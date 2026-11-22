#!/usr/bin/env node
/**
 * make-demo.mjs — the deterministic demo history for GitWave.
 *
 * Writes `src/data/demo.gitwave.json` (bundled into the artifact) and
 * `examples/demo.gitwave.json` (byte-identical, for humans and imports).
 *
 * The story: "Orbit Notes", a small note-taking app, May–November 2026.
 * Six refs, two merges, three releases, four pull requests (two open, one
 * draft, one merged) and a third of trunk authored by an agent.
 *
 * Determinism: fixed seed, fixed snapshot time, no clock reads, no locale
 * formatting. `--check` regenerates in memory and fails when either committed
 * file has drifted.
 *
 * RUN: node tools/make-demo.mjs [--check]
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const TARGETS = [
  resolve(ROOT, "src/data/demo.gitwave.json"),
  resolve(ROOT, "examples/demo.gitwave.json"),
];

const DAY = 86400000;
const SNAPSHOT = Date.parse("2026-11-01T18:00:00Z");
const START = Date.parse("2026-05-04T09:12:00Z");

/* ---- deterministic PRNG (mulberry32) ------------------------------------- */

function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(0x6b17a5e);
const pick = (list) => list[Math.floor(rand() * list.length)];
const between = (a, b) => a + rand() * (b - a);

const HEX = "0123456789abcdef";
function makeSha(used) {
  for (;;) {
    let s = "";
    for (let i = 0; i < 40; i++) s += HEX[Math.floor(rand() * 16)];
    if (!used.has(s)) {
      used.add(s);
      return s;
    }
  }
}

const iso = (ms) => new Date(ms).toISOString().replace(".000Z", "Z");

/* ---- subjects ------------------------------------------------------------ */

const SUBJECTS = {
  feat: [
    "feat: inline marks in the editor",
    "feat: slash menu for block insertion",
    "feat: keyboard-first note switcher",
    "feat: backlinks panel on the note page",
    "feat: drag to reorder blocks",
    "feat: offline cache for recent notes",
    "feat: command palette search",
    "feat: sync status in the sidebar",
    "feat: markdown paste normaliser",
    "feat: tag autocomplete in the editor",
  ],
  fix: [
    "fix: caret jumps after paste",
    "fix: sync loop on reconnect",
    "fix: stale note title in the header",
    "fix: focus lost when the palette closes",
    "fix: debounce the search field",
    "fix: scroll position after block delete",
    "fix: empty state flicker on first load",
    "fix: escape closes the wrong overlay",
    "fix: duplicate tag rendering",
  ],
  docs: [
    "docs: note model and sync rules",
    "docs: local-first tradeoffs",
    "docs: keyboard map reference",
    "docs: release checklist",
    "docs: editor extension guide",
  ],
  chore: [
    "chore: pin formatter and lint config",
    "chore: split the bundle by route",
    "chore: cache the test runner",
    "chore: drop the unused polyfill",
    "chore: nightly dependency audit",
  ],
  agent: [
    "agent: extract the note store from the app shell",
    "agent: add store invariants and tests",
    "agent: normalise the store error surface",
    "agent: move sync scheduling into the store",
    "agent: document the store boundary",
    "agent: remove the duplicated cache layer",
    "agent: tighten the store types",
    "agent: add a migration for the store shape",
  ],
  release: [
    "release: v0.9.0",
    "release: v1.0.0",
    "release: v1.1.0",
  ],
};

const AUTHORS = {
  maya: { name: "Maya Chen", kind: "human" },
  ravi: { name: "Ravi Patel", kind: "human" },
  agent: {
    name: "dsh/lead",
    kind: "agent",
    agent: { runtime: "dsh", model: "flash" },
  },
};

/* ---- ref plan ------------------------------------------------------------ */

