/*
 * Everything the Notes pane computes rather than fetches — and nothing else.
 * No Tauri, no React, no timers: the store and the components are thin layers
 * on top, and every rule here is pinned by notes-model.test.ts.
 *
 * Front matter is opaque to the frontend. Rust owns created/updated and the
 * parse; the pane keeps the raw block as a string, changes at most the status
 * line, and hands it back untouched otherwise.
 */
import type { NoteEntry, NoteStatus } from "./ipc";

export type SaveState = "clean" | "dirty" | "saving" | "saved" | "error" | "locked";
export interface TreeNode { kind: "folder" | "note"; name: string; path: string; depth: number; entry?: NoteEntry }
export interface Backlink { path: string; title: string; context: string }
export interface Outlink { target: string; label: string | null; path: string | null; ambiguous: boolean }
export interface Pill { label: string; tone: "none" | "queued" | "progress" | "done" | "unknown"; locked: boolean }

/* A file written on Windows (or pasted from one) ends its lines with \r\n; a
   front-matter block the regex missed would be edited as body text and the
   status line would be saved twice over. */
const FM = /^---\r?\n([\s\S]*?)\r?\n---\r?\n(?:\r?\n)?/;

export function splitFrontMatter(text: string): { front: string; body: string } {
  const m = FM.exec(text);
  if (!m) return { front: "", body: text };
  return { front: m[0], body: text.slice(m[0].length) };
}
export function joinFrontMatter(front: string, body: string): string {
  return front + body;
}
export function statusInFront(front: string): string | null {
  const m = /^status:[ \t]*(.*)$/m.exec(front);
  const v = m?.[1]?.trim();
  return v ? v : null;
}
/** Rewrite the one line, keep every other key and its order. */
export function setStatusInFront(front: string, status: NoteStatus | null): string {
  if (!front) return status ? `---\nstatus: ${status}\n---\n\n` : "";
  if (status === null) {
    const stripped = front.replace(/^status:[ \t]*[^\r\n]*\r?\n/m, "");
    return /^---\r?\n---\r?\n\r?\n?$/.test(stripped) ? "" : stripped;
  }
  if (/^status:/m.test(front)) return front.replace(/^status:[ \t]*[^\r\n]*$/m, `status: ${status}`);
  return front.replace(/^---(\r?\n)/, `---$1status: ${status}$1`);
}

/** Folders before notes at the vault root; inside a folder its own notes come
 *  before its subfolders. Each level sorted by name; a collapsed folder hides
 *  its subtree. */
export function buildTree(notes: NoteEntry[], collapsed: Set<string>): TreeNode[] {
  const folders = new Set<string>();
  for (const n of notes) {
    const parts = n.path.split("/").slice(0, -1);
    for (let i = 0; i < parts.length; i++) folders.add(parts.slice(0, i + 1).join("/"));
  }
  const childFolders = (parent: string) =>
    [...folders].filter((f) => (f.includes("/") ? f.slice(0, f.lastIndexOf("/")) : "") === parent).sort();
  const childNotes = (parent: string) =>
    notes.filter((n) => n.folder === parent).sort((a, b) => a.title.localeCompare(b.title));

  const out: TreeNode[] = [];
  const emitFolder = (f: string, depth: number) => {
    out.push({ kind: "folder", name: f.split("/").pop() ?? f, path: f, depth });
    if (collapsed.has(f)) return;
    for (const n of childNotes(f)) out.push({ kind: "note", name: n.title, path: n.path, depth: depth + 1, entry: n });
    for (const sub of childFolders(f)) emitFolder(sub, depth + 1);
  };
  for (const f of childFolders("")) emitFolder(f, 0);
  for (const n of childNotes("")) out.push({ kind: "note", name: n.title, path: n.path, depth: 0, entry: n });
  return out;
}

/** buildTree hands back a flat pre-order list with a depth on every node; the
 *  sidebar draws it nested, so an open folder's children sit inside a single
 *  guide line — the shape the Repo pane's explorer has. A collapsed folder has
 *  no children in the flat list, so it gets none here either. */
export interface TreeBranch extends TreeNode { children: TreeBranch[] }
export function nestTree(flat: TreeNode[]): TreeBranch[] {
  const roots: TreeBranch[] = [];
  const stack: TreeBranch[] = [];
  for (const node of flat) {
    const branch: TreeBranch = { ...node, children: [] };
    while (stack.length > node.depth) stack.pop();
    (stack[stack.length - 1]?.children ?? roots).push(branch);
    stack.push(branch);
  }
  return roots;
}

export function backlinksFor(notes: NoteEntry[], path: string): Backlink[] {
  return notes
    .filter((n) => n.path !== path && n.resolved.includes(path))
    .map((n) => ({ path: n.path, title: n.title, context: n.snippet }));
}

export function outlinksFor(notes: NoteEntry[], path: string): Outlink[] {
  const n = notes.find((x) => x.path === path);
  if (!n) return [];
  return n.links.map((l, i) => ({
    target: l.target, label: l.label,
    path: n.resolved[i] ?? null,
    ambiguous: n.ambiguous[i] ?? false,
  }));
}

