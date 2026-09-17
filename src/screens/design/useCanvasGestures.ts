/* The Design canvas's viewport and gestures (spec §7 · Pointer interaction, Keyboard):
   the viewport and when it is written to canvas.json, trackpad pan and pinch/⌘-scroll
   zoom, space-drag and middle-drag pan, dragging a frame (one undo entry per drag),
   and the canvas keys. DesignCanvas renders; this decides what the input means.

   The viewport is saved when it has been still for a moment, without a timer: after
   a pointer gesture ends, on the next pointermove or keydown after a wheel burst,
   after a keyboard zoom, and when the canvas unmounts. */
import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { fit, wheelZoomFactor, worldToScreen, zoomAt, type Rect, type Viewport } from "@/lib/canvas-math";
import { canvasKey } from "@/lib/canvas-keys";
import { readingOrder, type CanvasFile } from "@/lib/design-model";
import { designProjectFor, moveFrame, redoDesign, undoDesign } from "@/lib/design-store";
import { designCanvasSave } from "@/lib/ipc";

/** Room kept around a revealed frame, in screen px; the top also clears the name strip. */
const REVEAL = 48, STRIP = 26;

type Gesture =
  | { kind: "pan"; pointer: number; sx: number; sy: number; v0: Viewport }
  | { kind: "frame"; pointer: number; id: string; sx: number; sy: number; moved: boolean };

/** The frame (if any) under a DOM event target. */
const frameAt = (target: EventTarget | null) =>
  (target instanceof Element ? target.closest<HTMLElement>("[data-frame]") : null)?.dataset.frame ?? null;

export interface CanvasGestures {
  viewport: Viewport | null;
  selected: string | null;
  liveId: string | null;
  /** a frame being dragged, drawn at this world position until the store has it */
  drag: { id: string; x: number; y: number } | null;
  panning: boolean;
  select: (id: string | null) => void;
  enterLive: (id: string) => void;
  exitLive: () => void;
  zoomBy: (factor: number) => void;
  fitAll: () => void;
  cycleZoom: () => void;
  panTo: (v: Viewport) => void;
  commit: () => void;
  onFrameDragStart: (id: string, e: ReactPointerEvent) => void;
  canvasHandlers: {
    onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => void;
    onPointerMove: (e: ReactPointerEvent<HTMLDivElement>) => void;
    onPointerUp: (e: ReactPointerEvent<HTMLDivElement>) => void;
    onPointerCancel: (e: ReactPointerEvent<HTMLDivElement>) => void;
    onDoubleClick: (e: ReactMouseEvent<HTMLDivElement>) => void;
    onKeyDown: (e: ReactKeyboardEvent<HTMLDivElement>) => void;
    onKeyUp: (e: ReactKeyboardEvent<HTMLDivElement>) => void;
    onBlur: () => void;
  };
}

