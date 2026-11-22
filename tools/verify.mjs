#!/usr/bin/env node
/**
 * verify.mjs — independent headless checks for the built artifact.
 *
 * Runs Chrome without a driver, reads the page's own hidden mirrors and the
 * `?selftest=1` geometry report, proves a `#gw=` link restores a view, and
 * captures the documented screenshots.
 *
 * RUN: node tools/verify.mjs
 * EXIT: 0 every check passed · 1 a check failed
 */

import { spawnSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseDoc, buildModel } from "../src/core/model.ts";
import { defaultView } from "../src/core/view.ts";
import { shareFragment } from "../src/core/share.ts";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const ARTIFACT = resolve(ROOT, "gitwave.html");
const SHOTS = resolve(ROOT, "docs/screenshots");

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter(Boolean);

const chrome = CHROME_CANDIDATES.find((candidate) => existsSync(candidate));
if (!chrome) {
  console.error("x Chrome not found — set CHROME_PATH");
  process.exit(1);
}
if (!existsSync(ARTIFACT)) {
  console.error("x gitwave.html is missing — run: npm run build");
  process.exit(1);
}

const fileUrl = (query) => `file:///${ARTIFACT.replace(/\\/g, "/")}${query}`;

function runChrome({ query, screenshot = null, dump = false, width = 1440, height = 900 }) {
  const profile = mkdtempSync(join(tmpdir(), "gitwave-verify-"));
  const stdout = join(profile, "stdout.html");
  const stderr = join(profile, "stderr.txt");
  const args = [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--no-first-run",
    `--user-data-dir=${profile}`,
    `--window-size=${width},${height}`,
    "--virtual-time-budget=6000",
  ];
  if (dump) args.push("--dump-dom");
  if (screenshot) args.push(`--screenshot=${screenshot}`);
  args.push(fileUrl(query));

  const outFd = openSync(stdout, "w");
  const errFd = openSync(stderr, "w");
  const result = spawnSync(chrome, args, {
    stdio: ["ignore", outFd, errFd],
    timeout: 120000,
  });
  closeSync(outFd);
  closeSync(errFd);
  const html = readFileSync(stdout, "utf8");
  const errors = readFileSync(stderr, "utf8");
  try {
    rmSync(profile, { recursive: true, force: true });
  } catch {
    /* Chrome may still hold the profile on Windows */
  }
  return { status: result.status, html, errors };
}

