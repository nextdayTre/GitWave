# GitWave — Design System

> **A repository you can see.** Every slot is a sample; the history is the wave.

This is the source of truth for anything visual or geometric in `src/`. If a value
changes, it changes here first. The sister instrument's rule also holds: *one
implementation, one envelope, deterministic output.*

---

## 1. What this is

A single-file, offline, read-only instrument. A repository window is split into **32 time
slots**; each slot contributes one level, `0–15`, to a monotone curve. Every ref is a wave
over the same time axis. Warmth is attention, not decoration. Nothing here writes to Git.

**Non-goals.** Not a Git GUI, not a code host, not a dashboard. No onboarding, no badges, no
confetti. The reward is watching the version history and the shape be the same object.

---

## 2. Design stance

1. **The instrument, not the diagram.** Nothing decorative competes with the data. One
   accent for the trunk, one categorical ramp for refs, reserved hues for state.
2. **Never draw a value the slot cannot hold.** The level is bounded `0–15`; the spline
   never overshoots it.
3. **The picture and the truth are one object.** The strip and the curve share one geometry
   function (`slotGeometry`/`slotX`). They must agree to 0 px; the headless selftest
   asserts ≤ 0.5 px (observed 0.01 px).
4. **Warmth is attention.** Amber = open/aging, coral = stale/conflict. In **Signal**, no
   identity slot is warm; **Ember** is the deliberate warm-identity exception, and it says
   so in its name.
5. **Motion exists to show causation.** The LFO advances the read head through history. It
   never animates the data and never autoplays.
6. **Read-only.** Every gesture changes the view. Actions copy a command.

---

## 3. Colour

All colours live in `:root[data-theme="…"]` in `src/styles/app.css`; `src/core/theme.ts`
mirrors them and `tests/theme.test.ts` fails if the two drift. The canvas reads the tokens
at theme change and caches them; it introduces no hex literal of its own (tested).

### Signal (default)

| token | value | role |
|---|---|---|
| `--bg` | `#08090c` | page background |
| `--stage-glow` | `#0b0e13` | radial glow behind the wave |
| `--panel` | `#0d1015` | chrome bands |
| `--panel-hi` | `#12161d` | raised controls |
| `--panel-hover` | `#181d26` | hover |
| `--line` / `--line-soft` / `--line-hi` | `#1b212b` / `#141920` / `#2a3341` | borders |
| `--text` | `#e8edf5` | primary prose and numbers |
| `--dim` | `#7c879c` | secondary text |
| `--dimmer` | `#5f6b80` | micro-labels, ruler |
| `--handle-hi` | `#eafaf3` | focus ring |
| `--ok` / `--ok-hi` / `--ok-low` | `#34d399` / `#5eead4` / `#22c55e` | trunk, merged, data |
| `--open` | `#f5b544` | amber: open PR, age, playhead, releases |
| `--risk` | `#fb7185` | coral: stale, conflict, changes requested |
| `--agent` | `#a78bfa` | violet: agent authorship |
| `--review` | `#60a5fa` | blue: review |
| `--depth` | `#6366f1` | indigo: the colour the 3D layers recede toward |
| `--id0…--id5` | `#34d399` `#38bdf8` `#818cf8` `#c084fc` `#a3e635` `#94a3b8` | six ref identity slots |

**Identity rule.** Slots 0–5 are cool or neutral. Slot 5 is a neutral, so a ref can never
read as warmth. A seventh or eighth ref reuses a slot with a dash pattern
(`[6,4]` / `[2,4]`); identity is never hue alone. The warm reservation is tested against
`--open` and `--risk` at ≥ 35°, and saturated identity hues are ≥ 22° apart.

### Presets

| theme | identity | intent |
|---|---|---|
| **signal** | mint, sky, indigo, orchid, lime, steel | default: multi-hue semantic |
| **ember** | amber, orange, copper, gold, sand, pink | warm identity; coral still means risk |
| **spectral** | mint, cyan, blue, indigo, violet, steel | cool, night-lab |
| **bitwave** | emerald/teal/lime + steel | sister continuity |

Every preset keeps the same roles: trunk/merged = `--ok`, open/aging = `--open`,
stale/conflict = `--risk`, agent = `--agent`, review = `--review`. A theme may retune the
values, never the meanings.

