import { describe, expect, it, vi } from "vitest";

/* mountAgentBridge is the one impure export here — it calls onAgentAction and
 * agentActionReply from ./ipc directly (the wire itself, not a decision), and
 * says what happened through ./journal and the toasts, so those three are faked
 * rather than the whole deps surface handleAgentAction already covers. */
type FakeAction = { id: number; dir: string; action: string; args: Record<string, unknown> };
let resolveListener: ((unlisten: () => void) => void) | null = null;
let fire: ((a: FakeAction) => void) | null = null;
vi.mock("./ipc", () => ({
  agentsAvailable: vi.fn(async () => ({ claude: null, codex: null, default: "" })),
  onAgentAction: vi.fn((cb: (a: FakeAction) => void) => {
    fire = cb;
    return new Promise<() => void>((resolve) => { resolveListener = resolve; });
  }),
  agentActionReply: vi.fn(async () => {}),
}));
vi.mock("./journal", () => ({ announce: vi.fn() }));
vi.mock("@/overlays/toasts", () => ({ toastSuccess: vi.fn(), toastError: vi.fn() }));

import { describeAction, handleAgentAction, mountAgentBridge } from "./agent-bridge";
import { announce } from "./journal";
import { toastError, toastSuccess } from "@/overlays/toasts";

describe("what an agent asked for, in words", () => {
  it("names each action", () => {
    expect(describeAction("round.plan", {})).toBe("Run a round");
    expect(describeAction("round.start", { n: 3, where: "pane" })).toBe("Start round 3 in the pane");
    expect(describeAction("round.start", { n: 3, where: "terminal" })).toBe("Start round 3 in a terminal");
    expect(describeAction("project.open", { dir: "/x/y" })).toBe("Open /x/y");
    expect(describeAction("terminal.read", { lines: 200 })).toBe("Read the terminal's last 200 lines");
    expect(describeAction("nope", {})).toBeNull();
  });
});

