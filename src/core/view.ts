/**
 * view.ts — the only mutable thing in GitWave.
 *
 * A view is window + visible refs + focus + theme + lens + motion. Every
 * transition is a pure function returning a fresh view; the document itself is
 * frozen. View validation is total: bad input degrades to the default with a
 * warning rather than throwing.
 */

import type {
  Commit,
  GitRef,
  Model,
  MotionMode,
  SpanKey,
  ThemeName,
  View,
  ViewModule,
} from "./types.ts";
import { SLOT_COUNT, SPANS, clamp, isoOf, refTipTime, windowFor } from "./samples.ts";
import { searchCommits } from "./search.ts";
import type { Slot } from "./samples.ts";
import { THEME_IDS } from "./theme.ts";

export const MAX_REFS = 8;
export const MOTION_MODES: MotionMode[] = ["sweep", "bounce", "once"];
export const MOTION_RATES = [1, 2, 4, 8];
const SPAN_KEYS: SpanKey[] = ["7d", "30d", "90d", "all"];

export interface Stop {
  kind: "tag" | "now";
  label: string;
  timeMs: number;
}

export interface ViewResult {
  view: View;
  warnings: string[];
}

function isObj(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isSpan(value: unknown): value is SpanKey {
  return typeof value === "string" && (SPAN_KEYS as string[]).includes(value);
}

export function isTheme(value: unknown): value is ThemeName {
  return typeof value === "string" && (THEME_IDS as string[]).includes(value);
}

export function isMotionMode(value: unknown): value is MotionMode {
  return typeof value === "string" && (MOTION_MODES as string[]).includes(value);
}

export function isMotionRate(value: unknown): value is number {
  return typeof value === "number" && MOTION_RATES.includes(value);
}

export function trunkOf(model: Model) {
  return model.doc.refs.find((ref) => ref.kind === "trunk") ?? model.doc.refs[0];
}

/**
 * The opening rack: integration history, a topical branch, and a person.
 * Every dataset can produce this shape; the demo produces exactly the three
 * cards the instrument is designed around (team / branch / individual).
 */
export function defaultModules(model: Model): ViewModule[] {
  const modules: ViewModule[] = [{ name: "Merge History", query: "merged", colorKey: 0 }];
  const branches = model.doc.refs.filter((ref) => ref.kind === "branch");
  const branch = branches.find((ref) => ref.id.startsWith("agent/")) ?? branches[0];
  if (branch) {
    modules.push({ name: branch.id, query: `ref:${branch.id}`, colorKey: branch.colorKey });
  }
  const trunk = trunkOf(model);
  const counts = new Map<string, number>();
  for (const commit of model.commitsByRef.get(trunk.id) ?? []) {
    if (commit.author.kind !== "human") continue;
    counts.set(commit.author.name, (counts.get(commit.author.name) ?? 0) + 1);
  }
  const top = [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0])
  )[0];
  if (top) {
    const used = new Set(modules.map((module) => module.colorKey));
    const colorKey = [1, 2, 4, 5, 3, 0].find((key) => !used.has(key)) ?? 4;
    modules.push({
      name: top[0],
      query: `author:${top[0].split(/\s+/)[0].toLowerCase()}`,
      colorKey,
    });
  }
  return modules.slice(0, 8);
}

export function defaultView(model: Model): View {
  const trunk = trunkOf(model);
  return {
    v: 1,
    repo: model.doc.repo.id,
    end: model.doc.repo.snapshotAt,
    span: "90d",
    refs: model.doc.refs.slice(0, MAX_REFS).map((ref) => ref.id),
    focusRef: trunk.id,
    focusSha: trunk.tip,
    theme: "signal",
    lens: { age: true, agents: false, prs: true },
    motion: { playing: false, mode: "sweep", rate: 4 },
    tray: false,
    depth: true,
    query: "",
    modules: defaultModules(model),
    rack: true,
  };
}

