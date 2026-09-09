/*
 * The Notes pane's state, outside React so an open note survives a pane or
 * project switch. One module-scope listener for `notes-changed`, registered only
 * while the pane is on screen; off screen the heartbeat's generation is the only
 * signal, so an untouched vault costs nothing.
 *
 * Saving: 600 ms after the last keystroke. There is no one-shot primitive in the
 * scheduler and no bare timers are allowed, so a dirty note arms a 600 ms
 * every() ticker whose callback fires the save only once the last keystroke is
 * genuinely 600 ms old. every() slows itself when the window is unfocused and
 * parks when it is hidden, so the ticker is a floor rather than a deadline —
 * the timestamp check keeps the wait honest while focused, and losing focus or
 * visibility flushes straight away, as do pane switch, project switch and
 * window close. A parked timer can never sit on an unsaved edit.
 */
import { every } from "./scheduler";
import {
  notesDelete, notesIndex, notesMove, notesRead, notesWrite, onNotesChanged,
  readFileB64, IMG_MIME,
  type NoteEntry, type NoteStatus, type NotesIndex,
} from "./ipc";
import {
  joinFrontMatter, newNotePath, roundPhaseOf, setStatusInFront, splitFrontMatter,
  type RoundPhase, type SaveState,
} from "./notes-model";
import { agentRoundFor, evictRoundLog, execRunning } from "./round-log";
import { toastError } from "@/overlays/toasts";

export interface OpenNote {
  path: string; front: string; body: string; savedBody: string;
  state: SaveState; savedAt: number | null; error: string | null; conflict: boolean;
  /** the disk text waiting behind a conflict bar */
  incoming: string | null;
}

const EMPTY: NotesIndex = { notes: [], generation: 0, rounds: [] };
const indexes = new Map<string, NotesIndex>();
const opens = new Map<string, OpenNote>();
const subs = new Set<() => void>();
const notify = () => { for (const cb of subs) cb(); };

export function subscribeNotes(cb: () => void): () => void { subs.add(cb); return () => { subs.delete(cb); }; }
export function indexFor(dir: string): NotesIndex { return indexes.get(dir) ?? EMPTY; }
export function openFor(dir: string): OpenNote | null { return opens.get(dir) ?? null; }
export function queuedCountFor(dir: string): number {
  return indexFor(dir).notes.filter((n) => n.status === "queued" && n.round == null).length;
}

export async function refreshNotes(dir: string): Promise<void> {
  try {
    indexes.set(dir, await notesIndex(dir));
    notify();
  } catch { /* not an open project — the pane shows its empty state */ }
}

/** The heartbeat's `notes_generation`: refetch only when it actually moved. */
export function noteGeneration(dir: string, generation: number): void {
  if (indexFor(dir).generation >= generation) return;
  void refreshNotes(dir);
}

/* ---------- the on-screen subscription ---------- */
let onScreen: string | null = null;
let unlisten: (() => void) | null = null;
export function setNotesOnScreen(dir: string | null): void {
  onScreen = dir;
  if (dir && !unlisten) {
    let dead = false;
    void onNotesChanged((c) => { void onDiskChanged(c.dir, c.paths, c.generation); })
      .then((u) => { if (dead) u(); else unlisten = u; });
    // the setter may have flipped back before the listener landed
    if (!onScreen) { dead = true; }
  }
  if (!dir && unlisten) { unlisten(); unlisten = null; }
  if (dir) void refreshNotes(dir);
}

/** A write landed on disk — ours or the agent's. */
export async function onDiskChanged(dir: string, paths: string[], generation?: number): Promise<void> {
  if (generation === undefined || indexFor(dir).generation < generation) await refreshNotes(dir);
  const open = opens.get(dir);
  if (!open || !paths.includes(open.path)) { notify(); return; }
  let text: string;
  try { text = await notesRead(dir, open.path); } catch { notify(); return; }
  const { front, body } = splitFrontMatter(text);
  if (open.state === "saving") {
    // a write is in flight for this note: never overwrite the buffer mid-save.
    // Remember that disk moved under us so the pending save's resolution
    // lands on "dirty" (and re-arms) instead of a false "saved".
    if (body !== open.body) racedWhileSaving.add(dir);
  } else if (open.state === "dirty" || open.state === "error" || open.state === "locked") {
    if (body !== open.body) { open.incoming = text; open.conflict = true; }
  } else if (body !== open.body) {
    open.front = front; open.body = body; open.savedBody = body; open.conflict = false; open.incoming = null;
  } else {
    open.front = front;
  }
  notify();
}

