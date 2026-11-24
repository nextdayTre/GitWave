import { test } from "node:test";
import assert from "node:assert/strict";
import {
  activeStopIndex,
  addModules,
  cycleTheme,
  defaultModules,
  defaultView,
  endMsAtWtPos,
  endMsOf,
  expandModule,
  historyRange,
  nudgeEnd,
  pinModule,
  removeModule,
  selectModule,
  setSpan,
  showRack,
  stopsFor,
  toggleLens,
  validateView,
  viewAtWtPos,
  withEnd,
  wtPosOf,
  focusCommitView,
  focusFirstMatch,
  focusRefView,
  focusSlot,
  nowView,
  showRef,
  toggleRef,
  transportStep,
} from "../src/core/view.ts";
import { buildSlots, isoOf, windowFor } from "../src/core/samples.ts";
import { THEME_IDS } from "../src/core/theme.ts";
import { loadDemo } from "./fixtures.ts";

test("view: defaults are the snapshot, 90 days, all refs, signal theme, 3D rack", () => {
  const { model } = loadDemo();
  const view = defaultView(model);
  assert.equal(view.end, model.doc.repo.snapshotAt);
  assert.equal(view.span, "90d");
  assert.equal(view.refs.length, model.doc.refs.length);
  assert.equal(view.theme, "signal");
  assert.equal(view.motion.playing, false);
  assert.equal(view.lens.age, true);
  assert.equal(view.focusRef, "main");
  assert.equal(view.focusSha, model.refsById.get("main")?.tip);
  assert.equal(view.depth, true);
  assert.equal(view.query, "");
  assert.equal(view.rack, true);
  assert.equal(view.modules.length, 3);
});

test("view: the opening rack is integration, branch, individual", () => {
  const { model } = loadDemo();
  const modules = defaultModules(model);
  assert.deepEqual(
    modules.map((module) => module.name),
    ["Merge History", "agent/refactor-store", "Maya Chen"]
  );
  assert.deepEqual(
    modules.map((module) => module.query),
    ["merged", "ref:agent/refactor-store", "author:maya"]
  );
  assert.deepEqual(
    modules.map((module) => module.colorKey),
    [0, 3, 1]
  );
  const view = defaultView(model);
  assert.equal(view.rack, true);
  assert.deepEqual(view.modules, modules);
});

test("view: modules pin, add, remove, select and expand", () => {
  const { model } = loadDemo();
  const view = defaultView(model);
  const custom = { name: "Sync", query: "subject:sync", colorKey: 4 };
  const pinned = pinModule(view, custom);
  assert.equal(pinned.modules.length, 4);
  assert.equal(pinModule(pinned, custom), pinned, "duplicate queries are refused");

  const added = addModules(view, [custom, { ...custom, name: "Duplicate" }]);
  assert.equal(added.modules.length, 4, "the duplicate query is skipped");

  const selected = selectModule(view, custom);
  assert.equal(selected.query, "subject:sync");
  const expanded = expandModule(view, custom);
  assert.equal(expanded.query, "subject:sync");
  assert.equal(expanded.depth, true);
  assert.equal(expanded.rack, false);
  assert.equal(showRack(expanded).rack, true);

  const removed = removeModule(view, 0);
  assert.equal(removed.modules.length, 2);
  const onlyOne = { ...view, modules: [view.modules[0]] };
  assert.equal(removeModule(onlyOne, 0), onlyOne, "the last module is kept");
});

test("view: validation clamps modules and keeps the rack shape", () => {
  const { model } = loadDemo();
  const result = validateView(
    {
      v: 1,
      repo: model.doc.repo.id,
      modules: [
        { name: "A", query: "agent", colorKey: 2 },
        { name: "B", query: "merged", colorKey: 99 },
        { name: "", query: "", colorKey: 0 },
        "bad",
      ],
      rack: false,
    },
    model
  );
  assert.equal(result.view.modules.length, 2, "empty modules are dropped");
  assert.equal(result.view.modules[0].query, "agent");
  assert.equal(result.view.modules[1].colorKey, 1);
  assert.equal(result.view.rack, false);

  const defaults = validateView({ v: 1, repo: model.doc.repo.id, modules: [] }, model).view;
  assert.equal(defaults.modules.length, 3);
});

test("view: validation clamps bad values and never restores autoplay", () => {
  const { model } = loadDemo();
  const result = validateView(
    {
      v: 1,
      repo: model.doc.repo.id,
      end: "2026-06-01T00:00:00Z",
      span: "90d",
      refs: ["main", "ghost", "main", "feat/editor"],
      focusRef: "ghost",
      focusSha: "not-a-sha",
      theme: "neon",
      lens: { age: false, agents: "yes" },
      motion: { playing: true, mode: "spin", rate: 7 },
      tray: "yes",
      depth: "yes",
      query: 42,
    },
    model
  );
  const view = result.view;
  assert.equal(view.depth, true);
  assert.equal(view.query, "");
  const expectedEnd = isoOf(
    Math.min(model.snapshotMs, model.startMs + 90 * 86400000)
  );
  assert.equal(view.end, expectedEnd);
  assert.equal(view.span, "90d");
  assert.deepEqual(view.refs, ["main", "feat/editor"]);
  assert.equal(view.focusRef, "main");
  assert.equal(view.focusSha, null);
  assert.equal(view.theme, "signal");
  assert.equal(view.motion.playing, false);
  assert.equal(view.motion.mode, "sweep");
  assert.equal(view.motion.rate, 4);
  assert.equal(view.tray, false);
  assert.ok(result.warnings.length > 0);
});

