/**
 * browser.js — Kilohearts-inspired Git Tree sidebar + Floating 3D Wavetable Browser.
 *
 * Left sidebar: hierarchical Git source tree (Favorites, Presets, Branches, Authors)
 * with crisp folder icons, PR/agent indicators and active highlight rows.
 *
 * Browser Grid mode: borderless dark gallery of floating, glowing translucent 3D
 * wavetables (heart + title + source subtitle beneath each), animating on hover.
 */

import { ctx, requestRender, setView } from "../app.ts";
import { searchCommits } from "../core/search.ts";
import { expandModule, focusFirstMatch, pinModule } from "../core/view.ts";
import { drawModuleSurface, startDepthScan } from "../render/depth.js";
import { announce } from "./status.ts";
import { clear, el } from "./dom.js";

let browserTiles = [];
const collapsed = new Set();

/** Build the complete catalog of selectable wavetable filters for the loaded repo. */
export function catalogItems(model) {
  if (!model) return [];
  const items = [];

  /* 1. Presets */
  const presets = [
    { name: "All Commits", query: "", subtitle: "repository", colorKey: 0, category: "presets", kind: "repo" },
    { name: "Merge History", query: "merged", subtitle: "integration", colorKey: 0, category: "presets", kind: "merge" },
    { name: "Agent Activity", query: "agent", subtitle: "automated", colorKey: 3, category: "presets", kind: "agent" },
    { name: "Merge Commits", query: "merge", subtitle: "merges", colorKey: 1, category: "presets", kind: "merge" },
  ];
  for (const p of presets) {
    const count = p.query ? searchCommits(model, p.query).count : model.doc.commits.length;
    items.push({ ...p, count });
  }

  /* 2. Branches / Refs */
  for (const ref of model.doc.refs) {
    const query = `ref:${ref.id}`;
    const count = searchCommits(model, query).count;
    const pr = ref.pr;
    const prTag = pr && (pr.state === "open" || pr.state === "draft") ? `PR #${pr.number}` : null;
    const stale = ctx.prsByRef.get(ref.id)?.stale ?? false;
    items.push({
      name: ref.name,
      query,
      subtitle: ref.kind === "trunk" ? "trunk" : prTag ? prTag : "branch",
      colorKey: ref.colorKey,
      category: "branches",
      kind: ref.kind,
      prTag,
      stale,
      count,
    });
  }

  /* 3. Authors */
  const authorCounts = new Map();
  const authorKind = new Map();
  for (const commit of model.doc.commits) {
    const name = commit.author.name;
    authorCounts.set(name, (authorCounts.get(name) ?? 0) + 1);
    authorKind.set(name, commit.author.kind);
  }
  const sortedAuthors = [...authorCounts.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0])
  );
  let aIdx = 0;
  for (const [name, count] of sortedAuthors) {
    const token = name.split(/[\s/]+/)[0].toLowerCase();
    const kind = authorKind.get(name) ?? "human";
    const query = `author:${token}`;
    items.push({
      name,
      query,
      subtitle: kind === "agent" ? "agent" : "author",
      colorKey: kind === "agent" ? 3 : (aIdx + 1) % 6,
      category: "authors",
      kind,
      count,
    });
    aIdx += 1;
  }

  return items;
}

function makeSvgIcon(kind) {
  const ns = document.querySelector("svg")?.namespaceURI || "";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("width", "14");
  svg.setAttribute("height", "14");
  svg.setAttribute("class", "tree-ico");
  svg.setAttribute("aria-hidden", "true");

  const path = document.createElementNS(ns, "path");
  path.setAttribute("fill", "currentColor");
  if (kind === "heart" || kind === "heart-fill") {
    path.setAttribute(
      "d",
      "M8 13.7l-1.1-1C3.2 9.4 1.2 7.5 1.2 5.1 1.2 3.2 2.7 1.8 4.6 1.8c1.1 0 2.2.5 2.9 1.4.7-.9 1.8-1.4 2.9-1.4 1.9 0 3.4 1.4 3.4 3.3 0 2.4-2 4.3-5.7 7.6L8 13.7z"
    );
    if (kind === "heart") {
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", "currentColor");
      path.setAttribute("stroke-width", "1.35");
    }
  } else if (kind === "folder") {
    path.setAttribute(
      "d",
      "M1.5 3.2A1.2 1.2 0 0 1 2.7 2h3.4l1.4 1.5h5.8A1.2 1.2 0 0 1 14.5 4.7v7.6a1.2 1.2 0 0 1-1.2 1.2H2.7a1.2 1.2 0 0 1-1.2-1.2V3.2z"
    );
  } else if (kind === "branch") {
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "1.4");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute(
      "d",
      "M4.5 3v10M4.5 5.5c0 2.5 6.5 1.2 6.5 4.5M11 10v2.5"
    );
  } else if (kind === "user") {
    path.setAttribute(
      "d",
      "M8 2.2a2.6 2.6 0 1 1 0 5.2 2.6 2.6 0 0 1 0-5.2zm0 6.5c2.9 0 5.2 1.5 5.2 3.4v1.1H2.8v-1.1c0-1.9 2.3-3.4 5.2-3.4z"
    );
  } else if (kind === "agent") {
    path.setAttribute("d", "M8 1.5L13.5 8 8 14.5 2.5 8 8 1.5zm0 3.1L5.2 8 8 11.4 10.8 8 8 4.6z");
  } else {
    /* wave icon */
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "1.45");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    path.setAttribute("d", "M1.5 8.5c1.5-4.5 3-4.5 4.5 0s3 4.5 4.5 0 2.5-3.5 4 0");
  }
  svg.appendChild(path);
  return svg;
}

