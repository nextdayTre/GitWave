# AGENTS.md — GitWave

GitWave is a **single-file, offline, read-only** instrument that renders a repository's
history as a wavetable. Thirty-two time slots, one monotone wave per ref, a version dial, an
LFO transport, an amber tension vector for open pull requests, and a **3D oscillator rack**
where every saved filter is its own small surface with author/ref splits and visual search.
It is the sister of BitWave, not a fork: it imports nothing from it and shares no package.

**Status: v0.5.0 — instrument + visual search rack + read-only Agent Bridge & Floating Agent Oscillator.**
The standalone `gitwave.html` remains single-file, offline, and zero-network (with the bundled demo and `window.gitwave` in-page bridge). Local live sync (`tools/live-server.mjs`), the Node CLI (`tools/gitwave-cli.mjs`), and the MCP stdio server (`tools/mcp-server.mjs`) run locally on top of the exact same `src/core/*` implementation. The read-only stance on Git is real and enforced.

## Quick start

Requires Node ≥ 23.6 (the tests use native TypeScript type-stripping) and, for verification,
Chrome.

```powershell
npm install
npm test                            # 82 DOM-free unit tests
npm run typecheck                   # the DOM-free core
npm run build                       # src/ -> gitwave.html (single file)
node tools/make-demo.mjs --check    # the committed fixture is current
node tools/verify.mjs               # 60 headless checks + 17 screenshots
```

Open **`gitwave.html`** directly. It works from `file://`; there is no server, no runtime
dependency and no network call. `?fresh` disables autosave and hash mirroring.
`?selftest=1` writes the geometry report to the hidden `#gitwave-selftest` node.
`?static=1` freezes the 3D ambient motion (used by the screenshot verifier);
`?spawn=<query>&name=<name>` (repeatable) previews the agent handoff by opening the rack
with those filters.

## The mental model

| object | meaning |
|---|---|
| window | a span (`7d` / `30d` / `90d` / `all`) ending at the read head; default `90d` at `now` |
| slot | 1 of 32 equal time slices; the sample of the wavetable |
| level | the slot's churn, `0–15`, log-scaled against `max(doc ceiling, window p95)` |
| ref | a lane; trunk spans the window, a branch spans first commit → tip |
| PR | a ref with `pr.state` open/draft; age vs. the snapshot, size relative to the open set |
| tension | `0.65·ageNorm + 0.35·amountNorm`; stale after 14 days |
| depth | 3D surface of windows, 5 days apart, up to 24 layers; front = the read head |
| query | commit filter (`author:`, `ref:`, `pr:`, `merged`, dates, text); empty = no filter |
| modules | the rack: saved filters `{name, query, colorKey}`, up to 8 |
| rack | 3D sub-mode: true = the rack, false = the expanded surface |
| view | the only mutable thing: window, span, refs, focus, theme, lens, motion, depth, query, modules, rack |

Full mapping: [docs/GIT-MODEL.md](docs/GIT-MODEL.md). Visual contract:
[docs/DESIGN.md](docs/DESIGN.md).

## Where the truth lives

| file | role |
|---|---|
| `src/core/model.ts` | validate, normalize, deep-freeze and index `.gitwave` |
| `src/core/samples.ts` | windows, slots, levels, ref waves (the shared scale) |
| `src/core/refs.ts` | lifetimes, PRs, age, tension, centroid |
| `src/core/search.ts` | the query language and the matching commits |
| `src/core/split.ts` | turning a filter into its author/ref children |
| `src/core/depth.ts` | the time-depth slice stack |
| `src/core/wavetable.ts` | deterministic bipolar harmonic 3D wavetable synthesis from real Git slots |
| `src/core/geometry.ts` | the one slot geometry canvas + strip both use |
| `src/core/theme.ts` | nine synth palettes; the CSS is tested against it |
| `src/core/view.ts` | pure view transitions + the transport step |
| `src/core/share.ts` | `#gw=` codec (view only, never the dataset) |
| `src/core/agent.ts` | pure Floating Agent Oscillator synthesis & activity modulations |
| `src/core/tools.ts` | pure read-only tool queries (`repoSummary`, `listRefs`, `search`, `commitDetail`, `tension`, `compare`) |
| `src/app.ts` | runtime context, derived frame, hidden state |
| `src/bridge.ts` | zero-network `window.gitwave` in-page bridge |
| `src/render/depth.js` | true 3D isometric volumetric wavetable engine + paired 2D oscilloscope |
| `src/render/rack.js` | Serum-style 3D oscillator rack with source cycling and rotary knobs |
| `src/render/` | canvas, strip overview filmstrip, tension pad, readout |
| `src/ui/agent-pod.js` | draggable Floating Agent Oscillator avatar & signature tuner |
| `src/ui/browser.js` | Kilohearts Git source tree sidebar + borderless floating 3D browser grid |
| `src/ui/knobs.js` | tactile Warpenter/Serum SVG rotary knob widget |
| `src/ui/` | controls, legend, tray, help, keyboard, clipboard |
| `src/data/demo.gitwave.json` | the bundled deterministic history |
| `tools/lib/git-snapshot.mjs` | shared read-only local Git/GitHub snapshot & sync radar engine |
| `tools/live-server.mjs` | localhost live companion server (SSE bridge, repo watcher, multi-repo sync HUD) |
| `tools/mcp-server.mjs` | zero-dependency MCP stdio server (9 read-only + visual steering + agent oscillator tools) |
| `tools/gitwave-cli.mjs` | Node CLI over the same core & live steering bridge |
| `tools/make-demo.mjs` | the fixture generator (`--check` gates it) |
| `tools/verify.mjs` | headless state/alignment/link/screenshot checks |
| `docs/DEMO.md` | the Orbit Notes story and how to replace it |
| `docs/HANDOFF.md` | current v0.5.0 status, desktop build commands, and session handoff roadmap |
| `src-tauri/` | cross-platform Tauri 2 + Rust desktop shell (Windows/macOS/Linux) + built-in Agent Bridge |
| `.github/workflows/desktop-release.yml` | GitHub Actions CI building Windows + macOS (Apple Silicon & Intel) desktop releases |

