/**
 * controls.js — the header dial, the bottom controls, the source menu and the
 * theme picker.
 *
 * All transitions are view changes; the document is never touched except by
 * loading a snapshot (installDocument).
 */

import {
  ctx,
  installDocument,
  loadDemoDocument,
  requestRender,
  setView,
} from "../app.ts";import { buildModel, parseDoc } from "../core/model.ts";
import { clamp, dateFull } from "../core/samples.ts";
import {
  activeStopIndex,
  addModules,
  defaultView,
  focusCommitView,
  focusFirstMatch,
  focusRefView,
  jumpToStop,
  nudgeEnd,
  nowView,
  setSpan,
  showRack,
  stopsFor,
  toggleLens,
  validateView,
  viewAtWtPos,
} from "../core/view.ts";
import { splitModules } from "../core/split.ts";
import { shareFragment } from "../core/share.ts";
import { THEME_LIST, THEMES } from "../core/theme.ts";
import { drawDepth, liveWtPos, startDepthScan } from "../render/depth.js";
import { focusPr } from "./tray.js";
import { createKnob } from "./knobs.js";
import { announce, copyText } from "./status.ts";
import { clear, el } from "./dom.js";

let stageKnobRefs = null;

export function toggleTree() {
  ctx.treeOpen = !ctx.treeOpen;
  requestRender();
}

export function setUiMode(mode) {
  if (!ctx.view || !ctx.model) return;
  ctx.diffOpen = false;
  if (mode === "2d") {
    ctx.browserOpen = false;
    setView({ ...ctx.view, depth: false });
    return;
  }
  let next = ctx.view;
  if (next.span === "all") next = setSpan(ctx.model, next, "90d");
  if (mode === "browser") {
    ctx.browserOpen = true;
    if (!next.depth) setView({ ...next, depth: true, rack: true });
    else requestRender();
  } else if (mode === "stage") {
    ctx.browserOpen = false;
    if (next.depth && !next.rack) requestRender();
    else setView({ ...next, depth: true, rack: false });
    startDepthScan();
  } else {
    /* rack */
    ctx.browserOpen = false;
    if (next.depth && next.rack) requestRender();
    else setView({ ...next, depth: true, rack: true });
    startDepthScan();
  }
}

export function syncStageKnobsLive() {
  if (!stageKnobRefs || !ctx.palette || !ctx.view || !ctx.model) return;
  const pos = liveWtPos();
  const pct = Math.round(pos * 100);
  stageKnobRefs.pos.setValue(pos, pct >= 100 ? "NOW" : `${pct}%`);
  if (stageKnobRefs.scanBtn) {
    const playing = ctx.view.motion.playing;
    const pressed = playing ? "true" : "false";
    if (stageKnobRefs.scanBtn.getAttribute("aria-pressed") !== pressed) {
      stageKnobRefs.scanBtn.setAttribute("aria-pressed", pressed);
      stageKnobRefs.scanBtn.textContent = playing ? "⏸ LFO" : "▶ LFO";
    }
  }
}

