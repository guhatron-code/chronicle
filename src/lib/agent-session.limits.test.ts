/*
 * Round 9 — the reducer hands the rate-limit reading to the global limits
 * store, but only from a LIVE session: replaying last week's thread must not
 * paint last week's limits on the title bar. Cost is per session and lands
 * on the session state either way.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Update = { dir: string; message: { method: string; params?: Record<string, unknown> } };
let onUpdate: ((u: Update) => void) | null = null;
vi.mock("./ipc", () => ({
  onAcpUpdate: vi.fn(async (cb: (u: Update) => void) => { onUpdate = cb; return () => {}; }),
  agentPrompt: vi.fn(), roundRunMessage: vi.fn(), agentSessionStart: vi.fn(),
  roundPlanBegin: vi.fn(), roundPlanCancel: vi.fn(), roundPlanSettle: vi.fn(),
  agentCancel: vi.fn(), agentEdits: vi.fn(), agentHistoryRead: vi.fn(),
  agentSetConfigOption: vi.fn(), agentRespondPermission: vi.fn(), agentSessionResume: vi.fn(),
  agentSessionState: vi.fn(), agentSessionStop: vi.fn(), agentSessionsList: vi.fn(),
  agentSetMode: vi.fn(),
}));
vi.mock("./notes-store", () => ({
  indexFor: () => ({ notes: [], rounds: [], generation: 0, vault: "", borrowed: false }),
  refreshNotes: vi.fn(), roundGenerating: vi.fn(() => false), roundNotesFor: vi.fn(() => []), setRoundGenerating: vi.fn(),
}));
vi.mock("./journal", () => ({ announce: vi.fn() }));
vi.mock("@/overlays/toasts", () => ({ toastAction: vi.fn(), toastError: vi.fn() }));

const agent = await import("./agent-session");
const { limitsReading, resetLimits } = await import("./limits-store");

const DIR = "/p";
const usage = (extra: Record<string, unknown>) => ({
  method: "session/update",
  params: { update: { sessionUpdate: "usage_update", used: 1000, size: 200000, ...extra } },
});
const rateLimited = usage({ _meta: { "_claude/rateLimit": { status: "allowed_warning", utilization: 71, resetsAt: 1_800_000_600, rateLimitType: "five_hour" } } });

describe("limits and cost off usage_update", () => {
  beforeEach(() => { resetLimits(); agent.subscribeAgent(() => {})(); });

  it("a live reading reaches the store and still updates the context meter", async () => {
    agent.subscribeAgent(() => {});
    await Promise.resolve();
    onUpdate!({ dir: DIR, message: rateLimited });
    expect(limitsReading()).toMatchObject({ status: "allowed_warning", utilization: 71, windowType: "five_hour" });
    expect(agent.agentSessionFor(DIR).usage).toEqual({ used: 1000, size: 200000 });
  });

  it("a replayed reading records nothing", () => {
    const s = agent.reduceLines(DIR, [rateLimited]);
    expect(limitsReading()).toBeNull();
    expect(s.usage).toEqual({ used: 1000, size: 200000 });
  });

  it("cost lands on the session", () => {
    const s = agent.reduceLines(DIR, [usage({ cost: { amount: 0.42, currency: "USD" } })]);
    expect(s.cost).toBe(0.42);
    expect(agent.reduceLines(DIR, [usage({})]).cost).toBeNull();
  });
});