export function stopsFor(model: Model): Stop[] {
  const stops: Stop[] = model.doc.tags.map((tag) => ({
    kind: "tag",
    label: tag.name,
    timeMs: Date.parse(tag.time),
  }));
  stops.push({ kind: "now", label: "now", timeMs: model.snapshotMs });
  return stops.sort((a, b) => a.timeMs - b.timeMs);
}

export function endMsOf(view: View): number {
  const ms = Date.parse(view.end);
  return Number.isFinite(ms) ? ms : 0;
}

export function validateView(raw: unknown, model: Model): ViewResult {
  const base = defaultView(model);
  const warnings: string[] = [];
  if (!isObj(raw)) {
    return { view: base, warnings: ["view was not an object — using defaults"] };
  }
  if (raw.v !== 1) warnings.push("unknown view schema — values were clamped");
  if (typeof raw.repo === "string" && raw.repo !== model.doc.repo.id) {
    warnings.push(`view belongs to "${raw.repo}" — the loaded dataset is "${model.doc.repo.id}"`);
  }

  const span: SpanKey = isSpan(raw.span) ? raw.span : base.span;
  let end = base.end;
  if (typeof raw.end === "string" && Number.isFinite(Date.parse(raw.end))) {
    end = isoOf(windowFor(model, raw.end, span).endMs);
  } else if (raw.end !== undefined) {
    warnings.push("end was not an ISO timestamp — using the snapshot");
  }

  let refs = base.refs;
  if (Array.isArray(raw.refs)) {
    const seen = new Set<string>();
    refs = [];
    for (const id of raw.refs) {
      if (typeof id !== "string" || !model.refsById.has(id) || seen.has(id)) continue;
      seen.add(id);
      refs.push(id);
      if (refs.length >= MAX_REFS) break;
    }
    if (!refs.length) refs = base.refs;
  }

  let focusRef = typeof raw.focusRef === "string" && model.refsById.has(raw.focusRef)
    ? raw.focusRef
    : base.focusRef;
  if (!refs.includes(focusRef)) {
    if (refs.length >= MAX_REFS) refs = refs.slice(0, MAX_REFS - 1);
    refs = [...refs, focusRef];
  }

  let focusSha: string | null = base.focusSha;
  if (raw.focusSha === null) focusSha = null;
  else if (typeof raw.focusSha === "string") {
    focusSha = model.commitBySha.has(raw.focusSha) ? raw.focusSha : null;
    if (!focusSha) warnings.push("focus commit was not found — focus cleared");
  }

  const theme: ThemeName = isTheme(raw.theme) ? raw.theme : base.theme;
  if (raw.theme !== undefined && !isTheme(raw.theme)) {
    warnings.push("unknown theme — using signal");
  }

  const lensRaw = isObj(raw.lens) ? raw.lens : {};
  const lens = {
    age: typeof lensRaw.age === "boolean" ? lensRaw.age : base.lens.age,
    agents: typeof lensRaw.agents === "boolean" ? lensRaw.agents : base.lens.agents,
    prs: typeof lensRaw.prs === "boolean" ? lensRaw.prs : base.lens.prs,
  };

  const motionRaw = isObj(raw.motion) ? raw.motion : {};
  const mode = isMotionMode(motionRaw.mode) ? motionRaw.mode : base.motion.mode;
  const rate = isMotionRate(motionRaw.rate) ? motionRaw.rate : base.motion.rate;

  let modules = base.modules;
  if (Array.isArray(raw.modules) && raw.modules.length) {
    const next: ViewModule[] = [];
    for (const item of raw.modules) {
      if (!isObj(item)) continue;
      const name = typeof item.name === "string" ? item.name.trim().slice(0, 40) : "";
      const query = typeof item.query === "string" ? item.query.slice(0, 120) : "";
      const colorKey =
        typeof item.colorKey === "number" &&
        Number.isInteger(item.colorKey) &&
        item.colorKey >= 0 &&
        item.colorKey <= 5
          ? item.colorKey
          : next.length % 6;
      if (!name && !query) continue;
      next.push({ name: name || query || `OSC ${next.length + 1}`, query, colorKey });
      if (next.length >= 8) break;
    }
    if (next.length) modules = next;
  }

  return {
    warnings,
    view: {
      v: 1,
      repo: model.doc.repo.id,
      end,
      span,
      refs,
      focusRef,
      focusSha,
      theme,
      lens,
      // Playing is never restored from a view: GitWave does not autoplay.
      motion: { playing: false, mode, rate },
      tray: raw.tray === true,
      depth: typeof raw.depth === "boolean" ? raw.depth : base.depth,
      query: typeof raw.query === "string" ? raw.query.slice(0, 120) : "",
      modules,
      rack: raw.rack !== false,
    },
  };
}

