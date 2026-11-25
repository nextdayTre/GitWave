/**
 * depth.js — true 3D isometric volumetric wavetable engine + paired 2D scope.
 *
 * Renders Git history as a sculpted, translucent, continuously morphing 3D
 * wavetable inspired by Kilohearts, Warpenter and Serum:
 *   - `drawDepth`         — Hero 3D volumetric wavetable inside a delicate
 *                           isometric wireframe cage (interactive orbit).
 *   - `drawActiveScope`   — Warpenter-style paired 2D oscilloscope synced 1:1
 *                           to the active 3D playhead slice.
 *   - `drawModuleSurface` — Serum-style Rack oscillators AND Kilohearts
 *                           borderless floating 3D browser thumbnails.
 *
 * Pure 2D canvas, cached wavetable synthesis, zero libraries, zero hex literals.
 */

import { ctx, getOscParams, setView } from "../app.ts";
import { slotAtX, slotGeometry, slotX } from "../core/geometry.ts";
import { mergeMarkers } from "../core/refs.ts";
import {
  SLOT_COUNT,
  clamp,
  dateFull,
  dateMedium,
  dateShort,
  effectiveCeiling,
  isoOf,
  refTipTime,
  slotIndexForTime,
  windowFor,
} from "../core/samples.ts";
import { searchCommits } from "../core/search.ts";
import { buildSpline, evalSpline } from "../core/spline.ts";
import { hexToRgbFast, mixHex, rgba, rgbaMixRgb } from "../core/theme.ts";
import { focusSlot, historyRange, wtPosOf, endMsAtWtPos } from "../core/view.ts";
import { buildWavetable, sampleWavetableSlice } from "../core/wavetable.ts";
import { openDiffView } from "../ui/diff.js";
import { shortSha } from "../ui/dom.js";

const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
const SWEEP_RATE = 0.085;
const BREATH_RATE = 1.15;

/* Lightweight LRU cache for synthesized wavetables so 60fps rendering stays light */
const tableCache = new Map();
const MAX_CACHE = 48;

/* Per-frozen-model ceiling cache: avoids scanning all commits every 60fps frame */
const ceilingCache = new WeakMap();

/* Cached canvas CSS sizes: avoids getBoundingClientRect() layout thrashing inside rAF */
let canvasSizeEpoch = 1;
const canvasSizeCache = new WeakMap();

export function invalidateCanvasSizes() {
  canvasSizeEpoch += 1;
}

/* Precomputed sin(pi * u) taper arrays per sampleCount */
const sinPiCache = new Map();
function getSinPi(S) {
  let arr = sinPiCache.get(S);
  if (arr) return arr;
  arr = new Float32Array(S);
  const inv = 1 / Math.max(1, S - 1);
  for (let s = 0; s < S; s++) arr[s] = Math.sin(Math.PI * s * inv);
  sinPiCache.set(S, arr);
  return arr;
}

/* Reusable flat projection scratch buffers (eliminates ~23,000 {x,y,p} allocations/frame) */
let scratchCap = 0;
let projX = new Float32Array(0);
let projY = new Float32Array(0);
let baseX = new Float32Array(0);
let baseY = new Float32Array(0);
let activeX = new Float32Array(0);
let activeY = new Float32Array(0);
let activeBaseX = new Float32Array(0);
let activeBaseY = new Float32Array(0);

function ensureProjectionScratch(total, S) {
  if (total > scratchCap) {
    scratchCap = total;
    projX = new Float32Array(total);
    projY = new Float32Array(total);
    baseX = new Float32Array(total);
    baseY = new Float32Array(total);
  }
  if (S > activeX.length) {
    activeX = new Float32Array(S);
    activeY = new Float32Array(S);
    activeBaseX = new Float32Array(S);
    activeBaseY = new Float32Array(S);
  }
}

function getCachedCeiling(model, span, queryKey, shas) {
  let byKey = ceilingCache.get(model);
  if (!byKey) {
    byKey = new Map();
    ceilingCache.set(model, byKey);
  }
  const key = `${span}|${queryKey}`;
  const hit = byKey.get(key);
  if (hit !== undefined) return hit;
  const frontWin = windowFor(model, model.doc.repo.snapshotAt, span);
  const val = effectiveCeiling(model, frontWin, shas);
  if (byKey.size >= 128) {
    const oldest = byKey.keys().next().value;
    if (oldest !== undefined) byKey.delete(oldest);
  }
  byKey.set(key, val);
  return val;
}

export function formatChurn(n) {
  if (n >= 10000) return `${(n / 1000).toFixed(1)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(2)}k`;
  return String(Math.round(n));
}

/**
 * Target normalized WT POS [0..1] coupled directly to the repo read head (`view.end`),
 * with smooth sub-slot interpolation while the LFO transport is playing.
 * 0 = oldest travelable window for the span, 1 = latest snapshot (`now`).
 */
export function targetWtPos() {
  if (!ctx.model || !ctx.view) return 1;
  const { minEnd, maxEnd } = historyRange(ctx.model, ctx.view.span);
  if (maxEnd <= minEnd) return 1;
  const baseEnd = ctx.window ? ctx.window.endMs : windowFor(ctx.model, ctx.view.end, ctx.view.span).endMs;
  if (ctx.view.motion.playing && ctx.window && ctx.window.slotMs > 0) {
    const dir = ctx.lfoDir || 1;
    const phase = clamp(ctx.depthPhase, 0, 1);
    const delta = dir * phase * ctx.window.slotMs;
    /* In sweep mode, avoid stalling at maxEnd for a full beat before wrapping */
    if (ctx.view.motion.mode === "sweep" && dir > 0 && baseEnd >= maxEnd - 1) {
      return clamp((minEnd + phase * ctx.window.slotMs - minEnd) / (maxEnd - minEnd), 0, 1);
    }
    const smoothEnd = clamp(baseEnd + delta, minEnd, maxEnd);
    return clamp((smoothEnd - minEnd) / (maxEnd - minEnd), 0, 1);
  }
  return wtPosOf(ctx.model, ctx.view);
}

/**
 * Advance the smoothly damped visual WT POS for fluid glide on jumps & LFO travel.
 * Snaps instantly on reduced motion, static mode, or sweep wrap-around.
 */
export function stepSmoothWtPos(dtSec = 0.0167, instant = false) {
  const target = targetWtPos();
  if (instant || ctx.reducedMotion || ctx.smoothWtPos === null || !Number.isFinite(ctx.smoothWtPos)) {
    ctx.smoothWtPos = target;
    return target;
  }
  const diff = target - ctx.smoothWtPos;
  /* Snap cleanly on sweep wrap-around or tiny residuals */
  if (
    Math.abs(diff) < 0.0004 ||
    (ctx.view?.motion.playing && ctx.view.motion.mode === "sweep" && Math.abs(diff) > 0.6)
  ) {
    ctx.smoothWtPos = target;
    return target;
  }
  const rate = ctx.view?.motion.playing ? 24 : 18;
  const alpha = 1 - Math.exp(-Math.min(0.1, Math.max(0.001, dtSec)) * rate);
  ctx.smoothWtPos += diff * alpha;
  return ctx.smoothWtPos;
}

/** Live normalized WT POS [0..1] (smoothly damped when animating, exact when static). */
export function liveWtPos() {
  if (ctx.smoothWtPos !== null && Number.isFinite(ctx.smoothWtPos)) {
    return clamp(ctx.smoothWtPos, 0, 1);
  }
  return targetWtPos();
}

/** Live read-head timestamp (ms) matching `liveWtPos()`. */
export function liveReadHeadMs() {
  if (!ctx.model || !ctx.view) return 0;
  const { minEnd, maxEnd } = historyRange(ctx.model, ctx.view.span);
  return Math.round(minEnd + liveWtPos() * (maxEnd - minEnd));
}

