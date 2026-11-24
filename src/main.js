/**
 * main.js — boot, render loop, transport and the hidden state mirrors.
 *
 * The document is loaded once (demo fixture), the view comes from a link, an
 * autosave or the defaults, and every gesture after that is a view change.
 */

import {
  ctx,
  getState,
  installDocument,
  loadDemoDocument,
  recompute,
  registerRender,
  setView,
} from "./app.ts";
import { buildModel } from "./core/model.ts";
import { decodeView, readFragment, shareFragment } from "./core/share.ts";
import { defaultView, focusFirstMatch, transportStep, validateView } from "./core/view.ts";
import {
  loadAutosave,
  loadSeenSnapshot,
  saveAutosave,
  saveSeenSnapshot,
} from "./state/autosave.ts";
import { drawWave } from "./render/canvas.js";
import { drawDepth, initDepthOrbit, initScope2d } from "./render/depth.js";
import { drawRackFrames, initRackBar, renderRack } from "./render/rack.js";
import { initCanvasPointer, initStrip, renderStrip } from "./render/strip.js";
import { drawTension, initTension } from "./render/tension.js";
import { initReadout, renderReadout } from "./render/readout.js";
import { renderLegend } from "./ui/legend.js";
import { initTray, openTray, focusPr, renderTray } from "./ui/tray.js";
import { initHelp, openHelp } from "./ui/help.js";
import { initControls, syncControls, syncStageKnobsLive } from "./ui/controls.js";
import { drawBrowserFrames, renderBrowserGrid, renderTree } from "./ui/browser.js";
import { initKeyboard } from "./ui/keyboard.js";
import { announce } from "./ui/status.ts";

const params = new URLSearchParams(location.search);
const fresh = params.has("fresh");
const staticMode = params.has("static");
const phaseParam = Math.max(0, Math.min(100, Number(params.get("phase")) || 0));
const selftest = params.has("selftest");

let lfoRunning = false;
let lfoLast = 0;
let lfoAcc = 0;
let lfoDir = 1;
let saveTimer = 0;
let hashTimer = 0;
let resizeTimer = 0;

window.addEventListener("error", () => {
  ctx.errors += 1;
});
window.addEventListener("unhandledrejection", () => {
  ctx.errors += 1;
});

function boot() {
  const doc = loadDemoDocument();
  const model = buildModel(doc);
  let view = defaultView(model);
  let usedLink = false;

  const hash = readFragment(location.hash);
  if (hash) {
    const decoded = decodeView(hash, model);
    if (decoded) {
      view = decoded;
      usedLink = true;
    } else {
      announce("that link could not be read — showing the default view");
    }
  }
  if (!usedLink && !fresh) {
    const saved = loadAutosave(model);
    if (saved) view = saved;
  }

  const override = {};
  if (params.get("theme")) override.theme = params.get("theme");
  if (params.get("span")) override.span = params.get("span");
  if (params.get("end")) override.end = params.get("end");
  if (params.has("tray")) override.tray = params.get("tray") !== "0";
  if (params.has("agents")) override.lens = { ...view.lens, agents: true };
  if (params.has("depth")) override.depth = params.get("depth") !== "0";
  if (params.has("rack")) override.rack = params.get("rack") !== "0";
  if (params.get("query")) override.query = params.get("query");
  if (params.has("browser")) {
    ctx.browserOpen = params.get("browser") !== "0";
    if (ctx.browserOpen) override.depth = true;
  }
  if (params.has("tree")) {
    ctx.treeOpen = params.get("tree") !== "0";
  }
  if (params.has("focus")) {
    const ref = model.refsById.get(params.get("focus"));
    if (ref) {
      override.focusRef = ref.id;
      override.focusSha = ref.tip;
    }
  }
  const spawns = params.getAll("spawn");
  if (spawns.length) {
    const names = params.getAll("name");
    const modules = spawns.slice(0, 8).map((query, index) => ({
      name: (names[index] || query || "All commits").slice(0, 40),
      query: query.slice(0, 120),
      colorKey: index % 6,
    }));
    override.depth = true;
    override.rack = true;
    override.query = modules[0].query;
    override.modules = modules;
    ctx.browserOpen = false;
  }
  if (Object.keys(override).length) {
    view = validateView({ ...view, ...override }, model).view;
  }

  let bootMatch = -1;
  if (view.query) {
    const focused = focusFirstMatch(model, view, view.query);
    view = focused.view;
    bootMatch = focused.index;
  }
  if (staticMode) ctx.morph = 4.2 + phaseParam;
  installDocument(doc, view);
  ctx.reducedMotion =
    typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (fresh) {
    ctx.seenSnapshotMs = Number.NaN;
  } else {
    ctx.seenSnapshotMs = loadSeenSnapshot(model);
  }
  recompute();
  ctx.matchIndex = bootMatch;
  if (!fresh) saveSeenSnapshot(model);
}

