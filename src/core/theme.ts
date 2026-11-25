/**
 * theme.ts — the colour contract.
 *
 * Four presets, one set of roles. Warmth is attention (open = amber, risk =
 * coral); cool and neutral hues are ref identity; violet marks agent
 * authorship; blue marks review. No colour ships without a token, and the CSS
 * `:root` blocks and these definitions are checked against each other by
 * tests/theme.test.ts.
 */

import type { ThemeName } from "./types.ts";

export interface ThemeTokens {
  bg: string;
  stageGlow: string;
  panel: string;
  panelHi: string;
  panelHover: string;
  line: string;
  lineSoft: string;
  lineHi: string;
  text: string;
  dim: string;
  dimmer: string;
  handle: string;
  ok: string;
  okHi: string;
  okLow: string;
  open: string;
  risk: string;
  agent: string;
  review: string;
  /** The colour the depth field recedes toward (front slice = the metric). */
  depth: string;
}

export interface ThemeDef {
  id: ThemeName;
  label: string;
  note: string;
  tokens: ThemeTokens;
  /** Six identity slots; slot 5 is a neutral so it can never read as warmth. */
  identity: string[];
}

const SIGNAL: ThemeTokens = {
  bg: "#07090d",
  stageGlow: "#0b1018",
  panel: "#0c0f15",
  panelHi: "#121721",
  panelHover: "#181f2c",
  line: "#1b2230",
  lineSoft: "#131822",
  lineHi: "#2a3548",
  text: "#e9eff8",
  dim: "#828fa6",
  dimmer: "#65738c",
  handle: "#f0fdf7",
  ok: "#34d399",
  okHi: "#5eead4",
  okLow: "#22c55e",
  open: "#f5b544",
  risk: "#fb7185",
  agent: "#a78bfa",
  review: "#60a5fa",
  depth: "#4f46e5",
};

const KILOHEARTS: ThemeTokens = {
  bg: "#121417",
  stageGlow: "#161b24",
  panel: "#181b20",
  panelHi: "#20252d",
  panelHover: "#282f3a",
  line: "#2b323e",
  lineSoft: "#20252e",
  lineHi: "#3d495c",
  text: "#edf2fa",
  dim: "#9aa6ba",
  dimmer: "#77849a",
  handle: "#f0f7ff",
  ok: "#5599ff",
  okHi: "#8ec5ff",
  okLow: "#3b82f6",
  open: "#f5b544",
  risk: "#fb7185",
  agent: "#a78bfa",
  review: "#60a5fa",
  depth: "#2563eb",
};

const VELVET: ThemeTokens = {
  bg: "#0b0612",
  stageGlow: "#140b21",
  panel: "#110a1a",
  panelHi: "#191026",
  panelHover: "#221633",
  line: "#2c1b42",
  lineSoft: "#1d122d",
  lineHi: "#462b69",
  text: "#f3ecfc",
  dim: "#a28eb8",
  dimmer: "#84709c",
  handle: "#eafffe",
  ok: "#2eead8",
  okHi: "#7cf7ec",
  okLow: "#14b8a6",
  open: "#fbbf24",
  risk: "#fb7185",
  agent: "#e879f9",
  review: "#60a5fa",
  depth: "#7e22ce",
};

const CIRCUIT: ThemeTokens = {
  bg: "#05070a",
  stageGlow: "#071019",
  panel: "#090d14",
  panelHi: "#0e1520",
  panelHover: "#131d2c",
  line: "#162436",
  lineSoft: "#0e1825",
  lineHi: "#243b57",
  text: "#e8f4fc",
  dim: "#7fa0be",
  dimmer: "#5c7a96",
  handle: "#ecfeff",
  ok: "#22d3ee",
  okHi: "#67e8f9",
  okLow: "#06b6d4",
  open: "#f5b544",
  risk: "#fb7185",
  agent: "#a78bfa",
  review: "#38bdf8",
  depth: "#1d4ed8",
};

const ACID: ThemeTokens = {
  bg: "#090c0b",
  stageGlow: "#0e1612",
  panel: "#0f1412",
  panelHi: "#151d1a",
  panelHover: "#1c2723",
  line: "#22302b",
  lineSoft: "#17211d",
  lineHi: "#32473f",
  text: "#eef7f0",
  dim: "#8aa395",
  dimmer: "#6a8375",
  handle: "#f7fee7",
  ok: "#84f03c",
  okHi: "#bef264",
  okLow: "#4ade80",
  open: "#facc15",
  risk: "#fb7185",
  agent: "#c084fc",
  review: "#38bdf8",
  depth: "#15803d",
};

