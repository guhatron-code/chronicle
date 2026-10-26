/*
 * Every word the run card, the lane view and the notes card say, pinned to the
 * approved boards (design/comps/runs/gen.py). The fixture is board R1; each
 * block patches it into the next board's state.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as M from "./runs-model";

const base = JSON.parse(readFileSync(path.join(__dirname, "__fixtures__/run-record.json"), "utf8")) as M.RunRecord;
const clone = (): M.RunRecord => structuredClone(base);
const lane = (r: M.RunRecord, id: string) => r.lanes.find((l) => l.id === id)!;
const NOW = Date.parse("2026-10-15T09:04:12Z");
const ok = (name: string, ms: number): M.CheckResult => ({ name, exit: 0, ms, timed_out: false, tail: "" });

describe("the run card, working (board R1)", () => {
  const r = clone();
  it("says what the header says", () => {
    expect(M.runTitle(r)).toBe("Round 10 · 7 items");
    expect(M.runWord(r)).toEqual({ word: "running", tone: "neutral", pulse: true });
    expect(M.lanesSummary(r)).toBe("3 of 4 lanes");
    expect(M.fmtCost(r.cost.usd)).toBe("$1.84");
    expect(M.fmtElapsed(M.elapsedMs(r, NOW))).toBe("4m 12s");
  });
  it("words each lane as the board does", () => {
    expect(M.laneWord(r, lane(r, "a")).word).toBe("working");
    expect(M.laneWord(r, lane(r, "c")).word).toBe("being checked");
    expect(M.laneWord(r, lane(r, "d"))).toEqual({ word: "waiting", tone: "dim", pulse: false });
    expect(M.tryLabel(lane(r, "b"))).toBe("try 2 of 3");
    expect(M.tryLabel(lane(r, "a"))).toBeNull();
  });
  it("ends with the quiet sentence and shows the latest decision", () => {
    expect(M.runFooter(r)).toBe("Nothing needs you. Chronicle saves each lane as it passes.");
    expect(M.decisionLine(r)).toEqual({ lead: "Lane B asked to run", command: "npx vitest run src/lib", tail: "— allowed, it reads only.", prob: "0.93" });
    expect(M.planRowText(r, 10, 7)).toBe("Planned round 10 · 7 items into 4 lanes");
    expect(M.planRowText(null, 10, 7)).toBe("Planning round 10 · 7 notes");
    expect(M.planRowText(null, 11, 0)).toBe("Planning round 11");
  });
  it("mirrors into the notes card", () => {
    expect(M.runSubline(r, 1, 7)).toBe("3 lanes working · 1 of 7 done · $1.84");
    expect(M.noteChip(r, "Tasks/T-144.md", "in_progress")).toEqual({ label: "checking", tone: "progress" });
    expect(M.noteChip(r, "Tasks/T-142.md", "in_progress")).toEqual({ label: "working", tone: "progress" });
    expect(M.noteChip(r, "Tasks/T-146.md", "in_progress")).toEqual({ label: "in round", tone: "unknown" });
    expect(M.noteChip(r, "Tasks/T-141.md", "done")).toEqual({ label: "done", tone: "done" });
    expect(M.noteChip(r, "Tasks/elsewhere.md", null)).toBeNull();
  });
  it("draws the lane view's header (board R2)", () => {
    expect(M.laneItemTitles(r, lane(r, "c"))).toBe("Scroll anchoring on a bottom sentinel · content-visibility on off-screen rows");
    expect(M.ownsLabel(r, lane(r, "c"))).toBe("Owns 2 files");
    expect(M.laneDivider(r, lane(r, "c"))).toBe("lane C · being checked");
    expect(M.fmtElapsed(M.laneElapsed(lane(r, "c"), Date.parse("2026-10-15T09:04:12Z")))).toBe("3m 50s");
  });
});

describe("a gate failing, the fix, the final check, the save (board R3)", () => {
  it("a check fails → fixing", () => {
    const r = clone();
    Object.assign(lane(r, "c"), { state: "fixing", fixes: 1, gates: [{ commit: "c1", fix: 0, notice: null, review: null, checks: [
      ok("test", 4200), { name: "typecheck", exit: 2, ms: 2100, timed_out: false, tail: "src/screens/agent/AgentPane.tsx(612,9): error TS2339" }] }] });
    expect(M.laneWord(r, lane(r, "c"))).toEqual({ word: "fixing", tone: "warn", pulse: false });
    expect(M.runFooter(r)).toBe("Lane C’s typecheck failed. It is fixing that now — fix 1 of 2.");
    expect(M.gateLabel("c", lane(r, "c").gates[0], false)).toBe("Lane C · checked after save");
    expect(M.gateLabel("c", lane(r, "c").gates[0], true)).toBe("Checked after save");
    expect(M.checkRows(lane(r, "c").gates[0])).toEqual([
      { name: "test", state: "pass", word: "passed", dur: "4.2 s" },
      { name: "typecheck", state: "fail", word: "failed", dur: "2.1 s" },
    ]);
  });
  it("the fix passes", () => {
    const r = clone();
    Object.assign(lane(r, "a"), { state: "closed", cost_usd: 0.74, ended: "2026-10-15T09:05:00Z" });
    Object.assign(lane(r, "c"), { state: "closed", fixes: 1, ended: "2026-10-15T09:07:00Z", gates: [
      { commit: "c1", fix: 0, notice: null, review: null, checks: [ok("test", 4200), { name: "typecheck", exit: 2, ms: 2100, timed_out: false, tail: "x" }] },
      { commit: "c2", fix: 1, notice: null, review: { model: "review", pass: true, findings: [] }, checks: [ok("test", 4300), ok("typecheck", 2000), ok("build", 9800)] }] });
    Object.assign(lane(r, "d"), { state: "streaming", cost_usd: 0.12 });
    expect(M.runFooter(r)).toBe("Lane C passed on its fix. Two lanes still working.");
    expect(M.gateLabel("c", lane(r, "c").gates[1], false)).toBe("Lane C · fix 1 · checked after save");
    expect(M.reviewLine(lane(r, "c").gates[1].review!)).toBe("Reviewed: looks right");
    expect(M.reviewLine({ model: "review", pass: false, findings: [{ file: "a", line: 1, what: "x" }, { file: "b", line: 2, what: "y" }] })).toBe("Reviewed: 2 findings");
  });
  it("the final check of the whole project, then saved", () => {
    const r = clone();
    r.lanes.forEach((l) => (l.state = "closed"));
    r.state = "gating";
    r.head_pending = ["test", "typecheck", "build", "cargo test"];
    expect(M.runWord(r).word).toBe("final check");
    expect(M.runFooter(r)).toBe("Every lane passed on its own. One last check of the whole project, then it’s saved.");
    expect(M.finalCheckRows(r).map((c) => c.state)).toEqual(["run", "queued", "queued", "queued"]);
    r.state = "done";
    r.head_pending = [];
    r.head_check = { commit: "h", reopened: null, checks: [ok("test", 4400), ok("typecheck", 2100), ok("build", 9900), ok("cargo test", 31000)] };
    expect(M.finalCheckRows(r).map((c) => c.state)).toEqual(["pass", "pass", "pass", "pass"]);
    expect(M.runFooter(r)).toBe("Saved as round 10. 7 items done.");
    expect(M.runWord(r)).toEqual({ word: "done", tone: "success", pulse: false });
  });
  it("the leak notice", () => {
    const r = clone();
    lane(r, "b").state = "closed";
    lane(r, "b").leak = [{ path: "src/index.css", owner: "c", by: null }];
    lane(r, "c").leak = [{ path: "src/index.css", owner: "c", by: "b" }];
    expect(M.leakParts(lane(r, "b").leak[0])).toEqual({ lead: "Also changed ", path: "src/index.css", tail: ", which lane C owns — left unsaved for you." });
    expect(M.leakParts(lane(r, "c").leak[0])).toEqual({ lead: "Lane B also changed ", path: "src/index.css", tail: ", which this lane owns — left unsaved for you." });
    expect(M.leakParts({ path: "NOTES.txt", owner: null, by: null }).tail).toBe(", which no lane owns — left unsaved for you.");
    expect(M.runFooter(r)).toBe("Lane B also touched a file lane C owns. That change is left unsaved and listed above; nothing is undone for you.");
  });
});

describe("needs you (board R4)", () => {
  const r = clone();
  r.state = "needs-you";
  r.lanes.forEach((l) => (l.state = "closed"));
  Object.assign(lane(r, "a"), { cost_usd: 0.74, commit: "a1" });
  Object.assign(lane(r, "d"), { attempt: 2, cost_usd: 0.41 });
  r.cost.usd = 2.52;
  r.needs_you = [
    { kind: "parked", lane: "d", item: "T-147", reason: "The pane starts the session when it mounts. Starting it when the project opens needs a hook in src/App.tsx, which this lane doesn’t own.", reading: 0.86 },
    { kind: "refused", lane: "a", item: null, reason: "npm publish", reading: null },
  ];
  it("words the lane and the run", () => {
    expect(M.laneWord(r, lane(r, "d"))).toEqual({ word: "needs you", tone: "warn", pulse: false });
    expect(M.runWord(r).word).toBe("needs you");
    expect(M.runFooter(r)).toBe("One thing needs you: an item in lane D can’t be done as written. The other six are saved.");
  });
  it("draws the two rows with their buttons", () => {
    const [parked, refused] = M.needsYouRows(r);
    expect(parked).toMatchObject({ title: "Pre-warm the session when the project opens", reading: "0.86",
      body: "Lane D: “The pane starts the session when it mounts. Starting it when the project opens needs a hook in src/App.tsx, which this lane doesn’t own.”" });
    expect(parked.actions.map((a) => a.label)).toEqual(["Rewrite the item", "Skip it"]);
    expect(refused).toMatchObject({ title: "The agent tried to publish. Chronicle doesn’t publish for you.", body: "Lane A, after its last save. Nothing left your Mac." });
    expect(refused.actions.map((a) => a.label)).toEqual(["Open the lane"]);
  });
  it("mirrors into the notes card and tells an away user", () => {
    expect(M.runSubline(r, 6, 7)).toBe("needs you · 3 lanes saved · 6 of 7 done · $2.52");
    expect(M.noteChip(r, "Tasks/T-147.md", "in_progress")).toEqual({ label: "needs you", tone: "queued" });
    expect(M.transitionNotice(clone(), r)).toBe("Round 10 needs you.");
    expect(M.transitionNotice(r, r)).toBeNull();
  });
});

describe("the edges the boards don't draw", () => {
  it("formats time and counts", () => {
    expect(M.fmtElapsed(42_000)).toBe("42s");
    expect(M.fmtElapsed(65_000)).toBe("1m 05s");
    expect(M.fmtElapsed(3_780_000)).toBe("1h 03m");
    expect(M.countWord(2)).toBe("two");
    expect(M.countWord(14)).toBe("14");
  });
  it("says why a run stopped, failed or was interrupted", () => {
    const r = clone();
    r.state = "interrupted";
    expect(M.runWord(r).word).toBe("interrupted");
    expect(M.runFooter(r)).toBe("Chronicle stopped while this round was running. Resume picks up the lanes that hadn’t finished.");
    r.state = "stopped";
    expect(M.runFooter(r)).toBe("Stopped. Nothing was undone; each lane’s unsaved changes are listed in its thread.");
    r.state = "failed";
    r.planner_error = "- Item T-3 isn't in any lane.";
    expect(M.runFooter(r)).toBe("The plan couldn’t be split into lanes: - Item T-3 isn't in any lane.");
    expect(M.runOver(r)).toBe(true);
  });
  it("a planner that never declared a lane map says what it said instead", () => {
    const r = clone();
    r.state = "failed";
    r.planner_error = "I could not find a way to split this.";
    expect(M.runFooter(r)).toBe("The plan couldn’t be split into lanes: I could not find a way to split this.");
    r.planner_error = null;
    expect(M.runFooter(r)).toBe("The plan couldn’t be split into lanes.");
  });
  it("an exhausted lane and a failed final check each say what to do", () => {
    const r = clone();
    r.state = "needs-you";
    r.needs_you = [{ kind: "exhausted", lane: "d", item: null, reason: "Lane D didn’t finish after three tries.", reading: null }];
    expect(M.runFooter(r)).toBe("One thing needs you: lane D didn’t finish after three tries.");
    expect(M.needsYouRows(r)[0].actions.map((a) => a.label)).toEqual(["Try the lane again", "Open the lane"]);
    r.needs_you = [{ kind: "head", lane: null, item: null, reason: "`build` failed (exit 1)", reading: null }];
    expect(M.needsYouRows(r)[0]).toMatchObject({ title: "The whole-project check failed after every lane passed.", mono: "`build` failed (exit 1)" });
    expect(M.needsYouRows(r)[0].actions.map((a) => a.label)).toEqual(["Check again"]);
  });
});

describe("the lane view and the plan row's own words (Task 14 selectors)", () => {
  it("the plan row says planning, planned, stopped or didn't start, and waits for the pane", () => {
    const r = clone();
    expect(M.planRowState(r, { n: 10, total: 7 })).toBe("planned");
    expect(M.planRowLine(r, { n: 10, total: 7 })).toBe("Planned round 10 · 7 items into 4 lanes");
    expect(M.planRowState(null, { n: 11, total: 3 })).toBe("planning");
    expect(M.planRowLine(null, { n: 11, total: 3, queued: true })).toBe("Planning round 11 · 3 notes · waiting for the pane");
    expect(M.planRowState(null, { n: 11, total: 3, outcome: "cancelled" })).toBe("failed");
    expect(M.planRowLine(null, { n: 11, total: 3, outcome: "cancelled" })).toBe("Round 11 · stopped before the lanes were planned");
    expect(M.planRowLine(null, { n: 11, total: 3, outcome: "failed" })).toBe("Round 11 didn’t start");
    const f = clone();
    f.lane_map = null;
    f.state = "failed";
    f.planner_error = null;
    expect(M.planRowLine(f, { n: 10, total: 7, outcome: "failed" })).toBe("The plan couldn’t be split into lanes.");
  });
  it("a needs-you row takes its lane's word, or the run's", () => {
    const r = clone();
    r.state = "needs-you";
    r.needs_you = [{ kind: "parked", lane: "d", item: "T-147", reason: "x", reading: 0.86 }];
    expect(M.needsWord(r, "d")).toEqual({ word: "needs you", tone: "warn", pulse: false });
    expect(M.needsWord(r, null)).toEqual({ word: "needs you", tone: "warn", pulse: false });
    expect(M.needsWord(r, "zz").word).toBe("needs you");
  });
  it("a stopped lane says its changes are still there; any other lane says nothing", () => {
    const r = clone();
    expect(M.stoppedLaneLine(lane(r, "a"))).toBeNull();
    lane(r, "a").state = "cancelled";
    expect(M.stoppedLaneLine(lane(r, "a"))).toBe("Stopped. This lane’s unsaved changes are still in your project.");
  });
  it("the guard's decision line says what ran, why, the option, the model and the band", () => {
    const decision = { choice: "allow", confidence: 0.934, model: "haiku", band: "high" };
    expect(M.guardLine({ allowed: true, path: "npx vitest run src/lib", reason: "it reads only.", decision })).toEqual({
      lead: "Ran", path: "npx vitest run src/lib", tail: " — allowed, it reads only.", meta: "allow · haiku · high", prob: "0.93",
    });
    expect(M.guardLine({ allowed: false, path: "git push", reason: "", decision: { ...decision, choice: "deny" } })).toMatchObject({
      lead: "Didn’t run", tail: ".", meta: "deny · haiku · high",
    });
    expect(M.guardLine({ allowed: false, path: "x", reason: "outside the folder" })).toBeNull();
  });
});
