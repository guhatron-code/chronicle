/* Boards 4 and 6: the finding the scorecard picked, outlined on its element. Drawn in
   the canvas layer over the frame (never inside the page), from the rect the frame's
   reporter located in page px: page px are world px, so world → screen is
   worldToScreen plus the zoom. When the page has no such element it says so at the
   frame's top-left instead. */
import { worldToScreen, type Rect, type Viewport } from "@/lib/canvas-math";
import type { DesignProject } from "@/lib/design-store";

/** gen.py `mk`: the ring sits 4 px off the element, the chip 6 px above the ring. */
const RING_GAP = 4, CHIP_GAP = 6;
/** the chip's height (10.5 px text, 3 px padding), for "is there room above?" */
const CHIP_H = 20;

export function PinLayer({ v, rects, pin, located, size }: {
  v: Viewport; rects: Record<string, Rect>; pin: DesignProject["pin"]; located: DesignProject["located"];
  /** the canvas's size in screen px: the label chip stays inside it */
  size: { w: number; h: number };
}) {
  const r = pin ? rects[pin.frame] : undefined;
  if (!pin || !r) return null;
  const loc = located[`${pin.frame}:${pin.selector}`];
  if (loc === undefined) return null;

  if (loc === null) {
    const at = worldToScreen(v, r.x, r.y);
    return (
      <div
        className="pointer-events-none absolute flex h-5 items-center gap-[5px] whitespace-nowrap rounded-[5px] border border-border-hairline bg-surface-overlay px-[7px] text-[10.5px] text-text-secondary"
        style={{ left: at.x + 8, top: at.y + 8 }}
      >
        <span aria-hidden className="size-[5px] shrink-0 rounded-full bg-state-warn" />
        couldn't find it on the page
      </div>
    );
  }

  const at = worldToScreen(v, r.x + loc.x, r.y + loc.y);
  const w = loc.w * v.zoom, h = loc.h * v.zoom;
  // above-right: the chip's right edge on the ring's right edge, just above it — or
  // just below the ring when there is no room above; never past the canvas's right edge
  const above = at.y - RING_GAP - CHIP_GAP - CHIP_H;
  const top = above >= 0 ? above : at.y + h + RING_GAP + CHIP_GAP;
  const right = Math.max(0, size.w - (at.x + w + RING_GAP));
  return (
    <>
      <div className="pointer-events-none absolute rounded-[2px]"
        style={{ left: at.x, top: at.y, width: w, height: h, outline: "2px solid var(--state-warn)", outlineOffset: RING_GAP }} />
      <span
        title={pin.text}
        className="pointer-events-none absolute h-5 max-w-[36ch] truncate whitespace-nowrap rounded-[5px] bg-state-warn px-[7px] py-[3px] text-[10.5px] leading-[14px] font-medium text-primary-foreground"
        style={{ right, top }}
      >
        {pin.text}
      </span>
    </>
  );
}
