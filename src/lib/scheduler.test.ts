import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cadenceFor, every, getActivity, intervalFor, setActivity, subscribeActivity, type Activity } from "./scheduler";

const A = (p: Partial<Activity> = {}): Activity => ({ visible: true, focused: true, onBattery: false, ...p });

describe("cadenceFor", () => {
  it("is normal when visible and focused", () => expect(cadenceFor(A())).toBe("normal"));
  it("is slow when visible but unfocused", () => expect(cadenceFor(A({ focused: false }))).toBe("slow"));
  it("is paused whenever hidden, focused or not", () => {
    expect(cadenceFor(A({ visible: false }))).toBe("paused");
    expect(cadenceFor(A({ visible: false, focused: false }))).toBe("paused");
  });
});

describe("intervalFor", () => {
  it("returns the base when normal", () => expect(intervalFor(60_000, A())).toBe(60_000));
  it("quadruples when slow", () => expect(intervalFor(60_000, A({ focused: false }))).toBe(240_000));
  it("doubles on battery, compounding with slow", () => {
    expect(intervalFor(60_000, A({ onBattery: true }))).toBe(120_000);
    expect(intervalFor(60_000, A({ focused: false, onBattery: true }))).toBe(480_000);
  });
  it("is null when paused", () => expect(intervalFor(60_000, A({ visible: false }))).toBeNull());
});

describe("every", () => {
  beforeEach(() => { vi.useFakeTimers(); setActivity(A()); });
  afterEach(() => { vi.useRealTimers(); });

  it("fires after the base interval and re-arms", () => {
    const fn = vi.fn();
    const stop = every(1000, fn);
    vi.advanceTimersByTime(999); expect(fn).toHaveBeenCalledTimes(0);
    vi.advanceTimersByTime(1);   expect(fn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000); expect(fn).toHaveBeenCalledTimes(2);
    stop();
    vi.advanceTimersByTime(5000); expect(fn).toHaveBeenCalledTimes(2);
  });

  it("never overlaps: the next arm waits for a slow callback to settle", async () => {
    let release!: () => void;
    const fn = vi.fn(() => new Promise<void>((r) => { release = r; }));
    every(1000, fn);
    vi.advanceTimersByTime(1000); expect(fn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5000); expect(fn).toHaveBeenCalledTimes(1); // still running
    release(); await vi.runOnlyPendingTimersAsync();
    vi.advanceTimersByTime(1000); expect(fn).toHaveBeenCalledTimes(2);
  });

  it("re-arms from the new cadence when activity changes", () => {
    const fn = vi.fn();
    every(1000, fn);
    setActivity({ focused: false }); // slow: 4000
    vi.advanceTimersByTime(3999); expect(fn).toHaveBeenCalledTimes(0);
    vi.advanceTimersByTime(1);    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("does not fire while hidden, then fires once immediately on show", () => {
    const fn = vi.fn();
    every(1000, fn);
    setActivity({ visible: false });
    vi.advanceTimersByTime(60_000); expect(fn).toHaveBeenCalledTimes(0);
    setActivity({ visible: true });
    expect(fn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000); expect(fn).toHaveBeenCalledTimes(2);
  });

  it("setActivity ignores no-op patches and exposes the current value", () => {
    const seen: Activity[] = [];
    const un = subscribeActivity((a) => seen.push(a));
    setActivity({ focused: true });
    expect(seen.length).toBe(0);
    setActivity({ onBattery: true });
    expect(seen.length).toBe(1);
    expect(getActivity().onBattery).toBe(true);
    un();
  });
});
