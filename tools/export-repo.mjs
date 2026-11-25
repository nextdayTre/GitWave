#!/usr/bin/env node
/**
 * export-repo.mjs — read-only local Git repository → `.gitwave.json` exporter.
 *
 * Exports branches, tags, commits, churn metrics, optional GitHub PR metadata
 * (`--gh`), and (with `--patches`) real file-level unified diffs so you can open
 * any local Git repo inside `gitwave.html` and inspect diffs by double-clicking
 * any slot.
 *
 * USAGE:
 *   node tools/export-repo.mjs [repoPath] [--patches] [--gh] [--limit 300] [--out file.gitwave.json]
 *
 * Strictly read-only: never modifies the repository.
 */

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { exportRepoSnapshot } from "./lib/git-snapshot.mjs";

const args = process.argv.slice(2);
let repoArg = ".";
let includePatches = false;
let includeGhPrs = false;
let limit = 300;
let outFile = null;

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--patches" || a === "-p") includePatches = true;
  else if (a === "--gh") includeGhPrs = true;
  else if (a === "--limit" && args[i + 1]) limit = Math.max(1, Math.min(2000, Number(args[++i]) || 300));
  else if ((a === "--out" || a === "-o") && args[i + 1]) outFile = args[++i];
  else if (!a.startsWith("-")) repoArg = a;
}

try {
  const { doc, sync } = exportRepoSnapshot(repoArg, {
    includePatches,
    includeGhPrs,
    limit,
  });

  const json = JSON.stringify(doc, null, 2) + "\n";
  if (outFile) {
    writeFileSync(resolve(outFile), json, "utf8");
    console.error(
      `exported ${doc.repo.name}: ${doc.commits.length} commits, ${doc.refs.length} refs, sync=${sync.syncState}${
        includePatches ? " (with patches)" : ""
      }${includeGhPrs ? " (+gh PRs)" : ""} -> ${outFile}`
    );
  } else {
    process.stdout.write(json);
  }
} catch (error) {
  console.error(`x export failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
