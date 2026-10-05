import { describe, it, expect, vi } from "vitest";

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
    await vi.waitFor(() => expect(h.review).toHaveBeenCalledWith(DIR, "home", 3));
    await vi.waitFor(() => expect(p.review.phase).toBe("critique"));
  });
});
