/*
 * Round 9 — a Task fan-out as a tree. The Task card is the subagent's home: its
 * description on the trigger row, a live count of the calls it made, and those
 * calls folded underneath as ordinary tool cards, one step in. Open while the
 * subagent works, closed once it is done — until the user touches the toggle,
 * after which their choice wins. The subagent's final report (the Task's own
 * output) sits under its calls.
 */
import { useState } from "react";
import type { ThreadItem } from "@/lib/agent-session";
import { Task, TaskContent, TaskTrigger } from "@/components/ai-elements/task";
import { Spinner } from "@/components/chrome/atoms";
import { CheckGlyph, ChevronRightGlyph, ErrorGlyph } from "@/components/chrome/icons";
import { cn } from "@/lib/utils";
import { ToolCard } from "./ToolCard";

type Group = Extract<ThreadItem, { kind: "subagent" }>;

const AgentGlyph = ({ size = 12 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" className="shrink-0">
    <circle cx="7" cy="4.5" r="2.2" />
    <path d="M2.5 12c.6-2.4 2.3-3.6 4.5-3.6s3.9 1.2 4.5 3.6" />
  </svg>
);

export function SubagentCard({ group, dir, readOnly }: { group: Group; dir: string; readOnly?: boolean }) {
  const { tool, children } = group;
  const running = tool.status === "pending" || tool.status === "in_progress";
  const failed = tool.status === "failed" && !tool.rejected;
  // the adapter's first frame says "Task"; the description follows on an update
  const title = tool.title && tool.title !== "Task" ? tool.title : "Subagent";
  const [chosen, setChosen] = useState<boolean | null>(null);
  const open = chosen ?? running;
  const n = children.length;
  const report = tool.output?.trim();

  return (
    <Task open={open} onOpenChange={(o) => setChosen(o)} data-subagent={tool.toolCallId} data-open={open} className={cn(
      "rounded-md border border-border-hairline bg-surface-card",
      failed && "border-[color-mix(in_srgb,var(--state-error)_45%,transparent)]",
    )}>
      <TaskTrigger title={title}>
        <div className="flex w-full cursor-pointer items-center gap-2 whitespace-nowrap px-[11px] py-2 text-left">
          <span className={cn("text-text-dim transition-transform", open && "rotate-90")}><ChevronRightGlyph size={10} /></span>
          {running ? <Spinner size={11} /> : failed ? <span className="wv-pop text-state-error"><ErrorGlyph size={11} /></span> : <span className="wv-pop text-state-success"><CheckGlyph size={11} /></span>}
          <span className="text-text-dim"><AgentGlyph /></span>
          <span className="overflow-hidden text-ellipsis text-[12.5px] font-medium text-text-primary">{title}</span>
          <span className="shrink-0 font-mono text-[11px] text-text-dim tabular-nums">{n} {n === 1 ? "call" : "calls"}</span>
          <span className="flex-1" />
          <span className="shrink-0 text-[11.5px] text-text-dim">{running ? "working" : failed ? "failed" : "done"}</span>
        </div>
      </TaskTrigger>
      <TaskContent className="px-[11px] pb-2 [&>div]:mt-1 [&>div]:border-border-hairline [&>div]:pl-3">
        <div className="space-y-0.5">
          {children.map((c) => (
            <ToolCard key={c.toolCallId} tool={c} dir={dir} readOnly={readOnly} />
          ))}
          {n === 0 && <div className="px-[11px] py-[5px] text-[12px] text-text-dim">{running ? "Starting…" : "Made no calls."}</div>}
        </div>
        {report && !running && (
          <div data-selectable className="mt-1.5 max-h-24 overflow-y-auto rounded-md bg-surface-input px-3 py-2 font-mono text-[11px] leading-[1.7] text-text-muted">
            <pre className="whitespace-pre-wrap">{report}</pre>
          </div>
        )}
      </TaskContent>
    </Task>
  );
}
