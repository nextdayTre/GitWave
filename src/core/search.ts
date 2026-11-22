/**
 * search.ts — the commit filter behind visual search.
 *
 * A query is a small, total language: free text plus `key:value` tokens, all
 * ANDed. It returns the matching commits (for the cards and stepping) and a
 * sha set (for the slot levels), or `null` when the query is empty so every
 * renderer knows there is no filter. No network, no regex backtracking, no
 * history mutation.
 */

import type { Commit, GitRef, Model } from "./types.ts";

export const MAX_QUERY = 120;
export const MAX_TOKENS = 12;

export interface SearchToken {
  key: string;
  value: string;
}

export interface SearchState {
  query: string;
  tokens: SearchToken[];
  /** null = no filter; an empty Set = a query that matched nothing. */
  shas: Set<string> | null;
  matches: Commit[];
  count: number;
  error: string | null;
}

const KEYS = new Set([
  "author",
  "ref",
  "pr",
  "sha",
  "subject",
  "after",
  "before",
  "kind",
  "is",
]);

function tokenize(query: string): SearchToken[] {
  const tokens: SearchToken[] = [];
  for (const part of query.split(/\s+/).filter(Boolean).slice(0, MAX_TOKENS)) {
    const colon = part.indexOf(":");
    if (colon > 0) {
      const key = part.slice(0, colon).toLowerCase();
      if (KEYS.has(key)) {
        tokens.push({ key, value: part.slice(colon + 1).toLowerCase() });
        continue;
      }
    }
    const bare = part.toLowerCase();
    if (bare === "agent" || bare === "human" || bare === "merge" || bare === "merged") {
      tokens.push({ key: "is", value: bare });
      continue;
    }
    tokens.push({ key: "text", value: bare });
  }
  return tokens;
}

function refsOf(model: Model, commit: Commit): GitRef[] {
  const out: GitRef[] = [];
  for (const id of commit.refs) {
    const ref = model.refsById.get(id);
    if (ref) out.push(ref);
  }
  return out;
}

function textOf(commit: Commit, refs: GitRef[]): string {
  const parts = [commit.subject, commit.author.name, commit.sha];
  for (const ref of refs) {
    parts.push(ref.id, ref.name);
    if (ref.pr) parts.push(ref.pr.title, `#${ref.pr.number}`);
  }
  return parts.join(" ").toLowerCase();
}

function matchToken(model: Model, commit: Commit, token: SearchToken): boolean {
  const refs = refsOf(model, commit);
  const prs = refs.map((ref) => ref.pr).filter((pr) => pr !== null);
  switch (token.key) {
    case "author":
      if (token.value === "agent") return commit.author.kind === "agent";
      if (token.value === "human") return commit.author.kind === "human";
      return commit.author.name.toLowerCase().includes(token.value);
    case "ref":
      return refs.some(
        (ref) =>
          ref.id.toLowerCase().includes(token.value) ||
          ref.name.toLowerCase().includes(token.value)
      );
    case "pr":
      return prs.some(
        (pr) => String(pr.number) === token.value || pr.title.toLowerCase().includes(token.value)
      );
    case "sha":
      return token.value.length > 0 && commit.sha.startsWith(token.value);
    case "subject":
      return commit.subject.toLowerCase().includes(token.value);
    case "kind":
      return commit.author.kind === token.value;
    case "is":
      if (token.value === "merge") return commit.merge;
      if (token.value === "merged") {
        return commit.merge || refs.some((ref) => ref.mergedAt !== null);
      }
      if (token.value === "agent") return commit.author.kind === "agent";
      if (token.value === "human") return commit.author.kind === "human";
      return false;
    case "after": {
      const ms = Date.parse(token.value.length === 10 ? `${token.value}T00:00:00Z` : token.value);
      return Number.isFinite(ms) ? Date.parse(commit.time) >= ms : false;
    }
    case "before": {
      const ms = Date.parse(token.value.length === 10 ? `${token.value}T23:59:59Z` : token.value);
      return Number.isFinite(ms) ? Date.parse(commit.time) <= ms : false;
    }
    default:
      return textOf(commit, refs).includes(token.value);
  }
}

/** Parse and run a query. Never throws; a bad token simply matches nothing. */
export function searchCommits(model: Model, raw: string): SearchState {
  const query = String(raw ?? "").trim().slice(0, MAX_QUERY);
  if (!query) {
    return { query: "", tokens: [], shas: null, matches: [], count: 0, error: null };
  }
  const tokens = tokenize(query);
  const matches: Commit[] = [];
  for (const commit of model.doc.commits) {
    if (tokens.every((token) => matchToken(model, commit, token))) matches.push(commit);
  }
  matches.sort(
    (a, b) => Date.parse(a.time) - Date.parse(b.time) || a.sha.localeCompare(b.sha)
  );
  return {
    query,
    tokens,
    shas: new Set(matches.map((commit) => commit.sha)),
    matches,
    count: matches.length,
    error: null,
  };
}

/** The human-readable summary shown next to the find field. */
export function searchLabel(search: SearchState): string {
  if (!search.query) return "";
  if (search.count === 0) return "no matches";
  return `${search.count} match${search.count === 1 ? "" : "es"}`;
}
