/*
 * F19 (Deck 3) — the "What needs you" panel. One-click actions run for real;
 * roadmap-authored actions are copy-only, reviewed before running. The full command
 * is always WRAPPED, never truncated. Presentational only.
 */
import type { ReactNode } from "react";
import { BtnPrimary, BtnSecondary } from "@/components/chrome/atoms";
import { CheckGlyph, CopyGlyph } from "@/components/chrome/icons";
import { cn } from "@/lib/utils";
import { DashedBadge, TinyBadge } from "./bits";

export type NeedsYouRow = {
  id: string;
  /** Manifest-authored provenance — renders the dashed badge on any kind. */
  fromRoadmap?: boolean;
  /** 14px glyph for the 30px tile (UploadGlyph / FolderSimpleGlyph / CodeGlyph, …). */
  icon: ReactNode;
  title: string;
  sub: string;
  command: string;
} & (
  | {
      kind: "one-click";
      /** The highlighted first row — fill-subtle bg, bordered tile, "Next up" badge. */
      hi?: boolean;
      primary?: boolean;
      actionLabel: string;
      onAction?: () => void;
    }
  | { kind: "copy-only"; onCopy?: () => void }
);

export type NeedsYouProps =
  | { kind: "list"; rows: NeedsYouRow[]; className?: string }
  | { kind: "empty"; className?: string };

function Row({ row, last }: { row: NeedsYouRow; last: boolean }) {
  const hi = row.kind === "one-click" && row.hi;
  return (
    <div
      className={cn(
        "flex gap-3 px-[13px] py-3",
        !last && "border-b border-divider-faint",
        hi && "bg-fill-subtle",
      )}
    >
      <span
        className={cn(
          "flex size-[30px] shrink-0 items-center justify-center rounded-md bg-surface-card-raised text-text-secondary",
          hi && "border border-border-strong",
        )}
      >
        {row.icon}
      </span>
      <div className="flex flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="min-w-0 text-[13.5px] font-medium text-text-primary">{row.title}</span>
          {hi && <TinyBadge>Next up</TinyBadge>}
          {(row.fromRoadmap || row.kind === "copy-only") && (
            <DashedBadge>From the roadmap · review before running</DashedBadge>
          )}
        </div>
        {row.sub !== "" && <div className="text-[12.5px] text-text-muted">{row.sub}</div>}
        {row.command !== "" && (
          <div className="font-mono text-[11.5px] text-text-dim [overflow-wrap:anywhere]">
            {row.command}
          </div>
        )}
      </div>
      {row.kind === "one-click" ? (
        row.primary ? (
          <BtnPrimary
            className="h-[31px] shrink-0 self-center px-3 text-[12.5px]"
            onClick={row.onAction}
          >
            {row.actionLabel}
          </BtnPrimary>
        ) : (
          <BtnSecondary
            className="h-[31px] shrink-0 self-center px-3 text-[12.5px]"
            onClick={row.onAction}
          >
            {row.actionLabel}
          </BtnSecondary>
        )
      ) : row.command !== "" ? (
        <BtnSecondary
          className="h-[31px] shrink-0 gap-1.5 self-center px-3 text-[12.5px]"
          onClick={row.onCopy}
        >
          <CopyGlyph size={12} />
          Copy the command
        </BtnSecondary>
      ) : null}
    </div>
  );
}

export function NeedsYou(p: NeedsYouProps) {
  if (p.kind === "empty") {
    return (
      <div
        className={cn(
          "flex items-center gap-2.5 py-[18px]",
          p.className,
        )}
      >
        <CheckGlyph size={14} className="text-state-success" />
        <span className="text-[13px] text-text-secondary">Nothing needs you right now.</span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "py-[18px]",
        p.className,
      )}
    >
      <div className="pb-[9px] text-[15px] font-semibold text-text-primary">
        What needs you
      </div>
      <div className="overflow-hidden rounded-lg">
        {p.rows.map((row, i) => (
          <Row key={row.id} row={row} last={i === p.rows.length - 1} />
        ))}
      </div>
    </div>
  );
}
