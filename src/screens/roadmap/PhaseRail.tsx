/*
 * F21 (Deck 3) — the phase rail: stage headers, the connector, the dots
 * (done solid success · now 12px neutral pulse + 3px fill-hover ring · later hairline
 * circle), collapsed/expanded phase cards, window phases (dashed grouping), the
 * just-completed ring moment, and FX kanban-round phases. Presentational only.
 */
import { Eyebrow, IdChip, StateWord } from "@/components/chrome/atoms";
import { CheckGlyph } from "@/components/chrome/icons";
import { cn } from "@/lib/utils";
import { AccBody, PasteChip, TinyBadge, Twisty } from "./bits";

/** into renders inside the chip ("→ Claude Design"); note sits OUTSIDE it. */
export type RailChip = { name: string; into?: string; note?: string };

export type RailPhase =
  | {
      kind: "phase";
      id: string;
      name: string;
      /** e.g. "From the Kanban · 6 tasks" — fix-round phases carry one. */
      badge?: string;
      /** body visibility — open/close animate via AccBody */
      open: boolean;
      status: "done" | "just-done" | "later" | "now";
      statusWord: string; // "in design", "done", "later", …
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
  if (phase.kind === "phase" && phase.status === "now") {
    // the now dot: 12px neutral, pulsing, 3px fill-hover ring (frozen under reduced motion)
    return (
      <span
        className="size-3 rounded-full bg-state-neutral"
        style={{
          animation: "wv-pulse 1.6s ease-in-out infinite",
          boxShadow: "0 0 0 3px var(--fill-hover)",
        }}
      />
    );
  }
  if (phase.kind === "phase" && phase.status === "done") {
    return <span className="size-2.5 rounded-full bg-state-success" />;
  }
  if (phase.kind === "phase" && phase.status === "just-done") {
    // the one quiet celebrate moment — ring fades over 3s, frozen under reduced motion
    return (
      <span
        className="size-2.5 rounded-full bg-state-success"
        style={{ boxShadow: "0 0 0 3px var(--fill-hover)" }}
      />
    );
  }
  return <span className="size-2.5 rounded-full border-[1.4px] border-border-strong" />;
}

