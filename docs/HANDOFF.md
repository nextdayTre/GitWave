# GitWave — Project Status & Session Handoff (v0.5.0)

> **Vision:** A tactile, visual, daily-driver Git/GitHub project-navigation instrument (inspired by physical re-writable DVDs & USB drives) paired with expressive, read-only AI agent connectivity. Open-source and welcoming to all builders, human and digital alike.

This document is the clean starting point for any new session (human or agent). It records exactly what is shipped and verified today, the invariants that must not be broken, and the prioritized roadmap ahead.

---

## 1. Current Architecture — One `src/`, Three Runtimes

All UI, 3D wavetables, core Git math, and themes live in **`src/`** and target three environments without duplicating logic:

| Target | Entry / Artifact | Purpose | Network / Git stance |
|---|---|---|---|
| **1. Standalone Offline Web** | `gitwave.html` (`npm.cmd run build`) | Double-clickable single-file instrument & GitHub Pages demo | **Zero network, zero `fetch()`, zero external refs** (enforced by `tools/build-artifact.mjs`). Bundles Orbit Notes demo + `window.gitwave`. |
| **2. Cross-Platform Desktop (Tauri 2)** | `src-tauri/` → `src-tauri/target/release/gitwave-desktop.exe` (`~9.75 MB`) | Daily-driver native app for **Windows, macOS & Linux** (macOS `.dmg` + Windows `.msi`/`.exe` built via `.github/workflows/desktop-release.yml`) | Native Rust backend (`src-tauri/src/git_engine.rs`) reads local repos & files directly over Tauri IPC + hosts built-in Agent Bridge (`127.0.0.1:4173`). Strictly read-only on Git. |
| **3. Local Browser Companion + MCP** | `tools/live-server.mjs`, `tools/mcp-server.mjs`, `tools/gitwave-cli.mjs` | Local browser fallback, terminal CLI, and zero-dependency MCP stdio server (9 tools) | Strictly read-only on Git. Injects `/live-bridge.js` only at localhost serve time so `gitwave.html` stays pure. |

---

## 2. What Is Shipped & Verified Right Now

### Core & Visual Instrument (`src/`)
- **Core engine (`src/core/*`):** Frozen schema-1 `.gitwave` model (now preserving optional commit `paths?: string[]` and `changes?: CommitFileChange[]`), 32-slot monotone log-scaled wavetable samples, PR tension, `path:` / `file:` search tokens, `repoContentGroups()`, and smart solo-repo `defaultModules()` (replaces empty `Merge History (0)` cards on real single-author repos with `All Commits` + active folders/files while preserving Orbit Notes defaults).
- **Floating Agent Oscillator (`src/core/agent.ts`, `src/ui/agent-pod.js`):** Draggable detached 3D mini-oscillator avatar (`A` or `agent` header button) with **7 waveform synthesis formulas** (`lissajous`, `fm`, `harmonic`, `chebyshev`, `interference`, `fold`, `pulse`), custom colors/swatches, parameter sliders (`carrier`, `mod`, `fold`), and **9 cyclic task modulations** (`idle`, `reading`, `searching`, `diffing`, `editing`, `pushing`, `merging`, `cloning`, `syncing`).
- **Choreographed Welcome Tour (`src/core/tour.ts`, `src/ui/tour.js`):** 7-chapter pauseable/screen-recordable walkthrough (`▶ tour` on the Agent Pod or `?tour=1`) co-authored by Trevor & Antigravity, closing with an open-source invitation to all builders, human and digital alike.
- **In-Page Bridge (`src/bridge.ts`):** Zero-network `window.gitwave` API with read tools, UI steering, atomic single-render `applyLiveState()`, file preview hooks, and tour controls.
- **Tactile Drive Explorer & Locked Rack (`src/ui/browser.js`, `src/ui/diff.js`, `src/ui/markdown.js`):**
  - **BURN TRAY** card in sidebar showing uncommitted working-tree files (`staged`, `modified`, `untracked`, `conflicted`); click to open live unified diffs in the Burn Tray Diff Inspector.
  - **Repositories ("Cartridge Shelf")** with live sync status LEDs (`ok`, `Nd`, `↑N`, `↓N`, `local-only`, `empty` for unborn 0-commit repos) + native **`⊕` Mount Folder** picker in Desktop mode.
  - **Contents** tree (real folders & tracked files on disk) + **`contents`** category pill in the Floating 3D Browser.
  - **Read-Only File Preview & Folder Explorer:**
    - `.md` files render clean, scrollable formatted Markdown by default (XSS-safe DOM builder, zero `innerHTML`) with a **`raw source`** toggle.
    - `.html` files render a sandboxed **on-board live preview** (`<iframe sandbox="allow-scripts" srcdoc="...">`) with a **`raw source`** toggle.
    - Folders list all contained files + commit history for that path.
  - **Rack Oscillators Locked:** Sidebar navigation never silently overwrites or spawns Rack oscillators; bays only change via each oscillator's `‹ ›` controls, explicit `+` pin, or `×` remove.