export function tagCounts(notes: NoteEntry[]): { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const n of notes) for (const t of n.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

export function pillFor(status: string | null, round: number | null, roundState: string | null): Pill {
  const locked = roundState === "generating" || roundState === "ready";
  if (status === null) return { label: "no status", tone: "none", locked };
  if (status === "queued") return { label: "queued", tone: "queued", locked };
  if (status === "in_progress") return { label: round != null ? `in progress · round ${round}` : "in progress", tone: "progress", locked };
  if (status === "done") return { label: "done", tone: "done", locked: false };
  return { label: "unknown", tone: "unknown", locked };
}

export function slugFor(path: string): string {
  const title = (path.split("/").pop() ?? path).replace(/\.md$/, "");
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

const SANITIZE = /[/\\:*?"<>|]/g;
/** Free text reduced to ONE safe path segment — a note title, or a new folder's
 *  name. Separators become dashes and a leading dot goes, so nothing the user
 *  types can walk out of the vault or hide the file it makes. */
export function sanitizeTitle(raw: string): string {
  return raw
    .replace(SANITIZE, "-").replace(/-{2,}/g, "-")
    .trim().replace(/^[-.]+|-+$/g, "")
    .slice(0, 80).trim();
}
export function newNotePath(folder: string, title: string, taken: Set<string>): string {
  const base = sanitizeTitle(title) || "Untitled";
  const at = (name: string) => (folder ? `${folder}/${name}.md` : `${name}.md`);
  if (!taken.has(at(base))) return at(base);
  for (let n = 2; ; n++) if (!taken.has(at(`${base} ${n}`))) return at(`${base} ${n}`);
}

/* ---------- the round log panel (pure parts) ---------- */

export type RoundPhase = "generating" | "plan-ready" | "executing" | "finished" | "failed";

/** Just the fields the phase model needs off `.chronicle/rounds.json`. */
export interface RoundRecord { n: number; state: string }

/**
 * Which phase a project's newest round is in, and its number.
 *
 * The record cannot answer this on its own: it says `ready` from the moment
 * the plan is written until the last note is done, which covers both "written,
 * nothing has run" and "the executor is working". Only a live session tells
 * them apart — the headless `exec` session, or (for the agent-pane route,
 * which has no session and no log) this session's own record of the click.
 *
 * A round that has ENDED still answers, until `dismissed` catches up with its
 * number: the run you have just watched is the one you most want to read back,
 * and the card vanishing the moment the last note ticked took the log with it.
 * A newer round always outranks a dismissed one.
 */
export function roundPhaseOf(
  rounds: RoundRecord[],
  execRunning: boolean,
  agentRound: number | null,
  dismissed = 0,
): { phase: RoundPhase; n: number } | null {
  const newest = (rs: RoundRecord[]) => rs.reduce((m, r) => Math.max(m, r.n), 0);
  const generating = rounds.filter((r) => r.state === "generating");
  if (generating.length > 0) return { phase: "generating", n: newest(generating) };
  const ready = rounds.filter((r) => r.state === "ready");
  if (ready.length > 0) {
    const n = newest(ready);
    return { phase: execRunning || agentRound === n ? "executing" : "plan-ready", n };
  }
  const over = rounds.filter((r) => r.state === "done" || r.state === "failed");
  if (over.length === 0) return null;
  const n = newest(over);
  if (n <= dismissed) return null;
  return { phase: over.find((r) => r.n === n)?.state === "failed" ? "failed" : "finished", n };
}

/** The panel never grows without bound: a long round's tail is thousands of
 *  lines nobody scrolls back through, and the DOM pays for every one. The
 *  session carries the WHOLE last 30 kB of the log on each event rather than a
 *  delta, so this is a re-split of the tail, not an append. */
export const LOG_MAX_LINES = 400;
export function tailLines(tail: string, max = LOG_MAX_LINES): string[] {
  const all: string[] = [];
  for (const raw of tail.split("\n")) {
    const line = raw.replace(/\s+$/, "");
    if (line.length > 0) all.push(line);
  }
  return all.length > max ? all.slice(all.length - max) : all;
}

/** Auto-scroll follows the tail until the reader scrolls up to read something,
 *  and picks it up again when they scroll back down. A few pixels of rounding
 *  (and the browser's sub-pixel scrollTop) is not "scrolled up". */
export const STICK_SLOP = 24;
export function stickToBottom(scrollTop: number, scrollHeight: number, clientHeight: number): boolean {
  return scrollHeight - clientHeight - scrollTop <= STICK_SLOP;
}

/** The round card's second line, in each phase. */
export function roundSubline(
  phase: RoundPhase,
  route: "headless" | "agent" | null,
  done: number,
  total: number,
): string {
  const notes = `${total} ${total === 1 ? "note" : "notes"}`;
  if (phase === "generating") return `${notes} · writing the plan…`;
  if (phase === "plan-ready") return `${notes} · plan ready · not started`;
  if (phase === "finished") return `${notes} · done · ${done} of ${total}`;
  if (phase === "failed") return `${notes} · didn't finish · ${done} of ${total} done`;
  return `${notes} · executing · ${done} of ${total} done · ${route === "agent" ? "in the agent pane" : "headless"}`;
}

/** The one line at the top of the panel. Executing counts what has actually
 *  landed in the notes' front matter — the same truth the round card shows. */
export function roundLogHeader(phase: RoundPhase, n: number, done: number, total: number): string {
  if (phase === "generating") return `Round ${n} · writing the plan`;
  if (phase === "plan-ready") return `Round ${n} · plan ready · not started`;
  if (phase === "finished") return `Round ${n} · done · ${done} of ${total}`;
  if (phase === "failed") return `Round ${n} · didn't finish · ${done} of ${total} done`;
  return `Round ${n} · executing · ${done} of ${total} done`;
}
