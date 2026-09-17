/* Compare mode (comps board 7, the `split` half of `b_history`): once History has a
   version selected, the canvas swaps its normal frame rendering for two thumbnail
   halves at the same viewport — the compared version on the left, the current one
   on the right — with a 1 px divider between them. Pan and zoom move both halves
   together because both read the same `v`. DesignCanvas owns clearing `compare`
   on Esc/close; this only draws. */
import { useState } from "react";
import { worldToScreen, type Rect, type Viewport } from "@/lib/canvas-math";
import type { Frame } from "@/lib/design-model";

/** The app can't read a version's own design.json from the frontend (no IPC
 *  for it, and the CSP blocks a fetch of chronicle-file:), so both halves draw
 *  the CURRENT frame list — a frame added or removed between versions just
 *  404s on one side, caught below rather than left as a broken-image icon. */
function Half({ frames, rects, v, base, slug, n, label, hintOnFail }: {
  frames: Frame[]; rects: Record<string, Rect>; v: Viewport; base: string; slug: string; n: number; label: string;
  /** append " · some frames differ" to this half's chip once any thumbnail 404s */
  hintOnFail?: boolean;
}) {
  // Keyed by URL, not a DOM mutation: once a src 404s it stays failed (it names
  // a specific version's thumb, which never appears later) until this half
  // re-renders for a different version/frame set.
  const [failed, setFailed] = useState<Set<string>>(() => new Set());
  const anyFailed = failed.size > 0;
  return (
    <div className="relative flex-1 overflow-hidden">
      {frames.map((f) => {
        const r = rects[f.id];
        if (!r) return null;
        const at = worldToScreen(v, r.x, r.y);
        const w = r.w * v.zoom, h = r.h * v.zoom;
        const src = `${base}${slug}/.versions/v${n}/thumbs/${f.id}.png`;
        if (failed.has(src)) {
          return (
            <div
              key={f.id}
              className="absolute flex items-center justify-center rounded-[2px] bg-fill-subtle text-center text-[11px] text-text-faint shadow-[0_0_0_1px_var(--border-hairline)]"
              style={{ left: at.x, top: at.y, width: w, height: h }}
            >
              Not in this version
            </div>
          );
        }
        return (
          <img
            key={f.id}
            src={src}
            alt=""
            draggable={false}
            className="absolute block rounded-[2px] object-cover object-top shadow-[0_0_0_1px_var(--border-hairline)]"
            style={{ left: at.x, top: at.y, width: w, height: h }}
            onError={() => setFailed((s) => (s.has(src) ? s : new Set(s).add(src)))}
          />
        );
      })}
      <span className="pointer-events-none absolute top-3 left-3 inline-flex h-5 items-center rounded-md bg-fill-subtle px-[7px] font-mono text-[10.5px] text-text-subtle">
        {label}{hintOnFail && anyFailed ? " · some frames differ" : ""}
      </span>
    </div>
  );
}

export function DesignCompare({ frames, rects, v, base, slug, compare, newest }: {
  frames: Frame[]; rects: Record<string, Rect>; v: Viewport; base: string; slug: string; compare: number; newest: number;
}) {
  return (
    <div className="absolute inset-0 flex">
      <Half frames={frames} rects={rects} v={v} base={base} slug={slug} n={compare} label={`v${compare}`} hintOnFail />
      <div className="w-px shrink-0 bg-border-strong" />
      <Half frames={frames} rects={rects} v={v} base={base} slug={slug} n={newest} label={`v${newest} · current`} />
    </div>
  );
}
