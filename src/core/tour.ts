/**
 * tour.ts — pure, deterministic Welcome Walkthrough script co-authored as a
 * gift from Trevor & Antigravity to human explorers and future visiting agents.
 *
 * Each chapter choreographs both the GitWave instrument view (mode, focus,
 * search, lens) and the Floating Agent Oscillator's creative signature (color,
 * waveform formula, harmonic parameters, and live task modulation).
 */

import type { AgentActivityId, AgentFormulaId, AgentOscParams } from "./agent.ts";

export type TourUiMode = "rack" | "stage" | "browser" | "2d" | "diff";

export interface TourChapter {
  id: string;
  eyebrow: string;
  title: string;
  body: string;
  tip: string;
  /** Duration in milliseconds during autoplay (for smooth screen-recording). */
  durationMs: number;
  ui: {
    mode: TourUiMode;
    query?: string;
    focusRef?: string;
    openDiff?: boolean;
    wtPos?: number;
  };
  agent: {
    name: string;
    color: string;
    formula: AgentFormulaId;
    activity: AgentActivityId;
    task: string;
    params?: Partial<AgentOscParams>;
  };
}

export const TOUR_CHAPTERS: readonly TourChapter[] = [
  {
    id: "welcome",
    eyebrow: "01 / 07 · GIFT FROM TREVOR & ANTIGRAVITY",
    title: "A repository you can see, hold, and play",
    body: "Trevor grew up on re-writable DVDs and USB drives — where you could see what lived on your disc and what waited to be written. Together we built GitWave so Git history feels just as tactile: every commit is a sample, every branch is a living wave.",
    tip: "Space pauses · arrows step chapters · drag this floating oscillator anywhere",
    durationMs: 7600,
    ui: { mode: "rack", query: "" },
    agent: {
      name: "Antigravity",
      color: "#2eead8",
      formula: "lissajous",
      activity: "reading",
      task: "Welcome! Braided Lissajous — human + agent in phase",
      params: { carrier: 3, modRatio: 2, modDepth: 1.05, fold: 0.55 },
    },
  },
  {
    id: "rack",
    eyebrow: "02 / 07 · THE 3D OSCILLATOR RACK",
    title: "Every filter becomes its own live wavetable",
    body: "Each bay in the Rack isolates a different slice of reality — merged integration history, an agent's branch, or a single contributor. Scrub WT POS in Sync mode to time-travel every surface together and compare live commit & churn deltas.",
    tip: "Click any oscillator to solo it · click + to pin your current search",
    durationMs: 7400,
    ui: { mode: "rack", query: "merged" },
    agent: {
      name: "Antigravity",
      color: "#34d399",
      formula: "harmonic",
      activity: "searching",
      task: "Comparing harmonic footprints across Rack bays",
      params: { carrier: 2.5, modRatio: 2, modDepth: 0.9, fold: 0.4 },
    },
  },
  {
    id: "stage",
    eyebrow: "03 / 07 · VOLUMETRIC STAGE + 2D SCOPE",
    title: "Orbit history in 3D, inspect exact bursts in 2D",
    body: "Stage opens one filter into an interactive isometric surface you can orbit by dragging. Directly beneath it, the 2D Commit Scope aligns 1:1 with the 32-slot overview filmstrip — hover any spike to inspect the commits inside that moment.",
    tip: "Drag the 3D surface to orbit · double-click the viewport to reset angle",
    durationMs: 7600,
    ui: { mode: "stage", query: "" },
    agent: {
      name: "Antigravity",
      color: "#38bdf8",
      formula: "fm",
      activity: "reading",
      task: "FM Glass — scanning the volumetric depth stack",
      params: { carrier: 3, modRatio: 3.5, modDepth: 1.2, fold: 0.45 },
    },
  },
  {
    id: "browser",
    eyebrow: "04 / 07 · FLOATING WAVETABLE BROWSER",
    title: "Navigate branches, authors, and presets visually",
    body: "Instead of memorizing CLI flags, browse your entire repository like a sound designer's wavetable gallery. In live mode, the left sidebar also mounts your local repositories like cartridges and tracks your uncommitted Burn Tray.",
    tip: "Heart favorites · click to load into the Rack · double-click for Stage",
    durationMs: 7400,
    ui: { mode: "browser" },
    agent: {
      name: "Antigravity",
      color: "#a78bfa",
      formula: "interference",
      activity: "cloning",
      task: "Interference bloom — mapping every branch & author",
      params: { carrier: 2.5, modRatio: 1.5, modDepth: 0.95, detune: 0.6 },
    },
  },
  {
    id: "diff",
    eyebrow: "05 / 07 · DIFF INSPECTOR & BURN TRAY",
    title: "Read-only inspection, zero fear of breaking Git",
    body: "Double-click any time slice — or click the Burn Tray in live mode — to inspect line-by-line unified diffs right inside the studio. GitWave stays strictly read-only on your repository: actions copy safe commands and never mutate history.",
    tip: "Click any file on the left to isolate its patch · Esc returns to wavetables",
    durationMs: 7600,
    ui: { mode: "diff", openDiff: true },
    agent: {
      name: "Antigravity",
      color: "#f5b544",
      formula: "chebyshev",
      activity: "diffing",
      task: "Chebyshev mirror — comparing hunks line by line",
      params: { carrier: 2, modRatio: 2, modDepth: 1.15, fold: 0.7 },
    },
  },
  {
    id: "register",
    eyebrow: "06 / 07 · 2D REGISTER & PR TENSION",
    title: "Warmth is reserved strictly for attention",
    body: "Switch to 2D to read every branch as a bounded monotone wave on the same 32-slot timeline. Cool hues are identity; amber signals open pull requests; coral warns when work goes stale past 14 days or hits a conflict.",
    tip: "Click the Tension Pad (or press P) to inspect every open pull request",
    durationMs: 7400,
    ui: { mode: "2d" },
    agent: {
      name: "Antigravity",
      color: "#fb7185",
      formula: "fold",
      activity: "merging",
      task: "Wavefold convergence — tracking open PR tension",
      params: { carrier: 2.5, modRatio: 2, modDepth: 0.85, fold: 1.1 },
    },
  },
  {
    id: "handoff",
    eyebrow: "07 / 07 · AN OPEN INVITATION — HUMAN & DIGITAL",
    title: "Make this instrument yours, whoever you build with",
    body: "GitWave is open source — a warm welcome to every explorer, human and digital alike. Tune your own color and waveform formula, steer views over window.gitwave or MCP, keep Git state visible and fearless, and pass along whatever lovely tools you build next!",
    tip: "Click ⚙ on the pod to tune your signature · open-source & read-only by design",
    durationMs: 9000,
    ui: { mode: "rack", query: "" },
    agent: {
      name: "Antigravity",
      color: "#2eead8",
      formula: "lissajous",
      activity: "syncing",
      task: "Warm welcome to all builders — human & digital alike!",
      params: { carrier: 3, modRatio: 2, modDepth: 1.1, fold: 0.65 },
    },
  },
];

export interface TourState {
  active: boolean;
  playing: boolean;
  index: number;
  total: number;
}

export function initialTourState(): TourState {
  return {
    active: false,
    playing: false,
    index: 0,
    total: TOUR_CHAPTERS.length,
  };
}

export function clampChapterIndex(index: number): number {
  const n = TOUR_CHAPTERS.length;
  if (!Number.isFinite(index)) return 0;
  return Math.max(0, Math.min(n - 1, Math.round(index)));
}

export function chapterAt(index: number): TourChapter {
  return TOUR_CHAPTERS[clampChapterIndex(index)];
}
