/*
 * F27 (Deck 5) — the kanban board, measures per L5 (Deck 6): the header row
 * (title, mono task count, "Ready to execute — n queued", "New task ⌘N"), four
 * open lanes with mono counts, the queued add affordance, and the drop well
 * that appears only in the targeted lane while dragging. In-progress cards are
 * frozen (they only sit there while a round executes). Full-bleed and flush —
 * the pane shell owns the surface; no border/radius/bg here. Presentational
 * only: drag state arrives as props (draggingId / dropColumn); no dnd library.
 */
import { BtnPrimary, BtnSecondary, MonoMeta } from "@/components/chrome/atoms";
import { PlusGlyph } from "@/components/chrome/icons";
import { cn } from "@/lib/utils";
import { RoundExecutingNote } from "./ExecuteFlow";
import { TaskCard } from "./TaskCard";
import { COLUMN_LABELS, COLUMN_ORDER, type BoardTask, type TaskColumn } from "./types";

export type BoardProps = {
  /** Board title — "Fixes & ideas". */
  title: string;
  tasks: BoardTask[];
  /** The card open in the composer — it shows the selected ring in its lane. */
  selectedId?: string | null;
  /** The card being dragged — it dims in place. The lifted copy that follows
   *  the pointer is the wiring's overlay (a TaskCard with `dragging`). */
  draggingId?: string | null;
  /** While dragging: the lane showing the "Drop a task here" well. */
  dropColumn?: TaskColumn | null;
  /** A round is executing — renders the F30 explainer strip under the header. */
  executingRound?: number | null;
  onNewTask?: () => void;
  onReadyToExecute?: () => void;
  onOpenTask?: (id: string) => void;
  /** HTML5 drag seam — the wiring drives these. */
  onTaskDragStart?: (id: string, e: React.DragEvent) => void;
  onTaskDragEnd?: () => void;
  onLaneDragOver?: (column: TaskColumn, e: React.DragEvent) => void;
  onLaneDrop?: (column: TaskColumn, e: React.DragEvent) => void;
  onLaneDragLeave?: (column: TaskColumn) => void;
  className?: string;
};

/** The dashed lane wells — the queued add affordance and the drop indicator. */
const wellClass =
  "rounded-lg border border-dashed border-border-strong p-3.5 text-center text-[11.5px] text-text-dim";

function Lane({
  column,
  tasks,
  selectedId,
  draggingId,
  dropTarget,
  onNewTask,
  onOpenTask,
  onTaskDragStart,
  onTaskDragEnd,
  onDragOverLane,
  onDropLane,
  onDragLeaveLane,
}: {
  column: TaskColumn;
  tasks: BoardTask[];
  selectedId?: string | null;
  draggingId?: string | null;
  /** VISUAL drop-target flag — the well renders only while this is set. */
  dropTarget?: boolean;
  onNewTask?: () => void;
  onOpenTask?: (id: string) => void;
  onTaskDragStart?: (id: string, e: React.DragEvent) => void;
  onTaskDragEnd?: () => void;
  onDragOverLane?: (e: React.DragEvent) => void;
  onDropLane?: (e: React.DragEvent) => void;
  onDragLeaveLane?: () => void;
}) {
  return (
    <div
      className="flex min-h-0 flex-col gap-2.5"
      onDragOver={onDragOverLane}
      onDrop={onDropLane}
      onDragLeave={onDragLeaveLane}
    >
      <div className="flex items-baseline gap-2">
        <span className="text-[12.5px] font-medium text-text-primary">
          {COLUMN_LABELS[column]}
        </span>
        <span className="font-mono text-[11px] text-text-dim tabular-nums">{tasks.length}</span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto">
        {tasks.map((t) => (
          <TaskCard
            key={t.id}
            task={t}
            ago={t.ago}
            frozen={column === "in_progress"}
            selected={t.id === selectedId}
            dimmed={t.id === draggingId}
            onOpen={() => onOpenTask?.(t.id)}
            draggable
            onDragStart={(e) => onTaskDragStart?.(t.id, e)}
            onDragEnd={onTaskDragEnd}
          />
        ))}
        {dropTarget && <div className={wellClass}>Drop a task here</div>}
        {/* the add affordance — queued only; it steps aside while a drag is live */}
        {column === "queued" && draggingId == null && (
          <button
            type="button"
            onClick={onNewTask}
            className={cn(
              wellClass,
              "hover:bg-fill-subtle hover:text-text-secondary",
              "focus-visible:outline-none focus-visible:[box-shadow:var(--focus-ring)]!",
            )}
          >
            Write down a bug or an idea — ⌘N
          </button>
        )}
      </div>
    </div>
  );
}

export function Board({
  title,
  tasks,
  selectedId,
  draggingId,
  dropColumn,
  executingRound,
  onNewTask,
  onReadyToExecute,
  onOpenTask,
  onTaskDragStart,
  onTaskDragEnd,
  onLaneDragOver,
  onLaneDrop,
  onLaneDragLeave,
  className,
}: BoardProps) {
  // the SAME eligibility rule execution uses: queued AND unclaimed (T-007)
  const queued = tasks.filter((t) => t.column === "queued" && t.round == null).length;
  return (
    <div className={cn("flex h-full min-h-0 flex-col", className)}>
      {/* header row — L5 measures */}
      <div className="flex items-center gap-3 border-b border-divider px-6 py-3">
        <span className="text-[14.5px] font-semibold text-text-primary">{title}</span>
        <MonoMeta className="text-text-dim">
          {tasks.length} {tasks.length === 1 ? "task" : "tasks"}
        </MonoMeta>
        <span className="flex-1" />
        <BtnSecondary
          onClick={onReadyToExecute}
          disabled={queued === 0}
          className="h-[31px] px-3 text-xs"
        >
          Ready to execute — {queued} queued
        </BtnSecondary>
        <BtnPrimary onClick={onNewTask} className="h-8 gap-[7px] px-[13px] text-xs">
          <PlusGlyph size={10} strokeWidth={1.6} />
          New task
          <span className="font-mono text-[10.5px] opacity-55">⌘N</span>
        </BtnPrimary>
      </div>

      {/* the round-running explainer (F30) — new tasks start the next round */}
      {executingRound != null && (
        <div className="px-6 pt-4">
          <RoundExecutingNote round={executingRound} />
        </div>
      )}

      {/* five open lanes — a drop well appears only while dragging */}
      <div className="grid min-h-0 min-w-[960px] flex-1 grid-cols-5 gap-[22px] overflow-x-auto px-6 py-4">
        {COLUMN_ORDER.map((column) => (
          <Lane
            key={column}
            column={column}
            tasks={tasks.filter((t) => t.column === column)}
            selectedId={selectedId}
            draggingId={draggingId}
            dropTarget={dropColumn === column}
            onNewTask={onNewTask}
            onOpenTask={onOpenTask}
            onTaskDragStart={onTaskDragStart}
            onTaskDragEnd={onTaskDragEnd}
            onDragOverLane={(e) => onLaneDragOver?.(column, e)}
            onDropLane={(e) => onLaneDrop?.(column, e)}
            onDragLeaveLane={() => onLaneDragLeave?.(column)}
          />
        ))}
      </div>
    </div>
  );
}
