/*
 * The agent session registry — framework-free, one session per project,
 * mirroring term-sessions.ts. Consumes the ONE `acp-update` stream from the
 * Rust seam (raw ACP JSON + `_chronicle/*` lifecycle events), reduces it into
 * a renderable thread, and lets React subscribe with a bump. Listeners
 * register ONCE at module scope (per-mount listeners duplicate under
 * HMR/StrictMode — the ipc.ts law).
 */
import {
  agentCancel,
  agentEdits,
  agentHistoryRead,
  agentPrompt,
  agentSetConfigOption,
  agentRespondPermission,
  agentSessionResume,
  agentSessionStart,
  agentSessionState,
  agentSessionStop,
  agentSessionsList,
  agentSetMode,
  onAcpUpdate,
  roundPlanBegin,
  roundPlanCancel,
  roundPlanSettle,
  roundRunMessage,
  type AcpUpdate,
  type AgentEditFile,
} from "./ipc";
import { clearRunningRound, markRunningRound, runningRoundFor } from "./round-log";
import { indexFor, refreshNotes, roundGenerating, roundNotesFor, setRoundGenerating } from "./notes-store";
import { endNewestRoundCard, roundPlanOutcome } from "./notes-model";
import { announce } from "./journal";
import { toastAction, toastError } from "@/overlays/toasts";

export type AgentPhase =
  | "none" // never started (or explicitly reset)
  | "installing" // npx may be downloading the bridge
  | "starting" // initialize done, session/new in flight
  | "ready"
  | "needs-login"
  | "error"
  | "ended";

export interface AgentMode {
  id: string;
  name: string;
  description?: string;
}

/** A session config option (model, effort, …) the agent advertised. */
export interface AgentConfigOption {
  id: string;
  name: string;
  category?: string;
  currentValue: string;
  options: { value: string; name: string; description?: string }[];
}

/** A slash command the agent advertised. Skills arrive here too — a project
 *  skill is just a command whose description names its plugin. */
export interface AgentCommand {
  name: string;
  description: string;
  /** the agent's own argument hint, e.g. "[pr number]" — shown, never parsed */
  hint?: string;
  /** parsed out of a "(plugin) …" description, for grouping the menu */
  group?: string;
}

export type PermOutcome = { type: "selected"; optionId: string } | { type: "cancelled" };

export type AgentEntry =
  | { kind: "user"; text: string; checkpoint?: string | null }
  | { kind: "assistant"; text: string; streaming: boolean }
  | {
      kind: "tool";
      toolCallId: string;
      toolKind: string; // read | edit | delete | move | search | execute | think | fetch | other
      title: string;
      status: "pending" | "in_progress" | "completed" | "failed";
      /** mono detail — a path for edits/reads, the command for runs */
      detail: string;
      diff?: { plus: number; minus: number };
      output?: string;
      /** the user said no to this call's permission ask */
      rejected?: boolean;
    }
  | {
      kind: "perm";
      requestId: string;
      toolKind: string;
      toolCallId?: string;
      title: string;
      detail: string;
      options: { optionId: string; name: string; kind: string }[];
      outcome?: PermOutcome;
    }
  | { kind: "turn-error"; message: string }
  | {
      kind: "round";
      n: number;
      total: number;
      /** the card is in the thread but its message has not been sent yet: the
       *  pane is mid-turn, or the session is still starting. A queued card is
       *  invisible to the turn-end reducer — the turn it would otherwise
       *  capture is somebody else's */
      queued?: boolean;
      /** set when the turn carrying the round ended — done/failed derive from
       *  the NOTES' statuses plus this stop reason, never the agent's claim */
      ended?: boolean;
      stopReason?: string | null;
    }
  | {
      kind: "round-plan";
      n: number;
      total: number;
      /** waiting for the pane, exactly as on a `round` card: the prompt has not
       *  been sent yet, so no turn ending belongs to this card */
      queued?: boolean;
      /** set when the planning turn ended — the outcome comes from the record
       *  `round_plan_settle` read back, never from what the agent said */
      ended?: boolean;
      outcome?: "ready" | "failed" | "cancelled";
    }
  | {
      kind: "plan";
      items: { text: string; status: "pending" | "in_progress" | "completed" }[];
    };

export interface AgentSessionState {
  phase: AgentPhase;
  sessionId: string | null;
  modes: { currentModeId: string; availableModes: AgentMode[] } | null;
  /** the agent's config options — the model picker reads the "model" one */
  configOptions: AgentConfigOption[];
  /** the agent's slash commands, including every skill — the composer's / menu */
  commands: AgentCommand[];
  loadSession: boolean; // adapter capability — Z-4 resume gating
  turnActive: boolean;
  usage: { used: number; size: number } | null;
  entries: AgentEntry[];
  errorMessage: string | null;
  /** the Works-freely confirm is per SESSION — reset on every new session */
  worksFreelyConfirmed: boolean;
  /** the Full-auto confirm is per SESSION — reset on every new session */
  fullAutoConfirmed: boolean;
  /** the one-time "Turn on Auto?" confirm was accepted this session */
  autoConfirmed: boolean;
  /** composer preload (F38) — a labeled draft the user still has to send */
  draft: { label: string; text: string } | null;
  /** a mirror of the composer's current text — preload checks read it */
  composerText: string;
  /** messages typed while a turn was active — auto-sent FIFO on turn end (#4) */
  queue: string[];
  /** F37 — a read-only view of an earlier session's transcript */
  viewing: { id: string; entries: AgentEntry[] } | null;
  /** the review strip's ground truth — refetched on _chronicle/edits_changed */
  editFiles: AgentEditFile[];
  /** files just resolved to zero — the strip's "All changes kept" moment */
  editsResolved: boolean;
  /** a checkpoint announced before its user message landed in the thread */
  pendingCheckpoint: string | null;
}

