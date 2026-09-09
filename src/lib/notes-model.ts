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

const FM = /^---\n([\s\S]*?)\n---\n\n?/;

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
    const stripped = front.replace(/^status:[ \t]*.*\n/m, "");
    return stripped === "---\n---\n\n" ? "" : stripped;
  }
  if (/^status:/m.test(front)) return front.replace(/^status:[ \t]*.*$/m, `status: ${status}`);
  return front.replace(/^---\n/, `---\nstatus: ${status}\n`);
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

/** A couple of pixels of rounding is not an overflow worth animating. */
const MARQUEE_SLOP = 3;
export function needsMarquee(scrollWidth: number, clientWidth: number): boolean {
  return scrollWidth - clientWidth > MARQUEE_SLOP;
}
export function marqueeDistance(scrollWidth: number, clientWidth: number): number {
  return Math.max(0, scrollWidth - clientWidth);
}

export function slugFor(path: string): string {
  const title = (path.split("/").pop() ?? path).replace(/\.md$/, "");
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

const SANITIZE = /[/\\:*?"<>|]/g;
export function newNotePath(folder: string, title: string, taken: Set<string>): string {
  const base = title.replace(SANITIZE, "-").replace(/-{2,}/g, "-").trim().replace(/^-+|-+$/g, "").slice(0, 80).trim() || "Untitled";
  const at = (name: string) => (folder ? `${folder}/${name}.md` : `${name}.md`);
  if (!taken.has(at(base))) return at(base);
  for (let n = 2; ; n++) if (!taken.has(at(`${base} ${n}`))) return at(`${base} ${n}`);
}
