/*
 * The repo pane container: owns the lazy tree, the viewer tabs (with disk
 * freshness), the history view, and the tree splitter — all against the typed
 * IPC layer. Per-project UI state lives in a module-level cache so switching
 * panes or projects never loses tabs/expansion (FIX-PLAN Phase 2 law).
 */
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Repo, type RepoView } from "./Repo";
import type { FileTreeProps } from "./FileTree";
import type { ViewerBody, ViewerProps } from "./Viewer";
import type { HistoryPaneProps, HistoryReady } from "./HistoryPane";
import {
  IMG_MIME,
  githubCreate,
  copyFile as copyFileIpc,
  copyText,
  createPath,
  gitCommit,
  gitDiff,
  gitDiscard,
  gitInitHere,
  gitLogGraph,
  gitPull,
  gitPush,
  gitStage,
  gitStatusDetail,
  gitUnstage,
  listDir,
  readFile,
  readFileB64,
  renamePath,
  revealPath,
  statFile,
  trashPath,
  type FileStat,
  type StateData,
  draftSaveMessage,
  agentEditDiff,
  agentEditKeep,
  agentEditUndo,
  type AgentEditFile,
} from "@/lib/ipc";
import {
  bufferFor,
  bufferKey,
  closeBuffer,
  dirtyPathsFor,
  editBuffer,
  evictBuffers,
  keepMine,
  languageIdFor,
  loadEditorConfig,
  onFileChanged,
  openBuffer,
  reloadBuffer,
  renameBuffer,
  saveBuffer,
  saveLabelFor,
  subscribeBuffers,
  tabSizeFor,
} from "@/lib/repo-editor";
import {
  buildTree,
  changeGroups,
  changedPaths,
  extOf,
  fmtBytes,
  gitLetterMap,
  mapCommits,
  newPathIn,
  parseDiff,
  publishStateFrom,
  splitName,
  type DirLoad,
  type GitStatus,
} from "@/lib/repo-data";
import { announce } from "@/lib/journal";
import { sanitizeTitle } from "@/lib/notes-model";
import { isHtmlPath } from "@/lib/web-url";
import { toastError, toastRemoteOutcome, toastSuccess } from "@/overlays/toasts";
import { listen } from "@tauri-apps/api/event";
import { humanError, humanGitError } from "@/lib/utils";
import type { ConfirmSpec } from "@/overlays/ConfirmDialog";

/* ---- per-project state, surviving pane switches and project tabs ---- */

interface TabState {
  path: string;
  mode: "contents" | "diff";
  /** Last stat size — drives the huge-card affordances across remounts. */
  sizeBytes?: number;
  body: ViewerBody | null; // null = loading
  /** false for the paths the backend refuses to write — anything under .git/. */
  editable?: boolean;
  meta?: string;
  diffStat?: { added: number; removed: number };
  mtime?: number; // as loaded — freshness baseline
  changedOnDisk?: boolean;
  /** F36 — a review tab: the diff comes from the agent's ledger, not git. */
  agentReview?: { abs: string; viaCommand: boolean };
}

interface RepoState {
  loads: Map<string, DirLoad>;
  expanded: Set<string>;
  selectedId: string | null;
  tabs: TabState[];
  activeTab: string | null; // path
  historyView: boolean;
  /** Where the history view was entered from — Back/Close return there. */
  historyFrom: "repo" | "roadmap";
  closedGroups: Set<string>;
  message: string;
  logLimit: number;
  banner?: string;
  /** F36 — the active review pass over the agent's ledger. */
  review?: { files: AgentEditFile[]; resolved: Set<string> };
  /** A name being typed: a new entry in `parent`, or a rename of `renaming`. */
  pending: { parent: string; kind: "file" | "dir" } | null;
  renaming: string | null;
  nameError: string | null;
}

const CACHE = new Map<string, RepoState>();
function stateFor(dir: string): RepoState {
  let s = CACHE.get(dir);
  if (!s) {
    s = {
      loads: new Map(),
      expanded: new Set(),
      selectedId: null,
      tabs: [],
      activeTab: null,
      historyView: false,
      historyFrom: "repo",
      closedGroups: new Set(),
      message: "",
      logLimit: 30,
      pending: null,
      renaming: null,
      nameError: null,
    };
    CACHE.set(dir, s);
  }
  return s;
}

/* A mounted pane rerenders when something outside it moves the cached state —
 * ⌘N from the App keymap is the only such mutation today. (The tabs already
 * follow the buffer store through subscribeBuffers.) */
const repoSubs = new Set<() => void>();
function bumpRepo(): void { for (const cb of repoSubs) cb(); }
export function subscribeRepo(cb: () => void): () => void {
  repoSubs.add(cb);
  return () => { repoSubs.delete(cb); };
}

/** ⌘N on the Repo pane: start a new file in the selected folder. */
export function newFileInRepo(dir: string): void {
  const s = CACHE.get(dir);
  if (!s) return;
  const id = s.selectedId;
  const parent = id ? (s.loads.has(id) ? id : splitName(id).dir) : "";
  s.pending = { parent, kind: "file" };
  s.renaming = null;
  s.nameError = null;
  bumpRepo();
}

/** Drop a closed project's cached tree/tab state (memory hygiene). */
export function evictRepo(dir: string): void {
  CACHE.delete(dir);
  evictBuffers(dir);
}

/** Open a specific file in the viewer next time the repo pane mounts for
 * `dir` — the roadmap's problem cards land on the actual file. */