function getCachedTable(model, view, shas, ceiling, sliceCount, sampleCount, smooth, seed, fullHistory = true) {
  const key = [
    model.doc.repo.id,
    fullHistory ? "hist" : view.end,
    view.span,
    seed,
    ceiling,
    sliceCount,
    sampleCount,
    Math.round(smooth * 50),
    shas ? shas.size : -1,
  ].join("|");
  const hit = tableCache.get(key);
  if (hit) return hit;
  const table = buildWavetable(model, view, shas, ceiling, {
    sliceCount,
    sampleCount,
    smooth,
    seed,
    fullHistory,
  });
  if (tableCache.size >= MAX_CACHE) {
    const oldest = tableCache.keys().next().value;
    tableCache.delete(oldest);
  }
  tableCache.set(key, table);
  return table;
}

function fit(canvas, forceMeasure = false) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let entry = canvasSizeCache.get(canvas);
  if (forceMeasure || !entry || entry.epoch !== canvasSizeEpoch || entry.width <= 1 || entry.height <= 1) {
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    entry = { epoch: canvasSizeEpoch, width, height, dpr };
    canvasSizeCache.set(canvas, entry);
  }
  const { width, height } = entry;
  const pxW = Math.round(width * dpr);
  const pxH = Math.round(height * dpr);
  if (canvas.width !== pxW || canvas.height !== pxH) {
    canvas.width = pxW;
    canvas.height = pxH;
  }
  const g = canvas.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { g, width, height };
}

/**
 * True normalized unit-space 3D isometric/perspective projector.
 *
 * All rotations and perspective division happen in unit space (x in [-1,1],
 * y in [-1,1], z in [-1,1] where -1 = front/newest, +1 = back/oldest) before
 * scaling to screen pixels — guaranteeing crisp 3D optics with zero clipping
 * or camera singularity at any canvas aspect ratio.
 */
function makeProjector(w, h, yaw, pitch, opts = {}) {
  const xStretch = opts.xStretch ?? 1.05;
  const zStretch = opts.zStretch ?? 0.85;
  const yStretch = opts.yStretch ?? 0.38;
  const fill = opts.fill ?? 0.44;
  const centerYOffset = opts.centerYOffset ?? 0.03;

  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);

  /* Compute exact bounding extent in unit space so the 3D volume always fits cleanly */
  const maxUnitX = (Math.abs(xStretch * cy) + Math.abs(zStretch * sy)) * 1.14;
  const maxUnitY =
    ((Math.abs(xStretch * sy) + Math.abs(zStretch * cy)) * Math.abs(sp) +
      Math.abs(yStretch * cp) +
      0.16) *
    1.14;

  const unitScale = Math.min((w * fill) / Math.max(0.5, maxUnitX), (h * fill) / Math.max(0.5, maxUnitY));
  const cx = w * 0.5;
  const baseY = h * (0.5 + centerYOffset);
  const fov = 5.8;

  function project(x, y, z) {
    const ux = x * xStretch;
    const uy = y * yStretch;
    const uz = z * zStretch;

    /* Rotate around Y (yaw): back (z > 0) shifts right; right (x > 0) shifts slightly forward */
    const rx = ux * cy + uz * sy;
    const rz = -ux * sy + uz * cy;

    /* Rotate around X (pitch): back (rz > 0) rises up on screen; amplitude (uy) rises vertically */
    const screenUp = uy * cp + rz * sp;
    const camDepth = rz * cp - uy * sp;

    const p = fov / Math.max(2.2, fov + camDepth);
    return {
      x: cx + rx * unitScale * p,
      y: baseY - screenUp * unitScale * p,
      p,
    };
  }
  project.params = { xStretch, yStretch, zStretch, cy, sy, cp, sp, unitScale, cx, baseY, fov };
  return project;
}

/** Draw Warpenter / Serum-style subtle 3D isometric bounding wireframe cage. */
function drawWireCage(g, proj, P, frontColor, alphaScale = 1) {
  const yFloor = -0.92;
  const yCeil = 1.05;
  const corners = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ];

  g.save();
  /* Soft receding floor fill */
  const f0 = proj(-1, yFloor, -1);
  const f1 = proj(1, yFloor, -1);
  const f2 = proj(1, yFloor, 1);
  const f3 = proj(-1, yFloor, 1);
  g.beginPath();
  g.moveTo(f0.x, f0.y);
  g.lineTo(f1.x, f1.y);
  g.lineTo(f2.x, f2.y);
  g.lineTo(f3.x, f3.y);
  g.closePath();
  g.fillStyle = rgba(frontColor, 0.03 * alphaScale);
  g.fill();

  /* Floor grid lines along depth & wave axes */
  g.strokeStyle = rgba(P.lineHi, 0.28 * alphaScale);
  g.lineWidth = 0.75;
  for (let i = 1; i <= 3; i++) {
    const t = -1 + (i / 4) * 2;
    const a = proj(-1, yFloor, t);
    const b = proj(1, yFloor, t);
    g.beginPath();
    g.moveTo(a.x, a.y);
    g.lineTo(b.x, b.y);
    g.stroke();

    const c = proj(t, yFloor, -1);
    const d = proj(t, yFloor, 1);
    g.beginPath();
    g.moveTo(c.x, c.y);
    g.lineTo(d.x, d.y);
    g.stroke();
  }

  /* Zero-plane bounding outline (y = 0) */
  g.strokeStyle = rgba(P.dimmer, 0.25 * alphaScale);
  g.lineWidth = 0.8;
  const z0 = proj(-1, 0, -1);
  const z1 = proj(1, 0, -1);
  const z2 = proj(1, 0, 1);
  const z3 = proj(-1, 0, 1);
  g.beginPath();
  g.moveTo(z0.x, z0.y);
  g.lineTo(z1.x, z1.y);
  g.lineTo(z2.x, z2.y);
  g.lineTo(z3.x, z3.y);
  g.closePath();
  g.stroke();

  /* Floor outer border */
  g.strokeStyle = rgba(P.lineHi, 0.42 * alphaScale);
  g.lineWidth = 0.9;
  g.beginPath();
  g.moveTo(f0.x, f0.y);
  g.lineTo(f1.x, f1.y);
  g.lineTo(f2.x, f2.y);
  g.lineTo(f3.x, f3.y);
  g.closePath();
  g.stroke();

  /* Delicate corner verticals & upper frame */
  g.strokeStyle = rgba(P.dimmer, 0.16 * alphaScale);
  g.lineWidth = 0.7;
  for (const [cx, cz] of corners) {
    const bot = proj(cx, yFloor, cz);
    const top = proj(cx, yCeil, cz);
    g.beginPath();
    g.moveTo(bot.x, bot.y);
    g.lineTo(top.x, top.y);
    g.stroke();
  }
  const t0 = proj(-1, yCeil, -1);
  const t1 = proj(1, yCeil, -1);
  const t2 = proj(1, yCeil, 1);
  const t3 = proj(-1, yCeil, 1);
  g.beginPath();
  g.moveTo(t0.x, t0.y);
  g.lineTo(t1.x, t1.y);
  g.lineTo(t2.x, t2.y);
  g.lineTo(t3.x, t3.y);
  g.closePath();
  g.stroke();
  g.restore();
}

/**
 * Core volumetric 3D wavetable painter.
 * Renders back-to-front translucent silk ribbons, slope-lit crest highlights,
 * subtle additive luminous mist, bright leading rim, and the active playhead slice.
 *
 * Uses flat Float32Array projection buffers and batched per-slice fills (~40x fewer
 * Canvas draw calls than per-quad fills, zero per-frame object/color-string churn).
 */
