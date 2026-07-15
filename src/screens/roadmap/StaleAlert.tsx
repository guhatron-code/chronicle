/*
 * F16 (Deck 3) — the stale-roadmap alert. Default + scanning (disabled primary with
 * a primary-fg spinner). Presentational only.
 */
import { BtnPrimary } from "@/components/chrome/atoms";
import { ClockGlyph } from "@/components/chrome/icons";
import { cn } from "@/lib/utils";

export type StaleAlertProps = {
  scanning?: boolean;
  onScan?: () => void;
  className?: string;
};

export function StaleAlert({ scanning = false, onScan, className }: StaleAlertProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-[11px] py-[18px]",
        className,
      )}
    >
      <ClockGlyph size={14} className="shrink-0 text-text-subtle" />
      <span className="text-[12.5px] text-text-secondary">
        The plan documents changed since this roadmap was written.
      </span>
      <span className="flex-1" />
      {scanning ? (
        <BtnPrimary size="sm"
 disabled
 className="gap-2 disabled:opacity-55">
          <span
            aria-hidden
            className="inline-block size-[11px] rounded-full border-[1.5px] border-(--primary-fg)"
            style={{ borderTopColor: "transparent", animation: "wv-spin 0.7s linear infinite" }}
          />
          Rebuilding…
        </BtnPrimary>
      ) : (
        <BtnPrimary size="sm" onClick={onScan}>
          Rebuild
        </BtnPrimary>
      )}
    </div>
  );
}
