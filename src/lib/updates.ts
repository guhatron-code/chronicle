/*
 * OTA updates — quiet by design, honest in motion (I). Chronicle checks
 * GitHub's latest.json once per launch; a newer version offers ONE
 * dismissable line. Nothing downloads without a click — and once clicked,
 * the line tells the truth: Checking… / Downloading 42% / Installing… /
 * Restart to finish. Failed AUTO-checks stay silent; manual checks are loud
 * (the palette toasts the outcome).
 */
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export type UpdatePhase = "available" | "checking" | "downloading" | "installing" | "restart";

export interface UpdateState {
  version: string;
  phase: UpdatePhase;
  /** 0–100 while downloading with a known size; null = size unknown. */
  pct: number | null;
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
 * throttle once swallowed a release for 20 hours). force re-checks any time
 * and shows the Checking… state while it looks. */
export async function checkForUpdate(force = false): Promise<void> {
  if (!force && checkedThisSession) return;
  checkedThisSession = true;
  if (force && !state) {
    state = { version: "", phase: "checking", pct: null };
    notify();
  }
  try {
    const upd = await check();
    if (upd && localStorage.getItem(DISMISS_KEY) !== upd.version) {
      current = upd;
      state = { version: upd.version, phase: "available", pct: null };
    } else if (state?.phase === "checking") {
      state = null; // nothing new — the manual path toasts, the line clears
    }
    notify();
  } catch {
    /* offline / rate-limited — auto-checks stay silent; the manual caller
       sees no update and can retry */
    if (state?.phase === "checking") {
      state = null;
      notify();
    }
  }
}

/** The user said yes: download (with live progress), install, then offer
 * the restart — never a silent relaunch mid-thought. */
export async function installUpdate(): Promise<void> {
  if (!current || (state && state.phase !== "available")) return;
  state = { version: current.version, phase: "downloading", pct: null };
  notify();
  let total = 0;
  let got = 0;
  try {
    await current.downloadAndInstall((ev) => {
      if (ev.event === "Started") {
        total = ev.data.contentLength ?? 0;
        state = { version: current!.version, phase: "downloading", pct: total > 0 ? 0 : null };
      } else if (ev.event === "Progress") {
        got += ev.data.chunkLength;
        state = {
          version: current!.version,
          phase: "downloading",
          pct: total > 0 ? Math.min(100, Math.round((got / total) * 100)) : null,
        };
      } else if (ev.event === "Finished") {
        state = { version: current!.version, phase: "installing", pct: null };
      }
      notify();
    });
    state = { version: current.version, phase: "restart", pct: null };
    notify();
  } catch (e) {
    state = current ? { version: current.version, phase: "available", pct: null } : null;
    notify();
    throw e;
  }
}

/** The "Restart to finish" action. */
export async function restartUpdate(): Promise<void> {
  await relaunch();
}

/** Not now — this version stays quiet until the next one ships. */
export function dismissUpdate(): void {
  if (state) localStorage.setItem(DISMISS_KEY, state.version);
  current = null;
  state = null;
  notify();
}
