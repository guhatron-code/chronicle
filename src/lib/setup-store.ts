/*
 * The doctor's frontend store — framework-free, one shared instance, mirroring
 * agent-session.ts. Holds the six checks, folds live `setup-update` progress
 * events over the last full status, and drives install / repair / run-all /
 * sign-in. Listeners register ONCE at module scope (the ipc.ts law).
 */
import {
  agentsAccessDisable,
  agentsAccessEnable,
  agentsAccessStatus,
  onSetupUpdate,
  setupCancel,
  setupFixTerminalPath,
  setupInstall,
  setupOpenLogin,
  setupRunAll,
  setupStatus,
  type AgentsAccessStatus,
  type SetupCheck,
} from "./ipc";
import { every } from "./scheduler";

/** The row order + plain-language identity the screen renders. Names live here
 *  so the store, not the JSX, is the source of truth for what each check is. */
export const CHECK_META: { id: string; name: string; blurb: string; kind: "claude" | "node" | "signin" | "path" | "github" | "skills" | "agents" }[] = [
  { id: "claude", name: "The AI that does the work", blurb: "Claude Code — the assistant that writes and edits your project.", kind: "claude" },
  { id: "claude_signin", name: "Sign in to Claude", blurb: "So the AI can start working on your behalf.", kind: "signin" },
  { id: "node", name: "The engine the AI runs on", blurb: "The background software the AI needs to do its work.", kind: "node" },
  { id: "terminal_path", name: "Make the AI work in the terminal", blurb: "So typing the AI's name in the terminal works.", kind: "path" },
  { id: "github", name: "Your projects' online home", blurb: "Where your projects live online, so you can publish and share them.", kind: "github" },
  { id: "superpowers", name: "Extra skills for the AI", blurb: "Extra abilities that make the AI better at bigger jobs.", kind: "skills" },
  { id: "agents", name: "Let agents reach Chronicle", blurb: "Claude Code in this project can read and write its notes, see the roadmap, read this project's terminal output, and start rounds you watch.", kind: "agents" },
];

/** The machine-wide prerequisites the first-launch gate and the "all set" celebration
 *  require. "agents" is excluded on purpose: it is a per-project opt-in that needs an
 *  open project to even ask about, so it must never block reaching one. */
const REQUIRED_META = CHECK_META.filter((c) => c.kind !== "agents");

export interface DoctorState {
  checks: Map<string, SetupCheck>;
  loaded: boolean;
  runningAll: boolean;
  /** checks whose sign-in Terminal is open and being polled */
  waitingSignins: Set<string>;
}

const state: DoctorState = {
  checks: new Map(),
  loaded: false,
  runningAll: false,
  waitingSignins: new Set(),
};
const subs = new Set<() => void>();
let listenersReady = false;

function notify() {
  for (const cb of subs) cb();
}

export function subscribeDoctor(cb: () => void): () => void {
  ensureListeners();
  subs.add(cb);
  return () => subs.delete(cb);
}

function ensureListeners() {
  if (listenersReady) return;
  listenersReady = true;
  void onSetupUpdate((u) => {
    const m = u.message;
    if (m.id === "_all") {
      const st = m.state as string;
      state.runningAll = st !== "done" && st !== "stopped";
      notify();
      return;
    }
    const prev = state.checks.get(m.id) ?? { id: m.id, state: "checking" as SetupCheck["state"] };
    // a progress event carries only the delta; merge over the last known row
    state.checks.set(m.id, { ...prev, ...m } as SetupCheck);
    notify();
  });
}

export function doctorState(): DoctorState {
  return state;
}

export function checkFor(id: string): SetupCheck {
  return state.checks.get(id) ?? { id, state: "checking" };
}

export function readyCount(): number {
  return REQUIRED_META.filter((c) => state.checks.get(c.id)?.state === "ready").length;
}
export function totalRequired(): number {
  return REQUIRED_META.length;
}
export function allReady(): boolean {
  return state.loaded && REQUIRED_META.every((c) => state.checks.get(c.id)?.state === "ready");
}

/** Pull a fresh full status (re-check). */
export async function refreshDoctor(): Promise<void> {
  ensureListeners();
  try {
    const s = await setupStatus();
    for (const c of s.checks) {
      // don't stomp a live "installing" row with a stale detect
      const cur = state.checks.get(c.id);
      if (cur?.state === "installing") continue;
      state.checks.set(c.id, c);
    }
    state.loaded = true;
    notify();
  } catch {
    /* leave the last-known state */
  }
}

/* ---------- actions ---------- */

