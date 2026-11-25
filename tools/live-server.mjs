#!/usr/bin/env node
/**
 * live-server.mjs — zero-dependency local live companion server for GitWave.
 *
 * Keeps `gitwave.html` on disk 100% single-file, offline and zero-network by
 * injecting `/live-bridge.js` ONLY at localhost serve time.
 *
 * Performance & stability guarantees:
 *   - Latest-click-wins request sequencing (`loadSeq`) prevents stale repo hops
 *   - Per-repo snapshot cache keyed by filesystem fingerprint (< 5ms repeat switch)
 *   - Batched commit patches (1 git spawn for recent 24 commits, not 250 spawns)
 *   - Async cached multi-repo discovery (never freezes HTTP responses)
 *   - Self-suppression cooldown + fingerprint check on `.git` watcher (zero loops)
 *
 * Strictly read-only on Git repositories. Binds exclusively to 127.0.0.1.
 */

import { createServer } from "node:http";
import { existsSync, readFileSync, watch } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  discoverLocalReposAsync,
  exportRepoSnapshotAsync,
  getLocalSyncStatus,
  getRepoFingerprint,
  readRepoFileSafe,
} from "./lib/git-snapshot.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const ARTIFACT = resolve(ROOT, "gitwave.html");

const args = process.argv.slice(2);
let port = Number(process.env.GITWAVE_PORT) || 4173;
let activeRepoPath = resolve(process.env.GITWAVE_REPO || ".");
const scanRoots = [];
let includePatches = true;
let includeGhPrs = false;

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--port" && args[i + 1]) port = Number(args[++i]) || 4173;
  else if (a === "--repo" && args[i + 1]) activeRepoPath = resolve(args[++i]);
  else if (a === "--root" && args[i + 1]) scanRoots.push(resolve(args[++i]));
  else if (a === "--no-patches") includePatches = false;
  else if (a === "--patches") includePatches = true;
  else if (a === "--gh") includeGhPrs = true;
}

if (process.env.GITWAVE_ROOTS) {
  for (const part of process.env.GITWAVE_ROOTS.split(";").filter(Boolean)) {
    scanRoots.push(resolve(part));
  }
}
if (!scanRoots.length) {
  scanRoots.push(activeRepoPath);
}

/** @type {Set<import("node:http").ServerResponse>} */
const sseClients = new Set();

let currentSnapshot = null;
let currentSync = null;
let currentFingerprint = "";
let cachedRepos = [];
let lastRepoScanAt = 0;
let repoScanPromise = null;
let loadSeq = 0;
let ignoreWatchUntil = 0;

/** LRU snapshot cache keyed by resolved repoPath -> { fingerprint, doc, sync } */
const snapshotCache = new Map();
const MAX_REPO_CACHE = 12;

let lastAgentState = {
  id: "antigravity",
  name: "Antigravity",
  role: "live-agent",
  colorToken: "agent",
  customColor: null,
  formula: "lissajous",
  activity: "idle",
  task: "Connected to local live companion",
  visible: true,
  liveConnected: true,
};

function updateCachedRepoEntry(sync) {
  if (!sync) return;
  const idx = cachedRepos.findIndex((r) => r.repoPath === sync.repoPath);
  const entry = {
    repoPath: sync.repoPath,
    repoName: sync.repoName,
    headRef: sync.headRef,
    syncState: sync.syncState,
    summary: sync.summary,
  };
  if (idx >= 0) cachedRepos[idx] = entry;
  else {
    cachedRepos = [...cachedRepos, entry].sort((a, b) => a.repoName.localeCompare(b.repoName));
  }
}

async function getReposCached(force = false) {
  const now = Date.now();
  if (!force && cachedRepos.length && now - lastRepoScanAt < 20000) {
    return cachedRepos;
  }
  if (!repoScanPromise) {
    repoScanPromise = discoverLocalReposAsync(scanRoots)
      .then((list) => {
        cachedRepos = list;
        lastRepoScanAt = Date.now();
        return list;
      })
      .finally(() => {
        repoScanPromise = null;
      });
  }
  return repoScanPromise;
}

