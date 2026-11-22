import { test } from "node:test";
import assert from "node:assert/strict";
import { searchCommits } from "../src/core/search.ts";
import { loadDemo } from "./fixtures.ts";

test("search: an empty query is not a filter", () => {
  const { model } = loadDemo();
  const search = searchCommits(model, "   ");
  assert.equal(search.query, "");
  assert.equal(search.shas, null);
  assert.equal(search.count, 0);
  assert.deepEqual(search.matches, []);
});

test("search: author tokens match the author name and the agent kind", () => {
  const { model } = loadDemo();
  const maya = searchCommits(model, "author:maya");
  assert.equal(maya.count, 87);
  assert.ok(maya.matches.every((commit) => commit.author.name === "Maya Chen"));
  assert.equal(searchCommits(model, "author:ravi").count, 35);
  assert.equal(searchCommits(model, "agent").count, 46);
  assert.equal(searchCommits(model, "is:agent").count, 46);
  assert.equal(searchCommits(model, "kind:human").count, 122);
});

test("search: ref and pr resolve the same branch", () => {
  const { model } = loadDemo();
  assert.equal(searchCommits(model, "ref:editor").count, 19);
  assert.equal(searchCommits(model, "pr:12").count, 19);
  assert.equal(searchCommits(model, "ref:sync").count, 6);
  assert.equal(searchCommits(model, "pr:15").count, 24);
  assert.equal(searchCommits(model, "pr:9").count, 15);
});

test("search: merge is a state token", () => {
  const { model } = loadDemo();
  const merges = searchCommits(model, "merge");
  assert.equal(merges.count, 2);
  assert.ok(merges.matches.every((commit) => commit.merge));
});

test("search: date bounds are inclusive days", () => {
  const { model } = loadDemo();
  const after = searchCommits(model, "after:2026-10-01");
  assert.equal(after.count, 43);
  assert.ok(after.matches.every((commit) => Date.parse(commit.time) >= Date.parse("2026-10-01T00:00:00Z")));
  const before = searchCommits(model, "before:2026-06-01");
  assert.equal(before.count, 16);
  assert.ok(before.matches.every((commit) => Date.parse(commit.time) <= Date.parse("2026-06-01T23:59:59Z")));
});

test("search: free text searches the subject, author, ref and PR", () => {
  const { model } = loadDemo();
  assert.equal(searchCommits(model, "sync").count, 22);
  assert.equal(searchCommits(model, "subject:sync").count, 17);
  assert.equal(searchCommits(model, "sha:5e4093b").count, 1);
});

test("search: tokens are ANDed", () => {
  const { model } = loadDemo();
  assert.equal(searchCommits(model, "author:maya ref:editor").count, 19);
  assert.equal(searchCommits(model, "author:ravi ref:editor").count, 0);
});

test("search: a query with no matches is an empty set, not no filter", () => {
  const { model } = loadDemo();
  const search = searchCommits(model, "zzzz-not-a-thing");
  assert.equal(search.count, 0);
  assert.ok(search.shas instanceof Set);
  assert.equal(search.shas?.size, 0);
});

test("search: merged is the integration history", () => {
  const { model } = loadDemo();
  const merged = searchCommits(model, "merged");
  assert.equal(merged.count, 21);
  assert.ok(
    merged.matches.every(
      (commit) =>
        commit.merge ||
        commit.refs.some((id) => model.refsById.get(id)?.mergedAt != null)
    )
  );
});

test("search: results are chronological and the query is capped", () => {
  const { model } = loadDemo();
  const search = searchCommits(model, "agent");
  for (let i = 1; i < search.matches.length; i++) {
    assert.ok(Date.parse(search.matches[i].time) >= Date.parse(search.matches[i - 1].time));
  }
  const long = searchCommits(model, "a".repeat(400));
  assert.equal(long.query.length, 120);
});
