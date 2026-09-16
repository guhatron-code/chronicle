/*
 * Round 9 — the account's limits, live, in the title bar. One quiet mono chip
 * ("62% · resets 4:10 PM") that appears with the first reading a live pane
 * session brings in; amber at allowed_warning, red at rejected. Hover for the
 * window, the full reset time, how old the reading is, and this session's
 * cost; Refresh asks the live session for /usage, which lands in the thread
 * like any exchange (nothing is parsed from it). Data arrives only during a
 * turn, so between turns the chip shows the last value with its age.
 */
import { useEffect, useState } from "react";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { ageLabel, fmtResetTime, windowLabel, type LimitsReading } from "@/lib/limits-store";
import { every } from "@/lib/scheduler";
import { cn } from "@/lib/utils";

export function LimitsChip({
  limits,
  sessionCost,
  onRefresh,
}: {
  limits: LimitsReading;
  /** USD for the active project's session, when it has one */
  sessionCost: number | null;
  /** null = no live idle session to ask */
  onRefresh: (() => void) | null;
}) {
  // the age counts up between turns — on the scheduler, never a bare timer
  const [, tick] = useState(0);
  useEffect(() => every(30_000, () => tick((n) => n + 1)), []);

  const pct = limits.utilization == null ? null : `${Math.round(limits.utilization)}%`;
  const reset = limits.resetsAt == null ? null : fmtResetTime(limits.resetsAt);
  const text = pct && reset ? `${pct} · resets ${reset}` : pct ?? (reset ? `resets ${reset}` : "limits");
  const tone = limits.status === "rejected" ? "error" : limits.status === "allowed_warning" ? "warn" : "ok";

  return (
    <HoverCard openDelay={150} closeDelay={120}>
      <HoverCardTrigger asChild>
        <span
          data-limits-chip={tone}
          className={cn(
            "mr-3 inline-flex shrink-0 cursor-default items-center gap-1.5 whitespace-nowrap rounded-[7px] px-1.5 py-0.5 font-mono text-[11.5px] tabular-nums",
            tone === "ok" && "text-text-dim",
            tone === "warn" && "text-state-warn",
            tone === "error" && "text-state-error",
          )}
        >
          {tone !== "ok" && <span aria-hidden className={cn("size-[5px] rounded-full", tone === "warn" ? "bg-state-warn" : "bg-state-error")} />}
          {text}
        </span>
      </HoverCardTrigger>
      <HoverCardContent align="end" sideOffset={6} className="w-60 p-3 text-[11.5px]">
        <div className="mb-1.5 text-[12px] font-medium text-text-primary">
          {limits.status === "rejected" ? "Limit reached" : limits.status === "allowed_warning" ? "Close to the limit" : "Usage limits"}
        </div>
        <Row label="Window" value={windowLabel(limits.windowType)} />
        {pct && <Row label="Used" value={pct} />}
        {limits.resetsAt != null && <Row label="Resets" value={new Date(limits.resetsAt).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })} />}
        <Row label="Reading" value={ageLabel(limits.at)} />
        {sessionCost != null && <Row label="Cost this session" value={`$${sessionCost.toFixed(2)}`} />}
        <div className="mt-2 flex items-center justify-between border-t border-border-hairline pt-2">
          <span className="text-text-dim">Full picture from Claude Code</span>
          <button
            disabled={!onRefresh}
            title={onRefresh ? undefined : "Needs a live session that is not mid-turn"}
            onClick={() => onRefresh?.()}
            className="rounded-[6px] px-1.5 py-0.5 font-medium text-text-secondary hover:bg-fill-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
          >
            Refresh
          </button>
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5">
      <span className="text-text-dim">{label}</span>
      <span className="font-mono text-text-secondary tabular-nums">{value}</span>
    </div>
  );
}
