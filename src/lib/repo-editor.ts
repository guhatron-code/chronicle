/*
 * The Repo pane's unsaved work, outside React so a buffer survives a tab, pane
 * or project switch. There is NO autosave here: code is saved when the user
 * says ⌘S and at no other moment, which is the whole reason this is a separate
 * store from the notes' 600 ms debounce.
 *
 * No timers of any kind live in this file — the watcher's `project-fs-changed`
 * is the only thing that wakes it, and the pane routes that in.
 */
import { readFile, readFileText, writeFile } from "./ipc";

export type BufferState = "clean" | "dirty" | "saving" | "conflict" | "error";

export interface Buffer {
  dir: string;
  path: string;
  /** what the editor holds right now */
  text: string;
  /** what is on disk as far as we know */
  savedText: string;
  /** the mtime the next write must match */
  mtime: number;
  state: BufferState;
  /** the disk version waiting behind the conflict bar */
  incoming: { text: string; mtime: number } | null;
  error: string | null;
  savedAt: number | null;
}

/** NUL cannot appear in a path on any platform, so it is the one separator that
 *  cannot collide ("/a" + "b c/d.ts" vs "/a b" + "c/d.ts"). Written as the
 *  escape so the source file stays text. */
export function bufferKey(dir: string, path: string): string { return `${dir}\0${path}`; }

const buffers = new Map<string, Buffer>();
const subs = new Set<() => void>();
const disposers = new Set<(key: string) => void>();
const notify = () => { for (const cb of subs) cb(); };

export function subscribeBuffers(cb: () => void): () => void { subs.add(cb); return () => { subs.delete(cb); }; }
/** CodeMirror's per-buffer EditorState cache hangs off this — the undo history
 *  must die exactly when the buffer does, and not one tab switch earlier. */
export function onBufferDisposed(cb: (key: string) => void): () => void {
  disposers.add(cb);
  return () => { disposers.delete(cb); };
}
const dispose = (key: string) => { for (const cb of disposers) cb(key); };

export function bufferFor(dir: string, path: string): Buffer | null {
  return buffers.get(bufferKey(dir, path)) ?? null;
}

/** Called on the first EDIT, not on open — read-only browsing costs nothing. */
export function openBuffer(dir: string, path: string, text: string, mtime: number): Buffer {
  const existing = buffers.get(bufferKey(dir, path));
  if (existing) return existing;
  const b: Buffer = {
    dir, path, text, savedText: text, mtime,
    state: "clean", incoming: null, error: null, savedAt: null,
  };
  buffers.set(bufferKey(dir, path), b);
  notify();
  return b;
}

export function editBuffer(dir: string, path: string, text: string): void {
  const b = buffers.get(bufferKey(dir, path));
  if (!b) return;
  const was = b.state;
  b.text = text;
  if (b.state !== "conflict") b.state = text === b.savedText ? "clean" : "dirty";
  // A keystroke changes nothing React draws except the save word, and that
  // moves once per cycle — notifying per character re-rendered the whole pane.
  if (b.state !== was) notify();
}

export async function saveBuffer(dir: string, path: string): Promise<void> {
  const b = buffers.get(bufferKey(dir, path));
  if (!b || b.state === "saving" || b.state === "clean") return;
  const text = b.text;
  const expected = b.mtime;
  b.state = "saving";
  b.error = null;
  notify();
  /* The buffer is followed as an OBJECT, never looked up again by the key it
   * started under: a rename during the write moves the very same live buffer to
   * a new key, and re-reading the old key found nothing and left the file stuck
   * on "saving" forever. `alive` is false only when the buffer really went
   * away — closed, or the project evicted — and every exit notifies, because
   * the header word and the tab's dot are what change here. */
  const alive = () => bufferFor(b.dir, b.path) === b;
  try {
    const mtime = await writeFile(dir, path, text, expected);
    if (!alive()) { notify(); return; }
    b.savedText = text;
    b.mtime = mtime;
    b.savedAt = Date.now();
    b.state = b.text === text ? "clean" : "dirty"; // typed on while saving
    b.incoming = null;
  } catch (e) {
    if (!alive()) { notify(); return; }
    const msg = String(e);
    if (msg.includes("changed on disk")) {
      // never a toast: the bar is the only place this is said
      await raiseConflict(b);
    } else {
      b.state = "error";
      b.error = msg.slice(0, 140);
    }
  }
  notify();
}

