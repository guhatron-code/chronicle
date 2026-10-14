/*
 * Rows are memoised by signature, not by object identity, because the reducer
 * mutates entries in place (a streamed chunk appends to the last entry). The
 * signature must move when anything the row draws moves, and stay put otherwise.
 */
import { describe, expect, it } from "vitest";
import { rowKeys, rowSignature, sameRow, touch } from "./thread-rows";
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

describe("sameRow", () => {
  it("two distinct entries with equal signatures are not the same row (resume/view replace the array)", () => {
    const a: AgentEntry = { kind: "user", text: "old", rev: 0 } as AgentEntry;
    const b: AgentEntry = { kind: "user", text: "new", rev: 0 } as AgentEntry;
    expect(sameRow({ sig: rowSignature(a), entry: a }, { sig: rowSignature(b), entry: b })).toBe(false);
  });
  it("the same object with an equal signature is the same row", () => {
    const a: AgentEntry = { kind: "assistant", text: "x", streaming: false, rev: 2 };
    expect(sameRow({ sig: rowSignature(a), entry: a }, { sig: rowSignature(a), entry: a })).toBe(true);
  });
  it("a moved signature is never the same row", () => {
    const a: AgentEntry = { kind: "assistant", text: "x", streaming: false, rev: 2 };
    expect(sameRow({ sig: "a", entry: a }, { sig: "b", entry: a })).toBe(false);
  });
  it("two rebuilt groups with the same tool object and equal signature are the same row; a different tool is not", () => {
    const parent = tool("t1", { subagent: true });
    const g1: ThreadItem = { kind: "subagent", tool: parent, children: [] };
    const g2: ThreadItem = { kind: "subagent", tool: parent, children: [] };
    const g3: ThreadItem = { kind: "subagent", tool: tool("t1", { subagent: true }), children: [] };
    const sig = rowSignature(g1);
    expect(sameRow({ sig, entry: g1 }, { sig, entry: g2 })).toBe(true);
    expect(sameRow({ sig, entry: g1 }, { sig, entry: g3 })).toBe(false);
  });
});
