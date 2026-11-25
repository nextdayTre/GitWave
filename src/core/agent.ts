/**
 * agent.ts — pure, deterministic Floating Agent Oscillator ("Agent Synth Avatar")
 * synthesis model and activity modulation profiles.
 *
 * Allows an AI agent or human user to express creative identity through a
 * signature color and mathematical waveform formula, with cyclic modulations
 * that visually reflect live tasks (searching, reading, diffing, editing,
 * pushing, merging, cloning, syncing, idle).
 *
 * Pure & DOM-free: no Date.now(), no Math.random(), bounded in [-1, 1].
 */

import { clamp } from "./samples.ts";

export type AgentFormulaId =
  | "harmonic"
  | "fm"
  | "chebyshev"
  | "interference"
  | "pulse"
  | "lissajous"
  | "fold";

export type AgentActivityId =
  | "idle"
  | "reading"
  | "searching"
  | "diffing"
  | "editing"
  | "pushing"
  | "merging"
  | "cloning"
  | "syncing";

export type AgentColorToken =
  | "agent"
  | "ok"
  | "open"
  | "risk"
  | "review"
  | "id0"
  | "id1"
  | "id2"
  | "id3"
  | "id4"
  | "id5";

export interface AgentOscParams {
  /** Base harmonic carrier cycles across the wavetable [1..8]. */
  carrier: number;
  /** Modulator-to-carrier ratio [0.5..6]. */
  modRatio: number;
  /** Modulation depth / index [0..2.5]. */
  modDepth: number;
  /** Wavefolder drive [0..2]. */
  fold: number;
  /** Secondary beat / detune offset [0..1.5]. */
  detune: number;
  /** Symmetry / pulse bias [-0.8..0.8]. */
  symmetry: number;
}

export interface AgentOscConfig {
  id: string;
  name: string;
  role: string;
  colorToken: AgentColorToken;
  /** Optional explicit 6-digit hex color chosen by the agent/user (e.g. "#2eead8"). */
  customColor: string | null;
  formula: AgentFormulaId;
  params: AgentOscParams;
  activity: AgentActivityId;
  task: string;
  repo: string;
  visible: boolean;
  minimized: boolean;
  liveConnected: boolean;
}

export interface AgentOscPatch {
  id?: string;
  name?: string;
  role?: string;
  colorToken?: string;
  /** Accepts either a token name ("agent", "ok", "id2"...) or a 6-digit hex ("#22d3ee"). */
  color?: string | null;
  customColor?: string | null;
  formula?: string;
  params?: Partial<AgentOscParams>;
  activity?: string;
  task?: string;
  repo?: string;
  visible?: boolean;
  minimized?: boolean;
  liveConnected?: boolean;
}

export interface AgentFormulaMeta {
  id: AgentFormulaId;
  label: string;
  equation: string;
  note: string;
}

export interface AgentActivityProfile {
  id: AgentActivityId;
  label: string;
  rate: number;
  energy: number;
  sweep: "breath" | "scan" | "sonar" | "mirror" | "pulse" | "ascend" | "converge" | "bloom" | "orbit";
  note: string;
}

export const AGENT_FORMULAS: readonly AgentFormulaMeta[] = [
  {
    id: "lissajous",
    label: "Lissajous",
    equation: "sin(c·θ + φ)·cos(m·θ) + 0.45·sin((c+m)·θ − φ)",
    note: "braided orbital harmonics",
  },
  {
    id: "fm",
    label: "FM Glass",
    equation: "sin(c·θ + d·sin(m·θ + φ))",
    note: "crystalline frequency modulation",
  },
  {
    id: "harmonic",
    label: "Harmonic",
    equation: "Σ sin(k·c·θ + k·φ) / k",
    note: "warm additive overtone stack",
  },
  {
    id: "chebyshev",
    label: "Chebyshev",
    equation: "T₃(sin(c·θ + φ)) + d·T₅(sin(θ))",
    note: "polynomial harmonic bloom",
  },
  {
    id: "interference",
    label: "Interference",
    equation: "sin(c·θ + φ) · cos((c + Δ)·θ − φ)",
    note: "beating dual wave packets",
  },
  {
    id: "fold",
    label: "Wavefold",
    equation: "sin((1 + 2f)·sin(c·θ + φ) + d·cos(m·θ))",
    note: "west-coast Buchla wavefolder",
  },
  {
    id: "pulse",
    label: "PWM Pulse",
    equation: "tanh(k · (sin(c·θ + φ) − s))",
    note: "sculpted pulse-width modulation",
  },
];

