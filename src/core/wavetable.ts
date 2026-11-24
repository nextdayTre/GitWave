/**
 * wavetable.ts — synth-sculpted 3D wavetable geometry derived from real Git slots.
 *
 * Pure and deterministic: every frame is built from `depthSlices` + `buildSlots`
 * on the frozen model. Real churn levels, commit density, merge cadence and
 * agent authorship sculpt smooth bipolar harmonic wave slices across Z-depth so
 * each branch, author or filter produces its own recognizable wavetable timbre.
 */

import type { Model, View } from "./types.ts";
import { SLOT_COUNT, buildSlots, clamp } from "./samples.ts";
import type { Slot } from "./samples.ts";
import { depthSlices, historyDepthSlices } from "./depth.ts";
import type { DepthSlice } from "./depth.ts";

export interface WavetableLayerMeta {
  z: number;
  energy: number;
  mergeRatio: number;
  agentRatio: number;
  density: number;
  centroid: number;
  commitCount: number;
  churn: number;
  startMs: number;
  endMs: number;
}

export interface WavetableData {
  sliceCount: number;
  sampleCount: number;
  /** frames[i][s] in [-1, 1]; index 0 = front (newest), index sliceCount-1 = back (oldest). */
  frames: Float32Array[];
  /** Raw normalized churn envelope per slice [0..1], useful for highlights & readouts. */
  envelopes: Float32Array[];
  meta: WavetableLayerMeta[];
  rawSlices: DepthSlice[];
  frontSlots: Slot[];
  empty: boolean;
  /** Deterministic timbre signature parameters derived from the dataset slice. */
  timbre: {
    carrier: number;
    fmRatio: number;
    fmIndex: number;
    phaseTwist: number;
    harmonicMix: number;
  };
}

export interface WavetableOptions {
  sliceCount?: number;
  sampleCount?: number;
  /** 0 = crisp harmonic ripples, 1 = glassy smooth dunes. Default 0.58. */
  smooth?: number;
  /** Optional seed label (e.g. module query) for consistent harmonic character. */
  seed?: string;
  /** When true, anchor Z-depth to the full travelable repository history for the span. */
  fullHistory?: boolean;
}