const blank = (): AgentSessionState => ({
  phase: "none",
  sessionId: null,
  modes: null,
  loadSession: false,
  turnActive: false,
  usage: null,
  entries: [],
  errorMessage: null,
  worksFreelyConfirmed: false,
  fullAutoConfirmed: false,
  autoConfirmed: false,
  configOptions: [],
  commands: [],
  draft: null,
  composerText: "",
  queue: [],
  viewing: null,
  editFiles: [],
  editsResolved: false,
  pendingCheckpoint: null,
});

const sessions = new Map<string, AgentSessionState>();
const subs = new Set<() => void>();
let listenersReady = false;

function notify() {
  for (const cb of subs) cb();
}

export function subscribeAgent(cb: () => void): () => void {
  ensureListeners();
  subs.add(cb);
  return () => subs.delete(cb);
}

export function agentSessionFor(dir: string): AgentSessionState {
  ensureListeners();
  let s = sessions.get(dir);
  if (!s) {
    s = blank();
    sessions.set(dir, s);
  }
  return s;
}

/** The F37 header word for a session. */
export function agentStateWord(s: AgentSessionState): { word: string; kind: "dim" | "neutral" | "error" } {
  if (s.phase === "needs-login") return { word: "needs login", kind: "error" };
  if (s.phase === "error") return { word: "stopped", kind: "error" };
  if (s.phase === "ended") return { word: "ended", kind: "dim" };
  if (s.phase === "installing" || s.phase === "starting") return { word: "starting", kind: "neutral" };
  if (s.phase === "ready") {
    if (s.entries.some((e) => e.kind === "perm" && !e.outcome)) return { word: "waiting on you", kind: "neutral" };
    if (s.turnActive) return { word: "working", kind: "neutral" };
    return { word: "idle", kind: "dim" };
  }
  return { word: "idle", kind: "dim" };
}

/* ---------- wire reduction ---------- */

/** available_commands_update → the / menu's agent half. The adapter already
 *  filters what it can't run, so whatever arrives here is offerable as-is. */
function parseCommands(raw: unknown): AgentCommand[] {
  if (!Array.isArray(raw)) return [];
  return (raw as Raw[])
    .map((c) => {
      const description = str(c.description);
      // both adapters name the owning plugin as a "(name) " description prefix
      const plugin = /^\(([^)]+)\)\s*/.exec(description);
      const input = (c.input ?? null) as Raw | null;
      return {
        name: str(c.name),
        description: plugin ? description.slice(plugin[0].length) : description,
        hint: input && input.hint != null ? str(input.hint) : undefined,
        group: plugin ? plugin[1] : undefined,
      };
    })
    .filter((c) => c.name.length > 0);
}

function parseConfigOptions(raw: unknown): AgentConfigOption[] {
  if (!Array.isArray(raw)) return [];
  return (raw as Raw[])
    .filter((o) => o.type === "select" && Array.isArray(o.options))
    .map((o) => ({
      id: str(o.id),
      name: str(o.name),
      category: str(o.category) || undefined,
      currentValue: str(o.currentValue),
      options: (o.options as Raw[]).map((v) => ({
        value: str(v.value),
        name: str(v.name),
        description: str(v.description) || undefined,
      })),
    }));
}

function ensureListeners() {
  if (listenersReady) return;
  listenersReady = true;
  void onAcpUpdate(routeUpdate);
}

/** Refetch the ledger list; flags the kept-everything moment honestly. */
export function refreshAgentEdits(dir: string) {
  const s = agentSessionFor(dir);
  agentEdits(dir)
    .then((r) => {
      const files = Array.isArray(r?.files) ? r.files : [];
      s.editsResolved = s.editFiles.length > 0 && files.length === 0;
      s.editFiles = files;
      notify();
    })
    .catch(() => {});
}

/** A cheap, honest ± stat: multiset line difference (not a full Myers diff,
 *  but never claims lines that are present unchanged on both sides). */
function diffStat(oldText: string | null | undefined, newText: string): { plus: number; minus: number } {
  const count = (t: string) => {
    const m = new Map<string, number>();
    if (t === "") return m;
    for (const l of t.split("\n")) m.set(l, (m.get(l) ?? 0) + 1);
    return m;
  };
  const a = count(oldText ?? "");
  const b = count(newText);
  let plus = 0;
  let minus = 0;
  for (const [l, n] of b) plus += Math.max(0, n - (a.get(l) ?? 0));
  for (const [l, n] of a) minus += Math.max(0, n - (b.get(l) ?? 0));
  return { plus, minus };
}

const projectRelative = (dir: string, p: string) =>
  p.startsWith(`${dir}/`) ? p.slice(dir.length + 1) : p;

type Raw = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** Pull the mono detail out of a ToolCall/ToolCallUpdate: a location path for
 *  file-ish calls, the command for runs, the title otherwise. */
function toolDetail(dir: string, kind: string, tc: Raw): string {
  const locations = Array.isArray(tc.locations) ? (tc.locations as Raw[]) : [];
  const loc = str(locations[0]?.path);
  if (loc) return projectRelative(dir, loc);
  const raw = (tc.rawInput ?? {}) as Raw;
  if (kind === "execute") {
    const cmd = str(raw.command);
    if (cmd) return `${cmd}${Array.isArray(raw.args) ? ` ${(raw.args as unknown[]).join(" ")}` : ""}`;
  }
  const path = str(raw.file_path) || str(raw.path) || str(raw.abs_path);
  if (path) return projectRelative(dir, path);
  return str(tc.title);
}

function applyToolContent(dir: string, entry: Extract<AgentEntry, { kind: "tool" }>, content: unknown) {
  if (!Array.isArray(content)) return;
  for (const c of content as Raw[]) {
    if (c.type === "diff") {
      entry.diff = diffStat(c.oldText as string | null, str(c.newText));
      if (c.path) entry.detail = projectRelative(dir, str(c.path));
    } else if (c.type === "content") {
      const block = (c.content ?? {}) as Raw;
      if (block.type === "text" && str(block.text)) {
        entry.output = `${entry.output ?? ""}${str(block.text)}`;
      }
    }
  }
}

