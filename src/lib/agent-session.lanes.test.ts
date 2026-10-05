import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  onUpdate: null as ((u: unknown) => void) | null,
  agentPrompt: vi.fn(async (..._a: unknown[]) => {}),
  outsideFiles: vi.fn(async (_dir: string) => [] as { path: string; abs: string }[]),
}));
const agentPrompt = h.agentPrompt;
vi.mock("./ipc", async (orig) => ({
  ...(await orig<typeof import("./ipc")>()),
  onAcpUpdate: vi.fn(async (cb: (u: unknown) => void) => { h.onUpdate = cb; return () => {}; }),
  agentPrompt: h.agentPrompt,
  agentSessionState: vi.fn(async () => ({ alive: false })),
  agentSessionStart: vi.fn(async () => ({ started: true })),
  agentEdits: vi.fn(async () => []),
  designOutsideFiles: h.outsideFiles,
}));
vi.mock("./notes-store", () => ({}));
vi.mock("./journal", () => ({ announce: vi.fn() }));
vi.mock("@/overlays/toasts", () => ({ toastError: vi.fn(), toastSuccess: vi.fn() }));

const DIR = "/home/u/proj";

describe("lanes", () => {
  beforeEach(() => { agentPrompt.mockClear(); });

  it("keys and splits", async () => {
    const m = await import("./agent-session");
    expect(m.laneKey(DIR, "chat")).toBe(DIR);
    expect(m.laneKey(DIR, "design")).toBe(`${DIR}#design`);
    expect(m.splitLaneKey(`${DIR}#design`)).toEqual({ dir: DIR, lane: "design" });
    expect(m.splitLaneKey(DIR)).toEqual({ dir: DIR, lane: "chat" });
  });

  it("routes updates to the lane they name and never crosses", async () => {
    const m = await import("./agent-session");
    m.agentSessionFor(DIR);
    h.onUpdate!({ dir: DIR, lane: "design", message: { method: "_chronicle/session_state", params: { state: "ready", sessionId: "d1" } } });
    expect(m.agentSessionFor(m.laneKey(DIR, "design")).phase).toBe("ready");
    expect(m.agentSessionFor(DIR).phase).toBe("none");
    h.onUpdate!({ dir: DIR, message: { method: "_chronicle/session_state", params: { state: "ready", sessionId: "c1" } } });
    expect(m.agentSessionFor(DIR).phase).toBe("ready");
  });

  it("records guards, outside changes, idle ends and turn ends in the design lane", async () => {
    const m = await import("./agent-session");
    const key = m.laneKey(DIR, "design");
    h.onUpdate!({ dir: DIR, lane: "design", message: { method: "_chronicle/guard", params: { toolCallId: "t", allowed: false, path: "/p/src/a.ts", reason: "no" } } });
    h.onUpdate!({ dir: DIR, lane: "design", message: { method: "_chronicle/outside_changes", params: { paths: ["src/a.ts"] } } });
    h.onUpdate!({ dir: DIR, lane: "design", message: { method: "_chronicle/turn_end", params: { stopReason: "end_turn" } } });
    h.onUpdate!({ dir: DIR, lane: "design", message: { method: "_chronicle/session_state", params: { state: "ended", reason: "idle" } } });
    const s = m.agentSessionFor(key);
    expect(s.entries.some((e) => e.kind === "guard" && !e.allowed)).toBe(true);
    expect(s.outside).toEqual(["src/a.ts"]);
    expect(s.turnEnds).toBe(1);
    expect(s.phase).toBe("ended");
    expect(s.endedReason).toBe("idle");
  });

  it("remembers why the last design turn stopped", async () => {
    const m = await import("./agent-session");
    const key = m.laneKey(DIR, "design");
    h.onUpdate!({ dir: DIR, lane: "design", message: { method: "_chronicle/turn_end", params: { stopReason: "cancelled" } } });
    expect(m.agentSessionFor(key).lastStopReason).toBe("cancelled");
    h.onUpdate!({ dir: DIR, lane: "design", message: { method: "_chronicle/turn_end", params: {} } });
    expect(m.agentSessionFor(key).lastStopReason).toBeNull();
  });

  it("sends the prefix to the agent but shows the plain text", async () => {
    const m = await import("./agent-session");
    const key = m.laneKey(DIR, "design");
    m.agentSessionFor(key).phase = "ready";
    await m.sendAgentMessage(key, "Make it bolder", undefined, { prefix: "[design: home · .chronicle/designs/home/]" });
    expect(agentPrompt).toHaveBeenCalledWith(key, [{ type: "text", text: "[design: home · .chronicle/designs/home/]\n\nMake it bolder" }], "Make it bolder");
    const last = m.agentSessionFor(key).entries.at(-1)!;
    expect(last.kind === "user" && last.text).toBe("Make it bolder");
  });

  it("adopting the design lane never touches the chat's edit review", async () => {
    const ipc = await import("./ipc");
    const m = await import("./agent-session");
    (ipc.agentEdits as unknown as { mockClear: () => void }).mockClear();
    await m.adoptAgentSession(m.laneKey(DIR, "design"));
    expect(ipc.agentEdits).not.toHaveBeenCalled();
  });

  it("undoing one outside file leaves the rest listed — the ledger decides", async () => {
    const m = await import("./agent-session");
    const key = m.laneKey(DIR, "design");
    const file = (rel: string) => ({ path: rel, abs: `${DIR}/${rel}`, kind: "modified", viaCommand: false, plus: 1, minus: 0 });
    h.outsideFiles.mockImplementation(async () => [file("src/a.ts"), file("src/b.ts")]);
    h.onUpdate!({ dir: DIR, lane: "design", message: { method: "_chronicle/outside_changes", params: { paths: ["src/a.ts", "src/b.ts"] } } });
    await vi.waitFor(() => expect(m.agentSessionFor(key).outsideAbs["src/b.ts"]).toBe(`${DIR}/src/b.ts`));
    expect(h.outsideFiles).toHaveBeenCalledWith(DIR);

    h.outsideFiles.mockImplementation(async () => [file("src/b.ts")]);
    h.onUpdate!({ dir: DIR, lane: "design", message: { method: "_chronicle/outside_changes", params: { paths: [], reverted: 1 } } });
    expect(m.agentSessionFor(key).outside).toEqual(["src/a.ts", "src/b.ts"]); // not blanked while the ledger is read
    await vi.waitFor(() => expect(m.agentSessionFor(key).outside).toEqual(["src/b.ts"]));

    h.outsideFiles.mockImplementation(async () => []);
    await m.refreshDesignOutside(key);
    expect(m.agentSessionFor(key).outside).toEqual([]);
    expect(m.agentSessionFor(key).outsideAbs).toEqual({});
  });
});