function ensureLfo() {
  if (ctx.view?.motion.playing && !lfoRunning) {
    lfoRunning = true;
    lfoLast = performance.now();
    lfoAcc = 0;
    requestAnimationFrame(lfoFrame);
  }
}

function advanceTransport() {
  if (!ctx.view || !ctx.model) return;
  const step = transportStep(ctx.model, ctx.view, lfoDir);
  lfoDir = step.direction;
  ctx.lfoDir = lfoDir;
  setView(step.view);
}

function lfoFrame(now) {
  if (!ctx.view?.motion.playing) {
    lfoRunning = false;
    ctx.depthPhase = 0;
    return;
  }
  const rate = ctx.reducedMotion ? 1 : ctx.view.motion.rate;
  const interval = 1000 / rate;
  lfoAcc += Math.min(120, Math.max(0, now - lfoLast));
  lfoLast = now;
  let guard = 0;
  while (lfoAcc >= interval && guard++ < 6) {
    lfoAcc -= interval;
    advanceTransport();
    if (!ctx.view?.motion.playing) break;
  }
  if (ctx.view?.depth) {
    ctx.depthPhase = ctx.view.motion.playing ? Math.max(0, Math.min(1, lfoAcc / interval)) : 0;
  }
  requestAnimationFrame(lfoFrame);
}

let ambientRunning = false;
let ambientStart = 0;
let ambientLast = 0;

function ensureAmbient() {
  if (!ctx.view?.depth || staticMode || ctx.reducedMotion) {
    ambientRunning = false;
    return;
  }
  if (ambientRunning) return;
  ambientRunning = true;
  ambientStart = performance.now();
  ambientLast = 0;
  requestAnimationFrame(ambientFrame);
}

function ambientFrame(now) {
  if (!ctx.view?.depth) {
    ambientRunning = false;
    return;
  }
  ctx.morph = (now - ambientStart) / 1000 + phaseParam;
  if (ctx.depthScan >= 0 && now - ctx.depthScan >= 750) ctx.depthScan = -1;
  if (ctx.browserOpen) {
    if (now - ambientLast >= 33) {
      drawBrowserFrames();
      ambientLast = now;
    }
  } else if (ctx.view.rack) {
    if (now - ambientLast >= 25) {
      drawRackFrames();
      ambientLast = now;
    }
  } else {
    drawDepth();
    syncStageKnobsLive();
  }
  requestAnimationFrame(ambientFrame);
}

function schedulePersist() {
  if (fresh || !ctx.view) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (ctx.view) saveAutosave(ctx.view);
  }, 350);
}

function scheduleHash() {
  if (fresh || !ctx.view) return;
  clearTimeout(hashTimer);
  hashTimer = setTimeout(() => {
    if (!ctx.view) return;
    try {
      history.replaceState(null, "", `#${shareFragment(ctx.view)}`);
    } catch {
      /* file:// in a locked-down browser — links still work when copied */
    }
  }, 200);
}

function updateMirrors() {
  const state = getState();
  const node = document.getElementById("gitwave-state");
  if (node && state) node.textContent = JSON.stringify(state);
}

