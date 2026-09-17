/* The canvas's coordinate maths, pure. World units are CSS px of the design;
   screen = world × zoom + (x, y). */
export interface Viewport { x: number; y: number; zoom: number }
export type Rect = { x: number; y: number; w: number; h: number };
export const ZOOM_MIN = 0.05, ZOOM_MAX = 2, LIVE_MIN_ZOOM = 0.15, LIVE_MAX = 6;

export const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));

export function worldToScreen(v: Viewport, x: number, y: number) {
  return { x: x * v.zoom + v.x, y: y * v.zoom + v.y };
}

export function zoomAt(v: Viewport, factor: number, sx: number, sy: number): Viewport {
  const zoom = clampZoom(v.zoom * factor);
  const wx = (sx - v.x) / v.zoom, wy = (sy - v.y) / v.zoom;
  return { zoom, x: sx - wx * zoom, y: sy - wy * zoom };
}

export function fit(rects: Rect[], w: number, h: number, pad = 48): Viewport {
  if (!rects.length) return { x: pad, y: pad, zoom: 1 };
  const minX = Math.min(...rects.map((r) => r.x)), minY = Math.min(...rects.map((r) => r.y));
  const maxX = Math.max(...rects.map((r) => r.x + r.w)), maxY = Math.max(...rects.map((r) => r.y + r.h));
  const zoom = clampZoom(Math.min((w - pad * 2) / (maxX - minX || 1), (h - pad * 2) / (maxY - minY || 1)));
  return { zoom, x: pad - minX * zoom + ((w - pad * 2) - (maxX - minX) * zoom) / 2, y: pad - minY * zoom };
}

export function liveFrames(rects: Record<string, Rect>, v: Viewport, w: number, h: number): Set<string> {
  if (v.zoom < LIVE_MIN_ZOOM) return new Set();
  const cx = w / 2, cy = h / 2;
  const visible = Object.entries(rects)
    .map(([id, r]) => {
      const a = worldToScreen(v, r.x, r.y), b = worldToScreen(v, r.x + r.w, r.y + r.h);
      const on = b.x > 0 && a.x < w && b.y > 0 && a.y < h;
      const d = Math.hypot((a.x + b.x) / 2 - cx, (a.y + b.y) / 2 - cy);
      return { id, on, d };
    })
    .filter((f) => f.on)
    .sort((p, q) => p.d - q.d)
    .slice(0, LIVE_MAX);
  return new Set(visible.map((f) => f.id));
}

/** The live set plus the frame the user made live, still at most LIVE_MAX: when it
 *  isn't already in a full set, the farthest (last, since liveFrames sorts nearest
 *  first) gives way. Returns a new set. */
export function pinLive(live: Set<string>, pinned: string | null, max = LIVE_MAX): Set<string> {
  if (!pinned || live.has(pinned)) return new Set(live);
  const ids = [...live];
  if (ids.length >= max) ids.length = max - 1;
  return new Set([...ids, pinned]);
}

/** ⌘-scroll / pinch zoom factor. A trackpad pinch sends small deltas and zooms
 *  smoothly; a mouse-wheel notch (~100 px, or 3 lines) is clamped to ±30 so one
 *  notch is about 26%, not 63%. */
export function wheelZoomFactor(deltaY: number, deltaMode: number): number {
  const px = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 800 : deltaY;
  return Math.exp(-Math.max(-30, Math.min(30, px)) * 0.01);
}
