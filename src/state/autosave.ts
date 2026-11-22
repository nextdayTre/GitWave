/**
 * autosave.ts — localStorage is a convenience, never a requirement.
 *
 * The view is saved canonically (no playing state, fixed key order). The
 * previous snapshot time is kept so a freshly loaded document can say how many
 * commits landed since the last visit.
 */

import { canonicalView } from "../core/share.ts";
import { validateView } from "../core/view.ts";
import type { Model, View } from "../core/types.ts";

const VIEW_KEY = (id: string) => `gitwave:view:${id}`;
const SEEN_KEY = (id: string) => `gitwave:seen:${id}`;

function storage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function loadAutosave(model: Model): View | null {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(VIEW_KEY(model.doc.repo.id));
    if (!raw) return null;
    return validateView(JSON.parse(raw), model).view;
  } catch {
    return null;
  }
}

export function saveAutosave(view: View): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(VIEW_KEY(view.repo), JSON.stringify(canonicalView(view)));
  } catch {
    /* quota or private mode — the instrument still works */
  }
}

export function loadSeenSnapshot(model: Model): number {
  const store = storage();
  if (!store) return Number.NaN;
  try {
    const raw = store.getItem(SEEN_KEY(model.doc.repo.id));
    const ms = raw === null ? Number.NaN : Number(raw);
    return Number.isFinite(ms) ? ms : Number.NaN;
  } catch {
    return Number.NaN;
  }
}

export function saveSeenSnapshot(model: Model): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(SEEN_KEY(model.doc.repo.id), String(model.snapshotMs));
  } catch {
    /* ignore */
  }
}
