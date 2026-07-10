/*
 * F21 (Deck 3) — the phase rail: stage headers, the connector, the dots
 * (done solid success · now 12px neutral pulse + 3px fill-hover ring · later hairline
 * circle), collapsed/expanded phase cards, window phases (dashed grouping), the
 * just-completed ring moment, and FX kanban-round phases. Presentational only.
 */
import { Eyebrow, IdChip, StateWord } from "@/components/chrome/atoms";
import { CheckGlyph } from "@/components/chrome/icons";
import { cn } from "@/lib/utils";
import { PasteChip, TinyBadge, Twisty } from "./bits";

export type RailChip = { name: string; hint?: string };

export type RailPhase =
  | {
      kind: "collapsed";
      id: string;
      name: string;
      status: "done" | "just-done" | "later";
      onToggle?: () => void;
    }
  | {
      kind: "expanded";
      id: string;
      name: string;
      statusWord: string; // "in design", "in progress", …
      description: string;
      steps: { label: string; done?: boolean }[];
      paste: RailChip[];
      reference?: RailChip[];
      onToggle?: () => void;
      onViewDetails?: () => void;
      onChip?: (name: string) => void;
    }
  | { kind: "window"; id: string; name: string; eyebrow: string; note: string }
  | {
      kind: "fx";
      id: string;
      name: string;
      badge: string; // "from the Kanban · 6 tasks"
      statusWord: string; // "queued"
      chips: string[];
      onToggle?: () => void;
      onChip?: (name: string) => void;
    };

export type RailStage = { name: string; sub: string; phases: RailPhase[] };

export type PhaseRailProps = { stages: RailStage[]; className?: string };

function Dot({ phase }: { phase: RailPhase }) {
  if (phase.kind === "expanded") {
    // the now dot: 12px neutral, pulsing, 3px fill-hover ring (frozen under reduced motion)
    return (
      <span
        className="mt-4 size-3 rounded-full bg-state-neutral"
        style={{
          animation: "wv-pulse 1.6s ease-in-out infinite",
          boxShadow: "0 0 0 3px var(--fill-hover)",
        }}
      />
    );
  }
  if (phase.kind === "collapsed" && phase.status === "done") {
    return <span className="mt-4 size-2.5 rounded-full bg-state-success" />;
  }
  if (phase.kind === "collapsed" && phase.status === "just-done") {
    // the one quiet celebrate moment — ring fades over 3s, frozen under reduced motion
    return (
      <span
        className="mt-4 size-2.5 rounded-full bg-state-success"
        style={{ boxShadow: "0 0 0 3px var(--fill-hover)" }}
      />
    );
  }
  return <span className="mt-4 size-2.5 rounded-full border-[1.4px] border-border-strong" />;
}

function CollapsedCard({ phase }: { phase: Extract<RailPhase, { kind: "collapsed" }> }) {
  return (
    <div
      className={cn(
        "flex items-center gap-2.5 rounded-lg border border-border-hairline bg-surface-card px-[15px] py-3",
        phase.status === "later" && "opacity-75",
      )}
    >
      <IdChip>{phase.id}</IdChip>
      <span
        className={cn(
          "text-[13.5px] font-medium",
          phase.status === "done" && "text-text-muted",
          phase.status === "just-done" && "text-text-primary",
          phase.status === "later" && "text-text-secondary",
        )}
      >
        {phase.name}
      </span>
      {phase.status === "later" ? (
        <span className="text-xs text-text-subtle">later</span>
      ) : (
        <StateWord kind="success" glyphSize={11} className="gap-[5px] text-xs">
          {phase.status === "just-done" ? "done · just now" : "done"}
        </StateWord>
      )}
      <span className="flex-1" />
      <Twisty label={`Expand ${phase.id}`} onClick={phase.onToggle} />
    </div>
  );
}

