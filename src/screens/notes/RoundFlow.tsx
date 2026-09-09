/*
 * "Start a round ▸" turns the queued notes into a fix plan — the same
 * background session Kanban's ExecuteFlow drove (that file is deleted in
 * Task 9; its generating-card markup is lifted here). No preflight, no done
 * card: the sidebar button starts it directly (via the imperative handle)
 * and a toast offers to run it once the plan is written.
 */
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { BtnSecondary, MonoMeta, Spinner } from "@/components/chrome/atoms";
import { fixesCancel, fixesGenerate, fixesStatus } from "@/lib/ipc";
import { useSessionStatus } from "@/lib/session-status";
import { initProgress, logLinesFrom } from "@/lib/roadmap-data";
import { openRoundFor, refreshNotes, setRoundGenerating } from "@/lib/notes-store";
import { toastAction, toastError } from "@/overlays/toasts";

type State =
  | { kind: "idle" }
  | { kind: "generating"; startedAt: number; logLines: string[]; activeLine: string; progress: number };

export interface RoundFlowHandle { start: () => void }

export const RoundFlow = forwardRef<RoundFlowHandle, {
  dir: string;
  agent: "claude" | "codex";
  onRunInPane?: (n: number, total: number) => void;
  onGoRoadmap?: () => void;
}>(function RoundFlow({ dir, agent, onRunInPane, onGoRoadmap }, ref) {
  const [state, setState] = useState<State>({ kind: "idle" });
  const settled = useRef(false);
  const dirRef = useRef(dir); dirRef.current = dir;
  const agentRef = useRef(agent); agentRef.current = agent;

  useImperativeHandle(ref, () => ({
    start: () => {
      settled.current = false;
      setState({ kind: "generating", startedAt: Date.now(), logLines: [], activeLine: "Starting the session…", progress: 0.06 });
      fixesGenerate(dirRef.current, agentRef.current)
        .then(() => { setRoundGenerating(dirRef.current, true); void refreshNotes(dirRef.current); })
        .catch((e) => {
          setState({ kind: "idle" });
          toastError("Couldn't start the round", String(e).slice(0, 90));
        });
    },
  }), []);

  const st = useSessionStatus(dir, "fixes", state.kind === "generating", fixesStatus);
  useEffect(() => {
    if (state.kind !== "generating" || !st) return;
    const tail = st.log_tail ?? "";
    const lines = logLinesFrom(tail);
    if (st.running !== false) {
      settled.current = false;
      setState((s) => s.kind === "generating"
        ? { kind: "generating", startedAt: st.started_at || s.startedAt, logLines: lines.slice(0, -1), activeLine: lines[lines.length - 1] ?? "Starting the session…", progress: initProgress(tail) }
        : s);
      return;
    }
    if (settled.current) return;
    settled.current = true;
    setRoundGenerating(dir, false);
    void (async () => {
      await refreshNotes(dir);
      setState({ kind: "idle" });
      if (st.cancelled) return;
      if ((st.code ?? 1) !== 0) {
        toastError("The round didn't finish", `Exited with code ${st.code ?? "?"} — your notes are untouched`);
        return;
      }
      const open = openRoundFor(dir);
      if (open) {
        toastAction(`Round ${open.n} is ready`, "Run it in the agent", () => onRunInPane?.(open.n, open.total));
      } else if (onGoRoadmap) {
        toastAction("The round finished", "View the roadmap", onGoRoadmap);
      } else {
        toastError("The round finished, but nothing's left queued for it");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [st]);

  if (state.kind !== "generating") return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Starting a round"
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/45 p-6"
    >
      <div className="flex w-[440px] flex-col gap-3 rounded-lg border border-border-hairline bg-surface-card p-5">
        <div className="flex items-center gap-2.5">
          <Spinner size={14} />
          <span className="text-sm font-medium text-text-primary">Writing the fix plan…</span>
          <span className="flex-1" />
          <MonoMeta className="text-text-dim">
            {(() => {
              const s = Math.round((Date.now() - state.startedAt) / 1000);
              return s >= 60 ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s` : `${s}s`;
            })()}
          </MonoMeta>
        </div>
        <div className="h-[3px] overflow-hidden rounded-[2px] bg-fill-hover">
          <div
            className="h-full rounded-[2px] bg-state-neutral"
            style={{ width: `${Math.round(state.progress * 100)}%` }}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-[5px] overflow-hidden rounded-md bg-surface-input px-[13px] py-[11px] font-mono text-[11px] text-text-dim">
          {state.logLines.map((line, i) => (
            <div key={i} className="truncate">{line}</div>
          ))}
          <div className="truncate text-text-subtle">
            {state.activeLine}
            <span style={{ animation: "wv-pulse 1.1s step-end infinite" }}>▍</span>
          </div>
        </div>
        <div className="flex justify-end">
          <BtnSecondary
            onClick={() => {
              fixesCancel(dir)
                .then(() => { setRoundGenerating(dir, false); setState({ kind: "idle" }); void refreshNotes(dir); })
                .catch((e) => toastError("Couldn't stop it", String(e).slice(0, 90)));
            }}
          >
            Cancel
          </BtnSecondary>
        </div>
      </div>
    </div>
  );
});
