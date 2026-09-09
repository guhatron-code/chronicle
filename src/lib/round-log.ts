/*
 * The Notes pane's live round log — its own store slice, deliberately not part
 * of notes-store's subscriber set. A round writes a line every second or so,
 * and notes-store's listeners are the whole pane (tree, editor, backlinks); if
 * a log line went through `notify()` there, typing next to a running round
 * would re-reconcile everything. Only the log panel subscribes here.
 *
 * No timers, no polling. Both phases already have a background session that
 * pushes `session-status` from Rust (src/lib/session-status.ts): `fixes` while
 * the plan is being written, `exec` while the round runs headless. Each event
 * carries the whole last 30 kB of the log file, so there is nothing to
 * accumulate — the newest tail replaces the last one. The subscription exists
 * only while the panel is open AND a round is live; `arm(null)` releases it,
 * and the panel's unmount, the pane's unmount and closing the project all do
 * exactly that.
 */
import { fixesStatus, roundExecStatus, type SessionKind } from "./ipc";
import { subscribeSessionStatus } from "./session-status";

interface Log {
  /** the raw tail as the session last reported it */
  tail: string;
  running: boolean;
  /** false until the seed read or the first event lands */
  seen: boolean;
}

const EMPTY: Log = { tail: "", running: false, seen: false };
const logs = new Map<string, Log>();
const armed = new Map<string, { kind: SessionKind; off: () => void }>();
const subs = new Set<() => void>();
const notify = () => { for (const cb of subs) cb(); };

export function subscribeRoundLog(cb: () => void): () => void {
  subs.add(cb);
  return () => { subs.delete(cb); };
}

export function roundLogFor(dir: string): Log { return logs.get(dir) ?? EMPTY; }

const seedFor = (kind: SessionKind) => (kind === "fixes" ? fixesStatus : roundExecStatus);

/**
 * Point the log at one session, or at nothing. Re-arming with the same kind is
 * a no-op, so the panel can call this from an effect on every render without
 * churning the listener.
 */
export function armRoundLog(dir: string, kind: SessionKind | null): void {
  const cur = armed.get(dir);
  if (cur?.kind === kind) return;
  cur?.off();
  armed.delete(dir);
  if (kind === null) {
    if (logs.delete(dir)) notify();
    return;
  }

  logs.set(dir, { ...EMPTY });
  let live = true;
  let gotLive = false;
  const un = subscribeSessionStatus(dir, kind, (e) => {
    gotLive = true;
    if (!live) return;
    logs.set(dir, { tail: e.log_tail ?? "", running: e.running === true, seen: true });
    notify();
  });
  armed.set(dir, { kind, off: () => { live = false; un(); } });
  // one seed read, exactly as useSessionStatus does it: a webview that opened
  // mid-round has missed every event so far. A live event is always at least as
  // new as an in-flight seed, so once one has arrived the seed must not win.
  void seedFor(kind)(dir)
    .then((s) => {
      if (!live || gotLive) return;
      logs.set(dir, { tail: s.log_tail ?? "", running: s.running === true, seen: true });
      notify();
    })
    .catch(() => {
      if (!live || gotLive) return;
      logs.set(dir, { ...EMPTY, seen: true });
      notify();
    });
  notify();
}

/** Project close — drop the listener and the buffer with it. */
export function evictRoundLog(dir: string): void { armRoundLog(dir, null); }
