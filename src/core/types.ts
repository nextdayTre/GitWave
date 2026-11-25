/**
 * GitWave core types — the `.gitwave` document and the view state.
 *
 * Everything here is plain data. The document is the *only* source of truth
 * for history; the view is the only thing a gesture may change.
 */

export type RefKind = "trunk" | "branch";
export type PrState = "open" | "merged" | "draft" | "closed";
export type ReviewState = "none" | "required" | "approved" | "changes_requested";
export type ChecksState = "none" | "pending" | "passing" | "failing";
export type AuthorKind = "human" | "agent";
export type SpanKey = "7d" | "30d" | "90d" | "all";
export type ThemeName =
  | "signal"
  | "kilohearts"
  | "velvet"
  | "circuit"
  | "acid"
  | "ember"
  | "spectral"
  | "bitwave"
  | "mono";
export type MotionMode = "sweep" | "bounce" | "once";

export interface PullRequest {
  number: number;
  title: string;
  state: PrState;
  review: ReviewState;
  checks: ChecksState;
  conflicts: boolean;
  draft: boolean;
  mergedAt: string | null;
}

export interface GitRef {
  id: string;
  name: string;
  kind: RefKind;
  base: string | null;
  tip: string;
  createdAt: string;
  mergedAt: string | null;
  colorKey: number;
  pr: PullRequest | null;
}

export interface CommitAuthor {
  name: string;
  kind: AuthorKind;
}

export interface AgentStamp {
  runtime: string;
  model: string;
}

export type FileChangeStatus = "added" | "modified" | "deleted" | "renamed";

export interface CommitFileChange {
  path: string;
  status: FileChangeStatus;
  insertions: number;
  deletions: number;
  patch?: string;
}

export interface Commit {
  sha: string;
  parents: string[];
  time: string;
  author: CommitAuthor;
  agent: AgentStamp | null;
  subject: string;
  insertions: number;
  deletions: number;
  files: number;
  refs: string[];
  merge: boolean;
  /** Optional list of file paths touched by this commit (enables `path:` filters & folder wavetables). */
  paths?: string[];
  /** Optional file-level diffs when exported with patch data. */
  changes?: CommitFileChange[];
}

export interface Tag {
  name: string;
  sha: string;
  time: string;
}

export interface RepoDoc {
  schemaVersion: 1;
  tool: "gitwave";
  generatedBy?: string;
  repo: {
    id: string;
    name: string;
    defaultRef: string;
    snapshotAt: string;
    span: { from: string; to: string };
  };
  refs: GitRef[];
  commits: Commit[];
  tags: Tag[];
  scale: { churnCeiling: number; levels: number };
}

export interface Lens {
  age: boolean;
  agents: boolean;
  prs: boolean;
}

export interface Motion {
  playing: boolean;
  mode: MotionMode;
  rate: number;
}

/** A saved filter in the oscillator rack. */
export interface ViewModule {
  name: string;
  query: string;
  colorKey: number;
}

export interface View {
  v: 1;
  repo: string;
  end: string;
  span: SpanKey;
  refs: string[];
  focusRef: string;
  focusSha: string | null;
  theme: ThemeName;
  lens: Lens;
  motion: Motion;
  tray: boolean;
  /** 3D depth field: the focused ref (or the search filter) through time. */
  depth: boolean;
  /** Commit filter; empty means no filter. */
  query: string;
  /** Saved filters shown as 3D oscillator modules. */
  modules: ViewModule[];
  /** In 3D, show the rack (true) or the expanded depth field (false). */
  rack: boolean;
}

export interface Model {
  doc: RepoDoc;
  startMs: number;
  snapshotMs: number;
  commitBySha: Map<string, Commit>;
  commitsByRef: Map<string, Commit[]>;
  refsById: Map<string, GitRef>;
  tagsByTime: Tag[];
  /** Pre-parsed commit timestamps aligned with `doc.commits` (avoids Date.parse in hot loops). */
  commitTimeMs: Float64Array;
  commitTimeBySha: Map<string, number>;
  refTipMs: Map<string, number>;
  refCreatedMs: Map<string, number>;
}
