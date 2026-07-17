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
/** get_picker → one recents row (shape read from main.rs get_picker). */
export interface PickerRecent {
  name: string;
  path: string;
  opened_at: string; // epoch seconds as a string
  description?: string;
  summary?: string;
  missing?: boolean;
  current?: { id?: string; name?: string; label?: string } | null;
  done?: number;
  total?: number;
  needs?: number;
}
export interface PickerData {
  recents: PickerRecent[];
}
export type ProjectData = unknown; // open_project → { dir, name, repo, extras, manifest, ... }

/** One derived phase status (get_state.statuses / --derive). */
export interface PhaseStatus {
  id: string;
  state: "done" | "now" | "later" | "window" | "pool";
  label: string;
}

/** A manifest phase as the MERGED manifest carries it (incl. kanban FX overlays). */
export interface ManifestPhase {
  id?: string;
  name?: string;
  desc?: string;
  items?: string[];
  paste?: { path?: string; label?: string; into?: string; when?: string }[];
  docs?: { path: string }[];
  pool?: boolean;
  window?: boolean;
  status?: { blocked_note?: string };
  fixRound?: number;
}

export interface ManifestStage {
  title?: string;
  note?: string;
  synthetic?: boolean;
  phases?: ManifestPhase[];
}

export interface Manifest {
  name?: string;
  description?: string;
  workBranch?: string;
  spine?: { path: string }[];
  stages?: ManifestStage[];
}

/** get_state — the full derived shape (read from main.rs state_for_project). */
export interface StateData {
  repo: string;
  dir: string;
  manifest_present: boolean;
  manifest_error: string | null;
  manifest: Manifest | null;
  is_git: boolean;
  git_degraded?: boolean;
  branch: string;
  upstream: boolean;
  ahead: number;
  behind: number;
  remote_url: string;
  commits: number;
  last_commit: string;
  tags: string[];
  worktrees: { path: string; branch: string; prunable: boolean }[];
  dirty: { code: string; path: string }[];
  statuses: PhaseStatus[];
  docs: Record<string, boolean>;
  stale: string[];
  custom_actions: { text?: string; cmd?: string; level?: string }[];
  manifest_warnings: string[];
  work_branch: string | null;
  init_consent: "auto" | "manual" | "basic" | null;
  blank?: boolean;
  misplaced?: string | null;
  checked_at: string;
}
export interface InitStatusData {
  running?: boolean;
  started?: boolean;
  started_at?: number; // epoch ms
  code?: number | null;
  log_tail?: string;
}
export type AgentsData = unknown; // agents_available → { claude, codex, default }
export interface GitStatusFile {
  path: string;
  code: string; // porcelain letter: M A D R C ? …
  untracked?: boolean; // unstaged rows only
}
export interface GitStatusDetail {
  staged: GitStatusFile[];
  unstaged: GitStatusFile[];
}
export interface GitLogRow {
  hash: string;
  parents: string[];
  subject: string;
  author: string;
  ago: string;
  refs: string; // raw %D decoration string
}

/** Matches the Rust `Entry` (list_dir). */
export interface DirEntry {
  name: string;
  is_dir: boolean;
  size: number;
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
export const initStart = (dir: string, agent: string | null, fresh = false) =>
  invoke<void>("init_start", { dir, agent, fresh });
export const initStatus = (dir: string) =>
  invoke<InitStatusData>("init_status", { dir });
/** Stop a running roadmap session (SIGTERM → grace → SIGKILL, always reaped). */
export const initCancel = (dir: string) => invoke<void>("init_cancel", { dir });
/** The init/rebuild session's log file — for the View-full-log terminal tab. */
export const initLogPath = (dir: string) =>
  invoke<string>("init_log_path", { dir });
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
/** E — the plain-language outcome of a push/pull, for the toast. */
export interface RemoteOutcome {
  headline: string;
  detail: string;
  prUrl: string | null;
}
export const gitPush = (dir: string) => invoke<RemoteOutcome>("git_push", { dir });
export const gitPull = (dir: string) => invoke<RemoteOutcome>("git_pull", { dir });
/** https-only, validated in Rust — the PR-hint toast's action. */
export const openUrl = (url: string) => invoke<void>("open_url", { url });
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
  invoke<string>("copy_file", { dir, path }); // returns copied char count (as a string)
export const copyText = (text: string) => invoke<void>("copy_text", { text });


/** Attachment/viewer image MIME by extension (one copy — UI-wide). */
export const IMG_MIME: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  webp: "image/webp", svg: "image/svg+xml", bmp: "image/bmp", ico: "image/x-icon",
  heic: "image/heic", avif: "image/avif",
};

