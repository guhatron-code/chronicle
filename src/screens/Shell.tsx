/*
 * The persistent shell (Deck 2 composite): title bar / rail · content · splitter ·
 * terminal — ONE flat surface, hairline dividers only (the de-boxing law). The
 * terminal column persists on Roadmap/Repo; the Kanban takes the full width; the
 * splitter position is remembered per project.
 */
import { useCallback, useRef } from "react";
import type { ReactNode } from "react";
import { Rail, type Pane } from "@/components/chrome/Rail";
import { TitleBar, type ProjectTab } from "@/components/chrome/TitleBar";
import { TerminalColumn } from "@/components/chrome/TerminalColumn";

export function Shell({
  tabs,
  activeDir,
  pane,
  onPane,
  checkedAt,
  degraded,
  queuedCount,
  checking,
  splitPct,
  onSplitPct,
  onSwitch,
  onClose,
  onAdd,
  onRefresh,
  onHelp,
  terminalTabs,
  onNewTerminal,
  onStartAgent,
  children,
}: {
  tabs: ProjectTab[];
  activeDir: string;
  pane: Pane;
  onPane: (p: Pane) => void;
  checkedAt: string | null;
  degraded: string | null;
  queuedCount: number;
  checking?: boolean;
  splitPct: number; // content column width as % of content+terminal
  onSplitPct: (pct: number) => void;
  onSwitch: (dir: string) => void;
  onClose: (dir: string) => void;
  onAdd: () => void;
  onRefresh: () => void;
  onHelp: () => void;
  terminalTabs: { id: number; title: string }[];
  onNewTerminal: () => void;
  onStartAgent: (agent: "claude" | "codex") => void;
  children: ReactNode;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const showTerminal = pane !== "kanban";

  /* the roadmap content column is max-w-[900px] + 2×28px padding — the pane
   * never grows past what the content can use, and never shrinks below the
   * width where the cards start to distort */
  const ROAD_MAX_W = 956;
  const paneMinW = pane === "road" ? 560 : 520;

  const onSplitterDown = useCallback(
    (down: React.PointerEvent<HTMLDivElement>) => {
      down.preventDefault();
      const el = down.currentTarget;
      el.setPointerCapture(down.pointerId);
      const row = rowRef.current;
      if (!row) return;
      const onMove = (e: PointerEvent) => {
        const rect = row.getBoundingClientRect();
        const railW = 52;
        const usable = rect.width - railW - 7;
        const pct = ((e.clientX - rect.left - railW) / usable) * 100;
        // the roadmap column maxes at 956px (900 content + padding) — dragging
        // past it would only add empty margin, so the splitter stops there
        const maxPct = pane === "road" ? Math.min(75, (ROAD_MAX_W / usable) * 100) : 75;
        onSplitPct(Math.min(maxPct, Math.max(30, pct)));
      };
      const onUp = () => {
        el.removeEventListener("pointermove", onMove);
        el.removeEventListener("pointerup", onUp);
        el.removeEventListener("pointercancel", onUp);
      };
      el.addEventListener("pointermove", onMove);
      el.addEventListener("pointerup", onUp);
      el.addEventListener("pointercancel", onUp);
    },
    [onSplitPct, pane],
  );

  return (
    <div className="flex h-full flex-col bg-surface-app font-sans text-text-primary">
      <TitleBar
        tabs={tabs}
        activeDir={activeDir}
        checkedAt={checkedAt}
        degraded={degraded}
        onSwitch={onSwitch}
        onClose={onClose}
        onAdd={onAdd}
      />
      <div ref={rowRef} className="flex min-h-0 flex-1">
        <Rail
          pane={pane}
          onPane={onPane}
          queuedCount={queuedCount}
          checking={checking}
          onRefresh={onRefresh}
          onHelp={onHelp}
        />
        <div
          className="flex min-w-0 flex-col overflow-hidden"
          style={
            showTerminal
              ? {
                  width:
                    pane === "road"
                      ? `min(calc((100% - 59px) * ${splitPct / 100}), ${ROAD_MAX_W}px)`
                      : `calc((100% - 59px) * ${splitPct / 100})`,
                  minWidth: paneMinW,
                }
              : { flex: 1 }
          }
        >
          {children}
        </div>
        {showTerminal && (
          <>
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize the terminal column"
              onPointerDown={onSplitterDown}
              className="flex w-[7px] shrink-0 cursor-col-resize items-center justify-center hover:bg-fill-hover"
            >
              <span className="h-[34px] w-0.5 rounded-[1px] bg-border-strong" />
            </div>
            <TerminalColumn
              tabs={terminalTabs}
              activeId={terminalTabs[0]?.id ?? null}
              onNewTerminal={onNewTerminal}
              onStartAgent={onStartAgent}
            />
          </>
        )}
      </div>
    </div>
  );
}
