/*
 * The doctor's frontend store — framework-free, one shared instance, mirroring
 * agent-session.ts. Holds the six checks, folds live `setup-update` progress
 * events over the last full status, and drives install / repair / run-all /
 * sign-in. Listeners register ONCE at module scope (the ipc.ts law).
 */
import {
  onSetupUpdate,
  setupCancel,
  setupFixTerminalPath,
  setupInstall,
  setupOpenLogin,
  setupRunAll,
  setupStatus,
  type SetupCheck,
} from "./ipc";

/** The row order + plain-language identity the screen renders. Names live here
 *  so the store, not the JSX, is the source of truth for what each check is. */
export const CHECK_META: { id: string; name: string; blurb: string; kind: "claude" | "node" | "signin" | "path" | "github" | "skills" }[] = [
  { id: "claude", name: "The AI that does the work", blurb: "Claude Code — the assistant that writes and edits your project.", kind: "claude" },
  { id: "claude_signin", name: "Sign in to Claude", blurb: "So the AI can start working on your behalf.", kind: "signin" },
  { id: "node", name: "The engine the AI runs on", blurb: "The background software the AI needs to do its work.", kind: "node" },
  { id: "terminal_path", name: "Make the AI work in the terminal", blurb: "So typing the AI's name in the terminal works.", kind: "path" },
  { id: "github", name: "Your projects' online home", blurb: "Where your projects live online, so you can publish and share them.", kind: "github" },
  { id: "superpowers", name: "Extra skills for the AI", blurb: "Extra abilities that make the AI better at bigger jobs.", kind: "skills" },
];

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
  return CHECK_META.filter((c) => state.checks.get(c.id)?.state === "ready").length;
}
export function allReady(): boolean {
  return state.loaded && CHECK_META.every((c) => state.checks.get(c.id)?.state === "ready");
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

/** Open a real Terminal window for the sign-in and poll the doctor until the
 *  check flips to ready (the user finishes the login in Terminal). */
export async function startSignin(_dir: string | null, id: string): Promise<void> {
  const kind = id === "github" ? "github" : "claude";
  await setupOpenLogin(kind);
  state.waitingSignins.add(id);
  notify();
  const started = Date.now();
  const poll = setInterval(() => {
    // give up after 5 minutes; a manual "Re-check" still works
    if (Date.now() - started > 5 * 60_000) { clearInterval(poll); state.waitingSignins.delete(id); notify(); return; }
    void refreshDoctor().then(() => {
      if (state.checks.get(id)?.state === "ready") {
        clearInterval(poll);
        state.waitingSignins.delete(id);
        notify();
      }
    });
  }, 2500);
}

export function waitingSignin(id: string): boolean {
  return state.waitingSignins.has(id);
}
