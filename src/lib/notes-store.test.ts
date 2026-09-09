import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setActivity } from "./scheduler";

const writes: { path: string; text: string }[] = [];
let writeError: string | null = null;
let fileText = "---\nstatus: queued\n---\n\nbody\n";
// let one test hold a write in flight until it explicitly releases it
let holdWrite = false;
let releaseWrite: (() => void) | null = null;

interface FakeNote { path: string; title: string; folder: string; status: string | null; round: number | null }
interface FakeRound { n: number; state: string; kind: string | null; note_paths: string[] }
const A_NOTE = { path: "Tasks/A.md", title: "A", folder: "Tasks", status: "queued", round: null };
// what notesIndex answers with; tests reshape it before calling refreshNotes
let indexNotes: FakeNote[] = [A_NOTE];
let indexRounds: FakeRound[] = [];
let indexGeneration = 1;

vi.mock("./ipc", () => ({
  notesIndex: vi.fn(async () => ({
    notes: indexNotes.map((n) => ({
      ...n, tags: [], links: [], resolved: [], ambiguous: [],
      mtime: 1, size: 10, snippet: "body", unreadable: false,
    })),
    generation: indexGeneration,
    rounds: indexRounds,
  })),
  notesRead: vi.fn(async () => fileText),
  notesWrite: vi.fn(async (_d: string, path: string, text: string) => {
    if (holdWrite) {
      holdWrite = false;
      await new Promise<void>((resolve) => { releaseWrite = resolve; });
    }
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
    holdWrite = false;
    releaseWrite = null;
    indexNotes = [A_NOTE];
    indexRounds = [];
    indexGeneration = 1;
    store.evictNotes("/p");
    store.setRoundGenerating("/p", false);
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

  it("takes the open round and the editor's lock from the record, not from this session", async () => {
    // a restart mid-round: nothing in memory says a round is live, and only
    // rounds.json can tell the pane the notes are locked
    indexNotes = [
      { path: "Tasks/A.md", title: "A", folder: "Tasks", status: "in_progress", round: 4 },
      { path: "Tasks/B.md", title: "B", folder: "Tasks", status: "done", round: 4 },
      { path: "Loose.md", title: "Loose", folder: "", status: null, round: null },
    ];
    indexRounds = [{ n: 4, state: "ready", kind: "bug fixes", note_paths: ["Tasks/A.md", "Tasks/B.md"] }];
    await store.refreshNotes("/p");

    const open = store.openRoundFor("/p");
    expect(open?.n).toBe(4);
    expect(open?.total).toBe(2);
    expect(open?.done).toBe(1);
    expect(store.roundStateFor("/p", 4)).toBe("ready");   // the header's "locked by the round"
    expect(store.roundStateFor("/p", null)).toBeNull();
    expect(store.roundGenerating("/p")).toBe(false);

    // the plan being written: the same record, a different state
    indexRounds = [{ n: 4, state: "generating", kind: null, note_paths: ["Tasks/A.md", "Tasks/B.md"] }];
    indexGeneration = 2;
    await store.refreshNotes("/p");
    expect(store.openRoundFor("/p")).toBeNull();          // no card until the plan lands
    expect(store.roundStateFor("/p", 4)).toBe("generating");
    expect(store.roundGenerating("/p")).toBe(true);

    // settled: the round lets go, whatever the notes still say
    indexRounds = [{ n: 4, state: "done", kind: "bug fixes", note_paths: ["Tasks/A.md", "Tasks/B.md"] }];
    indexGeneration = 3;
    await store.refreshNotes("/p");
    expect(store.openRoundFor("/p")).toBeNull();
    expect(store.roundStateFor("/p", 4)).toBeNull();
    expect(store.roundGenerating("/p")).toBe(false);
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

  it("a disk change during a save never clobbers the buffer, and re-arms once the save settles", async () => {
    await store.refreshNotes("/p");
    await store.openNote("/p", "Tasks/A.md");
    store.editBody("/p", "mine");

    holdWrite = true;
    const flushing = store.flushSave("/p"); // save() runs synchronously up to the gated write
    await vi.advanceTimersByTimeAsync(0);
    expect(store.openFor("/p")?.state).toBe("saving");

    // someone else's write lands on disk while ours is still in flight
    fileText = "---\nstatus: queued\n---\n\nexternal\n";
    await store.onDiskChanged("/p", ["Tasks/A.md"]);
    expect(store.openFor("/p")?.body).toBe("mine"); // buffer intact — never overwritten mid-save
    expect(store.openFor("/p")?.conflict).toBe(false); // not treated as a conflict either

    releaseWrite?.(); // our own write completes
    await flushing;
    expect(writes).toHaveLength(1); // the original write did land
    expect(store.openFor("/p")?.state).toBe("dirty"); // but disk moved again since — not "saved"
    expect(store.openFor("/p")?.body).toBe("mine");

    await vi.advanceTimersByTimeAsync(700); // the re-armed ticker fires on its own
    expect(writes).toHaveLength(2);
    expect(writes[1]).toEqual({ path: "Tasks/A.md", text: "---\nstatus: queued\n---\n\nmine" });
    expect(store.openFor("/p")?.state).toBe("saved");
  });
});
