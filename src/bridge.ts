/**
 * bridge.ts — in-page `window.gitwave` read-only agent bridge.
 *
 * Pure, zero-network, deterministic envelope `{ ok, data | error }`.
 * Works offline in standalone `gitwave.html` AND serves as the exact command
 * target for the local live companion server & MCP server.
 */

import {
  ctx,
  getState,
  installDocument,
  requestRender,
  setAgent,
  setLiveWorkspace,
  setView,
} from "./app.ts";
import type { LiveRepoSummary, LiveSyncState } from "./app.ts";
import { AGENT_ACTIVITIES, AGENT_FORMULAS, normalizeAgentPatch } from "./core/agent.ts";
import type { AgentOscPatch } from "./core/agent.ts";
import { TOUR_CHAPTERS } from "./core/tour.ts";
import { buildModel, parseDoc } from "./core/model.ts";
import { THEME_IDS } from "./core/theme.ts";
import {
  commitDetailTool,
  compareRefsTool,
  listRefsTool,
  repoSummary,
  searchCommitsTool,
  tensionReportTool,
} from "./core/tools.ts";
import type { SpanKey, ThemeName } from "./core/types.ts";
import {
  defaultView,
  focusCommitView,
  focusFirstMatch,
  focusRefView,
  setSpan,
  validateView,
  viewAtWtPos,
} from "./core/view.ts";
import { startDepthScan } from "./render/depth.js";
import { setUiMode } from "./ui/controls.js";
import { closeDiffView, openDiffView, openFileView, openWorkingTreeDiff } from "./ui/diff.js";
import { goToTourStep, nextTourStep, prevTourStep, startTour, stopTour } from "./ui/tour.js";
import { announce } from "./ui/status.ts";

export interface BridgeEnvelope<T = unknown> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

function ok<T>(data: T): BridgeEnvelope<T> {
  return { ok: true, data };
}

function fail(code: string, message: string): BridgeEnvelope<never> {
  return { ok: false, error: { code, message } };
}

const VALID_SPANS = new Set<string>(["7d", "30d", "90d", "all"]);
const VALID_THEMES = new Set<string>(THEME_IDS);
const VALID_MODES = new Set<string>(["rack", "stage", "browser", "2d", "diff"]);

