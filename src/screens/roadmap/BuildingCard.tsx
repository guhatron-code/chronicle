/*
 * F13 (Deck 2) — the roadmap building state. Spinner + streamed log; Cancel actually
 * stops the session; neutral, never green. The >5min variant swaps the progress bar
 * for reassurance copy and a "View full log" link. Presentational only.
 */
import { BtnSecondary, MonoMeta, Spinner } from "@/components/chrome/atoms";
import { cn } from "@/lib/utils";

export type BuildingCardProps =
  | {
      kind: "running";
      elapsed: string;
      /** 0..1 */
      progress: number;
      logLines: string[];
      activeLine: string;
      onCancel?: () => void;
      className?: string;
    }
  | {
      kind: "still-running";
      elapsed: string;
      logLines: string[];
      activeLine: string;
      onCancel?: () => void;
      onViewFullLog?: () => void;
      className?: string;
    };

export function BuildingCard(p: BuildingCardProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-lg border border-border-hairline bg-surface-card p-4",
        p.className,
      )}
    >
      <div className="flex items-center gap-2.5">
        <Spinner size={15} />
        <span className="text-[14.5px] font-medium text-text-primary">
          {p.kind === "running" ? "Writing your roadmap…" : "Still running"}
        </span>
        <span className="flex-1" />
        <MonoMeta className="text-[11.5px] text-text-dim">{p.elapsed}</MonoMeta>
      </div>

      {p.kind === "running" ? (
        <div className="h-[3px] overflow-hidden rounded-[2px] bg-fill-hover">
          <div
            className="h-full rounded-[2px] bg-state-neutral"
            style={{ width: `${Math.round(p.progress * 100)}%` }}
          />
        </div>
      ) : (
        <div className="text-[12.5px] leading-[1.55] text-text-muted">
          Long roadmaps can take a while on big folders. The session is alive and still writing.
        </div>
      )}

      {/* streamed log — surface-input, radius 8, no border (log-pane law) */}
      <div className="flex flex-col gap-[5px] rounded-md bg-surface-input px-3 py-2.5 font-mono text-[11.5px] text-text-dim">
        {p.logLines.map((line) => (
          <div key={line}>{line}</div>
        ))}
        <div className="text-text-subtle">
          {p.activeLine}
          <span style={{ animation: "wv-pulse 1.1s step-end infinite" }}>▍</span>
        </div>
      </div>

      <div
        className={cn(
          "flex items-center",
          p.kind === "still-running" ? "justify-between" : "justify-end",
        )}
      >
        {p.kind === "still-running" && (
          <button
            onClick={p.onViewFullLog}
            className="text-[12.5px] text-text-secondary underline underline-offset-2 hover:text-text-primary"
          >
            View full log
          </button>
        )}
        <BtnSecondary className="h-8 px-[13px] text-[12.5px]" onClick={p.onCancel}>
          Cancel — stops the session
        </BtnSecondary>
      </div>
    </div>
  );
}
