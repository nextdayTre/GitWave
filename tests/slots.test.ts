import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SLOT_COUNT,
  buildSlots,
  effectiveCeiling,
  levelOf,
  refWave,
  slotIndexForTime,
  windowFor,
} from "../src/core/samples.ts";
import { loadDemo } from "./fixtures.ts";

test("slots: levelOf is bounded, monotone and pinned at the ceiling", () => {
  assert.equal(levelOf(0, 46), 0);
  assert.ok(levelOf(1, 46) > 0 && levelOf(1, 46) < 15);
  assert.equal(levelOf(46, 46), 15);
  assert.equal(levelOf(100000, 46), 15);
  let previous = -1;
  for (const churn of [0, 1, 2, 5, 10, 20, 40, 46, 100]) {
    const level = levelOf(churn, 46);
    assert.ok(level >= 0 && level <= 15);
    assert.ok(level >= previous, "level must not decrease as churn grows");
    previous = level;
  }
});

test("slots: window clamps to history and to the span", () => {
  const { model } = loadDemo();
  const clampedLow = windowFor(model, "2026-01-01T00:00:00Z", "30d");
  assert.equal(clampedLow.endMs, model.startMs + 30 * 86400000);
  const clampedHigh = windowFor(model, "2030-01-01T00:00:00Z", "30d");
  assert.equal(clampedHigh.endMs, model.snapshotMs);
  const all = windowFor(model, model.doc.repo.snapshotAt, "all");
  assert.equal(all.startMs, model.startMs);
  assert.equal(all.endMs, model.snapshotMs);
  assert.equal(all.slotMs, (model.snapshotMs - model.startMs) / SLOT_COUNT);
});

test("slots: a 30d window has 32 slots and every commit lands in exactly one", () => {
  const { model } = loadDemo();
  const window = windowFor(model, model.doc.repo.snapshotAt, "30d");
  const slots = buildSlots(model, window);
  assert.equal(slots.length, SLOT_COUNT);
  const inWindow = model.doc.commits.filter((commit) => {
    if (commit.merge) return false;
    const t = Date.parse(commit.time);
    return t >= window.startMs && t <= window.endMs;
  });
  const counted = slots.reduce((total, slot) => total + slot.count, 0);
  assert.equal(counted, inWindow.length);
  for (const slot of slots) {
    assert.ok(slot.level >= 0 && slot.level <= 15);
    assert.equal(slot.commits.length, slot.count);
    for (const entry of slot.byRef.values()) {
      assert.ok(entry.level >= 0 && entry.level <= 15);
      assert.ok(entry.churn > 0);
    }
  }
});

test("slots: slotIndexForTime is clamped at both edges", () => {
  const { model } = loadDemo();
  const window = windowFor(model, model.doc.repo.snapshotAt, "30d");
  assert.equal(slotIndexForTime(window, window.startMs), 0);
  assert.equal(slotIndexForTime(window, window.endMs), SLOT_COUNT - 1);
  assert.equal(slotIndexForTime(window, window.startMs - 1000), 0);
  assert.equal(slotIndexForTime(window, window.endMs + 1000), SLOT_COUNT - 1);
});

test("slots: the trunk wave spans the window; a quiet branch has no wave", () => {
  const { model } = loadDemo();
  const window = windowFor(model, model.doc.repo.snapshotAt, "30d");
  const slots = buildSlots(model, window);
  const trunk = model.doc.refs.find((ref) => ref.kind === "trunk");
  assert.ok(trunk);
  const trunkWave = refWave(model, trunk, window, slots);
  assert.equal(trunkWave.length, SLOT_COUNT);
  assert.equal(trunkWave[trunkWave.length - 1].k, SLOT_COUNT - 1);

  const chore = model.doc.refs.find((ref) => ref.id === "chore/ci");
  assert.ok(chore);
  assert.deepEqual(refWave(model, chore, window, slots), []);
});

test("slots: a branch wave starts at its first commit and ends at its tip", () => {
  const { model } = loadDemo();
  const window = windowFor(model, model.doc.repo.snapshotAt, "30d");
  const slots = buildSlots(model, window);
  const feat = model.doc.refs.find((ref) => ref.id === "feat/editor");
  assert.ok(feat);
  const wave = refWave(model, feat, window, slots);
  assert.ok(wave.length > 1 && wave.length < SLOT_COUNT);
  assert.equal(wave[0].k, 0);
  const tipSlot = slots[wave[wave.length - 1].k];
  assert.ok(tipSlot.byRef.has(feat.id));
  for (const point of wave) {
    const entry = slots[point.k].byRef.get(feat.id);
    assert.equal(point.level, entry ? entry.level : 0);
  }
});

test("slots: the window scale never drops below the document ceiling", () => {
  const { model } = loadDemo();
  const quiet = windowFor(model, "2026-10-20T00:00:00Z", "7d");
  const slots = buildSlots(model, quiet);
  const ceiling = effectiveCeiling(model, quiet);
  assert.ok(ceiling >= model.doc.scale.churnCeiling);
  for (const slot of slots) {
    assert.equal(slot.level, levelOf(slot.churn, ceiling));
    for (const entry of slot.byRef.values()) {
      assert.equal(entry.level, levelOf(entry.churn, ceiling));
    }
  }
});