/** Move the read head by one slot. `all` shows everything, so it does not step. */
export function nudgeEnd(model: Model, view: View, direction: number): View {
  if (view.span === "all") return view;
  const window = windowFor(model, view.end, view.span);
  const step = window.slotMs || (model.snapshotMs - model.startMs) / SLOT_COUNT;
  const spanMs = window.endMs - window.startMs;
  const minEnd = Math.min(model.snapshotMs, model.startMs + spanMs);
  const next = clamp(window.endMs + direction * step, minEnd, model.snapshotMs);
  return { ...view, end: isoOf(next) };
}

export function setSpan(model: Model, view: View, span: SpanKey): View {
  const next = { ...view, span };
  next.end = isoOf(windowFor(model, next.end, span).endMs);
  return next;
}

export function jumpToStop(model: Model, view: View, index: number): View {
  const stops = stopsFor(model);
  const stop = stops[Math.max(0, Math.min(stops.length - 1, index))];
  if (!stop) return view;
  const nextEnd = windowFor(model, new Date(stop.timeMs).toISOString(), view.span).endMs;
  return { ...view, end: isoOf(nextEnd) };
}

/** The last release at or before the read head; `now` when past the last tag. */
export function activeStopIndex(model: Model, view: View): number {
  const stops = stopsFor(model);
  const end = endMsOf(view);
  let index = 0;
  for (let i = 0; i < stops.length; i++) {
    if (stops[i].timeMs <= end + 1) index = i;
  }
  return index;
}

export function cycleTheme(view: View): View {
  const index = THEME_IDS.indexOf(view.theme);
  const next = THEME_IDS[(index + 1) % THEME_IDS.length];
  return { ...view, theme: next };
}

/** Add a ref to the visible set, dropping the most recently added at the cap. */
export function showRef(view: View, refId: string): View {
  if (view.refs.includes(refId)) return view;
  const refs = [...view.refs];
  while (refs.length >= MAX_REFS) refs.pop();
  refs.push(refId);
  return { ...view, refs };
}

/** Toggle visibility. The focused ref cannot be hidden without clearing focus. */
export function toggleRef(view: View, refId: string): View {
  if (!view.refs.includes(refId)) return showRef(view, refId);
  if (view.refs.length <= 1) return view;
  const refs = view.refs.filter((id) => id !== refId);
  if (view.focusRef === refId) {
    return { ...view, refs, focusRef: refs[0], focusSha: null };
  }
  return { ...view, refs };
}

/** Solo a module: its filter becomes the active filter for the whole instrument. */
export function selectModule(view: View, module: ViewModule): View {
  return { ...view, query: module.query };
}

/** Pin the current filter as a module. Duplicate queries are refused. */
export function pinModule(view: View, module: ViewModule): View {
  if (view.modules.some((existing) => existing.query === module.query)) return view;
  if (view.modules.length >= 8) return view;
  return { ...view, modules: [...view.modules, { ...module }] };
}

export function addModules(view: View, seeds: ViewModule[]): View {
  const modules = [...view.modules];
  const seen = new Set(modules.map((module) => module.query));
  for (const seed of seeds) {
    if (modules.length >= 8) break;
    if (seen.has(seed.query)) continue;
    seen.add(seed.query);
    modules.push({ name: seed.name, query: seed.query, colorKey: seed.colorKey });
  }
  return { ...view, modules };
}