export async function installCheck(id: string): Promise<void> {
  const cur = checkFor(id);
  state.checks.set(id, { ...cur, state: "installing", pct: null });
  notify();
  try {
    await setupInstall(id);
  } catch {
    /* the couldnt_finish event already landed; refresh reconciles */
  }
  await refreshDoctor();
}

export async function fixTerminalPath(id = "terminal_path"): Promise<void> {
  try {
    await setupFixTerminalPath();
    // mark it fixed locally; a real re-check confirms in a fresh shell
    const cur = checkFor(id);
    state.checks.set(id, { ...cur, state: "ready", detail: "Fixed. Open a new terminal and it'll work." });
    notify();
  } catch {
    await refreshDoctor();
  }
}

export async function cancelCheck(id: string): Promise<void> {
  await setupCancel(id).catch(() => {});
}

export async function runEverything(): Promise<void> {
  state.runningAll = true;
  notify();
  try {
    await setupRunAll();
  } finally {
    state.runningAll = false;
    await refreshDoctor();
  }
}

const signinStops = new Map<string, () => void>();

/** Open a real Terminal window for the sign-in and poll the doctor until the
 *  check flips to ready (the user finishes the login in Terminal). */
export async function startSignin(_dir: string | null, id: string): Promise<void> {
  const kind = id === "github" ? "github" : "claude";
  await setupOpenLogin(kind);
  state.waitingSignins.add(id);
  notify();
  const started = Date.now();
  signinStops.get(id)?.();
  let stop: () => void = () => {};
  const finish = () => {
    stop();
    signinStops.delete(id);
    state.waitingSignins.delete(id);
    notify();
  };
  stop = every(3500, async () => {
    await refreshDoctor();
    if (state.checks.get(id)?.state === "ready") { finish(); return; }
    // give up after 5 minutes; a manual "Re-check" still works
    if (Date.now() - started > 5 * 60_000) finish();
  });
  signinStops.set(id, finish);
}

/** The setup screen is gone — nobody is waiting for a sign-in anymore. */
export function cancelSignins(): void {
  for (const finish of [...signinStops.values()]) finish();
}

export function waitingSignin(id: string): boolean {
  return state.waitingSignins.has(id);
}

/* ---------- the "agents" row (src-tauri/src/main.rs: agents_access_*) ----------
 * Per-project, not machine-wide, so it does not come from setupStatus() — it is
 * fetched with the currently open project's dir and mapped here, kept pure so the
 * mapping is testable without a Tauri runtime. */

/** Pure: what the row should show for a given backend status and the currently
 *  open project's dir. No dir ⇒ blocked (nothing to turn on yet); a dir with no
 *  status yet (still loading) ⇒ checking; otherwise ready/needs_you from `mcp`.
 *  A ready row whose skill is hand-managed says so — the human owns that copy,
 *  and Chronicle isn't quietly overwriting it. */
export function agentsRowFor(status: AgentsAccessStatus | null, dir: string | null): SetupCheck {
  if (!dir) return { id: "agents", state: "blocked", detail: "Open a project first", action: "" };
  if (!status) return { id: "agents", state: "checking" };
  if (status.mcp) {
    return {
      id: "agents",
      state: "ready",
      ...(status.skill === "hand-managed"
        ? { detail: "The chronicle skill at ~/.claude/skills/chronicle is yours to manage." }
        : {}),
    };
  }
  return {
    id: "agents",
    state: "needs_you",
    detail: "Writes .mcp.json in this project and installs the chronicle skill.",
    action: "install",
  };
}

/** The row when asking the backend failed. A "checking" row here would spin for
 *  the rest of the session with nothing to click and nothing to read; this one
 *  says what went wrong and keeps the Turn on button, which retries the lot. */
export function agentsRowForError(err: unknown): SetupCheck {
  return { id: "agents", state: "needs_you", detail: String(err), action: "install" };
}

/** Pull the agents row fresh for whichever project is open (or blocked, if none is). */
export async function refreshAgentsRow(dir: string | null): Promise<void> {
  if (!dir) {
    state.checks.set("agents", agentsRowFor(null, null));
    notify();
    return;
  }
  try {
    const status = await agentsAccessStatus(dir);
    state.checks.set("agents", agentsRowFor(status, dir));
  } catch (err) {
    state.checks.set("agents", agentsRowForError(err));
  }
  notify();
}

export async function enableAgentAccess(dir: string): Promise<void> {
  try {
    await agentsAccessEnable(dir);
  } finally {
    await refreshAgentsRow(dir);
  }
}

export async function disableAgentAccess(dir: string): Promise<void> {
  try {
    await agentsAccessDisable(dir);
  } finally {
    await refreshAgentsRow(dir);
  }
}
