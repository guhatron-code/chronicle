/*
 * The Notes pane's live round log, and the session liveness the round card
 * needs to know which phase it is in. Its own store slice, deliberately not
 * part of notes-store's subscriber set: a round writes a line a second, and
 * notes-store's listeners are the whole pane, so a log line going through
 * `notify()` there would re-reconcile the tree and the editor on every line.
 *
 * Two subscriber sets, for the same reason. `subscribeRoundLog` fires on every
 * new tail and only the panel listens to it. `subscribeRoundSession` fires
 * only when a session starts or stops — which is a phase change, so the whole
 * pane can afford to hear it.
 *
 * No timers, no polling. Both phases already have a background session that
 * pushes `session-status` from Rust (src/lib/session-status.ts): `fixes` while
 * the plan is being written, `exec` while the round runs headless. Each event
 * carries the whole last 30 kB of the log file, so there is nothing to
 * accumulate — the newest tail replaces the last one. Nothing is armed unless
 * the pane says a round exists, and the panel's own subscription only exists
 * while the panel is open.
 */
import { fixesStatus, roundExecStatus, type SessionKind } from "./ipc";
import { subscribeSessionStatus } from "./session-status";

/** The two sessions a round can have. `exec` is the headless executor; a round
 *  sent to the agent pane has neither, which is why `markAgentRound` exists. */
export type RoundLogKind = Extract<SessionKind, "fixes" | "exec">;

interface Log {
  /** the raw tail as the session last reported it */
  tail: string;
  running: boolean;
  /** false until the seed read or the first event lands */
  seen: boolean;
}

const EMPTY: Log = { tail: "", running: false, seen: false };
const logKey = (dir: string, kind: RoundLogKind) => `${dir}::${kind}`;
const logs = new Map<string, Log>();
const armed = new Map<string, { kind: RoundLogKind; off: () => void }>();

const logSubs = new Set<() => void>();
const sessionSubs = new Set<() => void>();
const notifyLog = () => { for (const cb of logSubs) cb(); };
const notifySession = () => { for (const cb of sessionSubs) cb(); };

/** Every new tail. The log panel is the only thing that should listen. */
export function subscribeRoundLog(cb: () => void): () => void {
  logSubs.add(cb);
  return () => { logSubs.delete(cb); };
}

/** A session starting or stopping — a phase change, not a log line. */
export function subscribeRoundSession(cb: () => void): () => void {
  sessionSubs.add(cb);
  return () => { sessionSubs.delete(cb); };
}

export function roundLogFor(dir: string, kind: RoundLogKind): Log {
  return logs.get(logKey(dir, kind)) ?? EMPTY;
}

const seedFor = (kind: RoundLogKind) => (kind === "fixes" ? fixesStatus : roundExecStatus);

/**
 * Point the panel at one session's log, or at nothing. Re-arming with the same
 * kind is a no-op, so the panel can call this from an effect on every render
 * without churning the listener.
 */
export function armRoundLog(dir: string, kind: RoundLogKind | null): void {
  const cur = armed.get(dir);
  if (cur?.kind === kind) return;
  cur?.off();
  armed.delete(dir);
  if (kind === null) { notifyLog(); return; }

  const key = logKey(dir, kind);
  logs.set(key, { ...EMPTY });
  let live = true;
  let gotLive = false;
  const un = subscribeSessionStatus(dir, kind, (e) => {
    gotLive = true;
    if (!live) return;
    logs.set(key, { tail: e.log_tail ?? "", running: e.running === true, seen: true });
    notifyLog();
  });
  armed.set(dir, { kind, off: () => { live = false; un(); } });
  // one seed read, exactly as useSessionStatus does it: a webview that opened
  // mid-round has missed every event so far. A live event is always at least as
  // new as an in-flight seed, so once one has arrived the seed must not win.
  void seedFor(kind)(dir)
    .then((s) => {
      if (!live || gotLive) return;
      logs.set(key, { tail: s.log_tail ?? "", running: s.running === true, seen: true });
      notifyLog();
    })
    .catch(() => {
      if (!live || gotLive) return;
      logs.set(key, { ...EMPTY, seen: true });
      notifyLog();
    });
  notifyLog();
}

/* ---------- which session is alive: the phase discriminator ---------- */