**Contrast tiers (tested):** `--text` on `--bg` ≥ 7:1; `--dim` on `--panel` ≥ 4.5:1;
`--dimmer` on `--panel` ≥ 3:1; every wave and semantic hue on `--bg` ≥ 3:1.

---

## 4. Typography

Two families, never crossed:

- `--mono` — machine state: shas, dates, churn, counts, ref names, readouts.
- `--sans` — human prose: product name, subtitle, field labels, help.

| size | face | use |
|---|---|---|
| 16px / 600 | sans | `h1` |
| 12px | sans | subtitle |
| 12px | sans | commit subject |
| 11.5px | mono | readouts, controls, version output |
| 10.5px | mono | stage bar, strip labels, legend |
| 10px | sans | uppercase group labels |
| 10px | mono | canvas ruler |
| 9.5px | mono | dates in the strip |
| 8.5px | mono | strip counts |

Uppercase micro-labels carry `letter-spacing: 0.09em` and `text-transform: uppercase`.
Numeric text uses `font-variant-numeric: tabular-nums`.

---

## 5. Space and geometry

`--pad` is the single gutter authority: **40 px**, or **16 px** at or below 720 px. CSS owns
the token for the DOM bands; `slotGeometry()` uses the same 720 px breakpoint for the canvas
and the strip. Because both call one function, the plot and the strip cannot disagree.

```
plotWidth = bandWidth − 2·pad
gap       = clamp(1.5, 12, (plotWidth / 32) · 0.16)
cell      = (plotWidth − 31·gap) / 32
slotX(k)  = pad + k·(cell + gap) + cell/2
```

| constant | value |
|---|---|
| slot count | **32** |
| canvas top / bottom inset | 56 px / 34 px |
| stage min-height | `clamp(240px, 38dvh, 560px)` |
| body | `height: 100dvh`, vertical scroll allowed |
| strip cell height | ~52 px (meter + labels) |
| tension pad | 102 × 102 px in a 116 px panel; 84 × 84 at ≤ 720 |
| breakpoints | 1100 (hide repo readout, strip counts), 900 (hide dates, tighter strip), 850 (legend names), 720 (16 px gutter, mobile layout) |
| target size | ≥ 24 × 24 CSS px |

At ≤ 1100 px the strip drops the count; at ≤ 900 px it drops the date and keeps the
16-tick meter, so a 32-slot timeline never becomes a smear.

---

## 6. The canvas contract

### Level

```
ceiling = max(doc.scale.churnCeiling, p95(slot churn in this window))
level   = clamp(0, 15, round(15 · ln(1 + churn) / ln(1 + ceiling)))
```

The document ceiling is a **floor** (a quiet week stays quiet); a busy window rescales so
the shape stays legible when the span grows. Exact churn is always in the strip and the
focus card, so the level is a visual scale, never a claim.

### Fields

- 32 slots, each a time slice; slot `k` is the sample at `slotX(k)`.
- **Ref wave**: the trunk spans the whole window; a branch spans first commit → tip. A gap
  before the fork or after the tip is a real absence, not a zero.
- **Dots** at every non-empty slot; a violet halo marks agent-authored commits.
- **PR ring** at the branch tip's slot: radius 5.6 (7.2 when focused); a dashed outer ring
  for a conflict; a hollow core for a draft; a violet 1.1 px core for agent authorship.
  The `#12` label appears above 1000 px.
- **Merge diamond** on the trunk curve, 6.8 px, rotated 45°, `--ok` stroke.
- **Release flag**: a 7 px amber pennant at the tag's slot, labelled above 900 px.
- **Fork tick**: a 9 px vertical tick at a branch's first visible slot.
- **Read head**: a 1 px amber line at the right edge, a 4 px triangle at the bottom, and
  the `MM/DD` label at the top-right.
- **"You were here"**: a dashed `--dim` line at the previous snapshot, with `N new` in
  violet when commits landed since.
- **Hover**: a 3.5 % white wash over the slot; no layout shift.
- **Focus ring**: a 6.5 px `--handle-hi` ring on the focused slot's curve, plus a 9.5 px
  35 % ring.
- Empty window: centred "no commits in this window" in `--dimmer`.

### The spline

Monotone cubic Hermite (Fritsch–Butland interior weights, zero end tangents). It cannot
overshoot, so the curve never implies a level the slot does not hold. With one point the
renderer draws a dot, not a line.