export function removeModule(view: View, index: number): View {
  if (view.modules.length <= 1) return view;
  return { ...view, modules: view.modules.filter((_, i) => i !== index) };
}

/** Open a module into the big depth field. */
export function expandModule(view: View, module: ViewModule): View {
  return { ...view, query: module.query, depth: true, rack: false };
}

/** Return from an expanded module to the rack. */
export function showRack(view: View): View {
  return { ...view, depth: true, rack: true };
}

export function focusSlot(view: View, slot: Slot): View {
  const commit = slot.newest;
  if (!commit) return view;
  const refId = commit.refs[0];
  if (!refId || !view.refs.includes(refId)) return { ...view, focusSha: commit.sha };
  return { ...view, focusRef: refId, focusSha: commit.sha };
}

export function focusCommit(view: View, refId: string | null, sha: string | null): View {
  return {
    ...view,
    focusRef: refId ?? view.focusRef,
    focusSha: sha,
  };
}

/**
 * Focus a specific commit, making its ref visible and travelling to it when it
 * is outside the current window. Used by search stepping and the PR tray.
 */
export function focusCommitView(model: Model, view: View, commit: Commit): View {
  const ref = commit.refs[0] ? model.refsById.get(commit.refs[0]) ?? null : null;
  const withRef = ref ? showRef(view, ref.id) : view;
  const window = windowFor(model, withRef.end, withRef.span);
  const t = Date.parse(commit.time);
  const outside = t < window.startMs || t > window.endMs;
  const end = outside ? isoOf(windowFor(model, isoOf(t), withRef.span).endMs) : withRef.end;
  return {
    ...withRef,
    focusRef: ref?.id ?? withRef.focusRef,
    focusSha: commit.sha,
    end,
  };
}

/**
 * On a new query, focus the first match in the current window (or the newest
 * match when the window holds none) without moving the read head. This keeps
 * the focus card consistent with the filter while leaving the view in place.
 */
export function focusFirstMatch(
  model: Model,
  view: View,
  query: string
): { view: View; index: number } {
  const search = searchCommits(model, query);
  if (!search.count) return { view, index: -1 };
  const window = windowFor(model, view.end, view.span);
  let index = search.matches.findIndex((commit) => {
    const t = Date.parse(commit.time);
    return t >= window.startMs && t <= window.endMs;
  });
  if (index < 0) index = search.matches.length - 1;
  const commit = search.matches[index];
  const ref = commit.refs[0] ? model.refsById.get(commit.refs[0]) ?? null : null;
  const withRef = ref ? showRef(view, ref.id) : view;
  return {
    view: { ...withRef, focusRef: ref?.id ?? withRef.focusRef, focusSha: commit.sha },
    index,
  };
}

/**
 * Focus a ref, travelling to its tip when it is outside the current window.
 * The window end is clamped by the span like every other transition.
 */
export function focusRefView(model: Model, view: View, ref: GitRef): View {
  const tipMs = refTipTime(model, ref);
  const window = windowFor(model, view.end, view.span);
  const outside = tipMs < window.startMs || tipMs > window.endMs;
  const end = outside
    ? isoOf(windowFor(model, isoOf(tipMs), view.span).endMs)
    : view.end;
  return { ...view, focusRef: ref.id, focusSha: ref.tip, end };
}

export function toggleLens(view: View, key: keyof View["lens"]): View {
  return { ...view, lens: { ...view.lens, [key]: !view.lens[key] } };
}

export function withEnd(model: Model, view: View, endIso: string): View {
  return {
    ...view,
    end: isoOf(windowFor(model, endIso, view.span).endMs),
  };
}

export function nowView(model: Model, view: View): View {
  return { ...view, end: model.doc.repo.snapshotAt };
}

/** Travelable read-head endpoints for the current span. */
export function historyRange(model: Model, span: SpanKey): { minEnd: number; maxEnd: number } {
  const maxEnd = model.snapshotMs;
  if (span === "all") return { minEnd: maxEnd, maxEnd };
  const minEnd = Math.min(maxEnd, model.startMs + SPANS[span]);
  return { minEnd, maxEnd };
}