function renderAll() {
  const mode = !ctx.view?.depth
    ? "wave"
    : ctx.browserOpen
      ? "browser"
      : ctx.view.rack
        ? "rack"
        : "depth";

  const workspace = document.getElementById("workspace");
  const tree = document.getElementById("gitTree");
  if (tree) tree.hidden = !ctx.treeOpen;
  if (workspace) workspace.dataset.tree = ctx.treeOpen ? "open" : "closed";

  const stage = document.getElementById("stage");
  if (stage) stage.dataset.mode = mode;

  const viewport = document.getElementById("stageViewport");
  const scope2dWrap = document.getElementById("scope2dWrap");
  const stageKnobs = document.getElementById("stageKnobs");
  const rackBar = document.getElementById("rackBar");
  const rack = document.getElementById("rack");
  const browser = document.getElementById("browser");

  if (viewport) viewport.hidden = mode === "rack" || mode === "browser";
  if (scope2dWrap) scope2dWrap.hidden = mode !== "depth";
  if (stageKnobs) stageKnobs.hidden = mode !== "depth";
  if (rackBar) rackBar.hidden = mode !== "rack";
  if (rack) rack.hidden = mode !== "rack";
  if (browser) browser.hidden = mode !== "browser";

  if (ctx.treeOpen) renderTree();

  if (mode === "rack") renderRack();
  else if (mode === "browser") renderBrowserGrid();
  else if (mode === "depth") drawDepth();
  else drawWave();

  const expanded = mode === "depth";
  for (const id of ["backBtn", "splitAuthor", "splitRef"]) {
    const node = document.getElementById(id);
    if (node) node.hidden = !expanded;
  }
  const hint = document.getElementById("hint");
  if (hint) {
    hint.textContent =
      mode === "rack"
        ? "drag any wavetable or WT POS to time-travel in sync · click card to set diff baseline · space to scan"
        : mode === "browser"
          ? "click a wavetable to load · double-click to open 3D stage · heart to favorite"
          : mode === "depth"
            ? "drag 3D to orbit · turn WT POS or press Space to scan history · hover/click 2D scope peaks to inspect"
            : "wheel to travel · click a commit · space to play";
  }

  renderStrip();
  drawTension();
  renderReadout();
  renderLegend();
  renderTray();
  syncControls();
  updateMirrors();
  ensureLfo();
  ensureAmbient();
  schedulePersist();
  scheduleHash();
}

function runSelftest() {
  setTimeout(() => {
    const canvas = document.getElementById("wave");
    const stage = document.getElementById("stage");
    const cells = Array.from(document.querySelectorAll(".slot"));
    if (!canvas || !stage) return;
    const rawRect = canvas.getBoundingClientRect();
    const cRect = rawRect.width > 0 ? rawRect : stage.getBoundingClientRect();
    let maxDelta = 0;
    let worst = null;
    for (const cell of cells) {
      const rect = cell.getBoundingClientRect();
      const expected = Number(cell.dataset.x);
      const actual = rect.left + rect.width / 2 - cRect.left;
      const delta = Math.abs(expected - actual);
      if (delta > maxDelta) {
        maxDelta = delta;
        worst = { k: cell.dataset.k, expected, actual };
      }
    }
    const result = {
      ok: document.body.dataset.ready === "true" && maxDelta <= 0.5 && ctx.errors === 0,
      ready: document.body.dataset.ready === "true",
      errors: ctx.errors,
      slotCount: cells.length,
      maxDelta: Number(maxDelta.toFixed(3)),
      worst,
      canvasWidth: Number(cRect.width.toFixed(2)),
      layout: ["version", "versionOut", "wave", "slots"].reduce((acc, id) => {
        const node = document.getElementById(id);
        if (!node) return acc;
        const rect = node.getBoundingClientRect();
        acc[id] = [Math.round(rect.left), Math.round(rect.right), Math.round(rect.width)];
        return acc;
      }, {}),
      state: getState(),
    };
    const node = document.getElementById("gitwave-selftest");
    if (node) node.textContent = JSON.stringify(result);
  }, 40);
}

try {
  boot();
  initStrip();
  initCanvasPointer();
  initDepthOrbit();
  initScope2d();
  initRackBar();
  initTension({
    open: () => {
      ctx.prFilter = null;
      openTray();
    },
    focus: (pr) => {
      ctx.prFilter = null;
      focusPr(pr);
    },
  });
  initReadout();
  initTray();
  initHelp();
  initControls();
  initKeyboard();
  registerRender(renderAll);
  renderAll();
  document.body.dataset.ready = "true";
  if (params.has("help")) openHelp();
  if (params.has("menu")) document.getElementById("themeBtn")?.click();
  if (selftest) runSelftest();

  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => renderAll(), 90);
  });
  if (typeof ResizeObserver === "function") {
    const stage = document.getElementById("stage");
    if (stage) {
      const observer = new ResizeObserver(() => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => renderAll(), 90);
      });
      observer.observe(stage);
    }
  }
  window.addEventListener("hashchange", () => {
    const hash = readFragment(location.hash);
    if (!hash || !ctx.model) return;
    const decoded = decodeView(hash, ctx.model);
    if (decoded) setView(decoded);
  });
} catch (error) {
  const message = document.createElement("pre");
  message.style.padding = "24px";
  message.style.color = "#fb7185";
  message.style.font = "12px ui-monospace, monospace";
  message.textContent = `GitWave failed to start\n\n${String(error?.stack ?? error)}`;
  document.body.replaceChildren(message);
  ctx.errors += 1;
}
