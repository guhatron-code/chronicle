/* Compare mode (comps board 7, the `split` half of `b_history`): once History has a
   version selected, the canvas swaps its normal frame rendering for two thumbnail
   halves at the same viewport — the compared version on the left, the current one
   on the right — with a 1 px divider between them. Pan and zoom move both halves
   together because both read the same `v`. DesignCanvas owns clearing `compare`
   on Esc/close; this only draws. */
import { worldToScreen, type Rect, type Viewport } from "@/lib/canvas-math";
import type { Frame } from "@/lib/design-model";

function Half({ frames, rects, v, base, slug, n, label }: {
  frames: Frame[]; rects: Record<string, Rect>; v: Viewport; base: string; slug: string; n: number; label: string;
}) {
  return (
    <div className="relative flex-1 overflow-hidden">
      {frames.map((f) => {
        const r = rects[f.id];
        if (!r) return null;
        const at = worldToScreen(v, r.x, r.y);
        return (
          <img
            key={f.id}
            src={`${base}${slug}/.versions/v${n}/thumbs/${f.id}.png`}
            alt=""
            draggable={false}
            className="absolute block rounded-[2px] object-cover object-top shadow-[0_0_0_1px_var(--border-hairline)]"
            style={{ left: at.x, top: at.y, width: r.w * v.zoom, height: r.h * v.zoom }}
          />
        );
      })}
      <span className="pointer-events-none absolute top-3 left-3 inline-flex h-5 items-center rounded-md bg-fill-subtle px-[7px] font-mono text-[10.5px] text-text-subtle">
        {label}
      </span>
    </div>
  );
}

export function DesignCompare({ frames, rects, v, base, slug, compare, newest }: {
  frames: Frame[]; rects: Record<string, Rect>; v: Viewport; base: string; slug: string; compare: number; newest: number;
}) {
  return (
    <div className="absolute inset-0 flex">
      <Half frames={frames} rects={rects} v={v} base={base} slug={slug} n={compare} label={`v${compare}`} />
      <div className="w-px shrink-0 bg-border-strong" />
      <Half frames={frames} rects={rects} v={v} base={base} slug={slug} n={newest} label={`v${newest} · current`} />
    </div>
  );
}
