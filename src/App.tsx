/*
 * C1 wired — the picker + overlays on live IPC (get_picker · open_project ·
 * remove_recent · create_project · pickFolder · agents_available). Opening a
 * project lands on a blank held surface until C2 builds the shell.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Picker } from "@/screens/Picker";
import type { RecentProject } from "@/screens/RecentCard";
import { CommandPalette, type PaletteProject } from "@/overlays/CommandPalette";
import { ConfirmDialog, type ConfirmSpec } from "@/overlays/ConfirmDialog";
import { NewProjectDialog } from "@/overlays/NewProjectDialog";
import { ShortcutsOverlay } from "@/overlays/ShortcutsOverlay";
import { ChronicleToaster, toastSuccess, toastError } from "@/overlays/toasts";
import {
  agentsAvailable,
  createProject,
  getPicker,
  openProject,
  pickFolder,
  removeRecent,
  windowControls,
  type PickerRecent,
} from "@/lib/ipc";
import { toPaletteProject, toRecentProject, tildify } from "@/lib/picker-data";

export default function App() {
  const [rows, setRows] = useState<PickerRecent[]>([]);
  const [agent, setAgent] = useState("Claude");
  const [openDir, setOpenDir] = useState<string | null>(null); // C2 replaces with the shell
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [newProjOpen, setNewProjOpen] = useState(false);
  const [newProjError, setNewProjError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmSpec | null>(null);
  const devPreset = useRef<RecentProject[] | null>(null);
  const [, bump] = useState(0);

  const refresh = useCallback(() => {
    getPicker()
      .then((d) => setRows(d.recents ?? []))
      .catch(() => {/* picker data is best-effort; the empty state renders */});
  }, []);

  useEffect(() => {
    refresh();
    agentsAvailable()
      .then((a) => {
        const d = (a as { default?: string } | null)?.default;
        if (d) setAgent(d === "codex" ? "Codex" : "Claude");
      })
      .catch(() => {});
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  const doOpenProject = useCallback((path: string) => {
    openProject(path)
      .then((p) => {
        const dir = (p as { dir?: string } | null)?.dir ?? path;
        setOpenDir(dir);
        setPaletteOpen(false);
        refresh();
      })
      .catch((e) =>
        toastError("Couldn't open the project", String(e).split("\n")[0].slice(0, 90)),
      );
  }, [refresh]);

  const openDialog = useCallback(() => {
    setPaletteOpen(false);
    pickFolder()
      .then((sel) => {
        if (typeof sel === "string" && sel) doOpenProject(sel);
      })
      .catch(() => {});
  }, [doOpenProject]);

  const doRemoveRecent = useCallback((path: string, name: string) => {
    setConfirm({
      title: `Remove ${name} from recents?`,
      body: "Removes it from this list — the folder itself isn't touched.",
      cancelLabel: "Keep it",
      confirmLabel: "Remove from recents",
      danger: true,
      onConfirm: () => {
        removeRecent(path)
          .then(refresh)
          .catch((e) => toastError("Couldn't remove it", String(e).slice(0, 90)));
      },
    });
  }, [refresh]);

  const doCreate = useCallback((name: string) => {
    createProject(name)
      .then((dir) => {
        setNewProjOpen(false);
        setNewProjError(null);
        doOpenProject(dir);
      })
      .catch((e) => {
        const msg = String(e);
        setNewProjError(
          /already exists/i.test(msg)
            ? "A folder with this name already exists. Pick another name, or open the existing folder."
            : msg.slice(0, 120),
        );
      });
  }, [doOpenProject]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === "k") { e.preventDefault(); setPaletteOpen((o) => !o); }
      else if (mod && e.key === "o") { e.preventDefault(); openDialog(); }
      else if (mod && e.key === "/") { e.preventDefault(); setShortcutsOpen(true); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openDialog]);

  // Dev-only handle so the cleanroom harness can reach every state.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const presets: Record<string, RecentProject[] | null> = {
      default: null,
      empty: [],
      missing: [{
        path: "/tmp/x", name: "lumen-site", tildePath: "~/dev/lumen-site", mark: 3,
        markLabel: "lu", ago: "2h ago", variant: { kind: "missing" },
      }],
      writing: [{
        path: "/tmp/y", name: "sparrow", tildePath: "~/code/sparrow", mark: 6,
        markLabel: "sp", ago: "1w ago", variant: { kind: "writing" },
      }],
    };
    (window as never as Record<string, unknown>).__c1 = {
      recentsPreset: (name: string) => { devPreset.current = presets[name] ?? null; bump((n) => n + 1); },
      palette: setPaletteOpen,
      shortcuts: setShortcutsOpen,
      newProject: (err: string | null) => { setNewProjError(err); setNewProjOpen(true); },
      confirm: setConfirm,
      toastSuccess,
      toastError,
    };
  }, []);

  const recents: RecentProject[] =
    devPreset.current ?? rows.map((r) => toRecentProject(r, { agent }));
  const paletteRecents: PaletteProject[] = rows
    .filter((r) => r.path !== openDir)
    .map((r) => toPaletteProject(r));

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
        {openDir ? (
          /* C2 builds the shell here; the held surface is deliberately blank. */
          <div className="flex h-full items-center justify-center">
            <span className="font-mono text-[11.5px] text-text-dim">
              {tildify(openDir)} — the project shell arrives with slice C2.
            </span>
          </div>
        ) : (
          <Picker
            recents={recents}
            onOpenDialog={openDialog}
            onNewProject={() => { setNewProjError(null); setNewProjOpen(true); }}
            onOpenProject={doOpenProject}
            onRemoveRecent={(path) => {
              const name = rows.find((r) => r.path === path)?.name ?? "this project";
              doRemoveRecent(path, name);
            }}
            onLocate={openDialog}
          />
        )}
      </div>

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        openProjects={[]}
        recents={paletteRecents}
        onSwitch={doOpenProject}
        onOpenRecent={doOpenProject}
        onOpenDialog={openDialog}
        onNewProject={() => { setPaletteOpen(false); setNewProjError(null); setNewProjOpen(true); }}
      />
      <ConfirmDialog spec={confirm} onClose={() => setConfirm(null)} />
      <NewProjectDialog
        open={newProjOpen}
        onOpenChange={setNewProjOpen}
        error={newProjError}
        onCreate={doCreate}
        onClearError={() => setNewProjError(null)}
        basePath="~/Documents"
      />
      <ShortcutsOverlay open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
      <ChronicleToaster />
    </div>
  );
}