function settleStreaming(s: AgentSessionState) {
  for (const e of s.entries) if (e.kind === "assistant") e.streaming = false;
}

function routeUpdate(u: AcpUpdate) {
  reduceInto(agentSessionFor(u.dir), u.dir, u.message ?? {}, true);
}

/**
 * The ONE reducer — live events and transcript replay share it.
 *
 * `live` is false while an OLD session's transcript is being replayed into a
 * throwaway state. Everything that touches the world outside the thread — the
 * running-round mark, settling a round's record, a toast, a journal line —
 * is gated on it: replaying a round you watched last week must not cancel the
 * round running right now.
 */
function reduceInto(s: AgentSessionState, dir: string, msg: AcpUpdate["message"], live: boolean) {
  const method = str(msg.method);
  const params = (msg.params ?? {}) as Raw;

  if (method === "_chronicle/session_state") {
    const state = str(params.state);
    if (state === "installing") {
      Object.assign(s, blank(), { phase: "installing" as AgentPhase, draft: s.draft });
      // the thread and the queue are both gone; a card waiting in that queue
      // must not go on waiting for a prompt that no longer exists (`live`
      // only: a replay must never close the running round's card)
      if (live) dropQueueWaiters(dir);
    } else if (state === "starting") {
      s.phase = "starting";
    } else if (state === "ready") {
      s.phase = "ready";
      s.sessionId = str(params.sessionId) || null;
      const modes = params.modes as Raw | null;
      s.modes = modes
        ? {
            currentModeId: str(modes.currentModeId),
            availableModes: Array.isArray(modes.availableModes)
              ? (modes.availableModes as Raw[]).map((m) => ({
                  id: str(m.id),
                  name: str(m.name),
                  description: str(m.description) || undefined,
                }))
              : [],
          }
        : null;
      s.configOptions = parseConfigOptions(params.configOptions);
      const caps = params.agentCaps as Raw | null;
      s.loadSession = Boolean((caps?.agentCapabilities as Raw | undefined)?.loadSession);
    } else if (state === "needs-login") {
      s.phase = "needs-login";
      s.turnActive = false;
    } else if (state === "error") {
      s.phase = "error";
      s.errorMessage = str(params.message) || "The agent bridge stopped.";
      s.turnActive = false;
      settleStreaming(s);
      if (live) clearRunningRound(dir); // a dead bridge is not running anyone's round
    } else if (state === "ended") {
      // needs-login/error keep their more specific face over the shutdown event
      if (s.phase !== "needs-login" && s.phase !== "error") s.phase = "ended";
      s.turnActive = false;
      settleStreaming(s);
      if (live) clearRunningRound(dir);
    }
    notify();
    return;
  }

  if (method === "_chronicle/checkpoint") {
    const id = str(params.id);
    if (id) {
      // attach to the message this snapshot preceded — the entry may or may
      // not have landed yet (event vs invoke resolution order)
      const lastUser = [...s.entries].reverse().find((e) => e.kind === "user");
      if (lastUser && lastUser.kind === "user" && lastUser.checkpoint === undefined) {
        lastUser.checkpoint = id;
      } else {
        s.pendingCheckpoint = id;
      }
      notify();
    }
    return;
  }

  if (method === "_chronicle/write" || method === "_chronicle/edits_changed") {
    refreshAgentEdits(dir);
    return;
  }

  if (method === "_chronicle/user_message") {
    // transcript replay only — live sends push their entry directly
    s.entries.push({ kind: "user", text: str(params.text), checkpoint: s.pendingCheckpoint ?? undefined });
    s.pendingCheckpoint = null;
    return;
  }

  if (method === "_chronicle/turn_end") {
    s.turnActive = false;
    settleStreaming(s);
    const stopReason = params.error != null ? "error" : str(params.stopReason) || null;
    // A turn carries a plan or a run, never both. The plan's record is settled
    // HERE and nowhere else: `round_plan_settle` mid-turn would mark the round
    // failed and put every note back in the queue under the agent's feet.
    //
    // A QUEUED card is skipped in both loops below. Its card is in the thread
    // but its message is not sent yet — it is waiting for this very turn to
    // end — so the turn that is ending belongs to whatever the user was doing,
    // never to it.
    let settledPlan = false;
    if (live) {
      for (let i = s.entries.length - 1; i >= 0; i--) {
        const e = s.entries[i];
        if (e.kind === "round-plan" && !e.ended && !e.queued) {
          e.ended = true;
          settledPlan = true;
          void settleRoundPlan(dir, e, stopReason);
          break;
        }
      }
    }
    // a running round settles with the turn — its face derives from the notes
    if (live && !settledPlan) {
      for (let i = s.entries.length - 1; i >= 0; i--) {
        const e = s.entries[i];
        if (e.kind === "round" && !e.ended && !e.queued) {
          e.ended = true;
          e.stopReason = stopReason;
          // the Notes card has no session to watch for this route — the thread IS
          // the round — so the turn ending is the only thing that can tell it the
          // round is no longer running, however it ended (settleRoundRun clears
          // the mark, and speaks only if the round did not actually finish)
          settleRoundRun(dir, e.n);
          break;
        }
      }
    }
    if (params.error != null) {
      const err = params.error as Raw;
      s.entries.push({
        kind: "turn-error",
        message: str(err.message) || "The agent stopped with an error.",
      });
    }
    notify();
    // #4 — a clean turn end releases the next queued message (FIFO, one/turn).
    // A cancel (Stop) ends with stopReason "cancelled" and no error — it must
    // NOT flush (the queue persists so the user can still cancel items); on an
    // errored turn we also keep the queue rather than fire into a broken session.
    // NOTE: this is safe under transcript replay because replay runs on a blank
    // tmp state whose queue is always empty (the queue is only populated from
    // the composer, never from the wire).
    //
    // AFTER the notify, not before: a round or plan card waiting for this turn
    // wakes up in that notify and has to see the queue as it really is. Flushing
    // first empties a one-message queue, so the card read "nothing is waiting",
    // sent its own prompt into the flush's in-flight one, and the single-flight
    // agent rejected it — the round never ran and the card said "stopped early".
    if (params.error == null && str(params.stopReason) !== "cancelled") flushQueue(dir, s);
    return;
  }

  if (method === "_chronicle/permission_resolved") {
    const id = str(params.requestId);
    const outcome = str(params.outcome);
    for (const e of s.entries) {
      if (e.kind === "perm" && e.requestId === id && !e.outcome) {
        e.outcome = outcome === "cancelled" ? { type: "cancelled" } : { type: "selected", optionId: outcome };
        markRejected(s, e);
      }
    }
    notify();
    return;
  }

  if (method === "session/request_permission") {
    const tc = (params.toolCall ?? {}) as Raw;
    const kind = str(tc.kind) || "other";
    s.entries.push({
      kind: "perm",
      requestId: JSON.stringify(msg.id),
      toolKind: kind,
      toolCallId: str(tc.toolCallId) || undefined,
      title:
        kind === "edit" || kind === "delete" || kind === "move"
          ? "The agent wants to edit"
          : kind === "execute"
            ? "The agent wants to run"
            : kind === "read" || kind === "search" || kind === "fetch"
              ? "The agent wants to read"
              : "The agent asks to continue",
      detail: toolDetail(dir, kind, tc),
      options: Array.isArray(params.options)
        ? (params.options as Raw[]).map((o) => ({
            optionId: str(o.optionId),
            name: str(o.name),
            kind: str(o.kind),
          }))
        : [],
    });
    notify();
    return;
  }

  if (method === "session/update") {
    const update = (params.update ?? {}) as Raw;
    const kind = str(update.sessionUpdate);
    if (kind === "agent_message_chunk") {
      const content = (update.content ?? {}) as Raw;
      if (content.type === "text") {
        const last = s.entries[s.entries.length - 1];
        if (last?.kind === "assistant" && last.streaming) last.text += str(content.text);
        else s.entries.push({ kind: "assistant", text: str(content.text), streaming: true });
      }
    } else if (kind === "tool_call") {
      settleStreamTail(s);
      const toolKind = str(update.kind) || "other";
      const entry: Extract<AgentEntry, { kind: "tool" }> = {
        kind: "tool",
        toolCallId: str(update.toolCallId),
        toolKind,
        title: str(update.title),
        status: (str(update.status) || "pending") as Extract<AgentEntry, { kind: "tool" }>["status"],
        detail: toolDetail(dir, toolKind, update),
      };
      applyToolContent(dir, entry, update.content);
      s.entries.push(entry);
    } else if (kind === "tool_call_update") {
      const id = str(update.toolCallId);
      for (const e of s.entries) {
        if (e.kind === "tool" && e.toolCallId === id) {
          if (update.status != null) e.status = str(update.status) as typeof e.status;
          if (update.title != null) e.title = str(update.title);
          if (update.kind != null) e.toolKind = str(update.kind);
          const freshDetail = toolDetail(dir, e.toolKind, update);
          if (freshDetail && freshDetail !== str(update.title)) e.detail = freshDetail;
          applyToolContent(dir, e, update.content);
        }
      }
    } else if (kind === "current_mode_update") {
      if (s.modes) s.modes.currentModeId = str(update.currentModeId);
    } else if (kind === "config_option_update") {
      s.configOptions = parseConfigOptions(update.configOptions);
    } else if (kind === "usage_update") {
      const used = Number(update.used);
      const size = Number(update.size);
      if (Number.isFinite(used) && Number.isFinite(size) && size > 0) s.usage = { used, size };
    } else if (kind === "plan") {
      const raw = Array.isArray(update.entries) ? (update.entries as Raw[]) : [];
      const items = raw.map((e) => {
        const st = str(e.status);
        return {
          text: str(e.content),
          status: (st === "in_progress" || st === "completed" ? st : "pending") as
            | "pending"
            | "in_progress"
            | "completed",
        };
      });
      // update the live plan in place; a session has one evolving list
      const last = [...s.entries].reverse().find((e) => e.kind === "plan");
      if (last && last.kind === "plan") last.items = items;
      else s.entries.push({ kind: "plan", items });
    } else if (kind === "available_commands_update") {
      s.commands = parseCommands(update.availableCommands);
    }
    // user_message_chunk (we already pushed the sent text) and thoughts stay unrendered
    notify();
    return;
  }
  // _chronicle/write lands in Z-3 (the review strip); other traffic is inert here
}