const REFS = [
  {
    id: "main",
    name: "main",
    kind: "trunk",
    base: null,
    colorKey: 0,
    start: START,
    end: Date.parse("2026-10-30T16:40:00Z"),
    regular: 98,
    authors: ["maya", "maya", "maya", "ravi", "agent"],
    subjects: "mixed",
  },
  {
    id: "chore/ci",
    name: "chore/ci",
    kind: "branch",
    base: "main",
    colorKey: 5,
    start: Date.parse("2026-07-08T10:20:00Z"),
    end: Date.parse("2026-07-13T17:05:00Z"),
    regular: 4,
    authors: ["maya"],
    subjects: "chore",
    mergeAt: Date.parse("2026-07-14T09:30:00Z"),
    pr: {
      number: 4,
      title: "CI: cache the test runner",
      state: "merged",
      review: "approved",
      checks: "passing",
      conflicts: false,
      draft: false,
    },
  },
  {
    id: "docs/site",
    name: "docs/site",
    kind: "branch",
    base: "main",
    colorKey: 4,
    start: Date.parse("2026-06-20T10:05:00Z"),
    end: Date.parse("2026-10-26T14:10:00Z"),
    regular: 15,
    authors: ["ravi", "ravi", "maya"],
    subjects: "docs",
    mergeAt: Date.parse("2026-10-26T16:00:00Z"),
    pr: {
      number: 9,
      title: "Docs: local-first guide and release notes",
      state: "merged",
      review: "approved",
      checks: "passing",
      conflicts: false,
      draft: false,
    },
  },
  {
    id: "agent/refactor-store",
    name: "agent/refactor-store",
    kind: "branch",
    base: "main",
    colorKey: 3,
    start: Date.parse("2026-09-02T09:15:00Z"),
    end: Date.parse("2026-10-15T11:20:00Z"),
    regular: 24,
    authors: ["agent", "agent", "agent"],
    subjects: "agent",
    pr: {
      number: 15,
      title: "Agent: extract the note store from the app shell",
      state: "draft",
      review: "none",
      checks: "pending",
      conflicts: false,
      draft: true,
    },
  },
  {
    id: "feat/editor",
    name: "feat/editor",
    kind: "branch",
    base: "main",
    colorKey: 1,
    start: Date.parse("2026-09-08T14:40:00Z"),
    end: Date.parse("2026-10-20T17:30:00Z"),
    regular: 19,
    authors: ["maya", "maya", "maya"],
    subjects: "feat",
    pr: {
      number: 12,
      title: "Editor: inline marks and the slash menu",
      state: "open",
      review: "required",
      checks: "passing",
      conflicts: false,
      draft: false,
    },
  },
  {
    id: "fix/sync-race",
    name: "fix/sync-race",
    kind: "branch",
    base: "main",
    colorKey: 2,
    start: Date.parse("2026-10-12T09:40:00Z"),
    end: Date.parse("2026-10-24T15:15:00Z"),
    regular: 6,
    authors: ["ravi"],
    subjects: "fix",
    pr: {
      number: 14,
      title: "Fix: sync race when an offline note resumes",
      state: "open",
      review: "changes_requested",
      checks: "failing",
      conflicts: true,
      draft: false,
    },
  },
];

/* ---- build commits ------------------------------------------------------- */

const usedShas = new Set();
const byRef = new Map();

function makeTimes(start, end, count) {
  const times = [];
  for (let i = 0; i < count; i++) {
    const u = (i + rand() * 0.72) / count;
    const t = Math.round((start + (end - start) * u) / 60000) * 60000;
    times.push(t);
  }
  times.sort((a, b) => a - b);
  for (let i = 1; i < times.length; i++) {
    if (times[i] <= times[i - 1]) times[i] = times[i - 1] + 60000;
  }
  return times;
}

function churnFor(scaleBoost = 1) {
  const base = Math.exp(1.35 + 1.12 * rand()) * scaleBoost;
  return {
    insertions: Math.max(1, Math.round(base * (0.35 + rand() * 1.15))),
    deletions: Math.round(base * (0.08 + rand() * 0.4)),
    files: Math.max(1, Math.round(1 + rand() * 7)),
  };
}