function paintWavetable3D(g, table, proj, P, opts) {
  const {
    frontColor,
    backColor,
    playheadColor,
    playheadPos,
    showPlayhead = true,
    breathPhase = 0,
    breathAmp = 0.025,
    mode = "stage", // 'stage' | 'rack' | 'browser'
  } = opts;

  const D = table.sliceCount;
  const S = table.sampleCount;
  if (D === 0 || S === 0) return null;

  const isBrowser = mode === "browser";
  const isStage = mode === "stage";
  const rimHighlight = mixHex(frontColor, P.handle, isBrowser ? 0.62 : 0.48);
  const crestLight = mixHex(frontColor, P.handle, 0.34);
  const playCore = mixHex(playheadColor, P.handle, 0.58);

  const frontRgb = hexToRgbFast(frontColor);
  const backRgb = hexToRgbFast(backColor);
  const rimRgb = hexToRgbFast(rimHighlight);
  const crestRgb = hexToRgbFast(crestLight);

  ensureProjectionScratch(D * S, S);
  const sinPi = getSinPi(S);
  const breathScale = 1 + 0.035 * Math.sin(breathPhase);
  const { xStretch, yStretch, zStretch, cy, sy, cp, sp, unitScale, cx, baseY: centerY, fov } = proj.params;
  const invS = 1 / Math.max(1, S - 1);
  const invD = D > 1 ? 1 / (D - 1) : 0;
  const doBreath = !table.empty && breathAmp > 0;

  /* Pre-project every slice into flat Float32Arrays (zero heap allocations) */
  for (let i = 0; i < D; i++) {
    const zNorm = i * invD;
    const zCoord = -1 + zNorm * 2;
    const uz = zCoord * zStretch;
    const uzSy = uz * sy;
    const uzCy = uz * cy;
    const frame = table.frames[i];
    const rowOff = i * S;
    const zPhase = breathPhase + zNorm * 2.4;

    for (let s = 0; s < S; s++) {
      const u = s * invS;
      const ux = (-1 + u * 2) * xStretch;
      const rx = ux * cy + uzSy;
      const rz = -ux * sy + uzCy;

      let yVal = frame[s] * breathScale;
      if (doBreath) {
        yVal += Math.sin(u * 12.566370614359172 + zPhase) * breathAmp * sinPi[s];
      }
      const uy = yVal * yStretch;
      const screenUp = uy * cp + rz * sp;
      const camDepth = rz * cp - uy * sp;
      const p = fov / (fov + camDepth > 2.2 ? fov + camDepth : 2.2);
      const idx = rowOff + s;
      projX[idx] = cx + rx * unitScale * p;
      projY[idx] = centerY - screenUp * unitScale * p;

      const baseCam = rz * cp;
      const pb = fov / (fov + baseCam > 2.2 ? fov + baseCam : 2.2);
      baseX[idx] = cx + rx * unitScale * pb;
      baseY[idx] = centerY - rz * sp * unitScale * pb;
    }
  }

  /* Project active playhead slice at exact continuous depth playheadPos in [0, 1] */
  const activeZ = clamp(playheadPos, 0, 1);
  const activeSliceValues = sampleWavetableSlice(table, activeZ, breathPhase, breathAmp);
  const activeUz = (-1 + activeZ * 2) * zStretch;
  const aUzSy = activeUz * sy;
  const aUzCy = activeUz * cy;
  for (let s = 0; s < S; s++) {
    const ux = (-1 + s * invS * 2) * xStretch;
    const rx = ux * cy + aUzSy;
    const rz = -ux * sy + aUzCy;

    const uy = activeSliceValues[s] * yStretch;
    const screenUp = uy * cp + rz * sp;
    const camDepth = rz * cp - uy * sp;
    const p = fov / (fov + camDepth > 2.2 ? fov + camDepth : 2.2);
    activeX[s] = cx + rx * unitScale * p;
    activeY[s] = centerY - screenUp * unitScale * p;

    const baseCam = rz * cp;
    const pb = fov / (fov + baseCam > 2.2 ? fov + baseCam : 2.2);
    activeBaseX[s] = cx + rx * unitScale * pb;
    activeBaseY[s] = centerY - rz * sp * unitScale * pb;
  }
  const playheadInsertIdx = Math.round(activeZ * (D - 1));

  /* Interpolated real Git energy at activeZ for subtle dynamic playhead bloom */
  let activeEnergy = 0.4;
  if (table.meta && table.meta.length > 0) {
    const mPos = activeZ * (table.meta.length - 1);
    const m0 = Math.min(table.meta.length - 1, Math.floor(mPos));
    const m1 = Math.min(table.meta.length - 1, m0 + 1);
    const mf = mPos - m0;
    activeEnergy = table.meta[m0].energy + (table.meta[m1].energy - table.meta[m0].energy) * mf;
  }

  const drawPlayheadSlice = () => {
    if (!showPlayhead) return;
    const energyBoost = 0.85 + 0.45 * activeEnergy;
    /* Translucent golden curtain between playhead curve and zero-plane */
    g.save();
    g.beginPath();
    g.moveTo(activeX[0], activeY[0]);
    for (let s = 1; s < S; s++) g.lineTo(activeX[s], activeY[s]);
    for (let s = S - 1; s >= 0; s--) g.lineTo(activeBaseX[s], activeBaseY[s]);
    g.closePath();
    g.fillStyle = rgba(playheadColor, (isStage ? 0.15 : 0.13) * energyBoost);
    g.fill();

    /* Subtle zero-rail highlight underneath the active slice */
    g.strokeStyle = rgba(playheadColor, 0.35);
    g.lineWidth = 0.85;
    g.beginPath();
    g.moveTo(activeBaseX[0], activeBaseY[0]);
    g.lineTo(activeBaseX[S - 1], activeBaseY[S - 1]);
    g.stroke();

    /* Outer phosphor bloom (swells subtly over busy commit ridges) */
    g.lineJoin = "round";
    g.lineCap = "round";
    g.globalCompositeOperation = "lighter";
    g.strokeStyle = rgba(playheadColor, (isStage ? 0.26 : 0.22) * energyBoost);
    g.lineWidth = (isStage ? 8.2 : 5.4) * (0.9 + 0.25 * activeEnergy);
    g.beginPath();
    g.moveTo(activeX[0], activeY[0]);
    for (let s = 1; s < S; s++) g.lineTo(activeX[s], activeY[s]);
    g.stroke();

    /* Main crisp golden/amber trace */
    g.globalCompositeOperation = "source-over";
    g.strokeStyle = playheadColor;
    g.lineWidth = isStage ? 2.2 : 1.75;
    g.stroke();

    /* Hot white-gold filament core */
    g.strokeStyle = rgba(playCore, 0.88);
    g.lineWidth = isStage ? 0.9 : 0.7;
    g.stroke();

    /* Pulsing yellow selection beacon dot on the 3D waveform (both Stage & Rack) */
    const markerSlot = opts.markerSlot ?? -1;
    const markerOwned = opts.markerOwned !== false;
    const markerPulse = opts.markerPulse ?? 0.5;
    const markerLabel = opts.markerLabel ?? "";
    if (!isBrowser && markerSlot >= 0 && markerSlot < SLOT_COUNT) {
      const idx = Math.round((markerSlot / (SLOT_COUNT - 1)) * (S - 1));
      const mpx = activeX[idx];
      const mpy = activeY[idx];
      const mbx = activeBaseX[idx];
      const mby = activeBaseY[idx];
      if (Number.isFinite(mpx) && Number.isFinite(mbx)) {
        const dotYellow = mixHex(playheadColor, P.handle, 0.25);
        const dotCore = mixHex(playheadColor, P.handle, 0.78);
        const baseR = isStage ? 4.8 : 3.9;
        const sonarR = baseR + 3.5 + markerPulse * (isStage ? 11.5 : 8.5);
        const sonarAlpha = (1 - markerPulse * 0.82) * (markerOwned ? 0.78 : 0.36);

        /* Dashed vertical beacon drop-line to the zero-plane */
        g.strokeStyle = rgba(playheadColor, markerOwned ? 0.72 : 0.32);
        g.lineWidth = isStage ? 1.2 : 1;
        g.setLineDash([2.5, 2.5]);
        g.beginPath();
        g.moveTo(mbx, mby);
        g.lineTo(mpx, mpy);
        g.stroke();
        g.setLineDash([]);

        /* Zero-plane anchor tick */
        g.fillStyle = rgba(playheadColor, markerOwned ? 0.6 : 0.28);
        g.beginPath();
        g.arc(mbx, mby, isStage ? 2.2 : 1.7, 0, Math.PI * 2);
        g.fill();

        /* Expanding pulsing sonar ring */
        g.strokeStyle = rgba(playheadColor, sonarAlpha);
        g.lineWidth = isStage ? 1.8 : 1.4;
        g.beginPath();
        g.arc(mpx, mpy, sonarR, 0, Math.PI * 2);
        g.stroke();

        if (markerOwned) {
          /* Additive yellow phosphor aura */
          g.save();
          g.globalCompositeOperation = "lighter";
          g.fillStyle = rgba(playheadColor, 0.36 + 0.24 * (1 - markerPulse));
          g.beginPath();
          g.arc(mpx, mpy, baseR + 4.2 + markerPulse * 2.2, 0, Math.PI * 2);
          g.fill();
          g.restore();

          /* Solid glowing yellow/amber dot + hot pinpoint core */
          g.fillStyle = dotYellow;
          g.beginPath();
          g.arc(mpx, mpy, baseR + 0.4 * Math.sin(markerPulse * Math.PI), 0, Math.PI * 2);
          g.fill();

          g.strokeStyle = P.bg;
          g.lineWidth = 1;
          g.stroke();

          g.fillStyle = dotCore;
          g.beginPath();
          g.arc(mpx, mpy, baseR * 0.44, 0, Math.PI * 2);
          g.fill();
        } else {
          /* Hollow time-reference ring for sibling oscillators at this timestamp */
          g.strokeStyle = rgba(dotYellow, 0.85);
          g.lineWidth = 1.6;
          g.beginPath();
          g.arc(mpx, mpy, baseR * 0.9, 0, Math.PI * 2);
          g.stroke();
        }

        /* Crisp floating date/selection pill directly above the pulsing dot */
        if (markerLabel && (isStage || markerOwned)) {
          g.font = `${isStage ? "9.5px" : "8.5px"} ${MONO}`;
          const tw = g.measureText(markerLabel).width;
          const padX = 5;
          const pillW = tw + padX * 2;
          const pillH = isStage ? 15 : 13;
          const px = mpx - pillW * 0.5;
          const py = mpy - baseR - pillH - 7;
          g.fillStyle = rgba(P.bg, 0.86);
          g.strokeStyle = rgba(playheadColor, 0.65);
          g.lineWidth = 0.9;
          g.beginPath();
          g.roundRect(px, py, pillW, pillH, 3);
          g.fill();
          g.stroke();

          g.fillStyle = dotYellow;
          g.textAlign = "center";
          g.textBaseline = "middle";
          g.fillText(markerLabel, mpx, py + pillH * 0.5 + 0.5);
        }
      }
    }
    g.restore();
  };

  g.save();
  g.lineJoin = "round";
  g.lineCap = "round";

  /* Painter's algorithm: back (D-1) to front (0) */
  let playheadDrawn = false;
  const quadStep = isStage ? 2 : 3;

  for (let i = D - 1; i >= 0; i--) {
    const zNorm = i * invD;
    const foreWeight = 1 - zNorm;
    const zBlend = Math.pow(zNorm, 0.85);
    const sliceRgb = [
      frontRgb[0] + (backRgb[0] - frontRgb[0]) * zBlend,
      frontRgb[1] + (backRgb[1] - frontRgb[1]) * zBlend,
      frontRgb[2] + (backRgb[2] - frontRgb[2]) * zBlend,
    ];
    const rowOff = i * S;

    /* 1. Continuous translucent surface sheet between slice i and i-1 (1 fill + 1 batched crest pass) */
    if (i > 0 && !table.empty) {
      const nextOff = (i - 1) * S;
      const frameA = table.frames[i];
      const frameB = table.frames[i - 1];
      const layerEnergy = table.meta?.[i]?.energy ?? 0.45;
      const stripAlphaBase = isBrowser
        ? 0.045 + 0.095 * foreWeight
        : isStage
          ? 0.055 + 0.115 * foreWeight
          : 0.065 + 0.125 * foreWeight;

      /* Pass 1a: seamless full silk ribbon (eliminates 87-111 per-quad fills & anti-alias seams) */
      g.beginPath();
      g.moveTo(projX[rowOff], projY[rowOff]);
      for (let s = 1; s < S; s++) g.lineTo(projX[rowOff + s], projY[rowOff + s]);
      for (let s = S - 1; s >= 0; s--) g.lineTo(projX[nextOff + s], projY[nextOff + s]);
      g.closePath();
      g.fillStyle = rgbaMixRgb(
        sliceRgb,
        crestRgb,
        0.18 * foreWeight,
        stripAlphaBase * (0.64 + 0.36 * layerEnergy)
      );
      g.fill();

      /* Pass 1b: single batched slope-lit crest highlight for sculpted 3D relief */
      let hasCrest = false;
      g.beginPath();
      for (let s = 0; s < S - quadStep; s += quadStep) {
        const s2 = s + quadStep < S ? s + quadStep : S - 1;
        const hAvg = (frameA[s] + frameA[s2] + frameB[s] + frameB[s2]) * 0.25;
        const slope = (frameB[s] - frameA[s]) * 1.4 + (frameB[s2] - frameB[s]) * 0.8;
        if (hAvg * 0.45 + slope * 0.35 > 0.11) {
          hasCrest = true;
          const a0 = rowOff + s;
          const a1 = rowOff + s2;
          const b0 = nextOff + s;
          const b1 = nextOff + s2;
          g.moveTo(projX[a0], projY[a0]);
          g.lineTo(projX[a1], projY[a1]);
          g.lineTo(projX[b1], projY[b1]);
          g.lineTo(projX[b0], projY[b0]);
          g.closePath();
        }
      }
      if (hasCrest) {
        g.fillStyle = rgbaMixRgb(sliceRgb, crestRgb, 0.58, stripAlphaBase * 0.42);
        g.fill();
      }
    }

    /* 2. Soft translucent vertical ribbon curtain (creates Warpenter volumetric mist) */
    if (!table.empty) {
      g.beginPath();
      g.moveTo(projX[rowOff], projY[rowOff]);
      for (let s = 1; s < S; s++) g.lineTo(projX[rowOff + s], projY[rowOff + s]);
      for (let s = S - 1; s >= 0; s--) g.lineTo(baseX[rowOff + s], baseY[rowOff + s]);
      g.closePath();
      const curtainAlpha = isBrowser
        ? 0.018 + 0.042 * foreWeight
        : 0.02 + 0.048 * foreWeight;
      g.fillStyle = rgbaMixRgb(sliceRgb, sliceRgb, 0, curtainAlpha);
      g.fill();
    }

    /* 3. Crisp translucent wave ridge line */
    const strokeAlpha =
      i === 0
        ? 0.94
        : (isBrowser ? 0.1 : 0.08) + (isBrowser ? 0.44 : 0.38) * Math.pow(foreWeight, 1.35);
    g.strokeStyle =
      i === 0 ? rimHighlight : rgbaMixRgb(sliceRgb, rimRgb, foreWeight * 0.35, strokeAlpha);
    g.lineWidth = i === 0 ? (isStage ? 1.8 : 1.4) : isStage ? 0.8 : 0.65;
    g.beginPath();
    g.moveTo(projX[rowOff], projY[rowOff]);
    for (let s = 1; s < S; s++) g.lineTo(projX[rowOff + s], projY[rowOff + s]);
    g.stroke();

    /* 4. Ethereal additive glow sheen on every few ridges (reuses current path!) */
    if (!table.empty && (i === 0 || i % 3 === 0)) {
      g.globalCompositeOperation = "lighter";
      g.strokeStyle =
        i === 0
          ? rgbaMixRgb(rimRgb, rimRgb, 0, 0.24)
          : rgbaMixRgb(frontRgb, frontRgb, 0, 0.055 + 0.065 * foreWeight);
      g.lineWidth = i === 0 ? (isStage ? 5.5 : 3.8) : isStage ? 2.2 : 1.6;
      g.stroke();
      g.globalCompositeOperation = "source-over";
    }

    /* 5. Insert active playhead slice cleanly in depth order */
    if (showPlayhead && !playheadDrawn && i <= playheadInsertIdx) {
      drawPlayheadSlice();
      playheadDrawn = true;
    }
  }

  if (showPlayhead && !playheadDrawn) {
    drawPlayheadSlice();
  }

  g.restore();
  return { activeZ };
}

