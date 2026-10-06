import { describe, expect, it } from "vitest";
import { answersMessage, critiqueFixPrompt, critiquePrompt, findingLine, fixAllMinorPrompt, fixFindingPrompt, lintFixPrompt, resolveBlockerPrompt, skipMessage } from "./design-prompts";
import type { CritiqueRound, Finding, LintReport, Questions } from "./design-review-model";

const f = (over: Partial<Finding>): Finding => ({ rule: "audit:contrast", severity: "severe", text: "Text at 3.2:1 needs 4.5:1", frame: "desktop", file: "frames/desktop.html", ...over });

describe("prompts", () => {
  it("answers list every question by label, then references, then go", () => {
    const q: Questions = { questions: [{ id: "who", label: "Who is buying?", hint: "", type: "multi", options: ["a", "b"], max: 2 }, { id: "feel", label: "How should it feel?", hint: "", type: "single", options: [], max: null }, { id: "extra", label: "Anything to match?", hint: "", type: "text", options: [], max: null }], references: true, answers: null, skipped: false };
    const m = answersMessage(q, { who: ["Gift buyers", "New to specialty"], feel: "Quiet and exact" }, ["refs/shelf-photo.jpg"]);
    expect(m).toBe("Answers to your questions:\n- Who is buying?: Gift buyers, New to specialty\n- How should it feel?: Quiet and exact\n- Anything to match?: (no answer)\nReferences, in this design's refs/ folder:\n- refs/shelf-photo.jpg\nGo ahead.");
    expect(skipMessage()).toBe("Skip the questions. Decide, and say what you assumed.");
  });
  it("lint and finding lines name frame, file, line and selector", () => {
    expect(findingLine(f({ line: 188, selector: "p.lede" }))).toBe("- desktop · frames/desktop.html:188 · p.lede — Text at 3.2:1 needs 4.5:1");
    expect(findingLine(f({}))).toBe("- desktop · frames/desktop.html — Text at 3.2:1 needs 4.5:1");
    // a reviewer's finding, as parseCritique shapes it: no file, a frame and a selector
    expect(fixFindingPrompt({ rule: "critique:ux", severity: "minor", text: "The hero runs long", frame: "mobile", file: "", selector: ".hero p" }))
      .toBe("Fix this and change nothing else:\n- mobile · .hero p — The hero runs long\nSay what you changed in one sentence.");
    const r: LintReport = { v: 1, version: 3, at: "t", ran: true, problem: null, severe: [f({})], minor: [f({ severity: "minor" })] };
    const p = lintFixPrompt(r, 1, 2);
    expect(p.startsWith("Lint fix pass 1 of 2. Fix these and change nothing else:\n- desktop")).toBe(true);
    expect(p.split("\n").filter((l) => l.startsWith("- "))).toHaveLength(1);
    expect(p.endsWith("Say what you changed in one sentence.")).toBe(true);
    expect(fixAllMinorPrompt([f({ severity: "minor" })])).toContain("Fix these minor findings");
  });
  it("the critique prompt names the reviewers, the file, the round and the bar", () => {
    const d = "/p/.chronicle/designs/g";
    const p = critiquePrompt(2, 3, 8.0, 6, [{ frame: "desktop", html: `${d}/frames/desktop.html`, fold: `${d}/.review/captures/desktop.fold.jpg`, full: `${d}/.review/captures/desktop.jpg` }]);
    for (const must of ["art-director", "ux-director", "accessibility", "copy", "critique/round-2.json", "round 2 of 3", "8.0", "in parallel", "never your own reasoning", "\"blocker\"", "one sentence", "description with its reviewer name"]) expect(p).toContain(must);
    expect(p).not.toContain("version\":null");
  });
  it("each reviewer gets a frame's HTML and its two captures, read once, and nothing else", () => {
    const d = "/p/.chronicle/designs/g";
    const p = critiquePrompt(1, 3, 8.0, 6, [
      { frame: "desktop", html: `${d}/frames/desktop.html`, fold: `${d}/.review/captures/desktop.fold.jpg`, full: `${d}/.review/captures/desktop.jpg` },
      { frame: "mobile", html: `${d}/frames/mobile.html`, fold: `${d}/.review/captures/mobile.fold.jpg`, full: `${d}/.review/captures/mobile.jpg` },
    ]);
    expect(p).toContain(`- desktop: ${d}/frames/desktop.html · ${d}/.review/captures/desktop.fold.jpg (the first screen) · ${d}/.review/captures/desktop.jpg (the whole page)`);
    expect(p).toContain(`- mobile: ${d}/frames/mobile.html`);
    expect(p).toContain("nothing else"); expect(p).toContain("reads each of them once");
    expect(p).not.toContain(".png");
  });
  it("the critique fix prompt lists severe first and caps the list", () => {
    const c: CritiqueRound = { round: 1, version: 5, at: "t", bar: 8, weighted: 7.6, passed: false, missing: [], blocker: "The 140 px headline pushes the price down",
      reviewers: [{ id: "ux", score: 7, notes: [], findings: [f({ rule: "critique:ux", severity: "minor", text: "m1" }), f({ rule: "critique:ux", text: "s1", selector: ".buy" })] }, { id: "copy", score: 8, notes: [], findings: Array.from({ length: 10 }, (_, i) => f({ rule: "critique:copy", severity: "minor", text: `c${i}` })) }] };
    const p = critiqueFixPrompt(c);
    expect(p.startsWith("Round 1 scored 7.6 against 8.0.")).toBe(true);
    const lines = p.split("\n").filter((l) => l.startsWith("- "));
    expect(lines).toHaveLength(8); expect(lines[0]).toBe("- UX director · desktop · .buy — s1");
    expect(resolveBlockerPrompt(c.blocker!)).toContain("you may change what the brief asked for");
  });
});
