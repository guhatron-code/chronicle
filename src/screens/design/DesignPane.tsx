/* The Design pane (comps board 1): designs on the left, the canvas in the middle,
   the design session's thread on the right. With no designs, the new-design screen
   (board 2) takes the canvas and thread's place. */
import { useEffect, useState } from "react";
import type { ConfirmSpec } from "@/overlays/ConfirmDialog";
import { designProjectFor, loadDesigns, openDesign, subscribeDesigns } from "@/lib/design-store";
import { CanvasToolbar } from "./CanvasToolbar";
import { DesignCanvas } from "./DesignCanvas";
import { DesignSidebar } from "./DesignSidebar";
import { DesignThread } from "./DesignThread";
import { NewDesign } from "./NewDesign";

export function DesignPane({ dir, onScreen, onConfirm }: { dir: string; onScreen: boolean; onConfirm: (spec: ConfirmSpec) => void }) {
  const [, bump] = useState(0);
  useEffect(() => subscribeDesigns(() => bump((n) => n + 1)), []);
  useEffect(() => { void loadDesigns(dir); }, [dir]);
  const p = designProjectFor(dir);
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    const on = () => setCreating(true);
    window.addEventListener("chronicle:new-design", on);
    return () => window.removeEventListener("chronicle:new-design", on);
  }, []);
  const empty = p.rows.length === 0;
  // Nothing open yet: open the first design in the list.
  const first = p.rows[0]?.slug;
  useEffect(() => { if (!p.active && first) void openDesign(dir, first); }, [dir, p.active, first]);
  return (
    <div data-chrome className="flex h-full min-w-0 flex-1">
      <DesignSidebar dir={dir} onNew={() => setCreating(true)} />
      {empty || creating ? (
        <NewDesign dir={dir} onDone={() => setCreating(false)} />
      ) : p.active ? (
        <div className="flex min-w-0 flex-1 flex-col">
          <CanvasToolbar dir={dir} />
          {/* keyed by design: each design starts with its own viewport, selection and live frame */}
          <DesignCanvas key={p.active} dir={dir} onScreen={onScreen} />
        </div>
      ) : (
        <div className="flex-1" />
      )}
      {!(empty || creating) && p.active && <DesignThread dir={dir} onConfirm={onConfirm} />}
    </div>
  );
}