/**
 * Hero Stage 3D renderer (Warpenter-inspired full volumetric wavetable + orbit).
 * Anchored to the full repository history for the span; the glowing amber
 * playhead slice is directly coupled to the real Git read head (`view.end`).
 */
export function drawDepth(forceScope = false) {
  const canvas = document.getElementById("wave");
  if (!canvas || !ctx.view || !ctx.model || !ctx.palette || !ctx.window || !ctx.metric) return;
  const { g, width: w, height: h } = fit(canvas);
  const P = ctx.palette;
  const view = ctx.view;
  const model = ctx.model;
  const shas = ctx.search.shas;
  const stableCeiling = getCachedCeiling(model, view.span, view.query, shas);
  const frontColor = ctx.metric.color;
  const sp = ctx.stageParams;

  const table = getCachedTable(
    model,
    view,
    shas,
    stableCeiling,
    56,
    112,
    sp.smooth,
    ctx.view.query || ctx.metric.label,
    true
  );

  /* Smooth damped camera orbit */
  ctx.camera.yaw += (ctx.camera.targetYaw - ctx.camera.yaw) * 0.14;
  ctx.camera.pitch += (ctx.camera.targetPitch - ctx.camera.pitch) * 0.14;

  const morph = ctx.morph ?? 0;
  const wtPos = liveWtPos();
  /* z = 0 is front (newest / now), z = 1 is back (oldest) */
  const playheadZ = 1 - wtPos;
  const breathPhase = morph * BREATH_RATE;

  g.clearRect(0, 0, w, h);
  g.fillStyle = P.bg;
  g.fillRect(0, 0, w, h);

  /* Atmospheric radial stage glow */
  const glow = g.createRadialGradient(
    w * 0.52,
    h * 0.48,
    12,
    w * 0.5,
    h * 0.5,
    Math.max(w, h) * 0.58
  );
  glow.addColorStop(0, rgba(frontColor, 0.085));
  glow.addColorStop(0.55, rgba(P.stageGlow, 0.35));
  glow.addColorStop(1, rgba(P.bg, 0));
  g.fillStyle = glow;
  g.fillRect(0, 0, w, h);

  const spread = 0.6 + sp.depth * 0.55;
  const proj = makeProjector(w, h, ctx.camera.yaw, ctx.camera.pitch, {
    xStretch: 1.24,
    zStretch: 0.92 * spread,
    yStretch: 0.42,
    fill: 0.45,
    centerYOffset: 0.02,
  });

  drawWireCage(g, proj, P, frontColor, 1);

  /* Highlight hovered or focused slot along the 3D playhead slice with a pulsing yellow dot */
  let focusK = -1;
  if (ctx.focusCommit && ctx.window) {
    const ft = model.commitTimeBySha?.get(ctx.focusCommit.sha) ?? Date.parse(ctx.focusCommit.time);
    if (ft >= ctx.window.startMs && ft <= ctx.window.endMs) {
      focusK = slotIndexForTime(ctx.window, ft);
    }
  }
  const markerSlot = ctx.hoverSlot >= 0 ? ctx.hoverSlot : focusK;
  let markerLabel = "";
  if (ctx.hoverSlot >= 0 && ctx.slots[ctx.hoverSlot]) {
    markerLabel = dateShort(ctx.slots[ctx.hoverSlot].startMs);
  } else if (focusK >= 0 && ctx.focusCommit) {
    const ft = model.commitTimeBySha?.get(ctx.focusCommit.sha) ?? Date.parse(ctx.focusCommit.time);
    markerLabel = `${dateShort(ft)} · ${shortSha(ctx.focusCommit.sha, 6)}`;
  }
  const markerPulse = 0.5 + 0.5 * Math.sin(morph * 4.4);

  paintWavetable3D(g, table, proj, P, {
    frontColor,
    backColor: P.depth,
    playheadColor: P.open,
    playheadPos: playheadZ,
    showPlayhead: true,
    breathPhase,
    breathAmp: 0.016,
    mode: "stage",
    markerSlot,
    markerLabel,
    markerPulse,
    markerOwned: true,
  });

  /* Compute exact live Git totals for the current read-head window */
  let winCommits = 0;
  let winChurn = 0;
  for (const s of ctx.slots) {
    winCommits += s.count;
    winChurn += s.churn;
  }

  ctx.activeWtPos = wtPos;
  ctx.activeSliceCount = winCommits;
  ctx.activeSliceChurn = winChurn;
  ctx.activeSliceDate = dateFull(liveReadHeadMs());

  /* Truthful corner telemetry coupled to the read head */
  g.save();
  g.font = `10px ${MONO}`;
  g.textAlign = "right";
  g.textBaseline = "top";
  g.fillStyle = rgba(P.open, 0.92);
  const scanTag = view.motion.playing ? " · LFO" : "";
  g.fillText(
    `WT POS ${Math.round(wtPos * 100)}% · ${ctx.activeSliceDate} UTC${scanTag}`,
    w - 18,
    14
  );
  g.fillStyle = rgba(P.dim, 0.9);
  g.fillText(
    `${winCommits} commits · ${formatChurn(winChurn)} churn · ${view.span} window`,
    w - 18,
    29
  );
  g.restore();

  /* Search scan sweep pulse */
  if (ctx.depthScan >= 0) {
    const progress = Math.min(1, (performance.now() - ctx.depthScan) / 700);
    if (progress < 1) {
      const zc = -1 + progress * 2;
      const p0 = proj(-1, 0, zc);
      const p1 = proj(1, 0, zc);
      g.save();
      g.strokeStyle = rgba(P.agent, 0.55 * (1 - progress));
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(p0.x, p0.y);
      g.lineTo(p1.x, p1.y);
      g.stroke();
      g.restore();
    }
  }

  /* Empty state message */
  if (table.empty) {
    g.save();
    g.font = "11px ui-sans-serif, system-ui, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = P.dimmer;
    g.fillText(
      ctx.search.query ? "no matching commits — zero plane" : "no commits in this window",
      w / 2,
      h / 2
    );
    g.restore();
  }

  /* Redraw paired 2D commit scope only when its data, hover, focus, or size actually changed */
  drawActiveScope(forceScope);
}