export const AGENT_ACTIVITIES: readonly AgentActivityProfile[] = [
  { id: "idle", label: "IDLE", rate: 0.55, energy: 0.46, sweep: "breath", note: "calm ambient hover" },
  { id: "reading", label: "READING", rate: 1.2, energy: 0.7, sweep: "scan", note: "steady left-to-right slice scan" },
  { id: "searching", label: "SEARCHING", rate: 1.9, energy: 0.86, sweep: "sonar", note: "pulsing dual-lock sonar sweep" },
  { id: "diffing", label: "DIFFING", rate: 1.5, energy: 0.8, sweep: "mirror", note: "opposing left/right phase comparison" },
  { id: "editing", label: "EDITING", rate: 2.05, energy: 0.9, sweep: "pulse", note: "energetic wavefolded writing cadence" },
  { id: "pushing", label: "PUSHING", rate: 2.25, energy: 0.94, sweep: "ascend", note: "rising harmonic cascade toward remote" },
  { id: "merging", label: "MERGING", rate: 1.65, energy: 0.88, sweep: "converge", note: "two opposing waves locking into one" },
  { id: "cloning", label: "CLONING", rate: 1.8, energy: 0.86, sweep: "bloom", note: "radial expansion from origin outward" },
  { id: "syncing", label: "SYNCING", rate: 1.55, energy: 0.82, sweep: "orbit", note: "orbital local/GitHub phase-lock" },
];

export const AGENT_COLOR_TOKENS: readonly AgentColorToken[] = [
  "agent",
  "ok",
  "open",
  "risk",
  "review",
  "id0",
  "id1",
  "id2",
  "id3",
  "id4",
  "id5",
];

const FORMULA_SET = new Set<string>(AGENT_FORMULAS.map((f) => f.id));
const ACTIVITY_MAP = new Map<AgentActivityId, AgentActivityProfile>(
  AGENT_ACTIVITIES.map((a) => [a.id, a])
);
const COLOR_TOKEN_SET = new Set<string>(AGENT_COLOR_TOKENS);
const HEX6_RE = /^#[0-9a-fA-F]{6}$/;

export const DEFAULT_AGENT_PARAMS: AgentOscParams = {
  carrier: 2.5,
  modRatio: 2.0,
  modDepth: 0.85,
  fold: 0.55,
  detune: 0.45,
  symmetry: 0,
};

export function defaultAgentConfig(): AgentOscConfig {
  return {
    id: "antigravity",
    name: "Antigravity",
    role: "agent-osc",
    colorToken: "agent",
    customColor: null,
    formula: "lissajous",
    params: { ...DEFAULT_AGENT_PARAMS },
    activity: "idle",
    task: "Standing by — ready to pair",
    repo: "",
    visible: false,
    minimized: false,
    liveConnected: false,
  };
}

function cleanText(value: unknown, fallback: string, maxLen: number): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.replace(/[\r\n\t]+/g, " ").trim();
  return trimmed.slice(0, maxLen);
}

function num(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return clamp(value, min, max);
}

export function activityProfile(id: AgentActivityId): AgentActivityProfile {
  return ACTIVITY_MAP.get(id) ?? AGENT_ACTIVITIES[0];
}

