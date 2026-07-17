/*
 * The persistent shell (Deck 2 composite, amended by Deck 7 F31): title bar /
 * rail · content · splitter · the right column stacking AGENT over TERMINAL
 * with a horizontal splitter — ONE flat surface, hairline dividers only (the
 * de-boxing law). Each unit (content · agent · terminal) can be shown or
 * hidden via the title-bar cluster — all three at max, exactly one at min;
 * visibility persists per project. SUPERSEDED and retired here: the old
 * "terminal column is absent on Kanban (full-bleed)" rule — the right column
 * may sit beside any content pane; the toggles are how full-bleed happens now.
 * Hiding a unit never kills sessions (they live outside React, like hidden
 * terminal tabs always have).
 */
import { useCallback, useRef } from "react";
import type { ReactNode } from "react";
import { Rail, type Pane } from "@/components/chrome/Rail";
import { TitleBar, type ProjectTab } from "@/components/chrome/TitleBar";
import type { PaneUnit, PaneVisibility } from "@/components/chrome/PaneCluster";
import {
  TerminalColumn,
  type TerminalAgent,
  type TerminalTab,
} from "@/components/chrome/TerminalColumn";
import { AgentSection } from "@/screens/agent/AgentSection";

export function Shell({
  tabs,
  activeDir,
  pane,
  onPane,
  checkedAt,
  update,
  degraded,
  queuedCount,
  checking,
  splitPct,
  onSplitPct,
  panes,
  onTogglePane,
  agentCollapsed,
  terminalCollapsed,
  onToggleAgentCollapsed,
  onToggleTerminalCollapsed,
  hSplitPct,
  onHSplitPct,
  agentBody,
  agentStateWord,
  agentStateKind,
  onSwitch,
  onClose,
  onAdd,
  onHome,
  onRefresh,
  onHelp,
  terminalTabs,
  activeTerminalId,
  onNewTerminal,
  onStartAgent,
  terminalSpawning,
  onTerminalSelect,
  onTerminalClose,
  onTerminalRenameCommit,
  terminalHostFor,
  children,
}: {
  tabs: ProjectTab[];
  activeDir: string;
  pane: Pane;
  onPane: (p: Pane) => void;
  checkedAt: string | null;
  update?: { version: string; busy: boolean; onInstall: () => void; onDismiss: () => void } | null;
  degraded: string | null;
  queuedCount: number;
  checking?: boolean;
  splitPct: number; // content column width as % of content+right column
  onSplitPct: (pct: number) => void;
  /** F31 — which units are visible (persisted per project by the wiring). */
  panes: PaneVisibility;
  onTogglePane: (unit: PaneUnit) => void;
  agentCollapsed: boolean;
  terminalCollapsed: boolean;
  onToggleAgentCollapsed: () => void;
  onToggleTerminalCollapsed: () => void;
  /** The agent section's height as % of the right column (both expanded). */
  hSplitPct: number;
  onHSplitPct: (pct: number) => void;
  /** Z-2b fills this with the real thread + composer. */
  agentBody?: ReactNode;
  agentStateWord?: string;
  agentStateKind?: "dim" | "neutral" | "error";
  onSwitch: (dir: string) => void;
  onClose: (dir: string) => void;
  onAdd: () => void;
  onHome?: () => void;
  onRefresh: () => void;
  onHelp: () => void;
  terminalTabs: TerminalTab[];
  /** Defaults to the first tab — the C2 behavior — until C6 wires selection. */
  activeTerminalId?: number | null;
  onNewTerminal: () => void;
  onStartAgent: (agent: TerminalAgent) => void;
  /** Which spawn affordance is mid-flight — buttons disable + show it. */
  terminalSpawning?: "claude" | "codex" | "shell" | null;
  onTerminalSelect?: (id: number) => void;
  onTerminalClose?: (id: number) => void;
  onTerminalRenameCommit?: (id: number, name: string) => void;
  /** The xterm host-mount seam — see TerminalColumn's header comment. */
  terminalHostFor?: (id: number) => (el: HTMLDivElement | null) => void;
  children: ReactNode;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const colRef = useRef<HTMLDivElement>(null);

  const showContent = panes.content;
  const showRight = panes.agent || panes.terminal;
  const bothExpanded = panes.agent && panes.terminal && !agentCollapsed && !terminalCollapsed;

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

  /* the horizontal splitter between agent and terminal — same anatomy as the
   * vertical one, persisted per project by the wiring */
  const onHSplitterDown = useCallback(
    (down: React.PointerEvent<HTMLDivElement>) => {
      down.preventDefault();
      const el = down.currentTarget;
      el.setPointerCapture(down.pointerId);
      const col = colRef.current;
      if (!col) return;
      const onMove = (e: PointerEvent) => {
        const rect = col.getBoundingClientRect();
        const pct = ((e.clientY - rect.top) / rect.height) * 100;
        onHSplitPct(Math.min(80, Math.max(20, pct)));
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
    [onHSplitPct],
  );

  return (
    <div className="flex h-full flex-col bg-surface-app font-sans text-text-primary">
      <TitleBar
        tabs={tabs}
        activeDir={activeDir}
        checkedAt={checkedAt}
        update={update}
        degraded={degraded}
        panes={panes}
        onTogglePane={onTogglePane}
        onSwitch={onSwitch}
        onClose={onClose}
        onAdd={onAdd}
        onHome={onHome}
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
        {showContent && (
          <div
            className="flex min-w-0 flex-col overflow-hidden"
            style={
              showRight
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
        )}
        {showContent && showRight && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize the right column"
            onPointerDown={onSplitterDown}
            className="flex w-[7px] shrink-0 cursor-col-resize items-center justify-center hover:bg-fill-hover"
          >
            <span className="h-[34px] w-0.5 rounded-[1px] bg-border-strong" />
          </div>
        )}
        {showRight && (
          <div
            ref={colRef}
            data-right-column
            className="flex min-w-0 flex-1 flex-col overflow-hidden border-l border-divider"
            style={showContent ? { minWidth: 240 } : undefined}
          >
            {panes.agent &&
              (agentCollapsed ? (
                <AgentSection
                  collapsed
                  onToggleCollapsed={onToggleAgentCollapsed}
                  stateWord={agentStateWord}
                  stateKind={agentStateKind}
                />
              ) : (
                <div
                  className="flex min-h-0 flex-col"
                  style={{
                    flex:
                      panes.terminal && !terminalCollapsed
                        ? `${hSplitPct} 1 0%`
                        : "1 1 0%",
                  }}
                >
                  <AgentSection
                    collapsed={false}
                    onToggleCollapsed={onToggleAgentCollapsed}
                    stateWord={agentStateWord}
                    stateKind={agentStateKind}
                  >
                    {agentBody}
                  </AgentSection>
                </div>
              ))}
            {/* both sections collapsed: the strips pin top and bottom */}
            {panes.agent && agentCollapsed && panes.terminal && terminalCollapsed && (
              <div className="flex-1" />
            )}
            {bothExpanded && (
              <div
                role="separator"
                aria-orientation="horizontal"
                aria-label="Resize the agent and terminal sections"
                onPointerDown={onHSplitterDown}
                className="flex h-[7px] shrink-0 cursor-row-resize items-center justify-center border-t border-divider hover:bg-fill-hover"
              >
                <span className="h-0.5 w-[34px] rounded-[1px] bg-border-strong" />
              </div>
            )}
            {panes.terminal &&
              (terminalCollapsed ? (
                <TerminalColumn
                  collapsed
                  onToggleCollapsed={onToggleTerminalCollapsed}
                  tabs={terminalTabs}
                  activeId={null}
                  onNewTerminal={onNewTerminal}
                  onStartAgent={onStartAgent}
                />
              ) : (
                <div
                  className="flex min-h-0 flex-col"
                  style={{
                    flex:
                      panes.agent && !agentCollapsed
                        ? `${100 - hSplitPct} 1 0%`
                        : "1 1 0%",
                  }}
                >
                  <TerminalColumn
                    tabs={terminalTabs}
                    activeId={activeTerminalId ?? terminalTabs[0]?.id ?? null}
                    onNewTerminal={onNewTerminal}
                    onStartAgent={onStartAgent}
                    spawning={terminalSpawning}
                    onSelect={onTerminalSelect}
                    onClose={onTerminalClose}
                    onRenameCommit={onTerminalRenameCommit}
                    hostFor={terminalHostFor}
                    onToggleCollapsed={onToggleTerminalCollapsed}
                  />
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}
