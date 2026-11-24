/**
 * app.ts — the runtime context shared by every renderer.
 *
 * One document, one view, one derived frame. `setView` is the only mutation
 * point; it recomputes the frame and asks the shell to render. The document is
 * frozen at install.
 */

import demoDoc from "./data/demo.gitwave.json";
import { buildModel, freezeDoc, parseDoc } from "./core/model.ts";
import {
  SLOT_COUNT,
  buildSlots,
  effectiveCeiling,
  isoOf,
  refWave,
  windowFor,
} from "./core/samples.ts";
import type { Slot, WavePoint } from "./core/samples.ts";
import { openPrs, commitsSince } from "./core/refs.ts";
import type { PrView } from "./core/refs.ts";
import { searchCommits } from "./core/search.ts";
import type { SearchState } from "./core/search.ts";
import { depthSlices } from "./core/depth.ts";
import type { DepthSlice } from "./core/depth.ts";
import type { GitRef, Model, RepoDoc, View } from "./core/types.ts";

export interface Wave {
  ref: GitRef;
  points: WavePoint[];
}

export interface Palette {
  bg: string;
  stageGlow: string;
  panel: string;
  panelHi: string;
  panelHover: string;
  line: string;
  lineSoft: string;
  lineHi: string;
  text: string;
  dim: string;
  dimmer: string;
  handle: string;
  ok: string;
  okHi: string;
  okLow: string;
  open: string;
  risk: string;
  agent: string;
  review: string;
  depth: string;
  identity: string[];
}

export interface Metric {
  label: string;
  color: string;
  shas: Set<string> | null;
  ceiling: number;
  ref: GitRef | null;
}

export interface OscParams {
  /** null = follow live ambient sweep; 0..1 = manual WT POS knob */
  pos: number | null;
  /** 0..1 = 3D depth spread / tilt */
  depth: number;
  /** 0..1 = harmonic sculpt smoothness */
  smooth: number;
}

export interface CameraState {
  yaw: number;
  pitch: number;
  targetYaw: number;
  targetPitch: number;
}

export interface AppContext {
  doc: RepoDoc | null;
  model: Model | null;
  view: View | null;
  window: ReturnType<typeof windowFor> | null;
  slots: Slot[];
  metricSlots: Slot[];
  metric: Metric | null;
  depthSlices: DepthSlice[];
  depthPhase: number;
  lfoDir: number;
  depthScan: number;
  /** Ambient render clock (seconds) for the fluid 3D surfaces. */
  morph: number;
  /** Whether all Rack oscillators scrub WT POS in lockstep with the repo read head. */
  rackSync: boolean;
  /** UI sub-mode when in 3D: 'rack' | 'stage' | 'browser', or '2d' when depth=false. */
  browserOpen: boolean;
  /** Kilohearts left Git tree sidebar visibility. */
  treeOpen: boolean;
  /** Active category in the Kilohearts tree / browser grid. */
  treeCategory: "all" | "favorites" | "presets" | "branches" | "authors";
  /** Favorited filter queries (Kilohearts heart icons). */
  favorites: Set<string>;
  /** Interactive 3D camera angles for the Hero Stage. */
  camera: CameraState;
  /** Per-oscillator rotary knob parameters keyed by module query. */
  oscParams: Map<string, OscParams>;
  /** Hero stage rotary knob parameters. */
  stageParams: OscParams;
  /** Hovered browser thumbnail query for silky hover-scan feedback. */
  browserHoverQuery: string | null;
  /** Cached active slice wave + WT POS (0=oldest..1=now) + telemetry. */
  activeSliceWave: Float32Array | null;
  activeSliceZ: number;
  activeWtPos: number;
  activeSliceCount: number;
  activeSliceChurn: number;
  activeSliceDate: string;
  search: SearchState;
  matchIndex: number;
  waves: Wave[];
  prs: PrView[];
  prsByRef: Map<string, PrView>;
  focusCommit: import("./core/types.ts").Commit | null;
  focusRef: GitRef | null;
  palette: Palette | null;
  paletteTheme: string;
  hoverSlot: number;
  prFilter: { x: number; y: number; r: number } | null;
  reducedMotion: boolean;
  seenSnapshotMs: number;
  newCount: number;
  errors: number;
  render: () => void;
}