/** Validate and apply a partial agent oscillator patch purely. */
export function normalizeAgentPatch(
  base: AgentOscConfig,
  patch: AgentOscPatch | null | undefined
): AgentOscConfig {
  if (!patch || typeof patch !== "object") return base;

  let colorToken = base.colorToken;
  let customColor = base.customColor;

  if (typeof patch.colorToken === "string" && COLOR_TOKEN_SET.has(patch.colorToken)) {
    colorToken = patch.colorToken as AgentColorToken;
    customColor = null;
  }

  if (patch.customColor === null || patch.customColor === "") {
    customColor = null;
  } else if (typeof patch.customColor === "string" && HEX6_RE.test(patch.customColor.trim())) {
    customColor = patch.customColor.trim().toLowerCase();
  }

  if (patch.color === null || patch.color === "") {
    customColor = null;
  } else if (typeof patch.color === "string") {
    const raw = patch.color.trim();
    if (COLOR_TOKEN_SET.has(raw)) {
      colorToken = raw as AgentColorToken;
      customColor = null;
    } else if (HEX6_RE.test(raw)) {
      customColor = raw.toLowerCase();
    }
  }

  const formula =
    typeof patch.formula === "string" && FORMULA_SET.has(patch.formula)
      ? (patch.formula as AgentFormulaId)
      : base.formula;

  const activity =
    typeof patch.activity === "string" && ACTIVITY_MAP.has(patch.activity as AgentActivityId)
      ? (patch.activity as AgentActivityId)
      : base.activity;

  const p = patch.params ?? {};
  const params: AgentOscParams = {
    carrier: num(p.carrier, base.params.carrier, 1, 8),
    modRatio: num(p.modRatio, base.params.modRatio, 0.5, 6),
    modDepth: num(p.modDepth, base.params.modDepth, 0, 2.5),
    fold: num(p.fold, base.params.fold, 0, 2),
    detune: num(p.detune, base.params.detune, 0, 1.5),
    symmetry: num(p.symmetry, base.params.symmetry, -0.8, 0.8),
  };

  return {
    id: cleanText(patch.id, base.id, 32) || base.id,
    name: cleanText(patch.name, base.name, 36) || base.name,
    role: cleanText(patch.role, base.role, 24) || base.role,
    colorToken,
    customColor,
    formula,
    params,
    activity,
    task:
      typeof patch.task === "string"
        ? cleanText(patch.task, "", 96)
        : base.task,
    repo:
      typeof patch.repo === "string"
        ? cleanText(patch.repo, "", 48)
        : base.repo,
    visible: typeof patch.visible === "boolean" ? patch.visible : base.visible,
    minimized: typeof patch.minimized === "boolean" ? patch.minimized : base.minimized,
    liveConnected:
      typeof patch.liveConnected === "boolean" ? patch.liveConnected : base.liveConnected,
  };
}

/** Evaluate base formula sample in [-1, 1] at position u in [0, 1], depth z in [0, 1], and phase. */
function evalFormula(
  formula: AgentFormulaId,
  params: AgentOscParams,
  u: number,
  z: number,
  phi: number
): number {
  const theta = Math.PI * 2 * u;
  const c = params.carrier;
  const m = params.modRatio;
  const d = params.modDepth;
  const f = params.fold;
  const det = params.detune;
  const sym = params.symmetry;
  const zTwist = z * Math.PI * 1.65;

  switch (formula) {
    case "fm": {
      const mod = d * (0.65 + 0.55 * z) * Math.sin(theta * m - phi * 1.15 + zTwist);
      return Math.sin(theta * c + phi + mod);
    }
    case "harmonic": {
      const h1 = Math.sin(theta * c + phi + zTwist * 0.6);
      const h2 = 0.5 * Math.sin(theta * c * 2 - phi * 0.8 + zTwist * 1.2) * (0.4 + 0.4 * d);
      const h3 = 0.28 * Math.sin(theta * c * 3 + phi * 1.4 - zTwist) * (0.3 + 0.4 * f);
      return Math.tanh((h1 + h2 + h3) * 0.92);
    }
    case "chebyshev": {
      const x = Math.sin(theta * c + phi + zTwist * 0.5);
      // T3(x) = 4x^3 - 3x, T5(x) = 16x^5 - 20x^3 + 5x
      const t3 = 4 * x * x * x - 3 * x;
      const x2 = x * x;
      const t5 = 16 * x2 * x2 * x - 20 * x2 * x + 5 * x;
      const mix = clamp(0.25 + 0.32 * d, 0, 0.85);
      return clamp((1 - mix) * t3 + mix * t5 * Math.cos(zTwist - phi * 0.5), -1, 1);
    }
    case "interference": {
      const w1 = Math.sin(theta * c + phi + zTwist);
      const w2 = Math.cos(theta * (c + det + 0.35) - phi * 1.3 - zTwist * 0.8);
      const beat = Math.sin(theta * (0.5 + det) + phi * 0.6);
      return clamp(w1 * w2 * 0.85 + beat * 0.22 * d, -1, 1);
    }
    case "fold": {
      const drive = 1.15 + f * 1.85 + z * 0.7;
      const core = Math.sin(theta * c + phi + zTwist * 0.5);
      const mod = d * 0.45 * Math.cos(theta * m - phi * 0.9);
      return Math.sin(drive * core + mod);
    }
    case "pulse": {
      const shift = clamp(sym + Math.sin(phi * 0.7 + zTwist) * 0.32, -0.82, 0.82);
      const sharpness = 2.4 + f * 3.0 + d * 1.2;
      return Math.tanh(sharpness * (Math.sin(theta * c + phi * 0.9 + zTwist * 0.4) - shift));
    }
    case "lissajous":
    default: {
      const a = Math.sin(theta * c + phi + zTwist * 0.7) * Math.cos(theta * m - phi * 0.65);
      const b = 0.48 * Math.sin(theta * (c + m * 0.5) - phi * 1.2 + zTwist * 1.1) * (0.5 + 0.3 * d);
      return Math.tanh((a + b) * (1.1 + f * 0.35));
    }
  }
}

