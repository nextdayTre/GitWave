/**
 * agent-pod.js — Floating Detached Agent Oscillator ("Agent Synth Avatar").
 *
 * Always floats above the main GitWave GUI when enabled, draggable anywhere on
 * screen. Lets an AI agent or human user pick a signature color and mathematical
 * waveform formula whose cyclic modulations visibly react to live tasks
 * (reading, searching, diffing, editing, pushing, merging, cloning, syncing).
 *
 * Zero hex literals; untrusted text is rendered exclusively via textContent.
 */

import { ctx, setAgent } from "../app.ts";
import {
  AGENT_ACTIVITIES,
  AGENT_COLOR_TOKENS,
  AGENT_FORMULAS,
  evaluateAgentSurface,
} from "../core/agent.ts";
import { mixHex, rgba } from "../core/theme.ts";
import { clear, el } from "./dom.js";
import { startTour, stopTour } from "./tour.js";

const SWATCH_TOKENS = ["agent", "ok", "id1", "id2", "id3", "id4", "open", "risk"];

let podCanvas = null;
let configOpen = false;
let podBuilt = false;
let podClock = 0;
let dragOffset = null;
let customPos = null;
let lastSig = "";

function resolveAgentColor() {
  const P = ctx.palette;
  const fallback = P ? P.agent : "currentColor";
  if (!P) return fallback;
  const cfg = ctx.agent;
  if (cfg.customColor) return cfg.customColor;
  const tok = cfg.colorToken;
  if (tok === "agent") return P.agent;
  if (tok === "ok") return P.ok;
  if (tok === "open") return P.open;
  if (tok === "risk") return P.risk;
  if (tok === "review") return P.review;
  if (tok.startsWith("id")) {
    const idx = Number(tok.slice(2));
    return P.identity[idx] ?? P.agent;
  }
  return P.agent;
}

function tokenHex(tok) {
  const P = ctx.palette;
  if (!P) return "";
  if (tok === "agent") return P.agent;
  if (tok === "ok") return P.ok;
  if (tok === "open") return P.open;
  if (tok === "risk") return P.risk;
  if (tok === "review") return P.review;
  if (tok.startsWith("id")) return P.identity[Number(tok.slice(2))] ?? P.agent;
  return P.agent;
}

function fitCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }
  const g = canvas.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { g, width, height };
}