function initStageKnobs() {
  const host = document.getElementById("stageKnobs");
  if (!host || !ctx.palette) return;
  clear(host);
  const P = ctx.palette;
  const sp = ctx.stageParams;

  const scanBtn = document.createElement("button");
  scanBtn.type = "button";
  scanBtn.className = "op op-xs op-play stage-scan-btn";
  scanBtn.textContent = "▶ LFO";
  scanBtn.setAttribute("aria-pressed", "false");
  scanBtn.title = "Play/pause LFO time-travel scan across Git history (Space)";
  scanBtn.addEventListener("click", () => togglePlay());

  const pos = createKnob({
    label: "WT POS",
    value: liveWtPos(),
    defaultValue: 1,
    size: 40,
    accent: P.open,
    title: "Time-travel read head through Git history (0% oldest → 100% now · double-click for NOW)",
    format: (v) => (Math.round(v * 100) >= 100 ? "NOW" : `${Math.round(v * 100)}%`),
    onChange(v) {
      if (!ctx.model || !ctx.view) return;
      if (ctx.view.span === "all") {
        const next = setSpan(ctx.model, ctx.view, "90d");
        setView(viewAtWtPos(ctx.model, next, v, ctx.search.shas, true));
      } else {
        setView(viewAtWtPos(ctx.model, ctx.view, v, ctx.search.shas, true));
      }
    },
    onReset() {
      if (!ctx.model || !ctx.view) return;
      setView({
        ...nowView(ctx.model, ctx.view),
        motion: { ...ctx.view.motion, playing: false },
      });
    },
  });

  const depth = createKnob({
    label: "DEPTH",
    value: sp.depth,
    defaultValue: 0.68,
    size: 40,
    accent: ctx.metric?.color ?? P.ok,
    title: "3D depth spread (double-click to reset)",
    onChange(v) {
      sp.depth = v;
      drawDepth();
    },
  });

  const smooth = createKnob({
    label: "SMOOTH",
    value: sp.smooth,
    defaultValue: 0.52,
    size: 40,
    accent: ctx.metric?.color ?? P.ok,
    title: "Harmonic wavetable smoothness (double-click to reset)",
    onChange(v) {
      sp.smooth = v;
      drawDepth();
    },
  });

  host.appendChild(scanBtn);
  host.appendChild(pos.el);
  host.appendChild(depth.el);
  host.appendChild(smooth.el);
  stageKnobRefs = { scanBtn, pos, depth, smooth };
}

function renderPrQueue() {
  const host = document.getElementById("prQueue");
  if (!host || !ctx.prs) return;
  clear(host);
  if (!ctx.prs.length) {
    host.appendChild(el("span", "pr-queue-empty", "queue clear"));
    return;
  }
  ctx.prs.forEach((pr, idx) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = pr.stale ? "pr-pill is-stale" : "pr-pill";
    if (ctx.view?.focusRef === pr.ref.id) btn.classList.add("is-active");
    btn.title = `${pr.pr.title} (${Math.round(pr.ageDays)}d · ${pr.pr.review})`;
    btn.appendChild(el("span", "pr-pill-idx", String(idx + 1).padStart(2, "0")));
    btn.appendChild(el("span", "pr-pill-num", `#${pr.pr.number}`));
    btn.appendChild(el("span", "pr-pill-ref", pr.ref.name));
    btn.appendChild(el("span", "pr-pill-age", `${Math.round(pr.ageDays)}d`));
    btn.addEventListener("click", () => focusPr(pr));
    host.appendChild(btn);
  });
}

export function togglePlay() {
  if (!ctx.view) return;
  setView({
    ...ctx.view,
    motion: { ...ctx.view.motion, playing: !ctx.view.motion.playing },
  });
}

export function toggleDepth() {
  if (!ctx.view || !ctx.model) return;
  const depth = !ctx.view.depth;
  let next = { ...ctx.view, depth };
  if (depth) {
    next = { ...next, rack: true };
    if (next.span === "all") next = setSpan(ctx.model, next, "90d");
  }
  setView(next);
  if (depth) startDepthScan();
}

function splitOpen(by) {
  if (!ctx.model || !ctx.view) return;
  const before = ctx.view.modules.length;
  const seeds = splitModules(ctx.model, ctx.view.query, by, 4);
  if (!seeds.length) {
    announce("nothing to split");
    return;
  }
  const next = addModules(ctx.view, seeds);
  if (next.modules.length === before) {
    announce("the rack is full (8 modules)");
    return;
  }
  setView(showRack(next));
  announce(`added ${next.modules.length - before} ${by} module${next.modules.length - before === 1 ? "" : "s"}`);
}

function stepSearch(direction) {
  if (!ctx.search.count || !ctx.model || !ctx.view) return;
  const count = ctx.search.count;
  const base = ctx.matchIndex < 0 ? (direction > 0 ? -1 : 0) : ctx.matchIndex;
  const next = ((base + direction) % count + count) % count;
  ctx.matchIndex = next;
  setView(focusCommitView(ctx.model, ctx.view, ctx.search.matches[next]));
}

function $(id) {
  return document.getElementById(id);
}

export function closeThemeMenu() {
  const menu = $("themeMenu");
  const button = $("themeBtn");
  if (menu) menu.hidden = true;
  if (button) button.setAttribute("aria-expanded", "false");
}

