/*
 * The project journal (F2) — Chronicle records the transitions it OBSERVES
 * (a phase flipping done, a publish landing, a round finishing) into
 * .chronicle/journal.jsonl, and surfaces them two ways: a native notification
 * when the window isn't focused, and the "while you were away" digest when
 * you come back to a project.
 */
import { journalAppend, notifyNative } from "./ipc";

/** Record a transition; notify natively only when the user isn't looking. */
export function announce(dir: string, kind: string, text: string, notifyTitle?: string): void {
  void journalAppend(dir, { kind, text }).catch(() => {});
  if (notifyTitle && !document.hasFocus()) {
    void notifyNative(notifyTitle, text).catch(() => {});
  }
}

const seenKey = (dir: string) => `chronicle.seen.${dir}`;

/** When the user last actually looked at this project (epoch ms; 0 = never). */
export function lastSeen(dir: string): number {
  const v = Number(localStorage.getItem(seenKey(dir)));
  return Number.isFinite(v) && v > 0 ? v : 0;
}

export function markSeen(dir: string): void {
  localStorage.setItem(seenKey(dir), String(Date.now()));
}

/** An absence long enough that a catch-up digest is worth showing. */
export const AWAY_THRESHOLD_MS = 10 * 60_000;