/** Normalized WT POS [0..1] for the read head: 0 = oldest window, 1 = now. */
export function wtPosOf(model: Model, view: View): number {
  const { minEnd, maxEnd } = historyRange(model, view.span);
  if (maxEnd <= minEnd) return 1;
  const endMs = windowFor(model, view.end, view.span).endMs;
  return clamp((endMs - minEnd) / (maxEnd - minEnd), 0, 1);
}

/** Map a normalized WT POS [0..1] to the exact read-head timestamp (ms). */
export function endMsAtWtPos(model: Model, span: SpanKey, pos: number): number {
  const { minEnd, maxEnd } = historyRange(model, span);
  return Math.round(minEnd + clamp(pos, 0, 1) * (maxEnd - minEnd));
}

/**
 * Scrub the repository read head to normalized WT POS [0..1].
 * Pauses LFO autoplay if scrubbing interactively, and keeps the focused commit
 * inside the newly scrubbed window when matching commits exist.
 */
export function viewAtWtPos(
  model: Model,
  view: View,
  pos: number,
  shas: Set<string> | null = null,
  pauseMotion = false
): View {
  const nextEndMs = endMsAtWtPos(model, view.span, pos);
  const window = windowFor(model, isoOf(nextEndMs), view.span);
  let focusSha = view.focusSha;
  let focusRef = view.focusRef;

  const current = focusSha ? model.commitBySha.get(focusSha) ?? null : null;
  const currentTime = current ? Date.parse(current.time) : Number.NaN;
  const outside =
    !current ||
    !Number.isFinite(currentTime) ||
    currentTime < window.startMs ||
    currentTime > window.endMs ||
    (shas !== null && !shas.has(current.sha));

  if (outside) {
    let best: Commit | null = null;
    for (let i = model.doc.commits.length - 1; i >= 0; i--) {
      const c = model.doc.commits[i];
      if (c.merge) continue;
      if (shas && !shas.has(c.sha)) continue;
      const t = Date.parse(c.time);
      if (t >= window.startMs && t <= window.endMs) {
        best = c;
        break;
      }
    }
    if (best) {
      focusSha = best.sha;
      const refId = best.refs[0];
      if (refId && view.refs.includes(refId)) focusRef = refId;
    }
  }

  return {
    ...view,
    end: isoOf(window.endMs),
    focusRef,
    focusSha,
    motion: pauseMotion && view.motion.playing ? { ...view.motion, playing: false } : view.motion,
  };
}

/**
 * One transport tick. Pure: the caller owns the direction and the RAF clock.
 * `sweep` loops, `bounce` reverses at the ends, `once` stops at the snapshot.
 */
export function transportStep(
  model: Model,
  view: View,
  direction: number
): { view: View; direction: number } {
  const window = windowFor(model, view.end, view.span);
  if (view.span === "all") {
    return {
      view: { ...view, motion: { ...view.motion, playing: false } },
      direction,
    };
  }
  const slot = window.slotMs;
  const spanMs = window.endMs - window.startMs;
  const minEnd = Math.min(model.snapshotMs, model.startMs + spanMs);
  let end = window.endMs + direction * slot;
  let playing = true;
  let nextDirection = direction;

  if (view.motion.mode === "once") {
    if (end >= model.snapshotMs) {
      end = model.snapshotMs;
      playing = false;
    }
  } else if (view.motion.mode === "bounce") {
    if (end >= model.snapshotMs) {
      nextDirection = -1;
      end = Math.max(minEnd, model.snapshotMs - slot);
    } else if (end <= minEnd) {
      nextDirection = 1;
      end = Math.min(model.snapshotMs, minEnd + slot);
    }
  } else if (end > model.snapshotMs) {
    end = minEnd;
  }

  return {
    view: {
      ...view,
      end: isoOf(end),
      motion: { ...view.motion, playing },
    },
    direction: nextDirection,
  };
}