/** a tool_call arriving mid-stream ends the current assistant paragraph */
function settleStreamTail(s: AgentSessionState) {
  const last = s.entries[s.entries.length - 1];
  if (last?.kind === "assistant") last.streaming = false;
}

/** A denied permission marks its tool card "You said no — skipped". */
function markRejected(s: AgentSessionState, perm: Extract<AgentEntry, { kind: "perm" }>) {
  const outcome = perm.outcome;
  const denied =
    outcome?.type === "selected" &&
    perm.options.some((o) => o.optionId === outcome.optionId && o.kind.startsWith("reject"));
  if (!denied || !perm.toolCallId) return;
  for (const e of s.entries) {
    if (e.kind === "tool" && e.toolCallId === perm.toolCallId) e.rejected = true;
  }
}

/* ---------- actions ---------- */

export async function startAgentSession(dir: string): Promise<void> {
  const s = agentSessionFor(dir);
  Object.assign(s, blank(), { phase: "installing" as AgentPhase, draft: s.draft });
  dropQueueWaiters(dir); // the queue went with the thread
  notify();
  try {
    await agentSessionStart(dir);
  } catch (e) {
    s.phase = "error";
    s.errorMessage = String(e);
    clearRunningRound(dir); // a session that failed to start is not running anyone's round
    notify();
    throw e;
  }
}

