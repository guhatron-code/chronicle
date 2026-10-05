/* The Design canvas (spec §7, comps boards 1, 3, 5 and 9): the open design's frames
   laid out on a dot grid, each drawn at its full reported height. Only frames on
   screen at 15% or more are live iframes, at most six, and none while the pane or
   the window is hidden; the rest show their latest thumbnail. Input handling lives
   in useCanvasGestures; this file draws and routes frame messages. */
import { useCallback, useEffect, useRef, useState } from "react";
import { liveFrames, pinLive, worldToScreen, type Rect } from "@/lib/canvas-math";
import { placeFrames } from "@/lib/design-model";
import { designProjectFor, frameMessage, subscribeDesigns } from "@/lib/design-store";
import { getActivity, subscribeActivity } from "@/lib/scheduler";
import { DesignCompare } from "./DesignCompare";
import { FrameView, STRIP, stateWordOf } from "./FrameView";
import { Minimap } from "./Minimap";
import { PinLayer } from "./PinLayer";
import { ReviewPill } from "./ReviewPill";
import { ZoomControls } from "./CanvasToolbar";
import { useCanvasGestures } from "./useCanvasGestures";

/** Room kept around a frame the scorecard brings on screen (useCanvasGestures' REVEAL). */
const REVEAL = 48;

const PLACEHOLDERS = [
  { label: "Desktop", width: 1440, w: 317, h: 260 },
  { label: "Tablet", width: 768, w: 169, h: 225 },
  { label: "Mobile", width: 390, w: 117, h: 253 },
];

function useWindowVisible() {
  const [visible, setVisible] = useState(() => getActivity().visible);
  useEffect(() => subscribeActivity((a) => setVisible(a.visible)), []);
  return visible;
}

