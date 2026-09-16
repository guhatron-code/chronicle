/*
 * The persistent shell (Deck 2 composite, amended by Deck 7 F31): title bar /
 * rail · content · splitter · the right column stacking AGENT over TERMINAL
 * with a horizontal splitter — ONE flat surface, hairline dividers only (the
 * de-boxing law). Each unit (content · agent · terminal) can be shown or
 * hidden via the title-bar cluster — all three at max, exactly one at min;
 * visibility persists per project. SUPERSEDED and retired here: the old
 * "terminal column is absent on Notes (full-bleed)" rule — the right column
 * may sit beside any content pane; the toggles are how full-bleed happens now.
 * Hiding a unit never kills sessions (they live outside React, like hidden
 * terminal tabs always have).
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Rail, type Pane } from "@/components/chrome/Rail";
import { TitleBar, type ProjectTab, type UpdateLineProps } from "@/components/chrome/TitleBar";
import type { PaneUnit, PaneVisibility } from "@/components/chrome/PaneCluster";
import {
  TerminalColumn,
  type TerminalAgent,
  type TerminalTab,
} from "@/components/chrome/TerminalColumn";
import { AgentSection } from "@/screens/agent/AgentSection";
import { focusActiveTerm, shouldReclaimTerminalFocus } from "@/lib/term-sessions";
import { agentSessionFor, sendAgentMessage, subscribeAgent } from "@/lib/agent-session";
import { limitsReading, subscribeLimits } from "@/lib/limits-store";
import { toastError } from "@/overlays/toasts";
import type { ConfirmSpec } from "@/overlays/ConfirmDialog";

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
  onConfirm,
  onSwitch,
  onClose,
  onAdd,
  onHome,
  onRefresh,
  onHelp,
  onSetup,
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
  update?: UpdateLineProps | null;
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
  /** The agent pane body — thread + composer (Z-2b). */
  agentBody?: ReactNode;
  /** confirm sheet dispatcher (End session mid-turn, Works freely, …) */
  onConfirm: (spec: ConfirmSpec) => void;
  onSwitch: (dir: string) => void;
  onClose: (dir: string) => void;
  onAdd: () => void;
  onHome?: () => void;
  onRefresh: () => void;
  onHelp: () => void;
  onSetup?: () => void;
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
  // Round 9 — the limits chip: one global reading, this project's session cost
  const [, bump] = useState(0);
  useEffect(() => subscribeLimits(() => bump((n) => n + 1)), []);
  useEffect(() => subscribeAgent(() => bump((n) => n + 1)), []);
  const limits = limitsReading();
  const agent = agentSessionFor(activeDir);
  const refreshLimits = useCallback(() => {
    void sendAgentMessage(activeDir, "/usage").catch((e) => toastError("Couldn't ask for usage", String(e).slice(0, 90)));
  }, [activeDir]);
  const rowRef = useRef<HTMLDivElement>(null);
  const colRef = useRef<HTMLDivElement>(null);

  const showContent = panes.content;
  const showRight = panes.agent || panes.terminal;
  const bothExpanded = panes.agent && panes.terminal && !agentCollapsed && !terminalCollapsed;

  /* ---- the terminal takes the keyboard ----
     Nothing used to focus an xterm, so the first keystroke after coming back to
     the window, or after picking a tab, went nowhere. Four moments hand the
     keyboard over: the window regaining focus; the column expanding; a session
     appearing (every spawn — ⌘T, the column's buttons, a roadmap Start, a
     round run in a terminal — makes itself active); and a tab pick. The middle two both show
     up as a dep change below, so the effect covers them; a pick needs its own
     handler because re-clicking the tab that is already active changes no state
     at all. Every one of them is gated by shouldReclaimTerminalFocus, so the
     keyboard is never taken out of a field, an editor or a dialog. */
  const terminalOpen = panes.terminal && !terminalCollapsed;
  const dirRef = useRef(activeDir);
  const collapsedRef = useRef(!terminalOpen);
  /* layout, not passive: a window focus event can land between the commit and a
     passive flush, and the listener below would read the previous project's dir
     or the previous collapsed state */
  useLayoutEffect(() => {
    dirRef.current = activeDir;
    collapsedRef.current = !terminalOpen;
  });

  /* One frame, because the tab that just became active mounts its host in this
     commit and xterm cannot focus a textarea that is not in the document yet —
     and the predicate is re-asked at the far end of that frame, not before it:
     a double-click on a tab fires two clicks and then raises the rename chip,
     whose autofocused input must keep the keyboard. Returns the handle so an
     effect can cancel it. */
  const focusSoon = useCallback((dir: string) => {
    return requestAnimationFrame(() => {
      // collapsedRef, not `false`: the column can be collapsed inside the frame
      // this was scheduled in, and a hidden terminal must not take the keyboard
      if (!shouldReclaimTerminalFocus(document.activeElement, { collapsed: collapsedRef.current })) return;
      focusActiveTerm(dir);
    });
  }, []);

  const selectTerminal = useCallback(
    (id: number) => {
      onTerminalSelect?.(id);
      focusSoon(activeDir);
    },
    [activeDir, focusSoon, onTerminalSelect],
  );

  /* Registered once, reading the live dir/collapsed through refs — re-binding it
     every render would be a listener churn for nothing. Judged synchronously, on
     purpose: a click that raised the window focuses its own target immediately
     after this runs, so clicking into a field still wins. */
  useEffect(() => {
    const onWindowFocus = () => {
      // false while the Web pane's native WKWebView is first responder — the
      // keyboard is already somewhere real, and App.tsx's menu-key path relies
      // on that split (it blurs the stale DOM focus itself)
      if (!document.hasFocus()) return;
      if (!shouldReclaimTerminalFocus(document.activeElement, { collapsed: collapsedRef.current })) return;
      focusActiveTerm(dirRef.current);
    };
    window.addEventListener("focus", onWindowFocus);
    return () => window.removeEventListener("focus", onWindowFocus);
  }, []);

  /* the column expanding (terminalOpen), a spawn or a tab close (the active id
     moves), a project switch, or the mount itself. focusSoon's predicate
     decides, so none of them can interrupt typing; on mount with no sessions
     yet it is a no-op anyway. */
  useEffect(() => {
    if (!terminalOpen) return;
    const raf = focusSoon(activeDir);
    return () => cancelAnimationFrame(raf);
  }, [activeDir, activeTerminalId, focusSoon, terminalOpen]);

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
        limits={limits}
        sessionCost={agent.cost}
        onRefreshLimits={agent.phase === "ready" && !agent.turnActive ? refreshLimits : null}
        update={update}
        degraded={degraded}
        panes={panes}
        onTogglePane={onTogglePane}
        onSwitch={onSwitch}
        onClose={onClose}
        onAdd={onAdd}
        onHome={onHome}
        onHelp={onHelp}
      />
      <div ref={rowRef} className="flex min-h-0 flex-1">
        <Rail
          pane={pane}
          onPane={onPane}
          queuedCount={queuedCount}
          checking={checking}
          onRefresh={onRefresh}
          onSetup={onSetup}
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
                  dir={activeDir}
                  collapsed
                  onToggleCollapsed={onToggleAgentCollapsed}
                  onConfirm={onConfirm}
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
                    dir={activeDir}
                    collapsed={false}
                    onToggleCollapsed={onToggleAgentCollapsed}
                    onConfirm={onConfirm}
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
                    onSelect={selectTerminal}
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
