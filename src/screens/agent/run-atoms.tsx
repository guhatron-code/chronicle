/*
 * The pieces the run card, the lane view and the notes card share — each a
 * transcription of one gen.py helper (sw, mono, tchip, chat_btn, check_row,
 * decision_line, leak_notice, divider_label).
 */
import type { ReactNode } from "react";
import { Spinner } from "@/components/chrome/atoms";
import { CheckGlyph, ErrorGlyph, SparkGlyph, WarnGlyph } from "@/components/chrome/icons";
import type { CheckRowView, Word } from "@/lib/runs-model";
import { cn } from "@/lib/utils";

const TONE: Record<Word["tone"], string> = {
  neutral: "text-state-neutral", success: "text-state-success", warn: "text-state-warn", error: "text-state-error", dim: "text-text-dim",
};

/** gen.py `sw`: a check, an error or a warn glyph, or a dot that pulses while running. */
export function RunWord({ w, size = 11.5 }: { w: Word; size?: number }) {
  return (
    <span className={cn("inline-flex items-center gap-[5px] whitespace-nowrap", TONE[w.tone])} style={{ fontSize: size }}>
      {w.tone === "success" ? <CheckGlyph size={12} /> : w.tone === "error" ? <ErrorGlyph size={12} /> : w.tone === "warn" ? <WarnGlyph size={12} /> : (
        <span aria-hidden className="size-[5px] shrink-0 rounded-full bg-current" style={w.pulse ? { animation: "wv-pulse var(--dur-pulse) ease-in-out infinite" } : undefined} />
      )}
      <span key={w.word} className="wv-word">{w.word}</span>
    </span>
  );
}

export const Mono = ({ children, className }: { children: ReactNode; className?: string }) => (
  <span className={cn("whitespace-nowrap font-mono text-[10.5px] tabular-nums text-text-dim", className)}>{children}</span>
);

export const Chip = ({ children }: { children: ReactNode }) => (
  <span className="inline-flex h-[18px] items-center whitespace-nowrap rounded-[5px] bg-fill-subtle px-1.5 font-mono text-[10px] text-text-subtle">{children}</span>
);

const BTN = {
  primary: "border-primary bg-primary text-primary-foreground hover:bg-(--primary-hover)",
  secondary: "border-border-strong text-text-primary hover:bg-fill-hover",
  quiet: "border-border-hairline text-text-muted hover:bg-fill-hover hover:text-text-primary",
};
export function ChatBtn({ kind = "secondary", onClick, disabled, children }: { kind?: keyof typeof BTN; onClick?: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={cn("h-[26px] whitespace-nowrap rounded-lg border px-[11px] text-[11.5px] font-medium disabled:opacity-50", BTN[kind])}>
      {children}
    </button>
  );
}

export function CheckRow({ row }: { row: CheckRowView }) {
  const lead = row.state === "pass" ? <span className="flex text-state-success"><CheckGlyph size={12} /></span>
    : row.state === "fail" ? <span className="flex text-state-error"><ErrorGlyph size={12} /></span>
    : row.state === "run" ? <Spinner size={10} />
    : <span className="inline-block size-2.5 rounded-full border-[1.5px] border-border-strong" />;
  return (
    <div className="flex h-[26px] items-center gap-2">
      <span className="flex w-3 justify-center">{lead}</span>
      <Mono className="text-[11px] text-text-secondary">{row.name}</Mono>
      <span className={cn("text-[11.5px]", row.state === "fail" ? "text-state-error" : row.state === "queued" ? "text-text-dim" : "text-text-muted")}>{row.word}</span>
      <span className="flex-1" />
      <Mono>{row.dur}</Mono>
    </div>
  );
}

export function DecisionLine({ children, prob }: { children: ReactNode; prob: string }) {
  return (
    <div className="mx-3.5 my-0.5 flex items-start gap-2 rounded-md border border-border-hairline bg-surface-card px-[11px] py-[7px]">
      <span className="mt-px flex shrink-0 text-text-subtle"><SparkGlyph size={12} /></span>
      <span className="flex-1 text-xs leading-[1.55] text-text-muted">{children}</span>
      <Mono>{prob}</Mono>
    </div>
  );
}

export function LeakNotice({ parts }: { parts: { lead: string; path: string; tail: string } }) {
  return (
    <div className="mb-2 ml-[18px] mr-0.5 flex items-start gap-[7px] rounded-md border border-border-hairline bg-fill-subtle px-2.5 py-[7px]">
      <span className="mt-px flex shrink-0 text-state-warn"><WarnGlyph size={12} /></span>
      <span className="text-[11.5px] leading-normal text-text-muted">{parts.lead}<Mono className="text-text-secondary">{parts.path}</Mono>{parts.tail}</span>
    </div>
  );
}

export function Divider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 px-3.5 py-1.5">
      <span className="h-px flex-1 bg-divider" />
      <span className="whitespace-nowrap text-[10.5px] text-text-faint">{label}</span>
      <span className="h-px flex-1 bg-divider" />
    </div>
  );
}
