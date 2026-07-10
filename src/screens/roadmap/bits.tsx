/*
 * C3 shared micro-bits — the tiny compositions the roadmap frames repeat
 * (F15 / F18 / F19 / F21 / F22). Values transcribed 1:1 from the decks; tokens only.
 */
import type { ReactNode } from "react";
import { ChevronDownGlyph, ChevronUpGlyph } from "@/components/chrome/icons";
import { cn } from "@/lib/utils";

/** Passive 15px-line badge chip — fill-subtle, radius 5, NO border (de-boxing law).
 *  (F15 "changed just now" · F18 "new"/"edited" · F19 "next up" · F21 FX badge.) */
export const TinyBadge = ({ className, children }: { className?: string; children: ReactNode }) => (
  <span
    className={cn(
      "rounded-[5px] bg-fill-subtle px-[5px] text-[10.5px] leading-[15px] text-text-subtle",
      className,
    )}
  >
    {children}
  </span>
);

/** Dashed provenance badge (F19 "from the roadmap · review before running"). */
export const DashedBadge = ({ children }: { children: ReactNode }) => (
  <span className="rounded-[5px] border border-dashed border-border-strong px-1.5 text-[10.5px] leading-4 text-text-subtle">
    {children}
  </span>
);

/** Mono file chip with an optional sans hint — the "you paste" chip family
 *  (F21 expanded h27 on card · F21 FX h26 raised · F22 h28 raised). */
export function PasteChip({
  name,
  hint,
  height = 27,
  raised = false,
  onClick,
  className,
}: {
  name: string;
  hint?: string;
  height?: number;
  raised?: boolean;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border border-border-hairline px-2.5 font-mono text-[11.5px] text-text-secondary",
        "hover:border-border-strong hover:text-text-primary",
        raised ? "bg-surface-card-raised" : "bg-surface-card",
        className,
      )}
      style={{ height }}
    >
      {name}
      {hint && <span className="font-sans text-[10.5px] text-text-subtle">{hint}</span>}
    </button>
  );
}

/** 24px expand/collapse twisty (F21 phase cards). */
export const Twisty = ({
  open,
  label,
  onClick,
}: {
  open?: boolean;
  label: string;
  onClick?: () => void;
}) => (
  <button
    aria-label={label}
    onClick={onClick}
    className="flex size-6 shrink-0 items-center justify-center rounded-sm text-text-dim hover:bg-fill-hover"
  >
    {open ? <ChevronUpGlyph size={11} /> : <ChevronDownGlyph size={11} />}
  </button>
);

/** The accordion body wrapper — grid-rows 0fr↔1fr so open AND close both animate.
 *  Content stays mounted; reduced motion freezes the transition globally. */
export function AccBody({
  open,
  children,
  className,
}: {
  open: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className="grid transition-[grid-template-rows] duration-200 ease-out"
      style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
      aria-hidden={!open}
      inert={!open} // a closed body must not catch focus or clicks
    >
      <div className={cn("min-h-0 overflow-hidden", className)}>{children}</div>
    </div>
  );
}
