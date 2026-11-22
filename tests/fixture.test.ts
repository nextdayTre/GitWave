import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadDemo, rawDemo } from "./fixtures.ts";

test("fixture: committed copies are byte-identical", () => {
  const bundled = readFileSync(new URL("../src/data/demo.gitwave.json", import.meta.url), "utf8");
  const example = readFileSync(new URL("../examples/demo.gitwave.json", import.meta.url), "utf8");
  assert.equal(bundled, example);
});

test("fixture: shape and story are pinned", () => {
  const { doc } = loadDemo();
  assert.equal(doc.repo.id, "orbit-notes");
  assert.equal(doc.repo.name, "Orbit Notes");
  assert.equal(doc.repo.snapshotAt, "2026-11-01T18:00:00Z");
  assert.equal(doc.schemaVersion, 1);
  assert.equal(doc.tool, "gitwave");
  assert.equal(doc.commits.length, 168);
  assert.equal(doc.refs.length, 6);
  assert.equal(doc.tags.length, 3);
  assert.equal(doc.commits.filter((commit) => commit.merge).length, 2);
  assert.deepEqual(
    doc.tags.map((tag) => tag.name),
    ["v0.9.0", "v1.0.0", "v1.1.0"]
  );
  assert.deepEqual(
    doc.refs.map((ref) => ref.id),
    ["main", "feat/editor", "fix/sync-race", "agent/refactor-store", "docs/site", "chore/ci"]
  );
  assert.equal(doc.refs.filter((ref) => ref.kind === "trunk").length, 1);
  assert.ok(doc.commits.some((commit) => commit.author.kind === "agent"));
  const open = doc.refs.filter((ref) => ref.pr && ["open", "draft"].includes(ref.pr.state));
  assert.equal(open.length, 3);
  assert.deepEqual(open.map((ref) => ref.pr?.number).sort((a, b) => (a ?? 0) - (b ?? 0)), [12, 14, 15]);
  assert.ok(open.some((ref) => ref.pr?.conflicts));
  assert.ok(open.some((ref) => ref.pr?.draft));
});

test("fixture: every parent and tag references a committed sha", () => {
  const { doc } = loadDemo();
  const shas = new Set(doc.commits.map((commit) => commit.sha));
  for (const commit of doc.commits) {
    for (const parent of commit.parents) {
      assert.ok(shas.has(parent), `missing parent ${parent} for ${commit.sha}`);
    }
  }
  for (const tag of doc.tags) assert.ok(shas.has(tag.sha));
  for (const ref of doc.refs) assert.ok(shas.has(ref.tip));
});

test("fixture: shas are unique, lowercase and 40 chars", () => {
  const { doc } = loadDemo();
  const seen = new Set<string>();
  for (const commit of doc.commits) {
    assert.match(commit.sha, /^[0-9a-f]{40}$/);
    assert.ok(!seen.has(commit.sha), `duplicate sha ${commit.sha}`);
    seen.add(commit.sha);
  }
});

test("fixture: raw document is stable JSON with the documented top-level keys", () => {
  const raw = rawDemo() as Record<string, unknown>;
  assert.deepEqual(Object.keys(raw), [
    "schemaVersion",
    "tool",
    "generatedBy",
    "repo",
    "refs",
    "commits",
    "tags",
    "scale",
  ]);
});
