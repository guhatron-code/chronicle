/*
 * F9 — the keyboard shortcuts overlay (⌘/). Same anatomy as the palette; two-column
 * groups Projects / Panes / Terminal with kbd chips.
 */
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Eyebrow, Kbd } from "@/components/chrome/atoms";

const GROUPS: { title: string; col: 0 | 1; rows: [string, string][] }[] = [
  {
    title: "Projects",
    col: 0,
    rows: [
      ["Switch to project 1–9", "⌘1–9"],
      ["Palette / switcher", "⌘K"],
      ["Open a project", "⌘O"],
      ["Close project", "⌘W"],
    ],
  },
  {
    title: "Panes",
    col: 1,
    rows: [
      ["Cycle Roadmap · Repo · Kanban", "⌘J"],
      ["Jump between panes", "ctrl-tab"],
    ],
  },
  {
    title: "Terminal",
    col: 1,
    rows: [
      ["New terminal", "⌘T"],
      ["Focus the terminal", "⌘L"],
    ],
  },
];

export function ShortcutsOverlay({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="max-w-[560px] gap-0 overflow-hidden rounded-xl border-border-strong bg-surface-overlay p-0 shadow-(--shadow-overlay)"
      >
        <div className="flex items-center justify-between border-b border-divider px-4 py-3.5">
          <DialogTitle className="text-[15px] font-semibold text-text-primary">
            Keyboard shortcuts
          </DialogTitle>
          <Kbd>esc</Kbd>
        </div>
        <div className="grid grid-cols-2 gap-x-7 px-4 pb-4 pt-2.5">
          {[0, 1].map((col) => (
            <div key={col}>
              {GROUPS.filter((g) => g.col === col).map((g) => (
                <div key={g.title}>
                  <div className="pb-1.5 pt-2.5">
                    <Eyebrow>{g.title}</Eyebrow>
                  </div>
                  {g.rows.map(([label, key]) => (
                    <div key={key} className="flex items-center justify-between py-1.5">
                      <span className="text-[12.5px] text-text-secondary">{label}</span>
                      <Kbd className="px-1.5 text-text-muted">{key}</Kbd>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
