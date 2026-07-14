/*
 * The roadmap pane container: owns the per-project init flow (consent → session →
 * settle), the copy flash, phase expansion, the phase-detail route, and implements
 * every RoadmapCtx handler against the typed IPC layer.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Roadmap } from "./Roadmap";
import { PhaseDetailHost } from "./PhaseDetailHost";
import {
  adoptManifest,
  copyFile,
  copyText,
  gitCheckout,
  gitInitHere,
  gitPull,
  gitPush,
  gitWorktreePrune,
  initCancel,
  initStart,
  initStatus,
  runCommand,
  setDefaultAgent,
  setInitConsent,
  type StateData,
} from "@/lib/ipc";
import {
  flatPhases,
  initProgress,
  logLinesFrom,
  mapRoadmap,
  type InitRun,
  type RoadmapCtx,
} from "@/lib/roadmap-data";
import { spawnTerm } from "@/lib/term-sessions";
import { fixesCancel, fixesStatus, initLogPath } from "@/lib/ipc";
import { kanbanFor, refreshKanban, subscribeKanban } from "@/lib/kanban-store";
import { toastError, toastSuccess } from "@/overlays/toasts";
import type { ConfirmSpec } from "@/overlays/ConfirmDialog";

export function RoadmapPane({
  dir,
  state,
  agent,
  partOf,
  justSwitched,
  onAgentChange,
  onOpenProject,
  onGoRepo,
  onGoHistory,
  onGoKanban,
  onConfirm,
  onPollNow,
}: {
  dir: string;
  state: StateData | null;
  agent: "claude" | "codex";
  partOf: { name: string; path: string } | null;
  justSwitched: boolean;
  onAgentChange: (a: "claude" | "codex") => void;
  onOpenProject: (path: string) => void;
  onGoRepo: () => void;
  onGoHistory: () => void;
  onGoKanban: () => void;
  onConfirm: (spec: ConfirmSpec) => void;
  onPollNow: () => void;
}) {
  const [initRun, setInitRun] = useState<InitRun | null>(null);
  const [fixesRun, setFixesRun] = useState<InitRun | null>(null);
  const [, kbBump] = useState(0);
  useEffect(() => subscribeKanban(() => kbBump((n) => n + 1)), []);
  const [copiedPath, setCopiedPath] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [warningDismissed, setWarningDismissed] = useState(false);
  const [consentLocal, setConsentLocal] = useState<"auto" | "manual" | "basic" | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirRef = useRef(dir);
  const stateRef = useRef(state);
  stateRef.current = state;

  /* per-project state resets when the project changes */
  useEffect(() => {
    if (dirRef.current !== dir) {
      dirRef.current = dir;
      setInitRun(null);
      setCopiedPath(null);
      setExpandedId(null);
      setDetailId(null);
      setWarningDismissed(false);
      setConsentLocal(null);
    }
  }, [dir]);

  /* the init session poll (3s while running) */
  useEffect(() => {
    if (!initRun?.running) return;
    const startedAt = initRun.startedAt;
    const tick = async () => {
      try {
        const st = (await initStatus(dir)) as { running?: boolean; started?: boolean; code?: number | null; log_tail?: string };
        const tail = st.log_tail ?? "";
        const lines = logLinesFrom(tail);
        setInitRun({
          running: st.running ?? false,
          startedAt,
          // the last line renders as activeLine — don't repeat it in the scrollback
          logLines: lines.slice(0, -1),
          activeLine: lines[lines.length - 1] ?? "Starting the session…",
          progress: initProgress(tail),
          code: st.code ?? null,
          elapsedS: Math.round((Date.now() - startedAt) / 1000),
        });
        if (st.running === false) {
          if ((st.code ?? 1) === 0) {
            setInitRun(null); // the roadmap appears on the next poll
            toastSuccess("The roadmap is written");
          } else if (stateRef.current?.manifest_present) {
            // a failed REBUILD has no problem-card home (the old roadmap still shows) —
            // say so instead of vanishing silently
            setInitRun(null);
            toastError("The rebuild didn't finish", `Session exited with code ${st.code ?? "?"} — the existing roadmap is untouched`);
          }
          onPollNow();
        }
      } catch { /* keep the last shown state */ }
    };
    const id = setInterval(tick, 3000);
    void tick();
    return () => clearInterval(id);
  }, [dir, initRun?.running, initRun?.startedAt, onPollNow]);

  /* a kanban round is generating → mirror its session on the roadmap (3s poll) */
  const generating = kanbanFor(dir).rounds.some((r) => r.state === "generating");
  useEffect(() => {
    if (!generating) { setFixesRun(null); return; }
    const startedAt = Date.now();
    const tick = async () => {
      try {
        const st = (await fixesStatus(dir)) as { running?: boolean; code?: number | null; log_tail?: string };
        const tail = st.log_tail ?? "";
        const lines = logLinesFrom(tail);
        if (st.running !== false) {
          setFixesRun((prev) => ({
            running: true,
            startedAt: prev?.startedAt ?? startedAt,
            logLines: lines.slice(0, -1),
            activeLine: lines[lines.length - 1] ?? "Starting the session…",
            progress: initProgress(tail),
            code: null,
            elapsedS: Math.round((Date.now() - (prev?.startedAt ?? startedAt)) / 1000),
          }));
        } else {
          setFixesRun(null);
          await refreshKanban(dir);
          if ((st.code ?? 1) === 0) toastSuccess("The fix plan is written", "The round is on your roadmap");
          onPollNow();
        }
      } catch { /* keep the last shown state */ }
    };
    const id = setInterval(tick, 3000);
    void tick();
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dir, generating]);

  const startInit = useCallback(() => {
    const startedAt = Date.now();
    setInitRun({ running: true, startedAt, logLines: [], activeLine: "Starting the session…", progress: 0.06, code: null, elapsedS: 0 });
    initStart(dir, agent).catch((e) => {
      setInitRun(null);
      toastError("Couldn't start the session", String(e).slice(0, 90));
    });
  }, [dir, agent]);

  const doCopyDoc = useCallback((path: string) => {
    copyFile(dir, path)
      .then((n) => {
        setCopiedPath(path);
        if (copyTimer.current) clearTimeout(copyTimer.current);
        copyTimer.current = setTimeout(() => setCopiedPath(null), 1800);
        toastSuccess(`Copied ${path.split("/").pop()}`, `${Number(n).toLocaleString()} characters`);
      })
      .catch((e) => toastError("Couldn't copy it", String(e).slice(0, 90)));
  }, [dir]);

  if (!state) {
    return <div className="flex h-full items-center justify-center font-mono text-[11.5px] text-text-dim">Checking…</div>;
  }

  /* the phase-detail route */
  if (detailId) {
    const phases = flatPhases(state);
    const idx = phases.findIndex((p) => p.id === detailId);
    const phase = phases[idx];
    if (phase) {
      return (
        <PhaseDetailHost
          dir={dir}
          phase={phase}
          status={state.statuses[idx] ?? null}
          onBack={() => setDetailId(null)}
          onCopyDoc={doCopyDoc}
          onStart={() => {
            const pf = (phase.paste ?? []).find((x) => x.path);
            spawnTerm(dir, { agent, title: phase.id })
              .then(() => {
                if (pf?.path) doCopyDoc(pf.path);
                else toastSuccess("Session started", `${agent === "codex" ? "Codex" : "Claude"} is starting in the terminal`);
              })
              .catch((e) => toastError("Couldn't start a terminal", String(e).slice(0, 90)));
          }}
        />
      );
    }
  }

  const ctx: RoadmapCtx = {
    agent,
    partOf,
    initRun,
    fixesRun,
    consent: consentLocal ?? state.init_consent,
    copiedPath,
    expandedId,
    justSwitched,
    publishing,
    warningDismissed,
    handlers: {
      onAgentChange: (a) => {
        onAgentChange(a);
        void setDefaultAgent(a).catch(() => {});
      },
      onBuild: () => {
        setConsentLocal("auto");
        setInitConsent(dir, "auto").catch(() => {});
        startInit();
      },
      onRunMyself: () => {
        setConsentLocal("manual");
        setInitConsent(dir, "manual").catch(() => {});
        copyText("/chronicle-init")
          .then(() => toastSuccess("Copied the prompt", "/chronicle-init — paste it in a session"))
          .catch(() => {});
      },
      onBasicView: () => {
        setConsentLocal("basic");
        setInitConsent(dir, "basic").catch(() => {});
      },
      onCancelFixes: () => {
        fixesCancel(dir)
          .then(() => { setFixesRun(null); void refreshKanban(dir); toastSuccess("Stopped the session"); })
          .catch((e) => toastError("Couldn't stop it", String(e).slice(0, 90)));
      },
      onCancelInit: () => {
        initCancel(dir)
          .then(() => { setInitRun(null); toastSuccess("Stopped the session"); })
          .catch((e) => toastError("Couldn't stop it", String(e).slice(0, 90)));
      },
      onViewFullLog: () => {
        initLogPath(dir)
          .then((path) =>
            spawnTerm(dir, { title: "Roadmap log", autoType: `tail -n 200 -f '${path.replace(/'/g, "'\\''")}'` }),
          )
          .catch((e) => toastError("Couldn't open the log", String(e).slice(0, 90)));
      },
      onScan: startInit,
      onRebuild: () =>
        onConfirm({
          title: "Rebuild the roadmap?",
          body: "A Claude session will read the plan documents again and rewrite the roadmap. Your files aren't changed.",
          cancelLabel: "Cancel",
          confirmLabel: "Rebuild",
          onConfirm: startInit,
        }),
      onDismissWarning: () => setWarningDismissed(true),
      onOpenPartOf: onOpenProject,
      onOpenFile: () => onGoRepo(),
      onMoveManifest: (sub) => {
        adoptManifest(dir, sub)
          .then(() => { toastSuccess("Moved the roadmap here"); onPollNow(); })
          .catch((e) => toastError("Couldn't move it", String(e).slice(0, 90)));
      },
      onAction: (id, arg) => {
        const run = async () => {
          setPublishing(true);
          try {
            if (id === "push" || id === "publish-first") { await gitPush(dir); toastSuccess("Published"); }
            else if (id === "pull") { await gitPull(dir); toastSuccess("Brought it down"); }
            else if (id === "branch") { await gitCheckout(dir, arg); toastSuccess(`Switched to ${arg}`); }
            else if (id === "prune") { await gitWorktreePrune(dir); toastSuccess("Cleaned up"); }
            onPollNow();
          } catch (e) {
            toastError("That didn't finish", String(e).split("\n")[0].slice(0, 110));
          } finally {
            setPublishing(false);
          }
        };
        void run();
      },
      onRunCustom: (cmd) => {
        const risky = /gh repo create|worktree remove|--force|--hard|\brm\s|\bdelete\b|reset --hard/i.test(cmd);
        onConfirm({
          title: "Execute this command?",
          body: cmd,
          cancelLabel: "Not yet",
          confirmLabel: risky ? "Execute — can't be undone" : "Execute",
          danger: risky,
          onConfirm: () => {
            runCommand(dir, cmd)
              .then((out) => {
                toastSuccess("Executed", String(out).split("\n")[0].slice(0, 90));
                onPollNow();
              })
              .catch((e) => toastError("That didn't finish", String(e).split("\n")[0].slice(0, 110)));
          },
        });
      },
      onCopyCommand: (cmd) => {
        copyText(cmd)
          .then(() => toastSuccess("Copied the command", cmd.length > 44 ? cmd.slice(0, 42) + "…" : cmd))
          .catch((e) => toastError("Couldn't copy it", String(e).slice(0, 90)));
      },
      onCopyDoc: doCopyDoc,
      onTogglePhase: (id) => {
        const nowId = state.statuses.find((x) => x.state === "now")?.id ?? null;
        setExpandedId((cur) => {
          const effectiveOpen = cur === null ? nowId : cur === "__none__" ? null : cur;
          return effectiveOpen === id ? "__none__" : id;
        });
      },
      onViewDetails: setDetailId,
      onHistoryDetails: onGoHistory,
      onStartHistory: () => {
        gitInitHere(dir)
          .then(() => { toastSuccess("History started"); onPollNow(); })
          .catch((e) => toastError("Couldn't start history", String(e).slice(0, 90)));
      },
      onAddNext: onGoKanban,
      onReadDecision: setDetailId,
    },
  };

  return <Roadmap {...mapRoadmap(state, ctx)} />;
}
