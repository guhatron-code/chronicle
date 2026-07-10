/*
 * The typed IPC layer — the ONLY module that talks to Tauri.
 *
 * Wraps every #[tauri::command] in src-tauri/src/main.rs plus the PTY event streams.
 * Components import from here, never from @tauri-apps/* directly (the one exception:
 * nothing — window controls and the folder dialog are wrapped here too).
 *
 * Arg casing: Tauri converts snake_case Rust args to camelCase on the wire; the only
 * multi-word arg today is `stageAll` (Rust `stage_all`).
 *
 * Value-returning commands start life as `unknown`-backed named aliases; each alias is
 * refined to a real interface during the slice that consumes it (read the Rust
 * serializers in main.rs when you get there — don't guess shapes).
 */
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open as openDialog } from "@tauri-apps/plugin-dialog";

/* ---------- domain types (refine per-slice; see header note) ---------- */
export type PickerData = unknown; // get_picker → { recents: [...] }
export type ProjectData = unknown; // open_project → { dir, name, repo, extras, manifest, ... }
export type StateData = unknown; // get_state → the derived roadmap/git state
export type InitStatusData = unknown; // init_status → { phase, code, log_tail, ... }
export type AgentsData = unknown; // agents_available → { claude, codex, default }
export type GitStatusDetail = unknown; // git_status_detail → { staged: [...], unstaged: [...] }
export type GitLogRow = unknown; // git_log_graph rows → { hash, parents, subject, author, ago, refs }

export interface DirEntry {
  name: string;
  path: string;
  dir: boolean;
}

/* ---------- agents / project lifecycle ---------- */
export const agentsAvailable = () => invoke<AgentsData>("agents_available");
export const setDefaultAgent = (agent: string) =>
  invoke<void>("set_default_agent", { agent });
export const getPicker = () => invoke<PickerData>("get_picker");
export const createProject = (name: string) =>
  invoke<string>("create_project", { name });
export const adoptManifest = (dir: string, sub: string) =>
  invoke<void>("adopt_manifest", { dir, sub });
export const removeRecent = (path: string) =>
  invoke<void>("remove_recent", { path });
export const openProject = (path: string) =>
  invoke<ProjectData>("open_project", { path });
export const getState = (dir: string) => invoke<StateData>("get_state", { dir });
export const initStart = (dir: string, agent: string | null) =>
  invoke<void>("init_start", { dir, agent });
export const initStatus = (dir: string) =>
  invoke<InitStatusData>("init_status", { dir });
/** Stop a running roadmap session (SIGTERM → grace → SIGKILL, always reaped). */
export const initCancel = (dir: string) => invoke<void>("init_cancel", { dir });
/** Persist the per-project consent choice; surfaces as `init_consent` in get_state. */
export const setInitConsent = (dir: string, choice: "auto" | "manual" | "basic") =>
  invoke<void>("set_init_consent", { dir, choice });

/* ---------- git ---------- */
export const gitStatusDetail = (dir: string) =>
  invoke<GitStatusDetail>("git_status_detail", { dir });
export const gitStage = (dir: string, path?: string) =>
  invoke<void>("git_stage", { dir, path });
export const gitUnstage = (dir: string, path: string) =>
  invoke<void>("git_unstage", { dir, path });
export const gitDiscard = (dir: string, path: string, untracked: boolean) =>
  invoke<void>("git_discard", { dir, path, untracked });
export const gitInitHere = (dir: string) => invoke<void>("git_init_here", { dir });
export const gitCommit = (dir: string, message: string, stageAll: boolean) =>
  invoke<void>("git_commit", { dir, message, stageAll }); // Rust: stage_all
export const gitPush = (dir: string) => invoke<void>("git_push", { dir });
export const gitPull = (dir: string) => invoke<void>("git_pull", { dir });
export const gitLogGraph = (dir: string, limit?: number) =>
  invoke<GitLogRow[]>("git_log_graph", { dir, limit });
export const gitDiff = (
  dir: string,
  path: string,
  staged: boolean,
  untracked: boolean,
) => invoke<string>("git_diff", { dir, path, staged, untracked });
/** One-click "Switch branch" (plain checkout; git's own refusal surfaces as the error). */
export const gitCheckout = (dir: string, branch: string) =>
  invoke<void>("git_checkout", { dir, branch });
/** One-click "Clean up stale workspaces"; returns the surviving worktree list. */
export const gitWorktreePrune = (dir: string) =>
  invoke<string>("git_worktree_prune", { dir });

/* ---------- viewer freshness ---------- */
export interface FileStat {
  size: number;
  mtime: number; // unix seconds
  kind: "text" | "image" | "binary";
}
export const statFile = (dir: string, path: string) =>
  invoke<FileStat>("stat_file", { dir, path });
/** Image preview bytes (render as a data: URI — img-src data: is in the CSP). */
export const readFileB64 = (dir: string, path: string) =>
  invoke<string>("read_file_b64", { dir, path });

/* ---------- fs / shell / clipboard ---------- */
export const runCommand = (dir: string, cmd: string) =>
  invoke<string>("run_command", { dir, cmd });
export const listDir = (dir: string, path: string) =>
  invoke<DirEntry[]>("list_dir", { dir, path });
export const readFile = (dir: string, path: string) =>
  invoke<string>("read_file", { dir, path });
export const copyFile = (dir: string, path: string) =>
  invoke<number>("copy_file", { dir, path }); // returns copied char count
export const copyText = (text: string) => invoke<void>("copy_text", { text });

/* ---------- PTY ---------- */
export const ptySpawn = (dir: string, cols: number, rows: number) =>
  invoke<number>("pty_spawn", { dir, cols, rows });
export const ptyWrite = (id: number, data: string) =>
  invoke<void>("pty_write", { id, data });
export const ptyResize = (id: number, cols: number, rows: number) =>
  invoke<void>("pty_resize", { id, cols, rows });
export const ptyKill = (id: number) => invoke<void>("pty_kill", { id });

/*
 * PTY event streams — payload shapes verified against the legacy frontend:
 *   "pty-out"  → [id: number, b64: string]   (base64-encoded chunk)
 *   "pty-exit" → id: number
 * Register ONCE at app scope (not per component mount) and route by id;
 * always return the UnlistenFn from effect cleanup or HMR duplicates writes.
 */
export const onPtyOut = (
  cb: (id: number, b64: string) => void,
): Promise<UnlistenFn> =>
  listen<[number, string]>("pty-out", (e) => cb(e.payload[0], e.payload[1]));
export const onPtyExit = (cb: (id: number) => void): Promise<UnlistenFn> =>
  listen<number>("pty-exit", (e) => cb(e.payload));

/** Decode a pty-out chunk for xterm's write(). */
export const decodePtyChunk = (b64: string): Uint8Array =>
  Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

/* ---------- window chrome + dialogs (frameless window) ---------- */
export const pickFolder = () => openDialog({ directory: true });

export function windowControls() {
  const w = getCurrentWindow();
  return {
    close: () => w.close(),
    minimize: () => w.minimize(),
    toggleMaximize: () => w.toggleMaximize(),
    setTitle: (title: string) => w.setTitle(title),
  };
}
