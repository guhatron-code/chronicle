/*
 * The app root: picker (no project open) ⇄ the persistent shell. C2 wires the
 * project tabs, the 8s ground-truth poll, the keyboard map, and the per-project
 * splitter. The content panes (roadmap/repo/kanban) land in C3–C5; the live
 * terminal in C6.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Picker } from "@/screens/Picker";
import { Shell } from "@/screens/Shell";
import type { Pane } from "@/components/chrome/Rail";
import type { ProjectTab } from "@/components/chrome/TitleBar";
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
  getState,
  openProject,
  pickFolder,
  removeRecent,
  windowControls,
  type PickerRecent,
} from "@/lib/ipc";
import { markFor, toPaletteProject, toRecentProject } from "@/lib/picker-data";

/** The slice of get_state the shell chrome consumes (refined in C3 for the panes). */
interface ShellState {
  checked_at?: string;
  manifest_present?: boolean;
  statuses?: { id: string; state: string; label: string }[];
}

interface ProjectEntry {
  dir: string;
  name: string;
  state: ShellState | null;
  updated: boolean; // finished/changed while in the background
  updatedHint?: string;
  prevNowId?: string;
}

const PANES: Pane[] = ["road", "repo", "kanban"];
const splitKey = (dir: string) => `chronicle.split.${dir}`;

