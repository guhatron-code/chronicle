/*
 * F28 (Deck 5) — the kanban task card: id chip + title, two-line content preview,
 * 34×24 image thumbs (+n overflow), design-link chips, the mono ago stamp.
 * States: default · hover (grab cursor + grip dots) · dragging (lifted: overlay
 * surface, shadow, −1.2°) · dimmed (the source while its copy is dragged) ·
 * selected (open in the composer) · frozen (in an executing round, quietly
 * locked) · completed (strikethrough + check + round footnote). Presentational
 * only — drag flags are visual props; HTML5 drag events are wired later.
 */
import { CheckGlyph, GripGlyph, ImageGlyph, LinkGlyph, LockGlyph } from "@/components/chrome/icons";
import { cn } from "@/lib/utils";
import type { Task } from "./types";

export type TaskCardProps = {
  task: Task;
  /** Presentation-time stamp — "40m ago". */
  ago?: string;
  /** Open in the composer — field-focus border + ring (F28 "Selected"). */
  selected?: boolean;
  /** The lifted copy under the pointer (F28 "Dragging"). */
  dragging?: boolean;
  /** The source card in its lane while the lifted copy is dragged — dims. */
  dimmed?: boolean;
  /** Read-only in an executing round (F28 "In a frozen round"). */
  frozen?: boolean;
  onOpen?: () => void;
  /** HTML5 drag seam — the wiring drives these; completed/frozen cards get none. */
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent<HTMLDivElement | HTMLButtonElement>) => void;
  onDragEnd?: () => void;
  className?: string;
};

/** Card id chip — deck values (10px mono, radius 5, 0 5px), NOT the 10.5 IdChip atom. */
const TaskIdChip = ({ dim, children }: { dim?: boolean; children: string }) => (
  <span
    className={cn(
      "shrink-0 rounded-[5px] bg-fill-subtle px-[5px] font-mono text-[10px]",
      dim ? "text-text-dim" : "text-text-subtle",
    )}
  >
    {children}
  </span>
);

/** Image thumb tile — renders the file when the string is a loadable URL,
 *  otherwise the deck's placeholder glyph on the input surface. */
export function ImageThumb({
  src,
  width = 34,
  height = 24,
  glyphSize = 11,
  className,
}: {
  src: string;
  width?: number;
  height?: number;
  glyphSize?: number;
  className?: string;
}) {
  const loadable = /^(data:|blob:|https?:|file:|asset:|\/)/.test(src);
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden rounded-[5px] bg-surface-input",
        className,
      )}
      style={{ width, height }}
    >
      {loadable ? (
        <img src={src} alt="" className="size-full object-cover" />
      ) : (
        <ImageGlyph size={glyphSize} dot={false} className="text-text-dim" />
      )}
    </span>
  );
}

/** Design-link chip (card size: h20, 10.5px). */
const CardLinkChip = ({ label }: { label: string }) => (
  <span className="inline-flex h-5 min-w-0 shrink items-center gap-[5px] rounded-[5px] bg-fill-subtle px-[7px] text-[10.5px] text-text-subtle">
    <LinkGlyph size={9} className="shrink-0" />
    <span className="min-w-0 max-w-40 truncate">{label}</span>
  </span>
);

export function TaskCard({
  task,
  ago,
  selected,
  dragging,
  dimmed,
  frozen,
  onOpen,
  draggable,
  onDragStart,
  onDragEnd,
  className,
}: TaskCardProps) {
  /* ---- completed: struck title + check + round footnote, non-grabbable ---- */
  if (task.column === "completed") {
    return (
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          "flex w-full flex-col gap-[5px] rounded-lg border border-divider bg-surface-card px-[13px] py-[11px] text-left",
          "focus-visible:outline-none focus-visible:[box-shadow:var(--focus-ring)]!",
          className,
        )}
      >
        <div className="flex items-center gap-[7px]">
          <TaskIdChip dim>{task.id}</TaskIdChip>
          <span className="min-w-0 truncate text-[12.5px] text-text-muted line-through">
            {task.title}
          </span>
          <CheckGlyph size={10} className="shrink-0 text-state-success" />
        </div>
        {task.round != null && (
          <div className="text-[10.5px] text-text-dimmer">
            round {task.round} · verified by the fix plan
          </div>
        )}
      </button>
    );
  }

  /* ---- frozen: quietly locked, title + lock + the round line only ---- */
  if (frozen) {
    return (
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          "flex w-full flex-col gap-[7px] rounded-lg border border-divider bg-surface-card px-[13px] py-[11px] text-left opacity-80",
          "focus-visible:outline-none focus-visible:[box-shadow:var(--focus-ring)]!",
          className,
        )}
      >
        <div className="flex items-center gap-[7px]">
          <TaskIdChip>{task.id}</TaskIdChip>
          <span className="min-w-0 truncate text-[12.5px] font-medium text-text-secondary">
            {task.title}
          </span>
          <LockGlyph size={10} className="shrink-0 text-text-dim" />
        </div>
        <div className="text-[11px] text-text-dim">
          {task.round != null
            ? `in round ${task.round} · locked while it executes`
            : "locked while it executes"}
        </div>
      </button>
    );
  }

  /* ---- default / hover / dragging / dimmed / selected ---- */
  const thumbs = task.images.slice(0, 2);
  const extra = task.images.length - thumbs.length;
  const hasFooter = task.images.length > 0 || task.links.length > 0 || ago != null;

  return (
    <button
      type="button"
      onClick={onOpen}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={cn(
        "group relative flex w-full flex-col gap-[7px] rounded-lg border px-[13px] py-[11px] text-left",
        dragging
          ? "-rotate-[1.2deg] cursor-grabbing border-border-strong bg-surface-overlay [box-shadow:var(--shadow-overlay)]"
          : "cursor-grab border-border-hairline bg-surface-card-raised hover:border-border-strong",
        selected && "border-border-field-focus [box-shadow:var(--focus-ring)]",
        dimmed && "opacity-40",
        "focus-visible:outline-none focus-visible:[box-shadow:var(--focus-ring)]!",
        className,
      )}
    >
      {/* grab affordance — grip dots appear on hover (F28) */}
      {!dragging && (
        <span
          aria-hidden
          className="absolute right-2.5 top-[11px] text-text-dim opacity-0 group-hover:opacity-100"
        >
          <GripGlyph size={10} />
        </span>
      )}
      <div className="flex items-center gap-[7px]">
        <TaskIdChip>{task.id}</TaskIdChip>
        <span className="min-w-0 truncate text-[12.5px] font-medium text-text-primary">
          {task.title}
        </span>
      </div>
      {task.content !== "" && (
        <div className="line-clamp-2 text-[11.5px] leading-[1.5] text-text-muted">
          {task.content}
        </div>
      )}
      {hasFooter && (
        <div className="flex min-w-0 items-center gap-1.5">
          {thumbs.map((src, i) => (
            <ImageThumb key={i} src={src} />
          ))}
          {extra > 0 && <span className="shrink-0 font-mono text-[10px] text-text-dim">+{extra}</span>}
          {task.links.map((link) => (
            <CardLinkChip key={link} label={link} />
          ))}
          {/* the stamp right-aligns only behind thumbs/chips; alone it sits left (deck F28) */}
          {(task.images.length > 0 || task.links.length > 0) && <span className="min-w-0 flex-1" />}
          {ago && (
            <span className="shrink-0 font-mono text-[10px] text-text-dimmer tabular-nums">
              {ago}
            </span>
          )}
        </div>
      )}
    </button>
  );
}
