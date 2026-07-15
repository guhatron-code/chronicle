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
import { RoadmapPane } from "@/screens/roadmap/RoadmapPane";
import { RepoPane, evictRepo, openHistoryView } from "@/screens/repo/RepoPane";
import { openFileInRepo } from "@/screens/repo/RepoPane";
import { SearchOverlay } from "@/overlays/SearchOverlay";
import {
  activeTermFor,
  closeTerm,
  closeTermsFor,
  fitTerm,
  getTerm,
  liveCount,
  renameTerm,
  setActiveTermFor,
  spawnTerm,
  subscribeTerms,
  termsFor,
} from "@/lib/term-sessions";
import type { TerminalTab } from "@/components/chrome/TerminalColumn";
import { KanbanPane } from "@/screens/kanban/KanbanPane";
import { evictKanban, kanbanFor, openTaskInKanban, queuedCountFor, refreshKanban, subscribeKanban } from "@/lib/kanban-store";
import { announce } from "@/lib/journal";
import { checkForUpdate, dismissUpdate, installUpdate, subscribeUpdates, updateAvailable } from "@/lib/updates";
import { isInitRunning, setInitRunning, subscribeRunFlags } from "@/lib/run-flags";
import { copyText, fixesStatus, githubClone, githubRepos, initStatus, type GithubRepo } from "@/lib/ipc";
import type { StateData } from "@/lib/ipc";

interface ProjectEntry {
  dir: string;
  name: string;
  state: StateData | null;
  partOf: { name: string; path: string } | null;
  updated: boolean; // finished/changed while in the background
  updatedHint?: string;
  prevNowId?: string;
  justSwitchedAt?: number; // the ~2s banner emphasis window
}

const PANES: Pane[] = ["road", "repo", "kanban"];
const splitKey = (dir: string) => `chronicle.split.${dir}`;

