/*
 * F22 (Deck 3) — the phase detail view that slides over the roadmap. Breadcrumb bar
 * with "Start this phase" (the audit's headline addition) + two columns:
 * description / steps checklist / you-paste / documents accordion  |  saves timeline.
 * Presentational only.
 */
import { BtnPrimary, Eyebrow, IdChip, Spinner, StateWord } from "@/components/chrome/atoms";
import {
  AgentStarGlyph,
  CheckGlyph,
  ChevronLeftGlyph,
  ChevronRightGlyph,
  ChevronUpGlyph,
  CopyGlyph,
  ErrorGlyph,
  PlayGlyph,
  XGlyph,
} from "@/components/chrome/icons";
import { cn } from "@/lib/utils";
import { MiniMd } from "@/lib/mini-md";
import { AccBody, PasteChip } from "./bits";
import type { RailChip } from "./PhaseRail";

export type DetailStep = {
  label: string;
  state: "done" | "active" | "todo";
  /** e.g. "· being worked on" on the active step. */
  note?: string;
};

export type DetailDoc = { title: string; path: string } & (
  | { state: "open"; heading?: string; body: string; onCopy?: () => void }
  | { state: "closed"; onOpen?: () => void; cachedBody?: string }
  | { state: "loading" }
  | { state: "error"; errorWord?: string; onRetry?: () => void }
);

export type SaveAuthor = { kind: "agent" } | { kind: "you"; initials: string };
export type DetailSave = { hash: string; author: SaveAuthor; ago: string; message: string };
export type DetailSaves =
  | { kind: "list"; entries: DetailSave[] }
  | { kind: "empty"; message: string } // e.g. "No saves mention R-1 yet."
  | { kind: "loading" };

export type PhaseDetailProps = {
  phaseId: string;
  phaseName: string;
  statusWord: string;
  /** Helper line under the bar, e.g. "Start this phase opens a terminal, …". */
  startHelper: string;
  /** Readiness checks (F3) — three green dots or one honest red one. */
  preflight?: { label: string; ok: boolean }[];
  description: string;
  stepsLabel: string; // "5 steps"
  steps: DetailStep[];
  paste: RailChip[];
  docs: DetailDoc[];
  saves: DetailSaves;
  onBack?: () => void;
  onClose?: () => void;
  onStart?: () => void;
  onChip?: (name: string) => void;
  className?: string;
};

function StepRow({ step }: { step: DetailStep }) {
  if (step.state === "done") {
    return (
      <div className="flex items-center gap-[9px] py-[7px] text-[13px] text-text-dim">
        <CheckGlyph size={12} className="shrink-0 text-state-success" />
        <span className="line-through">{step.label}</span>
      </div>
    );
  }
  return (
    <div
      className={cn(
        "flex items-center gap-[9px] py-[7px] text-[13px]",
        step.state === "active" ? "text-text-primary" : "text-text-secondary",
      )}
    >
      <span
        className={cn(
          "inline-block size-3 shrink-0 rounded-[3px] border-[1.3px]",
          step.state === "active" ? "border-state-neutral" : "border-border-strong",
        )}
      />
      <span>
        {step.label}
        {step.note && <span className="pl-1.5 text-[11px] text-state-neutral">{step.note}</span>}
      </span>
    </div>
  );
}

