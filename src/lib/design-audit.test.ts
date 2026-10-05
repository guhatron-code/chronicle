import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// The audit runs inside the capture window; its DOM walk is checked live. Its
// arithmetic is checked here by evaluating the script against a stub window.
const src = readFileSync(path.resolve(__dirname, "../../src-tauri/resources/design/audit.js"), "utf8");
const body = src.replace(/^<script>/, "").replace(/<\/script>\s*$/, "");
type Lib = { contrast: (a: number[], b: number[]) => number; parseColor: (s: string) => number[] | null; isLarge: (px: number, weight: number) => boolean; minTarget: (width: number) => number; overCap: (counts: Record<string, number>, rule: string, severity: string) => boolean };
function load(): Lib {
  const win: Record<string, unknown> = {};
  new Function("window", "document", body)(win, undefined);
  return win.__chronicleAuditLib as Lib;
}

describe("the audit's arithmetic", () => {
  const lib = load();
  it("parses rgb, rgba and hex, and measures contrast like WCAG", () => {
    expect(lib.parseColor("rgb(255, 255, 255)")).toEqual([255, 255, 255, 1]);
    expect(lib.parseColor("rgba(0,0,0,0.5)")).toEqual([0, 0, 0, 0.5]);
    expect(lib.parseColor("#1a1a1a")).toEqual([26, 26, 26, 1]);
    expect(lib.parseColor("transparent")).toEqual([0, 0, 0, 0]);
    expect(lib.contrast([255, 255, 255, 1], [0, 0, 0, 1])).toBeCloseTo(21, 1);
    expect(lib.contrast([118, 118, 118, 1], [255, 255, 255, 1])).toBeCloseTo(4.54, 1);
  });
  it("knows large text and the target floor per width", () => {
    expect(lib.isLarge(18, 400)).toBe(true);
    expect(lib.isLarge(17.9, 400)).toBe(false);
    expect(lib.isLarge(14, 700)).toBe(true);
    expect(lib.minTarget(390)).toBe(44);
    expect(lib.minTarget(768)).toBe(44);
    expect(lib.minTarget(769)).toBe(24);
  });
  it("caps findings per rule and severity, so a severe one is never dropped behind twenty minors", () => {
    const counts: Record<string, number> = {};
    const minors = Array.from({ length: 25 }, () => lib.overCap(counts, "contrast", "minor"));
    expect(minors.filter((over) => !over)).toHaveLength(20);
    expect(lib.overCap(counts, "contrast", "severe")).toBe(false);
    expect(lib.overCap(counts, "target", "minor")).toBe(false);
  });
  it("defines the entry point and runs nothing on load", () => {
    const win: Record<string, unknown> = {};
    new Function("window", "document", body)(win, undefined);
    expect(typeof win.__chronicleAudit).toBe("function");
  });
});
