/*
 * F11 — the shell title bar: window controls · brand glyph · project tabs (active =
 * fill-hover + strong border + mark dot; background = fill-subtle, close on hover;
 * updated = the word badge, never a colored dot alone; overflow "+N more"; 180px max)
 * · "+" (opens the ⌘K switcher) · Checked HH:MM:SS or the degraded status.
 * The whole bar is the drag region.
 */
import { Fragment } from "react";
import { windowControls } from "@/lib/ipc";
import { BrandGlyph, ErrorGlyph, PlusGlyph, XGlyph } from "./icons";
import { cn } from "@/lib/utils";
import type { MarkIndex } from "./atoms";

const MARK_BG = ["", "bg-mark-1", "bg-mark-2", "bg-mark-3", "bg-mark-4", "bg-mark-5", "bg-mark-6"];

export type ProjectTab = {
  dir: string;
  name: string;
  mark: MarkIndex;
  updated?: boolean; // finished something while in the background
  updatedHint?: string;
};

const MAX_VISIBLE_TABS = 4;

export function TitleBar({
  tabs,
  activeDir,
  checkedAt,
  degraded,
  onSwitch,
  onClose,
  onAdd,
}: {
  tabs: ProjectTab[];
  activeDir: string;
  checkedAt: string | null;
  degraded: string | null;
  onSwitch: (dir: string) => void;
  onClose: (dir: string) => void;
  onAdd: () => void;
}) {
  const visible = tabs.slice(0, MAX_VISIBLE_TABS);
  const hidden = tabs.length - visible.length;

  return (
    <div
      data-tauri-drag-region
      onDoubleClick={(e) => {
        // macOS quirk: the native drag session that starts on the first press
        // swallows Tauri's built-in detail-2 zoom — do it ourselves. Interactive
        // children opt out.
        if (!(e.target as HTMLElement).closest("button, input, [data-no-zoom]")) {
          void windowControls().toggleMaximize();
        }
      }}
      className="flex h-11 shrink-0 items-center gap-3 border-b border-divider px-3.5"
    >
      <div className="flex gap-2">
        <button aria-label="Close window" onClick={() => void windowControls().close()}
          className="size-3 rounded-full border border-border-strong bg-fill-hover" />
        <button aria-label="Minimize window" onClick={() => void windowControls().minimize()}
          className="size-3 rounded-full border border-border-strong bg-fill-hover" />
        <button aria-label="Zoom window" onClick={() => void windowControls().toggleMaximize()}
          className="size-3 rounded-full border border-border-strong bg-fill-hover" />
      </div>
      <BrandGlyph size={17} className="shrink-0 text-text-subtle" />

      <div className="flex min-w-0 items-center gap-1">
        {visible.map((t) => {
          const active = t.dir === activeDir;
          return (
            <Fragment key={t.dir}>
              {active ? (
                <div
                  data-no-zoom
                  className="flex h-[30px] max-w-[180px] items-center gap-2 rounded-md border border-border-strong bg-fill-hover px-3"
                  title={t.dir}
                >
                  <span className={cn("size-2 shrink-0 rounded-[3px]", MARK_BG[t.mark])} />
                  <span className="truncate text-[12.5px] font-medium text-text-primary">
                    {t.name}
                  </span>
                </div>
              ) : (
                <div
                  className="group/tab flex h-[30px] max-w-[180px] cursor-pointer items-center gap-2 rounded-md border border-transparent bg-fill-subtle py-0 pl-3 pr-2"
                  title={t.updated ? (t.updatedHint ?? `${t.name} has updates`) : t.dir}
                  onClick={() => onSwitch(t.dir)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === "Enter" && onSwitch(t.dir)}
                >
                  <span className={cn("size-2 shrink-0 rounded-[3px]", MARK_BG[t.mark])} />
                  <span
                    className={cn(
                      "truncate text-[12.5px]",
                      t.updated ? "text-text-secondary" : "text-text-muted",
                    )}
                  >
                    {t.name}
                  </span>
                  {t.updated ? (
                    <span className="rounded-[5px] bg-fill-subtle px-[5px] text-[10.5px] leading-[15px] text-text-subtle">
                      Updated
                    </span>
                  ) : (
                    <button
                      aria-label={`Close ${t.name}`}
                      onClick={(e) => { e.stopPropagation(); onClose(t.dir); }}
                      className="flex size-[18px] items-center justify-center rounded-[5px] text-text-dim opacity-0 hover:bg-fill-hover hover:text-text-secondary focus-visible:opacity-100 group-hover/tab:opacity-100"
                    >
                      <XGlyph />
                    </button>
                  )}
                </div>
              )}
            </Fragment>
          );
        })}
        {hidden > 0 && (
          <button
            onClick={onAdd}
            className="h-[30px] rounded-md px-2.5 font-mono text-xs text-text-dim hover:bg-fill-hover hover:text-text-secondary"
          >
            +{hidden} more
          </button>
        )}
        <button
          aria-label="Open another project"
          title="Open another project — ⌘K"
          onClick={onAdd}
          className="flex size-7 items-center justify-center rounded-[7px] text-text-dim hover:bg-fill-hover hover:text-text-secondary"
        >
          <PlusGlyph size={11} />
        </button>
      </div>

      <span className="flex-1" data-tauri-drag-region />
      {degraded ? (
        <span className="inline-flex items-center gap-1.5 text-[11.5px] text-text-subtle">
          <ErrorGlyph size={11} strokeWidth={1.4} />
          {degraded}
        </span>
      ) : (
        checkedAt && (
          <span className="font-mono text-[11.5px] text-text-dim tabular-nums">
            Checked {checkedAt}
          </span>
        )
      )}
    </div>
  );
}
