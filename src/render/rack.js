/**
 * rack.js — Serum / Vital-inspired 3D wavetable oscillator rack with synced
 * time-travel scrubbing and live cross-oscillator comparison diffs.
 *
 * Each oscillator bay is one live Git filter rendered as a full-history 3D
 * volumetric wavetable. In SYNC mode (default), scrubbing WT POS on any
 * oscillator or the master rack bar scrubs every oscillator AND the repo read
 * head (`view.end`) together, displaying live commit/churn counts and signed
 * deltas at that exact timestamp.
 */

import { ctx, getOscParams, setView } from "../app.ts";
import {
  buildSlots,
  clamp,
  dateFull,
  dateShort,
  isoOf,
  windowFor,
} from "../core/samples.ts";
import { searchCommits } from "../core/search.ts";
import {
  endMsAtWtPos,
  expandModule,
  focusFirstMatch,
  nowView,
  pinModule,
  removeModule,
  setSpan,
  viewAtWtPos,
} from "../core/view.ts";
import { announce } from "../ui/status.ts";
import { clear, el } from "../ui/dom.js";
import { createKnob } from "../ui/knobs.js";
import { catalogItems } from "../ui/browser.js";
import { togglePlay } from "../ui/controls.js";
import {
  drawModuleSurface,
  formatChurn,
  liveReadHeadMs,
  liveWtPos,
  startDepthScan,
} from "./depth.js";

const LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H"];

let rackCards = [];
let lastSignature = "";

function label(index) {
  return `OSC ${LETTERS[index] ?? index + 1}`;
}

function rackSignature() {
  if (!ctx.view) return "";
  return (
    (ctx.doc?.repo.id ?? "") +
    "|" +
    ctx.view.theme +
    "|" +
    ctx.view.modules.map((m) => `${m.name}\t${m.query}\t${m.colorKey}`).join("\n")
  );
}

function scrubGlobalWtPos(pos) {
  if (!ctx.model || !ctx.view) return;
  const base =
    ctx.view.span === "all" ? setSpan(ctx.model, ctx.view, "90d") : ctx.view;
  setView(viewAtWtPos(ctx.model, base, pos, ctx.search.shas, true));
}

function resetGlobalWtPos() {
  if (!ctx.model || !ctx.view) return;
  setView({
    ...nowView(ctx.model, ctx.view),
    motion: { ...ctx.view.motion, playing: false },
  });
}

function cardWtPos(card) {
  const osc = getOscParams(card.module.query);
  if (ctx.rackSync) return liveWtPos();
  return osc.pos !== null ? osc.pos : liveWtPos();
}

function computeWindowMetrics(query, endMs) {
  if (!ctx.model || !ctx.view) return { commits: 0, churn: 0, agent: 0, endMs };
  const search = searchCommits(ctx.model, query);
  const win = windowFor(ctx.model, isoOf(endMs), ctx.view.span);
  const slots = buildSlots(ctx.model, win, search.shas);
  let commits = 0;
  let churn = 0;
  let agent = 0;
  for (const s of slots) {
    commits += s.count;
    churn += s.churn;
    agent += s.agentCount;
  }
  return { commits, churn, agent, endMs: win.endMs };
}

function signedDelta(n) {
  if (n > 0) return `+${n}`;
  if (n < 0) return `−${Math.abs(n)}`;
  return "0";
}

function signedChurn(n) {
  if (n > 0) return `+${formatChurn(n)}`;
  if (n < 0) return `−${formatChurn(Math.abs(n))}`;
  return "0";
}