export function reloadOpen(dir: string): void {
  const open = opens.get(dir);
  if (!open?.incoming) return;
  const { front, body } = splitFrontMatter(open.incoming);
  Object.assign(open, { front, body, savedBody: body, state: "clean" as SaveState, conflict: false, incoming: null, error: null });
  notify();
}
export function keepMine(dir: string): void {
  const open = opens.get(dir);
  if (!open) return;
  open.conflict = false; open.incoming = null;
  arm(dir);
  notify();
}

export async function openNote(dir: string, path: string): Promise<void> {
  await flushSave(dir);
  remember(dir, opens.get(dir)?.path);
  try {
    const text = await notesRead(dir, path);
    const { front, body } = splitFrontMatter(text);
    opens.set(dir, { path, front, body, savedBody: body, state: "clean", savedAt: null, error: null, conflict: false, incoming: null });
  } catch (e) {
    opens.set(dir, { path, front: "", body: "", savedBody: "", state: "error", savedAt: null, error: String(e).slice(0, 140), conflict: false, incoming: null });
  }
  notify();
}

export function editBody(dir: string, body: string): void {
  const open = opens.get(dir);
  if (!open) return;
  open.body = body;
  open.state = body === open.savedBody ? "clean" : "dirty";
  lastEdit.set(dir, Date.now());
  if (open.state === "dirty") arm(dir);
  notify();
}

/* ---------- the 600 ms debounce, on the scheduler ---------- */
const DEBOUNCE_MS = 600;
const lastEdit = new Map<string, number>();
const tickers = new Map<string, () => void>();
/** Set by onDiskChanged when a disk change arrives while a save is in
 *  flight for that dir; consumed by save() to force "dirty" on resolve
 *  rather than a false "saved" over content that's since moved again. */
const racedWhileSaving = new Set<string>();

function arm(dir: string): void {
  if (tickers.has(dir)) return;
  tickers.set(dir, every(DEBOUNCE_MS, async () => {
    const open = opens.get(dir);
    if (!open || open.state !== "dirty" || open.conflict) { disarm(dir); return; }
    if (Date.now() - (lastEdit.get(dir) ?? 0) < DEBOUNCE_MS) return; // still typing
    await save(dir);
    if (opens.get(dir)?.state !== "dirty") disarm(dir);
  }));
}
function disarm(dir: string): void {
  tickers.get(dir)?.();
  tickers.delete(dir);
}

/* Losing focus or visibility is the deadline the scheduler cannot promise: park
   nothing, flush everything. Registered once, at module scope. */
if (typeof window !== "undefined") {
  const flushAll = () => { for (const dir of opens.keys()) void flushSave(dir); };
  window.addEventListener("blur", flushAll);
  window.addEventListener("beforeunload", flushAll);
  document.addEventListener("visibilitychange", () => { if (document.hidden) flushAll(); });
}

async function save(dir: string): Promise<void> {
  const open = opens.get(dir);
  if (!open || open.state === "saving") return;
  const body = open.body;
  open.state = "saving";
  racedWhileSaving.delete(dir); // a fresh attempt; only races during THIS flight count
  notify();
  try {
    await notesWrite(dir, open.path, joinFrontMatter(open.front, body));
    const now = opens.get(dir);
    if (!now || now.path !== open.path) return;
    now.savedBody = body;
    now.error = null;
    const raced = racedWhileSaving.delete(dir);
    now.state = now.body === body && !raced ? "saved" : "dirty";
    now.savedAt = Date.now();
    if (now.state === "dirty") arm(dir); // same arm path editBody uses — no ghost-dirty note
  } catch (e) {
    const now = opens.get(dir);
    if (!now) return;
    const msg = String(e);
    // the editor keeps the unsaved text either way; the save retries on the
    // next keystroke pause
    now.state = msg.includes("locked") ? "locked" : "error";
    now.error = msg.slice(0, 140);
    if (now.state === "error") toastError("Couldn't save the note", msg.slice(0, 90));
  }
  notify();
}

