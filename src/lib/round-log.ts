/*
 * The running-round mark and the dismissed-round memory.
 *
 * `.chronicle/rounds.json` says `ready` from the moment a round's plan is
 * written until every note in it is done — it cannot tell "written, nothing
 * has run" from "running". Only this session's own record of where the round
 * was sent can: the agent pane (an ACP thread with no log of its own) or a
 * terminal tab (a `pty` this session spawned). One mark per project, naming
 * the round and the route — never both routes at once, because a round can
 * only be running in one place.
 *
 * Session-local on purpose: after a restart the card falls back to "plan
 * ready · not started", which is at worst incomplete, where claiming a route
 * that no longer runs would be a lie. The mark has to be cleared when the
 * round's run actually ends, or a round that failed silently reads as running
 * forever — the callers that start a route are the ones that clear it.
 */
import type { RoundRoute } from "./notes-model";

const sessionSubs = new Set<() => void>();
const notifySession = () => { for (const cb of sessionSubs) cb(); };

/** A round's run starting, stopping, or changing route — a phase change. */
export function subscribeRoundSession(cb: () => void): () => void {
  sessionSubs.add(cb);
  return () => { sessionSubs.delete(cb); };
}

/* ---------- the one running-round mark ---------- */

export interface RunningRound { n: number; route: RoundRoute; termId?: number }
const runs = new Map<string, RunningRound>();

export function markRunningRound(dir: string, r: RunningRound): void {
  const cur = runs.get(dir);
  if (cur && cur.n === r.n && cur.route === r.route && cur.termId === r.termId) return;
  runs.set(dir, r);
  notifySession();
}
export function clearRunningRound(dir: string): void {
  if (runs.delete(dir)) notifySession();
}
export function runningRoundFor(dir: string): RunningRound | null { return runs.get(dir) ?? null; }

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

/** Project close — drop the mark and the dismissal cache. */
export function evictRoundLog(dir: string): void {
  runs.delete(dir);
  dismissed.delete(dir);
}
