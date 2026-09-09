/*
 * Horizontal strips in the chrome (the file/page tabs, the project tabs) hide
 * their scrollbar and say "there is more this way" with a gradient instead.
 * This is the half that decides WHICH end is fading; EdgeFades draws it.
 *
 * Nothing polls: a scroll is an event, and a width change is a ResizeObserver
 * callback. Content changes (a tab opened or closed) arrive as a React render,
 * so the read also runs in a layout effect on every commit.
 */
import * as React from "react";

export type OverflowEdges = {
  /** content is scrolled past on the left */
  left: boolean;
  /** content continues past the right edge */
  right: boolean;
};

const NONE: OverflowEdges = { left: false, right: false };

/**
 * Which ends of a horizontal scroller still have content beyond them.
 *
 * The 1px slack is not cosmetic: sub-pixel layout means scrollLeft routinely
 * lands a fraction short of its own maximum, and without it the right-hand
 * fade never switches off at the end of the strip.
 */
export function edgesFor(scrollLeft: number, clientWidth: number, scrollWidth: number): OverflowEdges {
  const max = scrollWidth - clientWidth;
  if (!(max > 1)) return NONE;
  const x = Math.min(Math.max(scrollLeft, 0), max);
  return { left: x > 1, right: x < max - 1 };
}

/** Tracks {left, right} for a horizontally scrolling element. */
export function useOverflowEdges(ref: React.RefObject<HTMLElement | null>): OverflowEdges {
  const [edges, setEdges] = React.useState<OverflowEdges>(NONE);

  const read = React.useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const next = edgesFor(el.scrollLeft, el.clientWidth, el.scrollWidth);
    // same object out for the same answer, or every scroll tick re-renders
    setEdges((prev) => (prev.left === next.left && prev.right === next.right ? prev : next));
  }, [ref]);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.addEventListener("scroll", read, { passive: true });
    // ResizeObserver is not in every test environment; the listener alone still works
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(read);
    ro?.observe(el);
    return () => {
      el.removeEventListener("scroll", read);
      ro?.disconnect();
    };
  }, [ref, read]);

  // a tab added, removed or renamed changes scrollWidth without a scroll or a
  // resize of the strip itself — re-read after the commit that did it
  React.useLayoutEffect(read);

  return edges;
}