async function raiseConflict(b: Buffer): Promise<void> {
  try {
    const disk = await readFile(b.dir, b.path);
    b.incoming = { text: disk.text, mtime: disk.mtime_ms };
  } catch {
    b.incoming = { text: b.savedText, mtime: b.mtime };
  }
  b.state = "conflict";
  b.error = null;
}

/** The watcher said this path moved — ours or the agent's. */
export async function onFileChanged(dir: string, path: string): Promise<void> {
  const b = buffers.get(bufferKey(dir, path));
  if (!b || b.state === "saving" || b.state === "conflict") return;
  let disk: { text: string; mtime_ms: number };
  try { disk = await readFile(dir, path); } catch { return; }
  const now = buffers.get(bufferKey(dir, path));
  if (!now || now.state === "saving" || now.state === "conflict") return;
  // our own write coming back round: the disk already says what we saved
  if (disk.text === now.savedText) { now.mtime = disk.mtime_ms; notify(); return; }
  if (now.state === "clean") {
    now.text = disk.text;
    now.savedText = disk.text;
    now.mtime = disk.mtime_ms;
    notify();
    return;
  }
  // dirty or error: the bar, never a silent overwrite
  now.incoming = { text: disk.text, mtime: disk.mtime_ms };
  now.state = "conflict";
  now.error = null;
  notify();
}

export function reloadBuffer(dir: string, path: string): void {
  const b = buffers.get(bufferKey(dir, path));
  if (!b?.incoming) return;
  b.text = b.incoming.text;
  b.savedText = b.incoming.text;
  b.mtime = b.incoming.mtime;
  b.state = "clean";
  b.incoming = null;
  b.error = null;
  notify();
}

/** Your text stays; the DISK's mtime comes along, so the next save is accepted. */
export function keepMine(dir: string, path: string): void {
  const b = buffers.get(bufferKey(dir, path));
  if (!b) return;
  if (b.incoming) b.mtime = b.incoming.mtime;
  b.incoming = null;
  b.state = b.text === b.savedText ? "clean" : "dirty";
  b.error = null;
  notify();
}

export function closeBuffer(dir: string, path: string): void {
  const key = bufferKey(dir, path);
  if (!buffers.delete(key)) return;
  dispose(key);
  notify();
}

export function renameBuffer(dir: string, from: string, to: string): void {
  const key = bufferKey(dir, from);
  const b = buffers.get(key);
  if (!b) return;
  buffers.delete(key);
  dispose(key); // the CodeMirror state is keyed by path; a rename starts a new one
  b.path = to;
  buffers.set(bufferKey(dir, to), b);
  notify();
}

export function dirtyPathsFor(dir: string): string[] {
  const out: string[] = [];
  for (const b of buffers.values()) {
    if (b.dir === dir && (b.state === "dirty" || b.state === "conflict" || b.state === "error")) out.push(b.path);
  }
  return out.sort();
}

/** The quit guard's chain, without the quit: the next project that still has
 *  unsaved work, the open one first, each asked about at most once. Null means
 *  nothing is left to ask about — the app may go. */
export function nextDirtyDir(dirs: (string | null | undefined)[], asked: ReadonlySet<string>): string | null {
  for (const d of dirs) if (d && !asked.has(d) && dirtyPathsFor(d).length > 0) return d;
  return null;
}

export function anyDirty(): boolean {
  for (const b of buffers.values()) {
    if (b.state === "dirty" || b.state === "conflict" || b.state === "error") return true;
  }
  return false;
}

export function evictBuffers(dir: string): void {
  for (const [key, b] of [...buffers]) {
    if (b.dir !== dir) continue;
    buffers.delete(key);
    dispose(key);
  }
  editorConfigs.delete(dir);
  notify();
}

/* ---------- the header's word ---------- */

/** `now` is passed in so the function stays pure and the label never claims
 *  more precision than the next render can honour. */
export function saveLabelFor(b: Buffer | null, now: number): string {
  if (!b) return "";
  if (b.state === "saving") return "saving";
  if (b.state === "error") return b.error ?? "couldn't save";
  if (b.state === "conflict") return "";
  if (b.state === "dirty") return "unsaved";
  if (b.savedAt === null) return "";
  const s = Math.floor(Math.max(0, now - b.savedAt) / 1000);
  if (s < 60) return `saved · ${s}s ago`;
  if (s < 3600) return `saved · ${Math.floor(s / 60)}m ago`;
  return `saved · ${Math.round(s / 3600)}h ago`;
}

