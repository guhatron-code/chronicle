/*
 * The agent section of the right column (F31 + F37 header). Header: the
 * Claude mark stays colored at rest · the session state word (working /
 * waiting on you / idle / ended / needs login) · End session · the collapse
 * chevron. Collapsed = a slim re-open strip, never a vanished pane (the
 * title-bar toggle is what removes the unit entirely). The body is the
 * AgentPane, passed in by the wiring.
 */
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  agentSessionFor,
  agentStateWord,
  endAgentSession,
  listAgentSessions,
  resumeAgentSession,
  startAgentSession,
  subscribeAgent,
  viewAgentSession,
  type AgentHistoryRow,
} from "@/lib/agent-session";
import type { ConfirmSpec } from "@/overlays/ConfirmDialog";
import { toastError } from "@/overlays/toasts";
import { ClaudeStar, HistoryClockGlyph } from "@/components/chrome/icons";
import { cn } from "@/lib/utils";

function fmtAgo(ms: number): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** F37 — previous sessions by date; Resume only where the adapter allows it. */
function HistoryPopover({
  dir,
  onClose,
}: {
  dir: string;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<AgentHistoryRow[] | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    listAgentSessions(dir).then(setRows).catch(() => setRows([]));
  }, [dir]);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [onClose]);
  const anyReadOnly = (rows ?? []).some((r) => !r.resumable && !r.active);
  return (
    <div
      ref={ref}
      data-agent-history
      className="absolute right-2 top-9 z-20 flex w-[320px] flex-col rounded-[10px] border border-border-strong bg-surface-overlay p-1 [box-shadow:var(--shadow-overlay)]"
    >
      {rows === null ? (
        <div className="px-2.5 py-2 text-xs text-text-dim">Looking…</div>
      ) : rows.length === 0 ? (
        <div className="px-2.5 py-2 text-xs text-text-dim">No sessions yet — the first one lands here.</div>
      ) : (
        rows.slice(0, 12).map((r) => (
          <div key={r.id} className="flex flex-col gap-1 rounded-md px-2.5 py-2 hover:bg-fill-hover">
            <span className="overflow-hidden text-ellipsis whitespace-nowrap text-[12.5px] text-text-primary">
              {r.firstMessage || "(no message)"}
            </span>
            <div className="flex items-center gap-2">
              <span className="font-mono text-[10.5px] text-text-dim tabular-nums">
                {fmtAgo(r.updatedAt)} · {r.userMessages} {r.userMessages === 1 ? "message" : "messages"}
              </span>
              <span className="flex-1" />
              {r.active ? (
                <span className="text-[11px] text-text-dim">current</span>
              ) : r.resumable ? (
                <button
                  onClick={() => {
                    onClose();
                    void resumeAgentSession(dir, r.id).catch((e) => toastError("Couldn't resume it", String(e).slice(0, 110)));
                  }}
                  className="h-6 rounded-[6px] border border-border-strong px-2.5 text-[11px] font-medium text-text-primary hover:bg-fill-hover"
                >
                  Resume
                </button>
              ) : (
                <>
                  <button
                    onClick={() => {
                      onClose();
                      void viewAgentSession(dir, r.id).catch((e) => toastError("Couldn't open it", String(e).slice(0, 90)));
                    }}
                    className="text-[11px] text-text-muted hover:text-text-primary"
                  >
                    View
                  </button>
                  <span className="text-[11px] text-text-dimmer">·</span>
                  <button
                    onClick={() => {
                      onClose();
                      const ph = agentSessionFor(dir).phase;
                      if (ph === "none" || ph === "ended" || ph === "error") {
                        void startAgentSession(dir).catch((e) => toastError("Couldn't start the agent", String(e).slice(0, 90)));
                      }
                    }}
                    className="whitespace-nowrap text-[11px] text-text-muted hover:text-text-primary"
                  >
                    Continue in a new session
                  </button>
                </>
              )}
            </div>
          </div>
        ))
      )}
      {anyReadOnly && (
        <div className="mt-1 border-t border-divider-faint px-2.5 pb-1.5 pt-2 text-[11px] text-text-dim">
          Older sessions open read-only — this adapter can't resume them.
        </div>
      )}
    </div>
  );
}

