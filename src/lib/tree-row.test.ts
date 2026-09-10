import { describe, expect, it } from "vitest";
import { marqueeDistance, needsMarquee, rowNameStyle, treeBarOffset } from "./tree-row";

describe("rows never wrap", () => {
  it("marquees only when the name really overflows", () => {
    expect(needsMarquee(200, 120)).toBe(true);
    expect(needsMarquee(120, 120)).toBe(false);
    expect(needsMarquee(122, 120)).toBe(false); // a 2px rounding wobble is not an overflow
    expect(marqueeDistance(200, 120)).toBe(80);
    expect(marqueeDistance(100, 120)).toBe(0);
  });
});

describe("rowNameStyle", () => {
  it("always truncates and never wraps", () => {
    for (const [sw, cw, hov] of [[100, 120, false], [200, 120, true], [200, 120, false]] as const) {
      expect(rowNameStyle(sw, cw, hov).className).toContain("whitespace-nowrap");
      expect(rowNameStyle(sw, cw, hov).className).toContain("text-ellipsis");
    }
  });
  it("marquees only on hover, only when it overflows, and carries the distance", () => {
    expect(rowNameStyle(200, 120, true)).toEqual({
      className: "min-w-0 flex-1 overflow-hidden whitespace-nowrap text-ellipsis note-marquee",
      style: { "--marquee": "80px" },
    });
    expect(rowNameStyle(200, 120, false).className).not.toContain("note-marquee");
    expect(rowNameStyle(122, 120, true).className).not.toContain("note-marquee");
    expect(rowNameStyle(100, 120, true).style).toEqual({});
  });
});

describe("treeBarOffset", () => {
  it("hangs a top-level row's bar into the scroller's px-2, and a nested one past the guide", () => {
    expect(treeBarOffset(0)).toBe("-left-2");
    expect(treeBarOffset(1)).toBe("-left-[11px]");
    expect(treeBarOffset(4)).toBe("-left-[11px]");
  });
});

describe("marquee pace", () => {
  it("takes longer for a longer overflow, never under the floor", async () => {
    const { marqueeDuration, rowNameStyle } = await import("./tree-row");
    expect(marqueeDuration(20)).toBe(4.5);
    expect(marqueeDuration(400)).toBeGreaterThan(marqueeDuration(200));
    expect(marqueeDuration(400)).toBeCloseTo(400 / 40 / 0.43, 1);
    expect(rowNameStyle(600, 200, true).style["--marquee-dur"]).toBe(`${marqueeDuration(400).toFixed(2)}s`);
  });
});