/* ---------- languages ---------- */

export type LangId =
  | "javascript" | "typescript" | "jsx" | "tsx" | "json" | "css" | "html"
  | "markdown" | "rust" | "python" | "shell" | "toml" | "yaml" | "plain";

const BY_EXT: Record<string, LangId> = {
  js: "javascript", mjs: "javascript", cjs: "javascript",
  ts: "typescript", mts: "typescript", cts: "typescript",
  jsx: "jsx", tsx: "tsx",
  json: "json", jsonc: "json",
  css: "css", scss: "css", less: "css",
  html: "html", htm: "html", svg: "html", vue: "html",
  md: "markdown", markdown: "markdown", mdx: "markdown",
  rs: "rust", py: "python", pyi: "python",
  sh: "shell", bash: "shell", zsh: "shell", fish: "shell",
  toml: "toml", lock: "toml",
  yml: "yaml", yaml: "yaml",
};

const BY_NAME: Record<string, LangId> = {
  ".zshrc": "shell", ".bashrc": "shell", ".bash_profile": "shell", ".profile": "shell",
  dockerfile: "shell", makefile: "plain", ".editorconfig": "toml", ".gitignore": "plain",
};

export function languageIdFor(path: string): LangId {
  const name = (path.split("/").pop() ?? path).toLowerCase();
  const byName = BY_NAME[name];
  if (byName) return byName;
  const i = name.lastIndexOf(".");
  if (i <= 0) return "plain"; // no dot, or a dotfile with no extension
  return BY_EXT[name.slice(i + 1)] ?? "plain";
}

/* ---------- .editorconfig ---------- */

const editorConfigs = new Map<string, string>();

/** Read once per project; a missing file is remembered as "none". */
export async function loadEditorConfig(dir: string): Promise<void> {
  if (editorConfigs.has(dir)) return;
  try { editorConfigs.set(dir, await readFileText(dir, ".editorconfig")); }
  catch { editorConfigs.set(dir, ""); }
}

export function tabSizeFor(dir: string, path: string): number {
  return editorConfigTabSize(editorConfigs.get(dir) ?? "", path) ?? 2;
}

function globToRe(glob: string): RegExp {
  let out = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === "*") {
      if (glob[i + 1] === "*") { out += ".*"; i++; }
      else out += "[^/]*";
    } else if (c === "?") out += "[^/]";
    else if (c === "{") out += "(";
    else if (c === "}") out += ")";
    else if (c === ",") out += "|";
    else out += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${out}$`);
}

function sectionMatches(pattern: string, relPath: string): boolean {
  const re = globToRe(pattern);
  if (re.test(relPath)) return true;
  // a pattern with no slash matches the file name at any depth
  if (!pattern.includes("/")) return re.test(relPath.split("/").pop() ?? relPath);
  return false;
}

/** The last matching section wins, as .editorconfig specifies. `indent_size`
 *  first, and `tab_width` when indent_size is absent or the literal "tab". */
export function editorConfigTabSize(text: string, relPath: string): number | null {
  let matched = false;
  let indentStyle: string | null = null;
  let indentSize: string | null = null;
  let tabWidth: string | null = null;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;
    if (line.startsWith("[") && line.endsWith("]")) {
      matched = sectionMatches(line.slice(1, -1), relPath);
      continue;
    }
    if (!matched) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim().toLowerCase();
    const value = line.slice(eq + 1).trim().toLowerCase();
    if (key === "indent_style") indentStyle = value;
    else if (key === "indent_size") indentSize = value;
    else if (key === "tab_width") tabWidth = value;
  }
  // Tab-indented sections size themselves off tab_width first; everyone else
  // (and the "indent_size = tab" shorthand) prefers indent_size.
  const preferTabWidth = indentStyle === "tab" || indentSize === "tab";
  const pick = preferTabWidth ? (tabWidth ?? indentSize) : (indentSize ?? tabWidth);
  const n = Number(pick);
  return Number.isFinite(n) && n > 0 && n <= 16 ? n : null;
}
