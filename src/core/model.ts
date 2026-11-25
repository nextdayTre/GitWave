/**
 * model.ts — parse, validate and index a `.gitwave` document.
 *
 * The validator is deliberately strict about types and deliberately forgiving
 * about *unknown* keys: a newer writer may add fields, and a reader must not
 * guess at meaning. Anything that would change a number or a wave is checked.
 *
 * Pure and DOM-free. The document is deep-frozen after validation: GitWave is
 * a read-only instrument, and the freeze is the enforcement.
 */

import type {
  AuthorKind,
  Commit,
  CommitFileChange,
  FileChangeStatus,
  GitRef,
  Model,
  PullRequest,
  RepoDoc,
  Tag,
} from "./types.ts";

export interface ParseError {
  ok: false;
  code: "E_SCHEMA";
  errors: string[];
}

export interface ParseOk {
  ok: true;
  doc: RepoDoc;
  warnings: string[];
}

export type ParseResult = ParseOk | ParseError;

const HEX40 = /^[0-9a-f]{40}$/;
const AUTHOR_KINDS: AuthorKind[] = ["human", "agent"];
const PR_STATES = ["open", "merged", "draft", "closed"];
const REVIEW_STATES = ["none", "required", "approved", "changes_requested"];
const CHECKS_STATES = ["none", "pending", "passing", "failing"];
const REF_KINDS = ["trunk", "branch"];
const CHANGE_STATUSES: FileChangeStatus[] = ["added", "modified", "deleted", "renamed"];