/* ---------- kanban (R4) ---------- */
export type KanbanColumn = "later" | "queued" | "in_progress" | "blocked" | "completed";
export interface KanbanTask {
  id: string; // T-001, sequential per project
  title: string;
  content?: string;
  column: KanbanColumn;
  images?: string[]; // repo-relative (.chronicle/attachments/…)
  links?: string[];
  round?: number | null; // set when frozen into a round
  archived?: boolean; // hidden from the board; kept in the store
  created_at?: number; // ms epoch (frontend-owned)
  updated_at?: number;
}
export interface KanbanRound {
  n: number;
  state: "generating" | "ready" | "failed" | "done";
  kind: "bug fixes" | "feature additions" | null;
  task_ids: string[];
  plan_path: string; // fixes/phase_N_fixes_plan.md
  prompt_path: string; // fixes/phase_N_fixes_prompt.md
}
export interface KanbanStore {
  version: number;
  next_id: number;
  tasks: KanbanTask[];
  rounds: KanbanRound[];
}
export const kanbanGet = (dir: string) => invoke<KanbanStore>("kanban_get", { dir });
export const kanbanSave = (dir: string, data: KanbanStore) =>
  invoke<void>("kanban_save", { dir, data });
/** Save an image attachment; returns the repo-relative path to reference in the task. */
export const kanbanAttach = (dir: string, taskId: string, name: string, b64: string) =>
  invoke<string>("kanban_attach", { dir, taskId, name, b64 });
/** Composer attachment (approach A): save a base64 file into .chronicle/attachments;
 *  returns its repo-relative path to reference in the agent prompt. */
export const agentAttach = (dir: string, name: string, b64: string) =>
  invoke<string>("agent_attach", { dir, name, b64 });
/** Remove one attachment file (jailed to .chronicle/attachments). */
export const kanbanDetach = (dir: string, path: string) =>
  invoke<void>("kanban_detach", { dir, path });
/** "Ready to execute": freeze the queued tasks into a round; returns the round number. */
export const fixesGenerate = (dir: string, agent: string | null) =>
  invoke<number>("fixes_generate", { dir, agent });
export const fixesStatus = (dir: string) => invoke<InitStatusData>("fixes_status", { dir });

/* ---------- feature batch: rounds run headless · journal · search · export ---------- */

/** Run a settled round's prompt in a background session (F1). */
export const roundExecute = (dir: string, n: number, agent: string | null) =>
  invoke<void>("round_execute", { dir, n, agent });
export const roundExecStatus = (dir: string) => invoke<InitStatusData>("round_exec_status", { dir });
export const roundExecCancel = (dir: string) => invoke<void>("round_exec_cancel", { dir });
export const execLogPath = (dir: string) => invoke<string>("exec_log_path", { dir });

/** What a finished round actually did — saves + files, straight from git (F5). */
export interface RoundRetro { saves: { hash: string; subject: string }[]; save_count: number; file_count: number }
export const roundRetro = (dir: string, n: number) => invoke<RoundRetro>("round_retro", { dir, n });

/** The project journal — transitions recorded as they're observed (F2). */
export interface JournalEntry { ts: number; kind: string; text: string }
export const journalAppend = (dir: string, entry: { kind: string; text: string }) =>
  invoke<void>("journal_append", { dir, entry });
export const journalRead = (dir: string, since: number) =>
  invoke<JournalEntry[]>("journal_read", { dir, since });

/** A native macOS notification (osascript — local only). */
export const notifyNative = (title: string, body: string) =>
  invoke<void>("notify", { title, body });

/** Draft a one-line save message from the staged diff (F4 — you gate it). */
export const draftSaveMessage = (dir: string) => invoke<string>("draft_save_message", { dir });

/** One ranked sweep across file names, commit subjects, and plan docs (F6). */
export interface SearchResults {
  files: string[];
  commits: { hash: string; subject: string; ago: string }[];
  docs: { path: string; line: string }[];
}
export const globalSearch = (dir: string, q: string) => invoke<SearchResults>("global_search", { dir, q });

/* ---------- the project watcher: file changes poll NOW, not in ≤8s ---------- */
export const watchProject = (dir: string) => invoke<void>("watch_project", { dir });
export const unwatchProject = (dir: string) => invoke<void>("unwatch_project", { dir });

/* ---------- GitHub via the user's gh CLI (no tokens in Chronicle) ---------- */
export interface GithubRepo {
  nameWithOwner: string;
  description: string | null;
  updatedAt: string;
  isPrivate: boolean;
}
export const githubRepos = () => invoke<GithubRepo[]>("github_repos");
/** Clone into ~/Documents/GitHub (reused if already there); returns the path. */
export const githubClone = (repo: string) => invoke<string>("github_clone", { repo });
/** Create the private online copy and publish; returns the repo name. */
export const githubCreate = (dir: string) => invoke<string>("github_create", { dir });

