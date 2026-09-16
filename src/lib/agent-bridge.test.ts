import { describe, expect, it, vi } from "vitest";
import { describeAction, handleAgentAction } from "./agent-bridge";

describe("what an agent asked for, in words", () => {
  it("names each action", () => {
    expect(describeAction("round.plan", {})).toBe("Plan a round");
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
    revealPane: vi.fn(), revealTerminal: vi.fn(), roundTotal: vi.fn(() => 2),
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