/** Load an item into the active oscillator / stage without jarring navigation. */
export function selectCatalogItem(item, opts = {}) {
  if (!ctx.view || !ctx.model) return;
  const openStage = opts.openStage === true;
  const leaveBrowser = opts.leaveBrowser === true;

  let nextView = ctx.view;
  /* If currently in Rack mode and item isn't in modules yet, load into the currently selected slot */
  if (nextView.depth && nextView.rack && !ctx.browserOpen) {
    const existingIdx = nextView.modules.findIndex((m) => m.query === item.query);
    if (existingIdx < 0) {
      const activeIdx = Math.max(
        0,
        nextView.modules.findIndex((m) => m.query === nextView.query)
      );
      const updated = nextView.modules.map((m, idx) =>
        idx === activeIdx
          ? { name: item.name, query: item.query, colorKey: item.colorKey }
          : m
      );
      nextView = { ...nextView, modules: updated };
    }
  }

  const focused = focusFirstMatch(ctx.model, { ...nextView, query: item.query }, item.query);
  let finalView = focused.view;

  if (openStage) {
    ctx.browserOpen = false;
    finalView = expandModule(finalView, {
      name: item.name,
      query: item.query,
      colorKey: item.colorKey,
    });
  } else if (leaveBrowser) {
    ctx.browserOpen = false;
    /* Ensure item is present in rack when coming from browser */
    if (finalView.depth && finalView.rack) {
      const has = finalView.modules.some((m) => m.query === item.query);
      if (!has) {
        const activeIdx = Math.max(
          0,
          finalView.modules.findIndex((m) => m.query === ctx.view?.query)
        );
        finalView = {
          ...finalView,
          modules: finalView.modules.map((m, idx) =>
            idx === activeIdx
              ? { name: item.name, query: item.query, colorKey: item.colorKey }
              : m
          ),
        };
      }
    }
  }

  ctx.matchIndex = focused.index;
  setView(finalView);
  startDepthScan();
}

function pinCatalogItem(item) {
  if (!ctx.view) return;
  const next = pinModule(ctx.view, {
    name: item.name,
    query: item.query,
    colorKey: item.colorKey,
  });
  if (next === ctx.view) {
    announce(
      ctx.view.modules.length >= 8
        ? "rack holds 8 oscillators"
        : `“${item.name}” is already in the rack`
    );
    return;
  }
  setView(next);
  announce(`added “${item.name}” to rack`);
}

function toggleFavorite(query) {
  if (ctx.favorites.has(query)) ctx.favorites.delete(query);
  else ctx.favorites.add(query);
  requestRender();
}

