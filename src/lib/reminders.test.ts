import { describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ store: [] as unknown[], set: vi.fn(async (_d: string, l: unknown[]) => { h.store = l; }) }));
vi.mock("./ipc", () => ({ designReminders: vi.fn(async () => h.store), designRemindersSet: h.set }));
vi.mock("@/lib/scheduler", () => ({ every: (_ms: number, fn: () => void) => { (globalThis as { tick?: () => void }).tick = fn; return () => {}; } }));

describe("reminders", () => {
  it("fires due reminders once, with a notification only when unfocused, and clears them", async () => {
    const m = await import("./reminders");
    await m.addReminder({ dir: "/p", slug: "guji", title: "Product page", version: 5, at: 1000 });
    await m.addReminder({ dir: "/p", slug: "later", title: "Later", version: 1, at: 9000 });
    expect(h.set).toHaveBeenLastCalledWith("/p", expect.arrayContaining([expect.objectContaining({ slug: "guji" })]));
    let now = 500; const toast = vi.fn(); const notify = vi.fn(async () => {}); const cont = vi.fn(async () => {});
    const stop = m.startReminderTicker({ now: () => now, focused: () => false, toast, notify, continueDesign: cont });
    (globalThis as { tick?: () => void }).tick!();
    expect(toast).not.toHaveBeenCalled();
    now = 1500; (globalThis as { tick?: () => void }).tick!();
    expect(toast).toHaveBeenCalledWith("Your Claude plan is back. Product page is at v5.", "Continue", expect.any(Function));
    expect(notify).toHaveBeenCalledWith("Your Claude plan is back", "Product page is at v5.");
    toast.mock.calls[0][2](); expect(cont).toHaveBeenCalledWith("/p", "guji");
    (globalThis as { tick?: () => void }).tick!();
    expect(toast).toHaveBeenCalledTimes(1);
    expect(m.remindersFor("/p").map((r) => r.slug)).toEqual(["later"]);
    m.dropRemindersWhenAllowed("allowed");
    expect(m.remindersFor("/p")).toEqual([]);
    stop();
  });
});