function toggleThemeMenu() {
  const menu = $("themeMenu");
  const button = $("themeBtn");
  if (!menu || !button) return;
  const next = menu.hidden;
  menu.hidden = !next;
  button.setAttribute("aria-expanded", next ? "true" : "false");
  if (next) {
    const first = menu.querySelector(".theme-option");
    if (first instanceof HTMLElement) first.focus({ preventScroll: true });
  }
}

function buildThemeMenu() {
  const menu = $("themeMenu");
  if (!menu) return;
  clear(menu);
  for (const theme of THEME_LIST) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "theme-option";
    button.dataset.theme = theme.id;
    button.setAttribute("role", "menuitemradio");
    button.title = theme.note;
    const label = el("span", "", theme.label);
    const dots = el("span", "theme-dots");
    for (const color of [
      theme.tokens.ok,
      theme.tokens.open,
      theme.tokens.agent,
      ...theme.identity.slice(1, 3),
    ]) {
      const dot = document.createElement("i");
      dot.style.setProperty("--dot", color);
      dots.appendChild(dot);
    }
    button.appendChild(label);
    button.appendChild(dots);
    button.addEventListener("click", () => {
      if (!ctx.view) return;
      setView({ ...ctx.view, theme: theme.id });
      closeThemeMenu();
    });
    menu.appendChild(button);
  }
}

function saveDocument() {
  if (!ctx.doc) return;
  const text = JSON.stringify(ctx.doc, null, 2) + "\n";
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${ctx.doc.repo.id}.gitwave.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  announce(`saved ${link.download}`);
}

function copyLink() {
  if (!ctx.view) return;
  const base = location.href.split("#")[0];
  copyText(`${base}#${shareFragment(ctx.view)}`, "view link copied");
}

function reloadDemo() {
  try {
    const doc = loadDemoDocument();
    const model = buildModel(doc);
    installDocument(doc, defaultView(model));
    requestRender();
    announce("demo history reloaded");
  } catch {
    announce("could not reload the demo");
  }
}

async function openFile(file) {
  if (!file) return;
  try {
    const text = await file.text();
    const parsed = parseDoc(JSON.parse(text));
    if (!parsed.ok) {
      announce(`not a valid .gitwave — ${parsed.errors[0]}`);
      return;
    }
    const model = buildModel(parsed.doc);
    const view = validateView(defaultView(model), model).view;
    installDocument(parsed.doc, view);
    ctx.seenSnapshotMs = Number.NaN;
    requestRender();
    announce(`loaded ${parsed.doc.repo.name} — ${parsed.doc.commits.length} commits`);
  } catch {
    announce("could not read that file");
  }
}