### The oscillator rack and the depth surface

Pressing **3D** (or `D`) opens the **rack**. A module is a saved filter rendered as its own
small 3D surface: the header is `OSC A · name · count`, the body is the surface, the foot is
the query plus `open` and `×`, and the dashed `+ pin find` tile saves the current filter.
Clicking a module makes its filter active (the strip follows); `open` expands it to the full
stage; `+author` / `+ref` in the expanded bar split the active filter into child modules.
The opening rack is integration, branch, individual: `merged`, the agent branch, and the top
human author on the trunk.

**The 3D is not a chart.** It has no 0–F ruler, no level guides and no churn labels; that
grammar belongs to the 2D register. The surface is the oscillator table — the same data read
as shape — and the numbers live in the strip, the card counts and the `POS` readout.

- **Layers:** up to 24, one every **5 days**, each with the current span (90 days by
  default; 30 days gives a denser, spikier stack). The front layer ends at the read head;
  the stack stops when the span clamp would repeat a window.
- **Metric:** the active filter (the selected module or the find). With no active module it
  is *all commits* in `--ok`; with a module it is that module's identity hue.
- **Perspective:** for depth `t = d/(D-1)`:
  `x = pad + 0.16·plotWidth·t + (slotX − pad)·(1 − 0.16t)`,
  `y = bottom − 0.5·H·t − (level/15)·H·(1 − 0.5t)`.
  The back layers are narrower, shorter and up-right; the peaks still fit the plot.
- **Surface:** adjacent layers are joined by translucent quads (alpha `0.04 + 0.05·(1−t)`,
  a little higher in the mini), with one fin stroke per layer, a strut every 8 samples, a
  front wash and a bright front line in the module hue. A **travelling wavetable position
  frame** in `--open` (amber) walks through the depth — a curve, not an axis. The mini and
  the expanded share the surface; the expanded adds the read head, `POS` and focus/search
  marks, and no axes.
- **Motion:** an ambient clock (`ctx.morph`) breathes each surface (~5 s) and walks the
  amber frame through the depth (~12.5 s). The rack redraws at 30 fps and the expanded at
  60 fps; the motion is independent of the transport, which adds the data phase. `?static=1`
  freezes one representative phase for captures; reduced motion freezes it.
- **Selection:** a selected module's border uses its own swatch (`--sw`), never the global
  accent, so the rack stays a set of distinct identities.
- **Split:** the parent's matching commits are grouped by author (`author:<first word>`) or
  ref (`ref:<id>`); the children carry the group name, the count and the ref's colour (or
  the next identity slot for an author), capped at 8 modules in total.
- **The strip in 3D** is the active filter's front window, with the meter in the module
  colour (`--metric`). The label reads `3D · <metric> · <span>`.
- **Search:** the active filter's layers are the matches; the current match gets a ring; a
  750 ms scan line sweeps front→back when the query changes (skipped under reduced motion).
- **Transport:** a sub-slot phase slides the surface between ticks; the rack animates
  continuously in the ambient loop, so it never snaps.
- **The stage bar** reads `POS <pct>%` of the history, not a level.

Every surface is drawn with the 2D canvas: 16–24 layers × 64 samples of quads and fins —
no WebGL, no libraries, and it redraws in the same frame budget as the 2D wave.

### Draw order

2D: background → glow → guide lines → branch waves → trunk wave → dots → PR rings → merge
diamonds → fork ticks → release flags → last-visit line → read head → hover → focus ring →
empty state.

3D: background → glow → surface sheet → fins → struts → travelling frame → front wash →
front line → read head → focus/search marks → scan. No grid, no level labels.

---

## 7. The strip

One button per slot, in the same 32-column grid and the same gap. Contents:

```
date (MM/DD)   10px mono, --dim
16-tick meter  --ok ticks on --line; the slot level 0–15
count          "3" or the 6-char sha when the slot holds one commit
```

The focused slot gets an `--ok` border and an 8 % wash. A slot with an agent commit gets a
2 px violet top edge; under the **agents** lens it also gets a 14 % violet wash. Empty slots
are disabled (no dead tab stops). At ≤ 1100 px the count drops; at ≤ 900 px the date drops
and the meter grows to 8 px.

