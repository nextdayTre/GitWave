/**
 * refs.ts — ref lifetimes, pull requests and the tension model.
 *
 * In GitWave a pull request is a *semantic reading of a ref*: a branch that is
 * not merged into the trunk is open; a branch whose age exceeds the stale
 * threshold is stale; a fixture may additionally say it conflicts, is a draft,
 * or waits on review. Nothing here talks to a network — the PR is data the
 * document carries.
 */

import type { Commit, GitRef, Model, PullRequest } from "./types.ts";
import { DAY, clamp, refTipTime } from "./samples.ts";

export const STALE_DAYS = 14;
export const AGE_PLOT_DAYS = 20;

export interface PrView {
  ref: GitRef;
  pr: PullRequest;
  ageDays: number;
  ageNorm: number;
  churn: number;
  commits: number;
  amountNorm: number;
  tension: number;
  stale: boolean;
  agentAuthored: boolean;
}

export interface PrVector {
  x: number;
  y: number;
  w: number;
}

export function refCommits(model: Model, refId: string): Commit[] {
  return model.commitsByRef.get(refId) ?? [];
}

export function refChurn(model: Model, refId: string): number {
  let total = 0;
  for (const commit of refCommits(model, refId)) {
    if (commit.merge) continue;
    total += commit.insertions + commit.deletions;
  }
  return total;
}

export function refAgeDays(model: Model, ref: GitRef, nowMs: number): number {
  return Math.max(0, (nowMs - refTipTime(model, ref)) / DAY);
}

export function refHasAgent(model: Model, refId: string): boolean {
  return refCommits(model, refId).some((commit) => commit.author.kind === "agent");
}

export function ageNorm(ageDays: number): number {
  return clamp(ageDays / STALE_DAYS, 0, 1);
}

export function agePlot(ageDays: number): number {
  return clamp(ageDays / AGE_PLOT_DAYS, 0, 1.2);
}

export function tensionOf(age: number, amount: number): number {
  return clamp(0.65 * age + 0.35 * amount, 0, 1);
}

/**
 * Open and draft PRs only — merged and closed refs are not tension.
 *
 * `amountNorm` is size *relative to the biggest open PR*: the pad compares
 * branches with each other, so a row of small fix branches does not all pin to
 * the top of the axis. The exact churn and commit count travel with the view.
 */
export function openPrs(model: Model, nowMs = model.snapshotMs): PrView[] {
  const entries: Array<Omit<PrView, "amountNorm" | "tension">> = [];
  for (const ref of model.doc.refs) {
    if (!ref.pr) continue;
    if (ref.pr.state !== "open" && ref.pr.state !== "draft") continue;
    const commits = refCommits(model, ref.id).filter((commit) => !commit.merge);
    const churn = commits.reduce(
      (total, commit) => total + commit.insertions + commit.deletions,
      0
    );
    const ageDays = refAgeDays(model, ref, nowMs);
    entries.push({
      ref,
      pr: ref.pr,
      ageDays,
      ageNorm: ageNorm(ageDays),
      churn,
      commits: commits.length,
      stale: ageDays > STALE_DAYS,
      agentAuthored: commits.some((commit) => commit.author.kind === "agent"),
    });
  }
  const maxChurn = Math.max(1, ...entries.map((entry) => entry.churn));
  return entries
    .map((entry) => {
      const amountNorm = clamp(entry.churn / maxChurn, 0.05, 1);
      return { ...entry, amountNorm, tension: tensionOf(entry.ageNorm, amountNorm) };
    })
    .sort((a, b) => b.tension - a.tension || a.pr.number - b.pr.number);
}

/** Weighted centre of attention for the tension pad; weights favour big PRs. */
export function prCentroid(prs: PrView[]): PrVector | null {
  let sx = 0;
  let sy = 0;
  let sw = 0;
  for (const pr of prs) {
    const w = 0.15 + pr.amountNorm;
    sx += agePlot(pr.ageDays) * w;
    sy += pr.amountNorm * w;
    sw += w;
  }
  if (!sw) return null;
  return { x: sx / sw, y: sy / sw, w: sw };
}

export function prVector(pr: PrView): PrVector {
  const w = 0.15 + pr.amountNorm;
  return { x: agePlot(pr.ageDays), y: pr.amountNorm, w };
}

export function mergeMarkers(
  model: Model,
  startMs: number,
  endMs: number
): Array<{ commit: Commit; ref: GitRef | null }> {
  const out: Array<{ commit: Commit; ref: GitRef | null }> = [];
  for (const commit of model.doc.commits) {
    if (!commit.merge) continue;
    const t = Date.parse(commit.time);
    if (t < startMs || t > endMs) continue;
    out.push({ commit, ref: commit.refs.length ? model.refsById.get(commit.refs[0]) ?? null : null });
  }
  return out.sort((a, b) => Date.parse(a.commit.time) - Date.parse(b.commit.time));
}

export function releaseFlags(
  model: Model,
  startMs: number,
  endMs: number
): Array<{ name: string; sha: string; timeMs: number }> {
  return model.doc.tags
    .map((tag) => ({ name: tag.name, sha: tag.sha, timeMs: Date.parse(tag.time) }))
    .filter((tag) => tag.timeMs >= startMs && tag.timeMs <= endMs)
    .sort((a, b) => a.timeMs - b.timeMs);
}

export function commitsSince(model: Model, sinceMs: number): Commit[] {
  if (!Number.isFinite(sinceMs)) return [];
  return model.doc.commits.filter((commit) => Date.parse(commit.time) > sinceMs);
}

export function staleCount(prs: PrView[]): number {
  return prs.filter((pr) => pr.stale).length;
}