export function initControls() {
  if (!ctx.model || !ctx.view) return;
  const version = $("version");
  if (version instanceof HTMLInputElement) {
    version.addEventListener("input", () => {
      if (!ctx.model || !ctx.view) return;
      setView(jumpToStop(ctx.model, ctx.view, Number(version.value)));
    });
    version.addEventListener(
      "wheel",
      (event) => {
        if (!ctx.model || !ctx.view) return;
        event.preventDefault();
        const stops = stopsFor(ctx.model).length;
        const next = clamp(Number(version.value) + (event.deltaY > 0 ? 1 : -1), 0, stops - 1);
        version.value = String(next);
        setView(jumpToStop(ctx.model, ctx.view, next));
      },
      { passive: false }
    );
  }

  const span = $("spanSelect");
  if (span instanceof HTMLSelectElement) {
    span.addEventListener("change", () => {
      if (!ctx.model || !ctx.view) return;
      setView(setSpan(ctx.model, ctx.view, span.value));
    });
  }

  $("prevBtn")?.addEventListener("click", () => {
    if (ctx.model && ctx.view) setView(nudgeEnd(ctx.model, ctx.view, -1));
  });
  $("nextBtn")?.addEventListener("click", () => {
    if (ctx.model && ctx.view) setView(nudgeEnd(ctx.model, ctx.view, 1));
  });
  $("nowBtn")?.addEventListener("click", () => {
    if (ctx.model && ctx.view) setView(nowView(ctx.model, ctx.view));
  });

  const refSelect = $("refSelect");
  if (refSelect instanceof HTMLSelectElement) {
    refSelect.addEventListener("change", () => {
      if (!ctx.model || !ctx.view) return;
      const ref = ctx.model.refsById.get(refSelect.value);
      if (!ref) return;
      setView(focusRefView(ctx.model, ctx.view, ref));
    });
  }

  for (const [id, key] of [
    ["lensAge", "age"],
    ["lensAgents", "agents"],
    ["lensPrs", "prs"],
  ]) {
    $(id)?.addEventListener("click", () => {
      if (ctx.view) setView(toggleLens(ctx.view, key));
    });
  }

  $("modeRack")?.addEventListener("click", () => setUiMode("rack"));
  $("modeStage")?.addEventListener("click", () => setUiMode("stage"));
  $("modeBrowser")?.addEventListener("click", () => setUiMode("browser"));
  $("mode2d")?.addEventListener("click", () => setUiMode("2d"));
  $("treeToggle")?.addEventListener("click", toggleTree);
  $("treeBrowserBtn")?.addEventListener("click", () => setUiMode("browser"));
  $("backBtn")?.addEventListener("click", () => {
    ctx.browserOpen = false;
    if (ctx.view) setView(showRack(ctx.view));
  });
  $("splitAuthor")?.addEventListener("click", () => splitOpen("author"));
  $("splitRef")?.addEventListener("click", () => splitOpen("ref"));
  initStageKnobs();

  const find = $("findInput");
  if (find instanceof HTMLInputElement) {
    let timer = 0;
    find.addEventListener("input", () => {
      if (!ctx.view) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!ctx.view || !ctx.model) return;
        const query = find.value.trim();
        if (!query) {
          ctx.matchIndex = -1;
          setView({ ...ctx.view, query: "" });
        } else {
          const focused = focusFirstMatch(ctx.model, { ...ctx.view, query }, query);
          setView(focused.view);
          ctx.matchIndex = focused.index;
          requestRender();
        }
        startDepthScan();
      }, 140);
    });
    find.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        stepSearch(event.shiftKey ? -1 : 1);
      } else if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (find.value) {
          find.value = "";
          if (ctx.view) {
            ctx.matchIndex = -1;
            setView({ ...ctx.view, query: "" });
          }
          startDepthScan();
        } else {
          find.blur();
        }
      }
    });
  }

  $("lfoBtn")?.addEventListener("click", togglePlay);
  const mode = $("modeSelect");
  if (mode instanceof HTMLSelectElement) {
    mode.addEventListener("change", () => {
      if (!ctx.view) return;
      setView({
        ...ctx.view,
        motion: { ...ctx.view.motion, mode: mode.value },
      });
    });
  }
  const rate = $("rateSelect");
  if (rate instanceof HTMLSelectElement) {
    rate.addEventListener("change", () => {
      if (!ctx.view) return;
      setView({
        ...ctx.view,
        motion: { ...ctx.view.motion, rate: Number(rate.value) },
      });
    });
  }

  $("themeBtn")?.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleThemeMenu();
  });
  buildThemeMenu();

  $("demoBtn")?.addEventListener("click", reloadDemo);
  $("saveBtn")?.addEventListener("click", saveDocument);
  $("linkBtn")?.addEventListener("click", copyLink);

  const input = $("openFile");
  $("openBtn")?.addEventListener("click", () => {
    if (input instanceof HTMLInputElement) input.click();
  });
  if (input instanceof HTMLInputElement) {
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      void openFile(file);
      input.value = "";
    });
  }

  document.addEventListener("click", (event) => {
    const menu = $("themeMenu");
    const button = $("themeBtn");
    if (!menu || menu.hidden) return;
    if (
      event.target instanceof Node &&
      (menu.contains(event.target) || (button instanceof Node && button.contains(event.target)))
    ) {
      return;
    }
    closeThemeMenu();
  });
}