/** Re-sync after a reload: a live backend session re-adopts its state (the
 *  thread itself is rebuilt from the transcript store in Z-4). */
export async function adoptAgentSession(dir: string): Promise<void> {
  refreshAgentEdits(dir); // the ledger outlives sessions — a restart still reviews
  const s = agentSessionFor(dir);
  if (s.phase !== "none") return;
  try {
    const st = await agentSessionState(dir);
    if (st && (st as { alive?: boolean }).alive) {
      const raw = st as Record<string, unknown>;
      s.phase = "ready";
      s.sessionId = (raw.sessionId as string) ?? null;
      const modes = raw.modes as Raw | null;
      if (modes && modes.currentModeId != null) {
        s.modes = {
          currentModeId: str(modes.currentModeId),
          availableModes: Array.isArray(modes.availableModes)
            ? (modes.availableModes as Raw[]).map((m) => ({ id: str(m.id), name: str(m.name) }))
            : [],
        };
      }
      s.configOptions = parseConfigOptions(raw.configOptions);
      s.turnActive = Boolean(raw.turnActive);
      notify();
    }
  } catch {
    /* no session — the pane shows its start state */
  }
}

/**
 * Send a turn. `text` is what the thread shows; `blocks` is what goes on the
 * wire when the composer built something richer than plain text (file links,
 * inlined note/roadmap context). Omit it and the message is one text block —
 * which is what every non-composer caller wants.
 */
export async function sendAgentMessage(dir: string, text: string, blocks?: unknown[]): Promise<void> {
  const s = agentSessionFor(dir);
  const body = text.trim();
  if (!body) return;
  // throws before anything is shown, honest to the wire
  await agentPrompt(dir, blocks ?? [{ type: "text", text: body }], body);
  s.entries.push({ kind: "user", text: body, checkpoint: s.pendingCheckpoint ?? undefined });
  s.pendingCheckpoint = null;
  s.turnActive = true;
  s.draft = null;
  s.editsResolved = false; // the strip's resolution flash ends with a new turn
  notify();
}

export async function cancelAgentTurn(dir: string): Promise<void> {
  await agentCancel(dir);
  // the stop lands via _chronicle/turn_end (stop reason cancelled)
}

export async function setAgentMode(dir: string, modeId: string): Promise<void> {
  const s = agentSessionFor(dir);
  await agentSetMode(dir, modeId);
  if (s.modes) s.modes.currentModeId = modeId;
  if (modeId === "acceptEdits") s.worksFreelyConfirmed = true;
  if (modeId === "bypassPermissions") s.fullAutoConfirmed = true;
  if (modeId === "auto") s.autoConfirmed = true;
  notify();
}

export async function setAgentConfigOption(dir: string, configId: string, value: string): Promise<void> {
  const s = agentSessionFor(dir);
  const opt = s.configOptions.find((o) => o.id === configId);
  if (opt) opt.currentValue = value; // optimistic; config_option_update confirms
  notify();
  await agentSetConfigOption(dir, configId, value);
}

export async function answerPermission(dir: string, requestId: string, optionId: string | null): Promise<void> {
  await agentRespondPermission(dir, requestId, optionId);
  // the entry settles via _chronicle/permission_resolved
}

export async function endAgentSession(dir: string): Promise<void> {
  await agentSessionStop(dir);
  // phase flips via the ended event
}

/** F38 — preload the composer without ever sending. */
export function setAgentDraft(dir: string, draft: { label: string; text: string } | null) {
  const s = agentSessionFor(dir);
  s.draft = draft;
  notify();
}

/** The composer mirrors its text here so preload checks can see an unsent
 *  draft without owning the input. No notify — this is a read-side mirror. */
export function mirrorComposerText(dir: string, text: string) {
  agentSessionFor(dir).composerText = text;
}

/** Queue a message typed during an active turn (#4). */
export function enqueueAgentMessage(dir: string, text: string) {
  const body = text.trim();
  if (!body) return;
  agentSessionFor(dir).queue.push(body);
  notify();
}

/** Drop one queued message by index (the cancel ✕). */
export function dequeueAgentMessage(dir: string, index: number) {
  const s = agentSessionFor(dir);
  if (index >= 0 && index < s.queue.length) {
    const [gone] = s.queue.splice(index, 1);
    notify();
    // if that was a round's prompt waiting its turn, the ✕ has just cancelled
    // the round — the card must not sit open waiting for a turn that is never
    // coming (leftTheQueue is a no-op for an ordinary typed message)
    leftTheQueue(dir, gone, "dropped");
  }
}

/* ---------- history (F37) — the transcript store is the source ---------- */

export interface AgentHistoryRow {
  id: string;
  firstMessage: string;
  userMessages: number;
  updatedAt: number;
  active: boolean;
  resumable: boolean;
}

export async function listAgentSessions(dir: string): Promise<AgentHistoryRow[]> {
  const r = (await agentSessionsList(dir)) as { sessions?: AgentHistoryRow[] } | null;
  return Array.isArray(r?.sessions) ? r.sessions : [];
}

/** Rebuild a thread by replaying stored lines through the ONE reducer. */
async function replayTranscript(dir: string, id: string): Promise<AgentEntry[]> {
  const r = (await agentHistoryRead(dir, id)) as { lines?: AcpUpdate["message"][] } | null;
  const tmp = blank();
  for (const line of r?.lines ?? []) {
    if (line && typeof line === "object") reduceInto(tmp, dir, line, false);
  }
  settleStreaming(tmp);
  // asks from an ended session can't be answered anymore
  for (const e of tmp.entries) {
    if (e.kind === "perm" && !e.outcome) e.outcome = { type: "cancelled" };
  }
  return tmp.entries;
}

