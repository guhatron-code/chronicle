/*
 * The doctor's frontend store — framework-free, one shared instance, mirroring
 * agent-session.ts. Holds the six checks, folds live `setup-update` progress
 * events over the last full status, and drives install / repair / run-all /
 * sign-in. Listeners register ONCE at module scope (the ipc.ts law).
 */
import {
  agentsAccessDisable,
  agentsAccessEnable,
  agentsAccessStatus,
  agentsStatus,
  onSetupUpdate,
  providerKeyRemove,
  providerKeySet,
  providerLocalSet,
  providerRoleSet,
  providersStatus,
  setDefaultAgent,
  setupCancel,
  setupFixTerminalPath,
  setupInstall,
  setupOpenLogin,
  setupRunAll,
  setupStatus,
  type AgentsAccessStatus,
  type AgentsStatus,
  type ProvidersStatus,
  type SetupCheck,
} from "./ipc";
import { every } from "./scheduler";
import { AGENT_ORDER, agentMeta } from "./agents";

/** The row order + plain-language identity the screen renders. Names live here
 *  so the store, not the JSX, is the source of truth for what each check is. */
export const CHECK_META: { id: string; name: string; blurb: string; kind: "claude" | "node" | "connector" | "signin" | "path" | "github" | "skills" | "agents" | "browser" | "design_skills" }[] = [
  { id: "claude", name: "The AI that does the work", blurb: "Claude Code — the assistant that writes and edits your project.", kind: "claude" },
  { id: "claude_signin", name: "Sign in to Claude", blurb: "So the AI can start working on your behalf.", kind: "signin" },
  { id: "node", name: "The engine the AI runs on", blurb: "The background software the AI needs to do its work.", kind: "node" },
  { id: "connector", name: "The agent’s connector", blurb: "The small program Chronicle talks to the AI through. Installed once, so sessions start fast.", kind: "connector" },
  { id: "terminal_path", name: "Make the AI work in the terminal", blurb: "So typing the AI's name in the terminal works.", kind: "path" },
  { id: "github", name: "Your projects' online home", blurb: "Where your projects live online, so you can publish and share them.", kind: "github" },
  { id: "superpowers", name: "Extra skills for the AI", blurb: "Extra abilities that make the AI better at bigger jobs.", kind: "skills" },
  { id: "agents", name: "Let agents reach Chronicle", blurb: "Claude Code in this project can read and write its notes, see the roadmap, read this project's terminal output, and start rounds you watch.", kind: "agents" },
  { id: "design_browser", name: "A browser for checking designs", blurb: "Opens each design the way a visitor would and checks contrast and tap sizes. Downloaded once.", kind: "browser" },
  { id: "design_skills", name: "Design skills", blurb: "The director’s taste and review rules, including shopping-page guidelines.", kind: "design_skills" },
];

/** The machine-wide prerequisites the first-launch gate and the "all set" celebration
 *  require. "agents" is excluded on purpose: it is a per-project opt-in that needs an
 *  open project to even ask about, so it must never block reaching one. */
const REQUIRED_META = CHECK_META.filter((c) => c.kind !== "agents" && c.kind !== "connector" && c.kind !== "browser" && c.kind !== "design_skills");

/** The Design pane's own rows: shown as a group of their own, never required. */
export const DESIGN_META = CHECK_META.filter((c) => c.kind === "browser" || c.kind === "design_skills");

export interface DoctorState {
  checks: Map<string, SetupCheck>;
  loaded: boolean;
  runningAll: boolean;
  /** checks whose sign-in Terminal is open and being polled */
  waitingSignins: Set<string>;
}

const state: DoctorState = {
  checks: new Map(),
  loaded: false,
  runningAll: false,
  waitingSignins: new Set(),
};
const subs = new Set<() => void>();
let listenersReady = false;

function notify() {
  for (const cb of subs) cb();
}

export function subscribeDoctor(cb: () => void): () => void {
  ensureListeners();
  subs.add(cb);
  return () => subs.delete(cb);
}

function ensureListeners() {
  if (listenersReady) return;
  listenersReady = true;
  void onSetupUpdate((u) => {
    const m = u.message;
    if (m.id === "_all") {
      const st = m.state as string;
      state.runningAll = st !== "done" && st !== "stopped";
      notify();
      return;
    }
    const prev = state.checks.get(m.id) ?? { id: m.id, state: "checking" as SetupCheck["state"] };
    // a progress event carries only the delta; merge over the last known row
    state.checks.set(m.id, { ...prev, ...m } as SetupCheck);
    notify();
  });
}

