import * as React from "react";
/*
 * One tab strip for every pane that has document tabs — the Repo viewer's
 * open files and the Web pane's pages. The visuals are the viewer's: an h-10
 * row ending on the divider, h-8 tabs, a 2px underline under the active one,
 * a close button on the active tab, and the strip scrolls sideways.
 *
 * overflow-y-hidden matters: overflow-x-auto forces overflow-y to auto, and
 * the underline sits a pixel below the tab, so without it the browser draws a
 * phantom vertical scrollbar in the strip.
 */
import { XGlyph } from "@/components/chrome/icons";
import { cn } from "@/lib/utils";

export type TabStripTab = {
  id: string;
  /** what the tab reads as — truncated to the tab's width */
  label: string;
  /** the hover title; falls back to the label */
  title?: string;
  /** a small dot before the label — unsaved work, a page still loading */
  dirty?: boolean;
};

export type TabStripProps = {
  tabs: TabStripTab[];
  activeId: string | null;
  onSelect?: (id: string) => void;
  onClose?: (id: string) => void;
  /** renders the "+" at the end of the strip */
  onNew?: () => void;
  /** anything else that rides at the end of the strip */
  trailing?: React.ReactNode;
  className?: string;
};

function Dot() {
  return <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-text-dim" />;
}

export function TabStrip({ tabs, activeId, onSelect, onClose, onNew, trailing, className }: TabStripProps) {
  // scroll the active tab into view only when it CHANGES — a ref callback runs
  // every render, and scrollIntoView on each one hijacks the tab strip's scroll
  const lastScrolled = React.useRef<string | null>(null);

  return (
    <div
      className={cn(
        "flex h-10 min-w-0 shrink-0 items-end gap-0.5 overflow-x-auto overflow-y-hidden border-b border-divider px-2.5",
        className,
      )}
    >
      {tabs.map((tab) =>
        tab.id === activeId ? (
          <div
            key={tab.id}
            ref={(el) => {
              if (el && lastScrolled.current !== tab.id) {
                lastScrolled.current = tab.id;
                el.scrollIntoView({ inline: "nearest", block: "nearest" });
              }
            }}
            className="relative flex h-8 max-w-[190px] shrink-0 items-center gap-2 px-3 text-[12.5px] font-medium text-text-primary"
          >
            {tab.dirty && <Dot />}
            <span className="min-w-0 truncate" title={tab.title ?? tab.label}>{tab.label}</span>
            <button
              aria-label={`Close ${tab.label}`}
              onClick={() => onClose?.(tab.id)}
              className="flex size-4 items-center justify-center rounded-[4px] text-text-dim hover:bg-fill-hover"
            >
              <XGlyph size={8} />
            </button>
            <span className="absolute -bottom-px left-2 right-2 h-0.5 rounded-[1px] bg-text-primary" />
          </div>
        ) : (
          <button
            key={tab.id}
            onClick={() => onSelect?.(tab.id)}
            className="flex h-8 max-w-[170px] shrink-0 items-center gap-2 px-3 text-[12.5px] text-text-muted hover:text-text-secondary"
          >
            {tab.dirty && <Dot />}
            <span className="min-w-0 truncate" title={tab.title ?? tab.label}>{tab.label}</span>
          </button>
        ),
      )}
      {onNew && (
        <button
          aria-label="New tab"
          onClick={onNew}
          className="flex h-8 shrink-0 items-center px-2.5 text-text-faint hover:text-text-primary"
        >
          +
        </button>
      )}
      {trailing}
    </div>
  );
}
