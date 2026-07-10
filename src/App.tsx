/*
 * C1 — the picker surface + overlays (F1–F9), composed per L6.
 * Data is the deck's specimen set until the C1 wiring step replaces it with
 * get_picker; window controls are live (proven in Phase A/R1).
 */
import { useEffect, useState } from "react";
import { Picker } from "@/screens/Picker";
import type { RecentProject } from "@/screens/RecentCard";
import { CommandPalette, type PaletteProject } from "@/overlays/CommandPalette";
import { ConfirmDialog, type ConfirmSpec } from "@/overlays/ConfirmDialog";
import { NewProjectDialog } from "@/overlays/NewProjectDialog";
import { ShortcutsOverlay } from "@/overlays/ShortcutsOverlay";
import { ChronicleToaster, toastSuccess, toastError } from "@/overlays/toasts";
import { windowControls, pickFolder } from "@/lib/ipc";

/* Deck-1 specimen data — replaced by get_picker at the C1 wiring step. */
const SPECIMEN_RECENTS: RecentProject[] = [
  {
    path: "/dev/lumen-site",
    name: "lumen-site",
    tildePath: "~/dev/lumen-site",
    description: "Marketing site for the Lumen launch — five pages, static, shipped from this folder.",
    mark: 3,
    markLabel: "lu",
    ago: "2h ago",
    variant: {
      kind: "phase",
      phaseId: "R-1",
      phaseName: "Missing screens get drawn",
      statusWord: "in design",
      progress: 0.45,
      waiting: 3,
    },
  },
  {
    path: "/dev/field-notes",
    name: "field-notes",
    tildePath: "~/dev/field-notes",
    description: "Plain-file notes app. Sync is boring on purpose.",
    mark: 5,
    markLabel: "fn",
    ago: "20m ago",
    variant: {
      kind: "phase",
      phaseId: "P-4",
      phaseName: "Sync engine hardening",
      statusWord: "running",
      running: true,
      progress: 0.78,
      waiting: 1,
    },
  },
  {
    path: "/dev/tidepool",
    name: "tidepool",
    tildePath: "~/dev/tidepool",
    description: "Weather widget for the studio wall display.",
    mark: 4,
    markLabel: "tp",
    ago: "3d ago",
    variant: { kind: "all-done" },
  },
  {
    path: "/code/sparrow",
    name: "sparrow",
    tildePath: "~/code/sparrow",
    description: "A folder with code in it — Chronicle hasn't written a plan for it yet.",
    mark: 6,
    markLabel: "sp",
    ago: "1w ago",
    variant: { kind: "no-roadmap", agent: "Claude" },
  },
];

const SPECIMEN_PALETTE: PaletteProject[] = [
  { path: "/dev/lumen-site", name: "lumen-site", tildePath: "~/dev/lumen-site", mark: 3, markLabel: "lu", statusWord: "in design", statusKind: "neutral" },
  { path: "/dev/field-notes", name: "field-notes", tildePath: "~/dev/field-notes", mark: 5, markLabel: "fn", statusWord: "running", statusKind: "running" },
];
const SPECIMEN_PALETTE_RECENTS: PaletteProject[] = [
  { path: "/dev/tidepool", name: "tidepool", tildePath: "~/dev/tidepool", mark: 4, markLabel: "tp", statusWord: "done", statusKind: "success" },
];

export default function App() {
  const [recents] = useState<RecentProject[]>(SPECIMEN_RECENTS);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [newProjOpen, setNewProjOpen] = useState(false);
  const [newProjError, setNewProjError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmSpec | null>(null);

  const openDialog = () => {
    setPaletteOpen(false);
    void pickFolder();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === "k") { e.preventDefault(); setPaletteOpen((o) => !o); }
      else if (mod && e.key === "o") { e.preventDefault(); openDialog(); }
      else if (mod && e.key === "/") { e.preventDefault(); setShortcutsOpen(true); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Dev-only handle so the cleanroom harness can reach every overlay state.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as never as Record<string, unknown>).__c1 = {
      palette: setPaletteOpen,
      shortcuts: setShortcutsOpen,
      newProject: (err: string | null) => { setNewProjError(err); setNewProjOpen(true); },
      confirm: setConfirm,
      toastSuccess,
      toastError,
    };
  }, []);

  return (
    <div className="flex h-full flex-col bg-surface-app font-sans text-text-primary">
      {/* 44px title bar — the drag region; picker shows only the window controls.
          windowControls() is called lazily — render must not touch Tauri internals. */}
      <div data-tauri-drag-region className="flex h-11 shrink-0 items-center gap-2 px-4">
        <button aria-label="Close window" onClick={() => void windowControls().close()}
          className="size-3 rounded-full border border-border-strong bg-fill-hover" />
        <button aria-label="Minimize window" onClick={() => void windowControls().minimize()}
          className="size-3 rounded-full border border-border-strong bg-fill-hover" />
        <button aria-label="Zoom window" onClick={() => void windowControls().toggleMaximize()}
          className="size-3 rounded-full border border-border-strong bg-fill-hover" />
      </div>

      <div className="min-h-0 flex-1">
        <Picker
          recents={recents}
          onOpenDialog={openDialog}
          onNewProject={() => { setNewProjError(null); setNewProjOpen(true); }}
          onOpenProject={() => {/* C1 wiring: open_project */}}
          onRemoveRecent={(path) => {
            const name = recents.find((r) => r.path === path)?.name ?? "project";
            setConfirm({
              title: `Remove ${name} from recents?`,
              body: "Removes it from this list — the folder itself isn't touched.",
              cancelLabel: "Keep it",
              confirmLabel: "Remove from recents",
              danger: true,
              onConfirm: () => {/* C1 wiring: remove_recent */},
            });
          }}
          onLocate={() => void pickFolder()}
        />
      </div>

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        openProjects={SPECIMEN_PALETTE}
        recents={SPECIMEN_PALETTE_RECENTS}
        onSwitch={() => setPaletteOpen(false)}
        onOpenRecent={() => setPaletteOpen(false)}
        onOpenDialog={openDialog}
        onNewProject={() => { setPaletteOpen(false); setNewProjError(null); setNewProjOpen(true); }}
      />
      <ConfirmDialog spec={confirm} onClose={() => setConfirm(null)} />
      <NewProjectDialog
        open={newProjOpen}
        onOpenChange={setNewProjOpen}
        error={newProjError}
        onCreate={() => {/* C1 wiring: create_project */}}
        basePath="~/Documents"
      />
      <ShortcutsOverlay open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
      <ChronicleToaster />
    </div>
  );
}
