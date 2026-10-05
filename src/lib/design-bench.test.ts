import { describe, expect, it, vi } from "vitest";
import { answersFor, BENCH_SETTINGS, MAX_ANSWERS, refusalFor, renderMarkdown, runDesignBench, type BenchDeps, type Brief } from "./design-bench";
import { initialReviewState, type Questions, type ReviewState } from "./design-review-model";

describe("the benchmark runner", () => {
  it("runs the filtered briefs through the loop, answers questions, judges the compared ones, and summarises", async () => {
    const phases: Record<string, "done" | "below-bar"> = { "app-1": "done", "ecommerce-1": "below-bar" };
    const state = { review: initialReviewState(), questions: null as unknown, lint: null as unknown, active: "x" };
    const deps: BenchDeps = {
      briefs: async () => [{ id: "app-1", kind: "app", title: "A", brief: "brief-app", answers: [], quick: true }, { id: "ecommerce-1", kind: "ecommerce", title: "E", brief: "brief-ecom", answers: [["who", "Gift buyers"]], quick: true }, { id: "deck-1", kind: "deck", title: "D", brief: "brief-deck", answers: [], quick: false }],
      project: async () => "/bench/p", open: vi.fn(async () => {}), setSettings: vi.fn(async () => {}),
      startDesign: vi.fn(async (_d, _k, _b) => "slug"),
      answer: vi.fn(async () => {}),
      waitSettled: vi.fn(async (_d, _s) => ({ ...initialReviewState(), phase: phases[currentId], round: 2, best: { round: 2, score: phases[currentId] === "done" ? 8.4 : 7.7 } })),
      state: () => state as never,
      judge: vi.fn(async () => ({ winner: "A" as const, reasons: ["r1", "r2", "r3"] })),
      referenceCaptures: async (_r, id) => (id === "app-1" ? ["/ref/a.png"] : null),
      write: vi.fn(async () => {}), version: "0.12.0", now: (() => { let t = 0; return () => (t += 1000); })(),
    };
    let currentId = "";
    deps.startDesign = vi.fn(async (_d, _k, b) => { currentId = b === "brief-app" ? "app-1" : "ecommerce-1"; return "slug"; });
    const r = await runDesignBench(deps, "/repo", { quick: true });
    expect(r.briefs.map((b) => b.id)).toEqual(["app-1", "ecommerce-1"]);
    expect(r.briefs[0]).toMatchObject({ passed: true, score: 8.4, rounds: 2, compared: { winner: expect.stringMatching(/chronicle|claude-design/), reasons: ["r1", "r2", "r3"] } });
    expect(r.briefs[1]).toMatchObject({ passed: false, score: 7.7, compared: null });
    expect(deps.write).toHaveBeenCalledWith("/repo", expect.stringMatching(/^0\.12\.0-\d{4}-\d{2}-\d{2}/), expect.any(Object), expect.stringContaining("1 of 2 passed the bar"));
    expect(renderMarkdown(r)).toContain("mean score 8.1");
  });

  it("answers a brief's questions by id, then label, else the first option; a multi gets one answer", () => {
    const brief = { id: "x", kind: "app", title: "X", brief: "b", answers: [["who", "Gift buyers"], ["How should it feel?", "Quiet"]] as [string, string][], quick: true };
    const q = (id: string, label: string, type: "single" | "multi" | "text", options: string[]) => ({ id, label, hint: "", type, options, max: null });
    const a = answersFor(brief, { questions: [q("who", "Who?", "single", ["a"]), q("feel", "How should it feel?", "multi", ["Loud"]), q("where", "Where?", "single", ["Phone", "Desk"])], references: false, answers: null, skipped: false });
    expect(a).toEqual({ who: "Gift buyers", feel: ["Quiet"], where: "Phone" });
  });

  it("matches an answer key that is a whole word of the question's id or label, and a text question with no match has no preference", () => {
    const brief = { id: "x", kind: "app", title: "X", brief: "b", answers: [["who", "Gift buyers"], ["feel", "Quiet"], ["system", "None"]] as [string, string][], quick: true };
    const q = (id: string, label: string, type: "single" | "multi" | "text", options: string[]) => ({ id, label, hint: "", type, options, max: null });
    const a = answersFor(brief, { questions: [
      q("audience", "Who is this for?", "single", ["Everyone"]),
      q("tone_feel", "Tone", "multi", ["Bold"]),
      q("design-system", "Existing styles", "single", ["Yes"]),
      q("whom", "Whomever", "single", ["First"]),
      q("notes", "Anything else?", "text", []),
    ], references: false, answers: null, skipped: false });
    expect(a).toEqual({ audience: "Gift buyers", tone_feel: ["Quiet"], "design-system": "None", whom: "First", notes: "No preference, decide for me." });
  });
});

