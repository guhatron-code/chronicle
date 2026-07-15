/*
 * OTA updates — quiet by design. Chronicle checks GitHub's latest.json at most
 * once a day, and if a newer version exists it offers ONE dismissable line;
 * nothing downloads or installs without the user's click.
 */
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export interface UpdateState {
  version: string;
  /** downloading → installing → ready-to-relaunch happens inside install(). */
  busy: boolean;
}

let current: Update | null = null;
let state: UpdateState | null = null;
const subscribers = new Set<() => void>();

function notify() {
  for (const cb of subscribers) cb();
}

export function subscribeUpdates(cb: () => void): () => void {
  subscribers.add(cb);
  return () => subscribers.delete(cb);
}

export function updateAvailable(): UpdateState | null {
  return state;
}

const CHECK_KEY = "chronicle.update.checked";
const DISMISS_KEY = "chronicle.update.dismissed";
const DAY_MS = 20 * 60 * 60_000; // ~daily, forgiving of launch-time jitter

/** Throttled check — call freely; it self-limits to ~once a day. */
export async function checkForUpdate(force = false): Promise<void> {
  const last = Number(localStorage.getItem(CHECK_KEY)) || 0;
  if (!force && Date.now() - last < DAY_MS) return;
  localStorage.setItem(CHECK_KEY, String(Date.now()));
  try {
    const upd = await check();
    if (upd && localStorage.getItem(DISMISS_KEY) !== upd.version) {
      current = upd;
      state = { version: upd.version, busy: false };
      notify();
    }
  } catch {
    /* offline / rate-limited — try again tomorrow; never surface as an error */
  }
}

/** The user said yes: download, install, relaunch. */
export async function installUpdate(): Promise<void> {
  if (!current || state?.busy) return;
  state = { ...state!, busy: true };
  notify();
  try {
    await current.downloadAndInstall();
    await relaunch();
  } catch (e) {
    state = state ? { ...state, busy: false } : null;
    notify();
    throw e;
  }
}

/** Not now — this version stays quiet until the next one ships. */
export function dismissUpdate(): void {
  if (state) localStorage.setItem(DISMISS_KEY, state.version);
  current = null;
  state = null;
  notify();
}
