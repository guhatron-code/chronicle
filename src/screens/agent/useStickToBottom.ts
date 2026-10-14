/*
 * Keeps a scroller pinned to its bottom while content grows, without any
 * scroll animation during growth (the jump happens in a layout effect, before
 * paint, so nothing is visible), and without a scroll call at all once the
 * user has scrolled up. A ResizeObserver catches growth React never rendered
 * (an image, a card opening). `overflow-anchor: none` on the scroller stops
 * the browser from correcting the same movement a second time.
 */
import { useCallback, useLayoutEffect, useRef } from "react";
import { stickDecision } from "@/lib/thread-scroll";

const reducedMotion = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** Returns a callback ref for the scroller. It attaches when the element
 *  appears (the pane shows an empty state first) and tears down when it goes. */
export function useStickToBottom(deps: unknown[]) {
  const pinned = useRef(true);
  const lastHeight = useRef(0);
  const elRef = useRef<HTMLElement | null>(null);
  const teardown = useRef<(() => void) | null>(null);

  const apply = (el: HTMLElement, userScrolled: boolean) => {
    const grew = el.scrollHeight > lastHeight.current;
    lastHeight.current = el.scrollHeight;
    const d = stickDecision({
      pinned: pinned.current, scrollTop: el.scrollTop, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight,
      grew, userScrolled, reducedMotion: reducedMotion(),
    });
    pinned.current = d.pinned;
    if (d.action === "jump") el.scrollTop = el.scrollHeight;
    else if (d.action === "glide") el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  };

  const setScroller = useCallback((el: HTMLElement | null) => {
    teardown.current?.();
    teardown.current = null;
    elRef.current = el;
    if (!el) return;
    // open at the newest entry before the first paint
    pinned.current = true;
    lastHeight.current = el.scrollHeight;
    el.scrollTop = el.scrollHeight;
    const onScroll = () => apply(el, true);
    el.addEventListener("scroll", onScroll, { passive: true });
    const ro = new ResizeObserver(() => apply(el, false));
    for (const child of Array.from(el.children)) ro.observe(child);
    const mo = new MutationObserver((muts) => {
      for (const m of muts) for (const n of Array.from(m.addedNodes)) if (n instanceof HTMLElement) ro.observe(n);
    });
    mo.observe(el, { childList: true });
    teardown.current = () => { el.removeEventListener("scroll", onScroll); ro.disconnect(); mo.disconnect(); };
  }, []);

  // after every render that could have grown the content
  useLayoutEffect(() => {
    const el = elRef.current;
    if (el) apply(el, false);
  }, deps);

  return setScroller;
}