/** Read-only view of an earlier session ("View" in the history list). */
export async function viewAgentSession(dir: string, id: string): Promise<void> {
  const entries = await replayTranscript(dir, id);
  const s = agentSessionFor(dir);
  s.viewing = { id, entries };
  notify();
}

export function closeAgentViewing(dir: string) {
  const s = agentSessionFor(dir);
  s.viewing = null;
  notify();
}

/** TRUE resume — only offered when the adapter advertised loadSession. The
 *  thread rebuilds from OUR transcript; the adapter's replay is suppressed. */
export async function resumeAgentSession(dir: string, id: string): Promise<void> {
  const entries = await replayTranscript(dir, id);
  const s = agentSessionFor(dir);
  Object.assign(s, blank(), { phase: "installing" as AgentPhase, entries });
  dropQueueWaiters(dir); // the queue went with the thread
  notify();
  try {
    await agentSessionResume(dir, id);
  } catch (e) {
    s.phase = "error";
    s.errorMessage = String(e);
    notify();
    throw e;
  }
}

/* ---------- round-in-pane (F39) ---------- */

/**
 * A planning turn has ENDED — the only moment the round's record may settle.
 * What the agent wrote decides nothing: `round_plan_settle` reads the plan
 * back off disk and says ready or failed, and a cancelled turn hands the
 * notes back to the queue instead.
 */
async function settleRoundPlan(
  dir: string,
  entry: Extract<AgentEntry, { kind: "round-plan" }>,
  stopReason: string | null,
): Promise<void> {
  let state: "ready" | "failed" | "none" = "none";
  let checked = true;
  try {
    if (stopReason === "cancelled") await roundPlanCancel(dir);
    else state = (await roundPlanSettle(dir)).state;
  } catch {
    // the record was never read back, so it is still marked generating — say
    // exactly that rather than claim the notes are back in the queue
    checked = stopReason === "cancelled";
  }
  entry.outcome = roundPlanOutcome(stopReason, state);
  setRoundGenerating(dir, false);
  notify();
  await refreshNotes(dir);
  if (!checked) {
    toastError("Couldn't check the plan", "The round is still marked as planning; use Stop on the round card to clear it");
  } else if (entry.outcome === "ready") {
    toastAction(`Round ${entry.n} is ready`, "Run it in the pane", () => {
      void startRoundInPane(dir, entry.n, entry.total).catch((e) =>
        toastError("Couldn't start the round", String(e).slice(0, 110)),
      );
    });
  } else if (entry.outcome === "failed") {
    toastError("The plan wasn't written", "Your notes are back in the queue");
  }
}

/**
 * A round's run has stopped, whichever route was running it: the pane's turn
 * ended, or the round's terminal tab died.
 *
 * A run stopping is NOT a round finishing — that is the record's news, and
 * `refreshNotes` announces it the moment the last note is ticked, on both
 * routes (notes-store.ts). So all that is left here is the other ending: the
 * run is over and work is genuinely left in the round. The notes are read back
 * first because a note ticked in the last second is still a tick.
 *
 * The NOTES decide that, not the record: `refreshNotes` does not settle a
 * record (Rust's settle_done runs in the app's poll), so a round whose last
 * note has just been ticked still reads `ready` here for a moment. Reading the
 * record alone announced "ended early" for a round that had in fact just
 * finished, with "finished" arriving right behind it. So: if every note in the
 * round is done, say nothing and let the record path announce the finish on
 * the next poll.
 *
 * Shared with the terminal route (round-run.ts), so the two routes can never
 * end a round differently.
 */
export function settleRoundRun(dir: string, n: number): void {
  // nothing is running this round any more, whatever the notes say
  if (runningRoundFor(dir)?.n === n) clearRunningRound(dir);
  void refreshNotes(dir).then(() => {
    // a record that already says done/failed has spoken (or is about to)
    if (!indexFor(dir).rounds.some((r) => r.n === n && r.state === "ready")) return;
    if (!roundNotesFor(dir, n).some((x) => x.status !== "done")) return;
    announce(dir, "round-ended", `Round ${n} ended early`, "Chronicle");
  });
}

/**
 * "Start a round": freeze the queued notes into a round, then write its plan
 * as a turn in this pane — no background session, nothing to watch but the
 * thread. The record settles when that turn ends, never before.
 */
