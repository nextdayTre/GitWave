/**
 * git-snapshot.mjs — shared, strictly read-only local Git & GitHub snapshot engine.
 *
 * Used by:
 *   - `tools/export-repo.mjs` (CLI exporter)
 *   - `tools/live-server.mjs` (local live companion + multi-repo switcher)
 *   - `tools/mcp-server.mjs` & `tools/gitwave-cli.mjs` (agent tools)
 *
 * Strictly read-only: only runs `git rev-parse`, `git for-each-ref`, `git log`,
 * `git show`, `git status`, `git merge-base`, `git remote` and optionally
 * `gh pr list`. Never mutates any repository.
 */

import { execFile, execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function execCmd(bin, args, cwd, timeout = 15000) {
  return execFileSync(bin, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    timeout,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function execCmdAsync(bin, args, cwd, timeout = 15000) {
  const { stdout } = await execFileAsync(bin, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    timeout,
    windowsHide: true,
  });
  return stdout;
}

function git(cwd, args) {
  return execCmd("git", args, cwd);
}

function tryGit(cwd, args) {
  try {
    return git(cwd, args);
  } catch {
    return "";
  }
}

function sanitizeRemoteUrl(raw) {
  const s = (raw || "").trim();
  if (!s) return null;
  // Strip any embedded credentials (https://user:token@host/...)
  return s.replace(/\/\/[^/@]+@/, "//");
}

function readOriginUrlFast(topLevel) {
  try {
    const cfg = readFileSync(join(topLevel, ".git", "config"), "utf8");
    const sec = cfg.match(/\[remote "origin"\]([\s\S]*?)(?:\r?\n\[|$)/);
    if (!sec) return null;
    const urlMatch = sec[1].match(/^\s*url\s*=\s*(.+)$/m);
    return urlMatch ? sanitizeRemoteUrl(urlMatch[1]) : null;
  } catch {
    return null;
  }
}

function buildRepoFileTree(trackedFiles, dirtyFiles = []) {
  const dirtySet = new Set(dirtyFiles.map((f) => f.path.replace(/\\/g, "/")));
  const allPaths = new Set();
  for (const p of trackedFiles) {
    const clean = p.replace(/\\/g, "/").trim();
    if (clean) allPaths.add(clean);
  }
  for (const f of dirtyFiles) {
    const clean = f.path.replace(/\\/g, "/").trim();
    if (clean) allPaths.add(clean);
  }

  const folderMap = new Map();
  const rootFiles = [];

  const sortedAll = [...allPaths].sort((a, b) => a.localeCompare(b));
  for (const p of sortedAll) {
    const isDirty = dirtySet.has(p);
    const slash = p.indexOf("/");
    if (slash > 0) {
      const dir = p.slice(0, slash);
      const rec = folderMap.get(dir) ?? {
        name: `${dir}/`,
        path: `${dir}/`,
        fileCount: 0,
        dirtyCount: 0,
        sampleFiles: [],
      };
      rec.fileCount += 1;
      if (isDirty) rec.dirtyCount += 1;
      if (rec.sampleFiles.length < 6) rec.sampleFiles.push(p);
      folderMap.set(dir, rec);
    } else {
      rootFiles.push({ name: p, path: p, dirty: isDirty });
    }
  }

  const folders = [...folderMap.values()].sort(
    (a, b) => b.fileCount - a.fileCount || a.name.localeCompare(b.name)
  );

  return {
    totalFiles: allPaths.size,
    folders: folders.slice(0, 32),
    rootFiles: rootFiles.slice(0, 48),
    allFiles: sortedAll.slice(0, 600),
  };
}

/**
 * Strictly read-only, path-traversal-safe file reader for the live File Preview pane.
 * Refuses any path outside `repoPath` or inside `.git/`.
 */
export function readRepoFileSafe(repoPath, relPath) {
  const root = resolve(repoPath || ".");
  const cleanRel = String(relPath || "").replace(/\\/g, "/").replace(/^\/+/, "").trim();
  if (!cleanRel || cleanRel.includes("..") || cleanRel === ".git" || cleanRel.startsWith(".git/")) {
    throw new Error("invalid or restricted file path");
  }
  const full = resolve(root, cleanRel);
  const normRoot = root.toLowerCase();
  const normFull = full.toLowerCase();
  if (normFull !== normRoot && !normFull.startsWith(normRoot + "\\") && !normFull.startsWith(normRoot + "/")) {
    throw new Error("path escapes repository root");
  }
  if (!existsSync(full)) {
    throw new Error(`file not found: ${cleanRel}`);
  }
  const st = statSync(full);
  if (!st.isFile()) {
    throw new Error(`not a regular file: ${cleanRel}`);
  }

  const MAX_BYTES = 128 * 1024;
  const buf = readFileSync(full);
  const probeLen = Math.min(buf.length, 4096);
  let binary = false;
  for (let i = 0; i < probeLen; i++) {
    if (buf[i] === 0) {
      binary = true;
      break;
    }
  }

  if (binary) {
    return {
      path: cleanRel,
      sizeBytes: st.size,
      lineCount: 0,
      binary: true,
      truncated: false,
      content: "",
    };
  }

  const truncated = buf.length > MAX_BYTES;
  const text = (truncated ? buf.subarray(0, MAX_BYTES) : buf)
    .toString("utf8")
    .replace(/\r\n/g, "\n");
  const lineCount = text ? text.split("\n").length : 0;

  return {
    path: cleanRel,
    sizeBytes: st.size,
    lineCount,
    binary: false,
    truncated,
    content: text,
  };
}

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

function parseNumstatMap(raw) {
  const map = new Map();
  for (const line of (raw || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split("\t");
    if (parts.length < 3) continue;
    const ins = parts[0] === "-" ? 0 : Number(parts[0]) || 0;
    const del = parts[1] === "-" ? 0 : Number(parts[1]) || 0;
    const filePath = parts.slice(2).join("\t");
    const prev = map.get(filePath) ?? { insertions: 0, deletions: 0 };
    map.set(filePath, {
      insertions: prev.insertions + ins,
      deletions: prev.deletions + del,
    });
  }
  return map;
}

function buildUntrackedPreview(topLevel, relPath) {
  const fullPath = join(topLevel, relPath);
  try {
    const st = statSync(fullPath);
    if (!st.isFile()) return { insertions: 0, deletions: 0, patch: "" };
    if (st.size > 40000) {
      return {
        insertions: 0,
        deletions: 0,
        patch: `diff --git a/${relPath} b/${relPath}\nnew file (untracked · ${(st.size / 1024).toFixed(1)} KB — preview skipped for large/binary file)`,
      };
    }
    const buf = readFileSync(fullPath);
    // Detect binary null byte in first 4KB
    const probeLen = Math.min(buf.length, 4096);
    for (let i = 0; i < probeLen; i++) {
      if (buf[i] === 0) {
        return {
          insertions: 0,
          deletions: 0,
          patch: `diff --git a/${relPath} b/${relPath}\nnew binary file (untracked · ${(st.size / 1024).toFixed(1)} KB)`,
        };
      }
    }
    const text = buf.toString("utf8").replace(/\r\n/g, "\n");
    const lines = text.split("\n");
    const shown = lines.slice(0, 260);
    const body = shown.map((l) => `+${l}`).join("\n");
    const header = `diff --git a/${relPath} b/${relPath}\nnew file mode 100644\n--- /dev/null\n+++ b/${relPath}\n@@ -0,0 +1,${shown.length} @@`;
    return {
      insertions: lines.length,
      deletions: 0,
      patch: `${header}\n${body}`.slice(0, 32768),
    };
  } catch {
    return { insertions: 0, deletions: 0, patch: "" };
  }
}

/**
 * Build live unified diffs for uncommitted working-tree files (staged, modified, untracked).
 * Strictly read-only.
 */
export function getWorkingTreeChanges(topLevel, files) {
  if (!files || !files.length) return [];
  const unstagedDiff = parsePatchByFile(
    tryGit(topLevel, ["diff", "--unified=3", "--no-color"])
  );
  const stagedDiff = parsePatchByFile(
    tryGit(topLevel, ["diff", "--cached", "--unified=3", "--no-color"])
  );
  const unstagedStat = parseNumstatMap(tryGit(topLevel, ["diff", "--numstat"]));
  const stagedStat = parseNumstatMap(tryGit(topLevel, ["diff", "--cached", "--numstat"]));

  return files.slice(0, 60).map((f) => {
    if (f.state === "untracked") {
      const preview = buildUntrackedPreview(topLevel, f.path);
      return {
        path: f.path,
        status: "added",
        state: f.state,
        insertions: preview.insertions,
        deletions: preview.deletions,
        ...(preview.patch ? { patch: preview.patch } : {}),
      };
    }

    const uStat = unstagedStat.get(f.path) ?? { insertions: 0, deletions: 0 };
    const sStat = stagedStat.get(f.path) ?? { insertions: 0, deletions: 0 };
    const uHit = unstagedDiff.get(f.path);
    const sHit = stagedDiff.get(f.path);

    let patch = "";
    if (sHit && uHit) {
      patch = `# --- STAGED ---\n${sHit.patch}\n\n# --- UNSTAGED WORKING TREE ---\n${uHit.patch}`;
    } else if (uHit) {
      patch = uHit.patch;
    } else if (sHit) {
      patch = sHit.patch;
    }

    const status = uHit?.status || sHit?.status || (f.code.includes("D") ? "deleted" : f.code.includes("A") ? "added" : f.code.includes("R") ? "renamed" : "modified");
    return {
      path: f.path,
      status,
      state: f.state,
      insertions: uStat.insertions + sStat.insertions,
      deletions: uStat.deletions + sStat.deletions,
      ...(patch ? { patch: patch.slice(0, 32768) } : {}),
    };
  });
}

/**
 * Inspect working-tree dirty files and local-vs-origin ahead/behind deltas
 * without reading full commit logs. Fast enough for multi-repo status cards.
 */
export function getLocalSyncStatus(repoPath, opts = {}) {
  const includeWorkingDiffs = Boolean(opts.includeWorkingDiffs);
  const cwd = resolve(repoPath || ".");
  const topLevel = resolve(git(cwd, ["rev-parse", "--show-toplevel"]).trim());
  const repoName = basename(topLevel);
  const headRef = tryGit(topLevel, ["symbolic-ref", "--short", "HEAD"]).trim() || "(detached)";
  const remoteUrl = sanitizeRemoteUrl(tryGit(topLevel, ["remote", "get-url", "origin"]));

  /* Working tree ("in the burn tray") */
  const rawStatus = tryGit(topLevel, ["status", "--porcelain=v1"]);
  let staged = 0;
  let modified = 0;
  let untracked = 0;
  let conflicted = 0;
  const files = [];

  for (const line of rawStatus.split(/\r?\n/)) {
    if (!line || line.length < 3) continue;
    const x = line[0];
    const y = line[1];
    const filePath = line.slice(3).trim();
    const code = `${x}${y}`;
    if (code === "??") {
      untracked += 1;
      files.push({ code: "?", state: "untracked", path: filePath });
    } else if (x === "U" || y === "U" || code === "AA" || code === "DD") {
      conflicted += 1;
      files.push({ code: "!", state: "conflicted", path: filePath });
    } else {
      if (x !== " ") staged += 1;
      if (y !== " ") modified += 1;
      files.push({
        code: code.trim() || "M",
        state: x !== " " && y !== " " ? "staged+modified" : x !== " " ? "staged" : "modified",
        path: filePath,
      });
    }
  }

  /* Local branches + upstream ahead/behind tracking */
  const rawRefs = tryGit(topLevel, [
    "for-each-ref",
    "--format=%(refname:short)%09%(upstream:short)%09%(upstream:track,nobracket)%09%(objectname)",
    "refs/heads",
  ])
    .trim()
    .split(/\r?\n/)
    .filter(Boolean);

  const localNames = new Set();
  const branches = [];
  let totalAhead = 0;
  let totalBehind = 0;
  let unpushedBranches = 0;

  for (const line of rawRefs) {
    const [name, upstream, track, tip] = line.split("\t");
    if (!name) continue;
    localNames.add(name);
    let ahead = 0;
    let behind = 0;
    const mAhead = (track || "").match(/ahead (\d+)/);
    const mBehind = (track || "").match(/behind (\d+)/);
    if (mAhead) ahead = Number(mAhead[1]) || 0;
    if (mBehind) behind = Number(mBehind[1]) || 0;
    const gone = (track || "").includes("gone");
    const localOnly = !upstream || gone;
    totalAhead += ahead;
    totalBehind += behind;
    if (localOnly || ahead > 0) unpushedBranches += 1;
    branches.push({
      name,
      current: name === headRef,
      tip: tip || "",
      upstream: upstream || null,
      ahead,
      behind,
      gone,
      localOnly,
    });
  }

  /* Remote-only branches on origin/* not checked out locally */
  const rawRemote = tryGit(topLevel, [
    "for-each-ref",
    "--format=%(refname:short)",
    "refs/remotes/origin",
  ])
    .trim()
    .split(/\r?\n/)
    .filter((r) => r && r !== "origin/HEAD" && r !== "origin");

  const remoteOnlyBranches = [];
  for (const r of rawRemote) {
    const short = r.replace(/^origin\//, "");
    if (!localNames.has(short)) remoteOnlyBranches.push(short);
  }

  const dirtyCount = files.length;
  const syncState =
    conflicted > 0
      ? "conflict"
      : dirtyCount > 0 && (totalAhead > 0 || totalBehind > 0)
        ? "dirty+diverged"
        : dirtyCount > 0
          ? "dirty"
          : totalBehind > 0 && totalAhead > 0
            ? "diverged"
            : totalAhead > 0
              ? "ahead"
              : totalBehind > 0
                ? "behind"
                : !remoteUrl
                  ? "local-only"
                  : "synced";

  const workingChanges = includeWorkingDiffs
    ? getWorkingTreeChanges(topLevel, files)
    : undefined;

  return {
    repoPath: topLevel,
    repoName,
    headRef,
    remoteUrl,
    syncState,
    workingTree: {
      clean: dirtyCount === 0,
      dirtyCount,
      staged,
      modified,
      untracked,
      conflicted,
      files: files.slice(0, 80),
      ...(workingChanges ? { changes: workingChanges } : {}),
    },
    branches,
    remoteOnlyBranches,
    summary: {
      dirtyCount,
      totalAhead,
      totalBehind,
      unpushedBranches,
      remoteOnlyCount: remoteOnlyBranches.length,
    },
  };
}

function tryFetchGhPrs(cwd) {
  try {
    const out = execCmd(
      "gh",
      [
        "pr",
        "list",
        "--state",
        "all",
        "--limit",
        "30",
        "--json",
        "number,title,state,isDraft,reviewDecision,statusCheckRollup,mergeable,mergedAt,headRefName",
      ],
      cwd,
      10000
    );
    const list = JSON.parse(out);
    if (!Array.isArray(list)) return new Map();
    const byBranch = new Map();
    for (const item of list) {
      if (!item || typeof item.headRefName !== "string") continue;
      const rawState = String(item.state || "").toUpperCase();
      const state = item.isDraft
        ? "draft"
        : rawState === "MERGED"
          ? "merged"
          : rawState === "CLOSED"
            ? "closed"
            : "open";
      const revRaw = String(item.reviewDecision || "").toUpperCase();
      const review =
        revRaw === "APPROVED"
          ? "approved"
          : revRaw === "CHANGES_REQUESTED"
            ? "changes_requested"
            : revRaw === "REVIEW_REQUIRED"
              ? "required"
              : "none";
      const rollup = Array.isArray(item.statusCheckRollup) ? item.statusCheckRollup : [];
      let checks = "none";
      if (rollup.length) {
        const states = rollup.map((c) => String(c.conclusion || c.state || "").toUpperCase());
        if (states.some((s) => s === "FAILURE" || s === "ERROR" || s === "TIMED_OUT")) {
          checks = "failing";
        } else if (states.some((s) => s === "PENDING" || s === "IN_PROGRESS" || s === "QUEUED" || s === "")) {
          checks = "pending";
        } else {
          checks = "passing";
        }
      }
      byBranch.set(item.headRefName, {
        number: Number(item.number) || 0,
        title: String(item.title || `PR #${item.number}`).slice(0, 120),
        state,
        review,
        checks,
        conflicts: String(item.mergeable || "").toUpperCase() === "CONFLICTING",
        draft: Boolean(item.isDraft),
        mergedAt: item.mergedAt ? new Date(item.mergedAt).toISOString().replace(".000Z", "Z") : null,
      });
    }
    return byBranch;
  } catch {
    return new Map();
  }
}

/**
 * Export a full schema-1 `.gitwave` document + local/GitHub sync radar from a
 * local repository path. Strictly read-only.
 */
export function exportRepoSnapshot(repoPath = ".", opts = {}) {
  const includePatches = Boolean(opts.includePatches);
  const includeGhPrs = Boolean(opts.includeGhPrs);
  const limit = Math.max(1, Math.min(2000, Number(opts.limit) || 300));
  const cwd = resolve(repoPath);

  const topLevel = resolve(git(cwd, ["rev-parse", "--show-toplevel"]).trim());
  const repoName = basename(topLevel);
  const repoId = repoName.toLowerCase().replace(/[^a-z0-9-]+/g, "-") || "local-repo";

  const rawBranches = git(topLevel, [
    "for-each-ref",
    "--format=%(refname:short)%09%(objectname)%09%(committerdate:iso-strict)",
    "refs/heads",
  ])
    .trim()
    .split(/\r?\n/)
    .filter(Boolean);

  if (!rawBranches.length) {
    throw new Error(`No local branches found in ${topLevel}`);
  }

  const branchEntries = rawBranches.slice(0, 32).map((line) => {
    const [name, tip, date] = line.split("\t");
    return { name, tip, date };
  });

  const headRef = tryGit(topLevel, ["symbolic-ref", "--short", "HEAD"]).trim();
  const trunkEntry =
    branchEntries.find((b) => b.name === "main") ||
    branchEntries.find((b) => b.name === "master") ||
    branchEntries.find((b) => b.name === headRef) ||
    branchEntries[0];

  const ghPrs = includeGhPrs ? tryFetchGhPrs(topLevel) : new Map();

  const commitMap = new Map();
  const refShas = new Map();

  for (const branch of branchEntries) {
    const logOut = git(topLevel, [
      "log",
      branch.name,
      "-n",
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
      const isAgent = /\b(bot|agent|claude|gemini|copilot|codex|antigravity)\b/i.test(authorName);

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

  const validShas = new Set(commitMap.keys());
  const commits = [...commitMap.values()].sort(
    (a, b) => Date.parse(a.time) - Date.parse(b.time) || a.sha.localeCompare(b.sha)
  );

  /* Optionally attach real per-file unified diff patches in fast batches (not 1 spawn/commit!) */
  const patchLimit =
    typeof opts.patchLimit === "number" && opts.patchLimit > 0
      ? Math.min(commits.length, opts.patchLimit)
      : commits.length;

  for (const c of commits) {
    c.parents = c.parents.filter((p) => validShas.has(p));
    if (c._fileStats.length > 0) {
      c.paths = c._fileStats.slice(0, 100).map((fs) => fs.path);
    }
  }

  if (includePatches) {
    const targets = commits
      .filter((c) => !c.merge && c._fileStats.length > 0)
      .slice(-patchLimit);

    const patchesBySha = new Map();
    const BATCH = 32;
    for (let i = 0; i < targets.length; i += BATCH) {
      const shas = targets.slice(i, i + BATCH).map((c) => c.sha);
      const rawBatch = tryGit(topLevel, [
        "show",
        "--format=PATCHSHA%x1f%H",
        "--patch",
        "--unified=3",
        "--no-color",
        ...shas,
      ]);
      const sections = rawBatch.split("PATCHSHA\x1f").slice(1);
      for (const sec of sections) {
        const nl = sec.indexOf("\n");
        const sha = (nl >= 0 ? sec.slice(0, nl) : sec).trim();
        const body = nl >= 0 ? sec.slice(nl + 1) : "";
        if (sha) patchesBySha.set(sha, parsePatchByFile(body));
      }
    }

    for (const c of targets) {
      const patchMap = patchesBySha.get(c.sha) ?? new Map();
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
  }

  for (const c of commits) {
    delete c._fileStats;
  }

  const refs = [];
  let colorIdx = 0;
  for (const b of branchEntries) {
    const shas = refShas.get(b.name) ?? [];
    if (!shas.length || !validShas.has(b.tip)) continue;
    const isTrunk = b.name === trunkEntry.name;
    const oldestSha = shas[shas.length - 1];
    const oldestCommit = commitMap.get(oldestSha);
    let pr = null;
    if (!isTrunk) {
      if (ghPrs.has(b.name)) {
        pr = ghPrs.get(b.name);
      } else {
        // Offline unmerged-branch check (only when branch tip is not an ancestor of trunk)
        let merged = false;
        try {
          execCmd("git", ["merge-base", "--is-ancestor", b.tip, trunkEntry.tip], topLevel, 5000);
          merged = true;
        } catch {
          merged = false;
        }
        if (!merged && b.tip !== trunkEntry.tip) {
          const isDraft = /^(wip|draft|agent)\//i.test(b.name);
          pr = {
            number: refs.length + 1,
            title: `${b.name} (local unmerged branch)`,
            state: isDraft ? "draft" : "open",
            review: "none",
            checks: "none",
            conflicts: false,
            draft: isDraft,
            mergedAt: null,
          };
        }
      }
    }
    refs.push({
      id: b.name,
      name: b.name,
      kind: isTrunk ? "trunk" : "branch",
      base: isTrunk ? null : trunkEntry.name,
      tip: b.tip,
      createdAt: oldestCommit
        ? oldestCommit.time
        : new Date(b.date).toISOString().replace(".000Z", "Z"),
      mergedAt: pr?.mergedAt ?? null,
      colorKey: isTrunk ? 0 : (colorIdx++ % 5) + 1,
      pr,
    });
  }

  const rawTags = tryGit(topLevel, [
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
    generatedBy: "tools/lib/git-snapshot.mjs",
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

  const sync = getLocalSyncStatus(topLevel, {
    includeWorkingDiffs: Boolean(opts.includeWorkingDiffs),
  });
  return { doc, sync };
}

async function tryGitAsync(cwd, args, timeout = 15000) {
  try {
    return await execCmdAsync("git", args, cwd, timeout);
  } catch {
    return "";
  }
}

/**
 * High-speed parallel async repository snapshot & file-tree exporter for
 * `live-server.mjs`. Collapses 12 sequential git spawns into ~3 parallel calls
 * and handles unborn (0-commit) repositories gracefully.
 */
export async function exportRepoSnapshotAsync(repoPath = ".", opts = {}) {
  const includePatches = Boolean(opts.includePatches);
  const patchLimit = Math.max(1, Math.min(48, Number(opts.patchLimit) || 16));
  const limit = Math.max(1, Math.min(2000, Number(opts.limit) || 200));
  const cwd = resolve(repoPath);
  const topLevel = existsSync(join(cwd, ".git"))
    ? cwd
    : resolve((await execCmdAsync("git", ["rev-parse", "--show-toplevel"], cwd)).trim());
  const repoName = basename(topLevel);
  const repoId = repoName.toLowerCase().replace(/[^a-z0-9-]+/g, "-") || "local-repo";
  const remoteUrl = readOriginUrlFast(topLevel);

  /* Phase 1: 3 fast parallel git calls */
  const [statusOut, refsOut, lsFilesOut] = await Promise.all([
    tryGitAsync(topLevel, ["status", "--porcelain=v2", "--branch"]),
    tryGitAsync(topLevel, [
      "for-each-ref",
      "--format=%(refname)%09%(refname:short)%09%(objectname)%09%(*objectname)%09%(committerdate:iso-strict)%09%(creatordate:iso-strict)%09%(upstream:short)%09%(upstream:track,nobracket)",
      "refs/heads",
      "refs/remotes/origin",
      "refs/tags",
    ]),
    tryGitAsync(topLevel, ["ls-files"]),
  ]);

  /* Parse working tree + HEAD from porcelain v2 */
  let headRef = "(detached)";
  let staged = 0;
  let modified = 0;
  let untracked = 0;
  let conflicted = 0;
  const dirtyFiles = [];

  for (const line of statusOut.split(/\r?\n/)) {
    if (!line) continue;
    if (line.startsWith("# branch.head ")) {
      headRef = line.slice(14).trim() || "(detached)";
    } else if (line.startsWith("? ")) {
      untracked += 1;
      dirtyFiles.push({ code: "?", state: "untracked", path: line.slice(2).trim() });
    } else if (line.startsWith("u ")) {
      conflicted += 1;
      const parts = line.split(" ");
      dirtyFiles.push({ code: "!", state: "conflicted", path: parts.slice(10).join(" ") });
    } else if (line.startsWith("1 ") || line.startsWith("2 ")) {
      const parts = line.split(" ");
      const xy = parts[1] || "..";
      const x = xy[0] === "." ? " " : xy[0];
      const y = xy[1] === "." ? " " : xy[1];
      if (x !== " ") staged += 1;
      if (y !== " ") modified += 1;
      let filePath = "";
      if (line.startsWith("2 ")) {
        const tabParts = line.split("\t");
        const headCols = tabParts[0].split(" ");
        filePath = headCols.slice(9).join(" ");
      } else {
        filePath = parts.slice(8).join(" ");
      }
      dirtyFiles.push({
        code: `${x}${y}`.trim() || "M",
        state: x !== " " && y !== " " ? "staged+modified" : x !== " " ? "staged" : "modified",
        path: filePath,
      });
    }
  }

  /* Parse local branches, remote branches, and tags from ONE for-each-ref output */
  const branchEntries = [];
  const syncBranches = [];
  const localNames = new Set();
  const remoteNames = [];
  const rawTagEntries = [];
  let totalAhead = 0;
  let totalBehind = 0;
  let unpushedBranches = 0;

  for (const line of refsOut.split(/\r?\n/)) {
    if (!line) continue;
    const [fullRef, shortRef, objSha, derefSha, commitDate, creatorDate, upstream, track] = line.split("\t");
    if (!fullRef) continue;
    if (fullRef.startsWith("refs/heads/")) {
      localNames.add(shortRef);
      if (branchEntries.length < 32) {
        branchEntries.push({ name: shortRef, tip: objSha, date: commitDate });
      }
      let ahead = 0;
      let behind = 0;
      const mA = (track || "").match(/ahead (\d+)/);
      const mB = (track || "").match(/behind (\d+)/);
      if (mA) ahead = Number(mA[1]) || 0;
      if (mB) behind = Number(mB[1]) || 0;
      const gone = (track || "").includes("gone");
      const localOnly = !upstream || gone;
      totalAhead += ahead;
      totalBehind += behind;
      if (localOnly || ahead > 0) unpushedBranches += 1;
      syncBranches.push({
        name: shortRef,
        current: shortRef === headRef,
        tip: objSha || "",
        upstream: upstream || null,
        ahead,
        behind,
        gone,
        localOnly,
      });
    } else if (fullRef.startsWith("refs/remotes/origin/")) {
      if (shortRef !== "origin/HEAD" && shortRef !== "origin") {
        remoteNames.push(shortRef.replace(/^origin\//, ""));
      }
    } else if (fullRef.startsWith("refs/tags/")) {
      rawTagEntries.push({ name: shortRef, sha: derefSha || objSha, isoDate: creatorDate });
    }
  }

  const remoteOnlyBranches = remoteNames.filter((r) => !localNames.has(r));
  const trackedList = lsFilesOut.split(/\r?\n/).filter(Boolean);
  const tree = buildRepoFileTree(trackedList, dirtyFiles);
  const dirtyCount = dirtyFiles.length;

  const syncState = !branchEntries.length
    ? "empty"
    : conflicted > 0
      ? "conflict"
      : dirtyCount > 0 && (totalAhead > 0 || totalBehind > 0)
        ? "dirty+diverged"
        : dirtyCount > 0
          ? "dirty"
          : totalBehind > 0 && totalAhead > 0
            ? "diverged"
            : totalAhead > 0
              ? "ahead"
              : totalBehind > 0
                ? "behind"
                : !remoteUrl
                  ? "local-only"
                  : "synced";

  /* Unborn / 0-commit repo: return graceful sync + tree without throwing */
  if (!branchEntries.length) {
    return {
      unborn: true,
      doc: null,
      sync: {
        repoPath: topLevel,
        repoName,
        headRef,
        remoteUrl,
        syncState,
        unborn: true,
        tree,
        workingTree: {
          clean: dirtyCount === 0,
          dirtyCount,
          staged,
          modified,
          untracked,
          conflicted,
          files: dirtyFiles.slice(0, 80),
        },
        branches: [],
        remoteOnlyBranches,
        summary: {
          dirtyCount,
          totalAhead: 0,
          totalBehind: 0,
          unpushedBranches: 0,
          remoteOnlyCount: remoteOnlyBranches.length,
        },
      },
    };
  }

  const trunkEntry =
    branchEntries.find((b) => b.name === "main") ||
    branchEntries.find((b) => b.name === "master") ||
    branchEntries.find((b) => b.name === headRef) ||
    branchEntries[0];

  /* Phase 2: Parallel git log across branches + working-tree diffs ONLY if dirty */
  const logPromises = branchEntries.map((b) =>
    tryGitAsync(topLevel, [
      "log",
      b.name,
      "-n",
      String(limit),
      "--date=iso-strict",
      "--numstat",
      "--format=COMMIT%x1f%H%x1f%P%x1f%aI%x1f%an%x1f%s",
    ]).then((out) => ({ branch: b, out }))
  );

  const wtDiffPromise =
    opts.includeWorkingDiffs && dirtyCount > 0
      ? Promise.all([
          tryGitAsync(topLevel, ["diff", "--unified=3", "--no-color"]),
          tryGitAsync(topLevel, ["diff", "--cached", "--unified=3", "--no-color"]),
          tryGitAsync(topLevel, ["diff", "--numstat"]),
          tryGitAsync(topLevel, ["diff", "--cached", "--numstat"]),
        ])
      : Promise.resolve(null);

  const [logResults, wtRaw] = await Promise.all([Promise.all(logPromises), wtDiffPromise]);

  const commitMap = new Map();
  const refShas = new Map();

  for (const { branch, out } of logResults) {
    const blocks = out.split("COMMIT\x1f").slice(1);
    const shasForRef = [];

    for (const block of blocks) {
      const lines = block.split(/\r?\n/);
      const [sha, parentsRaw, isoTime, authorName, subject] = lines[0].split("\x1f");
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
      const isAgent = /\b(bot|agent|claude|gemini|copilot|codex|antigravity)\b/i.test(authorName);

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

  const validShas = new Set(commitMap.keys());
  const commits = [...commitMap.values()].sort(
    (a, b) => Date.parse(a.time) - Date.parse(b.time) || a.sha.localeCompare(b.sha)
  );

  for (const c of commits) {
    c.parents = c.parents.filter((p) => validShas.has(p));
    if (c._fileStats.length > 0) {
      c.paths = c._fileStats.slice(0, 100).map((fs) => fs.path);
    }
  }

  /* Phase 3: Single batched git show for latest `patchLimit` commits + merge-base checks in parallel */
  const patchTargets = includePatches
    ? commits.filter((c) => !c.merge && c._fileStats.length > 0).slice(-patchLimit)
    : [];

  const patchPromise = patchTargets.length
    ? tryGitAsync(topLevel, [
        "show",
        "--format=PATCHSHA%x1f%H",
        "--patch",
        "--unified=3",
        "--no-color",
        ...patchTargets.map((c) => c.sha),
      ])
    : Promise.resolve("");

  const nonTrunkBranches = branchEntries.filter(
    (b) => b.name !== trunkEntry.name && b.tip !== trunkEntry.tip && validShas.has(b.tip)
  );
  const ancestorChecks = Promise.all(
    nonTrunkBranches.map(async (b) => {
      try {
        await execCmdAsync("git", ["merge-base", "--is-ancestor", b.tip, trunkEntry.tip], topLevel, 5000);
        return [b.name, true];
      } catch {
        return [b.name, false];
      }
    })
  );

  const [rawPatches, ancestorPairs] = await Promise.all([patchPromise, ancestorChecks]);
  const mergedSet = new Set(ancestorPairs.filter(([, m]) => m).map(([n]) => n));

  if (patchTargets.length && rawPatches) {
    const patchesBySha = new Map();
    for (const sec of rawPatches.split("PATCHSHA\x1f").slice(1)) {
      const nl = sec.indexOf("\n");
      const sha = (nl >= 0 ? sec.slice(0, nl) : sec).trim();
      const body = nl >= 0 ? sec.slice(nl + 1) : "";
      if (sha) patchesBySha.set(sha, parsePatchByFile(body));
    }
    for (const c of patchTargets) {
      const patchMap = patchesBySha.get(c.sha) ?? new Map();
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
  }
  for (const c of commits) delete c._fileStats;

  const refs = [];
  let colorIdx = 0;
  for (const b of branchEntries) {
    const shas = refShas.get(b.name) ?? [];
    if (!shas.length || !validShas.has(b.tip)) continue;
    const isTrunk = b.name === trunkEntry.name;
    const oldestCommit = commitMap.get(shas[shas.length - 1]);
    let pr = null;
    if (!isTrunk && !mergedSet.has(b.name) && b.tip !== trunkEntry.tip) {
      const isDraft = /^(wip|draft|agent)\//i.test(b.name);
      pr = {
        number: refs.length + 1,
        title: `${b.name} (local unmerged branch)`,
        state: isDraft ? "draft" : "open",
        review: "none",
        checks: "none",
        conflicts: false,
        draft: isDraft,
        mergedAt: null,
      };
    }
    refs.push({
      id: b.name,
      name: b.name,
      kind: isTrunk ? "trunk" : "branch",
      base: isTrunk ? null : trunkEntry.name,
      tip: b.tip,
      createdAt: oldestCommit
        ? oldestCommit.time
        : new Date(b.date).toISOString().replace(".000Z", "Z"),
      mergedAt: null,
      colorKey: isTrunk ? 0 : (colorIdx++ % 5) + 1,
      pr,
    });
  }

  const tags = [];
  for (const t of rawTagEntries) {
    if (!t.name || !t.sha || !validShas.has(t.sha)) continue;
    const target = commitMap.get(t.sha);
    tags.push({
      name: t.name,
      sha: t.sha,
      time: t.isoDate ? new Date(t.isoDate).toISOString().replace(".000Z", "Z") : target.time,
    });
  }

  let workingChanges;
  if (wtRaw) {
    const [uDiffRaw, sDiffRaw, uStatRaw, sStatRaw] = wtRaw;
    const uDiff = parsePatchByFile(uDiffRaw);
    const sDiff = parsePatchByFile(sDiffRaw);
    const uStat = parseNumstatMap(uStatRaw);
    const sStat = parseNumstatMap(sStatRaw);
    workingChanges = dirtyFiles.slice(0, 60).map((f) => {
      if (f.state === "untracked") {
        const preview = buildUntrackedPreview(topLevel, f.path);
        return {
          path: f.path,
          status: "added",
          state: f.state,
          insertions: preview.insertions,
          deletions: preview.deletions,
          ...(preview.patch ? { patch: preview.patch } : {}),
        };
      }
      const us = uStat.get(f.path) ?? { insertions: 0, deletions: 0 };
      const ss = sStat.get(f.path) ?? { insertions: 0, deletions: 0 };
      const uh = uDiff.get(f.path);
      const sh = sDiff.get(f.path);
      const patch =
        sh && uh
          ? `# --- STAGED ---\n${sh.patch}\n\n# --- UNSTAGED WORKING TREE ---\n${uh.patch}`
          : uh?.patch || sh?.patch || "";
      const status =
        uh?.status ||
        sh?.status ||
        (f.code.includes("D") ? "deleted" : f.code.includes("A") ? "added" : f.code.includes("R") ? "renamed" : "modified");
      return {
        path: f.path,
        status,
        state: f.state,
        insertions: us.insertions + ss.insertions,
        deletions: us.deletions + ss.deletions,
        ...(patch ? { patch: patch.slice(0, 32768) } : {}),
      };
    });
  }

  const fromIso = commits[0].time;
  const toIso = commits[commits.length - 1].time;
  const churns = commits.map((c) => c.insertions + c.deletions).sort((a, b) => a - b);
  const p90 = churns[Math.floor((churns.length - 1) * 0.9)] || 250;

  return {
    unborn: false,
    doc: {
      schemaVersion: 1,
      tool: "gitwave",
      generatedBy: "tools/lib/git-snapshot.mjs",
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
    },
    sync: {
      repoPath: topLevel,
      repoName,
      headRef,
      remoteUrl,
      syncState,
      unborn: false,
      tree,
      workingTree: {
        clean: dirtyCount === 0,
        dirtyCount,
        staged,
        modified,
        untracked,
        conflicted,
        files: dirtyFiles.slice(0, 80),
        ...(workingChanges ? { changes: workingChanges } : {}),
      },
      branches: syncBranches,
      remoteOnlyBranches,
      summary: {
        dirtyCount,
        totalAhead,
        totalBehind,
        unpushedBranches,
        remoteOnlyCount: remoteOnlyBranches.length,
      },
    },
  };
}

/**
 * Ultra-fast filesystem-only fingerprint of a local repo's HEAD & branch tips (< 1ms, zero git spawns).
 */
export function getRepoFingerprint(repoPath) {
  const abs = resolve(repoPath || ".");
  const gitDir = join(abs, ".git");
  try {
    const headRaw = readFileSync(join(gitDir, "HEAD"), "utf8").trim();
    let tip = headRaw;
    if (headRaw.startsWith("ref: ")) {
      const refFile = join(gitDir, headRaw.slice(5).trim());
      if (existsSync(refFile)) tip = readFileSync(refFile, "utf8").trim();
    }
    let idxMtime = 0;
    const idxFile = join(gitDir, "index");
    if (existsSync(idxFile)) idxMtime = Math.round(statSync(idxFile).mtimeMs);
    return `${headRaw}|${tip}|${idxMtime}`;
  } catch {
    return "";
  }
}

/**
 * Fast single-process async repo summary (`git status --porcelain=v2 --branch`)
 * for the multi-repo Cartridge Shelf. Runs ~6x faster than full sync scanning.
 */
async function getQuickRepoSummaryAsync(dir) {
  const abs = resolve(dir);
  const out = await execCmdAsync("git", ["status", "--porcelain=v2", "--branch"], abs, 8000);
  let headRef = "(detached)";
  let unborn = false;
  let upstream = null;
  let ahead = 0;
  let behind = 0;
  let dirtyCount = 0;
  let conflicted = 0;

  for (const line of out.split(/\r?\n/)) {
    if (!line) continue;
    if (line.startsWith("# branch.oid (initial)")) {
      unborn = true;
    } else if (line.startsWith("# branch.head ")) {
      headRef = line.slice(14).trim() || "(detached)";
    } else if (line.startsWith("# branch.upstream ")) {
      upstream = line.slice(18).trim() || null;
    } else if (line.startsWith("# branch.ab ")) {
      const m = line.match(/\+(\d+)\s+-(\d+)/);
      if (m) {
        ahead = Number(m[1]) || 0;
        behind = Number(m[2]) || 0;
      }
    } else if (line.startsWith("u ")) {
      conflicted += 1;
      dirtyCount += 1;
    } else if (line[0] === "1" || line[0] === "2" || line[0] === "?") {
      dirtyCount += 1;
    }
  }

  const syncState = unborn
    ? "empty"
    : conflicted > 0
      ? "conflict"
      : dirtyCount > 0 && (ahead > 0 || behind > 0)
        ? "dirty+diverged"
        : dirtyCount > 0
          ? "dirty"
          : ahead > 0 && behind > 0
            ? "diverged"
            : ahead > 0
              ? "ahead"
              : behind > 0
                ? "behind"
                : !upstream
                  ? "local-only"
                  : "synced";

  return {
    repoPath: abs,
    repoName: basename(abs),
    headRef,
    syncState,
    unborn,
    summary: {
      dirtyCount,
      totalAhead: ahead,
      totalBehind: behind,
      unpushedBranches: !upstream || ahead > 0 ? 1 : 0,
      remoteOnlyCount: 0,
    },
  };
}

/**
 * Non-blocking parallel discovery of local Git repositories across root dirs.
 */
export async function discoverLocalReposAsync(roots = ["."]) {
  const candidates = [];
  const seen = new Set();

  const collect = (dir) => {
    const abs = resolve(dir);
    if (seen.has(abs)) return;
    if (!existsSync(join(abs, ".git"))) return;
    seen.add(abs);
    candidates.push(abs);
  };

  for (const root of roots) {
    const absRoot = resolve(root);
    if (!existsSync(absRoot)) continue;
    collect(absRoot);
    try {
      for (const name of readdirSync(absRoot)) {
        if (name.startsWith(".") || name === "node_modules") continue;
        const child = join(absRoot, name);
        try {
          if (statSync(child).isDirectory()) collect(child);
        } catch {
          /* ignore */
        }
      }
    } catch {
      /* ignore */
    }
  }

  const results = [];
  const CONCURRENCY = 4;
  for (let i = 0; i < candidates.length; i += CONCURRENCY) {
    const slice = candidates.slice(i, i + CONCURRENCY);
    const settled = await Promise.allSettled(slice.map((dir) => getQuickRepoSummaryAsync(dir)));
    for (const item of settled) {
      if (item.status === "fulfilled") results.push(item.value);
    }
  }

  return results.sort((a, b) => a.repoName.localeCompare(b.repoName));
}

/**
 * Discover local Git repositories from an array of directories or repo paths.
 * Scans each root itself plus its immediate child folders.
 */
export function discoverLocalRepos(roots = ["."]) {
  const seen = new Set();
  const repos = [];

  const maybeAdd = (dir) => {
    const abs = resolve(dir);
    if (seen.has(abs)) return;
    if (!existsSync(join(abs, ".git"))) return;
    try {
      const status = getLocalSyncStatus(abs);
      if (seen.has(status.repoPath)) return;
      seen.add(status.repoPath);
      repos.push(status);
    } catch {
      /* skip unreadable or bare repos */
    }
  };

  for (const root of roots) {
    const absRoot = resolve(root);
    if (!existsSync(absRoot)) continue;
    maybeAdd(absRoot);
    try {
      const entries = readdirSync(absRoot);
      for (const name of entries) {
        if (name.startsWith(".") || name === "node_modules") continue;
        const child = join(absRoot, name);
        try {
          if (statSync(child).isDirectory()) maybeAdd(child);
        } catch {
          /* ignore */
        }
      }
    } catch {
      /* ignore */
    }
  }

  return repos.sort((a, b) => a.repoName.localeCompare(b.repoName));
}
