/*
 * Every agent's probe turn, as Rust hands it to the pane (`_chronicle`
 * stamped, `agent` on ready), replays through the ONE reducer. The reducer
 * reads no agent's own namespace: an agent with no parent pointer gives a
 * flat tool list, and the session knows which agent it is.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("./ipc", () => ({
  agentsAvailable: vi.fn(async () => ({ claude: null, codex: null, default: "", project: "claude-acp", launchable: false })),
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

const { groupEntries, reduceLines } = await import("./agent-session");
type Raw = Record<string, any>;

const dir = path.join(__dirname, "__fixtures__");
const agents = readdirSync(dir).filter((f) => /^acp-.+\.jsonl$/.test(f) && !f.endsWith(".raw.jsonl")).map((f) => f.slice(4, -6));
const read = (id: string): Raw[] => readFileSync(path.join(dir, `acp-${id}.jsonl`), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));

describe("every probed agent replays through the reducer", () => {
  it("has a fixture for at least Claude Code", () => {
    expect(agents).toContain("claude-acp");
  });

  for (const id of agents) {
    describe(id, () => {
      const lines = read(id);
      const s = reduceLines("/Users/me/chronicle-probe", lines);
      const calls = lines.filter((l) => l.method === "session/update" && l.params.update.sessionUpdate === "tool_call");

      it("knows which agent it is", () => {
        expect(s.agent).toBe(id);
      });

      it("makes one tool row per tool call, in wire order", () => {
        const tools = s.entries.filter((e) => e.kind === "tool");
        expect(tools.map((t) => (t as Raw).toolCallId)).toEqual(calls.map((c) => c.params.update.toolCallId));
      });

      it("links a call to a parent exactly when Rust stamped one", () => {
        for (const c of calls) {
          const entry = s.entries.find((e) => e.kind === "tool" && (e as Raw).toolCallId === c.params.update.toolCallId) as Raw;
          expect(entry.parentId).toBe(c.params.update._chronicle.parentId);
        }
        if (calls.every((c) => !c.params.update._chronicle.parentId && !c.params.update._chronicle.subagent)) {
          expect(groupEntries(s.entries).some((i) => i.kind === "subagent")).toBe(false);
        }
      });

      it("keeps every permission ask as a card", () => {
        const asks = lines.filter((l) => l.method === "session/request_permission").length;
        expect(s.entries.filter((e) => e.kind === "perm")).toHaveLength(asks);
      });
    });
  }
});

describe("the reducer reads no agent's own namespace", () => {
  it("ignores a claudeCode parent that Rust did not stamp", () => {
    const s = reduceLines("/p", [
      { method: "session/update", params: { update: { sessionUpdate: "tool_call", toolCallId: "a", title: "a", kind: "execute", status: "pending",
        _meta: { claudeCode: { parentToolUseId: "T1", toolName: "Bash" } }, _chronicle: { agent: "codex-acp" } } } },
    ]);
    expect("parentId" in s.entries[0]).toBe(false);
  });
});

describe("a history replay that passes a ready line", () => {
  const ready = { method: "_chronicle/session_state", params: { state: "ready", sessionId: "s1", agent: "codex-acp", modes: null, agentCaps: null } };
  const text = { method: "session/update", params: { update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "hi" } } } };

  it("reads the agent off the ready line, twice over for a resumed thread", () => {
    const s = reduceLines("/p", [ready, text, ready]);
    expect(s.agent).toBe("codex-acp");
    expect(s.entries.filter((e) => e.kind === "assistant")).toHaveLength(1);
  });

  it("does not make the live session look live: viewing history leaves phase and agent alone", async () => {
    const ipc = await import("./ipc");
    (ipc.agentHistoryRead as any).mockResolvedValue({ lines: [ready, text, ready] });
    const { agentSessionFor, viewAgentSession } = await import("./agent-session");
    const dir = "/view-only";
    await viewAgentSession(dir, "old");
    const live = agentSessionFor(dir);
    expect(live.phase).toBe("none");
    expect(live.agent).toBe("claude-acp");
    expect(live.viewing?.entries.length).toBeGreaterThan(0);
  });
});