function subjectFor(kind, index) {
  if (kind === "mixed") {
    const roll = rand();
    if (roll < 0.42) return pick(SUBJECTS.feat);
    if (roll < 0.72) return pick(SUBJECTS.fix);
    if (roll < 0.86) return pick(SUBJECTS.docs);
    return pick(SUBJECTS.chore);
  }
  if (kind === "agent") return SUBJECTS.agent[index % SUBJECTS.agent.length];
  if (kind === "docs") return SUBJECTS.docs[index % SUBJECTS.docs.length];
  if (kind === "chore") return SUBJECTS.chore[index % SUBJECTS.chore.length];
  if (kind === "feat") return SUBJECTS.feat[index % SUBJECTS.feat.length];
  if (kind === "fix") return SUBJECTS.fix[index % SUBJECTS.fix.length];
  return pick(SUBJECTS.feat);
}

for (const ref of REFS) {
  const times = makeTimes(ref.start, ref.end, ref.regular);
  const commits = [];
  for (let i = 0; i < ref.regular; i++) {
    const authorKey =
      ref.authors[Math.floor(rand() * ref.authors.length)] ?? ref.authors[0];
    const author = AUTHORS[authorKey];
    const kind = ref.subjects === "agent" ? "agent" : ref.subjects;
    const churn = churnFor(ref.id === "main" && rand() < 0.06 ? 2.4 : 1);
    commits.push({
      sha: makeSha(usedShas),
      parents: [],
      time: times[i],
      author: { name: author.name, kind: author.kind },
      agent: author.agent ?? null,
      subject: subjectFor(kind, i),
      insertions: churn.insertions,
      deletions: churn.deletions,
      files: churn.files,
      refs: [ref.id],
      merge: false,
    });
  }
  byRef.set(ref.id, commits);
}

/* merge commits on the trunk */
for (const ref of REFS) {
  if (!ref.mergeAt) continue;
  const main = byRef.get("main");
  const branch = byRef.get(ref.id);
  const merge = {
    sha: makeSha(usedShas),
    parents: [],
    time: ref.mergeAt,
    author: { name: "Maya Chen", kind: "human" },
    agent: null,
    subject: `Merge branch '${ref.name}'`,
    insertions: 0,
    deletions: 0,
    files: 0,
    refs: ["main"],
    merge: true,
  };
  main.push(merge);
  // the merge is the docs/chore branch's lifecycle end, so keep the tip near it
  branch.tip = branch[branch.length - 1].sha;
  branch.mergeSha = merge.sha;
}

/* parents: previous commit on the same ref, or the trunk tip at fork time */
const allCommits = [];
for (const [refId, commits] of byRef) {
  commits.sort((a, b) => a.time - b.time || a.sha.localeCompare(b.sha));
  allCommits.push(...commits);
}
allCommits.sort((a, b) => a.time - b.time || a.sha.localeCompare(b.sha));

const mainCommits = byRef.get("main");
for (const ref of REFS) {
  if (ref.id === "main") continue;
  const commits = byRef.get(ref.id);
  let trunkBefore = null;
  for (const c of mainCommits) {
    if (c.time < commits[0].time) trunkBefore = c;
    else break;
  }
  commits[0].parents = trunkBefore ? [trunkBefore.sha] : [];
  for (let i = 1; i < commits.length; i++) {
    commits[i].parents = [commits[i - 1].sha];
  }
}
for (let i = 1; i < mainCommits.length; i++) {
  if (mainCommits[i].merge) continue;
  mainCommits[i].parents = [mainCommits[i - 1].sha];
}
mainCommits[0].parents = [];
for (const ref of REFS) {
  if (!ref.mergeAt) continue;
  const merge = mainCommits.find((c) => c.merge && c.time === ref.mergeAt);
  const branch = byRef.get(ref.id);
  const tip = branch[branch.length - 1];
  const previous = mainCommits
    .filter((c) => c.time < merge.time)
    .slice(-1)[0];
  merge.parents = previous ? [previous.sha, tip.sha] : [tip.sha];
}