/** Update live comparison bars, diff deltas, timestamps and master toolbar without rebuilding DOM. */
export function syncRackTelemetry() {
  if (!ctx.model || !ctx.view || !rackCards.length) return;
  const sharedPos = liveWtPos();
  const sharedMs = liveReadHeadMs();
  const sharedPct = Math.round(sharedPos * 100);

  /* Compute per-card real window metrics at each card's active timestamp */
  const stats = rackCards.map((card) => {
    const pos = cardWtPos(card);
    const ms = ctx.rackSync
      ? sharedMs
      : endMsAtWtPos(ctx.model, ctx.view.span, pos);
    return {
      card,
      pos,
      ...computeWindowMetrics(card.module.query, ms),
    };
  });

  const maxChurn = Math.max(1, ...stats.map((s) => s.churn));
  const selectedIdx = stats.findIndex((s) => ctx.view.query === s.card.module.query);
  const baseIdx = selectedIdx >= 0 ? selectedIdx : 0;
  const base = stats[baseIdx];

  for (let i = 0; i < stats.length; i++) {
    const item = stats[i];
    const { card, pos } = item;
    const isSelected = ctx.view.query === card.module.query;
    const isBaseline = i === baseIdx && stats.length > 1;
    const pct = Math.round(pos * 100);

    card.el.classList.toggle("is-selected", isSelected);
    card.nameBtn.setAttribute("aria-pressed", isSelected ? "true" : "false");

    if (card.posKnob) {
      card.posKnob.setValue(pos, pct >= 100 ? "NOW" : `${pct}%`);
    }
    if (card.posBadge) {
      card.posBadge.textContent = `${pct}% · ${dateShort(item.endMs)}`;
    }
    if (card.sliceStats) {
      card.sliceStats.textContent = `${item.commits}c · ${formatChurn(item.churn)}`;
    }
    if (card.meterFill) {
      const wPct = item.churn > 0 ? Math.max(6, Math.round((item.churn / maxChurn) * 100)) : 0;
      card.meterFill.style.width = `${wPct}%`;
    }
    if (card.diffBadge) {
      card.diffBadge.classList.remove("is-pos", "is-neg", "is-base");
      if (stats.length <= 1) {
        card.diffBadge.textContent = `${item.commits} in ${ctx.view.span}`;
      } else if (isBaseline) {
        card.diffBadge.classList.add("is-base");
        card.diffBadge.textContent = isSelected ? "BASE · solo" : "BASE";
      } else {
        const dc = item.commits - base.commits;
        const dch = item.churn - base.churn;
        if (dc > 0 || (dc === 0 && dch > 0)) card.diffBadge.classList.add("is-pos");
        else if (dc < 0 || (dc === 0 && dch < 0)) card.diffBadge.classList.add("is-neg");
        card.diffBadge.textContent = `Δ ${signedDelta(dc)}c · ${signedChurn(dch)}`;
      }
    }
  }

  /* Sync Master Rack Comparison Toolbar */
  const slider = document.getElementById("rackWtSlider");
  if (slider instanceof HTMLInputElement) {
    slider.value = String(Math.round(sharedPos * 1000));
    slider.disabled = ctx.view.span === "all";
  }
  const timeOut = document.getElementById("rackTimeOut");
  if (timeOut) {
    timeOut.textContent = `${dateFull(sharedMs)} UTC · ${sharedPct}%`;
  }
  const syncBtn = document.getElementById("rackSyncBtn");
  if (syncBtn) {
    syncBtn.setAttribute("aria-pressed", ctx.rackSync ? "true" : "false");
    syncBtn.textContent = ctx.rackSync ? "sync: on" : "sync: free";
  }
  const lfoBtn = document.getElementById("rackLfoBtn");
  if (lfoBtn) {
    const playing = ctx.view.motion.playing;
    lfoBtn.setAttribute("aria-pressed", playing ? "true" : "false");
    lfoBtn.textContent = playing ? "⏸ scan" : "▶ scan";
  }
  const diffOut = document.getElementById("rackDiffOut");
  if (diffOut) {
    if (!ctx.rackSync) {
      diffOut.textContent = "free mode · comparing independent timestamps";
    } else if (stats.length >= 2) {
      const sorted = [...stats].sort((a, b) => b.churn - a.churn || b.commits - a.commits);
      const leader = sorted[0];
      const runner = sorted[1];
      const gapCommits = leader.commits - runner.commits;
      const gapChurn = leader.churn - runner.churn;
      if (leader.commits === 0) {
        diffOut.textContent = `quiet across all ${stats.length} oscillators in this ${ctx.view.span} window`;
      } else {
        diffOut.textContent = `lead: ${leader.card.module.name} (${leader.commits}c · ${formatChurn(
          leader.churn
        )}) · +${gapCommits}c / +${formatChurn(gapChurn)} over ${runner.card.module.name}`;
      }
    } else if (stats.length === 1) {
      diffOut.textContent = `${stats[0].commits} commits · ${formatChurn(stats[0].churn)} churn in ${ctx.view.span}`;
    } else {
      diffOut.textContent = "";
    }
  }
}