const EMBER: ThemeTokens = {
  bg: "#0a0806",
  stageGlow: "#120d08",
  panel: "#14100b",
  panelHi: "#1c1711",
  panelHover: "#251d15",
  line: "#2b231a",
  lineSoft: "#1e1812",
  lineHi: "#3a2f22",
  text: "#f6ede1",
  dim: "#a2917d",
  dimmer: "#7d6c5a",
  handle: "#fff6e8",
  ok: "#f5b544",
  okHi: "#fcd34d",
  okLow: "#d97706",
  open: "#fb923c",
  risk: "#ef4444",
  agent: "#c084fc",
  review: "#60a5fa",
  depth: "#b45309",
};

const SPECTRAL: ThemeTokens = {
  bg: "#05080f",
  stageGlow: "#070d18",
  panel: "#0a111d",
  panelHi: "#0e1828",
  panelHover: "#132036",
  line: "#17263a",
  lineSoft: "#0f1a2a",
  lineHi: "#22344d",
  text: "#e6eefc",
  dim: "#8397b5",
  dimmer: "#5a6f8f",
  handle: "#eff6ff",
  ok: "#22d3ee",
  okHi: "#67e8f9",
  okLow: "#0891b2",
  open: "#fbbf24",
  risk: "#fb7185",
  agent: "#a78bfa",
  review: "#60a5fa",
  depth: "#7c3aed",
};

const BITWAVE: ThemeTokens = {
  bg: "#08090c",
  stageGlow: "#0b0e13",
  panel: "#0d1015",
  panelHi: "#12161d",
  panelHover: "#181d26",
  line: "#1b212b",
  lineSoft: "#141920",
  lineHi: "#2a3341",
  text: "#e8edf5",
  dim: "#7c879c",
  dimmer: "#5f6b80",
  handle: "#eafaf3",
  ok: "#34d399",
  okHi: "#5eead4",
  okLow: "#22c55e",
  open: "#f5b544",
  risk: "#f87171",
  agent: "#a78bfa",
  review: "#60a5fa",
  depth: "#0f766e",
};

const MONO: ThemeTokens = {
  bg: "#090a0d",
  stageGlow: "#101218",
  panel: "#111318",
  panelHi: "#181b22",
  panelHover: "#20242e",
  line: "#252a36",
  lineSoft: "#1a1e27",
  lineHi: "#384052",
  text: "#f1f5f9",
  dim: "#94a3b8",
  dimmer: "#748296",
  handle: "#ffffff",
  ok: "#cbd5e1",
  okHi: "#f8fafc",
  okLow: "#94a3b8",
  open: "#f5b544",
  risk: "#fb7185",
  agent: "#c4b5fd",
  review: "#93c5fd",
  depth: "#475569",
};

export const THEMES: Record<ThemeName, ThemeDef> = {
  signal: {
    id: "signal",
    label: "Emerald Signal",
    note: "multi-hue semantic — mint trunk, cool refs, amber playhead",
    tokens: SIGNAL,
    identity: ["#34d399", "#38bdf8", "#818cf8", "#c084fc", "#a3e635", "#94a3b8"],
  },
  kilohearts: {
    id: "kilohearts",
    label: "Kilohearts Blue",
    note: "matte charcoal studio — translucent electric blue wavetables",
    tokens: KILOHEARTS,
    identity: ["#5599ff", "#38bdf8", "#818cf8", "#60a5fa", "#5eead4", "#cbd5e1"],
  },
  velvet: {
    id: "velvet",
    label: "Neon Purple",
    note: "obsidian plum — luminous cyan-mint waves and orchid accents",
    tokens: VELVET,
    identity: ["#2eead8", "#e879f9", "#60a5fa", "#c084fc", "#38bdf8", "#cbd5e1"],
  },
  circuit: {
    id: "circuit",
    label: "Cyan Circuit",
    note: "obsidian black — high-contrast phosphor cyan & deep cobalt",
    tokens: CIRCUIT,
    identity: ["#22d3ee", "#38bdf8", "#60a5fa", "#818cf8", "#2dd4bf", "#94a3b8"],
  },
  acid: {
    id: "acid",
    label: "Acid Lime",
    note: "dark graphite — electric lime wavetables and bright yellow playhead",
    tokens: ACID,
    identity: ["#84f03c", "#34d399", "#a3e635", "#2dd4bf", "#38bdf8", "#cbd5e1"],
  },
  ember: {
    id: "ember",
    label: "Classic Orange",
    note: "warm obsidian — amber and copper waves, coral risk",
    tokens: EMBER,
    identity: ["#f5b544", "#fb923c", "#d97706", "#eab308", "#fde68a", "#f9a8d4"],
  },
  spectral: {
    id: "spectral",
    label: "Spectral Violet",
    note: "midnight navy — cyan-to-violet spectrum, warmth only for risk",
    tokens: SPECTRAL,
    identity: ["#34d399", "#06b6d4", "#3b82f6", "#6366f1", "#a855f7", "#94a3b8"],
  },
  bitwave: {
    id: "bitwave",
    label: "BitWave Mint",
    note: "sister palette — emerald identity, amber tension",
    tokens: BITWAVE,
    identity: ["#34d399", "#2dd4bf", "#5eead4", "#a3e635", "#94a3b8", "#67e8f9"],
  },
  mono: {
    id: "mono",
    label: "Graphite Mono",
    note: "matte carbon — silver-ice wavetables with amber attention",
    tokens: MONO,
    identity: ["#e2e8f0", "#cbd5e1", "#94a3b8", "#a5b4fc", "#bae6fd", "#d4d4d8"],
  },
};

