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
 * The strip carries no scrollbar at all (scrollbar-none) — a bar under a 40px
 * row of tabs reads as chrome-on-chrome. Overflow is announced by a gradient at
 * whichever end still has tabs past it; the wheel, the trackpad and the active
 * tab's scrollIntoView all still scroll it.
 *
 * Every tab reserves the close button's size-4 slot, so revealing the X on a
 * background tab never re-truncates its label. Middle-click closes a tab too,
 * the way it does in a browser.
 *
 * Keyboard: the ARIA tab pattern — one stop for the whole strip (the active
 * tab), ←/→ move along it and select as they go, Enter and Space select.
 */
import { EdgeFades } from "@/components/chrome/EdgeFades";
import { XGlyph } from "@/components/chrome/icons";
import { useOverflowEdges } from "@/lib/overflow-edges";
import { cn } from "@/lib/utils";

/** what the tab's leading dot is saying — each has its own colour */
export type TabDot = "loading" | "live" | "local" | "dirty";

const DOT: Record<TabDot, string> = {
  loading: "bg-state-neutral",
  live: "bg-state-success",
  local: "bg-text-subtle",
  dirty: "bg-state-warn",
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
  /** names the strip for a screen reader */
  label?: string;
  className?: string;
};

export function TabStrip({ tabs, activeId, onSelect, onClose, onNew, trailing, label, className }: TabStripProps) {
  // scroll the active tab into view only when it CHANGES — a ref callback runs
  // every render, and scrollIntoView on each one hijacks the tab strip's scroll
  const lastScrolled = React.useRef<string | null>(null);

  const stripRef = React.useRef<HTMLDivElement>(null);
  const edges = useOverflowEdges(stripRef);

  // roving tabIndex: the strip is one tab stop. With nothing active the first
  // tab holds it, so the strip is never unreachable from the keyboard.
  const activeIndex = tabs.findIndex((t) => t.id === activeId);
  const stop = activeIndex >= 0 ? activeIndex : 0;

  const step = (from: HTMLElement, delta: number) => {
    const strip = from.parentElement;
    if (!strip) return;
    const els = Array.from(strip.querySelectorAll<HTMLElement>('[role="tab"]'));
    const next = els[els.indexOf(from) + delta];
    if (!next) return;
    next.focus();
    const id = next.dataset.tabId;
    if (id) onSelect?.(id);
  };

  return (
    <div data-chrome className={cn("relative flex h-10 min-w-0 shrink-0", className)}>
      <div
        ref={stripRef}
        role="tablist"
        aria-label={label}
        aria-orientation="horizontal"
        className="flex h-10 w-full min-w-0 items-end gap-0.5 overflow-x-auto overflow-y-hidden border-b border-divider px-2.5 scrollbar-none"
      >
        {tabs.map((tab, i) => {
          const active = tab.id === activeId;
          const title = tab.title ?? tab.label;
          return (
            <div
              key={tab.id}
              role="tab"
              aria-selected={active}
              data-tab-id={tab.id}
              tabIndex={i === stop ? 0 : -1}
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
                if (e.key === "ArrowRight") { e.preventDefault(); step(e.currentTarget, 1); }
                else if (e.key === "ArrowLeft") { e.preventDefault(); step(e.currentTarget, -1); }
                else if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  if (!active) onSelect?.(tab.id);
                }
                // the close button is not its own tab stop, so the key closes it
                else if (e.key === "Delete" || e.key === "Backspace") {
                  e.preventDefault();
                  onClose?.(tab.id);
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
                tabIndex={-1}
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
      <EdgeFades edges={edges} />
    </div>
  );
}
