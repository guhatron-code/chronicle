import { describe, it, expect } from "vitest";
import { parseDesign, placeFrames, readingOrder, orderRows, type DesignRow } from "./design-model";

const raw = {
  v: 1, title: "Home", kind: "ecommerce", brief: "b", created: "t",
  frames: [
    { id: "desktop", file: "frames/desktop.html", label: "Desktop", width: 1440, height: 900, group: "bp" },
    { id: "mobile", file: "frames/mobile.html", label: "Mobile", width: 390, height: 844, group: "bp" },
    { id: "a", file: "frames/a.html", label: "A", width: 1440, height: 720, group: "hero" },
    { id: "broken" },
  ],
  groups: [{ id: "bp", label: "Breakpoints", kind: "breakpoints" }, { id: "hero", label: "Hero", kind: "variations" }],
  chosen: null,
};

describe("design model", () => {
  it("parses and drops broken frames", () => {
    const d = parseDesign(raw)!;
    expect(d.frames.map((f) => f.id)).toEqual(["desktop", "mobile", "a"]);
    expect(parseDesign({ ...raw, kind: "poster" })).toBeNull();
    expect(parseDesign("nope")).toBeNull();
  });
  it("places groups in rows, keeps stored positions, and uses reported heights", () => {
    const d = parseDesign(raw)!;
    const r = placeFrames(d, { mobile: { x: 5000, y: 10 } }, { desktop: 2600 });
    expect(r.desktop).toEqual({ x: 0, y: 0, w: 1440, h: 2600 });
    expect(r.mobile).toEqual({ x: 5000, y: 10, w: 390, h: 844 });
    expect(r.a.y).toBeGreaterThanOrEqual(2600 + 120);
  });
  it("doesn't let a moved frame push the row below it down", () => {
    const moved = {
      v: 1, title: "Moved", kind: "app", brief: "", created: "",
      frames: [
        { id: "tall", file: "frames/tall.html", label: "Tall", width: 400, height: 2000, group: "g1" },
        { id: "next", file: "frames/next.html", label: "Next", width: 400, height: 300, group: "g2" },
      ],
      groups: [{ id: "g1", label: "G1", kind: "variations" }, { id: "g2", label: "G2", kind: "variations" }],
      chosen: null,
    };
    const d = parseDesign(moved)!;
    // "tall" is the only frame in g1 and it has a stored position (dragged away),
    // so g1 contributes no row height: g2 should start at y = 0, not 2000 + 120.
    const r = placeFrames(d, { tall: { x: 9000, y: 9000 } }, {});
    expect(r.next.y).toBe(0);
  });
  it("orders frames top to bottom, left to right", () => {
    expect(readingOrder({ b: { x: 900, y: 0 }, a: { x: 0, y: 0 }, c: { x: 0, y: 1000 } })).toEqual(["a", "b", "c"]);
  });
  it("groups rows by kind in the user's order, newest first otherwise", () => {
    const rows: DesignRow[] = [
      { slug: "x", title: "X", kind: "app", frames: 1, created: "", latestVersion: 1, updatedMs: 1, bad: false },
      { slug: "y", title: "Y", kind: "app", frames: 1, created: "", latestVersion: 1, updatedMs: 5, bad: false },
      { slug: "z", title: "Z", kind: "brand", frames: 0, created: "", latestVersion: null, updatedMs: 9, bad: false },
    ];
    const g = orderRows(rows, { app: ["x"] });
    expect(g.app.map((r) => r.slug)).toEqual(["x", "y"]);
    expect(g.brand.map((r) => r.slug)).toEqual(["z"]);
    expect(g.deck).toEqual([]);
  });
});
