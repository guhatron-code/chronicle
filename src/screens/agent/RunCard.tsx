/*
 * The run card in the chat thread (boards R1, R3, R4): the plan row, the
 * latest decision, then one row per lane with the run's cost and elapsed time
 * in the header, the final check while it runs, the needs-you rows with their
 * one or two buttons, and one sentence saying what is happening. Every word
 * comes from runs-model.ts.
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import { resumeRunInPane, type AgentEntry } from "@/lib/agent-session";
import { every } from "@/lib/scheduler";
import { runFor, runsVersion, subscribeRuns } from "@/lib/runs-store";
import { runNeedsYou, runStop, type NeedsAct } from "@/lib/runs-ipc";
import {
  decisionLine, elapsedMs, finalCheckRows, fmtCost, fmtElapsed, laneWord, lanesSummary, leakParts, needsWord, needsYouRows,
  planRowLine, planRowState, runFooter, runOver, runTitle, runWord, tryLabel, type LaneRecord, type NeedsRow, type RunRecord, type Word,
} from "@/lib/runs-model";
import { Spinner } from "@/components/chrome/atoms";
import { CheckGlyph, ChevronRightGlyph, ErrorGlyph, LanesGlyph, SparkGlyph, WarnGlyph } from "@/components/chrome/icons";
import { toastError } from "@/overlays/toasts";
import { cn } from "@/lib/utils";
import { ChatBtn, Chip, CheckRow, DecisionLine, LeakNotice, Mono, RunWord } from "./run-atoms";

type RunEntry = Extract<AgentEntry, { kind: "run" }>;
type Act = NeedsRow["actions"][number]["act"];

function PlanRow({ entry, rec, onOpenFile }: { entry: RunEntry; rec: RunRecord | null; onOpenFile?: (p: string) => void }) {
  const state = planRowState(rec, entry);
  const planned = state === "planned";
  const lead = planned ? <span className="flex text-state-success"><CheckGlyph size={12} /></span>
    : state === "failed" ? <span className="flex text-state-error"><ErrorGlyph size={12} /></span> : <Spinner size={11} />;
  return (
    <div className="mx-3.5 my-1 flex h-[38px] items-center gap-2 rounded-[10px] border border-border-hairline bg-surface-card-raised px-3.5">
      {lead}
      <span className="min-w-0 truncate text-[12.5px] text-text-primary">{planRowLine(rec, entry)}</span>
      <span className="flex-1" />
      {rec && rec.planner_cost_usd > 0 && <Mono className="text-[11px]">{fmtCost(rec.planner_cost_usd)}</Mono>}
      {planned && onOpenFile && rec?.plan_path && (
        <button type="button" onClick={() => onOpenFile(rec.plan_path)} className="whitespace-nowrap text-[11.5px] text-text-secondary hover:text-text-primary">Open the plan ›</button>
      )}
    </div>
  );
}

function LaneRow({ rec, lane, last, onOpen }: { rec: RunRecord; lane: LaneRecord; last: boolean; onOpen: () => void }) {
  const spec = rec.lane_map?.lanes.find((l) => l.id === lane.id);
  const t = tryLabel(lane);
  return (
    <div className={cn("flex flex-col", !last && "border-b border-divider")}>
      <button type="button" onClick={onOpen} data-run-lane={lane.id} className="flex h-[34px] min-w-0 items-center gap-2 rounded-sm px-0.5 text-left hover:bg-fill-hover">
        <Mono className="w-2.5 text-text-faint">{lane.id.toUpperCase()}</Mono>
        <span className="min-w-0 truncate text-[12.5px] text-text-primary">{spec?.title}</span>
        <span className="flex gap-1">{spec?.items.map((i) => <Chip key={i}>{i}</Chip>)}</span>
        <span className="flex-1" />
        {t && <Mono>{t}</Mono>}
        <RunWord w={laneWord(rec, lane)} />
        {lane.cost_usd > 0 && <Mono className="text-[11px]">{fmtCost(lane.cost_usd)}</Mono>}
        <span className="flex text-text-dim"><ChevronRightGlyph size={11} /></span>
      </button>
      {lane.leak.map((k) => <LeakNotice key={`${k.path}:${k.by ?? ""}`} parts={leakParts(k)} />)}
    </div>
  );
}

function NeedsYouRow({ row, word, onAct }: { row: NeedsRow; word: Word; onAct: (row: NeedsRow, act: Act, text?: string) => Promise<void> }) {
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fire = (a: Act, text?: string) => {
    setBusy(true);
    void onAct(row, a, text).then(() => setDraft(null), () => {}).finally(() => setBusy(false));
  };
  const buttons = (
    <div className="flex shrink-0 gap-1.5">
      {row.actions.map((a) => (
        <ChatBtn key={a.label} kind={a.primary ? "primary" : a.act === "open" || a.act === "dismiss" ? "quiet" : "secondary"} disabled={busy}
          onClick={() => (a.act === "rewrite" ? setDraft(row.title) : fire(a.act))}>{a.label}</ChatBtn>
      ))}
    </div>
  );
  if (row.kind === "parked") {
    return (
      <div className="flex flex-col gap-[7px] rounded-lg border border-border-hairline bg-surface-card px-3 py-2.5">
        <div className="flex items-center gap-2">
          <RunWord w={word} />
          {row.item && <Chip>{row.item}</Chip>}
          <span className="min-w-0 text-[12.5px] font-medium text-text-primary">{row.title}</span>
        </div>
        <div className="text-xs leading-[1.55] text-text-muted">{row.body}</div>
        {row.reading && (
          <div className="flex items-center gap-2">
            <span className="flex text-text-subtle"><SparkGlyph size={12} /></span>
            <span className="flex-1 text-[11.5px] text-text-muted">likely impossible as written</span>
            <Mono>{row.reading}</Mono>
          </div>
        )}
        {draft === null ? buttons : (
          <div className="flex flex-col gap-1.5">
            <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={2} autoFocus
              className="resize-none rounded-md border border-border-field bg-surface-input px-2.5 py-1.5 text-[12.5px] text-text-primary outline-none focus:border-border-field-focus" />
            <div className="flex gap-1.5">
              {/* (new copy) the rewrite's two buttons */}
              <ChatBtn kind="primary" disabled={busy || !draft.trim()} onClick={() => fire("rewrite", draft)}>Run it as one more lane</ChatBtn>
              <ChatBtn kind="quiet" disabled={busy} onClick={() => setDraft(null)}>Cancel</ChatBtn>
            </div>
          </div>
        )}
      </div>
    );
  }
  return (
    <div className="flex items-start gap-2 rounded-lg border border-border-hairline bg-surface-card px-3 py-[9px]">
      <span className="mt-0.5 flex shrink-0 text-state-warn"><WarnGlyph size={12} /></span>
      <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
        <span className="text-[12.5px] text-text-primary">{row.title}</span>
        {row.body && <span className="text-[11.5px] text-text-muted">{row.body}</span>}
        {row.mono && <pre className="mt-1 whitespace-pre-wrap rounded-md bg-surface-input px-2.5 py-2 font-mono text-[10.5px] leading-[1.6] text-text-muted">{row.mono}</pre>}
      </div>
      {buttons}
    </div>
  );
}

