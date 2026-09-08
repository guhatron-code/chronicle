/*
 * The idle-aware scheduler — pure, no React, no Tauri. One activity value
 * (visible · focused · onBattery) feeds every recurring timer in the app:
 * hidden pauses, unfocused slows ×4, battery doubles. `every()` is the only
 * way to run something on a cadence; a bare setInterval never knows whether
 * anyone is looking. src/lib/activity.ts feeds this from the DOM and Rust.
 */
export interface Activity {
  visible: boolean;
  focused: boolean;
  onBattery: boolean;
}
export type Cadence = "normal" | "slow" | "paused";

let current: Activity = { visible: true, focused: true, onBattery: false };
const subscribers = new Set<(a: Activity) => void>();

export function getActivity(): Activity {
  return current;
}

/** Merge a change in; subscribers only hear real changes. */
export function setActivity(patch: Partial<Activity>): void {
  const next = { ...current, ...patch };
  if (next.visible === current.visible && next.focused === current.focused && next.onBattery === current.onBattery) return;
  current = next;
  for (const cb of subscribers) cb(next);
}

export function subscribeActivity(cb: (a: Activity) => void): () => void {
  subscribers.add(cb);
  return () => subscribers.delete(cb);
}

export function cadenceFor(a: Activity): Cadence {
  if (!a.visible) return "paused";
  if (!a.focused) return "slow";
  return "normal";
}

/** null = don't arm at all (paused). */
export function intervalFor(base: number, a: Activity): number | null {
  const c = cadenceFor(a);
  if (c === "paused") return null;
  const slowed = c === "slow" ? base * 4 : base;
  return a.onBattery ? slowed * 2 : slowed;
}

/**
 * Run `fn` on a cadence derived from `base` and the live activity. Single-
 * flight (a slow callback delays the next arm rather than stacking), re-arms
 * on every activity change, and fires once immediately when leaving "paused".
 * Callbacks own their errors — a rejection is swallowed here so the timer
 * survives; the existing per-screen try/catch blocks keep last-known state.
 */
export function every(base: number, fn: () => void | Promise<void>): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let stopped = false;
  let parkedWhilePaused = false;

  const arm = () => {
    if (stopped || running) return;
    if (timer) { clearTimeout(timer); timer = null; }
    const ms = intervalFor(base, current);
    if (ms === null) { parkedWhilePaused = true; return; }
    timer = setTimeout(fire, ms);
  };
  const fire = () => {
    timer = null;
    if (stopped || running) return;
    running = true;
    const settle = () => { running = false; if (!stopped) arm(); };
    let result: void | Promise<void>;
    try {
      result = fn();
    } catch {
      settle();
      return;
    }
    if (result instanceof Promise) {
      result.then(settle, settle);
    } else {
      settle();
    }
  };
  const un = subscribeActivity(() => {
    if (stopped) return;
    const resumed = parkedWhilePaused && cadenceFor(current) !== "paused";
    parkedWhilePaused = false;
    if (resumed) { fire(); return; }
    arm();
  });
  arm();
  return () => {
    stopped = true;
    un();
    if (timer) { clearTimeout(timer); timer = null; }
  };
}