async function loadActiveRepoAsync(targetPath = activeRepoPath, opts = {}) {
  const resolved = resolve(targetPath);
  const force = Boolean(opts.force);
  const fp = getRepoFingerprint(resolved);
  const cached = snapshotCache.get(resolved);

  ignoreWatchUntil = Date.now() + 2000;

  if (!force && cached && fp && cached.fingerprint === fp) {
    activeRepoPath = cached.sync.repoPath;
    currentSnapshot = cached.doc;
    currentSync = cached.sync;
    currentFingerprint = fp;
    if (cached.doc) lastAgentState = { ...lastAgentState, repo: cached.doc.repo.name };
    updateCachedRepoEntry(cached.sync);
    return { unborn: Boolean(cached.unborn), doc: cached.doc, sync: cached.sync, fromCache: true };
  }

  const { unborn, doc, sync } = await exportRepoSnapshotAsync(resolved, {
    includePatches,
    patchLimit: 16,
    includeGhPrs,
    includeWorkingDiffs: true,
    limit: 200,
  });

  const nextFp = getRepoFingerprint(sync.repoPath);
  if (snapshotCache.size >= MAX_REPO_CACHE) {
    const oldest = snapshotCache.keys().next().value;
    snapshotCache.delete(oldest);
  }
  snapshotCache.set(sync.repoPath, { fingerprint: nextFp, unborn, doc, sync });

  if (!unborn && doc) {
    activeRepoPath = sync.repoPath;
    currentSnapshot = doc;
    currentSync = sync;
    currentFingerprint = nextFp;
    lastAgentState = { ...lastAgentState, repo: doc.repo.name };
  }
  updateCachedRepoEntry(sync);
  ignoreWatchUntil = Date.now() + 2000;
  return { unborn, doc, sync, fromCache: false };
}

function broadcast(event, payload) {
  const frame = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(frame);
    } catch {
      sseClients.delete(res);
    }
  }
}

/* Watch active repo HEAD + branch tips ONLY (never triggers self-loops on git status) */
let watchers = [];
let watchTimer = null;

function watchActiveRepo() {
  for (const w of watchers) {
    try {
      w.close();
    } catch {
      /* ignore */
    }
  }
  watchers = [];

  const gitDir = join(activeRepoPath, ".git");
  const headsDir = join(gitDir, "refs", "heads");
  const headFile = join(gitDir, "HEAD");
  const targets = [headsDir, headFile].filter((p) => existsSync(p));

  for (const target of targets) {
    try {
      const w = watch(target, () => {
        if (Date.now() < ignoreWatchUntil) return;
        clearTimeout(watchTimer);
        watchTimer = setTimeout(async () => {
          if (Date.now() < ignoreWatchUntil) return;
          const nextFp = getRepoFingerprint(activeRepoPath);
          if (nextFp && nextFp === currentFingerprint) return;
          try {
            const { unborn, doc, sync } = await loadActiveRepoAsync(activeRepoPath, { force: true });
            if (!unborn && doc) {
              broadcast("snapshot", {
                doc,
                sync,
                repos: cachedRepos,
                reason: "fs-watch",
                preserveMode: true,
              });
            }
          } catch {
            /* transient git lock while committing */
          }
        }, 700);
      });
      watchers.push(w);
    } catch {
      /* ignore watch errors on restricted dirs */
    }
  }
}

void (async () => {
  try {
    await loadActiveRepoAsync(activeRepoPath);
    watchActiveRepo();
    const repos = await getReposCached(true);
    broadcast("sync", { sync: currentSync, repos });
  } catch (error) {
    console.error(`! initial repo load skipped (${error instanceof Error ? error.message : String(error)})`);
  }
})();

