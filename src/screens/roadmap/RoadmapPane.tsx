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
  execLogPath,
  githubCreate,
  journalRead,
  statusReport,
  initCancel,
  roundExecCancel,
  roundExecStatus,
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
import { setActiveTermFor, spawnTerm, termsFor } from "@/lib/term-sessions";
import { AWAY_THRESHOLD_MS, announce, lastSeen, markSeen } from "@/lib/journal";
import { openFileInRepo } from "@/screens/repo/RepoPane";
import { fixesCancel, fixesLogPath, fixesStatus, initLogPath } from "@/lib/ipc";
import { kanbanFor, refreshKanban, subscribeKanban } from "@/lib/kanban-store";
import { setInitRunning } from "@/lib/run-flags";
import { toastError, toastSuccess, toastRemoteOutcome } from "@/overlays/toasts";
import { humanError, humanGitError } from "@/lib/utils";
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
  onStartPhaseWithAgent,
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
  /** F38 — reveal the agent pane and preload this phase's prompt as a draft. */
  onStartPhaseWithAgent: (phaseId: string, promptPath: string | null) => void;
}) {
  const [initRun, setInitRunRaw] = useState<InitRun | null>(null);
  const setInitRun = useCallback((v: InitRun | null | ((prev: InitRun | null) => InitRun | null)) => {
    setInitRunRaw((prev) => {
      const next = typeof v === "function" ? v(prev) : v;
      setInitRunning(dirRef.current, !!next?.running);
      return next;
    });
  }, []);
  const [fixesRun, setFixesRun] = useState<InitRun | null>(null);
  const [execRun, setExecRun] = useState<InitRun | null>(null);
  const [digest, setDigest] = useState<{ ts: number; text: string }[] | null>(null);
  const [, kbBump] = useState(0);
  useEffect(() => subscribeKanban(() => kbBump((n) => n + 1)), []);
  const [copiedPath, setCopiedPath] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [justDoneId, setJustDoneId] = useState<string | null>(null);
  const prevDone = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!state) return; // no baseline until real statuses exist (else first paint fakes a flip)
    const done = new Set(state.statuses.filter((x) => x.state === "done").map((x) => x.id));
    if (prevDone.current) {
      const fresh = [...done].find((id) => !prevDone.current!.has(id));
      if (fresh) {
        setJustDoneId(fresh);
        const t = setTimeout(() => setJustDoneId(null), 4000);
        prevDone.current = done;
        return () => clearTimeout(t);
      }
    }
    prevDone.current = done;
  }, [state?.statuses]);
  const [publishing, setPublishing] = useState(false);
  const [warningDismissed, setWarningDismissed] = useState(false);
  const [consentLocal, setConsentLocal] = useState<"auto" | "manual" | "basic" | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirRef = useRef(dir);
  const stateRef = useRef(state);
  stateRef.current = state;
  const onPollNowRef = useRef(onPollNow);
  onPollNowRef.current = onPollNow;

  /* the away digest: entries recorded since the user last looked (F2) */
  useEffect(() => {
    const d = dir;
    const seen = lastSeen(d);
    if (seen > 0 && Date.now() - seen > AWAY_THRESHOLD_MS) {
      journalRead(d, seen)
        .then((entries) => {
          if (dirRef.current !== d || !Array.isArray(entries) || entries.length === 0) return;
          setDigest(entries.map((e) => ({ ts: e.ts, text: e.text })));
        })
        .catch(() => {});
    }
    markSeen(d);
  }, [dir]);

  /* looking at the roadmap = caught up — advance the seen marker on each poll */
  useEffect(() => {
    if (document.hasFocus()) markSeen(dir);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.checked_at, dir]);

  /* per-project state resets when the project changes — then the backend is
     asked whether a build session is still running here, so a rebuild started
     before a tab switch picks its progress card straight back up */
  useEffect(() => {
    if (dirRef.current !== dir) {
      dirRef.current = dir;
      setInitRun(null);
      setCopiedPath(null);
      setExpandedId(null);
      setDetailId(null);
      setWarningDismissed(false);
      setConsentLocal(null);
      setJustDoneId(null);
      prevDone.current = null; // a different project needs a fresh baseline
    }
    const d = dir;
    initStatus(d)
      .then((raw) => {
        const st = raw as { running?: boolean; log_tail?: string; started_at?: number };
        if (dirRef.current !== d || !st?.running) return;
        const tail = st.log_tail ?? "";
        const lines = logLinesFrom(tail);
        const began = st.started_at || Date.now();
        setInitRun((prev) => prev ?? {
          running: true,
          startedAt: began,
          logLines: lines.slice(0, -1),
          activeLine: lines[lines.length - 1] ?? "Starting the session…",
          progress: initProgress(tail),
          code: null,
          elapsedS: Math.round((Date.now() - began) / 1000),
        });
      })
      .catch(() => {});
  }, [dir]);

  /* self-heal on every App poll: if no card is showing but the backend has a
     live session for this project (lost track via tab switch, re-open, HMR),
     pick it back up */
  const checkedAt = state?.checked_at ?? null;
  useEffect(() => {
    if (initRun) return;
    const d = dir;
    initStatus(d)
      .then((raw) => {
        const st = raw as { running?: boolean; log_tail?: string; started_at?: number };
        if (dirRef.current !== d || !st?.running) return;
        const tail = st.log_tail ?? "";
        const lines = logLinesFrom(tail);
        const began = st.started_at || Date.now();
        setInitRun((prev) => prev ?? {
          running: true,
          startedAt: began,
          logLines: lines.slice(0, -1),
          activeLine: lines[lines.length - 1] ?? "Starting the session…",
          progress: initProgress(tail),
          code: null,
          elapsedS: Math.round((Date.now() - began) / 1000),
        });
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkedAt, dir, initRun == null]);

  /* the init session poll (3s while running) */
  useEffect(() => {
    if (!initRun?.running) return;
    const startedAt = initRun.startedAt;
    const tick = async () => {
      try {
        const st = (await initStatus(dir)) as { running?: boolean; started?: boolean; code?: number | null; log_tail?: string; started_at?: number };
        if (dirRef.current !== dir) return; // a late reply must not cross projects
        const tail = st.log_tail ?? "";
        const lines = logLinesFrom(tail);
        const began = st.started_at || startedAt;
        setInitRun({
          running: st.running ?? false,
          startedAt: began,
          // the last line renders as activeLine — don't repeat it in the scrollback
          logLines: lines.slice(0, -1),
          activeLine: lines[lines.length - 1] ?? "Starting the session…",
          progress: initProgress(tail),
          code: st.code ?? null,
          elapsedS: Math.round((Date.now() - began) / 1000),
        });
        if (st.running === false) {
          if ((st.code ?? 1) === 0) {
            setInitRun(null); // the roadmap appears on the next poll
            toastSuccess("The roadmap is written");
            announce(dir, "roadmap", "The roadmap was written", "Chronicle");
          } else if (stateRef.current?.manifest_present) {
            // a failed REBUILD has no problem-card home (the old roadmap still shows) —
            // say so instead of vanishing silently
            setInitRun(null);
            toastError("The rebuild didn't finish", `Session exited with code ${st.code ?? "?"} — the existing roadmap is untouched`);
          }
          onPollNowRef.current();
        }
      } catch { /* keep the last shown state */ }
    };
    const id = setInterval(tick, 3000);
    void tick();
    return () => clearInterval(id);
  }, [dir, initRun?.running, initRun?.startedAt]);

  /* a headless round execution is live → mirror it on the roadmap (3s poll) */
  const kb = kanbanFor(dir);
  const execRoundN = (() => {
    for (const r of [...kb.rounds].reverse()) {
      if (r.state !== "ready") continue;
      const mine = kb.tasks.filter((t) => t.round === r.n && !t.archived);
      if (mine.length > 0 && mine.some((t) => t.column !== "completed")) return r.n;
    }
    return null;
  })();
  useEffect(() => {
    if (execRoundN == null) { setExecRun(null); return; }
    const startedAt = Date.now();
    let sawLive = false;
    const tick = async () => {
      try {
        const st = await roundExecStatus(dir);
        if (dirRef.current !== dir) return;
        const tail = st.log_tail ?? "";
        const lines = logLinesFrom(tail);
        if (st.running === true) {
          sawLive = true;
          const began = st.started_at || startedAt;
          setExecRun({
            running: true,
            startedAt: began,
            logLines: lines.slice(0, -1),
            activeLine: lines[lines.length - 1] ?? "Starting the session…",
            progress: initProgress(tail),
            code: null,
            elapsedS: Math.round((Date.now() - began) / 1000),
          });
        } else {
          setExecRun(null);
          if (sawLive) {
            sawLive = false;
            void refreshKanban(dir);
            if ((st.code ?? 1) === 0) {
              toastSuccess("The round finished", "Check the board — completed tasks are ticked");
              announce(dir, "round-done", `Round ${execRoundN} finished`, "Chronicle");
            } else {
              toastError("The round session ended", `Exited with code ${st.code ?? "?"} — unfinished tasks stay on the board`);
              announce(dir, "round-ended", `Round ${execRoundN} ended early`, "Chronicle");
            }
            onPollNowRef.current();
          }
        }
      } catch { /* keep the last shown state */ }
    };
    const id = setInterval(tick, 3000);
    void tick();
    return () => clearInterval(id);
  }, [dir, execRoundN]);

  /* a kanban round is generating → mirror its session on the roadmap (3s poll) */
  const generating = kanbanFor(dir).rounds.some((r) => r.state === "generating");
  useEffect(() => {
    if (!generating) { setFixesRun(null); return; }
    const startedAt = Date.now();
    const tick = async () => {
      try {
        const st = (await fixesStatus(dir)) as { running?: boolean; code?: number | null; log_tail?: string; started_at?: number };
        if (dirRef.current !== dir) return; // a late reply must not cross projects
        const tail = st.log_tail ?? "";
        const lines = logLinesFrom(tail);
        if (st.running === true) {
          const began = st.started_at || startedAt;
          setFixesRun(() => ({
            running: true,
            startedAt: began,
            logLines: lines.slice(0, -1),
            activeLine: lines[lines.length - 1] ?? "Starting the session…",
            progress: initProgress(tail),
            code: null,
            elapsedS: Math.round((Date.now() - began) / 1000),
          }));
        } else {
          setFixesRun(null);
          await refreshKanban(dir);
          if ((st.code ?? 1) === 0) {
            toastSuccess("The fix plan is written", "The round is on your roadmap");
            announce(dir, "round-plan", "A round's fix plan is ready", "Chronicle");
          }
          onPollNowRef.current();
        }
      } catch { /* keep the last shown state */ }
    };
    const id = setInterval(tick, 3000);
    void tick();
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dir, generating]);

  /** fresh: an explicit Rebuild re-derives chronicle.json from scratch; a first
   *  build (or a plan-drift refresh) keeps the skill's diff-and-patch mode. */
  const startInit = useCallback((fresh = false) => {
    const startedAt = Date.now();
    setInitRun({ running: true, startedAt, logLines: [], activeLine: "Starting the session…", progress: 0.06, code: null, elapsedS: 0 });
    initStart(dir, agent, fresh).catch((e) => {
      setInitRun(null);
      toastError("Couldn't start the session", String(e).slice(0, 90));
    });
  }, [dir, agent]);

  const doCopyDoc = useCallback((path: string, pasteHint?: string) => {
    copyFile(dir, path)
      .then((n) => {
        setCopiedPath(path);
        if (copyTimer.current) clearTimeout(copyTimer.current);
        copyTimer.current = setTimeout(() => setCopiedPath(null), 1800);
        toastSuccess(
          `Copied ${path.split("/").pop()}`,
          pasteHint ?? `${Number(n).toLocaleString()} characters`,
        );
      })
      .catch((e) => toastError("Couldn't copy it", humanError(e)));
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
          projectState={state}
          onBack={() => setDetailId(null)}
          onCopyDoc={doCopyDoc}
          onStartAgent={() => {
            const pf = (phase.paste ?? []).find((x) => x.path)?.path ?? null;
            onStartPhaseWithAgent(phase.id ?? "?", pf);
          }}
          onStart={() => {
            const agentName = agent === "codex" ? "Codex" : "Claude";
            const pf = (phase.paste ?? []).find((x) => x.path);
            const pasteHint = `When ${agentName} is ready, paste it (⌘V) as the first message`;
            // already started once — foreground that session instead of stacking a twin
            const existing = termsFor(dir).find((t) => t.title === phase.id && !t.dead);
            if (existing) {
              setActiveTermFor(dir, existing.id);
              if (pf?.path) doCopyDoc(pf.path, pasteHint);
              else toastSuccess("Already running", `The ${phase.id} session is in the terminal`);
              return;
            }
            spawnTerm(dir, { agent, title: phase.id })
              .then(() => {
                if (pf?.path) doCopyDoc(pf.path, pasteHint);
                else toastSuccess("Session started", `${agentName} is starting in the terminal`);
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
    execRun,
    execRoundN,
    digest,
    consent: consentLocal ?? state.init_consent,
    copiedPath,
    expandedId,
    justDoneId,
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
        startInit(); // first build — refresh mode is correct here
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
      onDismissDigest: () => { setDigest(null); markSeen(dir); },
      onCopyStatus: () => {
        statusReport(dir)
          .then((md) => copyText(md))
          .then(() => toastSuccess("Status report copied", "Paste it anywhere — it's markdown"))
          .catch((e) => toastError("Couldn't build the report", String(e).slice(0, 90)));
      },
      onCancelExec: () => {
        roundExecCancel(dir)
          .then(() => { setExecRun(null); void refreshKanban(dir); toastSuccess("Stopped the round", "Finished tasks stay done; the rest are still on the board"); })
          .catch((e) => toastError("Couldn't stop it", String(e).slice(0, 90)));
      },
      onViewExecLog: () => {
        const existing = termsFor(dir).find((t) => t.title === "Round log" && !t.dead);
        if (existing) {
          setActiveTermFor(dir, existing.id);
          return;
        }
        execLogPath(dir)
          .then((path) =>
            spawnTerm(dir, { title: "Round log", autoType: `tail -n 200 -f '${path.replace(/'/g, "'\\''")}'` }),
          )
          .catch((e) => toastError("Couldn't open the log", String(e).slice(0, 90)));
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
      onViewFixesLog: () => {
        const existing = termsFor(dir).find((t) => t.title === "Fix plan log" && !t.dead);
        if (existing) {
          setActiveTermFor(dir, existing.id);
          return;
        }
        fixesLogPath(dir)
          .then((path) =>
            spawnTerm(dir, { title: "Fix plan log", autoType: `tail -n 200 -f '${path.replace(/'/g, "'\\''")}'` }),
          )
          .catch((e) => toastError("Couldn't open the log", String(e).slice(0, 90)));
      },
      onViewFullLog: () => {
        const existing = termsFor(dir).find((t) => t.title === "Roadmap log" && !t.dead);
        if (existing) {
          setActiveTermFor(dir, existing.id);
          return;
        }
        initLogPath(dir)
          .then((path) =>
            spawnTerm(dir, { title: "Roadmap log", autoType: `tail -n 200 -f '${path.replace(/'/g, "'\\''")}'` }),
          )
          .catch((e) => toastError("Couldn't open the log", String(e).slice(0, 90)));
      },
      onScan: () =>
        onConfirm({
          title: "Rebuild the roadmap?",
          body: `${agent === "codex" ? "A Codex" : "A Claude"} session will read the plan documents again and rewrite the roadmap. Your files aren't changed.`,
          cancelLabel: "Not yet",
          confirmLabel: "Rebuild",
          onConfirm: () => startInit(true), // Rebuild = from scratch, not refresh
        }),
      onRebuild: () =>
        onConfirm({
          title: "Rebuild the roadmap?",
          body: `${agent === "codex" ? "A Codex" : "A Claude"} session will read the plan documents again and rewrite the roadmap. Your files aren't changed.`,
          cancelLabel: "Not yet",
          confirmLabel: "Rebuild",
          onConfirm: () => startInit(true), // Rebuild = from scratch, not refresh
        }),
      onDismissWarning: () => setWarningDismissed(true),
      onOpenPartOf: onOpenProject,
      onOpenFile: (path) => {
        openFileInRepo(dir, path || "chronicle.json");
        onGoRepo();
      },
      onMoveManifest: (sub) => {
        adoptManifest(dir, sub)
          .then(() => { toastSuccess("Moved the roadmap here"); onPollNow(); })
          .catch((e) => toastError("Couldn't move it", String(e).slice(0, 90)));
      },
      onAction: (id, arg) => {
        if (publishing) return; // single-flight: no double-fire while one runs
        if (id === "github") {
          // creating the online copy is outward-facing — always confirmed
          onConfirm({
            title: "Put this project on GitHub?",
            body: `Creates a private repository "${arg}" under your GitHub account and publishes every save — using your gh sign-in. You can make it public on GitHub any time.`,
            cancelLabel: "Not yet",
            confirmLabel: "Create and publish",
            onConfirm: () => {
              setPublishing(true);
              githubCreate(dir)
                .then((name) => { toastSuccess("Published online", `${name} — private, under your account`); onPollNow(); })
                .catch((e) => toastError("That didn't finish", humanGitError(e)))
                .finally(() => setPublishing(false));
            },
          });
          return;
        }
        const run = async () => {
          setPublishing(true);
          try {
            if (id === "push" || id === "publish-first") { toastRemoteOutcome(await gitPush(dir)); }
            else if (id === "pull") { toastRemoteOutcome(await gitPull(dir)); }
            else if (id === "branch") { await gitCheckout(dir, arg); toastSuccess(`Switched to ${arg}`); }
            else if (id === "prune") { await gitWorktreePrune(dir); toastSuccess("Cleaned up"); }
            onPollNow();
          } catch (e) {
            const gitMove = id === "push" || id === "publish-first" || id === "pull";
            toastError("That didn't finish", gitMove ? humanGitError(e) : String(e).split("\n")[0].slice(0, 110));
          } finally {
            setPublishing(false);
          }
        };
        void run();
      },
      onRunCustom: (cmd, level) => {
        const risky =
          level === "danger" || level === "warn" ||
          /gh repo create|worktree remove|--force|--hard|\brm\s|\bdelete\b|reset --hard/i.test(cmd);
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
