/*
 * F2 — the recent-project card. One anatomy, seven states (Deck 1 is the spec):
 * default · hover (CSS) · delete-hover (CSS on the trash) · missing-folder ·
 * writing-roadmap · all-done · no-roadmap-yet.
 */
import { useState } from "react";
import {
  BtnSecondary,
  IdChip,
  MarkTile,
  type MarkIndex,
  MonoMeta,
  Spinner,
  StateWord,
} from "@/components/chrome/atoms";
import { CheckGlyph, ErrorGlyph, TrashGlyph } from "@/components/chrome/icons";
import { cn } from "@/lib/utils";

export type RecentProject = {
  path: string;
  name: string;
  tildePath: string;
  description?: string;
  mark: MarkIndex;
  markLabel: string;
  ago: string;
  variant:
    | {
        kind: "phase";
        phaseId: string;
        phaseName: string;
        statusWord: string;
        running?: boolean;
        progress: number; // 0..1
        waiting: number;
      }
    | { kind: "all-done" }
    | { kind: "no-roadmap"; agent: string }
    | { kind: "missing" }
    | { kind: "writing" };
};

export function RecentCard({
  project,
  onOpen,
  onRemove,
  onLocate,
}: {
  project: RecentProject;
  onOpen: (path: string) => void;
  onRemove: (path: string) => void;
  onLocate?: (path: string) => void;
}) {
  const [trashHover, setTrashHover] = useState(false);
  const v = project.variant;

  /* Missing folder — not a dead card; actions instead of open. */
  if (v.kind === "missing") {
    return (
      <div className="flex flex-col gap-[9px] rounded-lg border border-border-hairline bg-surface-card p-[15px] px-[18px] text-left">
        <div className="flex items-center gap-2.5">
          <MarkTile mark={project.mark} label={project.markLabel} dashed />
          <span className="text-sm font-medium text-text-muted">{project.name}</span>
          <span className="font-mono text-[11.5px] text-text-dimmer line-through">
            {project.tildePath}
          </span>
        </div>
        <div className="flex items-center gap-2 text-[12.5px]">
          <span className="inline-flex items-center gap-1.5 text-state-error">
            <ErrorGlyph size={12} />
            Folder missing
          </span>
          <span className="text-text-subtle">It may have been moved or renamed.</span>
        </div>
        <div className="flex gap-2">
          <BtnSecondary className="h-[29px] px-3 text-[12.5px]" onClick={() => onLocate?.(project.path)}>
            Locate…
          </BtnSecondary>
          <button
            className="h-[29px] rounded-md px-3 text-[12.5px] text-text-dim hover:bg-fill-hover hover:text-text-secondary"
            onClick={() => onRemove(project.path)}
          >
            Remove from recents
          </button>
        </div>
      </div>
    );
  }

  /* Writing roadmap — neutral, never success-green; no cancel here (F13 owns it). */
  if (v.kind === "writing") {
    return (
      <button
        onClick={() => onOpen(project.path)}
        className="flex flex-col gap-[9px] rounded-lg border border-border-hairline bg-surface-card p-[15px] px-[18px] text-left font-sans hover:border-border-strong hover:bg-surface-card-raised"
      >
        <div className="flex items-center gap-2.5">
          <MarkTile mark={project.mark} label={project.markLabel} />
          <span className="text-sm font-medium text-text-primary">{project.name}</span>
          <span className="font-mono text-[11.5px] text-text-dim">{project.tildePath}</span>
        </div>
        <div className="flex items-center gap-[9px] text-[12.5px] text-state-neutral">
          <Spinner />
          Writing your roadmap…
        </div>
        <div className="text-[11.5px] text-text-dim">
          A Claude session is reading the folder. Nothing else is changed.
        </div>
      </button>
    );
  }

  return (
    <div
      className={cn(
        "group relative rounded-lg border border-border-hairline bg-surface-card text-left font-sans",
        "hover:border-border-strong hover:bg-surface-card-raised",
        trashHover && "border-border-strong bg-surface-card hover:bg-surface-card", // delete-hover: the card recedes to the flat surface
      )}
    >
      {/* delete affordance appears on card hover; delete-hover recedes the content */}
      <button
        aria-label="Remove from recents"
        onClick={(e) => {
          e.stopPropagation();
          onRemove(project.path);
        }}
        onMouseEnter={() => setTrashHover(true)}
        onMouseLeave={() => setTrashHover(false)}
        className={cn(
          "absolute right-2.5 top-2.5 z-10 flex size-[26px] items-center justify-center rounded-sm",
          "text-text-dim opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
          trashHover ? "bg-fill-hover text-state-error" : "hover:bg-fill-hover hover:text-text-secondary",
        )}
      >
        <TrashGlyph />
      </button>

      <button
        onClick={() => onOpen(project.path)}
        className="flex w-full flex-col gap-[9px] p-[15px] px-[18px] text-left"
      >
        <div className={cn("flex flex-col gap-[9px]", trashHover && "opacity-55")}>
          <div className="flex items-center gap-2.5">
            <MarkTile mark={project.mark} label={project.markLabel} />
            <span className="text-sm font-medium text-text-primary">{project.name}</span>
            <span className="font-mono text-[11.5px] text-text-dim">{project.tildePath}</span>
          </div>
          {project.description && (
            <div className="text-[12.5px] leading-[1.5] text-text-muted">{project.description}</div>
          )}

          {v.kind === "phase" && (
            <div className="flex items-center gap-2 text-[12.5px]">
              <IdChip>{v.phaseId}</IdChip>
              <span className="text-text-secondary">{v.phaseName}</span>
              {!trashHover && (
                <StateWord kind={v.running ? "running" : "neutral"}>{v.statusWord}</StateWord>
              )}
            </div>
          )}
          {v.kind === "all-done" && (
            <div className="flex items-center gap-[7px] text-[12.5px] text-state-success">
              <CheckGlyph size={13} />
              Everything on the plan is done
            </div>
          )}
          {v.kind === "no-roadmap" && (
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-border-strong px-2.5 py-[3px] text-[11.5px] text-text-subtle">
                No roadmap yet · runs with {v.agent}
              </span>
              <span className="flex-1" />
              <MonoMeta>{project.ago}</MonoMeta>
            </div>
          )}
        </div>

        {trashHover ? (
          <div className="text-[11.5px] text-text-subtle">
            Removes it from this list — the folder itself isn't touched.
          </div>
        ) : (
          (v.kind === "phase" || v.kind === "all-done") && (
            <div className="flex items-center gap-2.5">
              <span className="block h-[3px] flex-1 overflow-hidden rounded-[2px] bg-fill-hover">
                <span
                  className={cn(
                    "block h-full rounded-[2px]",
                    v.kind === "all-done" ? "bg-state-success opacity-70" : "bg-text-secondary",
                  )}
                  style={{ width: v.kind === "all-done" ? "100%" : `${Math.round(v.progress * 100)}%` }}
                />
              </span>
              {v.kind === "phase" && v.waiting > 0 && (
                <span className="text-[11.5px] text-text-subtle">{v.waiting} waiting</span>
              )}
              <MonoMeta>{project.ago}</MonoMeta>
            </div>
          )
        )}
      </button>
    </div>
  );
}
