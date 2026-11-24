import { test } from "node:test";
import assert from "node:assert/strict";
import { DEPTH_COUNT, depthBackLabel, depthSlices, historyDepthSlices } from "../src/core/depth.ts";
import { defaultView } from "../src/core/view.ts";
import { isoOf, windowFor } from "../src/core/samples.ts";
import { loadDemo } from "./fixtures.ts";

const DAY = 86400000;

test("depth: the front slice is the window end and every layer is older", () => {
  const { model } = loadDemo();
  const view = defaultView(model);
  const slices = depthSlices(model, view);
  const front = windowFor(model, view.end, view.span);
  assert.ok(slices.length >= 10 && slices.length <= DEPTH_COUNT);
  assert.equal(slices[0].endMs, front.endMs);
  for (let i = 1; i < slices.length; i++) {
    assert.ok(slices[i].endMs < slices[i - 1].endMs, "depth must move backwards");
    assert.notEqual(slices[i].endMs, slices[i - 1].endMs, "layers must be distinct");
  }
  const minEnd = model.startMs + 90 * DAY;
  assert.ok(slices[slices.length - 1].endMs >= minEnd - 1);
});

test("depth: the stack stops when the span clamp repeats the window", () => {
  const { model } = loadDemo();
  const minEnd = isoOf(model.startMs + 90 * DAY);
  const view = { ...defaultView(model), end: minEnd };
  assert.equal(depthSlices(model, view).length, 1);
});

test("depth: the all span is a single layer", () => {
  const { model } = loadDemo();
  const view = { ...defaultView(model), span: "all" as const };
  assert.equal(depthSlices(model, view).length, 1);
});

test("depth: the count is capped and a shorter stride packs more layers", () => {
  const { model } = loadDemo();
  const view = defaultView(model);
  assert.ok(depthSlices(model, view, 500).length <= 500);
  const dense = depthSlices(model, view, DEPTH_COUNT, 2);
  const loose = depthSlices(model, view, DEPTH_COUNT, 10);
  assert.ok(dense.length >= loose.length);
});

test("depth: the back label names the oldest layer", () => {
  const { model } = loadDemo();
  const slices = depthSlices(model, defaultView(model));
  assert.equal(depthBackLabel(slices), slices[slices.length - 1].label);
  assert.match(depthBackLabel(slices), /^2026-/);
});

test("depth: historyDepthSlices spans full travelable history from now to minEnd", () => {
  const { model } = loadDemo();
  const slices = historyDepthSlices(model, "90d", DEPTH_COUNT);
  assert.equal(slices.length, DEPTH_COUNT);
  assert.equal(slices[0].endMs, model.snapshotMs);
  assert.equal(slices[slices.length - 1].endMs, model.startMs + 90 * DAY);
  for (let i = 1; i < slices.length; i++) {
    assert.ok(slices[i].endMs < slices[i - 1].endMs, "full history slices strictly recede");
  }
  assert.equal(historyDepthSlices(model, "all").length, 1);
});
