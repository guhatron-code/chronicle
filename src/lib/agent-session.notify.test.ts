// src/lib/agent-session.notify.test.ts
/*
 * The store used to call every subscriber synchronously on every wire message —
 * dozens of full pane renders a second while text streamed. Now a burst of
 * updates inside one frame is one delivery, with a timer backstop for the case
 * where no frame ever comes (a hidden window).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Update = { dir: string; message: { method: string; params?: Record<string, unknown> } };
let onUpdate: ((u: Update) => void) | null = null;

vi.mock("./ipc", () => ({
  agentsAvailable: vi.fn(async () => ({ claude: null, codex: null, default: "" })),
  onAcpUpdate: vi.fn(async (cb: (u: Update) => void) => { onUpdate = cb; return () => {}; }),
  agentPrompt: vi.fn(async () => {}), roundRunMessage: vi.fn(async () => ""),
  agentSessionStart: vi.fn(async () => {}), roundPlanBegin: vi.fn(), roundPlanCancel: vi.fn(async () => {}),
  roundPlanSettle: vi.fn(), agentCancel: vi.fn(), agentEdits: vi.fn(async () => []), agentHistoryRead: vi.fn(),
  agentSetConfigOption: vi.fn(), agentRespondPermission: vi.fn(), agentSessionResume: vi.fn(),
  agentSessionState: vi.fn(), agentSessionStop: vi.fn(), agentSessionsList: vi.fn(), agentSetMode: vi.fn(),
}));
vi.mock("./notes-store", () => ({
  indexFor: () => ({ notes: [], rounds: [], generation: 0, vault: "", borrowed: false }),
  refreshNotes: vi.fn(async () => {}), roundGenerating: vi.fn(() => false), roundNotesFor: vi.fn(() => []), setRoundGenerating: vi.fn(),
}));
vi.mock("./journal", () => ({ announce: vi.fn() }));
vi.mock("@/overlays/toasts", () => ({ toastAction: vi.fn(), toastError: vi.fn() }));

const agent = await import("./agent-session");
const DIR = "/p";
const chunk = (text: string) =>
  onUpdate!({ dir: DIR, message: { method: "session/update", params: { update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } } } } });

describe("notifications coalesce", () => {
  let frames: FrameRequestCallback[];
  beforeEach(() => {
    frames = [];
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { frames.push(cb); return frames.length; });
    Object.assign(agent.agentSessionFor(DIR), { phase: "ready", entries: [] });
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

  it("delivers one notification for a burst of chunks in one frame", () => {
    const seen = vi.fn();
    const off = agent.subscribeAgent(seen);
    const before = agent.agentVersion();
    for (let i = 0; i < 100; i++) chunk("x");
    expect(seen).not.toHaveBeenCalled();
    expect(frames.length).toBe(1); // one frame requested, not a hundred
    frames[0](0);
    expect(seen).toHaveBeenCalledTimes(1);
    expect(agent.agentVersion()).toBe(before + 1);
    expect(agent.agentSessionFor(DIR).entries[0]).toMatchObject({ kind: "assistant", text: "x".repeat(100) });
    off();
  });

  it("still delivers when no frame ever fires (a hidden window)", () => {
    const seen = vi.fn();
    const off = agent.subscribeAgent(seen);
    chunk("y");
    vi.advanceTimersByTime(60);
    expect(seen).toHaveBeenCalledTimes(1);
    // the frame that finally comes finds nothing pending and delivers nothing extra
    frames.forEach((f) => f(0));
    expect(seen).toHaveBeenCalledTimes(1);
    off();
  });

  it("flushAgentNotifications delivers a pending notification synchronously", () => {
    const seen = vi.fn();
    const off = agent.subscribeAgent(seen);
    chunk("z");
    agent.flushAgentNotifications();
    expect(seen).toHaveBeenCalledTimes(1);
    agent.flushAgentNotifications(); // nothing pending → nothing delivered
    expect(seen).toHaveBeenCalledTimes(1);
    off();
  });
});
