/* The Design pane (comps board 1): designs on the left, the canvas in the middle,
   the design session's thread on the right. With no designs, the new-design screen
   (board 2) takes the canvas and thread's place. */
import { useEffect, useState } from "react";
import type { ConfirmSpec } from "@/overlays/ConfirmDialog";
import { designProjectFor, loadDesigns, openDesign, redoDesign, setCompare, setScoreOpen, subscribeDesigns, undoDesign } from "@/lib/design-store";
import { CanvasToolbar } from "./CanvasToolbar";
import { DesignCanvas } from "./DesignCanvas";
import { DesignSidebar } from "./DesignSidebar";
import { DesignThread } from "./DesignThread";
import { HistoryPanel } from "./HistoryPanel";
import { NewDesign } from "./NewDesign";
import { Scorecard } from "./Scorecard";

export function DesignPane({ dir, onScreen, onConfirm, onRevealTerminal }: {
  dir: string;
  onScreen: boolean;
  onConfirm: (spec: ConfirmSpec) => void;
  /** the design session's sign-in runs in a terminal tab — bring the terminal on screen */
  onRevealTerminal: () => void;
}) {
  const [, bump] = useState(0);
  useEffect(() => subscribeDesigns(() => bump((n) => n + 1)), []);
  useEffect(() => { void loadDesigns(dir); }, [dir]);
  const p = designProjectFor(dir);
  const [creating, setCreating] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  // Closing History (the button, Esc, or switching designs) always clears the
  // compare selection too — a stale compare would otherwise draw a broken split
  // the next time History reopens, or reference a version from another design.
  const closeHistory = () => { setHistoryOpen(false); setCompare(dir, null); };
  useEffect(() => {
    const on = () => setCreating(true);
    window.addEventListener("chronicle:new-design", on);
    return () => window.removeEventListener("chronicle:new-design", on);
  }, []);
  // The scorecard, History and the thread share the right column: opening one closes the other.
  const openHistory = () => { setScoreOpen(dir, false); setHistoryOpen(true); };
  const toggleScore = () => { if (p.scoreOpen) setScoreOpen(dir, false); else { closeHistory(); setScoreOpen(dir, true); } };
  useEffect(() => {
    if (!historyOpen && !p.scoreOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (historyOpen) closeHistory(); else setScoreOpen(dir, false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyOpen, p.scoreOpen, dir]);
  // ⌘Z anywhere in the pane, not only on the canvas: a restore starts from the
  // History panel, and the undo that follows it has to work with the focus still
  // on that button. The canvas's own handler claims the chord first (it calls
  // preventDefault), so this never doubles it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || !(e.metaKey || e.ctrlKey) || e.altKey) return;
      if (e.key.toLowerCase() !== "z") return;
      const el = e.target as HTMLElement | null;
      if (el?.tagName === "INPUT" || el?.tagName === "TEXTAREA" || el?.isContentEditable) return;
      e.preventDefault();
      void (e.shiftKey ? redoDesign(dir) : undoDesign(dir));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dir]);
  const empty = p.rows.length === 0;
  // Nothing open yet: open the first design in the list.
  const first = p.rows[0]?.slug;
  useEffect(() => { if (!p.active && first) void openDesign(dir, first); }, [dir, p.active, first]);
  // Switching designs (a different p.active) leaves any open History pointed at
  // the wrong design's versions — close it, the same as the button or Esc.
  useEffect(() => {
    closeHistory();
    setScoreOpen(dir, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dir, p.active]);
  return (
    <div data-chrome className="flex h-full min-w-0 flex-1">
      <DesignSidebar dir={dir} onNew={() => setCreating(true)} />
      {empty || creating ? (
        <NewDesign dir={dir} onDone={() => setCreating(false)} />
      ) : p.active ? (
        <div className="flex min-w-[240px] flex-1 flex-col">
          <CanvasToolbar dir={dir} historyOpen={historyOpen} onToggleHistory={() => (historyOpen ? closeHistory() : openHistory())} scoreOpen={p.scoreOpen} onToggleScore={toggleScore} />
          {/* keyed by design: each design starts with its own viewport, selection and live frame */}
          <DesignCanvas key={p.active} dir={dir} onScreen={onScreen} />
        </div>
      ) : (
        <div className="flex-1" />
      )}
      {!(empty || creating) && p.active && (
        p.scoreOpen
          ? <Scorecard dir={dir} onClose={() => setScoreOpen(dir, false)} />
          : historyOpen
            ? <HistoryPanel dir={dir} onClose={closeHistory} />
            : <DesignThread dir={dir} onConfirm={onConfirm} onRevealTerminal={onRevealTerminal} />
      )}
    </div>
  );
}
