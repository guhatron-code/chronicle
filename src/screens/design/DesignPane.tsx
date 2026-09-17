/* The Design pane (comps board 1): designs on the left, the canvas in the middle,
   the design session's thread on the right. With no designs, the new-design screen
   (board 2) takes the canvas and thread's place. */
import { useEffect, useState } from "react";
import type { ConfirmSpec } from "@/overlays/ConfirmDialog";
import { designProjectFor, loadDesigns, openDesign, setCompare, subscribeDesigns } from "@/lib/design-store";
import { CanvasToolbar } from "./CanvasToolbar";
import { DesignCanvas } from "./DesignCanvas";
import { DesignSidebar } from "./DesignSidebar";
import { DesignThread } from "./DesignThread";
import { HistoryPanel } from "./HistoryPanel";
import { NewDesign } from "./NewDesign";

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
  useEffect(() => {
    if (!historyOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closeHistory(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyOpen, dir]);
  const empty = p.rows.length === 0;
  // Nothing open yet: open the first design in the list.
  const first = p.rows[0]?.slug;
  useEffect(() => { if (!p.active && first) void openDesign(dir, first); }, [dir, p.active, first]);
  // Switching designs (a different p.active) leaves any open History pointed at
  // the wrong design's versions — close it, the same as the button or Esc.
  useEffect(() => {
    closeHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dir, p.active]);
  return (
    <div data-chrome className="flex h-full min-w-0 flex-1">
      <DesignSidebar dir={dir} onNew={() => setCreating(true)} />
      {empty || creating ? (
        <NewDesign dir={dir} onDone={() => setCreating(false)} />
      ) : p.active ? (
        <div className="flex min-w-0 flex-1 flex-col">
          <CanvasToolbar dir={dir} historyOpen={historyOpen} onToggleHistory={() => (historyOpen ? closeHistory() : setHistoryOpen(true))} />
          {/* keyed by design: each design starts with its own viewport, selection and live frame */}
          <DesignCanvas key={p.active} dir={dir} onScreen={onScreen} />
        </div>
      ) : (
        <div className="flex-1" />
      )}
      {!(empty || creating) && p.active && (
        historyOpen
          ? <HistoryPanel dir={dir} onClose={closeHistory} />
          : <DesignThread dir={dir} onConfirm={onConfirm} onRevealTerminal={onRevealTerminal} />
      )}
    </div>
  );
}
