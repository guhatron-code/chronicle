/*
 * F29 (Deck 5) — the task composer / detail surface (dialog-stack): id chip +
 * created/updated meta when editing, title field, the "What's wrong, or what's
 * the idea?" editor with its B/I/</>/list toolbar, the screenshot dropzone
 * (44×32 thumbs), design links (paste + Add, removable chips), the column
 * segmented control, and Delete… / Archive / Save. Presentational only — the
 * toolbar is the kibo-editor seam, the dropzone click is the `onAttach` seam;
 * real file drops and rich text are wired later.
 */
import { Input } from "@/components/ui/input";
import { BtnPrimary, BtnSecondary } from "@/components/chrome/atoms";
import { ImageGlyph, LinkGlyph, XGlyph } from "@/components/chrome/icons";
import { cn } from "@/lib/utils";
import { ImageThumb } from "./TaskCard";
import type { TaskColumn } from "./types";

export type ComposerProps = {
  mode: "create" | "edit";
  /** Edit only — "T-014". */
  id?: string;
  /** The task belongs to a round — In progress stays offered (it lives there). */
  inRound?: boolean;
  /** Edit only — "created 40m ago · updated 5m ago". */
  meta?: string;
  title: string;
  content: string;
  images: string[];
  links: string[];
  column: TaskColumn;
  /** The design-link input draft. */
  linkDraft?: string;
  onTitleChange?: (value: string) => void;
  onContentChange?: (value: string) => void;
  /** The image-attach visual seam — dropzone click; drops are wired later. */
  onAttach?: () => void;
  onRemoveImage?: (index: number) => void;
  onLinkDraftChange?: (value: string) => void;
  onAddLink?: () => void;
  onRemoveLink?: (index: number) => void;
  onColumnChange?: (column: TaskColumn) => void;
  onDelete?: () => void;
  onArchive?: () => void;
  onSave?: () => void;
  onClose?: () => void;
  className?: string;
};

const fieldClass = cn(
  "rounded-md border-border-field bg-surface-input text-text-primary shadow-none",
  "placeholder:text-text-dimmer dark:bg-surface-input",
  "focus-visible:border-border-field-focus focus-visible:ring-0 focus-visible:[box-shadow:var(--focus-ring)]!",
);

/** One 24px editor-toolbar button — the kibo-editor seam, decorative for now. */
function ToolBtn({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      className={cn(
        "flex size-6 items-center justify-center rounded-[5px] text-xs text-text-muted hover:bg-fill-hover",
        "focus-visible:outline-none focus-visible:[box-shadow:var(--focus-ring)]!",
        className,
      )}
    >
      {children}
    </button>
  );
}

const SEGMENTS: readonly TaskColumn[] = ["later", "queued", "in_progress", "blocked"] as const;
/** Roundless tasks can't be placed into the round-owned lane by hand. */
const segmentsFor = (inRound: boolean): readonly TaskColumn[] =>
  inRound ? SEGMENTS : SEGMENTS.filter((c) => c !== "in_progress");
const SEGMENT_LABELS: Record<string, string> = {
  later: "Later",
  queued: "Queued",
  in_progress: "In progress",
  blocked: "Blocked",
};

