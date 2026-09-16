/*
 * The replay harness: one real pane session, recorded by the app itself,
 * fed through the ONE reducer with nothing live. The fixture is an excerpt of
 * session f31438d3-cb94-4472-8983-720cf5c5ff96 (2026-09-16, the turn that
 * planned round 9): the user message, two Task fan-outs (`subagent: true`,
 * two distinct `parentToolUseId`s), the first four child calls under each,
 * three thought chunks, six message chunks, one rate-limit `usage_update`,
 * the end-of-turn `usage_update` with `cost`, and the turn end. Everything
 * else was dropped; home paths became /home/u, long texts were cut to their
 * first sentence, big rawInput/rawOutput bodies became {"_trimmed":true}.
 *
 * What it asserts is the shape the reducer produces TODAY. Items that change
 * the reducer update these numbers on purpose, never by accident.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
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

const DIR = "/home/u/proj";
const lines = readFileSync(path.join(__dirname, "__fixtures__/agent-fanout.jsonl"), "utf8")
  .split("\n").filter(Boolean).map((l) => JSON.parse(l) as unknown);

describe("a recorded fan-out session replays through the reducer", () => {
  const s = reduceLines(DIR, lines);
  const tools = s.entries.filter((e) => e.kind === "tool");

  it("keeps the fixture honest: the turn it came from is intact", () => {
    expect(lines.length).toBeLessThanOrEqual(400);
    expect((lines[0] as { method: string }).method).toBe("_chronicle/user_message");
    expect((lines.at(-1) as { method: string }).method).toBe("_chronicle/turn_end");
  });

  it("starts with the user's message", () => {
    expect(s.entries[0]?.kind).toBe("user");
  });

  it("yields ten tool cards: two Task fan-outs and the eight calls their subagents made", () => {
    expect(tools).toHaveLength(10);
    const tasks = tools.filter((t) => t.toolKind === "think");
    expect(tasks.map((t) => t.title)).toEqual(["Map agent session pipeline", "Map notes subsystem"]);
    expect(tools.filter((t) => t.toolKind === "execute")).toHaveLength(8);
  });

  it("knows which calls belong to which subagent, and the view folds them under their Task", () => {
    const tasks = tools.filter((t) => t.subagent);
    expect(tasks).toHaveLength(2);
    const view = groupEntries(s.entries);
    const groups = view.filter((v) => v.kind === "subagent");
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => (g.kind === "subagent" ? g.children.length : -1))).toEqual([4, 4]);
    // nothing a subagent did is left lying in the main transcript
    expect(view.filter((v) => v.kind === "tool")).toHaveLength(0);
  });

  it("keeps the agent's thinking: the fixture's three chunks are one thought entry", () => {
    const thoughts = s.entries.filter((e) => e.kind === "thought");
    expect(thoughts).toHaveLength(1);
    expect(thoughts[0]).toMatchObject({ streaming: false });
    expect((thoughts[0] as { text: string }).text.length).toBeGreaterThan(20);
  });

  it("ends with the last context reading", () => {
    expect(s.usage).toEqual({ used: 245376, size: 1000000 });
  });
});
