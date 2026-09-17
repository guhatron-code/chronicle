/* One frame on the Design canvas (spec §7, comps board 1 and board 9). A picture by
   default — the latest thumbnail, or a live iframe when the canvas says so — with the
   name strip above it, the fold line at its declared height, and, when the page
   didn't render, a card that says where it stopped and sends that to the session. */
import { useState, type PointerEvent as ReactPointerEvent } from "react";
import { BtnPrimary } from "@/components/chrome/atoms";
import type { Rect } from "@/lib/canvas-math";
import type { Frame } from "@/lib/design-model";
import { sendDesignMessage, type FrameState } from "@/lib/design-store";
import { toastError } from "@/overlays/toasts";
import { cn } from "@/lib/utils";

/** The name strip's height plus its gap to the frame, in screen px (comps: 20 + 6). */
export const STRIP = 26;

export const stateWordOf = (s: FrameState) =>
  s.kind === "failed" ? "didn't render" : s.kind === "rendered" ? "rendered" : "rendering";

export function FrameView(props: {
  dir: string; frame: Frame; rect: Rect; zoom: number; live: boolean; interactive: boolean; selected: boolean;
  base: string; slug: string; state: FrameState; thumb: string | null; reloadTick: number;
  /** screen position of the frame's top-left corner (worldToScreen of rect, plus any drag offset) */
  at: { x: number; y: number };
  iframeRef: (el: HTMLIFrameElement | null) => void;
  onSelect: () => void; onDragStart: (e: ReactPointerEvent) => void;
}) {
  const { dir, frame, rect, zoom, live, interactive, selected, base, slug, state, thumb, reloadTick, at } = props;
  const w = rect.w * zoom, h = rect.h * zoom;
  const word = stateWordOf(state);
  // Keyed by URL, not a DOM mutation: a thumbnail can 404 (e.g. a version that
  // predates this frame) without ever un-404ing for the same URL, so once a
  // src fails it stays failed until a different thumb prop arrives.
  const [thumbFailed, setThumbFailed] = useState<Set<string>>(() => new Set());
  const grab = (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    props.onSelect();
    props.onDragStart(e);
  };
  const askFix = () => {
    if (state.kind !== "failed") return;
    sendDesignMessage(dir, `The frame ${frame.file} didn't render: ${state.message} (line ${state.line}). Fix it.`)
      .catch((err) => toastError("Couldn't send that to the design session", String(err?.message ?? err)));
  };

  return (
    <div
      role="group"
      aria-label={`${frame.label}, ${frame.width} wide, ${word}`}
      tabIndex={-1}
      data-frame={frame.id}
      className="absolute outline-none"
      style={{ left: at.x, top: at.y, width: w, height: h }}
      // Keep keyboard focus on the canvas: a press here must not move it to this group
      // (the canvas's live region announces the selection instead). Clicks still fire.
      onMouseDown={(e) => e.preventDefault()}
    >
      {/* name strip */}
      <div
        className="absolute left-0 flex h-5 items-center gap-2 overflow-hidden whitespace-nowrap select-none"
        style={{ top: -STRIP, width: Math.max(w, 0), minWidth: 0 }}
        onPointerDown={grab}
      >
        <span className={cn("min-w-0 truncate text-[11.5px]", selected ? "text-text-primary" : "text-text-subtle")}>{frame.label}</span>
        <span className="shrink-0 font-mono text-[10.5px] text-text-faint">{frame.width}</span>
        <span className="flex-1" />
        {state.kind === "failed" ? (
          <span className="inline-flex shrink-0 items-center gap-[5px] text-[11.5px] text-state-error">
            <span className="size-[5px] rounded-full bg-state-error" />didn't render
          </span>
        ) : live && state.kind !== "rendered" ? (
          <span className="inline-flex shrink-0 items-center gap-[5px] text-[11.5px] text-state-neutral">
            <span className="size-[5px] rounded-full bg-state-neutral" style={{ animation: "wv-pulse 1.6s ease-in-out infinite" }} />rendering
          </span>
        ) : null}
      </div>

      {/* body */}
      <div
        className="absolute inset-0 overflow-hidden rounded-[2px] shadow-[0_0_0_1px_var(--border-hairline)]"
        style={{ outline: selected ? "2px solid var(--text-primary)" : undefined, outlineOffset: selected ? 3 : undefined }}
        onPointerDown={interactive ? undefined : grab}
      >
        {live ? (
          <iframe
            key={reloadTick}
            ref={props.iframeRef}
            src={`${base}${slug}/${frame.file}`}
            sandbox="allow-scripts"
            title={frame.label}
            width={frame.width}
            height={rect.h}
            style={{ transform: `scale(${zoom})`, transformOrigin: "0 0", border: 0, pointerEvents: interactive ? "auto" : "none", background: "white", display: "block" }}
          />
        ) : thumb && !thumbFailed.has(thumb) ? (
          <img
            src={thumb}
            alt=""
            draggable={false}
            className="block object-cover object-top select-none"
            style={{ width: w, height: h }}
            onError={() => setThumbFailed((s) => (s.has(thumb) ? s : new Set(s).add(thumb)))}
          />
        ) : thumb ? (
          <div className="flex size-full items-center justify-center rounded-[2px] bg-fill-subtle text-center text-[11px] text-text-faint">
            Not in this version
          </div>
        ) : (
          <div className="size-full bg-fill-subtle" />
        )}
        {rect.h > frame.height && (
          <div className="pointer-events-none absolute right-0 left-0 border-t border-dashed border-border-strong" style={{ top: frame.height * zoom }} />
        )}
      </div>

      {state.kind === "failed" && (
        <div
          className="absolute top-0 left-0 flex w-[240px] flex-col gap-2 rounded-[2px] border border-border-strong bg-surface-card p-3.5"
          onPointerDown={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <span className="text-[12px] text-text-primary">
            {state.line > 0 ? `The page stopped at line ${state.line}.` : "The page didn't render."}
          </span>
          <span className="font-mono text-[10.5px] leading-normal break-words text-text-faint">{state.message}</span>
          <div className="mt-1 flex gap-1.5">
            <BtnPrimary size="sm" onClick={askFix}>Ask the design session to fix it</BtnPrimary>
          </div>
        </div>
      )}
    </div>
  );
}