export default function App() {
  const [rows, setRows] = useState<PickerRecent[]>([]);
  const [agent, setAgent] = useState("Claude");
  const [projects, setProjects] = useState<Map<string, ProjectEntry>>(new Map());
  const [activeDir, setActiveDir] = useState<string | null>(null);
  const [pane, setPane] = useState<Pane>("road");
  const [checking, setChecking] = useState(false);
  const [splitPct, setSplitPct] = useState(55.5);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [newProjOpen, setNewProjOpen] = useState(false);
  const [newProjError, setNewProjError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmSpec | null>(null);
  const devPreset = useRef<RecentProject[] | null>(null);
  const [, bump] = useState(0);
  const projectsRef = useRef(projects);
  projectsRef.current = projects;
  const activeRef = useRef(activeDir);
  activeRef.current = activeDir;

  const refreshPicker = useCallback(() => {
    getPicker()
      .then((d) => setRows(d.recents ?? []))
      .catch(() => {});
  }, []);

  /* ---- the ground-truth poll: every open project, every 8s ---- */
  const pollOne = useCallback(async (dir: string) => {
    try {
      const s = (await getState(dir)) as ShellState;
      setProjects((prev) => {
        const next = new Map(prev);
        const e = next.get(dir);
        if (!e) return prev;
        const nowId = s.statuses?.find((x) => x.state === "now")?.id;
        const changed = e.prevNowId !== undefined && nowId !== e.prevNowId;
        next.set(dir, {
          ...e,
          state: s,
          prevNowId: nowId,
          updated: e.updated || (changed && dir !== activeRef.current),
          updatedHint: changed ? `${e.name} moved to ${nowId ?? "done"}` : e.updatedHint,
        });
        return next;
      });
    } catch {
      /* transient failures keep the last-known state (honesty: checked_at stays old) */
    }
  }, []);

  useEffect(() => {
    if (projects.size === 0) return;
    const tick = () => { for (const dir of projectsRef.current.keys()) void pollOne(dir); };
    const id = setInterval(tick, 8000);
    return () => clearInterval(id);
  }, [projects.size, pollOne]);

  useEffect(() => {
    refreshPicker();
    agentsAvailable()
      .then((a) => {
        const d = (a as { default?: string } | null)?.default;
        if (d) setAgent(d === "codex" ? "Codex" : "Claude");
      })
      .catch(() => {});
    const onFocus = () => { refreshPicker(); for (const dir of projectsRef.current.keys()) void pollOne(dir); };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refreshPicker, pollOne]);

  const activate = useCallback((dir: string) => {
    setActiveDir(dir);
    setProjects((prev) => {
      const next = new Map(prev);
      const e = next.get(dir);
      if (e) next.set(dir, { ...e, updated: false, updatedHint: undefined });
      return next;
    });
    const saved = Number(localStorage.getItem(splitKey(dir)));
    setSplitPct(Number.isFinite(saved) && saved >= 30 && saved <= 75 ? saved : 55.5);
    const name = projectsRef.current.get(dir)?.name;
    if (name) void windowControls().setTitle(`${name} — Chronicle`).catch?.(() => {});
  }, []);

  const doOpenProject = useCallback((path: string) => {
    openProject(path)
      .then((p) => {
        const dir = (p as { dir?: string } | null)?.dir ?? path;
        const name =
          (p as { manifest?: { name?: string } | null } | null)?.manifest?.name ??
          dir.split("/").filter(Boolean).pop() ?? dir;
        setProjects((prev) => {
          if (prev.has(dir)) return prev;
          const next = new Map(prev);
          next.set(dir, { dir, name, state: null, updated: false });
          return next;
        });
        setPaletteOpen(false);
        setPane("road");
        activate(dir);
        void pollOne(dir);
        refreshPicker();
      })
      .catch((e) =>
        toastError("Couldn't open the project", String(e).split("\n")[0].slice(0, 90)),
      );
  }, [activate, pollOne, refreshPicker]);

  const closeProject = useCallback((dir: string) => {
    // NOTE(C6): once live terminal sessions exist, a live session gates this behind
    // the F6 "Close and stop the session" confirm. No sessions exist yet.
    setProjects((prev) => {
      const next = new Map(prev);
      next.delete(dir);
      if (activeRef.current === dir) {
        const first = next.keys().next();
        setActiveDir(first.done ? null : first.value);
      }
      return next;
    });
  }, []);

  const openDialog = useCallback(() => {
    setPaletteOpen(false);
    pickFolder()
      .then((sel) => { if (typeof sel === "string" && sel) doOpenProject(sel); })
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
          .then(refreshPicker)
          .catch((e) => toastError("Couldn't remove it", String(e).slice(0, 90)));
      },
    });
  }, [refreshPicker]);

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

  const refreshNow = useCallback(() => {
    setChecking(true);
    const dirs = [...projectsRef.current.keys()];
    Promise.allSettled(dirs.map((d) => pollOne(d))).finally(() => setChecking(false));
  }, [pollOne]);

  /* ---- the keyboard map (§5 of the handoff) ---- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === "k") { e.preventDefault(); setPaletteOpen((o) => !o); }
      else if (mod && e.key === "o") { e.preventDefault(); openDialog(); }
      else if (mod && e.key === "/") { e.preventDefault(); setShortcutsOpen(true); }
      else if (mod && e.key === "j" && activeRef.current) {
        e.preventDefault();
        setPane((p) => PANES[(PANES.indexOf(p) + 1) % PANES.length]);
      } else if (e.ctrlKey && e.key === "Tab" && activeRef.current) {
        e.preventDefault();
        setPane((p) => PANES[(PANES.indexOf(p) + 1) % PANES.length]);
      } else if (mod && e.key === "w" && activeRef.current) {
        e.preventDefault();
        closeProject(activeRef.current);
      } else if (mod && /^[1-9]$/.test(e.key)) {
        const dirs = [...projectsRef.current.keys()];
        const dir = dirs[Number(e.key) - 1];
        if (dir) { e.preventDefault(); activate(dir); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openDialog, activate, closeProject]);

  /* ---- dev-only handle for the cleanroom harness ---- */
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const presets: Record<string, RecentProject[] | null> = {
      default: null,
      empty: [],
      missing: [{ path: "/tmp/x", name: "lumen-site", tildePath: "~/dev/lumen-site", mark: 3, markLabel: "lu", ago: "2h ago", variant: { kind: "missing" } }],
      writing: [{ path: "/tmp/y", name: "sparrow", tildePath: "~/code/sparrow", mark: 6, markLabel: "sp", ago: "1w ago", variant: { kind: "writing" } }],
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

  const active = activeDir ? projects.get(activeDir) : null;
  const tabs: ProjectTab[] = [...projects.values()].map((p) => ({
    dir: p.dir,
    name: p.name,
    mark: markFor(p.dir),
    updated: p.updated,
    updatedHint: p.updatedHint,
  }));
  const recents: RecentProject[] =
    devPreset.current ?? rows.map((r) => toRecentProject(r, { agent }));
  const openPalette: PaletteProject[] = tabs.map((t) => {
    const row = rows.find((r) => r.path === t.dir);
    const base = row ? toPaletteProject(row) : null;
    return base ?? { path: t.dir, name: t.name, tildePath: t.dir, mark: t.mark, markLabel: t.name.slice(0, 2), statusWord: "open", statusKind: "neutral" as const };
  });
  const paletteRecents: PaletteProject[] = rows
    .filter((r) => !projects.has(r.path))
    .map((r) => toPaletteProject(r));

  const overlays = (
    <>
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        openProjects={openPalette}
        recents={paletteRecents}
        onSwitch={(dir) => { activate(dir); setPaletteOpen(false); }}
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
    </>
  );

  if (!active) {
    return (
      <div className="flex h-full flex-col bg-surface-app font-sans text-text-primary">
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
            onOpenProject={doOpenProject}
            onRemoveRecent={(path) => {
              const name = rows.find((r) => r.path === path)?.name ?? "this project";
              doRemoveRecent(path, name);
            }}
            onLocate={openDialog}
          />
        </div>
        {overlays}
      </div>
    );
  }

  const degraded =
    active.state && active.state.manifest_present === false ? "No roadmap yet" : null;

  return (
    <>
      <Shell
        tabs={tabs}
        activeDir={active.dir}
        pane={pane}
        onPane={setPane}
        checkedAt={active.state?.checked_at ?? null}
        degraded={degraded}
        queuedCount={0 /* the kanban store wires in C7 */}
        checking={checking}
        splitPct={splitPct}
        onSplitPct={(pct) => {
          setSplitPct(pct);
          localStorage.setItem(splitKey(active.dir), String(pct));
        }}
        onSwitch={activate}
        onClose={closeProject}
        onAdd={() => setPaletteOpen(true)}
        onRefresh={refreshNow}
        onHelp={() => setShortcutsOpen(true)}
        terminalTabs={[]}
        onNewTerminal={() => {/* C6 */}}
        onStartAgent={() => {/* C6 */}}
      >
        {/* the content panes land in C3 (roadmap) · C5 (repo) · C7 (kanban) */}
        <div className="flex h-full items-center justify-center">
          <span className="font-mono text-[11.5px] text-text-dim">
            {pane === "road" ? "the roadmap arrives with slice C3"
              : pane === "repo" ? "the repo arrives with slice C5"
              : "the kanban arrives with slice C7"}
          </span>
        </div>
      </Shell>
      {overlays}
    </>
  );
}
