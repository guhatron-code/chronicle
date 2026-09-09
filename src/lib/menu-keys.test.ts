import { describe, expect, it } from "vitest";
import { keydownInit, reclaimsFocus, type MenuKey } from "./menu-keys";

const cmd = (key: string, code: string): MenuKey => ({ key, code, meta: true, alt: false, shift: false });
const altCmd = (key: string, code: string): MenuKey => ({ key, code, meta: true, alt: true, shift: false });
const shiftCmd = (key: string, code: string): MenuKey => ({ key, code, meta: true, alt: false, shift: true });

describe("keydownInit", () => {
  it("carries the chord onto a replayable KeyboardEvent", () => {
    expect(keydownInit(cmd("k", "KeyK"))).toEqual({
      key: "k", code: "KeyK", metaKey: true, altKey: false, shiftKey: false,
      bubbles: true, cancelable: true,
    });
  });
  it("keeps the code for ⌥⌘ chords, whose key macOS rewrites", () => {
    const init = keydownInit(altCmd("1", "Digit1"));
    expect(init.code).toBe("Digit1");
    expect(init.altKey).toBe(true);
    expect(init.metaKey).toBe(true);
  });
  it("bubbles and is cancelable, so window listeners see it and can preventDefault", () => {
    const init = keydownInit(cmd("/", "Slash"));
    expect(init.bubbles).toBe(true);
    expect(init.cancelable).toBe(true);
  });
  it("carries shift for ⌘⇧F", () => {
    const init = keydownInit(shiftCmd("F", "KeyF"));
    expect(init.shiftKey).toBe(true);
    expect(init.key).toBe("F"); // App.tsx accepts "f" or "F"
  });
});

describe("reclaimsFocus", () => {
  it("is true for the chords that put the user in Chronicle's chrome", () => {
    for (const k of [
      cmd("k", "KeyK"), cmd("t", "KeyT"), cmd("l", "KeyL"), cmd("w", "KeyW"),
      cmd("j", "KeyJ"), cmd("/", "Slash"), cmd("o", "KeyO"), cmd("5", "Digit5"),
    ])
      expect(reclaimsFocus(k)).toBe(true);
    expect(reclaimsFocus(altCmd("1", "Digit1"))).toBe(true);
    expect(reclaimsFocus(shiftCmd("F", "KeyF"))).toBe(true);
  });
  it("is false for the chords that act on the page and leave the user reading it", () => {
    expect(reclaimsFocus(cmd("r", "KeyR"))).toBe(false);
    expect(reclaimsFocus(cmd("[", "BracketLeft"))).toBe(false);
    expect(reclaimsFocus(cmd("]", "BracketRight"))).toBe(false);
  });
});
