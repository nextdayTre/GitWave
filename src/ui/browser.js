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
import { isDesktopRuntime } from "../desktop.ts";
import { repoContentGroups, searchCommits } from "../core/search.ts";
import { expandModule, focusFirstMatch, pinModule } from "../core/view.ts";
import { drawModuleSurface, startDepthScan } from "../render/depth.js";
import { openFileView, openWorkingTreeDiff } from "./diff.js";
import { announce } from "./status.ts";
import { clear, el } from "./dom.js";

let browserTiles = [];
let lastBrowserSig = "";
let lastTreeSig = "";
let lastHoverQuery = null;
const collapsed = new Set();

/** Build the complete catalog of selectable wavetable filters for the loaded repo. */
export function catalogItems(model) {
  if (!model) return [];
  const items = [];

  /* 1. Presets (hide 0-commit demo presets on real solo repos so dead tiles don't crowd the grid) */
  const presets = [
    { name: "All Commits", query: "", subtitle: "repository", colorKey: 0, category: "presets", kind: "repo", always: true },
    { name: "Merge History", query: "merged", subtitle: "integration", colorKey: 0, category: "presets", kind: "merge", always: false },
    { name: "Agent Activity", query: "agent", subtitle: "automated", colorKey: 3, category: "presets", kind: "agent", always: false },
    { name: "Merge Commits", query: "merge", subtitle: "merges", colorKey: 1, category: "presets", kind: "merge", always: false },
  ];
  for (const p of presets) {
    const count = p.query ? searchCommits(model, p.query).count : model.doc.commits.length;
    if (p.always || count > 0) {
      items.push({ ...p, count });
    }
  }

  /* 2. Repository Contents (actual folders & files derived from commit paths + live disk tree) */
  const contentGroups = repoContentGroups(model, 16);
  const liveTree = ctx.liveSync?.tree;
  const folderByName = new Map((liveTree?.folders ?? []).map((f) => [f.name, f]));
  const rootByName = new Map((liveTree?.rootFiles ?? []).map((f) => [f.name, f]));
  const seenContent = new Set();

  contentGroups.forEach((grp, idx) => {
    seenContent.add(grp.name);
    const liveFolder = folderByName.get(grp.name);
    const liveFile = rootByName.get(grp.name);
    const fileLabel = liveFolder
      ? `${liveFolder.fileCount} ${liveFolder.fileCount === 1 ? "file" : "files"}`
      : grp.kind === "folder"
        ? "folder"
        : "file";
    items.push({
      name: grp.name,
      query: grp.query,
      subtitle: fileLabel,
      colorKey: (idx + 1) % 6,
      category: "contents",
      kind: grp.kind,
      dirty: Boolean(liveFolder?.dirtyCount || liveFile?.dirty),
      count: grp.commits,
    });
  });

  if (liveTree) {
    let extraIdx = contentGroups.length;
    for (const folder of liveTree.folders) {
      if (seenContent.has(folder.name) || extraIdx >= 18) continue;
      seenContent.add(folder.name);
      const query = `path:${folder.path}`;
      const count = searchCommits(model, query).count;
      items.push({
        name: folder.name,
        query,
        subtitle: `${folder.fileCount} ${folder.fileCount === 1 ? "file" : "files"}`,
        colorKey: (extraIdx + 1) % 6,
        category: "contents",
        kind: "folder",
        dirty: folder.dirtyCount > 0,
        count,
      });
      extraIdx += 1;
    }
    if (liveTree.folders.length < 3) {
      for (const rf of liveTree.rootFiles) {
        if (seenContent.has(rf.name) || extraIdx >= 18) continue;
        seenContent.add(rf.name);
        const query = `path:${rf.path}`;
        const count = searchCommits(model, query).count;
        items.push({
          name: rf.name,
          query,
          subtitle: "file",
          colorKey: (extraIdx + 1) % 6,
          category: "contents",
          kind: "file",
          dirty: rf.dirty,
          count,
        });
        extraIdx += 1;
      }
    }
  }

  /* 3. Branches / Refs */
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

/**
 * Navigate to a catalog item WITHOUT silently overwriting Rack oscillators:
 * - Clicking a file or folder in `Contents` opens the read-only File/Folder
 *   Preview & History pane (leaving Rack bays 100% untouched).
 * - Clicking a branch, author, or preset focuses its query cleanly (soloing an
 *   existing Rack bay if already present, or filtering Stage/Strip/2D).
 * - Rack oscillators only change via their own `‹ ›` buttons or explicit `+` pin.
 */
export function selectCatalogItem(item, opts = {}) {
  if (!ctx.view || !ctx.model) return;
  const openStage = opts.openStage === true;
  const leaveBrowser = opts.leaveBrowser === true;

  if (item.category === "contents" && !openStage) {
    openFileView(item.name);
    return;
  }

  ctx.diffOpen = false;
  ctx.diffTarget = "commit";

  const focused = focusFirstMatch(ctx.model, { ...ctx.view, query: item.query }, item.query);
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

function treeSignature() {
  return JSON.stringify([
    ctx.doc?.repo.id ?? "",
    ctx.doc?.repo.snapshotAt ?? "",
    ctx.view?.query ?? "",
    ctx.view?.theme ?? "",
    ctx.browserOpen,
    ctx.diffOpen,
    ctx.diffTarget,
    ctx.diffFile ?? "",
    ctx.treeCategory,
    ctx.favorites.size,
    [...collapsed].sort(),
    ctx.liveSync?.repoPath ?? "",
    ctx.liveSync?.syncState ?? "",
    ctx.liveSync?.tree?.totalFiles ?? -1,
    ctx.loadingRepo ?? "",
    ctx.liveSync?.workingTree?.dirtyCount ?? -1,
    (ctx.liveSync?.workingTree?.files ?? []).slice(0, 6).map((f) => `${f.code}:${f.path}`),
    (ctx.liveSync?.branches ?? []).map((b) => `${b.name}:${b.ahead}:${b.behind}:${b.localOnly}`),
    (ctx.liveRepos ?? []).map((r) => `${r.repoPath}:${r.syncState}:${r.summary?.dirtyCount ?? 0}`),
  ]);
}

/** Render the Kilohearts-style collapsible Git Tree sidebar. */
export function renderTree(force = false) {
  const host = document.getElementById("gitTreeBody");
  if (!host || !ctx.model || !ctx.view || !ctx.palette) return;
  const sig = treeSignature();
  if (!force && sig === lastTreeSig && host.childElementCount > 0) return;
  lastTreeSig = sig;
  clear(host);

  /* Live Companion: Local Burn Tray ("Uncommitted on Disk") + Cartridge Shelf */
  if (ctx.liveSync) {
    const wt = ctx.liveSync.workingTree;
    const burn = el("div", wt.clean ? "tree-burn is-clean" : wt.conflicted > 0 ? "tree-burn is-risk" : "tree-burn is-dirty");
    const burnHead = document.createElement("button");
    burnHead.type = "button";
    burnHead.className = "tree-burn-head";
    burnHead.title = "Inspect live uncommitted working-tree files in Diff view";
    const burnLeft = el("span", "tree-burn-title");
    burnLeft.appendChild(el("span", "tree-burn-dot"));
    burnLeft.appendChild(el("span", "", "BURN TRAY"));
    burnHead.appendChild(burnLeft);
    burnHead.appendChild(
      el(
        "span",
        "tree-burn-badge",
        wt.clean ? "clean" : `${wt.dirtyCount} dirty`
      )
    );
    burnHead.addEventListener("click", () => openWorkingTreeDiff());
    burn.appendChild(burnHead);

    const summaryLine = wt.clean
      ? `Synced with HEAD (${ctx.liveSync.headRef})`
      : `${wt.staged} staged · ${wt.modified} mod · ${wt.untracked} new`;
    burn.appendChild(el("div", "tree-burn-sub", summaryLine));

    if (!wt.clean && wt.files.length) {
      const fWrap = el("div", "tree-burn-files");
      for (const f of wt.files.slice(0, 5)) {
        const fBtn = document.createElement("button");
        fBtn.type = "button";
        fBtn.className = "tree-burn-file";
        fBtn.title = `${f.state}: ${f.path}`;
        fBtn.appendChild(el("span", "tree-burn-code", f.code));
        fBtn.appendChild(el("span", "tree-burn-path", f.path));
        fBtn.addEventListener("click", () => openWorkingTreeDiff(f.path));
        fWrap.appendChild(fBtn);
      }
      if (wt.files.length > 5) {
        const moreBtn = document.createElement("button");
        moreBtn.type = "button";
        moreBtn.className = "tree-burn-more";
        moreBtn.textContent = `inspect all ${wt.files.length} uncommitted files →`;
        moreBtn.addEventListener("click", () => openWorkingTreeDiff());
        fWrap.appendChild(moreBtn);
      }
      burn.appendChild(fWrap);
    }
    host.appendChild(burn);
  }

  if (ctx.liveRepos && ctx.liveRepos.length > 0) {
    const repoGroup = el("div", "tree-group tree-repos");
    const isCollapsed = collapsed.has("repos");
    const rHead = document.createElement("button");
    rHead.type = "button";
    rHead.className = "tree-folder";
    rHead.setAttribute("aria-expanded", isCollapsed ? "false" : "true");
    rHead.appendChild(el("span", "tree-caret", isCollapsed ? "▸" : "▾"));
    rHead.appendChild(makeSvgIcon("folder"));
    rHead.appendChild(el("span", "tree-label", "Repositories"));
    rHead.appendChild(el("span", "tree-count", String(ctx.liveRepos.length)));
    rHead.addEventListener("click", () => {
      if (collapsed.has("repos")) collapsed.delete("repos");
      else collapsed.add("repos");
      renderTree(true);
    });
    if (isDesktopRuntime()) {
      const headRow = el("div", "tree-folder-bar");
      headRow.appendChild(rHead);
      const mountBtn = document.createElement("button");
      mountBtn.type = "button";
      mountBtn.className = "tree-pin";
      mountBtn.textContent = "⊕";
      mountBtn.title = "Mount another local projects folder";
      mountBtn.setAttribute("aria-label", "Mount another local projects folder");
      mountBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        ctx.onLiveAction?.({ method: "pickFolder" });
      });
      headRow.appendChild(mountBtn);
      repoGroup.appendChild(headRow);
    } else {
      repoGroup.appendChild(rHead);
    }

    if (!isCollapsed) {
      const rList = el("div", "tree-list");
      for (const repo of ctx.liveRepos) {
        const isCurrent = ctx.liveSync && repo.repoPath === ctx.liveSync.repoPath;
        const isLoading = ctx.loadingRepo === repo.repoPath;
        const row = el("div", isCurrent ? "tree-row is-active" : isLoading ? "tree-row is-loading" : "tree-row");
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "tree-item";
        btn.title = repo.unborn
          ? `${repo.repoName} (no commits yet)\n${repo.repoPath}`
          : `${repo.repoName} (${repo.headRef}) — ${repo.syncState}\n${repo.repoPath}`;

        const led = el(
          "span",
          repo.unborn
            ? "tree-repo-led is-muted"
            : repo.syncState === "conflict"
              ? "tree-repo-led is-risk"
              : repo.syncState === "synced"
                ? "tree-repo-led is-ok"
                : "tree-repo-led is-warn"
        );
        btn.appendChild(led);
        btn.appendChild(el("span", "tree-item-name", repo.repoName));
        const tagText = isLoading
          ? "…"
          : repo.unborn
            ? "empty"
            : repo.summary?.dirtyCount > 0
              ? `${repo.summary.dirtyCount}d`
              : repo.summary?.totalAhead > 0
                ? `↑${repo.summary.totalAhead}`
                : repo.summary?.totalBehind > 0
                  ? `↓${repo.summary.totalBehind}`
                  : repo.syncState === "synced"
                    ? "ok"
                    : repo.syncState;
        btn.appendChild(
          el(
            "span",
            repo.unborn
              ? "tree-sync-pill"
              : repo.syncState === "synced"
                ? "tree-sync-pill is-ok"
                : "tree-sync-pill is-warn",
            tagText
          )
        );
        btn.addEventListener("click", () => {
          if (repo.unborn) {
            announce(`${repo.repoName} has no commits yet`);
            return;
          }
          if (isCurrent) {
            if (ctx.diffOpen) {
              ctx.diffOpen = false;
              ctx.diffTarget = "commit";
              requestRender();
            }
            announce(`viewing ${repo.repoName}`);
            return;
          }
          ctx.loadingRepo = repo.repoPath;
          announce(`loading ${repo.repoName}…`);
          renderTree(true);
          ctx.onLiveAction?.({ method: "loadRepo", params: { path: repo.repoPath } });
        });
        row.appendChild(btn);
        rList.appendChild(row);
      }
      repoGroup.appendChild(rList);
    }
    host.appendChild(repoGroup);
  }

  const branchSyncByName = new Map(
    (ctx.liveSync?.branches ?? []).map((b) => [b.name, b])
  );

  const items = catalogItems(ctx.model);
  const favItems = items.filter((it) => ctx.favorites.has(it.query));
  const contentItems = items.filter((it) => it.category === "contents");
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
      ctx.diffOpen = false;
      ctx.diffTarget = "commit";
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
    ...(contentItems.length
      ? [{ id: "contents", label: "Contents", icon: "folder", list: contentItems }]
      : []),
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
      renderTree(true);
    });
    head.addEventListener("dblclick", () => {
      ctx.diffOpen = false;
      ctx.diffTarget = "commit";
      ctx.treeCategory = sec.id;
      ctx.browserOpen = true;
      if (ctx.view && !ctx.view.depth) setView({ ...ctx.view, depth: true });
      else requestRender();
    });
    group.appendChild(head);

    if (!isCollapsed) {
      const list = el("div", "tree-list");
      for (const item of sec.list) {
        const active =
          sec.id === "contents"
            ? ctx.diffOpen && ctx.diffTarget === "file" && ctx.diffFile === item.name
            : ctx.view.query === item.query;
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
        } else if (sec.id === "contents") {
          btn.appendChild(makeSvgIcon(item.kind === "folder" ? "folder" : "wave"));
        } else if (sec.id === "authors") {
          btn.appendChild(makeSvgIcon(item.kind === "agent" ? "agent" : "user"));
        } else {
          btn.appendChild(makeSvgIcon("wave"));
        }

        btn.appendChild(el("span", "tree-item-name", item.name));

        if (sec.id === "contents" && item.dirty) {
          btn.appendChild(el("span", "tree-sync-pill is-warn", "mod"));
        }

        if (item.prTag) {
          const badge = el("span", item.stale ? "tree-pr is-stale" : "tree-pr", item.prTag);
          btn.appendChild(badge);
        }

        if (sec.id === "branches") {
          const bSync = branchSyncByName.get(item.name);
          if (bSync) {
            const deltaText = bSync.localOnly
              ? "local"
              : bSync.ahead || bSync.behind
                ? `${bSync.ahead ? `↑${bSync.ahead}` : ""}${bSync.behind ? `↓${bSync.behind}` : ""}`
                : "";
            if (deltaText) {
              btn.appendChild(el("span", "tree-sync-pill is-warn", deltaText));
            }
          }
        }

        btn.appendChild(el("span", "tree-count", String(item.count)));
        btn.addEventListener("click", () => selectCatalogItem(item, { leaveBrowser: true }));
        if (sec.id !== "contents") {
          btn.addEventListener("dblclick", () => selectCatalogItem(item, { openStage: true }));
        }

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

/** Redraw canvases inside the Kilohearts Floating 3D Browser Grid.
 *  When `all === false` (ambient loop), only redraw the hovered tile + any tile
 *  just unhovered so the grid stays silky-smooth with zero frame drops. */
export function drawBrowserFrames(all = false) {
  const hover = ctx.browserHoverQuery;
  const prevHover = lastHoverQuery;
  lastHoverQuery = hover;

  for (const tile of browserTiles) {
    if (!all && tile.item.query !== hover && tile.item.query !== prevHover) {
      continue;
    }
    drawModuleSurface(tile.canvas, tile.item, tile.index, {
      mode: "browser",
      color: tile.color,
    });
  }
}

function browserSignature(host) {
  return JSON.stringify([
    ctx.doc?.repo.id ?? "",
    ctx.doc?.repo.snapshotAt ?? "",
    ctx.doc?.commits.length ?? 0,
    ctx.liveSync?.repoPath ?? "",
    ctx.liveSync?.tree?.totalFiles ?? -1,
    ctx.liveSync?.syncState ?? "",
    ctx.view?.theme ?? "",
    ctx.view?.span ?? "",
    ctx.treeCategory,
    Math.round((host?.clientWidth || 0) / 16),
    [...ctx.favorites].sort(),
  ]);
}

/** Render the Kilohearts Floating 3D Wavetable Browser Grid. */
export function renderBrowserGrid() {
  const host = document.getElementById("browser");
  if (!host || !ctx.model || !ctx.view || !ctx.palette) return;

  const sig = browserSignature(host);
  if (sig === lastBrowserSig && browserTiles.length > 0 && host.childElementCount > 0) {
    for (const tile of browserTiles) {
      tile.el?.classList.toggle("is-active", ctx.view.query === tile.item.query);
    }
    return;
  }
  lastBrowserSig = sig;
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
    all: `${ctx.doc?.repo.name ?? "Repository"} — All Wavetables`,
    contents: `${ctx.doc?.repo.name ?? "Repository"} — Contents & Files`,
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
  const liveTree = ctx.liveSync?.tree;
  const repoBits = liveTree
    ? `${ctx.liveSync.headRef} · ${ctx.doc?.commits.length ?? 0} commits · ${liveTree.totalFiles} files on disk · ${ctx.liveSync.syncState}`
    : `${filtered.length} ${filtered.length === 1 ? "wavetable" : "wavetables"} · click to load · double-click to inspect`;
  meta.appendChild(el("p", "", repoBits));
  headLeft.appendChild(meta);
  head.appendChild(headLeft);

  const hasContents = all.some((it) => it.category === "contents");
  const pillIds = hasContents
    ? ["all", "contents", "favorites", "presets", "branches", "authors"]
    : ["all", "favorites", "presets", "branches", "authors"];

  const pills = el("div", "browser-pills");
  for (const id of pillIds) {
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
      drawBrowserFrames(false);
    });
    hit.addEventListener("pointerleave", () => {
      if (ctx.browserHoverQuery === item.query) {
        ctx.browserHoverQuery = null;
        drawBrowserFrames(false);
      }
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

    browserTiles.push({ el: tile, canvas, item, index, color });
  });

  if (!filtered.length) {
    grid.appendChild(el("p", "browser-empty", "No favorites yet — click a heart to pin a wavetable here."));
  } else {
    drawBrowserFrames(true);
  }
}
