/*
 * The pinned round card — what the round is, what it is doing, and (the part
 * that was missing) how to actually run it.
 *
 * A round whose plan is written sits at `ready` in the record and looks
 * identical to one that is executing; the only affordance for starting it was
 * a toast action that is easy to miss, so a written plan could sit untouched
 * while the card said "working". `plan-ready` is now its own phase with its
 * own three buttons: the two routes a round can actually run in, and the
 * prompt for anywhere else.
 *
 * A running round is somewhere you can go and look — the agent pane or a
 * terminal tab — so the executing card's first button is the way there, and
 * the second is the honest escape for a run that ended without the app
 * hearing about it.
 *
 * Presentational plus its own commands: everything it needs about the round
 * arrives as props (so the memo holds while the user types), and the actions
 * it owns are the ones that only make sense here.
 */
import { memo, useState } from "react";
import { TreeRow } from "@/components/chrome/Tree";
import { DocGlyph } from "@/components/chrome/icons";
import { copyText, readFileText, roundPlanCancel, type NoteEntry } from "@/lib/ipc";
import { agentSessionFor, cancelAgentTurn } from "@/lib/agent-session";
import { clearRunningRound, dismissRound } from "@/lib/round-log";
import { refreshNotes, setRoundGenerating } from "@/lib/notes-store";
import { roundSubline, type RoundPhase, type RoundRoute } from "@/lib/notes-model";
import { toastError, toastSuccess } from "@/overlays/toasts";
import { StatusChip } from "./StatusChip";
import { cn } from "@/lib/utils";

/** Everything the card needs about the round — NotesPane assembles it once,
 *  from the index and the live sessions, so the memo holds while the user types. */
export interface RoundCardData {
  phase: RoundPhase;
  n: number;
  /** "bug fixes" / "feature additions", as the plan's first line declared it */
  kind: string;
  notes: NoteEntry[];
  done: number;
  route: RoundRoute | null;
  /** the tab running it, when the route is a terminal — "Open the terminal" */
  termId?: number;
}

/** A note's row label. Before anything runs, "working" would be a lie; after
 *  the round is over, so would "in round". */
function rowStatus(note: NoteEntry, phase: RoundPhase): { label: string; tone: string } {
  if (note.status === "done") return { label: "done", tone: "done" };
  if (phase === "executing") return { label: "working", tone: "progress" };
  if (phase === "finished" || phase === "failed") return { label: "not done", tone: "unknown" };
  return { label: "in round", tone: "queued" };
}

const BTN = "shrink-0 rounded-xs border border-border-hairline px-[7px] py-[3px] text-[10.5px] text-text-dim hover:bg-fill-hover hover:text-text-primary disabled:opacity-50";