export function openFileInRepo(dir: string, path: string) {
  const s = stateFor(dir);
  s.historyView = false;
  if (!s.tabs.find((t) => t.path === path)) s.tabs.push({ path, mode: "contents", body: null });
  s.activeTab = path;
  s.selectedId = path;
  // the same first question a tree open asks: this project's indentation, read
  // once. Without it a file opened from the roadmap or search drew at 2 spaces
  // in a 4-space project until some other tab happened to load the config.
  void loadEditorConfig(dir);
}

/** F36 — start a review pass over the agent's unresolved edits: the viewer
 * opens on the first file's ledger diff with the Keep/Undo action bar. */
export function openAgentReview(dir: string, files: AgentEditFile[]) {
  if (files.length === 0) return;
  const s = stateFor(dir);
  s.historyView = false;
  s.review = { files, resolved: new Set() };
  openReviewFile(s, files[0]);
}

function openReviewFile(s: RepoState, f: AgentEditFile) {
  let t = s.tabs.find((x) => x.path === f.path);
  if (!t) {
    t = { path: f.path, mode: "diff", body: null };
    s.tabs.push(t);
  }
  t.mode = "diff";
  t.body = null;
  t.agentReview = { abs: f.abs, viaCommand: f.viaCommand };
  s.activeTab = f.path;
  s.selectedId = f.path;
}

/** Open the project-history view next time the repo pane mounts for `dir` —
 * lets the roadmap's history panel land directly on the L4 pane. Back/Close
 * return to the caller's surface. */
export function openHistoryView(dir: string, from: "repo" | "roadmap" = "roadmap") {
  const s = stateFor(dir);
  s.historyView = true;
  s.historyFrom = from;
}

const DIFF_ROW_CAP = 2_000;
const HUGE_WARN = 300_000; // "Reading it may be slow."
const HUGE_CAP = 1_500_000; // the backend refuses text reads past this

