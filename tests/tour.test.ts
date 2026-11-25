import { test } from "node:test";
import assert from "node:assert/strict";
import { TOUR_CHAPTERS, chapterAt, clampChapterIndex, initialTourState } from "../src/core/tour.ts";
import { AGENT_ACTIVITIES, AGENT_FORMULAS } from "../src/core/agent.ts";

const VALID_FORMULAS = new Set(AGENT_FORMULAS.map((f) => f.id));
const VALID_ACTIVITIES = new Set(AGENT_ACTIVITIES.map((a) => a.id));

test("tour: chapters cover all core modes with valid agent formulas and activities", () => {
  assert.ok(TOUR_CHAPTERS.length >= 6);
  const modes = new Set(TOUR_CHAPTERS.map((c) => c.ui.mode));
  assert.ok(modes.has("rack"));
  assert.ok(modes.has("stage"));
  assert.ok(modes.has("browser"));
  assert.ok(modes.has("diff"));
  assert.ok(modes.has("2d"));

  for (const ch of TOUR_CHAPTERS) {
    assert.ok(ch.title.length > 4);
    assert.ok(ch.body.length > 20);
    assert.ok(ch.durationMs >= 4000);
    assert.ok(VALID_FORMULAS.has(ch.agent.formula), `invalid formula ${ch.agent.formula}`);
    assert.ok(VALID_ACTIVITIES.has(ch.agent.activity), `invalid activity ${ch.agent.activity}`);
    assert.match(ch.agent.color, /^#[0-9a-f]{6}$/);
  }
});

test("tour: state defaults off (never autoplays) and clamps chapter indices", () => {
  const s = initialTourState();
  assert.equal(s.active, false);
  assert.equal(s.playing, false);
  assert.equal(s.index, 0);
  assert.equal(clampChapterIndex(-5), 0);
  assert.equal(clampChapterIndex(999), TOUR_CHAPTERS.length - 1);
  assert.equal(chapterAt(0).id, "welcome");
  assert.equal(chapterAt(99).id, "handoff");
});
