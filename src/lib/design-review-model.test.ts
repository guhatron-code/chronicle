import { describe, expect, it } from "vitest";
import { blockerOf, clampSettings, fixedSummary, fmtScore, initialReviewState, parseCritique, parseLint, parseQuestions, parseReviewState, parseSettings, parseTokens, questionsPending, reviewerForTitle, stateWord, weightedScore, DEFAULT_SETTINGS } from "./design-review-model";

describe("review settings", () => {
  it("defaults, clamps to the half and the ranges", () => {
    expect(parseSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings({ bar: 9.75, rounds: 9, critique: false })).toEqual({ critique: false, bar: 9.5, rounds: 5, lint: true });
    expect(clampSettings({ critique: true, bar: 7.25, rounds: 0, lint: true })).toEqual({ critique: true, bar: 7.0, rounds: 1, lint: true });
  });
});

describe("questions", () => {
  it("keeps at most five well-formed questions and drops duplicates", () => {
    const raw = { v: 1, references: true, questions: [
      { id: "who", label: "Who is buying?", hint: "shapes copy", type: "multi", options: ["Regulars", 3, "Gift buyers"], max: 2 },
      { id: "who", label: "dup" }, { label: "no id" }, { id: "feel", label: "How should it feel?", type: "weird" },
      { id: "q3", label: "3" }, { id: "q4", label: "4" }, { id: "q5", label: "5" }, { id: "q6", label: "6" },
    ] };
    const q = parseQuestions(raw)!;
    expect(q.questions.map((x) => x.id)).toEqual(["who", "feel", "q3", "q4", "q5"]);
    expect(q.questions[0]).toEqual({ id: "who", label: "Who is buying?", hint: "shapes copy", type: "multi", options: ["Regulars", "Gift buyers"], max: 2 });
    expect(q.questions[1].type).toBe("single");
    expect(q.references).toBe(true);
    expect(questionsPending(q)).toBe(true);
    expect(questionsPending(parseQuestions({ questions: [] }))).toBe(false);
    expect(questionsPending(parseQuestions({ questions: [{ id: "a", label: "A" }], answers: { a: "x" } }))).toBe(false);
    expect(questionsPending(parseQuestions({ questions: [{ id: "a", label: "A" }], skipped: true }))).toBe(false);
    expect(parseQuestions("nope")).toBeNull();
    expect(parseQuestions({ questions: "nope" })).toBeNull();
  });
});

describe("tokens, lint", () => {
  it("parses a token plan and a lint report and rejects junk", () => {
    const t = parseTokens({ colors: [{ name: "ink", value: "#1a1a1a" }, { name: 3 }], type: [{ role: "display", family: "Bricolage Grotesque", weight: 700, size: 22, leading: 1.1 }], rejected: ["cream + serif"] })!;
    expect(t.colors).toEqual([{ name: "ink", value: "#1a1a1a" }]);
    expect(t.type[0]).toEqual({ role: "display", family: "Bricolage Grotesque", weight: "700", size: "22", leading: "1.1" });
    expect(parseTokens(null)).toBeNull();
    const l = parseLint({ v: 1, version: 3, at: "t", ran: false, problem: "no node", severe: [{ rule: "audit:overflow", severity: "severe", text: "wide", frame: "m", file: "frames/m.html" }], minor: [] })!;
    expect(l.ran).toBe(false); expect(l.problem).toBe("no node"); expect(l.severe).toHaveLength(1);
    expect(parseLint({})).toBeNull();
  });
});