export function RepoPane({
  dir,
  state,
  onConfirm,
  onPollNow,
  onGoRoadmap,
  onOpenInWeb,
}: {
  dir: string;
  state: StateData | null;
  onConfirm: (spec: ConfirmSpec) => void;
  onPollNow: () => void;
  /** History entered from the roadmap returns there on Back/Close. */
  onGoRoadmap?: () => void;
  /** Open the active file (an HTML document) in the Web pane. */
  onOpenInWeb?: (path: string) => void;
}) {
  const rs = stateFor(dir);
  const [, bump] = useState(0);
  const rerender = useCallback(() => bump((n) => n + 1), []);
  const [gitStatus, setGitStatus] = useState<GitStatus | null>(null);
  const [statusFailed, setStatusFailed] = useState(false);
  const [log, setLog] = useState<HistoryReady["commits"]>([]);
  const [arcs, setArcs] = useState<HistoryReady["branches"]>([]);
  const [logCount, setLogCount] = useState(0);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [drafting, setDrafting] = useState(false);
  const [treeWidth, setTreeWidth] = useState(() => {
    const v = Number(localStorage.getItem("chronicle.treew"));
    return Number.isFinite(v) && v >= 170 && v <= 480 ? v : 230;
  });
  const seq = useRef(0);
  const dirRef = useRef(dir);
  dirRef.current = dir;

  /* ---- ground-truth refresh (staleness-guarded) ---- */

  const loadDir = useCallback((path: string) => {
    const d = dir;
    rs.loads.set(path, { kind: "loading" });
    rerender();
    listDir(d, path)
      .then((entries) => {
        if (dirRef.current !== d) return;
        // a malformed backend reply must degrade, not crash the pane
        stateFor(d).loads.set(path, { kind: "ready", entries: Array.isArray(entries) ? entries : [] });
        rerender();
      })
      .catch((e) => {
        if (dirRef.current !== d) return;
        stateFor(d).loads.set(path, { kind: "error", message: String(e).slice(0, 120) });
        rerender();
      });
  }, [dir, rs, rerender]);

  const refreshGit = useCallback(() => {
    const d = dir;
    const my = ++seq.current;
    gitStatusDetail(d)
      .then((st) => {
        if (dirRef.current !== d || seq.current !== my) return;
        const okShape = st && Array.isArray(st.staged) && Array.isArray(st.unstaged);
        setGitStatus(okShape ? st : null);
        setStatusFailed(!okShape);
      })
      .catch(() => {
        if (dirRef.current !== d) return;
        setGitStatus(null);
        setStatusFailed(true);
      });
    gitLogGraph(d, stateFor(d).logLimit)
      .then((rows) => {
        if (dirRef.current !== d || seq.current !== my) return;
        const arr = Array.isArray(rows) ? rows : [];
        const branch = state?.branch ?? null;
        const mapped = mapCommits(arr, branch);
        setLog(mapped.commits);
        setArcs(mapped.branches);
        setLogCount(arr.length);
        setHistoryLoading(false);
      })
      .catch(() => {
        if (dirRef.current !== d) return;
        setLog([]);
        setArcs([]);
        setHistoryLoading(false);
      });
  }, [dir, state?.branch]);

  /* the tree follows the disk: re-list every already-loaded directory and
     commit only real changes — a PRD the agent just wrote must appear without
     collapsing what the user expanded (loads for unopened dirs stay lazy) */
  const refreshTree = useCallback(() => {
    const d = dir;
    for (const [path, load] of stateFor(d).loads) {
      if (load.kind !== "ready") continue;
      listDir(d, path)
        .then((entries) => {
          if (dirRef.current !== d) return;
          const cur = stateFor(d).loads.get(path);
          if (!cur || cur.kind !== "ready") return;
          const next = Array.isArray(entries) ? entries : [];
          if (JSON.stringify(next) !== JSON.stringify(cur.entries)) {
            stateFor(d).loads.set(path, { kind: "ready", entries: next });
            rerender();
          }
        })
        .catch(() => {/* transient — the next tick retries */});
    }
  }, [dir, rerender]);

  /* freshness: re-stat open tabs; flag the ones that changed on disk */
  const checkFreshness = useCallback(() => {
    const d = dir;
    for (const tab of stateFor(d).tabs) {
      if (tab.mtime == null) continue;
      if (bufferFor(d, tab.path)) continue; // the buffer reconciles this one
      statFile(d, tab.path)
        .then((st) => {
          if (dirRef.current !== d) return;
          const t = stateFor(d).tabs.find((x) => x.path === tab.path);
          if (t && t.mtime != null && st.mtime > t.mtime && !t.changedOnDisk) {
            t.changedOnDisk = true;
            rerender();
          }
        })
        .catch(() => {/* deleted since — the read-error path handles it on reload */});
    }
  }, [dir, rerender]);

  useEffect(() => {
    if (!rs.loads.has("")) loadDir("");
    setHistoryLoading(true);
    refreshGit();
    // Tabs opened from outside the pane (openFileInRepo / openAgentReview)
    // arrive body-less — load them in their own mode. A TEXT tab's body is
    // permanently null (it is drawn from the buffer), so every remount used to
    // re-read every open file; now a tab that already has a buffer only asks
    // whether the disk moved while the pane was away.
    for (const t of rs.tabs) {
      if (t.body !== null) continue;
      if (t.mode === "diff") loadDiff(t.path);
      else if (bufferFor(dir, t.path)) reconcileTab(t.path);
      else loadContents(t.path);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dir]);

  /* the App 8s poll lands as a checked_at change — piggyback for git + freshness */
  const checkedAt = state?.checked_at ?? null;
  useEffect(() => {
    refreshGit();
    checkFreshness();
    refreshTree();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkedAt]);

  useEffect(() => {
    const onFocus = () => { checkFreshness(); refreshTree(); };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [checkFreshness, refreshTree]);

  /* the watcher is the tree's real trigger — checked_at only ticks per poll
     (second granularity), but a file the agent just wrote should appear now */
  useEffect(() => {
    let un: (() => void) | undefined;
    let t: ReturnType<typeof setTimeout> | undefined;
    void listen<string>("project-fs-changed", (ev) => {
      if (ev.payload !== dir) return;
      if (t) clearTimeout(t);
      t = setTimeout(() => { // timer-ok: the watcher's 450ms debounce, cleared on every event and on unmount
        refreshTree();
        checkFreshness();
        // every open buffer reconciles: clean reloads silently, dirty raises
        // the bar, and our own write echo is recognised and ignored
        for (const tab of stateFor(dir).tabs) {
          if (bufferFor(dir, tab.path)) void onFileChanged(dir, tab.path);
        }
      }, 450);
    }).then((u) => { un = u; });
    return () => { if (t) clearTimeout(t); un?.(); };
  }, [dir, refreshTree, checkFreshness]);

  /* the buffer store lives outside React: its save-state changes are what move
     the header word and the tab's dot */
  useEffect(() => subscribeBuffers(rerender), [rerender]);
  useEffect(() => subscribeRepo(rerender), [rerender]);

  /* ---- the viewer: open / load / mode / freshness ---- */

  const loadContents = useCallback((path: string, ignoreGuard = false) => {
    const d = dir;
    const tab = () => stateFor(d).tabs.find((t) => t.path === path);
    /* This path is no longer readable text — it went binary, oversize, or away
       entirely. A clean buffer is stale now and would keep the old text on
       screen in front of the new card, so it goes; a buffer with unsaved work
       is never thrown away by a background reload. */
    const dropStaleBuffer = () => {
      if (bufferFor(d, path)?.state === "clean") closeBuffer(d, path);
    };
    statFile(d, path)
      .then(async (st: FileStat) => {
        if (dirRef.current !== d) return;
        const t = tab();
        if (!t) return;
        const name = splitName(path).name;
        if (st.kind === "image") {
          const b64 = await readFileB64(d, path);
          if (dirRef.current !== d) return;
          const mime = IMG_MIME[extOf(path).toLowerCase()] ?? "image/png";
          t.body = { kind: "image", caption: `${name} · ${fmtBytes(st.size)}`, src: `data:${mime};base64,${b64}` };
          t.meta = undefined;
          dropStaleBuffer();
        } else if (st.kind === "binary") {
          t.body = {
            kind: "binary",
            message: "This is a binary file — there's nothing readable to show.",
            note: "Size",
            detail: fmtBytes(st.size),
          };
          t.meta = undefined;
          dropStaleBuffer();
        } else if (st.size > HUGE_WARN && !ignoreGuard) {
          t.sizeBytes = st.size;
          t.body = {
            kind: "huge",
            message: `This file is ${fmtBytes(st.size)}`,
            note:
              st.size > 5_000_000
                ? "Too large to preview or copy."
                : st.size > HUGE_CAP
                  ? "Too large to preview — copying still works."
                  : "Reading it may be slow.",
          };
          t.meta = undefined;
          dropStaleBuffer();
        } else {
          const r = await readFile(d, path);
          if (dirRef.current !== d) return;
          const cur = tab();
          if (!cur || cur.mode !== "contents") return; // switched to diff mid-load
          if (r.too_large) {
            t.sizeBytes = r.size;
            t.body = {
              kind: "huge",
              message: `This file is ${fmtBytes(r.size)}`,
              note: "Too large to open for editing — copying still works.",
            };
            t.meta = undefined;
            dropStaleBuffer();
            t.mtime = st.mtime;
            t.changedOnDisk = false;
            rerender();
            return;
          }
          if (r.binary) {
            t.body = {
              kind: "binary",
              message: "This is a binary file — there's nothing readable to show.",
              note: "Size",
              detail: fmtBytes(r.size),
            };
            t.meta = undefined;
            dropStaleBuffer();
            t.mtime = st.mtime;
            rerender();
            return;
          }
          // The buffer is created on OPEN here rather than on the first
          // keystroke: the editor needs a doc to render, and an untouched
          // buffer is "clean", costs one Map entry, and never writes anything.
          // When one already exists this is a RE-read — openBuffer would hand
          // back the old buffer and throw the fresh text away, so the store's
          // reconciliation decides instead: clean reloads, dirty raises the bar.
          if (bufferFor(d, path)) {
            await onFileChanged(d, path);
            if (dirRef.current !== d) return;
          } else openBuffer(d, path, r.text, r.mtime_ms);
          const lines = r.text.split("\n").length;
          t.body = null; // the body is derived from the buffer at render time
          t.editable = !path.split("/").some((s) => s === ".git");
          t.meta = `${extOf(path) || "file"} · ${lines} line${lines === 1 ? "" : "s"}`;
        }
        t.mtime = st.mtime;
        t.changedOnDisk = false;
        rerender();
      })
      .catch((e) => {
        if (dirRef.current !== d) return;
        const t = tab();
        if (!t) return;
        t.body = { kind: "read-error", message: "This file couldn't be read", detail: humanError(e) };
        t.meta = undefined;
        dropStaleBuffer();
        rerender();
      });
  }, [dir, rerender]);

  /* Coming back to a pane that was away: the tab kept its buffer, but the disk
     may have moved under it. One question — has the mtime? — and only a real
     move pays for the store's reconciliation (which re-reads: clean reloads,
     dirty raises the bar). A file that stopped being readable text while we
     were gone goes back through the full load, which draws the right card. */
  const reconcileTab = useCallback((path: string) => {
    const d = dir;
    if (!bufferFor(d, path)) { loadContents(path); return; }
    // stat first: a remount pays one stat per open tab, and a read only when
    // the disk actually moved (onFileChanged does that read itself)
    statFile(d, path)
      .then((st) => {
        if (dirRef.current !== d) return;
        if (st.kind !== "text") { loadContents(path); return; }
        const cur = bufferFor(d, path);
        if (!cur || Math.floor(cur.mtime / 1000) === st.mtime) return; // still in step with the disk
        void onFileChanged(d, path);
      })
      .catch(() => { loadContents(path); }); // gone since — the read-error card says so
  }, [dir, loadContents]);

  const loadDiff = useCallback((path: string) => {
    const d = dir;
    const st = gitStatus;
    const un = st?.unstaged.find((f) => f.path === path);
    const staged = !un && !!st?.staged.find((f) => f.path === path);
    const reviewTab = stateFor(d).tabs.find((x) => x.path === path)?.agentReview;
    (reviewTab ? agentEditDiff(d, reviewTab.abs) : gitDiff(d, path, staged, !!un?.untracked))
      .then((raw) => {
        if (dirRef.current !== d) return;
        const t = stateFor(d).tabs.find((x) => x.path === path);
        if (!t || t.mode !== "diff") return; // switched to contents mid-load
        const { rows, added, removed } = parseDiff(raw);
        const shown = rows.length > DIFF_ROW_CAP
          ? [...rows.slice(0, DIFF_ROW_CAP),
             { kind: "hunk" as const, header: "@@ truncated @@", context: `showing the first ${DIFF_ROW_CAP.toLocaleString()} of ${rows.length.toLocaleString()} rows` }]
          : rows;
        t.body = { kind: "diff", rows: shown };
        t.diffStat = { added, removed };
        t.changedOnDisk = false;
        rerender();
      })
      .catch((e) => {
        if (dirRef.current !== d) return;
        const t = stateFor(d).tabs.find((x) => x.path === path);
        if (!t) return;
        t.body = { kind: "read-error", message: "The diff couldn't be read", detail: String(e).slice(0, 120) };
        rerender();
      });
  }, [dir, gitStatus, rerender]);

  const openFile = useCallback((path: string) => {
    const s = stateFor(dir);
    s.selectedId = path;
    if (!s.tabs.find((t) => t.path === path)) {
      s.tabs.push({ path, mode: "contents", body: null });
      void loadEditorConfig(dir);
      loadContents(path);
    }
    s.activeTab = path;
    rerender();
  }, [dir, loadContents, rerender]);

  /* ---- tree handlers ---- */

  const onToggleDir = useCallback((id: string) => {
    const s = stateFor(dir);
    if (s.expanded.has(id)) s.expanded.delete(id);
    else {
      s.expanded.add(id);
      if (!s.loads.has(id)) loadDir(id);
    }
    rerender();
  }, [dir, loadDir, rerender]);

  /* ---- explorer operations: new file/folder, rename, reveal, delete ---- */

  /** "the selected folder, or the root" — a file's own folder counts. */
  const targetFolder = useCallback((): string => {
    const id = rs.selectedId;
    if (!id) return "";
    const load = rs.loads.get(id);
    if (load) return id;              // the selection is a folder we have listed
    return splitName(id).dir;         // a file: its folder
  }, [rs]);

  const startNew = useCallback((kind: "file" | "dir") => {
    const parent = targetFolder();
    const s = stateFor(dir);
    s.pending = { parent, kind };
    s.renaming = null;
    s.nameError = null;
    if (parent && !s.expanded.has(parent)) {
      s.expanded.add(parent);
      if (!s.loads.has(parent)) loadDir(parent);
    }
    rerender();
  }, [dir, targetFolder, loadDir, rerender]);

  const cancelName = useCallback(() => {
    const s = stateFor(dir);
    s.pending = null;
    s.renaming = null;
    s.nameError = null;
    rerender();
  }, [dir, rerender]);

  const commitName = useCallback((raw: string) => {
    const s = stateFor(dir);
    // the notes' sanitiser: separators become dashes, a leading dot goes, so
    // nothing typed into the tree can walk out of the folder it was typed in
    const name = sanitizeTitle(raw);
    if (!name) { cancelName(); return; }
    const done = () => { cancelName(); refreshTree(); };
    const fail = (e: unknown) => {
      stateFor(dir).nameError = String(e).slice(0, 90);
      rerender();
    };
    if (s.renaming) {
      const from = s.renaming;
      const to = newPathIn(splitName(from).dir, name);
      if (to === from) { cancelName(); return; }
      renamePath(dir, from, to)
        .then(() => {
          // the open tab, its buffer and its dirt follow the file
          const t = stateFor(dir).tabs.find((x) => x.path === from);
          if (t) t.path = to;
          renameBuffer(dir, from, to);
          if (stateFor(dir).activeTab === from) stateFor(dir).activeTab = to;
          if (stateFor(dir).selectedId === from) stateFor(dir).selectedId = to;
          done();
        })
        .catch(fail);
      return;
    }
    if (!s.pending) { cancelName(); return; }
    const { parent, kind } = s.pending;
    const path = newPathIn(parent, name);
    createPath(dir, path, kind === "dir" ? "dir" : "file")
      .then(() => {
        done();
        if (kind === "file") openFile(path);
        else if (!stateFor(dir).expanded.has(path)) { stateFor(dir).expanded.add(path); loadDir(path); }
      })
      .catch(fail);
  }, [dir, cancelName, refreshTree, rerender, openFile, loadDir]);

  const deletePath = useCallback((id: string) => {
    const name = splitName(id).name;
    /* A folder takes everything under it — its tabs, their buffers and their
       unsaved edits. The prompt says so before the Trash does it: "you can put
       it back from Finder" is true of the file, not of work that was never
       written to it. */
    const inside = (p: string) => p === id || p.startsWith(`${id}/`);
    const unsaved = dirtyPathsFor(dir).filter(inside);
    const body = unsaved.length === 0
      ? "It moves to the Trash, so you can put it back from Finder."
      : unsaved.length === 1 && unsaved[0] === id
        ? "It has edits you haven't saved — they go with it. The file moves to the Trash, so you can put that back from Finder."
        : `${unsaved.length} file${unsaved.length === 1 ? "" : "s"} inside ${unsaved.length === 1 ? "has" : "have"} edits you haven't saved — they go too. It moves to the Trash, so you can put that back from Finder.`;
    onConfirm({
      title: `Delete ${name}?`,
      body,
      cancelLabel: "Keep it",
      confirmLabel: "Move to Trash",
      danger: true,
      onConfirm: () => {
        trashPath(dir, id)
          .then(() => {
            const s = stateFor(dir);
            const i = s.tabs.findIndex((t) => inside(t.path));
            closeBuffer(dir, id);
            for (const t of s.tabs) if (inside(t.path)) closeBuffer(dir, t.path);
            if (i >= 0) {
              s.tabs = s.tabs.filter((t) => !inside(t.path));
              if (s.activeTab !== null && inside(s.activeTab)) {
                s.activeTab = s.tabs[Math.max(0, i - 1)]?.path ?? null;
              }
              s.selectedId = s.activeTab;
            }
            refreshTree();
            rerender();
            toastSuccess("Moved to the Trash", name);
          })
          .catch((e) => toastError("Couldn't delete it", humanError(e)));
      },
    });
  }, [dir, onConfirm, refreshTree, rerender]);

  /* ---- splitter ---- */

  const onTreeSplitterDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = treeWidth;
    const move = (ev: PointerEvent) => {
      const w = Math.min(480, Math.max(170, startW + ev.clientX - startX));
      setTreeWidth(w);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      setTreeWidth((w) => {
        localStorage.setItem("chronicle.treew", String(w));
        return w;
      });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }, [treeWidth]);

  /* ---- history handlers ---- */

  const afterGitOp = useCallback((toast?: string) => {
    if (toast) toastSuccess(toast);
    stateFor(dirRef.current).banner = undefined; // a success clears the last op error
    refreshGit();
    onPollNow();
  }, [refreshGit, onPollNow]);

  const opError = useCallback((title: string) => (e: unknown) => {
    const s = stateFor(dirRef.current);
    const msg = /publish|bring/i.test(title) ? humanGitError(e) : String(e).slice(0, 110);
    s.banner = `${title} — ${msg}`;
    toastError(title, msg.slice(0, 90));
    rerender();
  }, [rerender]);

  /* ---- view assembly ---- */

  const branch = state?.branch || undefined;
  const isGit = state?.is_git !== false;
  const slug = dir.split("/").filter(Boolean).pop() ?? "project";

  let view: RepoView;
  if (rs.historyView) {
    const ready: HistoryPaneProps["state"] = !isGit
      ? { kind: "no-history" }
      : historyLoading && gitStatus === null
        ? { kind: "loading" }
        : {
            kind: "ready",
            statusUnknown: statusFailed,
            banner: rs.banner ?? (statusFailed ? "Couldn't check for changes — showing the last known state" : undefined),
            message: rs.message,
            readyToSave: gitStatus ? gitStatus.staged.map((f) => ({ ...splitName(f.path), path: f.path })) : [],
            changes: gitStatus ? changeGroups(gitStatus, rs.closedGroups) : [],
            publish: publishStateFrom(state ?? {}),
            commits: log,
            branches: arcs,
            // the backend caps git_log_graph at 200 — past that, "Show more" would lie
            hasMore: logCount >= rs.logLimit && rs.logLimit < 200,
          };
    const leaveHistory = () => {
      const from = rs.historyFrom;
      rs.historyView = false;
      rs.historyFrom = "repo";
      if (from === "roadmap" && onGoRoadmap) onGoRoadmap();
      else rerender();
    };
    view = {
      kind: "history",
      history: {
        branch,
        backLabel: rs.historyFrom === "roadmap" ? "Roadmap" : "Repo",
        state: ready,
        onBack: leaveHistory,
        onCloseHistory: leaveHistory,
        onMessageChange: (m) => { rs.message = m; rerender(); },
        drafting,
        onDraftMessage: () => {
          if (drafting) return;
          setDrafting(true);
          const d = dir;
          // nothing marked ready → the backend diffs the staged set, so include
          // everything first exactly like Save does
          const stageAllFirst = (gitStatus?.staged.length ?? 0) === 0
            ? gitStage(d, ".")
            : Promise.resolve();
          stageAllFirst
            .then(() => draftSaveMessage(d))
            .then((msg) => {
              if (dirRef.current !== d) return;
              stateFor(d).message = msg;
              rerender();
            })
            .catch((e) => toastError("Couldn't draft it", humanError(e)))
            .finally(() => setDrafting(false));
        },
        onSave: () => {
          const msg = rs.message.trim();
          if (!msg) return;
          // nothing marked Ready to save → include everything (vocabulary law:
          // Save means save, never a raw 'nothing added to commit' git error)
          const stageAll = (gitStatus?.staged.length ?? 0) === 0;
          gitCommit(dir, msg, stageAll)
            .then(() => { stateFor(dir).message = ""; stateFor(dir).banner = undefined; afterGitOp("Saved to history"); })
            .catch(opError("Couldn't save"));
        },
        onSkip: (path) => { gitUnstage(dir, path).then(() => afterGitOp()).catch(opError("Couldn't skip it")); },
        onToggleGroup: (gdir) => {
          if (rs.closedGroups.has(gdir)) rs.closedGroups.delete(gdir);
          else rs.closedGroups.add(gdir);
          rerender();
        },
        onInclude: (path) => { gitStage(dir, path).then(() => afterGitOp()).catch(opError("Couldn't include it")); },
        onDiscard: (path) => {
          const untracked = !!gitStatus?.unstaged.find((f) => f.path === path)?.untracked;
          onConfirm({
            title: "Discard these changes?",
            body: untracked
              ? `${path} is a new file — discarding deletes it from disk. This can't be undone.`
              : `${path} goes back to its last saved version. This can't be undone.`,
            cancelLabel: "Keep it",
            confirmLabel: "Discard",
            danger: true,
            onConfirm: () => {
              gitDiscard(dir, path, untracked).then(() => afterGitOp("Discarded")).catch(opError("Couldn't discard it"));
            },
          });
        },
        onPush: () => {
          gitPush(dir)
            .then((r) => {
              toastRemoteOutcome(r);
              // the ONLY thing that announces a publish is a push that returned,
              // and only when it carried something ("Already published — nothing
              // new" is the one push outcome that is not a publish)
              if (!/nothing new/i.test(r.headline)) announce(dir, "published", r.headline, slug);
              refreshGit();
              onPollNow();
            })
            .catch(opError("Couldn't publish"));
        },
        onPull: () => {
          gitPull(dir)
            .then((r) => { toastRemoteOutcome(r); refreshGit(); onPollNow(); })
            .catch(opError("Couldn't bring them down"));
        },
        onCreateOnline: () => {
          const repoName = slug.replace(/[^a-zA-Z0-9._-]/g, "-");
          onConfirm({
            title: "Put this project on GitHub?",
            body: `Creates a private repository "${repoName}" under your GitHub account and publishes every save — using your gh sign-in. You can make it public on GitHub any time.`,
            cancelLabel: "Not yet",
            confirmLabel: "Create and publish",
            onConfirm: () => {
              githubCreate(dir)
                .then((name) => {
                  afterGitOp(`Published online — ${name}`);
                  announce(dir, "published", `Published online — ${name}`, slug);
                })
                .catch(opError("Couldn't publish"));
            },
          });
        },
        onCommit: (hash) => {
          copyText(hash).then(() => toastSuccess("Save id copied")).catch(() => {});
        },
        onShowMore: () => { rs.logLimit += 30; refreshGit(); },
        onStartHistory: () => {
          gitInitHere(dir).then(() => afterGitOp("Started keeping history")).catch(opError("Couldn't start history"));
        },
      },
    };
  } else {
    const workspaceRoots = (state?.worktrees ?? []).filter((w) => w.path.startsWith(dir + "/")).length;
    const tree: FileTreeProps = {
      rootsCount: 1 + workspaceRoots,
      roots: buildTree(
        rs.loads,
        rs.expanded,
        changedPaths(gitStatus),
        gitLetterMap(gitStatus),
        new Set(
          (state?.worktrees ?? [])
            .filter((w) => w.path.startsWith(dir + "/"))
            .map((w) => w.path.slice(dir.length + 1).split("/")[0]!),
        ),
        "",
        rs.pending,
      ),
      selectedId: rs.selectedId,
      renamingId: rs.renaming,
      nameError: rs.nameError,
      onSelect: openFile,
      onToggleDir,
      onRetry: (id) => loadDir(id === "#root" ? "" : id),
      onOpenHistory: () => { rs.historyView = true; rs.historyFrom = "repo"; rerender(); },
      onNewFile: () => startNew("file"),
      onNewFolder: () => startNew("dir"),
      onCommitName: commitName,
      onCancelName: cancelName,
      onRename: (id) => { rs.renaming = id; rs.pending = null; rs.nameError = null; rerender(); },
      onReveal: (id) => { revealPath(dir, id).catch((e) => toastError("Couldn't show it", humanError(e))); },
      onDelete: deletePath,
      onOpenInWeb: (id) => onOpenInWeb?.(id),
    };
    const active = rs.tabs.find((t) => t.path === rs.activeTab);
    /* F36 — resolve one review file and move to the next unresolved one */
    const advanceReview = (abs: string) => {
      const rev = rs.review;
      if (!rev) return;
      rev.resolved.add(abs);
      const f = rev.files.find((x) => x.abs === abs);
      if (f) {
        const i = rs.tabs.findIndex((t) => t.path === f.path);
        if (i >= 0) rs.tabs.splice(i, 1);
      }
      const next = rev.files.find((x) => !rev.resolved.has(x.abs));
      if (next) openReviewFile(rs, next);
      else {
        rs.review = undefined;
        rs.activeTab = rs.tabs[rs.tabs.length - 1]?.path ?? null;
        rs.selectedId = rs.activeTab;
      }
      rerender();
    };
    const buf = active ? bufferFor(dir, active.path) : null;
    const dirtyNow = dirtyPathsFor(dir); // one pass over the store, not one per tab
    const viewer: ViewerProps = !active
      ? { kind: "empty" }
      : {
          kind: "file",
          tabs: rs.tabs.map((t) => ({
            id: t.path,
            name: splitName(t.path).name,
            dirty: dirtyNow.includes(t.path),
          })),
          activeTabId: active.path,
          path: active.path,
          mode: active.mode,
          meta: active.mode === "contents" ? active.meta : undefined,
          saveLabel: active.mode === "contents" ? saveLabelFor(buf, Date.now()) : undefined,
          conflict: active.mode === "contents" && buf?.state === "conflict",
          diffStat: active.mode === "diff" ? active.diffStat : undefined,
          readyToSave:
            active.mode === "diff" &&
            !!gitStatus?.staged.some((f) => f.path === active.path) &&
            !gitStatus?.unstaged.some((f) => f.path === active.path),
          changedOnDisk: active.changedOnDisk,
          review:
            active.agentReview && rs.review
              ? {
                  progress: `${rs.review.resolved.size} of ${rs.review.files.length} reviewed`,
                  viaCommand: active.agentReview.viaCommand,
                  onKeep: () => {
                    const abs = active.agentReview!.abs;
                    agentEditKeep(dir, abs)
                      .then(() => advanceReview(abs))
                      .catch((e) => toastError("Couldn't keep it", String(e).slice(0, 90)));
                  },
                  onUndo: active.agentReview.viaCommand
                    ? undefined
                    : () => {
                        const abs = active.agentReview!.abs;
                        onConfirm({
                          title: "Undo this file?",
                          body: `Puts ${splitName(active.path).name} back the way it was before the agent's changes. The agent's edit is gone for good.`,
                          cancelLabel: "Keep reviewing",
                          confirmLabel: "Undo this file",
                          danger: true,
                          onConfirm: () => {
                            agentEditUndo(dir, abs)
                              .then(() => advanceReview(abs))
                              .catch((e) => toastError("Couldn't undo it", String(e).slice(0, 90)));
                          },
                        });
                      },
                }
              : undefined,
          body:
            active.mode === "contents" && buf
              ? {
                  kind: "text",
                  docKey: bufferKey(dir, active.path),
                  isBufferOpen: bufferIsOpenFor,
                  text: buf.text,
                  language: languageIdFor(active.path),
                  readOnly: active.editable === false,
                  tabSize: tabSizeFor(dir, active.path),
                }
              : active.body ?? (active.mode === "contents"
                  // a contents tab still loading: an empty read-only editor, not
                  // an empty DiffView (which draws a blank Changes surface under
                  // a header that says Contents)
                  ? {
                      kind: "text" as const,
                      docKey: bufferKey(dir, active.path),
                      isBufferOpen: bufferIsOpenFor,
                      text: "",
                      language: "plain" as const,
                      readOnly: true,
                      tabSize: 2,
                    }
                  : { kind: "diff" as const, rows: [] }),
          onEdit: (text) => editBuffer(dir, active.path, text),
          onSave: () => { void saveBuffer(dir, active.path).then(() => { savesLanded(dir, [active.path]); }); },
          onKeepMine: () => keepMine(dir, active.path),
          onReloadFromDisk: () => reloadBuffer(dir, active.path),
          onSelectTab: (id) => { rs.activeTab = id; rs.selectedId = id; rerender(); },
          onCloseTab: (id) => {
            const closeIt = () => {
              const i = rs.tabs.findIndex((t) => t.path === id);
              if (i >= 0) rs.tabs.splice(i, 1);
              closeBuffer(dir, id);
              if (rs.activeTab === id) rs.activeTab = rs.tabs[Math.max(0, i - 1)]?.path ?? null;
              rs.selectedId = rs.activeTab; // the tree follows the viewer
              rerender();
            };
            // asked live, not from the render's `dirtyNow`: the click lands
            // after the render that made this closure
            if (dirtyPathsFor(dir).includes(id)) confirmDirtyOne(dir, id, onConfirm, closeIt);
            else closeIt();
          },
          onModeChange: (mode) => {
            active.mode = mode;
            active.body = null;
            if (mode === "diff") loadDiff(active.path);
            else loadContents(active.path);
            rerender();
          },
          onCopy: () => {
            if (active.mode === "contents" && buf) {
              copyText(buf.text)
                .then(() => toastSuccess("Contents copied"))
                .catch((e) => toastError("Couldn't copy", String(e).slice(0, 90)));
            } else if (active.body?.kind === "huge" && (active.sizeBytes ?? 0) <= 5_000_000) {
              // the backend copies the full file — the 1.5MB preview cap doesn't apply
              copyFileIpc(dir, active.path)
                .then((n) => toastSuccess("Contents copied", `${Number(n).toLocaleString()} characters`))
                .catch((e) => toastError("Couldn't copy", String(e).slice(0, 90)));
            }
          },
          onReload: () => {
            active.body = null;
            rerender();
            if (active.mode === "diff") loadDiff(active.path);
            else loadContents(active.path);
          },
          onRetry: () => {
            active.body = null;
            rerender();
            if (active.mode === "diff") loadDiff(active.path);
            else loadContents(active.path);
          },
          onOpenAnyway:
            (active.sizeBytes ?? 0) > HUGE_CAP
              ? undefined
              : () => { active.body = null; rerender(); loadContents(active.path, true); },
          onOpenInWeb: isHtmlPath(active.path) && onOpenInWeb ? () => onOpenInWeb(active.path) : undefined,
        };
    view = { kind: "files", tree, viewer };
  }

  return <Repo view={view} treeWidth={treeWidth} onTreeSplitterDown={onTreeSplitterDown} />;
}

/** The editor asks this as it unmounts, about the key it was showing: a cached
 *  EditorState — undo history and all — may only outlive the mount while the
 *  buffer behind it is still open. Asked per key rather than answered from a
 *  closure over the active tab, because a tab switch tears the old editor down
 *  while the props already name the new file.
 *
 *  The key is `bufferKey(dir, path)`: the pair joined by the one separator a
 *  path cannot contain. */
function bufferIsOpenFor(key: string): boolean {
  const cut = key.indexOf("\0");
  if (cut < 0) return false;
  return bufferFor(key.slice(0, cut), key.slice(cut + 1)) !== null;
}

/* ---- unsaved work: ⌘S, and the one prompt that guards it ---- */

/** Did every one of these buffers actually reach the disk? `saveBuffer` never
 *  rejects — it parks the failure in the store — so this is the only honest
 *  answer to "can the tab close now?".
 *
 *  A write failure is a toast carrying the OS sentence, and the buffer stays
 *  dirty. A conflict is never a toast: the bar in the header is the one place
 *  that is said. Only the first stuck file is reported — a project-wide save
 *  that hits a read-only volume must not stack ten toasts. */
function savesLanded(dir: string, paths: string[]): boolean {
  const stuck = paths.filter((p) => {
    const b = bufferFor(dir, p);
    return b !== null && b.state !== "clean";
  });
  const first = stuck[0];
  if (first === undefined) return true;
  const b = bufferFor(dir, first);
  if (b?.state === "error") {
    toastError(`Couldn't save ${splitName(first).name}`, (b.error ?? "").slice(0, 90));
  }
  return false;
}

/** ⌘S from anywhere: save whatever the repo pane has open for this project. */
export function saveActiveFile(dir: string): void {
  const s = CACHE.get(dir);
  if (!s?.activeTab) return;
  const path = s.activeTab;
  void saveBuffer(dir, path).then(() => { savesLanded(dir, [path]); });
}

/** One file with unsaved work is about to go away. */
function confirmDirtyOne(
  dir: string,
  path: string,
  onConfirm: (spec: ConfirmSpec) => void,
  proceed: () => void,
): void {
  onConfirm({
    title: `Save ${splitName(path).name}?`,
    body: "It has changes you haven't saved yet.",
    cancelLabel: "Cancel",
    confirmLabel: "Save",
    // the tab goes away only if the write landed — a refused save that closed
    // the tab anyway would lose the text for good
    onConfirm: () => {
      void saveBuffer(dir, path).then(() => { if (savesLanded(dir, [path])) proceed(); });
    },
    altLabel: "Discard",
    onAlt: () => { proceed(); },
  });
}

/** Every file with unsaved work in this project is about to go away — closing
 *  the project, or quitting. One prompt, three answers. */
export function confirmDirty(
  dir: string,
  onConfirm: (spec: ConfirmSpec) => void,
  proceed: () => void,
): void {
  const paths = dirtyPathsFor(dir);
  if (paths.length === 0) { proceed(); return; }
  if (paths.length === 1) { confirmDirtyOne(dir, paths[0]!, onConfirm, proceed); return; }
  onConfirm({
    title: `Save ${paths.length} files?`,
    body: `${paths.map((p) => splitName(p).name).join(", ")} have changes you haven't saved yet.`,
    cancelLabel: "Cancel",
    confirmLabel: "Save them",
    onConfirm: () => {
      void Promise.all(paths.map((p) => saveBuffer(dir, p)))
        .then(() => { if (savesLanded(dir, paths)) proceed(); });
    },
    altLabel: "Discard",
    onAlt: () => { proceed(); },
  });
}
