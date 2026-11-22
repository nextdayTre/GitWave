/**
 * geometry.ts — the single authority for slot geometry.
 *
 * The canvas plot and the DOM strip must agree to 0 px. Both call these
 * functions; neither invents its own spacing. `pad` is 40 px, or 16 px at or
 * below 720 px (written to `--pad` by the app).
 */

import { SLOT_COUNT } from "./samples.ts";

export interface SlotGeometry {
  count: number;
  pad: number;
  plotWidth: number;
  gap: number;
  cell: number;
}

export function padFor(viewportWidth: number): number {
  return viewportWidth <= 720 ? 16 : 40;
}

export function slotGeometry(viewportWidth: number, count = SLOT_COUNT): SlotGeometry {
  const pad = padFor(viewportWidth);
  const plotWidth = Math.max(1, viewportWidth - pad * 2);
  const gap = Math.max(1.5, Math.min(12, (plotWidth / count) * 0.16));
  const cell = Math.max(1, (plotWidth - (count - 1) * gap) / count);
  return { count, pad, plotWidth, gap, cell };
}

/** Centre x of slot k, relative to the band's left edge. */
export function slotX(k: number, g: SlotGeometry): number {
  return g.pad + k * (g.cell + g.gap) + g.cell / 2;
}

/** Left edge x of slot k, relative to the band's left edge. */
export function slotLeft(k: number, g: SlotGeometry): number {
  return g.pad + k * (g.cell + g.gap);
}

/** Slot index under a pointer x, or -1 outside the plot. */
export function slotAtX(x: number, g: SlotGeometry): number {
  if (x < g.pad || x > g.pad + g.plotWidth) return -1;
  const raw = Math.floor((x - g.pad) / (g.cell + g.gap));
  return raw < 0 ? 0 : raw >= g.count ? g.count - 1 : raw;
}

export function levelY(level: number, top: number, bottom: number): number {
  const t = Math.max(0, Math.min(15, level)) / 15;
  return bottom - t * (bottom - top);
}
