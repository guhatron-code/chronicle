/*
 * The Web pane's sidebar model — pure, no React, no Tauri. The store keeps one
 * flat, ordered array of tabs plus an ordered array of folders; a tab's
 * `folder` says which folder it is filed under (absent = the root). That flat
 * array is the only ordering there is: reordering splices inside it, so a move
 * inside one folder never disturbs the tabs of another.
 *
 * The tree draws folders first, in `folders` order, then the root's tabs in
 * tab order — the same shape the Notes sidebar reads as, and the reason a tab
 * dropped on a folder visibly leaves the root list.
 */
import { displayAddress } from "./web-url";


export interface WebFolder {
  /** stable identity, minted once and persisted */
  id: string;
  name: string;
  collapsed: boolean;
}

/** Everything the tree needs off a tab; WebTab in web-store.ts satisfies it. */
export interface TabLike {
  id: number;
  /** the folder it is filed under; null/undefined = the root */
  folder?: string | null;
}

export type WebTreeNode<T extends TabLike> =
  | { kind: "folder"; folder: WebFolder; open: boolean; tabs: T[] }
  | { kind: "tab"; tab: T };

/**
 * Folders (in folder order, each with its tabs in tab order), then the root's
 * tabs. `collapsed` overrides the folders' own `collapsed` flag when given —
 * the sidebar passes the live set, persistence keeps the flag.
 *
 * A tab whose `folder` names no folder is drawn at the root rather than
 * dropped, so a hand-edited file can never hide a tab.
 */
export function buildWebTree<T extends TabLike>(
  tabs: readonly T[],
  folders: readonly WebFolder[],
  collapsed?: ReadonlySet<string>,
): WebTreeNode<T>[] {
  const known = new Set(folders.map((f) => f.id));
  const out: WebTreeNode<T>[] = folders.map((folder) => ({
    kind: "folder" as const,
    folder,
    open: collapsed ? !collapsed.has(folder.id) : !folder.collapsed,
    tabs: tabs.filter((t) => t.folder === folder.id),
  }));
  for (const tab of tabs) if (!tab.folder || !known.has(tab.folder)) out.push({ kind: "tab", tab });
  return out;
}

/** The tabs of one container, in order — what an index in `moveTab` counts. */
export function tabsIn<T extends TabLike>(tabs: readonly T[], folders: readonly WebFolder[], folderId: string | null): T[] {
  const known = new Set(folders.map((f) => f.id));
  return folderId === null
    ? tabs.filter((t) => !t.folder || !known.has(t.folder))
    : tabs.filter((t) => t.folder === folderId);
}

/**
 * Move `tabId` into `folderId` (null = the root) at `index` within that
 * container, and hand back a new array. `index` counts the destination's tabs
 * *after* the tab has been lifted out, and is clamped; an id that names no tab
 * is a no-op, and a folder id that names no folder means the root.
 */
export function moveTab<T extends TabLike>(
  tabs: readonly T[],
  folders: readonly WebFolder[],
  tabId: number,
  folderId: string | null,
  index: number,
): T[] {
  const from = tabs.findIndex((t) => t.id === tabId);
  if (from < 0) return [...tabs];
  const known = new Set(folders.map((f) => f.id));
  const dest = folderId !== null && known.has(folderId) ? folderId : null;

  const rest = tabs.slice();
  const [moved] = rest.splice(from, 1);
  const next = { ...moved, folder: dest ?? undefined } as T;

  const siblings = tabsIn(rest, folders, dest);
  const at = Math.max(0, Math.min(index, siblings.length));
  // splice in front of the sibling that is to follow it; past the last one it
  // goes directly after that sibling, and an empty container appends
  const anchor = siblings[at];
  const pos = anchor
    ? rest.indexOf(anchor)
    : siblings.length > 0
      ? rest.indexOf(siblings[siblings.length - 1]) + 1
      : rest.length;
  rest.splice(pos, 0, next);
  return rest;
}

