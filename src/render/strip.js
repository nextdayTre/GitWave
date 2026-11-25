/**
 * strip.js — the commit strip under the wave.
 *
 * One button per slot, aligned to the same geometry the canvas uses. The
 * 16-tick meter is the slot's level (0–15); the label is the date and the
 * commit count (or the short sha when a slot holds one commit).
 */

import { ctx, setView } from "../app.ts";
import { SLOT_COUNT, dateMedium, dateShort } from "../core/samples.ts";
import { slotAtX, slotGeometry, slotX } from "../core/geometry.ts";
import { focusSlot } from "../core/view.ts";
import { drawWave } from "./canvas.js";
import { drawDepth } from "./depth.js";
import { drawRackFrames } from "./rack.js";
import { openDiffView } from "../ui/diff.js";
import { clear, el, shortSha } from "../ui/dom.js";

function redraw() {
  if (ctx.diffOpen) return;
  if (ctx.view?.depth) {
    if (ctx.view.rack) drawRackFrames();
    else drawDepth();
  } else {
    drawWave();
  }
}

function bandWidth() {
  const canvas = document.getElementById("wave");
  const width = canvas ? canvas.getBoundingClientRect().width : 0;
  if (width > 0) return width;
  const stage = document.getElementById("stage");
  const stageW = stage ? stage.getBoundingClientRect().width : 0;
  if (stageW > 0) return stageW;
  const host = document.getElementById("slots");
  return (host ? host.getBoundingClientRect().width : 960) + 80;
}

let stripCells = [];
let stripHost = null;

function ensureStripCells(host) {
  if (stripHost === host && stripCells.length === SLOT_COUNT && host.childElementCount === SLOT_COUNT) {
    return stripCells;
  }
  clear(host);
  stripHost = host;
  stripCells = new Array(SLOT_COUNT);
  const fragment = document.createDocumentFragment();
  for (let k = 0; k < SLOT_COUNT; k++) {
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "slot";
    cell.dataset.k = String(k);

    const dateEl = el("span", "slot-date", "");
    const meter = el("span", "slot-meter");
    meter.setAttribute("aria-hidden", "true");
    const ticks = new Array(8);
    for (let i = 0; i < 8; i++) {
      const tick = document.createElement("i");
      meter.appendChild(tick);
      ticks[i] = tick;
    }
    const countEl = el("span", "slot-count", "");

    cell.appendChild(dateEl);
    cell.appendChild(meter);
    cell.appendChild(countEl);
    fragment.appendChild(cell);
    stripCells[k] = { cell, dateEl, meter, ticks, countEl, lastKey: "" };
  }
  host.appendChild(fragment);
  return stripCells;
}

const TICK_SHAPE = Array.from({ length: 8 }, (_, i) => Math.sin(((i + 0.5) / 8) * Math.PI));

export function renderStrip() {
  const host = document.getElementById("slots");
  if (!host || !ctx.window || !ctx.view) return;
  const active = ctx.slots;
  if (active.length !== SLOT_COUNT) return;
  const geom = slotGeometry(bandWidth(), SLOT_COUNT);
  host.style.setProperty("--slot-gap", `${geom.gap.toFixed(2)}px`);
  host.style.gridTemplateColumns = `repeat(${SLOT_COUNT}, minmax(0, 1fr))`;
  host.style.setProperty(
    "--metric",
    ctx.view.depth && ctx.metric ? ctx.metric.color : ""
  );

  const focusTime = ctx.focusCommit
    ? ctx.model?.commitTimeBySha?.get(ctx.focusCommit.sha) ?? Date.parse(ctx.focusCommit.time)
    : Number.NaN;
  const focusK = Number.isFinite(focusTime)
    ? Math.max(
        0,
        Math.min(
          SLOT_COUNT - 1,
          Math.floor((focusTime - ctx.window.startMs) / (ctx.window.slotMs || 1))
        )
      )
    : -1;

  const cells = ensureStripCells(host);
  const agentLens = ctx.view.lens.agents;

  for (let k = 0; k < SLOT_COUNT; k++) {
    const slot = active[k];
    const rec = cells[k];
    const xStr = slotX(k, geom).toFixed(3);
    const isFocus = k === focusK;
    const hasAgent = slot.agentCount > 0;
    const sha6 = slot.count === 1 && slot.newest ? shortSha(slot.newest.sha, 6) : "";
    const cellKey = `${xStr}|${slot.startMs}|${slot.count}|${slot.churn}|${slot.level}|${slot.agentCount}|${agentLens ? 1 : 0}|${isFocus ? 1 : 0}|${sha6}`;
    if (rec.lastKey === cellKey) continue;
    rec.lastKey = cellKey;

    const { cell, dateEl, meter, ticks, countEl } = rec;
    cell.dataset.x = xStr;
    cell.disabled = slot.count === 0;
    cell.classList.toggle("is-agent", hasAgent);
    cell.classList.toggle("is-agent-lens", agentLens && hasAgent);
    cell.classList.toggle("is-focus", isFocus);

    const label =
      `slot ${k + 1} of ${SLOT_COUNT}, ${dateMedium(slot.startMs)}, ` +
      `${slot.count} commit${slot.count === 1 ? "" : "s"}, churn ${slot.churn}, level ${slot.level}` +
      (slot.agentCount ? `, ${slot.agentCount} agent commit${slot.agentCount === 1 ? "" : "s"}` : "");
    cell.setAttribute("aria-label", label);
    cell.title = slot.count > 0 ? `${label} — click for 3D beacon · double-click for diff` : label;

    dateEl.textContent = dateShort(slot.startMs);

    const norm = slot.level / 15;
    meter.style.setProperty("--lvl", norm.toFixed(3));
    const hasCommits = slot.count > 0;
    for (let i = 0; i < 8; i++) {
      const tick = ticks[i];
      const hPct = hasCommits ? Math.max(14, Math.round((0.25 + 0.75 * norm * TICK_SHAPE[i]) * 100)) : 6;
      tick.style.height = `${hPct}%`;
      tick.className = hasCommits ? "on" : "";
    }

    countEl.textContent = slot.count === 0 ? "·" : slot.count === 1 && sha6 ? sha6 : String(slot.count);
  }

  const mode = document.getElementById("stripMode");
  if (mode) {
    const nextMode = ctx.view.depth
      ? `OVERVIEW · ${SLOT_COUNT} SLICES · ${ctx.metric?.label ?? "all"} · DRAG TO SELECT`
      : `OVERVIEW · ${SLOT_COUNT} SLOTS · ${ctx.view.span} · DRAG TO SELECT`;
    if (mode.textContent !== nextMode) mode.textContent = nextMode;
  }
  const range = document.getElementById("stripRange");
  if (range) {
    const nextRange = `${dateMedium(ctx.window.startMs)} – ${dateMedium(ctx.window.endMs)} UTC`;
    if (range.textContent !== nextRange) range.textContent = nextRange;
  }
}