test("view: omitted focusSha keeps the default; explicit null clears it", () => {
  const { model } = loadDemo();
  const omitted = validateView({ v: 1, repo: model.doc.repo.id }, model).view;
  assert.equal(omitted.focusSha, model.refsById.get("main")?.tip);
  const cleared = validateView(
    { v: 1, repo: model.doc.repo.id, focusSha: null },
    model
  ).view;
  assert.equal(cleared.focusSha, null);
});

test("view: a view from another dataset warns but still loads", () => {
  const { model } = loadDemo();
  const result = validateView({ v: 1, repo: "some-other-repo", span: "30d" }, model);
  assert.ok(result.warnings.some((warning) => /loaded dataset/.test(warning)));
});

test("view: stepping moves exactly one slot and clamps at the history edge", () => {
  const { model } = loadDemo();
  const view = defaultView(model);
  const window = windowFor(model, view.end, view.span);
  const back = nudgeEnd(model, view, -1);
  assert.equal(endMsOf(view) - endMsOf(back), window.slotMs);
  let cursor = view;
  for (let i = 0; i < 200; i++) cursor = nudgeEnd(model, cursor, -1);
  const clamped = windowFor(model, cursor.end, cursor.span);
  assert.equal(clamped.endMs, model.startMs + 90 * 86400000);
  assert.equal(nudgeEnd(model, { ...view, span: "all" }, -1).end, view.end);
});

test("view: changing the span keeps the read head inside the new window", () => {
  const { model } = loadDemo();
  const view = defaultView(model);
  const all = setSpan(model, view, "all");
  assert.equal(all.end, model.doc.repo.snapshotAt);
  const short = setSpan(model, all, "7d");
  assert.equal(short.span, "7d");
  assert.equal(short.end, model.doc.repo.snapshotAt);
});

test("view: stops are the three releases plus now", () => {
  const { model } = loadDemo();
  const stops = stopsFor(model);
  assert.deepEqual(stops.map((stop) => stop.label), ["v0.9.0", "v1.0.0", "v1.1.0", "now"]);
  const view = defaultView(model);
  assert.equal(activeStopIndex(model, view), 3);
  const atTag = withEnd(model, view, model.doc.tags[2].time);
  assert.equal(activeStopIndex(model, atTag), 2);
});

test("view: theme cycles through all presets", () => {
  const { model } = loadDemo();
  let view = defaultView(model);
  const seen: string[] = [];
  for (let i = 0; i < THEME_IDS.length; i++) {
    seen.push(view.theme);
    view = cycleTheme(view);
  }
  assert.deepEqual(seen, THEME_IDS);
  assert.equal(view.theme, THEME_IDS[0]);
});

test("view: lens toggles are independent", () => {
  const { model } = loadDemo();
  const view = defaultView(model);
  const next = toggleLens(toggleLens(view, "agents"), "age");
  assert.equal(next.lens.agents, true);
  assert.equal(next.lens.age, false);
  assert.equal(next.lens.prs, true);
});

test("view: now re-reads and withEnd clamps", () => {
  const { model } = loadDemo();
  const view = defaultView(model);
  const old = withEnd(model, view, "2026-06-01T00:00:00Z");
  assert.equal(endMsOf(old), model.startMs + 90 * 86400000);
  assert.equal(nowView(model, old).end, model.doc.repo.snapshotAt);
});

test("view: focusing a slot focuses its newest commit", () => {
  const { model } = loadDemo();
  const view = defaultView(model);
  const window = windowFor(model, view.end, view.span);
  const slots = buildSlots(model, window);
  const busy = slots.find((slot) => slot.count > 0);
  assert.ok(busy);
  const focused = focusSlot(view, busy);
  assert.equal(focused.focusSha, busy.newest?.sha);
});

test("view: focusing a ref outside the window travels to its tip", () => {
  const { model } = loadDemo();
  const view = defaultView(model);
  const chore = model.refsById.get("chore/ci");
  assert.ok(chore);
  const focused = focusRefView(model, view, chore);
  assert.equal(focused.focusRef, "chore/ci");
  assert.equal(focused.focusSha, chore.tip);
  assert.notEqual(focused.end, view.end);
  const window = windowFor(model, focused.end, focused.span);
  const first = Date.parse(chore.createdAt);
  assert.ok(first >= window.startMs && first <= window.endMs);

  const main = model.refsById.get("main");
  assert.ok(main);
  assert.equal(focusRefView(model, view, main).end, view.end);
});