export function Composer(p: ComposerProps) {
  return (
    <div
      className={cn(
        "flex w-[560px] max-w-full flex-col overflow-hidden rounded-xl border border-border-strong bg-surface-overlay [box-shadow:var(--shadow-overlay)]",
        p.className,
      )}
    >
      {/* header */}
      <div className="flex items-center gap-[9px] border-b border-divider px-[18px] py-3.5">
        {p.mode === "edit" && p.id && (
          <span className="shrink-0 rounded-[5px] bg-fill-subtle px-1.5 py-px font-mono text-[10.5px] text-text-subtle">
            {p.id}
          </span>
        )}
        <span className="text-[15px] font-semibold text-text-primary">
          {p.mode === "edit" ? "Edit task" : "New task"}
        </span>
        {p.mode === "edit" && p.meta && (
          <span className="min-w-0 truncate font-mono text-[10.5px] text-text-dim tabular-nums">
            {p.meta}
          </span>
        )}
        <span className="flex-1" />
        <button
          type="button"
          aria-label="Close"
          onClick={p.onClose}
          className="flex size-[26px] shrink-0 items-center justify-center rounded-sm text-text-dim hover:bg-fill-hover hover:text-text-secondary focus-visible:outline-none focus-visible:[box-shadow:var(--focus-ring)]!"
        >
          <XGlyph size={10} />
        </button>
      </div>

      <div className="flex flex-col gap-[13px] px-[18px] py-4">
        {/* title */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="task-title" className="text-[12.5px] text-text-muted">
            Title
          </label>
          <Input
            id="task-title"
            value={p.title}
            onChange={(e) => p.onTitleChange?.(e.target.value)}
            className={cn("h-9 px-3 text-[13px] md:text-[13px]", fieldClass)}
          />
        </div>

        {/* content — the kibo editor lands here later; a plain textarea holds the seam */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="task-content" className="text-[12.5px] text-text-muted">
            What's wrong, or what's the idea?
          </label>
          <div className="overflow-hidden rounded-md border border-border-field bg-surface-input focus-within:border-border-field-focus focus-within:[box-shadow:var(--focus-ring)]">
            <div className="flex gap-0.5 border-b border-divider-faint px-2 py-1.5">
              <ToolBtn label="Bold" className="font-bold">
                B
              </ToolBtn>
              <ToolBtn label="Italic" className="italic">
                I
              </ToolBtn>
              <ToolBtn label="Code" className="font-mono text-[11px]">
                {"<>"}
              </ToolBtn>
              <ToolBtn label="List">≔</ToolBtn>
            </div>
            <textarea
              id="task-content"
              value={p.content}
              onChange={(e) => p.onContentChange?.(e.target.value)}
              className="field-sizing-content min-h-16 w-full resize-none bg-transparent px-3 py-2.5 text-[12.5px] leading-[1.6] text-text-secondary outline-none placeholder:text-text-dimmer"
            />
          </div>
        </div>

        {/* screenshots — the attach seam + attached thumbs */}
        <div className="flex items-center justify-center gap-[9px] rounded-md border border-dashed border-border-strong p-3.5">
          <button
            type="button"
            onClick={p.onAttach}
            className="inline-flex items-center gap-[9px] rounded-sm text-xs text-text-dim hover:text-text-secondary focus-visible:outline-none focus-visible:[box-shadow:var(--focus-ring)]!"
          >
            <ImageGlyph size={14} className="shrink-0" />
            Drop screenshots here
          </button>
          {p.images.map((src, i) => (
            <span key={i} className="group/thumb relative shrink-0">
              <ImageThumb src={src} width={44} height={32} glyphSize={12} className="rounded-sm" />
              {p.onRemoveImage && (
                <button
                  type="button"
                  aria-label={`Remove screenshot ${i + 1}`}
                  onClick={() => p.onRemoveImage?.(i)}
                  className="absolute -right-1 -top-1 hidden size-3.5 items-center justify-center rounded-full border border-border-strong bg-surface-card-raised text-text-dim hover:text-text-secondary focus-visible:flex focus-visible:outline-none focus-visible:[box-shadow:var(--focus-ring)]! group-hover/thumb:flex"
                >
                  <XGlyph size={6} />
                </button>
              )}
            </span>
          ))}
        </div>

        {/* design links */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="task-link" className="text-[12.5px] text-text-muted">
            Design link
          </label>
          <div className="flex gap-2">
            <Input
              id="task-link"
              value={p.linkDraft ?? ""}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  p.onAddLink?.();
                }
              }}
              placeholder="Paste a Figma or file link…"
              onChange={(e) => p.onLinkDraftChange?.(e.target.value)}
              className={cn("h-[34px] flex-1 px-3 text-xs md:text-xs", fieldClass)}
            />
            <BtnSecondary onClick={p.onAddLink} className="h-[34px] px-3 text-xs">
              Add
            </BtnSecondary>
          </div>
          {p.links.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {p.links.map((link, i) => (
                <span
                  key={link}
                  className="inline-flex h-6 items-center gap-[5px] rounded-sm bg-fill-subtle px-[9px] text-[11px] text-text-subtle"
                >
                  <LinkGlyph size={9} className="shrink-0" />
                  <span className="max-w-56 truncate">{link}</span>
                  <button
                    type="button"
                    aria-label={`Remove link ${link}`}
                    onClick={() => p.onRemoveLink?.(i)}
                    className="flex shrink-0 text-text-dim hover:text-text-secondary focus-visible:outline-none focus-visible:[box-shadow:var(--focus-ring)]!"
                  >
                    <XGlyph size={8} />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* column — Completed is reached by the round, not by hand (deck omits it) */}
        <div className="flex items-center gap-2.5">
          <span className="text-[12.5px] text-text-muted">Column</span>
          <div className="flex overflow-hidden rounded-md border border-border-hairline">
            {segmentsFor(!!p.inRound).map((c, i) => (
              <button
                key={c}
                type="button"
                aria-pressed={p.column === c}
                onClick={() => p.onColumnChange?.(c)}
                className={cn(
                  "h-7 px-[11px] text-[11.5px]",
                  i > 0 && "border-l border-border-hairline",
                  p.column === c
                    ? "bg-fill-hover font-medium text-text-primary"
                    : "text-text-muted hover:text-text-primary",
                  "focus-visible:outline-none focus-visible:[box-shadow:var(--focus-ring)]!",
                )}
              >
                {SEGMENT_LABELS[c]}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* footer */}
      <div className="flex items-center gap-2 border-t border-divider px-[18px] py-3.5">
        {p.mode === "edit" && (
          <>
            <button
              type="button"
              onClick={p.onDelete}
              className="h-[31px] rounded-md border border-border-hairline px-[11px] text-xs font-medium text-state-error hover:bg-fill-hover focus-visible:outline-none focus-visible:[box-shadow:var(--focus-ring)]!"
            >
              Delete…
            </button>
            <button
              type="button"
              onClick={p.onArchive}
              className="h-[31px] rounded-md px-[11px] text-xs text-text-dim hover:bg-fill-hover hover:text-text-secondary focus-visible:outline-none focus-visible:[box-shadow:var(--focus-ring)]!"
            >
              Archive
            </button>
          </>
        )}
        <span className="flex-1" />
        <BtnPrimary onClick={p.onSave} className="h-[33px] px-3.5 text-[12.5px]">
          {p.mode === "edit" ? "Save task" : "Add task"}
        </BtnPrimary>
      </div>
    </div>
  );
}