export function RunEntryCard({ dir, entry, onOpenLane, onOpenFile }: {
  dir: string; entry: RunEntry; onOpenLane: (n: number, lane: string) => void; onOpenFile?: (path: string) => void;
}) {
  useSyncExternalStore(subscribeRuns, runsVersion, runsVersion);
  const rec = runFor(dir, entry.n);
  const live = rec != null && !runOver(rec) && rec.state !== "interrupted";
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => (live ? every(1000, () => setNow(Date.now())) : undefined), [live]);
  const act = (row: NeedsRow, a: Act, text?: string): Promise<void> => {
    if (a === "open") { if (row.lane) onOpenLane(entry.n, row.lane); return Promise.resolve(); }
    const payload: NeedsAct = a === "skip" ? { kind: "skip", item: row.item ?? "" } : a === "rewrite" ? { kind: "rewrite", item: row.item ?? "", text: text ?? "" }
      : a === "retry" ? { kind: "retry", lane: row.lane ?? "" } : a === "recheck" ? { kind: "recheck" } : { kind: "dismiss", index: row.index };
    return runNeedsYou(dir, entry.n, payload).catch((e) => { toastError("Couldn’t do that", String(e).slice(0, 110)); throw e; });
  };
  const decision = rec ? decisionLine(rec) : null;
  const gating = rec?.state === "gating" || rec?.state === "closing";
  return (
    <div className="flex flex-col">
      {entry.part !== "card" && <PlanRow entry={entry} rec={rec} onOpenFile={onOpenFile} />}
      {entry.part === "plan" ? null : decision && live && (
        <DecisionLine prob={decision.prob}>{decision.lead} <Mono className="text-[11px] text-text-secondary">{decision.command}</Mono> {decision.tail}</DecisionLine>
      )}
      {entry.part !== "plan" && rec?.lane_map && (
        <div data-run-card className="mx-3.5 my-1 flex flex-col gap-2 rounded-[10px] border border-border-hairline bg-surface-card-raised px-3.5 pb-2.5 pt-3">
          <div className="flex items-center gap-2 whitespace-nowrap">
            <span className="text-[13px] font-semibold text-text-primary">{runTitle(rec, entry.total)}</span>
            <RunWord w={runWord(rec)} size={12} />
            <span className="flex-1" />
            <span className="inline-flex items-center gap-[5px] text-[11.5px] text-text-muted"><LanesGlyph size={12} />{lanesSummary(rec)}</span>
            <Mono className="text-[11px] text-text-muted">{fmtCost(rec.cost.usd)}</Mono>
            <Mono className="text-[11px]">{fmtElapsed(elapsedMs(rec, now))}</Mono>
          </div>
          <div className="flex flex-col">
            {rec.lanes.map((l, i) => (
              <LaneRow key={l.id} rec={rec} lane={l} last={i === rec.lanes.length - 1 && !gating} onOpen={() => onOpenLane(entry.n, l.id)} />
            ))}
            {gating && (
              <div className="mt-1.5 border-t border-divider px-0.5 pb-0.5 pt-2">
                <div className="flex h-[26px] items-center gap-2">
                  <Spinner size={11} />
                  <span className="text-[12.5px] text-text-primary">Checking everything together</span>
                  <span className="flex-1" />
                  <Mono className="text-[11px]">{finalCheckRows(rec).length} checks</Mono>
                </div>
                <div className="ml-[19px]">{finalCheckRows(rec).map((c) => <CheckRow key={c.name} row={c} />)}</div>
              </div>
            )}
          </div>
          {rec.needs_you.length > 0 && (
            <div className="flex flex-col gap-1.5 pt-0.5">
              {/* keyed by what the row is about, so an open rewrite draft stays with its item when rows shift */}
              {(() => {
                const seen = new Map<string, number>();
                return needsYouRows(rec).map((row) => {
                  const base = `${row.kind}:${row.item ?? row.lane ?? "run"}`;
                  const k = (seen.get(base) ?? 0) + 1;
                  seen.set(base, k);
                  return <NeedsYouRow key={`${base}:${k}`} row={row} word={needsWord(rec, row.lane)} onAct={act} />;
                });
              })()}
            </div>
          )}
          {rec.notices.at(-1) && <span className="text-[11px] leading-normal text-text-faint">{rec.notices.at(-1)}</span>}
          <div className="flex items-center gap-2.5 pt-0.5">
            <span className="flex-1 text-[11.5px] leading-normal text-text-muted">{runFooter(rec)}</span>
            {rec.state === "interrupted" ? (
              <ChatBtn kind="primary" onClick={() => void resumeRunInPane(dir, entry.n).catch((e) => toastError("Couldn’t resume the round", String(e).slice(0, 110)))}>Resume</ChatBtn>
            ) : live ? (
              <ChatBtn kind="quiet" onClick={() => void runStop(dir, entry.n).catch((e) => toastError("Couldn’t stop the round", String(e).slice(0, 110)))}>Stop</ChatBtn>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
