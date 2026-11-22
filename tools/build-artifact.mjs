#!/usr/bin/env node
/**
 * build-artifact.mjs — turn the Vite build into the shipping single file.
 *
 * Vite writes `dist/index.html` with the JS, CSS and the demo fixture inlined
 * by vite-plugin-singlefile. This script verifies the result is truly
 * self-contained (no external `src`/`href`, no network references) and copies
 * it to the repo root as `gitwave.html` — the double-clickable instrument.
 *
 * RUN: npm run build
 * EXIT: 0 copied · 1 the build is not a valid single-file artifact.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const SOURCE = resolve(ROOT, "dist/index.html");
const TARGET = resolve(ROOT, "gitwave.html");

const built = readFileSync(SOURCE, "utf8");

const external = [...built.matchAll(/\s(?:src|href)\s*=\s*"([^"]+)"/g)]
  .map((match) => match[1])
  .filter((url) => !url.startsWith("#") && !url.startsWith("data:"));

const problems = [];
if (external.length) problems.push(`external references: ${external.join(", ")}`);
if (!built.includes("<style")) problems.push("CSS was not inlined");
if (!built.includes("GitWave")) problems.push("app code missing (GitWave not found)");
if (/\bassets\//.test(built)) problems.push("reference to an assets/ path remains");
if (!/<script\b/.test(built)) problems.push("no script tag in the artifact");
if (/\bfetch\s*\(/.test(built)) problems.push("artifact contains a fetch() call");
if (/https?:\/\//.test(built)) problems.push("artifact contains an http(s) reference");

if (problems.length) {
  console.error("x build is not a valid single-file artifact:");
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

writeFileSync(TARGET, built);
const kb = (Buffer.byteLength(built) / 1024).toFixed(1);
console.log(`gitwave.html — ${kb} KB, single file, no external references`);
