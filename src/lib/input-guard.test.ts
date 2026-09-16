import { describe, expect, it } from "vitest";
import { installFunctionKeyGuard, isFunctionKeyText } from "./input-guard";

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