/* Cached edge taper curves per sample count (avoids Math.pow(Math.sin(...)) in 60fps loops). */
const taperCache = new Map<number, Float32Array>();

function getAgentTaper(n: number): Float32Array {
  let arr = taperCache.get(n);
  if (arr) return arr;
  arr = new Float32Array(n);
  for (let s = 1; s < n - 1; s++) {
    const u = s / Math.max(1, n - 1);
    arr[s] = Math.pow(Math.max(0, Math.sin(Math.PI * u)), 0.48);
  }
  taperCache.set(n, arr);
  return arr;
}

/**
 * Synthesize one normalized slice `Float32Array` in [-1, 1] for the Agent Oscillator.
 * Optionally writes into a caller-supplied `out` buffer to avoid per-frame allocations.
 */
export function evaluateAgentSlice(
  config: AgentOscConfig,
  zNorm: number,
  phaseSec: number,
  sampleCount = 64,
  outBuf?: Float32Array
): Float32Array {
  const n = Math.max(16, Math.min(160, Math.round(sampleCount)));
  const z = clamp(zNorm, 0, 1);
  const profile = activityProfile(config.activity);
  const out = outBuf && outBuf.length === n ? outBuf : new Float32Array(n);
  const taper = getAgentTaper(n);
  const t = phaseSec * profile.rate;
  const sweep = profile.sweep;
  const energy = profile.energy;
  const formula = config.formula;
  const params = config.params;
  const invN = 1 / Math.max(1, n - 1);

  out[0] = 0;
  out[n - 1] = 0;

  /* Precompute per-slice constants outside the sample loop */
  const zSinPi = Math.sin(z * Math.PI);
  const breathAmp = sweep === "breath" ? 0.72 + 0.28 * Math.sin(t * 1.15 + z * 1.4) : 0;
  const orbitVal = sweep === "orbit" ? 0.5 + 0.5 * Math.sin(t * 1.6 + z * Math.PI * 2) : 0;
  const scanHead = sweep === "scan" ? (t * 0.32) % 1 : 0;
  const sonarPing = sweep === "sonar" ? (t * 0.48) % 1 : 0;
  const sonarSin = sweep === "sonar" ? Math.sin(t * 4) : 0;
  const mirrorSin = sweep === "mirror" ? Math.sin(t * 2.2 + z * Math.PI) : 0;
  const convergeSep = sweep === "converge" ? 0.36 * (1 - 0.5 * (1 - Math.cos(t * 1.5))) : 0;
  const bloomRadius = sweep === "bloom" ? (t * 0.45) % 0.55 : 0;

  for (let s = 1; s < n - 1; s++) {
    const u = s * invN;
    let amp: number;
    let phaseShift: number;
    let add: number;

    switch (sweep) {
      case "scan": {
        const diff = Math.abs(u - scanHead);
        const dist = diff < 1 - diff ? diff : 1 - diff;
        const beam = Math.exp(-dist * dist * 32);
        amp = 0.65 + 0.5 * beam;
        phaseShift = t * 1.1;
        add = beam * 0.22 * zSinPi;
        break;
      }
      case "sonar": {
        const dA = u - sonarPing;
        const dB = u - (1 - sonarPing);
        const ringA = Math.exp(-dA * dA * 44);
        const ringB = Math.exp(-dB * dB * 44);
        const pulse = ringA > ringB ? ringA : ringB;
        amp = 0.55 + 0.65 * pulse;
        phaseShift = t * 1.85;
        add = pulse * 0.25 * sonarSin;
        break;
      }
      case "mirror": {
        const side = u < 0.5 ? 1 : -1;
        const du = u - 0.5;
        const split = Math.exp(-du * du * 60);
        amp = 0.85 * (1 - 0.45 * split);
        phaseShift = side * t * 1.4;
        add = side * 0.16 * mirrorSin;
        break;
      }
      case "pulse": {
        const base = 0.5 + 0.5 * Math.sin(t * 2.6 - u * 4);
        amp = 0.72 + 0.38 * base * base;
        phaseShift = t * 2.1;
        add = 0.12 * Math.sin(u * Math.PI * 6 + t * 3);
        break;
      }
      case "ascend": {
        const crest = ((1 - z) * 0.65 + u * 0.35 - t * 0.55) % 1;
        const wrap = crest < 0 ? crest + 1 : crest;
        const dw = wrap - 0.5;
        const lift = Math.exp(-dw * dw * 26);
        amp = 0.7 + 0.48 * lift;
        phaseShift = -t * 2.4;
        add = lift * 0.26;
        break;
      }
      case "converge": {
        const d1 = u - (0.5 - convergeSep);
        const d2 = u - (0.5 + convergeSep);
        const g1 = Math.exp(-d1 * d1 * 34);
        const g2 = Math.exp(-d2 * d2 * 34);
        const lock = g1 > g2 ? g1 : g2;
        amp = 0.52 + 0.64 * lock;
        phaseShift = (u < 0.5 ? 1 : -1) * t * 1.3;
        add = lock * 0.2;
        break;
      }
      case "bloom": {
        const d = Math.abs(Math.abs(u - 0.5) - bloomRadius);
        const wave = Math.exp(-d * d * 75);
        amp = 0.58 + 0.56 * wave;
        phaseShift = t * 1.6;
        add = wave * 0.22;
        break;
      }
      case "orbit": {
        amp = 0.65 + 0.42 * orbitVal;
        phaseShift = t * 1.45;
        add = (orbitVal - 0.5) * 0.2;
        break;
      }
      case "breath":
      default: {
        amp = breathAmp;
        phaseShift = t * 0.75;
        add = 0;
        break;
      }
    }

    const raw = evalFormula(formula, params, u, z, phaseShift);
    const val = (raw * amp * energy + add) * taper[s];
    out[s] = val < -1 ? -1 : val > 1 ? 1 : val;
  }
  return out;
}

