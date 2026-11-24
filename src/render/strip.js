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

  const focusK = ctx.focusCommit
    ? Math.max(
        0,
        Math.min(
          SLOT_COUNT - 1,
          Math.floor(
            (Date.parse(ctx.focusCommit.time) - ctx.window.startMs) / (ctx.window.slotMs || 1)
          )
        )
      )
    : -1;

  clear(host);
  const fragment = document.createDocumentFragment();
  for (let k = 0; k < SLOT_COUNT; k++) {
    const slot = active[k];
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "slot";
    cell.dataset.k = String(k);
    cell.dataset.x = slotX(k, geom).toFixed(3);
    if (slot.count === 0) cell.disabled = true;
    if (slot.agentCount > 0) cell.classList.add("is-agent");
    if (ctx.view.lens.agents && slot.agentCount > 0) cell.classList.add("is-agent-lens");
    if (k === focusK) cell.classList.add("is-focus");

    const label =
      `slot ${k + 1} of ${SLOT_COUNT}, ${dateMedium(slot.startMs)}, ` +
      `${slot.count} commit${slot.count === 1 ? "" : "s"}, churn ${slot.churn}, level ${slot.level}` +
      (slot.agentCount ? `, ${slot.agentCount} agent commit${slot.agentCount === 1 ? "" : "s"}` : "");
    cell.setAttribute("aria-label", label);
    cell.title = slot.count > 0 ? `${label} — click for 3D beacon · double-click for diff` : label;

    cell.appendChild(el("span", "slot-date", dateShort(slot.startMs)));

    const meter = el("span", "slot-meter");
    meter.setAttribute("aria-hidden", "true");
    const norm = slot.level / 15;
    meter.style.setProperty("--lvl", norm.toFixed(3));
    for (let i = 0; i < 8; i++) {
      const tick = document.createElement("i");
      /* Symmetric mini waveform pulse inspired by Ref #3 overview cells */
      const waveShape = Math.sin(((i + 0.5) / 8) * Math.PI);
      const hPct = slot.count === 0 ? 6 : Math.max(14, Math.round((0.25 + 0.75 * norm * waveShape) * 100));
      tick.style.height = `${hPct}%`;
      if (slot.count > 0) tick.className = "on";
      meter.appendChild(tick);
    }
    cell.appendChild(meter);

    const count =
      slot.count === 1 && slot.newest ? shortSha(slot.newest.sha, 6) : String(slot.count);
    cell.appendChild(el("span", "slot-count", slot.count === 0 ? "·" : count));

    fragment.appendChild(cell);
  }
  host.appendChild(fragment);

  const mode = document.getElementById("stripMode");
  if (mode) {
    mode.textContent = ctx.view.depth
      ? `OVERVIEW · ${SLOT_COUNT} SLICES · ${ctx.metric?.label ?? "all"} · DRAG TO SELECT`
      : `OVERVIEW · ${SLOT_COUNT} SLOTS · ${ctx.view.span} · DRAG TO SELECT`;
  }
  const range = document.getElementById("stripRange");
  if (range) {
    range.textContent = `${dateMedium(ctx.window.startMs)} – ${dateMedium(ctx.window.endMs)} UTC`;
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
