/*
 * Rows are memoised by signature, not by object identity, because the reducer
 * mutates entries in place (a streamed chunk appends to the last entry). The
 * signature must move when anything the row draws moves, and stay put otherwise.
 */
import { describe, expect, it } from "vitest";
import { rowKeys, rowSignature, touch } from "./thread-rows";
import type { AgentEntry, ThreadItem } from "./agent-session";

const tool = (id: string, extra: Partial<Extract<AgentEntry, { kind: "tool" }>> = {}): Extract<AgentEntry, { kind: "tool" }> =>
  ({ kind: "tool", toolCallId: id, title: id, toolKind: "other", status: "in_progress", rev: 0, ...extra }) as Extract<AgentEntry, { kind: "tool" }>;

describe("rowSignature", () => {
  it("moves when a streamed chunk lands on an assistant row", () => {
    const e: AgentEntry = { kind: "assistant", text: "hel", streaming: true, rev: 0 };
    const a = rowSignature(e);
    e.text += "lo";
    touch(e);
    expect(rowSignature(e)).not.toBe(a);
  });
  it("stays put when nothing about the row changed", () => {
    const e: AgentEntry = { kind: "assistant", text: "done", streaming: false, rev: 3 };
    expect(rowSignature(e)).toBe(rowSignature(e));
  });
  it("moves for a subagent group when a child changes, and when a child arrives", () => {
    const parent = tool("t1", { subagent: true });
    const child = tool("t2", { parentId: "t1" });
    const group: ThreadItem = { kind: "subagent", tool: parent, children: [child] };
    const a = rowSignature(group);
    child.status = "completed"; touch(child);
    const b = rowSignature(group);
    expect(b).not.toBe(a);
    group.children.push(tool("t3", { parentId: "t1" }));
    expect(rowSignature(group)).not.toBe(b);
  });
});

describe("rowKeys", () => {
  it("keys follow identity where the wire gives one and the n-th of its kind otherwise", () => {
    const items: ThreadItem[] = [
      { kind: "user", text: "a", rev: 0 } as AgentEntry,
      tool("t1"),
      { kind: "assistant", text: "b", streaming: false, rev: 0 },
      { kind: "assistant", text: "c", streaming: false, rev: 0 },
    ];
    expect(rowKeys(items)).toEqual(["user:1", "tool:t1", "assistant:1", "assistant:2"]);
  });
});