let lastScopeSig = "";

let scopePointerActive = false;

function updateScopeTooltip(k, canvasW) {
  const tip = document.getElementById("scopeTooltip");
  if (!tip) return;
  if (!scopePointerActive || k < 0 || k >= ctx.slots.length || !ctx.window) {
    tip.hidden = true;
    return;
  }
  const slot = ctx.slots[k];
  const dateEl = document.getElementById("scopeTipDate");
  const statsEl = document.getElementById("scopeTipStats");
  const shaEl = document.getElementById("scopeTipSha");
  const authorEl = document.getElementById("scopeTipAuthor");
  const subjectEl = document.getElementById("scopeTipSubject");
  if (!dateEl || !statsEl || !shaEl || !authorEl || !subjectEl) return;

  dateEl.textContent = `${dateMedium(slot.startMs)} – ${dateMedium(slot.endMs)}`;
  if (slot.count === 0) {
    statsEl.textContent = "quiet slot";
    shaEl.textContent = "—";
    authorEl.textContent = "";
    subjectEl.textContent = "no matching commits in this slice";
  } else {
    const c = slot.newest;
    let ins = 0;
    let del = 0;
    for (const item of slot.commits) {
      ins += item.insertions;
      del += item.deletions;
    }
    statsEl.textContent = `${slot.count} commit${slot.count === 1 ? "" : "s"} · +${ins} −${del}`;
    shaEl.textContent = c ? shortSha(c.sha, 7) : "—";
    authorEl.textContent = c
      ? `${c.author.name}${c.author.kind === "agent" ? " ◈" : ""}${
          slot.count > 1 ? ` (+${slot.count - 1} more)` : ""
        }`
      : "";
    subjectEl.textContent = c ? c.subject : "";
  }

  const geom = slotGeometry(canvasW, SLOT_COUNT);
  const sx = slotX(k, geom);
  const preferLeft = sx > canvasW * 0.62;
  tip.hidden = false;
  tip.style.left = preferLeft ? "" : `${Math.min(canvasW - 240, Math.max(12, sx + 12))}px`;
  tip.style.right = preferLeft ? `${Math.min(canvasW - 240, Math.max(12, canvasW - sx + 12))}px` : "";
}

