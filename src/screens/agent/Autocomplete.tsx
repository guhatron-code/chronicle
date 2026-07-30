/*
 * The composer's trigger menu — one popup, two triggers (`/` and `@`).
 *
 * It owns only presentation and the highlight; the composer owns the query and
 * what a pick means. Keyboard handling lives in `handleKey`, which the
 * composer's textarea calls FIRST so Enter accepts a highlighted row instead of
 * sending the message.
 */
import { useLayoutEffect, useRef } from "react";
import { cn } from "@/lib/utils";

export interface PickerItem {
  /** stable key + what gets inserted (the composer decides the exact text) */
  id: string;
  /** the bold left-hand label */
  label: string;
  /** the muted right-hand text */
  detail?: string;
  /** the agent's own argument hint, rendered between label and detail */
  hint?: string;
  /** rows sharing a heading are grouped, in first-seen order */
  group?: string;
  /** shown small and dim at the far right — "file", "task", … */
  badge?: string;
}

export function Autocomplete({
  items,
  active,
  onActive,
  onPick,
  emptyLabel,
}: {
  items: PickerItem[];
  active: number;
  onActive: (i: number) => void;
  onPick: (item: PickerItem) => void;
  emptyLabel: string;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  // keep the highlighted row in view when arrowing past the fold
  useLayoutEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-row="${active}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (items.length === 0) {
    return (
      <div
        data-composer-menu
        className="absolute bottom-full left-0 z-30 mb-1.5 w-[340px] max-w-[calc(100%-8px)] rounded-[10px] border border-border-strong bg-surface-overlay px-3 py-2.5 [box-shadow:var(--shadow-overlay)]"
      >
        <span className="text-[12px] text-text-subtle">{emptyLabel}</span>
      </div>
    );
  }

  let lastGroup: string | undefined;
  return (
    <div
      ref={listRef}
      data-composer-menu
      // overflow-x-hidden is explicit: setting only overflow-y promotes
      // overflow-x from visible to auto, which is where the sideways
      // scrollbar came from
      className="absolute bottom-full left-0 z-30 mb-1.5 flex max-h-[360px] w-[380px] max-w-[calc(100%-8px)] flex-col overflow-y-auto overflow-x-hidden rounded-[10px] border border-border-strong bg-surface-overlay p-1 [box-shadow:var(--shadow-overlay)]"
    >
      {items.map((it, i) => {
        const heading = it.group !== lastGroup ? it.group : undefined;
        lastGroup = it.group;
        return (
          <div key={it.id} className="flex flex-col">
            {heading && (
              <div className="px-2.5 pb-[5px] pt-2 text-[10px] uppercase tracking-[0.09em] text-text-dimmer">
                {heading}
              </div>
            )}
            <button
              data-row={i}
              // mousedown, not click: the textarea must not lose focus first
              onMouseDown={(e) => { e.preventDefault(); onPick(it); }}
              onMouseEnter={() => onActive(i)}
              className={cn(
                "flex w-full min-w-0 flex-col gap-0.5 rounded-md px-2.5 py-1.5 text-left",
                i === active && "bg-fill-hover",
              )}
            >
              {/* two lines, like the config dropdown: the name can't be
                  squeezed by a long description, and the description gets the
                  full width instead of a few truncated words */}
              <span className="flex w-full min-w-0 items-center gap-2">
                <span className="min-w-0 truncate text-[12.5px] text-text-primary">{it.label}</span>
                {it.hint && (
                  <span className="min-w-0 shrink truncate font-mono text-[10.5px] text-text-dimmer">
                    {it.hint}
                  </span>
                )}
                {it.badge && (
                  <span className="ml-auto shrink-0 rounded-[5px] bg-fill-subtle px-1.5 text-[10px] text-text-subtle">
                    {it.badge}
                  </span>
                )}
              </span>
              {it.detail && (
                <span className="line-clamp-2 w-full min-w-0 text-[11px] leading-snug text-text-dim">
                  {it.detail}
                </span>
              )}
            </button>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Keyboard for an open menu. Returns true when the key was consumed, which the
 * composer treats as "do not also send / do not also insert a newline".
 */
export function handleKey(
  e: React.KeyboardEvent,
  count: number,
  active: number,
  setActive: (i: number) => void,
  pick: () => void,
  close: () => void,
): boolean {
  if (e.key === "ArrowDown") {
    e.preventDefault();
    setActive(count === 0 ? 0 : (active + 1) % count);
    return true;
  }
  if (e.key === "ArrowUp") {
    e.preventDefault();
    setActive(count === 0 ? 0 : (active - 1 + count) % count);
    return true;
  }
  if (e.key === "Escape") {
    e.preventDefault();
    close();
    return true;
  }
  // Enter and Tab accept — but never mid-IME-composition, where Enter is
  // committing the candidate rather than choosing a row
  if ((e.key === "Enter" || e.key === "Tab") && !e.nativeEvent.isComposing) {
    if (count === 0) return false;
    e.preventDefault();
    pick();
    return true;
  }
  return false;
}

/**
 * Find an active trigger in the text before the caret.
 *
 * `/` fires only at position 0: paths like `src/lib` must not open the menu,
 * and the adapter only treats a prompt as a command when the first text block
 * starts with a slash, so a mid-sentence `/` was never going to be one.
 *
 * `@` fires anywhere it follows whitespace or starts the input. The query runs
 * to the caret and stops at whitespace.
 */
export function findTrigger(
  text: string,
  caret: number,
): { kind: "slash" | "at"; start: number; query: string } | null {
  const before = text.slice(0, caret);

  if (before.startsWith("/") && !/\s/.test(before)) {
    return { kind: "slash", start: 0, query: before.slice(1) };
  }

  const at = before.lastIndexOf("@");
  if (at !== -1) {
    const prev = at === 0 ? "" : before[at - 1];
    const query = before.slice(at + 1);
    if ((at === 0 || /\s/.test(prev)) && !/\s/.test(query)) {
      return { kind: "at", start: at, query };
    }
  }
  return null;
}
