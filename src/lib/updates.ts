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

const DISMISS_KEY = "chronicle.update.dismissed";
let checkedThisSession = false;

/** Checks once per LAUNCH (a launch is one cheap request — a cross-launch
 * throttle once swallowed a release for 20 hours). force re-checks any time. */
export async function checkForUpdate(force = false): Promise<void> {
  if (!force && checkedThisSession) return;
  checkedThisSession = true;
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
