/*
 * F11 — the shell title bar: window controls · brand glyph · project tabs (active =
 * fill-hover + strong border + mark dot; background = fill-subtle, close on hover;
 * updated = the word badge, never a colored dot alone; overflow "+N more"; 180px max)
 * · "+" (opens the ⌘K switcher) · Checked HH:MM:SS or the degraded status.
 * The whole bar is the drag region.
 */
import { Fragment } from "react";
import { windowControls } from "@/lib/ipc";
import { BrandGlyph, ErrorGlyph, HelpGlyph, PlusGlyph, XGlyph } from "./icons";
import { PaneCluster, type PaneUnit, type PaneVisibility } from "./PaneCluster";
import { cn } from "@/lib/utils";
import type { MarkIndex } from "./atoms";

const MARK_BG = ["", "bg-mark-1", "bg-mark-2", "bg-mark-3", "bg-mark-4", "bg-mark-5", "bg-mark-6"];

/** I — the update line's state machine (F40.3). */
export type UpdateLineProps = {
  version: string;
  phase: "available" | "checking" | "downloading" | "installing" | "restart";
  pct: number | null;
  onInstall: () => void;
  onDismiss: () => void;
  onRestart: () => void;
};

export type ProjectTab = {
  dir: string;
  name: string;
  mark: MarkIndex;
  updated?: boolean; // finished something while in the background
  updatedHint?: string;
};

const MAX_VISIBLE_TABS = 4;

/** The window lights — quiet monochrome dots at rest; hovering the cluster
 * shows the real macOS colours and glyphs (close ×, minimize −, zoom ⤢). */
export function TrafficLights() {
  const dot =
    "group/tl flex size-3 items-center justify-center rounded-full border border-border-strong bg-fill-hover " +
    "transition-colors duration-100 [&_svg]:opacity-0 group-hover/lights:[&_svg]:opacity-100";
  const glyph = "text-black/50";
  return (
    <div className="group/lights flex gap-2">
      <button
        aria-label="Close window"
        onClick={() => void windowControls().close()}
        className={cn(dot, "group-hover/lights:border-[#e0443e] group-hover/lights:bg-[#ff5f57]")}
      >
        <svg width="6" height="6" viewBox="0 0 6 6" stroke="currentColor" strokeWidth="1.1" className={glyph}>
          <path d="M1 1l4 4M5 1L1 5" />
        </svg>
      </button>
      <button
        aria-label="Minimize window"
        onClick={() => void windowControls().minimize()}
        className={cn(dot, "group-hover/lights:border-[#dea123] group-hover/lights:bg-[#febc2e]")}
      >
        <svg width="6" height="6" viewBox="0 0 6 6" stroke="currentColor" strokeWidth="1.1" className={glyph}>
          <path d="M0.5 3h5" />
        </svg>
      </button>
      <button
        aria-label="Zoom window"
        onClick={() => void windowControls().toggleMaximize()}
        className={cn(dot, "group-hover/lights:border-[#1f9a31] group-hover/lights:bg-[#28c840]")}
      >
        <svg width="6" height="6" viewBox="0 0 6 6" fill="currentColor" className={glyph}>
          <path d="M1 3.6V1h2.6zM5 2.4V5H2.4z" />
        </svg>
      </button>
    </div>
  );
}

