import { beforeEach, describe, expect, it, vi } from "vitest";

let diskText = "one\n";
let diskMtime = 1000;
let writeError: string | null = null;
/** Set to hold a write open — the only way to observe a buffer mid-save. */
let holdWrite: Promise<void> | null = null;
const writes: { path: string; text: string; expected?: number }[] = [];

vi.mock("./ipc", () => ({
  readFile: vi.fn(async () => ({
    text: diskText, mtime_ms: diskMtime, size: diskText.length, binary: false, too_large: false,
  })),
  readFileText: vi.fn(async () => diskText),
  writeFile: vi.fn(async (_d: string, path: string, text: string, expected?: number) => {
    if (holdWrite) await holdWrite;
    if (writeError) throw writeError;
    writes.push({ path, text, expected });
    diskText = text;
    diskMtime += 100;
    return diskMtime;
  }),
}));

const ed = await import("./repo-editor");

const DIR = "/p";
const F = "src/a.ts";

describe("the repo buffer store", () => {
  beforeEach(() => {
    ed.evictBuffers(DIR);
    diskText = "one\n";
    diskMtime = 1000;
    writeError = null;
    holdWrite = null;
    writes.length = 0;
  });

  it("edit then save leaves a clean buffer, and the save carries the expected mtime", async () => {
    ed.openBuffer(DIR, F, "one\n", 1000);
    expect(ed.bufferFor(DIR, F)!.state).toBe("clean");
    ed.editBuffer(DIR, F, "two\n");
    expect(ed.bufferFor(DIR, F)!.state).toBe("dirty");
    expect(ed.dirtyPathsFor(DIR)).toEqual([F]);
    await ed.saveBuffer(DIR, F);
    const b = ed.bufferFor(DIR, F)!;
    expect(b.state).toBe("clean");
    expect(b.savedText).toBe("two\n");
    expect(b.mtime).toBe(1100);
    expect(writes).toEqual([{ path: F, text: "two\n", expected: 1000 }]);
    expect(ed.dirtyPathsFor(DIR)).toEqual([]);
  });

  it("typing the saved text back makes the buffer clean again", () => {
    ed.openBuffer(DIR, F, "one\n", 1000);
    ed.editBuffer(DIR, F, "two\n");
    ed.editBuffer(DIR, F, "one\n");
    expect(ed.bufferFor(DIR, F)!.state).toBe("clean");
  });

  it("a disk change under a CLEAN buffer reloads silently", async () => {
    ed.openBuffer(DIR, F, "one\n", 1000);
    diskText = "from the agent\n";
    diskMtime = 2000;
    await ed.onFileChanged(DIR, F);
    const b = ed.bufferFor(DIR, F)!;
    expect(b.state).toBe("clean");
    expect(b.text).toBe("from the agent\n");
    expect(b.savedText).toBe("from the agent\n");
    expect(b.mtime).toBe(2000);
  });

  it("a disk change under a DIRTY buffer raises the conflict, and Reload takes disk", async () => {
    ed.openBuffer(DIR, F, "one\n", 1000);
    ed.editBuffer(DIR, F, "mine\n");
    diskText = "theirs\n";
    diskMtime = 2000;
    await ed.onFileChanged(DIR, F);
    const b = ed.bufferFor(DIR, F)!;
    expect(b.state).toBe("conflict");
    expect(b.text).toBe("mine\n");
    expect(b.incoming).toEqual({ text: "theirs\n", mtime: 2000 });

    ed.reloadBuffer(DIR, F);
    const after = ed.bufferFor(DIR, F)!;
    expect(after.state).toBe("clean");
    expect(after.text).toBe("theirs\n");
    expect(after.mtime).toBe(2000);
    expect(after.incoming).toBeNull();
  });

  it("Keep mine leaves the buffer and takes the disk mtime so the next save wins", async () => {
    ed.openBuffer(DIR, F, "one\n", 1000);
    ed.editBuffer(DIR, F, "mine\n");
    diskText = "theirs\n";
    diskMtime = 2000;
    await ed.onFileChanged(DIR, F);
    ed.keepMine(DIR, F);
    const b = ed.bufferFor(DIR, F)!;
    expect(b.state).toBe("dirty");
    expect(b.text).toBe("mine\n");
    expect(b.mtime).toBe(2000);
    expect(b.incoming).toBeNull();
    await ed.saveBuffer(DIR, F);
    expect(writes.at(-1)).toEqual({ path: F, text: "mine\n", expected: 2000 });
    expect(ed.bufferFor(DIR, F)!.state).toBe("clean");
  });

  it("our own write echo is ignored — no conflict bar after a save", async () => {
    ed.openBuffer(DIR, F, "one\n", 1000);
    ed.editBuffer(DIR, F, "two\n");
    await ed.saveBuffer(DIR, F);
    await ed.onFileChanged(DIR, F); // the watcher fires for OUR write
    const b = ed.bufferFor(DIR, F)!;
    expect(b.state).toBe("clean");
    expect(b.incoming).toBeNull();
  });

  it("a refused save becomes the conflict, never an error", async () => {
    ed.openBuffer(DIR, F, "one\n", 1000);
    ed.editBuffer(DIR, F, "mine\n");
    diskText = "theirs\n";
    diskMtime = 2000;
    writeError = "changed on disk";
    await ed.saveBuffer(DIR, F);
    const b = ed.bufferFor(DIR, F)!;
    expect(b.state).toBe("conflict");
    expect(b.incoming).toEqual({ text: "theirs\n", mtime: 2000 });
    expect(b.error).toBeNull();
  });

  it("any other write failure is an error that keeps the buffer dirty", async () => {
    ed.openBuffer(DIR, F, "one\n", 1000);
    ed.editBuffer(DIR, F, "mine\n");
    writeError = "Permission denied (os error 13)";
    await ed.saveBuffer(DIR, F);
    const b = ed.bufferFor(DIR, F)!;
    expect(b.state).toBe("error");
    expect(b.text).toBe("mine\n");
    expect(b.error).toContain("Permission denied");
    expect(ed.dirtyPathsFor(DIR)).toEqual([F]);
  });

  /* The close prompt's Save answer asks the store, not the promise: saveBuffer
     resolves either way, so "did it land?" is `state === "clean"` and nothing
     else. If this ever went the other way a refused save would close the tab
     and take the text with it. */
  it("a failed save leaves the buffer, its text and its dirt in place", async () => {
    ed.openBuffer(DIR, F, "one\n", 1000);
    ed.editBuffer(DIR, F, "mine\n");
    writeError = "Read-only file system (os error 30)";
    await ed.saveBuffer(DIR, F);
    expect(ed.bufferFor(DIR, F)!.state).not.toBe("clean");
    expect(ed.bufferFor(DIR, F)!.text).toBe("mine\n");
    // and the same question over a set — the project-wide prompt's answer
    expect(ed.dirtyPathsFor(DIR)).toEqual([F]);
  });

  it("a save refused as a conflict is also not clean — the tab stays open", async () => {
    ed.openBuffer(DIR, F, "one\n", 1000);
    ed.editBuffer(DIR, F, "mine\n");
    diskText = "theirs\n";
    diskMtime = 2000;
    writeError = "This file changed on disk since you opened it";
    await ed.saveBuffer(DIR, F);
    const b = ed.bufferFor(DIR, F)!;
    expect(b.state).toBe("conflict");
    expect(b.text).toBe("mine\n");
    expect(b.error).toBeNull(); // a conflict is the bar, never a toast
  });

  it("evicting a project disposes every one of its editor states", () => {
    const disposed: string[] = [];
    const off = ed.onBufferDisposed((k) => disposed.push(k));
    ed.openBuffer(DIR, F, "one\n", 1000);
    ed.openBuffer(DIR, "src/b.ts", "two\n", 1000);
    ed.openBuffer("/other", F, "three\n", 1000);
    ed.evictBuffers(DIR);
    expect(disposed.sort()).toEqual([ed.bufferKey(DIR, F), ed.bufferKey(DIR, "src/b.ts")].sort());
    expect(ed.bufferFor(DIR, F)).toBeNull();
    expect(ed.bufferFor("/other", F)).not.toBeNull();
    off();
    ed.evictBuffers("/other");
  });

  it("a rename carries the buffer, its dirt and a fresh undo key", () => {
    const disposed: string[] = [];
    const off = ed.onBufferDisposed((k) => disposed.push(k));
    ed.openBuffer(DIR, F, "one\n", 1000);
    ed.editBuffer(DIR, F, "mine\n");
    ed.renameBuffer(DIR, F, "src/b.ts");
    expect(ed.bufferFor(DIR, F)).toBeNull();
    const b = ed.bufferFor(DIR, "src/b.ts")!;
    expect(b.state).toBe("dirty");
    expect(b.text).toBe("mine\n");
    expect(disposed).toEqual([ed.bufferKey(DIR, F)]);
    off();
  });

  /* The pane's own tabs are re-read from disk on every remount, and the Repo
     pane unmounts whenever another pane is on screen. openBuffer hands back the
     buffer it already has and drops the text it was given, so the fresh read
     went nowhere — the store's reconciliation is the only thing that lands it. */
  it("a buffer left behind a hidden pane takes the disk on the way back", async () => {
    ed.openBuffer(DIR, F, "one\n", 1000);
    diskText = "from the agent\n";
    diskMtime = 2000;
    expect(ed.openBuffer(DIR, F, diskText, diskMtime).text).toBe("one\n"); // the old way saw nothing
    await ed.onFileChanged(DIR, F);
    const b = ed.bufferFor(DIR, F)!;
    expect(b.text).toBe("from the agent\n");
    expect(b.savedText).toBe("from the agent\n");
    expect(b.mtime).toBe(2000);
    expect(b.state).toBe("clean");
  });

  it("and one with unsaved work in it raises the bar instead of being overwritten", async () => {
    ed.openBuffer(DIR, F, "one\n", 1000);
    ed.editBuffer(DIR, F, "mine\n");
    diskText = "from the agent\n";
    diskMtime = 2000;
    await ed.onFileChanged(DIR, F);
    const b = ed.bufferFor(DIR, F)!;
    expect(b.state).toBe("conflict");
    expect(b.text).toBe("mine\n");
  });

  /* The save re-looked the buffer up by the key it started under. A rename that
     landed mid-write moved it to a new key, the lookup found nothing, and the
     file sat on "saving" — no dot, no word, and ⌘S refused it — until the tab
     was closed and reopened. */
  it("a rename during a save leaves the buffer clean under its new name", async () => {
    let release!: () => void;
    holdWrite = new Promise<void>((r) => { release = r; });
    ed.openBuffer(DIR, F, "one\n", 1000);
    ed.editBuffer(DIR, F, "mine\n");
    const saving = ed.saveBuffer(DIR, F);
    expect(ed.bufferFor(DIR, F)!.state).toBe("saving");
    ed.renameBuffer(DIR, F, "src/b.ts");
    release();
    await saving;
    expect(ed.bufferFor(DIR, F)).toBeNull();
    const b = ed.bufferFor(DIR, "src/b.ts")!;
    expect(b.state).toBe("clean");
    expect(b.savedText).toBe("mine\n");
    expect(ed.dirtyPathsFor(DIR)).toEqual([]);
  });

  it("a buffer closed during a save takes nothing with it", async () => {
    let release!: () => void;
    holdWrite = new Promise<void>((r) => { release = r; });
    ed.openBuffer(DIR, F, "one\n", 1000);
    ed.editBuffer(DIR, F, "mine\n");
    const saving = ed.saveBuffer(DIR, F);
    ed.closeBuffer(DIR, F);
    release();
    await saving;
    expect(ed.bufferFor(DIR, F)).toBeNull();
    expect(ed.anyDirty()).toBe(false);
  });

  it("names the next project with unsaved work, the open one first, once each", () => {
    ed.openBuffer(DIR, F, "one\n", 1000);
    ed.editBuffer(DIR, F, "mine\n");
    ed.openBuffer("/other", F, "one\n", 1000);
    ed.editBuffer("/other", F, "theirs\n");
    const asked = new Set<string>();
    expect(ed.nextDirtyDir(["/other", DIR], asked)).toBe("/other");
    asked.add("/other");
    expect(ed.nextDirtyDir(["/other", DIR], asked)).toBe(DIR);
    asked.add(DIR);
    expect(ed.nextDirtyDir(["/other", DIR], asked)).toBeNull();
    // a null active project (nothing open) is skipped, not asked about
    expect(ed.nextDirtyDir([null, "/other"], new Set())).toBe("/other");
    // and a clean project is never asked at all
    ed.evictBuffers("/other");
    expect(ed.nextDirtyDir(["/other"], new Set())).toBeNull();
  });

  it("closing disposes the buffer and tells the editor to drop its undo history", () => {
    const disposed: string[] = [];
    const off = ed.onBufferDisposed((k) => disposed.push(k));
    ed.openBuffer(DIR, F, "one\n", 1000);
    ed.closeBuffer(DIR, F);
    expect(ed.bufferFor(DIR, F)).toBeNull();
    expect(disposed).toEqual([ed.bufferKey(DIR, F)]);
    expect(ed.anyDirty()).toBe(false);
    off();
  });

  it("subscribers hear a state change but not every keystroke", () => {
    let n = 0;
    const off = ed.subscribeBuffers(() => { n++; });
    ed.openBuffer(DIR, F, "one\n", 1000);
    const afterOpen = n;
    ed.editBuffer(DIR, F, "a\n");   // clean to dirty: one notify
    ed.editBuffer(DIR, F, "ab\n");  // dirty to dirty: silent
    ed.editBuffer(DIR, F, "abc\n"); // dirty to dirty: silent
    expect(n).toBe(afterOpen + 1);
    off();
  });
});