---

## 8. The tension pad

A 2-D scatter in the stage's bottom-right corner, drawn by `src/render/tension.js`.

- **X** = age, 0–20 days (`AGE_PLOT_DAYS`), clamped at 1.2 for the plot.
- **Y** = size relative to the biggest open PR (`amountNorm`), 0–1.
- **Dot** radius 4.8–6.6 by size; colour `mix(--open, --risk, ageNorm)`; hollow for a draft;
  a dashed outer ring for a conflict; a 1.2 px violet core for agent authorship.
- **Vector** from the origin to the weighted centroid (`0.15 + amountNorm`), coloured by the
  centroid's age; an arrowhead at the tip.
- **Filter**: a dashed amber circle; dragging sets the centre, the wheel changes the radius;
  dots outside dim to 22 %.
- Activating the pad (click / Enter / Space) opens the tray; clicking a dot focuses that
  PR's branch. Escape clears the filter.

---

## 9. Motion

The **LFO** is a transport, not a modulator of data: it advances the read head by one slot
per tick. In 3D a sub-slot phase slides the surface between ticks. The surfaces also run an
**ambient motion** independent of the transport: a slow breath and a travelling amber
wavetable-position frame (the rack at 30 fps, the expanded at 60 fps). A query change starts
a one-shot 750 ms scan through the expanded layers; reduced motion and `?static=1` freeze the
ambient motion.

| control | values |
|---|---|
| mode | `sweep` (loop), `bounce` (reverse at the ends), `once` (stop at `now`) |
| rate | 1, 2, 4, 8 slots/s |
| clock | `requestAnimationFrame`, `dt ≤ 120 ms`, ≤ 6 catch-up ticks |

Consequences are deterministic: `transportStep` is pure and unit-tested. The transport
never restores a view from a link (`motion.playing` is forced false), so a shared link can
never autoplay. `prefers-reduced-motion` caps the rate at 1/s and removes transitions; it
does not remove features.

The canvas redraws on dirty state only; the strip rebuilds 32 cells per change; the LFO at
8/s is the highest redraw rate.

---

## 10. Accessibility

- The canvas `aria-label` is a live summary: 2D/3D, span, end date, visible refs,
  open/stale PRs, the metric, the focused ref, and the search count.
- The **find** field is a labelled search input; its match count is a polite status. The
  **3D** button is a toggle with a pressed state. In the rack each module is a button with
  a full label (`OSC A: Merge History, 21 matching commits`), and the add tile is a button.
- The **3D** view hides the ref selector and the legend: the cards are the identities there.
- Every strip slot is a button with a full label
  (`slot 12 of 32, Oct 26, 3 commits, churn 312, level 11`). Empty slots are disabled.
- The tension pad is a `role="button"` with a count; the tray is a `role="dialog"`.
- One polite live region (`#liveStatus`) plus a visible `#status`; copy results are
  announced.
- Focus is always visible; targets are ≥ 24 px; hue is never the only carrier (rings, dashes,
  glyphs, labels).
- Reduced motion, keyboard travel (`←`/`→`, `Home`/`End`, `Space`, `Alt+1…8`, `T`, `P`, `?`),
  and a full help panel.

---

## 11. Invariants the tests enforce

1. `src/core/theme.ts` and every `:root[data-theme]` block agree, token for token.
2. Contrast tiers (text 7:1, dim 4.5:1, dimmer 3:1, graphical 3:1).
3. Signal's identity hues stay away from reserved warmth (≥ 35°) and apart (≥ 22°).
4. The semantic hues are distinct (≥ 25°).
5. No hex colour in `src/render/canvas.js`, `tension.js`, `depth.js` or `rack.js`.
6. The document is deeply frozen; a mutation throws.
7. The level is bounded and monotone; the window scale never drops below the document floor.
8. The strip and canvas agree within 0.5 px headlessly, in 2D **and** the expanded 3D
   (observed 0.01 px).
9. The `#gw=` link restores the view in a real browser (including `depth`, `rack` and the
   modules), and never carries autoplay.
10. 79 unit tests + 55 headless checks pass.
11. The 3D has no level axis, grid or churn labels; the 0–F grammar is the 2D register only.
12. The 3D animates while open (ambient breath + travelling frame); `?static=1` freezes a
    representative phase for reproducible captures.