export function doctorState(): DoctorState {
  return state;
}

export function checkFor(id: string): SetupCheck {
  return state.checks.get(id) ?? { id, state: "checking" };
}

export function readyCount(): number {
  return REQUIRED_META.filter((c) => state.checks.get(c.id)?.state === "ready").length;
}
export function totalRequired(): number {
  return REQUIRED_META.length;
}
export function allReady(): boolean {
  return state.loaded && REQUIRED_META.every((c) => state.checks.get(c.id)?.state === "ready");
}

/** Pull a fresh full status (re-check). */
export async function refreshDoctor(): Promise<void> {
  ensureListeners();
  try {
    const s = await setupStatus();
    for (const c of s.checks) {
      // don't stomp a live "installing" row with a stale detect
      const cur = state.checks.get(c.id);
      if (cur?.state === "installing") continue;
      state.checks.set(c.id, c);
    }
    state.loaded = true;
    notify();
  } catch {
    /* leave the last-known state */
  }
}

/* ---------- actions ---------- */

export async function installCheck(id: string): Promise<void> {
  const cur = checkFor(id);
  state.checks.set(id, { ...cur, state: "installing", pct: null });
  notify();
  try {
    await setupInstall(id);
  } catch {
    /* the couldnt_finish event already landed; refresh reconciles */
  }
  await refreshDoctor();
}

export async function fixTerminalPath(id = "terminal_path"): Promise<void> {
  try {
    await setupFixTerminalPath();
    // mark it fixed locally; a real re-check confirms in a fresh shell
    const cur = checkFor(id);
    state.checks.set(id, { ...cur, state: "ready", detail: "Fixed. Open a new terminal and it'll work." });
    notify();
  } catch {
    await refreshDoctor();
  }
}

export async function cancelCheck(id: string): Promise<void> {
  await setupCancel(id).catch(() => {});
}

export async function runEverything(): Promise<void> {
  state.runningAll = true;
  notify();
  try {
    await setupRunAll();
  } finally {
    state.runningAll = false;
    await refreshDoctor();
  }
}

const signinStops = new Map<string, () => void>();

/** Open a real Terminal window for the sign-in and poll the doctor until the
 *  check flips to ready (the user finishes the login in Terminal). */
export async function startSignin(_dir: string | null, id: string): Promise<void> {
  const kind = id === "github" ? "github" : "claude";
  await setupOpenLogin(kind);
  state.waitingSignins.add(id);
  notify();
  const started = Date.now();
  signinStops.get(id)?.();
  let stop: () => void = () => {};
  const finish = () => {
    stop();
    signinStops.delete(id);
    state.waitingSignins.delete(id);
    notify();
  };
  stop = every(3500, async () => {
    await refreshDoctor();
    if (state.checks.get(id)?.state === "ready") { finish(); return; }
    // give up after 5 minutes; a manual "Re-check" still works
    if (Date.now() - started > 5 * 60_000) finish();
  });
  signinStops.set(id, finish);
}

/** The setup screen is gone — nobody is waiting for a sign-in anymore. */
export function cancelSignins(): void {
  for (const finish of [...signinStops.values()]) finish();
}

export function waitingSignin(id: string): boolean {
  return state.waitingSignins.has(id);
}

/* ---------- the Your agent group (spec §3-§4, board 1) ----------
 * Fetched with the open project's dir, like the agents row; mapped here so the
 * mapping is testable without a Tauri runtime. Installs report through the
 * ordinary setup-update stream under the check id `agent:<id>`. */

export interface AgentRowView {
  id: string;
  name: string;
  blurb: string;
  chosen: boolean;
  selectable: boolean;
  state: "ready" | "needs_you" | "missing" | "blocked" | "unsupported" | "installing";
  word: string;
  detail: string;
  action: "install" | "signin" | "";
  pct: number | null;
}

export const connectorName = (agentName: string) => `${agentName}’s connector`;

