import { describe, expect, it } from "vitest";
import { agentRows, agentsRowFor, agentsRowForError, connectorName, leavesSentence, providerRows, roleOptions } from "./setup-store";
import type { AgentsAccessStatus, AgentsStatus, AgentStatusRow, ProvidersStatus, SetupCheck } from "./ipc";

const status = (mcp: boolean): AgentsAccessStatus => ({ mcp, skill: "installed", command: "/x/chronicle" });

describe("agentsRowFor", () => {
  it("is blocked when no project is open", () => {
    expect(agentsRowFor(null, null)).toEqual({ id: "agents", state: "blocked", detail: "Open a project first", action: "" });
    expect(agentsRowFor(status(true), null)).toEqual({ id: "agents", state: "blocked", detail: "Open a project first", action: "" });
  });

  it("is ready when the project's mcp is on", () => {
    expect(agentsRowFor(status(true), "/tmp/p")).toEqual({ id: "agents", state: "ready" });
  });

  it("needs you to turn it on when a project is open but mcp is off", () => {
    expect(agentsRowFor(status(false), "/tmp/p")).toEqual({
      id: "agents",
      state: "needs_you",
      detail: "Writes .mcp.json in this project and installs the chronicle skill.",
      action: "install",
    });
  });

  it("says what went wrong, and still offers the button, when the check itself failed", () => {
    // a spinner with no explanation and no retry is the one thing this row must
    // never become: a backend error reads as "needs you", with the reason
    expect(agentsRowForError(new Error("no HOME"))).toEqual({
      id: "agents",
      state: "needs_you",
      detail: "Error: no HOME",
      action: "install",
    });
    expect(agentsRowForError("that project isn't open").detail).toBe("that project isn't open");
  });

  it("says the skill is hand-managed when ready but the human owns that copy", () => {
    const handManaged: AgentsAccessStatus = { mcp: true, skill: "hand-managed", command: "/x/chronicle" };
    expect(agentsRowFor(handManaged, "/tmp/p")).toEqual({
      id: "agents",
      state: "ready",
      detail: "The chronicle skill at ~/.claude/skills/chronicle is yours to manage.",
    });
  });
});

it("the Design rows exist, are never required, and do not count toward ready", async () => {
  const m = await import("./setup-store");
  expect(m.CHECK_META.map((c) => c.id)).toEqual(expect.arrayContaining(["design_browser", "design_skills"]));
  expect(m.totalRequired()).toBe(6);
  expect(m.DESIGN_META.map((c) => c.id)).toEqual(["design_browser", "design_skills"]);
});

it("the connector row exists, installs, and never counts toward ready", async () => {
  const m = await import("./setup-store");
  const row = m.CHECK_META.find((c) => c.id === "connector");
  expect(row).toMatchObject({ kind: "connector", name: "The agent’s connector" });
  expect(m.totalRequired()).toBe(6);
  // it sits right after the engine it needs
  const ids = m.CHECK_META.map((c) => c.id);
  expect(ids.indexOf("connector")).toBe(ids.indexOf("node") + 1);
});

const row = (over: Partial<AgentStatusRow>): AgentStatusRow => ({
  id: "codex-acp", name: "Codex", supported: true, launchable: true, installed: true, missing: null, signedIn: true,
  login: { kind: "terminal", command: "codex login" }, ...over,
});
const agentStatus = (agents: AgentStatusRow[], def = "claude-acp"): AgentsStatus => ({ agents, default: def, project: def });
const none = () => undefined;