export const THEME_IDS: ThemeName[] = [
  "signal",
  "kilohearts",
  "velvet",
  "circuit",
  "acid",
  "ember",
  "spectral",
  "bitwave",
  "mono",
];
export const THEME_LIST: ThemeDef[] = THEME_IDS.map((id) => THEMES[id]);

const TOKEN_VAR: Record<keyof ThemeTokens, string> = {
  bg: "--bg",
  stageGlow: "--stage-glow",
  panel: "--panel",
  panelHi: "--panel-hi",
  panelHover: "--panel-hover",
  line: "--line",
  lineSoft: "--line-soft",
  lineHi: "--line-hi",
  text: "--text",
  dim: "--dim",
  dimmer: "--dimmer",
  handle: "--handle-hi",
  ok: "--ok",
  okHi: "--ok-hi",
  okLow: "--ok-low",
  open: "--open",
  risk: "--risk",
  agent: "--agent",
  review: "--review",
  depth: "--depth",
};

export function tokenVar(name: keyof ThemeTokens): string {
  return TOKEN_VAR[name];
}

export function identityColor(theme: ThemeName, colorKey: number): string {
  const def = THEMES[theme];
  return def.identity[colorKey] ?? def.identity[def.identity.length - 1];
}

export function tokenColor(theme: ThemeName, name: keyof ThemeTokens): string {
  return THEMES[theme].tokens[name];
}

/* ---- colour maths (done by tests and by the renderers) ------------------- */

const rgbCache = new Map<string, readonly [number, number, number]>();

export function hexToRgb(hex: string): [number, number, number] {
  const hit = rgbCache.get(hex);
  if (hit) return [hit[0], hit[1], hit[2]];
  const h = hex.replace("#", "");
  const full =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h;
  const n = parseInt(full, 16);
  const rgb: [number, number, number] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  if (rgbCache.size < 512) rgbCache.set(hex, rgb);
  return [rgb[0], rgb[1], rgb[2]];
}

/** Fast cached RGB lookup (do not mutate returned tuple). */
export function hexToRgbFast(hex: string): readonly [number, number, number] {
  const hit = rgbCache.get(hex);
  if (hit) return hit;
  const rgb = hexToRgb(hex);
  return rgbCache.get(hex) ?? rgb;
}

export function rgbToHex(rgb: [number, number, number]): string {
  return (
    "#" +
    rgb
      .map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0"))
      .join("")
  );
}

export function rgba(hex: string, alpha: number): string {
  const rgb = hexToRgbFast(hex);
  return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha})`;
}

export function mixHex(a: string, b: string, t: number): string {
  const A = hexToRgbFast(a);
  const B = hexToRgbFast(b);
  const k = Math.max(0, Math.min(1, t));
  return rgbToHex([
    A[0] + (B[0] - A[0]) * k,
    A[1] + (B[1] - A[1]) * k,
    A[2] + (B[2] - A[2]) * k,
  ]);
}

/** Mix two RGB triples directly into a CSS rgba() string with zero hex round-trip. */
export function rgbaMixRgb(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  t: number,
  alpha: number
): string {
  const k = t < 0 ? 0 : t > 1 ? 1 : t;
  const r = Math.round(a[0] + (b[0] - a[0]) * k);
  const g = Math.round(a[1] + (b[1] - a[1]) * k);
  const bl = Math.round(a[2] + (b[2] - a[2]) * k);
  return `rgba(${r},${g},${bl},${alpha.toFixed(3)})`;
}

export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((value) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

export function hslOf(hex: string): { h: number; s: number; l: number } {
  const [r0, g0, b0] = hexToRgb(hex);
  const r = r0 / 255;
  const g = g0 / 255;
  const b = b0 / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h = h * 60;
  if (h < 0) h += 360;
  return { h, s, l };
}

export function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

export function ageColor(theme: ThemeName, ageNorm: number): string {
  const t = THEMES[theme].tokens;
  return mixHex(t.open, t.risk, Math.max(0, Math.min(1, ageNorm)));
}