export async function startRoundPlanInPane(dir: string): Promise<void> {
  const s = agentSessionFor(dir);
  const { n, total, prompt } = await roundPlanBegin(dir);
  setRoundGenerating(dir, true);
  void refreshNotes(dir);
  s.viewing = null;

  /* The card and the record are abandoned together. Leaving the card open is
     the dangerous half: the turn-end reducer settles the newest un-ended
     `round-plan`, so a plan that never got a turn would capture the NEXT
     turn's end — settling an unrelated record and stealing the branch a
     running round needs to clear its mark and announce itself. */
  let over = false;
  const endCard = () => {
    if (endNewestRoundCard(agentSessionFor(dir).entries, "round-plan", "cancelled")) notify();
  };
  const giveUp = () => {
    if (over) return;
    over = true;
    endCard();
    void roundPlanCancel(dir).catch(() => {});
    setRoundGenerating(dir, false);
    void refreshNotes(dir);
  };

  if (s.phase === "ready" && !s.turnActive) {
    s.entries.push({ kind: "round-plan", n, total });
    notify();
    try {
      await sendAgentMessage(dir, prompt);
    } catch (e) {
      giveUp();
      throw e;
    }
    return;
  }
  // Everything else waits for the session, and only a session that is NOT
  // there gets started. A pane that is `ready` with a live turn is the case
  // that made this rule: restarting it blanked the thread and, the backend
  // being single-flight, never emitted `session_state` at all — the pane sat
  // on "installing" forever. Queuing behind the turn is the intended
  // behaviour, so the card lands straight away, marked `queued` (it says
  // "waiting for the pane", and no turn ending is its own) and the subscriber
  // sends the moment the turn drops.
  const needsStart = s.phase !== "ready" && s.phase !== "installing" && s.phase !== "starting";
  /* Once. A session that turns out to be ready while `startAgentSession` is
     still in flight sends from the subscriber before the line below runs, and
     landing a SECOND card — one that says it is still waiting — would leave a
     card no turn ending can close. */
  let landed = false;
  const land = (queued: boolean) => {
    if (landed) return;
    landed = true;
    agentSessionFor(dir).entries.push({ kind: "round-plan", n, total, queued });
    notify();
  };
  const un = sendWhenPaneIsFree(dir, "round-plan", prompt, {
    land,
    // the card's Stop can land while the session is still starting — a plan
    // nobody is waiting for any more must not be sent the moment it is, and
    // its card must not sit open waiting for a turn that will never come
    stillWanted: () => !over && roundGenerating(dir),
    // Stop has already cancelled the record; only the card is left to close
    abandon: () => { over = true; endCard(); },
    fail: giveUp,
  });
  if (!needsStart) { land(true); return; }
  // startAgentSession resets the thread, so the card goes in AFTER it
  try {
    await startAgentSession(dir);
  } catch (e) {
    un();
    giveUp();
    throw e;
  }
  // the subscriber may already have given up while the session was starting —
  // landing a card for an abandoned plan would strand it open
  if (over) return;
  land(true);
}

/**
 * Wait for the pane to be free, then hand the card's prompt over — and stop
 * watching once it is out of our hands, whichever way that happens.
 *
 * "Free" is not just `ready && !turnActive`. The composer has a queue of its
 * own: a turn ending flushes ONE message off it, and the agent takes one
 * prompt at a time (Rust's `Agent::prompt` is single-flight). Sending straight
 * into that flush was rejected with "the agent is still working", which landed
 * in the catch and ended the card "stopped early" without the round ever
 * running. So when the composer has messages waiting, the prompt joins the
 * BACK of that queue and goes out in FIFO order behind them — the user's
 * messages were typed first, and they keep their place.
 *
 * A prompt sitting in that queue is visible in the composer's queued-message
 * strip like any other, ✕ included. That is honest: it is genuinely waiting
 * its turn, and a user who removes it there has cancelled the round, which is
 * `fail`.
 *
 * The card stays `queued` for as long as the prompt is: only the message
 * actually going out unqueues it, because until then no turn ending is the
 * card's own. `land` is idempotent for the same reason the card is landed by
 * whichever comes first — a session that was already idle can send before the
 * caller's own `land()` runs, and a card landed after that must not say it is
 * still waiting.
 */
interface PaneHandoff {
  /** put the card in the thread if it is not there yet */
  land: (queued: boolean) => void;
  /** is the card still wanted? Stop, or the run's mark taken down, says no */
  stillWanted: () => boolean;
  /** it is not wanted: close the card the way this caller closes an abandoned one */
  abandon: () => void;
  /** it was wanted and could not be sent */
  fail: () => void;
}

function sendWhenPaneIsFree(
  dir: string,
  kind: "round" | "round-plan",
  text: string,
  on: PaneHandoff,
): () => void {
  const un = subscribeAgent(() => {
    const cur = agentSessionFor(dir);
    if (cur.phase === "ready" && !cur.turnActive) {
      un();
      if (!on.stillWanted()) { on.abandon(); return; }
      if (cur.queue.length > 0) {
        on.land(true);
        cur.queue.push(text);
        waitOnQueue(dir, text, {
          // asked again at the moment of sending: the wait can be long, and
          // the card can be cancelled anywhere in it
          stillWanted: on.stillWanted,
          sent: () => unqueueCard(dir, kind),
          abandon: on.abandon,
          dropped: on.fail,
        });
        notify();
        return;
      }
      on.land(false);
      unqueueCard(dir, kind);
      void sendAgentMessage(dir, text).catch(on.fail);
      return;
    }
    if (cur.phase === "error" || cur.phase === "needs-login") { un(); on.fail(); }
  });
  return un;
}

/* A prompt handed to the composer's queue, waiting its turn there.
 *
 * The queue alone cannot say what became of it: the turn-end flush sends it,
 * the ✕ removes it, and a session restart throws the whole queue away — all
 * three simply make it disappear. So every place that takes a message off the
 * queue says which happened, and this is where the round card finds out.
 *
 * `stillWanted` is the important one. It is asked AGAIN at the moment of
 * sending, not just when the prompt was handed over: a prompt can wait behind
 * several of the user's messages, and in that time the round card's "Not
 * running anymore" (or the plan card's Stop) can cancel it. A cancelled round
 * must not be executed by a flush that happens later. */
interface QueueWaiter {
  dir: string;
  text: string;
  stillWanted: () => boolean;
  sent: () => void;
  /** it is no longer wanted — the user cancelled it while it waited */
  abandon: () => void;
  /** it was still wanted, but it will never be sent */
  dropped: () => void;
}
const queueWaiters = new Set<QueueWaiter>();
function waitOnQueue(dir: string, text: string, on: Omit<QueueWaiter, "dir" | "text">): void {
  queueWaiters.add({ dir, text, ...on });
}

/** The flush is about to send this message. An ordinary typed message always
 *  goes; a round prompt goes only if its card still wants it, and a cancelled
 *  one takes itself out of the queue here instead of being executed. */