/** Render the Kilohearts-style collapsible Git Tree sidebar. */
export function renderTree() {
  const host = document.getElementById("gitTreeBody");
  if (!host || !ctx.model || !ctx.view || !ctx.palette) return;
  clear(host);

  const items = catalogItems(ctx.model);
  const favItems = items.filter((it) => ctx.favorites.has(it.query));
  const presetItems = items.filter((it) => it.category === "presets");
  const branchItems = items.filter((it) => it.category === "branches");
  const authorItems = items.filter((it) => it.category === "authors");

  /* Top quick category rows (Kilohearts Favorites / All / Presets style) */
  const topNav = el("div", "tree-top");
  const topCats = [
    { id: "favorites", label: "Favorites", icon: "heart-fill", count: favItems.length },
    { id: "all", label: "All Wavetables", icon: "wave", count: items.length },
  ];
  for (const cat of topCats) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "tree-cat";
    if (ctx.browserOpen && ctx.treeCategory === cat.id) row.classList.add("is-active");
    row.appendChild(makeSvgIcon(cat.icon));
    row.appendChild(el("span", "tree-label", cat.label));
    row.appendChild(el("span", "tree-count", String(cat.count)));
    row.addEventListener("click", () => {
      ctx.treeCategory = cat.id;
      ctx.browserOpen = true;
      if (ctx.view && !ctx.view.depth) {
        setView({ ...ctx.view, depth: true });
      } else {
        requestRender();
      }
    });
    topNav.appendChild(row);
  }
  host.appendChild(topNav);

  const sections = [
    { id: "presets", label: "Presets", icon: "folder", list: presetItems },
    { id: "branches", label: "Branches", icon: "folder", list: branchItems },
    { id: "authors", label: "Authors", icon: "folder", list: authorItems },
  ];

  for (const sec of sections) {
    const group = el("div", "tree-group");
    const isCollapsed = collapsed.has(sec.id);

    const head = document.createElement("button");
    head.type = "button";
    head.className = "tree-folder";
    if (ctx.browserOpen && ctx.treeCategory === sec.id) head.classList.add("is-active");
    head.setAttribute("aria-expanded", isCollapsed ? "false" : "true");

    const caret = el("span", "tree-caret", isCollapsed ? "▸" : "▾");
    head.appendChild(caret);
    head.appendChild(makeSvgIcon(sec.icon));
    head.appendChild(el("span", "tree-label", sec.label));
    head.appendChild(el("span", "tree-count", String(sec.list.length)));

    head.addEventListener("click", (event) => {
      if (ctx.browserOpen) {
        ctx.treeCategory = sec.id;
        requestRender();
        return;
      }
      if (event.shiftKey) {
        ctx.treeCategory = sec.id;
        ctx.browserOpen = true;
        requestRender();
        return;
      }
      if (collapsed.has(sec.id)) collapsed.delete(sec.id);
      else collapsed.add(sec.id);
      renderTree();
    });
    head.addEventListener("dblclick", () => {
      ctx.treeCategory = sec.id;
      ctx.browserOpen = true;
      if (ctx.view && !ctx.view.depth) setView({ ...ctx.view, depth: true });
      else requestRender();
    });
    group.appendChild(head);

    if (!isCollapsed) {
      const list = el("div", "tree-list");
      for (const item of sec.list) {
        const active = ctx.view.query === item.query;
        const row = el("div", "tree-row");
        if (active) row.classList.add("is-active");

        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "tree-item";
        btn.title = `${item.name} (${item.query || "all commits"}) — ${item.count} commits`;

        if (sec.id === "branches") {
          const sw = el("span", "tree-dot");
          const col =
            item.kind === "trunk"
              ? ctx.palette.ok
              : ctx.palette.identity[item.colorKey] ?? ctx.palette.ok;
          sw.style.setProperty("--sw", col);
          btn.appendChild(sw);
        } else if (sec.id === "authors") {
          btn.appendChild(makeSvgIcon(item.kind === "agent" ? "agent" : "user"));
        } else {
          btn.appendChild(makeSvgIcon("wave"));
        }

        btn.appendChild(el("span", "tree-item-name", item.name));

        if (item.prTag) {
          const badge = el("span", item.stale ? "tree-pr is-stale" : "tree-pr", item.prTag);
          btn.appendChild(badge);
        }

        btn.appendChild(el("span", "tree-count", String(item.count)));
        btn.addEventListener("click", () => selectCatalogItem(item));
        btn.addEventListener("dblclick", () => selectCatalogItem(item, { openStage: true }));

        const pin = document.createElement("button");
        pin.type = "button";
        pin.className = "tree-pin";
        pin.textContent = "+";
        pin.title = `Pin ${item.name} as a new oscillator`;
        pin.setAttribute("aria-label", `Pin ${item.name} to rack`);
        pin.addEventListener("click", (event) => {
          event.stopPropagation();
          pinCatalogItem(item);
        });

        row.appendChild(btn);
        row.appendChild(pin);
        list.appendChild(row);
      }
      group.appendChild(list);
    }

    host.appendChild(group);
  }
}

/** Redraw animated canvases inside the Kilohearts Floating 3D Browser Grid. */
export function drawBrowserFrames() {
  for (const tile of browserTiles) {
    drawModuleSurface(tile.canvas, tile.item, tile.index, {
      mode: "browser",
      color: tile.color,
    });
  }
}

