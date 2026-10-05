/* The thread cards' shared pieces, transcribed from the comps (gen.py `card`,
   `tool_row`, `eyebrow`, `state_word`, `score_chip`). Token utilities only. */
import type { ComponentProps, ReactNode } from "react";
import { BtnSecondary } from "@/components/chrome/atoms";
import { CheckGlyph, ErrorGlyph } from "@/components/chrome/icons";
import { cn } from "@/lib/utils";

/** gen.py `card`: margin 4/14/6/50, radius 8, hairline border, card surface. */
export function Card({ className, children, label }: { className?: string; children: ReactNode; label?: string }) {
  return (
    <section aria-label={label} className={cn("mx-3.5 mb-1.5 ml-[50px] mt-1 rounded-lg border border-border-hairline bg-surface-card", className)}>
      {children}
    </section>
  );
}

/** gen.py `eyebrow`: 10 px uppercase, +0.09em, faint. */
export const Eyebrow = ({ children, className }: { children: ReactNode; className?: string }) => (
  <span className={cn("text-[10px] uppercase tracking-[0.09em] text-text-faint", className)}>{children}</span>
);

/** The card header row: eyebrow on the left, state on the right, divider below. */
export const CardHead = ({ title, children, divider = true }: { title: string; children?: ReactNode; divider?: boolean }) => (
  <div className={cn("flex items-center gap-2 px-3 py-[9px]", divider && "border-b border-divider")}>
    <Eyebrow>{title}</Eyebrow>
    <span className="flex-1" />
    {children}
  </div>
);

export type Tone = "success" | "error" | "warn" | "neutral";
const TONE_TEXT: Record<Tone, string> = { success: "text-state-success", error: "text-state-error", warn: "text-state-warn", neutral: "text-state-neutral" };
const TONE_BG: Record<Tone, string> = { success: "bg-state-success", error: "bg-state-error", warn: "bg-state-warn", neutral: "bg-state-neutral" };

/** gen.py `dot`: 5 px, pulsing when `pulse`. */
export const Dot = ({ tone, pulse }: { tone: Tone; pulse?: boolean }) => (
  <span aria-hidden className={cn("size-[5px] shrink-0 rounded-full", TONE_BG[tone])}
    style={pulse ? { animation: "wv-pulse 1.6s ease-in-out infinite" } : undefined} />
);

/** gen.py `state_word`: 11.5 px in the tone, a dot before it (pulsing for neutral). */
export const StateWord = ({ word, tone }: { word: string; tone: Tone }) => (
  <span className={cn("inline-flex min-w-0 items-center gap-[5px] text-[11.5px]", TONE_TEXT[tone])}>
    <Dot tone={tone} pulse={tone === "neutral"} />
    <span className="truncate">{word}</span>
  </span>
);

/** gen.py `score_chip`: 18 px, mono 10.5, success when passed, warn when not. */
export const ScoreChip = ({ value, passed }: { value: string; passed: boolean }) => (
  <span className={cn("inline-flex h-[18px] shrink-0 items-center gap-1 whitespace-nowrap rounded-[5px] bg-fill-subtle px-1.5 font-mono text-[10.5px]", passed ? "text-state-success" : "text-state-warn")}>
    {value}
  </span>
);

/** The spinner tool rows use: 10 px ring, open at the top. */
export const RingSpinner = () => (
  <span aria-hidden className="size-2.5 rounded-full border-[1.5px] border-state-neutral border-t-transparent"
    style={{ animation: "wv-spin .7s linear infinite" }} />
);

export type RowState = "done" | "run" | "fail" | "queued";
const ROW_SR: Record<RowState, string> = { done: "done", run: "running", fail: "failed", queued: "queued" };

/** gen.py `tool_row`: 28 px, a 12 px state slot, the label, a mono detail. */
export function ToolRow({ label, detail, state }: { label: string; detail?: string; state: RowState }) {
  return (
    <div className="flex h-7 items-center gap-2 px-2.5">
      <span className="flex w-3 shrink-0 justify-center">
        {state === "done" && <span className="flex text-state-success"><CheckGlyph size={11} /></span>}
        {state === "run" && <RingSpinner />}
        {state === "fail" && <span className="flex text-state-error"><ErrorGlyph size={12} /></span>}
        {state === "queued" && <span aria-hidden className="size-2.5 rounded-full border-[1.5px] border-border-strong" />}
        <span className="sr-only">{ROW_SR[state]}</span>
      </span>
      <span className="whitespace-nowrap text-[12px] text-text-secondary">{label}</span>
      {detail ? <span className="min-w-0 truncate font-mono text-[10.5px] text-text-faint">{detail}</span> : null}
    </div>
  );
}

/** gen.py `btn(kind="ghost")`: transparent, no border, secondary text. */
export const BtnGhost = ({ className, ...p }: ComponentProps<typeof BtnSecondary>) => (
  <BtnSecondary {...p} className={cn("border-transparent text-text-secondary dark:border-transparent", className)} />
);