/** Redraw the existing oscillator canvases and sync live WT POS telemetry without rebuilding DOM. */
export function drawRackFrames() {
  for (const card of rackCards) {
    const wtPos = cardWtPos(card);
    drawModuleSurface(card.canvas, card.module, card.index, {
      mode: "rack",
      wtPos,
    });
  }
  syncRackTelemetry();
}

/** Wire master rack toolbar events once at boot. */
export function initRackBar() {
  const slider = document.getElementById("rackWtSlider");
  if (slider instanceof HTMLInputElement) {
    slider.addEventListener("input", () => {
      if (!ctx.rackSync) ctx.rackSync = true;
      scrubGlobalWtPos(Number(slider.value) / 1000);
    });
  }
  const syncBtn = document.getElementById("rackSyncBtn");
  if (syncBtn) {
    syncBtn.addEventListener("click", () => {
      ctx.rackSync = !ctx.rackSync;
      const pos = liveWtPos();
      for (const card of rackCards) {
        const osc = getOscParams(card.module.query);
        osc.pos = ctx.rackSync ? null : pos;
      }
      drawRackFrames();
      announce(
        ctx.rackSync
          ? "rack oscillators synced to shared read head"
          : "rack oscillators unlocked for independent timestamp comparison"
      );
    });
  }
  const lfoBtn = document.getElementById("rackLfoBtn");
  if (lfoBtn) {
    lfoBtn.addEventListener("click", () => togglePlay());
  }
}

function cycleModuleSource(index, direction) {
  if (!ctx.model || !ctx.view) return;
  const catalog = catalogItems(ctx.model);
  if (!catalog.length) return;
  const current = ctx.view.modules[index];
  if (!current) return;
  const curIdx = catalog.findIndex((it) => it.query === current.query);
  const start = curIdx >= 0 ? curIdx : 0;
  /* Find next catalog entry not already shown in another rack slot if possible */
  const otherQueries = new Set(
    ctx.view.modules.filter((_, i) => i !== index).map((m) => m.query)
  );
  let pick = catalog[(start + direction + catalog.length) % catalog.length];
  for (let step = 1; step <= catalog.length; step++) {
    const cand =
      catalog[(((start + direction * step) % catalog.length) + catalog.length) % catalog.length];
    if (!otherQueries.has(cand.query)) {
      pick = cand;
      break;
    }
  }
  const modules = ctx.view.modules.map((m, i) =>
    i === index ? { name: pick.name, query: pick.query, colorKey: pick.colorKey } : m
  );
  const next = { ...ctx.view, modules, query: pick.query };
  const focused = focusFirstMatch(ctx.model, next, pick.query);
  ctx.matchIndex = focused.index;
  setView(focused.view);
  startDepthScan();
}

