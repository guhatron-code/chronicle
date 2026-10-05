import { describe, expect, it, vi } from "vitest";
import { answersFor, renderMarkdown, runDesignBench, type BenchDeps } from "./design-bench";
import { initialReviewState } from "./design-review-model";

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
});