/**
 * Interactive 2D Active Slice Commit Scope (Stage mode).
 * Drawn directly beneath the Hero 3D stage and aligned 1:1 with the 32-slot
 * overview strip below it. Renders the real monotone commit-churn curve at
 * the active WT POS timestamp with clickable commit peaks, agent halos,
 * merge diamonds, open PR rings and hover inspection tooltips.
 */
export function drawActiveScope(force = false) {
  const canvas = document.getElementById("scope2d");
  if (!canvas || !ctx.palette || !ctx.metric || !ctx.window || !ctx.view) return;
  if (ctx.diffOpen || ctx.browserOpen || !ctx.view.depth || ctx.view.rack) return;
  const pct = Math.round(liveWtPos() * 100);
  const scopeSig = [
    canvasSizeEpoch,
    ctx.doc?.repo.id ?? "",
    ctx.view.theme,
    ctx.view.query,
    ctx.window.startMs,
    ctx.window.endMs,
    ctx.metric.color,
    ctx.hoverSlot,
    ctx.focusCommit?.sha ?? "",
    pct,
    ctx.activeSliceCount,
    ctx.activeSliceChurn,
  ].join("|");
  if (!force && scopeSig === lastScopeSig) return;
  lastScopeSig = scopeSig;

  const { g, width: w, height: h } = fit(canvas);
  if (w < 8 || h < 8) return;
  const P = ctx.palette;
  const slots = ctx.slots;
  if (!slots || slots.length !== SLOT_COUNT) return;

  const accent = ctx.metric.color;
  const geom = slotGeometry(w, SLOT_COUNT);
  const topPad = 24;
  const botPad = 14;
  const plotH = Math.max(24, h - topPad - botPad);
  /* Baseline sits at 74% height so true peaks rise cleanly upward and a subtle 26% phosphor echo mirrors underneath */
  const baseY = topPad + plotH * 0.74;
  const upAmp = plotH * 0.7;
  const downAmp = plotH * 0.22;

  const xs = new Array(SLOT_COUNT);
  const ys = new Array(SLOT_COUNT);
  const mirrorYs = new Array(SLOT_COUNT);
  for (let k = 0; k < SLOT_COUNT; k++) {
    const norm = slots[k].level / 15;
    xs[k] = slotX(k, geom);
    ys[k] = baseY - norm * upAmp;
    mirrorYs[k] = baseY + norm * downAmp;
  }
  const spline = buildSpline(xs, ys);
  const mirrorSpline = buildSpline(xs, mirrorYs);

  g.clearRect(0, 0, w, h);
  g.fillStyle = P.bg;
  g.fillRect(0, 0, w, h);

  /* Delicate oscilloscope graticule aligned to 4-slot intervals */
  g.save();
  g.strokeStyle = rgba(P.lineSoft, 0.9);
  g.lineWidth = 1;
  for (let k = 4; k < SLOT_COUNT; k += 4) {
    const gx = xs[k];
    g.beginPath();
    g.moveTo(gx, topPad - 4);
    g.lineTo(gx, h - botPad + 4);
    g.stroke();
  }
  /* Subtle upper half-scale guide + solid zero rail */
  g.strokeStyle = rgba(P.lineSoft, 0.6);
  g.setLineDash([2, 4]);
  g.beginPath();
  g.moveTo(geom.pad, baseY - upAmp * 0.5);
  g.lineTo(w - geom.pad, baseY - upAmp * 0.5);
  g.stroke();
  g.setLineDash([]);

  g.strokeStyle = rgba(P.lineHi, 0.72);
  g.beginPath();
  g.moveTo(geom.pad, baseY);
  g.lineTo(w - geom.pad, baseY);
  g.stroke();
  g.restore();

  /* Sample smooth monotone spline across plot width */
  if (spline && mirrorSpline) {
    const x0 = xs[0];
    const x1 = xs[SLOT_COUNT - 1];
    const steps = Math.max(96, Math.min(240, Math.round((x1 - x0) / 3)));

    /* Translucent upper fill */
    const upGrad = g.createLinearGradient(0, baseY - upAmp, 0, baseY);
    upGrad.addColorStop(0, rgba(accent, 0.28));
    upGrad.addColorStop(1, rgba(accent, 0.03));

    g.save();
    g.beginPath();
    g.moveTo(x0, baseY);
    for (let i = 0; i <= steps; i++) {
      const px = x0 + ((x1 - x0) * i) / steps;
      g.lineTo(px, evalSpline(spline, px));
    }
    g.lineTo(x1, baseY);
    g.closePath();
    g.fillStyle = upGrad;
    g.fill();

    /* Subtle mirrored phosphor reflection below zero rail */
    const downGrad = g.createLinearGradient(0, baseY, 0, baseY + downAmp);
    downGrad.addColorStop(0, rgba(accent, 0.14));
    downGrad.addColorStop(1, rgba(accent, 0.01));
    g.beginPath();
    g.moveTo(x0, baseY);
    for (let i = 0; i <= steps; i++) {
      const px = x0 + ((x1 - x0) * i) / steps;
      g.lineTo(px, evalSpline(mirrorSpline, px));
    }
    g.lineTo(x1, baseY);
    g.closePath();
    g.fillStyle = downGrad;
    g.fill();

    /* Faint mirrored trace */
    g.strokeStyle = rgba(accent, 0.26);
    g.lineWidth = 1;
    g.beginPath();
    for (let i = 0; i <= steps; i++) {
      const px = x0 + ((x1 - x0) * i) / steps;
      const py = evalSpline(mirrorSpline, px);
      if (i === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    }
    g.stroke();

    /* Outer phosphor glow on real commit curve */
    g.lineJoin = "round";
    g.lineCap = "round";
    g.globalCompositeOperation = "lighter";
    g.strokeStyle = rgba(accent, 0.28);
    g.lineWidth = 6.5;
    g.beginPath();
    for (let i = 0; i <= steps; i++) {
      const px = x0 + ((x1 - x0) * i) / steps;
      const py = evalSpline(spline, px);
      if (i === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    }
    g.stroke();

    /* Primary truthful monotone curve */
    g.globalCompositeOperation = "source-over";
    g.strokeStyle = mixHex(accent, P.handle, 0.22);
    g.lineWidth = 1.9;
    g.beginPath();
    for (let i = 0; i <= steps; i++) {
      const px = x0 + ((x1 - x0) * i) / steps;
      const py = evalSpline(spline, px);
      if (i === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    }
    g.stroke();

    /* Bright core filament */
    g.strokeStyle = rgba(P.handle, 0.65);
    g.lineWidth = 0.7;
    g.stroke();
    g.restore();
  }

  /* Merge diamonds along active curve */
  if (ctx.model) {
    const merges = mergeMarkers(ctx.model, ctx.window.startMs, ctx.window.endMs);
    if (merges.length) {
      g.save();
      g.strokeStyle = P.okHi;
      g.fillStyle = rgba(P.okHi, 0.22);
      g.lineWidth = 1.2;
      for (const m of merges) {
        const mk = slotIndexForTime(ctx.window, Date.parse(m.commit.time));
        const mx = xs[mk];
        const my = ys[mk];
        const r = 4.2;
        g.beginPath();
        g.moveTo(mx, my - r);
        g.lineTo(mx + r, my);
        g.lineTo(mx, my + r);
        g.lineTo(mx - r, my);
        g.closePath();
        g.fill();
        g.stroke();
      }
      g.restore();
    }
  }

  /* Open PR tip markers in the active window */
  if (ctx.model && ctx.prs?.length) {
    g.save();
    for (const pr of ctx.prs) {
      const tipMs = refTipTime(ctx.model, pr.ref);
      if (tipMs < ctx.window.startMs || tipMs > ctx.window.endMs) continue;
      const pk = slotIndexForTime(ctx.window, tipMs);
      const px = xs[pk];
      const py = ys[pk];
      const col = pr.stale ? P.risk : P.open;
      g.strokeStyle = col;
      g.lineWidth = 1.4;
      g.beginPath();
      g.arc(px, py, 6.2, 0, Math.PI * 2);
      g.stroke();
    }
    g.restore();
  }

  /* Focused slot index */
  const focusK =
    ctx.focusCommit &&
    Date.parse(ctx.focusCommit.time) >= ctx.window.startMs &&
    Date.parse(ctx.focusCommit.time) <= ctx.window.endMs
      ? slotIndexForTime(ctx.window, Date.parse(ctx.focusCommit.time))
      : -1;

  /* Interactive commit peak nodes on every non-empty slot */
  g.save();
  for (let k = 0; k < SLOT_COUNT; k++) {
    const slot = slots[k];
    if (slot.count === 0) continue;
    const px = xs[k];
    const py = ys[k];
    const r = Math.min(4.6, 2.4 + Math.log2(1 + slot.count) * 0.9);

    if (slot.agentCount > 0) {
      g.strokeStyle = rgba(P.agent, 0.85);
      g.lineWidth = 1.4;
      g.beginPath();
      g.arc(px, py, r + 2.6, 0, Math.PI * 2);
      g.stroke();
    }

    g.fillStyle = k === focusK ? P.handle : mixHex(accent, P.handle, 0.35);
    g.beginPath();
    g.arc(px, py, r, 0, Math.PI * 2);
    g.fill();
  }

  /* Focused slot reticle */
  if (focusK >= 0 && slots[focusK].count > 0) {
    const fx = xs[focusK];
    const fy = ys[focusK];
    g.strokeStyle = rgba(P.handle, 0.35);
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(fx, topPad);
    g.lineTo(fx, h - botPad);
    g.stroke();

    g.strokeStyle = P.handle;
    g.lineWidth = 1.6;
    g.beginPath();
    g.arc(fx, fy, 7.2, 0, Math.PI * 2);
    g.stroke();
  }

  /* Hovered slot crosshair & highlight ring */
  const hk = ctx.hoverSlot;
  if (hk >= 0 && hk < SLOT_COUNT) {
    const hx = xs[hk];
    const hy = ys[hk];
    g.fillStyle = rgba(P.open, 0.06);
    g.fillRect(hx - geom.cell * 0.5, topPad - 2, geom.cell, plotH + 4);

    g.strokeStyle = rgba(P.open, 0.72);
    g.lineWidth = 1;
    g.setLineDash([2, 2]);
    g.beginPath();
    g.moveTo(hx, topPad - 2);
    g.lineTo(hx, h - botPad + 2);
    g.stroke();
    g.setLineDash([]);

    g.strokeStyle = P.open;
    g.lineWidth = 1.8;
    g.beginPath();
    g.arc(hx, hy, slots[hk].count > 0 ? 8.2 : 4.5, 0, Math.PI * 2);
    g.stroke();
  }
  g.restore();

  /* Top corner scope telemetry */
  g.save();
  g.font = `9.5px ${MONO}`;
  g.textAlign = "left";
  g.textBaseline = "top";
  g.fillStyle = rgba(P.dim, 0.92);
  g.fillText(
    `2D COMMIT SCOPE · ${ctx.metric.label.toUpperCase()} · ${dateShort(ctx.window.startMs)} – ${dateShort(ctx.window.endMs)} UTC`,
    geom.pad,
    6
  );
  g.textAlign = "right";
  g.fillStyle = rgba(P.open, 0.92);
  g.fillText(
    `WT POS ${Math.round(liveWtPos() * 100)}% · ${ctx.activeSliceCount} COMMITS · ${formatChurn(ctx.activeSliceChurn)} CHURN`,
    w - geom.pad,
    6
  );
  g.restore();

  if (scopePointerActive) {
    updateScopeTooltip(ctx.hoverSlot, w);
  }
}

/** Wire interactive hover tooltips and click/scrub commit inspection on the 2D scope. */
export function initScope2d() {
  const canvas = document.getElementById("scope2d");
  if (!canvas) return;
  let scrubbing = false;

  const slotAtEvent = (event) => {
    const rect = canvas.getBoundingClientRect();
    const geom = slotGeometry(rect.width, SLOT_COUNT);
    const x = event.clientX - rect.left;
    return { k: slotAtX(x, geom), width: rect.width };
  };

  const inspectSlot = (k) => {
    if (!ctx.view || k < 0 || k >= ctx.slots.length) return;
    const slot = ctx.slots[k];
    if (!slot || !slot.newest) return;
    if (ctx.view.focusSha !== slot.newest.sha) {
      setView(focusSlot(ctx.view, slot));
    }
  };

  const syncStripHover = (k) => {
    const cells = document.querySelectorAll("#slots .slot.is-hover");
    for (const c of cells) c.classList.remove("is-hover");
    if (k >= 0) {
      const match = document.querySelector(`#slots .slot[data-k="${k}"]`);
      if (match) match.classList.add("is-hover");
    }
  };

  canvas.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    scrubbing = true;
    scopePointerActive = true;
    const { k, width } = slotAtEvent(event);
    ctx.hoverSlot = k;
    syncStripHover(k);
    inspectSlot(k);
    drawDepth();
    updateScopeTooltip(k, width);
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      /* non-fatal */
    }
  });

  canvas.addEventListener("pointermove", (event) => {
    scopePointerActive = true;
    const { k, width } = slotAtEvent(event);
    if (scrubbing) inspectSlot(k);
    if (k !== ctx.hoverSlot) {
      ctx.hoverSlot = k;
      syncStripHover(k);
      drawDepth();
    }
    updateScopeTooltip(k, width);
  });

  const endScrub = () => {
    scrubbing = false;
  };
  canvas.addEventListener("pointerup", endScrub);
  canvas.addEventListener("pointercancel", endScrub);

  canvas.addEventListener("pointerleave", () => {
    scrubbing = false;
    scopePointerActive = false;
    const tip = document.getElementById("scopeTooltip");
    if (tip) tip.hidden = true;
    syncStripHover(-1);
    if (ctx.hoverSlot !== -1) {
      ctx.hoverSlot = -1;
      drawDepth();
    }
  });

  canvas.addEventListener("dblclick", (event) => {
    const { k } = slotAtEvent(event);
    const slot = ctx.slots[k];
    if (!slot || slot.count === 0) return;
    openDiffView(slot);
  });
}

