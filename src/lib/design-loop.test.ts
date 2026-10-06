import { describe, expect, it } from "vitest";
import { afterTurn, MAX_LINT_PASSES, onAccept, onSend, onStop, resumeAfterRestart, type TurnResult } from "./design-loop";
import { DEFAULT_SETTINGS, initialReviewState, knownRounds, type CritiqueRound, type LintReport, type ReviewSettings } from "./design-review-model";

const lint = (severe: number): LintReport => ({ v: 1, version: 1, at: "t", ran: true, problem: null, severe: Array.from({ length: severe }, (_, i) => ({ rule: `r${i}`, severity: "severe", text: "x", frame: "d", file: "frames/d.html" })), minor: [] });
const crit = (weighted: number, bar = 8): CritiqueRound => ({ round: 1, version: 1, at: "t", bar, weighted, passed: weighted >= bar, reviewers: [], missing: [], blocker: null });
const turn = (over: Partial<TurnResult>): TurnResult => ({ version: 2, questionsPending: false, lint: null, critique: null, cancelled: false, critiqued: false, ...over });
const S: ReviewSettings = DEFAULT_SETTINGS;

describe("the review loop", () => {
  it("brief → questions → answers → gate fix → critique → fix → critique → done, one version per step", () => {
    let st = onSend(initialReviewState(), "brief", 1000);
    expect(st.phase).toBe("building"); expect(st.startedAt).toBe(1000);
    let r = afterTurn(st, S, turn({ version: null, questionsPending: true }));
    expect(r.next).toEqual({ kind: "questions" }); expect(r.state.phase).toBe("questions");
    st = onSend(r.state, "answers", 2000);
    r = afterTurn(st, S, turn({ version: 1, lint: lint(1) }));
    expect(r.next).toEqual({ kind: "send", prompt: "lintFix" }); expect(r.state).toMatchObject({ phase: "fixing", fixPass: 1, version: 1 });
    st = onSend(r.state, "lintFix", 3000);
    r = afterTurn(st, S, turn({ version: 2, lint: lint(0) }));
    expect(r.next).toEqual({ kind: "send", prompt: "critique" }); expect(r.state).toMatchObject({ phase: "critique", round: 1, fixPass: 0, version: 2 });
    st = onSend(r.state, "critique", 4000); expect(st.phase).toBe("critique");
    r = afterTurn(st, S, turn({ version: null, critique: crit(7.6) }));
    expect(r.next).toEqual({ kind: "send", prompt: "critiqueFix" }); expect(r.state).toMatchObject({ phase: "building", round: 1, best: { round: 1, score: 7.6 } });
    st = onSend(r.state, "critiqueFix", 5000);
    r = afterTurn(st, S, turn({ version: 3, lint: lint(0) }));
    expect(r.state).toMatchObject({ phase: "critique", round: 2 });
    r = afterTurn(onSend(r.state, "critique", 6000), S, turn({ version: null, critique: { ...crit(8.4), round: 2 } }));
    expect(r.next).toEqual({ kind: "done" }); expect(r.state).toMatchObject({ phase: "done", best: { round: 2, score: 8.4 } });
  });
  it("lint fixes stop after two passes and the findings ride into the critique", () => {
    let st = onSend(initialReviewState(), "user", 0);
    let r = afterTurn(st, S, turn({ lint: lint(2) })); expect(r.next).toEqual({ kind: "send", prompt: "lintFix" });
    r = afterTurn(onSend(r.state, "lintFix", 0), S, turn({ lint: lint(2) })); expect(r.next).toEqual({ kind: "send", prompt: "lintFix" }); expect(r.state.fixPass).toBe(MAX_LINT_PASSES);
    r = afterTurn(onSend(r.state, "lintFix", 0), S, turn({ lint: lint(2) })); expect(r.next).toEqual({ kind: "send", prompt: "critique" });
  });
  it("below the bar after the last round, and accept", () => {
    let st = { ...initialReviewState(), phase: "critique" as const, round: 3, best: { round: 2, score: 7.7 } };
    const r = afterTurn(st, { ...S, rounds: 3 }, turn({ version: null, critique: { ...crit(7.6), round: 3 } }));
    expect(r.next).toEqual({ kind: "belowBar" }); expect(r.state.best).toEqual({ round: 2, score: 7.7 });
    expect(onAccept(r.state)).toMatchObject({ phase: "done", accepted: true });
  });
  it("lint off and critique off short-circuit; a cancelled turn stops", () => {
    const r1 = afterTurn(onSend(initialReviewState(), "user", 0), { ...S, lint: false }, turn({ lint: lint(3) }));
    expect(r1.next).toEqual({ kind: "send", prompt: "critique" });
    const r2 = afterTurn(onSend(initialReviewState(), "user", 0), { ...S, critique: false }, turn({ lint: lint(0) }));
    expect(r2.next).toEqual({ kind: "done" }); expect(r2.state.phase).toBe("done");
    const r3 = afterTurn(onSend(initialReviewState(), "critique", 0), S, turn({ cancelled: true }));
    expect(r3.next).toEqual({ kind: "stopped" }); expect(onStop(r3.state).phase).toBe("stopped");
  });
  it("a critique turn that wrote no round file does not pass and does not hang", () => {
    const r = afterTurn({ ...initialReviewState(), phase: "critique", round: 1 }, S, turn({ version: null, critique: null }));
    expect(r.next).toEqual({ kind: "critiqueMissing" }); expect(r.state.phase).toBe("critique");
  });
  it("a fix turn that changed nothing falls through instead of looping on the same lint", () => {
    const st = { ...onSend(initialReviewState(), "lintFix", 0), fixPass: 1, version: 4 };
    const r = afterTurn(st, S, turn({ version: null, lint: null }));
    expect(r.next).toEqual({ kind: "send", prompt: "critique" }); expect(r.state.version).toBe(4);
  });
  it("a lint fix pass runs in the fixing phase and keeps its pass count", () => {
    const st = onSend({ ...initialReviewState(), phase: "fixing", fixPass: 1, version: 1 }, "lintFix", 0);
    expect(st).toMatchObject({ phase: "fixing", fixPass: 1, lastPrompt: "lintFix" });
    expect(onSend(st, "critiqueFix", 0).phase).toBe("building");
  });
  it("a user message during done starts a fresh attempt", () => {
    const st = onSend({ ...initialReviewState(), phase: "done", round: 3, best: { round: 3, score: 8.2 }, accepted: true }, "user", 9);
    expect(st).toMatchObject({ phase: "building", round: 0, fixPass: 0, best: null, accepted: false, startedAt: 9 });
  });
  it("a chat reply that changed nothing never re-critiques", () => {
    const rested = { ...initialReviewState(), phase: "done" as const, round: 2, version: 5, best: { round: 2, score: 8.4 }, accepted: true, startedAt: 7 };
    const st = onSend(rested, "user", 9);
    expect(st).toMatchObject({ phase: "building", round: 0, prior: { phase: "done", round: 2, best: { round: 2, score: 8.4 }, accepted: true, startedAt: 7 } });
    // no version cut, v5 already has its round: done stays done, as it was
    const r = afterTurn(st, S, turn({ version: null, critiqued: true }));
    expect(r.next).toEqual({ kind: "wait" });
    expect(r.state).toMatchObject({ phase: "done", round: 2, version: 5, best: { round: 2, score: 8.4 }, accepted: true, startedAt: 7, prior: null });
    // below the bar and stopped come back the same way
    for (const phase of ["below-bar", "stopped"] as const) {
      const back = afterTurn(onSend({ ...rested, phase, accepted: false }, "user", 9), S, turn({ version: null, critiqued: true }));
      expect(back.state.phase).toBe(phase); expect(back.next).toEqual({ kind: "wait" });
    }
    // a reply that cut a version is a fresh attempt; one on a version never critiqued still gets its critique
    expect(afterTurn(st, S, turn({ version: 6, lint: lint(0), critiqued: true })).next).toEqual({ kind: "send", prompt: "critique" });
    expect(afterTurn(st, S, turn({ version: null, critiqued: false })).next).toEqual({ kind: "send", prompt: "critique" });
    // a message sent mid-loop has nothing to come back to
    expect(onSend({ ...rested, phase: "building" }, "user", 9).prior).toBeNull();
    // the attempt's rounds count the one set aside, so the round files still load
    expect(knownRounds(st)).toBe(2);
  });
  it("restart resumes at the gate, or asks again for a missing critique", () => {
    expect(resumeAfterRestart({ ...initialReviewState(), phase: "fixing" }, true).next).toEqual({ kind: "wait" });
    const r = resumeAfterRestart({ ...initialReviewState(), phase: "fixing", version: 3 }, false);
    expect(r.state.phase).toBe("gate"); expect(r.next).toEqual({ kind: "regate" });
    expect(resumeAfterRestart({ ...initialReviewState(), phase: "critique" }, false).next).toEqual({ kind: "critiqueMissing" });
    expect(resumeAfterRestart({ ...initialReviewState(), phase: "done" }, false).next).toEqual({ kind: "wait" });
  });
});