/** Blur, pane switch, project switch, window close. */
export async function flushSave(dir: string): Promise<void> {
  const open = opens.get(dir);
  if (!open || open.state !== "dirty" || open.conflict) return;
  disarm(dir);
  await save(dir);
}

export async function setStatus(dir: string, status: NoteStatus | null): Promise<void> {
  const open = opens.get(dir);
  if (!open) return;
  open.front = setStatusInFront(open.front, status);
  open.state = "dirty";
  notify();
  await flushSave(dir);
}

export async function createNote(dir: string, folder: string, title: string): Promise<string> {
  const taken = new Set(indexFor(dir).notes.map((n) => n.path));
  const path = newNotePath(folder, title, taken);
  const name = (path.split("/").pop() ?? path).replace(/\.md$/, "");
  await notesWrite(dir, path, `# ${name}\n\n`);
  await refreshNotes(dir);
  await openNote(dir, path);
  return path;
}

export async function renameNote(dir: string, from: string, to: string): Promise<void> {
  const failed = await notesMove(dir, from, to);
  if (failed.length > 0) {
    toastError(`Couldn't rewrite links in ${failed.length} note${failed.length === 1 ? "" : "s"}`, failed.slice(0, 3).join(", "));
  }
  await refreshNotes(dir);
  const open = opens.get(dir);
  if (open?.path === from) { open.path = to; notify(); }
}

export async function deleteNote(dir: string, path: string): Promise<void> {
  await notesDelete(dir, path);
  if (opens.get(dir)?.path === path) opens.delete(dir);
  await refreshNotes(dir);
}

export function evictNotes(dir: string): void {
  disarm(dir);
  evictRoundLog(dir);
  indexes.delete(dir);
  opens.delete(dir);
  lastEdit.delete(dir);
  history.delete(dir);
  generating.delete(dir);
  for (const k of [...imageCache.keys()]) if (k.startsWith(`${dir}::`)) imageCache.delete(k);
}

/* the search overlay and the palette land here */
let pending: string | null = null;
export function openNoteInPane(path: string): void { pending = path; notify(); }
export function takePendingOpenNote(): string | null { const p = pending; pending = null; return p; }

export function noteEntry(dir: string, path: string): NoteEntry | undefined {
  return indexFor(dir).notes.find((n) => n.path === path);
}

/* ---------- the open round, pinned above the tree ---------- */

export interface OpenRound { n: number; notes: NoteEntry[]; done: number; total: number }

/** The round the pane pins above the tree: the newest round the RECORD still
 *  calls `ready` — its plan is written and its notes are locked. Reading the
 *  record rather than the notes' own statuses is what makes this survive a
 *  restart, and it is the same thing `notes_write` refuses on. A round whose
 *  notes are all done settles to `done` (Rust's settle_done) and shows nothing. */
export function openRoundFor(dir: string): OpenRound | null {
  const idx = indexFor(dir);
  const live = idx.rounds.filter((r) => r.state === "ready");
  if (live.length === 0) return null;
  const n = live.reduce((m, r) => Math.max(m, r.n), 0);
  const mine = idx.notes.filter((x) => x.round === n).sort((a, b) => a.path.localeCompare(b.path));
  return { n, notes: mine, done: mine.filter((x) => x.status === "done").length, total: mine.length };
}

/** What this note's round means for its editor: the pill says "locked by the
 *  round" for both, and `notes_write` refuses for both. Derived from the record
 *  on disk, so reopening the app mid-round says so instead of letting the user
 *  type into a note whose every save fails with a raw `locked`. */
/** The round whose plan is being written, if any — the log panel's first phase.
 *  Read from the record, so a restart mid-generation still finds it. */
export function generatingRoundFor(dir: string): number | null {
  return indexFor(dir).rounds.find((r) => r.state === "generating")?.n ?? null;
}

/** The pane's one answer to "what is this round doing?" — see roundPhaseOf.
 *  The record says `ready` for both "the plan is written, nothing has run" and
 *  "the executor is working"; the live session is what tells them apart. */
export function roundPhase(dir: string): { phase: RoundPhase; n: number } | null {
  return roundPhaseOf(indexFor(dir).rounds, execRunning(dir), agentRoundFor(dir));
}

/** How the round is being run, when it is: the headless session, or the agent
 *  pane (which has no session of its own). */
