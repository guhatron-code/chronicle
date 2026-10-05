/*
 * The usage-limit reminder. When the plan's limit is hit the thread card can
 * schedule "your plan is back" for the reset time: a toast with a Continue
 * action, and a native notification when the window is unfocused. Reminders
 * persist per project through designReminders/designRemindersSet, so they
 * survive a restart. The ticker runs on the idle-aware scheduler.
 */
import { designReminders, designRemindersSet } from "./ipc";
import { every } from "./scheduler";
import type { LimitStatus } from "./limits-store";

export interface Reminder { dir: string; slug: string; title: string; version: number | null; at: number }

const byDir = new Map<string, Reminder[]>();
const subs = new Set<() => void>();
const emit = () => { for (const cb of subs) cb(); };

const persist = (dir: string) => designRemindersSet(dir, byDir.get(dir) ?? []);

export function remindersFor(dir: string): Reminder[] { return byDir.get(dir) ?? []; }
export function subscribeReminders(cb: () => void): () => void { subs.add(cb); return () => { subs.delete(cb); }; }

export async function loadReminders(dir: string): Promise<void> {
  const raw = await designReminders(dir);
  byDir.set(dir, (Array.isArray(raw) ? raw : []).filter((r): r is Reminder =>
    !!r && typeof (r as Reminder).slug === "string" && typeof (r as Reminder).at === "number")
    .map((r) => ({ ...r, dir })));
  emit();
}

export async function addReminder(r: Reminder): Promise<void> {
  const rest = remindersFor(r.dir).filter((x) => x.slug !== r.slug);
  byDir.set(r.dir, [...rest, r]);
  emit();
  await persist(r.dir);
}

export async function clearReminder(dir: string, slug: string): Promise<void> {
  const list = remindersFor(dir);
  if (!list.some((x) => x.slug === slug)) return;
  byDir.set(dir, list.filter((x) => x.slug !== slug));
  emit();
  await persist(dir);
}

export interface TickerDeps {
  now: () => number;
  focused: () => boolean;
  toast: (msg: string, action: string, onAction: () => void) => void;
  notify: (title: string, body: string) => Promise<void>;
  continueDesign: (dir: string, slug: string) => Promise<void>;
}

export function startReminderTicker(deps: TickerDeps): () => void {
  const tick = () => {
    const now = deps.now();
    for (const [dir, list] of [...byDir]) {
      const due = list.filter((r) => r.at <= now);
      if (!due.length) continue;
      byDir.set(dir, list.filter((r) => r.at > now));
      emit();
      void persist(dir).catch(() => {});
      for (const r of due) {
        const body = `${r.title} is at v${r.version ?? 1}.`;
        deps.toast(`Your Claude plan is back. ${body}`, "Continue", () => { void deps.continueDesign(r.dir, r.slug).catch(() => {}); });
        if (!deps.focused()) void deps.notify("Your Claude plan is back", body).catch(() => {});
      }
    }
  };
  return every(30_000, tick);
}

/** A reading of "allowed" means the limit cleared early: nothing left to remind about. */
export function dropRemindersWhenAllowed(status: LimitStatus | null): void {
  if (status !== "allowed") return;
  for (const [dir, list] of [...byDir]) {
    if (!list.length) continue;
    byDir.set(dir, []);
    void persist(dir).catch(() => {});
  }
  emit();
}
