import { describe, it, expect, vi } from "vitest";

const h = vi.hoisted(() => {
  const sessions = new Map<string, {
    phase: string; entries: unknown[]; turnEnds: number; lastPrompt: string;
    sessionId: string | null; errorMessage: string | null; loadSession: boolean;
  }>();
  // The mock session object for a lane key, created on first touch (defaults
  // match the original single-session mock: ready, no turns yet).
  const sessionFor = (key: string) => {
    let s = sessions.get(key);
    if (!s) {
      s = { phase: "ready", entries: [], turnEnds: 0, lastPrompt: "", sessionId: "s", errorMessage: null, loadSession: false };
      sessions.set(key, s);
    }
    return s;
  };
  return {
    calls: [] as string[],
    restore: vi.fn(async (_d: string, _s: string, n: number) => n + 10),
    agentSubs: new Set<() => void>(),
    sessions,
    sessionFor,
  };
});
const calls = h.calls;
/** Fires every registered `subscribeAgent` listener — simulates a store change. */
const fireAgent = () => { for (const cb of h.agentSubs) cb(); };

vi.mock("./ipc", async (orig) => ({
  ...(await orig<typeof import("./ipc")>()),
  onDesignsChanged: vi.fn(async () => () => {}),
  designsList: vi.fn(async () => ({ rows: [{ slug: "home", title: "Home", kind: "app", frames: 1, created: "", latestVersion: 1, updatedMs: 1, bad: false }], order: {} })),
  designRead: vi.fn(async () => ({ design: { v: 1, title: "Home", kind: "app", brief: "", created: "", frames: [{ id: "d", file: "frames/d.html", label: "D", width: 1440, height: 900, group: "bp" }], groups: [{ id: "bp", label: "BP", kind: "breakpoints" }], chosen: null }, canvas: { positions: {}, viewport: null }, bad: false })),
  designFrameBase: vi.fn(async () => "chronicle-file://h/"),
  designVersions: vi.fn(async () => []),
  designCanvasSave: vi.fn(async (_d: string, _s: string, c: unknown) => { h.calls.push(JSON.stringify(c)); }),
  designRename: vi.fn(async (_d: string, _s: string, t: string) => { h.calls.push(`rename:${t}`); }),
  designRestore: h.restore,
  designBranch: vi.fn(async () => "home-2"),
  designSnapshot: vi.fn(async () => null),
  designThumbnails: vi.fn(async () => []),
}));
vi.mock("./agent-session", async () => ({
  laneKey: (d: string) => `${d}#design`,
  agentSessionFor: (key: string) => h.sessionFor(key),
  subscribeAgent: (cb: () => void) => { h.agentSubs.add(cb); return () => h.agentSubs.delete(cb); },
  sendAgentMessage: vi.fn(async () => {}),
  startAgentSession: vi.fn(async (key: string) => { h.sessionFor(key).phase = "ready"; }),
  resumeAgentSession: vi.fn(async (key: string, id: string) => { const s = h.sessionFor(key); s.phase = "ready"; s.sessionId = id; }),
}));

const DIR = "/p";