describe("handling an action", () => {
  const deps = () => ({
    planRound: vi.fn(async () => {}), startRound: vi.fn(async () => {}), openProject: vi.fn(),
    activate: vi.fn(), revealPane: vi.fn(), revealTerminal: vi.fn(), roundTotal: vi.fn(() => 2),
    termTail: vi.fn(() => "line a\nline b"),
  });
  it("plans a round in the pane and says so", async () => {
    const d = deps();
    const r = await handleAgentAction({ id: 1, dir: "/p", action: "round.plan", args: {} }, d);
    expect(d.planRound).toHaveBeenCalledWith("/p");
    expect(d.revealPane).toHaveBeenCalled();
    expect(r).toEqual({ ok: true, summary: "An agent started planning a round in the pane." });
  });
  it("starts a round where asked", async () => {
    const d = deps();
    const r = await handleAgentAction({ id: 1, dir: "/p", action: "round.start", args: { n: 3, where: "terminal" } }, d);
    expect(d.startRound).toHaveBeenCalledWith("/p", 3, 2, "terminal");
    expect(d.revealTerminal).toHaveBeenCalled();
    expect(r.summary).toBe("An agent started round 3 in a terminal.");
  });
  it("brings the action's project to the front before it opens a pane", async () => {
    // the reveals act on whichever project the window is showing: an agent working
    // in B while the user looks at A must not flip A's panes open instead
    const order: string[] = [];
    const d = deps();
    d.activate.mockImplementation((dir: string) => { order.push(`activate ${dir}`); });
    d.revealPane.mockImplementation(() => { order.push("revealPane"); });
    d.revealTerminal.mockImplementation(() => { order.push("revealTerminal"); });

    await handleAgentAction({ id: 1, dir: "/B", action: "round.start", args: { n: 3 } }, d);
    await handleAgentAction({ id: 2, dir: "/B", action: "round.start", args: { n: 3, where: "terminal" } }, d);
    await handleAgentAction({ id: 3, dir: "/B", action: "round.plan", args: {} }, d);
    expect(order).toEqual([
      "activate /B", "revealPane",
      "activate /B", "revealTerminal",
      "activate /B", "revealPane",
    ]);
  });
  it("counts the lines it actually handed over, blank rows and all", async () => {
    // "50 lines" must never be the answer to a read that returned 73: the count is
    // the returned text's rows, with a trailing newline not counted as one of them
    const d = { ...deps(), termTail: vi.fn(() => "a\n\nb\n") };
    const r = await handleAgentAction({ id: 1, dir: "/p", action: "terminal.read", args: { id: 7, lines: 50 } }, d);
    expect(r).toEqual({ ok: true, summary: "3 lines from terminal 7.", data: { text: "a\n\nb\n", lines: 3 } });
    const empty = { ...deps(), termTail: vi.fn(() => "") };
    const e = await handleAgentAction({ id: 1, dir: "/p", action: "terminal.read", args: { id: 7 } }, empty);
    expect(e.summary).toBe("0 lines from terminal 7.");
  });
  it("reads a terminal tail", async () => {
    const d = deps();
    const r = await handleAgentAction({ id: 1, dir: "/p", action: "terminal.read", args: { id: 7, lines: 2 } }, d);
    expect(d.termTail).toHaveBeenCalledWith(7, 2);
    expect(r).toEqual({ ok: true, summary: "2 lines from terminal 7.", data: { text: "line a\nline b", lines: 2 } });
  });
  it("waits for the open, and says which kind of open it was", async () => {
    const d = deps();
    const r = await handleAgentAction({ id: 1, dir: "/p", action: "project.open", args: { dir: "/x" } }, d);
    expect(d.openProject).toHaveBeenCalledWith("/x");
    expect(r).toEqual({ ok: true, summary: "Opened /x." });
  });
  it("says it switched to a project that was already open", async () => {
    const d = { ...deps(), isProjectOpen: vi.fn(() => true) };
    const r = await handleAgentAction({ id: 1, dir: "/p", action: "project.open", args: { dir: "/x" } }, d);
    expect(r.summary).toBe("Switched to /x.");
  });
  it("does not claim an open that failed", async () => {
    const d = deps();
    d.openProject.mockRejectedValueOnce(new Error("boom"));
    const r = await handleAgentAction({ id: 1, dir: "/p", action: "project.open", args: { dir: "/x" } }, d);
    expect(r).toEqual({ ok: false, summary: "Couldn't open /x: boom" });
  });
  it("reads the tab the project is looking at when the agent names none", async () => {
    const d = { ...deps(), activeTerm: vi.fn(() => 4) };
    const r = await handleAgentAction({ id: 1, dir: "/p", action: "terminal.read", args: { lines: 200 } }, d);
    expect(d.activeTerm).toHaveBeenCalledWith("/p");
    expect(d.termTail).toHaveBeenCalledWith(4, 200);
    // 200 were asked for; two came back, and the summary says two
    expect(r).toEqual({ ok: true, summary: "2 lines from the terminal.", data: { text: "line a\nline b", lines: 2 } });
  });
  it("won't read a terminal that belongs to another project", async () => {
    const d = { ...deps(), termDir: vi.fn(() => "/other") };
    const r = await handleAgentAction({ id: 1, dir: "/p", action: "terminal.read", args: { id: 7 } }, d);
    expect(d.termTail).not.toHaveBeenCalled();
    expect(r).toEqual({ ok: false, summary: "Terminal 7 isn't in this project." });
  });
  it("says so when there is no terminal to read", async () => {
    const d = { ...deps(), termTail: vi.fn(() => null) };
    const r = await handleAgentAction({ id: 1, dir: "/p", action: "terminal.read", args: {} }, d);
    expect(r).toEqual({ ok: false, summary: "Couldn't read the terminal: no terminal is open there" });
  });
  it("refuses what it does not know, and reports a failure honestly", async () => {
    const d = deps();
    expect((await handleAgentAction({ id: 1, dir: "/p", action: "nope", args: {} }, d)).ok).toBe(false);
    d.startRound.mockRejectedValueOnce(new Error("no queued notes"));
    const r = await handleAgentAction({ id: 1, dir: "/p", action: "round.start", args: { n: 1 } }, d);
    expect(r).toEqual({ ok: false, summary: "Couldn't start round 1: no queued notes" });
  });
});

