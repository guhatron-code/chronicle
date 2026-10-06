import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => {
  const sessions = new Map<string, {
    phase: string; entries: unknown[]; turnEnds: number; lastPrompt: string;
    sessionId: string | null; errorMessage: string | null; loadSession: boolean;
    turnActive?: boolean; lastStopReason?: string | null;
  }>();
  // The mock session object for a lane key, created on first touch (defaults
  // match the original single-session mock: ready, no turns yet).
  const sessionFor = (key: string) => {
    let s = sessions.get(key);
    if (!s) {
      s = { phase: "ready", entries: [], turnEnds: 0, lastPrompt: "", sessionId: "s", errorMessage: null, loadSession: false, turnActive: false, lastStopReason: null };
      sessions.set(key, s);
    }
    return s;
  };
  return {
    calls: [] as string[],
    restore: vi.fn(async (_d: string, _s: string, n: number) => n + 10),
    designsChanged: null as null | ((e: { dir: string; slug: string; paths: string[] }) => void),
    agentSubs: new Set<() => void>(),
    sessions,
    sessionFor,
    /** director files served by `designFileRead`, keyed by their path in the design */
    files: new Map<string, string>(),
    snapshot: vi.fn(async (..._a: unknown[]): Promise<number | null> => null),
    review: vi.fn(async (..._a: unknown[]): Promise<{ thumbs: string[]; lint: unknown }> => ({ thumbs: [], lint: { v: 1, version: null, at: "", ran: true, problem: null, severe: [], minor: [] } })),
    critique: vi.fn(async (..._a: unknown[]): Promise<unknown> => { throw new Error("no round file"); }),
    state: vi.fn(async (..._a: unknown[]): Promise<unknown> => null),
    stateSet: vi.fn(async (..._a: unknown[]) => {}),
    answered: vi.fn(async (..._a: unknown[]): Promise<unknown> => null),
    mark: vi.fn(async (..._a: unknown[]) => {}),
    cancel: vi.fn(async (..._a: unknown[]) => {}),
    /** every message the design lane was sent, prefix included, as the wire sees it */
    sent: [] as string[],
    fireAgent: () => {},
  };
});
const calls = h.calls;
/** Fires every registered `subscribeAgent` listener — simulates a store change. */
const fireAgent = () => { for (const cb of h.agentSubs) cb(); };
h.fireAgent = fireAgent;
/** the design lane's session for DIR, which the loop tests flip by hand */
const sess = h.sessionFor("/p#design");

vi.mock("./ipc", async (orig) => ({
  ...(await orig<typeof import("./ipc")>()),
  onDesignsChanged: vi.fn(async (cb: (e: { dir: string; slug: string; paths: string[] }) => void) => { h.designsChanged = cb; return () => {}; }),
  designRootPath: vi.fn(async () => "/Users/me/main-checkout/.chronicle/designs"),
  designsList: vi.fn(async () => ({ rows: [{ slug: "home", title: "Home", kind: "app", frames: 1, created: "", latestVersion: 1, updatedMs: 1, bad: false }], order: {} })),
  designRead: vi.fn(async () => ({ design: { v: 1, title: "Home", kind: "app", brief: "", created: "", frames: [{ id: "d", file: "frames/d.html", label: "D", width: 1440, height: 900, group: "bp" }], groups: [{ id: "bp", label: "BP", kind: "breakpoints" }], chosen: null }, canvas: { positions: {}, viewport: null }, bad: false })),
  designFrameBase: vi.fn(async () => "chronicle-file://h/"),
  designVersions: vi.fn(async () => []),
  designCanvasSave: vi.fn(async (_d: string, _s: string, c: unknown) => { h.calls.push(JSON.stringify(c)); }),
  designRename: vi.fn(async (_d: string, _s: string, t: string) => { h.calls.push(`rename:${t}`); }),
  designRestore: h.restore,
  designBranch: vi.fn(async () => "home-2"),
  designCreate: vi.fn(async (_d: string, _k: string, title: string) => { h.calls.push(`create:${title}`); return "brand-new"; }),
  designSnapshot: h.snapshot,
  designThumbnails: vi.fn(async () => []),
  designContextFiles: vi.fn(async () => []),
  designReviewVersion: h.review,
  designReviewState: h.state,
  designReviewStateSet: h.stateSet,
  designReviewSettings: vi.fn(async () => {
    const d = { critique: true, bar: 8, rounds: 3, lint: true };
    return { project: d, design: null, effective: d };
  }),
  designReviewSettingsSet: vi.fn(async () => {}),
  designQuestionsAnswer: h.answered,
  designCritiqueRead: h.critique,
  designFileRead: vi.fn(async (_d: string, _s: string, rel: string) => h.files.get(rel) ?? null),
  designLintRead: vi.fn(async () => null),
  designVersionMark: h.mark,
}));
vi.mock("./agent-session", async () => ({
  laneKey: (d: string) => `${d}#design`,
  agentSessionFor: (key: string) => h.sessionFor(key),
  subscribeAgent: (cb: () => void) => { h.agentSubs.add(cb); return () => h.agentSubs.delete(cb); },
  sendAgentMessage: vi.fn(async (_key: string, text: string, _blocks?: unknown, opts?: { prefix?: string }) => {
    h.sent.push(opts?.prefix ? `${opts.prefix}\n\n${text}` : text);
  }),
  cancelAgentTurn: h.cancel,
  startAgentSession: vi.fn(async (key: string) => { h.sessionFor(key).phase = "ready"; }),
  resumeAgentSession: vi.fn(async (key: string, id: string) => { const s = h.sessionFor(key); s.phase = "ready"; s.sessionId = id; }),
}));
vi.mock("@/overlays/toasts", () => ({ toastError: vi.fn(), toastSuccess: vi.fn() }));

