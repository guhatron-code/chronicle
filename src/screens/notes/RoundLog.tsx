/*
 * "Is it actually working?" — the round's own output, docked below the editor
 * where the backlinks footer sits (the footer steps aside while this is open).
 *
 * It draws the same log the roadmap's building card draws, from the same
 * source: the background session pushes `session-status` from Rust and the
 * payload carries the log tail. `round-log.ts` holds the tail so a new line
 * re-renders this panel and nothing else — the tree, the editor and the
 * backlinks never hear about it.
 *
 * It shows the log the CURRENT PHASE actually has. While the plan is being
 * written, and after it is written but before anything has run, that is the
 * generation session's log — showing an empty executor log there was the bug
 * that made a finished plan look like it had never run. Only once the headless
 * executor is live does the panel switch to the exec log.
 *
 * The tail the session carries is capped at 30 kB by Rust, and again at
 * LOG_MAX_LINES here; "Open full log" tails the real file in a terminal tab,
 * exactly as the roadmap's View-full-log does — and is hidden when the phase's
 * log has produced nothing, because there is no file to tail. The line area is
 * marked `data-selectable` so the text can be copied — the header row is chrome.
 */
import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { LOG_MAX_LINES, roundLogHeader, stickToBottom, tailLines, type RoundPhase } from "@/lib/notes-model";
import { armRoundLog, roundLogFor, subscribeRoundLog } from "@/lib/round-log";
import { execLogPath, fixesLogPath } from "@/lib/ipc";
import { setActiveTermFor, spawnTerm, termsFor } from "@/lib/term-sessions";
import { toastError } from "@/overlays/toasts";
import { XGlyph } from "@/components/chrome/icons";

const TERM_TITLE = "Round log";

export const RoundLog = memo(function RoundLog({
  dir, phase, n, done, total, onClose, onRevealTerminal,
}: {
  dir: string;
  phase: RoundPhase;
  n: number;
  done: number;
  total: number;
  onClose: () => void;
  onRevealTerminal?: () => void;
}) {
  // the log that exists for this phase. A round that finished ran an executor,
  // so its log is the exec one; a `failed` round never got past generation, so
  // its log — the one that says why — is the generation session's.
  const kind = phase === "executing" || phase === "finished" ? "exec" : "fixes";
  const [, bump] = useState(0);
  useEffect(() => subscribeRoundLog(() => bump((x) => x + 1)), []);
  // the only thing that keeps the listener alive: no panel, no subscription
  useEffect(() => { armRoundLog(dir, kind); return () => armRoundLog(dir, null); }, [dir, kind]);

  const log = roundLogFor(dir, kind);
  const lines = tailLines(log.tail, LOG_MAX_LINES);
  // a tail with something in it is the proof the file is there — the exec log
  // path resolves to a name whether or not anything ever wrote to it
  const hasFile = lines.length > 0;

  /* follow the tail until the reader scrolls up, and pick it up again when they
     scroll back down — measured before the paint that would move it */
  const boxRef = useRef<HTMLDivElement | null>(null);
  const stick = useRef(true);
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [lines.length, log.tail]);

  const openFullLog = () => {
    const existing = termsFor(dir).find((t) => t.title === TERM_TITLE && !t.dead);
    onRevealTerminal?.();
    if (existing) { setActiveTermFor(dir, existing.id); return; }
    (kind === "exec" ? execLogPath(dir) : fixesLogPath(dir))
      .then((path) => spawnTerm(dir, { title: TERM_TITLE, autoType: `tail -n 200 -f '${path.replace(/'/g, "'\\''")}'` }))
      .catch((e) => toastError("Couldn't open the log", String(e).slice(0, 90)));
  };

  return (
    <div className="flex h-[240px] flex-none flex-col border-t border-border-hairline bg-surface-card">
      <div className="flex h-8 flex-none items-center gap-2.5 border-b border-border-hairline pl-4 pr-2">
        <span
          aria-hidden
          className="size-[5px] shrink-0 rounded-full bg-state-neutral"
          style={log.running ? { animation: "wv-pulse 1.6s ease-in-out infinite" } : { opacity: 0.4 }}
        />
        <span className="min-w-0 truncate text-[11.5px] text-text-secondary">
          {roundLogHeader(phase, n, done, total)}
        </span>
        <span className="flex-1" />
        {hasFile && (
          <button
            type="button"
            onClick={openFullLog}
            className="rounded-[5px] px-1.5 py-0.5 text-[11px] text-text-dim hover:bg-fill-hover hover:text-text-primary"
          >
            Open full log
          </button>
        )}
        <button
          type="button"
          aria-label="Hide the log"
          onClick={onClose}
          className="flex size-[22px] items-center justify-center rounded-[5px] text-text-dim hover:bg-fill-hover hover:text-text-primary"
        >
          <XGlyph size={10} />
        </button>
      </div>
      {/* the lines are text worth copying — the header and its buttons above
          stay chrome, and chrome is not selectable (src/index.css) */}
      <div
        ref={boxRef}
        data-selectable
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = stickToBottom(el.scrollTop, el.scrollHeight, el.clientHeight);
        }}
        className="min-h-0 flex-1 overflow-y-auto px-4 py-2 font-mono text-[11.5px] leading-[1.5] text-text-dim"
      >
        {lines.length === 0 ? (
          <div className="text-text-dimmer">
            {!log.seen
              ? "Reading the log…"
              : phase === "generating"
                ? "Nothing logged yet — the session is starting."
                : phase === "plan-ready"
                  ? "The plan is written. Run the round to see the executor here."
                  : phase === "finished" || phase === "failed"
                    ? "This round left no log — it ran in the agent pane, or the log has been cleaned up since."
                    : "Nothing logged yet. A round you sent to the agent pane reports in the agent thread, not here."}
          </div>
        ) : (
          lines.map((line, i) => <div key={i} className="whitespace-pre-wrap break-words">{line}</div>)
        )}
      </div>
    </div>
  );
});