describe("critique", () => {
  it("recomputes the weighted score and ignores the file's verdict", () => {
    const { weighted, missing } = weightedScore({ ux: 6, art: 8, a11y: 9, copy: 7 });
    expect(weighted).toBeCloseTo(7.35, 2); expect(missing).toEqual([]);
    expect(weightedScore({ ux: 12, art: -1 })).toEqual({ weighted: 3.5, missing: ["a11y", "copy"] });
    const c = parseCritique({ round: 9, version: 4, weighted: 9.9, passed: true, bar: 1, reviewers: [
      { id: "ux", score: 6, notes: ["n"], findings: [{ severity: "bad", text: "x", frame: "desktop", selector: ".p" }] },
      { id: "art", score: 8 }, { id: "a11y", score: 9 }, { id: "copy", score: 7 } ], blocker: null }, 8.0, 2)!;
    expect(c.round).toBe(2); expect(c.bar).toBe(8); expect(c.weighted).toBeCloseTo(7.35, 2); expect(c.passed).toBe(false);
    expect(c.reviewers[0].findings[0]).toEqual({ rule: "critique:ux", severity: "minor", text: "x", frame: "desktop", file: "", selector: ".p" });
    expect(parseCritique({ reviewers: "x" }, 8, 1)).toBeNull();
    const pass = parseCritique({ reviewers: [{ id: "ux", score: 8.5 }, { id: "art", score: 8 }, { id: "a11y", score: 8 }, { id: "copy", score: 8 }] }, 8.0, 1)!;
    expect(pass.weighted).toBeCloseTo(8.18, 2); expect(pass.passed).toBe(true);
  });
  it("shows a score to one decimal when exact, two when rounding would cross the bar", () => {
    expect(fmtScore(8)).toBe("8.0"); expect(fmtScore(7.5)).toBe("7.5"); expect(fmtScore(10)).toBe("10.0");
    expect(fmtScore(7.95)).toBe("7.95"); expect(fmtScore(7.68)).toBe("7.68");
    expect(fmtScore(weightedScore({ ux: 7.5, art: 8.5, a11y: 7.5, copy: 8.5 }).weighted)).toBe("7.95");
  });
  it("sums the fixed findings to three short ones, severe first, and counts the rest", () => {
    const f = (severity: "severe" | "minor", text: string) => ({ rule: "critique:ux", severity, text, frame: "desktop", file: "", selector: "" });
    expect(fixedSummary([])).toBe("");
    expect(fixedSummary([f("minor", "Tighten the hero. It runs long and the eye wanders."), f("severe", "Buttons lack focus rings!")]))
      .toBe("Buttons lack focus rings, Tighten the hero");
    const long = f("minor", "A".repeat(100));
    expect(fixedSummary([f("minor", "one"), f("minor", "two"), long, f("minor", "four"), f("minor", "five")]))
      .toBe(`one, two, ${"A".repeat(79)}… and 2 more`);
  });
  it("scores a round written with the agents' own names", () => {
    const c = parseCritique({ reviewers: [
      { id: "art-director", score: 8 }, { id: "ux-director", score: 9 }, { id: "accessibility", score: 8 }, { id: "copy", score: 8 } ] }, 8.0, 1)!;
    expect(c.reviewers.map((r) => r.id).sort()).toEqual(["a11y", "art", "copy", "ux"]);
    expect(c.missing).toEqual([]);
    expect(c.weighted).toBeCloseTo(8.35, 2); expect(c.passed).toBe(true);
    expect(c.reviewers.find((r) => r.id === "art")!.findings).toEqual([]);
  });
  it("never passes a round with a reviewer missing", () => {
    const c = parseCritique({ reviewers: [{ id: "ux", score: 10 }, { id: "art", score: 10 }, { id: "a11y", score: 10 }] }, 8.0, 1)!;
    expect(c.weighted).toBeCloseTo(8.5, 2);
    expect(c.missing).toEqual(["copy"]);
    expect(c.passed).toBe(false);
  });
});

