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
 * The tail the session carries is capped at 30 kB by Rust, and again at
 * LOG_MAX_LINES here; "Open full log" tails the real file in a terminal tab,
 * exactly as the roadmap's View-full-log does.
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
  const kind = phase === "generating" ? "fixes" : "exec";
  const [, bump] = useState(0);
  useEffect(() => subscribeRoundLog(() => bump((x) => x + 1)), []);
  // the only thing that keeps the listener alive: no panel, no subscription
  useEffect(() => { armRoundLog(dir, kind); return () => armRoundLog(dir, null); }, [dir, kind]);

  const log = roundLogFor(dir);
  const lines = tailLines(log.tail, LOG_MAX_LINES);

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
    (kind === "fixes" ? fixesLogPath(dir) : execLogPath(dir))
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
        <button
          type="button"
          onClick={openFullLog}
          className="rounded-[5px] px-1.5 py-0.5 text-[11px] text-text-dim hover:bg-fill-hover hover:text-text-primary"
        >
          Open full log
        </button>
        <button
          type="button"
          aria-label="Hide the log"
          onClick={onClose}
          className="flex size-[22px] items-center justify-center rounded-[5px] text-text-dim hover:bg-fill-hover hover:text-text-primary"
        >
          <XGlyph size={10} />
        </button>
      </div>
      <div
        ref={boxRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = stickToBottom(el.scrollTop, el.scrollHeight, el.clientHeight);
        }}
        className="min-h-0 flex-1 overflow-y-auto px-4 py-2 font-mono text-[11.5px] leading-[1.5] text-text-dim"
      >
        {lines.length === 0 ? (
          <div className="text-text-dimmer">
            {log.seen
              ? phase === "generating"
                ? "Nothing logged yet — the session is starting."
                : "Nothing logged yet. A round you sent to the agent pane reports in the agent thread, not here."
              : "Reading the log…"}
          </div>
        ) : (
          lines.map((line, i) => <div key={i} className="whitespace-pre-wrap break-words">{line}</div>)
        )}
      </div>
    </div>
  );
});