describe("a run an outside session asked for", () => {
  const deps = () => ({
    planRound: vi.fn(async () => {}), startRound: vi.fn(async () => {}), openProject: vi.fn(),
    activate: vi.fn(), revealPane: vi.fn(), revealTerminal: vi.fn(), roundTotal: vi.fn(() => 2),
    termTail: vi.fn(() => ""), beginRun: vi.fn(async () => 7), resumeRun: vi.fn(async () => {}),
  });
  it("names each run action", () => {
    expect(describeAction("run.begin", { source: { kind: "notes" } })).toBe("Begin a run from the queued notes");
    expect(describeAction("run.begin", { source: { kind: "plan", path: "fixes/phase_4_fixes_plan.md" } })).toBe("Begin a run from fixes/phase_4_fixes_plan.md");
    expect(describeAction("run.begin", { source: { kind: "prompt", text: "tidy the copy" } })).toBe("Begin a run from a prompt");
    expect(describeAction("run.begin", {})).toBeNull();
    expect(describeAction("run.resume", { n: 3 })).toBe("Resume round 3");
  });
  it("begins a run in the pane, the way the Run button does", async () => {
    const d = deps();
    const order: string[] = [];
    d.activate.mockImplementation(() => { order.push("activate"); });
    d.revealPane.mockImplementation(() => { order.push("revealPane"); });
    const source = { kind: "prompt", text: "tidy the copy" };
    const r = await handleAgentAction({ id: 1, dir: "/p", action: "run.begin", args: { source } }, d);
    expect(d.beginRun).toHaveBeenCalledWith("/p", source);
    expect(order).toEqual(["activate", "revealPane"]);
    expect(r).toEqual({ ok: true, summary: "An agent began round 7 as a run in the pane.", data: { n: 7 } });
  });
  it("refuses a source it can't read, and reports a refused begin honestly", async () => {
    const d = deps();
    expect(await handleAgentAction({ id: 1, dir: "/p", action: "run.begin", args: { source: { kind: "later" } } }, d))
      .toEqual({ ok: false, summary: "Couldn't start a run: no source to run" });
    expect(d.beginRun).not.toHaveBeenCalled();
    d.beginRun.mockRejectedValueOnce(new Error("A round is already running in this project."));
    expect(await handleAgentAction({ id: 1, dir: "/p", action: "run.begin", args: { source: { kind: "notes" } } }, d))
      .toEqual({ ok: false, summary: "Couldn't start a run: A round is already running in this project." });
  });
  it("resumes a run in the pane", async () => {
    const d = deps();
    const r = await handleAgentAction({ id: 1, dir: "/p", action: "run.resume", args: { n: 3 } }, d);
    expect(d.resumeRun).toHaveBeenCalledWith("/p", 3);
    expect(r).toEqual({ ok: true, summary: "An agent resumed round 3." });
    expect((await handleAgentAction({ id: 1, dir: "/p", action: "run.resume", args: {} }, d)).ok).toBe(false);
  });
});