function jsonResponse(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolveBody, rejectBody) => {
    const chunks = [];
    let total = 0;
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > 2 * 1024 * 1024) {
        rejectBody(new Error("payload too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        const text = Buffer.concat(chunks).toString("utf8").trim();
        resolveBody(text ? JSON.parse(text) : {});
      } catch (err) {
        rejectBody(err);
      }
    });
    req.on("error", rejectBody);
  });
}

const LIVE_BRIDGE_JS = `/* GitWave Local Live Companion Bridge (injected only on 127.0.0.1) */
(function () {
  if (window.__gitwaveLiveAttached) return;
  window.__gitwaveLiveAttached = true;

  var style = document.createElement("style");
  style.textContent = [
    ".gw-live-wrap{position:relative;display:inline-flex;align-items:center;gap:6px;}",
    ".gw-live-pill{display:inline-flex;align-items:center;gap:6px;padding:3px 8px;border-radius:5px;",
    "  border:1px solid var(--line-hi);background:var(--panel-hi);color:var(--text);",
    "  font-family:var(--mono);font-size:10px;cursor:pointer;white-space:nowrap;}",
    ".gw-live-pill:hover{border-color:var(--ok);background:var(--panel-hover);}",
    ".gw-live-dot{width:7px;height:7px;border-radius:50%;background:var(--ok);box-shadow:0 0 8px var(--ok);}",
    ".gw-live-dot.is-warn{background:var(--open);box-shadow:0 0 8px var(--open);}",
    ".gw-live-dot.is-risk{background:var(--risk);box-shadow:0 0 8px var(--risk);}",
    ".gw-live-pop{position:fixed;top:52px;right:16px;width:360px;max-width:calc(100vw - 24px);",
    "  max-height:calc(100vh - 76px);overflow-y:auto;z-index:70;padding:12px;",
    "  background:var(--panel);border:1px solid var(--line-hi);border-radius:10px;",
    "  box-shadow:0 18px 50px rgba(0,0,0,0.78);font-family:var(--mono);font-size:10.5px;color:var(--text);}",
    ".gw-live-pop h3{font-size:10px;letter-spacing:0.08em;text-transform:uppercase;color:var(--dim);margin:10px 0 6px;}",
    ".gw-live-pop h3:first-child{margin-top:0;}",
    ".gw-live-row{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:5px 7px;",
    "  border:1px solid var(--line-soft);border-radius:5px;background:var(--bg);margin-bottom:4px;}",
    ".gw-live-btn{appearance:none;width:100%;text-align:left;color:var(--text);cursor:pointer;}",
    ".gw-live-btn:hover{border-color:var(--ok);background:var(--panel-hi);}",
    ".gw-live-btn.is-active{border-color:var(--ok);}",
    ".gw-live-tag{font-size:9px;padding:1px 5px;border-radius:3px;background:var(--panel-hi);color:var(--dim);}",
    ".gw-live-tag.is-ok{color:var(--ok);}",
    ".gw-live-tag.is-open{color:var(--open);}",
    ".gw-live-tag.is-risk{color:var(--risk);}",
    ".gw-live-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px;}",
  ].join("\\n");
  document.head.appendChild(style);

  var currentSync = null;
  var repoList = [];
  var popOpen = false;
  var pillBtn = null;
  var popEl = null;
  var lastDocKey = "";
  var pendingRepoAbort = null;

  function syncBadgeText(sync) {
    if (!sync) return "LIVE";
    var parts = [sync.repoName];
    if (sync.workingTree && sync.workingTree.dirtyCount > 0) {
      parts.push(sync.workingTree.dirtyCount + " dirty");
    }
    if (sync.summary && sync.summary.totalAhead > 0) parts.push("↑" + sync.summary.totalAhead);
    if (sync.summary && sync.summary.totalBehind > 0) parts.push("↓" + sync.summary.totalBehind);
    if (parts.length === 1) parts.push("synced");
    return parts.join(" · ");
  }

  function dotTone(sync) {
    if (!sync) return "";
    if (sync.syncState === "conflict") return "is-risk";
    if (sync.syncState !== "synced") return "is-warn";
    return "";
  }

  function sendAction(action) {
    if (action && action.method === "readFile") {
      var relPath = action.params && action.params.path ? String(action.params.path) : "";
      return fetch("/api/file?path=" + encodeURIComponent(relPath))
        .then(function (r) { return r.json(); })
        .then(function (data) {
          if (window.gitwave && window.gitwave.setFilePreview) {
            if (data && data.ok && data.file) {
              window.gitwave.setFilePreview(data.file);
            } else {
              window.gitwave.setFilePreview({
                path: relPath,
                error: (data && data.error) || "could not read file",
              });
            }
          }
        })
        .catch(function () {
          if (window.gitwave && window.gitwave.setFilePreview) {
            window.gitwave.setFilePreview({ path: relPath, error: "live companion unavailable" });
          }
        });
    }
    if (action && action.method === "loadRepo") {
      if (pendingRepoAbort) {
        try { pendingRepoAbort.abort(); } catch (e) {}
      }
      pendingRepoAbort = new AbortController();
      return fetch("/api/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action),
        signal: pendingRepoAbort.signal,
      }).catch(function () {});
    }
    return fetch("/api/command", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(action),
    }).catch(function () {});
  }

  function renderHud() {
    if (!pillBtn) return;
    pillBtn.textContent = "";
    var dot = document.createElement("span");
    dot.className = "gw-live-dot " + dotTone(currentSync);
    pillBtn.appendChild(dot);
    pillBtn.appendChild(document.createTextNode(syncBadgeText(currentSync)));

    if (!popEl) return;
    popEl.hidden = !popOpen;
    if (!popOpen) return;
    popEl.textContent = "";

    var head = document.createElement("div");
    head.className = "gw-live-head";
    var title = document.createElement("strong");
    title.textContent = "LOCAL ↔ GITHUB SYNC RADAR";
    head.appendChild(title);
    var actions = document.createElement("div");
    actions.style.display = "flex";
    actions.style.gap = "5px";

    var refBtn = document.createElement("button");
    refBtn.type = "button";
    refBtn.className = "op op-xs";
    refBtn.textContent = "refresh";
    refBtn.onclick = function () { sendAction({ method: "refresh" }); };
    actions.appendChild(refBtn);

    var closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "op op-xs";
    closeBtn.textContent = "×";
    closeBtn.onclick = function () { popOpen = false; renderHud(); };
    actions.appendChild(closeBtn);
    head.appendChild(actions);
    popEl.appendChild(head);

    if (currentSync) {
      var wtH = document.createElement("h3");
      wtH.textContent = "Working Tree (" + (currentSync.workingTree.clean ? "clean" : currentSync.workingTree.dirtyCount + " uncommitted") + ")";
      popEl.appendChild(wtH);

      if (currentSync.workingTree.clean) {
        var cleanRow = document.createElement("div");
        cleanRow.className = "gw-live-row";
        cleanRow.textContent = "All local files committed — burn tray empty";
        popEl.appendChild(cleanRow);
      } else {
        currentSync.workingTree.files.slice(0, 12).forEach(function (f) {
          var row = document.createElement("button");
          row.type = "button";
          row.className = "gw-live-row gw-live-btn";
          var p = document.createElement("span");
          p.textContent = f.path;
          p.style.overflow = "hidden";
          p.style.textOverflow = "ellipsis";
          var t = document.createElement("span");
          t.className = "gw-live-tag " + (f.state === "conflicted" ? "is-risk" : "is-open");
          t.textContent = f.state;
          row.appendChild(p);
          row.appendChild(t);
          row.onclick = function () {
            popOpen = false;
            renderHud();
            if (window.gitwave && window.gitwave.openWorkingTreeDiff) {
              window.gitwave.openWorkingTreeDiff(f.path);
            }
          };
          popEl.appendChild(row);
        });
      }

      var brH = document.createElement("h3");
      brH.textContent = "Branches vs GitHub (origin)";
      popEl.appendChild(brH);
      currentSync.branches.forEach(function (b) {
        var row = document.createElement("div");
        row.className = "gw-live-row";
        var name = document.createElement("span");
        name.textContent = (b.current ? "● " : "") + b.name;
        var st = document.createElement("span");
        var label = b.localOnly ? "local-only" : (b.ahead || b.behind ? "↑" + b.ahead + " ↓" + b.behind : "synced");
        st.className = "gw-live-tag " + (label === "synced" ? "is-ok" : "is-open");
        st.textContent = label;
        row.appendChild(name);
        row.appendChild(st);
        popEl.appendChild(row);
      });
    }

    if (repoList.length) {
      var rH = document.createElement("h3");
      rH.textContent = "Local Repositories (" + repoList.length + ")";
      popEl.appendChild(rH);
      repoList.forEach(function (r) {
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "gw-live-row gw-live-btn" + (currentSync && r.repoPath === currentSync.repoPath ? " is-active" : "");
        var nm = document.createElement("span");
        nm.textContent = r.repoName + " (" + r.headRef + ")";
        var st = document.createElement("span");
        st.className = "gw-live-tag " + (r.syncState === "synced" ? "is-ok" : "is-open");
        st.textContent = r.syncState;
        btn.appendChild(nm);
        btn.appendChild(st);
        btn.onclick = function () {
          popOpen = false;
          renderHud();
          sendAction({ method: "loadRepo", params: { path: r.repoPath } });
        };
        popEl.appendChild(btn);
      });
    }
  }

  function mountHud() {
    var actions = document.querySelector(".header-actions");
    if (!actions || pillBtn) return;
    var wrap = document.createElement("div");
    wrap.className = "gw-live-wrap";
    pillBtn = document.createElement("button");
    pillBtn.type = "button";
    pillBtn.className = "gw-live-pill";
    pillBtn.title = "Local ↔ GitHub Sync Radar & Multi-Repo Switcher";
    pillBtn.onclick = function () {
      popOpen = !popOpen;
      if (popOpen) {
        fetch("/api/repos").then(function (r) { return r.json(); }).then(function (d) {
          if (d && d.ok && Array.isArray(d.repos)) {
            applyAtomic({ repos: d.repos }, false);
          }
        }).catch(function () {});
      }
      renderHud();
    };
    wrap.appendChild(pillBtn);
    actions.insertBefore(wrap, actions.firstChild);

    popEl = document.createElement("aside");
    popEl.className = "gw-live-pop";
    popEl.hidden = true;
    document.body.appendChild(popEl);
    renderHud();
  }

  function applyAtomic(msg, includeAgent) {
    if (!window.gitwave) return;
    if (msg.sync) currentSync = msg.sync;
    if (Array.isArray(msg.repos)) repoList = msg.repos;

    var docToLoad = undefined;
    if (msg.doc) {
      var key = msg.doc.repo.id + "|" + msg.doc.repo.snapshotAt + "|" + msg.doc.commits.length;
      if (key !== lastDocKey || msg.reason === "loadRepo") {
        lastDocKey = key;
        docToLoad = msg.doc;
      }
    }

    var announceText = undefined;
    if (msg.notice) {
      announceText = msg.notice;
    } else if (docToLoad) {
      announceText =
        (msg.reason === "loadRepo" ? "loaded " : "live: ") +
        docToLoad.repo.name +
        " (" +
        docToLoad.commits.length +
        " commits)";
    }

    if (window.gitwave.applyLiveState) {
      window.gitwave.applyLiveState({
        doc: docToLoad,
        sync: currentSync,
        repos: repoList,
        onAction: sendAction,
        preserveMode: msg.preserveMode !== false,
        announceText: announceText,
        agent: includeAgent
          ? Object.assign({}, msg.agent || {}, { liveConnected: true, visible: msg.agent ? msg.agent.visible : true })
          : undefined,
      });
    } else if (docToLoad) {
      window.gitwave.loadDocument(docToLoad, { preserveTheme: true, announceText: announceText });
    }
    renderHud();
  }

  function connect() {
    if (!window.gitwave) {
      setTimeout(connect, 60);
      return;
    }
    mountHud();
    var es = new EventSource("/api/events");
    es.addEventListener("hello", function (ev) {
      try { applyAtomic(JSON.parse(ev.data), true); } catch (e) {}
    });

    es.addEventListener("snapshot", function (ev) {
      try { applyAtomic(JSON.parse(ev.data), false); } catch (e) {}
    });

    es.addEventListener("sync", function (ev) {
      try { applyAtomic(JSON.parse(ev.data), false); } catch (e) {}
    });

    es.addEventListener("command", function (ev) {
      try {
        var cmd = JSON.parse(ev.data);
        window.gitwave.dispatch(cmd);
      } catch (e) {}
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", connect);
  } else {
    connect();
  }
})();
`;

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://127.0.0.1:${port}`);
  const pathname = url.pathname;

  const origin = req.headers.origin || "";
  if (/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  }
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (pathname === "/" || pathname === "/index.html" || pathname === "/gitwave.html") {
    if (!existsSync(ARTIFACT)) {
      res.writeHead(503, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("gitwave.html has not been built yet. Run: npm run build");
      return;
    }
    const html = readFileSync(ARTIFACT, "utf8");
    const injected = html.replace(
      "</body>",
      `<script src="/live-bridge.js"></script>\n</body>`
    );
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(injected);
    return;
  }

  if (pathname === "/live-bridge.js") {
    res.writeHead(200, {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(LIVE_BRIDGE_JS);
    return;
  }

  if (pathname === "/api/health") {
    jsonResponse(res, 200, {
      ok: true,
      port,
      clients: sseClients.size,
      activeRepo: activeRepoPath,
      sync: currentSync,
      agent: lastAgentState,
    });
    return;
  }

  if (pathname === "/api/repos") {
    const force = url.searchParams.get("refresh") === "1";
    const repos = await getReposCached(force);
    jsonResponse(res, 200, { ok: true, roots: scanRoots, repos });
    return;
  }

  if (pathname === "/api/file") {
    try {
      const relPath = url.searchParams.get("path") || "";
      const file = readRepoFileSafe(activeRepoPath, relPath);
      jsonResponse(res, 200, { ok: true, file });
    } catch (error) {
      jsonResponse(res, 400, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return;
  }

  if (pathname === "/api/sync") {
    try {
      const target = url.searchParams.get("path") || activeRepoPath;
      const sync = getLocalSyncStatus(target, { includeWorkingDiffs: true });
      jsonResponse(res, 200, { ok: true, sync });
    } catch (error) {
      jsonResponse(res, 400, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return;
  }

  if (pathname === "/api/snapshot") {
    try {
      const target = url.searchParams.get("path") || activeRepoPath;
      const patches = url.searchParams.get("patches") !== "0";
      const gh = url.searchParams.get("gh") === "1" || includeGhPrs;
      const { unborn, doc, sync } = await exportRepoSnapshotAsync(target, {
        includePatches: patches,
        patchLimit: 16,
        includeGhPrs: gh,
        includeWorkingDiffs: true,
      });
      jsonResponse(res, 200, { ok: true, unborn, doc, sync });
    } catch (error) {
      jsonResponse(res, 400, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return;
  }

  if (pathname === "/api/events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    });
    sseClients.add(res);
    const hello = {
      doc: currentSnapshot,
      sync: currentSync,
      repos: cachedRepos,
      agent: lastAgentState,
    };
    res.write(`event: hello\ndata: ${JSON.stringify(hello)}\n\n`);
    if (!cachedRepos.length) {
      void getReposCached(false).then((repos) => {
        broadcast("sync", { sync: currentSync, repos });
      });
    }
    const heartbeat = setInterval(() => {
      try {
        res.write(`: ping\n\n`);
      } catch {
        clearInterval(heartbeat);
      }
    }, 20000);
    req.on("close", () => {
      clearInterval(heartbeat);
      sseClients.delete(res);
    });
    return;
  }

  if (pathname === "/api/command" && req.method === "POST") {
    try {
      const body = await readBody(req);
      const method = String(body.method || "");
      const params = body.params && typeof body.params === "object" ? body.params : {};

      if (method === "loadRepo") {
        const mySeq = ++loadSeq;
        const target = resolve(String(params.path || activeRepoPath));
        await new Promise((r) => setTimeout(r, 10));
        if (mySeq !== loadSeq) {
          jsonResponse(res, 200, { ok: true, superseded: true });
          return;
        }
        const { unborn, doc, sync, fromCache } = await loadActiveRepoAsync(target);
        if (mySeq !== loadSeq) {
          jsonResponse(res, 200, { ok: true, superseded: true });
          return;
        }
        if (unborn || !doc) {
          broadcast("sync", {
            sync: currentSync,
            repos: cachedRepos,
            notice: `${sync.repoName} has no commits yet (${sync.workingTree.dirtyCount} local files)`,
          });
          jsonResponse(res, 200, { ok: true, unborn: true, repo: sync.repoName, sync });
          return;
        }
        watchActiveRepo();
        broadcast("snapshot", {
          doc,
          sync,
          repos: cachedRepos,
          reason: "loadRepo",
          preserveMode: true,
        });
        jsonResponse(res, 200, {
          ok: true,
          clients: sseClients.size,
          repo: doc.repo.name,
          commits: doc.commits.length,
          fromCache,
          sync,
        });
        return;
      }

      if (method === "refresh") {
        const mySeq = ++loadSeq;
        const { unborn, doc, sync } = await loadActiveRepoAsync(activeRepoPath, { force: true });
        if (mySeq !== loadSeq) {
          jsonResponse(res, 200, { ok: true, superseded: true });
          return;
        }
        if (!unborn && doc) {
          broadcast("snapshot", {
            doc,
            sync,
            repos: cachedRepos,
            reason: "refresh",
            preserveMode: true,
          });
        }
        void getReposCached(true).then((repos) => {
          broadcast("sync", { sync: currentSync, repos });
        });
        jsonResponse(res, 200, {
          ok: true,
          clients: sseClients.size,
          repo: doc?.repo.name ?? sync.repoName,
          sync,
        });
        return;
      }

      if (method === "setAgent") {
        lastAgentState = {
          ...lastAgentState,
          ...params,
          liveConnected: true,
        };
        broadcast("command", { method: "setAgent", params: { ...params, liveConnected: true } });
        jsonResponse(res, 200, {
          ok: true,
          clients: sseClients.size,
          agent: lastAgentState,
        });
        return;
      }

      broadcast("command", { method, params });
      jsonResponse(res, 200, {
        ok: true,
        clients: sseClients.size,
        dispatched: { method, params },
      });
    } catch (error) {
      jsonResponse(res, 400, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("not found");
});

server.listen(port, "127.0.0.1", () => {
  console.log(`GitWave Live Companion running at http://127.0.0.1:${port}`);
  console.log(`  active repo: ${activeRepoPath}`);
  console.log(`  scan roots:  ${scanRoots.join(", ")}`);
  console.log(`  mode:        read-only Git + cached fast sync + Floating Agent Oscillator`);
});
