/* Boards 4 and 6: the finding the scorecard picked, outlined on its element. Drawn in
   the canvas layer over the frame (never inside the page), from the rect the frame's
   reporter located in page px: page px are world px, so world → screen is
   worldToScreen plus the zoom. When the page has no such element it says so at the
   frame's top-left instead. */
import { worldToScreen, type Rect, type Viewport } from "@/lib/canvas-math";
import type { DesignProject } from "@/lib/design-store";

/** gen.py `mk`: the ring sits 4 px off the element, the chip 6 px above the ring. */
const RING_GAP = 4, CHIP_GAP = 6;

export function PinLayer({ v, rects, pin, located }: {
  v: Viewport; rects: Record<string, Rect>; pin: DesignProject["pin"]; located: DesignProject["located"];
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
  return (
    <div className="pointer-events-none absolute" style={{ left: at.x, top: at.y, width: w, height: h }}>
      <div className="absolute inset-0 rounded-[2px]" style={{ outline: "2px solid var(--state-warn)", outlineOffset: RING_GAP }} />
      {/* above-right: the chip's right edge on the ring's right edge, just above it */}
      <span
        title={pin.text}
        className="absolute max-w-[36ch] truncate whitespace-nowrap rounded-[5px] bg-state-warn px-[7px] py-[3px] text-[10.5px] font-medium text-primary-foreground"
        style={{ right: -RING_GAP, bottom: `calc(100% + ${RING_GAP + CHIP_GAP}px)` }}
      >
        {pin.text}
      </span>
    </div>
  );
}
