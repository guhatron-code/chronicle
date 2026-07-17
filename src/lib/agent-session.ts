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
  agentPrompt,
  agentRespondPermission,
  agentSessionStart,
  agentSessionState,
  agentSessionStop,
  agentSetMode,
  onAcpUpdate,
  type AcpUpdate,
  type AgentEditFile,
} from "./ipc";

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
  | { kind: "turn-error"; message: string };

export interface AgentSessionState {
  phase: AgentPhase;
  sessionId: string | null;
  modes: { currentModeId: string; availableModes: AgentMode[] } | null;
  loadSession: boolean; // adapter capability — Z-4 resume gating
  turnActive: boolean;
  usage: { used: number; size: number } | null;
  entries: AgentEntry[];
  errorMessage: string | null;
  /** the Works-freely confirm is per SESSION — reset on every new session */
  worksFreelyConfirmed: boolean;
  /** composer preload (F38) — a draft the user still has to send */
  draft: string | null;
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
  draft: null,
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
  const s = agentSessionFor(u.dir);
  const msg = u.message ?? {};
  const method = str(msg.method);
  const params = (msg.params ?? {}) as Raw;

  if (method === "_chronicle/session_state") {
    const state = str(params.state);
    if (state === "installing") {
      Object.assign(s, blank(), { phase: "installing" as AgentPhase, draft: s.draft });
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
    } else if (state === "ended") {
      // needs-login/error keep their more specific face over the shutdown event
      if (s.phase !== "needs-login" && s.phase !== "error") s.phase = "ended";
      s.turnActive = false;
      settleStreaming(s);
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
    refreshAgentEdits(u.dir);
    return;
  }

  if (method === "_chronicle/turn_end") {
    s.turnActive = false;
    settleStreaming(s);
    if (params.error != null) {
      const err = params.error as Raw;
      s.entries.push({
        kind: "turn-error",
        message: str(err.message) || "The agent stopped with an error.",
      });
    }
    notify();
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
      detail: toolDetail(u.dir, kind, tc),
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
        detail: toolDetail(u.dir, toolKind, update),
      };
      applyToolContent(u.dir, entry, update.content);
      s.entries.push(entry);
    } else if (kind === "tool_call_update") {
      const id = str(update.toolCallId);
      for (const e of s.entries) {
        if (e.kind === "tool" && e.toolCallId === id) {
          if (update.status != null) e.status = str(update.status) as typeof e.status;
          if (update.title != null) e.title = str(update.title);
          if (update.kind != null) e.toolKind = str(update.kind);
          const freshDetail = toolDetail(u.dir, e.toolKind, update);
          if (freshDetail && freshDetail !== str(update.title)) e.detail = freshDetail;
          applyToolContent(u.dir, e, update.content);
        }
      }
    } else if (kind === "current_mode_update") {
      if (s.modes) s.modes.currentModeId = str(update.currentModeId);
    } else if (kind === "usage_update") {
      const used = Number(update.used);
      const size = Number(update.size);
      if (Number.isFinite(used) && Number.isFinite(size) && size > 0) s.usage = { used, size };
    }
    // user_message_chunk (we already pushed the sent text), thoughts, plans,
    // available_commands: not rendered in v0.3
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
  notify();
  try {
    await agentSessionStart(dir);
  } catch (e) {
    s.phase = "error";
    s.errorMessage = String(e);
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
      s.turnActive = Boolean(raw.turnActive);
      notify();
    }
  } catch {
    /* no session — the pane shows its start state */
  }
}

export async function sendAgentMessage(dir: string, text: string): Promise<void> {
  const s = agentSessionFor(dir);
  const body = text.trim();
  if (!body) return;
  await agentPrompt(dir, body); // throws before anything is shown, honest to the wire
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
  notify();
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
export function setAgentDraft(dir: string, draft: string | null) {
  const s = agentSessionFor(dir);
  s.draft = draft;
  notify();
}

export function agentLive(dir: string): boolean {
  const s = sessions.get(dir);
  return !!s && (s.phase === "ready" || s.phase === "installing" || s.phase === "starting");
}
