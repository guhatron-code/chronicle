/*
 * The pane moves with one easing and two durations, defined once. This pins
 * the tokens and the rule that everything goes through them — read from the
 * stylesheet as text, since there is no DOM here.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../index.css", import.meta.url), "utf8");

describe("motion tokens", () => {
  it("defines the easing and the two durations once, on :root", () => {
    expect(css).toMatch(/--ease-pane:\s*cubic-bezier\(0?\.2,\s*0?\.8,\s*0?\.2,\s*1\)/);
    expect(css).toMatch(/--dur-fast:\s*140ms/);
    expect(css).toMatch(/--dur-slow:\s*260ms/);
    expect(css.match(/--dur-fast:/g)?.length).toBe(2); // :root and the reduced-motion override
  });
  it("the pane's moves use the tokens, not literal durations", () => {
    const block = css.slice(css.indexOf("/* The agent pane's motion"), css.indexOf("@keyframes wv-spin"));
    expect(block).toContain("var(--dur-slow)");
    expect(block).toContain("var(--ease-pane)");
    expect(block).not.toMatch(/\b\d{3}ms\b/);
  });
  it("reduced motion zeroes both durations", () => {
    const rm = css.slice(css.lastIndexOf("@media (prefers-reduced-motion: reduce)"));
    expect(rm).toMatch(/--dur-fast:\s*0ms/);
    expect(rm).toMatch(/--dur-slow:\s*0ms/);
  });
});