function isObj(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asInt(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value)
    ? value
    : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asIso(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? value : null;
}

function asBool(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function allowed(value: string, list: string[]): boolean {
  return list.includes(value);
}

function fail(errors: string[]): ParseError {
  return { ok: false, code: "E_SCHEMA", errors };
}

/**
 * Validate a raw JSON value. Never throws, never mutates its input.
 * Max 32 refs and 20000 commits keeps a hostile document from freezing a tab.
 */
export function parseDoc(raw: unknown): ParseResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!isObj(raw)) return fail(["document must be an object"]);
  if (raw.schemaVersion !== 1) {
    return fail([`unsupported schemaVersion ${String(raw.schemaVersion)} (expected 1)`]);
  }
  if (raw.tool !== "gitwave") return fail(["tool must be \"gitwave\""]);

  const repoRaw = raw.repo;
  if (!isObj(repoRaw)) return fail(["repo must be an object"]);
  const repoId = asString(repoRaw.id);
  const repoName = asString(repoRaw.name);
  const defaultRef = asString(repoRaw.defaultRef);
  const snapshotAt = asIso(repoRaw.snapshotAt);
  const spanRaw = repoRaw.span;
  const spanFrom = isObj(spanRaw) ? asIso(spanRaw.from) : null;
  const spanTo = isObj(spanRaw) ? asIso(spanRaw.to) : null;
  if (!repoId) errors.push("repo.id must be a string");
  if (!repoName) errors.push("repo.name must be a string");
  if (!defaultRef) errors.push("repo.defaultRef must be a string");
  if (!snapshotAt) errors.push("repo.snapshotAt must be an ISO timestamp");
  if (!spanFrom || !spanTo) errors.push("repo.span needs ISO from/to");

  if (!Array.isArray(raw.refs) || raw.refs.length === 0) {
    errors.push("refs must be a non-empty array");
  }
  if (!Array.isArray(raw.commits) || raw.commits.length === 0) {
    errors.push("commits must be a non-empty array");
  }
  if (errors.length) return fail(errors);

  const refsRaw = raw.refs as unknown[];
  const commitsRaw = raw.commits as unknown[];
  if (refsRaw.length > 32) errors.push("refs may not exceed 32");
  if (commitsRaw.length > 20000) errors.push("commits may not exceed 20000");

  const refIds = new Set<string>();
  const refs: GitRef[] = [];
  for (let i = 0; i < refsRaw.length; i++) {
    const r = refsRaw[i];
    const where = `refs[${i}]`;
    if (!isObj(r)) {
      errors.push(`${where} must be an object`);
      continue;
    }
    const id = asString(r.id);
    const name = asString(r.name);
    const kind = asString(r.kind);
    const base = r.base === null ? null : asString(r.base);
    const tip = asString(r.tip);
    const createdAt = asIso(r.createdAt);
    const mergedAt = r.mergedAt === null ? null : asIso(r.mergedAt);
    const colorKey = asInt(r.colorKey);
    if (!id) errors.push(`${where}.id must be a string`);
    if (!name) errors.push(`${where}.name must be a string`);
    if (!kind || !allowed(kind, REF_KINDS)) errors.push(`${where}.kind must be trunk|branch`);
    if (base === null && r.base !== null && r.base !== undefined) {
      errors.push(`${where}.base must be a string or null`);
    }
    if (!tip || !HEX40.test(tip)) errors.push(`${where}.tip must be a 40-char lowercase hex sha`);
    if (!createdAt) errors.push(`${where}.createdAt must be an ISO timestamp`);
    if (r.mergedAt !== null && !mergedAt) errors.push(`${where}.mergedAt must be ISO or null`);
    if (colorKey === null || colorKey < 0 || colorKey > 7) {
      errors.push(`${where}.colorKey must be an integer 0..7`);
    }
    let pr: PullRequest | null = null;
    if (r.pr !== null && r.pr !== undefined) {
      if (!isObj(r.pr)) {
        errors.push(`${where}.pr must be an object or null`);
      } else {
        const number = asInt(r.pr.number);
        const title = asString(r.pr.title);
        const state = asString(r.pr.state);
        const review = asString(r.pr.review);
        const checks = asString(r.pr.checks);
        if (number === null || number < 0) errors.push(`${where}.pr.number must be a positive integer`);
        if (!title) errors.push(`${where}.pr.title must be a string`);
        if (!state || !allowed(state, PR_STATES)) errors.push(`${where}.pr.state is invalid`);
        if (!review || !allowed(review, REVIEW_STATES)) errors.push(`${where}.pr.review is invalid`);
        if (!checks || !allowed(checks, CHECKS_STATES)) errors.push(`${where}.pr.checks is invalid`);
        if (errors.length === 0) {
          pr = {
            number: number as number,
            title: title as string,
            state: state as PullRequest["state"],
            review: review as PullRequest["review"],
            checks: checks as PullRequest["checks"],
            conflicts: asBool(r.pr.conflicts),
            draft: asBool(r.pr.draft),
            mergedAt: r.pr.mergedAt === null || r.pr.mergedAt === undefined
              ? null
              : asIso(r.pr.mergedAt),
          };
        }
      }
    }
    if (id && refIds.has(id)) errors.push(`${where}.id "${id}" is duplicated`);
    if (id) refIds.add(id);
    refs.push({
      id: id as string,
      name: name as string,
      kind: kind as GitRef["kind"],
      base,
      tip: tip as string,
      createdAt: createdAt as string,
      mergedAt,
      colorKey: colorKey as number,
      pr,
    });
  }

  const shas = new Set<string>();
  const commitRefs = new Map<string, string[]>();
  const commits: Commit[] = [];
  for (let i = 0; i < commitsRaw.length; i++) {
    const c = commitsRaw[i];
    const where = `commits[${i}]`;
    if (!isObj(c)) {
      errors.push(`${where} must be an object`);
      continue;
    }
    const sha = asString(c.sha);
    const time = asIso(c.time);
    const subject = asString(c.subject);
    const authorRaw = c.author;
    const authorName = isObj(authorRaw) ? asString(authorRaw.name) : null;
    const authorKind = isObj(authorRaw) ? asString(authorRaw.kind) : null;
    const parents = Array.isArray(c.parents) ? c.parents : null;
    const refIdsHere = Array.isArray(c.refs) ? c.refs : null;
    const insertions = asInt(c.insertions);
    const deletions = asInt(c.deletions);
    const files = asInt(c.files);
    if (!sha || !HEX40.test(sha)) errors.push(`${where}.sha must be 40-char lowercase hex`);
    if (!time) errors.push(`${where}.time must be an ISO timestamp`);
    if (!subject) errors.push(`${where}.subject must be a string`);
    if (!authorName) errors.push(`${where}.author.name must be a string`);
    if (!authorKind || !allowed(authorKind, AUTHOR_KINDS)) {
      errors.push(`${where}.author.kind must be human|agent`);
    }
    if (!parents) errors.push(`${where}.parents must be an array`);
    if (!refIdsHere) errors.push(`${where}.refs must be an array`);
    if (insertions === null || insertions < 0) errors.push(`${where}.insertions must be >= 0`);
    if (deletions === null || deletions < 0) errors.push(`${where}.deletions must be >= 0`);
    if (files === null || files < 0) errors.push(`${where}.files must be >= 0`);
    if (sha && shas.has(sha)) errors.push(`${where}.sha "${sha}" is duplicated`);
    if (sha) shas.add(sha);
    let agent = null;
    if (c.agent !== null && c.agent !== undefined) {
      if (!isObj(c.agent)) {
        errors.push(`${where}.agent must be an object or null`);
      } else {
        agent = {
          runtime: asString(c.agent.runtime) ?? "unknown",
          model: asString(c.agent.model) ?? "unknown",
        };
      }
    }
    const refsHere = (refIdsHere ?? []).filter((id): id is string => typeof id === "string");
    if (refIdsHere && refsHere.length !== refIdsHere.length) {
      errors.push(`${where}.refs must be strings`);
    }
    for (const id of refsHere) {
      if (!refIds.has(id)) warnings.push(`${where}.refs contains unknown ref "${id}"`);
    }
    commitRefs.set(sha as string, refsHere);
    let paths: string[] | undefined;
    if (Array.isArray(c.paths)) {
      const seenPaths = new Set<string>();
      const parsedPaths: string[] = [];
      for (const item of c.paths) {
        const p = asString(item);
        if (!p || seenPaths.has(p)) continue;
        seenPaths.add(p);
        parsedPaths.push(p.slice(0, 260));
        if (parsedPaths.length >= 120) break;
      }
      if (parsedPaths.length) paths = parsedPaths;
    }
    let changes: CommitFileChange[] | undefined;
    if (Array.isArray(c.changes)) {
      const parsedChanges: CommitFileChange[] = [];
      for (const item of c.changes) {
        if (!isObj(item)) continue;
        const path = asString(item.path);
        if (!path) continue;
        const rawStatus = asString(item.status) ?? "modified";
        const status: FileChangeStatus = allowed(rawStatus, CHANGE_STATUSES)
          ? (rawStatus as FileChangeStatus)
          : "modified";
        const ins = asInt(item.insertions) ?? 0;
        const del = asInt(item.deletions) ?? 0;
        const patch = typeof item.patch === "string" ? item.patch.slice(0, 65536) : undefined;
        parsedChanges.push({
          path,
          status,
          insertions: Math.max(0, ins),
          deletions: Math.max(0, del),
          ...(patch !== undefined ? { patch } : {}),
        });
        if (parsedChanges.length >= 200) break;
      }
      if (parsedChanges.length) changes = parsedChanges;
    }
    commits.push({
      sha: sha as string,
      parents: (parents ?? []).filter((p): p is string => typeof p === "string"),
      time: time as string,
      author: { name: authorName as string, kind: authorKind as AuthorKind },
      agent,
      subject: subject as string,
      insertions: insertions as number,
      deletions: deletions as number,
      files: files as number,
      refs: refsHere,
      merge: asBool(c.merge),
      ...(paths ? { paths } : {}),
      ...(changes ? { changes } : {}),
    });
  }

  const tagsRaw = Array.isArray(raw.tags) ? raw.tags : [];
  const tags: Tag[] = [];
  for (let i = 0; i < tagsRaw.length; i++) {
    const t = tagsRaw[i];
    const where = `tags[${i}]`;
    if (!isObj(t)) {
      errors.push(`${where} must be an object`);
      continue;
    }
    const name = asString(t.name);
    const sha = asString(t.sha);
    const time = asIso(t.time);
    if (!name) errors.push(`${where}.name must be a string`);
    if (!sha || !shas.has(sha)) errors.push(`${where}.sha must reference a commit`);
    if (!time) errors.push(`${where}.time must be an ISO timestamp`);
    if (name && sha) tags.push({ name, sha, time: time as string });
  }

  const scaleRaw = raw.scale;
  const ceiling = isObj(scaleRaw) ? asNumber(scaleRaw.churnCeiling) : null;
  const levels = isObj(scaleRaw) ? asInt(scaleRaw.levels) : null;
  if (ceiling === null || ceiling <= 0) errors.push("scale.churnCeiling must be > 0");
  if (levels !== 16) errors.push("scale.levels must be 16");

  for (const ref of refs) {
    if (!shas.has(ref.tip)) errors.push(`ref "${ref.id}" tip is not a commit`);
    let seen = 0;
    for (const list of commitRefs.values()) if (list.includes(ref.id)) seen++;
    if (seen === 0) errors.push(`ref "${ref.id}" has no commits`);
  }
  const trunkCount = refs.filter((r) => r.kind === "trunk").length;
  if (trunkCount !== 1) errors.push("exactly one ref must be kind \"trunk\"");
  if (!refIds.has(defaultRef as string)) errors.push("repo.defaultRef is not a ref");

  if (errors.length) return fail(errors);

  const doc: RepoDoc = {
    schemaVersion: 1,
    tool: "gitwave",
    ...(typeof raw.generatedBy === "string" ? { generatedBy: raw.generatedBy } : {}),
    repo: {
      id: repoId as string,
      name: repoName as string,
      defaultRef: defaultRef as string,
      snapshotAt: snapshotAt as string,
      span: { from: spanFrom as string, to: spanTo as string },
    },
    refs: refs.sort(
      (a, b) =>
        (a.kind === "trunk" ? -1 : 1) - (b.kind === "trunk" ? -1 : 1) ||
        a.colorKey - b.colorKey ||
        a.name.localeCompare(b.name)
    ),
    commits: commits.sort(
      (a, b) => Date.parse(a.time) - Date.parse(b.time) || a.sha.localeCompare(b.sha)
    ),
    tags: tags.sort((a, b) => Date.parse(a.time) - Date.parse(b.time)),
    scale: { churnCeiling: ceiling as number, levels: 16 },
  };

  return { ok: true, doc, warnings };
}

