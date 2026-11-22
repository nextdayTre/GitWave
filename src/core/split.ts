/**
 * split.ts — turning one filter into its children.
 *
 * "Split by author" or "split by ref" is the expanding-node gesture: a module
 * is a filter, and its children are the groups inside it. The same search that
 * draws the parent's surface decides the groups, so the rack can never show a
 * child that the parent's data does not contain.
 */

import type { Model, ViewModule } from "./types.ts";
import { searchCommits } from "./search.ts";

export interface ModuleSeed extends ViewModule {
  count: number;
}

const COLOR_ORDER = [1, 2, 3, 4, 5, 0];

export function splitModules(
  model: Model,
  query: string,
  by: "author" | "ref",
  limit = 4
): ModuleSeed[] {
  const search = searchCommits(model, query);
  const commits = search.query ? search.matches : model.doc.commits;
  const groups = new Map<
    string,
    { name: string; query: string; count: number; colorKey: number }
  >();

  for (const commit of commits) {
    if (by === "author") {
      const name = commit.author.name;
      const first = name.split(/\s+/)[0].toLowerCase();
      const key = `author:${first}`;
      const existing = groups.get(key);
      if (existing) existing.count += 1;
      else groups.set(key, { name, query: key, count: 1, colorKey: 0 });
    } else {
      for (const refId of commit.refs) {
        const ref = model.refsById.get(refId);
        if (!ref) continue;
        const key = `ref:${ref.id}`;
        const existing = groups.get(key);
        if (existing) existing.count += 1;
        else groups.set(key, { name: ref.id, query: key, count: 1, colorKey: ref.colorKey });
      }
    }
  }

  return [...groups.values()]
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map((group, index) => ({
      ...group,
      colorKey: by === "ref" ? group.colorKey : COLOR_ORDER[index % COLOR_ORDER.length],
    }));
}
