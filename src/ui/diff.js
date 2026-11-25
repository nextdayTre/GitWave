/**
 * diff.js — full Commit / Diff / Changes inspector replacing the Rack/Stage
 * wavetable viewport when double-clicking a slot box, 2D scope peak, or
 * clicking "diff" in the commit card.
 *
 * Strictly read-only: every commit subject, file path and diff line is written
 * with `textContent` (never `innerHTML`), and action buttons only copy git
 * commands to the clipboard.
 */

import { ctx, requestRender, setView } from "../app.ts";
import {
  SLOT_COUNT,
  dateMedium,
  slotIndexForTime,
  timeFull,
} from "../core/samples.ts";
import { searchCommits } from "../core/search.ts";
import { focusCommitView, focusSlot, pinModule } from "../core/view.ts";
import { clear, el, shortSha } from "./dom.js";
import { renderMarkdownDom } from "./markdown.js";
import { announce, copyText } from "./status.ts";

/** File viewer display mode: "rendered" (Markdown/HTML preview) or "raw" (line-numbered source). */
let fileViewMode = "rendered";

export function openDiffView(slotOrCommit = null) {
  if (!ctx.view || !ctx.model) return;
  ctx.diffOpen = true;
  ctx.diffTarget = "commit";
  ctx.diffFile = null;
  if (slotOrCommit && typeof slotOrCommit === "object") {
    if ("newest" in slotOrCommit && slotOrCommit.newest) {
      setView(focusSlot(ctx.view, slotOrCommit));
      return;
    }
    if ("sha" in slotOrCommit && typeof slotOrCommit.sha === "string") {
      setView(focusCommitView(ctx.model, ctx.view, slotOrCommit));
      return;
    }
  }
  requestRender();
}

export function openWorkingTreeDiff(filePath = null) {
  if (!ctx.view || !ctx.model) return;
  ctx.diffOpen = true;
  ctx.diffTarget = "working-tree";
  ctx.diffFile = typeof filePath === "string" && filePath ? filePath : null;
  ctx.filePreview = null;
  requestRender();
}

export function openFileView(pathOrFolder) {
  if (!ctx.view || !ctx.model) return;
  const clean = String(pathOrFolder || "").replace(/\\/g, "/").replace(/^\/+/, "").trim();
  if (!clean) return;
  ctx.diffOpen = true;
  ctx.diffTarget = "file";
  ctx.diffFile = clean;
  fileViewMode = /\.(md|markdown|mdx|html|htm)$/i.test(clean) ? "rendered" : "raw";
  const isFolder = clean.endsWith("/");
  if (!isFolder && ctx.onLiveAction) {
    ctx.filePreview = { path: clean, loading: true };
    ctx.onLiveAction({ method: "readFile", params: { path: clean } });
  } else {
    ctx.filePreview = null;
  }
  requestRender();
}

export function closeDiffView() {
  if (!ctx.diffOpen) return;
  ctx.diffOpen = false;
  ctx.diffTarget = "commit";
  ctx.diffFile = null;
  ctx.filePreview = null;
  requestRender();
}

function statusBadgeMeta(status) {
  switch (status) {
    case "added":
      return { glyph: "A", cls: "is-add", label: "added" };
    case "deleted":
      return { glyph: "D", cls: "is-del", label: "deleted" };
    case "renamed":
      return { glyph: "R", cls: "is-ren", label: "renamed" };
    default:
      return { glyph: "M", cls: "is-mod", label: "modified" };
  }
}

function findWindowCommits() {
  if (!ctx.model || !ctx.window) return [];
  const shas = ctx.search.shas;
  const out = [];
  for (const c of ctx.model.doc.commits) {
    if (shas && !shas.has(c.sha)) continue;
    const t = Date.parse(c.time);
    if (t >= ctx.window.startMs && t <= ctx.window.endMs) out.push(c);
  }
  return out;
}

function findChildren(sha) {
  if (!ctx.model) return [];
  const out = [];
  for (const c of ctx.model.doc.commits) {
    if (c.parents.includes(sha)) out.push(c);
  }
  return out;
}

function selectCommit(commit) {
  if (!ctx.model || !ctx.view || !commit) return;
  ctx.diffFile = null;
  setView(focusCommitView(ctx.model, ctx.view, commit));
}

