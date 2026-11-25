/**
 * readout.js — the header readout, the focus card and the tension summary.
 *
 * Every commit string is written with textContent: subjects are untrusted.
 */

import { ctx } from "../app.ts";
import { dateShort, timeFull } from "../core/samples.ts";
import { wtPosOf } from "../core/view.ts";
import { openDiffView } from "../ui/diff.js";
import { copyText } from "../ui/status.ts";
import { el, shortSha } from "../ui/dom.js";

let lastCommitCardKey = "";
let lastTensionSummaryKey = "";

function stat(text, className) {
  return el("span", className || "", text);
}

function reviewLabel(value) {
  return (
    {
      none: "no review",
      required: "review required",
      approved: "approved",
      changes_requested: "changes requested",
    }[value] || value
  );
}

function checksLabel(value) {
  return (
    {
      none: "no checks",
      pending: "checks pending",
      passing: "checks passing",
      failing: "checks failing",
    }[value] || value
  );
}

export function renderReadout() {
  if (!ctx.doc || !ctx.view || !ctx.window) return;
  const repoOut = document.getElementById("repoOut");
  if (repoOut) {
    repoOut.textContent = `${ctx.doc.repo.name} · ${ctx.doc.refs.length} refs · ${ctx.doc.commits.length} commits`;
  }

  const focusOut = document.getElementById("focusOut");
  if (focusOut) {
    focusOut.textContent = ctx.focusRef
      ? `${ctx.focusRef.name}${ctx.view.focusSha ? ` · ${shortSha(ctx.view.focusSha)}` : ""}`
      : "no ref focused";
  }

  const windowOut = document.getElementById("windowOut");
  if (windowOut) {
    if (ctx.view.depth) {
      const span = ctx.window.endMs - ctx.window.startMs;
      const pct = ctx.model ? Math.round(wtPosOf(ctx.model, ctx.view) * 100) : 100;
      windowOut.textContent = ctx.view.rack
        ? `rack · WT ${pct}% · ${dateShort(ctx.window.endMs)}`
        : `stage · WT ${pct}% · ${dateShort(ctx.window.startMs)}–${dateShort(ctx.window.endMs)}`;
      windowOut.title = `${dateShort(ctx.window.startMs)} – ${dateShort(ctx.window.endMs)} (${Math.round(
        span / 86400000
      )} days)`;
    } else {
      windowOut.textContent = `${ctx.view.span} · ${dateShort(ctx.window.startMs)} – ${dateShort(
        ctx.window.endMs
      )}`;
      windowOut.title = "";
    }
  }

  renderCommitCard();
  renderTensionSummary();

  const wave = document.getElementById("wave");
  if (wave) {
    const stale = ctx.prs.filter((pr) => pr.stale).length;
    const mode = ctx.view.depth ? "3D depth field" : "2D history";
    const search = ctx.search.query
      ? ` Search “${ctx.search.query}”: ${ctx.search.count} matches.`
      : "";
    wave.setAttribute(
      "aria-label",
      `${mode}: ${ctx.view.span} ending ${dateShort(ctx.window.endMs)}, ` +
        `${ctx.waves.length} visible refs, ${ctx.prs.length} open pull requests, ${stale} stale. ` +
        `Metric ${ctx.metric ? ctx.metric.label : "all"}. ` +
        `Focus ${ctx.focusRef ? ctx.focusRef.name : "none"}.${search}`
    );
  }
}

function renderCommitCard() {
  const sha = document.getElementById("commitSha");
  const author = document.getElementById("commitAuthor");
  const subject = document.getElementById("commitSubject");
  const stats = document.getElementById("commitStats");
  const copy = document.getElementById("copyCommit");
  const openDiff = document.getElementById("openDiffBtn");
  if (!sha || !author || !subject || !stats || !copy) return;

  const commit = ctx.focusCommit;
  const key = `${ctx.doc?.repo.id ?? ""}|${commit?.sha ?? ""}`;
  if (key === lastCommitCardKey) return;
  lastCommitCardKey = key;

  stats.replaceChildren();
  author.replaceChildren();

  if (!commit) {
    sha.textContent = "—";
    subject.textContent = "no commit focused";
    copy.disabled = true;
    copy.dataset.command = "";
    if (openDiff) openDiff.disabled = true;
    return;
  }
  if (openDiff) openDiff.disabled = false;

  sha.textContent = shortSha(commit.sha, 7);
  sha.title = commit.sha;
  author.append(document.createTextNode(commit.author.name));
  if (commit.author.kind === "agent") {
    author.append(document.createTextNode(" "));
    author.append(stat("◈ agent", "agent-mark"));
    if (commit.agent) author.append(document.createTextNode(` ${commit.agent.model}`));
  }
  subject.textContent = commit.subject;

  stats.appendChild(stat(`+${commit.insertions}`, "add"));
  stats.appendChild(stat(`−${commit.deletions}`, "del"));
  stats.appendChild(stat(`${commit.files} files`));
  if (commit.merge) stats.appendChild(stat("merge", "warn"));
  if (commit.parents.length !== 1) {
    stats.appendChild(stat(`${commit.parents.length} parents`));
  }
  const refId = commit.refs[0];
  const ref = refId ? ctx.model?.refsById.get(refId) : null;
  if (ref) {
    stats.appendChild(stat(`ref ${ref.name}`));
    const pr = ref.pr;
    if (pr && commit.sha === ref.tip) {
      stats.appendChild(stat(`PR #${pr.number} ${pr.state}`));
      stats.appendChild(stat(reviewLabel(pr.review)));
      stats.appendChild(
        stat(checksLabel(pr.checks), pr.checks === "failing" ? "warn" : "")
      );
      if (pr.conflicts) stats.appendChild(stat("conflict", "warn"));
    }
  }
  stats.appendChild(stat(timeFull(Date.parse(commit.time))));

  copy.disabled = false;
  copy.dataset.command = `git show ${commit.sha} --stat`;
}

function renderTensionSummary() {
  const host = document.getElementById("tensionSummary");
  if (!host) return;
  const stale = ctx.prs.filter((pr) => pr.stale).length;
  const max = ctx.prs.reduce((value, pr) => Math.max(value, pr.tension), 0);
  const key = `${ctx.prs.length}|${stale}|${max.toFixed(2)}`;
  if (key === lastTensionSummaryKey) return;
  lastTensionSummaryKey = key;

  host.replaceChildren();
  if (!ctx.prs.length) {
    host.textContent = "no open pull requests";
    return;
  }
  host.appendChild(el("span", "", `tension ${max.toFixed(2)}`));
  host.appendChild(el("span", "", `${ctx.prs.length} open`));
  if (stale) host.appendChild(el("span", "risk", `${stale} stale`));
}

export function initReadout() {
  const copy = document.getElementById("copyCommit");
  if (copy) {
    copy.addEventListener("click", () => {
      const command = copy.dataset.command;
      if (!command) return;
      copyText(command, "git command copied");
    });
  }
  const openDiff = document.getElementById("openDiffBtn");
  if (openDiff) {
    openDiff.addEventListener("click", () => {
      if (ctx.focusCommit) openDiffView(ctx.focusCommit);
    });
  }
}