function hashSeed(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

/** Smooth 1D array with a 3-tap Gaussian-like kernel repeated `passes` times. */
function smoothCurve(input: Float32Array, passes: number): Float32Array {
  let src = new Float32Array(input);
  let dst = new Float32Array(input.length);
  const n = input.length;
  for (let p = 0; p < passes; p++) {
    for (let i = 0; i < n; i++) {
      const a = src[Math.max(0, i - 1)];
      const b = src[i];
      const c = src[Math.min(n - 1, i + 1)];
      dst[i] = 0.25 * a + 0.5 * b + 0.25 * c;
    }
    const tmp = src;
    src = dst;
    dst = tmp;
  }
  return src;
}

/** Sample a normalized array with Catmull-Rom interpolation at `u` in [0, 1]. */
function sampleCatmull(arr: Float32Array, u: number): number {
  const n = arr.length;
  if (n === 0) return 0;
  if (n === 1) return arr[0];
  const pos = clamp(u, 0, 1) * (n - 1);
  const i1 = Math.min(n - 2, Math.floor(pos));
  const t = pos - i1;
  const p0 = arr[Math.max(0, i1 - 1)];
  const p1 = arr[i1];
  const p2 = arr[Math.min(n - 1, i1 + 1)];
  const p3 = arr[Math.min(n - 1, i1 + 2)];
  const t2 = t * t;
  const t3 = t2 * t;
  const v =
    0.5 *
    (2 * p1 +
      (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
  return clamp(v, 0, 1);
}

interface RawFrame {
  env: Float32Array;
  energy: number;
  mergeRatio: number;
  agentRatio: number;
  density: number;
  centroid: number;
  commitCount: number;
  churn: number;
  startMs: number;
  endMs: number;
}

function summarizeSlots(
  slots: Slot[],
  startMs: number,
  endMs: number,
  sampleCount: number,
  smoothPasses: number
): RawFrame {
  const raw = new Float32Array(SLOT_COUNT);
  let totalCount = 0;
  let totalChurn = 0;
  let mergeCount = 0;
  let agentCount = 0;
  let activeSlots = 0;
  let weightedCenter = 0;
  let weightSum = 0;
  let peak = 0;

  for (let k = 0; k < SLOT_COUNT; k++) {
    const slot = slots[k];
    const lvl = clamp(slot.level / 15, 0, 1);
    raw[k] = lvl;
    if (lvl > peak) peak = lvl;
    if (slot.count > 0) {
      activeSlots += 1;
      totalCount += slot.count;
      totalChurn += slot.churn;
      agentCount += slot.agentCount;
      for (const c of slot.commits) {
        if (c.merge) mergeCount += 1;
      }
      weightedCenter += (k / (SLOT_COUNT - 1)) * (lvl + 0.15);
      weightSum += lvl + 0.15;
    }
  }

  const smoothedRaw = smoothCurve(raw, smoothPasses);
  const env = new Float32Array(sampleCount);
  let sumEnv = 0;
  for (let s = 0; s < sampleCount; s++) {
    const u = s / Math.max(1, sampleCount - 1);
    const v = sampleCatmull(smoothedRaw, u);
    env[s] = v;
    sumEnv += v;
  }

  const meanEnv = sumEnv / Math.max(1, sampleCount);
  const energy = clamp(0.45 * meanEnv + 0.55 * peak, 0, 1);

  return {
    env,
    energy,
    mergeRatio: totalCount > 0 ? mergeCount / totalCount : 0,
    agentRatio: totalCount > 0 ? agentCount / totalCount : 0,
    density: activeSlots / SLOT_COUNT,
    centroid: weightSum > 0 ? weightedCenter / weightSum : 0.5,
    commitCount: totalCount,
    churn: totalChurn,
    startMs,
    endMs,
  };
}

/**
 * Build a full interpolated 3D wavetable from real Git depth slices.
 */
export function buildWavetable(
  model: Model,
  view: View,
  shas: Set<string> | null,
  ceiling: number,
  options: WavetableOptions = {}
): WavetableData {
  const sliceCount = Math.max(8, Math.min(72, options.sliceCount ?? 48));
  const sampleCount = Math.max(32, Math.min(160, options.sampleCount ?? 96));
  const smooth = clamp(options.smooth ?? 0.55, 0, 1);
  const smoothPasses = Math.round(1 + smooth * 3);
  const rawSlices = options.fullHistory
    ? historyDepthSlices(model, view.span, 24)
    : depthSlices(model, view).slice(0, 24);
  const seedVal = hashSeed(options.seed ?? view.query ?? view.focusRef ?? "gitwave");

  const rawFrames: RawFrame[] = [];
  let frontSlots: Slot[] = [];
  let aggEnergy = 0;
  let aggMerge = 0;
  let aggAgent = 0;
  let aggDensity = 0;
  let totalCommits = 0;

  for (let i = 0; i < rawSlices.length; i++) {
    const slice = rawSlices[i];
    const slots = buildSlots(model, slice.window, shas, ceiling);
    if (i === 0) frontSlots = slots;
    const frame = summarizeSlots(
      slots,
      slice.window.startMs,
      slice.window.endMs,
      sampleCount,
      smoothPasses
    );
    rawFrames.push(frame);
    aggEnergy += frame.energy;
    aggMerge += frame.mergeRatio;
    aggAgent += frame.agentRatio;
    aggDensity += frame.density;
    totalCommits += frame.commitCount;
  }

  const rawCount = Math.max(1, rawFrames.length);
  const meanMerge = aggMerge / rawCount;
  const meanAgent = aggAgent / rawCount;
  const meanDensity = aggDensity / rawCount;
  const empty = totalCommits === 0;

  /* Derive distinct, musical synth timbre parameters from real Git profile */
  const carrier =
    meanMerge > 0.35
      ? 1.8 + seedVal * 0.8
      : meanAgent > 0.35
        ? 3.2 + seedVal * 1.4
        : 2.2 + meanDensity * 2.1 + seedVal * 0.7;
  const fmRatio = meanAgent > 0.35 ? 3.5 : meanMerge > 0.35 ? 1.5 : 2.0 + Math.floor(seedVal * 2);
  const fmIndex = (0.35 + meanAgent * 1.25 + (1 - smooth) * 0.75) * (meanMerge > 0.45 ? 0.55 : 1.0);
  const phaseTwist = (1.6 + meanDensity * 2.2 + seedVal * 1.1) * (meanMerge > 0.35 ? 0.75 : 1.0);
  const harmonicMix = clamp(0.28 + (1 - smooth) * 0.42 + meanAgent * 0.25, 0.15, 0.85);

  const frames: Float32Array[] = [];
  const envelopes: Float32Array[] = [];
  const meta: WavetableLayerMeta[] = [];

  for (let f = 0; f < sliceCount; f++) {
    const z = sliceCount > 1 ? f / (sliceCount - 1) : 0;
    const rawPos = z * Math.max(0, rawFrames.length - 1);
    const i0 = Math.min(rawFrames.length - 1, Math.floor(rawPos));
    const i1 = Math.min(rawFrames.length - 1, i0 + 1);
    const lin = rawPos - i0;
    /* Smoothstep between adjacent raw slices so Z-depth flows continuously */
    const frac = lin * lin * (3 - 2 * lin);

    const a = rawFrames[i0];
    const b = rawFrames[i1];
    const energy = a.energy + (b.energy - a.energy) * frac;
    const mergeRatio = a.mergeRatio + (b.mergeRatio - a.mergeRatio) * frac;
    const agentRatio = a.agentRatio + (b.agentRatio - a.agentRatio) * frac;
    const density = a.density + (b.density - a.density) * frac;
    const centroid = a.centroid + (b.centroid - a.centroid) * frac;
    const commitCount = Math.round(a.commitCount + (b.commitCount - a.commitCount) * frac);
    const churn = Math.round(a.churn + (b.churn - a.churn) * frac);
    const startMs = Math.round(a.startMs + (b.startMs - a.startMs) * frac);
    const endMs = Math.round(a.endMs + (b.endMs - a.endMs) * frac);

    const wave = new Float32Array(sampleCount);
    const envOut = new Float32Array(sampleCount);

    for (let s = 0; s < sampleCount; s++) {
      const u = s / Math.max(1, sampleCount - 1);
      const env = a.env[s] + (b.env[s] - a.env[s]) * frac;
      envOut[s] = env;

      if (empty || energy < 0.001) {
        wave[s] = 0;
        continue;
      }

      /* Periodic raised-sine taper so edges land gracefully on the zero-plane */
      const win = Math.pow(Math.sin(Math.PI * u), 0.42);
      const theta = Math.PI * 2 * u;

      /* Subtle formant focus anchored to the slice's real commit centroid */
      const distFromPeak = u - centroid;
      const formant = 0.68 + 0.32 * Math.exp(-distFromPeak * distFromPeak * 7.5);

      /* Harmonic + FM synthesis driven directly by local churn envelope & slice traits */
      const modPhase = theta * fmRatio - z * phaseTwist * 1.45 + seedVal * Math.PI * 2;
      const fm = fmIndex * (0.25 + 0.75 * env) * Math.sin(modPhase);

      const primary = Math.sin(theta * carrier + z * phaseTwist + fm);
      const second = Math.sin(theta * (carrier * 2) - z * phaseTwist * 1.2 + env * 2.4);
      const shimmer = Math.cos(theta * (carrier * 3 + 1) + z * 3.1) * (0.18 + 0.82 * agentRatio);

      /* Combine bipolar wave with gentle sculpted ridge lift from churn envelope */
      const rawSignal =
        primary * (0.72 + 0.28 * formant) +
        second * harmonicMix * (0.28 + 0.72 * env) +
        shimmer * harmonicMix * 0.42 * (1 - smooth * 0.55);

      /* Envelope gates amplitude cleanly: quiet spans rest near zero, active spans bloom */
      const localAmp = Math.pow(clamp(env * 0.86 + energy * 0.14, 0, 1), 0.68);
      const shaped = Math.tanh(rawSignal * (0.95 + 0.35 * (1 - smooth)));
      /* Tiny positive bias proportional to churn so big churn surges swell visibly */
      const ridgeLift = env * env * 0.18 * (1 - mergeRatio * 0.4);
      wave[s] = clamp(win * (shaped * localAmp * 0.92 + ridgeLift), -1, 1);
    }

    frames.push(wave);
    envelopes.push(envOut);
    meta.push({
      z,
      energy,
      mergeRatio,
      agentRatio,
      density,
      centroid,
      commitCount,
      churn,
      startMs,
      endMs,
    });
  }

  return {
    sliceCount,
    sampleCount,
    frames,
    envelopes,
    meta,
    rawSlices,
    frontSlots,
    empty,
    timbre: { carrier, fmRatio, fmIndex, phaseTwist, harmonicMix },
  };
}

/**
 * Evaluate an interpolated wave slice at continuous depth `zNorm` in [0, 1],
 * with optional gentle real-time ambient breathing `breathPhase`.
 */
export function sampleWavetableSlice(
  table: WavetableData,
  zNorm: number,
  breathPhase = 0,
  breathAmp = 0
): Float32Array {
  const n = table.sliceCount;
  const samples = table.sampleCount;
  const out = new Float32Array(samples);
  if (n === 0 || table.empty) return out;
  const pos = clamp(zNorm, 0, 1) * (n - 1);
  const i0 = Math.min(n - 1, Math.floor(pos));
  const i1 = Math.min(n - 1, i0 + 1);
  const frac = pos - i0;
  const f0 = table.frames[i0];
  const f1 = table.frames[i1];

  for (let s = 0; s < samples; s++) {
    const base = f0[s] + (f1[s] - f0[s]) * frac;
    if (breathAmp > 0) {
      const u = s / Math.max(1, samples - 1);
      const win = Math.sin(Math.PI * u);
      const ripple = Math.sin(u * Math.PI * 4 + breathPhase + zNorm * 2.5) * breathAmp * win;
      out[s] = clamp(base * (1 + 0.04 * Math.sin(breathPhase)) + ripple, -1, 1);
    } else {
      out[s] = base;
    }
  }
  return out;
}
