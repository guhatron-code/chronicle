/*
 * Runs in the agent store: a lane's wire lands in its own session keyed under
 * its run; a run's card enters the chat thread and its planner prompt is sent;
 * the planning turn's end starts the run, or sends the reasons and waits again.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentEntry } from "./agent-session";

type Update = { dir: string; lane?: string; message: { method: string; params?: Record<string, unknown> } };
let onUpdate: ((u: Update) => void) | null = null;

vi.mock("./ipc", () => ({
  agentsAvailable: vi.fn(async () => ({ claude: null, codex: null, default: "" })),
  onAcpUpdate: vi.fn(async (cb: (u: Update) => void) => { onUpdate = cb; return () => {}; }),
  agentPrompt: vi.fn(async () => {}), roundRunMessage: vi.fn(async () => ""), agentSessionStart: vi.fn(async () => {}),
  roundPlanBegin: vi.fn(), roundPlanCancel: vi.fn(async () => {}), roundPlanSettle: vi.fn(),
  agentCancel: vi.fn(), agentEdits: vi.fn(async () => ({ files: [] })), agentHistoryRead: vi.fn(async () => ({ lines: [] })),
  agentSetConfigOption: vi.fn(), agentRespondPermission: vi.fn(), agentSessionResume: vi.fn(),
  agentSessionState: vi.fn(), agentSessionStop: vi.fn(), agentSessionsList: vi.fn(), agentSetMode: vi.fn(), designOutsideFiles: vi.fn(async () => []),
}));
vi.mock("./runs-ipc", () => ({
  runBegin: vi.fn(async () => ({ n: 10, total: 7, prompt: "PLAN IT" })),
  runPlanSettle: vi.fn(async () => ({ state: "running" })),
  runPlanCancel: vi.fn(async () => {}),
  runResume: vi.fn(async () => ({ state: "planning", prompt: "PLAN AGAIN" })),
}));
vi.mock("./runs-store", () => ({ refreshRuns: vi.fn(async () => []) }));
vi.mock("./notes-store", () => ({
  indexFor: () => ({ notes: [], rounds: [], generation: 0, vault: "", borrowed: false }),
  refreshNotes: vi.fn(async () => {}), roundGenerating: vi.fn(() => false), roundNotesFor: vi.fn(() => []), setRoundGenerating: vi.fn(),
}));
vi.mock("./journal", () => ({ announce: vi.fn() }));
vi.mock("@/overlays/toasts", () => ({ toastAction: vi.fn(), toastError: vi.fn() }));

const ipc = await import("./ipc");
const runsIpc = await import("./runs-ipc");
const notes = await import("./notes-store");
const agent = await import("./agent-session");
const DIR = "/home/u/proj";
const chunk = (text: string) => ({ method: "session/update", params: { update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } } } });
const usage = (amount: number) => ({ method: "session/update", params: { update: { sessionUpdate: "usage_update", used: 1, size: 10, cost: { amount } } } });
const turnEnd = () => ({ method: "_chronicle/turn_end", params: { stopReason: "end_turn" } });
const runCards = () => agent.agentSessionFor(DIR).entries.filter((e) => e.kind === "run");
const runCard = () => agent.agentSessionFor(DIR).entries.find((e) => e.kind === "run") as Extract<AgentEntry, { kind: "run" }> | undefined;

describe("runs in the agent store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(agent.agentSessionFor(DIR), { phase: "ready", turnActive: false, entries: [], queue: [], cost: 1.0 });
    // deliver anything a previous test left pending, so no backstop timer carries over
    agent.flushAgentNotifications();
  });

  it("a lane's updates land in its own session, keyed under its run", () => {
    onUpdate!({ dir: DIR, lane: "w/10-2", message: chunk("lane says hi") });
    agent.flushAgentNotifications();
    const key = agent.laneKey(DIR, "w/10-2");
    expect(key).toBe(`${DIR}#w/10-2`);
    expect(agent.splitLaneKey(key)).toEqual({ dir: DIR, lane: "w/10-2" });
    expect(agent.splitLaneKey(`/a#b/p#w/1-0`)).toEqual({ dir: "/a#b/p", lane: "w/1-0" });
    expect(agent.agentSessionFor(key).entries[0]).toMatchObject({ kind: "assistant", text: "lane says hi" });
    expect(agent.agentSessionFor(DIR).entries).toHaveLength(0);
  });

  it("a decision rides on its guard row", () => {
    const key = agent.laneKey(DIR, "w/10-1");
    onUpdate!({ dir: DIR, lane: "w/10-1", message: { method: "_chronicle/guard", params: { allowed: true, path: "npx vitest run src/lib", reason: "it reads only",
      decision: { choice: "allow", confidence: 0.93, model: "jev-1.13.0", band: "act" } } } });
    agent.flushAgentNotifications();
    expect(agent.agentSessionFor(key).entries.at(-1)).toMatchObject({ kind: "guard", allowed: true, decision: { confidence: 0.93, model: "jev-1.13.0" } });
  });

  it("a run lands its card and sends the planner prompt", async () => {
    expect(await agent.startRunInPane(DIR, { kind: "notes" })).toBe(10);
    await vi.waitFor(() => { agent.flushAgentNotifications(); expect(ipc.agentPrompt).toHaveBeenCalled(); }, { timeout: 5000, interval: 5 });
    expect(runCard()).toMatchObject({ kind: "run", n: 10, total: 7, queued: false, costBase: 1.0 });
    expect(vi.mocked(ipc.agentPrompt).mock.calls[0][2]).toBe("PLAN IT");
  });

  it("the planning turn's end starts the run with what the turn cost", async () => {
    await agent.startRunInPane(DIR, { kind: "notes" });
    await vi.waitFor(() => { agent.flushAgentNotifications(); expect(ipc.agentPrompt).toHaveBeenCalled(); }, { timeout: 5000, interval: 5 });
    onUpdate!({ dir: DIR, lane: "chat", message: usage(1.26) });
    agent.flushAgentNotifications();
    onUpdate!({ dir: DIR, lane: "chat", message: turnEnd() });
    agent.flushAgentNotifications();
    await vi.waitFor(() => { agent.flushAgentNotifications(); expect(runsIpc.runPlanSettle).toHaveBeenCalledWith(DIR, 10, expect.closeTo(0.26, 5)); }, { timeout: 5000, interval: 5 });
    await vi.waitFor(() => { agent.flushAgentNotifications(); expect(runCard()).toMatchObject({ ended: true, outcome: "running" }); }, { timeout: 5000, interval: 5 });
  });

  it("an accepted map moves the run's card to the end of the thread and leaves its plan row in place", async () => {
    await agent.startRunInPane(DIR, { kind: "notes" });
    await vi.waitFor(() => { agent.flushAgentNotifications(); expect(ipc.agentPrompt).toHaveBeenCalled(); }, { timeout: 5000, interval: 5 });
    onUpdate!({ dir: DIR, lane: "chat", message: chunk("I wrote the plan and declared two lanes.") });
    agent.flushAgentNotifications();
    onUpdate!({ dir: DIR, lane: "chat", message: turnEnd() });
    agent.flushAgentNotifications();
    await vi.waitFor(() => { agent.flushAgentNotifications(); expect(runCards().at(-1)).toMatchObject({ outcome: "running" }); }, { timeout: 5000, interval: 5 });
    const es = agent.agentSessionFor(DIR).entries;
    const reply = es.findIndex((e) => e.kind === "assistant");
    expect(es.at(-1)).toMatchObject({ kind: "run", n: 10, total: 7, ended: true, outcome: "running", part: "card" });
    const plan = es.findIndex((e) => e.kind === "run" && e.part === "plan");
    expect(plan).toBeGreaterThanOrEqual(0);
    expect(plan).toBeLessThan(reply);
    expect(runCards()).toHaveLength(2);
  });

  it("a turn that declared no map sends the reasons and waits again", async () => {
    vi.mocked(runsIpc.runPlanSettle).mockResolvedValueOnce({ state: "retry", prompt: "FIX THE MAP" });
    await agent.startRunInPane(DIR, { kind: "notes" });
    await vi.waitFor(() => { agent.flushAgentNotifications(); expect(ipc.agentPrompt).toHaveBeenCalledTimes(1); }, { timeout: 5000, interval: 5 });
    onUpdate!({ dir: DIR, lane: "chat", message: turnEnd() });
    agent.flushAgentNotifications();
    await vi.waitFor(() => { agent.flushAgentNotifications(); expect(vi.mocked(ipc.agentPrompt).mock.calls.at(-1)?.[2]).toBe("FIX THE MAP"); }, { timeout: 5000, interval: 5 });
    expect(runCard()).toMatchObject({ ended: false, queued: false });
  });

  it("a stopped planning turn cancels the run", async () => {
    await agent.startRunInPane(DIR, { kind: "notes" });
    await vi.waitFor(() => { agent.flushAgentNotifications(); expect(ipc.agentPrompt).toHaveBeenCalled(); }, { timeout: 5000, interval: 5 });
    onUpdate!({ dir: DIR, lane: "chat", message: { method: "_chronicle/turn_end", params: { stopReason: "cancelled" } } });
    agent.flushAgentNotifications();
    await vi.waitFor(() => { agent.flushAgentNotifications(); expect(runsIpc.runPlanCancel).toHaveBeenCalledWith(DIR, 10); }, { timeout: 5000, interval: 5 });
    await vi.waitFor(() => { agent.flushAgentNotifications(); expect(runCard()).toMatchObject({ ended: true, outcome: "cancelled" }); }, { timeout: 5000, interval: 5 });
  });

  it("resuming a run caught while planning sends its planner prompt again", async () => {
    await agent.resumeRunInPane(DIR, 10);
    await vi.waitFor(() => { agent.flushAgentNotifications(); expect(vi.mocked(ipc.agentPrompt).mock.calls.at(-1)?.[2]).toBe("PLAN AGAIN"); }, { timeout: 5000, interval: 5 });
    expect(runCard()).toMatchObject({ n: 10 });
  });

  it("a first send that fails ends the card failed and takes the run out of planning", async () => {
    vi.mocked(ipc.agentPrompt).mockRejectedValueOnce(new Error("the agent is still working"));
    await expect(agent.startRunInPane(DIR, { kind: "notes" })).rejects.toThrow("still working");
    expect(runCard()).toMatchObject({ ended: true, outcome: "failed" });
    expect(runsIpc.runPlanCancel).toHaveBeenCalledWith(DIR, 10);
    expect(notes.setRoundGenerating).toHaveBeenLastCalledWith(DIR, false);
  });

  it("a retry whose reasons can't be sent fails the run and tells Rust", async () => {
    vi.mocked(runsIpc.runPlanSettle).mockResolvedValueOnce({ state: "retry", prompt: "FIX THE MAP" });
    await agent.startRunInPane(DIR, { kind: "notes" });
    await vi.waitFor(() => { agent.flushAgentNotifications(); expect(ipc.agentPrompt).toHaveBeenCalledTimes(1); }, { timeout: 5000, interval: 5 });
    vi.mocked(ipc.agentPrompt).mockRejectedValueOnce(new Error("gone"));
    onUpdate!({ dir: DIR, lane: "chat", message: turnEnd() });
    agent.flushAgentNotifications();
    await vi.waitFor(() => { agent.flushAgentNotifications(); expect(runsIpc.runPlanCancel).toHaveBeenCalledWith(DIR, 10); }, { timeout: 5000, interval: 5 });
    expect(runCard()).toMatchObject({ ended: true, outcome: "failed" });
    expect(notes.setRoundGenerating).toHaveBeenLastCalledWith(DIR, false);
  });

  it("a settle that throws cancels the run's planning and fails the card", async () => {
    vi.mocked(runsIpc.runPlanSettle).mockRejectedValueOnce(new Error("disk"));
    await agent.startRunInPane(DIR, { kind: "notes" });
    await vi.waitFor(() => { agent.flushAgentNotifications(); expect(ipc.agentPrompt).toHaveBeenCalled(); }, { timeout: 5000, interval: 5 });
    onUpdate!({ dir: DIR, lane: "chat", message: turnEnd() });
    agent.flushAgentNotifications();
    await vi.waitFor(() => { agent.flushAgentNotifications(); expect(runCard()).toMatchObject({ ended: true, outcome: "failed" }); }, { timeout: 5000, interval: 5 });
    expect(runsIpc.runPlanCancel).toHaveBeenCalledWith(DIR, 10);
  });

  it("resuming a run whose card is in the thread reopens that card", async () => {
    agent.agentSessionFor(DIR).entries.push({ kind: "run", rev: 0, n: 10, total: 7, ended: true, outcome: "failed" });
    await agent.resumeRunInPane(DIR, 10);
    await vi.waitFor(() => { agent.flushAgentNotifications(); expect(vi.mocked(ipc.agentPrompt).mock.calls.at(-1)?.[2]).toBe("PLAN AGAIN"); }, { timeout: 5000, interval: 5 });
    expect(runCards()).toHaveLength(1);
    expect(runCard()).toMatchObject({ n: 10, total: 7, ended: false, queued: false });
    expect(runCard()?.outcome).toBeUndefined();
  });

  it("after a relaunch, a run still in progress lands its card at the thread's end, once", async () => {
    const store = await import("./runs-store");
    const rec = (n: number, state: string) => ({ n, state, round: n, lane_map: { items: [{ id: "T-1" }, { id: "T-2" }], lanes: [] } });
    agent.agentSessionFor(DIR).entries.push({ kind: "user", text: "earlier" } as unknown as AgentEntry);
    vi.mocked(store.refreshRuns).mockResolvedValue([rec(9, "done"), rec(12, "interrupted")] as never);
    await agent.landLiveRunCards(DIR);
    agent.flushAgentNotifications();
    const es = agent.agentSessionFor(DIR).entries;
    expect(es.at(-1)).toMatchObject({ kind: "run", n: 12, total: 2, part: "card", ended: true, queued: false });
    expect(runCards()).toHaveLength(1);
    expect(runCards()[0]).toMatchObject({ n: 12 });
    expect(ipc.agentPrompt).not.toHaveBeenCalled();
    await agent.landLiveRunCards(DIR);
    expect(runCards()).toHaveLength(1);
    vi.mocked(store.refreshRuns).mockResolvedValue([rec(9, "done"), rec(10, "stopped"), rec(11, "failed")] as never);
    agent.agentSessionFor(DIR).entries = [];
    await agent.landLiveRunCards(DIR);
    expect(runCards()).toHaveLength(0);
    vi.mocked(store.refreshRuns).mockResolvedValue([]);
  });

  it("a card landed after a relaunch is never settled by the next chat turn", async () => {
    const store = await import("./runs-store");
    vi.mocked(store.refreshRuns).mockResolvedValue([{ n: 12, state: "interrupted", round: 12, lane_map: null }] as never);
    await agent.landLiveRunCards(DIR);
    const before = { ...runCard()! };
    onUpdate!({ dir: DIR, lane: "chat", message: chunk("an ordinary reply") });
    onUpdate!({ dir: DIR, lane: "chat", message: turnEnd() });
    agent.flushAgentNotifications();
    await new Promise((r) => setTimeout(r, 20));
    agent.flushAgentNotifications();
    expect(runsIpc.runPlanSettle).not.toHaveBeenCalled();
    expect(runsIpc.runPlanCancel).not.toHaveBeenCalled();
    expect(runCard()).toEqual(before);
    vi.mocked(store.refreshRuns).mockResolvedValue([]);
  });

  it("a card landed after a relaunch becomes the plan again when its planning run is resumed, and the map lands the card once", async () => {
    const store = await import("./runs-store");
    vi.mocked(store.refreshRuns).mockResolvedValue([{ n: 10, state: "interrupted", round: 10, lane_map: null }] as never);
    await agent.landLiveRunCards(DIR);
    vi.mocked(store.refreshRuns).mockResolvedValue([]);
    await agent.resumeRunInPane(DIR, 10);
    await vi.waitFor(() => { agent.flushAgentNotifications(); expect(vi.mocked(ipc.agentPrompt).mock.calls.at(-1)?.[2]).toBe("PLAN AGAIN"); }, { timeout: 5000, interval: 5 });
    expect(runCards()).toHaveLength(1);
    expect(runCard()).toMatchObject({ n: 10, ended: false, queued: false });
    expect(runCard()?.part).not.toBe("card");
    onUpdate!({ dir: DIR, lane: "chat", message: turnEnd() });
    agent.flushAgentNotifications();
    await vi.waitFor(() => { agent.flushAgentNotifications(); expect(runCards()).toHaveLength(2); }, { timeout: 5000, interval: 5 });
    expect(runCards()[0]).toMatchObject({ part: "plan" });
    expect(runCards()[1]).toMatchObject({ part: "card", outcome: "running" });
  });

  it("a run that can't begin touches nothing", async () => {
    vi.mocked(runsIpc.runBegin).mockRejectedValueOnce(new Error("no notes"));
    await expect(agent.startRunInPane(DIR, { kind: "notes" })).rejects.toThrow("no notes");
    expect(runCards()).toHaveLength(0);
    expect(notes.setRoundGenerating).not.toHaveBeenCalled();
    expect(ipc.agentPrompt).not.toHaveBeenCalled();
  });

  it("a queued planner prompt whose send fails ends the card failed and takes the run out of planning", async () => {
    agent.agentSessionFor(DIR).turnActive = true;
    await agent.startRunInPane(DIR, { kind: "notes" });
    expect(runCard()).toMatchObject({ queued: true });
    vi.mocked(ipc.agentPrompt).mockRejectedValueOnce(new Error("the agent is still working"));
    onUpdate!({ dir: DIR, lane: "chat", message: turnEnd() });
    agent.flushAgentNotifications();
    await vi.waitFor(() => { agent.flushAgentNotifications(); expect(runsIpc.runPlanCancel).toHaveBeenCalledWith(DIR, 10); }, { timeout: 5000, interval: 5 });
    expect(runCard()).toMatchObject({ ended: true, outcome: "failed" });
    expect(notes.setRoundGenerating).toHaveBeenLastCalledWith(DIR, false);
    expect(runsIpc.runPlanCancel).toHaveBeenCalledTimes(1);
  });
});
