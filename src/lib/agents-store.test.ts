// src/lib/agents-store.test.ts
/*
 * Switching a project's agent: nothing live → set it and start; a session
 * live on the old agent → ask first, then end it and start the new one. The
 * live session keeps its own agent until it ends (Rust holds its profile).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: string[] = [];
const fail = { set: false, end: false, start: false };
let phase = "none";
vi.mock("./ipc", () => ({ setProjectAgent: vi.fn(async (_d: string, a: string | null) => { if (fail.set) throw new Error("boom"); calls.push(`set:${a}`); }) }));
vi.mock("./agent-session", () => ({
  agentSessionFor: () => ({ phase, agent: "claude-acp", turnActive: false }),
  startAgentSession: vi.fn(async () => { if (fail.start) throw new Error("boom"); calls.push("start"); }),
  endAgentSession: vi.fn(async () => { if (fail.end) throw new Error("boom"); calls.push("end"); }),
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
  beforeEach(() => { calls.length = 0; fail.set = fail.end = fail.start = false; });

  it("sets and starts when nothing is live", async () => {
    phase = "none";
    const confirm = vi.fn();
    await switchProjectAgent("/p", "codex-acp", confirm, vi.fn());
    expect(confirm).not.toHaveBeenCalled();
    expect(calls).toEqual(["set:codex-acp", "start"]);
  });

  it("asks first, and only on yes ends the old session and starts the new one", async () => {
    phase = "ready";
    let spec = null as { title: string; onConfirm: () => void } | null; // assigned in the callback
    await switchProjectAgent("/p", "codex-acp", (s) => { spec = s as typeof spec; }, vi.fn());
    expect(calls).toEqual([]); // nothing changes before the answer
    expect(spec!.title).toBe("Switch to Codex?");
    await (spec!.onConfirm as () => Promise<void>)();
    expect(calls).toEqual(["set:codex-acp", "end", "start"]);
  });

  async function confirmed(onError: (m: string) => void) {
    phase = "ready";
    let spec = null as { onConfirm: () => Promise<void> } | null;
    await switchProjectAgent("/p", "codex-acp", (s) => { spec = s as unknown as typeof spec; }, onError);
    await spec!.onConfirm();
  }

  it("says the choice wasn't saved, and runs nothing else, when saving it fails", async () => {
    fail.set = true;
    const onError = vi.fn();
    await confirmed(onError);
    expect(calls).toEqual([]);
    expect(onError.mock.calls[0][0]).toContain("choice wasn't saved");
  });

  it("keeps the saved choice and says the old session couldn't be ended", async () => {
    fail.end = true;
    const onError = vi.fn();
    await confirmed(onError);
    expect(calls).toEqual(["set:codex-acp"]);
    expect(onError.mock.calls[0][0]).toContain("The project now uses Codex, but the old session couldn't be ended — stop it from the header");
  });

  it("keeps the saved choice and says the new session couldn't start", async () => {
    fail.start = true;
    const onError = vi.fn();
    await confirmed(onError);
    expect(calls).toEqual(["set:codex-acp", "end"]);
    expect(onError.mock.calls[0][0]).toContain("The project now uses Codex, but it couldn't start — press Start in the composer");
  });
});