function DocRow({ doc, last }: { doc: DetailDoc; last: boolean }) {
  const header = (
    <>
      {doc.state === "open" ? (
        <ChevronUpGlyph size={10} className="shrink-0 text-text-dim" />
      ) : (
        <ChevronRightGlyph size={10} className="shrink-0 text-text-dim" />
      )}
      <span
        className={cn(
          "text-[12.5px]",
          doc.state === "open" ? "text-text-primary" : "text-text-secondary",
        )}
      >
        {doc.title}
      </span>
      <span className="font-mono text-[11px] text-text-dim">{doc.path}</span>
      <span className="flex-1" />
    </>
  );

  if (doc.state === "closed" || doc.state === "open") {
    const body = doc.state === "open" ? doc.body : doc.cachedBody;
    const heading = doc.state === "open" ? doc.heading : undefined;
    return (
      <div className={cn(!last && "border-b border-divider-faint")}>
        <div className="flex items-center gap-[9px] px-3 py-[9px]">
          {doc.state === "closed" ? (
            <button onClick={doc.onOpen} className="flex min-w-0 flex-1 items-center gap-[9px] text-left">
              {header}
            </button>
          ) : (
            <>
              {header}
              <button
                aria-label={`Copy ${doc.path}`}
                onClick={doc.onCopy}
                className="flex size-6 shrink-0 items-center justify-center rounded-sm text-text-dim hover:bg-fill-hover hover:text-text-secondary"
              >
                <CopyGlyph size={12} />
              </button>
            </>
          )}
        </div>
        <AccBody open={doc.state === "open"}>
          {body !== undefined && (
            <div className="pb-3.5 pl-[31px] pr-3.5 pt-1 text-[12.5px] leading-[1.6] text-text-secondary">
              {heading && <div className="pb-1 font-semibold text-text-primary">{heading}</div>}
              <MiniMd source={body} />
            </div>
          )}
        </AccBody>
      </div>
    );
  }

  return (
    <div className={cn(!last && "border-b border-divider-faint")}>
      <div className="flex items-center gap-[9px] px-3 py-[9px]">
        {header}
        {doc.state === "loading" && <Spinner size={11} className="shrink-0" />}
        {doc.state === "error" && (
          <>
            <span className="inline-flex shrink-0 items-center gap-[5px] text-[11.5px] text-state-error">
              <ErrorGlyph size={10} />
              {doc.errorWord ?? "can't be read"}
            </span>
            <button
              onClick={doc.onRetry}
              className="h-6 shrink-0 rounded-sm border border-border-strong px-[9px] text-[11px] font-medium text-text-secondary hover:bg-fill-hover"
            >
              Retry
            </button>
          </>
        )}
      </div>

    </div>
  );
}

function SaveRow({ save, last }: { save: DetailSave; last: boolean }) {
  return (
    <div className="flex gap-2.5">
      <div className="flex w-2.5 shrink-0 flex-col items-center">
        <span className="mt-[5px] size-[7px] rounded-full bg-text-subtle" />
        {!last && <span className="w-px flex-1 bg-divider" />}
      </div>
      <div className={cn("flex flex-col gap-[3px]", !last && "pb-3.5")}>
        <div className="flex items-center gap-[7px]">
          <span className="rounded-[5px] bg-fill-subtle px-[5px] font-mono text-[10.5px] text-text-subtle">
            {save.hash}
          </span>
          {save.author.kind === "agent" ? (
            <span
              title="agent save"
              className="flex size-4 items-center justify-center rounded-[5px] bg-surface-card-raised text-text-subtle"
            >
              <AgentStarGlyph size={9} />
            </span>
          ) : (
            <span
              title="you"
              className="flex size-4 items-center justify-center rounded-[5px] bg-surface-card-raised text-[8px] font-semibold text-text-subtle"
            >
              {save.author.initials}
            </span>
          )}
          <span className="font-mono text-[11px] text-text-dim tabular-nums">{save.ago}</span>
        </div>
        <span className="text-[12.5px] text-text-secondary">{save.message}</span>
      </div>
    </div>
  );
}

