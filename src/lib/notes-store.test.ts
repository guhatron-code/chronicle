import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setActivity } from "./scheduler";

const writes: { path: string; text: string }[] = [];
let writeError: string | null = null;
let fileText = "---\nstatus: queued\n---\n\nbody\n";

vi.mock("./ipc", () => ({
  notesIndex: vi.fn(async () => ({
    notes: [{
      path: "Tasks/A.md", title: "A", folder: "Tasks", status: "queued", round: null,
      tags: [], links: [], resolved: [], ambiguous: [], mtime: 1, size: 10, snippet: "body", unreadable: false,
    }],
    generation: 1,
  })),
  notesRead: vi.fn(async () => fileText),
  notesWrite: vi.fn(async (_d: string, path: string, text: string) => {
    if (writeError) throw writeError;
    writes.push({ path, text });
  }),
  notesMove: vi.fn(async () => [] as string[]),
  notesDelete: vi.fn(async () => ".chronicle/trash/1-A.md"),
  notesSearch: vi.fn(async () => []),
  notesAttach: vi.fn(async () => "../attachments/a-1.png"),
  notesDetach: vi.fn(async () => {}),
  onNotesChanged: vi.fn(async () => () => {}),
  readFileB64: vi.fn(async () => "aGk="),
  IMG_MIME: { png: "image/png", jpg: "image/jpeg" },
}));
vi.mock("@/overlays/toasts", () => ({ toastError: vi.fn(), toastSuccess: vi.fn() }));

const store = await import("./notes-store");

describe("the notes store", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setActivity({ visible: true, focused: true, onBattery: false });
    writes.length = 0;
    writeError = null;
    fileText = "---\nstatus: queued\n---\n\nbody\n";
    store.evictNotes("/p");
  });
  afterEach(() => { vi.useRealTimers(); });

  it("caches the index and only refetches when the generation moved", async () => {
    await store.refreshNotes("/p");
    expect(store.indexFor("/p").notes).toHaveLength(1);
    const ipc = await import("./ipc");
    expect(ipc.notesIndex).toHaveBeenCalledTimes(1);
    store.noteGeneration("/p", 1);
    await vi.advanceTimersByTimeAsync(0);
    expect(ipc.notesIndex).toHaveBeenCalledTimes(1); // unchanged — no work
    store.noteGeneration("/p", 2);
    await vi.advanceTimersByTimeAsync(0);
    expect(ipc.notesIndex).toHaveBeenCalledTimes(2);
  });

  it("saves 600 ms after the last keystroke, once", async () => {
    await store.refreshNotes("/p");
    await store.openNote("/p", "Tasks/A.md");
    store.editBody("/p", "body one");
    await vi.advanceTimersByTimeAsync(400);
    store.editBody("/p", "body one and two");
    await vi.advanceTimersByTimeAsync(400);
    expect(writes).toHaveLength(0); // the second keystroke restarted the wait
    await vi.advanceTimersByTimeAsync(700);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toEqual({ path: "Tasks/A.md", text: "---\nstatus: queued\n---\n\nbody one and two" });
    expect(store.openFor("/p")?.state).toBe("saved");
    await vi.advanceTimersByTimeAsync(5000);
    expect(writes).toHaveLength(1); // the ticker stopped once clean
  });

  it("does not save early when the scheduler ticks slowly", async () => {
    await store.refreshNotes("/p");
    await store.openNote("/p", "Tasks/A.md");
    store.editBody("/p", "typed");
    setActivity({ visible: true, focused: false, onBattery: false }); // every() is now 2400 ms
    await vi.advanceTimersByTimeAsync(2000);
    expect(writes).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(600);
    expect(writes).toHaveLength(1); // late is fine, early is not
  });

  it("flushes immediately on demand", async () => {
    await store.refreshNotes("/p");
    await store.openNote("/p", "Tasks/A.md");
    store.editBody("/p", "urgent");
    await store.flushSave("/p");
    expect(writes).toHaveLength(1);
    expect(store.openFor("/p")?.state).toBe("saved");
  });

  it("keeps the text and reports the error when a write fails", async () => {
    await store.refreshNotes("/p");
    await store.openNote("/p", "Tasks/A.md");
    writeError = "Read-only file system (os error 30)";
    store.editBody("/p", "still mine");
    await store.flushSave("/p");
    const open = store.openFor("/p");
    expect(open?.state).toBe("error");
    expect(open?.body).toBe("still mine");
    expect(open?.error).toContain("os error 30");
  });

  it("says locked rather than error when the round holds the note", async () => {
    await store.refreshNotes("/p");
    await store.openNote("/p", "Tasks/A.md");
    writeError = "locked";
    store.editBody("/p", "nope");
    await store.flushSave("/p");
    expect(store.openFor("/p")?.state).toBe("locked");
  });

  it("resolves an attachment against the vault root, not the note's folder", async () => {
    // the same string in a root note and a deeply nested one names the same file
    expect(store.attachmentPath("../attachments/shot-1.png")).toBe(".chronicle/attachments/shot-1.png");
    const ipc = await import("./ipc");
    await store.noteImageSrc("/p", "../attachments/shot-1.png");   // as if from Scratch.md
    await store.noteImageSrc("/p", "../attachments/shot-1.png");   // as if from Tasks/Archive/Old.md
    expect(ipc.readFileB64).toHaveBeenCalledTimes(1);              // one file, one read, cached
    expect(ipc.readFileB64).toHaveBeenCalledWith("/p", ".chronicle/attachments/shot-1.png");
    expect(store.cachedImageSrc("/p", "../attachments/shot-1.png")).toMatch(/^data:image\/png;base64,/);
    expect(store.attachmentPath("./local.png")).toBeNull();
    expect(store.attachmentPath("../../src/App.tsx")).toBeNull();
  });

  it("reloads a clean note silently and offers a choice when it is dirty", async () => {
    await store.refreshNotes("/p");
    await store.openNote("/p", "Tasks/A.md");
    fileText = "---\nstatus: done\n---\n\nchanged on disk\n";
    await store.onDiskChanged("/p", ["Tasks/A.md"]);
    expect(store.openFor("/p")?.body).toBe("changed on disk\n");
    expect(store.openFor("/p")?.conflict).toBe(false);

    store.editBody("/p", "mine");
    fileText = "---\nstatus: done\n---\n\ntheirs\n";
    await store.onDiskChanged("/p", ["Tasks/A.md"]);
    expect(store.openFor("/p")?.conflict).toBe(true);
    expect(store.openFor("/p")?.body).toBe("mine");
    store.reloadOpen("/p");
    await vi.advanceTimersByTimeAsync(0);
    expect(store.openFor("/p")?.body).toBe("theirs\n");
    expect(store.openFor("/p")?.conflict).toBe(false);
  });
});
