/*
 * F14 (Deck 2) — the roadmap warning banner. Non-alarming: hairline card, glyph +
 * words, a bordered action, a quiet dismiss. Presentational only.
 */
import { WarnGlyph, XGlyph } from "@/components/chrome/icons";
import { cn } from "@/lib/utils";

export type WarningBannerProps = {
  /** N in "N rules in this roadmap can't be checked". */
  count: number;
  onRebuild?: () => void;
  onDismiss?: () => void;
  className?: string;
};

export function WarningBanner({ count, onRebuild, onDismiss, className }: WarningBannerProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-[11px] py-[18px]",
        className,
      )}
    >
      <WarnGlyph size={14} className="shrink-0 text-text-subtle" />
      <span className="text-[12.5px] text-text-secondary">
        {count} rule{count === 1 ? "" : "s"} in this roadmap can't be checked — statuses may be incomplete.
      </span>
      <span className="flex-1" />
      <button
        onClick={onRebuild}
        className="h-[27px] shrink-0 rounded-md border border-border-strong px-[11px] text-xs font-medium text-text-primary hover:bg-fill-hover"
      >
        Rebuild the roadmap
      </button>
      <button
        aria-label="Dismiss"
        onClick={onDismiss}
        className="flex size-6 shrink-0 items-center justify-center rounded-sm text-text-dim hover:bg-fill-hover hover:text-text-secondary"
      >
        <XGlyph size={10} />
      </button>
    </div>
  );
}
