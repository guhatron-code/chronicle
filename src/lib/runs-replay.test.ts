/*
 * The replay harness for runs, as round 9's was for subagents: a run's records
 * fed through the store in order, the card's words read at each one; and a
 * lane's transcript fed through the one reducer, the lane view's rows counted.
 * The fixtures are hand-built to the boards until the live check (Task 18)
 * replaces them with recorded excerpts; numbers here change on purpose only.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { RunRecord } from "./runs-model";

vi.mock("./runs-ipc", () => ({
  onRunUpdate: vi.fn(async () => () => {}), runsList: vi.fn(async () => []),
  runBegin: vi.fn(), runPlanSettle: vi.fn(), runPlanCancel: vi.fn(), runResume: vi.fn(),
}));
vi.mock("./ipc", () => ({
  notifyNative: vi.fn(), agentsAvailable: vi.fn(async () => ({ claude: null, codex: null, default: "" })), onAcpUpdate: vi.fn(async () => () => {}),
  agentPrompt: vi.fn(), roundRunMessage: vi.fn(), agentSessionStart: vi.fn(), roundPlanBegin: vi.fn(), roundPlanCancel: vi.fn(), roundPlanSettle: vi.fn(),
  agentCancel: vi.fn(), agentEdits: vi.fn(), agentHistoryRead: vi.fn(), agentSetConfigOption: vi.fn(), agentRespondPermission: vi.fn(),
  agentSessionResume: vi.fn(), agentSessionState: vi.fn(), agentSessionStop: vi.fn(), agentSessionsList: vi.fn(), agentSetMode: vi.fn(), designOutsideFiles: vi.fn(),
}));
vi.mock("./notes-store", () => ({
  indexFor: () => ({ notes: [], rounds: [], generation: 0, vault: "", borrowed: false }),
  refreshNotes: vi.fn(), roundGenerating: vi.fn(() => false), roundNotesFor: vi.fn(() => []), setRoundGenerating: vi.fn(),
}));
vi.mock("./journal", () => ({ announce: vi.fn() }));
vi.mock("@/overlays/toasts", () => ({ toastAction: vi.fn(), toastError: vi.fn() }));

const store = await import("./runs-store");
const M = await import("./runs-model");
const { groupEntries, reduceLines } = await import("./agent-session");
const read = (f: string) => readFileSync(path.join(__dirname, "__fixtures__", f), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));

describe("a run's records replay into the card, board by board", () => {
  const updates = read("run-10.jsonl") as { dir: string; record: RunRecord }[];
  const at = (i: number) => { store.ingest(updates[i].dir, updates[i].record); return store.runFor(updates[i].dir, 10)!; };
  it("keeps the fixture honest", () => {
    expect(updates).toHaveLength(5);
    expect(updates.map((u) => u.record.state)).toEqual(["running", "running", "running", "gating", "done"]);
  });
  it("R1 · working", () => {
    const r = at(0);
    expect(M.runFooter(r)).toBe("Nothing needs you. Chronicle saves each lane as it passes.");
    expect(M.lanesSummary(r)).toBe("3 of 4 lanes");
  });
  it("R3.1 · a check fails → fixing", () => {
    expect(M.runFooter(at(1))).toBe("Lane C’s typecheck failed. It is fixing that now — fix 1 of 2.");
  });
  it("R3.2 · the fix passes", () => {
    const r = at(2);
    expect(M.runFooter(r)).toBe("Lane C passed on its fix. Two lanes still working.");
    expect(M.fmtCost(r.cost.usd)).toBe("$2.02");
  });
  it("R3.3 · the final check", () => {
    const r = at(3);
    expect(M.runWord(r).word).toBe("final check");
    expect(M.finalCheckRows(r).map((c) => c.name)).toEqual(["test", "typecheck", "build", "cargo test"]);
  });
  it("R3.4 · saved", () => {
    const r = at(4);
    expect(M.runFooter(r)).toBe("Saved as round 10. 7 items done.");
    expect(M.fmtElapsed(M.elapsedMs(r, Date.now()))).toBe("11m 40s");
  });
});

describe("a lane's transcript replays into the lane view (board R2)", () => {
  const s = reduceLines("/home/u/proj#w/10-2", read("run-lane.jsonl"));
  const items = groupEntries(s.entries);
  it("opens with Chronicle's instruction and the lane's own words", () => {
    expect(items[0]).toMatchObject({ kind: "user", text: "You are lane C of round 10: Scroll anchoring." });
    expect(items[1]).toMatchObject({ kind: "assistant" });
  });
  it("folds the subagent's three calls under its card", () => {
    const sub = items.find((e) => e.kind === "subagent");
    expect(sub && sub.kind === "subagent" ? sub.children.map((c) => c.toolCallId) : []).toEqual(["c4", "c5", "c6"]);
  });
  it("keeps Chronicle's two answers as guard rows — one judged, one refused", () => {
    const guards = s.entries.filter((e) => e.kind === "guard");
    expect(guards).toHaveLength(2);
    expect(guards[0]).toMatchObject({ allowed: true, decision: { confidence: 0.88 } });
    expect(guards[1]).toMatchObject({ allowed: false, reason: "Chronicle commits for you" });
  });
  it("shows the rest as tool cards, in order", () => {
    expect(s.entries.filter((e) => e.kind === "tool").map((e) => (e.kind === "tool" ? e.toolCallId : ""))).toEqual(["c1", "c2", "c3", "c4", "c5", "c6", "c8"]);
  });
});
