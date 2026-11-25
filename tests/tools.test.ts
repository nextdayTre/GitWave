import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildModel, parseDoc } from "../src/core/model.ts";
import {
  commitDetailTool,
  compareRefsTool,
  listRefsTool,
  repoSummary,
  searchCommitsTool,
  tensionReportTool,
} from "../src/core/tools.ts";

const raw = JSON.parse(
  readFileSync(new URL("../src/data/demo.gitwave.json", import.meta.url), "utf8")
);
const parsed = parseDoc(raw);
assert.ok(parsed.ok);
const model = buildModel(parsed.doc);

test("tools: repoSummary reports accurate demo counts and top authors", () => {
  const summary = repoSummary(model);
  assert.equal(summary.id, "orbit-notes");
  assert.equal(summary.counts.commits, 168);
  assert.equal(summary.counts.refs, 6);
  assert.equal(summary.counts.agentCommits, 46);
  assert.equal(summary.counts.openPrs, 3);
  assert.equal(summary.counts.stalePrs, 1);
  assert.equal(summary.releases.length, 3);
  assert.equal(summary.topAuthors[0].name, "Maya Chen");
});

test("tools: listRefsTool derives churn, agent presence and PR tension", () => {
  const refs = listRefsTool(model);
  assert.equal(refs.length, 6);
  const agentRef = refs.find((r) => r.id === "agent/refactor-store");
  assert.ok(agentRef);
  assert.equal(agentRef.hasAgent, true);
  assert.equal(agentRef.pr?.number, 15);
  assert.equal(agentRef.pr?.stale, true);
  assert.ok((agentRef.pr?.tension ?? 0) > 0.8);
});

test("tools: searchCommitsTool and commitDetailTool resolve matching commits", () => {
  const res = searchCommitsTool(model, "author:maya", 5);
  assert.equal(res.total, 87);
  assert.equal(res.returned, 5);
  const firstSha = res.commits[0].sha;
  const detail = commitDetailTool(model, firstSha.slice(0, 7));
  assert.ok(detail);
  assert.equal(detail.sha, firstSha);
  assert.equal(detail.author.name, "Maya Chen");
  assert.equal(commitDetailTool(model, "deadbeef0000"), null);
});

test("tools: tensionReportTool ranks open PRs and includes centroid", () => {
  const report = tensionReportTool(model);
  assert.equal(report.openCount, 3);
  assert.equal(report.staleCount, 1);
  assert.ok(report.centroid);
  assert.equal(report.prs[0].number, 15);
});

test("tools: compareRefsTool compares trunk and branch cleanly", () => {
  const cmp = compareRefsTool(model, "main", "agent/refactor-store");
  assert.ok(cmp);
  assert.equal(cmp.base, "main");
  assert.equal(cmp.head, "agent/refactor-store");
  assert.equal(cmp.onlyInHead, 24);
  assert.ok(cmp.headOnlySample.length > 0);
  assert.equal(compareRefsTool(model, "main", "missing"), null);
});