/**
 * Render an oscillator card (Serum-style Rack) OR a Kilohearts floating 3D browser thumbnail.
 */
export function drawModuleSurface(canvas, module, index = 0, opts = {}) {
  if (!canvas || !ctx.view || !ctx.model || !ctx.palette || !ctx.window) return 0;
  const { g, width: w, height: h } = fit(canvas);
  const P = ctx.palette;
  const model = ctx.model;
  const mode = opts.mode ?? "rack"; // 'rack' | 'browser'
  const isBrowser = mode === "browser";

  const search = searchCommits(model, module.query);
  const shas = search.shas;
  const ceiling = getCachedCeiling(model, ctx.view.span, module.query, shas);
  const frontColor =
    opts.color ??
    (isBrowser ? P.ok : P.identity[module.colorKey] ?? P.ok);

  const osc = getOscParams(module.query);
  const smooth = opts.smooth ?? osc.smooth;
  const depthSpread = opts.depth ?? osc.depth;
  const sliceCount = isBrowser ? 36 : 44;
  const sampleCount = isBrowser ? 72 : 88;

  const table = getCachedTable(
    model,
    ctx.view,
    shas,
    ceiling,
    sliceCount,
    sampleCount,
    smooth,
    module.query || module.name,
    true
  );

  const morph = ctx.morph ?? 0;
  const phase = (index % 8) * 0.42;
  const hovered = isBrowser && ctx.browserHoverQuery === module.query;
  const speedMul = hovered ? 2.4 : 1;
  const wtPos = isBrowser
    ? (((morph * SWEEP_RATE * speedMul + phase * 0.35) % 1) + 1) % 1
    : clamp(opts.wtPos ?? liveWtPos(), 0, 1);
  const playheadZ = 1 - wtPos;

  g.clearRect(0, 0, w, h);

  if (!isBrowser) {
    /* Recessed dark instrument bay background */
    g.fillStyle = P.bg;
    g.fillRect(0, 0, w, h);
    const glow = g.createRadialGradient(
      w * 0.52,
      h * 0.48,
      6,
      w * 0.5,
      h * 0.5,
      Math.max(w, h) * 0.65
    );
    glow.addColorStop(0, rgba(frontColor, 0.095));
    glow.addColorStop(1, rgba(P.bg, 0));
    g.fillStyle = glow;
    g.fillRect(0, 0, w, h);
  } else if (hovered) {
    /* Subtle luminous halo on hover in Kilohearts browser */
    const halo = g.createRadialGradient(w * 0.5, h * 0.52, 4, w * 0.5, h * 0.52, w * 0.48);
    halo.addColorStop(0, rgba(frontColor, 0.14));
    halo.addColorStop(1, rgba(P.bg, 0));
    g.fillStyle = halo;
    g.fillRect(0, 0, w, h);
  }

  const yaw = isBrowser ? 0.4 : 0.44;
  const pitch = isBrowser ? 0.56 : 0.46 + depthSpread * 0.24;
  const proj = makeProjector(w, h, yaw, pitch, {
    xStretch: isBrowser ? 1.15 : 1.08,
    zStretch: isBrowser ? 0.85 : 0.62 + depthSpread * 0.46,
    yStretch: isBrowser ? 0.36 : 0.4,
    fill: isBrowser ? 0.46 : 0.44,
    centerYOffset: isBrowser ? 0.04 : 0.02,
  });

  if (!isBrowser) {
    drawWireCage(g, proj, P, frontColor, 0.8);
  }

  /* Compute pulsing yellow selection dot position for Rack oscillators */
  let markerSlot = -1;
  let markerLabel = "";
  let markerOwned = true;
  if (!isBrowser && ctx.window) {
    const oscEndMs = ctx.rackSync
      ? ctx.window.endMs
      : endMsAtWtPos(model, ctx.view.span, wtPos);
    const oscWin = windowFor(model, isoOf(oscEndMs), ctx.view.span);
    if (ctx.hoverSlot >= 0 && ctx.rackSync && ctx.slots[ctx.hoverSlot]) {
      const hSlot = ctx.slots[ctx.hoverSlot];
      markerSlot = ctx.hoverSlot;
      markerLabel = dateShort(hSlot.startMs);
      markerOwned =
        ctx.view.query === module.query ||
        hSlot.commits.some((c) => !shas || shas.has(c.sha));
    } else if (ctx.focusCommit) {
      const ft = Date.parse(ctx.focusCommit.time);
      if (ft >= oscWin.startMs && ft <= oscWin.endMs) {
        markerSlot = slotIndexForTime(oscWin, ft);
        markerLabel = dateShort(ft);
        markerOwned = !shas || shas.has(ctx.focusCommit.sha);
      }
    }
  }
  const markerPulse = 0.5 + 0.5 * Math.sin(morph * 4.4);

  paintWavetable3D(g, table, proj, P, {
    frontColor,
    backColor: P.depth,
    playheadColor: P.open,
    playheadPos: playheadZ,
    showPlayhead: !isBrowser || hovered,
    breathPhase: morph * BREATH_RATE + phase,
    breathAmp: hovered ? 0.032 : 0.014,
    mode,
    markerSlot,
    markerLabel,
    markerOwned,
    markerPulse,
  });

  if (!isBrowser && opts.onPosUpdate) {
    opts.onPosUpdate(wtPos);
  }

  return search.query ? search.count : model.doc.commits.length;
}

