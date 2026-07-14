/*
 * F15 (Deck 3) — the current-state banner, the hero of the roadmap. One glance, one
 * next step. Four states: normal · just-switched (quiet emphasis) · waiting-on-you ·
 * all-done. Presentational only.
 */
import type { ReactNode } from "react";
import { BtnPrimary, BtnSecondary, Eyebrow, IdChip, StateWord } from "@/components/chrome/atoms";
import { CheckGlyph, ClockGlyph } from "@/components/chrome/icons";
import { cn } from "@/lib/utils";
import { TinyBadge } from "./bits";

export type UpNext = { id: string; name: string };

export type CurrentStateBannerProps =
  | {
      kind: "normal";
      phaseId: string;
      phaseName: string;
      statusWord: string;
      /** Pulses the status dot (frozen under reduced motion). */
      running?: boolean;
      body: ReactNode;
      upNext?: UpNext;
      className?: string;
    }
  | {
      kind: "just-switched";
      phaseId: string;
      phaseName: string;
      statusWord: string;
      body: ReactNode;
      upNext?: UpNext;
      className?: string;
    }
  | {
      kind: "waiting";
      phaseId: string;
      phaseName: string;
      body: ReactNode;
      actionLabel: string;
      onAction?: () => void;
      className?: string;
    }
  | {
      kind: "all-done";
      body: ReactNode;
      onAddNext?: () => void;
      onRebuild?: () => void;
      className?: string;
    };

/** F15 sizes the id chip up from the atom default: mono 11, padding 2px 7px. */
const BannerChip = ({ children }: { children: ReactNode }) => (
  <IdChip className="px-[7px] py-0.5 text-[11px]">{children}</IdChip>
);

export function CurrentStateBanner(p: CurrentStateBannerProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-2 py-[18px]",
        // just-switched: quiet emphasis — raised surface tint, settles over ~2s
        p.kind === "just-switched" && "bg-surface-card-raised transition-colors duration-1000",
        p.className,
      )}
    >
      {p.kind === "just-switched" ? (
        <div className="flex items-center gap-2">
          <Eyebrow>Current state</Eyebrow>
          <TinyBadge>Changed just now</TinyBadge>
        </div>
      ) : (
        <Eyebrow>Current state</Eyebrow>
      )}

      {p.kind === "all-done" ? (
        <div className="flex items-center gap-2.5">
          <CheckGlyph size={16} className="text-state-success" />
          <span className="text-[17px] font-semibold text-text-primary">
            Everything on the plan is done
          </span>
        </div>
      ) : (
        <div className="flex items-center gap-2.5">
          <BannerChip>{p.phaseId}</BannerChip>
          <span className="text-[17px] font-semibold text-text-primary">{p.phaseName}</span>
          {p.kind === "waiting" ? (
            <span className="inline-flex items-center gap-1.5 text-[12.5px] text-text-secondary">
              <ClockGlyph size={12} />
              waiting on you
            </span>
          ) : (
            <StateWord
              kind={p.kind === "just-switched" || (p.kind === "normal" && p.running) ? "running" : "neutral"}
              className="text-[12.5px]"
            >
              {p.statusWord}
            </StateWord>
          )}
        </div>
      )}

      <div className="text-[13px] leading-[1.5] text-text-muted">{p.body}</div>

      {(p.kind === "normal" || p.kind === "just-switched") && p.upNext && (
        <div className="text-xs text-text-dim">
          Up next:{" "}
          <span className="font-mono text-[11px] text-text-subtle">{p.upNext.id}</span> ·{" "}
          {p.upNext.name}
        </div>
      )}

      {p.kind === "waiting" && (
        <div className="mt-0.5 flex gap-2">
          <BtnPrimary className="h-[31px] px-3 text-[12.5px]" onClick={p.onAction}>
            {p.actionLabel}
          </BtnPrimary>
        </div>
      )}

      {p.kind === "all-done" && (
        <div className="mt-0.5 flex gap-2">
          <BtnPrimary className="h-[31px] px-3 text-[12.5px]" onClick={p.onAddNext}>
            Add what's next in the Kanban
          </BtnPrimary>
          <BtnSecondary className="h-[31px] px-3 text-[12.5px]" onClick={p.onRebuild}>
            Rebuild the roadmap
          </BtnSecondary>
        </div>
      )}
    </div>
  );
}
