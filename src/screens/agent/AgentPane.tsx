/*
 * The agent pane body (F32/F33/F34/F35 wired to the ACP seam): the thread of
 * user/assistant messages, tool cards and inline permission asks, the state
 * banners (disconnected · installing the bridge · needs login · error ·
 * ended), and the composer. Session state lives in lib/agent-session.ts —
 * this component only renders and dispatches.
 */
import { useEffect, useRef, useState } from "react";
import {
  agentSessionFor,
  startAgentSession,
  startRoundInPane,
  adoptAgentSession,
  closeAgentViewing,
  dequeueAgentMessage,
  subscribeAgent,
  type AgentEntry,
  type AgentSessionState,
} from "@/lib/agent-session";
import { kanbanFor, subscribeKanban } from "@/lib/kanban-store";
import { agentEditKeep, agentEditUndo, agentRestoreCheckpoint, agentsAvailable } from "@/lib/ipc";
import { CheckGlyph } from "@/components/chrome/icons";
import { getTerm, setActiveTermFor, spawnTerm, subscribeTerms } from "@/lib/term-sessions";
import type { ConfirmSpec } from "@/overlays/ConfirmDialog";
import { toastError } from "@/overlays/toasts";
import { MiniMd } from "@/lib/mini-md";
import { Chronigirl, ErrorGlyph, XGlyph } from "@/components/chrome/icons";
import { BtnPrimary, BtnSecondary, Spinner } from "@/components/chrome/atoms";
import { cn } from "@/lib/utils";
import { Composer } from "./Composer";
import { ToolCard } from "./ToolCard";
import { PermissionCard } from "./PermissionCard";

/** Projects we've auto-started the agent for this app session — so toggling the
 *  pane's visibility or ending a session never re-triggers auto-start. */
const autoStarted = new Set<string>();

/** F33 — the checkpoint row: a thin divider above each user message; the
 *  hover-revealed "Undo to here" restores the snapshot taken before it. */
function CheckpointRow({
  dir,
  checkpoint,
  disabled,
  onConfirm,
}: {
  dir: string;
  checkpoint?: string | null;
  disabled: boolean;
  onConfirm: (spec: ConfirmSpec) => void;
}) {
  const undo = () =>
    onConfirm({
      title: "Undo everything since this message?",
      body: "Puts every file back the way it was before this message — including changes you made yourself since. Your conversation stays.",
      cancelLabel: "Keep things as they are",
      confirmLabel: "Undo to here",
      danger: true,
      onConfirm: () => {
        agentRestoreCheckpoint(dir, checkpoint!)
          .catch((e) => toastError("Couldn't undo to here", String(e).slice(0, 110)));
      },
    });
  return (
    <div className="group flex h-4 items-center gap-2 px-3.5">
      <span className="h-px flex-1 bg-divider" />
      {checkpoint && !disabled && (
        <button
          data-checkpoint-undo
          onClick={undo}
          className="inline-flex h-[22px] items-center gap-[5px] rounded-[6px] bg-fill-hover px-2 text-[11px] text-text-secondary opacity-0 hover:text-text-primary focus-visible:opacity-100 group-hover:opacity-100"
        >
          <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4">
            <path d="M4.5 2 2 4.5 4.5 7" />
            <path d="M2 4.5h5a3 3 0 0 1 0 6H4" />
          </svg>
          Undo to here
        </button>
      )}
    </div>
  );
}

/** Speaker marks — the single biggest "this is a conversation" signal. */
function AssistantAvatar() {
  return (
    <span className="flex size-[26px] shrink-0 items-center justify-center rounded-full border border-border-hairline bg-surface-card-raised">
      <Chronigirl size={17} />
    </span>
  );
}
function UserAvatar() {
  return (
    <span className="flex size-[26px] shrink-0 items-center justify-center rounded-full border border-border-hairline bg-fill-subtle text-text-subtle">
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
        <circle cx="8" cy="5.5" r="2.6" />
        <path d="M3.4 13a4.6 4.6 0 0 1 9.2 0" />
      </svg>
    </span>
  );
}

/** The "agent is thinking" indicator — three staggered dots, a classic chat
 *  signal (and DS-clean: no gradient-clipped text). */
function TypingDots() {
  return (
    <span className="inline-flex items-center gap-1" aria-label="The agent is working">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="size-1.5 rounded-full bg-text-dim"
          style={{ animation: "wv-pulse 1.1s ease-in-out infinite", animationDelay: `${i * 0.18}s` }}
        />
      ))}
    </span>
  );
}