const DIR = "/p";

/** A promise the test settles by hand — holds a loop step mid-await. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}
const cleanLint = (version: number) => ({ v: 1, version, at: "t", ran: true, problem: null, severe: [], minor: [] });
const severeLint = (version: number) => ({ ...cleanLint(version), severe: [{ rule: "audit:overflow", severity: "severe", text: "wide", frame: "d", file: "frames/d.html" }] });
const finding = (text: string, severity = "minor") => ({ rule: "critique:ux", severity, text, frame: "d", file: "" });
const round = (n: number, findings: ReturnType<typeof finding>[], blocker: string | null = null) =>
  ({ round: n, version: n + 1, at: "t", bar: 8, weighted: 7, passed: false, reviewers: [{ id: "ux", score: 7, notes: [], findings }], missing: [], blocker });

describe("design store", () => {
  beforeEach(() => {
    h.files.clear();
    h.sent.length = 0;
    sess.turnActive = false; sess.lastStopReason = null;
  });
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
  it("stores located rects from frames and ignores foreign locate replies", async () => {
    const m = await import("./design-store");
    await m.loadDesigns(DIR); await m.openDesign(DIR, "home");
    const p = m.designProjectFor(DIR);
    m.frameMessage(DIR, "d", { __chronicleFrame: 1, type: "located", id: "d:.buy", rect: { x: 10, y: 20, w: 30, h: 40 } });
    expect(p.located["d:.buy"]).toEqual({ x: 10, y: 20, w: 30, h: 40 });
    m.frameMessage(DIR, "d", { __chronicleFrame: 1, type: "located", id: "d:.nope", rect: null });
    expect(p.located["d:.nope"]).toBeNull();
    m.frameMessage(DIR, "d", { type: "located", id: "d:.x", rect: { x: 1, y: 1, w: 1, h: 1 } });
    expect(p.located["d:.x"]).toBeUndefined();
    m.frameMessage(DIR, "d", { __chronicleFrame: 1, type: "located", id: "e:.buy", rect: { x: 1, y: 1, w: 1, h: 1 } });
    expect(p.located["e:.buy"]).toBeUndefined();
  });
  it("keeps the project's own settings apart from the effective ones", async () => {
    const m = await import("./design-store");
    const ipc = await import("./ipc");
    await m.loadDesigns(DIR);
    await m.openDesign(DIR, "home");
    const eff = { critique: true, bar: 9, rounds: 3, lint: true };
    vi.mocked(ipc.designReviewSettings).mockResolvedValueOnce({ project: { ...eff, bar: 7 }, design: { bar: 9 }, effective: eff });
    await m.setReviewSettings(DIR, "design", { bar: 9 });
    const p = m.designProjectFor(DIR);
    expect(p.settingsScope.project?.bar).toBe(7);
    expect(p.settings.bar).toBe(9);
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
    expect(m.designPrefix("home", "/Users/me/main/.chronicle/designs", [])).toBe("[design: home · /Users/me/main/.chronicle/designs/home/]");
    expect(m.designPrefix("home", "/r/.chronicle/designs/", [])).toBe("[design: home · /r/.chronicle/designs/home/]");
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
    // the prefix names the design's folder by its absolute path (linked worktrees)
    const agentMod = await import("./agent-session");
    const send = agentMod.sendAgentMessage as unknown as ReturnType<typeof vi.fn>;
    expect(send).toHaveBeenLastCalledWith(key, "make it pop", undefined,
      { prefix: "[design: home · /Users/me/main-checkout/.chronicle/designs/home/]" });
    p.active = "someone-else"; // the user clicked over to another design mid-turn
    h.sessions.get(key)!.turnEnds += 1; // the turn that was sending "home" ends
    fireAgent();
    await Promise.resolve();
    expect(snap).toHaveBeenCalledTimes(1);
    expect(snap).toHaveBeenCalledWith(DIR, "home", expect.any(String), expect.any(String), expect.any(String));
    expect(p.turnSlug).toBeNull();
  });

  it("forgets a send's design when the send itself fails", async () => {
    const m = await import("./design-store");
    const agentMod = await import("./agent-session");
    const send = agentMod.sendAgentMessage as unknown as ReturnType<typeof vi.fn>;
    const p = m.designProjectFor(DIR);
    p.active = "home"; p.turnSlug = null;
    send.mockRejectedValueOnce(new Error("the agent is still working"));
    await expect(m.sendDesignMessage(DIR, "again")).rejects.toThrow("still working");
    expect(p.turnSlug).toBeNull();
  });

  it("ignores a canvas-only change and reloads on anything else", async () => {
    const m = await import("./design-store");
    const ipc = await import("./ipc");
    const list = ipc.designsList as unknown as ReturnType<typeof vi.fn>;
    const read = ipc.designRead as unknown as ReturnType<typeof vi.fn>;
    await m.openDesign(DIR, "home");
    expect(h.designsChanged).not.toBeNull();
    list.mockClear(); read.mockClear();
    h.designsChanged!({ dir: DIR, slug: "home", paths: ["canvas.json", "canvas.json.tmp"] });
    await Promise.resolve();
    expect(list).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
    h.designsChanged!({ dir: DIR, slug: "home", paths: ["canvas.json", "frames/d.html"] });
    await Promise.resolve();
    expect(list).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledTimes(1);
    // a failing reload never surfaces as an unhandled rejection
    list.mockRejectedValueOnce(new Error("gone"));
    read.mockRejectedValueOnce(new Error("gone"));
    h.designsChanged!({ dir: DIR, slug: "home", paths: ["design.json"] });
    await new Promise((r) => setImmediate(r));
  });

  it("ignores a change under .review/ — the app's own writes never remount the frames", async () => {
    const m = await import("./design-store");
    const ipc = await import("./ipc");
    const list = ipc.designsList as unknown as ReturnType<typeof vi.fn>;
    const read = ipc.designRead as unknown as ReturnType<typeof vi.fn>;
    await m.openDesign(DIR, "home");
    const p = m.designProjectFor(DIR);
    m.frameMessage(DIR, "d", { __chronicleFrame: 1, type: "ready", height: 2400 });
    const tick = p.reloadTick;
    const states = p.frameStates;
    list.mockClear(); read.mockClear();
    h.designsChanged!({ dir: DIR, slug: "home", paths: [".review/state.json"] });
    h.designsChanged!({ dir: DIR, slug: "home", paths: [".review/lint/v2.json", ".review/captures/d.png", ".review/settings.json"] });
    await new Promise((r) => setImmediate(r));
    expect(list).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
    expect(p.reloadTick).toBe(tick);
    expect(p.frameStates).toBe(states);
    expect(p.frameStates.d).toEqual({ kind: "rendered", height: 2400 });
  });

  it("reviewBusy is the guard the scorecard reads: a turn, or a loop still running", async () => {
    const m = await import("./design-store");
    const p = m.designProjectFor("/busy");
    const s = h.sessionFor("/busy#design");
    s.turnActive = false;
    p.review = { ...p.review, phase: "idle" }; p.critiqueMissing = false;
    expect(m.reviewBusy("/busy")).toBe(false);
    s.turnActive = true;
    expect(m.reviewBusy("/busy")).toBe(true);
    s.turnActive = false;
    p.review = { ...p.review, phase: "gate" };
    expect(m.reviewBusy("/busy")).toBe(true);
    // a critique that never came back leaves "Ask again" open
    p.review = { ...p.review, phase: "critique" }; p.critiqueMissing = true;
    expect(m.reviewBusy("/busy")).toBe(false);
    m.evictDesignProject("/busy");
  });

  it("closing a project forgets its design state", async () => {
    const m = await import("./design-store");
    const p = m.designProjectFor("/closing");
    p.active = "home";
    m.evictDesignProject("/closing");
    expect(m.designProjectFor("/closing")).not.toBe(p);
    expect(m.designProjectFor("/closing").active).toBeNull();
  });


  it("names a design by the brief's first clause, cut at a word", async () => {
    const m = await import("./design-store");
    expect(m.titleFromBrief("A product page. Mostly phones.")).toBe("A product page");
    expect(m.titleFromBrief("   ")).toBe("Untitled design");
    const long = m.titleFromBrief("A product page for a coffee roaster's Ethiopia Guji single origin");
    expect(long.length).toBeLessThanOrEqual(48);
    expect(long).toBe("A product page for a coffee roaster's Ethiopia");
    // never cut mid-word
    expect(long.endsWith("o")).toBe(false);
  });

  it("sends the brief for the design it just created, even when the pane opens another one first", async () => {
    const m = await import("./design-store");
    const agentMod = await import("./agent-session");
    const ipc = await import("./ipc");
    const send = agentMod.sendAgentMessage as unknown as ReturnType<typeof vi.fn>;
    const dir = "/p4";
    const key = "/p4#design";
    h.sessionFor(key); // ready, so the send runs straight through
    send.mockClear();
    // The pane's "nothing open yet" effect races every create: it opens the
    // first row the moment the list reloads.
    (ipc.designRead as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => {
      void m.openDesign(dir, "home"); // the racing open, started mid-read
      return { design: { v: 1, title: "New", kind: "app", brief: "", created: "", frames: [], groups: [], chosen: null }, canvas: { positions: {}, viewport: null }, bad: false };
    });
    const slug = await m.startDesign(dir, "ecommerce", "A product page for a roaster. Mostly phones.");
    expect(slug).toBe("brand-new");
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][3]).toEqual({ prefix: "[design: brand-new \u00b7 /Users/me/main-checkout/.chronicle/designs/brand-new/]" });
    expect(h.calls.at(-1)).toBe("create:A product page for a roaster");
  });

  it("an open claims the design before it reads it, so nothing can steal the slot", async () => {
    const m = await import("./design-store");
    const p = m.designProjectFor("/p5");
    const pending = m.openDesign("/p5", "home");
    expect(p.active).toBe("home"); // claimed synchronously, before the read resolves
    await pending;
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

  it("prefixes the design and, when there are context files, names them", async () => {
    const m = await import("./design-store");
    expect(m.designPrefix("guji", "/p/.chronicle/designs", [])).toBe("[design: guji · /p/.chronicle/designs/guji/]");
    expect(m.designPrefix("guji", "/p/.chronicle/designs/", ["PRODUCT.md", "DESIGN.md"]))
      .toBe("[design: guji · /p/.chronicle/designs/guji/]\n[context: PRODUCT.md, DESIGN.md — read these first]");
  });

  it("drives brief → questions → answers → lint fix → critique → done, persisting each step", async () => {
    const m = await import("./design-store");
    const ipc = await import("./ipc");
    h.files.set("questions.json", JSON.stringify({ v: 1, questions: [{ id: "who", label: "Who is buying?", type: "single", options: ["Gift buyers", "Regulars"] }], references: true }));
    await m.loadDesigns(DIR); await m.openDesign(DIR, "home");
    const p = m.designProjectFor(DIR);
    await m.sendDesignMessage(DIR, "A product page", "home");
    expect(p.review.phase).toBe("building");
    // the director wrote questions.json and ended its turn with no file changes
    h.snapshot.mockResolvedValueOnce(null);
    sess.turnEnds += 1; h.fireAgent();
    await vi.waitFor(() => expect(p.review.phase).toBe("questions"));
    expect(p.questions?.questions[0].id).toBe("who");
    expect(h.stateSet).toHaveBeenLastCalledWith(DIR, "home", expect.objectContaining({ phase: "questions" }));
    await m.answerQuestions(DIR, { who: "Gift buyers" }, []);
    expect(h.answered).toHaveBeenCalledWith(DIR, "home", { who: "Gift buyers", references: [] }, false);
    expect(h.sent.at(-1)).toContain("- Who is buying?: Gift buyers");
    // the build turn ends: v1 with one severe finding
    h.files.set("questions.json", JSON.stringify({ v: 1, questions: [{ id: "who", label: "Who is buying?" }], answers: { who: "Gift buyers" } }));
    h.snapshot.mockResolvedValueOnce(1);
    h.review.mockResolvedValueOnce({ thumbs: ["home/.versions/v1/thumbs/d.png"], lint: { v: 1, version: 1, at: "t", ran: true, problem: null, severe: [{ rule: "audit:overflow", severity: "severe", text: "wide", frame: "d", file: "frames/d.html" }], minor: [] } });
    sess.turnEnds += 1; h.fireAgent();
    await vi.waitFor(() => expect(p.review).toMatchObject({ phase: "fixing", fixPass: 1 }));
    expect(h.sent.at(-1)).toMatch(/^\[design: home · .*\]\n\nLint fix pass 1 of 2/);
    // the fix turn ends clean → critique
    h.snapshot.mockResolvedValueOnce(2);
    h.review.mockResolvedValueOnce({ thumbs: [], lint: { v: 1, version: 2, at: "t", ran: true, problem: null, severe: [], minor: [] } });
    sess.turnEnds += 1; h.fireAgent();
    await vi.waitFor(() => expect(p.review).toMatchObject({ phase: "critique", round: 1 }));
    expect(h.sent.at(-1)).toContain("critique/round-1.json");
    // the reviewers get the frame's HTML and the gate's two JPEG captures, never the PNG thumbnails
    const home = "/Users/me/main-checkout/.chronicle/designs/home";
    expect(h.sent.at(-1)).toContain(`- d: ${home}/frames/d.html · ${home}/.review/captures/d.fold.jpg (the first screen) · ${home}/.review/captures/d.jpg (the whole page)`);
    expect(h.sent.at(-1)).not.toContain(".png");
    // the critique turn ends with a passing round file
    h.snapshot.mockResolvedValueOnce(null);
    h.critique.mockResolvedValueOnce({ round: 1, version: 2, reviewers: [{ id: "ux", score: 8.5 }, { id: "art", score: 8 }, { id: "a11y", score: 9 }, { id: "copy", score: 8 }], blocker: null });
    sess.turnEnds += 1; h.fireAgent();
    await vi.waitFor(() => expect(p.review.phase).toBe("done"));
    expect(p.critiques[0].weighted).toBeCloseTo(8.38, 2);
    expect(h.mark).toHaveBeenCalledWith(DIR, "home", 2, expect.closeTo(8.38, 2), 1);
    expect(ipc.designReviewStateSet).toHaveBeenCalled();
  });

  it("stop cancels the running turn and a critique that never came back is flagged, not passed", async () => {
    const m = await import("./design-store");
    await m.loadDesigns(DIR); await m.openDesign(DIR, "home");
    const p = m.designProjectFor(DIR);
    await m.sendDesignMessage(DIR, "x", "home");
    sess.turnActive = true;
    await m.stopReview(DIR);
    expect(h.cancel).toHaveBeenCalled(); expect(p.review.phase).toBe("stopped");
    p.review = { ...p.review, phase: "critique", round: 1 };
    h.snapshot.mockResolvedValueOnce(null); h.critique.mockRejectedValueOnce(new Error("no file"));
    sess.turnActive = false; sess.turnEnds += 1; h.fireAgent();
    await vi.waitFor(() => expect(p.critiqueMissing).toBe(true));
    expect(p.review.phase).toBe("critique");
  });

  it("a change to the director's files reloads just those files", async () => {
    const m = await import("./design-store");
    const ipc = await import("./ipc");
    const read = ipc.designRead as unknown as ReturnType<typeof vi.fn>;
    await m.openDesign(DIR, "home");
    const p = m.designProjectFor(DIR);
    read.mockClear();
    h.files.set("tokens.json", JSON.stringify({ colors: [{ name: "ink", value: "#111" }], type: [], rejected: [] }));
    h.designsChanged!({ dir: DIR, slug: "home", paths: ["tokens.json"] });
    await vi.waitFor(() => expect(p.tokens?.colors[0].name).toBe("ink"));
    expect(read).not.toHaveBeenCalled();
    h.files.delete("tokens.json");
  });

  it("reopening a design mid-loop after a restart re-runs the gate on the latest version", async () => {
    h.state.mockResolvedValueOnce({ v: 1, phase: "fixing", round: 1, fixPass: 1, version: 3, best: null, startedAt: 1, lastPrompt: "lintFix", accepted: false });
    h.review.mockResolvedValueOnce({ thumbs: [], lint: { v: 1, version: 3, at: "t", ran: true, problem: null, severe: [], minor: [] } });
    const m = await import("./design-store");
    await m.loadDesigns(DIR); await m.openDesign(DIR, "home");
    const p = m.designProjectFor(DIR);
    await vi.waitFor(() => expect(h.review).toHaveBeenCalledWith(DIR, "home", 3, true));
    await vi.waitFor(() => expect(p.review.phase).toBe("critique"));
  });

  /** Opens DIR/home fresh and starts a loop with the user's message; returns the project. */
  async function looping() {
    const m = await import("./design-store");
    await m.loadDesigns(DIR); await m.openDesign(DIR, "home");
    await m.sendDesignMessage(DIR, "A product page", "home");
    return { m, p: m.designProjectFor(DIR) };
  }

  it("a gate that couldn't run says so instead of passing the version clean", async () => {
    const { p } = await looping();
    h.snapshot.mockResolvedValueOnce(4);
    h.review.mockRejectedValueOnce(new Error("the browser isn't ready"));
    sess.turnEnds += 1; h.fireAgent();
    await vi.waitFor(() => expect(p.lint).toMatchObject({ ran: false, problem: "the browser isn't ready", version: 4, severe: [] }));
  });

  it("with the gate off, the version is rendered but never linted", async () => {
    const { p } = await looping();
    p.settings = { ...p.settings, lint: false };
    h.snapshot.mockResolvedValueOnce(6);
    h.review.mockClear();
    h.review.mockResolvedValueOnce({ thumbs: [], lint: { v: 1, version: 6, at: "t", ran: false, problem: "Lint gate off", severe: [], minor: [] } });
    sess.turnEnds += 1; h.fireAgent();
    await vi.waitFor(() => expect(h.review).toHaveBeenCalledWith(DIR, "home", 6, false));
    await vi.waitFor(() => expect(p.lint).toMatchObject({ ran: false, problem: "Lint gate off", version: 6 }));
  });

  it("a user's send during the gate takes over: the stale step sends nothing", async () => {
    const { m, p } = await looping();
    const gate = deferred<{ thumbs: string[]; lint: unknown }>();
    h.snapshot.mockResolvedValueOnce(5);
    h.review.mockReturnValueOnce(gate.promise);
    sess.turnEnds += 1; h.fireAgent();
    await vi.waitFor(() => expect(p.review.phase).toBe("gate"));
    await m.sendDesignMessage(DIR, "make the hero bigger", "home");
    gate.resolve({ thumbs: [], lint: severeLint(5) });
    await vi.waitFor(() => expect(p.review.version).toBe(5));
    await new Promise((r) => setImmediate(r));
    expect(h.sent.at(-1)).toMatch(/make the hero bigger$/);
    expect(p.review).toMatchObject({ phase: "building", lastPrompt: "user", fixPass: 0 });
  });

  it("a user's send during the turn-end snapshot wins: the step stamped before it sends nothing", async () => {
    const { m, p } = await looping();
    const snap = deferred<number | null>();
    h.snapshot.mockReturnValueOnce(snap.promise);
    sess.turnEnds += 1; h.fireAgent();
    await m.sendDesignMessage(DIR, "tighten the grid", "home");
    h.review.mockResolvedValueOnce({ thumbs: [], lint: severeLint(9) });
    snap.resolve(9);
    await vi.waitFor(() => expect(p.review.version).toBe(9));
    await new Promise((r) => setImmediate(r));
    expect(h.sent.at(-1)).toMatch(/tighten the grid$/);
    expect(p.review).toMatchObject({ phase: "building", lastPrompt: "user" });
  });

  it("a failed send never leaves a loop phase that no turn backs", async () => {
    const { m, p } = await looping();
    const agentMod = await import("./agent-session");
    const send = agentMod.sendAgentMessage as unknown as ReturnType<typeof vi.fn>;
    p.review = { ...p.review, phase: "gate" };
    send.mockRejectedValueOnce(new Error("busy"));
    await expect(m.sendDesignMessage(DIR, "again", "home")).rejects.toThrow("busy");
    expect(p.review.phase).toBe("stopped");
    p.review = { ...p.review, phase: "done" };
    send.mockRejectedValueOnce(new Error("busy"));
    await expect(m.sendDesignMessage(DIR, "again", "home")).rejects.toThrow("busy");
    expect(p.review.phase).toBe("done");
  });

  it("a Stop between the decision and its send wins", async () => {
    const { m, p } = await looping();
    const ipc = await import("./ipc");
    const versions = ipc.designVersions as unknown as ReturnType<typeof vi.fn>;
    const held = deferred<never[]>();
    let reached = false;
    versions.mockImplementationOnce(() => { reached = true; return held.promise; });
    h.snapshot.mockResolvedValueOnce(6);
    h.review.mockResolvedValueOnce({ thumbs: [], lint: cleanLint(6) });
    const sentBefore = h.sent.length;
    sess.turnEnds += 1; h.fireAgent();
    await vi.waitFor(() => expect(reached).toBe(true));
    expect(p.review.phase).toBe("critique"); // decided and committed, not yet sent
    await m.stopReview(DIR);
    held.resolve([]);
    await new Promise((r) => setImmediate(r));
    expect(p.review.phase).toBe("stopped");
    expect(h.sent.length).toBe(sentBefore);
  });

  it("a Stop during the gate wins", async () => {
    const { m, p } = await looping();
    const gate = deferred<{ thumbs: string[]; lint: unknown }>();
    h.snapshot.mockResolvedValueOnce(7);
    h.review.mockReturnValueOnce(gate.promise);
    const sentBefore = h.sent.length;
    sess.turnEnds += 1; h.fireAgent();
    await vi.waitFor(() => expect(p.review.phase).toBe("gate"));
    await m.stopReview(DIR);
    gate.resolve({ thumbs: [], lint: severeLint(7) });
    await vi.waitFor(() => expect(p.review.version).toBe(7));
    await new Promise((r) => setImmediate(r));
    expect(p.review.phase).toBe("stopped");
    expect(h.sent.length).toBe(sentBefore);
  });

  it("a loop send that fails leaves the review stopped, as the toast says", async () => {
    const { p } = await looping();
    const agentMod = await import("./agent-session");
    (agentMod.sendAgentMessage as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("busy"));
    h.snapshot.mockResolvedValueOnce(8);
    h.review.mockResolvedValueOnce({ thumbs: [], lint: cleanLint(8) });
    sess.turnEnds += 1; h.fireAgent();
    await vi.waitFor(() => expect(p.review.phase).toBe("stopped"));
  });

  it("a user message after done starts a fresh attempt", async () => {
    const { m, p } = await looping();
    p.review = { ...p.review, phase: "done", round: 2, best: { round: 2, score: 8.4 }, accepted: true };
    await m.sendDesignMessage(DIR, "now a dark version", "home");
    expect(p.review).toMatchObject({ phase: "building", round: 0, best: null, accepted: false });
  });

  it("a chat reply that changed nothing never re-critiques", async () => {
    const { m, p } = await looping();
    p.critiques = [round(1, []), round(2, [])] as never; // v2 and v3
    p.review = { ...p.review, phase: "done", round: 2, version: 3, best: { round: 2, score: 8.4 }, accepted: true };
    await m.sendDesignMessage(DIR, "what font is that?", "home");
    expect(p.review).toMatchObject({ phase: "building", round: 0, prior: { phase: "done", round: 2 } });
    const sends = h.sent.length;
    h.snapshot.mockResolvedValueOnce(null);
    sess.turnEnds += 1; h.fireAgent();
    await vi.waitFor(() => expect(p.review.phase).toBe("done"));
    expect(p.review).toMatchObject({ round: 2, version: 3, best: { round: 2, score: 8.4 }, accepted: true, prior: null });
    expect(h.sent.length).toBe(sends);
    expect(h.stateSet).toHaveBeenLastCalledWith(DIR, "home", expect.objectContaining({ phase: "done", prior: null }));
  });

  it("asking again for a round that never came back runs that round, not the next", async () => {
    const { m, p } = await looping();
    p.review = { ...p.review, phase: "critique", round: 2, version: 4 };
    p.critiqueMissing = true;
    expect(m.nextRound(p.review)).toBe(2);
    await m.askAnotherRound(DIR);
    expect(p.review).toMatchObject({ phase: "critique", round: 2 });
    expect(h.sent.at(-1)).toContain("critique/round-2.json");
    expect(p.critiqueMissing).toBe(false);
  });

  it("the pill's clock reads m:ss since the attempt started", async () => {
    const m = await import("./design-store");
    const p = m.designProjectFor("/clock");
    expect(m.reviewElapsed(p, 5_000)).toBe("0:00");
    p.review = { ...p.review, startedAt: 1_000 };
    expect(m.reviewElapsed(p, 1_000 + 125_000)).toBe("2:05");
  });

  it("resolving sends the blocker, else a finding both rounds share, else the first severe one", async () => {
    const { m, p } = await looping();
    p.critiques = [round(1, [finding("cramped")]), round(2, [finding("cramped")], "The brief asks for two heroes")] as never;
    await m.resolveBlocker(DIR);
    expect(h.sent.at(-1)).toContain("stalling on this: The brief asks for two heroes.");
    p.critiques = [round(1, [finding("cramped")]), round(2, [finding("loud", "severe"), finding("cramped")])] as never;
    await m.resolveBlocker(DIR);
    expect(h.sent.at(-1)).toContain("stalling on this: cramped.");
    p.critiques = [round(1, [finding("cramped")]), round(2, [finding("quiet"), finding("loud", "severe")])] as never;
    await m.resolveBlocker(DIR);
    expect(h.sent.at(-1)).toContain("stalling on this: loud.");
  });

  it("accepting below the bar marks the best round's version, or the current one when that round is gone", async () => {
    const { m, p } = await looping();
    h.mark.mockClear();
    p.critiques = [round(1, []), round(2, [])] as never; // versions 2 and 3
    p.review = { ...p.review, phase: "below-bar", version: 9, best: { round: 2, score: 7.7 } };
    await m.acceptBelowBar(DIR);
    expect(p.review).toMatchObject({ phase: "done", accepted: true });
    expect(h.mark).toHaveBeenLastCalledWith(DIR, "home", 3, 7.7, 2);
    p.critiques = [];
    p.review = { ...p.review, phase: "below-bar", best: { round: 2, score: 7.7 } };
    await m.acceptBelowBar(DIR);
    expect(h.mark).toHaveBeenLastCalledWith(DIR, "home", 9, 7.7, 2);
  });

  it("asking for another round sends the next round's critique", async () => {
    const { m, p } = await looping();
    p.review = { ...p.review, phase: "done", round: 2, version: 4 };
    await m.askAnotherRound(DIR);
    expect(p.review).toMatchObject({ phase: "critique", round: 3 });
    expect(h.sent.at(-1)).toContain("critique/round-3.json");
  });

  it("asking for a round, or a fix, while the loop runs is refused and changes nothing", async () => {
    const { m, p } = await looping();
    p.critiqueMissing = false;
    p.review = { ...p.review, phase: "critique", round: 2, version: 4 };
    const before = h.sent.length;
    await expect(m.askAnotherRound(DIR)).rejects.toThrow("The review is still running.");
    await expect(m.fixFinding(DIR, finding("x") as never)).rejects.toThrow("still running");
    expect(h.sent.length).toBe(before);
    expect(p.review).toMatchObject({ phase: "critique", round: 2 });
    p.review = { ...p.review, phase: "done" };
    sess.turnActive = true;
    await expect(m.askAnotherRound(DIR)).rejects.toThrow("still running");
    sess.turnActive = false;
  });

  it("settings change at the scope asked for and reload", async () => {
    const { m, p } = await looping();
    const ipc = await import("./ipc");
    const get = ipc.designReviewSettings as unknown as ReturnType<typeof vi.fn>;
    get.mockResolvedValueOnce({ project: { critique: true, bar: 8, rounds: 3, lint: true }, design: { bar: 7 }, effective: { critique: true, bar: 7, rounds: 3, lint: true } });
    await m.setReviewSettings(DIR, "design", { bar: 7 });
    expect(ipc.designReviewSettingsSet).toHaveBeenLastCalledWith(DIR, "design", "home", { bar: 7 });
    expect(p.settings.bar).toBe(7);
    expect(p.settingsScope.design).toEqual({ bar: 7 });
  });

  it("skipping the questions records it and tells the director to decide", async () => {
    const { m } = await looping();
    await m.skipQuestions(DIR);
    expect(h.answered).toHaveBeenLastCalledWith(DIR, "home", {}, true);
    expect(h.sent.at(-1)).toMatch(/Skip the questions\. Decide, and say what you assumed\.$/);
  });

  it("fix all minor sends the newest version's minor lint findings, and nothing when there are none", async () => {
    const { m, p } = await looping();
    p.review = { ...p.review, phase: "done" };
    p.lint = { ...cleanLint(3), minor: [{ rule: "r", severity: "minor", text: "tight leading", frame: "d", file: "frames/d.html" }] } as never;
    await m.fixAllMinor(DIR);
    expect(h.sent.at(-1)).toContain("- d · frames/d.html — tight leading");
    const count = h.sent.length;
    p.lint = cleanLint(3) as never;
    await m.fixAllMinor(DIR);
    expect(h.sent.length).toBe(count);
  });
});
