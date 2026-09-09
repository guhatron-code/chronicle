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
export function rowNameStyle(scrollWidth: number, clientWidth: number, hovered: boolean): RowNameStyle {
  const base = "min-w-0 flex-1 overflow-hidden whitespace-nowrap text-ellipsis";
  if (!hovered || !needsMarquee(scrollWidth, clientWidth)) return { className: base, style: {} };
  return { className: `${base} note-marquee`, style: { "--marquee": `${marqueeDistance(scrollWidth, clientWidth)}px` } };
}

/** The selected row's inset bar hangs outside the row, into the scroller's own
 *  padding at the top level and into the guide line's gutter below it — the
 *  px-2 container clips anything past -8px. */
export function treeBarOffset(depth: number): string {
  return depth === 0 ? "-left-2" : "-left-[11px]";
}
