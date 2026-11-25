#!/usr/bin/env node
/**
 * mcp-server.mjs — zero-dependency Model Context Protocol (MCP) stdio server for GitWave.
 *
 * Exposes GitWave's pure core read tools, local-vs-GitHub Sync Radar, live UI
 * steering, and the Floating Agent Oscillator ("Agent Synth Avatar") over
 * standard JSON-RPC 2.0 stdio transport.
 *
 * Strictly read-only on Git: never modifies any repository.
 * If `tools/live-server.mjs` is running on 127.0.0.1:4173 (or GITWAVE_LIVE_URL),
 * tool calls automatically reflect live visual feedback in the open browser tab.
 *
 * RUN: node tools/mcp-server.mjs
 */

import { createInterface } from "node:readline";
import { resolve } from "node:path";
import { buildModel, parseDoc } from "../src/core/model.ts";
import {
  commitDetailTool,
  compareRefsTool,
  listRefsTool,
  repoSummary,
  searchCommitsTool,
  tensionReportTool,
} from "../src/core/tools.ts";
import { AGENT_ACTIVITIES, AGENT_FORMULAS } from "../src/core/agent.ts";
import {
  discoverLocalRepos,
  exportRepoSnapshot,
  getLocalSyncStatus,
} from "./lib/git-snapshot.mjs";

const LIVE_URL = process.env.GITWAVE_LIVE_URL || `http://127.0.0.1:${process.env.GITWAVE_PORT || 4173}`;
const DEFAULT_REPO = resolve(process.env.GITWAVE_REPO || ".");

/** Send a fire-and-forget live command to `live-server.mjs` if reachable. */
async function sendLiveCommand(method, params = {}) {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 1400);
    const res = await fetch(`${LIVE_URL}/api/command`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ method, params }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return { reachable: false };
    const data = await res.json();
    return { reachable: true, ...data };
  } catch {
    return { reachable: false };
  }
}

async function pulseAgent(activity, task, repo = "") {
  await sendLiveCommand("setAgent", {
    visible: true,
    activity,
    task,
    ...(repo ? { repo } : {}),
  });
}

function loadModelFor(repoPath, opts = {}) {
  const target = repoPath ? resolve(String(repoPath)) : DEFAULT_REPO;
  const { doc, sync } = exportRepoSnapshot(target, {
    includePatches: Boolean(opts.includePatches),
    includeGhPrs: Boolean(opts.includeGhPrs),
    limit: opts.limit || 250,
  });
  const parsed = parseDoc(doc);
  if (!parsed.ok) {
    throw new Error(`invalid snapshot: ${parsed.errors.join("; ")}`);
  }
  return { model: buildModel(parsed.doc), doc: parsed.doc, sync };
}

