/*
 * The session is warmed when a project opens, not when the pane mounts. It
 * must never warm twice, never warm without Claude installed, and must say
 * "warming", not "starting", so the pane is honest about why it is quick.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const started: string[] = [];
type Update = { dir: string; message: { method: string; params?: Record<string, unknown> } };
let onUpdate: ((u: Update) => void) | null = null;
let claude: string | null = "/usr/local/bin/claude";
let project = "claude-acp";
let launchable: boolean | null = null; // null: follows claude
vi.mock("./ipc", () => ({
  onAcpUpdate: vi.fn(async (cb: (u: Update) => void) => { onUpdate = cb; return () => {}; }),
  agentsAvailable: vi.fn(async () => ({ claude, codex: null, default: claude ? "claude-acp" : "", project, launchable: launchable ?? !!claude, asksFirst: project !== "opencode" })),
  agentSessionStart: vi.fn(async (dir: string) => { started.push(dir); }),
  agentSessionState: vi.fn(async () => null),
  agentPrompt: vi.fn(async () => {}), roundRunMessage: vi.fn(async () => ""), roundPlanBegin: vi.fn(),
  roundPlanCancel: vi.fn(async () => {}), roundPlanSettle: vi.fn(), agentCancel: vi.fn(), agentEdits: vi.fn(async () => []),
  agentHistoryRead: vi.fn(), agentSetConfigOption: vi.fn(), agentRespondPermission: vi.fn(), agentSessionResume: vi.fn(),
  agentSessionStop: vi.fn(), agentSessionsList: vi.fn(), agentSetMode: vi.fn(),
}));
vi.mock("./notes-store", () => ({
  indexFor: () => ({ notes: [], rounds: [], generation: 0, vault: "", borrowed: false }),
  refreshNotes: vi.fn(async () => {}), roundGenerating: vi.fn(() => false), roundNotesFor: vi.fn(() => []), setRoundGenerating: vi.fn(),
}));
vi.mock("./journal", () => ({ announce: vi.fn() }));
vi.mock("@/overlays/toasts", () => ({ toastAction: vi.fn(), toastError: vi.fn() }));

const agent = await import("./agent-session");

describe("warmAgentSession", () => {
  beforeEach(() => { started.length = 0; claude = "/usr/local/bin/claude"; project = "claude-acp"; launchable = null; });

  it("starts the session once and says warming until it is ready", async () => {
    const dir = "/warm-a";
    await agent.warmAgentSession(dir);
    await agent.warmAgentSession(dir);
    expect(started).toEqual([dir]);
    const s = agent.agentSessionFor(dir);
    expect(s.warm).toBe(true);
    expect(agent.agentStateWord(s)).toEqual({ word: "warming", kind: "neutral" });
    s.phase = "ready";
    expect(agent.agentStateWord(s).word).toBe("idle");
  });

  it("warm start is a no-op without claude", async () => {
    claude = null;
    const dir = "/warm-b";
    await agent.warmAgentSession(dir);
    expect(started).toEqual([]);
    expect(agent.agentSessionFor(dir).phase).toBe("none");
    expect(agent.agentStateWord(agent.agentSessionFor(dir)).word).toBe("idle");
  });

  it("with no session live, the pane names the project's own agent, not Claude", async () => {
    project = "codex-acp";
    launchable = false; // can't start on this Mac yet: nothing is live
    const dir = "/warm-e";
    await agent.warmAgentSession(dir);
    expect(started).toEqual([]);
    const s = agent.agentSessionFor(dir);
    expect(s.phase).toBe("none");
    expect(s.agent).toBe("codex-acp");
    expect(s.asksFirst).toBe(true);
  });

  it("a started session carries the project's agent from the first frame", async () => {
    project = "opencode";
    const dir = "/warm-f";
    await agent.startAgentSession(dir);
    const s = agent.agentSessionFor(dir);
    expect(s.agent).toBe("opencode");
    expect(s.asksFirst).toBe(false);
  });

  it("does not warm a session that was explicitly ended", async () => {
    const dir = "/warm-c";
    Object.assign(agent.agentSessionFor(dir), { phase: "ended" });
    await agent.warmAgentSession(dir);
    expect(started).toEqual([]);
  });

  it("a ready session_state event clears warm", async () => {
    const dir = "/warm-d";
    await agent.warmAgentSession(dir);
    const s = agent.agentSessionFor(dir);
    expect(s.warm).toBe(true);
    onUpdate!({ dir, message: { method: "_chronicle/session_state", params: { state: "ready", sessionId: "sid" } } });
    expect(s.phase).toBe("ready");
    expect(s.warm).toBe(false);
  });
});
