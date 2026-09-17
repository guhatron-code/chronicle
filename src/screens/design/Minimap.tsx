/* The canvas minimap (comps board 1, bottom-right, 132×84): every frame as a small
   rectangle and the viewport as an outline. Pressing or dragging on it centres the
   view on that spot. The bounds are frozen for the length of a drag, so the map
   doesn't rescale under the pointer while the viewport moves. */
import { useRef, type PointerEvent as ReactPointerEvent } from "react";
import type { Rect, Viewport } from "@/lib/canvas-math";

const W = 132, H = 84, PAD = 8, IW = W - PAD * 2, IH = H - PAD * 2;

type Bounds = { x: number; y: number; scale: number; ox: number; oy: number };

function boundsOf(rects: Rect[], view: Rect): Bounds {
  const all = [...rects, view];
  const minX = Math.min(...all.map((r) => r.x)), minY = Math.min(...all.map((r) => r.y));
  const maxX = Math.max(...all.map((r) => r.x + r.w)), maxY = Math.max(...all.map((r) => r.y + r.h));
  const scale = Math.min(IW / (maxX - minX || 1), IH / (maxY - minY || 1));
  // centre the content inside the inner box
  return { x: minX, y: minY, scale, ox: (IW - (maxX - minX) * scale) / 2, oy: (IH - (maxY - minY) * scale) / 2 };
}

export function Minimap({ rects, viewport, size, onPan, onPanEnd }: {
  rects: Rect[]; viewport: Viewport; size: { w: number; h: number };
  onPan: (v: Viewport) => void; onPanEnd: () => void;
}) {
  const view: Rect = { x: -viewport.x / viewport.zoom, y: -viewport.y / viewport.zoom, w: size.w / viewport.zoom, h: size.h / viewport.zoom };
  const live = boundsOf(rects, view);
  const frozen = useRef<Bounds | null>(null);
  const b = frozen.current ?? live;
  const map = (r: Rect) => ({ left: b.ox + (r.x - b.x) * b.scale, top: b.oy + (r.y - b.y) * b.scale, width: r.w * b.scale, height: r.h * b.scale });

  const panTo = (e: ReactPointerEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const bb = frozen.current ?? live;
    const wx = (e.clientX - box.left - PAD - bb.ox) / bb.scale + bb.x;
    const wy = (e.clientY - box.top - PAD - bb.oy) / bb.scale + bb.y;
    onPan({ zoom: viewport.zoom, x: size.w / 2 - wx * viewport.zoom, y: size.h / 2 - wy * viewport.zoom });
  };

  return (
    <div
      aria-hidden="true"
      className="absolute right-3.5 bottom-3.5 box-border rounded-lg border border-border-hairline bg-surface-overlay select-none"
      style={{ width: W, height: H, padding: PAD, touchAction: "none" }}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        frozen.current = live;
        panTo(e);
      }}
      onPointerMove={(e) => { if (frozen.current) panTo(e); }}
      onPointerUp={(e) => {
        if (!frozen.current) return;
        frozen.current = null;
        e.currentTarget.releasePointerCapture(e.pointerId);
        onPanEnd();
      }}
      onPointerCancel={() => { if (frozen.current) { frozen.current = null; onPanEnd(); } }}
    >
      <div className="relative size-full overflow-hidden">
        {rects.map((r, i) => <span key={i} className="absolute rounded-[1px] bg-fill-hover" style={map(r)} />)}
        <span className="absolute rounded-[3px] border border-text-muted" style={map(view)} />
      </div>
    </div>
  );
}
