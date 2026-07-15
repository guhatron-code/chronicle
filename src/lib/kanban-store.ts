/*
 * The kanban store cache — one per project, shared between the KanbanPane and
 * the App shell (the rail badge needs the queued count without mounting the
 * pane). Ground truth is .chronicle/kanban.json via kanban_get/kanban_save;
 * mutations apply optimistically here and persist in the background.
 */
import {
  IMG_MIME,
  kanbanGet,
  kanbanSave,
  readFileB64,
  type KanbanStore,
  type KanbanTask,
} from "./ipc";

const stores = new Map<string, KanbanStore>();
const thumbs = new Map<string, string>(); // repo-relative path → data URI
const subscribers = new Set<() => void>();

function notify() {
  for (const cb of subscribers) cb();
}

export function subscribeKanban(cb: () => void): () => void {
  subscribers.add(cb);
  return () => subscribers.delete(cb);
}

const EMPTY: KanbanStore = { version: 1, next_id: 1, tasks: [], rounds: [] };

export function kanbanFor(dir: string): KanbanStore {
  return stores.get(dir) ?? EMPTY;
}

export function queuedCountFor(dir: string): number {
  return kanbanFor(dir).tasks.filter((t) => t.column === "queued" && !t.archived && t.round == null).length;
}

/** Reload from disk (project open, poll, after a generate settles). */
export async function refreshKanban(dir: string): Promise<void> {
  try {
    const raw = await kanbanGet(dir);
    stores.set(dir, {
      version: raw?.version ?? 1,
      next_id: raw?.next_id ?? 1,
      tasks: Array.isArray(raw?.tasks) ? raw.tasks : [],
      rounds: Array.isArray(raw?.rounds) ? raw.rounds : [],
    });
    notify();
  } catch { /* not a project / store unreadable — the pane shows empty */ }
}

/** Apply a mutation optimistically and persist. Throws only via onError. */
export function mutateKanban(
  dir: string,
  fn: (store: KanbanStore) => void,
  onError?: (e: unknown) => void,
): void {
  const cur = stores.get(dir) ?? { ...EMPTY, tasks: [], rounds: [] };
  const next: KanbanStore = {
    ...cur,
    tasks: cur.tasks.map((t) => ({ ...t })),
    rounds: cur.rounds.map((r) => ({ ...r })),
  };
  fn(next);
  stores.set(dir, next);
  notify();
  // persist against DISK truth, not the cache — the round executor edits the
  // board concurrently (column moves), and saving a stale cache would undo them
  kanbanGet(dir)
    .then((raw) => {
      const fresh: KanbanStore = {
        version: raw?.version ?? 1,
        next_id: raw?.next_id ?? 1,
        tasks: Array.isArray(raw?.tasks) ? raw.tasks : [],
        rounds: Array.isArray(raw?.rounds) ? raw.rounds : [],
      };
      fn(fresh);
      stores.set(dir, fresh);
      notify();
      return kanbanSave(dir, fresh);
    })
    .catch((e) => {
      // disk truth wins on failure
      void refreshKanban(dir);
      onError?.(e);
    });
}

/** Drop a closed project's cached board + thumbnails (memory hygiene). */
export function evictKanban(dir: string): void {
  stores.delete(dir);
  const prefix = `${dir}::`;
  for (const key of [...thumbs.keys()]) {
    if (key.startsWith(prefix)) thumbs.delete(key);
  }
}

/** Open a task's composer next time the kanban pane looks (global search lands here). */
let pendingOpenTask: string | null = null;
export function openTaskInKanban(id: string): void {
  pendingOpenTask = id;
  notify();
}
export function takePendingOpenTask(): string | null {
  const id = pendingOpenTask;
  pendingOpenTask = null;
  return id;
}

export function taskId(n: number): string {
  return `T-${String(n).padStart(3, "0")}`;
}

export function newTask(store: KanbanStore): KanbanTask {
  const t: KanbanTask = {
    id: taskId(store.next_id),
    title: "",
    content: "",
    column: "queued",
    images: [],
    links: [],
    created_at: Date.now(),
    updated_at: Date.now(),
  };
  return t;
}

/** The next round number (display-time; the backend assigns the real one). */
export function nextRoundN(store: KanbanStore): number {
  return store.rounds.reduce((m, r) => Math.max(m, r.n), 0) + 1;
}

/** An OPEN round — generating, or settled with unfinished tasks. New tasks
 * join the next round while one is open; the strip hides once every task in
 * the round is completed. */
export function executingRound(store: KanbanStore): number | null {
  // newest open round wins — the strip's "new tasks start round N+1" must
  // name the round tasks would actually join
  for (const r of [...store.rounds].reverse()) {
    if (r.state === "generating") return r.n;
    if (r.state === "ready") {
      const mine = store.tasks.filter((t) => t.round === r.n && !t.archived);
      // a settled round with no (visible) members is closed, not stuck open
      if (mine.length > 0 && mine.some((t) => t.column !== "completed")) return r.n;
    }
  }
  return null;
}

/** Attachment thumbnail as a data URI — cached; loads lazily and notifies.
 * A failed load is remembered (not left looking in-flight) and retried
 * after 30s, so a file that appears later still gets its thumbnail. */
export function thumbFor(dir: string, path: string): string | null {
  const key = `${dir}::${path}`;
  const hit = thumbs.get(key);
  if (hit !== undefined) {
    if (hit.startsWith("data:")) return hit;
    if (hit === "") return null; // in flight
    if (Date.now() - Number(hit.slice(5)) < 30_000) return null; // failed recently
    // fall through: stale failure — retry
  }
  thumbs.set(key, ""); // in flight
  readFileB64(dir, path)
    .then((b64) => {
      const ext = path.split(".").pop()?.toLowerCase() ?? "png";
      const src = `data:${IMG_MIME[ext] ?? "image/png"};base64,${b64}`;
      // downscale before caching — a full 5MB screenshot as the data URI for a
      // 44px thumb would sit in memory for the whole session
      downscale(src).then((small) => {
        thumbs.set(key, small);
        notify();
      });
    })
    .catch(() => thumbs.set(key, `FAIL:${Date.now()}`));
  return null;
}

/** Longest edge a cached thumbnail keeps — 2× the largest render (44px tiles). */
const THUMB_MAX = 320;

/** Downscale a data URI via canvas; falls back to the original when the image
 *  can't be rasterized (e.g. an odd SVG) — showing big beats showing nothing. */
function downscale(src: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      if (Math.max(img.width, img.height) <= THUMB_MAX || !img.width || !img.height) {
        resolve(src);
        return;
      }
      try {
        const scale = THUMB_MAX / Math.max(img.width, img.height);
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext("2d");
        if (!ctx) { resolve(src); return; }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/webp", 0.8));
      } catch {
        resolve(src);
      }
    };
    img.onerror = () => resolve(src);
    img.src = src;
  });
}