/** Index a validated document. O(commits + refs), computed once per load. */
export function buildModel(doc: RepoDoc): Model {
  const commitsByRef = new Map<string, Commit[]>();
  const refsById = new Map<string, GitRef>();
  const commitBySha = new Map<string, Commit>();
  const commitTimeMs = new Float64Array(doc.commits.length);
  const commitTimeBySha = new Map<string, number>();
  const refTipMs = new Map<string, number>();
  const refCreatedMs = new Map<string, number>();

  for (const ref of doc.refs) {
    refsById.set(ref.id, ref);
    commitsByRef.set(ref.id, []);
    refCreatedMs.set(ref.id, Date.parse(ref.createdAt));
  }
  for (let i = 0; i < doc.commits.length; i++) {
    const commit = doc.commits[i];
    const ms = Date.parse(commit.time);
    commitTimeMs[i] = ms;
    commitTimeBySha.set(commit.sha, ms);
    commitBySha.set(commit.sha, commit);
    for (const refId of commit.refs) {
      const list = commitsByRef.get(refId);
      if (list) list.push(commit);
    }
  }
  for (const [refId, list] of commitsByRef.entries()) {
    list.sort((a, b) => (commitTimeBySha.get(a.sha) ?? 0) - (commitTimeBySha.get(b.sha) ?? 0));
    const last = list[list.length - 1];
    refTipMs.set(
      refId,
      last ? commitTimeBySha.get(last.sha) ?? Date.parse(last.time) : refCreatedMs.get(refId) ?? 0
    );
  }
  return {
    doc,
    startMs: Date.parse(doc.repo.span.from),
    snapshotMs: Date.parse(doc.repo.snapshotAt),
    commitBySha,
    commitsByRef,
    refsById,
    tagsByTime: [...doc.tags].sort((a, b) => Date.parse(a.time) - Date.parse(b.time)),
    commitTimeMs,
    commitTimeBySha,
    refTipMs,
    refCreatedMs,
  };
}

/** Deep-freeze a document so no render path can mutate history. */
export function freezeDoc<T>(value: T): T {
  const seen = new WeakSet<object>();
  const walk = (node: unknown): void => {
    if (typeof node !== "object" || node === null) return;
    if (seen.has(node)) return;
    seen.add(node);
    for (const key of Object.keys(node)) {
      walk((node as Record<string, unknown>)[key]);
    }
    Object.freeze(node);
  };
  walk(value);
  return value;
}

export function commitChurn(commit: Commit): number {
  return commit.insertions + commit.deletions;
}
