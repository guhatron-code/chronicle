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
 * Dropping a path onto the surface types it into that tab's pty — two routes,
 * because they are two different event systems:
 *   · Finder (and any OS drag) — the webview swallows HTML5 file drops when
 *     Tauri's dragDropEnabled is on (it is, by default), and an HTML `File`
 *     has no path anyway. So OS drops come from `onDragDropEvent`, which hands
 *     us real absolute paths plus a PHYSICAL cursor position we hit-test
 *     against the active host. No modifier — this matches Terminal.app/iTerm.
 *   · A composer attachment chip — an in-webview drag, so it stays on the
 *     React handlers, Shift-gated (an unmodified chip drag is a re-drop on the
 *     composer, not a terminal insert).
 * Both funnel through shellPath(): quoted only if needed, trailing space,
 * never a newline — a drop inserts a path, it never runs a command.
 *
 * Renaming is component-local: double-click a tab → inline input replaces the
 * label (onRenameStart fires); Enter or blur commits via
 * onRenameCommit(id, name); Escape cancels; an empty draft cancels. A dead
 * session (live: false) keeps its tab — italic, dim, "· ended" — and its
 * scrollback until closed.
 */
import { useEffect, useRef, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { ptyWrite } from "@/lib/ipc";
import { cn } from "@/lib/utils";
import { ClaudeStar, CodexTile, PlusGlyph, XGlyph } from "./icons";
import { Eyebrow, Kbd, Spinner } from "./atoms";

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
  /** G — the agent ACTUALLY in the pty's foreground right now (truth, not
   *  the title's guess). Drives the live dot + "working". */
  fgAgent?: TerminalAgent | null;
  /** an agent ran here at some point — its exit reads as "idle" */
  hadAgent?: boolean;
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

/** Quote a path for the shell only when it needs it; always trailing-spaced,
 *  never newline-terminated (dropping a path must never run a command). */
function shellPath(p: string): string {
  return /[^A-Za-z0-9_./-]/.test(p) ? `'${p.replace(/'/g, `'\\''`)}' ` : `${p} `;
}

export function TerminalColumn({
  tabs,
  activeId,
  onNewTerminal,
  onStartAgent,
  spawning,
  onSelect,
  onClose,
  onRenameStart,
  onRenameCommit,
  hostFor,
  collapsed,
  onToggleCollapsed,
}: {
  tabs: TerminalTab[];
  activeId: number | null;
  onNewTerminal: () => void;
  onStartAgent: (agent: TerminalAgent) => void;
  /** A spawn is mid-flight — every spawn affordance disables; the one that was
   *  clicked shows a spinner (the pty takes a moment; double-clicks stacked twins). */
  spawning?: "claude" | "codex" | "shell" | null;
  onSelect?: (id: number) => void;
  onClose?: (id: number) => void;
  onRenameStart?: (id: number) => void;
  onRenameCommit?: (id: number, name: string) => void;
  /** The host-mount seam — see the header comment. */
  hostFor?: (id: number) => (el: HTMLDivElement | null) => void;
  /** F31 — collapsed to a slim re-open strip at the bottom of the column.
   *  Sessions keep running exactly as hidden tabs already do. */
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}) {
  const [renamingId, setRenamingId] = useState<number | null>(null);
  /** the tab an OS drag is currently hovering — drives the drop ring */
  const [osDropId, setOsDropId] = useState<number | null>(null);

  /* --- OS drag-drop (Finder → terminal) -----------------------------------
   * The listener is window-wide and mounts once, so it reads activeId and the
   * host elements through refs rather than re-subscribing on every change. */
  const hosts = useRef(new Map<number, HTMLDivElement>());
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;

  /** Which tab (if any) sits under an OS cursor. The payload position is
   *  PHYSICAL — divide by DPR to land in the CSS pixels a rect speaks. Only
   *  the active host is visible, so it is the only candidate. */
  const tabAtPoint = (pos: { x: number; y: number }): number | null => {
    const id = activeIdRef.current;
    const el = id == null ? undefined : hosts.current.get(id);
    if (id == null || !el) return null;
    const r = el.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const x = pos.x / dpr;
    const y = pos.y / dpr;
    return x >= r.left && x < r.right && y >= r.top && y < r.bottom ? id : null;
  };

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let dead = false;
    void getCurrentWebview()
      .onDragDropEvent((e) => {
        const p = e.payload;
        if (p.type === "enter" || p.type === "over") setOsDropId(tabAtPoint(p.position));
        else if (p.type === "leave") setOsDropId(null);
        else if (p.type === "drop") {
          setOsDropId(null);
          const id = tabAtPoint(p.position);
          if (id == null || p.paths.length === 0) return;
          // several files land as several space-separated paths, one write
          void ptyWrite(id, p.paths.map(shellPath).join("")).catch(() => {});
        }
      })
      .then((fn) => {
        if (dead) fn();
        else unlisten = fn;
      })
      .catch(() => {});
    return () => {
      dead = true;
      unlisten?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* The host ref seam: we need the element for hit-testing AND the parent
   * needs its xterm mount. Compose once per tab and cache — handing React a
   * fresh callback each render would detach/remount xterm (see the header). */
  const hostForRef = useRef(hostFor);
  hostForRef.current = hostFor;
  const composedHostRefs = useRef(new Map<number, (el: HTMLDivElement | null) => void>());
  const hostRefFor = (id: number) => {
    let fn = composedHostRefs.current.get(id);
    if (!fn) {
      fn = (el: HTMLDivElement | null) => {
        if (el) hosts.current.set(id, el);
        else hosts.current.delete(id);
        hostForRef.current?.(id)(el);
      };
      composedHostRefs.current.set(id, fn);
    }
    return fn;
  };

  if (collapsed) {
    return (
      <button
        data-terminal-strip
        onClick={onToggleCollapsed}
        className="flex h-7 shrink-0 items-center gap-2 border-t border-divider px-3 text-left hover:bg-fill-subtle"
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-text-dim">
          <path d="m3 5 3 3-3 3M8 11h5" />
        </svg>
        <span className="text-[11.5px] font-medium text-text-secondary">Terminal</span>
        <span className="font-mono text-[10.5px] text-text-dim tabular-nums">
          {tabs.length === 0 ? "no tabs" : tabs.length === 1 ? "1 tab" : `${tabs.length} tabs`}
        </span>
        <span className="flex-1" />
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-text-dim">
          <path d="m3 7.5 3-3 3 3" />
        </svg>
      </button>
    );
  }

  return (
    <div data-terminal-section className="flex min-h-0 flex-1 flex-col overflow-hidden">
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
                    ? "text-text-dim"
                    : t.id === activeId
                      ? "font-medium text-text-primary"
                      : "text-text-muted",
                )}
              >
                {tabLabel(t)}
              </span>
              {t.live && t.fgAgent && (
                <span data-tab-fg="working" className="inline-flex items-center gap-1 whitespace-nowrap text-[11px] text-state-neutral">
                  <span
                    className="size-1 shrink-0 rounded-full bg-state-neutral"
                    style={{ animation: "wv-pulse 1.6s ease-in-out infinite" }}
                  />
                  working
                </span>
              )}
              {t.live && !t.fgAgent && (t.agent || t.hadAgent) && (
                <span data-tab-fg="idle" className="whitespace-nowrap text-[11px] text-text-dim">idle</span>
              )}
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
          disabled={spawning != null}
          onClick={() => onStartAgent("claude")}
          className="flex size-[30px] shrink-0 items-center justify-center rounded-md hover:bg-fill-hover disabled:opacity-55 disabled:hover:bg-transparent"
        >
          {spawning === "claude" ? <Spinner size={13} /> : <ClaudeStar size={16} />}
        </button>
        <button
          aria-label="Start Codex"
          title="Start Codex"
          disabled={spawning != null}
          onClick={() => onStartAgent("codex")}
          className="flex size-[30px] shrink-0 items-center justify-center rounded-md hover:bg-fill-hover disabled:opacity-55 disabled:hover:bg-transparent"
        >
          {spawning === "codex" ? <Spinner size={13} /> : <CodexTile />}
        </button>
        {onToggleCollapsed && (
          <button
            aria-label="Collapse the terminal section"
            title="Collapse — a slim strip stays"
            onClick={onToggleCollapsed}
            className="flex size-6 shrink-0 items-center justify-center rounded-[6px] text-text-dim hover:bg-fill-hover hover:text-text-secondary"
          >
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="m3 4.5 3 3 3-3" />
            </svg>
          </button>
        )}
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
              disabled={spawning != null}
              onClick={() => onStartAgent("claude")}
              className="flex h-[33px] items-center gap-2 rounded-md border border-border-strong px-[13px] text-[12.5px] font-medium text-text-primary hover:bg-fill-hover disabled:opacity-55 disabled:hover:bg-transparent"
            >
              {spawning === "claude" ? <Spinner size={12} /> : <ClaudeStar size={14} />}
              {spawning === "claude" ? "Starting…" : "Claude Code"}
            </button>
            <button
              disabled={spawning != null}
              onClick={() => onStartAgent("codex")}
              className="flex h-[33px] items-center gap-2 rounded-md border border-border-strong px-[13px] text-[12.5px] font-medium text-text-primary hover:bg-fill-hover disabled:opacity-55 disabled:hover:bg-transparent"
            >
              {spawning === "codex" ? <Spinner size={12} /> : <CodexTile size={13} />}
              {spawning === "codex" ? "Starting…" : "Codex"}
            </button>
          </div>
          <button
            disabled={spawning != null}
            onClick={onNewTerminal}
            className="text-xs text-text-dim hover:text-text-secondary disabled:opacity-55"
          >
            {spawning === "shell" ? "Starting…" : <>New terminal — <Kbd>⌘T</Kbd></>}
          </button>
        </div>
      ) : (
        /* the xterm host surface — flush (no radius/outline), one persistent
         * div per tab; inactive ones display:none so sessions survive */
        <div className="min-h-0 min-w-0 flex-1 overflow-hidden bg-surface-input">
          {tabs.map((t) => (
            <div
              key={t.id}
              ref={hostRefFor(t.id)}
              onDragOver={(e) => {
                // Shift-gated: only accept our attachment path while Shift is held
                if (e.shiftKey && e.dataTransfer.types.includes("application/x-chronicle-path")) {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "copy";
                }
              }}
              onDrop={(e) => {
                const path = e.dataTransfer.getData("application/x-chronicle-path");
                if (!e.shiftKey || !path) return;
                e.preventDefault();
                void ptyWrite(t.id, shellPath(path)).catch(() => {});
              }}
              className={cn(
                "h-full w-full min-w-0 overflow-hidden px-4 py-3.5 font-mono text-xs leading-[1.7] text-text-secondary",
                t.id !== activeId && "hidden",
                // transient only — the surface is flush at rest (see the header)
                osDropId === t.id && "[box-shadow:inset_0_0_0_2px_var(--border-field-focus)]",
              )}
            />
          ))}
        </div>
      )}
    </div>
  );
}
