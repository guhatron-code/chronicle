import * as React from "react";
/*
 * One tab strip for every pane that has document tabs — the Repo viewer's
 * open files and the Web pane's pages. The visuals are the viewer's: an h-10
 * row ending on the divider, h-8 tabs, a 2px underline under the active one,
 * and the strip scrolls sideways.
 *
 * overflow-y-hidden matters: overflow-x-auto forces overflow-y to auto, and
 * the underline sits a pixel below the tab, so without it the browser draws a
 * phantom vertical scrollbar in the strip.
 *
 * Every tab reserves the close button's size-4 slot, so revealing the X on a
 * background tab never re-truncates its label. Middle-click closes a tab too,
 * the way it does in a browser.
 */
import { XGlyph } from "@/components/chrome/icons";
import { cn } from "@/lib/utils";

/** what the tab's leading dot is saying — each has its own colour */
export type TabDot = "loading" | "dirty" | "live";

const DOT: Record<TabDot, string> = {
  loading: "bg-state-neutral",
  dirty: "bg-text-dim",
  live: "bg-state-success",
};

export type TabStripTab = {
  id: string;
  /** what the tab reads as — truncated to the tab's width */
  label: string;
  /** the hover title; falls back to the label */
  title?: string;
  /** a small dot before the label — omit it for no dot */
  dot?: TabDot;
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
      {tabs.map((tab) => {
        const active = tab.id === activeId;
        const title = tab.title ?? tab.label;
        return (
          <div
            key={tab.id}
            role="tab"
            aria-selected={active}
            tabIndex={0}
            ref={
              active
                ? (el) => {
                    if (el && lastScrolled.current !== tab.id) {
                      lastScrolled.current = tab.id;
                      el.scrollIntoView({ inline: "nearest", block: "nearest" });
                    }
                  }
                : undefined
            }
            onClick={() => !active && onSelect?.(tab.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                if (!active) onSelect?.(tab.id);
              }
            }}
            // middle-click closes, as it does in a browser
            onAuxClick={(e) => {
              if (e.button !== 1) return;
              e.preventDefault();
              onClose?.(tab.id);
            }}
            className={cn(
              "group/tab relative flex h-8 shrink-0 cursor-default select-none items-center gap-2 px-3 text-[12.5px]",
              active
                ? "max-w-[190px] font-medium text-text-primary"
                : "max-w-[170px] text-text-muted hover:text-text-secondary",
            )}
          >
            {tab.dot && <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", DOT[tab.dot])} />}
            <span className="min-w-0 truncate" title={title}>{tab.label}</span>
            {/* the slot is always reserved — only its visibility changes, so a
                hover never shifts the label's truncation width */}
            <button
              aria-label={`Close ${tab.label}`}
              tabIndex={active ? 0 : -1}
              onClick={(e) => {
                e.stopPropagation();
                onClose?.(tab.id);
              }}
              className={cn(
                "flex size-4 items-center justify-center rounded-[4px] text-text-dim hover:bg-fill-hover",
                !active && "invisible group-hover/tab:visible group-focus-within/tab:visible",
              )}
            >
              <XGlyph size={8} />
            </button>
            {active && <span className="absolute -bottom-px left-2 right-2 h-0.5 rounded-[1px] bg-text-primary" />}
          </div>
        );
      })}
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
