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

/** A session config option (model, effort, …) the agent advertised. */
export interface AgentConfigOption {
  id: string;
  name: string;
  category?: string;
  currentValue: string;
  options: { value: string; name: string; description?: string }[];
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
      /** set when the turn carrying the round ended — done/failed derive from
       *  the BOARD's columns plus this stop reason, never the agent's claim */
      ended?: boolean;
      stopReason?: string | null;
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
  loadSession: boolean; // adapter capability — Z-4 resume gating
  turnActive: boolean;
  usage: { used: number; size: number } | null;
  entries: AgentEntry[];
  errorMessage: string | null;
  /** the Works-freely confirm is per SESSION — reset on every new session */
  worksFreelyConfirmed: boolean;
  /** the Full-auto confirm is per SESSION — reset on every new session */
  fullAutoConfirmed: boolean;
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
  configOptions: [],
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
  reduceInto(agentSessionFor(u.dir), u.dir, u.message ?? {});
}

/** The ONE reducer — live events and transcript replay share it. */
function reduceInto(s: AgentSessionState, dir: string, msg: AcpUpdate["message"]) {
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
    // a running round settles with the turn — its face derives from the board
    for (let i = s.entries.length - 1; i >= 0; i--) {
      const e = s.entries[i];
      if (e.kind === "round" && !e.ended) {
        e.ended = true;
        e.stopReason = params.error != null ? "error" : str(params.stopReason) || null;
        break;
      }
    }
    if (params.error != null) {
      const err = params.error as Raw;
      s.entries.push({
        kind: "turn-error",
        message: str(err.message) || "The agent stopped with an error.",
      });
    }
    // #4 — a clean turn end releases the next queued message (FIFO, one/turn);
    // on error we keep the queue so a broken session doesn't fire into the void
    if (params.error == null && s.queue.length > 0) {
      const next = s.queue.shift()!;
      void sendAgentMessage(dir, next).catch(() => {});
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
    }
    // user_message_chunk (we already pushed the sent text), thoughts,
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
      s.configOptions = parseConfigOptions(raw.configOptions);
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
  if (modeId === "bypassPermissions") s.fullAutoConfirmed = true;
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
    s.queue.splice(index, 1);
    notify();
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
    if (line && typeof line === "object") reduceInto(tmp, dir, line);
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

/** Run a kanban round in the pane: the round card enters the thread, the
 *  round prompt becomes the session's next message (sent as soon as the
 *  session is ready — starting one if needed). Done/failed derive from the
 *  BOARD plus the stop reason, never from the agent's prose. */
export async function startRoundInPane(dir: string, n: number, total: number): Promise<void> {
  const s = agentSessionFor(dir);
  const message =
    `Read fixes/phase_${n}_fixes_prompt.md and fixes/phase_${n}_fixes_plan.md in this project and execute the round exactly as the prompt instructs: ` +
    `every item, verified honestly, and after each item completes update that task's "column" to "completed" in .chronicle/kanban.json (match by task id, touch updated_at, change nothing else in that file).`;
  s.viewing = null;
  if (s.phase === "ready" && !s.turnActive) {
    s.entries.push({ kind: "round", n, total });
    notify();
    await sendAgentMessage(dir, message);
    return;
  }
  // start (or restart) the session, then land the card and send once ready —
  // startAgentSession resets the thread, so the card goes in AFTER it
  const un = subscribeAgent(() => {
    const cur = agentSessionFor(dir);
    if (cur.phase === "ready" && !cur.turnActive) {
      un();
      void sendAgentMessage(dir, message).catch(() => {});
    }
    if (cur.phase === "error" || cur.phase === "needs-login") un();
  });
  if (s.phase !== "installing" && s.phase !== "starting") {
    await startAgentSession(dir);
  }
  const cur = agentSessionFor(dir);
  cur.entries.push({ kind: "round", n, total });
  notify();
}

export function agentLive(dir: string): boolean {
  const s = sessions.get(dir);
  return !!s && (s.phase === "ready" || s.phase === "installing" || s.phase === "starting");
}