## Rules

1. **One implementation.** Rendering, verification and any future transport use
   `src/core/*`; never re-derive a level, an age or a tension in a transport or a panel.
2. **The document is frozen.** `freezeDoc` runs at install; a mutation throws. Do not add a
   write path to the repository.
3. **The canvas and strip share `slotGeometry`/`slotX`.** The headless selftest asserts
   alignment ≤ 0.5 px (observed 0.01 px). Changing one without the other is a bug.
4. **No ad-hoc colour.** Every hue is a theme token; the canvas introduces no hex literal
   (tested). Warmth is reserved for attention in `signal`; `ember` is the declared warm
   exception.
5. **Data text is untrusted.** Commit subjects and ref names are rendered with
   `textContent`, never `innerHTML`.
6. **Deterministic output.** No `Date.now()` in renderers; the clock is
   `repo.snapshotAt`. Times are UTC, ISO, no locale formatting. The fixture is seeded and
   `--check`ed.
7. **No network, no telemetry, no `fetch`.** `tools/build-artifact.mjs` fails the build if
   the artifact contains an external reference, `fetch(` or an `http(s)//` URL.
8. **Read-only actions.** `copy show`, `copy log` and `copy link` write to the clipboard.
   Nothing is executed.
9. **Additive slices.** The default visual contract stays unless a reviewed slice changes
   it. The next slices are the exporter, refs cards and compare; the agent surface comes
   after.
10. **Search is a filter, not a highlight.** An empty query is `shas: null` (no filter); a
    query that matches nothing is an empty Set (every level 0). They are different states.
    Tokens are ANDed, capped at 120 chars / 12 tokens, and parsed by `src/core/search.ts`
    — no regex, no `innerHTML`.
11. **The depth field is a view, not a model.** Every layer is built by `buildSlots`; all
    layers share the front window's ceiling; `src/render/depth.js` introduces no data and
    no colour literal. The strip under 3D is the metric's front window.
12. **The 3D is an oscillator, not a chart.** No 0–F ruler, level grid or churn labels in
    the rack or the surface; that grammar belongs to the 2D register. The 3D carries the
    fluid surface, the travelling amber position frame and the `POS` readout. Movement is
    the point: the ambient loop runs while 3D is open, and `?static=1` freezes one
    representative phase for screenshots.

## Verification pattern

There is no CDP driver. The page writes two hidden mirrors and the verifier reads them with
`--dump-dom`:

```powershell
$chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"
$profile = Join-Path $env:TEMP ("gitwave-" + [guid]::NewGuid())
Start-Process -FilePath $chrome -Wait -ArgumentList @(
  "--headless=new","--disable-gpu","--no-first-run",
  "--user-data-dir=$profile","--virtual-time-budget=6000","--dump-dom",
  "file:///C:/path/to/gitwave.html?fresh&selftest=1"
) -RedirectStandardOutput out.html
```

`#gitwave-state` holds `getState()` (schema 1: repo, window, refs, focus, theme, lens,
motion, depth, query, modules, rack, search, metric, tension, hash). `#gitwave-selftest`
holds `{ ok, ready, errors, slotCount, maxDelta, worst, canvasWidth, layout, state }`. A
visible boot error replaces the body with a `<pre style="padding: 24px">`.

`node tools/verify.mjs` also builds a canonical `#gw=` link, loads it in the browser and
asserts the theme/span/depth/rack/focus round-trip, runs the rack, 3D and search selftests,
and captures the twelve documented screenshots into `docs/screenshots/`.

## Planned agent surface (not shipped)

Following BitWave's contract when it is built: a `window.gitwave` bridge over the same core,
pure tools (`repo_summary`, `list_refs`, `commit_detail`, `tension_report`,
`search_commits`, `compare_refs`), a Node CLI, an MCP stdio server, a generated
manifest/examples, and an honest `relatedTools` list. The envelope, error codes and state schema are decisions for
that slice, not claims for this one.

Until then, the only machine-readable data is the `.gitwave` document and the hidden
mirrors above — both read-only.

## Non-goals

Git writes, network calls, GitHub API access in the app, telemetry, screenshot-driven
automation, or replacing the human instrument with an API. The demo is fiction; a real
exporter is a separate, reviewable slice.
