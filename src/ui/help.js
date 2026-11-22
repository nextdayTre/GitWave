/**
 * help.js — the keyboard map and the model in one panel.
 */

let open = false;

function panel() {
  return document.getElementById("helpPanel");
}

function setTab(tab) {
  const keys = document.getElementById("helpTabKeys");
  const about = document.getElementById("helpTabAbout");
  const keysPanel = document.getElementById("helpKeys");
  const aboutPanel = document.getElementById("helpAbout");
  if (!keys || !about || !keysPanel || !aboutPanel) return;
  const showKeys = tab === "keys";
  keys.setAttribute("aria-selected", showKeys ? "true" : "false");
  about.setAttribute("aria-selected", showKeys ? "false" : "true");
  keys.tabIndex = showKeys ? 0 : -1;
  about.tabIndex = showKeys ? -1 : 0;
  keysPanel.hidden = !showKeys;
  aboutPanel.hidden = showKeys;
}

export function isHelpOpen() {
  return open;
}

export function openHelp(tab = "keys") {
  const node = panel();
  if (!node) return;
  open = true;
  node.hidden = false;
  setTab(tab);
  const button = document.getElementById("helpBtn");
  if (button) button.setAttribute("aria-expanded", "true");
  const selected = node.querySelector('[role="tab"][aria-selected="true"]');
  if (selected instanceof HTMLElement) selected.focus({ preventScroll: true });
}

export function closeHelp() {
  const node = panel();
  if (!node || !open) return;
  open = false;
  node.hidden = true;
  const button = document.getElementById("helpBtn");
  if (button) {
    button.setAttribute("aria-expanded", "false");
    button.focus({ preventScroll: true });
  }
}

export function toggleHelp() {
  if (open) closeHelp();
  else openHelp();
}

export function initHelp() {
  const button = document.getElementById("helpBtn");
  const close = document.getElementById("helpClose");
  const keys = document.getElementById("helpTabKeys");
  const about = document.getElementById("helpTabAbout");
  const tabs = [keys, about].filter((node) => node instanceof HTMLElement);

  if (button) {
    button.addEventListener("click", () => toggleHelp());
  }
  if (close) close.addEventListener("click", closeHelp);
  if (keys) keys.addEventListener("click", () => setTab("keys"));
  if (about) about.addEventListener("click", () => setTab("about"));

  for (const tab of tabs) {
    tab.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const next = event.key === "ArrowRight" ? "about" : "keys";
      setTab(next);
      const target = document.getElementById(next === "about" ? "helpTabAbout" : "helpTabKeys");
      if (target) target.focus();
    });
  }
}
