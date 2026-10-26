/*
 * The replay harness for runs, as round 9's was for subagents: a run's records
 * fed through the store in order, the card's words read at each one; and a
 * lane's transcript fed through the one reducer, the lane view's rows counted.
 * The fixtures are excerpts recorded from the live check (Task 18): run-10.jsonl
 * is five moments of toy runs 3 (running, a review-triggered fix, a lane closed
 * on its fix) and 2 (needs-you, done); run-lane.jsonl is toy run 1's lane B,
 * trimmed. Numbers here follow the recording, on purpose only.
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

describe("a run's records replay into the card, moment by moment", () => {
  const updates = read("run-10.jsonl") as { dir: string; record: RunRecord }[];
  const at = (i: number) => { store.ingest(updates[i].dir, updates[i].record); return store.runFor(updates[i].dir, updates[i].record.n)!; };
  it("keeps the fixture honest", () => {
    expect(updates).toHaveLength(5);
    expect(updates.map((u) => [u.record.n, u.record.state])).toEqual([[3, "running"], [3, "running"], [3, "running"], [2, "needs-you"], [2, "done"]]);
  });
  it("keeps cost equal to the planner plus the lanes, as Rust's total_cost does", () => {
    for (const { record: r } of updates) {
      const usd = r.planner_cost_usd + r.lanes.reduce((a, l) => a + l.cost_usd, 0);
      expect(r.cost.usd).toBeCloseTo(usd, 2);
      expect(r.cost.in).toBe(r.lanes.reduce((a, l) => a + l.tokens.in, 0));
      expect(r.cost.out).toBe(r.lanes.reduce((a, l) => a + l.tokens.out, 0));
    }
  });
  it("R1 · working", () => {
    const r = at(0);
    expect(M.runTitle(r)).toBe("Round 3 · 5 items");
    expect(M.runFooter(r)).toBe("Nothing needs you. Chronicle saves each lane as it passes.");
    expect(M.lanesSummary(r)).toBe("1 of 2 lanes");
    expect(M.fmtCost(r.cost.usd)).toBe("$1.87");
  });
  it("R3.1 · a review finds problems → fixing", () => {
    const r = at(1);
    expect(M.runFooter(r)).toBe("Lane A’s review found problems. It is fixing that now — fix 1 of 2.");
    expect(M.fmtCost(r.cost.usd)).toBe("$3.01");
  });
  it("R3.2 · the fix passes", () => {
    const r = at(2);
    expect(M.runFooter(r)).toBe("Lane A passed on its fix. One lane still working.");
    expect(M.lanesSummary(r)).toBe("2 of 2 lanes");
    expect(M.fmtCost(r.cost.usd)).toBe("$3.75");
  });
  it("R4 · two parked items need you", () => {
    const r = at(3);
    expect(M.runWord(r).word).toBe("needs you");
    // The recording also shows a copy bug in needsFooter: with no item saved it reads
    // "The other no are saved." (countWord(0)); reported, not asserted.
    expect(M.runFooter(r)).toMatch(/^Two things need you\./);
    expect(M.fmtCost(r.cost.usd)).toBe("$2.08");
  });
  it("R3.4 · done after the parked items were skipped", () => {
    const r = at(4);
    expect(M.runFooter(r)).toBe("Saved as round 2. 0 items done, 2 skipped.");
    expect(M.finalCheckRows(r).map((c) => c.name)).toEqual(["test"]);
    expect(M.fmtElapsed(M.elapsedMs(r, Date.now()))).toBe("14m 12s");
  });
});

describe("a lane's transcript replays into the lane view (board R2)", () => {
  const s = reduceLines("/home/u/proj#w/1-1", read("run-lane.jsonl"));
  const items = groupEntries(s.entries);
  it("opens with Chronicle's instruction and the lane's own words", () => {
    expect(items[0]).toMatchObject({ kind: "user", text: "You are lane B of round 1: Rename check, changelog, publish." });
    expect(items[1]).toMatchObject({ kind: "assistant", text: expect.stringContaining("I'll read the plan, then handle the rename") });
  });
  it("has no subagent in this recording, so nothing folds", () => {
    expect(items.some((e) => e.kind === "subagent")).toBe(false);
  });
  it("keeps Chronicle's answers as guard rows — judged and refused", () => {
    const guards = s.entries.filter((e) => e.kind === "guard");
    expect(guards).toHaveLength(8);
    expect(guards[0]).toMatchObject({ allowed: true, decision: { choice: "allow", band: "second-opinion" } });
    const pr = (guards[0] as { decision?: { probabilities: Record<string, number> } }).decision!.probabilities; // float32 values, as recorded
    expect([pr.allow, pr.confirm, pr.refuse].map((x) => Math.round(x * 100))).toEqual([96, 4, 0]);
    expect(guards[1]).toMatchObject({ allowed: false, reason: "it wasn’t clear the command stays inside the lane’s files", decision: { band: "strict" } });
    expect(guards[6]).toMatchObject({ allowed: false, reason: "Chronicle doesn’t publish for you." });
  });
  it("shows the rest as tool cards, in order — the block calls among them", () => {
    const ids = s.entries.filter((e) => e.kind === "tool").map((e) => (e.kind === "tool" ? e.toolCallId : ""));
    expect(ids).toHaveLength(16);
    expect(ids.slice(0, 3)).toEqual(["toolu_011xUWub4RUuAieaFXJBkYvf", "toolu_011T25gbkQpg8HTFo2grTfpg", "toolu_012Tq7HzaPPrNrf2PxRwg7sB"]);
    expect(ids).toContain("toolu_01A99xCRvJhz22afwdiVgphU");
  });
});