const stateClasses = (kind: "dim" | "neutral" | "error") => ({
  text: kind === "neutral" ? "text-state-neutral" : kind === "error" ? "text-state-error" : "text-text-dim",
  dot: kind === "neutral" ? "bg-state-neutral" : kind === "error" ? "bg-state-error" : "bg-text-dim",
});

export function AgentSection({
  dir,
  collapsed,
  onToggleCollapsed,
  onConfirm,
  children,
}: {
  dir: string;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onConfirm: (spec: ConfirmSpec) => void;
  children?: ReactNode;
}) {
  const [, bump] = useState(0);
  const [histOpen, setHistOpen] = useState(false);
  useEffect(() => subscribeAgent(() => bump((n) => n + 1)), []);
  const s = agentSessionFor(dir);
  const { word, kind } = agentStateWord(s);
  const c = stateClasses(kind);
  const live = s.phase === "ready" || s.phase === "installing" || s.phase === "starting" || s.phase === "needs-login";

  const endSession = () => {
    const stop = () => void endAgentSession(dir).catch((e) => toastError("Couldn't end the session", String(e).slice(0, 90)));
    if (s.turnActive) {
      onConfirm({
        title: "End this session?",
        body: "The agent is still working. Ending the session stops it — file changes it already made are kept.",
        cancelLabel: "Let it finish",
        confirmLabel: "End the session",
        danger: true,
        onConfirm: stop,
      });
    } else stop();
  };

  if (collapsed) {
    return (
      <button
        data-agent-strip
        onClick={onToggleCollapsed}
        className="flex h-7 shrink-0 items-center gap-2 border-b border-divider px-3 text-left hover:bg-fill-subtle"
      >
        <ClaudeStar size={12} />
        <span className="text-[11.5px] font-medium text-text-secondary">Agent</span>
        <span className={cn("inline-flex items-center gap-1 whitespace-nowrap text-[11px]", c.text)}>
          <span className={cn("size-1 shrink-0 rounded-full", c.dot)} />
          {word}
        </span>
        <span className="flex-1" />
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-text-dim">
          <path d="m3 4.5 3 3 3-3" />
        </svg>
      </button>
    );
  }

  return (
    <div data-agent-section className="relative flex min-h-0 flex-1 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-divider px-3">
        <ClaudeStar size={13} />
        <span className="text-[12.5px] font-medium text-text-primary">Agent</span>
        <span data-agent-state className={cn("inline-flex items-center gap-[5px] whitespace-nowrap text-xs", c.text)}>
          <span
            className={cn("size-[5px] shrink-0 rounded-full", c.dot)}
            style={word === "working" ? { animation: "wv-pulse 1.6s ease-in-out infinite" } : undefined}
          />
          {word}
        </span>
        <span className="flex-1" />
        <button
          aria-label="Previous sessions"
          title="Previous sessions"
          onClick={() => setHistOpen((o) => !o)}
          className="flex size-6 items-center justify-center rounded-[6px] text-text-dim hover:bg-fill-hover hover:text-text-secondary"
        >
          <HistoryClockGlyph size={12} />
        </button>
        {live && (
          <button
            onClick={endSession}
            className="h-6 rounded-[6px] px-2 text-[11.5px] text-text-muted hover:bg-fill-hover hover:text-text-secondary"
          >
            End session
          </button>
        )}
        <button
          aria-label="Collapse the agent section"
          title="Collapse — a slim strip stays"
          onClick={onToggleCollapsed}
          className="flex size-6 items-center justify-center rounded-[6px] text-text-dim hover:bg-fill-hover hover:text-text-secondary"
        >
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="m3 7.5 3-3 3 3" />
          </svg>
        </button>
      </div>
      {histOpen && <HistoryPopover dir={dir} onClose={() => setHistOpen(false)} />}
      {children}
    </div>
  );
}