function renderUnifiedPatch(container, change) {
  const block = el("section", "diff-file-block");
  const head = el("header", "diff-file-head");
  const meta = statusBadgeMeta(change.status);
  head.appendChild(el("span", `diff-st ${meta.cls}`, meta.glyph));
  head.appendChild(el("code", "diff-file-path", change.path));
  const counts = el("span", "diff-file-counts");
  counts.appendChild(el("span", "add", `+${change.insertions}`));
  counts.appendChild(el("span", "del", `−${change.deletions}`));
  head.appendChild(counts);
  block.appendChild(head);

  const code = el("div", "diff-code");
  if (!change.patch || !change.patch.trim()) {
    code.appendChild(
      el("div", "diff-empty-patch", "binary or stat-only change — no text hunks embedded")
    );
  } else {
    const lines = change.patch.replace(/\r\n/g, "\n").split("\n");
    let oldLine = 0;
    let newLine = 0;
    let inHunk = false;

    for (const line of lines) {
      if (line.startsWith("@@")) {
        const m = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
        if (m) {
          oldLine = Number(m[1]);
          newLine = Number(m[2]);
          inHunk = true;
        }
        const row = el("div", "diff-line dl-hunk");
        row.appendChild(el("span", "dl-num", "…"));
        row.appendChild(el("span", "dl-num", "…"));
        row.appendChild(el("span", "dl-text", line));
        code.appendChild(row);
      } else if (
        line.startsWith("diff --git") ||
        line.startsWith("index ") ||
        line.startsWith("--- ") ||
        line.startsWith("+++ ") ||
        line.startsWith("rename ") ||
        line.startsWith("new file ") ||
        line.startsWith("deleted file ")
      ) {
        const row = el("div", "diff-line dl-meta");
        row.appendChild(el("span", "dl-num", ""));
        row.appendChild(el("span", "dl-num", ""));
        row.appendChild(el("span", "dl-text", line));
        code.appendChild(row);
      } else if (inHunk && line.startsWith("+")) {
        const row = el("div", "diff-line dl-add");
        row.appendChild(el("span", "dl-num", ""));
        row.appendChild(el("span", "dl-num", String(newLine++)));
        row.appendChild(el("span", "dl-text", line));
        code.appendChild(row);
      } else if (inHunk && line.startsWith("-")) {
        const row = el("div", "diff-line dl-del");
        row.appendChild(el("span", "dl-num", String(oldLine++)));
        row.appendChild(el("span", "dl-num", ""));
        row.appendChild(el("span", "dl-text", line));
        code.appendChild(row);
      } else {
        const row = el("div", "diff-line dl-ctx");
        row.appendChild(el("span", "dl-num", inHunk ? String(oldLine++) : ""));
        row.appendChild(el("span", "dl-num", inHunk ? String(newLine++) : ""));
        row.appendChild(el("span", "dl-text", line));
        code.appendChild(row);
      }
    }
  }
  block.appendChild(code);
  container.appendChild(block);
}

function makeCopyCmdRow(labelText, cmd) {
  const row = el("div", "diff-cmd-row");
  row.appendChild(el("span", "diff-cmd-label", labelText));
  row.appendChild(el("code", "diff-cmd-code", cmd));
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "op op-xs";
  btn.textContent = "copy";
  btn.addEventListener("click", () => copyText(cmd, `${labelText} copied`));
  row.appendChild(btn);
  return row;
}

