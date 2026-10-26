/*
 * Pure: given what the scroller looks like and what just happened, say whether
 * the thread is pinned to its bottom and what, if anything, to do about it.
 * The hook measures; this decides; tests pin the rule.
 */
export const NEAR_BOTTOM_PX = 60;

export type StickInput = {
  pinned: boolean;
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  /** this decision follows a scroll event the user caused */
  userScrolled: boolean;
  /** this user scroll moved scrollTop to a smaller value than the last one */
  scrolledUp: boolean;
  reducedMotion: boolean;
};
export type StickDecision = { pinned: boolean; action: "none" | "jump" | "glide" };

export function stickDecision(i: StickInput): StickDecision {
  const gap = i.scrollHeight - i.scrollTop - i.clientHeight;
  if (i.userScrolled) {
    // a scroll that lands exactly at the bottom is the browser clamping scrollTop
    // after the content shrank (a card collapsed) — nobody left the bottom
    if (i.scrolledUp && gap > 0) return { pinned: false, action: "none" };
    // direction first: any upward movement leaves the bottom, however close
    if (i.scrolledUp) return { pinned: true, action: "none" };
    const near = gap < NEAR_BOTTOM_PX;
    if (!near) return { pinned: false, action: "none" };
    if (i.pinned) return { pinned: true, action: "none" };
    return { pinned: true, action: i.reducedMotion ? "jump" : "glide" };
  }
  if (!i.pinned) return { pinned: false, action: "none" };
  // pinned means "at the bottom": whatever opened a gap — content that grew, or a
  // viewport that shrank because a strip appeared below the thread — closes it
  return { pinned: true, action: gap > 0 ? "jump" : "none" };
}
