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
  "path",
  "file",
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

function pathsOf(commit: Commit): string[] {
  if (commit.paths && commit.paths.length) return commit.paths;
  if (commit.changes && commit.changes.length) return commit.changes.map((c) => c.path);
  return [];
}

function textOf(commit: Commit, refs: GitRef[]): string {
  const parts = [commit.subject, commit.author.name, commit.sha];
  for (const ref of refs) {
    parts.push(ref.id, ref.name);
    if (ref.pr) parts.push(ref.pr.title, `#${ref.pr.number}`);
  }
  for (const p of pathsOf(commit)) {
    parts.push(p);
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
    case "path":
    case "file": {
      if (!token.value) return false;
      const list = pathsOf(commit);
      return list.some((p) => p.toLowerCase().includes(token.value));
    }
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
      const ct = model.commitTimeBySha?.get(commit.sha) ?? Date.parse(commit.time);
      return Number.isFinite(ms) ? ct >= ms : false;
    }
    case "before": {
      const ms = Date.parse(token.value.length === 10 ? `${token.value}T23:59:59Z` : token.value);
      const ct = model.commitTimeBySha?.get(commit.sha) ?? Date.parse(commit.time);
      return Number.isFinite(ms) ? ct <= ms : false;
    }
    default:
      return textOf(commit, refs).includes(token.value);
  }
}

/* Per-frozen-model memoization so render loops never re-scan commits for identical queries. */
const searchCache = new WeakMap<Model, Map<string, SearchState>>();
const MAX_SEARCH_CACHE = 96;
const EMPTY_SEARCH: SearchState = Object.freeze({
  query: "",
  tokens: [],
  shas: null,
  matches: [],
  count: 0,
  error: null,
});

/** Parse and run a query. Never throws; a bad token simply matches nothing. */
export function searchCommits(model: Model, raw: string): SearchState {
  const query = String(raw ?? "").trim().slice(0, MAX_QUERY);
  if (!query) return EMPTY_SEARCH;

  let byQuery = searchCache.get(model);
  if (!byQuery) {
    byQuery = new Map<string, SearchState>();
    searchCache.set(model, byQuery);
  }
  const hit = byQuery.get(query);
  if (hit) return hit;

  const tokens = tokenize(query);
  const matches: Commit[] = [];
  for (const commit of model.doc.commits) {
    if (tokens.every((token) => matchToken(model, commit, token))) matches.push(commit);
  }
  const timeBySha = model.commitTimeBySha;
  matches.sort(
    (a, b) =>
      (timeBySha?.get(a.sha) ?? Date.parse(a.time)) -
        (timeBySha?.get(b.sha) ?? Date.parse(b.time)) || a.sha.localeCompare(b.sha)
  );
  const result: SearchState = {
    query,
    tokens,
    shas: new Set(matches.map((commit) => commit.sha)),
    matches,
    count: matches.length,
    error: null,
  };
  if (byQuery.size >= MAX_SEARCH_CACHE) {
    const oldest = byQuery.keys().next().value;
    if (oldest !== undefined) byQuery.delete(oldest);
  }
  byQuery.set(query, result);
  return result;
}

/** The human-readable summary shown next to the find field. */
export function searchLabel(search: SearchState): string {
  if (!search.query) return "";
  if (search.count === 0) return "no matches";
  return `${search.count} match${search.count === 1 ? "" : "es"}`;
}

export interface ContentGroup {
  name: string;
  query: string;
  kind: "folder" | "file";
  commits: number;
  churn: number;
}

/**
 * Derive deterministic folder/file content groups from commit paths so real
 * single-author repos expose their actual codebase modules as wavetables.
 */
export function repoContentGroups(model: Model, limit = 16): ContentGroup[] {
  const dirStats = new Map<string, { commits: Set<string>; churn: number }>();
  const fileStats = new Map<string, { commits: Set<string>; churn: number }>();

  for (const commit of model.doc.commits) {
    const list = pathsOf(commit);
    if (!list.length) continue;
    const perFileChurn = Math.max(1, Math.round((commit.insertions + commit.deletions) / list.length));
    for (const rawPath of list) {
      const clean = rawPath.replace(/\\/g, "/").replace(/^\/+/, "");
      if (!clean) continue;
      const slash = clean.indexOf("/");
      if (slash > 0) {
        const dir = clean.slice(0, slash);
        const rec = dirStats.get(dir) ?? { commits: new Set<string>(), churn: 0 };
        rec.commits.add(commit.sha);
        rec.churn += perFileChurn;
        dirStats.set(dir, rec);
      } else {
        const rec = fileStats.get(clean) ?? { commits: new Set<string>(), churn: 0 };
        rec.commits.add(commit.sha);
        rec.churn += perFileChurn;
        fileStats.set(clean, rec);
      }
    }
  }

  const out: ContentGroup[] = [];
  for (const [dir, rec] of dirStats.entries()) {
    out.push({
      name: `${dir}/`,
      query: `path:${dir}/`,
      kind: "folder",
      commits: rec.commits.size,
      churn: rec.churn,
    });
  }
  for (const [file, rec] of fileStats.entries()) {
    out.push({
      name: file,
      query: `path:${file}`,
      kind: "file",
      commits: rec.commits.size,
      churn: rec.churn,
    });
  }

  return out
    .sort((a, b) => {
      if (a.kind !== b.kind && dirStats.size >= 2) return a.kind === "folder" ? -1 : 1;
      return b.commits - a.commits || b.churn - a.churn || a.name.localeCompare(b.name);
    })
    .slice(0, limit);
}