test("view: showRef and toggleRef keep focus valid and one ref visible", () => {
  const { model } = loadDemo();
  const view = defaultView(model);
  const added = showRef({ ...view, refs: ["main"] }, "feat/editor");
  assert.deepEqual(added.refs, ["main", "feat/editor"]);

  const removed = toggleRef({ ...view, refs: ["main", "feat/editor"] }, "main");
  assert.deepEqual(removed.refs, ["feat/editor"]);
  assert.equal(removed.focusRef, "feat/editor");
  assert.equal(removed.focusSha, null);

  const last = toggleRef({ ...view, refs: ["main"] }, "main");
  assert.deepEqual(last.refs, ["main"], "the last visible ref cannot be hidden");
});

test("view: a new query focuses a match without moving the read head", () => {
  const { model } = loadDemo();
  const view = defaultView(model);
  const focused = focusFirstMatch(model, view, "author:maya");
  assert.ok(focused.index >= 0);
  assert.equal(focused.view.end, view.end, "search does not move the window");
  const commit = focused.view.focusSha
    ? model.commitBySha.get(focused.view.focusSha)
    : null;
  assert.ok(commit);
  assert.equal(commit.author.name, "Maya Chen");
  assert.ok(focused.view.refs.includes(focused.view.focusRef));

  const noMatch = focusFirstMatch(model, view, "zzzz");
  assert.equal(noMatch.index, -1);
  assert.equal(noMatch.view.focusSha, view.focusSha);
});

test("view: focusCommitView travels to a commit outside the window", () => {
  const { model } = loadDemo();
  const view = defaultView(model);
  const earliest = model.doc.commits[0];
  const focused = focusCommitView(model, view, earliest);
  assert.equal(focused.focusSha, earliest.sha);
  assert.ok(focused.refs.includes(earliest.refs[0]));
  const window = windowFor(model, focused.end, focused.span);
  const t = Date.parse(earliest.time);
  assert.ok(t >= window.startMs && t <= window.endMs);
});

test("view: the transport sweeps, bounces and stops", () => {
  const { model } = loadDemo();
  const base = {
    ...defaultView(model),
    motion: { playing: true, mode: "sweep" as const, rate: 4 },
  };
  const window = windowFor(model, base.end, base.span);
  const minEnd = Math.min(
    model.snapshotMs,
    model.startMs + (window.endMs - window.startMs)
  );

  const swept = transportStep(model, base, 1);
  assert.equal(endMsOf(swept.view), minEnd, "sweep wraps to the oldest end");
  assert.equal(swept.view.motion.playing, true);
  assert.equal(swept.direction, 1);

  const bounced = transportStep(
    model,
    { ...base, motion: { ...base.motion, mode: "bounce" } },
    1
  );
  assert.equal(bounced.direction, -1, "bounce reverses at the newest end");
  assert.equal(endMsOf(bounced.view), model.snapshotMs - window.slotMs);

  const once = transportStep(
    model,
    { ...base, motion: { ...base.motion, mode: "once" } },
    1
  );
  assert.equal(endMsOf(once.view), model.snapshotMs);
  assert.equal(once.view.motion.playing, false);

  const all = transportStep(model, { ...base, span: "all" }, 1);
  assert.equal(all.view.motion.playing, false, "all has nowhere to travel");

  const mid = withEnd(model, base, isoOf(model.snapshotMs - 5 * window.slotMs));
  const step = transportStep(model, mid, 1);
  assert.equal(endMsOf(step.view) - endMsOf(mid), window.slotMs);
});

test("view: WT POS couples directly to read-head time travel", () => {
  const { model } = loadDemo();
  const base = {
    ...defaultView(model),
    motion: { playing: true, mode: "sweep" as const, rate: 4 },
  };
  const range = historyRange(model, "90d");
  assert.ok(range.maxEnd > range.minEnd);
  assert.equal(wtPosOf(model, base), 1);

  const oldest = viewAtWtPos(model, base, 0, null, true);
  assert.equal(endMsOf(oldest), range.minEnd);
  assert.equal(wtPosOf(model, oldest), 0);
  assert.equal(oldest.motion.playing, false, "interactive scrub pauses LFO");
  assert.ok(oldest.focusSha, "scrubbing into past focuses a commit inside that window");
  const focusCommit = model.commitBySha.get(oldest.focusSha!);
  assert.ok(focusCommit);
  const oldWin = windowFor(model, oldest.end, oldest.span);
  const t = Date.parse(focusCommit.time);
  assert.ok(t >= oldWin.startMs && t <= oldWin.endMs);

  const mid = viewAtWtPos(model, base, 0.5);
  assert.ok(Math.abs(wtPosOf(model, mid) - 0.5) < 0.005);
  assert.equal(endMsAtWtPos(model, "90d", 1), model.snapshotMs);
  assert.equal(wtPosOf(model, { ...base, span: "all" }), 1);
});
