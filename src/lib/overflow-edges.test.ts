import { describe, expect, it } from "vitest";
import { edgesFor } from "./overflow-edges";

describe("edgesFor", () => {
  it("fades neither end when everything fits", () => {
    expect(edgesFor(0, 400, 400)).toEqual({ left: false, right: false });
    expect(edgesFor(0, 400, 320)).toEqual({ left: false, right: false });
  });

  it("fades only the right at the start of an overflowing strip", () => {
    expect(edgesFor(0, 400, 900)).toEqual({ left: false, right: true });
  });

  it("fades both ends in the middle", () => {
    expect(edgesFor(200, 400, 900)).toEqual({ left: true, right: true });
  });

  it("fades only the left at the end", () => {
    expect(edgesFor(500, 400, 900)).toEqual({ left: true, right: false });
  });

  it("still drops the right fade when sub-pixel layout leaves scrollLeft short", () => {
    // the real case: scrollWidth 900.4, clientWidth 400 — scrollLeft tops out
    // at 500.4 but reports 499.6, which a strict `x < max` would call overflow
    expect(edgesFor(499.6, 400, 900.4).right).toBe(false);
  });

  it("treats a one-pixel overflow as no overflow", () => {
    expect(edgesFor(0, 400, 401)).toEqual({ left: false, right: false });
  });

  it("clamps a scrollLeft past either bound", () => {
    expect(edgesFor(-40, 400, 900)).toEqual({ left: false, right: true });
    expect(edgesFor(9999, 400, 900)).toEqual({ left: true, right: false });
  });
});