function PhaseCard({ phase }: { phase: Extract<RailPhase, { kind: "phase" }> }) {
  const open = phase.open;
  return (
    <div
      className={cn(
        "flex flex-col rounded-lg border px-[15px]",
        open
          ? "border-border-strong bg-surface-card-raised py-3.5"
          : "border-border-hairline bg-surface-card py-3 hover:border-border-strong",
        !open && phase.status === "later" && "opacity-75",
        "transition-[background,border-color,padding] duration-200",
      )}
    >
      <button
        onClick={phase.onToggle}
        aria-expanded={open}
        aria-label={`${open ? "Collapse" : "Expand"} ${phase.id} · ${phase.name}`}
        className="flex w-full items-center gap-2.5 text-left"
      >
        <IdChip>{phase.id}</IdChip>
        <span
          className={cn(
            open ? "text-[14.5px] font-medium text-text-primary" : "text-[13.5px] font-medium",
            !open && phase.status === "done" && "text-text-muted",
            !open && phase.status === "just-done" && "text-text-primary",
            !open && (phase.status === "later" || phase.status === "now") && "text-text-secondary",
          )}
        >
          {phase.name}
        </span>
        {phase.badge && <TinyBadge className="px-1.5 leading-4">{phase.badge}</TinyBadge>}
        {phase.status === "done" || phase.status === "just-done" ? (
          <StateWord kind="success" glyphSize={11} className="gap-[5px] text-xs">
            {phase.status === "just-done" ? "Done · just now" : "Done"}
          </StateWord>
        ) : phase.status === "later" && !open ? (
          <span className="text-xs text-text-subtle">Later</span>
        ) : (
          <StateWord kind="neutral" dotSize={5} className="text-xs">
            {phase.statusWord}
          </StateWord>
        )}
        <span className="flex-1" />
        <Twisty open={open} decorative />
      </button>

      {/* the body stays mounted so open AND close animate */}
      <AccBody open={open}>
        <div className="flex flex-col gap-3 pt-3">
          <div className="text-[12.5px] leading-[1.55] text-text-muted">{phase.description}</div>
          {phase.steps.length > 0 && (
            <div className="flex flex-col gap-1.5">
              {phase.steps.map((step) =>
                step.done ? (
                  <div key={step.label} className="flex items-center gap-2 text-[12.5px] text-text-muted">
                    <CheckGlyph size={11} className="shrink-0 text-state-success" />
                    <span className="text-text-dim line-through">{step.label}</span>
                  </div>
                ) : (
                  <div key={step.label} className="flex items-center gap-2 text-[12.5px] text-text-secondary">
                    <span className="inline-block size-[11px] shrink-0 rounded-[3px] border-[1.3px] border-border-strong" />
                    {step.label}
                  </div>
                ),
              )}
            </div>
          )}
          {phase.paste.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <span className="text-[11.5px] text-text-dim">You paste</span>
              {phase.paste.map((chip) => (
                <div key={chip.name} className="flex flex-wrap items-center gap-2.5">
                  <PasteChip
                    name={chip.name}
                    hint={chip.into ? `→ ${chip.into}` : undefined}
                    height={27}
                    onClick={() => phase.onChip?.(chip.name)}
                  />
                  {chip.note && <span className="text-[11.5px] text-text-subtle">{chip.note}</span>}
                </div>
              ))}
            </div>
          )}
          {phase.reference && phase.reference.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <span className="text-[11.5px] text-text-dim">Reference</span>
              {phase.reference.map((chip) => (
                <div key={chip.name} className="flex flex-wrap items-center gap-2.5">
                  <PasteChip
                    name={chip.name}
                    hint={chip.into ? `→ ${chip.into}` : undefined}
                    height={27}
                    onClick={() => phase.onChip?.(chip.name)}
                  />
                  {chip.note && <span className="text-[11.5px] text-text-subtle">{chip.note}</span>}
                </div>
              ))}
            </div>
          )}
          <button
            onClick={phase.onViewDetails}
            className="h-8 w-full rounded-md border border-border-hairline text-[12.5px] font-medium text-text-secondary hover:bg-fill-hover hover:text-text-primary"
          >
            View details ›
          </button>
        </div>
      </AccBody>
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
      <button
        onClick={phase.onToggle}
        aria-label={`Expand ${phase.id} · ${phase.name}`}
        className="flex w-full items-center gap-2.5 text-left"
      >
        <IdChip>{phase.id}</IdChip>
        <span className="text-[13.5px] font-medium text-text-primary">{phase.name}</span>
        <TinyBadge className="px-1.5 leading-4">{phase.badge}</TinyBadge>
        <span className="text-xs text-text-subtle">{phase.statusWord}</span>
        <span className="flex-1" />
        <Twisty decorative />
      </button>
      {phase.chips.length > 0 && (
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
      )}
    </div>
  );
}

export function PhaseRail({ stages, className }: PhaseRailProps) {
  return (
    <div
      className={cn(
        "flex flex-col py-[22px]",
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
          {stage.phases.map((phase, pi) => {
            const lastInStage = pi === stage.phases.length - 1;
            return (
              <div key={phase.id} className="flex gap-3.5">
                {/* the gutter — a continuous line dot-to-dot within the stage */}
                <div className="flex w-4 shrink-0 flex-col items-center">
                  <span className={cn("h-4 w-px shrink-0", pi > 0 && "bg-divider")} />
                  <Dot phase={phase} />
                  {!lastInStage && <span className="w-px flex-1 bg-divider" />}
                </div>
                <div className={cn("min-w-0 flex-1", !lastInStage && "pb-2.5")}>
                  {phase.kind === "phase" && <PhaseCard phase={phase} />}
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
