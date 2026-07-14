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
  copyText,
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
  statFile,
  type FileStat,
  type StateData,
} from "@/lib/ipc";
import {
  buildTree,
  changeGroups,
  changedPaths,
  codeLines,
  extOf,
  fmtBytes,
  gitLetterMap,
  mapCommits,
  parseDiff,
  publishStateFrom,
  splitName,
  type DirLoad,
  type GitStatus,
} from "@/lib/repo-data";
import { toastError, toastSuccess } from "@/overlays/toasts";
import type { ConfirmSpec } from "@/overlays/ConfirmDialog";

/* ---- per-project state, surviving pane switches and project tabs ---- */

interface TabState {
  path: string;
  mode: "contents" | "diff";
  body: ViewerBody | null; // null = loading
  meta?: string;
  diffStat?: { added: number; removed: number };
  mtime?: number; // as loaded — freshness baseline
  changedOnDisk?: boolean;
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
    };
    CACHE.set(dir, s);
  }
  return s;
}

/** Open the project-history view next time the repo pane mounts for `dir` —
 * lets the roadmap's history panel land directly on the L4 pane. Back/Close
 * return to the caller's surface. */
export function openHistoryView(dir: string, from: "repo" | "roadmap" = "roadmap") {
  const s = stateFor(dir);
  s.historyView = true;
  s.historyFrom = from;
}

const HUGE_WARN = 300_000; // "Reading it may be slow."
const HUGE_CAP = 1_500_000; // the backend refuses text reads past this

const IMG_MIME: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  webp: "image/webp", svg: "image/svg+xml", bmp: "image/bmp", ico: "image/x-icon",
  heic: "image/heic", avif: "image/avif",
};

