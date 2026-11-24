#!/usr/bin/env node
/**
 * export-repo.mjs — read-only local Git repository → `.gitwave.json` exporter.
 *
 * Exports branches, tags, commits, churn metrics, and (with `--patches`) real
 * file-level unified diffs so you can open any local Git repo inside
 * `gitwave.html` and inspect diffs by double-clicking any slot.
 *
 * USAGE:
 *   node tools/export-repo.mjs [repoPath] [--patches] [--limit 300] [--out file.gitwave.json]
 *
 * Strictly read-only: only runs `git rev-parse`, `git for-each-ref`, `git log`,
 * and `git show`. Never modifies the repository.
 */

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";

const args = process.argv.slice(2);
let repoArg = ".";
let includePatches = false;
let limit = 300;
let outFile = null;

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--patches" || a === "-p") includePatches = true;
  else if (a === "--limit" && args[i + 1]) limit = Math.max(1, Math.min(2000, Number(args[++i]) || 300));
  else if ((a === "--out" || a === "-o") && args[i + 1]) outFile = args[++i];
  else if (!a.startsWith("-")) repoArg = a;
}

const cwd = resolve(repoArg);

function git(gitArgs) {
  return execFileSync("git", gitArgs, {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
}

function tryGit(gitArgs) {
  try {
    return git(gitArgs);
  } catch {
    return "";
  }
}

const topLevel = git(["rev-parse", "--show-toplevel"]).trim();
const repoName = basename(topLevel);
const repoId = repoName.toLowerCase().replace(/[^a-z0-9-]+/g, "-") || "local-repo";

/* Discover local branches */
const rawBranches = git([
  "for-each-ref",
  "--format=%(refname:short)%09%(objectname)%09%(committerdate:iso-strict)",
  "refs/heads",
])
  .trim()
  .split(/\r?\n/)
  .filter(Boolean);

if (!rawBranches.length) {
  console.error("x No local branches found in", topLevel);
  process.exit(1);
}

const branchEntries = rawBranches.slice(0, 32).map((line) => {
  const [name, tip, date] = line.split("\t");
  return { name, tip, date };
});

const headRef = tryGit(["symbolic-ref", "--short", "HEAD"]).trim();
const trunkEntry =
  branchEntries.find((b) => b.name === "main") ||
  branchEntries.find((b) => b.name === "master") ||
  branchEntries.find((b) => b.name === headRef) ||
  branchEntries[0];

/* Collect commits across visible branches */
const commitMap = new Map();
const refShas = new Map();

for (const branch of branchEntries) {
  const logOut = git([
    "log",
    branch.name,
    `-n`,
    String(limit),
    "--date=iso-strict",
    "--numstat",
    "--format=COMMIT%x1f%H%x1f%P%x1f%aI%x1f%an%x1f%s",
  ]);

  const blocks = logOut.split("COMMIT\x1f").slice(1);
  const shasForRef = [];

  for (const block of blocks) {
    const lines = block.split(/\r?\n/);
    const header = lines[0];
    const [sha, parentsRaw, isoTime, authorName, subject] = header.split("\x1f");
    if (!sha || !/^[0-9a-f]{40}$/.test(sha)) continue;
    shasForRef.push(sha);

    if (commitMap.has(sha)) {
      const existing = commitMap.get(sha);
      if (!existing.refs.includes(branch.name)) existing.refs.push(branch.name);
      continue;
    }

    let insertions = 0;
    let deletions = 0;
    let files = 0;
    const fileStats = [];

    for (let i = 1; i < lines.length; i++) {
      const l = lines[i].trim();
      if (!l) continue;
      const parts = l.split("\t");
      if (parts.length < 3) continue;
      const ins = parts[0] === "-" ? 0 : Number(parts[0]) || 0;
      const del = parts[1] === "-" ? 0 : Number(parts[1]) || 0;
      const filePath = parts.slice(2).join("\t");
      insertions += ins;
      deletions += del;
      files += 1;
      fileStats.push({ path: filePath, status: "modified", insertions: ins, deletions: del });
    }

    const parents = parentsRaw ? parentsRaw.trim().split(/\s+/).filter(Boolean) : [];
    const isAgent = /\b(bot|agent|claude|gemini|copilot|codex)\b/i.test(authorName);

    commitMap.set(sha, {
      sha,
      parents,
      time: new Date(isoTime).toISOString().replace(".000Z", "Z"),
      author: { name: authorName || "Unknown", kind: isAgent ? "agent" : "human" },
      agent: isAgent ? { runtime: "git", model: authorName } : null,
      subject: subject || "(no subject)",
      insertions,
      deletions,
      files,
      refs: [branch.name],
      merge: parents.length > 1,
      _fileStats: fileStats,
    });
  }

  refShas.set(branch.name, shasForRef);
}

/* Keep only parents present in the exported commit set */
const validShas = new Set(commitMap.keys());
const commits = [...commitMap.values()]
  .sort((a, b) => Date.parse(a.time) - Date.parse(b.time) || a.sha.localeCompare(b.sha));

function parsePatchByFile(rawDiff) {
  const map = new Map();
  if (!rawDiff) return map;
  const chunks = rawDiff.split(/^diff --git /m).slice(1);
  for (const chunk of chunks) {
    const firstLineEnd = chunk.indexOf("\n");
    const firstLine = firstLineEnd >= 0 ? chunk.slice(0, firstLineEnd) : chunk;
    const match = firstLine.match(/^a\/(.+?) b\/(.+)$/);
    const path = match ? match[2] : firstLine.trim();
    const full = `diff --git ${chunk}`.trimEnd();
    let status = "modified";
    if (/^new file mode /m.test(full)) status = "added";
    else if (/^deleted file mode /m.test(full)) status = "deleted";
    else if (/^rename from /m.test(full)) status = "renamed";
    map.set(path, { status, patch: full.slice(0, 32768) });
  }
  return map;
}

/* Optionally attach real per-file unified diff patches */
for (const c of commits) {
  c.parents = c.parents.filter((p) => validShas.has(p));
  if (includePatches && !c.merge && c._fileStats.length > 0) {
    const rawDiff = tryGit([
      "show",
      "--format=",
      "--patch",
      "--unified=3",
      "--no-color",
      c.sha,
    ]);
    const patchMap = parsePatchByFile(rawDiff);
    c.changes = c._fileStats.slice(0, 60).map((fs) => {
      const hit = patchMap.get(fs.path);
      return {
        path: fs.path,
        status: hit ? hit.status : fs.status,
        insertions: fs.insertions,
        deletions: fs.deletions,
        ...(hit ? { patch: hit.patch } : {}),
      };
    });
  }
  delete c._fileStats;
}

/* Build refs */
const refs = [];
let colorIdx = 1;
for (const b of branchEntries) {
  const shas = refShas.get(b.name) ?? [];
  if (!shas.length || !validShas.has(b.tip)) continue;
  const isTrunk = b.name === trunkEntry.name;
  const oldestSha = shas[shas.length - 1];
  const oldestCommit = commitMap.get(oldestSha);
  refs.push({
    id: b.name,
    name: b.name,
    kind: isTrunk ? "trunk" : "branch",
    base: isTrunk ? null : trunkEntry.name,
    tip: b.tip,
    createdAt: oldestCommit ? oldestCommit.time : new Date(b.date).toISOString().replace(".000Z", "Z"),
    mergedAt: null,
    colorKey: isTrunk ? 0 : (colorIdx++ % 5) + 1,
    pr: null,
  });
}

/* Export tags pointing to exported commits */
const rawTags = tryGit([
  "for-each-ref",
  "--format=%(refname:short)%09%(*objectname)%09%(objectname)%09%(creatordate:iso-strict)",
  "refs/tags",
])
  .trim()
  .split(/\r?\n/)
  .filter(Boolean);

const tags = [];
for (const line of rawTags) {
  const [name, derefSha, objSha, isoDate] = line.split("\t");
  const sha = derefSha || objSha;
  if (!name || !sha || !validShas.has(sha)) continue;
  const target = commitMap.get(sha);
  tags.push({
    name,
    sha,
    time: isoDate ? new Date(isoDate).toISOString().replace(".000Z", "Z") : target.time,
  });
}

const fromIso = commits[0].time;
const toIso = commits[commits.length - 1].time;
const churns = commits.map((c) => c.insertions + c.deletions).sort((a, b) => a - b);
const p90 = churns[Math.floor((churns.length - 1) * 0.9)] || 250;

const doc = {
  schemaVersion: 1,
  tool: "gitwave",
  generatedBy: "tools/export-repo.mjs",
  repo: {
    id: repoId,
    name: repoName,
    defaultRef: trunkEntry.name,
    snapshotAt: toIso,
    span: { from: fromIso, to: toIso },
  },
  refs,
  commits,
  tags,
  scale: {
    churnCeiling: Math.max(100, Math.round(p90 * 2)),
    levels: 16,
  },
};

const json = JSON.stringify(doc, null, 2) + "\n";
if (outFile) {
  writeFileSync(resolve(outFile), json, "utf8");
  console.error(
    `exported ${repoName}: ${commits.length} commits, ${refs.length} refs${
      includePatches ? " (with patches)" : ""
    } -> ${outFile}`
  );
} else {
  process.stdout.write(json);
}
