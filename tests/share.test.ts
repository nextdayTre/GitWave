import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canonicalView,
  decodeView,
  encodeView,
  readFragment,
  shareFragment,
  VIEW_BUDGET,
} from "../src/core/share.ts";
import { defaultView, withEnd } from "../src/core/view.ts";
import { loadDemo } from "./fixtures.ts";

test("share: a view round-trips exactly", () => {
  const { model } = loadDemo();
  const view = {
    ...defaultView(model),
    tray: true,
    theme: "ember" as const,
    depth: true,
    query: "author:maya",
    rack: false,
  };
  const decoded = decodeView(encodeView(view), model);
  assert.ok(decoded);
  assert.deepEqual(canonicalView(decoded), canonicalView(view));
  assert.equal(decoded.depth, true);
  assert.equal(decoded.query, "author:maya");
  assert.equal(decoded.rack, false);
  assert.equal(decoded.modules.length, 3);
});

test("share: canonical payloads are deterministic", () => {
  const { model } = loadDemo();
  const view = defaultView(model);
  assert.equal(encodeView(view), encodeView({ ...view }));
  assert.equal(encodeView(view), encodeView({ ...view, motion: { ...view.motion, playing: true } }));
});

test("share: a link never carries autoplay", () => {
  const { model } = loadDemo();
  const view = { ...defaultView(model), motion: { playing: true, mode: "bounce" as const, rate: 8 } };
  assert.equal(canonicalView(view).motion.playing, false);
  const decoded = decodeView(encodeView(view), model);
  assert.ok(decoded);
  assert.equal(decoded.motion.playing, false);
  assert.equal(decoded.motion.mode, "bounce");
  assert.equal(decoded.motion.rate, 8);
});

test("share: different ends produce different links", () => {
  const { model } = loadDemo();
  const view = defaultView(model);
  const older = withEnd(model, view, "2026-08-01T00:00:00Z");
  assert.notEqual(encodeView(view), encodeView(older));
});

test("share: the payload stays inside the budget", () => {
  const { model } = loadDemo();
  assert.ok(shareFragment(defaultView(model)).length < VIEW_BUDGET);
  const full = {
    ...defaultView(model),
    modules: Array.from({ length: 8 }, (_, index) => ({
      name: `Module ${index + 1}`,
      query: `after:2026-0${(index % 9) + 1}-01`,
      colorKey: index % 6,
    })),
  };
  assert.ok(shareFragment(full).length < VIEW_BUDGET);
});

test("share: corrupt and foreign payloads are refused", () => {
  const { model } = loadDemo();
  assert.equal(decodeView("not-base64!!", model), null);
  assert.equal(decodeView(btoa("{}"), model), null);
  assert.equal(decodeView(btoa(JSON.stringify({ v: 2, repo: model.doc.repo.id })), model), null);
  const foreign = { ...defaultView(model), repo: "another-repo" };
  assert.equal(decodeView(encodeView(foreign), model), null);
});

test("share: the fragment reader only accepts gw=", () => {
  assert.equal(readFragment("#gw=abc"), "abc");
  assert.equal(readFragment("gw=abc"), "abc");
  assert.equal(readFragment("#bw=abc"), null);
  assert.equal(readFragment("#gw="), null);
  assert.equal(readFragment(""), null);
});