/* ---- tags ---------------------------------------------------------------- */

function mainCommitNear(ms) {
  let best = mainCommits[0];
  for (const c of mainCommits) {
    if (c.merge) continue;
    if (Math.abs(c.time - ms) < Math.abs(best.time - ms)) best = c;
  }
  return best;
}

const TAGS = [
  { name: "v0.9.0", near: Date.parse("2026-08-12T00:00:00Z") },
  { name: "v1.0.0", near: Date.parse("2026-09-30T00:00:00Z") },
  { name: "v1.1.0", near: Date.parse("2026-10-28T00:00:00Z") },
].map((t) => {
  const c = mainCommitNear(t.near);
  return { name: t.name, sha: c.sha, time: iso(c.time) };
});

/* release commits carry weight — a release is a big landing */
for (const tag of TAGS) {
  const commit = allCommits.find((c) => c.sha === tag.sha);
  if (!commit) continue;
  commit.insertions = Math.max(commit.insertions, 180);
  commit.deletions = Math.max(commit.deletions, 40);
  commit.files = Math.max(commit.files, 12);
  commit.subject = `release: ${tag.name}`;
}

/* ---- refs ---------------------------------------------------------------- */

const refs = REFS.map((ref) => {
  const commits = byRef.get(ref.id);
  const tip = commits[commits.length - 1];
  const pr = ref.pr
    ? {
        ...ref.pr,
        mergedAt: ref.mergeAt ? iso(ref.mergeAt) : null,
      }
    : null;
  return {
    id: ref.id,
    name: ref.name,
    kind: ref.kind,
    base: ref.base,
    tip: tip.sha,
    createdAt: iso(commits[0].time),
    mergedAt: ref.mergeAt ? iso(ref.mergeAt) : null,
    colorKey: ref.colorKey,
    pr,
  };
});

/* ---- scale --------------------------------------------------------------- */

const nonMerge = allCommits.filter((c) => !c.merge);
const churns = nonMerge
  .map((c) => c.insertions + c.deletions)
  .sort((a, b) => a - b);
const p95 = churns[Math.min(churns.length - 1, Math.floor(churns.length * 0.95))];
const ceiling = Math.max(40, p95);

/* ---- document ------------------------------------------------------------ */

const doc = {
  schemaVersion: 1,
  tool: "gitwave",
  generatedBy: "tools/make-demo.mjs",
  repo: {
    id: "orbit-notes",
    name: "Orbit Notes",
    defaultRef: "main",
    snapshotAt: iso(SNAPSHOT),
    span: { from: iso(allCommits[0].time), to: iso(SNAPSHOT) },
  },
  refs,
  commits: allCommits.map((c) => ({
    sha: c.sha,
    parents: c.parents,
    time: iso(c.time),
    author: c.author,
    agent: c.agent,
    subject: c.subject,
    insertions: c.insertions,
    deletions: c.deletions,
    files: c.files,
    refs: c.refs,
    merge: c.merge,
  })),
  tags: TAGS,
  scale: { churnCeiling: Math.round(ceiling), levels: 16 },
};

const text = JSON.stringify(doc, null, 2) + "\n";

if (process.argv.includes("--check")) {
  let failed = false;
  for (const target of TARGETS) {
    let current = null;
    try {
      current = readFileSync(target, "utf8");
    } catch {
      current = null;
    }
    if (current !== text) {
      failed = true;
      console.error(`x ${target} is stale — run: node tools/make-demo.mjs`);
    }
  }
  if (failed) process.exit(1);
  console.log("demo fixture is current (2 files, byte-identical)");
  process.exit(0);
}

for (const target of TARGETS) {
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, text);
}
const kb = (Buffer.byteLength(text) / 1024).toFixed(1);
console.log(
  `wrote demo.gitwave.json — ${doc.commits.length} commits, ${doc.refs.length} refs, ${doc.tags.length} tags, ${kb} KB`
);
