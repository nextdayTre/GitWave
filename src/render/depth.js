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

import { ctx, getOscParams } from "../app.ts";
import { clamp, dateShort, effectiveCeiling, isoOf } from "../core/samples.ts";
import { searchCommits } from "../core/search.ts";
import { mixHex, rgba } from "../core/theme.ts";
import { buildWavetable, sampleWavetableSlice } from "../core/wavetable.ts";

const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
const SWEEP_RATE = 0.085;
const BREATH_RATE = 1.15;

/* Lightweight LRU cache for synthesized wavetables so 60fps rendering stays light */
const tableCache = new Map();
const MAX_CACHE = 48;

function getCachedTable(model, view, shas, ceiling, sliceCount, sampleCount, smooth, seed) {
  const key = [
    model.doc.repo.id,
    view.end,
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
  });
  if (tableCache.size >= MAX_CACHE) {
    const oldest = tableCache.keys().next().value;
    tableCache.delete(oldest);
  }
  tableCache.set(key, table);
  return table;
}

function fit(canvas) {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }
  const g = canvas.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { g, width, height };
}

function smoothView(view) {
  if (!view?.motion.playing || !ctx.window || !ctx.model) return view;
  const end = Math.min(
    ctx.model.snapshotMs,
    ctx.window.endMs + Math.max(0, Math.min(1, ctx.depthPhase)) * ctx.window.slotMs
  );
  return { ...view, end: isoOf(end) };
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

  return function project(x, y, z) {
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
  };
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
 * Renders back-to-front translucent silk ribbons, slope-lit surface quads,
 * subtle additive luminous mist, bright leading rim, and the active playhead slice.
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
  const crestLight = mixHex(frontColor, P.handle, 0.32);
  const playCore = mixHex(playheadColor, P.handle, 0.58);

  /* Pre-project every slice (curve points + zero-plane anchor points) */
  const projected = new Array(D);
  const zeroPlane = new Array(D);
  const breathScale = 1 + 0.035 * Math.sin(breathPhase);

  for (let i = 0; i < D; i++) {
    const zNorm = D > 1 ? i / (D - 1) : 0;
    const zCoord = -1 + zNorm * 2;
    const frame = table.frames[i];
    const pts = new Array(S);
    const base = new Array(S);

    for (let s = 0; s < S; s++) {
      const u = s / Math.max(1, S - 1);
      const xCoord = -1 + u * 2;
      let yVal = frame[s] * breathScale;
      if (!table.empty && breathAmp > 0) {
        const win = Math.sin(Math.PI * u);
        yVal += Math.sin(u * Math.PI * 4 + breathPhase + zNorm * 2.4) * breathAmp * win;
      }
      pts[s] = proj(xCoord, yVal, zCoord);
      base[s] = proj(xCoord, 0, zCoord);
    }
    projected[i] = pts;
    zeroPlane[i] = base;
  }

  /* Project active playhead slice at exact continuous depth playheadPos in [0, 1] */
  const activeZ = clamp(playheadPos, 0, 1);
  const activeSliceValues = sampleWavetableSlice(table, activeZ, breathPhase, breathAmp);
  const activeZCoord = -1 + activeZ * 2;
  const activePts = new Array(S);
  const activeBase = new Array(S);
  for (let s = 0; s < S; s++) {
    const u = s / Math.max(1, S - 1);
    const xCoord = -1 + u * 2;
    activePts[s] = proj(xCoord, activeSliceValues[s], activeZCoord);
    activeBase[s] = proj(xCoord, 0, activeZCoord);
  }
  const playheadInsertIdx = Math.round(activeZ * (D - 1));

  const drawPlayheadSlice = () => {
    if (!showPlayhead) return;
    /* Translucent golden curtain between playhead curve and zero-plane */
    g.save();
    g.beginPath();
    for (let s = 0; s < S; s++) {
      if (s === 0) g.moveTo(activePts[s].x, activePts[s].y);
      else g.lineTo(activePts[s].x, activePts[s].y);
    }
    for (let s = S - 1; s >= 0; s--) {
      g.lineTo(activeBase[s].x, activeBase[s].y);
    }
    g.closePath();
    g.fillStyle = rgba(playheadColor, isStage ? 0.16 : 0.14);
    g.fill();

    /* Subtle zero-rail highlight underneath the active slice */
    g.strokeStyle = rgba(playheadColor, 0.35);
    g.lineWidth = 0.85;
    g.beginPath();
    g.moveTo(activeBase[0].x, activeBase[0].y);
    g.lineTo(activeBase[S - 1].x, activeBase[S - 1].y);
    g.stroke();

    /* Outer phosphor bloom */
    g.lineJoin = "round";
    g.lineCap = "round";
    g.globalCompositeOperation = "lighter";
    g.strokeStyle = rgba(playheadColor, isStage ? 0.28 : 0.24);
    g.lineWidth = isStage ? 8.5 : 5.5;
    g.beginPath();
    for (let s = 0; s < S; s++) {
      if (s === 0) g.moveTo(activePts[s].x, activePts[s].y);
      else g.lineTo(activePts[s].x, activePts[s].y);
    }
    g.stroke();

    /* Main crisp golden/amber trace */
    g.globalCompositeOperation = "source-over";
    g.strokeStyle = playheadColor;
    g.lineWidth = isStage ? 2.2 : 1.75;
    g.beginPath();
    for (let s = 0; s < S; s++) {
      if (s === 0) g.moveTo(activePts[s].x, activePts[s].y);
      else g.lineTo(activePts[s].x, activePts[s].y);
    }
    g.stroke();

    /* Hot white-gold filament core */
    g.strokeStyle = rgba(playCore, 0.88);
    g.lineWidth = isStage ? 0.9 : 0.7;
    g.beginPath();
    for (let s = 0; s < S; s++) {
      if (s === 0) g.moveTo(activePts[s].x, activePts[s].y);
      else g.lineTo(activePts[s].x, activePts[s].y);
    }
    g.stroke();
    g.restore();
  };

  g.save();
  g.lineJoin = "round";
  g.lineCap = "round";

  /* Painter's algorithm: back (D-1) to front (0) */
  let playheadDrawn = false;
  const quadStep = isBrowser ? 2 : 1;

  for (let i = D - 1; i >= 0; i--) {
    const zNorm = D > 1 ? i / (D - 1) : 0;
    const foreWeight = 1 - zNorm;
    const sliceColor = mixHex(frontColor, backColor, Math.pow(zNorm, 0.85));
    const pts = projected[i];
    const base = zeroPlane[i];

    /* 1. Sculpted translucent surface sheet between slice i and i-1 */
    if (i > 0 && !table.empty) {
      const nextPts = projected[i - 1];
      const frameA = table.frames[i];
      const frameB = table.frames[i - 1];
      const stripAlphaBase = isBrowser
        ? 0.045 + 0.095 * foreWeight
        : isStage
          ? 0.055 + 0.115 * foreWeight
          : 0.065 + 0.125 * foreWeight;

      for (let s = 0; s < S - quadStep; s += quadStep) {
        const s2 = Math.min(S - 1, s + quadStep);
        const hAvg = (frameA[s] + frameA[s2] + frameB[s] + frameB[s2]) * 0.25;
        const slope = (frameB[s] - frameA[s]) * 1.4 + (frameB[s2] - frameB[s]) * 0.8;
        const shade = clamp(0.45 + hAvg * 0.45 + slope * 0.35, 0, 1);
        const fillCol = mixHex(sliceColor, crestLight, shade * 0.55);
        const qAlpha = stripAlphaBase * (0.55 + 0.65 * Math.abs(hAvg));

        g.fillStyle = rgba(fillCol, qAlpha);
        g.beginPath();
        g.moveTo(pts[s].x, pts[s].y);
        g.lineTo(pts[s2].x, pts[s2].y);
        g.lineTo(nextPts[s2].x, nextPts[s2].y);
        g.lineTo(nextPts[s].x, nextPts[s].y);
        g.closePath();
        g.fill();
      }
    }

    /* 2. Soft translucent vertical ribbon curtain (creates Warpenter volumetric mist) */
    if (!table.empty) {
      g.beginPath();
      for (let s = 0; s < S; s++) {
        if (s === 0) g.moveTo(pts[s].x, pts[s].y);
        else g.lineTo(pts[s].x, pts[s].y);
      }
      for (let s = S - 1; s >= 0; s--) {
        g.lineTo(base[s].x, base[s].y);
      }
      g.closePath();
      const curtainAlpha = isBrowser
        ? 0.018 + 0.042 * foreWeight
        : 0.02 + 0.048 * foreWeight;
      g.fillStyle = rgba(sliceColor, curtainAlpha);
      g.fill();
    }

    /* 3. Crisp translucent wave ridge line */
    const strokeAlpha =
      i === 0
        ? 0.94
        : (isBrowser ? 0.1 : 0.08) + (isBrowser ? 0.44 : 0.38) * Math.pow(foreWeight, 1.35);
    g.strokeStyle =
      i === 0 ? rimHighlight : rgba(mixHex(sliceColor, rimHighlight, foreWeight * 0.35), strokeAlpha);
    g.lineWidth = i === 0 ? (isStage ? 1.8 : 1.4) : isStage ? 0.8 : 0.65;
    g.beginPath();
    for (let s = 0; s < S; s++) {
      if (s === 0) g.moveTo(pts[s].x, pts[s].y);
      else g.lineTo(pts[s].x, pts[s].y);
    }
    g.stroke();

    /* 4. Ethereal additive glow sheen on every few ridges (Kilohearts/Warpenter luminosity) */
    if (!table.empty && (i === 0 || i % 3 === 0)) {
      g.save();
      g.globalCompositeOperation = "lighter";
      g.strokeStyle = rgba(i === 0 ? rimHighlight : frontColor, i === 0 ? 0.24 : 0.055 + 0.065 * foreWeight);
      g.lineWidth = i === 0 ? (isStage ? 5.5 : 3.8) : isStage ? 2.2 : 1.6;
      g.beginPath();
      for (let s = 0; s < S; s++) {
        if (s === 0) g.moveTo(pts[s].x, pts[s].y);
        else g.lineTo(pts[s].x, pts[s].y);
      }
      g.stroke();
      g.restore();
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
  return { activeSliceValues, activeZ };
}

/**
 * Hero Stage 3D renderer (Warpenter-inspired full volumetric wavetable + orbit).
 */
export function drawDepth() {
  const canvas = document.getElementById("wave");
  if (!canvas || !ctx.view || !ctx.model || !ctx.palette || !ctx.window || !ctx.metric) return;
  const { g, width: w, height: h } = fit(canvas);
  const P = ctx.palette;
  const view = smoothView(ctx.view);
  const model = ctx.model;
  const shas = ctx.search.shas;
  const ceiling = ctx.metric.ceiling;
  const frontColor = ctx.metric.color;
  const sp = ctx.stageParams;

  const table = getCachedTable(
    model,
    view,
    shas,
    ceiling,
    56,
    112,
    sp.smooth,
    ctx.view.query || ctx.metric.label
  );

  /* Smooth damped camera orbit */
  ctx.camera.yaw += (ctx.camera.targetYaw - ctx.camera.yaw) * 0.14;
  ctx.camera.pitch += (ctx.camera.targetPitch - ctx.camera.pitch) * 0.14;

  const morph = ctx.morph ?? 0;
  const playheadPos = sp.pos !== null ? sp.pos : ((morph * SWEEP_RATE) % 1 + 1) % 1;
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

  const res = paintWavetable3D(g, table, proj, P, {
    frontColor,
    backColor: P.depth,
    playheadColor: P.open,
    playheadPos,
    showPlayhead: true,
    breathPhase,
    breathAmp: 0.022,
    mode: "stage",
  });

  /* Publish active slice to ctx so the Paired 2D Scope renders the exact same frame */
  if (res) {
    ctx.activeSliceWave = res.activeSliceValues;
    ctx.activeSliceZ = res.activeZ;
    const metaIdx = Math.min(table.meta.length - 1, Math.round(res.activeZ * (table.meta.length - 1)));
    const m = table.meta[metaIdx];
    ctx.activeSliceCount = m ? m.commitCount : 0;
    ctx.activeSliceDate = m ? dateShort(m.endMs) : "";
  }

  /* Subtle corner telemetry inside the 3D stage */
  g.save();
  g.font = `10px ${MONO}`;
  g.textAlign = "right";
  g.textBaseline = "top";
  g.fillStyle = rgba(P.open, 0.85);
  const sliceNum = Math.round(playheadPos * (table.sliceCount - 1)) + 1;
  g.fillText(
    `FRAME ${String(sliceNum).padStart(2, "0")}/${table.sliceCount} · POS ${Math.round(playheadPos * 100)}%`,
    w - 18,
    14
  );
  if (ctx.activeSliceDate) {
    g.fillStyle = rgba(P.dim, 0.85);
    g.fillText(`${ctx.activeSliceDate} UTC · ${ctx.activeSliceCount} commits`, w - 18, 29);
  }
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

  /* Sync paired 2D oscilloscope immediately */
  drawActiveScope();
}

/**
 * Paired 2D Active Slice Oscilloscope (Warpenter + Ref #3 style).
 * Drawn directly beneath the Hero 3D stage, synced 1:1 to the travelling playhead.
 */
export function drawActiveScope() {
  const canvas = document.getElementById("scope2d");
  if (!canvas || canvas.offsetParent === null || !ctx.palette || !ctx.metric) return;
  const { g, width: w, height: h } = fit(canvas);
  const P = ctx.palette;
  const wave = ctx.activeSliceWave;
  const accent = ctx.metric.color;
  const padX = 20;
  const padY = 16;
  const midY = h * 0.5;
  const amp = (h - padY * 2) * 0.44;
  const plotW = Math.max(10, w - padX * 2);

  g.clearRect(0, 0, w, h);
  g.fillStyle = P.bg;
  g.fillRect(0, 0, w, h);

  /* Delicate oscilloscope graticule */
  g.save();
  g.strokeStyle = rgba(P.lineSoft, 0.9);
  g.lineWidth = 1;
  for (let i = 1; i < 8; i++) {
    const gx = padX + (plotW * i) / 8;
    g.beginPath();
    g.moveTo(gx, padY * 0.6);
    g.lineTo(gx, h - padY * 0.6);
    g.stroke();
  }
  g.strokeStyle = rgba(P.line, 0.85);
  g.beginPath();
  g.moveTo(padX, midY);
  g.lineTo(w - padX, midY);
  g.stroke();
  g.restore();

  if (!wave || wave.length < 2) return;

  /* Soft translucent fill between waveform and zero centerline */
  const grad = g.createLinearGradient(0, padY, 0, h - padY);
  grad.addColorStop(0, rgba(accent, 0.16));
  grad.addColorStop(0.5, rgba(accent, 0.02));
  grad.addColorStop(1, rgba(accent, 0.16));

  g.save();
  g.beginPath();
  for (let s = 0; s < wave.length; s++) {
    const x = padX + (s / (wave.length - 1)) * plotW;
    const y = midY - wave[s] * amp;
    if (s === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.lineTo(padX + plotW, midY);
  g.lineTo(padX, midY);
  g.closePath();
  g.fillStyle = grad;
  g.fill();

  /* Outer phosphor glow */
  g.lineJoin = "round";
  g.lineCap = "round";
  g.globalCompositeOperation = "lighter";
  g.strokeStyle = rgba(accent, 0.25);
  g.lineWidth = 7;
  g.beginPath();
  for (let s = 0; s < wave.length; s++) {
    const x = padX + (s / (wave.length - 1)) * plotW;
    const y = midY - wave[s] * amp;
    if (s === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.stroke();

  /* Crisp primary oscilloscope trace */
  g.globalCompositeOperation = "source-over";
  g.strokeStyle = mixHex(accent, P.handle, 0.22);
  g.lineWidth = 1.8;
  g.beginPath();
  for (let s = 0; s < wave.length; s++) {
    const x = padX + (s / (wave.length - 1)) * plotW;
    const y = midY - wave[s] * amp;
    if (s === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.stroke();

  /* Bright center filament */
  g.strokeStyle = rgba(P.handle, 0.7);
  g.lineWidth = 0.7;
  g.stroke();
  g.restore();

  /* Minimal corner scope labels */
  g.save();
  g.font = `9.5px ${MONO}`;
  g.textAlign = "left";
  g.textBaseline = "top";
  g.fillStyle = rgba(P.dim, 0.9);
  g.fillText(`2D ACTIVE SLICE · ${ctx.metric.label.toUpperCase()}`, padX, 7);
  g.textAlign = "right";
  g.fillStyle = rgba(P.open, 0.9);
  g.fillText(`WT POS ${Math.round(ctx.activeSliceZ * 100)}%`, w - padX, 7);
  g.restore();
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
  const ceiling = effectiveCeiling(model, ctx.window, shas);
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
    smoothView(ctx.view),
    shas,
    ceiling,
    sliceCount,
    sampleCount,
    smooth,
    module.query || module.name
  );

  const morph = ctx.morph ?? 0;
  const phase = (index % 8) * 0.42;
  const hovered = isBrowser && ctx.browserHoverQuery === module.query;
  const speedMul = hovered ? 2.4 : 1;
  const playheadPos =
    !isBrowser && osc.pos !== null
      ? osc.pos
      : (((morph * SWEEP_RATE * speedMul + phase * 0.35) % 1) + 1) % 1;

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

  paintWavetable3D(g, table, proj, P, {
    frontColor,
    backColor: P.depth,
    playheadColor: P.open,
    playheadPos,
    showPlayhead: !isBrowser || hovered,
    breathPhase: morph * BREATH_RATE + phase,
    breathAmp: hovered ? 0.038 : 0.02,
    mode,
  });

  if (!isBrowser && opts.onPosUpdate) {
    opts.onPosUpdate(playheadPos);
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
