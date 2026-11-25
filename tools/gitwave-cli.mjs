#!/usr/bin/env node
/**
 * gitwave-cli.mjs — read-only Node CLI over GitWave's core + live companion bridge.
 *
 * USAGE:
 *   node tools/gitwave-cli.mjs summary [repoPath] [--gh]
 *   node tools/gitwave-cli.mjs sync [repoPath]
 *   node tools/gitwave-cli.mjs repos [rootDir]
 *   node tools/gitwave-cli.mjs refs [repoPath]
 *   node tools/gitwave-cli.mjs search "<query>" [repoPath] [--limit 25]
 *   node tools/gitwave-cli.mjs commit <sha> [repoPath]
 *   node tools/gitwave-cli.mjs tension [repoPath] [--gh]
 *   node tools/gitwave-cli.mjs compare <base> <head> [repoPath]
 *   node tools/gitwave-cli.mjs steer <method> [jsonParams]
 *   node tools/gitwave-cli.mjs agent [--name X] [--color "#22d3ee"] [--formula lissajous] [--activity searching] [--task "..."]
 */

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
import {
  discoverLocalRepos,
  exportRepoSnapshot,
  getLocalSyncStatus,
} from "./lib/git-snapshot.mjs";

const LIVE_URL = process.env.GITWAVE_LIVE_URL || `http://127.0.0.1:${process.env.GITWAVE_PORT || 4173}`;

function parseFlags(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) {
        flags[key] = true;
      } else {
        flags[key] = next;
        i += 1;
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

function loadModel(repoPath, opts = {}) {
  const { doc, sync } = exportRepoSnapshot(resolve(repoPath || "."), opts);
  const parsed = parseDoc(doc);
  if (!parsed.ok) throw new Error(parsed.errors.join("; "));
  return { model: buildModel(parsed.doc), doc: parsed.doc, sync };
}

async function postLive(method, params = {}) {
  const res = await fetch(`${LIVE_URL}/api/command`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ method, params }),
  });
  return await res.json();
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const { positional, flags } = parseFlags(rest);
  const includeGhPrs = Boolean(flags.gh);

  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") {
    console.log(
      [
        "GitWave CLI — read-only repo inspection + live visual steering",
        "",
        "  summary [repoPath] [--gh]        Repo overview + local/GitHub sync",
        "  sync [repoPath]                  Local working tree & origin ahead/behind radar",
        "  repos [rootDir]                  Discover local Git repos in a folder",
        "  refs [repoPath] [--gh]           Branches, churn, PRs & upstream delta",
        "  search <query> [repoPath]        Query commits with GitWave grammar",
        "  commit <sha> [repoPath]          Inspect commit details & file diffs",
        "  tension [repoPath] [--gh]        Open PR / unmerged branch tension report",
        "  compare <base> <head> [repoPath] Compare two branches",
        "  steer <method> [jsonParams]      Drive an open `npm run live` browser tab",
        "  agent [--name ...] [--color ...] [--formula ...] [--activity ...] [--task ...]",
      ].join("\n")
    );
    return;
  }

  let output;
  switch (cmd) {
    case "summary": {
      const { model, sync } = loadModel(positional[0] || ".", { includeGhPrs });
      output = { summary: repoSummary(model), sync };
      break;
    }
    case "sync": {
      output = getLocalSyncStatus(positional[0] || ".");
      break;
    }
    case "repos": {
      output = { repos: discoverLocalRepos([positional[0] || "."]) };
      break;
    }
    case "refs": {
      const { model, sync } = loadModel(positional[0] || ".", { includeGhPrs });
      output = { refs: listRefsTool(model), branchSync: sync.branches };
      break;
    }
    case "search": {
      const query = positional[0] || "";
      const { model } = loadModel(positional[1] || ".");
      output = searchCommitsTool(model, query, Number(flags.limit) || 25);
      break;
    }
    case "commit": {
      const sha = positional[0] || "";
      const { model } = loadModel(positional[1] || ".", { includePatches: true });
      const detail = commitDetailTool(model, sha);
      if (!detail) throw new Error(`commit "${sha}" not found`);
      output = detail;
      break;
    }
    case "tension": {
      const { model } = loadModel(positional[0] || ".", { includeGhPrs });
      output = tensionReportTool(model);
      break;
    }
    case "compare": {
      const [base, head, repoPath] = positional;
      if (!base || !head) throw new Error("usage: compare <base> <head> [repoPath]");
      const { model } = loadModel(repoPath || ".");
      const cmp = compareRefsTool(model, base, head);
      if (!cmp) throw new Error(`could not compare "${base}" and "${head}"`);
      output = cmp;
      break;
    }
    case "steer": {
      const method = positional[0];
      if (!method) throw new Error("usage: steer <method> [jsonParams]");
      const params = positional[1] ? JSON.parse(positional[1]) : {};
      output = await postLive(method, params);
      break;
    }
    case "agent": {
      const patch = {
        visible: flags.hide ? false : true,
        ...(flags.name ? { name: String(flags.name) } : {}),
        ...(flags.role ? { role: String(flags.role) } : {}),
        ...(flags.color ? { color: String(flags.color) } : {}),
        ...(flags.formula ? { formula: String(flags.formula) } : {}),
        ...(flags.activity ? { activity: String(flags.activity) } : {}),
        ...(flags.task ? { task: String(flags.task) } : {}),
      };
      output = await postLive("setAgent", patch);
      break;
    }
    default:
      throw new Error(`unknown command "${cmd}" (run with --help)`);
  }

  console.log(JSON.stringify(output, null, 2));
}

main().catch((err) => {
  console.error(`x ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