function renderWorkingTreeDiffView(host) {
  const sync = ctx.liveSync;
  const wt = sync?.workingTree;

  const bar = el("header", "diff-bar");
  const backBtn = document.createElement("button");
  backBtn.type = "button";
  backBtn.className = "op op-xs diff-back-btn";
  backBtn.textContent = ctx.view.depth
    ? ctx.view.rack
      ? "← back to rack"
      : "← back to stage"
    : "← back to 2D";
  backBtn.title = "Return to wavetable view (Esc)";
  backBtn.addEventListener("click", closeDiffView);
  bar.appendChild(backBtn);

  const crumbText = wt
    ? `BURN TRAY · ${sync.repoName} (${sync.headRef}) · ${
        wt.clean ? "CLEAN" : `${wt.dirtyCount} UNCOMMITTED FILE${wt.dirtyCount === 1 ? "" : "S"}`
      }`
    : "BURN TRAY · LIVE COMPANION REQUIRED";
  bar.appendChild(el("span", "diff-crumb", crumbText));

  const actions = el("div", "diff-actions");
  const commitModeBtn = document.createElement("button");
  commitModeBtn.type = "button";
  commitModeBtn.className = "op op-xs";
  commitModeBtn.textContent = "commit history";
  commitModeBtn.title = "Switch back to inspecting committed history";
  commitModeBtn.addEventListener("click", () => openDiffView(ctx.focusCommit ?? null));
  actions.appendChild(commitModeBtn);

  if (ctx.onLiveAction) {
    const refreshBtn = document.createElement("button");
    refreshBtn.type = "button";
    refreshBtn.className = "op op-xs";
    refreshBtn.textContent = "refresh";
    refreshBtn.title = "Re-scan local working tree & origin sync status";
    refreshBtn.addEventListener("click", () => ctx.onLiveAction?.({ method: "refresh" }));
    actions.appendChild(refreshBtn);
  }

  const copyDiffBtn = document.createElement("button");
  copyDiffBtn.type = "button";
  copyDiffBtn.className = "op op-xs";
  copyDiffBtn.textContent = "copy git diff";
  copyDiffBtn.addEventListener("click", () => copyText("git diff", "git diff copied"));
  actions.appendChild(copyDiffBtn);

  bar.appendChild(actions);
  host.appendChild(bar);

  if (!sync || !wt) {
    host.appendChild(
      el(
        "div",
        "diff-empty",
        "Start the local live companion (`node tools/live-server.mjs`) to inspect uncommitted working-tree files in real time."
      )
    );
    return;
  }

  const changes = Array.isArray(wt.changes) && wt.changes.length
    ? wt.changes
    : wt.files.map((f) => ({
        path: f.path,
        status: f.state === "untracked" ? "added" : f.code.includes("D") ? "deleted" : "modified",
        state: f.state,
        insertions: 0,
        deletions: 0,
      }));

  const body = el("div", "diff-body");
  const sidebar = el("aside", "diff-sidebar");

  /* Left: Working tree files */
  const secFiles = el("div", "diff-side-sec diff-side-grow");
  const fHead = el("div", "diff-side-head");
  fHead.appendChild(el("span", "", `UNCOMMITTED FILES (${changes.length})`));
  if (ctx.diffFile) {
    const allBtn = document.createElement("button");
    allBtn.type = "button";
    allBtn.className = "op op-xs";
    allBtn.textContent = "all";
    allBtn.addEventListener("click", () => {
      ctx.diffFile = null;
      renderDiffView();
    });
    fHead.appendChild(allBtn);
  }
  secFiles.appendChild(fHead);

  const fList = el("div", "diff-file-list");
  if (!changes.length) {
    fList.appendChild(el("div", "diff-lin-empty", "working tree is clean"));
  } else {
    for (const ch of changes) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = ctx.diffFile === ch.path ? "diff-file-row is-active" : "diff-file-row";
      const st = statusBadgeMeta(ch.status);
      btn.appendChild(el("span", `diff-st ${st.cls}`, st.glyph));
      btn.appendChild(el("span", "diff-file-name", ch.path));
      btn.appendChild(
        el(
          "span",
          "diff-file-mini",
          ch.insertions || ch.deletions ? `+${ch.insertions} −${ch.deletions}` : ch.state || st.label
        )
      );
      btn.title = `${ch.state || st.label}: ${ch.path}`;
      btn.addEventListener("click", () => {
        ctx.diffFile = ctx.diffFile === ch.path ? null : ch.path;
        renderDiffView();
      });
      fList.appendChild(btn);
    }
  }
  secFiles.appendChild(fList);
  sidebar.appendChild(secFiles);

  /* Left bottom: Local vs GitHub Branch Delta */
  const secSync = el("div", "diff-side-sec");
  secSync.appendChild(el("div", "diff-side-head", "LOCAL ↔ GITHUB SYNC"));
  const bList = el("div", "diff-lineage");
  for (const br of sync.branches.slice(0, 8)) {
    const row = el("div", "diff-sync-row");
    row.appendChild(el("span", "diff-sync-name", `${br.current ? "● " : ""}${br.name}`));
    const tag = br.localOnly
      ? "local-only"
      : br.ahead || br.behind
        ? `↑${br.ahead} ↓${br.behind}`
        : "synced";
    row.appendChild(el("span", tag === "synced" ? "diff-sync-tag is-ok" : "diff-sync-tag is-warn", tag));
    bList.appendChild(row);
  }
  if (sync.remoteOnlyBranches.length) {
    bList.appendChild(
      el(
        "div",
        "diff-lin-empty",
        `+${sync.remoteOnlyBranches.length} branch${sync.remoteOnlyBranches.length === 1 ? "" : "es"} on origin only`
      )
    );
  }
  secSync.appendChild(bList);
  sidebar.appendChild(secSync);
  body.appendChild(sidebar);

  /* Right Main Pane */
  const main = el("div", "diff-main");
  const cHead = el("section", "diff-commit-head");
  const titleRow = el("div", "diff-title-row");
  titleRow.appendChild(
    el(
      "h2",
      "diff-subject",
      wt.clean
        ? "Burn Tray Clean — all local files are committed"
        : `Uncommitted Local Changes on ${sync.headRef}`
    )
  );
  cHead.appendChild(titleRow);

  const metaRow = el("div", "diff-meta-row");
  metaRow.appendChild(el("span", "diff-ref-pill", sync.headRef));
  metaRow.appendChild(el("span", "diff-pr-pill is-open", `sync: ${sync.syncState}`));
  if (sync.remoteUrl) {
    metaRow.appendChild(el("span", "diff-time", sync.remoteUrl));
  }
  cHead.appendChild(metaRow);

  const totalIns = changes.reduce((sum, ch) => sum + (ch.insertions || 0), 0);
  const totalDel = changes.reduce((sum, ch) => sum + (ch.deletions || 0), 0);
  const churnTotal = Math.max(1, totalIns + totalDel);
  const addPct = Math.round((totalIns / churnTotal) * 100);
  const statStrip = el("div", "diff-stat-strip");
  statStrip.appendChild(el("span", "add", `+${totalIns} staged/unstaged`));
  statStrip.appendChild(el("span", "del", `−${totalDel} deletions`));
  statStrip.appendChild(
    el(
      "span",
      "diff-stat-files",
      `${wt.staged} staged · ${wt.modified} modified · ${wt.untracked} untracked`
    )
  );
  const ratioBar = el("span", "diff-ratio-bar");
  const ratioAdd = el("i", "diff-ratio-add");
  ratioAdd.style.width = `${addPct}%`;
  const ratioDel = el("i", "diff-ratio-del");
  ratioDel.style.width = `${100 - addPct}%`;
  ratioBar.appendChild(ratioAdd);
  ratioBar.appendChild(ratioDel);
  statStrip.appendChild(ratioBar);
  cHead.appendChild(statStrip);
  main.appendChild(cHead);

  const patchArea = el("div", "diff-patches");
  if (!changes.length) {
    const notice = el("section", "diff-notice");
    notice.appendChild(el("div", "diff-notice-title", "Nothing waiting in your Burn Tray"));
    notice.appendChild(
      el(
        "p",
        "diff-notice-body",
        "Every tracked file matches HEAD and no untracked files are waiting. Make an edit or let an agent work on this repository to watch live diffs stream here automatically."
      )
    );
    const cmds = el("div", "diff-cmds");
    cmds.appendChild(makeCopyCmdRow("check status", "git status -sb"));
    cmds.appendChild(makeCopyCmdRow("fetch origin", "git fetch --all --prune"));
    notice.appendChild(cmds);
    patchArea.appendChild(notice);
  } else {
    const visible = ctx.diffFile
      ? changes.filter((ch) => ch.path === ctx.diffFile)
      : changes;
    for (const ch of visible) {
      renderUnifiedPatch(patchArea, ch);
    }
  }
  main.appendChild(patchArea);
  body.appendChild(main);
  host.appendChild(body);
}

