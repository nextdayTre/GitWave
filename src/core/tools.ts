/**
 * tools.ts — pure, deterministic, read-only query tools over a GitWave `Model`.
 *
 * One implementation (Rule 1): `window.gitwave`, the Node CLI, and the MCP
 * stdio server all call these functions instead of re-deriving churn, tension,
 * search or ref comparisons.
 */

import type { Commit, GitRef, Model } from "./types.ts";
import { openPrs, prCentroid, refChurn, refHasAgent } from "./refs.ts";
import { searchCommits } from "./search.ts";

export interface RepoSummaryResult {
  id: string;
  name: string;
  defaultRef: string;
  snapshotAt: string;
  span: { from: string; to: string };
  counts: {
    commits: number;
    refs: number;
    tags: number;
    merges: number;
    agentCommits: number;
    humanCommits: number;
    openPrs: number;
    stalePrs: number;
  };
  scale: { churnCeiling: number; levels: number };
  maxTension: number;
  releases: Array<{ name: string; sha: string; time: string }>;
  topAuthors: Array<{ name: string; kind: "human" | "agent"; commits: number; churn: number }>;
}

export function repoSummary(model: Model): RepoSummaryResult {
  const doc = model.doc;
  let merges = 0;
  let agentCommits = 0;
  const authorStats = new Map<string, { name: string; kind: "human" | "agent"; commits: number; churn: number }>();

  for (const c of doc.commits) {
    if (c.merge) merges += 1;
    if (c.author.kind === "agent") agentCommits += 1;
    const prev = authorStats.get(c.author.name) ?? {
      name: c.author.name,
      kind: c.author.kind,
      commits: 0,
      churn: 0,
    };
    prev.commits += 1;
    prev.churn += c.insertions + c.deletions;
    authorStats.set(c.author.name, prev);
  }

  const prs = openPrs(model);
  const topAuthors = [...authorStats.values()]
    .sort((a, b) => b.commits - a.commits || b.churn - a.churn || a.name.localeCompare(b.name))
    .slice(0, 8);

  return {
    id: doc.repo.id,
    name: doc.repo.name,
    defaultRef: doc.repo.defaultRef,
    snapshotAt: doc.repo.snapshotAt,
    span: { ...doc.repo.span },
    counts: {
      commits: doc.commits.length,
      refs: doc.refs.length,
      tags: doc.tags.length,
      merges,
      agentCommits,
      humanCommits: doc.commits.length - agentCommits,
      openPrs: prs.length,
      stalePrs: prs.filter((p) => p.stale).length,
    },
    scale: { ...doc.scale },
    maxTension: Number(prs.reduce((m, p) => Math.max(m, p.tension), 0).toFixed(3)),
    releases: model.tagsByTime.map((t) => ({ name: t.name, sha: t.sha, time: t.time })),
    topAuthors,
  };
}

export interface RefListItem {
  id: string;
  name: string;
  kind: GitRef["kind"];
  base: string | null;
  tip: string;
  createdAt: string;
  mergedAt: string | null;
  commits: number;
  churn: number;
  hasAgent: boolean;
  pr: {
    number: number;
    title: string;
    state: string;
    review: string;
    checks: string;
    conflicts: boolean;
    draft: boolean;
    ageDays: number | null;
    tension: number | null;
    stale: boolean;
  } | null;
}

export function listRefsTool(model: Model): RefListItem[] {
  const prsByRef = new Map(openPrs(model).map((p) => [p.ref.id, p]));
  return model.doc.refs.map((ref) => {
    const commits = model.commitsByRef.get(ref.id) ?? [];
    const prView = prsByRef.get(ref.id) ?? null;
    return {
      id: ref.id,
      name: ref.name,
      kind: ref.kind,
      base: ref.base,
      tip: ref.tip,
      createdAt: ref.createdAt,
      mergedAt: ref.mergedAt,
      commits: commits.length,
      churn: refChurn(model, ref.id),
      hasAgent: refHasAgent(model, ref.id),
      pr: ref.pr
        ? {
            number: ref.pr.number,
            title: ref.pr.title,
            state: ref.pr.state,
            review: ref.pr.review,
            checks: ref.pr.checks,
            conflicts: ref.pr.conflicts,
            draft: ref.pr.draft,
            ageDays: prView ? Number(prView.ageDays.toFixed(2)) : null,
            tension: prView ? Number(prView.tension.toFixed(3)) : null,
            stale: prView ? prView.stale : false,
          }
        : null,
    };
  });
}

export interface SearchCommitsResult {
  query: string;
  total: number;
  returned: number;
  commits: Array<{
    sha: string;
    time: string;
    author: string;
    authorKind: "human" | "agent";
    subject: string;
    refs: string[];
    insertions: number;
    deletions: number;
    files: number;
    merge: boolean;
  }>;
}

export function searchCommitsTool(
  model: Model,
  query: string,
  limit = 25
): SearchCommitsResult {
  const cap = Math.max(1, Math.min(200, Math.round(limit)));
  const res = searchCommits(model, query);
  const list = query.trim() ? res.matches : model.doc.commits;
  const newestFirst = [...list].reverse().slice(0, cap);
  return {
    query: res.query,
    total: list.length,
    returned: newestFirst.length,
    commits: newestFirst.map((c) => ({
      sha: c.sha,
      time: c.time,
      author: c.author.name,
      authorKind: c.author.kind,
      subject: c.subject,
      refs: [...c.refs],
      insertions: c.insertions,
      deletions: c.deletions,
      files: c.files,
      merge: c.merge,
    })),
  };
}