describe("state", () => {
  it("parses, defaults and words each phase", () => {
    expect(parseReviewState(undefined)).toEqual(initialReviewState());
    expect(parseReviewState({ v: 1, phase: "nonsense", round: 2 }).phase).toBe("idle");
    expect(parseReviewState({ v: 1, phase: "building", round: 0, prior: { phase: "done", round: 2, best: { round: 2, score: 8.4 }, accepted: true, startedAt: 7 } }).prior)
      .toEqual({ phase: "done", round: 2, fixPass: 0, best: { round: 2, score: 8.4 }, accepted: true, startedAt: 7 });
    expect(parseReviewState({ v: 1, phase: "building", prior: "junk" }).prior).toBeNull();
    const s = (phase: ReturnType<typeof initialReviewState>["phase"]) => ({ ...initialReviewState(), phase });
    expect(stateWord(s("questions"), null, null)).toEqual({ word: "draft", tone: "faint" });
    expect(stateWord(s("building"), 2, null).word).toBe("working");
    expect(stateWord(s("gate"), 2, null).word).toBe("checking");
    expect(stateWord(s("fixing"), 2, null)).toEqual({ word: "fixing", tone: "warn" });
    expect(stateWord(s("critique"), 2, null).word).toBe("in review");
    expect(stateWord(s("done"), 6, 8.4)).toEqual({ word: "ready · 8.4", tone: "success" });
    expect(stateWord(s("done"), 6, null)).toEqual({ word: "v6", tone: "faint" });
    expect(stateWord(s("below-bar"), 6, 7.7)).toEqual({ word: "below the bar", tone: "warn" });
    expect(stateWord(s("stopped"), 5, null)).toEqual({ word: "stopped · v5", tone: "faint" });
    expect(stateWord(s("idle"), null, null)).toEqual({ word: "draft", tone: "faint" });
  });
});

describe("reviewerForTitle", () => {
  it("finds the reviewer named at the start of a subagent's title", () => {
    expect(reviewerForTitle("Art director review")).toBe("art");
    expect(reviewerForTitle("UX director critique")).toBe("ux");
    expect(reviewerForTitle("ux-director: review v6")).toBe("ux");
    expect(reviewerForTitle("art_director: review v6")).toBe("art");
    expect(reviewerForTitle("[accessibility] review v6")).toBe("a11y");
    expect(reviewerForTitle("(Copy) review")).toBe("copy");
    expect(reviewerForTitle("Copy: review v6")).toBe("copy");
    expect(reviewerForTitle("Accessibility  review")).toBe("a11y");
    expect(reviewerForTitle("Accessibility check")).toBe("a11y");
    expect(reviewerForTitle("Art director audit")).toBe("art");
    expect(reviewerForTitle("UX director")).toBe("ux");
  });
  it("misses titles that only mention a name, or run it into a longer word", () => {
    expect(reviewerForTitle("Copy frames for review")).toBeNull();
    expect(reviewerForTitle("Copywriting pass")).toBeNull();
    expect(reviewerForTitle("Review with the art director")).toBeNull();
    expect(reviewerForTitle("Render captures")).toBeNull();
  });
});

describe("blockerOf", () => {
  const f = (text: string, severity: "severe" | "minor" = "minor") => ({ rule: "critique:ux", severity, text, frame: "d", file: "" });
  const round = (n: number, findings: ReturnType<typeof f>[], blocker: string | null = null, id: "ux" | "art" = "ux") =>
    ({ round: n, version: n + 1, at: "t", bar: 8, weighted: 7, passed: false, reviewers: [{ id, score: 7, notes: [], findings }], missing: [], blocker });
  it("takes the most recent round's blocker sentence over everything", () => {
    expect(blockerOf([round(1, [f("cramped")], "Two heroes"), round(2, [f("cramped")])])).toEqual({ text: "Two heroes", reviewer: null, why: "blocker" });
    expect(blockerOf([round(1, [], "old"), round(2, [], "new")])!.text).toBe("new");
  });
  it("else a finding the last two rounds share, else the first severe, else the first", () => {
    expect(blockerOf([round(1, [f("Cramped ")]), round(2, [f("loud", "severe"), f("cramped")], null, "art")])).toEqual({ text: "cramped", reviewer: "art", why: "repeated" });
    expect(blockerOf([round(1, [f("cramped")]), round(2, [f("quiet"), f("loud", "severe")])])).toEqual({ text: "loud", reviewer: "ux", why: "severe" });
    expect(blockerOf([round(1, [f("quiet"), f("plain")])])).toEqual({ text: "quiet", reviewer: "ux", why: "first" });
    expect(blockerOf([round(1, [])])).toBeNull();
    expect(blockerOf([])).toBeNull();
  });
});