describe("the benchmark runner, beyond the happy path", () => {
  const brief = (id: string, quick = true): Brief => ({ id, kind: id.split("-")[0], title: id, brief: `brief-${id}`, answers: [["who", "Gift buyers"]], quick });
  const settled = (over: Partial<ReviewState> = {}): ReviewState => ({ ...initialReviewState(), phase: "done", round: 1, best: { round: 1, score: 8.5 }, ...over });
  const pending: Questions = { questions: [{ id: "who", label: "Who?", hint: "", type: "single", options: ["a"], max: null }], references: false, answers: null, skipped: false };
  function make(over: Partial<BenchDeps> = {}, briefs = [brief("app-1"), brief("deck-1")]) {
    const state = { review: initialReviewState(), questions: null as Questions | null, lint: null, active: "slug" };
    const deps: BenchDeps = {
      briefs: async () => briefs, project: async () => "/bench/p", open: vi.fn(async () => {}), setSettings: vi.fn(async () => {}),
      startDesign: vi.fn(async (_d, _k, b: string) => b.replace("brief-", "")),
      answer: vi.fn(async () => {}), waitSettled: vi.fn(async () => settled()), state: () => state as never,
      judge: vi.fn(async () => ({ winner: "A" as const, reasons: ["r"] })),
      referenceCaptures: async (_r, id) => (id === "app-1" ? ["/judge/ref/1.png"] : null),
      capture: vi.fn(async () => ["/bench/p/ours.png"]),
      write: vi.fn(async () => {}), version: "0.12.0", now: () => 0, random: () => 0.1,
      ...over,
    };
    return { deps, state };
  }

  it("sets the bench settings on the project it opened", async () => {
    const { deps } = make();
    await runDesignBench(deps, "/repo", {});
    expect(deps.open).toHaveBeenCalledWith("/bench/p");
    expect(deps.setSettings).toHaveBeenCalledWith("/bench/p", BENCH_SETTINGS);
  });

  it("answers pending questions from the brief and waits again", async () => {
    const { deps, state } = make({}, [brief("app-1")]);
    let calls = 0;
    deps.waitSettled = vi.fn(async () => {
      calls += 1;
      state.questions = calls === 1 ? pending : null;
      return calls === 1 ? settled({ phase: "questions", best: null }) : settled();
    });
    const r = await runDesignBench(deps, "/repo", {});
    expect(deps.answer).toHaveBeenCalledTimes(1);
    expect(deps.answer).toHaveBeenCalledWith("/bench/p", { who: "Gift buyers" }, []);
    expect(deps.waitSettled).toHaveBeenCalledTimes(2);
    expect(r.briefs[0]).toMatchObject({ passed: true, score: 8.5 });
  });

  it("stops answering after the cap, and a brief stuck on questions hasn't passed", async () => {
    const { deps, state } = make({}, [brief("app-1")]);
    state.questions = pending;
    deps.waitSettled = vi.fn(async () => settled({ phase: "questions", best: null }));
    const r = await runDesignBench(deps, "/repo", {});
    expect(deps.answer).toHaveBeenCalledTimes(MAX_ANSWERS);
    expect(r.briefs[0]).toMatchObject({ phase: "questions", passed: false, score: null });
  });

  it("judges exactly once, only the brief with a reference, and maps the winner back through the random side", async () => {
    for (const [random, winner, chronicleWas, expected] of [[0.1, "A", "A", "chronicle"], [0.9, "A", "B", "claude-design"], [0.9, "B", "B", "chronicle"], [0.1, "B", "A", "claude-design"]] as const) {
      const { deps } = make({ random: () => random, judge: vi.fn(async () => ({ winner, reasons: ["r"] })) });
      const r = await runDesignBench(deps, "/repo", {});
      expect(deps.judge).toHaveBeenCalledTimes(1);
      const [, b, a, bb] = vi.mocked(deps.judge).mock.calls[0];
      expect(b.id).toBe("app-1");
      expect(chronicleWas === "A" ? [a, bb] : [bb, a]).toEqual([["/bench/p/ours.png"], ["/judge/ref/1.png"]]);
      expect(r.briefs[0].compared).toEqual({ winner: expected, reasons: ["r"], chronicleWas });
      expect(r.briefs[1].compared).toBeNull();
    }
  });

  it("keeps a brief's score when the judge throws, and says why the comparison is missing", async () => {
    const { deps } = make({ judge: vi.fn(async () => { throw new Error("The judge didn't answer in time."); }) });
    const r = await runDesignBench(deps, "/repo", {});
    expect(r.briefs[0]).toMatchObject({ score: 8.5, passed: true, compared: { error: "The judge didn't answer in time." } });
    expect(r.briefs[0].error).toBeUndefined();
    expect(r.summary).toMatchObject({ passed: 2, compared: 0, beat: 0 });
    expect(renderMarkdown(r)).toContain("couldn't compare");
  });

  it("records a reference that didn't render without calling the judge", async () => {
    const { deps } = make({ referenceCaptures: async (_r, id) => (id === "app-1" ? [] : null) });
    const r = await runDesignBench(deps, "/repo", {});
    expect(deps.judge).not.toHaveBeenCalled();
    expect(r.briefs[0].compared).toEqual({ error: "reference didn't render" });
  });

  it("records a brief that throws and carries on with the rest", async () => {
    const { deps } = make();
    deps.startDesign = vi.fn(async (_d, _k, b: string) => { if (b === "brief-app-1") throw new Error("boom"); return "deck-1"; });
    const r = await runDesignBench(deps, "/repo", {});
    expect(r.briefs.map((b) => [b.id, b.error ?? null, b.passed])).toEqual([["app-1", "boom", false], ["deck-1", null, true]]);
    expect(deps.write).toHaveBeenCalledTimes(1);
    expect(renderMarkdown(r)).toContain("Method: both sides were rendered by Chronicle's capture window");
  });

  it("refuses a permission ask no one is there for, counts it, and carries on to the result", async () => {
    const { deps } = make({}, [brief("deck-1")]);
    let calls = 0;
    deps.waitSettled = vi.fn(async () => (++calls === 1 ? settled({ phase: "building", best: null }) : settled()));
    deps.refuse = vi.fn(async () => 1);
    const r = await runDesignBench(deps, "/repo", {});
    expect(deps.refuse).toHaveBeenCalledWith("/bench/p", "deck-1");
    expect(r.briefs[0]).toMatchObject({ refused: 1, passed: true, score: 8.5 });
    expect(r.summary.refused).toBe(1);
    expect(renderMarkdown(r)).toContain("Commands refused: 1");
    expect(renderMarkdown(r)).toMatch(/\| deck-1 \|.*\| 1 \| — \|/);
  });

  it("stops waiting when a mid-loop return has nothing to refuse", async () => {
    const { deps } = make({}, [brief("deck-1")]);
    deps.waitSettled = vi.fn(async () => settled({ phase: "critique", best: null }));
    deps.refuse = vi.fn(async () => 0);
    const r = await runDesignBench(deps, "/repo", {});
    expect(deps.refuse).toHaveBeenCalledTimes(1);
    expect(r.briefs[0]).toMatchObject({ refused: 0, passed: false, phase: "critique" });
  });

  it("refuses with the first reject_once option, or cancels", () => {
    expect(refusalFor([{ optionId: "allow", kind: "allow_once" }, { optionId: "no", kind: "reject_once" }, { optionId: "never", kind: "reject_always" }])).toBe("no");
    expect(refusalFor([{ optionId: "allow", kind: "allow_once" }])).toBeNull();
  });
});
