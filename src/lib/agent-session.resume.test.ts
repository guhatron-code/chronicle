/*
 * Resume used to open on an empty thread: resumeAgentSession replayed the
 * old transcript into `entries`, then the Rust side's "installing" state
 * blanked them. Now that state says whether the launch is a resume, and the
 * reducer keeps the thread when it is.
 */
import { describe, expect, it, vi } from "vitest";

type Update = { dir: string; message: { method: string; params?: Record<string, unknown> } };
let onUpdate: ((u: Update) => void) | null = null;
vi.mock("./ipc", () => ({
  onAcpUpdate: vi.fn(async (cb: (u: Update) => void) => { onUpdate = cb; return () => {}; }),
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

const agent = await import("./agent-session");
const DIR = "/p";
const state = (params: Record<string, unknown>) => onUpdate!({ dir: DIR, message: { method: "_chronicle/session_state", params } });

describe("the installing state and the thread", () => {
  it("keeps a replayed thread when the launch is a resume", async () => {
    agent.subscribeAgent(() => {});
    await Promise.resolve();
    const s = agent.agentSessionFor(DIR);
    s.entries = [{ kind: "user", text: "earlier" }, { kind: "assistant", text: "yes", streaming: false }];
    state({ state: "installing", resume: true });
    expect(s.phase).toBe("installing");
    expect(s.entries.map((e) => e.kind)).toEqual(["user", "assistant"]);
  });

  it("still starts a fresh session on a blank thread", async () => {
    agent.subscribeAgent(() => {});
    await Promise.resolve();
    const s = agent.agentSessionFor(DIR);
    s.entries = [{ kind: "user", text: "earlier" }];
    state({ state: "installing" });
    expect(s.entries).toEqual([]);
  });
});
