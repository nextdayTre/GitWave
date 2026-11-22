import { test } from "node:test";
import assert from "node:assert/strict";
import { splitModules } from "../src/core/split.ts";
import { loadDemo } from "./fixtures.ts";

test("split: a merged filter splits into the branches that landed", () => {
  const { model } = loadDemo();
  const seeds = splitModules(model, "merged", "ref");
  assert.ok(seeds.length >= 2);
  const byName = new Map(seeds.map((seed) => [seed.name, seed]));
  assert.equal(byName.get("docs/site")?.count, 15);
  assert.equal(byName.get("chore/ci")?.count, 4);
  assert.equal(byName.get("docs/site")?.query, "ref:docs/site");
  for (const seed of seeds) assert.match(seed.query, /^ref:/);
});

test("split: an author filter splits by ref", () => {
  const { model } = loadDemo();
  const seeds = splitModules(model, "author:maya", "ref");
  assert.ok(seeds.length >= 2);
  for (const seed of seeds) {
    assert.match(seed.query, /^ref:/);
    assert.ok(seed.count > 0);
  }
});

test("split: all commits split into the people who wrote them", () => {
  const { model } = loadDemo();
  const seeds = splitModules(model, "", "author", 4);
  assert.equal(seeds.length, 3, "the demo has three authors");
  assert.equal(seeds[0].name, "Maya Chen");
  assert.equal(seeds[0].count, 87);
  assert.match(seeds[0].query, /^author:/);
  const agent = seeds.find((seed) => seed.name === "dsh/lead");
  assert.ok(agent);
  assert.equal(agent.count, 46);
});

test("split: the limit and the color slots are respected", () => {
  const { model } = loadDemo();
  const seeds = splitModules(model, "", "author", 2);
  assert.equal(seeds.length, 2);
  for (const seed of seeds) {
    assert.ok(seed.colorKey >= 0 && seed.colorKey <= 5);
  }
});