const TOOLS = [
  {
    name: "gitwave_repo_summary",
    description:
      "Read-only summary of a local Git repository using GitWave's core model: commit/ref/agent/PR counts, releases, top authors, max tension, and local-vs-GitHub sync status.",
    inputSchema: {
      type: "object",
      properties: {
        repoPath: { type: "string", description: "Local repository path (defaults to current repo)." },
        includeGhPrs: { type: "boolean", description: "Query `gh pr list` for GitHub PR state/checks." },
      },
    },
  },
  {
    name: "gitwave_list_refs",
    description:
      "List all local branches and trunk with lifetimes, commit counts, churn, agent authorship, PR tension, and local-vs-origin ahead/behind status.",
    inputSchema: {
      type: "object",
      properties: {
        repoPath: { type: "string", description: "Local repository path." },
        includeGhPrs: { type: "boolean", description: "Include live GitHub PR metadata via `gh`." },
      },
    },
  },
  {
    name: "gitwave_search_commits",
    description:
      "Search commits using GitWave's query grammar (`author:`, `ref:`, `pr:`, `sha:`, `subject:`, `after:`, `before:`, `agent`, `human`, `merged`, `merge`, or free text).",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "GitWave search query string." },
        limit: { type: "number", description: "Max commits to return (default 25)." },
        repoPath: { type: "string", description: "Local repository path." },
        steerUi: { type: "boolean", description: "If true and live UI is running, apply this search visually in GitWave." },
      },
      required: ["query"],
    },
  },
  {
    name: "gitwave_commit_detail",
    description:
      "Inspect one commit by SHA prefix: full metadata, parents, children, refs, and file-level unified diffs.",
    inputSchema: {
      type: "object",
      properties: {
        sha: { type: "string", description: "Commit SHA or prefix." },
        repoPath: { type: "string", description: "Local repository path." },
        openDiffInUi: { type: "boolean", description: "If true, open this commit inside GitWave's live diff inspector." },
      },
      required: ["sha"],
    },
  },
  {
    name: "gitwave_tension_report",
    description:
      "Ranked report of open/draft pull requests or unmerged local branches with age, relative churn, staleness (>14d), tension score and centroid.",
    inputSchema: {
      type: "object",
      properties: {
        repoPath: { type: "string", description: "Local repository path." },
        includeGhPrs: { type: "boolean", description: "Include live GitHub PR metadata via `gh`." },
      },
    },
  },
  {
    name: "gitwave_compare_refs",
    description:
      "Compare two refs/branches using GitWave's core model: shared commits, unique commits, churn delta, and sample head-only commits.",
    inputSchema: {
      type: "object",
      properties: {
        base: { type: "string", description: "Base ref id (e.g. main)." },
        head: { type: "string", description: "Head ref id (e.g. feat/editor)." },
        repoPath: { type: "string", description: "Local repository path." },
      },
      required: ["base", "head"],
    },
  },
  {
    name: "gitwave_local_sync_status",
    description:
      "Local-vs-GitHub Sync Radar: uncommitted working-tree files (staged/modified/untracked), per-branch ahead/behind counts against origin, local-only branches, and remote-only branches. Can also scan a parent folder for multiple local repos.",
    inputSchema: {
      type: "object",
      properties: {
        repoPath: { type: "string", description: "Single local repository path." },
        scanRoot: { type: "string", description: "Optional directory containing multiple local Git repositories." },
      },
    },
  },
  {
    name: "gitwave_steer_ui",
    description:
      "Visually steer any open GitWave Live browser window (read-only view changes): switch mode (rack/stage/browser/2d/diff), load a local repo, search, focus a ref or commit, spawn custom oscillator rack modules, change theme, span, or WT POS time-travel.",
    inputSchema: {
      type: "object",
      properties: {
        loadRepo: { type: "string", description: "Hot-load a local repository path into the live browser UI." },
        mode: { type: "string", enum: ["rack", "stage", "browser", "2d", "diff"] },
        theme: { type: "string", description: "Theme id (signal, kilohearts, velvet, circuit, acid, ember, spectral, bitwave, mono)." },
        span: { type: "string", enum: ["7d", "30d", "90d", "all"] },
        query: { type: "string", description: "Filter query to apply on screen." },
        focusRef: { type: "string", description: "Branch/ref id to focus." },
        focusCommit: { type: "string", description: "Commit SHA prefix to focus." },
        openDiff: { type: "boolean", description: "Open the diff inspector for focusCommit." },
        openBurnTray: { type: "boolean", description: "Open the live Burn Tray (working-tree uncommitted diffs)." },
        burnTrayFile: { type: "string", description: "Optional file path to isolate inside the Burn Tray diff view." },
        tour: { type: "string", enum: ["start", "stop", "next", "prev"], description: "Control the choreographed Welcome Tour." },
        wtPos: { type: "number", description: "Time-travel wavetable position in [0..1]." },
        spawnRack: {
          type: "array",
          description: "Replace the 3D oscillator rack with custom filter modules.",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              query: { type: "string" },
              colorKey: { type: "number" },
            },
            required: ["query"],
          },
        },
      },
    },
  },
  {
    name: "gitwave_set_agent_oscillator",
    description:
      "Configure and animate the detached Floating Agent Oscillator ('Agent Synth Avatar') floating above the GitWave GUI. Pick a creative color, waveform formula, harmonic parameters, and live task modulation animation.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Display name on the floating oscillator pod." },
        role: { type: "string", description: "Short role tag." },
        color: {
          type: "string",
          description:
            "Theme token ('agent','ok','open','risk','review','id0'..'id5') or 6-digit hex color (e.g. '#22d3ee').",
        },
        formula: {
          type: "string",
          enum: AGENT_FORMULAS.map((f) => f.id),
          description: "Waveform synthesis formula.",
        },
        params: {
          type: "object",
          properties: {
            carrier: { type: "number", description: "Carrier cycles [1..8]" },
            modRatio: { type: "number", description: "Modulator ratio [0.5..6]" },
            modDepth: { type: "number", description: "Modulation depth [0..2.5]" },
            fold: { type: "number", description: "Wavefolder drive [0..2]" },
            detune: { type: "number", description: "Interference detune [0..1.5]" },
            symmetry: { type: "number", description: "Pulse symmetry [-0.8..0.8]" },
          },
        },
        activity: {
          type: "string",
          enum: AGENT_ACTIVITIES.map((a) => a.id),
          description: "Cyclic task modulation animation.",
        },
        task: { type: "string", description: "Short human-readable status shown in the pod footer." },
        visible: { type: "boolean", description: "Show or hide the floating oscillator." },
        minimized: { type: "boolean", description: "Collapse to compact floating pill." },
      },
    },
  },
];