function MessageRow({ who, avatar, children }: { who: string; avatar: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex gap-2.5 px-3.5 py-2">
      {avatar}
      <div className="min-w-0 flex-1">
        <div className="mb-0.5 text-[12.5px] font-semibold text-text-primary">{who}</div>
        <div className="text-[13px] leading-[1.65] text-text-primary [text-wrap:pretty]">{children}</div>
      </div>
    </div>
  );
}

function UserMessage({ text }: { text: string }) {
  return <MessageRow who="You" avatar={<UserAvatar />}>{text}</MessageRow>;
}

/** F36 — the persistent strip above the composer while the ledger is
 *  non-empty, and its honest resolution states. */
function ReviewStrip({
  dir,
  s,
  onOpenReview,
  onConfirm,
}: {
  dir: string;
  s: AgentSessionState;
  onOpenReview: () => void;
  onConfirm: (spec: ConfirmSpec) => void;
}) {
  const files = s.editFiles;
  if (files.length === 0) {
    if (!s.editsResolved) return null;
    return (
      <div data-review-strip="resolved" className="mx-3 mb-2 flex items-center gap-2 rounded-md bg-fill-subtle px-3 py-[9px]">
        {s.phase === "ended" || s.phase === "none" ? (
          <span className="text-[12.5px] text-text-muted">
            The session ended — changes you hadn't reviewed were kept. They're still in the repo view.
          </span>
        ) : (
          <>
            <span className="shrink-0 text-state-success"><CheckGlyph size={11} /></span>
            <span className="text-[12.5px] text-text-secondary">All changes reviewed</span>
          </>
        )}
      </div>
    );
  }
  const direct = files.filter((f) => !f.viaCommand).length;
  const undoAll = () =>
    onConfirm({
      title: "Undo the agent's edits?",
      body:
        direct === files.length
          ? "Puts every file the agent changed back the way it was. The edits are gone for good."
          : "Puts every file the agent edited directly back the way it was. Files changed by commands aren't touched — Undo to here covers those.",
      cancelLabel: "Keep them",
      confirmLabel: "Undo the edits",
      danger: true,
      onConfirm: () => {
        agentEditUndo(dir, null).catch((e) => toastError("Couldn't undo the edits", String(e).slice(0, 90)));
      },
    });
  return (
    <div data-review-strip className="mx-3 mb-2 flex items-center gap-2 whitespace-nowrap rounded-md bg-fill-subtle px-3 py-2">
      <span className="text-[12.5px] font-medium text-text-primary">
        {files.length === 1 ? "1 file changed" : `${files.length} files changed`}
      </span>
      <span className="flex-1" />
      <button
        onClick={onOpenReview}
        className="h-[26px] rounded-md border border-border-strong px-[11px] text-[11.5px] font-medium text-text-primary hover:bg-fill-hover"
      >
        Review
      </button>
      <button
        onClick={() => void agentEditKeep(dir, null).catch((e) => toastError("Couldn't keep them", String(e).slice(0, 90)))}
        className="h-[26px] rounded-md border border-border-strong px-[11px] text-[11.5px] font-medium text-text-primary hover:bg-fill-hover"
      >
        Keep all
      </button>
      {direct > 0 && (
        <button
          onClick={undoAll}
          className="h-[26px] rounded-md border border-border-hairline px-[11px] text-[11.5px] font-medium text-state-error hover:bg-fill-hover"
        >
          Undo all…
        </button>
      )}
    </div>
  );
}

function AssistantMessage({ text, streaming }: { text: string; streaming: boolean }) {
  return (
    <MessageRow who="Chronigirl" avatar={<AssistantAvatar />}>
      <span data-streaming={streaming || undefined}>
        {streaming && !text.trim() ? (
          <TypingDots />
        ) : (
          // format AS IT STREAMS — markdown renders progressively, not only at
          // the end; a caret trails the live text
          <span className="[&>*:last-child]:inline">
            <MiniMd source={text} />
            {streaming && (
              <span
                className="ml-0.5 inline-block h-[15px] w-px translate-y-[2px] bg-text-secondary"
                style={{ animation: "wv-pulse 1.1s step-end infinite" }}
              />
            )}
          </span>
        )}
      </span>
    </MessageRow>
  );
}