export function agentRows(status: AgentsStatus | null, progress: (checkId: string) => SetupCheck | undefined): AgentRowView[] {
  if (!status) return [];
  const order = (id: string) => { const i = (AGENT_ORDER as readonly string[]).indexOf(id); return i < 0 ? 99 : i; };
  return [...status.agents].sort((a, b) => order(a.id) - order(b.id)).map((a) => {
    const meta = agentMeta(a.id);
    const base = { id: a.id, name: a.name, blurb: meta.blurb, chosen: a.id === status.default, selectable: a.supported, pct: null as number | null };
    const live = progress(`agent:${a.id}`);
    if (!a.supported) return { ...base, state: "unsupported", word: "not yet supported", detail: `${meta.blurb} Not supported on this Mac yet.`, action: "" };
    if (live?.state === "installing") return { ...base, state: "installing", word: "installing", detail: meta.blurb, action: "", pct: live.pct ?? null };
    if (!a.installed) return { ...base, state: "missing", word: "missing", detail: `${meta.blurb} Not on this Mac yet.`, action: "install" };
    // the agent's own CLI is needed only to sign in (ruling R20): signed in, it runs without it
    if (a.missing && a.signedIn !== true) return { ...base, state: "blocked", word: "needs you", detail: `${meta.blurb} Needs ${a.missing} installed first.`, action: "" };
    if (a.signedIn === false) {
      if (a.login.kind === "terminal") return { ...base, state: "needs_you", word: "needs you", detail: `Installed. Sign in with ${a.login.command}.`, action: "signin" };
      if (a.login.kind === "auth_method") return { ...base, state: "needs_you", word: "needs you", detail: "Installed. Signs in from the pane the first time you use it.", action: "" };
      return { ...base, state: "needs_you", word: "needs you", detail: "Installed. It signs in with its own setup.", action: "" };
    }
    return { ...base, state: "ready", word: "ready", detail: a.signedIn ? `${meta.blurb} Signed in.` : meta.blurb, action: "" };
  }) as AgentRowView[];
}

let agents: AgentsStatus | null = null;
export function agentsState(): AgentsStatus | null {
  return agents;
}

export async function refreshAgentsStatus(dir: string | null): Promise<void> {
  try {
    agents = await agentsStatus(dir);
  } catch {
    /* keep the last-known rows */
  }
  notify();
}

export async function chooseDefaultAgent(id: string, dir: string | null): Promise<void> {
  await setDefaultAgent(id);
  await refreshAgentsStatus(dir);
  await refreshDoctor(); // the connector row follows the chosen agent
}

export async function installAgent(id: string, dir: string | null): Promise<void> {
  await installCheck(`agent:${id}`);
  await refreshAgentsStatus(dir);
}

/** Open Terminal with the agent's own sign-in command and poll until it reads signed in. */
export async function signInAgent(id: string, dir: string | null): Promise<void> {
  const key = `agent:${id}`;
  await setupOpenLogin(key);
  state.waitingSignins.add(key);
  notify();
  const started = Date.now();
  signinStops.get(key)?.();
  let stop: () => void = () => {};
  const finish = () => {
    stop();
    signinStops.delete(key);
    state.waitingSignins.delete(key);
    notify();
  };
  stop = every(3500, async () => {
    await refreshAgentsStatus(dir);
    if (agents?.agents.find((a) => a.id === id)?.signedIn) { finish(); return; }
    if (Date.now() - started > 5 * 60_000) finish();
  });
  signinStops.set(key, finish);
}

/* ---------- the "agents" row (src-tauri/src/main.rs: agents_access_*) ----------
 * Per-project, not machine-wide, so it does not come from setupStatus() — it is
 * fetched with the currently open project's dir and mapped here, kept pure so the
 * mapping is testable without a Tauri runtime. */

/** Pure: what the row should show for a given backend status and the currently
 *  open project's dir. No dir ⇒ blocked (nothing to turn on yet); a dir with no
 *  status yet (still loading) ⇒ checking; otherwise ready/needs_you from `mcp`.
 *  A ready row whose skill is hand-managed says so — the human owns that copy,
 *  and Chronicle isn't quietly overwriting it. */
export function agentsRowFor(status: AgentsAccessStatus | null, dir: string | null): SetupCheck {
  if (!dir) return { id: "agents", state: "blocked", detail: "Open a project first", action: "" };
  if (!status) return { id: "agents", state: "checking" };
  if (status.mcp) {
    return {
      id: "agents",
      state: "ready",
      ...(status.skill === "hand-managed"
        ? { detail: "The chronicle skill at ~/.claude/skills/chronicle is yours to manage." }
        : {}),
    };
  }
  return {
    id: "agents",
    state: "needs_you",
    detail: "Writes .mcp.json in this project and installs the chronicle skill.",
    action: "install",
  };
}

/** The row when asking the backend failed. A "checking" row here would spin for
 *  the rest of the session with nothing to click and nothing to read; this one
 *  says what went wrong and keeps the Turn on button, which retries the lot. */
export function agentsRowForError(err: unknown): SetupCheck {
  return { id: "agents", state: "needs_you", detail: String(err), action: "install" };
}

