/*
 * The kanban pane container: board CRUD against .chronicle/kanban.json,
 * HTML5 drag between lanes, the composer (create/edit + screenshot attach),
 * and the Ready-to-execute flow — freeze the queued round, watch the
 * background session write the fix plan, land on the roadmap. All state in
 * the shared kanban-store cache so the rail badge stays live.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Board } from "./Board";
import { Composer } from "./Composer";
import { ExecuteFlow, type ExecuteFlowProps } from "./ExecuteFlow";
import { setActiveTermFor, spawnTerm, termsFor } from "@/lib/term-sessions";
import type { TaskColumn } from "./types";
import {
  executingRound,
  kanbanFor,
  mutateKanban,
  newTask,
  takePendingOpenTask,
  taskId,
  nextRoundN,
  refreshKanban,
  subscribeKanban,
  thumbFor,
} from "@/lib/kanban-store";
import {
  copyFile,
  roundExecStatus,
  roundExecute,
  fixesCancel,
  kanbanDetach,
  fixesGenerate,
  fixesStatus,
  kanbanAttach,
  type KanbanTask,
} from "@/lib/ipc";
import { initProgress, logLinesFrom } from "@/lib/roadmap-data";
import { toastError, toastSuccess } from "@/overlays/toasts";
import type { ConfirmSpec } from "@/overlays/ConfirmDialog";

function fmtAgo(ms?: number): string | undefined {
  if (!ms) return undefined;
  const mins = Math.max(1, Math.round((Date.now() - ms) / 60_000));
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

type Flow =
  | { kind: "idle" }
  | { kind: "preflight" }
  | { kind: "generating"; startedAt: number; logLines: string[]; activeLine: string; progress: number }
  | { kind: "done"; round: number };

export function KanbanPane({
  dir,
  agent,
  onConfirm,
  onGoRoadmap,
}: {
  dir: string;
  agent: "claude" | "codex";
  onConfirm: (spec: ConfirmSpec) => void;
  onGoRoadmap: () => void;
}) {
  const [, bump] = useState(0);
  useEffect(() => subscribeKanban(() => bump((n) => n + 1)), []);
  useEffect(() => { void refreshKanban(dir); }, [dir]);

  const store = kanbanFor(dir);
  const [draft, setDraft] = useState<{
    mode: "create" | "edit";
    task: KanbanTask;
    linkDraft: string;
    /** attachments added / marked-removed this session — settled on save/cancel */
    added?: string[];
    removed?: string[];
  } | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropColumn, setDropColumn] = useState<TaskColumn | null>(null);
  const [flow, setFlow] = useState<Flow>({ kind: "idle" });
  const fileInput = useRef<HTMLInputElement | null>(null);
  const dirRef = useRef(dir);
  dirRef.current = dir;

  const fail = useCallback((title: string) => (e: unknown) => toastError(title, String(e).slice(0, 90)), []);

  /* ---- composer ---- */

  const openCreate = useCallback(() => {
    setDraft({ mode: "create", task: newTask(kanbanFor(dirRef.current)), linkDraft: "" });
  }, []);

  const openEdit = useCallback((id: string) => {
    const t = kanbanFor(dirRef.current).tasks.find((x) => x.id === id);
    if (t) setDraft({ mode: "edit", task: { ...t, images: [...(t.images ?? [])], links: [...(t.links ?? [])] }, linkDraft: "" });
  }, []);

  const saveDraft = useCallback(() => {
    if (!draft) return;
    for (const img of draft.removed ?? []) void kanbanDetach(dir, img).catch(() => {}); // save commits the removals
    const t = { ...draft.task, title: draft.task.title.trim() || "Untitled", updated_at: Date.now() };
    mutateKanban(dir, (s) => {
      if (draft.mode === "create") {
        // id from THIS store — the mutation re-applies on fresh disk truth,
        // where next_id may have moved past the composer's snapshot
        s.tasks.push({ ...t, id: taskId(s.next_id) });
        s.next_id += 1;
      } else {
        const i = s.tasks.findIndex((x) => x.id === t.id);
        if (i >= 0) s.tasks[i] = t;
      }
    }, fail("Couldn't save the task"));
    setDraft(null);
  }, [dir, draft, fail]);

  /* closing without saving: a create-mode draft's attachments are orphans —
     remove them (T-040) */
  const closeDraft = useCallback(() => {
    setDraft((d) => {
      // cancel: newly-added files are orphans either mode; marked-removed
      // files were NOT deleted yet, so the task keeps its images intact
      for (const img of d?.added ?? []) void kanbanDetach(dir, img).catch(() => {});
      return null;
    });
  }, [dir]);

  const attach = useCallback(() => fileInput.current?.click(), []);
  const onFilePicked = useCallback(async (f: File | undefined) => {
    if (!f || !draft) return;
    try {
      const buf = new Uint8Array(await f.arrayBuffer());
      let bin = "";
      for (const byte of buf) bin += String.fromCharCode(byte);
      const path = await kanbanAttach(dir, draft.task.id, f.name, btoa(bin));
      setDraft((d) => d && {
        ...d,
        added: [...(d.added ?? []), path],
        task: { ...d.task, images: [...(d.task.images ?? []), path] },
      });
    } catch (e) {
      fail("Couldn't attach the image")(e);
    }
  }, [dir, draft, fail]);

  /* ---- drag between lanes ---- */

  const moveTask = useCallback((id: string, column: TaskColumn) => {
    mutateKanban(dir, (s) => {
      const t = s.tasks.find((x) => x.id === id);
      // out of the round is always allowed (the human overrides the agent);
      // INTO in_progress stays blocked at the drop site — the round owns it
      if (t) {
        t.column = column;
        // back in Queued = re-eligible for the next round; the claim clears
        if (column === "queued") t.round = null;
        t.updated_at = Date.now();
      }
    }, fail("Couldn't move the task"));
  }, [dir, fail]);

  /* ---- ready to execute ---- */

  const startGenerate = useCallback(() => {
    const startedAt = Date.now();
    setFlow({ kind: "generating", startedAt, logLines: [], activeLine: "Starting the session…", progress: 0.06 });
    fixesGenerate(dir, agent)
      .then(() => refreshKanban(dir)) // the board shows the freeze immediately
      .catch((e) => {
        setFlow({ kind: "idle" });
        fail("Couldn't start the session")(e);
      });
  }, [dir, agent, fail]);

  useEffect(() => {
    if (flow.kind !== "generating") return;
    const startedAt = flow.startedAt;
    const tick = async () => {
      try {
        const st = (await fixesStatus(dir)) as { running?: boolean; code?: number | null; log_tail?: string; started_at?: number };
        const tail = st.log_tail ?? "";
        const lines = logLinesFrom(tail);
        if (st.running !== false) {
          setFlow({
            kind: "generating",
            startedAt: st.started_at || startedAt,
            logLines: lines.slice(0, -1),
            activeLine: lines[lines.length - 1] ?? "Starting the session…",
            progress: initProgress(tail),
          });
          return;
        }
        if ((st.code ?? 1) === 0) {
          await refreshKanban(dir);
          const rounds = kanbanFor(dir).rounds;
          const latest = rounds.reduce((m, r) => Math.max(m, r.n), 0);
          setFlow({ kind: "done", round: latest }); // the done card announces it — no twin toast
        } else {
          // refresh FIRST: the resume effect must not see a stale generating
          // round and re-open the flow (that looped a toast per tick)
          await refreshKanban(dir);
          failedRound.current = [...kanbanFor(dir).rounds].reverse().find((r) => r.state === "generating")?.n ?? null;
          setFlow({ kind: "idle" });
          toastError("The session didn't finish", `Exited with code ${st.code ?? "?"} — your tasks are untouched`);
        }
      } catch { /* keep the last shown state */ }
    };
    const id = setInterval(tick, 3000);
    void tick();
    return () => clearInterval(id);
  }, [dir, flow.kind, flow.kind === "generating" ? flow.startedAt : 0]);

  /* resume: a round generating in the store while the flow is idle means we
     lost the overlay (pane switch, reload) — pick it back up (T-006) */
  const genRoundOpen = store.rounds.some((r) => r.state === "generating");
  const prevGenOpen = useRef(false);
  /** a round that just failed client-side — never auto-resume it, even if the
   *  backend's settle is delayed (defense against a toast storm) */
  const failedRound = useRef<number | null>(null);
  useEffect(() => {
    const openGen = [...store.rounds].reverse().find((r) => r.state === "generating")?.n ?? null;
    if (openGen === null || openGen !== failedRound.current) {
      if (openGen === null) failedRound.current = null;
    }
    if (genRoundOpen && flow.kind === "idle" && openGen !== failedRound.current) {
      setFlow({ kind: "generating", startedAt: Date.now(), logLines: [], activeLine: "Starting the session…", progress: 0.06 });
    } else if (!genRoundOpen && prevGenOpen.current && flow.kind === "idle") {
      // it settled while nobody watched — still land on the done card
      const latest = [...store.rounds].reverse().find((r) => r.state === "ready");
      if (latest) {
        setFlow({ kind: "done", round: latest.n }); // the done card announces it — no twin toast
      }
    }
    prevGenOpen.current = genRoundOpen;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [genRoundOpen, flow.kind]);

  /* a task targeted from global search opens its composer on arrival */
  useEffect(() => {
    const id = takePendingOpenTask();
    if (id) openEdit(id);
  });

  /* ---- ⌘N while the pane is up ---- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
      if ((e.metaKey || e.ctrlKey) && e.key === "n" && !typing && !draft) {
        e.preventDefault();
        openCreate();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [draft, openCreate]);

  /* ---- the headless round session (F1): poll while one could be running ---- */
  const [execLive, setExecLive] = useState(false);
  const execCandidate = executingRound(store) != null &&
    store.rounds.find((x) => x.n === executingRound(store))?.state === "ready";
  useEffect(() => {
    if (!execCandidate) { setExecLive(false); return; }
    let stop = false;
    const tick = async () => {
      try {
        const st = await roundExecStatus(dir);
        if (stop || dirRef.current !== dir) return;
        setExecLive(st?.running === true);
      } catch { /* keep the last known */ }
    };
    const id = setInterval(tick, 3000);
    void tick();
    return () => { stop = true; clearInterval(id); };
  }, [dir, execCandidate]);

  const runHeadless = useCallback((n: number) => {
    onConfirm({
      title: `Run round ${n} for you?`,
      body: `A ${agent === "codex" ? "Codex" : "Claude"} session will execute the round's plan in this project with full permissions, marking tasks done as it verifies them. You can cancel from the roadmap at any time.`,
      cancelLabel: "Not yet",
      confirmLabel: "Run the round",
      onConfirm: () => {
        roundExecute(dir, n, agent)
          .then(() => {
            setExecLive(true);
            setFlow({ kind: "idle" });
            toastSuccess("The round is running", "Watch it on the roadmap — tasks tick as they finish");
          })
          .catch(fail("Couldn't start the round"));
      },
    });
  }, [dir, agent, onConfirm, fail]);

  /* ---- view assembly ---- */

  const visible = store.tasks.filter((t) => !t.archived);
  const queued = visible.filter((t) => t.column === "queued" && t.round == null).length;
  const roundN = nextRoundN(store);

  let flowProps: ExecuteFlowProps | null = null;
  if (flow.kind === "preflight") {
    flowProps = {
      kind: "preflight",
      agent,
      queued,
      planFile: `phase_${roundN}_fixes_plan.md`,
      promptFile: `phase_${roundN}_fixes_prompt.md`,
      onNotYet: () => setFlow({ kind: "idle" }),
      onConfirm: startGenerate,
    };
  } else if (flow.kind === "generating") {
    const s = Math.round((Date.now() - flow.startedAt) / 1000);
    flowProps = {
      kind: "generating",
      elapsed: s >= 60 ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s` : `${s}s`,
      progress: flow.progress,
      logLines: flow.logLines,
      activeLine: flow.activeLine,
      onCancel: () => {
        fixesCancel(dir)
          .then(() => { setFlow({ kind: "idle" }); void refreshKanban(dir); toastSuccess("Stopped the session"); })
          .catch(fail("Couldn't stop it"));
      },
    };
  } else if (flow.kind === "done") {
    const r = store.rounds.find((x) => x.n === flow.round);
    flowProps = {
      kind: "done",
      agent,
      round: flow.round,
      taskCount: r?.task_ids.length ?? 0,
      outcome: r?.kind ?? "fixes",
      planFile: (r?.plan_path ?? `fixes/phase_${flow.round}_fixes_plan.md`).split("/").pop()!,
      promptFile: (r?.prompt_path ?? `fixes/phase_${flow.round}_fixes_prompt.md`).split("/").pop()!,
      onOpenFile: (name) => {
        const full = name.includes("plan") ? r?.plan_path : r?.prompt_path;
        copyFile(dir, full ?? `fixes/${name}`)
          .then((n) => toastSuccess(`Copied ${name}`, `${Number(n).toLocaleString()} characters`))
          .catch(fail("Couldn't copy it"));
      },
      onRunHeadless: () => runHeadless(flow.round),
      onStartRound: () => {
        const agentName = agent === "codex" ? "Codex" : "Claude";
        const promptPath = r?.prompt_path ?? `fixes/phase_${flow.round}_fixes_prompt.md`;
        const title = `Round ${flow.round}`;
        const copyPrompt = () =>
          copyFile(dir, promptPath)
            .then(() => toastSuccess("Prompt copied", `When ${agentName} is ready, paste it (⌘V) as the first message`))
            .catch(fail("Couldn't copy the prompt"));
        const existing = termsFor(dir).find((t) => t.title === title && !t.dead);
        if (existing) {
          setActiveTermFor(dir, existing.id);
          void copyPrompt();
          return;
        }
        spawnTerm(dir, { agent, title })
          .then(() => void copyPrompt())
          .catch(fail("Couldn't start a terminal"));
      },
      onViewRoadmap: () => { setFlow({ kind: "idle" }); onGoRoadmap(); },
    };
  }

  return (
    <div className="relative h-full min-h-0">
      <Board
        title="Fixes & ideas"
        tasks={visible.map((t) => ({
          ...t,
          round: t.round ?? undefined,
          // repo-relative attachment paths render via the data-URI cache (T-003)
          images: (t.images ?? []).map((img) => thumbFor(dir, img) ?? img),
          links: t.links ?? [],
          content: t.content ?? "",
          ago: fmtAgo(t.updated_at ?? t.created_at),
        }))}
        selectedId={draft?.mode === "edit" ? draft.task.id : null}
        draggingId={draggingId}
        dropColumn={dropColumn}
        executingRound={executingRound(store)}
        executingRoundState={
          store.rounds.find((x) => x.n === executingRound(store))?.state === "generating"
            ? "generating"
            : execLive
              ? "running"
              : "ready"
        }
        onNewTask={openCreate}
        onReadyToExecute={() => queued > 0 && setFlow({ kind: "preflight" })}
        onOpenTask={openEdit}
        onTaskDragStart={(id, e) => {
          e.dataTransfer.setData("text/plain", id);
          e.dataTransfer.effectAllowed = "move";
          setDraggingId(id);
        }}
        onTaskDragEnd={() => { setDraggingId(null); setDropColumn(null); }}
        onLaneDragOver={(column, e) => {
          if (column === "in_progress") return; // round-owned — no manual drops
          e.preventDefault();
          setDropColumn(column);
        }}
        onLaneDrop={(column, e) => {
          e.preventDefault();
          const id = e.dataTransfer.getData("text/plain") || draggingId;
          if (id && column !== "in_progress") moveTask(id, column);
          setDraggingId(null);
          setDropColumn(null);
        }}
        onLaneDragLeave={(column) => setDropColumn((c) => (c === column ? null : c))}
      />

      {/* the composer overlay — a pane-scoped dialog: Escape and the scrim
          close it; the rail stays reachable (absolute, not fixed) */}
      {draft && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={draft.mode === "create" ? "New task" : `Edit ${draft.task.id}`}
          tabIndex={-1}
          ref={(el) => { if (el && !el.contains(document.activeElement)) el.focus(); }}
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/45 p-6 outline-none"
          onMouseDown={(e) => { if (e.target === e.currentTarget) closeDraft(); }}
          onKeyDown={(e) => { if (e.key === "Escape") closeDraft(); }}
        >
          <Composer
            mode={draft.mode}
            id={draft.mode === "edit" ? draft.task.id : undefined}
            inRound={draft.task.round != null}
            meta={draft.mode === "edit" ? [fmtAgo(draft.task.created_at) && `created ${fmtAgo(draft.task.created_at)}`, fmtAgo(draft.task.updated_at) && `updated ${fmtAgo(draft.task.updated_at)}`].filter(Boolean).join(" · ") : undefined}
            title={draft.task.title}
            content={draft.task.content ?? ""}
            images={(draft.task.images ?? []).map((img) => thumbFor(dir, img) ?? img)}
            links={draft.task.links ?? []}
            column={draft.task.column}
            linkDraft={draft.linkDraft}
            onTitleChange={(v) => setDraft((d) => d && { ...d, task: { ...d.task, title: v } })}
            onContentChange={(v) => setDraft((d) => d && { ...d, task: { ...d.task, content: v } })}
            onAttach={attach}
            onRemoveImage={(i) => setDraft((d) => {
              if (!d) return d;
              const target = (d.task.images ?? [])[i];
              // deletion happens on SAVE — cancel must be able to restore
              return {
                ...d,
                removed: target ? [...(d.removed ?? []), target] : d.removed,
                task: { ...d.task, images: (d.task.images ?? []).filter((_, j) => j !== i) },
              };
            })}
            onLinkDraftChange={(v) => setDraft((d) => d && { ...d, linkDraft: v })}
            onAddLink={() => setDraft((d) => {
              if (!d || !d.linkDraft.trim()) return d;
              return { ...d, task: { ...d.task, links: [...(d.task.links ?? []), d.linkDraft.trim()] }, linkDraft: "" };
            })}
            onRemoveLink={(i) => setDraft((d) => d && { ...d, task: { ...d.task, links: (d.task.links ?? []).filter((_, j) => j !== i) } })}
            onColumnChange={(column) => setDraft((d) => d && { ...d, task: { ...d.task, column } })}
            onDelete={() => {
              const id = draft.task.id;
              onConfirm({
                title: "Delete this task?",
                body: `${id} and its attachments disappear from the board. This can't be undone.`,
                cancelLabel: "Keep it",
                confirmLabel: "Delete",
                danger: true,
                onConfirm: () => {
                  for (const img of draft.task.images ?? []) void kanbanDetach(dir, img).catch(() => {});
                  mutateKanban(dir, (s) => { s.tasks = s.tasks.filter((x) => x.id !== id); }, fail("Couldn't delete it"));
                  setDraft(null);
                },
              });
            }}
            onArchive={() => {
              const id = draft.task.id;
              mutateKanban(dir, (s) => {
                const t = s.tasks.find((x) => x.id === id);
                if (t) t.archived = true;
              }, fail("Couldn't archive it"));
              setDraft(null);
            }}
            onSave={saveDraft}
            onClose={closeDraft}
          />
        </div>
      )}

      {/* the execute-flow overlay — same dialog contract; the generating state
          only closes via Cancel (Escape would abandon a live session silently) */}
      {flowProps && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Ready to execute"
          tabIndex={-1}
          ref={(el) => { if (el && !el.contains(document.activeElement)) el.focus(); }}
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/45 p-6 outline-none"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && flow.kind !== "generating") setFlow({ kind: "idle" });
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape" && flow.kind !== "generating") setFlow({ kind: "idle" });
          }}
        >
          <ExecuteFlow {...flowProps} />
        </div>
      )}

      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          void onFilePicked(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </div>
  );
}