export function createBridge() {
  const api = {
    schemaVersion: 1,
    tool: "gitwave",
    capabilities: [
      "read",
      "search",
      "compare",
      "steer",
      "loadDocument",
      "agentOscillator",
    ] as const,

    getState(): BridgeEnvelope {
      const st = getState();
      if (!st) return fail("NOT_READY", "no repository document loaded");
      return ok(st);
    },

    repoSummary(): BridgeEnvelope {
      if (!ctx.model) return fail("NOT_READY", "no repository loaded");
      return ok(repoSummary(ctx.model));
    },

    listRefs(): BridgeEnvelope {
      if (!ctx.model) return fail("NOT_READY", "no repository loaded");
      return ok(listRefsTool(ctx.model));
    },

    searchCommits(query = "", limit = 25): BridgeEnvelope {
      if (!ctx.model) return fail("NOT_READY", "no repository loaded");
      return ok(searchCommitsTool(ctx.model, String(query ?? ""), Number(limit) || 25));
    },

    commitDetail(sha: string): BridgeEnvelope {
      if (!ctx.model) return fail("NOT_READY", "no repository loaded");
      const detail = commitDetailTool(ctx.model, String(sha ?? ""));
      if (!detail) return fail("NOT_FOUND", `commit "${sha}" not found`);
      return ok(detail);
    },

    tensionReport(): BridgeEnvelope {
      if (!ctx.model) return fail("NOT_READY", "no repository loaded");
      return ok(tensionReportTool(ctx.model));
    },

    compareRefs(baseId: string, headId: string): BridgeEnvelope {
      if (!ctx.model) return fail("NOT_READY", "no repository loaded");
      const cmp = compareRefsTool(ctx.model, String(baseId ?? ""), String(headId ?? ""));
      if (!cmp) return fail("NOT_FOUND", `could not compare "${baseId}" and "${headId}"`);
      return ok(cmp);
    },

    /* ---- View steering (strictly read-only UI transitions) ---------------- */

    setMode(mode: string): BridgeEnvelope {
      if (!ctx.model || !ctx.view) return fail("NOT_READY", "no repository loaded");
      const m = String(mode ?? "").toLowerCase();
      if (!VALID_MODES.has(m)) {
        return fail("INVALID_MODE", `mode must be one of: rack, stage, browser, 2d, diff`);
      }
      if (m === "diff") {
        openDiffView(ctx.focusCommit ?? null);
      } else {
        closeDiffView();
        setUiMode(m);
      }
      return ok(getState());
    },

    setTheme(theme: string): BridgeEnvelope {
      if (!ctx.view) return fail("NOT_READY", "no repository loaded");
      if (!VALID_THEMES.has(theme)) {
        return fail("INVALID_THEME", `unknown theme "${theme}"`);
      }
      setView({ ...ctx.view, theme: theme as ThemeName });
      return ok({ theme });
    },

    setSpan(span: string): BridgeEnvelope {
      if (!ctx.model || !ctx.view) return fail("NOT_READY", "no repository loaded");
      if (!VALID_SPANS.has(span)) {
        return fail("INVALID_SPAN", `span must be one of: 7d, 30d, 90d, all`);
      }
      setView(setSpan(ctx.model, ctx.view, span as SpanKey));
      return ok(getState());
    },

    setQuery(query: string): BridgeEnvelope {
      if (!ctx.model || !ctx.view) return fail("NOT_READY", "no repository loaded");
      const q = String(query ?? "").trim();
      if (!q) {
        ctx.matchIndex = -1;
        setView({ ...ctx.view, query: "" });
      } else {
        const focused = focusFirstMatch(ctx.model, { ...ctx.view, query: q }, q);
        ctx.matchIndex = focused.index;
        setView(focused.view);
      }
      startDepthScan();
      return ok({ query: q, matches: ctx.search.count, matchIndex: ctx.matchIndex });
    },

    focusRef(refId: string): BridgeEnvelope {
      if (!ctx.model || !ctx.view) return fail("NOT_READY", "no repository loaded");
      const ref =
        ctx.model.refsById.get(refId) ??
        ctx.model.doc.refs.find((r) => r.name === refId || r.id.includes(refId));
      if (!ref) return fail("NOT_FOUND", `ref "${refId}" not found`);
      closeDiffView();
      setView(focusRefView(ctx.model, ctx.view, ref));
      return ok({ ref: ref.id, tip: ref.tip });
    },

    focusCommit(sha: string, opts?: { openDiff?: boolean }): BridgeEnvelope {
      if (!ctx.model || !ctx.view) return fail("NOT_READY", "no repository loaded");
      const detail = commitDetailTool(ctx.model, String(sha ?? ""));
      if (!detail) return fail("NOT_FOUND", `commit "${sha}" not found`);
      const commit = ctx.model.commitBySha.get(detail.sha);
      if (!commit) return fail("NOT_FOUND", `commit "${sha}" not found`);
      if (opts?.openDiff) {
        openDiffView(commit);
      } else {
        setView(focusCommitView(ctx.model, ctx.view, commit));
      }
      return ok({ sha: commit.sha, subject: commit.subject, diffOpen: ctx.diffOpen });
    },

    spawnRack(modules: Array<{ name?: string; query: string; colorKey?: number }>): BridgeEnvelope {
      if (!ctx.model || !ctx.view) return fail("NOT_READY", "no repository loaded");
      if (!Array.isArray(modules) || modules.length === 0) {
        return fail("INVALID_MODULES", "provide at least one module with a query");
      }
      const nextModules = modules.slice(0, 8).map((m, idx) => ({
        name: String(m.name || m.query || "All Commits").slice(0, 40),
        query: String(m.query ?? "").slice(0, 120),
        colorKey: typeof m.colorKey === "number" ? Math.abs(Math.round(m.colorKey)) % 6 : idx % 6,
      }));
      closeDiffView();
      ctx.browserOpen = false;
      const base = ctx.view.span === "all" ? setSpan(ctx.model, ctx.view, "90d") : ctx.view;
      const next = validateView(
        {
          ...base,
          depth: true,
          rack: true,
          query: nextModules[0].query,
          modules: nextModules,
        },
        ctx.model
      ).view;
      const focused = nextModules[0].query
        ? focusFirstMatch(ctx.model, next, nextModules[0].query)
        : { view: next, index: -1 };
      ctx.matchIndex = focused.index;
      setView(focused.view);
      startDepthScan();
      return ok({ modules: nextModules, state: getState() });
    },

    setWtPos(pos: number): BridgeEnvelope {
      if (!ctx.model || !ctx.view) return fail("NOT_READY", "no repository loaded");
      const n = Number(pos);
      if (!Number.isFinite(n)) return fail("INVALID_POS", "pos must be a number between 0 and 1");
      const clamped = Math.max(0, Math.min(1, n));
      const base = ctx.view.span === "all" ? setSpan(ctx.model, ctx.view, "90d") : ctx.view;
      setView(viewAtWtPos(ctx.model, base, clamped, ctx.search.shas, true));
      return ok({ wtPos: clamped, end: ctx.view?.end });
    },

    loadDocument(
      rawDoc: unknown,
      opts?: { preserveTheme?: boolean; leaveBrowser?: boolean; announceText?: string }
    ): BridgeEnvelope {
      const parsed = parseDoc(rawDoc);
      if (!parsed.ok) {
        return fail("INVALID_DOCUMENT", parsed.errors.join("; "));
      }
      const prevTheme = ctx.view?.theme;
      const prevDepth = ctx.view?.depth;
      const prevRack = ctx.view?.rack;
      const model = buildModel(parsed.doc);
      let nextView = defaultView(model);
      if (opts?.preserveTheme !== false && prevTheme) {
        nextView = {
          ...nextView,
          theme: prevTheme,
          depth: typeof prevDepth === "boolean" ? prevDepth : nextView.depth,
          rack: typeof prevRack === "boolean" ? prevRack : nextView.rack,
        };
      }
      nextView = validateView(nextView, model).view;
      if (opts?.leaveBrowser !== false) {
        ctx.browserOpen = false;
        closeDiffView();
      }
      installDocument(parsed.doc, nextView);
      ctx.seenSnapshotMs = Number.NaN;
      setAgent({ repo: parsed.doc.repo.name });
      requestRender();
      announce(
        opts?.announceText ??
          `loaded ${parsed.doc.repo.name} — ${parsed.doc.commits.length} commits`
      );
      return ok(repoSummary(model));
    },

    /* ---- Floating Agent Oscillator API ----------------------------------- */

    getAgent(): BridgeEnvelope {
      return ok({ ...ctx.agent, params: { ...ctx.agent.params } });
    },

    setAgent(patch: AgentOscPatch): BridgeEnvelope {
      const updated = setAgent(patch);
      return ok({ ...updated, params: { ...updated.params } });
    },

    listAgentFormulas(): BridgeEnvelope {
      return ok(AGENT_FORMULAS);
    },

    listAgentActivities(): BridgeEnvelope {
      return ok(AGENT_ACTIVITIES);
    },

    /* ---- Live Workspace (Burn Tray + Cartridge Shelf) & Welcome Tour ----- */

    /**
     * Atomic single-render live update: applies doc, sync radar, repo shelf,
     * and agent state in ONE pass so switching repos produces zero stutter.
     */
    applyLiveState(payload: {
      doc?: unknown;
      sync?: LiveSyncState | null;
      repos?: LiveRepoSummary[];
      agent?: AgentOscPatch;
      onAction?: ((action: { method: string; params?: Record<string, unknown> }) => void) | null;
      preserveMode?: boolean;
      announceText?: string;
    }): BridgeEnvelope {
      const p = payload ?? {};
      if ("sync" in p) ctx.liveSync = p.sync ?? null;
      if (Array.isArray(p.repos)) ctx.liveRepos = p.repos;
      if ("onAction" in p) ctx.onLiveAction = p.onAction ?? null;
      ctx.loadingRepo = null;

      if (p.doc) {
        const parsed = parseDoc(p.doc);
        if (!parsed.ok) {
          requestRender();
          return fail("INVALID_DOCUMENT", parsed.errors.join("; "));
        }
        const prevTheme = ctx.view?.theme;
        const prevDepth = ctx.view?.depth;
        const prevRack = ctx.view?.rack;
        const prevRepoId = ctx.doc?.repo.id;
        const switchedRepo = prevRepoId !== parsed.doc.repo.id;
        const model = buildModel(parsed.doc);
        let nextView = defaultView(model);
        if (prevTheme) {
          nextView = {
            ...nextView,
            theme: prevTheme,
            depth: typeof prevDepth === "boolean" ? prevDepth : nextView.depth,
            rack: typeof prevRack === "boolean" ? prevRack : nextView.rack,
          };
        }
        nextView = validateView(nextView, model).view;
        if (switchedRepo) {
          ctx.diffOpen = false;
          ctx.diffTarget = "commit";
          ctx.diffFile = null;
          if (p.preserveMode === false) ctx.browserOpen = false;
        }
        installDocument(parsed.doc, nextView);
        ctx.seenSnapshotMs = Number.NaN;
        ctx.agent = normalizeAgentPatch(ctx.agent, { repo: parsed.doc.repo.name });
      }

      if (p.agent) {
        ctx.agent = normalizeAgentPatch(ctx.agent, p.agent);
      }

      requestRender();
      if (p.announceText) announce(p.announceText);
      return ok({
        repo: ctx.doc?.repo.name ?? null,
        syncState: ctx.liveSync?.syncState ?? null,
        repoCount: ctx.liveRepos.length,
      });
    },

    setLiveWorkspace(patch: {
      sync?: LiveSyncState | null;
      repos?: LiveRepoSummary[];
      onAction?: ((action: { method: string; params?: Record<string, unknown> }) => void) | null;
    }): BridgeEnvelope {
      setLiveWorkspace(patch ?? {});
      return ok({
        repo: ctx.liveSync?.repoName ?? null,
        syncState: ctx.liveSync?.syncState ?? null,
        dirtyCount: ctx.liveSync?.workingTree?.dirtyCount ?? 0,
        repoCount: ctx.liveRepos.length,
      });
    },

    openWorkingTreeDiff(filePath?: string): BridgeEnvelope {
      if (!ctx.model || !ctx.view) return fail("NOT_READY", "no repository loaded");
      openWorkingTreeDiff(filePath ?? null);
      return ok({ diffOpen: true, diffTarget: "working-tree", file: filePath ?? null });
    },

    openFilePreview(filePath: string): BridgeEnvelope {
      if (!ctx.model || !ctx.view) return fail("NOT_READY", "no repository loaded");
      openFileView(String(filePath ?? ""));
      return ok({ diffOpen: true, diffTarget: "file", path: filePath });
    },

    setFilePreview(data: {
      path: string;
      sizeBytes?: number;
      lineCount?: number;
      binary?: boolean;
      truncated?: boolean;
      content?: string;
      error?: string;
    }): BridgeEnvelope {
      if (!data || typeof data.path !== "string") {
        return fail("INVALID_FILE", "file preview requires a path");
      }
      if (ctx.diffTarget === "file" && ctx.diffFile === data.path) {
        ctx.filePreview = { ...data, loading: false };
        requestRender();
      }
      return ok({ path: data.path, loaded: !data.error });
    },

    startTour(opts?: { index?: number; autoplay?: boolean }): BridgeEnvelope {
      if (!ctx.model || !ctx.view) return fail("NOT_READY", "no repository loaded");
      startTour(opts ?? {});
      return ok({ ...ctx.tour, chapters: TOUR_CHAPTERS.length });
    },

    stopTour(opts?: { restore?: boolean }): BridgeEnvelope {
      stopTour(opts ?? {});
      return ok({ ...ctx.tour });
    },

    goToTourStep(index: number): BridgeEnvelope {
      if (!ctx.model || !ctx.view) return fail("NOT_READY", "no repository loaded");
      goToTourStep(index);
      return ok({ ...ctx.tour });
    },

    /* ---- Unified JSON command dispatcher (for live bridge / MCP) --------- */

    dispatch(cmd: { method?: string; params?: Record<string, unknown> }): BridgeEnvelope {
      if (!cmd || typeof cmd !== "object" || typeof cmd.method !== "string") {
        return fail("INVALID_COMMAND", "command requires a method string");
      }
      const p = cmd.params ?? {};
      switch (cmd.method) {
        case "getState":
          return api.getState();
        case "repoSummary":
          return api.repoSummary();
        case "listRefs":
          return api.listRefs();
        case "searchCommits":
          return api.searchCommits(String(p.query ?? ""), Number(p.limit) || 25);
        case "commitDetail":
          return api.commitDetail(String(p.sha ?? ""));
        case "tensionReport":
          return api.tensionReport();
        case "compareRefs":
          return api.compareRefs(String(p.base ?? ""), String(p.head ?? ""));
        case "setMode":
          return api.setMode(String(p.mode ?? ""));
        case "setTheme":
          return api.setTheme(String(p.theme ?? ""));
        case "setSpan":
          return api.setSpan(String(p.span ?? ""));
        case "setQuery":
          return api.setQuery(String(p.query ?? ""));
        case "focusRef":
          return api.focusRef(String(p.ref ?? ""));
        case "focusCommit":
          return api.focusCommit(String(p.sha ?? ""), { openDiff: Boolean(p.openDiff) });
        case "spawnRack":
          return api.spawnRack(Array.isArray(p.modules) ? (p.modules as Array<{ name?: string; query: string; colorKey?: number }>) : []);
        case "setWtPos":
          return api.setWtPos(Number(p.pos));
        case "loadDocument":
          return api.loadDocument(p.doc, {
            preserveTheme: p.preserveTheme !== false,
            announceText: typeof p.announce === "string" ? p.announce : undefined,
          });
        case "setAgent":
          return api.setAgent(p as AgentOscPatch);
        case "getAgent":
          return api.getAgent();
        case "openWorkingTreeDiff":
          return api.openWorkingTreeDiff(typeof p.file === "string" ? p.file : undefined);
        case "startTour":
          return api.startTour({
            index: typeof p.index === "number" ? p.index : 0,
            autoplay: p.autoplay !== false,
          });
        case "stopTour":
          return api.stopTour({ restore: p.restore !== false });
        case "nextTourStep":
          nextTourStep();
          return ok({ ...ctx.tour });
        case "prevTourStep":
          prevTourStep();
          return ok({ ...ctx.tour });
        case "goToTourStep":
          return api.goToTourStep(Number(p.index) || 0);
        default:
          return fail("UNKNOWN_METHOD", `unknown gitwave method "${cmd.method}"`);
      }
    },
  };

  return api;
}

export function installBridge() {
  const bridge = createBridge();
  (window as unknown as { gitwave?: ReturnType<typeof createBridge> }).gitwave = bridge;
  return bridge;
}
