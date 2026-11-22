/**
 * tension.js — the amber 2-D "tension vector" for open pull requests.
 *
 * X is age (0–20 days), Y is size relative to the largest open PR. The vector
 * points at the weighted centre of attention; the dots are the pull requests.
 * Activate to open the tray; drag to filter; wheel to widen the filter.
 */

import { ctx } from "../app.ts";
import { agePlot, prCentroid } from "../core/refs.ts";
import { clamp } from "../core/samples.ts";
import { ageColor, mixHex, rgba } from "../core/theme.ts";

const AGE_MAX = 1.2;

let handlers = { open: () => {}, focus: () => {} };
let drag = null;
let hoverPr = null;

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

function plot(width, height) {
  return { left: 11, right: width - 7, top: 8, bottom: height - 13 };
}

function prPoint(pr, box) {
  const x = box.left + (agePlot(pr.ageDays) / AGE_MAX) * (box.right - box.left);
  const y = box.bottom - pr.amountNorm * (box.bottom - box.top);
  return { x, y };
}

export function drawTension() {
  const canvas = document.getElementById("tensionPad");
  const wrap = document.getElementById("tension");
  if (!canvas || !wrap || !ctx.palette || !ctx.prs) return;
  const { g, width, height } = fit(canvas);
  const P = ctx.palette;
  const box = plot(width, height);
  const prs = ctx.prs;
  const lensAge = ctx.view?.lens.age ?? true;
  const theme = ctx.view?.theme ?? "signal";

  g.clearRect(0, 0, width, height);

  /* axes */
  g.strokeStyle = rgba(P.dimmer, 0.7);
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(box.left, box.top);
  g.lineTo(box.left, box.bottom);
  g.lineTo(box.right, box.bottom);
  g.stroke();

  /* mid grid */
  g.strokeStyle = rgba(P.line, 0.9);
  g.beginPath();
  g.moveTo(box.left, (box.top + box.bottom) / 2);
  g.lineTo(box.right, (box.top + box.bottom) / 2);
  g.moveTo((box.left + box.right) / 2, box.top);
  g.lineTo((box.left + box.right) / 2, box.bottom);
  g.stroke();

  g.font = "8px ui-sans-serif, system-ui, sans-serif";
  g.fillStyle = P.dimmer;
  g.textAlign = "left";
  g.textBaseline = "top";
  g.fillText("amount", box.left, box.top - 7);
  g.textAlign = "right";
  g.textBaseline = "bottom";
  g.fillText("age →", box.right, height - 1);

  const empty = prs.length === 0;
  if (empty) {
    g.fillStyle = P.dimmer;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.font = "8.5px ui-sans-serif, system-ui, sans-serif";
    g.fillText("no open PRs", (box.left + box.right) / 2, (box.top + box.bottom) / 2);
  }

  /* filter window */
  if (ctx.prFilter) {
    const fx = box.left + (ctx.prFilter.x / AGE_MAX) * (box.right - box.left);
    const fy = box.bottom - ctx.prFilter.y * (box.bottom - box.top);
    const radius = ctx.prFilter.r * Math.min(box.right - box.left, box.bottom - box.top);
    g.strokeStyle = rgba(P.open, 0.45);
    g.setLineDash([2, 3]);
    g.beginPath();
    g.arc(fx, fy, radius, 0, Math.PI * 2);
    g.stroke();
    g.setLineDash([]);
  }

  /* vector to the weighted centroid */
  const centroid = prCentroid(prs);
  if (centroid) {
    const px = box.left + (centroid.x / AGE_MAX) * (box.right - box.left);
    const py = box.bottom - centroid.y * (box.bottom - box.top);
    const color = lensAge
      ? mixHex(P.open, P.risk, clamp(centroid.x / AGE_MAX, 0, 1))
      : P.open;
    g.strokeStyle = color;
    g.lineWidth = 1.6;
    g.beginPath();
    g.moveTo(box.left + 1, box.bottom - 1);
    g.lineTo(px, py);
    g.stroke();
    const angle = Math.atan2(py - (box.bottom - 1), px - (box.left + 1));
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(px, py);
    g.lineTo(px - 5.5 * Math.cos(angle - 0.4), py - 5.5 * Math.sin(angle - 0.4));
    g.lineTo(px - 5.5 * Math.cos(angle + 0.4), py - 5.5 * Math.sin(angle + 0.4));
    g.closePath();
    g.fill();
  }

  /* PR dots */
  for (const pr of prs) {
    const { x, y } = prPoint(pr, box);
    const nx = agePlot(pr.ageDays) / AGE_MAX;
    const ny = pr.amountNorm;
    const inFilter =
      !ctx.prFilter ||
      Math.hypot(nx - ctx.prFilter.x / AGE_MAX, ny - ctx.prFilter.y) <= ctx.prFilter.r;
    const color = lensAge ? ageColor(theme, pr.ageNorm) : P.open;
    const radius = 3 + pr.amountNorm * 1.8;
    g.save();
    g.globalAlpha = inFilter ? 1 : 0.22;
    if (pr.pr.draft) {
      g.strokeStyle = color;
      g.lineWidth = 1.4;
      g.beginPath();
      g.arc(x, y, radius, 0, Math.PI * 2);
      g.stroke();
    } else {
      g.fillStyle = color;
      g.beginPath();
      g.arc(x, y, radius, 0, Math.PI * 2);
      g.fill();
    }
    if (pr.pr.conflicts) {
      g.strokeStyle = color;
      g.lineWidth = 1;
      g.setLineDash([1.5, 1.5]);
      g.beginPath();
      g.arc(x, y, radius + 2.6, 0, Math.PI * 2);
      g.stroke();
      g.setLineDash([]);
    }
    if (pr.agentAuthored) {
      g.fillStyle = P.agent;
      g.beginPath();
      g.arc(x, y, 1.2, 0, Math.PI * 2);
      g.fill();
    }
    if (hoverPr === pr) {
      g.strokeStyle = P.handle;
      g.lineWidth = 1.2;
      g.beginPath();
      g.arc(x, y, radius + 3.5, 0, Math.PI * 2);
      g.stroke();
    }
    g.restore();
  }

  wrap.dataset.empty = empty ? "true" : "false";
  const count = document.getElementById("tensionCount");
  if (count) count.textContent = String(prs.length);
  const stale = prs.filter((pr) => pr.stale).length;
  wrap.setAttribute(
    "aria-label",
    prs.length
      ? `Pull request tension: ${prs.length} open, ${stale} stale. Activate to list them.`
      : "Pull request tension: no open pull requests."
  );
  wrap.title = prs.length
    ? `${prs.length} open · ${stale} stale · click for the list`
    : "no open pull requests";
}

