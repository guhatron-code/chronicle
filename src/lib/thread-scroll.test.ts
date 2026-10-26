/*
 * The rule: while you are at the bottom the thread stays there as content
 * grows, with no scroll animation (a glide restarted on every chunk never
 * lands). You leave the bottom by scrolling up; you come back by scrolling
 * within reach of it, and that one return glides.
 */
import { describe, expect, it } from "vitest";
import { NEAR_BOTTOM_PX, stickDecision } from "./thread-scroll";

const base = { pinned: true, scrollTop: 1000, scrollHeight: 1600, clientHeight: 600, userScrolled: false, scrolledUp: false, reducedMotion: false };

describe("stickDecision", () => {
  it("pinned + content grew → jump to the bottom, no glide", () => {
    expect(stickDecision({ ...base, scrollHeight: 1700 })).toEqual({ pinned: true, action: "jump" });
  });
  it("pinned + nothing grew → nothing", () => {
    expect(stickDecision({ ...base })).toEqual({ pinned: true, action: "none" });
  });
  it("pinned + the viewport shrank under the same content (a strip appeared below the thread) → jump", () => {
    // 1600 of content, scrolled to its old bottom at 1000; the scroller lost 44px to the review strip
    expect(stickDecision({ ...base, scrollTop: 1000, scrollHeight: 1600, clientHeight: 556 })).toEqual({ pinned: true, action: "jump" });
  });
  it("the user scrolled up → unpinned, and growth no longer moves them", () => {
    const away = stickDecision({ ...base, userScrolled: true, scrolledUp: true, scrollTop: 300 });
    expect(away).toEqual({ pinned: false, action: "none" });
    expect(stickDecision({ ...base, pinned: false, scrollTop: 300, scrollHeight: 2400 })).toEqual({ pinned: false, action: "none" });
  });
  it("the user scrolled back within reach of the bottom → pinned again, one glide", () => {
    const top = 1600 - 600 - (NEAR_BOTTOM_PX - 1);
    expect(stickDecision({ ...base, pinned: false, userScrolled: true, scrollTop: top })).toEqual({ pinned: true, action: "glide" });
  });
  it("the return is a jump under reduced motion", () => {
    const top = 1600 - 600 - 10;
    expect(stickDecision({ ...base, pinned: false, userScrolled: true, scrollTop: top, reducedMotion: true })).toEqual({ pinned: true, action: "jump" });
  });
  it("content that shrank under the pin (a card collapsed) clamps scrollTop upward and keeps the pin", () => {
    // the browser clamps scrollTop to the new bottom and fires a scroll event; nobody scrolled up
    expect(stickDecision({ ...base, userScrolled: true, scrolledUp: true, scrollTop: 700, scrollHeight: 1300 })).toEqual({ pinned: true, action: "none" });
  });
  it("a scroll event that lands exactly at the bottom keeps the pin", () => {
    expect(stickDecision({ ...base, userScrolled: true, scrollTop: 1000 })).toEqual({ pinned: true, action: "none" });
  });
  it("a slow upward scroll while near the bottom unpins", () => {
    expect(stickDecision({ ...base, userScrolled: true, scrolledUp: true, scrollTop: 1000 - 5 })).toEqual({ pinned: false, action: "none" });
  });
  it("a downward scroll back within reach re-pins and glides", () => {
    const top = 1600 - 600 - 20;
    expect(stickDecision({ ...base, pinned: false, userScrolled: true, scrolledUp: false, scrollTop: top })).toEqual({ pinned: true, action: "glide" });
  });
});