export function roundRoute(dir: string): "headless" | "agent" | null {
  if (execRunning(dir)) return "headless";
  return agentRoundFor(dir) != null ? "agent" : null;
}

/** "bug fixes" / "feature additions" — what the plan's first line declared. */
export function roundKindFor(dir: string, n: number): string {
  return indexFor(dir).rounds.find((r) => r.n === n)?.kind ?? "fixes";
}

/** The notes a round froze, in path order, and how many are done. */
export function roundNotesFor(dir: string, n: number): NoteEntry[] {
  return indexFor(dir).notes.filter((x) => x.round === n).sort((a, b) => a.path.localeCompare(b.path));
}

/** True while any round record could still change — what arms the pane's
 *  session watch, and nothing else. No round, no listeners. */
export function hasLiveRound(dir: string): boolean {
  return indexFor(dir).rounds.some((r) => r.state === "generating" || r.state === "ready");
}

export function roundStateFor(dir: string, round: number | null | undefined): "generating" | "ready" | null {
  if (round == null) return null;
  const state = indexFor(dir).rounds.find((r) => r.n === round)?.state;
  return state === "generating" || state === "ready" ? state : null;
}

/** True while a plan is being written. The record on disk is the truth — so a
 *  restart still knows — and the local flag only covers the window between the
 *  click and the first index refresh that carries the new round. */
const generating = new Set<string>();
export function roundGenerating(dir: string): boolean {
  return indexFor(dir).rounds.some((r) => r.state === "generating") || generating.has(dir);
}
export function setRoundGenerating(dir: string, on: boolean): void {
  if (on) generating.add(dir); else generating.delete(dir);
  notify();
}

/* ---------- images ----------
 * The webview cannot load a file:// path, so an attachment reference becomes a
 * data: URI the same way the board's thumbnails did. The reference is ALWAYS
 * vault-root-relative (`../attachments/<file>`, whatever folder the note sits
 * in), so the resolution never looks at the note's path. */
const imageCache = new Map<string, string>();   // dir::rel -> data URI
const imageInflight = new Set<string>();

/** `../attachments/x.png` → `.chronicle/attachments/x.png`, or null if it is not one. */
export function attachmentPath(ref: string): string | null {
  const m = /^\.\.\/attachments\/([^/]+)$/.exec(ref.trim());
  return m ? `.chronicle/attachments/${m[1]}` : null;
}

export function cachedImageSrc(dir: string, ref: string): string | null {
  return imageCache.get(`${dir}::${ref}`) ?? null;
}

export async function noteImageSrc(dir: string, ref: string): Promise<string | null> {
  const key = `${dir}::${ref}`;
  const hit = imageCache.get(key);
  if (hit) return hit;
  const rel = attachmentPath(ref);
  if (!rel || imageInflight.has(key)) return null;
  imageInflight.add(key);
  try {
    const b64 = await readFileB64(dir, rel);
    const ext = rel.split(".").pop()?.toLowerCase() ?? "png";
    const src = `data:${IMG_MIME[ext] ?? "image/png"};base64,${b64}`;
    imageCache.set(key, src);
    notify();
    return src;
  } catch {
    return null; // a missing file renders as a broken image, not a crash
  } finally {
    imageInflight.delete(key);
  }
}

/* ---------- ⌘[ back in note history, ⌘] follow the link under the caret ---------- */
const history = new Map<string, string[]>();
let goingBack = false;

/** Every openNote that is not a back-step remembers where it came from. */
function remember(dir: string, from: string | undefined): void {
  if (goingBack || !from) return;
  const h = history.get(dir) ?? [];
  if (h[h.length - 1] === from) return;
  h.push(from);
  history.set(dir, h.slice(-50));
}

export function noteHistoryBack(dir: string): void {
  const h = history.get(dir);
  const prev = h?.pop();
  if (!prev) return;
  goingBack = true;
  void openNote(dir, prev).finally(() => { goingBack = false; });
}

/** NoteEditor registers this on mount and clears it on unmount; it returns the
 *  resolved path of the wikiLink the caret is on, or null. */
let caretLink: (() => string | null) | null = null;
export function setCaretLinkResolver(fn: (() => string | null) | null): void { caretLink = fn; }

export function followLinkUnderCaret(dir: string): void {
  const target = caretLink?.();
  if (target) void openNote(dir, target);
}
