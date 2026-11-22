/**
 * share.ts — the `#gw=` view codec.
 *
 * A link carries the *view*, never the dataset: the receiving page must already
 * have the same document loaded (id match). Canonical links force
 * `motion.playing: false`, so a shared link can never autoplay the transport.
 */

import type { Model, View } from "./types.ts";
import { validateView } from "./view.ts";

export const VIEW_BUDGET = 2000;
export const FRAGMENT_KEY = "gw";

export interface CanonicalView {
  v: 1;
  repo: string;
  end: string;
  span: string;
  refs: string[];
  focusRef: string;
  focusSha: string | null;
  theme: string;
  lens: { age: boolean; agents: boolean; prs: boolean };
  motion: { playing: false; mode: string; rate: number };
  tray: boolean;
  depth: boolean;
  query: string;
  modules: Array<{ name: string; query: string; colorKey: number }>;
  rack: boolean;
}

/** Fixed key order and no transient state — equal views give equal links. */
export function canonicalView(view: View): CanonicalView {
  return {
    v: 1,
    repo: view.repo,
    end: view.end,
    span: view.span,
    refs: [...view.refs],
    focusRef: view.focusRef,
    focusSha: view.focusSha,
    theme: view.theme,
    lens: { age: view.lens.age, agents: view.lens.agents, prs: view.lens.prs },
    motion: { playing: false, mode: view.motion.mode, rate: view.motion.rate },
    tray: view.tray,
    depth: view.depth,
    query: view.query,
    modules: view.modules.map((module) => ({
      name: module.name,
      query: module.query,
      colorKey: module.colorKey,
    })),
    rack: view.rack,
  };
}

function base64UrlEncode(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(text: string): string {
  let base64 = text.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4) base64 += "=";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export function encodeView(view: View): string {
  return base64UrlEncode(JSON.stringify(canonicalView(view)));
}

export function decodeView(text: string, model: Model): View | null {
  try {
    const parsed: unknown = JSON.parse(base64UrlDecode(text));
    if (typeof parsed !== "object" || parsed === null) return null;
    const candidate = parsed as { v?: unknown; repo?: unknown };
    if (candidate.v !== 1) return null;
    if (candidate.repo !== model.doc.repo.id) return null;
    return validateView(parsed, model).view;
  } catch {
    return null;
  }
}

export function shareFragment(view: View): string {
  return `${FRAGMENT_KEY}=${encodeView(view)}`;
}

/** Pull the `gw=` payload out of a location.hash (null when absent/corrupt). */
export function readFragment(hash: string): string | null {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!raw.startsWith(`${FRAGMENT_KEY}=`)) return null;
  const payload = raw.slice(FRAGMENT_KEY.length + 1);
  return payload || null;
}