function formatBytes(n) {
  if (!Number.isFinite(n) || n < 0) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function renderFilePreviewView(host) {
  const target = ctx.diffFile || "";
  const isFolder = target.endsWith("/");
  const tree = ctx.liveSync?.tree;
  const allFiles = tree?.allFiles ?? [];
  const dirtyByPath = new Map(
    (ctx.liveSync?.workingTree?.files ?? []).map((f) => [f.path.replace(/\\/g, "/"), f])
  );

  /* Determine folder scope for the left file explorer */
  const folderPrefix = isFolder
    ? target
    : target.includes("/")
      ? target.slice(0, target.lastIndexOf("/") + 1)
      : "";

  const scopedFiles = folderPrefix
    ? allFiles.filter((p) => p.startsWith(folderPrefix))
    : allFiles.filter((p) => !p.includes("/"));

  const matchingCommits = ctx.model
    ? [...searchCommits(ctx.model, `path:${target}`).matches].reverse()
    : [];

  /* ---- 1. Top Toolbar ---- */
  const bar = el("header", "diff-bar");
  const backBtn = document.createElement("button");
  backBtn.type = "button";
  backBtn.className = "op op-xs diff-back-btn";
  backBtn.textContent = ctx.browserOpen
    ? "← back to browser"
    : ctx.view.depth
      ? ctx.view.rack
        ? "← back to rack"
        : "← back to stage"
      : "← back to 2D";
  backBtn.title = "Return without changing Rack oscillators (Esc)";
  backBtn.addEventListener("click", closeDiffView);
  bar.appendChild(backBtn);

  const crumbText = `${isFolder ? "FOLDER" : "FILE"} · ${target} · ${matchingCommits.length} commit${
    matchingCommits.length === 1 ? "" : "s"
  }`;
  bar.appendChild(el("span", "diff-crumb", crumbText));

  const actions = el("div", "diff-actions");
  const isMarkdown = !isFolder && /\.(md|markdown|mdx)$/i.test(target);
  const isHtml = !isFolder && /\.(html|htm)$/i.test(target);
  if (isMarkdown || isHtml) {
    const toggleBtn = document.createElement("button");
    toggleBtn.type = "button";
    toggleBtn.className = "op op-xs";
    toggleBtn.textContent =
      fileViewMode === "rendered"
        ? "raw source"
        : isHtml
          ? "live preview"
          : "rendered doc";
    toggleBtn.title = "Switch between formatted preview and raw line-numbered source";
    toggleBtn.addEventListener("click", () => {
      fileViewMode = fileViewMode === "rendered" ? "raw" : "rendered";
      renderDiffView();
    });
    actions.appendChild(toggleBtn);
  }

  const dirtyEntry = !isFolder ? dirtyByPath.get(target) : null;
  if (dirtyEntry) {
    const wtBtn = document.createElement("button");
    wtBtn.type = "button";
    wtBtn.className = "op op-xs";
    wtBtn.textContent = `burn tray (${dirtyEntry.state})`;
    wtBtn.title = "Inspect uncommitted local diff for this file";
    wtBtn.addEventListener("click", () => openWorkingTreeDiff(target));
    actions.appendChild(wtBtn);
  }

  const pinBtn = document.createElement("button");
  pinBtn.type = "button";
  pinBtn.className = "op op-xs";
  pinBtn.textContent = "+ pin wave";
  pinBtn.title = `Explicitly add "${target}" as a new oscillator in the 3D Rack`;
  pinBtn.addEventListener("click", () => {
    if (!ctx.view) return;
    const next = pinModule(ctx.view, {
      name: target.slice(0, 40),
      query: `path:${target}`.slice(0, 120),
      colorKey: (ctx.view.modules.length + 1) % 6,
    });
    if (next === ctx.view) {
      announce(
        ctx.view.modules.length >= 8
          ? "rack holds 8 oscillators"
          : `“${target}” is already pinned in the rack`
      );
      return;
    }
    setView(next);
    announce(`pinned “${target}” to rack`);
  });
  actions.appendChild(pinBtn);

  const copyPathBtn = document.createElement("button");
  copyPathBtn.type = "button";
  copyPathBtn.className = "op op-xs";
  copyPathBtn.textContent = "copy path";
  copyPathBtn.addEventListener("click", () => copyText(target, "path copied"));
  actions.appendChild(copyPathBtn);

  const copyLogBtn = document.createElement("button");
  copyLogBtn.type = "button";
  copyLogBtn.className = "op op-xs";
  copyLogBtn.textContent = "copy git log";
  copyLogBtn.addEventListener("click", () =>
    copyText(`git log -p -- "${target}"`, "git log command copied")
  );
  actions.appendChild(copyLogBtn);

  bar.appendChild(actions);
  host.appendChild(bar);

  /* ---- 2. Split Body (Left: Folder Files + Path Commits · Right: Read-Only Preview) ---- */
  const body = el("div", "diff-body");
  const sidebar = el("aside", "diff-sidebar");

  /* 2a. Files in this folder */
  const secFiles = el("div", "diff-side-sec diff-side-grow");
  const fHead = el("div", "diff-side-head");
  fHead.appendChild(
    el("span", "", `${folderPrefix ? folderPrefix.toUpperCase() : "ROOT FILES"} (${scopedFiles.length})`)
  );
  if (folderPrefix) {
    const upBtn = document.createElement("button");
    upBtn.type = "button";
    upBtn.className = "op op-xs";
    upBtn.textContent = "root";
    upBtn.title = "View top-level folder";
    upBtn.addEventListener("click", () => {
      const parent = folderPrefix.slice(0, -1);
      const slash = parent.lastIndexOf("/");
      if (slash >= 0) openFileView(parent.slice(0, slash + 1));
      else if (tree?.rootFiles?.[0]) openFileView(tree.rootFiles[0].path);
    });
    fHead.appendChild(upBtn);
  }
  secFiles.appendChild(fHead);

  const fList = el("div", "diff-file-list");
  if (!scopedFiles.length) {
    fList.appendChild(el("div", "diff-lin-empty", "no tracked files listed in this folder"));
  } else {
    for (const p of scopedFiles.slice(0, 140)) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = target === p ? "diff-file-row is-active" : "diff-file-row";
      const d = dirtyByPath.get(p);
      btn.appendChild(el("span", d ? "diff-st is-mod" : "diff-st is-add", d ? d.code : "·"));
      const displayName = folderPrefix && p.startsWith(folderPrefix) ? p.slice(folderPrefix.length) : p;
      btn.appendChild(el("span", "diff-file-name", displayName));
      if (d) btn.appendChild(el("span", "diff-file-mini", d.state));
      btn.title = p;
      btn.addEventListener("click", () => openFileView(p));
      fList.appendChild(btn);
    }
  }
  secFiles.appendChild(fList);
  sidebar.appendChild(secFiles);

  /* 2b. Commits touching this file/folder */
  const secCommits = el("div", "diff-side-sec");
  secCommits.appendChild(el("div", "diff-side-head", `HISTORY (${matchingCommits.length})`));
  const cList = el("div", "diff-commit-list");
  if (!matchingCommits.length) {
    cList.appendChild(el("div", "diff-lin-empty", "no commits matched in snapshot"));
  } else {
    for (const item of matchingCommits.slice(0, 24)) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "diff-commit-row";
      const top = el("div", "diff-cr-top");
      top.appendChild(el("code", "diff-cr-sha", shortSha(item.sha, 7)));
      top.appendChild(el("span", "diff-cr-meta", dateMedium(Date.parse(item.time))));
      row.appendChild(top);
      row.appendChild(el("div", "diff-cr-subj", item.subject));
      row.addEventListener("click", () => openDiffView(item));
      cList.appendChild(row);
    }
  }
  secCommits.appendChild(cList);
  sidebar.appendChild(secCommits);
  body.appendChild(sidebar);

  /* Right Main Pane */
  const main = el("div", "diff-main");
  const cHead = el("section", "diff-commit-head");
  const titleRow = el("div", "diff-title-row");
  titleRow.appendChild(el("h2", "diff-subject", target));
  cHead.appendChild(titleRow);

  const metaRow = el("div", "diff-meta-row");
  metaRow.appendChild(el("span", "diff-ref-pill", ctx.doc?.repo.name ?? "repo"));
  if (ctx.liveSync?.headRef) {
    metaRow.appendChild(el("span", "diff-ref-pill", ctx.liveSync.headRef));
  }
  if (dirtyEntry) {
    metaRow.appendChild(el("span", "diff-pr-pill is-open", `burn tray: ${dirtyEntry.state}`));
  } else {
    metaRow.appendChild(el("span", "diff-pr-pill", "read-only preview"));
  }
  if (!isFolder && ctx.filePreview && !ctx.filePreview.loading && !ctx.filePreview.error) {
    metaRow.appendChild(
      el(
        "span",
        "diff-time",
        `${formatBytes(ctx.filePreview.sizeBytes ?? 0)}${
          ctx.filePreview.binary ? " · binary" : ` · ${ctx.filePreview.lineCount ?? 0} lines`
        }${ctx.filePreview.truncated ? " (truncated at 128 KB)" : ""}`
      )
    );
  }
  cHead.appendChild(metaRow);
  main.appendChild(cHead);

  const contentArea = el("div", "diff-patches");
  if (isFolder) {
    const grid = el("div", "folder-grid");
    for (const p of scopedFiles.slice(0, 120)) {
      const card = document.createElement("button");
      card.type = "button";
      card.className = dirtyByPath.has(p) ? "folder-card is-dirty" : "folder-card";
      const rel = p.startsWith(target) ? p.slice(target.length) : p;
      card.appendChild(el("span", "folder-card-name", rel));
      card.appendChild(
        el("span", "folder-card-meta", dirtyByPath.has(p) ? dirtyByPath.get(p).state : "tracked")
      );
      card.addEventListener("click", () => openFileView(p));
      grid.appendChild(card);
    }
    if (!scopedFiles.length) {
      contentArea.appendChild(el("div", "diff-empty", "No files found inside this folder."));
    } else {
      contentArea.appendChild(grid);
    }
  } else {
    const fp = ctx.filePreview;
    if (fp && fp.loading) {
      contentArea.appendChild(el("div", "diff-empty", `Reading ${target}…`));
    } else if (fp && fp.error) {
      const notice = el("section", "diff-notice");
      notice.appendChild(el("div", "diff-notice-title", `Could not read ${target}`));
      notice.appendChild(el("p", "diff-notice-body", fp.error));
      contentArea.appendChild(notice);
    } else if (fp && fp.binary) {
      const notice = el("section", "diff-notice");
      notice.appendChild(el("div", "diff-notice-title", `Binary file · ${formatBytes(fp.sizeBytes ?? 0)}`));
      notice.appendChild(
        el(
          "p",
          "diff-notice-body",
          "Binary files are not rendered as text. Select any commit in the History list on the left to inspect when this file changed."
        )
      );
      contentArea.appendChild(notice);
    } else if (fp && typeof fp.content === "string") {
      if (isMarkdown && fileViewMode === "rendered") {
        const block = el("section", "diff-file-block md-surface");
        block.appendChild(renderMarkdownDom(fp.content));
        contentArea.appendChild(block);
      } else if (isHtml && fileViewMode === "rendered") {
        const block = el("section", "diff-file-block html-preview-block");
        const frame = document.createElement("iframe");
        frame.className = "html-preview-frame";
        frame.setAttribute("sandbox", "allow-scripts");
        frame.setAttribute("title", `Live preview of ${target}`);
        frame.srcdoc = fp.content;
        block.appendChild(frame);
        contentArea.appendChild(block);
      } else {
        const block = el("section", "diff-file-block");
        const code = el("div", "file-code-wrap");
        const lines = fp.content.split("\n");
        const maxLines = Math.min(lines.length, 2000);
        for (let i = 0; i < maxLines; i++) {
          const row = el("div", "file-line");
          row.appendChild(el("span", "file-lnum", String(i + 1)));
          row.appendChild(el("span", "file-ltext", lines[i]));
          code.appendChild(row);
        }
        if (lines.length > maxLines) {
          code.appendChild(
            el("div", "diff-empty-patch", `Showing first ${maxLines} of ${lines.length} lines`)
          );
        }
        block.appendChild(code);
        contentArea.appendChild(block);
      }
    } else {
      const notice = el("section", "diff-notice");
      notice.appendChild(el("div", "diff-notice-title", "Offline snapshot — live file contents unavailable"));
      notice.appendChild(
        el(
          "p",
          "diff-notice-body",
          "Start the local live companion (`node tools/live-server.mjs`) to read live files directly from disk, or select any commit on the left to inspect embedded diffs."
        )
      );
      contentArea.appendChild(notice);
    }
  }

  main.appendChild(contentArea);
  body.appendChild(main);
  host.appendChild(body);
}

