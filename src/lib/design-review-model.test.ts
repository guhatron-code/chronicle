import { describe, expect, it } from "vitest";
import { clampSettings, initialReviewState, parseCritique, parseLint, parseQuestions, parseReviewState, parseSettings, parseTokens, questionsPending, reviewerForTitle, stateWord, weightedScore, DEFAULT_SETTINGS } from "./design-review-model";

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
});

describe("state", () => {
  it("parses, defaults and words each phase", () => {
    expect(parseReviewState(undefined)).toEqual(initialReviewState());
    expect(parseReviewState({ v: 1, phase: "nonsense", round: 2 }).phase).toBe("idle");
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
