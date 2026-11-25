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
  sampleAgentSlice,
} from "../core/agent.ts";
import { hexToRgbFast, mixHex, rgba, rgbaMixRgb } from "../core/theme.ts";
import { clear, el } from "./dom.js";
import { startTour, stopTour } from "./tour.js";

const SWATCH_TOKENS = ["agent", "ok", "id1", "id2", "id3", "id4", "open", "risk"];
const POD_SLICES = 18;
const POD_SAMPLES = 64;

/* Reusable buffers so 60fps Agent Pod frames allocate zero typed arrays or tuples */
const podFramePool = Array.from({ length: POD_SLICES }, () => new Float32Array(POD_SAMPLES));
const podScanSlice = new Float32Array(POD_SAMPLES);
const podProjX = new Float32Array(POD_SAMPLES);
const podProjY = new Float32Array(POD_SAMPLES);

let podCanvas = null;
let podCachedW = 0;
let podCachedH = 0;
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

export function invalidateAgentPodSize() {
  podCachedW = 0;
  podCachedH = 0;
}

function fitCanvas(canvas) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  if (podCachedW < 8 || podCachedH < 8) {
    const rect = canvas.getBoundingClientRect();
    podCachedW = Math.max(1, Math.round(rect.width));
    podCachedH = Math.max(1, Math.round(rect.height));
  }
  const width = podCachedW;
  const height = podCachedH;
  const pxW = Math.round(width * dpr);
  const pxH = Math.round(height * dpr);
  if (canvas.width !== pxW || canvas.height !== pxH) {
    canvas.width = pxW;
    canvas.height = pxH;
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
  const bright = mixHex(accent, P.handle, 0.48);
  const core = mixHex(accent, P.handle, 0.78);
  const accentRgb = hexToRgbFast(accent);
  const secondaryRgb = hexToRgbFast(secondary);
  const brightRgb = hexToRgbFast(bright);
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

  const sliceCount = POD_SLICES;
  const sampleCount = POD_SAMPLES;
  const { frames, scanZ } = evaluateAgentSurface(ctx.agent, phase, sliceCount, sampleCount, podFramePool);
  sampleAgentSlice(frames, scanZ, podScanSlice);

  /* Isometric mini-stage projection (balanced margins across Z-depth) */
  const padX = 24;
  const frontW = w - padX * 2;
  const backShrink = 0.22;
  const baseBottom = h * 0.78;
  const depthLift = h * 0.44;
  const ampScale = h * 0.22;
  const invS = 1 / (sampleCount - 1);
  const invZ = 1 / (sliceCount - 1);

  const projectSlice = (z, wave) => {
    const rowW = frontW * (1 - backShrink * z);
    const left = (w - rowW) * 0.5 + (z - 0.5) * (w * 0.04);
    const baseY = baseBottom - z * depthLift;
    const scaleY = ampScale * (1 - 0.34 * z);
    for (let s = 0; s < sampleCount; s++) {
      podProjX[s] = left + s * invS * rowW;
      podProjY[s] = baseY - wave[s] * scaleY;
    }
    return { left, right: left + rowW, baseY };
  };

  /* Subtle wireframe base deck */
  g.save();
  g.strokeStyle = rgba(P.lineHi, 0.45);
  g.lineWidth = 0.75;
  const backW = frontW * (1 - backShrink);
  const backLeft = (w - backW) * 0.5 + 0.5 * (w * 0.04);
  const backY = baseBottom - depthLift;
  const frontLeft = (w - frontW) * 0.5 - 0.5 * (w * 0.04);
  g.beginPath();
  g.moveTo(backLeft, backY);
  g.lineTo(backLeft + backW, backY);
  g.lineTo(frontLeft + frontW, baseBottom);
  g.lineTo(frontLeft, baseBottom);
  g.closePath();
  g.stroke();
  g.restore();

  const drawContinuousScanPlane = () => {
    const { left, right, baseY } = projectSlice(scanZ, podScanSlice);

    /* Translucent luminous curtain underneath the continuous scan slice */
    g.beginPath();
    g.moveTo(podProjX[0], podProjY[0]);
    for (let s = 1; s < sampleCount; s++) g.lineTo(podProjX[s], podProjY[s]);
    g.lineTo(right, baseY);
    g.lineTo(left, baseY);
    g.closePath();
    g.fillStyle = rgbaMixRgb(accentRgb, brightRgb, 0.35, 0.22);
    g.fill();

    /* Fast additive bloom (zero shadowBlur!) + crisp bright trace + hot filament core */
    g.save();
    g.lineJoin = "round";
    g.lineCap = "round";
    g.beginPath();
    g.moveTo(podProjX[0], podProjY[0]);
    for (let s = 1; s < sampleCount; s++) g.lineTo(podProjX[s], podProjY[s]);

    g.globalCompositeOperation = "lighter";
    g.strokeStyle = rgbaMixRgb(accentRgb, brightRgb, 0.4, 0.32);
    g.lineWidth = 5.2;
    g.stroke();

    g.globalCompositeOperation = "source-over";
    g.strokeStyle = bright;
    g.lineWidth = 1.7;
    g.stroke();

    g.strokeStyle = rgba(core, 0.85);
    g.lineWidth = 0.7;
    g.stroke();
    g.restore();
  };

  /* Continuous depth insertion index for the gliding scan plane */
  const scanInsertIdx = Math.floor(scanZ * (sliceCount - 1));
  let scanDrawn = false;

  /* Paint back-to-front translucent ribbons with smooth Z-proximity glow falloff */
  g.save();
  g.lineJoin = "round";
  g.lineCap = "round";

  for (let i = sliceCount - 1; i >= 0; i--) {
    const z = i * invZ;
    const wave = frames[i];
    const isFront = i === 0;
    const dz = z - scanZ;
    /* Smooth Gaussian proximity halo so light flows organically between neighboring slices */
    const prox = Math.exp(-dz * dz * 70);
    const { left, right, baseY } = projectSlice(z, wave);

    /* Soft ribbon fill */
    g.beginPath();
    g.moveTo(podProjX[0], podProjY[0]);
    for (let s = 1; s < sampleCount; s++) g.lineTo(podProjX[s], podProjY[s]);
    g.lineTo(right, baseY);
    g.lineTo(left, baseY);
    g.closePath();
    const fillAlpha = (isFront ? 0.14 : 0.05 + (1 - z) * 0.048) + prox * 0.08;
    g.fillStyle = rgbaMixRgb(accentRgb, secondaryRgb, z * 0.75 * (1 - prox * 0.5), fillAlpha);
    g.fill();

    /* Crisp harmonic contour stroke (reuses projected points, zero shadowBlur) */
    g.beginPath();
    g.moveTo(podProjX[0], podProjY[0]);
    for (let s = 1; s < sampleCount; s++) g.lineTo(podProjX[s], podProjY[s]);

    if (isFront) {
      g.strokeStyle = accent;
      g.lineWidth = 1.35 + prox * 0.35;
      g.stroke();
      g.globalCompositeOperation = "lighter";
      g.strokeStyle = rgbaMixRgb(accentRgb, brightRgb, prox * 0.5, 0.22 + prox * 0.12);
      g.lineWidth = 3.4;
      g.stroke();
      g.globalCompositeOperation = "source-over";
    } else {
      const baseAlpha = 0.26 + (1 - z) * 0.4 + prox * 0.28;
      g.strokeStyle =
        prox > 0.08
          ? rgbaMixRgb(accentRgb, brightRgb, prox * 0.65, Math.min(0.95, baseAlpha))
          : rgbaMixRgb(accentRgb, secondaryRgb, z * 0.75, baseAlpha);
      g.lineWidth = 0.85 + prox * 0.55;
      g.stroke();
    }

    if (!scanDrawn && i <= scanInsertIdx) {
      drawContinuousScanPlane();
      scanDrawn = true;
    }
  }

  if (!scanDrawn) {
    drawContinuousScanPlane();
  }
  g.restore();
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
    invalidateAgentPodSize();

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
