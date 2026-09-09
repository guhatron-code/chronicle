import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionKind, SessionStatusEvent } from "./ipc";

/* the two sessions the store watches, driven by hand */
const listeners = new Map<string, Set<(e: SessionStatusEvent) => void>>();
let seedFixes: { running?: boolean } = { running: false };
let seedExec: { running?: boolean } = { running: false };

vi.mock("./ipc", () => ({
  fixesStatus: vi.fn(async () => seedFixes),
  roundExecStatus: vi.fn(async () => seedExec),
}));
vi.mock("./session-status", () => ({
  subscribeSessionStatus: (dir: string, kind: SessionKind, cb: (e: SessionStatusEvent) => void) => {
    const k = `${dir}::${kind}`;
    let set = listeners.get(k);
    if (!set) { set = new Set(); listeners.set(k, set); }
    set.add(cb);
    return () => { set!.delete(cb); };
  },
}));

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

const emit = (dir: string, kind: SessionKind, running: boolean) => {
  for (const cb of listeners.get(`${dir}::${kind}`) ?? []) {
    cb({ dir, kind, running, log_tail: "" } as SessionStatusEvent);
  }
};

describe("the round watch", () => {
  beforeEach(() => {
    listeners.clear();
    seedFixes = { running: false };
    seedExec = { running: false };
    store.evictRoundLog("/p");
    localStorage.clear();
  });

  it("keeps what the sessions reported across a disarm and re-arm", async () => {
    // an overlay used to unmount the watch, and forgetting a running executor
    // demoted the round to "plan ready" — with a button offering to start a
    // SECOND one. An unarmed watch has no news, not the news that nothing runs.
    store.armRoundWatch("/p", true);
    emit("/p", "exec", true);
    expect(store.execRunning("/p")).toBe(true);

    store.armRoundWatch("/p", false);
    expect(store.execRunning("/p")).toBe(true);

    store.armRoundWatch("/p", true);
    expect(store.execRunning("/p")).toBe(true);

    // and a live "it stopped" is still heard
    emit("/p", "exec", false);
    expect(store.execRunning("/p")).toBe(false);
  });

  it("takes the seed read when nothing has been reported yet", async () => {
    seedExec = { running: true };
    store.armRoundWatch("/p", true);
    await Promise.resolve();
    await Promise.resolve();
    expect(store.execRunning("/p")).toBe(true);
  });

  it("tells the two sessions apart", () => {
    store.armRoundWatch("/p", true);
    emit("/p", "fixes", true);
    expect(store.fixesRunning("/p")).toBe(true);
    expect(store.execRunning("/p")).toBe(false);
  });

  it("closing the project forgets what only this session knew", () => {
    store.armRoundWatch("/p", true);
    emit("/p", "exec", true);
    store.markAgentRound("/p", 3);
    store.evictRoundLog("/p");
    expect(store.execRunning("/p")).toBe(false);
    expect(store.agentRoundFor("/p")).toBeNull();
  });
});

describe("the agent-pane mark", () => {
  beforeEach(() => { store.evictRoundLog("/p"); localStorage.clear(); });

  it("names one round and can be cleared", () => {
    expect(store.agentRoundFor("/p")).toBeNull();
    store.markAgentRound("/p", 8);
    expect(store.agentRoundFor("/p")).toBe(8);
    // the turn ending is what clears it — without this a round that died in
    // the thread reads as running for the rest of the session
    store.clearAgentRound("/p");
    expect(store.agentRoundFor("/p")).toBeNull();
  });

  it("notifies the pane when it changes, and only then", () => {
    const seen = vi.fn();
    const off = store.subscribeRoundSession(seen);
    store.markAgentRound("/p", 8);
    store.markAgentRound("/p", 8); // same round, nothing moved
    store.clearAgentRound("/p");
    store.clearAgentRound("/p"); // already gone
    off();
    expect(seen).toHaveBeenCalledTimes(2);
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