/** Draw one frame of the floating mini 3D volumetric agent wavetable. */
export function drawAgentPodFrame(phaseSec = null) {
  if (!ctx.agent.visible || ctx.agent.minimized || !podCanvas || !ctx.palette) return;
  const P = ctx.palette;
  const accent = resolveAgentColor();
  const secondary = mixHex(accent, P.depth, 0.55);
  const bright = mixHex(accent, P.handle, 0.42);
  const phase = typeof phaseSec === "number" ? phaseSec : podClock;

  const { g, width: w, height: h } = fitCanvas(podCanvas);
  if (w < 8 || h < 8) return;

  /* Background radial glow tinted by the agent's signature color */
  g.fillStyle = P.bg;
  g.fillRect(0, 0, w, h);

  const grad = g.createRadialGradient(w * 0.5, h * 0.56, 6, w * 0.5, h * 0.56, Math.max(w, h) * 0.68);
  grad.addColorStop(0, rgba(accent, 0.2));
  grad.addColorStop(0.55, rgba(secondary, 0.08));
  grad.addColorStop(1, rgba(P.bg, 0));
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);

  const sliceCount = 18;
  const sampleCount = 64;
  const { frames, scanZ } = evaluateAgentSurface(ctx.agent, phase, sliceCount, sampleCount);

  /* Isometric mini-stage projection (balanced margins across Z-depth) */
  const padX = 24;
  const frontW = w - padX * 2;
  const backShrink = 0.22;
  const baseBottom = h * 0.78;
  const depthLift = h * 0.44;
  const ampScale = h * 0.22;

  const project = (u, z, val) => {
    const rowW = frontW * (1 - backShrink * z);
    const left = (w - rowW) * 0.5 + (z - 0.5) * (w * 0.04);
    const x = left + u * rowW;
    const baseY = baseBottom - z * depthLift;
    const y = baseY - val * ampScale * (1 - 0.34 * z);
    return [x, y, baseY];
  };

  /* Subtle wireframe base deck */
  g.save();
  g.strokeStyle = rgba(P.lineHi, 0.45);
  g.lineWidth = 0.75;
  const [blx, bly] = project(0, 1, 0);
  const [brx, bry] = project(1, 1, 0);
  const [flx, fly] = project(0, 0, 0);
  const [frx, fry] = project(1, 0, 0);
  g.beginPath();
  g.moveTo(blx, bly);
  g.lineTo(brx, bry);
  g.lineTo(frx, fry);
  g.lineTo(flx, fly);
  g.closePath();
  g.stroke();
  g.restore();

  const scanIdx = Math.round(scanZ * (sliceCount - 1));

  /* Paint back-to-front translucent ribbons */
  for (let i = sliceCount - 1; i >= 0; i--) {
    const z = sliceCount > 1 ? i / (sliceCount - 1) : 0;
    const wave = frames[i];
    const isScan = i === scanIdx;
    const isFront = i === 0;
    const col = mixHex(accent, secondary, z * 0.75);

    /* Soft ribbon fill */
    g.beginPath();
    for (let s = 0; s < sampleCount; s++) {
      const u = s / (sampleCount - 1);
      const [x, y] = project(u, z, wave[s]);
      if (s === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    const [rx, , rBase] = project(1, z, 0);
    const [lx, , lBase] = project(0, z, 0);
    g.lineTo(rx, rBase);
    g.lineTo(lx, lBase);
    g.closePath();
    g.fillStyle = rgba(col, isScan ? 0.24 : isFront ? 0.16 : 0.055 + (1 - z) * 0.05);
    g.fill();

    /* Crisp harmonic contour stroke */
    g.beginPath();
    for (let s = 0; s < sampleCount; s++) {
      const u = s / (sampleCount - 1);
      const [x, y] = project(u, z, wave[s]);
      if (s === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    if (isScan) {
      g.strokeStyle = bright;
      g.lineWidth = 1.9;
      g.shadowColor = rgba(accent, 0.75);
      g.shadowBlur = 8;
    } else if (isFront) {
      g.strokeStyle = accent;
      g.lineWidth = 1.45;
      g.shadowColor = rgba(accent, 0.45);
      g.shadowBlur = 4;
    } else {
      g.strokeStyle = rgba(col, 0.28 + (1 - z) * 0.42);
      g.lineWidth = 0.9;
      g.shadowBlur = 0;
    }
    g.stroke();
    g.shadowBlur = 0;
  }
}

export function stepAgentPodClock(phaseSec) {
  podClock = phaseSec;
  drawAgentPodFrame(phaseSec);
}

export function toggleAgentPod() {
  setAgent({ visible: !ctx.agent.visible });
}

function attachDrag(handle, pod) {
  handle.addEventListener("pointerdown", (event) => {
    if (event.target instanceof Element && event.target.closest("button, input, select")) return;
    const rect = pod.getBoundingClientRect();
    dragOffset = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    handle.setPointerCapture(event.pointerId);
    pod.classList.add("is-dragging");
  });

  handle.addEventListener("pointermove", (event) => {
    if (!dragOffset) return;
    const rect = pod.getBoundingClientRect();
    const maxX = Math.max(8, window.innerWidth - rect.width - 8);
    const maxY = Math.max(8, window.innerHeight - rect.height - 8);
    const left = Math.max(8, Math.min(maxX, event.clientX - dragOffset.x));
    const top = Math.max(8, Math.min(maxY, event.clientY - dragOffset.y));
    customPos = { left, top };
    pod.style.left = `${Math.round(left)}px`;
    pod.style.top = `${Math.round(top)}px`;
    pod.style.right = "auto";
    pod.style.bottom = "auto";
  });

  const endDrag = (event) => {
    if (!dragOffset) return;
    dragOffset = null;
    pod.classList.remove("is-dragging");
    try {
      handle.releasePointerCapture(event.pointerId);
    } catch {
      /* ignore */
    }
  };
  handle.addEventListener("pointerup", endDrag);
  handle.addEventListener("pointercancel", endDrag);
}

function renderTuner(container) {
  clear(container);
  const cfg = ctx.agent;
  const formulaMeta = AGENT_FORMULAS.find((f) => f.id === cfg.formula) ?? AGENT_FORMULAS[0];

  /* Identity name row */
  const nameRow = el("div", "ap-row");
  nameRow.appendChild(el("span", "ap-label", "name"));
  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.className = "ap-input";
  nameInput.maxLength = 32;
  nameInput.value = cfg.name;
  nameInput.setAttribute("aria-label", "Agent oscillator name");
  nameInput.addEventListener("change", () => {
    setAgent({ name: nameInput.value || "Antigravity" });
  });
  nameRow.appendChild(nameInput);
  container.appendChild(nameRow);

  /* Color signature row */
  const colorRow = el("div", "ap-row");
  colorRow.appendChild(el("span", "ap-label", "color"));
  const swatches = el("div", "ap-swatches");
  for (const tok of SWATCH_TOKENS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = !cfg.customColor && cfg.colorToken === tok ? "ap-swatch is-active" : "ap-swatch";
    btn.style.setProperty("--sw", tokenHex(tok));
    btn.title = `Theme token: ${tok}`;
    btn.setAttribute("aria-label", `Use ${tok} color`);
    btn.addEventListener("click", () => setAgent({ colorToken: tok, customColor: null }));
    swatches.appendChild(btn);
  }
  const picker = document.createElement("input");
  picker.type = "color";
  picker.className = "ap-color-picker";
  picker.value = resolveAgentColor();
  picker.title = "Pick a custom signature color";
  picker.setAttribute("aria-label", "Custom signature color");
  picker.addEventListener("input", () => setAgent({ customColor: picker.value }));
  swatches.appendChild(picker);
  colorRow.appendChild(swatches);
  container.appendChild(colorRow);

  /* Waveform formula selector */
  const formBlock = el("div", "ap-block");
  const formHead = el("div", "ap-block-head");
  formHead.appendChild(el("span", "ap-label", "formula"));
  formHead.appendChild(el("code", "ap-eq", formulaMeta.equation));
  formBlock.appendChild(formHead);
  const formChips = el("div", "ap-chips");
  for (const f of AGENT_FORMULAS) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = cfg.formula === f.id ? "ap-chip is-active" : "ap-chip";
    b.textContent = f.label;
    b.title = `${f.equation} — ${f.note}`;
    b.addEventListener("click", () => setAgent({ formula: f.id }));
    formChips.appendChild(b);
  }
  formBlock.appendChild(formChips);
  container.appendChild(formBlock);

  /* Modulation sliders */
  const sliders = [
    { key: "carrier", label: "carrier", min: 1, max: 7, step: 0.25 },
    { key: "modDepth", label: "mod", min: 0, max: 2.2, step: 0.05 },
    { key: "fold", label: "fold", min: 0, max: 2, step: 0.05 },
  ];
  const sliderGrid = el("div", "ap-sliders");
  for (const s of sliders) {
    const cell = el("label", "ap-slider-cell");
    const top = el("span", "ap-slider-top");
    top.appendChild(el("span", "", s.label));
    const valEl = el("code", "", Number(cfg.params[s.key]).toFixed(2));
    top.appendChild(valEl);
    cell.appendChild(top);
    const range = document.createElement("input");
    range.type = "range";
    range.min = String(s.min);
    range.max = String(s.max);
    range.step = String(s.step);
    range.value = String(cfg.params[s.key]);
    range.addEventListener("input", () => {
      const nextVal = Number(range.value);
      valEl.textContent = nextVal.toFixed(2);
      setAgent({ params: { [s.key]: nextVal } });
    });
    cell.appendChild(range);
    sliderGrid.appendChild(cell);
  }
  container.appendChild(sliderGrid);

  /* Activity modulation preview chips */
  const actBlock = el("div", "ap-block");
  actBlock.appendChild(el("span", "ap-label", "task modulation"));
  const actChips = el("div", "ap-chips");
  for (const a of AGENT_ACTIVITIES) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = cfg.activity === a.id ? "ap-chip is-active" : "ap-chip";
    b.textContent = a.id;
    b.title = a.note;
    b.addEventListener("click", () =>
      setAgent({
        activity: a.id,
        task: a.id === "idle" ? "Standing by — ready to pair" : `Previewing ${a.note}`,
      })
    );
    actChips.appendChild(b);
  }
  actBlock.appendChild(actChips);
  container.appendChild(actBlock);
}

export function initAgentPod() {
  const trigger = document.getElementById("agentBtn");
  if (trigger) {
    trigger.addEventListener("click", toggleAgentPod);
  }
}

export function renderAgentPod() {
  const pod = document.getElementById("agentPod");
  const trigger = document.getElementById("agentBtn");
  const cfg = ctx.agent;
  const accent = resolveAgentColor();

  if (trigger) {
    trigger.setAttribute("aria-pressed", cfg.visible ? "true" : "false");
    trigger.style.setProperty("--agent-sw", accent);
    const dot = trigger.querySelector(".agent-btn-dot");
    if (dot) dot.classList.toggle("is-busy", cfg.activity !== "idle");
  }

  if (!pod) return;
  pod.hidden = !cfg.visible;
  if (!cfg.visible) return;

  pod.style.setProperty("--agent-sw", accent);
  pod.classList.toggle("is-minimized", cfg.minimized);
  pod.classList.toggle("is-busy", cfg.activity !== "idle");

  if (customPos) {
    pod.style.left = `${Math.round(customPos.left)}px`;
    pod.style.top = `${Math.round(customPos.top)}px`;
    pod.style.right = "auto";
    pod.style.bottom = "auto";
  }

  const sig = JSON.stringify([
    cfg.name,
    cfg.role,
    cfg.formula,
    cfg.colorToken,
    cfg.customColor,
    cfg.activity,
    cfg.task,
    cfg.repo,
    cfg.minimized,
    cfg.liveConnected,
    ctx.tour?.active ?? false,
    configOpen,
    ctx.view?.theme ?? "",
  ]);

  if (podBuilt && sig === lastSig) {
    drawAgentPodFrame();
    return;
  }
  lastSig = sig;
  podBuilt = true;
  clear(pod);

  /* Header (drag handle) */
  const head = el("header", "ap-head");
  const idGroup = el("div", "ap-id");
  const led = el("span", "ap-led");
  idGroup.appendChild(led);
  idGroup.appendChild(el("span", "ap-name", cfg.name));
  idGroup.appendChild(el("span", "ap-activity", cfg.activity.toUpperCase()));
  if (cfg.liveConnected) {
    idGroup.appendChild(el("span", "ap-live-pill", "LIVE"));
  }
  head.appendChild(idGroup);

  const actions = el("div", "ap-actions");
  const tuneBtn = document.createElement("button");
  tuneBtn.type = "button";
  tuneBtn.className = configOpen ? "ap-ico-btn is-active" : "ap-ico-btn";
  tuneBtn.textContent = "⚙";
  tuneBtn.title = "Configure agent color, waveform formula & task modulation";
  tuneBtn.setAttribute("aria-pressed", configOpen ? "true" : "false");
  tuneBtn.addEventListener("click", () => {
    configOpen = !configOpen;
    if (configOpen && cfg.minimized) {
      setAgent({ minimized: false });
    } else {
      lastSig = "";
      renderAgentPod();
    }
  });

  const minBtn = document.createElement("button");
  minBtn.type = "button";
  minBtn.className = "ap-ico-btn";
  minBtn.textContent = cfg.minimized ? "+" : "−";
  minBtn.title = cfg.minimized ? "Expand floating oscillator" : "Minimize to compact pill";
  minBtn.addEventListener("click", () => setAgent({ minimized: !cfg.minimized }));

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "ap-ico-btn";
  closeBtn.textContent = "×";
  closeBtn.title = "Hide floating agent oscillator (A)";
  closeBtn.addEventListener("click", () => setAgent({ visible: false }));

  actions.appendChild(tuneBtn);
  actions.appendChild(minBtn);
  actions.appendChild(closeBtn);
  head.appendChild(actions);
  pod.appendChild(head);
  attachDrag(head, pod);

  if (!cfg.minimized) {
    const screen = el("div", "ap-screen");
    podCanvas = document.createElement("canvas");
    podCanvas.className = "ap-canvas";
    podCanvas.setAttribute("aria-label", `${cfg.name} oscillator (${cfg.formula}, ${cfg.activity})`);
    screen.appendChild(podCanvas);

    const metaOverlay = el("div", "ap-screen-meta");
    metaOverlay.appendChild(el("span", "ap-formula-tag", cfg.formula));
    if (cfg.repo) metaOverlay.appendChild(el("span", "ap-repo-tag", cfg.repo));
    screen.appendChild(metaOverlay);
    pod.appendChild(screen);

    const foot = el("div", "ap-foot");
    foot.appendChild(el("span", "ap-task", cfg.task || "Standing by"));
    const tourBtn = document.createElement("button");
    tourBtn.type = "button";
    tourBtn.className = ctx.tour?.active ? "ap-tour-btn is-active" : "ap-tour-btn";
    tourBtn.textContent = ctx.tour?.active ? "stop tour" : "▶ tour";
    tourBtn.title = "Play the Welcome Tour from Trevor & Antigravity";
    tourBtn.addEventListener("click", () => {
      if (ctx.tour?.active) stopTour();
      else startTour({ autoplay: true });
    });
    foot.appendChild(tourBtn);
    pod.appendChild(foot);

    if (configOpen) {
      const tuner = el("section", "ap-tuner");
      renderTuner(tuner);
      pod.appendChild(tuner);
    }

    drawAgentPodFrame();
  } else {
    podCanvas = null;
  }
}

export { AGENT_COLOR_TOKENS };