/** Geometry of the pad, used by pointer hit-testing. */
function pointerPr(event) {
  const canvas = document.getElementById("tensionPad");
  if (!canvas) return { pr: null, point: null };
  const rect = canvas.getBoundingClientRect();
  const box = plot(rect.width, rect.height);
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  let nearest = null;
  let best = 13;
  for (const pr of ctx.prs) {
    const point = prPoint(pr, box);
    const distance = Math.hypot(point.x - x, point.y - y);
    if (distance < best) {
      best = distance;
      nearest = pr;
    }
  }
  const rx = clamp((x - box.left) / Math.max(1, box.right - box.left), 0, 1);
  const ry = clamp((box.bottom - y) / Math.max(1, box.bottom - box.top), 0, 1);
  return {
    pr: nearest,
    point: { x: rx * AGE_MAX, y: ry, px: x, py: y, rx, ry },
    box,
  };
}

export function initTension(nextHandlers) {
  handlers = { ...handlers, ...nextHandlers };
  const wrap = document.getElementById("tension");
  if (!wrap) return;

  wrap.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    drag = { x: event.clientX, y: event.clientY, moved: false };
    try {
      wrap.setPointerCapture(event.pointerId);
    } catch {
      /* non-fatal */
    }
  });

  wrap.addEventListener("pointermove", (event) => {
    const { pr } = pointerPr(event);
    hoverPr = pr;
    if (drag) {
      if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 5) drag.moved = true;
      const { point } = pointerPr(event);
      if (point) {
        ctx.prFilter = {
          x: point.x,
          y: point.y,
          r: ctx.prFilter?.r ?? 0.4,
        };
      }
      drawTension();
    } else {
      drawTension();
    }
  });

  wrap.addEventListener("pointerup", (event) => {
    const wasDrag = drag?.moved;
    drag = null;
    if (wasDrag) {
      drawTension();
      return;
    }
    const { pr } = pointerPr(event);
    if (pr) handlers.focus(pr);
    else handlers.open();
    drawTension();
  });

  wrap.addEventListener("pointercancel", () => {
    drag = null;
    drawTension();
  });

  wrap.addEventListener("wheel", (event) => {
    event.preventDefault();
    const current = ctx.prFilter;
    const next = current
      ? { ...current, r: clamp(current.r + (event.deltaY > 0 ? 0.06 : -0.06), 0.15, 0.95) }
      : { x: AGE_MAX / 2, y: 0.5, r: 0.4 };
    ctx.prFilter = next;
    drawTension();
  }, { passive: false });

  wrap.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      handlers.open();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      ctx.prFilter = null;
      drawTension();
    }
  });

  wrap.addEventListener("pointerleave", () => {
    if (drag) return;
    if (hoverPr) {
      hoverPr = null;
      drawTension();
    }
  });
}
