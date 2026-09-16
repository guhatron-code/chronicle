import { describe, expect, it, vi } from "vitest";

/* round-run.ts reaches the backend, the terminal registry and the agent
   session at import time; none of that is under test here. The rule below is,
   and it is a pure function precisely so it can be. */
vi.mock("./ipc", () => ({ roundRunMessage: vi.fn(async () => "run it") }));
vi.mock("./term-sessions", () => ({
  getTerm: vi.fn(() => null), spawnTerm: vi.fn(), subscribeTerms: vi.fn(() => () => {}),
}));
vi.mock("./agent-session", () => ({ settleRoundRun: vi.fn() }));

const { ownsMark } = await import("./round-run");

describe("the round tab's ownership check", () => {
  it("owns the interim mark a start in flight left, before the tab has an id", () => {
    expect(ownsMark({ n: 3, route: "terminal" }, 3, 7)).toBe(true);
  });

  it("owns the mark that names this round and this tab", () => {
    expect(ownsMark({ n: 3, route: "terminal", termId: 7 }, 3, 7)).toBe(true);
  });

  it("does not own a mark for a different round", () => {
    expect(ownsMark({ n: 4, route: "terminal", termId: 7 }, 3, 7)).toBe(false);
    expect(ownsMark({ n: 4, route: "terminal" }, 3, 7)).toBe(false);
  });

  it("does not own this round in a different tab — it was re-run since", () => {
    expect(ownsMark({ n: 3, route: "terminal", termId: 9 }, 3, 7)).toBe(false);
  });

  it("does not own this round on the other route, or no mark at all", () => {
    expect(ownsMark({ n: 3, route: "pane" }, 3, 7)).toBe(false);
    expect(ownsMark(null, 3, 7)).toBe(false);
  });
});
