/*
 * F30 (Deck 5) — the "Ready to execute" flow: A pre-flight summary (overlay
 * card — what the round writes, what freezes), B generating (background
 * session — same family as the roadmap BuildingCard: neutral spinner, 3px bar,
 * streamed log, Cancel actually stops the session), C done (round frozen, the
 * two doc chips, the roadmap link), plus the round-executing explainer shown
 * while a round runs (new tasks start the next round). Neutral, never green
 * while running. Presentational only.
 */
import { BtnPrimary, BtnSecondary, MonoMeta, Spinner, StateWord } from "@/components/chrome/atoms";
import { ArrowRightGlyph, CheckGlyph } from "@/components/chrome/icons";
import { cn } from "@/lib/utils";
import { PasteChip } from "@/screens/roadmap/bits";

export type ExecuteFlowProps =
  | {
      /** A — the pre-flight summary dialog. */
      kind: "preflight";
      /** Which agent runs the round — the copy names it. */
      agent?: "claude" | "codex";
      queued: number;
      planFile: string; // "phase_2_fixes_plan.md"
      promptFile: string; // "phase_2_fixes_prompt.md"
      onNotYet?: () => void;
      onConfirm?: () => void;
      className?: string;
    }
  | {
      /** B — the background session writing the plan. */
      kind: "generating";
      elapsed: string; // "32s"
      /** 0..1 */
      progress: number;
      logLines: string[];
      activeLine: string;
      onCancel?: () => void;
      className?: string;
    }
  | {
      /** C — done; the round is frozen and the docs exist. */
      kind: "done";
      agent?: "claude" | "codex";
      round: number;
      taskCount: number;
      /** What the round turns into — "bug fixes". */
      outcome: string;
      planFile: string;
      promptFile: string;
      onOpenFile?: (name: string) => void;
      /** Runs the round in a background session — Chronicle does the work (F1). */
      onRunHeadless?: () => void;
      /** F39 — the default: the round runs in the agent pane, steps visible. */
      onRunInPane?: () => void;
      /** Opens a terminal with the agent and copies the prompt — you drive. */
      onStartRound?: () => void;
      onViewRoadmap?: () => void;
      className?: string;
    };

/** The while-a-round-is-executing explainer (F30) — the Board embeds it too. */
export function RoundExecutingNote({
  round,
  state,
  className,
}: {
  round: number;
  /** What the round is actually doing — the strip must not say more than it knows. */
  state?: "generating" | "ready" | "running";
  className?: string;
}) {
  const word =
    state === "generating"
      ? `Round ${round} is being planned`
      : state === "ready"
        ? `Round ${round} is waiting to run`
        : state === "running"
          ? `Round ${round} is running`
          : `Round ${round} is underway`;
  return (
    <div
      className={cn(
        "flex items-center gap-2.5 rounded-lg border border-border-hairline bg-surface-card px-[15px] py-3",
        className,
      )}
    >
      <StateWord kind="running" className="gap-1.5 text-xs">
        {word}
      </StateWord>
      <span className="text-[12.5px] text-text-muted">
        — new tasks start round {round + 1}.
      </span>
    </div>
  );
}

const AGENT_NAME = { claude: "Claude Code", codex: "Codex" } as const;