function wantedFromQueue(dir: string, text: string): boolean {
  for (const w of queueWaiters) {
    if (w.dir !== dir || w.text !== text) continue;
    if (w.stillWanted()) return true;
    queueWaiters.delete(w);
    w.abandon();
    return false;
  }
  return true;
}

function leftTheQueue(dir: string, text: string, how: "sent" | "dropped"): void {
  for (const w of queueWaiters) {
    if (w.dir !== dir || w.text !== text) continue;
    queueWaiters.delete(w);
    if (how === "sent") w.sent(); else w.dropped();
    return;
  }
}

/** The whole queue is being thrown away — a session start, a resume, or the
 *  backend announcing a fresh install. Nothing in it will ever be sent, so
 *  every card waiting on it has to be closed rather than left open against a
 *  prompt that no longer exists. */
function dropQueueWaiters(dir: string): void {
  for (const w of [...queueWaiters]) {
    if (w.dir !== dir) continue;
    queueWaiters.delete(w);
    w.dropped();
  }
}

/**
 * Release the next queued message (FIFO, one per turn end).
 *
 * A round prompt that was cancelled while it waited is skipped rather than
 * sent — and skipping it hands the turn to the message behind it, so a cancel
 * can never leave the rest of the queue stuck waiting for a turn that is not
 * coming.
 */
function flushQueue(dir: string, s: AgentSessionState): void {
  let skipped = false;
  while (s.queue.length > 0) {
    const next = s.queue.shift()!;
    if (!wantedFromQueue(dir, next)) { skipped = true; continue; }
    // a round prompt waits to hear which of these two happened, because the
    // queue itself cannot tell it
    void sendAgentMessage(dir, next)
      .then(() => leftTheQueue(dir, next, "sent"))
      .catch(() => leftTheQueue(dir, next, "dropped"));
    return;
  }
  if (skipped) notify(); // the queue strip lost a row and sent nothing
}

/** The card's message is going out now, so it is no longer waiting for the
 *  pane: the turn about to start IS its own, and the turn-end reducer must be
 *  able to see it again. */
function unqueueCard(dir: string, kind: "round" | "round-plan"): void {
  const entries = agentSessionFor(dir).entries;
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e.kind === kind && !e.ended && e.queued) {
      e.queued = false;
      notify();
      return;
    }
  }
}

/** Run a round in the pane: the round card enters the thread, the round
 *  prompt becomes the session's next message (sent as soon as the session is
 *  ready — starting one if needed). Whether it FINISHED is the record's answer
 *  and nobody else's — never the agent's prose, and never the turn ending. */
export async function startRoundInPane(dir: string, n: number, total: number): Promise<void> {
  const s = agentSessionFor(dir);
  s.viewing = null;
  // This route has no log and no session of its own — the mark IS the record
  // that the round is running here, and every exit below clears it. It goes up
  // BEFORE the first await: the mark is what turns both Run buttons off, and
  // marking after the await left them live for the whole round trip, so two
  // clicks ran the round twice (round-run.ts marks the terminal route early
  // for exactly the same reason).
  markRunningRound(dir, { n, route: "pane" });

  /* Giving up has to undo both halves. A card left open is the dangerous one:
     the turn-end reducer settles the newest un-ended `round`, so a run that
     never got sent would capture the NEXT turn's end and announce that some
     other round "ended early". The mark is only ours to clear while it still
     names this round on this route — a round started since must survive. */
  let over = false;
  const giveUp = () => {
    if (over) return;
    over = true;
    if (endNewestRoundCard(agentSessionFor(dir).entries, "round")) notify();
    const m = runningRoundFor(dir);
    if (m?.n === n && m.route === "pane") clearRunningRound(dir);
  };

  // Rust builds the run message for BOTH routes (round_run_message_cmd), so a
  // round asks for the same work — including the Chronicle-Phase marker commit
  // — whether it runs here or in a terminal. Rebuilding it here is how the
  // pane route quietly lost the marker instruction.
  let message: string;
  try {
    message = await roundRunMessage(dir, n);
  } catch (e) {
    giveUp();
    throw e;
  }

  if (s.phase === "ready" && !s.turnActive) {
    s.entries.push({ kind: "round", n, total });
    notify();
    try {
      await sendAgentMessage(dir, message);
    } catch (e) {
      giveUp();
      throw e;
    }
    return;
  }
  // as in startRoundPlanInPane: only a session that is not there is started —
  // a `ready` pane mid-turn queues behind the turn instead of being restarted
  const needsStart = s.phase !== "ready" && s.phase !== "installing" && s.phase !== "starting";
  // once, and whoever gets there first — see startRoundPlanInPane
  let landed = false;
  const land = (queued: boolean) => {
    if (landed) return;
    landed = true;
    agentSessionFor(dir).entries.push({ kind: "round", n, total, queued });
    notify();
  };
  const un = sendWhenPaneIsFree(dir, "round", message, {
    land,
    // "Not running anymore" on the round card just takes the mark down, and a
    // run still waiting for the pane is exactly the case where the user can
    // hit it before anything was sent. The mark IS this route's record of the
    // run, so a mark that is gone (or names some other round) means the user
    // has already said this is not running: give up quietly rather than start
    // the round they just cancelled.
    stillWanted: () => {
      if (over) return false;
      const m = runningRoundFor(dir);
      return m?.n === n && m.route === "pane";
    },
    abandon: giveUp,
    fail: giveUp,
  });
  if (!needsStart) { land(true); return; }
  // startAgentSession resets the thread, so the card goes in AFTER it
  try {
    await startAgentSession(dir);
  } catch (e) {
    un();
    giveUp();
    throw e;
  }
  // the subscriber may have given up while the session was starting — landing
  // a card for a run that will never be sent would strand it open
  if (over) return;
  land(true);
}

export function agentLive(dir: string): boolean {
  const s = sessions.get(dir);
  return !!s && (s.phase === "ready" || s.phase === "installing" || s.phase === "starting");
}
