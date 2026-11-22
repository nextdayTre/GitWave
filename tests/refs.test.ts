import { test } from "node:test";
import assert from "node:assert/strict";
import {
  refChurn,
  openPrs,
  prCentroid,
  mergeMarkers,
  releaseFlags,
  commitsSince,
  refHasAgent,
  STALE_DAYS,
} from "../src/core/refs.ts";
import { loadDemo } from "./fixtures.ts";

test("refs: churn and agent authorship are derived from commits", () => {
  const { model } = loadDemo();
  assert.ok(refChurn(model, "main") > 0);
  assert.ok(refChurn(model, "feat/editor") > 0);
  assert.equal(refHasAgent(model, "feat/editor"), false);
  assert.equal(refHasAgent(model, "agent/refactor-store"), true);
});

test("refs: exactly the open and draft PRs become tension", () => {
  const { model } = loadDemo();
  const prs = openPrs(model);
  assert.equal(prs.length, 3);
  assert.deepEqual(prs.map((pr) => pr.pr.number).sort((a, b) => a - b), [12, 14, 15]);
  for (let i = 1; i < prs.length; i++) {
    assert.ok(prs[i - 1].tension >= prs[i].tension, "sorted by tension, descending");
  }
});

test("refs: ages, staleness and agent authorship match the story", () => {
  const { model } = loadDemo();
  const prs = openPrs(model);
  const agent = prs.find((pr) => pr.pr.number === 15);
  assert.ok(agent);
  assert.equal(agent.agentAuthored, true);
  assert.ok(agent.ageDays > STALE_DAYS);
  assert.equal(agent.stale, true);
  assert.equal(agent.amountNorm, 1);

  const fix = prs.find((pr) => pr.pr.number === 14);
  assert.ok(fix);
  assert.equal(fix.stale, false);
  assert.ok(fix.ageDays > 0);
  assert.ok(fix.amountNorm > 0 && fix.amountNorm < 1);
});

test("refs: the tension centroid stays inside the pad", () => {
  const { model } = loadDemo();
  const centroid = prCentroid(openPrs(model));
  assert.ok(centroid);
  assert.ok(centroid.x >= 0 && centroid.x <= 1.2);
  assert.ok(centroid.y >= 0 && centroid.y <= 1);
  assert.ok(centroid.w > 0);
  assert.equal(prCentroid([]), null);
});

test("refs: merges and releases are found inside a window", () => {
  const { model } = loadDemo();
  const all = mergeMarkers(model, model.startMs, model.snapshotMs);
  assert.equal(all.length, 2);
  const last30 = mergeMarkers(model, model.snapshotMs - 30 * 86400000, model.snapshotMs);
  assert.equal(last30.length, 1);
  assert.equal(releaseFlags(model, model.startMs, model.snapshotMs).length, 3);
});

test("refs: commitsSince counts strictly newer commits", () => {
  const { model } = loadDemo();
  const since = Date.parse("2026-10-01T00:00:00Z");
  const newer = commitsSince(model, since);
  assert.ok(newer.length > 0);
  assert.ok(newer.every((commit) => Date.parse(commit.time) > since));
  assert.equal(commitsSince(model, model.snapshotMs).length, 0);
  assert.equal(commitsSince(model, Number.NaN).length, 0);
});
