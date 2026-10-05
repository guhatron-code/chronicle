/* The canvas's chrome (comps board 1): the 40 px toolbar over the canvas — the open
   design's title and kind — and the zoom control at the canvas's bottom-left.
   Score (once a critique exists) and History join the toolbar's right side; System
   arrives in a later sub-project and is not drawn here. */
import { useEffect, useState, type ReactNode } from "react";
import { KIND_LABEL, type DesignKind } from "@/lib/design-model";
import { designProjectFor, subscribeDesigns } from "@/lib/design-store";
import { ClockGlyph } from "@/components/chrome/icons";
import { cn } from "@/lib/utils";

/* kind glyphs, transcribed from design/comps/design-pane/gen.py's G dict */
const KIND_GLYPH: Record<DesignKind, ReactNode> = {
  ecommerce: <><path d="M3 5.5h10l-.8 8H3.8z" /><path d="M5.8 5.5V4.3a2.2 2.2 0 0 1 4.4 0v1.2" /></>,
  app: <><rect x="1.8" y="2.5" width="12.4" height="9" rx="1.2" /><path d="M5.5 14h5" /></>,
  marketing: <path d="M2.5 6.5v3h2l5 3v-9l-5 3zM12 5.5a3.5 3.5 0 0 1 0 5" />,
  brand: <><circle cx="8" cy="8" r="5.5" /><path d="M8 2.5v11M2.5 8h11" /></>,
  deck: <><rect x="2" y="3" width="12" height="8" rx="1" /><path d="M8 11v2.5M5.5 13.5h5" /></>,
};

const Glyph = ({ size, children }: { size: number; children: ReactNode }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.3} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);

export function CanvasToolbar({ dir, historyOpen, onToggleHistory, scoreOpen, onToggleScore }: {
  dir: string;
  /** the Score tab: shown once a critique exists */
  scoreOpen?: boolean;
  onToggleScore?: () => void;
  /** Task 19: the History segmented toggle — omitted where no History panel exists yet */
  historyOpen?: boolean;
  onToggleHistory?: () => void;
}) {
  const [, bump] = useState(0);
  useEffect(() => subscribeDesigns(() => bump((n) => n + 1)), []);
  const p = designProjectFor(dir);
  const row = p.rows.find((r) => r.slug === p.active);
  const title = row?.title ?? p.design?.title ?? p.active ?? "";
  const kind = row?.kind ?? p.design?.kind ?? null;
  const tab = (on: boolean) => cn(
    "inline-flex h-[26px] shrink-0 items-center gap-1.5 rounded-md px-[9px] text-[11.5px] outline-none",
    "focus-visible:[box-shadow:var(--focus-ring)]",
    on ? "bg-fill-hover text-text-primary" : "text-text-muted hover:bg-fill-hover hover:text-text-primary",
  );
  return (
    <div className="box-border flex h-10 shrink-0 items-center gap-2.5 border-b border-border-hairline pr-2.5 pl-3.5">
      <span className="min-w-0 truncate text-[12.5px] font-semibold text-text-primary">{title}</span>
      {kind && (
        <span className="inline-flex h-5 shrink-0 items-center gap-[5px] rounded-md bg-fill-subtle px-[7px] text-[11px] whitespace-nowrap text-text-subtle">
          <Glyph size={11}>{KIND_GLYPH[kind]}</Glyph>{KIND_LABEL[kind]}
        </span>
      )}
      <span className="flex-1" />
      {onToggleScore && p.critiques.length > 0 && (
        <button type="button" aria-pressed={!!scoreOpen} onClick={onToggleScore} className={tab(!!scoreOpen)}>
          <Glyph size={13}><path d="M3 13V8.5M8 13V3M13 13V6" /></Glyph>Score
        </button>
      )}
      {onToggleHistory && (
        <button type="button" aria-pressed={!!historyOpen} onClick={onToggleHistory} className={tab(!!historyOpen)}>
          <ClockGlyph size={13} />History
        </button>
      )}
    </div>
  );
}

const zoomBtn = "flex h-6 w-[26px] items-center justify-center rounded-[5px] text-[14px] text-text-subtle outline-none hover:bg-fill-hover hover:text-text-primary focus-visible:[box-shadow:var(--focus-ring)]";

/** Bottom-left of the canvas (comps `zoom_controls`): −, the percentage (a button
 *  that cycles fit → 100%), +, and fit. */
export function ZoomControls({ zoom, onZoom, onCycle, onFit }: { zoom: number; onZoom: (factor: number) => void; onCycle: () => void; onFit: () => void }) {
  const pct = `${Math.round(zoom * 100)}%`;
  return (
    <div className="absolute bottom-3.5 left-3.5 flex items-center gap-0.5 rounded-lg border border-border-hairline bg-surface-overlay p-[3px]">
      <button type="button" aria-label="Zoom out" className={zoomBtn} onClick={() => onZoom(0.8)}>−</button>
      <button type="button" aria-label={`Zoom ${pct}, switch between fit and 100%`} className="h-6 rounded-[5px] px-1.5 font-mono text-[11px] text-text-secondary outline-none hover:bg-fill-hover focus-visible:[box-shadow:var(--focus-ring)]" onClick={onCycle}>
        {pct}
      </button>
      <button type="button" aria-label="Zoom in" className={zoomBtn} onClick={() => onZoom(1.25)}>+</button>
      <span className="h-3.5 w-px bg-divider" />
      <button type="button" aria-label="Fit all frames" className={zoomBtn} onClick={onFit}>
        <Glyph size={14}><path d="M2 5.5V2h3.5M10.5 2H14v3.5M14 10.5V14h-3.5M5.5 14H2v-3.5" /></Glyph>
      </button>
    </div>
  );
}
