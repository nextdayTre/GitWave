/**
 * canvas.js — the wave stage.
 *
 * Draws the 32-slot frame for every visible ref, the release flags, merge
 * diamonds, pull-request tension rings, the read head and the focus lens.
 * Reads the theme tokens that the CSS defines; introduces no colour of its own.
 */

import { ctx, identityOf } from "../app.ts";
import { SLOT_COUNT, dateShort, refTipTime, slotIndexForTime } from "../core/samples.ts";
import { levelY, slotGeometry, slotX } from "../core/geometry.ts";
import { ageNorm, mergeMarkers, refAgeDays, refHasAgent, releaseFlags } from "../core/refs.ts";
import { ageColor, rgba } from "../core/theme.ts";
import { buildSpline, evalSpline } from "../core/spline.ts";

const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

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

function strokeSpline(g, sp, x0, x1) {
  const steps = Math.max(2, Math.ceil(x1 - x0));
  g.beginPath();
  for (let s = 0; s <= steps; s++) {
    const x = x0 + ((x1 - x0) * s) / steps;
    const y = evalSpline(sp, x);
    if (s === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.stroke();
}

export function drawWave() {
  const canvas = document.getElementById("wave");
  if (!canvas || !ctx.view || !ctx.model || !ctx.palette || !ctx.window) return;
  const { g, width: w, height: h } = fit(canvas);
  const P = ctx.palette;
  const view = ctx.view;
  const model = ctx.model;
  const window = ctx.window;
  const geom = slotGeometry(w, SLOT_COUNT);
  const top = 56;
  const bottom = Math.max(top + 24, h - 34);

  g.clearRect(0, 0, w, h);

  /* background + stage glow */
  g.fillStyle = P.bg;
  g.fillRect(0, 0, w, h);
  const glow = g.createRadialGradient(
    w * 0.5,
    top + (bottom - top) * 0.2,
    10,
    w * 0.5,
    top + (bottom - top) * 0.45,
    Math.max(w, h) * 0.6
  );
  glow.addColorStop(0, P.stageGlow);
  glow.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = glow;
  g.fillRect(0, 0, w, h);

  /* horizontal level guides (F, C, 8, 4, 0) */
  g.save();
  g.font = `10px ${MONO}`;
  g.textAlign = "right";
  g.textBaseline = "middle";
  for (const level of [15, 12, 8, 4, 0]) {
    const y = Math.round(levelY(level, top, bottom)) + 0.5;
    g.strokeStyle = level === 0 ? rgba(P.dimmer, 0.55) : "rgba(255,255,255,0.045)";
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(geom.pad, y);
    g.lineTo(geom.pad + geom.plotWidth, y);
    g.stroke();
    g.fillStyle = level === 0 ? P.dim : P.dimmer;
    g.fillText(level.toString(16).toUpperCase(), geom.pad - 10, y);
  }
  g.restore();

  /* ref waves */
  for (const wave of ctx.waves) {
    if (!wave.points.length) continue;
    const ref = wave.ref;
    const trunk = ref.kind === "trunk";
    const color = identityOf(ref);
    let alpha = trunk ? 1 : 0.92;
    if (!trunk && view.lens.age) {
      const age = ageNorm(refAgeDays(model, ref, model.snapshotMs));
      alpha *= 1 - 0.38 * age;
    }
    if (!trunk && view.lens.agents && !refHasAgent(model, ref.id)) alpha *= 0.24;
    if (!trunk && view.lens.agents && refHasAgent(model, ref.id)) alpha = 1;

    const xs = wave.points.map((point) => slotX(point.k, geom));
    const ys = wave.points.map((point) => levelY(point.level, top, bottom));
    const sp = buildSpline(xs, ys);
    if (!sp) continue;
    const x0 = xs[0];
    const x1 = xs[xs.length - 1];

    /* glow pass */
    g.save();
    g.globalAlpha = trunk ? 0.16 : 0.07;
    g.strokeStyle = color;
    g.lineWidth = trunk ? 9 : 7;
    g.lineJoin = "round";
    g.lineCap = "round";
    strokeSpline(g, sp, x0, x1);
    g.restore();

    /* main stroke */
    g.save();
    g.globalAlpha = alpha;
    g.lineWidth = trunk ? 2.2 : 1.8;
    g.lineJoin = "round";
    g.lineCap = "round";
    if (trunk) {
      const grad = g.createLinearGradient(0, top, 0, bottom);
      grad.addColorStop(0, P.okHi);
      grad.addColorStop(1, P.okLow);
      g.strokeStyle = grad;
    } else {
      g.strokeStyle = color;
      if (ref.colorKey === 6) g.setLineDash([6, 4]);
      else if (ref.colorKey === 7) g.setLineDash([2, 4]);
    }
    strokeSpline(g, sp, x0, x1);
    g.restore();

    /* sample dots + agent halos */
    for (const point of wave.points) {
      if (!point.count) continue;
      const x = slotX(point.k, geom);
      const y = levelY(point.level, top, bottom);
      if (point.agentCount > 0) {
        g.save();
        g.globalAlpha = view.lens.agents ? 0.8 : 0.4;
        g.fillStyle = P.agent;
        g.beginPath();
        g.arc(x, y, 4.6, 0, Math.PI * 2);
        g.fill();
        g.restore();
      }
      g.save();
      g.globalAlpha = Math.max(0.5, alpha);
      g.fillStyle = trunk ? P.okHi : color;
      g.beginPath();
      g.arc(x, y, 2.2, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }
  }

  /* pull-request tension rings, at the branch tip's slot level */
  if (view.lens.prs) {
    for (const pr of ctx.prs) {
      if (!view.refs.includes(pr.ref.id)) continue;
      const tipMs = refTipTime(model, pr.ref);
      const edgeK = tipMs < window.startMs ? 0 : SLOT_COUNT - 1;
      const k = tipMs < window.startMs || tipMs > window.endMs
        ? edgeK
        : slotIndexForTime(window, tipMs);
      const entry = ctx.slots[k]?.byRef.get(pr.ref.id);
      const y = levelY(entry ? entry.level : 0, top, bottom);
      drawPrRing(g, pr, slotX(k, geom), top, bottom, P, view, w, y);
    }
  }

  /* merge diamonds, on the trunk curve */
  const trunkWave = ctx.waves.find((wave) => wave.ref.kind === "trunk");
  for (const marker of mergeMarkers(model, window.startMs, window.endMs)) {
    const k = slotIndexForTime(window, Date.parse(marker.commit.time));
    const point = trunkWave?.points.find((p) => p.k === k);
    const y = levelY(point ? point.level : 0, top, bottom);
    const x = slotX(k, geom);
    g.save();
    g.translate(x, y);
    g.rotate(Math.PI / 4);
    g.fillStyle = P.bg;
    g.strokeStyle = P.ok;
    g.lineWidth = 1.4;
    g.fillRect(-3.4, -3.4, 6.8, 6.8);
    g.strokeRect(-3.4, -3.4, 6.8, 6.8);
    g.restore();
  }

  /* fork ticks + release flags */
  for (const wave of ctx.waves) {
    if (wave.ref.kind === "trunk" || !wave.points.length) continue;
    if (Date.parse(wave.ref.createdAt) <= window.startMs) continue;
    const x = slotX(wave.points[0].k, geom);
    g.save();
    g.globalAlpha = 0.6;
    g.strokeStyle = identityOf(wave.ref);
    g.lineWidth = 1.4;
    g.beginPath();
    g.moveTo(x, bottom);
    g.lineTo(x, bottom - 9);
    g.stroke();
    g.restore();
  }

  let lastFlagX = -100;
  for (const tag of releaseFlags(model, window.startMs, window.endMs)) {
    const k = slotIndexForTime(window, tag.timeMs);
    const x = slotX(k, geom);
    g.save();
    g.fillStyle = P.open;
    g.beginPath();
    g.moveTo(x, top - 9);
    g.lineTo(x + 7, top - 5.5);
    g.lineTo(x, top - 2);
    g.closePath();
    g.fill();
    if (w > 900 && x - lastFlagX > 52) {
      g.font = `9px ${MONO}`;
      g.textAlign = "left";
      g.textBaseline = "middle";
      g.fillStyle = P.open;
      g.globalAlpha = 0.9;
      g.fillText(tag.name, x + 10, top - 5.5);
      lastFlagX = x;
    }
    g.restore();
  }

  /* "you were here" */
  if (Number.isFinite(ctx.seenSnapshotMs)) {
    const seen = ctx.seenSnapshotMs;
    if (seen > window.startMs && seen < window.endMs && window.endMs - seen > geom.cell * 2) {
      const k = slotIndexForTime(window, seen);
      const x = slotX(k, geom);
      g.save();
      g.strokeStyle = rgba(P.dim, 0.55);
      g.setLineDash([3, 4]);
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(x, top);
      g.lineTo(x, bottom);
      g.stroke();
      g.setLineDash([]);
      g.font = `9px ${MONO}`;
      g.textAlign = "center";
      g.textBaseline = "top";
      g.fillStyle = ctx.newCount > 0 ? P.agent : P.dim;
      g.fillText(ctx.newCount > 0 ? `${ctx.newCount} new` : "seen", x, top + 6);
      g.restore();
    }
  }

  /* read head at the window end */
  const headX = geom.pad + geom.plotWidth;
  g.save();
  g.strokeStyle = rgba(P.open, 0.6);
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(headX, top);
  g.lineTo(headX, bottom);
  g.stroke();
  g.fillStyle = P.open;
  g.beginPath();
  g.moveTo(headX, bottom - 4);
  g.lineTo(headX - 4, bottom + 2);
  g.lineTo(headX + 4, bottom + 2);
  g.closePath();
  g.fill();
  if (w > 640) {
    g.font = `9px ${MONO}`;
    g.textAlign = "right";
    g.textBaseline = "bottom";
    g.fillStyle = P.open;
    g.globalAlpha = 0.9;
    g.fillText(dateShort(window.endMs), headX - 2, top - 12);
  }
  g.restore();

  /* hover band */
  if (ctx.hoverSlot >= 0 && ctx.hoverSlot < SLOT_COUNT) {
    const x = slotX(ctx.hoverSlot, geom);
    g.save();
    g.fillStyle = "rgba(255,255,255,0.035)";
    g.fillRect(x - geom.cell / 2, top, geom.cell, bottom - top);
    g.restore();
  }

  /* focus ring on the focused slot's curve */
  if (ctx.focusCommit) {
    const focus = ctx.focusCommit;
    const t = Date.parse(focus.time);
    if (t >= window.startMs && t <= window.endMs) {
      const k = slotIndexForTime(window, t);
      const refId = focus.refs[0];
      const entry = ctx.slots[k]?.byRef.get(refId);
      const y = levelY(entry ? entry.level : 0, top, bottom);
      g.save();
      g.strokeStyle = P.handle;
      g.lineWidth = 1.6;
      g.beginPath();
      g.arc(slotX(k, geom), y, 6.5, 0, Math.PI * 2);
      g.stroke();
      g.globalAlpha = 0.35;
      g.beginPath();
      g.arc(slotX(k, geom), y, 9.5, 0, Math.PI * 2);
      g.stroke();
      g.restore();
    }
  }

  /* empty window */
  const total = ctx.slots.reduce((sum, slot) => sum + slot.count, 0);
  if (total === 0) {
    g.save();
    g.font = `11px ui-sans-serif, system-ui, sans-serif`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = P.dimmer;
    g.fillText("no commits in this window", w / 2, (top + bottom) / 2);
    g.restore();
  }
}

function drawPrRing(g, pr, x, top, bottom, P, view, width, yOverride) {
  const entryY =
    yOverride !== undefined ? yOverride : bottom - (bottom - top) * 0.1;
  const color = view.lens.age ? ageColor(view.theme, pr.ageNorm) : P.open;
  const focused = view.focusRef?.id === pr.ref.id;
  const radius = focused ? 7.2 : 5.6;
  g.save();
  g.strokeStyle = color;
  g.lineWidth = 1.5;
  g.beginPath();
  g.arc(x, entryY, radius, 0, Math.PI * 2);
  g.stroke();
  if (pr.pr.conflicts) {
    g.setLineDash([2, 2]);
    g.beginPath();
    g.arc(x, entryY, radius + 3.5, 0, Math.PI * 2);
    g.stroke();
    g.setLineDash([]);
  }
  if (pr.pr.draft) {
    g.fillStyle = P.bg;
    g.beginPath();
    g.arc(x, entryY, 2, 0, Math.PI * 2);
    g.fill();
  } else {
    g.fillStyle = color;
    g.beginPath();
    g.arc(x, entryY, 2, 0, Math.PI * 2);
    g.fill();
  }
  if (pr.agentAuthored) {
    g.fillStyle = P.agent;
    g.beginPath();
    g.arc(x, entryY, 1.1, 0, Math.PI * 2);
    g.fill();
  }
  if (width > 1000) {
    g.font = `9px ${MONO}`;
    g.textAlign = "left";
    g.textBaseline = "middle";
    g.fillStyle = color;
    g.globalAlpha = 0.9;
    g.fillText(`#${pr.pr.number}`, x + radius + 4, entryY);
  }
  g.restore();
}
