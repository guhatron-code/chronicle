/*
 * The terminal column (F26) — the tab strip (chips · "+" · START + the two
 * brand logos) over the xterm host surface. Persistent across Roadmap/Repo;
 * absent on Kanban and Picker (the Shell decides). Anatomy per Deck-5 F26;
 * in-shell measures per Deck-6 L1/L2; the strip keeps the C2 h-10 row (the
 * operator pass aligned it with the viewer bar).
 *
 * Host-mount seam (C6 wiring): pass `hostFor(tabId)` — it must return a
 * STABLE ref callback per tab (memoize on the wiring side). Every tab gets one
 * persistent flush <div> on the terminal surface (bg-surface-input, 14px/16px
 * padding, no radius/outline/scrollbars — the global 2px scrollbar applies);
 * xterm.open() attaches to that div and it stays mounted for the life of the
 * tab — inactive tabs are display:none, so sessions and scrollback survive tab
 * switches. With no tabs the surface shows the START state instead
 * (onStartAgent / onNewTerminal).
 *
 * Renaming is component-local: double-click a tab → inline input replaces the
 * label (onRenameStart fires); Enter or blur commits via
 * onRenameCommit(id, name); Escape cancels; an empty draft cancels. A dead
 * session (live: false) keeps its tab — italic, dim, "· ended" — and its
 * scrollback until closed.
 */
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { ClaudeStar, CodexTile, PlusGlyph, XGlyph } from "./icons";
import { Eyebrow, Kbd } from "./atoms";

export type TerminalAgent = "claude" | "codex";

/** One terminal session tab. The rendered label is
 *  `{agent · }title{ · ended}` — "claude · R-1", "codex · el-1 · ended". */
export type TerminalTab = {
  id: number;
  /** The user-facing name — the rename target ("R-1", "design notes"). */
  title: string;
  /** false ⇒ the session exited; the tab goes italic-dim with "· ended". */
  live: boolean;
  /** Which agent runs in it, if any — prefixes the label. */
  agent?: TerminalAgent;
};

const tabLabel = (t: TerminalTab) =>
  `${t.agent ? `${t.agent} · ` : ""}${t.title}${t.live ? "" : " · ended"}`;

/** The F26 renaming chip: focus-ring'd input field replacing the label. */
function RenameInput({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string;
  onCommit: (name: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const done = useRef(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.select(), []);

  const commit = () => {
    if (done.current) return;
    done.current = true;
    const name = draft.trim();
    if (name) onCommit(name);
    else onCancel();
  };
  const cancel = () => {
    if (done.current) return;
    done.current = true;
    onCancel();
  };

  return (
    <div className="flex h-7 shrink-0 items-center rounded-md border border-border-field-focus bg-surface-input px-1.5 [box-shadow:var(--focus-ring)]">
      <input
        ref={ref}
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          else if (e.key === "Escape") cancel();
        }}
        onBlur={commit}
        aria-label="Rename terminal"
        className="field-sizing-content min-w-10 max-w-44 bg-transparent text-xs text-text-primary outline-none"
      />
    </div>
  );
}

