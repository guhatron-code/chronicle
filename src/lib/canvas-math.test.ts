import { describe, it, expect } from "vitest";
import { clampZoom, zoomAt, fit, worldToScreen, liveFrames, pinLive, wheelZoomFactor } from "./canvas-math";

describe("canvas maths", () => {
  it("clamps zoom", () => { expect(clampZoom(10)).toBe(2); expect(clampZoom(0.001)).toBe(0.05); });
  it("zooms about the pointer", () => {
    const v = zoomAt({ x: 0, y: 0, zoom: 1 }, 2, 100, 100);
    expect(worldToScreen(v, 100, 100)).toEqual({ x: 100, y: 100 });
    expect(v.zoom).toBe(2);
  });
  it("fits every frame inside the view with padding", () => {
    const v = fit([{ x: 0, y: 0, w: 1000, h: 500 }, { x: 1100, y: 0, w: 400, h: 800 }], 800, 600, 50);
    const a = worldToScreen(v, 0, 0); const b = worldToScreen(v, 1500, 800);
    expect(a.x).toBeGreaterThanOrEqual(50); expect(b.x).toBeLessThanOrEqual(750);
    expect(a.y).toBeGreaterThanOrEqual(50); expect(b.y).toBeLessThanOrEqual(550);
  });
  it("makes at most six on-screen frames live, only when zoomed in enough, nearest the centre first", () => {
    const rects = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`f${i}`, { x: i * 200, y: 0, w: 150, h: 150 }]));
    expect(liveFrames(rects, { x: 0, y: 0, zoom: 0.1 }, 2000, 1000).size).toBe(0);
    const live = liveFrames(rects, { x: 0, y: 0, zoom: 1 }, 1000, 400);
    expect(live.size).toBeLessThanOrEqual(6);
    expect(live.has("f8")).toBe(false);
  });
  it("keeps the frame the user made live without ever passing six", () => {
    const six = new Set(["a", "b", "c", "d", "e", "f"]);
    const pinned = pinLive(six, "z");
    expect(pinned.size).toBe(6);
    expect(pinned.has("z")).toBe(true);
    expect(pinned.has("f")).toBe(false); // the farthest (last) one gives way
    expect(pinLive(six, "c")).toEqual(six);
    expect(pinLive(new Set(["a"]), "z")).toEqual(new Set(["a", "z"]));
    expect(pinLive(six, null)).toEqual(six);
    expect(six.size).toBe(6); // the input is not mutated
  });
  it("zooms a mouse-wheel notch gently and a trackpad pinch smoothly", () => {
    expect(wheelZoomFactor(-4, 0)).toBeCloseTo(Math.exp(0.04));
    expect(wheelZoomFactor(100, 0)).toBeCloseTo(Math.exp(-0.3));
    expect(wheelZoomFactor(-100, 0)).toBeCloseTo(Math.exp(0.3));
    expect(wheelZoomFactor(3, 1)).toBeCloseTo(Math.exp(-0.3)); // lines, clamped
  });
});