/** Render the Kilohearts Floating 3D Wavetable Browser Grid. */
export function renderBrowserGrid() {
  const host = document.getElementById("browser");
  if (!host || !ctx.model || !ctx.view || !ctx.palette) return;
  clear(host);
  browserTiles = [];

  const all = catalogItems(ctx.model);
  const cat = ctx.treeCategory;
  const filtered =
    cat === "favorites"
      ? all.filter((it) => ctx.favorites.has(it.query))
      : cat === "all"
        ? all
        : all.filter((it) => it.category === cat);

  const titles = {
    all: "All Wavetables",
    favorites: "Favorites",
    presets: "Presets",
    branches: "Branches",
    authors: "Authors",
  };

  /* Kilohearts-style clean category header */
  const head = el("header", "browser-head");
  const headLeft = el("div", "browser-head-title");
  headLeft.appendChild(makeSvgIcon(cat === "favorites" ? "heart-fill" : "folder"));
  const meta = el("div", "browser-head-text");
  meta.appendChild(el("h2", "", titles[cat] ?? "Wavetables"));
  meta.appendChild(
    el("p", "", `${filtered.length} ${filtered.length === 1 ? "wavetable" : "wavetables"} · click to load · double-click to inspect`)
  );
  headLeft.appendChild(meta);
  head.appendChild(headLeft);

  const pills = el("div", "browser-pills");
  for (const id of ["all", "favorites", "presets", "branches", "authors"]) {
    const p = document.createElement("button");
    p.type = "button";
    p.className = "op browser-pill";
    p.setAttribute("aria-pressed", cat === id ? "true" : "false");
    p.textContent = id;
    p.addEventListener("click", () => {
      ctx.treeCategory = id;
      requestRender();
    });
    pills.appendChild(p);
  }
  head.appendChild(pills);
  host.appendChild(head);

  /* Borderless dark floating 3D wavetable gallery */
  const grid = el("div", "browser-grid");
  host.appendChild(grid);

  filtered.forEach((item, index) => {
    const active = ctx.view.query === item.query;
    const isFav = ctx.favorites.has(item.query);
    const tile = el("article", "wt-tile");
    if (active) tile.classList.add("is-active");

    const canvas = document.createElement("canvas");
    canvas.className = "wt-thumb";
    canvas.setAttribute("aria-hidden", "true");

    const hit = document.createElement("button");
    hit.type = "button";
    hit.className = "wt-hit";
    hit.setAttribute("aria-label", `Load ${item.name} (${item.count} commits)`);
    hit.appendChild(canvas);
    hit.addEventListener("click", () => selectCatalogItem(item, { leaveBrowser: true }));
    hit.addEventListener("dblclick", () => selectCatalogItem(item, { openStage: true }));
    hit.addEventListener("pointerenter", () => {
      ctx.browserHoverQuery = item.query;
    });
    hit.addEventListener("pointerleave", () => {
      if (ctx.browserHoverQuery === item.query) ctx.browserHoverQuery = null;
    });

    const caption = el("div", "wt-caption");
    const favBtn = document.createElement("button");
    favBtn.type = "button";
    favBtn.className = isFav ? "wt-heart is-fav" : "wt-heart";
    favBtn.setAttribute("aria-pressed", isFav ? "true" : "false");
    favBtn.setAttribute("aria-label", isFav ? `Unfavorite ${item.name}` : `Favorite ${item.name}`);
    favBtn.appendChild(makeSvgIcon(isFav ? "heart-fill" : "heart"));
    favBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleFavorite(item.query);
    });

    const info = el("div", "wt-info");
    info.appendChild(el("span", "wt-name", item.name));
    info.appendChild(el("span", "wt-sub", `${item.subtitle} · ${item.count}`));

    caption.appendChild(favBtn);
    caption.appendChild(info);

    tile.appendChild(hit);
    tile.appendChild(caption);
    grid.appendChild(tile);

    /* Use cool cohesive theme hue in Kilohearts browser, or per-branch identity in signal */
    const color =
      ctx.view.theme === "kilohearts"
        ? ctx.palette.ok
        : ctx.palette.identity[item.colorKey] ?? ctx.palette.ok;

    browserTiles.push({ canvas, item, index, color });
  });

  if (!filtered.length) {
    grid.appendChild(el("p", "browser-empty", "No favorites yet — click a heart to pin a wavetable here."));
  } else {
    drawBrowserFrames();
  }
}
