/**
 * knobs.js — Warpenter & Serum-inspired tactile SVG rotary knobs.
 *
 * Pure vector dials with a 270° track, glowing active arc, machined cap and
 * rotating indicator tick. Supports vertical drag (Shift = fine), mouse wheel,
 * double-click reset and keyboard arrows.
 */

import { clamp } from "../core/samples.ts";

function svgNs() {
  return document.querySelector("svg")?.namespaceURI || "";
}
const START_DEG = 135;
const SWEEP_DEG = 270;

function polar(cx, cy, r, deg) {
  const rad = (deg * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function arcPath(cx, cy, r, startDeg, endDeg) {
  const span = endDeg - startDeg;
  if (Math.abs(span) < 0.01) return "";
  const p0 = polar(cx, cy, r, startDeg);
  const p1 = polar(cx, cy, r, endDeg);
  const large = Math.abs(span) > 180 ? 1 : 0;
  return `M ${p0.x.toFixed(2)} ${p0.y.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${p1.x.toFixed(2)} ${p1.y.toFixed(2)}`;
}

/**
 * Create a rotary knob element.
 *
 * @param {{
 *   label: string,
 *   value: number,          // normalized 0..1
 *   defaultValue?: number,
 *   size?: number,
 *   accent?: string,
 *   format?: (v: number) => string,
 *   onChange: (v: number) => void,
 *   onReset?: () => void,
 *   title?: string
 * }} opts
 */
export function createKnob(opts) {
  const size = opts.size ?? 34;
  const cx = 24;
  const cy = 24;
  const r = 18.5;

  const wrap = document.createElement("div");
  wrap.className = "knob";
  if (opts.accent) wrap.style.setProperty("--knob-accent", opts.accent);

  const btn = document.createElement("div");
  btn.className = "knob-dial";
  btn.setAttribute("role", "slider");
  btn.setAttribute("tabindex", "0");
  btn.setAttribute("aria-label", opts.label);
  btn.setAttribute("aria-valuemin", "0");
  btn.setAttribute("aria-valuemax", "100");
  if (opts.title) btn.title = opts.title;

  const ns = svgNs();
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 48 48");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("aria-hidden", "true");

  /* Base track arc */
  const track = document.createElementNS(ns, "path");
  track.setAttribute("class", "knob-track");
  track.setAttribute("d", arcPath(cx, cy, r, START_DEG, START_DEG + SWEEP_DEG));
  svg.appendChild(track);

  /* Outer glow arc */
  const glow = document.createElementNS(ns, "path");
  glow.setAttribute("class", "knob-glow");
  svg.appendChild(glow);

  /* Crisp active value arc */
  const arc = document.createElementNS(ns, "path");
  arc.setAttribute("class", "knob-arc");
  svg.appendChild(arc);

  /* Machined inner cap */
  const cap = document.createElementNS(ns, "circle");
  cap.setAttribute("class", "knob-cap");
  cap.setAttribute("cx", String(cx));
  cap.setAttribute("cy", String(cy));
  cap.setAttribute("r", "13.2");
  svg.appendChild(cap);

  /* Subtle top bevel rim */
  const rim = document.createElementNS(ns, "circle");
  rim.setAttribute("class", "knob-rim");
  rim.setAttribute("cx", String(cx));
  rim.setAttribute("cy", String(cy));
  rim.setAttribute("r", "12.2");
  svg.appendChild(rim);

  /* Indicator tick line */
  const tick = document.createElementNS(ns, "line");
  tick.setAttribute("class", "knob-tick");
  svg.appendChild(tick);

  btn.appendChild(svg);

  const labelEl = document.createElement("span");
  labelEl.className = "knob-label";
  labelEl.textContent = opts.label;

  const valueEl = document.createElement("span");
  valueEl.className = "knob-val";

  wrap.appendChild(btn);
  wrap.appendChild(labelEl);
  wrap.appendChild(valueEl);

  let current = clamp(opts.value ?? 0.5, 0, 1);

  function renderValue(v, customText) {
    current = clamp(v, 0, 1);
    const endDeg = START_DEG + current * SWEEP_DEG;
    const d = arcPath(cx, cy, r, START_DEG, Math.max(START_DEG + 1, endDeg));
    arc.setAttribute("d", d);
    glow.setAttribute("d", d);

    const inner = polar(cx, cy, 4.5, endDeg);
    const outer = polar(cx, cy, 11.4, endDeg);
    tick.setAttribute("x1", inner.x.toFixed(2));
    tick.setAttribute("y1", inner.y.toFixed(2));
    tick.setAttribute("x2", outer.x.toFixed(2));
    tick.setAttribute("y2", outer.y.toFixed(2));

    const text = customText ?? (opts.format ? opts.format(current) : `${Math.round(current * 100)}%`);
    valueEl.textContent = text;
    btn.setAttribute("aria-valuenow", String(Math.round(current * 100)));
    btn.setAttribute("aria-valuetext", text);
  }

  renderValue(current);

  let dragging = null;

  btn.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    dragging = { y: event.clientY, start: current };
    wrap.classList.add("is-dragging");
    try {
      btn.setPointerCapture(event.pointerId);
    } catch {
      /* non-fatal */
    }
  });

  btn.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    const scale = event.shiftKey ? 420 : 135;
    const next = clamp(dragging.start + (dragging.y - event.clientY) / scale, 0, 1);
    if (Math.abs(next - current) > 0.002) {
      renderValue(next);
      opts.onChange(next);
    }
  });

  const endDrag = () => {
    if (!dragging) return;
    dragging = null;
    wrap.classList.remove("is-dragging");
  };
  btn.addEventListener("pointerup", endDrag);
  btn.addEventListener("pointercancel", endDrag);

  btn.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      event.stopPropagation();
      const step = event.shiftKey ? 0.015 : 0.045;
      const next = clamp(current + (event.deltaY < 0 ? step : -step), 0, 1);
      renderValue(next);
      opts.onChange(next);
    },
    { passive: false }
  );

  btn.addEventListener("dblclick", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (opts.onReset) {
      opts.onReset();
    } else if (typeof opts.defaultValue === "number") {
      renderValue(opts.defaultValue);
      opts.onChange(opts.defaultValue);
    }
  });

  btn.addEventListener("keydown", (event) => {
    let next = null;
    const step = event.shiftKey ? 0.02 : 0.06;
    if (event.key === "ArrowUp" || event.key === "ArrowRight") next = clamp(current + step, 0, 1);
    else if (event.key === "ArrowDown" || event.key === "ArrowLeft") next = clamp(current - step, 0, 1);
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = 1;
    if (next !== null) {
      event.preventDefault();
      renderValue(next);
      opts.onChange(next);
    }
  });

  return {
    el: wrap,
    setValue: renderValue,
    setAccent(color) {
      wrap.style.setProperty("--knob-accent", color);
    },
  };
}