export const ctx: AppContext = {
  doc: null,
  model: null,
  view: null,
  window: null,
  slots: [],
  metricSlots: [],
  metric: null,
  depthSlices: [],
  depthPhase: 0,
  lfoDir: 1,
  depthScan: -1,
  morph: 0,
  rackSync: true,
  browserOpen: false,
  treeOpen: true,
  treeCategory: "all",
  favorites: new Set(["merged", "ref:agent/refactor-store", "author:maya"]),
  camera: { yaw: 0.44, pitch: 0.56, targetYaw: 0.44, targetPitch: 0.56 },
  oscParams: new Map(),
  stageParams: { pos: null, depth: 0.68, smooth: 0.52 },
  browserHoverQuery: null,
  activeSliceWave: null,
  activeSliceZ: 0,
  activeWtPos: 1,
  activeSliceCount: 0,
  activeSliceChurn: 0,
  activeSliceDate: "",
  search: { query: "", tokens: [], shas: null, matches: [], count: 0, error: null },
  matchIndex: -1,
  waves: [],
  prs: [],
  prsByRef: new Map(),
  focusCommit: null,
  focusRef: null,
  palette: null,
  paletteTheme: "",
  hoverSlot: -1,
  prFilter: null,
  reducedMotion: false,
  seenSnapshotMs: Number.NaN,
  newCount: 0,
  errors: 0,
  render: () => {},
};

export function getOscParams(query: string): OscParams {
  let params = ctx.oscParams.get(query);
  if (!params) {
    params = { pos: null, depth: 0.65, smooth: 0.52 };
    ctx.oscParams.set(query, params);
  }
  return params;
}

export function registerRender(fn: () => void): void {
  ctx.render = fn;
}

export function requestRender(): void {
  ctx.render();
}

export function loadDemoDocument(): RepoDoc {
  const parsed = parseDoc(demoDoc);
  if (!parsed.ok) {
    throw new Error(`the bundled demo is invalid: ${parsed.errors.join("; ")}`);
  }
  return parsed.doc;
}

export function installDocument(doc: RepoDoc, view: View): void {
  ctx.doc = freezeDoc(doc);
  ctx.model = buildModel(ctx.doc);
  ctx.view = view;
  ctx.hoverSlot = -1;
  ctx.prFilter = null;
  document.documentElement.dataset.theme = view.theme;
  ctx.palette = readPalette();
  ctx.paletteTheme = view.theme;
  recompute();
}

export function setView(next: View): void {
  if (!ctx.view) return;
  if (next === ctx.view) return;
  const themeChanged = next.theme !== ctx.view.theme;
  ctx.view = next;
  if (themeChanged) {
    document.documentElement.dataset.theme = next.theme;
    ctx.palette = readPalette();
    ctx.paletteTheme = next.theme;
  }
  recompute();
  requestRender();
}

export function recompute(): void {
  if (!ctx.model || !ctx.view) return;
  const model = ctx.model;
  const view = ctx.view;
  const window = windowFor(model, view.end, view.span);
  const previousQuery = ctx.search.query;
  const search = searchCommits(model, view.query);
  const filterShas = search.shas;
  const ceiling = effectiveCeiling(model, window, filterShas);
  const slots = buildSlots(model, window, filterShas, ceiling);
  const prs = openPrs(model);
  const focusRef = model.refsById.get(view.focusRef) ?? null;
  const active = view.modules.find((module) => module.query === view.query) ?? null;

  const metricShas = search.shas;
  const metricCeiling = ceiling;
  const metricSlots = slots;
  const metricColor = active
    ? ctx.palette?.identity[active.colorKey] ?? ctx.palette?.ok ?? "#34d399"
    : ctx.palette?.ok ?? "#34d399";
  const metricLabel = active
    ? active.name
    : search.query
      ? `search “${search.query}”`
      : "all commits";

  const waves: Wave[] = [];
  for (const id of view.refs) {
    const ref = model.refsById.get(id);
    if (!ref) continue;
    waves.push({ ref, points: refWave(model, ref, window, slots) });
  }
  // Branches first, trunk last: the trunk is the spine and stays readable.
  waves.sort((a, b) => (a.ref.kind === "trunk" ? 1 : 0) - (b.ref.kind === "trunk" ? 1 : 0));

  ctx.window = window;
  ctx.slots = slots;
  ctx.search = search;
  ctx.metricSlots = metricSlots;
  ctx.metric = {
    label: metricLabel,
    color: metricColor,
    shas: metricShas,
    ceiling: metricCeiling,
    ref: null,
  };
  ctx.depthSlices = depthSlices(model, view);
  if (previousQuery !== search.query) ctx.matchIndex = -1;
  if (!search.count) ctx.matchIndex = -1;
  else ctx.matchIndex = Math.min(ctx.matchIndex, search.count - 1);
  ctx.prs = prs;
  ctx.prsByRef = new Map(prs.map((pr) => [pr.ref.id, pr]));
  ctx.waves = waves;
  ctx.focusCommit = view.focusSha ? model.commitBySha.get(view.focusSha) ?? null : null;
  ctx.focusRef = focusRef;
  ctx.newCount = Number.isFinite(ctx.seenSnapshotMs)
    ? commitsSince(model, ctx.seenSnapshotMs).length
    : 0;
}

