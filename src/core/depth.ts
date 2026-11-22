/**
 * depth.ts — the time-depth frame behind the 3D waterfall.
 *
 * The front slice ends at the read head. Each slice behind it ends one stride
 * earlier, so the depth axis *is* history: a ridge in the waterfall is a busy
 * period seen from many window positions. Slices stop when the span's own clamp
 * would repeat the same window, so every layer is distinct.
 */

import type { Model, View } from "./types.ts";
import { isoOf, windowFor } from "./samples.ts";

export const DEPTH_COUNT = 24;
export const DEPTH_STRIDE_DAYS = 5;
export const DAY_MS = 86400000;

export interface DepthSlice {
  d: number;
  startMs: number;
  endMs: number;
  label: string;
  window: ReturnType<typeof windowFor>;
}

/**
 * Build the depth stack. `d = 0` is the current window; larger `d` is older.
 * A slice is dropped once the end cannot move further back (the span clamp).
 */
export function depthSlices(
  model: Model,
  view: View,
  count = DEPTH_COUNT,
  strideDays = DEPTH_STRIDE_DAYS
): DepthSlice[] {
  const slices: DepthSlice[] = [];
  const front = windowFor(model, view.end, view.span);
  let previousEnd = Number.POSITIVE_INFINITY;
  for (let d = 0; d < count; d++) {
    const requested = front.endMs - d * strideDays * DAY_MS;
    const window = windowFor(model, isoOf(requested), view.span);
    if (d > 0 && Math.abs(window.endMs - previousEnd) < 1) break;
    previousEnd = window.endMs;
    slices.push({
      d,
      startMs: window.startMs,
      endMs: window.endMs,
      label: isoOf(window.endMs),
      window,
    });
  }
  return slices;
}

/** The date of the oldest layer, for the readout. */
export function depthBackLabel(slices: DepthSlice[]): string {
  const last = slices[slices.length - 1];
  return last ? last.label : "";
}
