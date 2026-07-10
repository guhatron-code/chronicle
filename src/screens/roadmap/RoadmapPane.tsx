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
  onGoKanban: () => void;
  onConfirm: (spec: ConfirmSpec) => void;
  onPollNow: () => void;
}) {
  const [initRun, setInitRun] = useState<InitRun | null>(null);
  const [copiedPath, setCopiedPath] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [warningDismissed, setWarningDismissed] = useState(false);
  const [consentLocal, setConsentLocal] = useState<"auto" | "manual" | "basic" | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirRef = useRef(dir);

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
          logLines: lines,
          activeLine: lines[lines.length - 1] ?? "Starting the session…",
          progress: initProgress(tail),
          code: st.code ?? null,
          elapsedS: Math.round((Date.now() - startedAt) / 1000),
        });
        if (st.running === false) {
          if ((st.code ?? 1) === 0) {
            setInitRun(null); // the roadmap appears on the next poll
            toastSuccess("The roadmap is written");
          }
          onPollNow();
        }
      } catch { /* keep the last shown state */ }
    };
    const id = setInterval(tick, 3000);
    void tick();
    return () => clearInterval(id);
  }, [dir, initRun?.running, initRun?.startedAt, onPollNow]);

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
            /* C6 seam: opens a terminal + starts the agent + copies the paste file.
               Until the terminal exists, do the honest part that works today. */
            const pf = (phase.paste ?? []).find((x) => x.path);
            if (pf?.path) doCopyDoc(pf.path);
          }}
        />
      );
    }
  }

  const ctx: RoadmapCtx = {
    agent,
    partOf,
    initRun,
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
      onCancelInit: () => {
        initCancel(dir)
          .then(() => { setInitRun(null); toastSuccess("Stopped the session"); })
          .catch((e) => toastError("Couldn't stop it", String(e).slice(0, 90)));
      },
      onViewFullLog: () => {/* C6: opens the session log as a terminal tab */},
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
          title: "Run this command?",
          body: cmd,
          cancelLabel: "Not yet",
          confirmLabel: risky ? "Run it — can't be undone" : "Run it",
          danger: risky,
          onConfirm: () => {
            runCommand(dir, cmd)
              .then((out) => {
                toastSuccess("Ran the command", String(out).split("\n")[0].slice(0, 90));
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
      onHistoryDetails: onGoRepo,
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
