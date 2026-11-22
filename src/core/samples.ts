/**
 * samples.ts — the wavetable frame.
 *
 * A GitWave window is split into a fixed number of slots (the "samples" of the
 * wavetable). A slot is a slice of wall-clock time; every ref that has commits
 * in it contributes one level, `0..15`, derived from that slot's total churn
 * through the stored logarithmic scale. Empty slots are real zeros: "no
 * commits in this slice", shown honestly in the strip.
 *
 * Pure and DOM-free. Every renderer uses these functions, so the curve, the
 * strip and hit-testing cannot drift apart.
 */

import type { Commit, Model, RefKind, GitRef, SpanKey } from "./types.ts";

export const SLOT_COUNT = 32;
export const DAY = 86400000;

export const SPANS: Record<SpanKey, number> = {
  "7d": 7 * DAY,
  "30d": 30 * DAY,
  "90d": 90 * DAY,
  all: Number.POSITIVE_INFINITY,
};

export const SPAN_ORDER: SpanKey[] = ["7d", "30d", "90d", "all"];

export interface SlotRef {
  refId: string;
  count: number;
  churn: number;
  level: number;
  tip: Commit;
}

export interface Slot {
  k: number;
  startMs: number;
  endMs: number;
  count: number;
  churn: number;
  level: number;
  agentCount: number;
  commits: Commit[];
  byRef: Map<string, SlotRef>;
  newest: Commit | null;
}

export interface WavePoint {
  k: number;
  level: number;
  count: number;
  tip: Commit | null;
}

export interface Window {
  span: SpanKey;
  startMs: number;
  endMs: number;
  slotMs: number;
}

/** The one churn → level mapping. Bounded, monotone, deterministic. */
export function levelOf(churn: number, ceiling: number): number {
  if (!(churn > 0) || !(ceiling > 0)) return 0;
  const raw = (15 * Math.log(1 + churn)) / Math.log(1 + ceiling);
  return Math.max(0, Math.min(15, Math.round(raw)));
}

export function clamp(value: number, lo: number, hi: number): number {
  return value < lo ? lo : value > hi ? hi : value;
}

/** Canonical ISO without the `.000` fraction — equal instants, equal strings. */
export function isoOf(ms: number): string {
  return new Date(ms).toISOString().replace(".000Z", "Z");
}

export function windowFor(model: Model, endIso: string, span: SpanKey): Window {
  const snapshot = model.snapshotMs;
  const requested = Date.parse(endIso);
  const safeEnd = Number.isFinite(requested) ? requested : snapshot;
  if (span === "all") {
    return {
      span,
      startMs: model.startMs,
      endMs: snapshot,
      slotMs: (snapshot - model.startMs) / SLOT_COUNT,
    };
  }
  const spanMs = SPANS[span];
  const minEnd = Math.min(snapshot, model.startMs + spanMs);
  const endMs = clamp(safeEnd, minEnd, snapshot);
  const startMs = Math.max(model.startMs, endMs - spanMs);
  return { span, startMs, endMs, slotMs: (endMs - startMs) / SLOT_COUNT };
}

export function clampEndIso(model: Model, endIso: string, span: SpanKey): string {
  return isoOf(windowFor(model, endIso, span).endMs);
}

export function slotIndexForTime(window: Window, timeMs: number): number {
  if (window.slotMs <= 0) return 0;
  const raw = Math.floor((timeMs - window.startMs) / window.slotMs);
  return clamp(raw, 0, SLOT_COUNT - 1);
}

/**
 * The level scale for a window: the document ceiling is a floor (a quiet week
 * stays quiet); a busy window rescales to its own 95th-percentile slot churn so
 * the shape stays legible as the span grows. Exact churn is always in the strip
 * and the commit card, so the level is a visual scale, never a claim.
 */
export function effectiveCeiling(
  model: Model,
  window: Window,
  shas: Set<string> | null = null
): number {
  const sums = new Array<number>(SLOT_COUNT).fill(0);
  for (const commit of model.doc.commits) {
    if (commit.merge) continue;
    if (shas && !shas.has(commit.sha)) continue;
    const t = Date.parse(commit.time);
    if (t < window.startMs || t > window.endMs) continue;
    sums[slotIndexForTime(window, t)] += commit.insertions + commit.deletions;
  }
  const sorted = sums.sort((a, b) => a - b);
  const p95 = sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * 0.95))] ?? 0;
  return Math.max(model.doc.scale.churnCeiling, p95);
}