export function TerminalColumn({
  tabs,
  activeId,
  onNewTerminal,
  onStartAgent,
  onSelect,
  onClose,
  onRenameStart,
  onRenameCommit,
  hostFor,
}: {
  tabs: TerminalTab[];
  activeId: number | null;
  onNewTerminal: () => void;
  onStartAgent: (agent: TerminalAgent) => void;
  onSelect?: (id: number) => void;
  onClose?: (id: number) => void;
  onRenameStart?: (id: number) => void;
  onRenameCommit?: (id: number, name: string) => void;
  /** The host-mount seam — see the header comment. */
  hostFor?: (id: number) => (el: HTMLDivElement | null) => void;
}) {
  const [renamingId, setRenamingId] = useState<number | null>(null);

  return (
    <div className="flex min-w-[240px] flex-1 flex-col overflow-hidden border-l border-divider">
      {/* tab strip — the C2 h-10 row (operator-aligned with the viewer bar) */}
      <div role="tablist" className="flex h-10 shrink-0 items-center gap-0.5 border-b border-divider px-3">
        {tabs.map((t) =>
          renamingId === t.id ? (
            <RenameInput
              key={t.id}
              initial={t.title}
              onCommit={(name) => {
                setRenamingId(null);
                onRenameCommit?.(t.id, name);
              }}
              onCancel={() => setRenamingId(null)}
            />
          ) : (
            <div
              key={t.id}
              role="tab"
              aria-selected={t.id === activeId}
              onClick={() => onSelect?.(t.id)}
              onDoubleClick={() => {
                setRenamingId(t.id);
                onRenameStart?.(t.id);
              }}
              className={cn(
                "flex h-7 shrink-0 items-center px-[11px]",
                t.id === activeId
                  ? "gap-2 rounded-md border border-border-strong bg-fill-hover"
                  : "gap-[7px] rounded-md hover:bg-fill-subtle",
              )}
            >
              <span
                className={cn(
                  "text-xs whitespace-nowrap",
                  !t.live
                    ? "italic text-text-dim"
                    : t.id === activeId
                      ? "font-medium text-text-primary"
                      : "text-text-muted",
                )}
              >
                {tabLabel(t)}
              </span>
              {t.id === activeId && (
                <button
                  aria-label="Close terminal"
                  onClick={(e) => {
                    e.stopPropagation();
                    onClose?.(t.id);
                  }}
                  className="flex size-4 items-center justify-center rounded-[4px] text-text-dim hover:bg-fill-hover hover:text-text-secondary"
                >
                  <XGlyph size={8} />
                </button>
              )}
            </div>
          ),
        )}
        <button
          aria-label="New terminal"
          title="New terminal — ⌘T"
          onClick={onNewTerminal}
          className="flex size-[26px] shrink-0 items-center justify-center rounded-[7px] text-text-dim hover:bg-fill-hover hover:text-text-secondary"
        >
          <PlusGlyph size={11} />
        </button>
        <span className="flex-1" />
        <Eyebrow>Start</Eyebrow>
        <button
          aria-label="Start Claude Code"
          title="Start Claude Code"
          onClick={() => onStartAgent("claude")}
          className="flex size-[30px] shrink-0 items-center justify-center rounded-md hover:bg-fill-hover"
        >
          <ClaudeStar size={16} />
        </button>
        <button
          aria-label="Start Codex"
          title="Start Codex"
          onClick={() => onStartAgent("codex")}
          className="flex size-[30px] shrink-0 items-center justify-center rounded-md hover:bg-fill-hover"
        >
          <CodexTile />
        </button>
      </div>

      {tabs.length === 0 ? (
        /* START state — no session yet; the strip's affordances, spelled out */
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 bg-surface-input px-6">
          <Eyebrow>Start a session</Eyebrow>
          <div className="max-w-[280px] text-center text-xs leading-[1.55] text-text-muted">
            Run Claude Code or Codex here, or open a plain terminal.
          </div>
          <div className="flex gap-2 pt-1">
            <button
              onClick={() => onStartAgent("claude")}
              className="flex h-[33px] items-center gap-2 rounded-md border border-border-strong px-[13px] text-[12.5px] font-medium text-text-primary hover:bg-fill-hover"
            >
              <ClaudeStar size={14} />
              Claude Code
            </button>
            <button
              onClick={() => onStartAgent("codex")}
              className="flex h-[33px] items-center gap-2 rounded-md border border-border-strong px-[13px] text-[12.5px] font-medium text-text-primary hover:bg-fill-hover"
            >
              <CodexTile size={13} />
              Codex
            </button>
          </div>
          <button
            onClick={onNewTerminal}
            className="text-xs text-text-dim hover:text-text-secondary"
          >
            New terminal — <Kbd>⌘T</Kbd>
          </button>
        </div>
      ) : (
        /* the xterm host surface — flush (no radius/outline), one persistent
         * div per tab; inactive ones display:none so sessions survive */
        <div className="min-h-0 min-w-0 flex-1 overflow-hidden bg-surface-input">
          {tabs.map((t) => (
            <div
              key={t.id}
              ref={hostFor?.(t.id)}
              className={cn(
                "h-full w-full min-w-0 overflow-hidden px-4 py-3.5 font-mono text-xs leading-[1.7] text-text-secondary",
                t.id !== activeId && "hidden",
              )}
            />
          ))}
        </div>
      )}
    </div>
  );
}