export function TitleBar({
  tabs,
  activeDir,
  checkedAt,
  update,
  degraded,
  panes,
  onTogglePane,
  onSwitch,
  onClose,
  onAdd,
  onHome,
  onHelp,
}: {
  tabs: ProjectTab[];
  activeDir: string;
  checkedAt: string | null;
  /** A newer Chronicle is ready — the quiet right-side affordance. */
  update?: UpdateLineProps | null;
  degraded: string | null;
  /** F31 — the visibility cluster, leftmost of the right-side items. */
  panes?: PaneVisibility;
  onTogglePane?: (unit: PaneUnit) => void;
  onSwitch: (dir: string) => void;
  onClose: (dir: string) => void;
  onAdd: () => void;
  onHome?: () => void;
  /** Opens the Help screen — the primary entry, replacing the rail's. */
  onHelp?: () => void;
}) {
  // the active tab must always be visible — swap it over the last slot when it
  // falls outside the window (T-013)
  const visible = tabs.slice(0, MAX_VISIBLE_TABS);
  const activeIdx = tabs.findIndex((t) => t.dir === activeDir);
  if (activeIdx >= MAX_VISIBLE_TABS) visible[MAX_VISIBLE_TABS - 1] = tabs[activeIdx];
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
      <TrafficLights />
      <button
        aria-label="Home — all projects"
        title="Home — all projects"
        onClick={onHome}
        className="flex size-7 shrink-0 items-center justify-center rounded-[7px] text-text-subtle hover:bg-fill-hover hover:text-text-secondary"
      >
        <BrandGlyph size={17} />
      </button>

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
                    <>
                      <span className="rounded-[5px] bg-fill-subtle px-[5px] text-[10.5px] leading-[15px] text-text-subtle group-hover/tab:hidden">
                        Updated
                      </span>
                      <button
                        aria-label={`Close ${t.name}`}
                        onClick={(e) => { e.stopPropagation(); onClose(t.dir); }}
                        className="hidden size-[18px] items-center justify-center rounded-[5px] text-text-dim hover:bg-fill-hover hover:text-text-secondary group-hover/tab:flex"
                      >
                        <XGlyph size={8} />
                      </button>
                    </>
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
      {panes && onTogglePane && (
        <span className="mr-3 shrink-0">
          <PaneCluster visibility={panes} onToggle={onTogglePane} />
        </span>
      )}
      {update && (
        <span data-update-line={update.phase} className="mr-3 inline-flex shrink-0 items-center gap-2 text-[11.5px]">
          {update.phase === "checking" ? (
            <span className="text-text-subtle">Checking…</span>
          ) : update.phase === "downloading" ? (
            <span className="inline-flex items-center gap-2 text-text-subtle">
              <span
                aria-hidden
                className="inline-block size-2.5 shrink-0 rounded-full border-[1.5px] border-state-neutral"
                style={{ borderTopColor: "transparent", animation: "wv-spin 0.7s linear infinite" }}
              />
              Downloading{update.pct != null && <span className="font-mono tabular-nums">{update.pct}%</span>}
            </span>
          ) : update.phase === "installing" ? (
            <span className="text-text-subtle">Installing…</span>
          ) : update.phase === "restart" ? (
            <>
              <span className="text-text-subtle">Restart to finish ·</span>
              <button
                onClick={update.onRestart}
                className="font-medium text-text-primary underline underline-offset-2 hover:text-text-secondary"
              >
                Restart
              </button>
            </>
          ) : (
            <>
              <span className="text-text-secondary">Chronicle {update.version} is ready</span>
              <button
                onClick={update.onInstall}
                className="font-medium text-text-primary underline underline-offset-2 hover:text-text-secondary"
              >
                Update
              </button>
              <button
                aria-label="Dismiss the update notice"
                onClick={update.onDismiss}
                className="flex size-4 items-center justify-center rounded-[4px] text-text-dim hover:bg-fill-hover hover:text-text-secondary"
              >
                <XGlyph size={8} />
              </button>
            </>
          )}
        </span>
      )}
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
      {onHelp && (
        <>
          <span className="mx-3 h-3.5 w-px shrink-0 bg-divider" aria-hidden />
          <button
            data-no-zoom
            onClick={onHelp}
            title="Guides, how-tos, and shortcuts — ⌘/"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-[7px] px-2 py-1 text-[11.5px] font-medium text-text-secondary hover:bg-fill-hover hover:text-text-primary"
          >
            <HelpGlyph size={13} />
            Need help?
          </button>
        </>
      )}
    </div>
  );
}