describe("agentRows", () => {
  it("is empty until the status arrives", () => {
    expect(agentRows(null, none)).toEqual([]);
  });

  it("marks the chosen agent and keeps the registry order", () => {
    const rows = agentRows(agentStatus([row({ id: "opencode", name: "OpenCode" }), row({ id: "claude-acp", name: "Claude Code", login: { kind: "terminal", command: "claude /login" } })]), none);
    expect(rows.map((r) => r.id)).toEqual(["claude-acp", "opencode"]);
    expect(rows[0].chosen).toBe(true);
    expect(rows[1].chosen).toBe(false);
  });

  it("asks a signed-out terminal agent to sign in, naming its command", () => {
    const [r] = agentRows(agentStatus([row({ signedIn: false })]), none);
    expect(r).toMatchObject({ state: "needs_you", word: "needs you", action: "signin", detail: "Installed. Sign in with codex login." });
  });

  it("offers Install for an agent not on this Mac", () => {
    const [r] = agentRows(agentStatus([row({ installed: false })]), none);
    expect(r).toMatchObject({ state: "missing", action: "install", word: "missing" });
    expect(r.detail).toContain("Not on this Mac yet.");
  });

  it("an agent with no build for this Mac is not yet supported, with nothing to press and nothing to choose", () => {
    const [r] = agentRows(agentStatus([row({ id: "opencode", name: "OpenCode", supported: false, installed: false, launchable: false })]), none);
    expect(r).toMatchObject({ state: "unsupported", word: "not yet supported", action: "", selectable: false });
  });

  it("says which of the agent's own tools is missing", () => {
    const [r] = agentRows(agentStatus([row({ id: "claude-acp", name: "Claude Code", missing: "claude", launchable: false })]), none);
    expect(r).toMatchObject({ state: "blocked", action: "", detail: "Anthropic’s agent. The default for new projects. Needs claude installed first." });
  });

  it("shows an install in progress from its setup-update events", () => {
    const progress = (id: string): SetupCheck | undefined => (id === "agent:gemini" ? { id, state: "installing", pct: 40 } : undefined);
    const [r] = agentRows(agentStatus([row({ id: "gemini", name: "Gemini CLI", installed: false, login: { kind: "auth_method", id: "oauth-personal" } })]), progress);
    expect(r).toMatchObject({ state: "installing", word: "installing", pct: 40, action: "" });
  });

  it("a browser sign-in agent says it signs in from the pane", () => {
    const [r] = agentRows(agentStatus([row({ id: "gemini", name: "Gemini CLI", signedIn: false, login: { kind: "auth_method", id: "oauth-personal" } })]), none);
    expect(r).toMatchObject({ state: "needs_you", action: "", detail: "Installed. Signs in from the pane the first time you use it." });
  });

  it("names the connector after its agent", () => {
    expect(connectorName("Claude Code")).toBe("Claude Code’s connector");
  });
});

const prov = (saved: Partial<Record<string, boolean>>, address: string | null = null, roles = { review: "agent", decisions: "agent" }): ProvidersStatus => ({
  roles,
  providers: [
    { id: "anthropic", name: "Anthropic", saved: !!saved.anthropic },
    { id: "openai", name: "OpenAI", saved: !!saved.openai },
    { id: "openrouter", name: "OpenRouter", saved: !!saved.openrouter },
    { id: "typesafe", name: "TypeSafe", saved: !!saved.typesafe },
    { id: "local", name: "Local", saved: !!address, address },
  ],
});

describe("the Providers group", () => {
  it("lists your agent first, then the five providers", () => {
    const rows = providerRows(prov({}));
    expect(rows.map((r) => r.id)).toEqual(["agent", "anthropic", "openai", "openrouter", "typesafe", "local"]);
    expect(rows[0]).toMatchObject({ word: "ready", action: "", blurb: "No key needed — it rides your sign-in." });
    expect(rows[1]).toMatchObject({ word: "optional", tone: "optional", action: "add_key" });
    expect(rows[5]).toMatchObject({ action: "add_address" });
  });

  it("a saved key reads as saved and offers its removal", () => {
    const rows = providerRows(prov({ typesafe: true }, "http://localhost:11434"));
    expect(rows.find((r) => r.id === "typesafe")).toMatchObject({ word: "key saved", tone: "ready", action: "remove_key" });
    expect(rows.find((r) => r.id === "local")).toMatchObject({ word: "address saved", action: "remove_address" });
  });

  it("offers a role only the providers that can answer it", () => {
    const s = prov({ anthropic: true, typesafe: true }, "http://localhost:11434");
    expect(roleOptions(s, "review").map((o) => o.value)).toEqual(["agent", "anthropic", "local"]);
    expect(roleOptions(s, "decisions").map((o) => o.value)).toEqual(["agent", "anthropic", "typesafe", "local"]);
    expect(roleOptions(s, "review")[0].label).toBe("with your agent");
  });

  it("says in one line what leaves the Mac, per role and provider", () => {
    expect(leavesSentence("decisions", "typesafe")).toBe("Only the agent’s small questions leave your Mac — a command’s text, a line from the plan, a failing check’s output. Never your files.");
    expect(leavesSentence("review", "agent")).toBe("Review with your agent sends nothing new: it rides the agent you already chose.");
    expect(leavesSentence("decisions", "local")).toBe("Nothing leaves your Mac: the server on this Mac answers.");
  });
});