export function useCanvasGestures({ dir, slug, canvas, rects, size, canvasRef }: {
  dir: string; slug: string | null; canvas: CanvasFile; rects: Record<string, Rect>;
  size: { w: number; h: number }; canvasRef: RefObject<HTMLDivElement | null>;
}): CanvasGestures {
  const [viewport, setViewport] = useState<Viewport | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [liveId, setLiveId] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ id: string; x: number; y: number } | null>(null);
  const [panning, setPanning] = useState(false);

  const vp = useRef(viewport);
  const gesture = useRef<Gesture | null>(null);
  /** the press a frame already claimed, so the canvas's own handler leaves it alone */
  const claimed = useRef<Event | null>(null);
  const space = useRef(false);
  const dirty = useRef(false);
  /** set while the viewport is the automatic fit of a design with no frames yet,
   *  so the first frames to arrive get a real fit instead of 100% at the origin */
  const autoFit = useRef(false);
  // The latest of everything the stable callbacks read.
  const live = useRef({ rects, size, selected, liveId, canvas, slug });
  live.current = { rects, size, selected, liveId, canvas, slug };
  const rectList = Object.values(rects);

  const setView = useCallback((v: Viewport, user = true) => {
    if (user) autoFit.current = false;
    vp.current = v;
    dirty.current = true;
    setViewport(v);
  }, []);

  /** Writes the viewport into canvas.json for the design this canvas was mounted for. */
  const commit = useCallback(() => {
    if (!dirty.current) return;
    dirty.current = false;
    const v = vp.current, { slug: s, canvas: c } = live.current;
    if (!v || !s) return;
    const p = designProjectFor(dir);
    const next: CanvasFile = { ...(p.active === s ? p.canvas : c), viewport: v };
    if (p.active === s) p.canvas = next;
    void designCanvasSave(dir, s, next).catch(() => {});
  }, [dir]);

  // First viewport: the saved one, or a fit once the container has a size.
  useEffect(() => {
    if (viewport || !size.w || !size.h || !slug) return;
    const saved = canvas.viewport;
    const v = saved ?? fit(rectList, size.w, size.h);
    autoFit.current = !saved && rectList.length === 0;
    vp.current = v;
    setViewport(v);
  }); // no deps: re-checks each render until it has a viewport
  // The first frames of a new design: fit them, once.
  useEffect(() => {
    if (autoFit.current && rectList.length && size.w && size.h) {
      autoFit.current = false;
      setView(fit(rectList, size.w, size.h), false);
      commit();
    }
  });
  // Save a moved viewport when the canvas goes away.
  useEffect(() => () => commit(), [commit]);

  const zoomBy = useCallback((factor: number) => {
    const v = vp.current; const { w, h } = live.current.size;
    if (!v) return;
    setView(zoomAt(v, factor, w / 2, h / 2)); commit();
  }, [setView, commit]);
  const fitAll = useCallback(() => {
    const { w, h } = live.current.size;
    setView(fit(Object.values(live.current.rects), w, h)); commit();
  }, [setView, commit]);
  const cycleZoom = useCallback(() => {
    const v = vp.current; const { w, h } = live.current.size;
    if (!v) return;
    const f = fit(Object.values(live.current.rects), w, h);
    if (Math.round(v.zoom * 100) === Math.round(f.zoom * 100)) zoomBy(1 / v.zoom);
    else fitAll();
  }, [zoomBy, fitAll]);
  const panTo = useCallback((v: Viewport) => setView(v), [setView]);

  const focusCanvas = useCallback(() => canvasRef.current?.focus({ preventScroll: true }), [canvasRef]);
  const select = useCallback((id: string | null) => {
    setSelected(id);
    // Pressing another frame (or the canvas) is the way out of a live frame whose
    // page holds the keyboard, where Esc never reaches the canvas.
    if (id !== live.current.liveId) setLiveId(null);
    focusCanvas();
  }, [focusCanvas]);
  const enterLive = useCallback((id: string) => { setSelected(id); setLiveId(id); }, []);
  const exitLive = useCallback(() => { setLiveId(null); focusCanvas(); }, [focusCanvas]);

  /** Pans just enough to bring a frame (and its name strip) on screen. */
  const reveal = useCallback((r: Rect) => {
    const v = vp.current; const { w, h } = live.current.size;
    if (!v) return;
    const a = worldToScreen(v, r.x, r.y), b = worldToScreen(v, r.x + r.w, r.y + r.h);
    let dx = 0, dy = 0;
    if (a.x < REVEAL || b.x - a.x > w - REVEAL * 2) dx = REVEAL - a.x;
    else if (b.x > w - REVEAL) dx = w - REVEAL - b.x;
    const top = REVEAL + STRIP;
    if (a.y < top || b.y - a.y > h - top - REVEAL) dy = top - a.y;
    else if (b.y > h - REVEAL) dy = h - REVEAL - b.y;
    if (dx || dy) { setView({ ...v, x: v.x + dx, y: v.y + dy }); commit(); }
  }, [setView, commit]);

  // Trackpad: two-finger scroll pans; pinch (ctrl) or ⌘-scroll zooms about the pointer.
  // Non-passive, so it can keep the webview from scrolling or zooming itself.
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const v = vp.current;
      if (!v) return;
      if (e.ctrlKey || e.metaKey) {
        const box = el.getBoundingClientRect();
        setView(zoomAt(v, wheelZoomFactor(e.deltaY, e.deltaMode), e.clientX - box.left, e.clientY - box.top));
      } else setView({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [canvasRef, setView, slug]);

  const startPan = (e: ReactPointerEvent) => {
    const v = vp.current;
    if (!v) return;
    e.preventDefault();
    gesture.current = { kind: "pan", pointer: e.pointerId, sx: e.clientX, sy: e.clientY, v0: v };
    canvasRef.current?.setPointerCapture(e.pointerId);
    setPanning(true);
  };

  const onFrameDragStart = (id: string, e: ReactPointerEvent) => {
    claimed.current = e.nativeEvent;
    if (space.current) { startPan(e); return; }
    // No pointer capture yet: capturing on press would retarget the click and
    // double-click to the canvas. It is taken once the drag threshold is crossed.
    gesture.current = { kind: "frame", pointer: e.pointerId, id, sx: e.clientX, sy: e.clientY, moved: false };
  };

  const endGesture = (e: ReactPointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const g = gesture.current;
    if (!g || g.pointer !== e.pointerId) return;
    gesture.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (g.kind === "pan") { setPanning(false); commit(); return; }
    const v = vp.current, r = live.current.rects[g.id];
    if (cancelled || !g.moved || !v || !r) { setDrag(null); return; }
    const x = Math.round(r.x + (e.clientX - g.sx) / v.zoom), y = Math.round(r.y + (e.clientY - g.sy) / v.zoom);
    setDrag({ id: g.id, x, y });
    // Keep drawing it at the drop point until the store has the move, so it never
    // flashes back to where it started while canvas.json is written.
    void moveFrame(dir, g.id, x, y).finally(() => setDrag((d) => (d && d.id === g.id && d.x === x && d.y === y ? null : d)));
  };

  const canvasHandlers: CanvasGestures["canvasHandlers"] = {
    onPointerDown: (e) => {
      if (claimed.current === e.nativeEvent) return; // a frame already took this press
      gesture.current = null; // a press whose release never reached the canvas
      if (e.button === 1 || (e.button === 0 && space.current)) { focusCanvas(); startPan(e); return; }
      if (e.button === 0 && e.target === e.currentTarget) select(null);
    },
    onPointerMove: (e) => {
      const g = gesture.current;
      if (!g) commit(); // a wheel burst has ended (a pan saves once, on release)
      if (!g || g.pointer !== e.pointerId) return;
      const dx = e.clientX - g.sx, dy = e.clientY - g.sy;
      if (g.kind === "pan") { setView({ ...g.v0, x: g.v0.x + dx, y: g.v0.y + dy }); return; }
      if (!g.moved) {
        // released somewhere the canvas never heard about: not a drag any more
        if (e.buttons === 0) { gesture.current = null; return; }
        if (Math.abs(dx) + Math.abs(dy) < 3) return;
        g.moved = true;
        e.currentTarget.setPointerCapture(e.pointerId);
      }
      const v = vp.current, r = live.current.rects[g.id];
      if (v && r) setDrag({ id: g.id, x: r.x + dx / v.zoom, y: r.y + dy / v.zoom });
    },
    onPointerUp: (e) => endGesture(e, false),
    onPointerCancel: (e) => endGesture(e, true),
    // Hit-tested here rather than on the frame, so it works whatever holds the pointer.
    onDoubleClick: (e) => { const id = frameAt(e.target); if (id) enterLive(id); },
    onKeyDown: (e) => {
      if ((e.target as HTMLElement).closest("button, input, textarea")) return;
      if (e.key === " ") { e.preventDefault(); space.current = true; return; }
      commit();
      const a = canvasKey(e);
      if (!a) return;
      const { rects: rs, selected: sel, liveId: lid } = live.current;
      switch (a.type) {
        case "zoom": e.preventDefault(); zoomBy(a.factor); return;
        case "fit": e.preventDefault(); fitAll(); return;
        case "actual": e.preventDefault(); { const v = vp.current; if (v) zoomBy(1 / v.zoom); } return;
        case "nudge": {
          e.preventDefault();
          // From the store's position, which moveFrame updates at once, so a held
          // arrow key keeps adding up before the rendered rect catches up.
          const r = sel ? designProjectFor(dir).canvas.positions[sel] ?? rs[sel] : null;
          if (sel && r) void moveFrame(dir, sel, r.x + a.dx, r.y + a.dy);
          return;
        }
        case "next": {
          const order = readingOrder(rs);
          const i = sel ? order.indexOf(sel) : -1;
          const n = a.back ? (i < 0 ? -1 : i - 1) : i + 1;
          // Past either end, Tab carries on to the rest of the pane.
          if (n < 0 || n >= order.length) { setSelected(null); return; }
          e.preventDefault();
          setSelected(order[n]);
          if (lid && lid !== order[n]) setLiveId(null);
          reveal(rs[order[n]]);
          return;
        }
        case "live": if (sel) { e.preventDefault(); setLiveId(sel); } return;
        case "exitLive": if (lid) { e.preventDefault(); exitLive(); } return;
        case "undo": e.preventDefault(); void undoDesign(dir); return;
        case "redo": e.preventDefault(); void redoDesign(dir); return;
      }
    },
    onKeyUp: (e) => { if (e.key === " ") space.current = false; },
    onBlur: () => { space.current = false; },
  };

  return { viewport, selected, liveId, drag, panning, select, enterLive, exitLive, zoomBy, fitAll, cycleZoom, panTo, commit, onFrameDragStart, canvasHandlers };
}