function ExpandedCard({ phase }: { phase: Extract<RailPhase, { kind: "expanded" }> }) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border-strong bg-surface-card-raised px-[15px] py-3.5">
      <div className="flex items-center gap-2.5">
        <IdChip>{phase.id}</IdChip>
        <span className="text-[14.5px] font-medium text-text-primary">{phase.name}</span>
        <StateWord kind="neutral" dotSize={5} className="text-xs">
          {phase.statusWord}
        </StateWord>
        <span className="flex-1" />
        <Twisty open label={`Collapse ${phase.id}`} onClick={phase.onToggle} />
      </div>
      <div className="text-[12.5px] leading-[1.55] text-text-muted">{phase.description}</div>
      <div className="flex flex-col gap-1.5">
        {phase.steps.map((step) =>
          step.done ? (
            <div
              key={step.label}
              className="flex items-center gap-2 text-[12.5px] text-text-muted"
            >
              <CheckGlyph size={11} className="shrink-0 text-state-success" />
              <span className="text-text-dim line-through">{step.label}</span>
            </div>
          ) : (
            <div
              key={step.label}
              className="flex items-center gap-2 text-[12.5px] text-text-secondary"
            >
              <span className="inline-block size-[11px] shrink-0 rounded-[3px] border-[1.3px] border-border-strong" />
              {step.label}
            </div>
          ),
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11.5px] text-text-dim">You paste</span>
        {phase.paste.map((chip) => (
          <PasteChip
            key={chip.name}
            name={chip.name}
            hint={chip.hint}
            height={27}
            onClick={() => phase.onChip?.(chip.name)}
          />
        ))}
        {phase.reference && phase.reference.length > 0 && (
          <>
            <span className="text-[11.5px] text-text-dim">reference</span>
            {phase.reference.map((chip) => (
              <PasteChip
                key={chip.name}
                name={chip.name}
                hint={chip.hint}
                height={27}
                onClick={() => phase.onChip?.(chip.name)}
              />
            ))}
          </>
        )}
      </div>
      <button
        onClick={phase.onViewDetails}
        className="h-8 w-full rounded-md border border-border-hairline text-[12.5px] font-medium text-text-secondary hover:bg-fill-hover hover:text-text-primary"
      >
        View details ›
      </button>
    </div>
  );
}

function WindowCard({ phase }: { phase: Extract<RailPhase, { kind: "window" }> }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-dashed border-border-strong px-[15px] py-[11px]">
      <div className="flex items-center gap-2">
        <Eyebrow>{phase.eyebrow}</Eyebrow>
      </div>
      <div className="flex items-center gap-2.5">
        <IdChip>{phase.id}</IdChip>
        <span className="text-[13.5px] font-medium text-text-secondary">{phase.name}</span>
        <span className="text-xs text-text-subtle">{phase.note}</span>
      </div>
    </div>
  );
}

function FxCard({ phase }: { phase: Extract<RailPhase, { kind: "fx" }> }) {
  return (
    <div className="flex flex-col gap-[9px] rounded-lg border border-border-hairline bg-surface-card px-[15px] py-3">
      <div className="flex items-center gap-2.5">
        <IdChip>{phase.id}</IdChip>
        <span className="text-[13.5px] font-medium text-text-primary">{phase.name}</span>
        <TinyBadge className="px-1.5 leading-4">{phase.badge}</TinyBadge>
        <span className="text-xs text-text-subtle">{phase.statusWord}</span>
        <span className="flex-1" />
        <Twisty label={`Expand ${phase.id}`} onClick={phase.onToggle} />
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[11.5px] text-text-dim">You paste</span>
        {phase.chips.map((name) => (
          <PasteChip
            key={name}
            name={name}
            height={26}
            raised
            onClick={() => phase.onChip?.(name)}
          />
        ))}
      </div>
    </div>
  );
}

export function PhaseRail({ stages, className }: PhaseRailProps) {
  const totalPhases = stages.reduce((n, s) => n + s.phases.length, 0);
  let seen = 0;
  return (
    <div
      className={cn(
        "flex flex-col rounded-lg border border-border-hairline bg-surface-panel px-6 py-[22px]",
        className,
      )}
    >
      {stages.map((stage, si) => (
        <div key={stage.name} className="contents">
          <div className={cn("flex flex-col gap-1 pb-3.5", si > 0 && "pt-3.5")}>
            <div className="flex items-center gap-3">
              <span className="text-[15px] font-semibold text-text-primary">{stage.name}</span>
              <span className="h-px flex-1 bg-divider" />
            </div>
            <span className="text-xs text-text-dim">{stage.sub}</span>
          </div>
          {stage.phases.map((phase) => {
            seen += 1;
            const last = seen === totalPhases;
            return (
              <div key={phase.id} className="flex gap-3.5">
                <div className="flex w-4 shrink-0 flex-col items-center">
                  <Dot phase={phase} />
                  {!last && <span className="w-px flex-1 bg-divider" />}
                </div>
                <div className={cn("min-w-0 flex-1", !last && "pb-2.5")}>
                  {phase.kind === "collapsed" && <CollapsedCard phase={phase} />}
                  {phase.kind === "expanded" && <ExpandedCard phase={phase} />}
                  {phase.kind === "window" && <WindowCard phase={phase} />}
                  {phase.kind === "fx" && <FxCard phase={phase} />}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
