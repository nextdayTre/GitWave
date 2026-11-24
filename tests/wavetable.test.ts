import { test } from "node:test";
import assert from "node:assert/strict";
import { buildWavetable, sampleWavetableSlice } from "../src/core/wavetable.ts";
import { effectiveCeiling, windowFor } from "../src/core/samples.ts";
import { searchCommits } from "../src/core/search.ts";
import { defaultView } from "../src/core/view.ts";
import { loadDemo } from "./fixtures.ts";

test("wavetable: deterministic, bounded in [-1, 1] and tapered at edges", () => {
  const { model } = loadDemo();
  const view = defaultView(model);
  const win = windowFor(model, view.end, view.span);
  const ceiling = effectiveCeiling(model, win, null);

  const a = buildWavetable(model, view, null, ceiling, { sliceCount: 32, sampleCount: 64, seed: "all" });
  const b = buildWavetable(model, view, null, ceiling, { sliceCount: 32, sampleCount: 64, seed: "all" });

  assert.equal(a.empty, false);
  assert.equal(a.frames.length, 32);
  assert.equal(a.frames[0].length, 64);

  for (let i = 0; i < a.frames.length; i++) {
    assert.deepEqual(a.frames[i], b.frames[i]);
    assert.equal(Math.abs(a.frames[i][0]), 0, "left edge tapers to zero");
    assert.equal(Math.abs(a.frames[i][63]) < 1e-6, true, "right edge tapers to zero");
    for (let s = 0; s < a.frames[i].length; s++) {
      assert.ok(a.frames[i][s] >= -1 && a.frames[i][s] <= 1);
    }
  }
});

test("wavetable: empty match yields a flat zero plane", () => {
  const { model } = loadDemo();
  const view = defaultView(model);
  const win = windowFor(model, view.end, view.span);
  const empty = searchCommits(model, "zzzz-no-match");
  const ceiling = effectiveCeiling(model, win, empty.shas);

  const table = buildWavetable(model, view, empty.shas, ceiling, { sliceCount: 16, sampleCount: 48 });
  assert.equal(table.empty, true);
  for (const frame of table.frames) {
    for (const v of frame) assert.equal(v, 0);
  }
});

test("wavetable: distinct Git filters produce distinct harmonic timbres and continuous slice sampling", () => {
  const { model } = loadDemo();
  const view = defaultView(model);
  const win = windowFor(model, view.end, view.span);

  const merged = searchCommits(model, "merged");
  const agent = searchCommits(model, "ref:agent/refactor-store");

  const tMerged = buildWavetable(model, view, merged.shas, effectiveCeiling(model, win, merged.shas), {
    seed: "merged",
  });
  const tAgent = buildWavetable(model, view, agent.shas, effectiveCeiling(model, win, agent.shas), {
    seed: "ref:agent/refactor-store",
  });

  assert.notEqual(tMerged.timbre.carrier, tAgent.timbre.carrier);
  const mid = sampleWavetableSlice(tMerged, 0.5, 0, 0);
  assert.equal(mid.length, tMerged.sampleCount);
  assert.ok(mid.some((v) => Math.abs(v) > 0.05), "sampled slice carries non-trivial wave energy");
});

test("wavetable: fullHistory mode anchors geometry across read-head travel and tracks churn", () => {
  const { model } = loadDemo();
  const nowV = defaultView(model);
  const oldV = { ...nowV, end: "2026-08-15T00:00:00Z" };
  const win = windowFor(model, model.doc.repo.snapshotAt, nowV.span);
  const ceiling = effectiveCeiling(model, win, null);

  const tNow = buildWavetable(model, nowV, null, ceiling, {
    sliceCount: 24,
    sampleCount: 48,
    seed: "all",
    fullHistory: true,
  });
  const tOld = buildWavetable(model, oldV, null, ceiling, {
    sliceCount: 24,
    sampleCount: 48,
    seed: "all",
    fullHistory: true,
  });

  assert.equal(tNow.meta[0].endMs, model.snapshotMs);
  assert.ok(tNow.meta[0].churn > 0, "layer metadata carries real churn");
  assert.ok(tNow.meta[0].startMs < tNow.meta[0].endMs);
  assert.deepEqual(tNow.frames[0], tOld.frames[0], "full-history terrain stays anchored when read head moves");
});