export function buildSlots(
  model: Model,
  window: Window,
  shas: Set<string> | null = null,
  ceiling?: number
): Slot[] {
  const slots: Slot[] = new Array(SLOT_COUNT);
  for (let k = 0; k < SLOT_COUNT; k++) {
    slots[k] = {
      k,
      startMs: window.startMs + k * window.slotMs,
      endMs: window.startMs + (k + 1) * window.slotMs,
      count: 0,
      churn: 0,
      level: 0,
      agentCount: 0,
      commits: [],
      byRef: new Map<string, SlotRef>(),
      newest: null,
    };
  }
  for (const commit of model.doc.commits) {
    if (commit.merge) continue;
    if (shas && !shas.has(commit.sha)) continue;
    const t = Date.parse(commit.time);
    if (t < window.startMs || t > window.endMs) continue;
    const slot = slots[slotIndexForTime(window, t)];
    const churn = commit.insertions + commit.deletions;
    slot.commits.push(commit);
    slot.count += 1;
    slot.churn += churn;
    if (commit.author.kind === "agent") slot.agentCount += 1;
    if (!slot.newest || Date.parse(commit.time) >= Date.parse(slot.newest.time)) {
      slot.newest = commit;
    }
    for (const refId of commit.refs) {
      const existing = slot.byRef.get(refId);
      if (existing) {
        existing.count += 1;
        existing.churn += churn;
        if (Date.parse(commit.time) >= Date.parse(existing.tip.time)) existing.tip = commit;
      } else {
        slot.byRef.set(refId, { refId, count: 1, churn, level: 0, tip: commit });
      }
    }
  }
  /*
   * Scale: see effectiveCeiling. A caller may pass a fixed ceiling so every
   * layer of the depth field shares one scale.
   */
  const scale = ceiling ?? effectiveCeiling(model, window, shas);
  for (const slot of slots) {
    slot.level = levelOf(slot.churn, scale);
    for (const entry of slot.byRef.values()) {
      entry.level = levelOf(entry.churn, scale);
    }
  }
  return slots;
}

/**
 * A ref's wave over the slots inside its lifetime.
 *
 * - trunk: the whole window (the repository exists even when nobody committed)
 * - branch: first commit → tip; before the fork and after the tip there is no line
 *
 * Returns `[]` when the lifetime does not overlap the window.
 */
export function refWave(
  model: Model,
  ref: GitRef,
  window: Window,
  slots?: Slot[]
): WavePoint[] {
  const tipTime = refTipTime(model, ref);
  const createdAt = Date.parse(ref.createdAt);
  if (tipTime < window.startMs || createdAt > window.endMs) return [];

  const first = ref.kind === "trunk" ? 0 : slotIndexForTime(window, Math.max(createdAt, window.startMs));
  const last = ref.kind === "trunk" ? SLOT_COUNT - 1 : slotIndexForTime(window, Math.min(tipTime, window.endMs));
  if (last < first) return [];

  const points: WavePoint[] = [];
  const frame = slots ?? buildSlots(model, window);
  for (let k = first; k <= last; k++) {
    const entry = frame[k].byRef.get(ref.id);
    points.push({
      k,
      level: entry ? entry.level : 0,
      count: entry ? entry.count : 0,
      tip: entry ? entry.tip : null,
    });
  }
  return points;
}

export function refTipTime(model: Model, ref: GitRef): number {
  const commits = model.commitsByRef.get(ref.id) ?? [];
  const last = commits[commits.length - 1];
  return last ? Date.parse(last.time) : Date.parse(ref.createdAt);
}

export function slotStops(model: Model, window: Window): number[] {
  return Array.from({ length: SLOT_COUNT }, (_, k) => window.startMs + (k + 0.5) * window.slotMs);
}

export function dateShort(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCDate()).padStart(2, "0")}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function dateMedium(ms: number): string {
  const d = new Date(ms);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

export function dateFull(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
    d.getUTCDate()
  ).padStart(2, "0")}`;
}

export function timeFull(ms: number): string {
  const d = new Date(ms);
  return `${dateFull(ms)} ${String(d.getUTCHours()).padStart(2, "0")}:${String(
    d.getUTCMinutes()
  ).padStart(2, "0")} UTC`;
}

export function spanLabel(span: SpanKey): string {
  return span === "all" ? "all" : span;
}

export function refKindLabel(kind: RefKind): string {
  return kind === "trunk" ? "trunk" : "branch";
}
