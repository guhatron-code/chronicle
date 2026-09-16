/*
 * The subagent tree is a VIEW over the flat thread: the reducer keeps entries
 * in wire order, and `groupEntries` folds every call a subagent made under its
 * Task card. Grouping is by id, never by arrival order — a child whose parent's
 * first frame is still streaming lands in the right place.
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

const { groupEntries, reduceLines } = await import("./agent-session");
type Tool = Extract<import("./agent-session").AgentEntry, { kind: "tool" }>;

const tool = (id: string, extra: Partial<Tool> = {}): Tool => ({
  kind: "tool", toolCallId: id, toolKind: "execute", title: id, status: "completed", detail: id, ...extra,
});
const task = (id: string, title = "Do a thing"): Tool => tool(id, { toolKind: "think", title, subagent: true });

const update = (u: Record<string, unknown>) => ({ method: "session/update", params: { update: u } });
const call = (id: string, meta: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  update({ sessionUpdate: "tool_call", toolCallId: id, kind: "execute", title: id, status: "pending", _meta: { claudeCode: meta }, ...extra });

describe("groupEntries", () => {
  it("folds a parent's children under it, in wire order", () => {
    const view = groupEntries([
      { kind: "user", text: "go" }, task("T1"),
      tool("a", { parentId: "T1" }), tool("b", { parentId: "T1" }), tool("c", { parentId: "T1" }),
      { kind: "assistant", text: "done", streaming: false },
    ]);
    expect(view.map((v) => v.kind)).toEqual(["user", "subagent", "assistant"]);
    const g = view[1];
    if (g.kind !== "subagent") throw new Error("expected a subagent group");
    expect(g.tool.toolCallId).toBe("T1");
    expect(g.children.map((c) => c.toolCallId)).toEqual(["a", "b", "c"]);
  });

  it("keeps two interleaved fan-outs apart", () => {
    const view = groupEntries([
      task("T1"), task("T2"), tool("a", { parentId: "T1" }), tool("x", { parentId: "T2" }),
      tool("b", { parentId: "T1" }), tool("y", { parentId: "T2" }),
    ]);
    expect(view).toHaveLength(2);
    const [g1, g2] = view;
    if (g1.kind !== "subagent" || g2.kind !== "subagent") throw new Error("expected two groups");
    expect(g1.children.map((c) => c.toolCallId)).toEqual(["a", "b"]);
    expect(g2.children.map((c) => c.toolCallId)).toEqual(["x", "y"]);
  });

  it("leaves an orphan at the top level, exactly as today", () => {
    const view = groupEntries([task("T1"), tool("stray", { parentId: "NOPE" })]);
    expect(view.map((v) => v.kind)).toEqual(["subagent", "tool"]);
  });

  it("groups a child that arrived before its parent's first frame", () => {
    const view = groupEntries([tool("early", { parentId: "T1" }), task("T1")]);
    expect(view).toHaveLength(1);
    const g = view[0];
    if (g.kind !== "subagent") throw new Error("expected a group");
    expect(g.children.map((c) => c.toolCallId)).toEqual(["early"]);
  });

  it("a Task card that is not a subagent — TodoWrite, ReportFindings — stays a plain think card", () => {
    const view = groupEntries([tool("todo", { toolKind: "think", title: "Update todos" })]);
    expect(view.map((v) => v.kind)).toEqual(["tool"]);
  });
});

describe("the reducer reads the linkage the adapter puts in _meta", () => {
  it("marks a Task call as a subagent and its children with their parent", () => {
    const s = reduceLines("/p", [
      call("T1", { toolName: "Agent", subagent: true }, { kind: "think", title: "Task" }),
      call("a", { toolName: "Bash", parentToolUseId: "T1" }),
      update({ sessionUpdate: "tool_call_update", toolCallId: "T1", title: "Map the code", _meta: { claudeCode: { toolName: "Agent", subagent: true } } }),
    ]);
    const tools = s.entries.filter((e): e is Tool => e.kind === "tool");
    expect(tools[0]).toMatchObject({ toolCallId: "T1", subagent: true, title: "Map the code" });
    expect(tools[1]).toMatchObject({ toolCallId: "a", parentId: "T1" });
    expect("subagent" in tools[1]).toBe(false);
  });

  it("treats a Task by tool name as a subagent even without the flag", () => {
    const s = reduceLines("/p", [call("T2", { toolName: "Task" }, { kind: "think", title: "Task" })]);
    expect(s.entries[0]).toMatchObject({ subagent: true });
  });
});
