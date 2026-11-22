# GitWave — the Git model

This is the data contract behind the instrument: how a repository becomes 32 samples, what
a level means, how a ref becomes a wave, how an open pull request becomes tension, and what
a `.gitwave` document may contain. It is deliberately small and deterministic.

---

## 1. The slot model

A **window** is `[start, end]` with one of four spans:

| span | length |
|---|---|
| `7d` | 7 days |
| `30d` | 30 days |
| `90d` | 90 days (default) |
| `all` | the whole history; the end is the snapshot |

The window is split into exactly **32 slots**. Slot `k` covers
`[start + k·Δ, start + (k+1)·Δ)` where `Δ = (end − start)/32`.

A **sample** is the slot. Every non-merge commit whose timestamp falls in the slot
contributes its churn (`insertions + deletions`). The slot's level is derived from the sum.
Empty slots are real: level `0` means "no commits in this slice".

The **read head** is the window end. The window ends at `repo.snapshotAt` when the read head
is at `now`; the version dial moves the end to a release commit.

---

## 2. Churn → level

```
ceiling = max(scale.churnCeiling, p95(slot churn across this window))
level   = clamp(0, 15, round(15 · ln(1 + churn) / ln(1 + ceiling)))
```

- `scale.churnCeiling` is stored in the document (the generator uses the 95th percentile of
  per-commit churn, floored at 40).
- The window's p95 is a soft auto-gain so a 90-day or all-history frame stays legible. The
  stored ceiling is a floor: a quiet week never gets stretched into drama.
- The exact churn is always available in the strip's tooltip/aria label and in the focus
  card, so the level is a visual scale, never a claim.
- Merge commits are excluded from levels (a merge has no churn of its own); they are drawn
  as diamonds.

**Pinned checks** (`tests/slots.test.ts`): `levelOf(0, ceiling) = 0`,
`levelOf(ceiling, ceiling) = 15`, monotone, `0 ≤ level ≤ 15`, and every slot/entry level
equals `levelOf(churn, effectiveCeiling)`.

---

## 3. Ref → wave

