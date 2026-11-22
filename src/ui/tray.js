/**
 * tray.js — the open pull-request list.
 *
 * A row can focus its branch or copy a `git log` command. Nothing here touches
 * the repository.
 */

import { ctx, setView } from "../app.ts";
import { isoOf, refTipTime, windowFor } from "../core/samples.ts";
import { showRef } from "../core/view.ts";
import { copyText } from "./status.ts";
import { clear, el } from "./dom.js";

export function openTray() {
  if (ctx.view && !ctx.view.tray) setView({ ...ctx.view, tray: true });
}

export function closeTray() {
  if (ctx.view?.tray) setView({ ...ctx.view, tray: false });
}

export function toggleTray() {
  if (ctx.view) setView({ ...ctx.view, tray: !ctx.view.tray });
}

export function focusPr(pr) {
  if (!ctx.view || !ctx.model) return;
  const tipMs = refTipTime(ctx.model, pr.ref);
  const end = isoOf(windowFor(ctx.model, isoOf(tipMs), ctx.view.span).endMs);
  const next = showRef(ctx.view, pr.ref.id);
  setView({
    ...next,
    focusRef: pr.ref.id,
    focusSha: pr.ref.tip,
    end,
    tray: false,
  });
}

const REVIEW = {
  none: "no review",
  required: "review required",
  approved: "approved",
  changes_requested: "changes requested",
};

const CHECKS = {
  none: "no checks",
  pending: "checks pending",
  passing: "checks passing",
  failing: "checks failing",
};

export function renderTray() {
  const tray = document.getElementById("prTray");
  const list = document.getElementById("trayList");
  if (!tray || !list || !ctx.view) return;
  tray.hidden = !ctx.view.tray;
  if (!ctx.view.tray) return;

  clear(list);
  if (!ctx.prs.length) {
    list.appendChild(el("p", "tray-empty", "no open pull requests"));
    return;
  }

  for (const pr of ctx.prs) {
    const row = el("div", "tray-row");
    const title = el("div", "tray-title");
    title.appendChild(el("span", "tray-num", `#${pr.pr.number}`));
    title.appendChild(el("span", "tray-name", pr.pr.title));

    const actions = el("div", "tray-actions");
    const focus = document.createElement("button");
    focus.type = "button";
    focus.className = "op";
    focus.textContent = "focus";
    focus.title = `Jump the read head to ${pr.ref.name}`;
    focus.addEventListener("click", () => focusPr(pr));

    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "op";
    copy.textContent = "copy log";
    copy.title = "Copy a git log command (nothing is executed)";
    copy.addEventListener("click", () => {
      const base = pr.ref.base ?? ctx.doc?.repo.defaultRef ?? "main";
      copyText(`git log --oneline ${base}..${pr.ref.name}`, "git log command copied");
    });

    actions.appendChild(focus);
    actions.appendChild(copy);

    const meta = el("div", "tray-meta");
    meta.appendChild(el("span", "", `ref ${pr.ref.name}`));
    meta.appendChild(el("span", pr.stale ? "stale" : "", `${pr.ageDays.toFixed(1)}d`));
    meta.appendChild(el("span", "", `${pr.commits} commits`));
    meta.appendChild(el("span", "", `±${pr.churn} churn`));
    meta.appendChild(el("span", "", REVIEW[pr.pr.review] ?? pr.pr.review));
    meta.appendChild(
      el("span", pr.pr.checks === "failing" ? "stale" : "", CHECKS[pr.pr.checks] ?? pr.pr.checks)
    );
    if (pr.pr.conflicts) meta.appendChild(el("span", "stale", "conflict"));
    if (pr.pr.draft) meta.appendChild(el("span", "", "draft"));
    if (pr.agentAuthored) meta.appendChild(el("span", "agent", "◈ agent"));
    if (pr.stale) meta.appendChild(el("span", "stale", "stale"));

    row.appendChild(title);
    row.appendChild(actions);
    row.appendChild(meta);
    list.appendChild(row);
  }
}

export function initTray() {
  const close = document.getElementById("trayClose");
  if (close) close.addEventListener("click", closeTray);
}