export function syncControls(transportOnly = false) {
  if (!ctx.model || !ctx.view) return;
  const stops = stopsFor(ctx.model);
  const index = activeStopIndex(ctx.model, ctx.view);
  const version = $("version");
  const versionOut = $("versionOut");
  if (version instanceof HTMLInputElement) {
    const maxStr = String(Math.max(0, stops.length - 1));
    const idxStr = String(index);
    if (version.max !== maxStr) version.max = maxStr;
    if (version.value !== idxStr) version.value = idxStr;
  }
  if (versionOut) {
    const stop = stops[index];
    const label = stop ? `${stop.label} · ${dateFull(stop.timeMs)}` : "—";
    if (versionOut.textContent !== label) versionOut.textContent = label;
  }

  $("lfoBtn")?.setAttribute("aria-pressed", ctx.view.motion.playing ? "true" : "false");
  if (transportOnly) {
    if (stageKnobRefs && ctx.palette) syncStageKnobsLive();
    return;
  }

  const span = $("spanSelect");
  if (span instanceof HTMLSelectElement) span.value = ctx.view.span;

  const refSelect = $("refSelect");
  if (refSelect instanceof HTMLSelectElement) {
    const wanted = ctx.view.focusRef;
    const current = Array.from(refSelect.options).map((option) => option.value);
    const next = ctx.model.doc.refs.map((ref) => ref.id);
    if (current.join("|") !== next.join("|")) {
      refSelect.replaceChildren();
      for (const ref of ctx.model.doc.refs) {
        const option = document.createElement("option");
        option.value = ref.id;
        option.textContent = ref.kind === "trunk" ? `${ref.name} (trunk)` : ref.name;
        refSelect.appendChild(option);
      }
    }
    refSelect.value = wanted;
  }

  for (const [id, value] of [
    ["lensAge", ctx.view.lens.age],
    ["lensAgents", ctx.view.lens.agents],
    ["lensPrs", ctx.view.lens.prs],
  ]) {
    $(id)?.setAttribute("aria-pressed", value ? "true" : "false");
  }

  const mode = $("modeSelect");
  if (mode instanceof HTMLSelectElement) mode.value = ctx.view.motion.mode;
  const rate = $("rateSelect");
  if (rate instanceof HTMLSelectElement) rate.value = String(ctx.view.motion.rate);

  const activeMode = !ctx.view.depth
    ? "2d"
    : ctx.browserOpen
      ? "browser"
      : ctx.view.rack
        ? "rack"
        : "stage";
  $("modeRack")?.setAttribute("aria-pressed", activeMode === "rack" ? "true" : "false");
  $("modeStage")?.setAttribute("aria-pressed", activeMode === "stage" ? "true" : "false");
  $("modeBrowser")?.setAttribute("aria-pressed", activeMode === "browser" ? "true" : "false");
  $("mode2d")?.setAttribute("aria-pressed", activeMode === "2d" ? "true" : "false");
  $("treeToggle")?.setAttribute("aria-pressed", ctx.treeOpen ? "true" : "false");

  const themeDef = THEMES[ctx.view.theme];
  const themeLabel = $("themeLabel");
  if (themeLabel && themeDef) themeLabel.textContent = themeDef.label;
  const themeDot = $("themeDot");
  if (themeDot && themeDef) themeDot.style.setProperty("--dot", themeDef.tokens.ok);

  if (stageKnobRefs && ctx.palette) {
    const accent = ctx.metric?.color ?? ctx.palette.ok;
    stageKnobRefs.pos.setAccent(ctx.palette.open);
    stageKnobRefs.depth.setAccent(accent);
    stageKnobRefs.smooth.setAccent(accent);
    syncStageKnobsLive();
  }
  renderPrQueue();

  const find = $("findInput");
  if (find instanceof HTMLInputElement && find.value !== ctx.view.query) {
    find.value = ctx.view.query;
  }
  const findCount = $("findCount");
  if (findCount) {
    if (!ctx.view.query) findCount.textContent = "";
    else if (!ctx.search.count) findCount.textContent = "no matches";
    else if (ctx.matchIndex < 0) {
      findCount.textContent = `${ctx.search.count} match${ctx.search.count === 1 ? "" : "es"}`;
    } else {
      findCount.textContent = `${ctx.matchIndex + 1}/${ctx.search.count}`;
    }
  }

  const menu = $("themeMenu");
  if (menu) {
    for (const option of menu.querySelectorAll(".theme-option")) {
      if (option instanceof HTMLElement) {
        option.setAttribute(
          "aria-checked",
          option.dataset.theme === ctx.view.theme ? "true" : "false"
        );
      }
    }
  }
}