A ref is a lane. Its **lifetime** is `[createdAt, tip]` (`mergedAt` is metadata, not the
wave's end).

- The **trunk** wave spans the whole window, including quiet slots.
- A **branch** wave starts at the slot containing its first commit and ends at the slot
  containing its tip. Before the fork and after the tip there is no line — a real absence.
- `commit.refs[0]` is the lane a commit was authored on. After a merge, the branch's commits
  are history but stay attributed to the branch for the wave; the trunk continues in
  parallel.
- A ref with no commits in the window has no wave; the legend still lists it.

---

## 4. Open pull requests → tension (offline)

In v0.4 the document carries PR metadata directly (the demo is authored). The app does not
infer GitHub state and never calls a network.

An **open PR** is a ref whose `pr.state` is `open` or `draft` and whose `pr` is not null.

| field | meaning |
|---|---|
| `number` | the PR number |
| `title` | human title |
| `state` | `open` / `draft` / `merged` / `closed` |
| `review` | `none` / `required` / `approved` / `changes_requested` |
| `checks` | `none` / `pending` / `passing` / `failing` |
| `conflicts` | a merge would conflict |
| `draft` | draft state (also `state: "draft"`) |
| `mergedAt` | ISO or null |

**Age** = `(snapshotAt − tipTime) / 1 day`; **stale** = age > **14 days**.
**Amount** = the branch's lifetime churn relative to the largest open PR
(`amountNorm = churn / maxOpenChurn`, clamped `0.05…1`). The pad compares PRs with each
other, so a set of small fixes does not all pin to the top.
**Tension** = `0.65 · ageNorm + 0.35 · amountNorm`, with `ageNorm = clamp(age/14, 0, 1)`.
**Pad X** uses `age/20` clamped at `1.2`, so a very old PR sits at the edge rather than off
the pad.

The **vector** points at the weighted centroid: weights `0.15 + amountNorm`, positions
`(age/20, amountNorm)`. Its colour mixes `--open` → `--risk` by the centroid's age.

### What a real exporter (the next slice) must do

- `git log --all --date-order --numstat --format` for commits, refs and churn.
- `git merge-base --is-ancestor <branch> <base>` for merged/open.
- `git merge-tree --write-tree <base> <branch>` for conflicts (optional).
- `git for-each-ref` for ref lifetimes and the trunk.
- `gh pr list --json` **only at export time**, if the user asks; the app stays offline.
- A branch not merged into the trunk is the offline definition of an open PR. Draft can be
  metadata or a `wip/`/`draft/` prefix. Nothing is inferred silently: every derived field is
  in the document.

---

## 5. Search and the depth field

### The query language

A query is free text plus `key:value` tokens, all **ANDed**, capped at 120 characters and
12 tokens. It is a parser, not a regex engine. The result is the matching commits (for the
cards and stepping) and a sha set (for the levels).

| token | matches |
|---|---|
| `author:maya` | the author name contains `maya`; `author:agent` / `author:human` match the kind |
| `ref:editor` | the commit's ref id or name contains `editor` |
| `pr:12` | a ref whose PR number is `12` (or whose title contains `12`) |
| `sha:5e4093b` | a sha prefix |
| `subject:sync` | the subject contains `sync` |
| `after:2026-09-01` / `before:…` | inclusive day bounds (UTC) |
| `kind:agent` / `kind:human` | the author kind |
| `is:merge` / `is:agent` / `is:human` | a state |
| `is:merged` / `merged` | a merge commit **or** a commit on a ref that was merged (the integration history) |
| `agent` / `human` / `merge` | shorthand for `is:` |
| free text | subject, author, sha, ref name, PR title/number |

- An **empty query** returns `shas: null` — no filter at all.
- A query that **matches nothing** returns an empty Set — every level is `0`. The two are
  deliberately different states.
- Matches are sorted chronologically. A new query focuses the first match **inside the
  current window** (or the newest match when the window holds none) without moving the read
  head; Enter / Shift+Enter travel through the matches.
- The filter applies to commit-derived data only: slot levels, ref waves, the strip and the
  depth metric. The **tension pad and PR state stay global**.

### The depth stack

```
front end      = the view's read head
slice d end    = front end − d · 5 days      (clamped by the span)
slice count D  = min(24, distinct slices)
```

Each layer is the current span (90 days by default), so consecutive layers overlap; that
overlap is the texture of the surface. A layer is dropped when the span clamp would repeat
the previous window. The **metric** of the surface is the active filter: the selected
module's query, or the find when it is not one of the modules. Every layer shares the active
window's `effectiveCeiling`, so a ridge means the same thing at every depth; the exact churn
is always in the strip and the card.

The depth field is a view of the same data, not a second data model: no value is recomputed
outside `src/core/samples.ts`, and the strip under it is the front layer's slots.

The 3D display is an **oscillator surface, not a chart**: there is no level axis, grid or
`0–F` label in the rack or the surface. The amplitude is still the same `level`; the numbers
live in the strip, the card counts and the `POS` readout. The ambient breath and the
travelling amber position frame are presentation only — they never change a level or a
count. `?static=1` freezes the ambient motion for reproducible captures.

### The oscillator rack

A module is a saved filter with a name, a query and a colour slot (`0..5`, the six identity
hues). The opening rack is built from the data:

| module | query | colour |
|---|---|---|
| Merge History | `merged` | 0 (mint) |
| the first `agent/` branch, else the first branch | `ref:<id>` | the ref's `colorKey` |
| the top human author on the trunk | `author:<first word>` | the next free slot |

The rack is a **view** of filters, not a new data store:

- **Solo** a module: its query becomes `view.query` (the strip follows).
- **Open** a module: `view.depth = true`, `view.rack = false`, `view.query = module.query`.
- **Split** an open module: the parent's matching commits are grouped by author or ref; a
  child module is `{ name, query: "author:<first word>" | "ref:<id>", colorKey }`. At most
  8 modules. The children are the "expand a git-tree node" gesture.
- **Pin** the find: add the current `view.query` as a module (refused if already present).
- **Agent spawn (preview):** `gitwave.html?spawn=<query>&name=<name>` (repeatable) replaces
  the rack with those filters, turns 3D + rack on, and activates the first. It is the same
  filter core the future bridge will call; no new state and no write path.
- The rack is **not** the data: every surface is drawn from `searchCommits` + `buildSlots`;
  a module with no matches is an honest empty surface.

## 6. The `.gitwave` document (schema 1)

```json
{
  "schemaVersion": 1,
  "tool": "gitwave",
  "generatedBy": "tools/make-demo.mjs",
  "repo": {
    "id": "orbit-notes",
    "name": "Orbit Notes",
    "defaultRef": "main",
    "snapshotAt": "2026-11-01T18:00:00Z",
    "span": { "from": "2026-05-04T19:33:00Z", "to": "2026-11-01T18:00:00Z" }
  },
  "refs": [
    {
      "id": "main",
      "name": "main",
      "kind": "trunk",
      "base": null,
      "tip": "<40-hex sha>",
      "createdAt": "2026-05-04T19:33:00Z",
      "mergedAt": null,
      "colorKey": 0,
      "pr": null
    }
  ],
  "commits": [
    {
      "sha": "<40-hex>",
      "parents": ["<40-hex>"],
      "time": "2026-05-04T19:33:00Z",
      "author": { "name": "Maya Chen", "kind": "human" },
      "agent": null,
      "subject": "feat: …",
      "insertions": 42,
      "deletions": 7,
      "files": 5,
      "refs": ["main"],
      "merge": false
    }
  ],
  "tags": [{ "name": "v1.0.0", "sha": "<40-hex>", "time": "…" }],
  "scale": { "churnCeiling": 40, "levels": 16 }
}
```

Rules:

- `schemaVersion` must be `1` and `tool` must be `"gitwave"`; anything else is refused.
- Exactly one ref has `kind: "trunk"`; every ref has a tip that is a committed sha; every
  tag references a commit; shas are unique lowercase 40-hex.
- `colorKey` is `0…7`; the first six are the identity slots.
- `commit.refs` may name multiple refs; an unknown id is a warning, not a failure.
- The document is sorted (commits by time then sha, refs trunk-first then colorKey, tags by
  time) and then **deep-frozen**. A reader must never mutate it.
- Limits: 32 refs, 20 000 commits.

---

## 7. The view (schema 1)

The view is the only mutable thing.

```json
{
  "v": 1,
  "repo": "orbit-notes",
  "end": "2026-11-01T18:00:00Z",
  "span": "90d",
  "refs": ["main", "feat/editor", "fix/sync-race", "agent/refactor-store", "docs/site", "chore/ci"],
  "focusRef": "main",
  "focusSha": "5e4093b…",
  "theme": "signal",
  "lens": { "age": true, "agents": false, "prs": true },
  "motion": { "playing": false, "mode": "sweep", "rate": 4 },
  "tray": false,
  "depth": false,
  "query": "",
  "modules": [
    { "name": "Merge History", "query": "merged", "colorKey": 0 },
    { "name": "agent/refactor-store", "query": "ref:agent/refactor-store", "colorKey": 3 },
    { "name": "Maya Chen", "query": "author:maya", "colorKey": 1 }
  ],
  "rack": true
}
```

- `end` is clamped into the span's legal range; spans are `7d/30d/90d/all`.
- `refs` is at most 8 visible ids; the focused ref is always visible.
- `theme` is one of the four presets; unknown values fall back to `signal` with a warning.
- `motion.playing` is never restored: a link or an autosave cannot autoplay.
- `focusSha` may be null (nothing focused).
- `depth` is the 3D flag; `query` is the commit filter (empty = no filter, capped 120);
  `modules` is the saved rack (≤ 8, names ≤ 40, queries ≤ 120); `rack` is the 3D sub-mode
  (true = the rack, false = the expanded surface).
- `depth`/`query`/`modules`/`rack` were added additively to view schema 1: a v0.1/v0.2 link
  without them loads with the defaults (`depth:false`, `query:""`, the opening rack, `rack:true`).

**Deep link.** `#gw=` + base64url of the canonical view JSON. Canonical means a fixed key
order and `motion.playing: false`. The payload is ~350–450 characters (budget 2000). A link
carries the view, never the dataset: the receiving page must have the same repo id loaded,
or it refuses the link. Over `file://` a link is only portable to the same file path.

**Autosave.** `localStorage["gitwave:view:<repoId>"]`, canonical, debounced 350 ms.
`?fresh` disables autosave, hash mirroring and the "you were here" marker. The previous
snapshot is stored under `gitwave:seen:<repoId>` so a later document can count new commits.

---

## 8. Determinism and honesty rules

1. No `Date.now()` in a renderer; the clock is `repo.snapshotAt`.
2. All times UTC, ISO strings, no locale formatting.
3. The fixture generator is seeded and `--check`ed; the two committed copies are
   byte-identical.
4. The canvas reads only theme tokens; the theme file and the CSS are tested for equality.
5. Commit subjects and ref names are rendered with `textContent`, never `innerHTML`.
6. The document is frozen; nothing can write history back.
7. The app has no `fetch`, no network, no telemetry. The build asserts it.
8. A filtered view computes its scale from the filtered commits (with the document floor),
   and every depth layer uses the active filter's scale. Searching changes what you see, not
   the meaning of the height.
9. A rack module is a filter, never a stored count: its surface and its number are recomputed
   from `searchCommits` and `buildSlots` on every render.

---

## 9. Limits

- GitHub state (review, checks) is only as fresh as the document.
- A single window is one repository; there is no multi-repo view.
- Conflict detection is a per-PR boolean, not a file list.
- The 32-slot grid is fixed; the span is the zoom.
- The depth field is capped at 24 layers and the rack at 8 modules; it is one repository,
  not a general graph.
- The query language is intentionally small (no regex, no paths, no boolean OR).
- The exporter, refs cards and compare mode are the next slices; the agent surface comes after.