async function handleToolCall(name, args = {}) {
  switch (name) {
    case "gitwave_repo_summary": {
      const { model, sync } = loadModelFor(args.repoPath, {
        includeGhPrs: Boolean(args.includeGhPrs),
      });
      await pulseAgent("reading", `Reading summary of ${sync.repoName}`, sync.repoName);
      return { summary: repoSummary(model), sync };
    }

    case "gitwave_list_refs": {
      const { model, sync } = loadModelFor(args.repoPath, {
        includeGhPrs: Boolean(args.includeGhPrs),
      });
      await pulseAgent("reading", `Inspecting ${sync.branches.length} refs in ${sync.repoName}`, sync.repoName);
      return { refs: listRefsTool(model), branchSync: sync.branches, remoteOnly: sync.remoteOnlyBranches };
    }

    case "gitwave_search_commits": {
      const query = String(args.query ?? "");
      const { model, sync } = loadModelFor(args.repoPath);
      const result = searchCommitsTool(model, query, Number(args.limit) || 25);
      await pulseAgent("searching", `Search "${query}" (${result.total} matches)`, sync.repoName);
      if (args.steerUi) {
        await sendLiveCommand("setQuery", { query });
      }
      return result;
    }

    case "gitwave_commit_detail": {
      const sha = String(args.sha ?? "");
      const { model, sync } = loadModelFor(args.repoPath, { includePatches: true });
      const detail = commitDetailTool(model, sha);
      if (!detail) throw new Error(`commit "${sha}" not found`);
      await pulseAgent("diffing", `Inspecting ${detail.sha.slice(0, 7)} · ${detail.subject.slice(0, 42)}`, sync.repoName);
      if (args.openDiffInUi) {
        await sendLiveCommand("focusCommit", { sha: detail.sha, openDiff: true });
      }
      return detail;
    }

    case "gitwave_tension_report": {
      const { model, sync } = loadModelFor(args.repoPath, {
        includeGhPrs: Boolean(args.includeGhPrs),
      });
      await pulseAgent("reading", `Checking PR tension in ${sync.repoName}`, sync.repoName);
      return tensionReportTool(model);
    }

    case "gitwave_compare_refs": {
      const { model, sync } = loadModelFor(args.repoPath);
      const cmp = compareRefsTool(model, String(args.base ?? ""), String(args.head ?? ""));
      if (!cmp) throw new Error(`could not compare "${args.base}" and "${args.head}"`);
      await pulseAgent("merging", `Comparing ${cmp.base} ↔ ${cmp.head}`, sync.repoName);
      return cmp;
    }

    case "gitwave_local_sync_status": {
      if (args.scanRoot) {
        const repos = discoverLocalRepos([String(args.scanRoot)]);
        await pulseAgent("syncing", `Scanned ${repos.length} local repositories`);
        return { scanRoot: resolve(String(args.scanRoot)), count: repos.length, repos };
      }
      const sync = getLocalSyncStatus(args.repoPath || DEFAULT_REPO);
      await pulseAgent("syncing", `Sync radar: ${sync.repoName} (${sync.syncState})`, sync.repoName);
      return sync;
    }

    case "gitwave_steer_ui": {
      const dispatched = [];
      if (typeof args.loadRepo === "string" && args.loadRepo.trim()) {
        dispatched.push({
          step: "loadRepo",
          res: await sendLiveCommand("loadRepo", { path: args.loadRepo }),
        });
      }
      if (typeof args.theme === "string") {
        dispatched.push({ step: "setTheme", res: await sendLiveCommand("setTheme", { theme: args.theme }) });
      }
      if (typeof args.span === "string") {
        dispatched.push({ step: "setSpan", res: await sendLiveCommand("setSpan", { span: args.span }) });
      }
      if (Array.isArray(args.spawnRack) && args.spawnRack.length) {
        dispatched.push({ step: "spawnRack", res: await sendLiveCommand("spawnRack", { modules: args.spawnRack }) });
      }
      if (typeof args.mode === "string") {
        dispatched.push({ step: "setMode", res: await sendLiveCommand("setMode", { mode: args.mode }) });
      }
      if (typeof args.query === "string") {
        dispatched.push({ step: "setQuery", res: await sendLiveCommand("setQuery", { query: args.query }) });
      }
      if (typeof args.focusRef === "string") {
        dispatched.push({ step: "focusRef", res: await sendLiveCommand("focusRef", { ref: args.focusRef }) });
      }
      if (typeof args.focusCommit === "string") {
        dispatched.push({
          step: "focusCommit",
          res: await sendLiveCommand("focusCommit", {
            sha: args.focusCommit,
            openDiff: Boolean(args.openDiff),
          }),
        });
      }
      if (typeof args.wtPos === "number") {
        dispatched.push({ step: "setWtPos", res: await sendLiveCommand("setWtPos", { pos: args.wtPos }) });
      }
      if (args.openBurnTray) {
        dispatched.push({
          step: "openWorkingTreeDiff",
          res: await sendLiveCommand("openWorkingTreeDiff", {
            ...(typeof args.burnTrayFile === "string" ? { file: args.burnTrayFile } : {}),
          }),
        });
      }
      if (typeof args.tour === "string") {
        const map = { start: "startTour", stop: "stopTour", next: "nextTourStep", prev: "prevTourStep" };
        const m = map[args.tour];
        if (m) dispatched.push({ step: m, res: await sendLiveCommand(m, {}) });
      }
      const reachable = dispatched.some((d) => d.res?.reachable);
      return {
        liveUrl: LIVE_URL,
        liveReachable: reachable,
        dispatched,
        ...(reachable
          ? {}
          : { hint: "Start `npm run live` and open the live URL in your browser to see visual steering in real time." }),
      };
    }

    case "gitwave_set_agent_oscillator": {
      const patch = {
        ...args,
        visible: typeof args.visible === "boolean" ? args.visible : true,
      };
      const res = await sendLiveCommand("setAgent", patch);
      return {
        liveUrl: LIVE_URL,
        liveReachable: Boolean(res.reachable),
        applied: patch,
        formulas: AGENT_FORMULAS.map((f) => f.id),
        activities: AGENT_ACTIVITIES.map((a) => a.id),
        ...(res.reachable
          ? { clients: res.clients }
          : { hint: "Start `npm run live` to watch the Floating Agent Oscillator animate in your browser." }),
      };
    }

    default:
      throw new Error(`unknown tool "${name}"`);
  }
}

