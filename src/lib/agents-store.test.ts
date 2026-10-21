// src/lib/agents-store.test.ts
/*
 * Switching a project's agent: nothing live → set it and start; a session
 * live on the old agent → ask first, then end it and start the new one. The
 * live session keeps its own agent until it ends (Rust holds its profile).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: string[] = [];
let phase = "none";
vi.mock("./ipc", () => ({ setProjectAgent: vi.fn(async (_d: string, a: string | null) => { calls.push(`set:${a}`); }) }));
vi.mock("./agent-session", () => ({
  agentSessionFor: () => ({ phase, agent: "claude-acp", turnActive: false }),
  startAgentSession: vi.fn(async () => { calls.push("start"); }),
  endAgentSession: vi.fn(async () => { calls.push("end"); }),
}));

const { agentSwitchPlan, switchProjectAgent } = await import("./agents-store");

describe("agentSwitchPlan", () => {
  it("does nothing for the agent already running", () => {
    expect(agentSwitchPlan({ phase: "ready", current: "codex-acp", next: "codex-acp" })).toBe("noop");
  });
  it("starts at once when no session is live", () => {
    for (const p of ["none", "ended", "error", "needs-login"] as const) expect(agentSwitchPlan({ phase: p, current: "claude-acp", next: "gemini" })).toBe("start");
  });
  it("asks first when a session is live or starting", () => {
    for (const p of ["installing", "starting", "ready"] as const) expect(agentSwitchPlan({ phase: p, current: "claude-acp", next: "gemini" })).toBe("confirm-restart");
  });
});

describe("switchProjectAgent", () => {
  beforeEach(() => { calls.length = 0; });

  it("sets and starts when nothing is live", async () => {
    phase = "none";
    const confirm = vi.fn();
    await switchProjectAgent("/p", "codex-acp", confirm);
    expect(confirm).not.toHaveBeenCalled();
    expect(calls).toEqual(["set:codex-acp", "start"]);
  });

  it("asks first, and only on yes ends the old session and starts the new one", async () => {
    phase = "ready";
    let spec = null as { title: string; onConfirm: () => void } | null; // assigned in the callback
    await switchProjectAgent("/p", "codex-acp", (s) => { spec = s as typeof spec; });
    expect(calls).toEqual([]); // nothing changes before the answer
    expect(spec!.title).toBe("Switch to Codex?");
    await (spec!.onConfirm as () => Promise<void>)();
    expect(calls).toEqual(["set:codex-acp", "end", "start"]);
  });
});
