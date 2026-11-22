/**
 * keyboard.js — global travel keys. Local widgets keep their native keys.
 */

import { ctx, setView } from "../app.ts";
import { isoOf, windowFor } from "../core/samples.ts";
import { cycleTheme, nudgeEnd, nowView, showRef } from "../core/view.ts";
import { closeHelp, toggleHelp } from "./help.js";
import { closeTray, toggleTray } from "./tray.js";
import { closeThemeMenu, toggleDepth, togglePlay, toggleTree } from "./controls.js";

function isTyping(target) {
  return (
    target instanceof Element &&
    !!target.closest("input, select, textarea, [contenteditable='true']")
  );
}

function isWidget(target) {
  return (
    target instanceof Element &&
    !!target.closest("button, [role='button'], a, [role='menuitemradio']")
  );
}

function oldestEnd() {
  if (!ctx.model || !ctx.view || !ctx.window) return 0;
  const spanMs = ctx.window.endMs - ctx.window.startMs;
  return Math.min(ctx.model.snapshotMs, ctx.model.startMs + spanMs);
}

export function initKeyboard() {
  window.addEventListener("keydown", (event) => {
    if (!ctx.model || !ctx.view) return;
    if (event.key === "Escape") {
      closeHelp();
      closeTray();
      closeThemeMenu();
      return;
    }
    if (event.ctrlKey || event.metaKey) return;
    if (isTyping(event.target)) return;

    if (event.key === "?") {
      event.preventDefault();
      toggleHelp();
      return;
    }

    if (event.altKey && /^[1-8]$/.test(event.key)) {
      const ref = ctx.model.doc.refs[Number(event.key) - 1];
      if (!ref) return;
      event.preventDefault();
      const next = showRef(ctx.view, ref.id);
      setView({ ...next, focusRef: ref.id, focusSha: ref.tip });
      return;
    }
    if (event.altKey) return;

    if (event.key === "/") {
      event.preventDefault();
      document.getElementById("findInput")?.focus();
      return;
    }
    if (event.key === "d" || event.key === "D") {
      toggleDepth();
      return;
    }
    if (event.key === "b" || event.key === "B") {
      toggleTree();
      return;
    }
    if (event.key === "t" || event.key === "T") {
      setView(cycleTheme(ctx.view));
      return;
    }
    if (event.key === "p" || event.key === "P") {
      toggleTray();
      return;
    }
    if (event.code === "Space") {
      if (isWidget(event.target)) return;
      event.preventDefault();
      togglePlay();
      return;
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      setView(nudgeEnd(ctx.model, ctx.view, -1));
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      setView(nudgeEnd(ctx.model, ctx.view, 1));
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      setView({ ...ctx.view, end: isoOf(oldestEnd()) });
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      setView(nowView(ctx.model, ctx.view));
    }
  });
}
