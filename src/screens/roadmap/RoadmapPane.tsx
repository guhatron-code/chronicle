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
  gitFetch,
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
  type HistoryFacts,
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
import { useSessionStatus } from "@/lib/session-status";
import { AWAY_THRESHOLD_MS, announce, lastSeen, markSeen } from "@/lib/journal";
import { openFileInRepo } from "@/screens/repo/RepoPane";
import { fixesCancel, fixesLogPath, fixesStatus, initLogPath } from "@/lib/ipc";
import { indexFor, refreshNotes, roundGenerating, subscribeNotesIndex } from "@/lib/notes-store";
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
  onGoNotes,
  onConfirm,
  onPollNow,
  onStartPhaseWithAgent,
  historyFacts,
  onHistoryFacts,
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
  onGoNotes: () => void;
  onConfirm: (spec: ConfirmSpec) => void;
  onPollNow: () => void;
  /** F38 — reveal the agent pane and preload this phase's prompt as a draft. */
  onStartPhaseWithAgent: (phaseId: string, promptPath: string | null) => void;
  /** The history section's four facts — App asks for them only while this pane
   *  is the one on screen, so a hidden roadmap costs no git. */
  historyFacts: HistoryFacts | null;
  /** "Check now" fetched: hand the fresher facts back to the owner. */
  onHistoryFacts: (f: HistoryFacts) => void;
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
  useEffect(() => subscribeNotesIndex(() => kbBump((n) => n + 1)), []);
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
        const t = setTimeout(() => setJustDoneId(null), 4000); // timer-ok: one-shot, ends the "just done" ring
        prevDone.current = done;
        return () => clearTimeout(t);
      }
    }
    prevDone.current = done;
  }, [state?.statuses]);
  const [publishing, setPublishing] = useState(false);
  const [historyChecking, setHistoryChecking] = useState(false);
  const [uncommittedOpen, setUncommittedOpen] = useState(false);
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

  /* the init session, pushed: one seed read, then session-status events */
  const initSt = useSessionStatus(dir, "init", !!initRun?.running, initStatus);
  // dir is omitted from these deps on purpose: a dir change re-activates the hook, which
  // emits a fresh status object, which re-runs the effect
  useEffect(() => {
    if (!initRun?.running || !initSt) return;
    if (dirRef.current !== dir) return; // a late event must not cross projects
    const st = initSt;
    const tail = st.log_tail ?? "";
    const lines = logLinesFrom(tail);
    const began = st.started_at || initRun.startedAt;
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
      if (st.cancelled) { setInitRun(null); return; } // the cancel path already spoke
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initSt]);

  /* a headless round execution is live → mirror it on the roadmap. The vault is
     the ground truth: a round is still running while any of its notes sits at
     in_progress (Rust's settle_done clears the last one when they're all done). */
  const execRoundN = (() => {
    const live = indexFor(dir).notes.filter((n) => n.round != null && n.status === "in_progress");
    if (live.length === 0) return null;
    return live.reduce((m, x) => Math.max(m, x.round ?? 0), 0);
  })();
  const execSt = useSessionStatus(dir, "exec", execRoundN != null, roundExecStatus);
  const sawExecLive = useRef(false);
  useEffect(() => {
    if (execRoundN == null) { setExecRun(null); sawExecLive.current = false; return; }
    if (!execSt || dirRef.current !== dir) return;
    const st = execSt;
    const tail = st.log_tail ?? "";
    const lines = logLinesFrom(tail);
    if (st.running === true) {
      sawExecLive.current = true;
      const began = st.started_at || Date.now();
      setExecRun({
        running: true,
        startedAt: began,
        logLines: lines.slice(0, -1),
        activeLine: lines[lines.length - 1] ?? "Starting the session…",
        progress: initProgress(tail),
        code: null,
        elapsedS: Math.round((Date.now() - began) / 1000),
      });
      return;
    }
    setExecRun(null);
    if (sawExecLive.current) {
      sawExecLive.current = false;
      void refreshNotes(dir);
      if (st.cancelled) { onPollNowRef.current(); return; }
      if ((st.code ?? 1) === 0) {
        toastSuccess("The round finished", "Check Notes — finished items are ticked");
        announce(dir, "round-done", `Round ${execRoundN} finished`, "Chronicle");
      } else {
        toastError("The round session ended", `Exited with code ${st.code ?? "?"} — unfinished notes stay in Notes`);
        announce(dir, "round-ended", `Round ${execRoundN} ended early`, "Chronicle");
      }
      onPollNowRef.current();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [execSt, execRoundN]);

  /* a round's plan is being written → mirror its session on the roadmap */
  const generating = roundGenerating(dir);
  const fixesSt = useSessionStatus(dir, "fixes", generating, fixesStatus);
  const fixesSettled = useRef(false);
  useEffect(() => {
    if (!generating) { setFixesRun(null); fixesSettled.current = false; return; }
    if (!fixesSt || dirRef.current !== dir) return;
    const st = fixesSt;
    const tail = st.log_tail ?? "";
    const lines = logLinesFrom(tail);
    if (st.running === true) {
      fixesSettled.current = false;
      const began = st.started_at || Date.now();
      setFixesRun({
        running: true,
        startedAt: began,
        logLines: lines.slice(0, -1),
        activeLine: lines[lines.length - 1] ?? "Starting the session…",
        progress: initProgress(tail),
        code: null,
        elapsedS: Math.round((Date.now() - began) / 1000),
      });
      return;
    }
    if (fixesSettled.current) return; // a duplicate terminal delivery must not double-toast
    fixesSettled.current = true;
    setFixesRun(null);
    void refreshNotes(dir).then(() => {
      if (!st.cancelled && (st.code ?? 1) === 0) {
        toastSuccess("The fix plan is written", "The round is on your roadmap");
        announce(dir, "round-plan", "A round's fix plan is ready", "Chronicle");
      }
      onPollNowRef.current();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fixesSt, generating]);

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
        copyTimer.current = setTimeout(() => setCopiedPath(null), 1800); // timer-ok: one-shot, ends the copied flash
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
    historyFacts,
    historyChecking,
    uncommittedOpen,
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
          .then(() => { setExecRun(null); void refreshNotes(dir); toastSuccess("Stopped the round", "Finished notes stay done; the rest are still in Notes"); })
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
          .then(() => { setFixesRun(null); void refreshNotes(dir); toastSuccess("Stopped the session"); })
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
                .then((name) => {
                  toastSuccess("Published online", `${name} — private, under your account`);
                  announce(dir, "published", `Published online — ${name}`, "Chronicle");
                  onPollNow();
                })
                .catch((e) => toastError("That didn't finish", humanGitError(e)))
                .finally(() => setPublishing(false));
            },
          });
          return;
        }
        const run = async () => {
          setPublishing(true);
          try {
            if (id === "push" || id === "publish-first") {
              // the ONLY thing that announces a publish is a push that returned —
              // and only when it carried something ("Already published — nothing
              // new" is the one push outcome that is not a publish)
              const r = await gitPush(dir);
              toastRemoteOutcome(r);
              if (!/nothing new/i.test(r.headline)) announce(dir, "published", r.headline, "Chronicle");
            }
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
      /* the only fetch in the app, and it is a click. A failed fetch keeps the
         numbers and the time it last really checked — git_fetch returns the
         same facts with `error` set, so the line says why instead of lying. */
      onCheckNow: () => {
        setHistoryChecking(true);
        gitFetch(dir)
          .then((f) => onHistoryFacts(f))
          .catch((e) => toastError("Couldn't check", humanGitError(e)))
          .finally(() => setHistoryChecking(false));
      },
      onToggleUncommitted: () => setUncommittedOpen((o) => !o),
      onAddNext: onGoNotes,
      onReadDecision: setDetailId,
    },
  };

  return <Roadmap {...mapRoadmap(state, ctx)} />;
}