export function initStrip() {
  const host = document.getElementById("slots");
  if (!host) return;
  let scrubbing = false;

  const pickAtPointer = (event) => {
    const elUnder = document.elementFromPoint(event.clientX, event.clientY);
    const cell = elUnder instanceof Element ? elUnder.closest(".slot") : null;
    if (!(cell instanceof HTMLElement) || cell.disabled || !ctx.view) return;
    const slot = ctx.slots[Number(cell.dataset.k)];
    if (!slot || !slot.newest) return;
    if (ctx.view.focusSha !== slot.newest.sha) {
      setView(focusSlot(ctx.view, slot));
    }
  };

  host.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    scrubbing = true;
    pickAtPointer(event);
  });

  window.addEventListener("pointerup", () => {
    scrubbing = false;
  });

  host.addEventListener("click", (event) => {
    const target = event.target;
    const cell = target instanceof Element ? target.closest(".slot") : null;
    if (!(cell instanceof HTMLElement) || cell.disabled || !ctx.view) return;
    const slot = ctx.slots[Number(cell.dataset.k)];
    if (!slot) return;
    setView(focusSlot(ctx.view, slot));
  });

  host.addEventListener("dblclick", (event) => {
    const target = event.target;
    const cell = target instanceof Element ? target.closest(".slot") : null;
    if (!(cell instanceof HTMLElement) || cell.disabled || !ctx.view) return;
    const slot = ctx.slots[Number(cell.dataset.k)];
    if (!slot || slot.count === 0) return;
    openDiffView(slot);
  });

  host.addEventListener("pointermove", (event) => {
    if (scrubbing) pickAtPointer(event);
    const target = event.target;
    const cell = target instanceof Element ? target.closest(".slot") : null;
    const k = cell instanceof HTMLElement ? Number(cell.dataset.k) : -1;
    if (k === ctx.hoverSlot) return;
    ctx.hoverSlot = k;
    redraw();
  });

  host.addEventListener("pointerleave", () => {
    if (ctx.hoverSlot === -1) return;
    ctx.hoverSlot = -1;
    redraw();
  });
}

export function initCanvasPointer() {
  const canvas = document.getElementById("wave");
  if (!canvas) return;

  const slotFromEvent = (event) => {
    const rect = canvas.getBoundingClientRect();
    const geom = slotGeometry(rect.width, SLOT_COUNT);
    const x = event.clientX - rect.left;
    return { k: slotAtX(x, geom), x };
  };

  canvas.addEventListener("pointermove", (event) => {
    if (ctx.view?.depth) return;
    const { k } = slotFromEvent(event);
    if (k === ctx.hoverSlot) return;
    ctx.hoverSlot = k;
    redraw();
  });

  canvas.addEventListener("pointerleave", () => {
    if (ctx.view?.depth) return;
    if (ctx.hoverSlot === -1) return;
    ctx.hoverSlot = -1;
    redraw();
  });

  canvas.addEventListener("click", (event) => {
    if (!ctx.view || ctx.view.depth) return;
    const { k } = slotFromEvent(event);
    const slot = ctx.slots[k];
    if (!slot) return;
    setView(focusSlot(ctx.view, slot));
  });
}
