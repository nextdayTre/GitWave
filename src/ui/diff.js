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
import { focusCommitView, focusSlot } from "../core/view.ts";
import { clear, el, shortSha } from "./dom.js";
import { copyText } from "./status.ts";

export function openDiffView(slotOrCommit = null) {
  if (!ctx.view || !ctx.model) return;
  ctx.diffOpen = true;
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

export function closeDiffView() {
  if (!ctx.diffOpen) return;
  ctx.diffOpen = false;
  ctx.diffFile = null;
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

export function renderDiffView() {
  const host = document.getElementById("diffView");
  if (!host || !ctx.diffOpen || !ctx.model || !ctx.view || !ctx.window) return;
  clear(host);

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
