import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  THEMES,
  THEME_IDS,
  contrastRatio,
  hexToRgb,
  hslOf,
  hueDistance,
  tokenVar,
} from "../src/core/theme.ts";

const CSS = readFileSync(new URL("../src/styles/app.css", import.meta.url), "utf8");

function block(theme: string): string {
  const match = CSS.match(new RegExp(`:root\\[data-theme="${theme}"\\]\\s*\\{([\\s\\S]*?)\\}`));
  return match ? match[1] : "";
}

function tokensOf(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const match of text.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    out[match[1]] = match[2].trim();
  }
  return out;
}

test("theme: every preset is defined in CSS with the documented tokens", () => {
  for (const theme of THEME_IDS) {
    const css = tokensOf(block(theme));
    assert.ok(Object.keys(css).length > 10, `${theme} block is missing`);
    for (const [key, value] of Object.entries(THEMES[theme].tokens)) {
      const name = tokenVar(key as keyof typeof THEMES.signal.tokens).slice(2);
      assert.equal(css[name], value, `${theme} ${name}`);
    }
    for (let i = 0; i < 6; i++) {
      assert.equal(css[`id${i}`], THEMES[theme].identity[i], `${theme} id${i}`);
    }
  }
});

test("theme: text, secondary text and tertiary labels meet their contrast tiers", () => {
  for (const theme of THEME_IDS) {
    const t = THEMES[theme].tokens;
    assert.ok(contrastRatio(t.text, t.bg) >= 7, `${theme} text vs bg`);
    assert.ok(contrastRatio(t.dim, t.panel) >= 4.5, `${theme} dim vs panel`);
    assert.ok(contrastRatio(t.dimmer, t.panel) >= 3, `${theme} dimmer vs panel`);
    for (const color of [t.ok, t.open, t.risk, t.agent, t.review, ...THEMES[theme].identity]) {
      assert.ok(contrastRatio(color, t.bg) >= 3, `${theme} ${color} vs bg`);
    }
  }
});

test("theme: identity slots are distinct, and Signal keeps warmth for attention", () => {
  const signal = THEMES.signal;
  const warm = [hslOf(signal.tokens.open).h, hslOf(signal.tokens.risk).h];
  const saturated = signal.identity
    .map((color) => ({ color, ...hslOf(color) }))
    .filter((entry) => entry.s >= 0.25);

  for (const entry of saturated) {
    for (const warmHue of warm) {
      assert.ok(
        hueDistance(entry.h, warmHue) >= 35,
        `${entry.color} is too close to a reserved warm hue`
      );
    }
  }
  for (let i = 0; i < saturated.length; i++) {
    for (let j = i + 1; j < saturated.length; j++) {
      assert.ok(
        hueDistance(saturated[i].h, saturated[j].h) >= 22,
        `${saturated[i].color} and ${saturated[j].color} are too close`
      );
    }
  }
});

test("theme: the semantic hues are distinct from each other", () => {
  const t = THEMES.signal.tokens;
  const hues = [t.ok, t.open, t.risk, t.agent, t.review].map((color) => hslOf(color).h);
  for (let i = 0; i < hues.length; i++) {
    for (let j = i + 1; j < hues.length; j++) {
      assert.ok(hueDistance(hues[i], hues[j]) >= 25, `semantic hues ${i}/${j} collide`);
    }
  }
});

test("theme: the canvas renderers introduce no ad-hoc hues", () => {
  for (const file of [
    "../src/render/canvas.js",
    "../src/render/tension.js",
    "../src/render/depth.js",
    "../src/render/rack.js",
  ]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(source), `${file} contains a hex colour`);
  }
});

test("theme: every token value is a 6-digit hex colour", () => {
  for (const theme of THEME_IDS) {
    for (const color of Object.values(THEMES[theme].tokens)) {
      assert.match(color, /^#[0-9a-f]{6}$/, `${theme} ${color}`);
      assert.equal(hexToRgb(color).length, 3);
    }
    for (const color of THEMES[theme].identity) {
      assert.match(color, /^#[0-9a-f]{6}$/, `${theme} identity ${color}`);
    }
  }
});
