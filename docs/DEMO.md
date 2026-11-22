# The demo history — Orbit Notes

GitWave v0.4 ships with one deterministic, fictional repository so the instrument works
from `file://` with no install, no network and no repository access. This page is the
fixture's contract: edit it when the story changes.

---

## 1. The story

**Orbit Notes** is a small local-first note-taking app, May–November 2026. The trunk keeps
shipping; a docs branch lands; an agent attempts a store refactor and stalls; an editor
feature waits on review; a sync race is still open.

| ref | kind | colorKey | commits | PR | state | age at snapshot |
|---|---|---|---|---|---|---|
| `main` | trunk | 0 (mint) | 100 (incl. 2 merges) | — | — | — |
| `feat/editor` | branch | 1 (sky) | 19 | #12 *Editor: inline marks and the slash menu* | open, review required, checks passing | 13.9 d |
| `fix/sync-race` | branch | 2 (indigo) | 6 | #14 *Fix: sync race when an offline note resumes* | open, changes requested, checks failing, **conflicts** | 9.5 d |
| `agent/refactor-store` | branch | 3 (orchid) | 24 | #15 *Agent: extract the note store from the app shell* | **draft**, checks pending, **stale** | 18.6 d |
| `docs/site` | branch | 4 (lime) | 15 | #9 *Docs: local-first guide and release notes* | merged 2026-10-26 | — |
| `chore/ci` | branch | 5 (steel) | 4 | #4 *CI: cache the test runner* | merged 2026-07-14 | — |

**Totals:** 168 commits, 6 refs, 3 releases, 2 merge commits, 5 pull requests (2 merged,
2 open, 1 draft), 46 agent-authored commits (22 on trunk, 24 on the agent branch).

**Releases:** `v0.9.0` (2026-08-12), `v1.0.0` (2026-09-29), `v1.1.0` (2026-10-27).

**Authors:** Maya Chen and Ravi Patel (human); `dsh/lead` (agent, with a runtime/model
stamp). The agent's commits on the trunk carry a violet halo under the **agents** lens.

**Time:** history starts 2026-05-04 19:33 UTC. The snapshot — the "now" every age and
colour is measured against — is **2026-11-01 18:00 UTC**. Times are UTC and rendered as
such, so screenshots and links never drift.

Stale threshold: 14 days. Ages at the snapshot therefore put #15 over the line (coral),
while #12 and #14 are still amber. That is the demo's whole point: one glance shows the
oldest, largest, unreviewed thing.

### Visual search in the demo

The fixture is also a search playground. Try:

| query | matches | what it shows |
|---|---|---|
| `author:maya` | 87 | Maya's year; the 3D waterfall becomes her activity |
| `author:ravi` | 35 | Ravi's year, mostly docs and sync |
| `ref:editor` | 19 | the editor branch as a single identity |
| `pr:15` | 24 | the agent draft branch |
| `agent` | 46 | every agent-authored commit |
| `merged` | 21 | the integration history (merged branches + merge commits) |
| `merge` | 2 | just the two integration points |
| `after:2026-10-01` | 43 | the final month's activity |

Press **3D**: the rack opens with three fluid modules drawn from this data — **Merge History**
(`merged`, 21), **agent/refactor-store** (`ref:agent/refactor-store`, 24) and **Maya Chen**
(`author:maya`, 87). Click a module to solo its filter; **open** expands it into the large
surface; **+author** / **+ref** split it into children (Maya's filter splits into main,
feat/editor and docs/site). Search `author:maya` in the rack: the Maya card is selected and
the strip becomes her commits.

---

## 2. Why this shape

The fixture is tuned to exercise every surface:

- **Three releases** give the version dial three stops plus `now`, and the release spikes
  are the tallest peaks in the wave.
- **Five PRs** fill the tension pad with an agent draft, a conflicted fix and an editor
  feature, with different ages and sizes.
- **Two merges** put diamonds on the trunk and end two branch lifetimes.
- **A quiet branch** (`chore/ci`, four commits in a week) shows that a ref can be present
  without dominating.
- **46 agent commits** make the agents lens meaningful, including a 24-commit draft branch
  that is the largest open PR.
- **A heavy-tailed churn distribution** gives the log scale something to do; the release
  commits are deliberately large.

---

## 3. Determinism

`tools/make-demo.mjs` is seeded (`0x6b17a5e`, mulberry32) and reads no clock, locale or
network. It writes two byte-identical files:

- `src/data/demo.gitwave.json` — bundled into `gitwave.html` by Vite;
- `examples/demo.gitwave.json` — the human-facing copy to open or inspect.

```powershell
node tools/make-demo.mjs          # regenerate both
node tools/make-demo.mjs --check  # exit 1 if either has drifted
```

`tests/fixture.test.ts` pins the shape: 168 commits, 6 refs, 3 tags, 2 merges, the exact ref
order, the three open/draft PR numbers, and that every parent and tag references a real
commit. `tests/fixture.test.ts` also asserts the two copies are byte-identical.

If you edit the story, edit `tools/make-demo.mjs`, run it, and update the counts in this
page, `README.md` and `src/index.html`. `node tools/make-demo.mjs --check` is part of the
acceptance run.

---

## 4. Reading the fixture by hand

```powershell
$d = Get-Content src/data/demo.gitwave.json -Raw | ConvertFrom-Json
$d.refs | Format-Table id, kind, colorKey, tip
$d.tags | Format-Table name, time
($d.commits | Where-Object { $_.author.kind -eq 'agent' }).Count   # 46
```

A commit is one row: `{ sha, parents, time, author, agent, subject, insertions, deletions,
files, refs, merge }`. The app derives levels, waves, ages and tension from these rows; none
of those derived values are stored. See [GIT-MODEL.md](GIT-MODEL.md).

---

## 5. Replacing it with a real repository (the next slice)

The app does not read Git. A future `tools/git-export.mjs` will snapshot a local repo into
the same schema: `git log --all --numstat` for commits and churn, `git for-each-ref` for
refs, ancestry for merged/open, optional `git merge-tree` for conflicts, and optional
`gh pr list --json` at export time only. The app stays offline; a `.gitwave` file is the
carrier.

Until then, `open` loads any valid `.gitwave` document and `save` writes the loaded one.
The schema is the contract; the demo is just one document. See
[GIT-MODEL.md](GIT-MODEL.md) §6 and §4.

---

## 6. The documented screenshots

`node tools/verify.mjs` captures twelve states into `docs/screenshots/`:

| file | state |
|---|---|
| `signal.png` | default: 90 days, all refs, signal theme, focus on the trunk tip |
| `ember.png` | the warm preset |
| `spectral.png` | the cool preset |
| `bitwave.png` | the sister emerald preset |
| `tension.png` | the PR tray open |
| `stale.png` | the agent draft focused (#15, coral) |
| `agents.png` | the agents lens: human waves dimmed, agent work bright |
| `help.png` | the help panel |
| `themes.png` | the theme picker |
| `rack.png` | the 3D oscillator rack: integration / branch / individual |
| `depth.png` | the expanded surface (all commits) |
| `search.png` | the rack with `author:maya`, the Maya card selected |

They are reproducible: each is a fresh `--user-data-dir`, 1440×900, `?fresh`, 6 s virtual
time, and the 3D captures add `?static=1` so the fluid surfaces are frozen at a
representative phase; the fixed snapshot means the pixels do not age. In normal use the 3D
surfaces breathe and the amber position frame travels through them.
