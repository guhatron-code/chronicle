/*
 * F20 (Deck 3) — the always-on documents panel + doc chips. Click = copy, and the
 * chip says so; the flash confirms, then a toast (F8). Five chip states: default ·
 * flash-on-copy · missing · paste · ghost. Presentational only.
 */
import { CheckGlyph, DocGlyph } from "@/components/chrome/icons";
import { cn } from "@/lib/utils";

export type DocChipProps =
  | { kind: "default"; name: string; onCopy?: () => void }
  | { kind: "copied"; name: string }
  | { kind: "missing"; name: string; note: string } // e.g. "not written yet"
  | { kind: "paste"; name: string; hint: string; note?: string; onCopy?: () => void } // chip: "→ Claude Code" · note renders OUTSIDE
  | { kind: "ghost"; name: string; note: string }; // e.g. "written when EL-1 begins"

export function DocChip(p: DocChipProps) {
  if (p.kind === "missing") {
    return (
      <span className="inline-flex h-[30px] items-center gap-[7px] rounded-md border border-dashed border-border-strong px-[11px] font-mono text-xs text-text-dim">
        <DocGlyph size={12} fold={false} />
        {p.name}
        <span className="font-sans text-[11px] text-text-dimmer">{p.note}</span>
      </span>
    );
  }
  if (p.kind === "ghost") {
    return (
      <span className="inline-flex h-[30px] items-center gap-[7px] rounded-md border border-dashed border-border-hairline px-[11px] font-mono text-xs text-text-dimmer">
        {p.name}
        <span className="font-sans text-[11px]">{p.note}</span>
      </span>
    );
  }
  if (p.kind === "copied") {
    return (
      <button className="inline-flex h-[30px] items-center gap-[7px] rounded-md border border-border-field-focus bg-fill-hover px-[11px] font-mono text-xs text-text-primary">
        <CheckGlyph size={12} className="text-state-success" />
        {p.name} · copied
      </button>
    );
  }
  return (
    <button
      onClick={p.onCopy}
      className="inline-flex h-[30px] shrink-0 items-center gap-[7px] whitespace-nowrap rounded-md border border-border-hairline bg-surface-card-raised px-[11px] font-mono text-xs text-text-secondary hover:border-border-strong hover:text-text-primary"
    >
      {p.kind === "default" && <DocGlyph size={12} />}
      {p.name}
      {p.kind === "paste" && (
        <span className="font-sans text-[11px] text-text-subtle">{p.hint}</span>
      )}
    </button>
  );
}

export type DocumentsPanelProps = {
  chips: DocChipProps[];
  className?: string;
};

export function DocumentsPanel({ chips, className }: DocumentsPanelProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-2.5 py-[26px]",
        className,
      )}
    >
      <div className="flex items-baseline justify-between">
        <span className="text-[15px] font-semibold text-text-primary">Always-on documents</span>
        <span className="text-[11.5px] text-text-dim">click a file to copy it</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {chips.filter((c) => c.kind !== "paste").map((chip, i) => (
          <DocChip key={`${chip.name}-${i}`} {...chip} />
        ))}
      </div>
      {chips.filter((c) => c.kind === "paste").map((chip, i) => (
        // a paste target is a row: the chip stays one line; the when-note is
        // plain prose OUTSIDE it (C4 law: into IN the chip, note OUTSIDE)
        <div key={`p-${chip.name}-${i}`} className="flex flex-wrap items-center gap-2.5">
          <DocChip {...chip} />
          {chip.kind === "paste" && chip.note && (
            <span className="text-[11.5px] leading-[1.5] text-text-subtle">{chip.note}</span>
          )}
        </div>
      ))}
    </div>
  );
}
