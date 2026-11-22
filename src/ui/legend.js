/**
 * legend.js — every ref, its colour, its PR state and its visibility eye.
 */

import { ctx, identityOf, setView } from "../app.ts";
import { refHasAgent } from "../core/refs.ts";
import { focusRefView, showRef, toggleRef } from "../core/view.ts";
import { clear, el } from "../ui/dom.js";

export function renderLegend() {
  const host = document.getElementById("legend");
  if (!host || !ctx.model || !ctx.view) return;
  clear(host);

  for (const ref of ctx.model.doc.refs) {
    const visible = ctx.view.refs.includes(ref.id);
    const item = el("div", "legend-item");
    if (!visible) item.classList.add("is-hidden");
    if (ctx.view.lens.agents && !refHasAgent(ctx.model, ref.id)) {
      item.classList.add("is-dimmed");
    }

    const focus = document.createElement("button");
    focus.type = "button";
    focus.className = "legend-focus";
    focus.setAttribute("aria-pressed", ctx.view.focusRef === ref.id ? "true" : "false");
    focus.title =
      `${ref.name} · ${ref.kind}` +
      (ref.pr ? ` · PR #${ref.pr.number} ${ref.pr.state}` : " · no pull request");
    const swatch = el("span", "legend-swatch");
    swatch.style.setProperty("--sw", identityOf(ref));
    focus.appendChild(swatch);
    focus.appendChild(el("span", "legend-name", ref.name));
    if (ref.pr && (ref.pr.state === "open" || ref.pr.state === "draft")) {
      focus.appendChild(el("span", "legend-pr", "●"));
    }
    focus.addEventListener("click", () => {
      setView(focusRefView(ctx.model, showRef(ctx.view, ref.id), ref));
    });

    const eye = document.createElement("button");
    eye.type = "button";
    eye.className = "legend-eye";
    eye.setAttribute("aria-pressed", visible ? "true" : "false");
    eye.setAttribute("aria-label", `${visible ? "Hide" : "Show"} ${ref.name}`);
    eye.title = `${visible ? "Hide" : "Show"} ${ref.name}`;
    eye.textContent = visible ? "◉" : "○";
    eye.addEventListener("click", () => {
      setView(toggleRef(ctx.view, ref.id));
    });

    item.appendChild(focus);
    item.appendChild(eye);
    host.appendChild(item);
  }
}
