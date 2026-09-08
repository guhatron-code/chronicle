/*
 * The background-session truth, pushed: one module-scope listener for
 * `session-status`, routed by project + kind. Screens subscribe through
 * useSessionStatus, which also does ONE seed read on activation (a reload
 * mid-run must recover the state the event stream already told a previous
 * webview about). Replaces four 3s pollers.
 */
import { useEffect, useState } from "react";
import { onSessionStatus, type InitStatusData, type SessionKind, type SessionStatusEvent } from "./ipc";

type Cb = (e: SessionStatusEvent) => void;
const subs = new Map<string, Set<Cb>>();
const keyOf = (dir: string, kind: SessionKind) => `${dir}::${kind}`;
let ready = false;

function ensure() {
  if (ready) return;
  ready = true;
  void onSessionStatus((e) => {
    const set = subs.get(keyOf(e.dir, e.kind));
    if (set) for (const cb of set) cb(e);
  });
}

export function subscribeSessionStatus(dir: string, kind: SessionKind, cb: Cb): () => void {
  ensure();
  const k = keyOf(dir, kind);
  let set = subs.get(k);
  if (!set) { set = new Set(); subs.set(k, set); }
  set.add(cb);
  return () => { set!.delete(cb); if (set!.size === 0) subs.delete(k); };
}

/**
 * Latest status for (dir, kind) while `active`; null when inactive or before
 * the seed read lands. Every emission is a fresh object so effects keyed on
 * the value re-run even when two events carry identical fields.
 */
export function useSessionStatus(
  dir: string,
  kind: SessionKind,
  active: boolean,
  seed: (dir: string) => Promise<InitStatusData>,
): SessionStatusEvent | null {
  const [st, setSt] = useState<SessionStatusEvent | null>(null);
  useEffect(() => {
    if (!active) { setSt(null); return; }
    let live = true;
    const un = subscribeSessionStatus(dir, kind, (e) => { if (live) setSt({ ...e }); });
    seed(dir)
      .then((s) => { if (live) setSt({ ...s, dir, kind }); })
      .catch(() => {});
    return () => { live = false; un(); };
  }, [dir, kind, active, seed]);
  return st;
}