describe("design store", () => {
  it("loads, opens, tracks frame reports and ignores foreign messages", async () => {
    const m = await import("./design-store");
    await m.loadDesigns(DIR);
    await m.openDesign(DIR, "home");
    const p = m.designProjectFor(DIR);
    expect(p.active).toBe("home");
    expect(p.design?.frames[0].id).toBe("d");
    m.frameMessage(DIR, "d", { __chronicleFrame: 1, type: "ready", height: 2400 });
    expect(p.frameStates.d).toEqual({ kind: "rendered", height: 2400 });
    m.frameMessage(DIR, "d", { type: "error", message: "x", line: 1 });
    expect(p.frameStates.d.kind).toBe("rendered");
    m.frameMessage(DIR, "d", { __chronicleFrame: 1, type: "error", message: "Unexpected token", line: 214 });
    expect(p.frameStates.d).toEqual({ kind: "failed", message: "Unexpected token", line: 214 });
  });
  it("undoes and redoes a move and a rename", async () => {
    const m = await import("./design-store");
    calls.length = 0;
    await m.moveFrame(DIR, "d", 10, 20);
    await m.renameDesign(DIR, "home", "Front");
    await m.undoDesign(DIR);
    await m.undoDesign(DIR);
    await m.redoDesign(DIR);
    expect(calls).toEqual([
      JSON.stringify({ positions: { d: { x: 10, y: 20 } }, viewport: null }),
      "rename:Front",
      "rename:Home",
      JSON.stringify({ positions: {}, viewport: null }),
      JSON.stringify({ positions: { d: { x: 10, y: 20 } }, viewport: null }),
    ]);
  });
  it("summarises and prefixes", async () => {
    const m = await import("./design-store");
    expect(m.designPrefix("home")).toBe("[design: home · .chronicle/designs/home/]");
    expect(m.summaryOf([{ kind: "assistant", text: "Added three frames. Then more." } as never])).toBe("Added three frames.");
  });

  it("restoring is undoable", async () => {
    const restore = h.restore;
    const m = await import("./design-store");
    const p = m.designProjectFor(DIR);
    p.versions = [{ n: 7, at: "", session: "", prompt: "", summary: "", hash: "" }];
    await m.restoreVersion(DIR, 5);
    expect(restore).toHaveBeenLastCalledWith(DIR, "home", 5);
    await m.undoDesign(DIR);
    expect(restore).toHaveBeenLastCalledWith(DIR, "home", 7);
  });

  it("keeps versioning across an idle-stop resume instead of stopping forever (finding 1)", async () => {
    const m = await import("./design-store");
    const ipc = await import("./ipc");
    const snap = ipc.designSnapshot as unknown as ReturnType<typeof vi.fn>;
    snap.mockClear();
    const DIR2 = "/p2";
    const key = "/p2#design";
    // An already-running session that has completed 2 turns BEFORE this store
    // ever touches the project — those must not be treated as new.
    h.sessions.set(key, { phase: "ready", entries: [], turnEnds: 2, lastPrompt: "", sessionId: "s2", errorMessage: null, loadSession: true });
    await m.loadDesigns(DIR2);
    await m.openDesign(DIR2, "home");
    expect(snap).not.toHaveBeenCalled();
    // An idle-stop (or a restart) resets the session's own counter.
    h.sessions.get(key)!.turnEnds = 0;
    fireAgent();
    expect(snap).not.toHaveBeenCalled();
    // The next real turn ends — exactly one version, not zero and not stuck.
    h.sessions.get(key)!.turnEnds = 1;
    fireAgent();
    await Promise.resolve();
    expect(snap).toHaveBeenCalledTimes(1);
    expect(snap).toHaveBeenCalledWith(DIR2, "home", "", "", "s2");
  });

  it("snapshots the design a turn was sent for, even if the user switched before it ended (finding 3)", async () => {
    const m = await import("./design-store");
    const ipc = await import("./ipc");
    const snap = ipc.designSnapshot as unknown as ReturnType<typeof vi.fn>;
    snap.mockClear();
    const key = "/p#design";
    h.sessionFor(key); // ensure it exists; phase stays "ready" so no start/resume path runs
    const p = m.designProjectFor(DIR);
    p.active = "home";
    await m.sendDesignMessage(DIR, "make it pop");
    expect(p.turnSlug).toBe("home");
    p.active = "someone-else"; // the user clicked over to another design mid-turn
    h.sessions.get(key)!.turnEnds += 1; // the turn that was sending "home" ends
    fireAgent();
    await Promise.resolve();
    expect(snap).toHaveBeenCalledTimes(1);
    expect(snap).toHaveBeenCalledWith(DIR, "home", expect.any(String), expect.any(String), expect.any(String));
    expect(p.turnSlug).toBeNull();
  });

  it("resumes only when the session says it can reload; otherwise starts fresh (finding 5)", async () => {
    const m = await import("./design-store");
    const agentMod = await import("./agent-session");
    const start = agentMod.startAgentSession as unknown as ReturnType<typeof vi.fn>;
    const resume = agentMod.resumeAgentSession as unknown as ReturnType<typeof vi.fn>;
    const dir = "/p3";
    const key = "/p3#design";
    h.sessions.set(key, { phase: "ended", entries: [], turnEnds: 0, lastPrompt: "", sessionId: "sid-1", errorMessage: null, loadSession: false });
    const p = m.designProjectFor(dir);
    p.active = "home";

    start.mockClear(); resume.mockClear();
    await m.sendDesignMessage(dir, "go");
    expect(start).toHaveBeenCalledTimes(1);
    expect(resume).not.toHaveBeenCalled();

    const s = h.sessions.get(key)!;
    s.phase = "ended"; s.sessionId = "sid-2"; s.loadSession = true;
    start.mockClear(); resume.mockClear();
    await m.sendDesignMessage(dir, "go again");
    expect(resume).toHaveBeenCalledWith(key, "sid-2");
    expect(start).not.toHaveBeenCalled();
  });
});
