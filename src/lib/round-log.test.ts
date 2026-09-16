import { beforeEach, describe, expect, it, vi } from "vitest";

/* the suite runs in node, not jsdom — the store already survives a missing
   localStorage (every access is in a try/catch), but the dismissal test needs
   a real one to read back */
const mem = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => { mem.set(k, v); },
  removeItem: (k: string) => { mem.delete(k); },
  clear: () => { mem.clear(); },
};

const store = await import("./round-log");

describe("the running-round mark", () => {
  beforeEach(() => { store.evictRoundLog("/p"); localStorage.clear(); });

  it("names the round and its route, and can be cleared", () => {
    expect(store.runningRoundFor("/p")).toBeNull();
    store.markRunningRound("/p", { n: 3, route: "pane" });
    expect(store.runningRoundFor("/p")).toEqual({ n: 3, route: "pane" });
    store.clearRunningRound("/p");
    expect(store.runningRoundFor("/p")).toBeNull();
  });

  it("notifies the pane when it changes, and only then", () => {
    const seen = vi.fn();
    const off = store.subscribeRoundSession(seen);
    store.markRunningRound("/p", { n: 3, route: "pane" });
    store.markRunningRound("/p", { n: 3, route: "pane" }); // same mark, nothing moved
    store.markRunningRound("/p", { n: 3, route: "terminal", termId: 7 });
    store.clearRunningRound("/p");
    store.clearRunningRound("/p"); // already gone
    off();
    expect(seen).toHaveBeenCalledTimes(3);
    expect(store.runningRoundFor("/p")).toBeNull();
  });

  it("a terminal route replaces a pane route for the same round", () => {
    store.markRunningRound("/p", { n: 3, route: "pane" });
    store.markRunningRound("/p", { n: 3, route: "terminal", termId: 7 });
    expect(store.runningRoundFor("/p")).toEqual({ n: 3, route: "terminal", termId: 7 });
  });
});

describe("dismissing a finished round", () => {
  beforeEach(() => { store.evictRoundLog("/p"); localStorage.clear(); });

  it("remembers the highest round dismissed, and survives a reload", () => {
    expect(store.dismissedRoundFor("/p")).toBe(0);
    store.dismissRound("/p", 4);
    expect(store.dismissedRoundFor("/p")).toBe(4);
    store.dismissRound("/p", 2); // never goes backwards
    expect(store.dismissedRoundFor("/p")).toBe(4);
    // a dismissal is the user's decision about a real round: it outlives the
    // project being closed and reopened, unlike anything else in here
    store.evictRoundLog("/p");
    expect(store.dismissedRoundFor("/p")).toBe(4);
    localStorage.clear();
    store.evictRoundLog("/p");
    expect(store.dismissedRoundFor("/p")).toBe(0);
  });
});
