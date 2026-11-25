import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AGENT_ACTIVITIES,
  AGENT_FORMULAS,
  defaultAgentConfig,
  evaluateAgentSlice,
  evaluateAgentSurface,
  normalizeAgentPatch,
  sampleAgentSlice,
} from "../src/core/agent.ts";

test("agent: all formulas and activities produce deterministic values bounded in [-1, 1]", () => {
  const base = defaultAgentConfig();
  for (const f of AGENT_FORMULAS) {
    for (const a of AGENT_ACTIVITIES) {
      const cfg = normalizeAgentPatch(base, { formula: f.id, activity: a.id });
      const s1 = evaluateAgentSlice(cfg, 0.35, 2.4, 64);
      const s2 = evaluateAgentSlice(cfg, 0.35, 2.4, 64);
      assert.equal(s1.length, 64);
      assert.deepEqual([...s1], [...s2], `${f.id}/${a.id} deterministic`);
      for (let i = 0; i < s1.length; i++) {
        assert.ok(Number.isFinite(s1[i]), `${f.id}/${a.id} finite`);
        assert.ok(s1[i] >= -1 && s1[i] <= 1, `${f.id}/${a.id} bounded: ${s1[i]}`);
      }
      // Edge taper anchors smoothly to 0
      assert.equal(s1[0], 0);
      assert.equal(s1[s1.length - 1], 0);
    }
  }
});

test("agent: different formulas and activities produce distinct waveforms", () => {
  const base = defaultAgentConfig();
  const liss = evaluateAgentSlice(normalizeAgentPatch(base, { formula: "lissajous", activity: "searching" }), 0.25, 1.7, 64);
  const pulse = evaluateAgentSlice(normalizeAgentPatch(base, { formula: "pulse", activity: "searching" }), 0.25, 1.7, 64);
  const idle = evaluateAgentSlice(normalizeAgentPatch(base, { formula: "lissajous", activity: "idle" }), 0.25, 1.7, 64);

  const diffFormula = liss.reduce((acc, v, i) => acc + Math.abs(v - pulse[i]), 0);
  const diffActivity = liss.reduce((acc, v, i) => acc + Math.abs(v - idle[i]), 0);
  assert.ok(diffFormula > 3, `formulas should differ visibly (${diffFormula})`);
  assert.ok(diffActivity > 2, `activities should modulate visibly (${diffActivity})`);
});

test("agent: normalizeAgentPatch sanitizes colors, clamps params and preserves defaults", () => {
  const base = defaultAgentConfig();
  const patched = normalizeAgentPatch(base, {
    name: "  Gemini\nNeon\t  ",
    color: "#22D3EE",
    formula: "chebyshev",
    activity: "merging",
    params: { carrier: 99, modDepth: -5, fold: 1.4 },
    visible: true,
    task: "Merging branch delta",
  });
  assert.equal(patched.name, "Gemini Neon");
  assert.equal(patched.customColor, "#22d3ee");
  assert.equal(patched.formula, "chebyshev");
  assert.equal(patched.activity, "merging");
  assert.equal(patched.params.carrier, 8);
  assert.equal(patched.params.modDepth, 0);
  assert.equal(patched.params.fold, 1.4);
  assert.equal(patched.visible, true);

  // Rejects bad hex / bad enum cleanly
  const bad = normalizeAgentPatch(patched, {
    color: "javascript:alert(1)",
    formula: "invalid",
    activity: "nope",
  });
  assert.equal(bad.customColor, "#22d3ee");
  assert.equal(bad.formula, "chebyshev");
  assert.equal(bad.activity, "merging");

  // Token resets customColor
  const tok = normalizeAgentPatch(patched, { color: "ok" });
  assert.equal(tok.colorToken, "ok");
  assert.equal(tok.customColor, null);
});

test("agent: evaluateAgentSurface produces valid stacked frames and bounded scanZ", () => {
  const cfg = normalizeAgentPatch(defaultAgentConfig(), { formula: "fold", activity: "pushing" });
  const surface = evaluateAgentSurface(cfg, 3.2, 16, 48);
  assert.equal(surface.frames.length, 16);
  assert.equal(surface.frames[0].length, 48);
  assert.ok(surface.scanZ >= 0 && surface.scanZ <= 1);
  assert.equal(surface.profile.label, "PUSHING");

  // Reusable framePool produces bit-identical output with zero extra allocation
  const pool = Array.from({ length: 16 }, () => new Float32Array(48));
  const pooled = evaluateAgentSurface(cfg, 3.2, 16, 48, pool);
  assert.equal(pooled.frames, pool);
  for (let i = 0; i < 16; i++) {
    assert.deepEqual([...pooled.frames[i]], [...surface.frames[i]]);
  }

  // Continuous scanZ interpolation matches exact endpoints and blends smoothly mid-slice
  const front = sampleAgentSlice(surface.frames, 0);
  const back = sampleAgentSlice(surface.frames, 1);
  const mid = sampleAgentSlice(surface.frames, 0.5);
  assert.deepEqual([...front], [...surface.frames[0]]);
  assert.deepEqual([...back], [...surface.frames[15]]);
  for (let s = 0; s < 48; s++) {
    assert.ok(Number.isFinite(mid[s]) && mid[s] >= -1 && mid[s] <= 1);
  }
});
