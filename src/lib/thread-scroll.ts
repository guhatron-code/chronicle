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
  /** content got taller since the last decision */
  grew: boolean;
  /** this decision follows a scroll event the user caused */
  userScrolled: boolean;
  reducedMotion: boolean;
};
export type StickDecision = { pinned: boolean; action: "none" | "jump" | "glide" };

export function stickDecision(i: StickInput): StickDecision {
  const gap = i.scrollHeight - i.scrollTop - i.clientHeight;
  if (i.userScrolled) {
    const near = gap < NEAR_BOTTOM_PX;
    if (!near) return { pinned: false, action: "none" };
    if (i.pinned) return { pinned: true, action: "none" };
    return { pinned: true, action: i.reducedMotion ? "jump" : "glide" };
  }
  if (!i.pinned) return { pinned: false, action: "none" };
  return { pinned: true, action: i.grew ? "jump" : "none" };
}