export function PhaseDetail(p: PhaseDetailProps) {
  return (
    <div
      className={cn(
        "flex h-full flex-col overflow-y-auto", // flat, flush with the pane (operator-directed)
        p.className,
      )}
    >
      {/* breadcrumb bar */}
      <div className="flex items-center gap-2.5 border-b border-divider px-5 py-[13px]">
        <button
          onClick={p.onBack}
          className="inline-flex items-center gap-1.5 text-[13px] text-text-muted hover:text-text-primary"
        >
          <ChevronLeftGlyph size={11} />
          Roadmap
        </button>
        <span className="text-text-dimmer">/</span>
        <IdChip className="shrink-0 whitespace-nowrap text-[11px]">{p.phaseId}</IdChip>
        <span className="min-w-0 truncate text-[15px] font-semibold text-text-primary" title={p.phaseName}>
          {p.phaseName}
        </span>
        <StateWord kind="neutral" dotSize={5} className="shrink-0 whitespace-nowrap text-xs">
          {p.statusWord}
        </StateWord>
        <span className="flex-1" />
        {p.statusWord !== "Done" && (
          <BtnPrimary size="md" className="gap-[7px]" onClick={p.onStart}>
            <PlayGlyph size={11} />
            Start this phase
          </BtnPrimary>
        )}
        <button
          aria-label="Close"
          onClick={p.onClose}
          className="flex size-7 shrink-0 items-center justify-center rounded-sm text-text-dim hover:bg-fill-hover hover:text-text-secondary"
        >
          <XGlyph size={11} />
        </button>
      </div>
      {p.statusWord !== "Done" && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 pt-1.5">
          <span className="text-[11.5px] text-text-dim">{p.startHelper}</span>
          {(p.preflight ?? []).map((c) => (
            <span
              key={c.label}
              className={cn(
                "inline-flex items-center gap-1.5 text-[11.5px]",
                c.ok ? "text-text-dim" : "text-state-error",
              )}
            >
              {c.ok ? (
                <CheckGlyph size={10} className="shrink-0 text-state-success" />
              ) : (
                <ErrorGlyph size={10} className="shrink-0" />
              )}
              {c.label}
            </span>
          ))}
        </div>
      )}

      <div className="grid grid-cols-[1.4fr_1fr]">
        {/* left column */}
        <div className="flex flex-col gap-[18px] border-r border-divider px-5 pb-[22px] pt-[18px]">
          <div className="max-w-[52ch] text-[13px] leading-[1.6] text-text-secondary">
            {p.description}
          </div>

          {p.steps.length > 0 && (
            <div className="flex flex-col gap-2">
              <Eyebrow>{p.stepsLabel}</Eyebrow>
              <div className="flex flex-col">
                {p.steps.map((step, i) => (
                  <StepRow key={`${i}-${step.label}`} step={step} />
                ))}
              </div>
            </div>
          )}

          {p.paste.length > 0 && (
          <div className="flex flex-col gap-2">
            <Eyebrow>You paste</Eyebrow>
            <div className="flex flex-col gap-1.5">
              {p.paste.map((chip) => (
                <div key={chip.name} className="flex flex-wrap items-center gap-2.5">
                  <PasteChip
                    name={chip.name}
                    hint={chip.into ? `→ ${chip.into}` : undefined}
                    height={28}
                    raised
                    onClick={() => p.onChip?.(chip.name)}
                  />
                  {chip.note && <span className="text-[11.5px] text-text-subtle">{chip.note}</span>}
                </div>
              ))}
            </div>
          </div>
          )}

          {p.docs.length > 0 && (
          <div className="flex flex-col gap-2">
            <Eyebrow>Documents</Eyebrow>
            <div className="overflow-hidden rounded-md bg-fill-subtle">
              {p.docs.map((doc, i) => (
                <DocRow key={doc.path} doc={doc} last={i === p.docs.length - 1} />
              ))}
            </div>
          </div>
          )}
        </div>

        {/* right column: saves */}
        <div className="flex flex-col gap-3 px-5 pb-[22px] pt-[18px]">
          <Eyebrow>Saves during this phase</Eyebrow>
          {p.saves.kind === "list" && (
            <div className="flex flex-col">
              {p.saves.entries.map((save, i) => (
                <SaveRow
                  key={save.hash}
                  save={save}
                  last={i === (p.saves as { entries: DetailSave[] }).entries.length - 1}
                />
              ))}
            </div>
          )}
          {p.saves.kind === "empty" && (
            <div className="rounded-md border border-dashed border-border-strong p-3 text-[12.5px] text-text-subtle">
              {p.saves.message}
            </div>
          )}
          {p.saves.kind === "loading" && (
            <div className="flex items-center gap-2 rounded-md border border-divider p-3 text-[12.5px] text-state-neutral">
              <Spinner size={12} />
              Looking…
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
