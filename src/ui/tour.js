/**
 * tour.js — Choreographed Welcome Tour ("A Gift from Trevor & Antigravity").
 *
 * Plays an interactive, pauseable, screen-record-friendly walkthrough where
 * the Floating Agent Oscillator shifts its signature color, waveform formula,
 * and cyclic task modulation as it guides humans and future visiting agents
 * across every register of GitWave.
 */

import { ctx, requestRender, setAgent, setView } from "../app.ts";
import { TOUR_CHAPTERS, chapterAt, clampChapterIndex } from "../core/tour.ts";
import { focusFirstMatch } from "../core/view.ts";
import { setUiMode } from "./controls.js";
import { closeDiffView, openDiffView } from "./diff.js";
import { clear, el } from "./dom.js";
import { announce } from "./status.ts";

let timerId = 0;
let restoreSnapshot = null;

function clearTimer() {
  if (timerId) {
    clearTimeout(timerId);
    timerId = 0;
  }
}

function scheduleNext() {
  clearTimer();
  if (!ctx.tour.active || !ctx.tour.playing) return;
  const ch = chapterAt(ctx.tour.index);
  timerId = setTimeout(() => {
    if (!ctx.tour.active || !ctx.tour.playing) return;
    if (ctx.tour.index >= TOUR_CHAPTERS.length - 1) {
      ctx.tour = { ...ctx.tour, playing: false };
      requestRender();
      return;
    }
    goToTourStep(ctx.tour.index + 1, { keepPlaying: true });
  }, ch.durationMs);
}

function applyChapter(ch) {
  if (!ctx.model || !ctx.view) return;

  /* 1. Apply UI mode & optional filter */
  if (ch.ui.openDiff || ch.ui.mode === "diff") {
    openDiffView(ctx.focusCommit ?? null);
  } else {
    closeDiffView();
    setUiMode(ch.ui.mode);
    if (typeof ch.ui.query === "string" && ctx.view) {
      const q = ch.ui.query.trim();
      if (!q) {
        ctx.matchIndex = -1;
        setView({ ...ctx.view, query: "" });
      } else {
        const focused = focusFirstMatch(ctx.model, { ...ctx.view, query: q }, q);
        ctx.matchIndex = focused.index;
        setView(focused.view);
      }
    }
  }

  /* 2. Morph the Floating Agent Oscillator to this chapter's creative signature */
  setAgent({
    visible: true,
    minimized: false,
    name: ch.agent.name,
    color: ch.agent.color,
    formula: ch.agent.formula,
    activity: ch.agent.activity,
    task: ch.agent.task,
    ...(ch.agent.params ? { params: ch.agent.params } : {}),
  });
}

export function startTour(opts = {}) {
  if (!ctx.model || !ctx.view) return;
  if (!ctx.tour.active) {
    restoreSnapshot = {
      depth: ctx.view.depth,
      rack: ctx.view.rack,
      browserOpen: ctx.browserOpen,
      diffOpen: ctx.diffOpen,
      query: ctx.view.query,
    };
  }
  const startIndex = clampChapterIndex(typeof opts.index === "number" ? opts.index : 0);
  const autoplay = opts.autoplay !== false && !ctx.reducedMotion;
  ctx.tour = {
    active: true,
    playing: autoplay,
    index: startIndex,
    total: TOUR_CHAPTERS.length,
  };
  applyChapter(chapterAt(startIndex));
  scheduleNext();
  announce(`welcome tour started — chapter ${startIndex + 1} of ${TOUR_CHAPTERS.length}`);
}

export function stopTour(opts = {}) {
  if (!ctx.tour.active) return;
  clearTimer();
  ctx.tour = {
    active: false,
    playing: false,
    index: 0,
    total: TOUR_CHAPTERS.length,
  };
  if (opts.restore !== false && restoreSnapshot && ctx.view) {
    closeDiffView();
    ctx.browserOpen = restoreSnapshot.browserOpen;
    setView({
      ...ctx.view,
      depth: restoreSnapshot.depth,
      rack: restoreSnapshot.rack,
      query: restoreSnapshot.query,
    });
  }
  restoreSnapshot = null;
  setAgent({
    activity: "idle",
    task: "Tour finished — ready to explore with you",
  });
  requestRender();
}