export function renderRack() {
  const rack = document.getElementById("rack");
  if (!rack || !ctx.view || !ctx.model || !ctx.palette) return;

  const sig = rackSignature();
  if (rackCards.length > 0 && lastSignature === sig && rack.children.length > 0) {
    drawRackFrames();
    return;
  }

  clear(rack);
  rackCards = [];
  lastSignature = sig;

  const countMods = ctx.view.modules.length;
  rack.dataset.cols = String(Math.min(4, Math.max(1, countMods)));

  ctx.view.modules.forEach((module, index) => {
    const count = module.query
      ? searchCommits(ctx.model, module.query).count
      : ctx.model.doc.commits.length;
    const selected = ctx.view.query === module.query;
    const color = ctx.palette.identity[module.colorKey] ?? ctx.palette.ok;
    const osc = getOscParams(module.query);

    const card = el("article", "module");
    card.style.setProperty("--sw", color);
    if (selected) card.classList.add("is-selected");

    /* 1. Serum-style top hardware rail */
    const topbar = el("header", "module-bar");
    const led = el("span", "osc-led");
    led.style.setProperty("--sw", color);
    topbar.appendChild(led);
    topbar.appendChild(el("span", "module-osc", label(index)));
    const diffBadge = el("span", "module-diff", "");
    topbar.appendChild(diffBadge);

    const barActions = el("div", "module-bar-actions");
    const open = document.createElement("button");
    open.type = "button";
    open.className = "osc-btn";
    open.textContent = "⤢";
    open.title = "Expand into Hero 3D + Interactive 2D Scope";
    open.setAttribute("aria-label", `Open ${module.name}`);
    open.addEventListener("click", (event) => {
      event.stopPropagation();
      if (!ctx.view) return;
      ctx.browserOpen = false;
      setView(expandModule(ctx.view, module));
      startDepthScan();
    });

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "osc-btn";
    remove.textContent = "×";
    remove.title = "Remove this oscillator";
    remove.setAttribute("aria-label", `Remove ${module.name}`);
    remove.disabled = ctx.view.modules.length <= 1;
    remove.addEventListener("click", (event) => {
      event.stopPropagation();
      if (ctx.view) setView(removeModule(ctx.view, index));
    });
    barActions.appendChild(open);
    barActions.appendChild(remove);
    topbar.appendChild(barActions);

    /* 2. Source preset selector strip (< Name >) + relative comparison bar */
    const sourceRow = el("div", "module-source");
    const nameBtn = document.createElement("button");
    nameBtn.type = "button";
    nameBtn.className = "module-name-btn";
    nameBtn.setAttribute("aria-pressed", selected ? "true" : "false");
    nameBtn.title = `${module.name} (${module.query || "all commits"}) — click to solo as diff baseline`;
    nameBtn.appendChild(el("span", "module-name", module.name));
    nameBtn.appendChild(el("span", "module-count", String(count)));
    nameBtn.addEventListener("click", () => {
      if (!ctx.view || !ctx.model) return;
      const focused = focusFirstMatch(
        ctx.model,
        { ...ctx.view, query: module.query },
        module.query
      );
      ctx.matchIndex = focused.index;
      setView(focused.view);
      startDepthScan();
    });

    const prevSrc = document.createElement("button");
    prevSrc.type = "button";
    prevSrc.className = "osc-step";
    prevSrc.textContent = "‹";
    prevSrc.title = "Previous Git wavetable source";
    prevSrc.setAttribute("aria-label", `Previous source for ${label(index)}`);
    prevSrc.addEventListener("click", (event) => {
      event.stopPropagation();
      cycleModuleSource(index, -1);
    });

    const nextSrc = document.createElement("button");
    nextSrc.type = "button";
    nextSrc.className = "osc-step";
    nextSrc.textContent = "›";
    nextSrc.title = "Next Git wavetable source";
    nextSrc.setAttribute("aria-label", `Next source for ${label(index)}`);
    nextSrc.addEventListener("click", (event) => {
      event.stopPropagation();
      cycleModuleSource(index, 1);
    });

    sourceRow.appendChild(nameBtn);
    sourceRow.appendChild(prevSrc);
    sourceRow.appendChild(nextSrc);

    /* Relative activity meter comparing this osc's churn against the rack leader at WT POS */
    const meterTrack = el("div", "module-meter");
    const meterFill = el("div", "module-meter-fill");
    meterFill.style.setProperty("--sw", color);
    meterTrack.appendChild(meterFill);

    /* 3. Wide 3D Volumetric Wavetable Canvas */
    const viewport = el("div", "module-viewport");
    const canvas = document.createElement("canvas");
    canvas.className = "module-wave";
    canvas.setAttribute("aria-hidden", "true");
    viewport.appendChild(canvas);

    const posBadge = el("span", "osc-pos-readout", "");
    const sliceStats = el("span", "osc-slice-stats", "");
    viewport.appendChild(posBadge);
    viewport.appendChild(sliceStats);

    /* Click solos as baseline; horizontal drag scrubs WT POS (synced or free); dblclick opens Stage */
    let drag = null;
    viewport.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      drag = { x: event.clientX, y: event.clientY, moved: false };
      try {
        viewport.setPointerCapture(event.pointerId);
      } catch {
        /* non-fatal */
      }
    });
    viewport.addEventListener("pointermove", (event) => {
      if (!drag) return;
      const dx = event.clientX - drag.x;
      if (Math.abs(dx) > 4) drag.moved = true;
      if (drag.moved) {
        const rect = viewport.getBoundingClientRect();
        const norm = clamp((event.clientX - rect.left) / Math.max(1, rect.width), 0, 1);
        if (ctx.rackSync) {
          scrubGlobalWtPos(norm);
        } else {
          osc.pos = norm;
          drawRackFrames();
        }
      }
    });
    viewport.addEventListener("pointerup", () => {
      const wasDrag = drag?.moved;
      drag = null;
      if (!wasDrag && ctx.view && ctx.model) {
        const focused = focusFirstMatch(
          ctx.model,
          { ...ctx.view, query: module.query },
          module.query
        );
        ctx.matchIndex = focused.index;
        setView(focused.view);
        startDepthScan();
      }
    });
    viewport.addEventListener("pointercancel", () => {
      drag = null;
    });
    viewport.addEventListener("dblclick", () => {
      if (!ctx.view) return;
      ctx.browserOpen = false;
      setView(expandModule(ctx.view, module));
      startDepthScan();
    });

    /* 4. Tactile Lower Rotary Knob Deck (Serum / Warpenter) */
    const deck = el("div", "module-deck");
    const posKnob = createKnob({
      label: "WT POS",
      value: ctx.rackSync ? liveWtPos() : osc.pos ?? liveWtPos(),
      defaultValue: 1,
      size: 36,
      accent: ctx.palette.open,
      title: "Time-travel WT POS (synced across all oscillators when SYNC is on · double-click for NOW)",
      format: (v) => (Math.round(v * 100) >= 100 ? "NOW" : `${Math.round(v * 100)}%`),
      onChange(v) {
        if (ctx.rackSync) {
          scrubGlobalWtPos(v);
        } else {
          osc.pos = v;
          drawRackFrames();
        }
      },
      onReset() {
        if (ctx.rackSync) {
          resetGlobalWtPos();
        } else {
          osc.pos = 1;
          drawRackFrames();
        }
      },
    });

    const depthKnob = createKnob({
      label: "DEPTH",
      value: osc.depth,
      defaultValue: 0.65,
      size: 36,
      accent: color,
      title: "3D tilt & depth spread (double-click to reset)",
      onChange(v) {
        osc.depth = v;
        drawRackFrames();
      },
    });

    const smoothKnob = createKnob({
      label: "SMOOTH",
      value: osc.smooth,
      defaultValue: 0.52,
      size: 36,
      accent: color,
      title: "Harmonic wavetable smoothness (double-click to reset)",
      onChange(v) {
        osc.smooth = v;
        drawRackFrames();
      },
    });

    deck.appendChild(posKnob.el);
    deck.appendChild(depthKnob.el);
    deck.appendChild(smoothKnob.el);

    /* 5. Clean compact filter footer */
    const foot = el("footer", "module-foot");
    foot.appendChild(el("code", "module-query", module.query || "all commits"));
    const expandBtn = document.createElement("button");
    expandBtn.type = "button";
    expandBtn.className = "op op-xs";
    expandBtn.textContent = "stage";
    expandBtn.title = "Open full 3D + Interactive 2D Scope for this oscillator";
    expandBtn.addEventListener("click", () => {
      if (!ctx.view) return;
      ctx.browserOpen = false;
      setView(expandModule(ctx.view, module));
      startDepthScan();
    });
    foot.appendChild(expandBtn);

    card.appendChild(topbar);
    card.appendChild(sourceRow);
    card.appendChild(meterTrack);
    card.appendChild(viewport);
    card.appendChild(deck);
    card.appendChild(foot);
    rack.appendChild(card);

    rackCards.push({
      el: card,
      nameBtn,
      canvas,
      module,
      index,
      posKnob,
      posBadge,
      sliceStats,
      diffBadge,
      meterFill,
    });
  });

  if (ctx.view.modules.length < 8) {
    const add = document.createElement("button");
    add.type = "button";
    add.className = "module-add";
    add.title = "Pin the current find as a new oscillator";
    add.appendChild(el("span", "module-add-plus", "+"));
    add.appendChild(el("span", "module-add-label", "add osc"));
    add.addEventListener("click", pinCurrent);
    rack.appendChild(add);
  }

  drawRackFrames();
}

function pinCurrent() {
  if (!ctx.view) return;
  const query = ctx.view.query;
  const name = query || "All commits";
  const used = new Set(ctx.view.modules.map((module) => module.colorKey));
  const colorKey =
    [0, 1, 2, 3, 4, 5].find((key) => !used.has(key)) ?? ctx.view.modules.length % 6;
  const next = pinModule(ctx.view, { name, query, colorKey });
  if (next === ctx.view) {
    announce(
      ctx.view.modules.length >= 8
        ? "the rack holds eight oscillators"
        : "that filter is already pinned"
    );
    return;
  }
  setView(next);
  announce(`pinned “${name}”`);
}
