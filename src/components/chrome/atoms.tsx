/*
 * DS atoms — the small compositions every deck repeats, values transcribed 1:1 from
 * the comps. All colors are token utilities from the bridge; no raw values.
 */
import type { ComponentProps, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CheckGlyph, ErrorGlyph } from "./icons";

/* ---- buttons: the two comp treatments on top of shadcn Button ---- */

/** Primary: 36px, --primary bg, radius 8 (comps: F1 hero, dialogs). */
export const BtnPrimary = ({ className, ...p }: ComponentProps<typeof Button>) => (
  <Button
    {...p}
    className={cn(
      "h-9 rounded-md px-4 text-[13px] font-medium",
      "bg-primary text-primary-foreground hover:bg-(--primary-hover)",
      "disabled:opacity-40",
      className,
    )}
  />
);

/** Secondary: 33–34px, transparent, --border-strong 1px, radius 8. */
export const BtnSecondary = ({ className, ...p }: ComponentProps<typeof Button>) => (
  <Button
    variant="outline"
    {...p}
    className={cn(
      "h-[34px] rounded-md border border-border-strong bg-transparent px-3.5 text-[13px] font-medium text-text-primary shadow-none",
      "hover:bg-fill-hover hover:text-text-primary dark:bg-transparent dark:hover:bg-fill-hover",
      "disabled:opacity-40",
      className,
    )}
  />
);

/* ---- typography atoms ---- */

/** Eyebrow: 10/400 UPPERCASE +0.09em in --text-dimmer. */
export const Eyebrow = ({ className, children }: { className?: string; children: ReactNode }) => (
  <span className={cn("text-[10px] uppercase tracking-[0.09em] text-text-dimmer", className)}>
    {children}
  </span>
);

/** kbd chip: mono 10.5, fill-subtle, radius 5 — passive, never bordered. */
export const Kbd = ({ className, children }: { className?: string; children: ReactNode }) => (
  <span
    className={cn(
      "rounded-[5px] bg-fill-subtle px-[5px] py-px font-mono text-[10.5px] text-text-dimmer",
      className,
    )}
  >
    {children}
  </span>
);

/** Passive id chip (R-1, T-014): mono 10.5, fill-subtle, radius 6. */
export const IdChip = ({ className, children }: { className?: string; children: ReactNode }) => (
  <span
    className={cn(
      "rounded-sm bg-fill-subtle px-1.5 py-px font-mono text-[10.5px] text-text-subtle",
      className,
    )}
  >
    {children}
  </span>
);

/** Mono metadata (paths, counts, timestamps) — tabular numerals always. */
export const MonoMeta = ({ className, children }: { className?: string; children: ReactNode }) => (
  <span className={cn("font-mono text-[11px] text-text-dimmer tabular-nums", className)}>
    {children}
  </span>
);

/* ---- status: always word + glyph/dot, never colour alone ---- */

export type StateKind = "neutral" | "running" | "success" | "error";

/** Dot/glyph + word. `running` pulses the dot (frozen under reduced motion). */
export function StateWord({
  kind,
  children,
  dotSize = 6,
  className,
}: {
  kind: StateKind;
  children: ReactNode;
  dotSize?: number;
  className?: string;
}) {
  if (kind === "success") {
    return (
      <span className={cn("inline-flex items-center gap-1.5 text-state-success", className)}>
        <CheckGlyph size={12} />
        {children}
      </span>
    );
  }
  if (kind === "error") {
    return (
      <span className={cn("inline-flex items-center gap-1.5 text-state-error", className)}>
        <ErrorGlyph size={12} />
        {children}
      </span>
    );
  }
  return (
    <span className={cn("inline-flex items-center gap-[5px] text-state-neutral", className)}>
      <span
        className="rounded-full bg-state-neutral"
        style={{
          width: dotSize,
          height: dotSize,
          animation: kind === "running" ? "wv-pulse 1.6s ease-in-out infinite" : undefined,
        }}
      />
      {children}
    </span>
  );
}

/** The neutral 0.7s spinner (13px ring; reduced motion freezes it to a static ring). */
export const Spinner = ({ size = 13, className }: { size?: number; className?: string }) => (
  <span
    aria-hidden
    className={cn("inline-block rounded-full border-[1.5px] border-state-neutral", className)}
    style={{
      width: size,
      height: size,
      borderTopColor: "transparent",
      animation: "wv-spin 0.7s linear infinite",
    }}
  />
);

/** Project mark tile — the one place hue appears (brand data, not UI). */
const MARK_BG = {
  1: "bg-mark-1",
  2: "bg-mark-2",
  3: "bg-mark-3",
  4: "bg-mark-4",
  5: "bg-mark-5",
  6: "bg-mark-6",
} as const;

export type MarkIndex = keyof typeof MARK_BG;

export function MarkTile({
  mark,
  label,
  size = 26,
  className,
  dashed = false,
}: {
  mark: MarkIndex;
  label: string;
  size?: number;
  className?: string;
  dashed?: boolean;
}) {
  return (
    <span
      className={cn(
        "flex items-center justify-center rounded-md text-[11px] font-semibold",
        dashed
          ? "border border-dashed border-border-strong bg-surface-card-raised text-text-dim"
          : cn(MARK_BG[mark], "text-black/60"),
        size === 22 && "rounded-[7px] text-[10px]",
        className,
      )}
      style={{ width: size, height: size }}
    >
      {label}
    </span>
  );
}
