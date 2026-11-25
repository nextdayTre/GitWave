/**
 * desktop.ts — zero-network Tauri 2 native desktop bridge adapter.
 *
 * When running inside standalone `gitwave.html` in a regular browser,
 * `window.__TAURI__` is undefined and this module is a clean no-op (zero
 * `fetch()`, zero URLs, 100% offline compliant).
 *
 * When running inside the cross-platform Tauri 2 desktop app (Windows / macOS /
 * Linux), it binds GitWave directly to native Rust IPC commands (`discover_repos`,
 * `load_repo_snapshot`, `read_repo_file`, `pick_workspace_folder`) and listens
 * for live Agent Bridge events emitted by Tauri's built-in local bridge.
 */

interface TauriCore {
  invoke: <T = unknown>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
}

interface TauriEventApi {
  listen: <T = unknown>(
    event: string,
    handler: (ev: { payload: T }) => void
  ) => Promise<() => void>;
}

interface GlobalTauri {
  core?: TauriCore;
  event?: TauriEventApi;
}

function getTauri(): GlobalTauri | null {
  if (typeof window === "undefined") return null;
  const t = (window as unknown as { __TAURI__?: GlobalTauri }).__TAURI__;
  return t && t.core && typeof t.core.invoke === "function" ? t : null;
}

export function isDesktopRuntime(): boolean {
  return getTauri() !== null;
}

export function initDesktopBridge(): void {
  const tauri = getTauri();
  if (!tauri || !tauri.core) return;
  const invoke = tauri.core.invoke;
  const gw = (window as unknown as { gitwave?: Record<string, (...args: unknown[]) => unknown> }).gitwave;
  if (!gw) return;

  let loadSeq = 0;
  let activeRepoPath = "";
  let cachedRepos: unknown[] = [];
  let activeSync: unknown = null;

  async function handleAction(action: { method?: string; params?: Record<string, unknown> }) {
    if (!action || typeof action.method !== "string") return;
    const params = action.params ?? {};

    if (action.method === "readFile") {
      const relPath = typeof params.path === "string" ? params.path : "";
      try {
        const file = await invoke<Record<string, unknown>>("read_repo_file", {
          repoPath: activeRepoPath,
          relPath,
        });
        gw.setFilePreview?.(file);
      } catch (err) {
        gw.setFilePreview?.({
          path: relPath,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      return;
    }

    if (action.method === "pickFolder") {
      try {
        const picked = await invoke<string | null>("pick_workspace_folder");
        if (!picked) return;
        const repos = await invoke<unknown[]>("discover_repos", { rootPath: picked });
        cachedRepos = Array.isArray(repos) ? repos : [];
        const firstReal = (cachedRepos as Array<{ repoPath?: string; unborn?: boolean }>).find(
          (r) => r.repoPath && !r.unborn
        );
        if (firstReal?.repoPath) {
          await handleAction({ method: "loadRepo", params: { path: firstReal.repoPath } });
        } else {
          gw.applyLiveState?.({
            repos: cachedRepos,
            onAction: handleAction,
            announceText: `mounted ${picked} (${cachedRepos.length} repos)`,
          });
        }
      } catch (err) {
        gw.applyLiveState?.({
          announceText: `could not open folder: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
      return;
    }

    if (action.method === "loadRepo" || action.method === "refresh") {
      const mySeq = ++loadSeq;
      const target =
        action.method === "loadRepo" && typeof params.path === "string"
          ? params.path
          : activeRepoPath;
      if (!target) return;
      try {
        const res = await invoke<{
          unborn?: boolean;
          doc?: unknown;
          sync?: { repoPath?: string; repoName?: string; workingTree?: { dirtyCount?: number } };
        }>("load_repo_snapshot", {
          repoPath: target,
          force: action.method === "refresh",
        });
        if (mySeq !== loadSeq) return;
        if (res.unborn || !res.doc) {
          gw.applyLiveState?.({
            repos: cachedRepos,
            onAction: handleAction,
            announceText: `${res.sync?.repoName ?? "repo"} has no commits yet`,
          });
          return;
        }
        activeRepoPath = res.sync?.repoPath ?? target;
        activeSync = res.sync ?? null;
        gw.applyLiveState?.({
          doc: res.doc,
          sync: activeSync,
          repos: cachedRepos,
          onAction: handleAction,
          preserveMode: true,
          announceText: `loaded ${res.sync?.repoName ?? "repo"}`,
        });
      } catch (err) {
        if (mySeq !== loadSeq) return;
        gw.applyLiveState?.({
          announceText: `repo load failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }
  }

  /* Subscribe to native Agent Bridge commands (MCP / CLI -> desktop app) */
  if (tauri.event && typeof tauri.event.listen === "function") {
    void tauri.event.listen<{ method?: string; params?: Record<string, unknown> }>(
      "gitwave://command",
      (ev) => {
        const cmd = ev.payload;
        if (!cmd || typeof cmd.method !== "string") return;
        if (cmd.method === "loadRepo" || cmd.method === "refresh" || cmd.method === "readFile") {
          void handleAction(cmd);
        } else {
          gw.dispatch?.(cmd);
        }
      }
    );
  }

  /* Initial desktop workspace bootstrap */
  void (async () => {
    try {
      const boot = await invoke<{
        rootPath: string;
        activeRepo: string | null;
        repos: unknown[];
        snapshot?: { unborn?: boolean; doc?: unknown; sync?: { repoPath?: string; repoName?: string } } | null;
      }>("bootstrap_workspace");
      cachedRepos = Array.isArray(boot.repos) ? boot.repos : [];
      if (boot.snapshot && !boot.snapshot.unborn && boot.snapshot.doc) {
        activeRepoPath = boot.snapshot.sync?.repoPath ?? boot.activeRepo ?? "";
        activeSync = boot.snapshot.sync ?? null;
        gw.applyLiveState?.({
          doc: boot.snapshot.doc,
          sync: activeSync,
          repos: cachedRepos,
          onAction: handleAction,
          preserveMode: true,
          agent: {
            liveConnected: true,
            visible: true,
            repo: boot.snapshot.sync?.repoName ?? "",
            task: "Desktop native bridge active",
          },
          announceText: `desktop: ${boot.snapshot.sync?.repoName ?? "ready"} (${cachedRepos.length} repos)`,
        });
      } else {
        gw.applyLiveState?.({
          repos: cachedRepos,
          onAction: handleAction,
          agent: { liveConnected: true, visible: true, task: "Desktop ready — pick a repository" },
        });
      }
    } catch {
      /* keep bundled demo loaded cleanly */
    }
  })();
}