export interface AgentSurfaceFrame {
  frames: Float32Array[];
  /** Normalized depth position [0..1] of the live scanning highlight plane. */
  scanZ: number;
  profile: AgentActivityProfile;
}

/**
 * Build a complete stack of miniature 3D slices for the Floating Agent Oscillator.
 * Optionally reuses a preallocated `framePool` to eliminate 60fps typed-array churn.
 */
export function evaluateAgentSurface(
  config: AgentOscConfig,
  phaseSec: number,
  sliceCount = 18,
  sampleCount = 64,
  framePool?: Float32Array[]
): AgentSurfaceFrame {
  const count = Math.max(6, Math.min(36, Math.round(sliceCount)));
  const profile = activityProfile(config.activity);
  const frames: Float32Array[] =
    framePool && framePool.length === count ? framePool : new Array<Float32Array>(count);
  for (let i = 0; i < count; i++) {
    const z = count > 1 ? i / (count - 1) : 0;
    frames[i] = evaluateAgentSlice(config, z, phaseSec, sampleCount, frames[i]);
  }
  const scanZ =
    profile.sweep === "ascend"
      ? 1 - ((phaseSec * profile.rate * 0.28) % 1)
      : 0.5 - 0.5 * Math.cos(phaseSec * profile.rate * 0.85);
  return { frames, scanZ: clamp(scanZ, 0, 1), profile };
}

/**
 * Continuously sample an interpolated slice at any floating-point `zNorm` in [0, 1]
 * across an already-evaluated AgentSurfaceFrame (zero extra trig, fluid Z-travel).
 */
export function sampleAgentSlice(
  frames: Float32Array[],
  zNorm: number,
  outBuf?: Float32Array
): Float32Array {
  const count = frames.length;
  const n = count > 0 ? frames[0].length : 0;
  const out = outBuf && outBuf.length === n ? outBuf : new Float32Array(n);
  if (count === 0 || n === 0) return out;
  const pos = clamp(zNorm, 0, 1) * (count - 1);
  const i0 = Math.min(count - 1, Math.floor(pos));
  const i1 = Math.min(count - 1, i0 + 1);
  const frac = pos - i0;
  const f0 = frames[i0];
  const f1 = frames[i1];
  for (let s = 0; s < n; s++) {
    out[s] = f0[s] + (f1[s] - f0[s]) * frac;
  }
  return out;
}