function writeMsg(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}

async function handleRequest(msg) {
  const { id, method, params } = msg;
  const isNotification = id === undefined || id === null;

  if (method === "notifications/initialized" || method === "notifications/cancelled") {
    return;
  }

  try {
    if (method === "initialize") {
      const protocolVersion =
        typeof params?.protocolVersion === "string" ? params.protocolVersion : "2024-11-05";
      writeMsg({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion,
          capabilities: { tools: {} },
          serverInfo: {
            name: "gitwave",
            version: "0.5.0",
          },
        },
      });
      return;
    }

    if (method === "ping") {
      if (!isNotification) writeMsg({ jsonrpc: "2.0", id, result: {} });
      return;
    }

    if (method === "tools/list") {
      writeMsg({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
      return;
    }

    if (method === "tools/call") {
      const toolName = String(params?.name || "");
      const toolArgs = params?.arguments && typeof params.arguments === "object" ? params.arguments : {};
      try {
        const result = await handleToolCall(toolName, toolArgs);
        writeMsg({
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          },
        });
      } catch (err) {
        writeMsg({
          jsonrpc: "2.0",
          id,
          result: {
            isError: true,
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  ok: false,
                  error: err instanceof Error ? err.message : String(err),
                }),
              },
            ],
          },
        });
      }
      return;
    }

    if (!isNotification) {
      writeMsg({
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: `Method not found: ${method}` },
      });
    }
  } catch (error) {
    if (!isNotification) {
      writeMsg({
        jsonrpc: "2.0",
        id,
        error: {
          code: -32603,
          message: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  try {
    const parsed = JSON.parse(trimmed);
    void handleRequest(parsed);
  } catch (err) {
    writeMsg({
      jsonrpc: "2.0",
      id: null,
      error: {
        code: -32700,
        message: `Parse error: ${err instanceof Error ? err.message : String(err)}`,
      },
    });
  }
});
