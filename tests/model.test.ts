import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDoc, buildModel, freezeDoc } from "../src/core/model.ts";
import { clone, loadDemo, rawDemo } from "./fixtures.ts";

test("model: rejects an unknown schema version", () => {
  const result = parseDoc({ ...(rawDemo() as object), schemaVersion: 2 });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.errors[0], /schemaVersion/);
});

test("model: rejects a different tool id", () => {
  const result = parseDoc({ ...(rawDemo() as object), tool: "bitwave" });
  assert.equal(result.ok, false);
});

test("model: rejects duplicate shas", () => {
  const raw = clone(rawDemo()) as { commits: Array<{ sha: string }> };
  raw.commits[1].sha = raw.commits[0].sha;
  const result = parseDoc(raw);
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.errors.some((error) => /duplicated/.test(error)));
});

test("model: rejects a tag that does not reference a commit", () => {
  const raw = clone(rawDemo()) as { tags: Array<{ sha: string }> };
  raw.tags[0].sha = "0".repeat(40);
  const result = parseDoc(raw);
  assert.equal(result.ok, false);
});

test("model: rejects a document with two trunks", () => {
  const raw = clone(rawDemo()) as { refs: Array<{ kind: string }> };
  raw.refs[1].kind = "trunk";
  const result = parseDoc(raw);
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.errors.some((error) => /exactly one ref/.test(error)));
});

test("model: unknown commit refs are warnings, not failures", () => {
  const raw = clone(rawDemo()) as { commits: Array<{ refs: string[] }> };
  raw.commits[0].refs = ["ghost"];
  const result = parseDoc(raw);
  assert.equal(result.ok, true);
  if (result.ok) assert.ok(result.warnings.some((warning) => /unknown ref/.test(warning)));
});

test("model: the validated document is deeply frozen", () => {
  const { doc } = loadDemo();
  assert.ok(Object.isFrozen(doc));
  assert.ok(Object.isFrozen(doc.refs));
  assert.ok(Object.isFrozen(doc.refs[0]));
  assert.ok(Object.isFrozen(doc.commits[0]));
  assert.throws(() => {
    (doc.repo as { id: string }).id = "mutated";
  });
  assert.throws(() => {
    (doc.commits[0] as { subject: string }).subject = "mutated";
  });
});

test("model: buildModel indexes every commit and ref", () => {
  const { doc, model } = loadDemo();
  assert.equal(model.commitBySha.size, doc.commits.length);
  assert.equal(model.startMs, Date.parse(doc.repo.span.from));
  assert.equal(model.snapshotMs, Date.parse(doc.repo.snapshotAt));
  let attributed = 0;
  for (const ref of doc.refs) attributed += model.commitsByRef.get(ref.id)?.length ?? 0;
  assert.equal(
    attributed,
    doc.commits.filter((commit) => commit.refs.length > 0).length
  );
  for (const list of model.commitsByRef.values()) {
    for (let i = 1; i < list.length; i++) {
      assert.ok(Date.parse(list[i].time) >= Date.parse(list[i - 1].time));
    }
  }
});

test("model: a rebuilt model is equivalent to the first", () => {
  const { doc } = loadDemo();
  const a = buildModel(doc);
  const b = buildModel(doc);
  assert.equal(a.commitBySha.size, b.commitBySha.size);
  assert.equal(a.commitsByRef.get("main")?.length, b.commitsByRef.get("main")?.length);
});

test("model: freezeDoc is idempotent", () => {
  const { doc } = loadDemo();
  const again = freezeDoc(doc);
  assert.equal(again, doc);
});
