/*
 * The run records the frontend knows of, by project and number. Rust is the
 * writer and pushes every change as `run-update`; this only keeps the newest
 * copy, lets React subscribe, and taps the user on the shoulder (a native
 * notification) when a round needs them or is saved while they're away.
 */
import { notifyNative } from "./ipc";
import { onRunUpdate, runsList } from "./runs-ipc";
import { runOver, transitionNotice, type RunRecord } from "./runs-model";

const byDir = new Map<string, Map<number, RunRecord>>();
const subs = new Set<() => void>();
let version = 0;
let listening = false;

function bump() {
  version++;
  for (const cb of subs) cb();
}

/** Keep the newer copy; `updated` is to the second, and a tie takes the incoming one. */
export function ingest(dir: string, rec: RunRecord): { accepted: boolean; prev: RunRecord | null } {
  const m = byDir.get(dir) ?? new Map<number, RunRecord>();
  const prev = m.get(rec.n) ?? null;
  if (prev && Date.parse(prev.updated) > Date.parse(rec.updated)) return { accepted: false, prev };
  m.set(rec.n, rec);
  byDir.set(dir, m);
  return { accepted: true, prev };
}

function ensure() {
  if (listening) return;
  listening = true;
  void onRunUpdate((u) => {
    const { accepted, prev } = ingest(u.dir, u.record);
    if (!accepted) return;
    const say = transitionNotice(prev, u.record);
    if (say && typeof document !== "undefined" && !document.hasFocus()) void notifyNative("Chronicle", say).catch(() => {});
    bump();
  });
}

export function subscribeRuns(cb: () => void): () => void {
  ensure();
  subs.add(cb);
  return () => { subs.delete(cb); };
}
export const runsVersion = () => version;
export const runFor = (dir: string, n: number): RunRecord | null => byDir.get(dir)?.get(n) ?? null;
export function liveRun(dir: string): RunRecord | null {
  return [...(byDir.get(dir)?.values() ?? [])].filter((r) => !runOver(r)).sort((a, b) => b.n - a.n)[0] ?? null;
}
/** The project's records from Rust, kept; resolves to what was listed (empty when listing failed). */
export function refreshRuns(dir: string): Promise<RunRecord[]> {
  ensure();
  return runsList(dir).then((list) => { for (const r of list) ingest(dir, r); bump(); return list; }).catch(() => []);
}