const SANITIZE = /[/\\:*?"<>|]/g;
/** A folder name reduced to one safe, single-line label — the notes sanitiser's
 *  rules, so a folder here and a folder there accept the same typing. */
export function sanitize(raw: string): string {
  return raw
    .replace(SANITIZE, "-").replace(/-{2,}/g, "-")
    .trim().replace(/^[-.]+|-+$/g, "")
    .slice(0, 80).trim();
}

/** Ids are minted from the clock plus a counter: unique inside one file, and
 *  short enough to read when the file is opened by hand. */
let folderSeq = 0;
export function newFolderId(now = Date.now()): string {
  return `f${now.toString(36)}${(folderSeq++).toString(36)}`;
}

/** Appends a folder; an empty name (or one the sanitiser eats) becomes "Untitled". */
export function createFolder(folders: readonly WebFolder[], name: string, id = newFolderId()): { folders: WebFolder[]; folder: WebFolder } {
  const folder: WebFolder = { id, name: sanitize(name) || "Untitled", collapsed: false };
  return { folders: [...folders, folder], folder };
}

/** Renames in place; a name the sanitiser empties leaves the folder alone. */
export function renameFolder(folders: readonly WebFolder[], id: string, name: string): WebFolder[] {
  const clean = sanitize(name);
  if (!clean) return [...folders];
  return folders.map((f) => (f.id === id ? { ...f, name: clean } : f));
}

/** Sets one folder's collapsed flag (persistence's copy of what the tree shows). */
export function setFolderCollapsed(folders: readonly WebFolder[], id: string, collapsed: boolean): WebFolder[] {
  return folders.map((f) => (f.id === id ? { ...f, collapsed } : f));
}

/**
 * Drops a folder. Its tabs are not closed: they lose the `folder` and stay
 * exactly where they are in the flat array, which puts them at the root in the
 * order they had inside the folder.
 */
export function deleteFolder<T extends TabLike>(
  tabs: readonly T[],
  folders: readonly WebFolder[],
  id: string,
): { tabs: T[]; folders: WebFolder[] } {
  return {
    tabs: tabs.map((t) => (t.folder === id ? ({ ...t, folder: undefined } as T) : t)),
    folders: folders.filter((f) => f.id !== id),
  };
}

/* ---------- persistence ---------- */

export interface SavedShape {
  tabs: { url: string; title: string; folder?: string }[];
  folders: WebFolder[];
}

/**
 * What came back from `web_tabs_load`, normalised. Three shapes reach here: the
 * modern `{tabs, folders}`, the bare array files written before folders
 * existed (every tab at the root, in order), and junk — a half-written file, a
 * hand-edit — which loads as nothing rather than throwing the pane away.
 */
export function normalizeSaved(value: unknown): SavedShape {
  const empty: SavedShape = { tabs: [], folders: [] };
  if (!value) return empty;
  const rawTabs = Array.isArray(value) ? value : Array.isArray((value as SavedShape).tabs) ? (value as SavedShape).tabs : null;
  if (!rawTabs) return empty;
  const rawFolders = Array.isArray(value) ? [] : ((value as SavedShape).folders ?? []);

  const folders: WebFolder[] = [];
  const seen = new Set<string>();
  for (const f of rawFolders) {
    const id = typeof f?.id === "string" ? f.id : "";
    if (!id || seen.has(id)) continue;
    seen.add(id);
    folders.push({ id, name: (typeof f.name === "string" && sanitize(f.name)) || "Untitled", collapsed: f.collapsed === true });
  }

  const tabs: SavedShape["tabs"] = [];
  for (const t of rawTabs) {
    if (typeof t?.url !== "string") continue;
    const folder = typeof t.folder === "string" && seen.has(t.folder) ? t.folder : undefined;
    tabs.push({ url: t.url, title: typeof t.title === "string" ? t.title : "", ...(folder ? { folder } : {}) });
  }
  return { tabs, folders };
}

/* ---------- what a tab row reads as ---------- */

/** The label a tab row shows — a project file reads as its file name, not the
 *  whole "this project › path" the address bar spells out. */
export function tabLabel(tab: { title: string; url: string }): string {
  if (tab.title) return tab.title;
  const shown = displayAddress(tab.url);
  if (!shown) return "New tab";
  const m = /^this project › (.*)$/.exec(shown);
  if (m) return m[1].split("/").pop() || m[1];
  return shown;
}

/** The old strip's dot, unchanged: still fetching · a file off this disk · a
 *  page that loaded. A blank new tab is none of the three. */
export function tabDot(tab: { loading: boolean; url: string }): "loading" | "live" | "local" | null {
  if (tab.loading) return "loading";
  if (tab.url.startsWith("chronicle-file")) return "local";
  return /^https?:\/\//.test(tab.url) ? "live" : null;
}