### Desktop & Tools (`src-tauri/`, `tools/`, `.github/`)
- **Tauri 2 Rust Backend (`src-tauri/src/`):**
  - `main.rs`: `bootstrap_workspace`, `discover_repos`, `load_repo_snapshot` (cached by `.git/HEAD` + index fingerprint), `read_repo_file`, `pick_workspace_folder`.
  - `git_engine.rs`: Cross-platform pure Rust (Windows/macOS/Linux, zero C/OpenSSL crates), parallel git queries, path-traversal-safe read-only file reader (`128 KB` text cap, binary detection).
  - `agent_bridge.rs`: Built-in `127.0.0.1:4173` bridge listener (`GET /api/health`, `POST /api/command`) forwarding live MCP/CLI commands into the desktop WebView via `gitwave://command`.
- **Cross-Platform Icons & CI:** Generated Windows `.ico`, macOS `.icns`, and PNGs from `src-tauri/app-icon.svg`; `.github/workflows/desktop-release.yml` builds Windows + macOS (Apple Silicon & Intel) releases on `v*` tags or manual `workflow_dispatch`.
- **MCP Server & CLI (`tools/mcp-server.mjs`, `tools/gitwave-cli.mjs`):** Zero-dependency JSON-RPC 2.0 MCP stdio server exposing 9 read-only + visual-steering + Floating Agent Oscillator tools.

---

## 3. Environment Notes & Commands (Windows PowerShell)

On Trevor's Windows machine, PowerShell script execution policy blocks `.ps1` shims (`npm`, `npx`), so always use **`npm.cmd`**, **`npx.cmd`**, or **`node`** directly:

```powershell
# Core verification (fast)
npm.cmd test                         # 98 DOM-free unit tests
npm.cmd run typecheck                # strict TS check on src/core & src/state
npm.cmd run build                    # builds dist/ + verifies single-file gitwave.html
node tools/make-demo.mjs --check     # ensures Orbit Notes fixture is byte-identical
node tools/verify.mjs                # 68 headless Chrome checks + 20 screenshots

# Native Desktop App (Tauri 2 — Rust 1.95 + VS2022 installed)
npx.cmd tauri dev                    # hot-reload desktop dev window
npx.cmd tauri build --no-bundle      # fast release binary -> src-tauri/target/release/gitwave-desktop.exe
npx.cmd tauri build                  # full Windows MSI/NSIS installers

# Launch compiled Desktop app directly
.\src-tauri\target\release\gitwave-desktop.exe

# Steer the open Desktop app (or browser live-server) via CLI / Agent Bridge
node tools/gitwave-cli.mjs agent --name "Antigravity" --color "#2eead8" --formula lissajous --activity syncing --task "Hello!"
node tools/gitwave-cli.mjs steer startTour '{}'

# Browser fallback (only needed if not running Desktop app)
node tools/live-server.mjs --root C:\Users\trevor\Documents
```

---

## 4. Non-Negotiable Invariants

1. **One core implementation:** Never re-derive levels, tension, search, or agent waves outside `src/core/*`.
2. **Standalone `gitwave.html` stays 100% offline & zero-network:** Never add `fetch()` or `http(s)://` URLs inside `src/`. Desktop IPC goes strictly through `window.__TAURI__` in `src/desktop.ts`.
3. **Zero `innerHTML`:** All data text, file previews, diffs, and rendered Markdown use `document.createElement` + `textContent`.
4. **No ad-hoc hex literals in canvas renderers:** Tested by `tests/theme.test.ts` (including `src/ui/agent-pod.js`).
5. **Strictly read-only on Git by default:** Any future Git write actions (stage/commit/push/pull) must be an explicit, clearly guarded opt-in slice — never silent.

---

## 5. Recommended Next Slices (Fresh Session Roadmap)

1. **Git Hygiene & Commit Checkpoint:** Currently this workspace has all v0.5.0 changes uncommitted in the working tree (~58 dirty files). Review and commit a clean `v0.5.0` milestone before starting the next feature slice (and optionally tag `v0.5.0` to test the GitHub Actions macOS + Windows desktop build!).
2. **Desktop Native Live Enhancements (`src-tauri/`):**
   - Add a lightweight native file/repo watcher (`notify` crate or gentle refresh button in the sidebar header) + persist Trevor's chosen mounted workspace folder(s) across restarts.
   - Optional read-only `gh pr list` enrichment inside `git_engine.rs` so real GitHub PR checks/reviews populate the Tension Pad automatically on desktop.
   - Add a **multi-folder / nested tree** inside `Contents` so subfolders expand cleanly in place.
3. **Rendered Document & Preview Polish:**
   - Support rendering local relative images inside Markdown (`![alt](docs/screenshots/signal.png)`) in Desktop mode.
   - Support previewing multi-file HTML projects (CSS/JS relative assets via a local Tauri custom protocol or asset scope) cleanly inside the On-Board Preview pane.
4. **Welcome Tour Video & Sharing:**
   - Polish timing/pacing of `src/core/tour.ts` for a crisp screen-recorded walkthrough video to feature in `README.md`.
5. **Future Opt-In Guided Git Actions (Later Slice):**
   - Guarded, visually confirmed "Burn / Sync" controls (stage, commit, push, pull, fetch) with crystal-clear previews so future-Trevor and other users can manage Git visually without fear.
