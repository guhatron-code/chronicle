import { describe, expect, it } from "vitest";
import { installFunctionKeyGuard, isFunctionKeyText, swallowsMove } from "./input-guard";

const RIGHT = "", LEFT = "", UP = "", DOWN = "", HOME = "", TOP = "";

describe("function-key junk", () => {
  it("is exactly the private-use characters macOS gives function keys", () => {
    for (const k of [RIGHT, LEFT, UP, DOWN, HOME, TOP, UP + DOWN]) expect(isFunctionKeyText(k), JSON.stringify(k)).toBe(true);
  });
  it("never matches what a person types", () => {
    for (const t of ["a", " ", "→", "é", "😀", `a${RIGHT}`, "", "", "豈"]) expect(isFunctionKeyText(t), JSON.stringify(t)).toBe(false);
    expect(isFunctionKeyText(null)).toBe(false);
    expect(isFunctionKeyText(undefined)).toBe(false);
  });
});

/** node has EventTarget and Event but no InputEvent: shape one by hand */
function beforeInput(inputType: string, data: string | null): Event {
  const e = new Event("beforeinput", { cancelable: true });
  Object.defineProperty(e, "inputType", { value: inputType });
  Object.defineProperty(e, "data", { value: data });
  return e;
}

describe("the guard", () => {
  it("cancels only an insertText made of junk, and can be uninstalled", () => {
    const t = new EventTarget();
    const off = installFunctionKeyGuard(t);
    const junk = beforeInput("insertText", RIGHT);
    t.dispatchEvent(junk);
    expect(junk.defaultPrevented, "junk").toBe(true);
    const text = beforeInput("insertText", "x");
    t.dispatchEvent(text);
    expect(text.defaultPrevented, "text").toBe(false);
    const paste = beforeInput("insertFromPaste", RIGHT);
    t.dispatchEvent(paste);
    expect(paste.defaultPrevented, "paste").toBe(false);
    off();
    const after = beforeInput("insertText", RIGHT);
    t.dispatchEvent(after);
    expect(after.defaultPrevented, "after uninstall").toBe(false);
  });
});

describe("swallowing a move that goes nowhere", () => {
  const at = (start: number, end: number, length: number, direction: "forward" | "backward" | "none" = "none") => ({ start, end, length, direction });
  it("→ and End at the very end, ← and Home at the very start", () => {
    expect(swallowsMove("ArrowRight", at(2, 2, 2))).toBe(true);
    expect(swallowsMove("End", at(2, 2, 2))).toBe(true);
    expect(swallowsMove("ArrowLeft", at(0, 0, 2))).toBe(true);
    expect(swallowsMove("Home", at(0, 0, 2))).toBe(true);
    expect(swallowsMove("ArrowRight", at(0, 0, 0))).toBe(true); // an empty field: both ends
    expect(swallowsMove("ArrowLeft", at(0, 0, 0))).toBe(true);
  });
  it("never a move that can go somewhere", () => {
    expect(swallowsMove("ArrowRight", at(1, 1, 2))).toBe(false);
    expect(swallowsMove("ArrowLeft", at(1, 1, 2))).toBe(false);
    expect(swallowsMove("ArrowUp", at(2, 2, 2))).toBe(false); // up and down always land somewhere
    expect(swallowsMove("a", at(2, 2, 2))).toBe(false);
  });
  it("looks at the end of a selection that moves", () => {
    // anchor 0, focus 3 (forward): ← still has somewhere to go, → does not
    expect(swallowsMove("ArrowLeft", at(0, 3, 3, "forward"))).toBe(false);
    expect(swallowsMove("ArrowRight", at(0, 3, 3, "forward"))).toBe(true);
    // anchor 3, focus 0 (backward): the mirror
    expect(swallowsMove("ArrowRight", at(0, 3, 3, "backward"))).toBe(false);
    expect(swallowsMove("ArrowLeft", at(0, 3, 3, "backward"))).toBe(true);
  });
});