export const RoundCard = memo(function RoundCard({
  dir, round, openPath, onOpenNote, onRunInPane, onRunInTerminal, onRevealPane, onRevealTerminal,
}: {
  dir: string;
  round: RoundCardData;
  openPath: string | null;
  onOpenNote: (path: string) => void;
  /** hands the round to the ACP session in the agent pane */
  onRunInPane?: (n: number, total: number) => void;
  /** spawns a terminal tab and types the round's run message into it */
  onRunInTerminal?: (n: number, total: number) => void;
  /** show the agent pane — where a round on the pane route is running */
  onRevealPane?: () => void;
  /** show the terminal column and put this round's tab on top */
  onRevealTerminal?: (termId: number) => void;
}) {
  const { phase, n, kind, notes, done, route, termId } = round;
  const [busy, setBusy] = useState(false);
  const total = notes.length;

  const copyPrompt = () => {
    readFileText(dir, `fixes/phase_${n}_fixes_prompt.md`)
      .then((text) => copyText(text))
      .then(() => toastSuccess("Prompt copied", "Paste it into any agent — it names the plan and the notes."))
      .catch((e) => toastError("Couldn't copy the prompt", String(e).slice(0, 90)));
  };

  /* Neither route has a session to cancel: the pane's thread IS the round, and
     a terminal tab is the user's to stop (or close) themselves. All the card
     can do is stop claiming it is running, which is what the user needs when
     the run ended without the app hearing about it. */
  const forgetRun = () => clearRunningRound(dir);

  /* A plan being written is a turn in the agent pane, so the TURN goes first:
     cancelling it ends the plan cleanly and its own turn-end path does the
     record cancel, which leaves ours below a no-op. The record cancel still
     runs unconditionally because the record can be stranded with no turn at
     all (the app restarted mid-plan, the session died without ever ending its
     turn) — that is the case where Stop is the only way out of "writing the
     plan…", and it has to work. Cancelling twice is safe: the backend's cancel
     does nothing when no round is generating. */
  const stopPlan = () => {
    setBusy(true);
    (agentSessionFor(dir).turnActive ? cancelAgentTurn(dir) : Promise.resolve())
      .then(() => roundPlanCancel(dir))
      .then(() => { setRoundGenerating(dir, false); return refreshNotes(dir); })
      .then(() => toastSuccess("Stopped the plan", "Your notes are back in the queue"))
      .catch((e) => toastError("Couldn't stop it", String(e).slice(0, 90)))
      .finally(() => setBusy(false));
  };

  return (
    <div className="mx-2 mb-2 mt-1 rounded-lg border border-border-strong bg-surface-card px-3 py-2.5">
      <div className="truncate text-[12.5px] font-semibold text-text-primary">
        Round {n} · {kind}
      </div>

      <div className="mt-0.5 text-[11px] text-text-muted">
        {roundSubline(phase, route, done, total)}
      </div>

      {(phase === "generating" || phase === "executing") && total > 0 && (
        <div className="my-2.5 h-[2px] overflow-hidden rounded-[1px] bg-fill-subtle">
          <div
            className="h-full rounded-[1px] bg-state-neutral"
            style={{ width: `${Math.round((done / total) * 100)}%` }}
          />
        </div>
      )}

      {total > 0 && (
        <div className={cn("flex flex-col text-[12.5px] text-text-secondary", phase === "plan-ready" && "mt-2")}>
          {notes.map((note) => (
            <TreeRow
              key={note.path}
              name={note.title}
              marquee
              icon={<DocGlyph size={13} strokeWidth={1.2} className="shrink-0 text-text-subtle" />}
              selected={note.path === openPath}
              trailing={<StatusChip {...rowStatus(note, phase)} />}
              onClick={() => onOpenNote(note.path)}
            />
          ))}
        </div>
      )}

      {phase === "plan-ready" && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {onRunInPane && (
            <button type="button" disabled={busy} onClick={() => onRunInPane(n, total)} className={BTN}>Run in the pane</button>
          )}
          {onRunInTerminal && (
            <button type="button" disabled={busy} onClick={() => onRunInTerminal(n, total)} className={BTN}>Run in a terminal</button>
          )}
          <button type="button" onClick={copyPrompt} className={BTN}>Copy the prompt</button>
        </div>
      )}

      {phase === "generating" && (
        <div className="mt-2.5 flex gap-1.5">
          <button type="button" disabled={busy} onClick={stopPlan} className={BTN}>Stop</button>
        </div>
      )}

      {phase === "executing" && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {route === "terminal" && termId != null && onRevealTerminal && (
            <button type="button" onClick={() => onRevealTerminal(termId)} className={BTN}>Open the terminal</button>
          )}
          {route === "pane" && onRevealPane && (
            <button type="button" onClick={onRevealPane} className={BTN}>Open the pane</button>
          )}
          <button type="button" onClick={forgetRun} className={BTN}>Not running anymore</button>
        </div>
      )}

      {(phase === "finished" || phase === "failed") && (
        <div className="mt-2.5 flex gap-1.5">
          <button type="button" onClick={() => dismissRound(dir, n)} className={BTN}>Dismiss</button>
          {phase === "failed" && (
            <button type="button" onClick={copyPrompt} className={BTN}>Copy the prompt</button>
          )}
        </div>
      )}
    </div>
  );
});
