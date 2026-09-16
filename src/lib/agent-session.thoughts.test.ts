/*
 * Round 9 — the agent's thinking is kept, not dropped. Consecutive
 * `agent_thought_chunk`s merge into one streaming thought entry, exactly as
 * message chunks merge into one assistant entry; anything else that arrives
 * closes it. Replay produces the same entries.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("./ipc", () => ({
  onAcpUpdate: vi.fn(async () => () => {}),
  agentPrompt: vi.fn(), roundRunMessage: vi.fn(), agentSessionStart: vi.fn(),
  roundPlanBegin: vi.fn(), roundPlanCancel: vi.fn(), roundPlanSettle: vi.fn(),
  agentCancel: vi.fn(), agentEdits: vi.fn(), agentHistoryRead: vi.fn(),
  agentSetConfigOption: vi.fn(), agentRespondPermission: vi.fn(), agentSessionResume: vi.fn(),
  agentSessionState: vi.fn(), agentSessionStop: vi.fn(), agentSessionsList: vi.fn(),
  agentSetMode: vi.fn(),
}));
vi.mock("./notes-store", () => ({
  indexFor: () => ({ notes: [], rounds: [], generation: 0, vault: "", borrowed: false }),
  refreshNotes: vi.fn(), roundGenerating: vi.fn(() => false), roundNotesFor: vi.fn(() => []), setRoundGenerating: vi.fn(),
}));
vi.mock("./journal", () => ({ announce: vi.fn() }));
vi.mock("@/overlays/toasts", () => ({ toastAction: vi.fn(), toastError: vi.fn() }));

const { reduceLines } = await import("./agent-session");

const update = (u: Record<string, unknown>) => ({ method: "session/update", params: { update: u } });
const thought = (text: string) => update({ sessionUpdate: "agent_thought_chunk", content: { type: "text", text } });
const message = (text: string) => update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text } });

describe("thoughts", () => {
  it("three chunks become one thought, closed by the message that follows", () => {
    const s = reduceLines("/p", [thought("Let me "), thought("look at "), thought("the code."), message("Here is what I found.")]);
    expect(s.entries).toEqual([
      { kind: "thought", text: "Let me look at the code.", streaming: false },
      { kind: "assistant", text: "Here is what I found.", streaming: false },
    ]);
  });

  it("a thought after a message is a new entry, and a tool call closes a thought too", () => {
    const s = reduceLines("/p", [
      message("One."), thought("Hmm."),
      update({ sessionUpdate: "tool_call", toolCallId: "t", kind: "read", title: "Read", status: "pending" }),
      thought("Again."),
    ]);
    expect(s.entries.map((e) => e.kind)).toEqual(["assistant", "thought", "tool", "thought"]);
    expect(s.entries[1]).toMatchObject({ text: "Hmm.", streaming: false });
    // the last one was still streaming when the lines ran out; replay settles it
    expect(s.entries[3]).toMatchObject({ text: "Again.", streaming: false });
  });
});