export function renderDiffView() {
  const host = document.getElementById("diffView");
  if (!host || !ctx.diffOpen || !ctx.model || !ctx.view || !ctx.window) return;
  clear(host);

  if (ctx.diffTarget === "file") {
    renderFilePreviewView(host);
    return;
  }

  if (ctx.diffTarget === "working-tree") {
    renderWorkingTreeDiffView(host);
    return;
  }

  const winCommits = findWindowCommits();
  let commit = ctx.focusCommit;
  if (!commit && winCommits.length) {
    commit = winCommits[winCommits.length - 1];
  }
  if (!commit) {
    commit = ctx.model.doc.commits[ctx.model.doc.commits.length - 1] ?? null;
  }

  /* Determine which slot holds this commit */
  let slotIndex = -1;
  let activeSlot = null;
  if (commit) {
    const t = Date.parse(commit.time);
    if (t >= ctx.window.startMs && t <= ctx.window.endMs) {
      slotIndex = slotIndexForTime(ctx.window, t);
      activeSlot = ctx.slots[slotIndex] ?? null;
    }
  }

  const slotCommits =
    activeSlot && activeSlot.commits.length
      ? [...activeSlot.commits].reverse()
      : commit
        ? [commit]
        : [];

  /* ---- 1. Top Toolbar ---- */
  const bar = el("header", "diff-bar");
  const backBtn = document.createElement("button");
  backBtn.type = "button";
  backBtn.className = "op op-xs diff-back-btn";
  backBtn.textContent = ctx.view.depth
    ? ctx.view.rack
      ? "← back to rack"
      : "← back to stage"
    : "← back to 2D";
  backBtn.title = "Return to wavetable view (Esc)";
  backBtn.addEventListener("click", closeDiffView);
  bar.appendChild(backBtn);

  const crumbText =
    activeSlot && slotIndex >= 0
      ? `SLOT ${slotIndex + 1}/${SLOT_COUNT} · ${dateMedium(activeSlot.startMs)} – ${dateMedium(
          activeSlot.endMs
        )} · ${activeSlot.count} commit${activeSlot.count === 1 ? "" : "s"}`
      : commit
        ? `COMMIT ${shortSha(commit.sha, 7)}`
        : "NO COMMIT SELECTED";
  bar.appendChild(el("span", "diff-crumb", crumbText));

  /* Chronological commit stepper inside the active window */
  const nav = el("div", "diff-nav");
  const idxInWin = commit ? winCommits.findIndex((c) => c.sha === commit.sha) : -1;
  const prevBtn = document.createElement("button");
  prevBtn.type = "button";
  prevBtn.className = "op op-xs";
  prevBtn.textContent = "‹ prev";
  prevBtn.title = "Older commit in window";
  prevBtn.disabled = idxInWin <= 0;
  prevBtn.addEventListener("click", () => {
    if (idxInWin > 0) selectCommit(winCommits[idxInWin - 1]);
  });

  const nextBtn = document.createElement("button");
  nextBtn.type = "button";
  nextBtn.className = "op op-xs";
  nextBtn.textContent = "next ›";
  nextBtn.title = "Newer commit in window";
  nextBtn.disabled = idxInWin < 0 || idxInWin >= winCommits.length - 1;
  nextBtn.addEventListener("click", () => {
    if (idxInWin >= 0 && idxInWin < winCommits.length - 1) {
      selectCommit(winCommits[idxInWin + 1]);
    }
  });
  nav.appendChild(prevBtn);
  nav.appendChild(nextBtn);
  bar.appendChild(nav);

  /* Quick read-only git copy actions */
  if (commit) {
    const actions = el("div", "diff-actions");
    if (ctx.liveSync && ctx.liveSync.workingTree) {
      const burnBtn = document.createElement("button");
      burnBtn.type = "button";
      burnBtn.className = "op op-xs";
      burnBtn.textContent = ctx.liveSync.workingTree.clean
        ? "burn tray (clean)"
        : `burn tray (${ctx.liveSync.workingTree.dirtyCount})`;
      burnBtn.title = "Inspect uncommitted local working-tree diffs";
      burnBtn.addEventListener("click", () => openWorkingTreeDiff());
      actions.appendChild(burnBtn);
    }
    const copyShow = document.createElement("button");
    copyShow.type = "button";
    copyShow.className = "op op-xs";
    copyShow.textContent = "copy git show";
    copyShow.addEventListener("click", () =>
      copyText(`git show -p ${commit.sha}`, "git show -p copied")
    );

    const copyShaBtn = document.createElement("button");
    copyShaBtn.type = "button";
    copyShaBtn.className = "op op-xs";
    copyShaBtn.textContent = shortSha(commit.sha, 7);
    copyShaBtn.title = `Copy full SHA (${commit.sha})`;
    copyShaBtn.addEventListener("click", () => copyText(commit.sha, "commit sha copied"));

    actions.appendChild(copyShow);
    actions.appendChild(copyShaBtn);
    bar.appendChild(actions);
  }
  host.appendChild(bar);

  if (!commit) {
    host.appendChild(el("div", "diff-empty", "Double-click any active slot to inspect its commits and diffs."));
    return;
  }

  /* ---- 2. Split Body (Left: Slot Commits & Files · Right: Commit Details & Unified Diff) ---- */
  const body = el("div", "diff-body");

  /* Left Sidebar */
  const sidebar = el("aside", "diff-sidebar");

  /* 2a. Commits in this slot */
  const secCommits = el("div", "diff-side-sec");
  secCommits.appendChild(
    el(
      "div",
      "diff-side-head",
      `COMMITS IN SLICE (${slotCommits.length})`
    )
  );
  const cList = el("div", "diff-commit-list");
  for (const item of slotCommits) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = item.sha === commit.sha ? "diff-commit-row is-active" : "diff-commit-row";
    const top = el("div", "diff-cr-top");
    top.appendChild(el("code", "diff-cr-sha", shortSha(item.sha, 7)));
    const delta = el("span", "diff-cr-delta");
    delta.appendChild(el("span", "add", `+${item.insertions}`));
    delta.appendChild(document.createTextNode(" "));
    delta.appendChild(el("span", "del", `−${item.deletions}`));
    top.appendChild(delta);
    row.appendChild(top);
    row.appendChild(el("div", "diff-cr-subj", item.subject));
    row.appendChild(
      el(
        "div",
        "diff-cr-meta",
        `${item.author.name}${item.author.kind === "agent" ? " ◈" : ""} · ${item.files}f`
      )
    );
    row.addEventListener("click", () => selectCommit(item));
    cList.appendChild(row);
  }
  secCommits.appendChild(cList);
  sidebar.appendChild(secCommits);

  /* 2b. Changed Files (when embedded) OR Lineage Tree */
  const changes = Array.isArray(commit.changes) && commit.changes.length ? commit.changes : null;
  const secFiles = el("div", "diff-side-sec diff-side-grow");
  if (changes) {
    const fHead = el("div", "diff-side-head");
    fHead.appendChild(el("span", "", `CHANGED FILES (${changes.length})`));
    if (ctx.diffFile) {
      const allBtn = document.createElement("button");
      allBtn.type = "button";
      allBtn.className = "op op-xs";
      allBtn.textContent = "all";
      allBtn.addEventListener("click", () => {
        ctx.diffFile = null;
        renderDiffView();
      });
      fHead.appendChild(allBtn);
    }
    secFiles.appendChild(fHead);

    const fList = el("div", "diff-file-list");
    for (const ch of changes) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className =
        ctx.diffFile === ch.path ? "diff-file-row is-active" : "diff-file-row";
      const st = statusBadgeMeta(ch.status);
      btn.appendChild(el("span", `diff-st ${st.cls}`, st.glyph));
      btn.appendChild(el("span", "diff-file-name", ch.path));
      btn.appendChild(el("span", "diff-file-mini", `+${ch.insertions} −${ch.deletions}`));
      btn.title = `${st.label}: ${ch.path}`;
      btn.addEventListener("click", () => {
        ctx.diffFile = ctx.diffFile === ch.path ? null : ch.path;
        renderDiffView();
      });
      fList.appendChild(btn);
    }
    secFiles.appendChild(fList);
  } else {
    secFiles.appendChild(el("div", "diff-side-head", "LINEAGE & PARENTS"));
    const lin = el("div", "diff-lineage");
    const parents = commit.parents
      .map((sha) => ctx.model?.commitBySha.get(sha) ?? null)
      .filter(Boolean);
    const children = findChildren(commit.sha);

    if (parents.length) {
      lin.appendChild(el("div", "diff-lin-tag", "PARENT"));
      for (const p of parents) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "diff-lin-btn";
        b.appendChild(el("code", "diff-cr-sha", shortSha(p.sha, 7)));
        b.appendChild(el("span", "diff-lin-subj", p.subject));
        b.addEventListener("click", () => selectCommit(p));
        lin.appendChild(b);
      }
    }
    if (children.length) {
      lin.appendChild(el("div", "diff-lin-tag", "NEXT / CHILD"));
      for (const ch of children.slice(0, 4)) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "diff-lin-btn";
        b.appendChild(el("code", "diff-cr-sha", shortSha(ch.sha, 7)));
        b.appendChild(el("span", "diff-lin-subj", ch.subject));
        b.addEventListener("click", () => selectCommit(ch));
        lin.appendChild(b);
      }
    }
    if (!parents.length && !children.length) {
      lin.appendChild(el("div", "diff-lin-empty", "root commit in snapshot"));
    }
    secFiles.appendChild(lin);
  }
  sidebar.appendChild(secFiles);
  body.appendChild(sidebar);

  /* Right Main Pane */
  const main = el("div", "diff-main");

  /* Commit Summary Header */
  const cHead = el("section", "diff-commit-head");
  const titleRow = el("div", "diff-title-row");
  titleRow.appendChild(el("h2", "diff-subject", commit.subject));
  cHead.appendChild(titleRow);

  const metaRow = el("div", "diff-meta-row");
  metaRow.appendChild(el("code", "diff-sha-full", commit.sha));
  metaRow.appendChild(el("span", "diff-meta-sep", "·"));
  metaRow.appendChild(el("span", "diff-author-name", commit.author.name));
  if (commit.author.kind === "agent") {
    const badge = el(
      "span",
      "diff-agent-badge",
      commit.agent ? `◈ ${commit.agent.runtime} / ${commit.agent.model}` : "◈ agent"
    );
    metaRow.appendChild(badge);
  }
  metaRow.appendChild(el("span", "diff-meta-sep", "·"));
  metaRow.appendChild(el("span", "diff-time", timeFull(Date.parse(commit.time))));
  for (const refId of commit.refs) {
    const ref = ctx.model.refsById.get(refId);
    metaRow.appendChild(el("span", "diff-ref-pill", ref ? ref.name : refId));
    if (ref?.pr) {
      const prCls = ref.pr.state === "open" || ref.pr.state === "draft" ? "diff-pr-pill is-open" : "diff-pr-pill";
      metaRow.appendChild(
        el("span", prCls, `PR #${ref.pr.number} · ${ref.pr.state} · ${ref.pr.review}`)
      );
    }
  }
  cHead.appendChild(metaRow);

  /* Churn Ratio Strip */
  const churnTotal = Math.max(1, commit.insertions + commit.deletions);
  const addPct = Math.round((commit.insertions / churnTotal) * 100);
  const statStrip = el("div", "diff-stat-strip");
  statStrip.appendChild(el("span", "add", `+${commit.insertions} insertions`));
  statStrip.appendChild(el("span", "del", `−${commit.deletions} deletions`));
  statStrip.appendChild(el("span", "diff-stat-files", `${commit.files} file${commit.files === 1 ? "" : "s"} changed`));
  const ratioBar = el("span", "diff-ratio-bar");
  const ratioAdd = el("i", "diff-ratio-add");
  ratioAdd.style.width = `${addPct}%`;
  const ratioDel = el("i", "diff-ratio-del");
  ratioDel.style.width = `${100 - addPct}%`;
  ratioBar.appendChild(ratioAdd);
  ratioBar.appendChild(ratioDel);
  statStrip.appendChild(ratioBar);
  cHead.appendChild(statStrip);
  main.appendChild(cHead);

  /* Unified Diffs OR Honest Summary + Copyable Local Git Diff Commands */
  const patchArea = el("div", "diff-patches");
  if (changes) {
    const visible = ctx.diffFile
      ? changes.filter((ch) => ch.path === ctx.diffFile)
      : changes;
    for (const ch of visible) {
      renderUnifiedPatch(patchArea, ch);
    }
  } else {
    const notice = el("section", "diff-notice");
    notice.appendChild(
      el(
        "div",
        "diff-notice-title",
        "Summary-only snapshot — no embedded patch hunks for this commit"
      )
    );
    notice.appendChild(
      el(
        "p",
        "diff-notice-body",
        `This snapshot (${ctx.doc?.repo.name ?? "repo"}) stores commit metadata and churn metrics without inline file patches. Run the local exporter with --patches on any Git repository and load the .gitwave.json via "open" to browse full syntax-highlighted file diffs right here, or copy a read-only git command below:`
      )
    );
    const cmds = el("div", "diff-cmds");
    cmds.appendChild(makeCopyCmdRow("full patch", `git show -p ${commit.sha}`));
    cmds.appendChild(makeCopyCmdRow("file stats", `git show --stat ${commit.sha}`));
    if (commit.parents[0]) {
      cmds.appendChild(
        makeCopyCmdRow("parent diff", `git diff ${shortSha(commit.parents[0], 7)}..${shortSha(commit.sha, 7)}`)
      );
    }
    cmds.appendChild(
      makeCopyCmdRow(
        "export local repo",
        "node tools/export-repo.mjs . --patches > repo.gitwave.json"
      )
    );
    notice.appendChild(cmds);
    patchArea.appendChild(notice);
  }

  main.appendChild(patchArea);
  body.appendChild(main);
  host.appendChild(body);
}