export function RepoPane({
  dir,
  state,
  onConfirm,
  onPollNow,
  onGoRoadmap,
}: {
  dir: string;
  state: StateData | null;
  onConfirm: (spec: ConfirmSpec) => void;
  onPollNow: () => void;
  /** History entered from the roadmap returns there on Back/Close. */
  onGoRoadmap?: () => void;
}) {
  const rs = stateFor(dir);
  const [, bump] = useState(0);
  const rerender = useCallback(() => bump((n) => n + 1), []);
  const [gitStatus, setGitStatus] = useState<GitStatus | null>(null);
  const [log, setLog] = useState<HistoryReady["commits"]>([]);
  const [arcs, setArcs] = useState<HistoryReady["branches"]>([]);
  const [logCount, setLogCount] = useState(0);
  const [historyLoading, setHistoryLoading] = useState(true);
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
        stateFor(d).loads.set(path, { kind: "ready", entries });
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
        setGitStatus(st);
      })
      .catch(() => {
        if (dirRef.current !== d) return;
        setGitStatus(null);
      });
    gitLogGraph(d, stateFor(d).logLimit)
      .then((rows) => {
        if (dirRef.current !== d) return;
        const branch = state?.branch ?? null;
        const mapped = mapCommits(rows, branch);
        setLog(mapped.commits);
        setArcs(mapped.branches);
        setLogCount(rows.length);
        setHistoryLoading(false);
      })
      .catch(() => {
        if (dirRef.current !== d) return;
        setLog([]);
        setArcs([]);
        setHistoryLoading(false);
      });
  }, [dir, state?.branch]);

  /* freshness: re-stat open tabs; flag the ones that changed on disk */
  const checkFreshness = useCallback(() => {
    const d = dir;
    for (const tab of stateFor(d).tabs) {
      if (tab.mtime == null) continue;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dir]);

  /* the App 8s poll lands as a checked_at change — piggyback for git + freshness */
  const checkedAt = state?.checked_at ?? null;
  useEffect(() => {
    refreshGit();
    checkFreshness();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkedAt]);

  useEffect(() => {
    const onFocus = () => checkFreshness();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [checkFreshness]);

  /* ---- the viewer: open / load / mode / freshness ---- */

  const loadContents = useCallback((path: string, ignoreGuard = false) => {
    const d = dir;
    const tab = () => stateFor(d).tabs.find((t) => t.path === path);
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
        } else if (st.kind === "binary") {
          t.body = {
            kind: "binary",
            message: "This is a binary file — there's nothing readable to show.",
            note: "Size",
            detail: fmtBytes(st.size),
          };
          t.meta = undefined;
        } else if (st.size > HUGE_WARN && !ignoreGuard) {
          t.body = {
            kind: "huge",
            message: `This file is ${fmtBytes(st.size)}`,
            note: st.size > HUGE_CAP ? "Too large to preview — click-to-copy still works." : "Reading it may be slow.",
          };
          t.meta = undefined;
          if (st.size > HUGE_CAP) hugePastCap.current.add(path);
          else hugePastCap.current.delete(path);
        } else {
          const text = await readFile(d, path);
          if (dirRef.current !== d) return;
          const lines = codeLines(text);
          t.body = { kind: "code", lines };
          t.meta = `${extOf(path) || "file"} · ${lines.length} line${lines.length === 1 ? "" : "s"}`;
        }
        t.mtime = st.mtime;
        t.changedOnDisk = false;
        rerender();
      })
      .catch((e) => {
        if (dirRef.current !== d) return;
        const t = tab();
        if (!t) return;
        t.body = { kind: "read-error", message: "This file couldn't be read", detail: String(e).slice(0, 120) };
        t.meta = undefined;
        rerender();
      });
  }, [dir, rerender]);

  const loadDiff = useCallback((path: string) => {
    const d = dir;
    const st = gitStatus;
    const un = st?.unstaged.find((f) => f.path === path);
    const staged = !un && !!st?.staged.find((f) => f.path === path);
    gitDiff(d, path, staged, !!un?.untracked)
      .then((raw) => {
        if (dirRef.current !== d) return;
        const t = stateFor(d).tabs.find((x) => x.path === path);
        if (!t) return;
        const { rows, added, removed } = parseDiff(raw);
        t.body = { kind: "diff", rows };
        t.diffStat = { added, removed };
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

  const hugePastCap = useRef(new Set<string>());

  const openFile = useCallback((path: string) => {
    const s = stateFor(dir);
    s.selectedId = path;
    if (!s.tabs.find((t) => t.path === path)) {
      s.tabs.push({ path, mode: "contents", body: null });
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
    refreshGit();
    onPollNow();
  }, [refreshGit, onPollNow]);

  const opError = useCallback((title: string) => (e: unknown) => {
    const s = stateFor(dirRef.current);
    s.banner = `${title} — ${String(e).slice(0, 110)}`;
    toastError(title, String(e).slice(0, 90));
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
            banner: rs.banner,
            message: rs.message,
            readyToSave: gitStatus ? gitStatus.staged.map((f) => ({ ...splitName(f.path), path: f.path })) : [],
            changes: gitStatus ? changeGroups(gitStatus, rs.closedGroups) : [],
            publish: publishStateFrom(state ?? {}),
            commits: log,
            branches: arcs,
            hasMore: logCount >= rs.logLimit,
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
        onSave: () => {
          const msg = rs.message.trim();
          if (!msg) return;
          gitCommit(dir, msg, false)
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
        onPush: () => { gitPush(dir).then(() => afterGitOp("Published")).catch(opError("Couldn't publish")); },
        onPull: () => { gitPull(dir).then(() => afterGitOp("Brought down the newer saves")).catch(opError("Couldn't bring them down")); },
        onCopySetup: () => {
          copyText(`gh repo create ${slug} --private --source=. --push`)
            .then(() => toastSuccess("Command copied", "Paste it into a terminal to put this project on GitHub"))
            .catch(opError("Couldn't copy it"));
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
    const tree: FileTreeProps = {
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
      ),
      selectedId: rs.selectedId,
      onSelect: openFile,
      onToggleDir,
      onRetry: (id) => loadDir(id === "#root" ? "" : id),
      onOpenHistory: () => { rs.historyView = true; rs.historyFrom = "repo"; rerender(); },
    };
    const active = rs.tabs.find((t) => t.path === rs.activeTab);
    const viewer: ViewerProps = !active
      ? { kind: "empty" }
      : {
          kind: "file",
          tabs: rs.tabs.map((t) => ({ id: t.path, name: splitName(t.path).name })),
          activeTabId: active.path,
          path: active.path,
          mode: active.mode,
          meta: active.mode === "contents" ? active.meta : undefined,
          diffStat: active.mode === "diff" ? active.diffStat : undefined,
          changedOnDisk: active.changedOnDisk,
          body: active.body ?? { kind: "code", lines: [] },
          onSelectTab: (id) => { rs.activeTab = id; rs.selectedId = id; rerender(); },
          onCloseTab: (id) => {
            const i = rs.tabs.findIndex((t) => t.path === id);
            if (i >= 0) rs.tabs.splice(i, 1);
            if (rs.activeTab === id) rs.activeTab = rs.tabs[Math.max(0, i - 1)]?.path ?? null;
            rerender();
          },
          onModeChange: (mode) => {
            active.mode = mode;
            active.body = null;
            if (mode === "diff") loadDiff(active.path);
            else loadContents(active.path);
            rerender();
          },
          onCopy: () => {
            if (active.body?.kind === "code") {
              copyText(active.body.lines.map((l) => l.map((s) => s.t).join("")).join("\n"))
                .then(() => toastSuccess("Contents copied"))
                .catch((e) => toastError("Couldn't copy", String(e).slice(0, 90)));
            }
          },
          onReload: () => { active.body = null; rerender(); loadContents(active.path); },
          onRetry: () => {
            active.body = null;
            rerender();
            if (active.mode === "diff") loadDiff(active.path);
            else loadContents(active.path);
          },
          onOpenAnyway: hugePastCap.current.has(active.path)
            ? undefined
            : () => { active.body = null; rerender(); loadContents(active.path, true); },
        };
    view = { kind: "files", tree, viewer };
  }

  return <Repo view={view} treeWidth={treeWidth} onTreeSplitterDown={onTreeSplitterDown} />;
}