describe("mounting the bridge", () => {
  const minimalDeps = () => ({
    planRound: vi.fn(async () => {}), startRound: vi.fn(async () => {}), openProject: vi.fn(),
    activate: vi.fn(), revealPane: vi.fn(), revealTerminal: vi.fn(), roundTotal: vi.fn(() => 0),
    termTail: vi.fn(() => null),
  });

  it("signals ready only after onAgentAction's listener is registered", async () => {
    resolveListener = null;
    const order: string[] = [];
    const bridgeReady = vi.fn(() => { order.push("ready"); });
    mountAgentBridge({ ...minimalDeps(), bridgeReady });

    // onAgentAction was called, but its promise has not settled yet: too early
    await Promise.resolve();
    expect(bridgeReady).not.toHaveBeenCalled();

    order.push("registered");
    resolveListener!(() => {}); // the listener is "live" now
    await Promise.resolve();
    await Promise.resolve();

    expect(order).toEqual(["registered", "ready"]);
    expect(bridgeReady).toHaveBeenCalledTimes(1);
  });

  it("tolerates a deps object with no bridgeReady at all", async () => {
    resolveListener = null;
    expect(() => mountAgentBridge(minimalDeps())).not.toThrow();
    resolveListener!(() => {});
    await Promise.resolve();
    await Promise.resolve(); // nothing throws once the listener resolves either
  });

  /* Nothing an agent does is silent. A success is both said now (the toast) and
   * recorded for later (the journal); a refusal is said, and only said — the app
   * declining to do something is not part of the project's history. */
  describe("saying what an agent did", () => {
    const settle = async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); };
    const mountAndFire = async (a: FakeAction) => {
      resolveListener = null;
      fire = null;
      vi.mocked(toastSuccess).mockClear();
      vi.mocked(toastError).mockClear();
      vi.mocked(announce).mockClear();
      mountAgentBridge(minimalDeps());
      resolveListener!(() => {});
      await settle();
      fire!(a);
      await settle();
    };

    it("toasts AND writes a journal line when an action worked", async () => {
      await mountAndFire({ id: 9, dir: "/p", action: "round.plan", args: {} });
      const said = "An agent started planning a round in the pane.";
      expect(toastSuccess).toHaveBeenCalledWith(said);
      expect(announce).toHaveBeenCalledWith("/p", "agent-action", said, "Chronicle");
      expect(toastError).not.toHaveBeenCalled();
    });

    it("toasts a refusal without writing one", async () => {
      await mountAndFire({ id: 10, dir: "/p", action: "nope", args: {} });
      expect(toastError).toHaveBeenCalledWith(
        "An agent asked for something Chronicle couldn't do",
        `Couldn't run "nope": Chronicle doesn't know that action`,
      );
      expect(announce).not.toHaveBeenCalled();
      expect(toastSuccess).not.toHaveBeenCalled();
    });
  });
});

describe("the Design pane's actions", () => {
  const base = {
    planRound: vi.fn(async () => {}), startRound: vi.fn(async () => {}), openProject: vi.fn(async () => {}),
    activate: vi.fn(), revealPane: vi.fn(), revealTerminal: vi.fn(), roundTotal: vi.fn(() => 0), termTail: vi.fn(() => null),
  };
  it("captures, lints and benchmarks, each with its own sentence", async () => {
    const d = {
      ...base,
      designCapture: vi.fn(async () => ["/d/.review/captures/a.png", "/d/.review/captures/b.png"]),
      designLint: vi.fn(async () => ({ v: 1 as const, version: null, at: "", ran: true, problem: null, severe: [{ rule: "r", severity: "severe" as const, text: "t", frame: "f", file: "x" }], minor: [] })),
      designBench: vi.fn(async () => ({ summary: { total: 3, passed: 2, mean: 8.06, compared: 1, beat: 1 } }) as never),
    };
    const c = await handleAgentAction({ id: 1, dir: "/p", action: "designs.capture", args: { slug: "s", frame: "home" } }, d);
    expect(d.designCapture).toHaveBeenCalledWith("/p", "s", "home");
    expect(c).toEqual({ ok: true, summary: "2 pictures under .review/captures/", data: { paths: ["/d/.review/captures/a.png", "/d/.review/captures/b.png"] } });
    const l = await handleAgentAction({ id: 2, dir: "/p", action: "designs.lint", args: { slug: "s" } }, d);
    expect(l.summary).toBe("1 severe · 0 minor");
    const b = await handleAgentAction({ id: 3, dir: "/p", action: "designs.bench", args: { quick: true, kind: "app" } }, d);
    expect(d.designBench).toHaveBeenCalledWith("/p", { quick: true, kind: "app" });
    expect(b.summary).toBe("2 of 3 passed the bar · mean 8.1");
    expect(describeAction("designs.bench", {})).toBe("Run the design benchmark");
  });
  it("refuses a capture with no design named", async () => {
    const r = await handleAgentAction({ id: 4, dir: "/p", action: "designs.capture", args: {} }, { ...base, designCapture: vi.fn() });
    expect(r.ok).toBe(false);
  });
});