describe("the pure helpers", () => {
  it("names a language for every extension the viewer shows", () => {
    expect(ed.languageIdFor("a/b.ts")).toBe("typescript");
    expect(ed.languageIdFor("a/b.tsx")).toBe("tsx");
    expect(ed.languageIdFor("a/b.mjs")).toBe("javascript");
    expect(ed.languageIdFor("a/b.jsx")).toBe("jsx");
    expect(ed.languageIdFor("a/b.json")).toBe("json");
    expect(ed.languageIdFor("a/b.css")).toBe("css");
    expect(ed.languageIdFor("a/b.html")).toBe("html");
    expect(ed.languageIdFor("a/b.md")).toBe("markdown");
    expect(ed.languageIdFor("a/b.rs")).toBe("rust");
    expect(ed.languageIdFor("a/b.py")).toBe("python");
    expect(ed.languageIdFor("a/b.sh")).toBe("shell");
    expect(ed.languageIdFor("a/b.toml")).toBe("toml");
    expect(ed.languageIdFor("Cargo.lock")).toBe("toml");
    expect(ed.languageIdFor("a/b.yml")).toBe("yaml");
    expect(ed.languageIdFor(".zshrc")).toBe("shell");
    expect(ed.languageIdFor("LICENSE")).toBe("plain");
  });

  it("reads the tab size out of .editorconfig for the matching section", () => {
    const cfg = [
      "root = true",
      "",
      "[*]",
      "indent_style = space",
      "indent_size = 2",
      "",
      "[*.{py,rs}]",
      "indent_size = 4",
      "",
      "[Makefile]",
      "indent_style = tab",
      "tab_width = 8",
    ].join("\n");
    expect(ed.editorConfigTabSize(cfg, "src/a.ts")).toBe(2);
    expect(ed.editorConfigTabSize(cfg, "src/a.py")).toBe(4);
    expect(ed.editorConfigTabSize(cfg, "deep/nest/a.rs")).toBe(4);
    expect(ed.editorConfigTabSize(cfg, "Makefile")).toBe(8);
    expect(ed.editorConfigTabSize("", "a.ts")).toBeNull();
    expect(ed.editorConfigTabSize("[*]\nindent_size = tab\ntab_width = 4", "a.ts")).toBe(4);
    // a later matching section wins over an earlier one
    expect(ed.editorConfigTabSize("[*]\nindent_size=2\n[*.ts]\nindent_size=8", "a.ts")).toBe(8);
  });

  it("says what the header says", () => {
    const base = { dir: DIR, path: F, text: "", savedText: "", mtime: 0, incoming: null, error: null };
    expect(ed.saveLabelFor(null, 0)).toBe("");
    expect(ed.saveLabelFor({ ...base, state: "dirty", savedAt: null }, 0)).toBe("unsaved");
    expect(ed.saveLabelFor({ ...base, state: "saving", savedAt: null }, 0)).toBe("saving");
    expect(ed.saveLabelFor({ ...base, state: "error", error: "Disk full", savedAt: null }, 0)).toBe("Disk full");
    expect(ed.saveLabelFor({ ...base, state: "clean", savedAt: null }, 0)).toBe("");
    expect(ed.saveLabelFor({ ...base, state: "clean", savedAt: 1000 }, 4000)).toBe("saved · 3s ago");
    expect(ed.saveLabelFor({ ...base, state: "clean", savedAt: 0 }, 125_000)).toBe("saved · 2m ago");
    expect(ed.saveLabelFor({ ...base, state: "clean", savedAt: 0 }, 7_200_000)).toBe("saved · 2h ago");
  });

  it("keys a buffer by project and path", () => {
    expect(ed.bufferKey("/p", "a.ts")).not.toBe(ed.bufferKey("/q", "a.ts"));
    expect(ed.bufferKey("/p", "a.ts")).toBe(ed.bufferKey("/p", "a.ts"));
  });
});

describe("bufferKey", () => {
  it("cannot collide across a dir/path boundary that contains spaces", async () => {
    const { bufferKey } = await import("./repo-editor");
    expect(bufferKey("/a", "b c/d.ts")).not.toBe(bufferKey("/a b", "c/d.ts"));
  });
});
