/*
 * F10 — the icon rail. Permanent, 52px, flush (divider on its right edge, no
 * background of its own — the de-boxing law). Selected = inverted, the one loud
 * signal. Refresh + help at the bottom; NO settings gear (⌘, lives in the app menu).
 */
import type { ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  HelpGlyph,
  KanbanGlyph,
  RefreshGlyph,
  RepoGlyph,
  RoadmapGlyph,
} from "./icons";
import { cn } from "@/lib/utils";

export type Pane = "road" | "repo" | "kanban";

function RailButton({
  label,
  tooltip,
  mono,
  selected,
  onClick,
  dim,
  children,
}: {
  label: string;
  tooltip: string;
  mono?: string;
  selected?: boolean;
  onClick?: () => void;
  dim?: boolean;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          aria-label={label}
          onClick={onClick}
          className={cn(
            "flex size-[30px] items-center justify-center rounded-[7px] border",
            selected
              ? "border-selected-bg bg-selected-bg text-selected-fg"
              : cn(
                  "border-border-strong bg-transparent hover:bg-fill-hover hover:text-text-secondary",
                  dim ? "text-text-dim" : "text-text-subtle",
                ),
          )}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent
        side="right"
        sideOffset={8}
        className="flex items-center gap-2 rounded-md border border-border-strong bg-surface-overlay px-2.5 py-1.5 text-xs text-text-primary [box-shadow:var(--shadow-overlay)]"
      >
        {tooltip}
        {mono && <span className="font-mono text-[10px] text-text-dim">{mono}</span>}
      </TooltipContent>
    </Tooltip>
  );
}

export function Rail({
  pane,
  onPane,
  queuedCount,
  checking,
  onRefresh,
  onHelp,
}: {
  pane: Pane;
  onPane: (p: Pane) => void;
  queuedCount: number;
  checking?: boolean;
  onRefresh: () => void;
  onHelp: () => void;
}) {
  return (
    <TooltipProvider delayDuration={400}>
    <div className="flex w-[52px] shrink-0 flex-col items-center gap-1.5 border-r border-divider py-2.5">
      <RailButton label="Roadmap" tooltip="Roadmap" mono="⌘J to cycle"
        selected={pane === "road"} onClick={() => onPane("road")}>
        <RoadmapGlyph />
      </RailButton>
      <RailButton label="Repo" tooltip="Repo" mono="⌘J to cycle"
        selected={pane === "repo"} onClick={() => onPane("repo")}>
        <RepoGlyph />
      </RailButton>
      <div className="relative">
        <RailButton
          label={queuedCount > 0 ? `Kanban — ${queuedCount} tasks queued` : "Kanban"}
          tooltip="Kanban" mono="⌘J to cycle"
          selected={pane === "kanban"} onClick={() => onPane("kanban")}
        >
          <KanbanGlyph />
        </RailButton>
        {queuedCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-[15px] min-w-[15px] items-center justify-center rounded-lg border border-border-strong bg-surface-overlay px-1 font-mono text-[9.5px] text-text-secondary tabular-nums">
            {queuedCount}
          </span>
        )}
      </div>
      <span className="flex-1" />
      <RailButton
        label={checking ? "Checking…" : "Check again now"}
        tooltip={checking ? "Checking…" : "Check again now"}
        onClick={onRefresh}
        dim
      >
        {checking ? (
          <span
            aria-hidden
            className="inline-block size-3.5 rounded-full border-[1.5px] border-state-neutral"
            style={{ borderTopColor: "transparent", animation: "wv-spin 0.7s linear infinite" }}
          />
        ) : (
          <RefreshGlyph />
        )}
      </RailButton>
      <RailButton label="Help and shortcuts" tooltip="Shortcuts" mono="⌘/" onClick={onHelp} dim>
        <HelpGlyph />
      </RailButton>
    </div>
    </TooltipProvider>
  );
}