/** The roadmap state as sendable markdown (F7). */
export const statusReport = (dir: string) => invoke<string>("status_report", { dir });
export const fixesCancel = (dir: string) => invoke<void>("fixes_cancel", { dir });
/** The fixes session's log file — for the View-full-log terminal tab. */
export const fixesLogPath = (dir: string) =>
  invoke<string>("fixes_log_path", { dir });

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

/** G — what's actually running in the pty's foreground. */
export const ptyInfo = (id: number) =>
  invoke<{ name: string | null; agent: "claude" | "codex" | null }>("pty_info", { id });

/* ---------- the doctor (setup & health — src-tauri/src/setup.rs) ---------- */

/** One check's detected state. */
export interface SetupCheck {
  id: string;
  state: "ready" | "missing" | "needs_you" | "blocked" | "checking" | "installing" | "couldnt_finish";
  detail?: string;
  action?: string; // install | signin | fix_path | ""
  pct?: number | null;
  gotBytes?: number;
  totalBytes?: number;
  tech?: string | null;
}
export interface SetupStatus {
  checks: SetupCheck[];
  ready: number;
  total: number;
}
export const setupStatus = () => invoke<SetupStatus>("setup_status");
export const setupInstall = (check: string) => invoke("setup_install", { check });
export const setupFixTerminalPath = () => invoke("setup_fix_terminal_path");
export const setupCancel = (check: string) => invoke("setup_cancel", { check });
export const setupRunAll = () => invoke("setup_run_all");
export const setupOpenLogin = (kind: string) =>
  invoke<{ title: string }>("setup_open_login", { kind });
export const onSetupUpdate = (cb: (u: { message: SetupCheck & { state?: string } }) => void): Promise<UnlistenFn> =>
  listen<{ message: SetupCheck & { state?: string } }>("setup-update", (e) => cb(e.payload));

/** Decode a pty-out chunk for xterm's write(). */
export const decodePtyChunk = (b64: string): Uint8Array =>
  Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

/* ---------- the agent pane (ACP — src-tauri/src/acp.rs) ---------- */

/** One `acp-update` event: the raw agent→client JSON plus our session key.
 *  Chronicle lifecycle events ride the same channel as `_chronicle/*` methods. */
export interface AcpUpdate {
  dir: string;
  message: {
    id?: unknown;
    method?: string;
    params?: Record<string, unknown>;
    [k: string]: unknown;
  };
}
export const agentSessionStart = (dir: string) => invoke("agent_session_start", { dir });
export const agentSessionState = (dir: string) => invoke<Record<string, unknown>>("agent_session_state", { dir });
export const agentPrompt = (dir: string, message: string) => invoke("agent_prompt", { dir, message });
export const agentCancel = (dir: string) => invoke("agent_cancel", { dir });
export const agentSetMode = (dir: string, mode: string) => invoke("agent_set_mode", { dir, mode });
export const agentSetConfigOption = (dir: string, configId: string, value: string) =>
  invoke("agent_set_config_option", { dir, configId, value });
export const agentRespondPermission = (dir: string, requestId: string, option: string | null) =>
  invoke("agent_respond_permission", { dir, requestId, option });
/** clean=true (default) is the explicit "End session" — unresolved edits
 *  auto-keep. Project close passes false so the ledger survives reopen. */
export const agentSessionStop = (dir: string, clean = true) => invoke("agent_session_stop", { dir, clean });
export const agentSessionResume = (dir: string, id: string) => invoke("agent_session_resume", { dir, id });
export const agentSessionsList = (dir: string) => invoke<Record<string, unknown>>("agent_sessions_list", { dir });
export const agentHistoryRead = (dir: string, id: string) => invoke<Record<string, unknown>>("agent_history_read", { dir, id });
export const onAcpUpdate = (cb: (u: AcpUpdate) => void): Promise<UnlistenFn> =>
  listen<AcpUpdate>("acp-update", (e) => cb(e.payload));

/** One unresolved agent edit, as agent_edits returns it. */
export interface AgentEditFile {
  path: string; // display-relative
  abs: string; // the key for diff/keep/undo
  kind: "created" | "modified" | "deleted";
  viaCommand: boolean;
  plus: number;
  minus: number;
}
export const agentEdits = (dir: string) =>
  invoke<{ files: AgentEditFile[] }>("agent_edits", { dir });
export const agentEditDiff = (dir: string, path: string) =>
  invoke<string>("agent_edit_diff", { dir, path });
export const agentEditKeep = (dir: string, path: string | null) =>
  invoke("agent_edit_keep", { dir, path });
export const agentEditUndo = (dir: string, path: string | null) =>
  invoke<number>("agent_edit_undo", { dir, path });
export const agentRestoreCheckpoint = (dir: string, id: string) =>
  invoke("agent_restore_checkpoint", { dir, id });

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
