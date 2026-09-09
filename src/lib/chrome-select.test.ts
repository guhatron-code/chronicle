// WebKit refuses NATIVE editing operations inside a contenteditable when an
// ancestor carries `user-select: none` — typing still works, deletion does not.
// A `body { user-select: none }` rule (with the editor opting back in further
// down the tree) therefore reads as "I can't backspace in a note": the opt-in
// does not help, because the whole ancestor chain has to be clean. Unselectable
// chrome is opted in per container with `data-chrome` instead. This pins that,
// so the body-level rule cannot come back on a later pass.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const css = readFileSync(path.resolve(__dirname, "../index.css"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, ""); // comments talk about user-select; rules decide

interface Rule { sel: string; body: string; at: number }
const rules: Rule[] = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
  sel: m[1].trim().replace(/\s+/g, " "),
  body: m[2],
  at: m.index ?? 0,
}));
const selectorsThatBlockSelection = rules
  .filter((r) => /user-select:\s*none/.test(r.body))
  .flatMap((r) => r.sel.split(",").map((s) => s.trim()));

describe("unselectable chrome (index.css)", () => {
  it("never blocks selection at the document level", () => {
    // any of these would sit above the notes editor and take Backspace with it
    for (const sel of selectorsThatBlockSelection) {
      expect(sel).not.toMatch(/^(html|body|#root|:root|\*)$/);
      expect(sel).not.toMatch(/^(html|body|#root)\b/);
    }
  });

  it("opts chrome out per container instead", () => {
    expect(selectorsThatBlockSelection).toContain("[data-chrome]");
  });

  it("lets content opt back in — the rule order the cascade needs", () => {
    const chrome = rules.find((r) => r.sel === "[data-chrome]");
    const optIn = rules.find((r) => /user-select:\s*text/.test(r.body) && r.sel.includes(".ProseMirror"));
    expect(chrome).toBeDefined();
    expect(optIn).toBeDefined();
    // same specificity, so the later rule wins: the opt-in must come second
    expect(chrome!.at).toBeLessThan(optIn!.at);
    for (const s of [".ProseMirror", "input", "textarea", "[data-selectable]", ".xterm"]) {
      expect(optIn!.sel).toContain(s);
    }
  });
});