export function ExecuteFlow(p: ExecuteFlowProps) {
  if (p.kind === "preflight") {
    const one = p.queued === 1;
    return (
      <div
        className={cn(
          "flex w-[440px] flex-col gap-3 rounded-xl border border-border-strong bg-surface-overlay p-5 [box-shadow:var(--shadow-overlay)]",
          p.className,
        )}
      >
        <div className="text-[15px] font-semibold text-text-primary">
          Turn {p.queued} queued {one ? "task" : "tasks"} into a fix plan?
        </div>
        <div className="text-[13px] leading-[1.55] text-text-muted">
          {p.queued} queued {one ? "task becomes" : "tasks become"} a fix plan for {AGENT_NAME[p.agent ?? "claude"]} —
          two files are written into the project:
        </div>
        <div className="flex flex-col gap-[5px] font-mono text-[11.5px] text-text-subtle">
          <span>{p.planFile}</span>
          <span>{p.promptFile}</span>
        </div>
        <div className="text-xs text-text-dim">
          The {p.queued} {one ? "task freezes" : "tasks freeze"} while the round runs. Nothing else
          in the project is touched.
        </div>
        <div className="flex justify-end gap-2">
          <BtnSecondary size="md" onClick={p.onNotYet}>
            Not yet
          </BtnSecondary>
          <BtnPrimary size="md" onClick={p.onConfirm}>
            Write the fix plan
          </BtnPrimary>
        </div>
      </div>
    );
  }

  if (p.kind === "generating") {
    return (
      <div
        className={cn(
          "flex w-[440px] flex-col gap-3 rounded-lg border border-border-hairline bg-surface-card p-5",
          p.className,
        )}
      >
        <div className="flex items-center gap-2.5">
          <Spinner size={14} />
          <span className="text-sm font-medium text-text-primary">Writing the fix plan…</span>
          <span className="flex-1" />
          <MonoMeta className="text-text-dim">{p.elapsed}</MonoMeta>
        </div>
        <div className="h-[3px] overflow-hidden rounded-[2px] bg-fill-hover">
          <div
            className="h-full rounded-[2px] bg-state-neutral"
            style={{ width: `${Math.round(p.progress * 100)}%` }}
          />
        </div>
        {/* streamed log — surface-input, radius 8, no border (log-pane law) */}
        <div className="flex min-w-0 flex-col gap-[5px] overflow-hidden rounded-md bg-surface-input px-[13px] py-[11px] font-mono text-[11px] text-text-dim">
          {p.logLines.map((line, i) => (
            <div key={i} className="truncate">{line}</div>
          ))}
          <div className="truncate text-text-subtle">
            {p.activeLine}
            <span style={{ animation: "wv-pulse 1.1s step-end infinite" }}>▍</span>
          </div>
        </div>
        <div className="flex justify-end">
          <BtnSecondary onClick={p.onCancel} >
            Cancel
          </BtnSecondary>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex w-[440px] flex-col gap-3 rounded-lg border border-border-hairline bg-surface-card p-5",
        p.className,
      )}
    >
      <div className="flex items-center gap-[9px]">
        <CheckGlyph size={14} className="shrink-0 text-state-success" />
        <span className="inline-flex items-center gap-1.5 text-sm font-medium text-text-primary">
          <span>Round {p.round} · {p.taskCount} {p.taskCount === 1 ? "task" : "tasks"}</span>
          <ArrowRightGlyph size={11} className="shrink-0 text-text-dim" />
          <span>{p.outcome}</span>
        </span>
      </div>
      <div className="text-[12.5px] leading-[1.55] text-text-muted">
        The plan is written. Chronicle can run it in the agent pane with every step
        visible, in a terminal, or quietly in the background.
      </div>
      <div className="flex gap-2">
        <BtnPrimary size="md" onClick={p.onRunInPane} className="gap-[7px]">
          Run the round for me
        </BtnPrimary>
        <BtnSecondary size="md" onClick={p.onStartRound}>
          Run it in a terminal
        </BtnSecondary>
      </div>
      <button
        type="button"
        onClick={p.onRunHeadless}
        className="self-start text-[11.5px] text-text-dim underline underline-offset-2 hover:text-text-secondary"
      >
        Run it in the background instead
      </button>
      <div className="flex flex-wrap gap-2">
        <PasteChip
          name={p.planFile}
          height={28}
          raised
          onClick={() => p.onOpenFile?.(p.planFile)}
        />
        <PasteChip
          name={p.promptFile}
          hint={`→ ${AGENT_NAME[p.agent ?? "claude"]}`}
          height={28}
          raised
          onClick={() => p.onOpenFile?.(p.promptFile)}
        />
      </div>
      <button
        type="button"
        onClick={p.onViewRoadmap}
        className="self-start text-[12.5px] text-text-secondary underline underline-offset-2 hover:text-text-primary focus-visible:outline-none focus-visible:[box-shadow:var(--focus-ring)]!"
      >
        It's on the roadmap ›
      </button>
    </div>
  );
}
