/*
 * What the `[[` and `#` menus put on screen, and when the `#` menu is allowed
 * to open at all. React-free on purpose: the rows are the part worth testing,
 * and the tests run in vitest's node environment.
 *
 * The rule both menus follow: a menu that can only offer what already exists is
 * a dead end the moment you are inventing something. Both therefore always
 * carry a row for what you have typed — otherwise typing `#idea` in a vault
 * with no `idea` tag filters every row away and the popup renders empty.
 */
import Fuse from "fuse.js";
import type { NoteEntry } from "@/lib/ipc";

export interface NoteSuggestion { path: string; title: string; folder: string; create?: boolean }
export interface TagSuggestion { tag: string; count: number; create?: boolean }

/** Fuzzy over titles and folders; "Create …" is always the last row. */
export function wikiLinkItems(notes: NoteEntry[], query: string): NoteSuggestion[] {
  const rows: NoteSuggestion[] = notes.map((n) => ({ path: n.path, title: n.title, folder: n.folder }));
  const q = query.trim();
  if (!q) return rows.slice(0, 8);
  const fuse = new Fuse(rows, { keys: ["title", "folder"], threshold: 0.35, minMatchCharLength: 1 });
  const hits = fuse.search(q).map((r) => r.item).slice(0, 8);
  if (!hits.some((h) => h.title.toLowerCase() === q.toLowerCase())) {
    hits.push({ path: "", title: q, folder: "new note", create: true });
  }
  return hits;
}

/** The global tag shape (see the spec): `#` then letters, digits, `_`, `/`, `-`. */
const TAG_NAME = /^[A-Za-z0-9_/-]+$/;

export function tagItems(tags: TagSuggestion[], query: string): TagSuggestion[] {
  const q = query.trim();
  const lower = q.toLowerCase();
  const hits = tags.filter((t) => !lower || t.tag.toLowerCase().includes(lower)).slice(0, 10);
  // a tag the vault has never seen still has to be typeable — without this row
  // the menu is empty exactly when the user is inventing one
  if (q && TAG_NAME.test(q) && !hits.some((t) => t.tag.toLowerCase() === lower)) {
    hits.push({ tag: q, count: 0, create: true });
  }
  return hits;
}

/**
 * `# ` at the start of a line is a heading, never a tag. So a bare `#` opening
 * its block stays silent, but `#i` there is already a tag — and mid-line every
 * `#` opens straight away.
 *
 * `matched` is the text the suggestion plugin matched: the `#` plus whatever
 * has been typed after it, which is why one character is enough to tell the two
 * apart. `parentOffset` is the caret's offset inside its own block.
 */
export function tagAllowed(parentOffset: number, matched: string): boolean {
  return parentOffset > 0 || matched.length > 1;
}