export function readPalette(): Palette {
  const cs = getComputedStyle(document.documentElement);
  const get = (name: string): string => cs.getPropertyValue(name).trim();
  return {
    bg: get("--bg"),
    stageGlow: get("--stage-glow"),
    panel: get("--panel"),
    panelHi: get("--panel-hi"),
    panelHover: get("--panel-hover"),
    line: get("--line"),
    lineSoft: get("--line-soft"),
    lineHi: get("--line-hi"),
    text: get("--text"),
    dim: get("--dim"),
    dimmer: get("--dimmer"),
    handle: get("--handle-hi"),
    ok: get("--ok"),
    okHi: get("--ok-hi"),
    okLow: get("--ok-low"),
    open: get("--open"),
    risk: get("--risk"),
    agent: get("--agent"),
    review: get("--review"),
    depth: get("--depth"),
    identity: [get("--id0"), get("--id1"), get("--id2"), get("--id3"), get("--id4"), get("--id5")],
  };
}

export function identityOf(ref: GitRef): string {
  const palette = ctx.palette;
  if (!palette) return "#94a3b8";
  if (ref.kind === "trunk") return palette.ok;
  return palette.identity[ref.colorKey] ?? palette.identity[palette.identity.length - 1];
}

export function refSlot(refId: string, k: number) {
  return ctx.slots[k]?.byRef.get(refId) ?? null;
}

export function getState() {
  if (!ctx.doc || !ctx.model || !ctx.view || !ctx.window) return null;
  const view = ctx.view;
  return {
    schemaVersion: 1,
    tool: "gitwave",
    version: "0.4.0",
    repo: {
      id: ctx.doc.repo.id,
      name: ctx.doc.repo.name,
      commits: ctx.doc.commits.length,
      refs: ctx.doc.refs.length,
      tags: ctx.doc.tags.map((tag) => tag.name),
      snapshotAt: ctx.doc.repo.snapshotAt,
    },
    window: {
      start: isoOf(ctx.window.startMs),
      end: isoOf(ctx.window.endMs),
      span: view.span,
      slots: SLOT_COUNT,
    },
    refs: view.refs.map((id) => {
      const ref = ctx.model?.refsById.get(id);
      return {
        id,
        kind: ref?.kind ?? "branch",
        pr: ref?.pr
          ? { number: ref.pr.number, state: ref.pr.state, review: ref.pr.review, checks: ref.pr.checks }
          : null,
      };
    }),
    focus: { ref: view.focusRef, sha: view.focusSha },
    theme: view.theme,
    lens: view.lens,
    motion: view.motion,
    depth: view.depth,
    query: view.query,
    rack: view.rack,
    modules: view.modules.map((module) => ({
      name: module.name,
      query: module.query,
      colorKey: module.colorKey,
    })),
    search: { count: ctx.search.count, matchIndex: ctx.matchIndex },
    metric: ctx.metric
      ? {
          label: ctx.metric.label,
          color: ctx.metric.color,
          ceiling: ctx.metric.ceiling,
          slices: ctx.depthSlices.length,
        }
      : null,
    tension: {
      open: ctx.prs.length,
      stale: ctx.prs.filter((pr) => pr.stale).length,
      max: ctx.prs.reduce((max, pr) => Math.max(max, pr.tension), 0),
    },
    hash: typeof location !== "undefined" ? location.hash : "",
  };
}
