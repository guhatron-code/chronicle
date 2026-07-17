/*
 * The agent section of the right column (F31 + F37 header). Header: the
 * Claude mark stays colored at rest · the session state word (working /
 * waiting on you / idle / ended / needs login) · End session · the collapse
 * chevron. Collapsed = a slim re-open strip, never a vanished pane (the
 * title-bar toggle is what removes the unit entirely). The body is the
 * AgentPane, passed in by the wiring.
 */
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { agentSessionFor, agentStateWord, endAgentSession, subscribeAgent } from "@/lib/agent-session";
import type { ConfirmSpec } from "@/overlays/ConfirmDialog";
import { toastError } from "@/overlays/toasts";
import { ClaudeStar } from "@/components/chrome/icons";
import { cn } from "@/lib/utils";

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
    <div data-agent-section className="flex min-h-0 flex-1 flex-col">
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
      {children}
    </div>
  );
}
