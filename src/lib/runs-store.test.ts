/*
 * The run store: Rust is the writer, the store only keeps the newest copy of
 * each record it has heard of, by project and number.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { RunRecord } from "./runs-model";

const base = JSON.parse(readFileSync(path.join(__dirname, "__fixtures__/run-record.json"), "utf8")) as RunRecord;
let push: ((u: { dir: string; record: RunRecord }) => void) | null = null;
vi.mock("./runs-ipc", () => ({
  onRunUpdate: vi.fn(async (cb: (u: { dir: string; record: RunRecord }) => void) => { push = cb; return () => {}; }),
  runsList: vi.fn(async () => [structuredClone(base)]),
}));
vi.mock("./ipc", () => ({ notifyNative: vi.fn(async () => {}) }));

const store = await import("./runs-store");
const DIR = "/home/u/proj";

describe("the run store", () => {
  it("loads a project's runs and hears every update after", async () => {
    const seen = vi.fn();
    store.subscribeRuns(seen);
    await store.refreshRuns(DIR);
    expect(store.runFor(DIR, 10)?.state).toBe("running");
    expect(store.liveRun(DIR)?.n).toBe(10);
    const v = store.runsVersion();
    push!({ dir: DIR, record: { ...structuredClone(base), state: "gating", updated: "2026-10-15T09:05:00Z" } });
    expect(store.runFor(DIR, 10)?.state).toBe("gating");
    expect(store.runsVersion()).toBe(v + 1);
    expect(seen).toHaveBeenCalled();
  });
  it("never goes back to an older copy", () => {
    push!({ dir: DIR, record: { ...structuredClone(base), state: "running", updated: "2026-10-15T09:01:00Z" } });
    expect(store.runFor(DIR, 10)?.state).toBe("gating");
    expect(store.ingest(DIR, { ...structuredClone(base), state: "done", updated: "2026-10-15T09:05:00Z" }).accepted).toBe(true);
    expect(store.liveRun(DIR)).toBeNull();
    expect(store.runFor("/other", 10)).toBeNull();
  });
});
