/*
 * The design lane's replay harness: one real design session, recorded by the
 * app itself during the live check (2026-09-23), fed through the ONE reducer
 * with nothing live. The fixture is an excerpt of session
 * 0dfb8350-bc59-4562-a611-6751163d038e — the turn that started "A product page
 * for a coffee roasters Ethiopia Guji single origin": the brief, the commands
 * the session asked about, one answered ask, the skill it loaded, three writes
 * into the design's folder and the fence's own decision for each. Everything
 * else was dropped; the project path became /home/u/proj, the slug became
 * guji-product-page, long strings were cut and big bodies became
 * {"_trimmed":true}.
 *
 * The recording stops mid-turn: the live check was paused with the session
 * still working, so no turn end was ever written. The replay rebuilds the
 * thread up to the last write and stops there.
 *
 * What it asserts is the shape the reducer produces TODAY, in the design lane.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("./ipc", () => ({
  onAcpUpdate: vi.fn(async () => () => {}),
  agentPrompt: vi.fn(), roundRunMessage: vi.fn(), agentSessionStart: vi.fn(),
  roundPlanBegin: vi.fn(), roundPlanCancel: vi.fn(), roundPlanSettle: vi.fn(),
  agentCancel: vi.fn(), agentEdits: vi.fn(), agentHistoryRead: vi.fn(),
  agentSetConfigOption: vi.fn(), agentRespondPermission: vi.fn(), agentSessionResume: vi.fn(),
  agentSessionState: vi.fn(), agentSessionStop: vi.fn(), agentSessionsList: vi.fn(),
  agentSetMode: vi.fn(), designOutsideFiles: vi.fn(async () => ({ files: [], abs: {} })),
}));
vi.mock("./notes-store", () => ({
  indexFor: () => ({ notes: [], rounds: [], generation: 0, vault: "", borrowed: false }),
  refreshNotes: vi.fn(), roundGenerating: vi.fn(() => false), roundNotesFor: vi.fn(() => []), setRoundGenerating: vi.fn(),
}));
vi.mock("./journal", () => ({ announce: vi.fn() }));
vi.mock("@/overlays/toasts", () => ({ toastAction: vi.fn(), toastError: vi.fn() }));

const { reduceLines } = await import("./agent-session");

/** the lane key, not a plain directory: this thread is the design session's */
const KEY = "/home/u/proj#design";
const lines = readFileSync(path.join(__dirname, "__fixtures__/design-lane.jsonl"), "utf8")
  .split("\n").filter(Boolean).map((l) => JSON.parse(l) as unknown);

describe("a recorded design session replays through the reducer", () => {
  const s = reduceLines(KEY, lines);

  it("keeps the fixture honest: the turn it came from is intact", () => {
    expect(lines.length).toBe(44);
    expect(JSON.stringify(lines)).not.toContain("/private/tmp");
    // the brief the pane sent, without the [design: …] prefix the wire carries
    expect(s.entries[0]).toMatchObject({ kind: "user" });
    expect((s.entries[0] as { text: string }).text).toMatch(/^A product page for a coffee roasters/);
  });

  it("every write landed inside the design's folder and the fence said so", () => {
    const guards = s.entries.filter((e) => e.kind === "guard") as { allowed: boolean; path: string }[];
    expect(guards.length).toBe(3);
    for (const g of guards) {
      expect(g.allowed).toBe(true);
      expect(g.path.startsWith("/home/u/proj/.chronicle/designs/guji-product-page/")).toBe(true);
    }
  });

  it("the session asked before it ran a command, and the answer stuck", () => {
    const asks = s.entries.filter((e) => e.kind === "perm") as { outcome?: { type: string } }[];
    expect(asks.length).toBe(1);
    expect(asks[0].outcome).toEqual({ type: "selected", optionId: "allow-once" });
  });

  it("the edits it made are the design's own files", () => {
    const tools = s.entries.filter((e) => e.kind === "tool") as { title: string; status: string }[];
    const edits = tools.filter((t) => /^(Write|Edit) /.test(t.title));
    expect(edits.length).toBe(3);
    for (const e of edits) {
      expect(e.title).toContain(".chronicle/designs/guji-product-page/frames/mobile.html");
      expect(e.status).toBe("completed");
    }
    // the lane loads a design skill of its own
    expect(tools.some((t) => t.title.startsWith("Load skill: frontend-design"))).toBe(true);
  });

  it("a recording that stops mid-turn carries no turn end", () => {
    expect(lines.some((l) => (l as { method?: string }).method === "_chronicle/turn_end")).toBe(false);
    // a replay rebuilds a thread, never a running turn
    expect(s.turnActive).toBe(false);
    expect(s.usage?.size).toBe(1_000_000);
  });
});