export interface CommitDetailResult {
  sha: string;
  time: string;
  author: Commit["author"];
  agent: Commit["agent"];
  subject: string;
  insertions: number;
  deletions: number;
  files: number;
  refs: string[];
  merge: boolean;
  parents: Array<{ sha: string; subject: string | null }>;
  children: Array<{ sha: string; subject: string }>;
  changes: Commit["changes"] | null;
}

export function commitDetailTool(
  model: Model,
  shaQuery: string
): CommitDetailResult | null {
  const prefix = shaQuery.trim().toLowerCase();
  if (!prefix) return null;
  let found: Commit | null = model.commitBySha.get(prefix) ?? null;
  if (!found) {
    for (const c of model.doc.commits) {
      if (c.sha.startsWith(prefix)) {
        found = c;
        break;
      }
    }
  }
  if (!found) return null;

  const children = model.doc.commits
    .filter((c) => c.parents.includes(found!.sha))
    .map((c) => ({ sha: c.sha, subject: c.subject }));

  return {
    sha: found.sha,
    time: found.time,
    author: { ...found.author },
    agent: found.agent ? { ...found.agent } : null,
    subject: found.subject,
    insertions: found.insertions,
    deletions: found.deletions,
    files: found.files,
    refs: [...found.refs],
    merge: found.merge,
    parents: found.parents.map((p) => ({
      sha: p,
      subject: model.commitBySha.get(p)?.subject ?? null,
    })),
    children,
    changes: found.changes ? found.changes.map((ch) => ({ ...ch })) : null,
  };
}

export interface TensionReportResult {
  snapshotAt: string;
  openCount: number;
  staleCount: number;
  centroid: { x: number; y: number; w: number } | null;
  prs: Array<{
    ref: string;
    number: number;
    title: string;
    state: string;
    review: string;
    checks: string;
    conflicts: boolean;
    draft: boolean;
    agentAuthored: boolean;
    commits: number;
    churn: number;
    ageDays: number;
    amountNorm: number;
    tension: number;
    stale: boolean;
  }>;
}

export function tensionReportTool(model: Model): TensionReportResult {
  const prs = openPrs(model);
  const c = prCentroid(prs);
  return {
    snapshotAt: model.doc.repo.snapshotAt,
    openCount: prs.length,
    staleCount: prs.filter((p) => p.stale).length,
    centroid: c
      ? {
          x: Number(c.x.toFixed(3)),
          y: Number(c.y.toFixed(3)),
          w: Number(c.w.toFixed(3)),
        }
      : null,
    prs: prs.map((p) => ({
      ref: p.ref.id,
      number: p.pr.number,
      title: p.pr.title,
      state: p.pr.state,
      review: p.pr.review,
      checks: p.pr.checks,
      conflicts: p.pr.conflicts,
      draft: p.pr.draft,
      agentAuthored: p.agentAuthored,
      commits: p.commits,
      churn: p.churn,
      ageDays: Number(p.ageDays.toFixed(2)),
      amountNorm: Number(p.amountNorm.toFixed(3)),
      tension: Number(p.tension.toFixed(3)),
      stale: p.stale,
    })),
  };
}

export interface CompareRefsResult {
  base: string;
  head: string;
  baseCommits: number;
  headCommits: number;
  sharedCommits: number;
  onlyInBase: number;
  onlyInHead: number;
  baseChurn: number;
  headChurn: number;
  churnDelta: number;
  headOnlySample: Array<{ sha: string; time: string; author: string; subject: string }>;
}

export function compareRefsTool(
  model: Model,
  baseId: string,
  headId: string
): CompareRefsResult | null {
  const baseRef = model.refsById.get(baseId);
  const headRef = model.refsById.get(headId);
  if (!baseRef || !headRef) return null;

  const baseList = model.commitsByRef.get(baseRef.id) ?? [];
  const headList = model.commitsByRef.get(headRef.id) ?? [];
  const baseShas = new Set(baseList.map((c) => c.sha));
  const headShas = new Set(headList.map((c) => c.sha));

  let sharedCommits = 0;
  for (const sha of headShas) {
    if (baseShas.has(sha)) sharedCommits += 1;
  }

  const headOnly = headList.filter((c) => !baseShas.has(c.sha));
  const baseChurn = refChurn(model, baseRef.id);
  const headChurn = refChurn(model, headRef.id);

  return {
    base: baseRef.id,
    head: headRef.id,
    baseCommits: baseList.length,
    headCommits: headList.length,
    sharedCommits,
    onlyInBase: baseList.length - sharedCommits,
    onlyInHead: headOnly.length,
    baseChurn,
    headChurn,
    churnDelta: headChurn - baseChurn,
    headOnlySample: [...headOnly]
      .reverse()
      .slice(0, 12)
      .map((c) => ({
        sha: c.sha,
        time: c.time,
        author: c.author.name,
        subject: c.subject,
      })),
  };
}
