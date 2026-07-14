/*
 * The kanban store cache — one per project, shared between the KanbanPane and
 * the App shell (the rail badge needs the queued count without mounting the
 * pane). Ground truth is .chronicle/kanban.json via kanban_get/kanban_save;
 * mutations apply optimistically here and persist in the background.
 */
import {
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
  return kanbanFor(dir).tasks.filter((t) => t.column === "queued" && !t.archived).length;
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
  kanbanSave(dir, next).catch((e) => {
    // disk truth wins on failure
    void refreshKanban(dir);
    onError?.(e);
  });
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

/** A round the roadmap is still executing — new tasks join the NEXT round. */
export function executingRound(store: KanbanStore): number | null {
  const r = store.rounds.find((x) => x.state === "generating" || x.state === "ready");
  return r ? r.n : null;
}

const IMG_MIME: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  webp: "image/webp", svg: "image/svg+xml", bmp: "image/bmp", heic: "image/heic", avif: "image/avif",
};

/** Attachment thumbnail as a data URI — cached; loads lazily and notifies. */
export function thumbFor(dir: string, path: string): string | null {
  const key = `${dir}::${path}`;
  const hit = thumbs.get(key);
  if (hit !== undefined) return hit || null;
  thumbs.set(key, ""); // in flight
  readFileB64(dir, path)
    .then((b64) => {
      const ext = path.split(".").pop()?.toLowerCase() ?? "png";
      thumbs.set(key, `data:${IMG_MIME[ext] ?? "image/png"};base64,${b64}`);
      notify();
    })
    .catch(() => thumbs.set(key, ""));
  return null;
}