/** Pull the agents row fresh for whichever project is open (or blocked, if none is). */
export async function refreshAgentsRow(dir: string | null): Promise<void> {
  if (!dir) {
    state.checks.set("agents", agentsRowFor(null, null));
    notify();
    return;
  }
  try {
    const status = await agentsAccessStatus(dir);
    state.checks.set("agents", agentsRowFor(status, dir));
  } catch (err) {
    state.checks.set("agents", agentsRowForError(err));
  }
  notify();
}

export async function enableAgentAccess(dir: string): Promise<void> {
  try {
    await agentsAccessEnable(dir);
  } finally {
    await refreshAgentsRow(dir);
  }
}

export async function disableAgentAccess(dir: string): Promise<void> {
  try {
    await agentsAccessDisable(dir);
  } finally {
    await refreshAgentsRow(dir);
  }
}

/* ---------- the Providers group (spec §9, board 1) ----------
 * Two roles (review, decisions), each answered by your agent unless a
 * provider with a saved key or address is chosen. Keys go straight to the
 * Keychain through Rust; this store only ever learns "saved" or not. */

export type Role = "review" | "decisions";

export interface ProviderRowView {
  id: string;
  name: string;
  blurb: string;
  word: string;
  tone: "ready" | "optional";
  action: "add_key" | "remove_key" | "add_address" | "remove_address" | "";
}

const PROVIDER_BLURB: Record<string, string> = {
  anthropic: "Claude models, with your own key.",
  openai: "GPT models, with your own key.",
  openrouter: "Many models through one key.",
  typesafe: "A small, fast model for the agent’s small questions.",
  local: "A model running on this Mac, at an address like http://localhost:11434.",
};

export function providerRows(status: ProvidersStatus | null): ProviderRowView[] {
  if (!status) return [];
  const agent: ProviderRowView = { id: "agent", name: "Your agent", blurb: "No key needed — it rides your sign-in.", word: "ready", tone: "ready", action: "" };
  return [
    agent,
    ...status.providers.map((p): ProviderRowView => {
      const local = p.id === "local";
      return {
        id: p.id,
        name: p.name,
        blurb: PROVIDER_BLURB[p.id] ?? "",
        word: p.saved ? (local ? "address saved" : "key saved") : "optional",
        tone: p.saved ? "ready" : "optional",
        action: p.saved ? (local ? "remove_address" : "remove_key") : local ? "add_address" : "add_key",
      };
    }),
  ];
}

export function roleOptions(status: ProvidersStatus | null, role: Role): { value: string; label: string }[] {
  const saved = (status?.providers ?? []).filter((p) => p.saved && !(role === "review" && p.id === "typesafe"));
  return [{ value: "agent", label: "with your agent" }, ...saved.map((p) => ({ value: p.id, label: p.name }))];
}

/** `refusal`: Rust's sentences for an agent with no Ask mode — it can't answer read-only, so
 *  "sends nothing new" would be false for it. */
export function leavesSentence(role: Role, provider: string, refusal?: { review: string; decisions: string } | null): string {
  if (provider === "local") return "Nothing leaves your Mac: the server on this Mac answers.";
  if (provider === "agent" && refusal) return refusal[role];
  if (provider === "agent")
    return role === "review"
      ? "Review with your agent sends nothing new: it rides the agent you already chose."
      : "Decisions with your agent send nothing new: they ride the agent you already chose.";
  return role === "review"
    ? "A provider receives only the text of what it is asked to review — a diff and a check’s output. Never your whole project."
    : "Only the agent’s small questions leave your Mac — a command’s text, a line from the plan, a failing check’s output. Never your files.";
}

let providers: ProvidersStatus | null = null;
/** the project the group was last shown for: its agent decides whether "with your agent" can answer */
let providersDir: string | null = null;
export function providersState(): ProvidersStatus | null {
  return providers;
}

export async function refreshProviders(dir?: string | null): Promise<void> {
  if (dir !== undefined) providersDir = dir;
  try {
    providers = await providersStatus(providersDir);
  } catch {
    /* keep the last-known rows */
  }
  notify();
}

export async function saveProviderKey(id: string, key: string): Promise<void> {
  try { await providerKeySet(id, key); } finally { await refreshProviders(); }
}
export async function removeProviderKey(id: string): Promise<void> {
  try { await providerKeyRemove(id); } finally { await refreshProviders(); }
}
export async function chooseRole(role: Role, provider: string): Promise<void> {
  try { await providerRoleSet(role, provider); } finally { await refreshProviders(); }
}
export async function saveLocalAddress(url: string | null): Promise<void> {
  try { await providerLocalSet(url); } finally { await refreshProviders(); }
}
