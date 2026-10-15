/*
 * F13 (Deck 2) — the roadmap building state. Spinner + streamed log; Cancel actually
 * stops the session; neutral, never green. The >5min variant swaps the progress bar
 * for reassurance copy and a "View full log" link. Presentational only.
 */
import type { ReactNode } from "react";
import { BtnSecondary, Eyebrow, MonoMeta, Spinner, StateWord } from "@/components/chrome/atoms";
import { cn } from "@/lib/utils";

/** The first-build screen (no roadmap yet): the banner shape, plus the ghost below. */
type WritingProps = { writing?: boolean; children?: ReactNode };

export type BuildingCardProps = WritingProps &
  (
  | {
      kind: "running";
      /** Defaults to "Writing your roadmap…" — the fixes flow retitles it. */
      title?: string;
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
      /** Defaults to the roadmap line — the fixes mirror passes its own. */
      note?: string;
      elapsed: string;
      logLines: string[];
      activeLine: string;
      onCancel?: () => void;
      onViewFullLog?: () => void;
      className?: string;
    });

function WritingState(p: BuildingCardProps) {
  const known = p.kind === "running";
  const raw = p.activeLine?.trim();
  const sentence = raw && !/^starting the session/i.test(raw) ? raw : "Reading the folder. Usually a minute or two.";
  return (
    <div className={cn("flex flex-col gap-[34px] py-[26px]", p.className)}>
      <div className="flex flex-col gap-3.5">
        <Eyebrow>Current state</Eyebrow>
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2.5">
            <span className="text-[20px] font-semibold leading-[1.25] tracking-[-0.01em] text-text-primary">
              Writing the roadmap
            </span>
            <StateWord kind="running" className="text-[12px]">working</StateWord>
          </div>
          <div className="max-w-[54ch] text-[13.5px] leading-[1.65] text-text-muted">{sentence}</div>
          <div className="h-[3px] max-w-[420px] overflow-hidden rounded-[2px] bg-fill-hover">
            {known ? (
              <div className="h-full rounded-[2px] bg-state-neutral" style={{ width: `${Math.round(p.progress * 100)}%` }} />
            ) : (
              <div
                className="h-full w-[40%] rounded-[2px] bg-state-neutral"
                style={{ animation: "ch-indeterminate 1.4s ease-in-out infinite" }}
              />
            )}
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={p.onCancel}
              className="h-7 rounded-md border border-border-hairline px-3 text-[12px] text-text-muted hover:bg-fill-hover hover:text-text-secondary"
            >
              Stop
            </button>
            <span className="text-[11.5px] text-text-faint">You can keep using the rest of Chronicle meanwhile.</span>
          </div>
        </div>
      </div>
      {p.children}
    </div>
  );
}

export function BuildingCard(p: BuildingCardProps) {
  if (p.writing) return <WritingState {...p} />;
  return (
    <div
      className={cn(
        "flex flex-col gap-3 py-[26px]",
        p.className,
      )}
    >
      <div className="flex items-center gap-2.5">
        <Spinner size={15} />
        <span className="text-[14.5px] font-medium text-text-primary">
          {p.kind === "running" ? (p.title ?? "Writing your roadmap…") : "Still running"}
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
          {p.note ?? "Long roadmaps can take a while on big folders. The session is alive and still writing."}
        </div>
      )}

      {/* streamed log — surface-input, radius 8, no border (log-pane law) */}
      <div data-selectable className="flex min-w-0 flex-col gap-[5px] overflow-hidden rounded-md bg-surface-input px-3 py-2.5 font-mono text-[11.5px] text-text-dim">
        {p.logLines.map((line, i) => (
          <div key={i} className="truncate">{line}</div>
        ))}
        <div className="truncate text-text-subtle">
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
        {p.kind === "still-running" && p.onViewFullLog && (
          <button
            onClick={p.onViewFullLog}
            className="text-[12.5px] text-text-secondary underline underline-offset-2 hover:text-text-primary"
          >
            View full log
          </button>
        )}
        <BtnSecondary className="h-8 px-[13px] text-[12.5px]" onClick={p.onCancel}>
          Cancel
        </BtnSecondary>
      </div>
    </div>
  );
}