export function goToTourStep(index, opts = {}) {
  if (!ctx.tour.active) {
    startTour({ index, autoplay: opts.keepPlaying ?? false });
    return;
  }
  const nextIdx = clampChapterIndex(index);
  const playing = typeof opts.keepPlaying === "boolean" ? opts.keepPlaying : ctx.tour.playing;
  ctx.tour = {
    ...ctx.tour,
    index: nextIdx,
    playing,
  };
  applyChapter(chapterAt(nextIdx));
  scheduleNext();
}

export function nextTourStep() {
  if (!ctx.tour.active) return;
  if (ctx.tour.index >= TOUR_CHAPTERS.length - 1) {
    stopTour({ restore: false });
    return;
  }
  goToTourStep(ctx.tour.index + 1);
}

export function prevTourStep() {
  if (!ctx.tour.active) return;
  goToTourStep(Math.max(0, ctx.tour.index - 1));
}

export function toggleTourPlay() {
  if (!ctx.tour.active) {
    startTour({ autoplay: true });
    return;
  }
  const nextPlaying = !ctx.tour.playing;
  ctx.tour = { ...ctx.tour, playing: nextPlaying };
  if (nextPlaying) {
    if (ctx.tour.index >= TOUR_CHAPTERS.length - 1) {
      goToTourStep(0, { keepPlaying: true });
      return;
    }
    scheduleNext();
  } else {
    clearTimer();
  }
  requestRender();
}

export function renderTourCard() {
  const host = document.getElementById("tourCard");
  if (!host) return;
  host.hidden = !ctx.tour.active;
  if (!ctx.tour.active) return;

  const ch = chapterAt(ctx.tour.index);
  host.style.setProperty("--tour-sw", ch.agent.color);
  clear(host);

  const head = el("header", "tour-head");
  head.appendChild(el("span", "tour-eyebrow", ch.eyebrow));
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "ap-ico-btn";
  closeBtn.textContent = "×";
  closeBtn.title = "Exit Welcome Tour (Esc)";
  closeBtn.addEventListener("click", () => stopTour());
  head.appendChild(closeBtn);
  host.appendChild(head);

  host.appendChild(el("h3", "tour-title", ch.title));
  host.appendChild(el("p", "tour-body", ch.body));
  host.appendChild(el("div", "tour-tip", ch.tip));

  /* Chapter progress dots */
  const dots = el("div", "tour-dots");
  TOUR_CHAPTERS.forEach((step, idx) => {
    const dot = document.createElement("button");
    dot.type = "button";
    dot.className = idx === ctx.tour.index ? "tour-dot is-active" : idx < ctx.tour.index ? "tour-dot is-done" : "tour-dot";
    dot.title = `${idx + 1}. ${step.title}`;
    dot.setAttribute("aria-label", `Go to chapter ${idx + 1}: ${step.title}`);
    dot.addEventListener("click", () => goToTourStep(idx));
    dots.appendChild(dot);
  });
  host.appendChild(dots);

  /* Transport controls */
  const nav = el("div", "tour-nav");
  const prevBtn = document.createElement("button");
  prevBtn.type = "button";
  prevBtn.className = "op op-xs";
  prevBtn.textContent = "‹ prev";
  prevBtn.disabled = ctx.tour.index <= 0;
  prevBtn.addEventListener("click", prevTourStep);

  const playBtn = document.createElement("button");
  playBtn.type = "button";
  playBtn.className = "op op-xs";
  playBtn.textContent = ctx.tour.playing ? "⏸ pause" : "▶ auto";
  playBtn.title = "Pause or resume automated tour playback";
  playBtn.addEventListener("click", toggleTourPlay);

  const nextBtn = document.createElement("button");
  nextBtn.type = "button";
  nextBtn.className = "op op-xs";
  nextBtn.textContent = ctx.tour.index >= TOUR_CHAPTERS.length - 1 ? "finish ✓" : "next ›";
  nextBtn.addEventListener("click", nextTourStep);

  nav.appendChild(prevBtn);
  nav.appendChild(playBtn);
  nav.appendChild(nextBtn);
  host.appendChild(nav);
}
