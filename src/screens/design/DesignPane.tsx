/* The Design pane (comps board 1): designs on the left, the canvas in the middle,
   the design session's thread on the right. With no designs, the new-design screen
   (board 2) takes the canvas and thread's place. */
import { useEffect, useState } from "react";
import type { ConfirmSpec } from "@/overlays/ConfirmDialog";
import { designProjectFor, loadDesigns, subscribeDesigns } from "@/lib/design-store";
import { NewDesign } from "./NewDesign";

export function DesignPane({ dir, onScreen: _onScreen, onConfirm: _onConfirm }: { dir: string; onScreen: boolean; onConfirm: (spec: ConfirmSpec) => void }) {
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
  return (
    <div data-chrome className="flex h-full min-w-0 flex-1">
      <aside className="flex w-[248px] shrink-0 flex-col border-r border-border-hairline">
        <div className="flex h-10 items-center border-b border-border-hairline px-3.5 text-[10px] uppercase tracking-[0.09em] text-text-faint">Designs</div>
        {empty && (
          <p className="px-3.5 py-3.5 text-[11.5px] leading-relaxed text-text-faint">
            No designs yet. Anything you make lands here, saved in <span className="font-mono text-[10.5px]">.chronicle/designs/</span>.
          </p>
        )}
      </aside>
      {empty || creating ? <NewDesign dir={dir} onDone={() => setCreating(false)} /> : <div className="flex-1" />}
    </div>
  );
}