export default function App() {
  const [rows, setRows] = useState<PickerRecent[]>([]);
  const [agent, setAgent] = useState<"claude" | "codex">("claude");
  const [projects, setProjects] = useState<Map<string, ProjectEntry>>(new Map());
  const [activeDir, setActiveDir] = useState<string | null>(null);
  const [pane, setPane] = useState<Pane>("road");
  const [checking, setChecking] = useState(false);
  const [splitPct, setSplitPct] = useState(55.5);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [ghRepos, setGhRepos] = useState<GithubRepo[] | null>(null);
  const [ghError, setGhError] = useState<string | null>(null);
  const [cloningRepo, setCloningRepo] = useState<string | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
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
  const pollInFlight = useRef(new Set<string>());
  const pollOne = useCallback(async (dir: string) => {
    if (pollInFlight.current.has(dir)) return; // a slow getState must not stack
    pollInFlight.current.add(dir);
    try {
      await pollOneInner(dir);
    } finally {
      pollInFlight.current.delete(dir);
    }
  }, []);
  const pollOneInner = useCallback(async (dir: string) => {
    void refreshKanban(dir); // the rail badge + round overlays stay live
    // a generating round settles server-side inside fixes_status — poll it even
    // when no pane is watching, so rounds can't stay "generating" forever (T-006)
    if (kanbanFor(dir).rounds.some((r) => r.state === "generating")) {
      void fixesStatus(dir).catch(() => {});
    }
    // a "Writing your roadmap…" flag with no RoadmapPane mounted to clear it
    // (user on Home) is verified against the backend and released when stale
    if (isInitRunning(dir)) {
      void initStatus(dir)
        .then((st) => { if ((st as { running?: boolean } | null)?.running !== true) setInitRunning(dir, false); })
        .catch(() => {});
    }
    try {
      const s = await getState(dir);
      // transitions observed against the previous ground truth → journal + notify
      const before = projectsRef.current.get(dir);
      if (before?.state) {
        const name = before.name;
        const prevStatuses = before.state.statuses ?? [];
        const prevDone = new Set(prevStatuses.filter((x) => x.state === "done").map((x) => x.id));
        // only a REAL flip announces — the previous poll must have known this
        // phase and seen it not-done (a fresh open must not replay history)
        const prevKnown = new Set(prevStatuses.map((x) => x.id));
        for (const st of s.statuses ?? []) {
          if (st.state === "done" && prevKnown.has(st.id) && !prevDone.has(st.id)) {
            announce(dir, "phase-done", `${st.id} is done`, name);
          }
        }
        if ((before.state.ahead ?? 0) > 0 && (s.ahead ?? 0) === 0 && s.upstream) {
          announce(dir, "published", "Everything is published", name);
        }
      }
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
          justSwitchedAt: changed && dir === activeRef.current ? Date.now() : e.justSwitchedAt,
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

  /* OTA: one quiet daily check; nothing installs without a click */
  const [, updBump] = useState(0);
  useEffect(() => {
    const un = subscribeUpdates(() => updBump((n) => n + 1));
    void checkForUpdate();
    return un;
  }, []);

  useEffect(() => {
    refreshPicker();
    agentsAvailable()
      .then((a) => {
        const d = (a as { default?: string } | null)?.default;
        if (d) setAgent(d === "codex" ? "codex" : "claude");
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
    if (projectsRef.current.has(path)) {
      // already open — just foreground it, keep whatever pane the user was on
      activate(path);
      setPaletteOpen(false);
      return;
    }
    openProject(path)
      .then((p) => {
        const dir = (p as { dir?: string } | null)?.dir ?? path;
        const info = p as { manifest?: { name?: string } | null; part_of?: { name?: string; path?: string } | null } | null;
        const name = info?.manifest?.name ?? dir.split("/").filter(Boolean).pop() ?? dir;
        const partOf = info?.part_of?.path
          ? { name: String(info.part_of.name ?? ""), path: String(info.part_of.path) }
          : null;
        void windowControls().setTitle(`${name} — Chronicle`).catch?.(() => {});
        setProjects((prev) => {
          if (prev.has(dir)) return prev;
          const next = new Map(prev);
          next.set(dir, { dir, name, state: null, partOf, updated: false });
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

  /* ---- terminal sessions (C6) ---- */
  const [, termBump] = useState(0);
  useEffect(() => subscribeTerms(() => termBump((n) => n + 1)), []);
  useEffect(() => subscribeKanban(() => termBump((n) => n + 1)), []);
  useEffect(() => subscribeRunFlags(() => termBump((n) => n + 1)), []);
  const setActiveTerm = useCallback((dir: string, id: number) => {
    setActiveTermFor(dir, id);
    requestAnimationFrame(() => {
      fitTerm(id);
      getTerm(id)?.term.focus();
    });
  }, []);
  const hostRefs = useRef(new Map<number, (el: HTMLDivElement | null) => void>());
  const hostObs = useRef(new Map<number, ResizeObserver>());
  const terminalHostFor = useCallback((id: number) => {
    let cb = hostRefs.current.get(id);
    if (!cb) {
      cb = (el) => {
        const s = getTerm(id);
        if (el && s) {
          if (s.host.parentElement !== el) el.appendChild(s.host);
          requestAnimationFrame(() => fitTerm(id));
          if (!hostObs.current.has(id)) {
            const ro = new ResizeObserver(() => fitTerm(id));
            ro.observe(el);
            hostObs.current.set(id, ro);
          }
        } else if (!el) {
          hostObs.current.get(id)?.disconnect();
          hostObs.current.delete(id);
          hostRefs.current.delete(id);
        }
      };
      hostRefs.current.set(id, cb);
    }
    return cb;
  }, []);
  /* spawn is single-flight: the pty takes a moment and a second click during
     the wait used to stack a twin session. The ref blocks same-frame clicks;
     the state drives the buttons' loading treatment. */
  const spawnGate = useRef(false);
  const [spawningKind, setSpawningKind] = useState<"claude" | "codex" | "shell" | null>(null);
  const newTerminal = useCallback((opts?: { agent?: "claude" | "codex"; title?: string; autoType?: string; kind?: "claude" | "codex" | "shell" }) => {
    const dir = activeRef.current;
    if (!dir || spawnGate.current) return;
    spawnGate.current = true;
    setSpawningKind(opts?.kind ?? opts?.agent ?? "shell");
    spawnTerm(dir, opts ?? {})
      .then((sess) => setActiveTerm(dir, sess.id))
      .catch((e) => toastError("Couldn't start a shell", String(e).slice(0, 90)))
      .finally(() => {
        spawnGate.current = false;
        setSpawningKind(null);
      });
  }, [setActiveTerm]);
  const closeTerminalTab = useCallback((id: number) => {
    const s = getTerm(id);
    if (!s) return;
    if (!s.dead) {
      setConfirm({
        title: "Close this terminal?",
        body: `"${s.title}" is still running. Closing stops the session.`,
        cancelLabel: "Keep it running",
        confirmLabel: "Close and stop the session",
        danger: true,
        onConfirm: () => closeTerm(id),
      });
    } else closeTerm(id);
  }, []);

  const closeProject = useCallback((dir: string) => {
    const doClose = () => {
      closeTermsFor(dir);
      evictRepo(dir);
      evictKanban(dir);
      setProjects((prev) => {
        const next = new Map(prev);
        next.delete(dir);
        if (activeRef.current === dir) {
          const first = next.keys().next();
          if (first.done) {
            setActiveDir(null);
            void windowControls().setTitle("Chronicle").catch?.(() => {});
          } else activate(first.value); // clears Updated + sets the title like any foregrounding
        }
        return next;
      });
    };
    const live = liveCount(dir);
    if (live > 0) {
      setConfirm({
        title: "Close this project?",
        body: `${live === 1 ? "A session is" : `${live} sessions are`} still running in its terminal. Closing the project stops ${live === 1 ? "it" : "them"}.`,
        cancelLabel: "Keep it running",
        confirmLabel: live === 1 ? "Close and stop the session" : "Close and stop the sessions",
        danger: true,
        onConfirm: doClose,
      });
    } else doClose();
  }, []);

  /* the palette's GitHub group — fetched once per session, on first open */
  const ghFetched = useRef(false);
  useEffect(() => {
    // refetch after an error — the user may have just run `gh auth login`
    if (!paletteOpen || (ghFetched.current && !ghError)) return;
    ghFetched.current = true;
    githubRepos()
      .then((rs) => { setGhRepos(Array.isArray(rs) ? rs : []); setGhError(null); })
      .catch((e) => setGhError(String(e).slice(0, 90)));
  }, [paletteOpen]);

  const cloneRepo = useCallback((nameWithOwner: string) => {
    if (cloningRepo) return;
    setCloningRepo(nameWithOwner);
    toastSuccess(`Cloning ${nameWithOwner}…`, "It opens as a project when it's here");
    githubClone(nameWithOwner)
      .then((dest) => {
        setPaletteOpen(false);
        doOpenProject(dest);
      })
      .catch((e) => toastError("Couldn't clone it", String(e).slice(0, 110)))
      .finally(() => setCloningRepo(null));
  }, [cloningRepo, doOpenProject]);

  const updateProps = updateAvailable()
    ? {
        version: updateAvailable()!.version,
        busy: updateAvailable()!.busy,
        onInstall: () =>
          void installUpdate().catch((e) =>
            toastError("The update didn't finish", String(e).slice(0, 90)),
          ),
        onDismiss: dismissUpdate,
      }
    : null;

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
      // in a text field, ctrl-only chords are native editing keys (^W delete-word,
      // ^K kill-line) — never app shortcuts. Meta chords stay global. (T-012)
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
      if (typing && !e.metaKey) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === "k") { e.preventDefault(); setPaletteOpen((o) => !o); }
      else if (mod && e.key === "t" && activeRef.current) { e.preventDefault(); newTerminal(); }
      else if (mod && e.key === "l" && activeRef.current) {
        e.preventDefault();
        const id = activeTermFor(activeRef.current);
        if (id != null) { fitTerm(id); getTerm(id)?.term.focus(); }
      }
      else if (mod && e.shiftKey && (e.key === "f" || e.key === "F") && activeRef.current) {
        e.preventDefault();
        setSearchOpen(true);
      }
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
        if (dir) { e.preventDefault(); activate(dir); setPaletteOpen(false); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openDialog, activate, closeProject, newTerminal]);

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
  // the 2s "changed just now" emphasis needs a re-render AT the boundary
  useEffect(() => {
    const at = active?.justSwitchedAt;
    if (!at) return;
    const left = at + 2000 - Date.now();
    if (left <= 0) return;
    const id = setTimeout(() => termBump((n) => n + 1), left + 50);
    return () => clearTimeout(id);
  }, [active?.justSwitchedAt]);
  const termSessions = active ? termsFor(active.dir) : [];
  const termTabs: TerminalTab[] = termSessions.map((t) => ({
    id: t.id,
    title: t.title,
    live: !t.dead,
    agent: t.agent,
  }));
  const activeTermId = active ? activeTermFor(active.dir) : null;
  const tabs: ProjectTab[] = [...projects.values()].map((p) => ({
    dir: p.dir,
    name: p.name,
    mark: markFor(p.dir),
    updated: p.updated,
    updatedHint: p.updatedHint,
  }));
  const recents: RecentProject[] =
    devPreset.current ??
    rows.map((r) =>
      toRecentProject(r, {
        agent: agent === "codex" ? "Codex" : "Claude",
        writing: isInitRunning(r.path), // a build running while you're on Home
        openNow: projects.has(r.path),
        liveSessions: liveCount(r.path),
      }),
    );
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
        githubRepos={ghRepos}
        githubError={ghError}
        cloningRepo={cloningRepo}
        onCloneRepo={cloneRepo}
        onCheckUpdates={() => {
          setPaletteOpen(false);
          void checkForUpdate(true).then(() => {
            if (!updateAvailable()) toastSuccess("You're on the latest version");
          });
        }}
        onGithubSetup={() => {
          void copyText("gh auth login")
            .then(() => toastSuccess("Copied the command", "Paste `gh auth login` in the terminal, then reopen the palette"))
            .catch(() => {});
        }}
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
      <SearchOverlay
        open={searchOpen}
        onOpenChange={setSearchOpen}
        dir={activeDir}
        onOpenFile={(path) => {
          if (!activeRef.current) return;
          openFileInRepo(activeRef.current, path);
          setPane("repo");
        }}
        onOpenHistory={() => {
          if (!activeRef.current) return;
          openHistoryView(activeRef.current, "repo");
          setPane("repo");
        }}
        onOpenTask={(id) => {
          openTaskInKanban(id);
          setPane("kanban");
        }}
      />
      <ChronicleToaster />
    </>
  );

  if (!active) {
    return (
      <div className="flex h-full flex-col bg-surface-app font-sans text-text-primary">
        <div
          data-tauri-drag-region
          onDoubleClick={(e) => {
            if (!(e.target as HTMLElement).closest("button, input")) void windowControls().toggleMaximize();
          }}
          className="flex h-11 shrink-0 items-center gap-2 px-4"
        >
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
            update={updateProps}
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
        update={updateProps}
        degraded={degraded}
        queuedCount={queuedCountFor(active.dir)}
        checking={checking}
        splitPct={splitPct}
        onSplitPct={(pct) => {
          setSplitPct(pct);
          localStorage.setItem(splitKey(active.dir), String(pct));
        }}
        onSwitch={activate}
        onClose={closeProject}
        onAdd={() => setPaletteOpen(true)}
        onHome={() => {
          setActiveDir(null);
          void windowControls().setTitle("Chronicle").catch?.(() => {});
        }}
        onRefresh={refreshNow}
        onHelp={() => setShortcutsOpen(true)}
        terminalTabs={termTabs}
        activeTerminalId={activeTermId}
        onNewTerminal={() => newTerminal()}
        terminalSpawning={spawningKind}
        onStartAgent={(a) => newTerminal({ agent: undefined, title: a === "claude" ? "Claude" : "Codex", autoType: a, kind: a })}
        onTerminalSelect={(id) => setActiveTerm(active.dir, id)}
        onTerminalClose={closeTerminalTab}
        onTerminalRenameCommit={(id, name) => renameTerm(id, name)}
        terminalHostFor={terminalHostFor}
      >
        {pane === "road" ? (
          <RoadmapPane
            key={active.dir}
            dir={active.dir}
            state={active.state}
            agent={agent}
            partOf={active.partOf}
            justSwitched={!!active.justSwitchedAt && Date.now() - active.justSwitchedAt < 2000}
            onAgentChange={setAgent}
            onOpenProject={doOpenProject}
            onGoRepo={() => setPane("repo")}
            onGoHistory={() => {
              openHistoryView(active.dir, "roadmap");
              setPane("repo");
            }}
            onGoKanban={() => setPane("kanban")}
            onConfirm={setConfirm}
            onPollNow={() => void pollOne(active.dir)}
          />
        ) : pane === "repo" ? (
          <RepoPane
            key={active.dir}
            dir={active.dir}
            state={active.state}
            onConfirm={setConfirm}
            onPollNow={() => void pollOne(active.dir)}
            onGoRoadmap={() => setPane("road")}
          />
        ) : (
          <KanbanPane
            key={active.dir}
            dir={active.dir}
            agent={agent}
            onConfirm={setConfirm}
            onGoRoadmap={() => setPane("road")}
          />
        )}
      </Shell>
      {overlays}
    </>
  );
}
