/*
 * The agent section of the right column (F31 shell — Z-2a). Header (the Claude
 * mark stays colored at rest · state word · collapse chevron) over the section
 * body. Collapsed = a slim re-open strip, never a vanished pane (the title-bar
 * toggle is what removes the unit entirely). Z-2b replaces the placeholder body
 * with the real thread + composer; the header grows session controls there.
 */
import type { ReactNode } from "react";
import { ClaudeStar } from "@/components/chrome/icons";
import { cn } from "@/lib/utils";

export function AgentSection({
  collapsed,
  onToggleCollapsed,
  stateWord = "idle",
  stateKind = "dim",
  children,
}: {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  stateWord?: string;
  stateKind?: "dim" | "neutral" | "error";
  children?: ReactNode;
}) {
  const stateColor =
    stateKind === "neutral" ? "text-state-neutral" : stateKind === "error" ? "text-state-error" : "text-text-dim";
  const dotColor =
    stateKind === "neutral" ? "bg-state-neutral" : stateKind === "error" ? "bg-state-error" : "bg-text-dim";

  if (collapsed) {
    return (
      <button
        data-agent-strip
        onClick={onToggleCollapsed}
        className="flex h-7 shrink-0 items-center gap-2 border-b border-divider px-3 text-left hover:bg-fill-subtle"
      >
        <ClaudeStar size={12} />
        <span className="text-[11.5px] font-medium text-text-secondary">Agent</span>
        <span className={cn("inline-flex items-center gap-1 whitespace-nowrap text-[11px]", stateColor)}>
          <span className={cn("size-1 shrink-0 rounded-full", dotColor)} />
          {stateWord}
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
        <span className={cn("inline-flex items-center gap-[5px] whitespace-nowrap text-xs", stateColor)}>
          <span className={cn("size-[5px] shrink-0 rounded-full", dotColor)} />
          {stateWord}
        </span>
        <span className="flex-1" />
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
      {children ?? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-[9px] p-5 text-center">
          <ClaudeStar size={20} />
          <span className="text-[15px] font-semibold text-text-primary">Ask for anything.</span>
          <span className="max-w-[34ch] text-[12.5px] leading-[1.55] text-text-muted [text-wrap:pretty]">
            Chronicle asks before the agent touches your project.
          </span>
        </div>
      )}
    </div>
  );
}
