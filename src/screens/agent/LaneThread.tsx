/*
 * A lane opened (board R2): back to the run, the lane's title and state, its
 * items, the files it owns, and — after its thread, which AgentPane renders
 * with the same rows as the chat — its gate cards: the checks after each
 * save, the failing output, the review. A stopped lane offers Discard.
 */
import { useState } from "react";
import { Eyebrow } from "@/components/chrome/atoms";
import { CheckGlyph, ChevronLeftGlyph, ChevronRightGlyph, WarnGlyph } from "@/components/chrome/icons";
import { runLaneDiscard } from "@/lib/runs-ipc";
import {
  checkRows, fmtCost, fmtElapsed, laneElapsed, laneItemTitles, laneWord, leakParts, ownsLabel, reviewLine, stoppedLaneLine,
  type Gate, type LaneRecord, type RunRecord,
} from "@/lib/runs-model";
import type { ConfirmSpec } from "@/overlays/ConfirmDialog";
import { toastError, toastSuccess } from "@/overlays/toasts";
import { ChatBtn, Chip, CheckRow, LeakNotice, Mono, RunWord } from "./run-atoms";

export function LaneHeader({ dir, rec, lane, onBack, now, onConfirm }: {
  dir: string; rec: RunRecord; lane: LaneRecord; onBack: () => void; now: number;
  /** asks before Discard puts the lane's files back; without it Discard acts at once */
  onConfirm?: (spec: ConfirmSpec) => void;
}) {
  const spec = rec.lane_map?.lanes.find((l) => l.id === lane.id);
  const [open, setOpen] = useState(true);
  const id = lane.id.toUpperCase();
  const stopped = stoppedLaneLine(lane);
  const doDiscard = () =>
    void runLaneDiscard(dir, rec.n, lane.id)
      .then((k) => toastSuccess("Discarded", `${k} ${k === 1 ? "file" : "files"} put back`))
      .catch((e) => toastError("Couldn’t discard", String(e).slice(0, 110)));
  // (new copy) the confirm before a stopped lane's changes are put back
  const discard = () =>
    onConfirm
      ? onConfirm({
          title: `Discard lane ${id}’s unsaved changes?`,
          body: "Puts the files this lane changed back the way they were. What it saved stays saved.",
          cancelLabel: "Keep them",
          confirmLabel: "Discard them",
          danger: true,
          onConfirm: doDiscard,
        })
      : doDiscard();
  return (
    <div className="mx-3.5 mb-0.5 mt-1 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <button type="button" onClick={onBack} data-lane-back className="inline-flex items-center gap-1 text-[11.5px] text-text-secondary hover:text-text-primary"><ChevronLeftGlyph size={11} />Back to the run</button>
        <span className="flex-1" />
        <Mono className="text-text-faint">Round {rec.round ?? rec.n} · lane {id}</Mono>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold text-text-primary">{spec?.title}</span>
        <RunWord w={laneWord(rec, lane)} />
        <span className="flex-1" />
        <Mono className="text-[11px]">{fmtCost(lane.cost_usd)} · {fmtElapsed(laneElapsed(lane, now))}</Mono>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        {spec?.items.map((i) => <Chip key={i}>{i}</Chip>)}
        <span className="ml-1 text-[11.5px] text-text-muted">{laneItemTitles(rec, lane)}</span>
      </div>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex h-[22px] items-center gap-1.5 self-start">
        <span className="flex text-text-dim transition-transform duration-(--dur-fast) ease-(--ease-pane)" style={{ transform: open ? "rotate(90deg)" : undefined }}><ChevronRightGlyph size={11} /></span>
        <span className="text-[11px] text-text-faint">{ownsLabel(rec, lane)}</span>
      </button>
      {open && <div className="-mt-1 mb-1 ml-[17px] flex flex-col gap-[3px]">{spec?.owns.map((p) => <Mono key={p} className="text-text-subtle">{p}</Mono>)}</div>}
      {/* a change this lane made to a file it doesn't own, or another lane made to one it does */}
      {lane.leak.length > 0 && (
        <div className="-ml-[18px] flex flex-col">{lane.leak.map((k) => <LeakNotice key={`${k.path}:${k.by ?? ""}`} parts={leakParts(k)} />)}</div>
      )}
      {stopped && (
        <div className="flex items-center gap-2">
          <span className="flex-1 text-[11.5px] text-text-muted">{stopped}</span>
          <ChatBtn kind="quiet" onClick={discard}>Discard them</ChatBtn>
        </div>
      )}
    </div>
  );
}

export function GateCard({ label, gate }: { label: string; gate: Gate }) {
  const failed = gate.checks.find((c) => c.exit !== 0);
  const rv = gate.review;
  return (
    <div className="mx-3.5 mb-1 mt-1.5 rounded-lg border border-border-hairline bg-surface-card px-3 py-2">
      <div className="mb-0.5 flex items-center gap-2"><Eyebrow className="text-text-faint">{label}</Eyebrow></div>
      {checkRows(gate).map((r) => <CheckRow key={r.name} row={r} />)}
      {failed?.tail && <div data-selectable className="mt-1.5 overflow-hidden whitespace-pre-wrap rounded-md bg-surface-input px-2.5 py-2 font-mono text-[10.5px] leading-[1.6] text-text-muted">{failed.tail}</div>}
      {gate.notice && <div className="mt-1 text-[11px] text-text-faint">{gate.notice}</div>}
      {rv && (
        <div className="mt-1 flex flex-col gap-1 border-t border-divider pt-1">
          <div className="flex h-[26px] items-center gap-2">
            <span className={rv.pass ? "flex w-3 justify-center text-state-success" : "flex w-3 justify-center text-state-warn"}>{rv.pass ? <CheckGlyph size={12} /> : <WarnGlyph size={12} />}</span>
            <span className="text-[11.5px] text-text-muted">{reviewLine(rv)}</span>
          </div>
          {!rv.pass && rv.findings.map((f, i) => (
            <div key={i} className="ml-5 text-[11.5px] leading-[1.5] text-text-muted">{f.file && <Mono className="text-text-secondary">{f.file}:{f.line}</Mono>} {f.what}</div>
          ))}
        </div>
      )}
    </div>
  );
}