/** Enable silky interactive 3D orbit (drag to rotate, double-click to reset) on the Hero Stage. */
export function initDepthOrbit() {
  const canvas = document.getElementById("wave");
  if (!canvas) return;
  let drag = null;

  canvas.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    if (!ctx.view?.depth || ctx.view.rack || ctx.browserOpen) return;
    drag = {
      x: event.clientX,
      y: event.clientY,
      yaw: ctx.camera.targetYaw,
      pitch: ctx.camera.targetPitch,
      moved: false,
    };
    canvas.classList.add("is-orbiting");
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      /* non-fatal */
    }
  });

  canvas.addEventListener("pointermove", (event) => {
    if (!drag) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (Math.hypot(dx, dy) > 3) drag.moved = true;
    ctx.camera.targetYaw = clamp(drag.yaw + dx * 0.0065, -0.85, 0.95);
    ctx.camera.targetPitch = clamp(drag.pitch + dy * 0.0055, 0.18, 1.15);
    if (ctx.reducedMotion) {
      ctx.camera.yaw = ctx.camera.targetYaw;
      ctx.camera.pitch = ctx.camera.targetPitch;
      drawDepth();
    }
  });

  const endOrbit = () => {
    if (!drag) return;
    drag = null;
    canvas.classList.remove("is-orbiting");
  };
  canvas.addEventListener("pointerup", endOrbit);
  canvas.addEventListener("pointercancel", endOrbit);

  canvas.addEventListener("dblclick", () => {
    if (!ctx.view?.depth || ctx.view.rack || ctx.browserOpen) return;
    ctx.camera.targetYaw = 0.44;
    ctx.camera.targetPitch = 0.56;
    if (ctx.reducedMotion) {
      ctx.camera.yaw = 0.44;
      ctx.camera.pitch = 0.56;
      drawDepth();
    }
  });
}

/** Start the travelling highlight; the ambient frame draws it. */
export function startDepthScan() {
  if (ctx.reducedMotion) return;
  ctx.depthScan = performance.now();
}