function decodeEntities(text) {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function extractPre(html, id) {
  const match = html.match(new RegExp(`<pre id="${id}"[^>]*>([\\s\\S]*?)</pre>`));
  if (!match) return null;
  const text = decodeEntities(match[1]).trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

const failures = [];
const passes = [];
function check(name, condition, detail = "") {
  if (condition) passes.push(`${name}${detail ? ` — ${detail}` : ""}`);
  else failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
}

/* ---- 1. in-page selftest ------------------------------------------------- */

const selftestRun = runChrome({ query: "?fresh&static=1&selftest=1", dump: true });
const selftest = extractPre(selftestRun.html, "gitwave-selftest");
check("selftest node present", Boolean(selftest));
if (selftest) {
  check("booted", selftest.ready === true);
  check("no page errors", selftest.errors === 0, `errors=${selftest.errors}`);
  check("32 slots", selftest.slotCount === 32, `slots=${selftest.slotCount}`);
  check(
    "strip aligned to the curve",
    typeof selftest.maxDelta === "number" && selftest.maxDelta <= 0.5,
    `maxDelta=${selftest.maxDelta}px`
  );
  check("selftest ok", selftest.ok === true);
}
check(
  "no boot-error screen",
  !/<pre style="padding: 24px/.test(selftestRun.html)
);

/* ---- 2. hidden state ----------------------------------------------------- */

const state = extractPre(selftestRun.html, "gitwave-state");
check("state mirror present", Boolean(state));
if (state) {
  check("state schema 1", state.schemaVersion === 1);
  check("tool is gitwave", state.tool === "gitwave");
  check("32-slot window", state.window?.slots === 32);
  check("six refs", state.refs?.length === 6, `refs=${state.refs?.length}`);
  check("three open PRs", state.tension?.open === 3, `open=${state.tension?.open}`);
  check("one stale PR", state.tension?.stale === 1, `stale=${state.tension?.stale}`);
  check("signal is the default theme", state.theme === "signal", `theme=${state.theme}`);
  check("autoplay is off", state.motion?.playing === false);
}

/* ---- 3. deeplink restores a view ---------------------------------------- */

const raw = JSON.parse(readFileSync(resolve(ROOT, "src/data/demo.gitwave.json"), "utf8"));
const parsed = parseDoc(raw);
if (!parsed.ok) {
  console.error("x the demo fixture no longer validates");
  process.exit(1);
}
const model = buildModel(parsed.doc);
const linkView = {
  ...defaultView(model),
  span: "30d",
  theme: "ember",
  tray: true,
  depth: true,
  focusRef: "agent/refactor-store",
};
const fragment = shareFragment(linkView);
const linkRun = runChrome({ query: `?fresh&static=1#${fragment}`, dump: true });
const linkState = extractPre(linkRun.html, "gitwave-state");
check("link decodes in the browser", Boolean(linkState));
if (linkState) {
  check("link restores the theme", linkState.theme === "ember", `theme=${linkState.theme}`);
  check("link restores the span", linkState.window?.span === "30d", `span=${linkState.window?.span}`);
  check("link restores the depth field", linkState.depth === true, `depth=${linkState.depth}`);
  check("link restores the rack flag", linkState.rack === true, `rack=${linkState.rack}`);
  check(
    "link restores the focus",
    linkState.focus?.ref === "agent/refactor-store",
    `ref=${linkState.focus?.ref}`
  );
}

/* ---- 3b. rack, depth field and search ----------------------------------- */

const rackRun = runChrome({ query: "?fresh&depth=1&static=1", dump: true });
const rackState = extractPre(rackRun.html, "gitwave-state");
check("rack state present", Boolean(rackState));
if (rackState) {
  check("rack mode is on", rackState.rack === true);
  check("rack has three opening modules", rackState.modules?.length === 3, `modules=${rackState.modules?.length}`);
  check(
    "rack opens on integration / branch / individual",
    rackState.modules?.map((module) => module.name).join("|") ===
      "Merge History|agent/refactor-store|Maya Chen",
    rackState.modules?.map((module) => module.name).join("|")
  );
}

const depthRun = runChrome({ query: "?fresh&depth=1&rack=0&static=1&selftest=1", dump: true });
const depthSelf = extractPre(depthRun.html, "gitwave-selftest");
const depthState = extractPre(depthRun.html, "gitwave-state");
check("3D selftest present", Boolean(depthSelf));
if (depthSelf) {
  check(
    "3D strip aligned to the front slice",
    depthSelf.ok === true && depthSelf.maxDelta <= 0.5,
    `maxDelta=${depthSelf.maxDelta}px`
  );
}
check("3D state present", Boolean(depthState));
if (depthState) {
  check("3D mode is on", depthState.depth === true);
  check("expanded depth is not the rack", depthState.rack === false);
  check("3D metric is all commits", depthState.metric?.label === "all commits", `metric=${depthState.metric?.label}`);
  check("3D has depth layers", depthState.metric?.slices >= 10, `layers=${depthState.metric?.slices}`);
  check("rack modules survive in 3D", depthState.modules?.length === 3);
}

const searchRun = runChrome({ query: "?fresh&static=1&query=author:maya&selftest=1", dump: true });
const searchState = extractPre(searchRun.html, "gitwave-state");
const searchSelf = extractPre(searchRun.html, "gitwave-selftest");
check("search state present", Boolean(searchState));
if (searchState) {
  check("search query is kept", searchState.query === "author:maya", `query=${searchState.query}`);
  check("search finds Maya's commits", searchState.search?.count === 87, `count=${searchState.search?.count}`);
  check(
    "search focused a match",
    typeof searchState.search?.matchIndex === "number" && searchState.search.matchIndex >= 0,
    `index=${searchState.search?.matchIndex}`
  );
}
check("search selftest", searchSelf?.ok === true, `errors=${searchSelf?.errors}`);

const spawnRun = runChrome({
  query:
    "?fresh&static=1&spawn=author:maya&name=Maya&spawn=ref:agent/refactor-store&name=Agent",
  dump: true,
});
const spawnState = extractPre(spawnRun.html, "gitwave-state");
check("agent spawn state present", Boolean(spawnState));
if (spawnState) {
  check("agent spawn opens the rack", spawnState.depth === true && spawnState.rack === true);
  check("agent spawn replaces the modules", spawnState.modules?.length === 2, `modules=${spawnState.modules?.length}`);
  check(
    "agent spawn selects the first filter",
    spawnState.query === "author:maya" && spawnState.modules?.[0]?.name === "Maya",
    `query=${spawnState.query}`
  );
}

/* ---- 4. screenshots ------------------------------------------------------ */

mkdirSync(SHOTS, { recursive: true });
const shots = [
  ["signal.png", "?fresh&static=1"],
  ["ember.png", "?fresh&static=1&theme=ember"],
  ["spectral.png", "?fresh&static=1&theme=spectral"],
  ["bitwave.png", "?fresh&static=1&theme=bitwave"],
  ["kilohearts.png", "?fresh&static=1&browser=1&theme=kilohearts"],
  ["velvet.png", "?fresh&static=1&depth=1&rack=0&theme=velvet"],
  ["acid.png", "?fresh&static=1&theme=acid"],
  ["browser.png", "?fresh&static=1&browser=1"],
  ["wave2d.png", "?fresh&depth=0"],
  ["tension.png", "?fresh&static=1&tray=1"],
  ["stale.png", "?fresh&static=1&focus=agent/refactor-store"],
  ["agents.png", "?fresh&static=1&agents=1"],
  ["help.png", "?fresh&static=1&help=1"],
  ["themes.png", "?fresh&static=1&menu=1"],
  ["rack.png", "?fresh&depth=1&static=1"],
  ["depth.png", "?fresh&depth=1&rack=0&static=1"],
  ["search.png", "?fresh&depth=1&query=author:maya&static=1"],
];
for (const [name, query] of shots) {
  const target = join(SHOTS, name);
  const result = runChrome({ query, screenshot: target });
  const size = existsSync(target) ? statSync(target).size : 0;
  check(
    `screenshot ${name}`,
    result.status === 0 && size > 20000,
    `${(size / 1024).toFixed(0)} KB`
  );
}

/* ---- report -------------------------------------------------------------- */

for (const line of passes) console.log(`ok ${line}`);
for (const line of failures) console.error(`x  ${line}`);
console.log(
  `\n${passes.length}/${passes.length + failures.length} checks passed · screenshots in docs/screenshots`
);
process.exit(failures.length ? 1 : 0);
