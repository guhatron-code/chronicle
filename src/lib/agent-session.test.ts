/*
 * The one thing in agent-session.ts that cannot be reasoned about safely: a
 * round prompt that is waiting its turn in the composer's queue. It can sit
 * there behind several of the user's messages, and everything that can happen
 * to a round in that window — the user cancelling it, the session being
 * restarted — has to reach it before the flush sends it.
 *
 * The wire is faked: `onAcpUpdate` hands us the reducer's callback, so a turn
 * ending is one synchronous call, and `agentPrompt` records what was actually
 * sent. That is the only assertion that matters here — a cancelled round must
 * never reach the agent.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Update = { dir: string; message: { method: string; params?: Record<string, unknown> } };
let onUpdate: ((u: Update) => void) | null = null;
/** every prompt that actually reached the backend, in order */
const prompts: string[] = [];

vi.mock("./ipc", () => ({
  onAcpUpdate: vi.fn(async (cb: (u: Update) => void) => { onUpdate = cb; return () => {}; }),
  agentPrompt: vi.fn(async (_dir: string, _blocks: unknown[], text: string) => { prompts.push(text); }),
  roundRunMessage: vi.fn(async (_dir: string, n: number) => `RUN ${n}`),
  agentSessionStart: vi.fn(async () => {}),
  roundPlanBegin: vi.fn(), roundPlanCancel: vi.fn(async () => {}), roundPlanSettle: vi.fn(),
  agentCancel: vi.fn(), agentEdits: vi.fn(), agentHistoryRead: vi.fn(),
  agentSetConfigOption: vi.fn(), agentRespondPermission: vi.fn(), agentSessionResume: vi.fn(),
  agentSessionState: vi.fn(), agentSessionStop: vi.fn(), agentSessionsList: vi.fn(),
  agentSetMode: vi.fn(),
}));
vi.mock("./notes-store", () => ({
  indexFor: () => ({ notes: [], rounds: [], generation: 0, vault: "", borrowed: false }),
  refreshNotes: vi.fn(async () => {}),
  roundGenerating: vi.fn(() => true),
  roundNotesFor: vi.fn(() => []),
  setRoundGenerating: vi.fn(),
}));
vi.mock("./journal", () => ({ announce: vi.fn() }));
vi.mock("@/overlays/toasts", () => ({ toastAction: vi.fn(), toastError: vi.fn() }));

const agent = await import("./agent-session");
const { clearRunningRound, runningRoundFor } = await import("./round-log");

const DIR = "/p";
const turnEnds = () => onUpdate!({ dir: DIR, message: { method: "_chronicle/turn_end", params: {} } });
/** let the send's own promise chain settle (agentPrompt, then the waiter) */
const settle = async () => { for (let i = 0; i < 4; i++) await Promise.resolve(); };
const roundCard = () => agent.agentSessionFor(DIR).entries.find((e) => e.kind === "round");

describe("a round prompt waiting in the composer queue", () => {
  beforeEach(() => {
    prompts.length = 0;
    clearRunningRound(DIR);
    // a pane mid-turn: the round cannot be sent yet, which is the whole point
    Object.assign(agent.agentSessionFor(DIR), {
      phase: "ready", turnActive: true, entries: [], queue: [],
    });
  });

  it("falls in behind the user's messages and unqueues its card only when it is really sent", async () => {
    agent.enqueueAgentMessage(DIR, "look at this first");
    await agent.startRoundInPane(DIR, 6, 1);
    expect(roundCard()).toMatchObject({ kind: "round", n: 6, queued: true });

    turnEnds(); // the user's turn ends: their message goes, the round queues behind it
    expect(prompts).toEqual(["look at this first"]);
    expect(agent.agentSessionFor(DIR).queue).toEqual(["RUN 6"]);
    expect(roundCard()).toMatchObject({ queued: true }); // not its turn yet
    await settle();

    turnEnds(); // now the round's own turn
    expect(prompts).toEqual(["look at this first", "RUN 6"]);
    await settle();
    expect(roundCard()).toMatchObject({ queued: false }); // the next turn end is its own
    expect(runningRoundFor(DIR)).toMatchObject({ n: 6, route: "pane" });
  });

  it("never sends a run the user cancelled while it waited", async () => {
    agent.enqueueAgentMessage(DIR, "look at this first");
    await agent.startRoundInPane(DIR, 4, 2);
    turnEnds();
    expect(agent.agentSessionFor(DIR).queue).toEqual(["RUN 4"]);
    await settle();

    // "Not running anymore" on the notes card — all it does is take the mark
    // down, and that has to be enough to stop the prompt going out
    clearRunningRound(DIR);

    turnEnds();
    expect(prompts).toEqual(["look at this first"]); // the round never reached the agent
    expect(agent.agentSessionFor(DIR).queue).toEqual([]);
    expect(roundCard()).toMatchObject({ kind: "round", n: 4, ended: true });
    expect(runningRoundFor(DIR)).toBeNull();
  });

  it("lets the message behind a cancelled round take the turn", async () => {
    agent.enqueueAgentMessage(DIR, "first");
    await agent.startRoundInPane(DIR, 7, 1);
    turnEnds(); // "first" goes out, the round queues
    await settle();
    agent.enqueueAgentMessage(DIR, "second"); // typed while the round waits
    clearRunningRound(DIR);

    turnEnds();
    // the round is skipped rather than sent, and skipping it must not strand
    // the queue behind it
    expect(prompts).toEqual(["first", "second"]);
    expect(agent.agentSessionFor(DIR).queue).toEqual([]);
  });

  it("closes the card when a session restart throws the queue away", async () => {
    agent.enqueueAgentMessage(DIR, "first");
    await agent.startRoundInPane(DIR, 5, 1);
    turnEnds();
    expect(agent.agentSessionFor(DIR).queue).toEqual(["RUN 5"]);
    await settle();

    await agent.startAgentSession(DIR); // the user restarts the agent
    expect(agent.agentSessionFor(DIR).queue).toEqual([]);
    expect(runningRoundFor(DIR)).toBeNull(); // the mark came down with the queue

    turnEnds();
    expect(prompts).toEqual(["first"]); // nothing left to send
  });
});
