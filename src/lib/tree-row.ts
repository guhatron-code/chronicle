/*
 * The pure parts of a tree row — shared by the Repo pane's explorer and the
 * Notes sidebar (src/components/chrome/Tree.tsx draws both). No React, no DOM:
 * every rule here is pinned by tree-row.test.ts.
 */

/** A couple of pixels of rounding is not an overflow worth animating. */
const MARQUEE_SLOP = 3;
export function needsMarquee(scrollWidth: number, clientWidth: number): boolean {
  return scrollWidth - clientWidth > MARQUEE_SLOP;
}
export function marqueeDistance(scrollWidth: number, clientWidth: number): number {
  return Math.max(0, scrollWidth - clientWidth);
}

export interface RowNameStyle { className: string; style: Record<string, string> }
/** Everything a row decides about its name span: ellipsis always, marquee only
 *  when the text really overflows and the pointer is on the row. */
/** Reading pace for the marquee: pixels per second of travel. */
export const MARQUEE_PX_PER_S = 40;
/** The travel is ~43% of the loop (the rest is the pause at each end and the
 *  return), so the loop is sized from the distance at reading pace, never
 *  shorter than 4.5 s. */
export function marqueeDuration(distance: number): number {
  return Math.max(4.5, (distance / MARQUEE_PX_PER_S) / 0.43);
}

export function rowNameStyle(scrollWidth: number, clientWidth: number, hovered: boolean): RowNameStyle {
  const base = "min-w-0 flex-1 overflow-hidden whitespace-nowrap text-ellipsis";
  if (!hovered || !needsMarquee(scrollWidth, clientWidth)) return { className: base, style: {} };
  const d = marqueeDistance(scrollWidth, clientWidth);
  return { className: `${base} note-marquee`, style: { "--marquee": `${d}px`, "--marquee-dur": `${marqueeDuration(d).toFixed(2)}s` } };
}

/** The selected row's inset bar hangs outside the row, into the scroller's own
 *  padding at the top level and into the guide line's gutter below it — the
 *  px-2 container clips anything past -8px. */
export function treeBarOffset(depth: number): string {
  return depth === 0 ? "-left-2" : "-left-[11px]";
}