function TurnError({ message }: { message: string }) {
  return (
    <div className="mx-3.5 my-1 flex items-start gap-2 rounded-md border border-border-hairline bg-surface-card px-[11px] py-2">
      <span className="mt-0.5 shrink-0 text-state-error"><ErrorGlyph size={12} /></span>
      <span className="min-w-0 text-xs leading-[1.55] text-text-muted">
        The agent stopped with an error — <span className="font-mono text-[11px]">{message}</span>. Send the message
        again, or end the session and start fresh.
      </span>
    </div>
  );
}

/** F39 — the round header card. Done/failed derive from GROUND TRUTH only:
 *  the board's task columns plus the session's stop reason — never the
 *  agent's own claim. */
function RoundCard({
  dir,
  entry,
  onRetry,
  onOpenBoard,
}: {
  dir: string;
  entry: Extract<AgentEntry, { kind: "round" }>;
  onRetry?: () => void;
  onOpenBoard?: () => void;
}) {
  const tasks = kanbanFor(dir).tasks.filter((t) => t.round === entry.n && !t.archived);
  const total = tasks.length || entry.total;
  const done = tasks.filter((t) => t.column === "completed").length;
  const allDone = total > 0 && done === total;
  const stopped = entry.ended && !allDone;
  return (
    <div data-round-card className="flex flex-col gap-2 rounded-[10px] border border-border-hairline bg-surface-card-raised px-3.5 py-3">
      <div className="flex items-center gap-2 whitespace-nowrap">
        <span className="text-[13px] font-semibold text-text-primary">
          Round {entry.n} · {total} {total === 1 ? "task" : "tasks"}
        </span>
        {allDone ? (
          <span className="inline-flex items-center gap-[5px] text-xs text-state-success">
            <CheckGlyph size={11} />
            done
          </span>
        ) : stopped ? (
          <span className="inline-flex items-center gap-[5px] text-xs text-state-error">
            <span className="size-[5px] shrink-0 rounded-full bg-state-error" />
            stopped early
          </span>
        ) : (
          <span className="inline-flex items-center gap-[5px] text-xs text-state-neutral">
            <span className="size-[5px] shrink-0 rounded-full bg-state-neutral" style={{ animation: "wv-pulse 1.6s ease-in-out infinite" }} />
            running
          </span>
        )}
        <span className="flex-1" />
        <button onClick={onOpenBoard} className="text-[11.5px] text-text-secondary hover:text-text-primary">
          Open the board ›
        </button>
      </div>
      {!entry.ended && (
        <div className="h-[3px] overflow-hidden rounded-[2px] bg-fill-hover">
          <span className="block h-full rounded-[2px] bg-state-neutral" style={{ width: `${total > 0 ? Math.round((done / total) * 100) : 0}%` }} />
        </div>
      )}
      <span className="font-mono text-[10.5px] text-text-dim tabular-nums">
        {done} of {total} tasks done on the board
      </span>
      {allDone && (
        <span className="text-[11.5px] text-text-muted">
          Every task in the round is completed on the board — that's what "done" means here.
        </span>
      )}
      {stopped && (
        <>
          <span className="text-[11.5px] leading-[1.55] text-text-muted">
            The session ended before the round finished
            {entry.stopReason ? <> — stop reason: <span className="font-mono text-[11px]">{entry.stopReason}</span></> : null}
            . The {total - done} remaining {total - done === 1 ? "task stays" : "tasks stay"} on the board.
          </span>
          {onRetry && (
            <div className="flex gap-2">
              <BtnPrimary size="sm" onClick={onRetry}>Pick the round back up</BtnPrimary>
              <BtnSecondary size="sm" onClick={onOpenBoard}>Open the board</BtnSecondary>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** #1 — the agent's live plan/todo list; updates in place as items progress. */
function PlanCard({ entry }: { entry: Extract<AgentEntry, { kind: "plan" }> }) {
  if (entry.items.length === 0) return null;
  const done = entry.items.filter((i) => i.status === "completed").length;
  return (
    <div data-plan-card className="flex flex-col gap-2 rounded-[10px] border border-border-hairline bg-surface-card-raised px-3.5 py-3">
      <div className="flex items-center gap-2 text-[11.5px] text-text-dim">
        <span className="font-medium text-text-secondary">Plan</span>
        <span className="tabular-nums">{done}/{entry.items.length}</span>
      </div>
      <div className="flex flex-col gap-1.5">
        {entry.items.map((item, i) => (
          <div key={i} className="flex items-start gap-2">
            <span className="mt-[2px] flex size-3.5 shrink-0 items-center justify-center">
              {item.status === "completed" ? (
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="var(--state-success)" strokeWidth="1.7"><path d="M2 6.5 5 9.5 10 3" /></svg>
              ) : item.status === "in_progress" ? (
                <span className="size-2.5 rounded-full border-[1.5px] border-state-neutral" style={{ borderTopColor: "transparent", animation: "wv-spin 0.7s linear infinite" }} />
              ) : (
                <span className="size-2.5 rounded-full border border-border-strong" />
              )}
            </span>
            <span className={cn("text-[12.5px] leading-[1.5]", item.status === "completed" ? "text-text-dim line-through" : "text-text-secondary")}>
              {item.text}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Entry({
  dir,
  entry,
  turnActive,
  onConfirm,
  readOnly,
  onRetryRound,
  onOpenBoard,
}: {
  dir: string;
  entry: AgentEntry;
  turnActive: boolean;
  onConfirm: (spec: ConfirmSpec) => void;
  readOnly?: boolean;
  onRetryRound?: (n: number, total: number) => void;
  onOpenBoard?: () => void;
}) {
  if (entry.kind === "user")
    return (
      <>
        <CheckpointRow dir={dir} checkpoint={entry.checkpoint} disabled={turnActive || !!readOnly} onConfirm={onConfirm} />
        <UserMessage text={entry.text} />
      </>
    );
  if (entry.kind === "round")
    return (
      <div className="px-3.5 py-1.5">
        <RoundCard
          dir={dir}
          entry={entry}
          onRetry={readOnly ? undefined : () => onRetryRound?.(entry.n, entry.total)}
          onOpenBoard={onOpenBoard}
        />
      </div>
    );
  if (entry.kind === "assistant") return <AssistantMessage text={entry.text} streaming={entry.streaming} />;
  if (entry.kind === "turn-error") return <TurnError message={entry.message} />;
  if (entry.kind === "perm")
    return (
      <div className="px-3.5 py-1">
        <PermissionCard dir={dir} perm={entry} />
      </div>
    );
  if (entry.kind === "plan")
    return (
      <div className="px-3.5 py-1">
        <PlanCard entry={entry} />
      </div>
    );
  return (
    <div className="px-3.5 py-1">
      <ToolCard tool={entry} dir={dir} readOnly={readOnly} />
    </div>
  );
}

/** #4 — messages waiting for the current turn to end; each cancellable. */
function QueuedMessages({ dir, queue }: { dir: string; queue: string[] }) {
  if (queue.length === 0) return null;
  return (
    <div className="mx-3 mb-2 flex flex-col gap-1.5">
      {queue.map((text, i) => (
        <div
          key={i}
          data-queued-message
          className="flex items-start gap-2 rounded-md border border-border-hairline bg-fill-subtle px-[11px] py-2"
        >
          <span className="mt-[1px] shrink-0 rounded-[5px] bg-surface-card px-1.5 text-[10.5px] text-text-dim">queued</span>
          <span className="min-w-0 flex-1 whitespace-pre-wrap text-[12.5px] text-text-secondary [overflow-wrap:anywhere]">{text}</span>
          <button
            aria-label="Remove this queued message"
            onClick={() => dequeueAgentMessage(dir, i)}
            // one text-line tall + centered glyph: centers on a single-line message,
            // stays pinned to the first line when the text wraps (row is items-start)
            className="flex h-[1lh] shrink-0 items-center text-[12.5px] text-text-dim hover:text-text-secondary"
          >
            <XGlyph size={9} />
          </button>
        </div>
      ))}
    </div>
  );
}

export function AgentPane({
  dir,
  onConfirm,
  onRevealTerminal,
  onOpenReview,
  onOpenBoard,
}: {
  dir: string;
  onConfirm: (spec: ConfirmSpec) => void;
  /** the sign-in flow runs in a terminal tab — the unit must be on screen */
  onRevealTerminal: () => void;
  /** F36 — Review opens the repo viewer on the ledger diff */
  onOpenReview: () => void;
  /** F39 — the round card's "Open the board" */
  onOpenBoard?: () => void;
}) {
  const [, bump] = useState(0);
  useEffect(() => subscribeAgent(() => bump((n) => n + 1)), []);
  useEffect(() => subscribeKanban(() => bump((n) => n + 1)), []); // round cards tick with the board
  useEffect(() => {
    // a live backend session survives a reload; if there's none AND the agent
    // is actually installed, auto-start once — the pane is only mounted for the
    // active, visible-and-expanded project, so this never spins up background
    // tabs. Gated on Claude being present so an unconfigured machine doesn't
    // auto-launch into an error banner on every open; skipped after an explicit
    // End session (phase is then "ended", not "none").
    let cancelled = false;
    void adoptAgentSession(dir).then(async () => {
      if (cancelled || autoStarted.has(dir)) return;
      if (agentSessionFor(dir).phase !== "none") return;
      const a = (await agentsAvailable().catch(() => null)) as { claude?: string | null } | null;
      if (cancelled || !a?.claude) return;
      if (agentSessionFor(dir).phase !== "none") return; // re-check across the await
      autoStarted.add(dir);
      void startAgentSession(dir).catch(() => {});
    });
    return () => { cancelled = true; };
  }, [dir]);
  const s = agentSessionFor(dir);

  /* stick to the bottom while the thread grows, unless the user scrolled up */
  const scrollRef = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  useEffect(() => {
    const el = scrollRef.current;
    if (el && nearBottom.current) el.scrollTop = el.scrollHeight;
  });

  /* needs-login: run `claude /login` in a terminal tab; when that tab's
     session exits, retry the agent session (the plan's retry contract) */
  const [loginTermId, setLoginTermId] = useState<number | null>(null);
  useEffect(() => {
    if (loginTermId == null) return;
    return subscribeTerms(() => {
      const t = getTerm(loginTermId);
      if (!t || t.dead) {
        setLoginTermId(null);
        void startAgentSession(dir).catch(() => {});
      }
    });
  }, [loginTermId, dir]);

  const start = () => void startAgentSession(dir).catch((e) => toastError("Couldn't start the agent", String(e).slice(0, 110)));
  const signIn = () => {
    onRevealTerminal();
    spawnTerm(dir, { title: "sign-in", agent: "claude", autoType: "claude /login" })
      .then((sess) => {
        setActiveTermFor(dir, sess.id);
        setLoginTermId(sess.id);
      })
      .catch((e) => toastError("Couldn't open the sign-in terminal", String(e).slice(0, 90)));
  };

  const banner = (() => {
    if (s.phase === "none")
      return (
        <div data-agent-banner="disconnected" className="mx-3 mb-2 flex items-center gap-[9px] rounded-md bg-fill-subtle px-[11px] py-[9px]">
          <span className="inline-flex items-center gap-1.5 text-[12.5px] text-state-error">
            <ErrorGlyph size={12} />
            The agent bridge isn't running
          </span>
          <span className="flex-1" />
          <BtnPrimary size="sm" onClick={start}>Start it</BtnPrimary>
        </div>
      );
    if (s.phase === "installing" || s.phase === "starting")
      return (
        <div data-agent-banner="installing" className="mx-3 mb-2 flex flex-col gap-2 rounded-md bg-fill-subtle p-[11px]">
          <div className="flex items-center gap-2">
            <Spinner size={11} />
            <span className="text-[12.5px] text-text-secondary">
              {s.phase === "installing" ? "Setting up the agent bridge…" : "Starting the session…"}
            </span>
          </div>
          {s.phase === "installing" && (
            <span className="text-[11.5px] text-text-dim">
              First run downloads the adapter once. Nothing in your project is touched.
            </span>
          )}
        </div>
      );
    if (s.phase === "needs-login")
      return (
        <div data-agent-banner="needs-login" className="mx-3 mb-2 flex flex-col gap-2 rounded-md bg-fill-subtle px-[11px] py-[9px]">
          <div className="flex items-center gap-[9px]">
            <span className="inline-flex items-center gap-1.5 text-[12.5px] text-text-secondary">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" className="shrink-0 text-text-subtle">
                <rect x="2.5" y="5" width="7" height="5.5" rx="1" />
                <path d="M4 5V3.6a2 2 0 0 1 4 0V5" />
              </svg>
              Claude Code isn't signed in
            </span>
            <span className="flex-1" />
            {loginTermId == null && (
              <BtnPrimary size="sm" onClick={signIn} className="whitespace-nowrap">
                Sign in — opens a terminal
              </BtnPrimary>
            )}
          </div>
          {loginTermId != null && (
            <div className="flex items-center gap-2">
              <Spinner size={11} />
              <span className="text-[11.5px] text-text-muted">Waiting for the sign-in to finish in</span>
              <span className="rounded-[5px] bg-fill-subtle px-1.5 font-mono text-[10.5px] text-text-subtle">claude · sign-in</span>
            </div>
          )}
        </div>
      );
    if (s.phase === "error")
      return (
        <div data-agent-banner="error" className="mx-3 mb-2 flex items-start gap-[9px] rounded-md bg-fill-subtle p-[11px]">
          <span className="mt-0.5 shrink-0 text-state-error"><ErrorGlyph size={12} /></span>
          <div className="flex min-w-0 flex-col gap-[7px]">
            <span className="text-[12.5px] leading-[1.5] text-text-secondary">
              The agent bridge stopped and couldn't start a session. It may need an update or a working connection.
            </span>
            {s.errorMessage && (
              <span className="truncate font-mono text-[10.5px] text-text-dim" title={s.errorMessage}>{s.errorMessage}</span>
            )}
            <BtnSecondary size="sm" className="w-max" onClick={start}>Try again</BtnSecondary>
          </div>
        </div>
      );
    if (s.phase === "ended")
      return (
        <div data-agent-banner="ended" className="mx-3 mb-2 flex items-center gap-[9px] rounded-md bg-fill-subtle px-[11px] py-[9px]">
          <span className="text-[12.5px] text-text-muted">The session ended.</span>
          <span className="flex-1" />
          <BtnPrimary size="sm" onClick={start}>Start a new session</BtnPrimary>
        </div>
      );
    return null;
  })();

  /* F37 — a read-only view of an earlier session's transcript */
  if (s.viewing) {
    return (
      <div className="flex min-h-0 flex-1 flex-col" data-agent-viewing>
        <div className="flex shrink-0 items-center gap-2 border-b border-divider bg-fill-subtle px-3.5 py-2">
          <span className="text-xs text-text-muted">Viewing an earlier session — nothing here can act</span>
          <span className="flex-1" />
          <BtnSecondary size="sm" onClick={() => closeAgentViewing(dir)}>Back</BtnSecondary>
          <BtnPrimary
            size="sm"
            onClick={() => {
              closeAgentViewing(dir);
              if (s.phase === "none" || s.phase === "ended" || s.phase === "error") {
                void startAgentSession(dir).catch((e) => toastError("Couldn't start the agent", String(e).slice(0, 90)));
              }
            }}
          >
            Continue in a new session
          </BtnPrimary>
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto py-2">
          {s.viewing.entries.map((entry, i) => (
            <Entry key={i} dir={dir} entry={entry} turnActive={false} onConfirm={onConfirm} readOnly onOpenBoard={onOpenBoard} />
          ))}
        </div>
      </div>
    );
  }

  const empty = s.entries.length === 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {empty ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-[9px] p-5 text-center">
          <span className="mb-1.5"><Chronigirl size={48} /></span>
          <span className="text-[15px] font-semibold text-text-primary">Ask for anything.</span>
          <span className="max-w-[34ch] text-[12.5px] leading-[1.55] text-text-muted [text-wrap:pretty]">
            Chronicle asks before Chronigirl touches your project.
          </span>
        </div>
      ) : (
        <div
          ref={scrollRef}
          data-agent-thread
          onScroll={(e) => {
            const el = e.currentTarget;
            nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
          }}
          className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto py-3"
        >
          {s.entries.map((entry, i) => (
            <Entry
              key={i}
              dir={dir}
              entry={entry}
              turnActive={s.turnActive}
              onConfirm={onConfirm}
              onOpenBoard={onOpenBoard}
              onRetryRound={(n, total) => {
                void startRoundInPane(dir, n, total).catch((e) => toastError("Couldn't restart the round", String(e).slice(0, 90)));
              }}
            />
          ))}
          {/* the "thinking" beat before the first token, so a turn never
              looks stalled — the classic chat typing signal */}
          {s.turnActive && s.entries.at(-1)?.kind !== "assistant" && (
            <div className="flex gap-2.5 px-3.5 pb-1 pt-2">
              <AssistantAvatar />
              <div className="pt-1.5"><TypingDots /></div>
            </div>
          )}
        </div>
      )}
      <ReviewStrip dir={dir} s={s} onOpenReview={onOpenReview} onConfirm={onConfirm} />
      {banner}
      <QueuedMessages dir={dir} queue={s.queue} />
      <Composer dir={dir} disabled={s.phase !== "ready"} onConfirm={onConfirm} />
    </div>
  );
}
