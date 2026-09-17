import { describe, it, expect } from "vitest";
import { canvasKey } from "./canvas-keys";
const k = (key: string, m: Partial<{ metaKey: boolean; shiftKey: boolean; ctrlKey: boolean; altKey: boolean }> = {}) =>
  canvasKey({ key, metaKey: false, shiftKey: false, ctrlKey: false, altKey: false, ...m });
describe("canvas keys", () => {
  it("maps plain keys, arrows, tab, enter, escape and undo", () => {
    expect(k("=")).toEqual({ type: "zoom", factor: 1.25 });
    expect(k("+", { shiftKey: true })).toEqual({ type: "zoom", factor: 1.25 });
    expect(k("-")).toEqual({ type: "zoom", factor: 0.8 });
    expect(k("0")).toEqual({ type: "fit" });
    expect(k("1")).toEqual({ type: "actual" });
    expect(k("ArrowLeft")).toEqual({ type: "nudge", dx: -1, dy: 0 });
    expect(k("ArrowDown", { shiftKey: true })).toEqual({ type: "nudge", dx: 0, dy: 10 });
    expect(k("Tab")).toEqual({ type: "next", back: false });
    expect(k("Tab", { shiftKey: true })).toEqual({ type: "next", back: true });
    expect(k("Enter")).toEqual({ type: "live" });
    expect(k("Escape")).toEqual({ type: "exitLive" });
    expect(k("z", { metaKey: true })).toEqual({ type: "undo" });
    expect(k("z", { metaKey: true, shiftKey: true })).toEqual({ type: "redo" });
  });
  it("leaves app chords alone", () => {
    expect(k("1", { metaKey: true })).toBeNull();
    expect(k("=", { metaKey: true })).toBeNull();
    expect(k("j", { metaKey: true })).toBeNull();
  });
});
