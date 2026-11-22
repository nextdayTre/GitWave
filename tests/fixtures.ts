/**
 * Shared test fixture loader. Reads the committed demo document exactly once.
 */

import { readFileSync } from "node:fs";
import { parseDoc, buildModel, freezeDoc } from "../src/core/model.ts";
import type { RepoDoc } from "../src/core/types.ts";

const RAW_TEXT = readFileSync(new URL("../src/data/demo.gitwave.json", import.meta.url), "utf8");

export function rawDemo(): unknown {
  return JSON.parse(RAW_TEXT);
}

export function rawDemoText(): string {
  return RAW_TEXT;
}

export function loadDemo(): { raw: unknown; doc: RepoDoc; model: ReturnType<typeof buildModel> } {
  const parsed = parseDoc(JSON.parse(RAW_TEXT));
  if (!parsed.ok) throw new Error(`demo fixture is invalid: ${parsed.errors.join("; ")}`);
  const doc = freezeDoc(parsed.doc);
  return { raw: JSON.parse(RAW_TEXT), doc, model: buildModel(doc) };
}

export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