export function DesignCanvas({ dir, onScreen }: { dir: string; onScreen: boolean }) {
  const [, bump] = useState(0);
  useEffect(() => subscribeDesigns(() => bump((n) => n + 1)), []);
  const p = designProjectFor(dir);
  const slug = p.active, design = p.design;
  const windowVisible = useWindowVisible();

  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const heights: Record<string, number> = {};
  for (const [id, s] of Object.entries(p.frameStates)) if (s.kind === "rendered") heights[id] = s.height;
  const rects: Record<string, Rect> = design ? placeFrames(design, p.canvas.positions, heights) : {};

  const g = useCanvasGestures({ dir, slug, canvas: p.canvas, rects, size, canvasRef });
  const v = g.viewport;

  // Frame messages: only from the iframes this canvas mounted, matched by window.
  const iframes = useRef(new Map<string, HTMLIFrameElement>());
  const refCallbacks = useRef(new Map<string, (el: HTMLIFrameElement | null) => void>());
  const iframeRef = (id: string) => {
    let cb = refCallbacks.current.get(id);
    if (!cb) {
      cb = (el) => { if (el) iframes.current.set(id, el); else iframes.current.delete(id); };
      refCallbacks.current.set(id, cb);
    }
    return cb;
  };
  const exitLive = g.exitLive;

  // The pinned finding: ask the pinned frame's page where its element is. Only ever
  // posted to an iframe this canvas mounted; the page's origin is opaque, hence "*".
  const pin = p.pin;
  const pinRef = useRef(pin);
  pinRef.current = pin;
  const locate = useCallback((frameId: string) => {
    const pn = pinRef.current;
    if (!pn || pn.frame !== frameId) return;
    iframes.current.get(frameId)?.contentWindow?.postMessage(
      { __chronicleCanvas: 1, type: "locate", id: `${pn.frame}:${pn.selector}`, selector: pn.selector }, "*");
  }, []);

  useEffect(() => {
    const on = (e: MessageEvent) => {
      if (!e.source) return;
      for (const [id, el] of iframes.current) {
        if (el.contentWindow !== e.source) continue;
        const d = e.data as Record<string, unknown> | null;
        // A live page holds the keyboard, so Esc can only come back as a message.
        if (d && d.__chronicleFrame === 1 && d.type === "escape") exitLive();
        else {
          frameMessage(dir, id, e.data);
          // a (re)loaded or reflowed page: its element may have moved, ask again
          if (d && d.__chronicleFrame === 1 && (d.type === "ready" || d.type === "height")) locate(id);
        }
        return;
      }
    };
    window.addEventListener("message", on);
    return () => window.removeEventListener("message", on);
  }, [dir, exitLive, locate]);

  const shown = onScreen && windowVisible;
  const nearest = shown && v && size.w ? liveFrames(rects, v, size.w, size.h) : new Set<string>();
  const live = shown && g.liveId && rects[g.liveId] ? pinLive(nearest, g.liveId) : nearest;

  // A new pin, or its frame going live: ask now (a frame still loading answers on "ready").
  const pinLiveNow = pin != null && live.has(pin.frame);
  useEffect(() => { if (pin && pinLiveNow) locate(pin.frame); }, [pin, pinLiveNow, locate]);

  // The scorecard picked a finding: select its frame and bring it on screen.
  const reach = useRef({ rects, v, size });
  reach.current = { rects, v, size };
  const { select, panTo, commit } = g;
  useEffect(() => {
    const on = (e: Event) => {
      const id = (e as CustomEvent<unknown>).detail;
      if (typeof id !== "string") return;
      const { rects: rs, v: vw, size: sz } = reach.current;
      const r = rs[id];
      if (!r) return;
      select(id);
      if (!vw) return;
      // the gestures' reveal: pan just enough to show the frame and its name strip
      const a = worldToScreen(vw, r.x, r.y), b = worldToScreen(vw, r.x + r.w, r.y + r.h);
      let dx = 0, dy = 0;
      if (a.x < REVEAL || b.x - a.x > sz.w - REVEAL * 2) dx = REVEAL - a.x;
      else if (b.x > sz.w - REVEAL) dx = sz.w - REVEAL - b.x;
      const top = REVEAL + STRIP;
      if (a.y < top || b.y - a.y > sz.h - top - REVEAL) dy = top - a.y;
      else if (b.y > sz.h - REVEAL) dy = sz.h - REVEAL - b.y;
      if (dx || dy) { panTo({ ...vw, x: vw.x + dx, y: vw.y + dy }); commit(); }
    };
    window.addEventListener("chronicle:select-frame", on);
    return () => window.removeEventListener("chronicle:select-frame", on);
  }, [select, panTo, commit]);

  // the one derivation of "latest": p.versions is refreshed after a turn's
  // thumbnails render, so the picture a frame asks for exists by then
  const latest = p.versions[0]?.n ?? null;
  // changes whenever versions refresh — a thumbnail that 404'd earlier is asked for again
  const thumbToken = `${p.reloadTick}-${p.versions.length}`;
  const frames = design?.frames ?? [];
  const sel = frames.find((f) => f.id === g.selected);
  const announce = sel ? `${sel.label}, ${sel.width} wide, ${stateWordOf(p.frameStates[sel.id] ?? { kind: "placeholder" })}` : "";
  const comparing = p.compare != null && latest != null;
  const inReview = p.review.phase === "critique" && !p.critiqueMissing;
  const pinsOn: Record<string, number> = {};
  for (const r of p.critiques.at(-1)?.reviewers ?? []) for (const f of r.findings) if (f.frame) pinsOn[f.frame] = (pinsOn[f.frame] ?? 0) + 1;
  // the pin follows a frame being dragged
  const drawn = g.drag && rects[g.drag.id] ? { ...rects, [g.drag.id]: { ...rects[g.drag.id], x: g.drag.x, y: g.drag.y } } : rects;

  return (
    <div ref={boxRef} className="relative min-h-0 flex-1 overflow-hidden bg-surface-app">
      <div
        ref={canvasRef}
        tabIndex={0}
        aria-label="Design canvas"
        className="absolute inset-0 outline-none focus-visible:[box-shadow:inset_0_0_0_1px_var(--border-field-focus)]"
        style={{
          backgroundImage: "radial-gradient(var(--border-hairline) 1px, transparent 1px)",
          backgroundSize: "20px 20px",
          backgroundPosition: v ? `${v.x}px ${v.y}px` : undefined,
          touchAction: "none",
          cursor: g.panning ? "grabbing" : undefined,
        }}
        {...g.canvasHandlers}
      >
        {p.bad ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-8 text-center text-[12.5px] text-text-muted">
            Couldn't read this design. Ask the design session to write its design.json again.
          </div>
        ) : design && frames.length === 0 ? (
          <div className="pointer-events-none absolute top-8 left-8 flex gap-7">
            {PLACEHOLDERS.map((ph) => (
              <div key={ph.label}>
                <div className="mb-1.5 flex h-5 items-center gap-2">
                  <span className="text-[11.5px] text-text-subtle">{ph.label}</span>
                  <span className="font-mono text-[10.5px] text-text-faint">{ph.width}</span>
                </div>
                <div className="flex items-center justify-center rounded-[2px] border border-dashed border-border-strong text-center text-[11px] text-text-faint" style={{ width: ph.w, height: ph.h }}>
                  waiting for the first frame
                </div>
              </div>
            ))}
          </div>
        ) : design && v && slug && p.base != null && comparing ? (
          <DesignCompare frames={frames} rects={rects} v={v} base={p.base} slug={slug} compare={p.compare!} newest={latest!} token={thumbToken} />
        ) : design && v && slug && p.base != null ? (
          frames.map((f) => {
            const r = rects[f.id];
            if (!r) return null;
            const dragged = g.drag?.id === f.id ? g.drag : null;
            const at = worldToScreen(v, dragged ? dragged.x : r.x, dragged ? dragged.y : r.y);
            // Skip frames (and their strips) entirely off screen, except the one the user made live.
            if (g.liveId !== f.id && (at.x > size.w || at.y - STRIP > size.h || at.x + r.w * v.zoom < 0 || at.y + r.h * v.zoom < 0)) return null;
            return (
              <FrameView
                key={f.id}
                dir={dir} frame={f} rect={r} zoom={v.zoom} at={at}
                live={live.has(f.id)} interactive={g.liveId === f.id} selected={g.selected === f.id}
                base={p.base!} slug={slug} state={p.frameStates[f.id] ?? { kind: "placeholder" }}
                thumb={p.base && latest ? `${p.base}${slug}/.versions/v${latest}/thumbs/${f.id}.png?t=${thumbToken}` : null}
                thumbToken={thumbToken}
                inReview={inReview} pins={pinsOn[f.id] ?? 0}
                reloadTick={p.reloadTick}
                iframeRef={iframeRef(f.id)}
                onSelect={() => g.select(f.id)}
                onDragStart={(e) => g.onFrameDragStart(f.id, e)}
              />
            );
          })
        ) : null}
        {design && v && !comparing && !p.bad && pin && <PinLayer v={v} rects={drawn} pin={pin} located={p.located} />}
      </div>

      {v && frames.length > 0 && !p.bad && (
        <>
          <ZoomControls zoom={v.zoom} onZoom={g.zoomBy} onCycle={g.cycleZoom} onFit={g.fitAll} />
          <Minimap rects={Object.values(rects)} viewport={v} size={size} onPan={g.panTo} onPanEnd={g.commit} />
        </>
      )}
      <ReviewPill dir={dir} />
      <div aria-live="polite" className="sr-only">{announce}</div>
    </div>
  );
}