/** `.chronicle/rounds.json` says `ready` from the moment the plan is written
 *  until every note is done — it cannot tell "written, nothing has run" from
 *  "running". Only a live session can, so the pane watches both while a round
 *  record exists: two listeners and two seed reads, no polling. */
const running = new Map<string, { fixes: boolean; exec: boolean }>();
const watches = new Map<string, () => void>();

export function execRunning(dir: string): boolean { return running.get(dir)?.exec ?? false; }
export function fixesRunning(dir: string): boolean { return running.get(dir)?.fixes ?? false; }

/**
 * Arm or release the two session listeners. Disarming deliberately KEEPS what
 * they last reported: an unarmed watch has no news, not the news that nothing
 * is running, and forgetting would demote a live `executing` round to
 * `plan-ready` — which is the card offering "Run headless" for a round that is
 * already running. Only closing the project clears it (evictRoundLog).
 */
export function armRoundWatch(dir: string, on: boolean): void {
  if (on === watches.has(dir)) return;
  if (!on) {
    watches.get(dir)?.();
    watches.delete(dir);
    return;
  }
  if (!running.has(dir)) running.set(dir, { fixes: false, exec: false });
  const setRun = (k: RoundLogKind, v: boolean) => {
    const cur = running.get(dir);
    if (!cur || cur[k] === v) return;
    cur[k] = v;
    notifySession();
  };
  let live = true;
  const unF = subscribeSessionStatus(dir, "fixes", (e) => { if (live) setRun("fixes", e.running === true); });
  const unE = subscribeSessionStatus(dir, "exec", (e) => { if (live) setRun("exec", e.running === true); });
  watches.set(dir, () => { live = false; unF(); unE(); });
  void fixesStatus(dir).then((s) => { if (live) setRun("fixes", s.running === true); }).catch(() => {});
  void roundExecStatus(dir).then((s) => { if (live) setRun("exec", s.running === true); }).catch(() => {});
}

/* ---------- the round that went to the agent pane ---------- */

/** "Run in the agent pane" has no session of its own — the round rides the ACP
 *  thread, which writes no log file. Remembering the click is the only way the
 *  card can say the round is running at all. Session-local on purpose: after a
 *  restart the card falls back to "plan ready · not started", which is at
 *  worst incomplete, where claiming an executor log would be a lie.
 *
 *  The mark has to be cleared, or a round that failed in the thread reads as
 *  running forever: agent-session clears it when the turn ends, and the card
 *  offers the user the same escape. */
const agentRuns = new Map<string, number>();
export function markAgentRound(dir: string, n: number): void {
  if (agentRuns.get(dir) === n) return;
  agentRuns.set(dir, n);
  notifySession();
}
export function clearAgentRound(dir: string): void {
  if (agentRuns.delete(dir)) notifySession();
}
export function agentRoundFor(dir: string): number | null { return agentRuns.get(dir) ?? null; }

/* ---------- the round the user has finished reading ---------- */

/** A round that has ended keeps its card and its log until it is dismissed —
 *  the run you just watched is the one you most want to read back. Remembered
 *  per project so a restart does not resurrect it; a newer round outranks it
 *  by number, so starting one is also a dismissal. */
const DISMISS_KEY = (dir: string) => `chronicle.notes.round-seen.${dir}`;
const dismissed = new Map<string, number>();

export function dismissedRoundFor(dir: string): number {
  const held = dismissed.get(dir);
  if (held !== undefined) return held;
  let n = 0;
  try { n = Number(localStorage.getItem(DISMISS_KEY(dir))) || 0; } catch { /* private mode */ }
  dismissed.set(dir, n);
  return n;
}

export function dismissRound(dir: string, n: number): void {
  if (dismissedRoundFor(dir) >= n) return;
  dismissed.set(dir, n);
  try { localStorage.setItem(DISMISS_KEY(dir), String(n)); } catch { /* private mode */ }
  notifySession();
}

/** Project close — drop both listeners and everything they filled in. */
export function evictRoundLog(dir: string): void {
  armRoundLog(dir, null);
  armRoundWatch(dir, false);
  running.delete(dir);
  agentRuns.delete(dir);
  dismissed.delete(dir);
  for (const k of [...logs.keys()]) if (k.startsWith(`${dir}::`)) logs.delete(k);
}
