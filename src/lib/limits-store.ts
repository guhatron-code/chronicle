/*
 * Round 9 — the account's rate limits, as the adapter forwards them. Claude
 * Code emits a rate_limit_event after every API response; claude-agent-acp
 * turns it into a usage_update whose _meta["_claude/rateLimit"] carries the
 * binding window. Limits are per ACCOUNT, not per project, so there is one
 * reading here and the title bar draws it. The reducer records it only from
 * a live session (agent-session.ts); replay never touches this.
 */

export type LimitStatus = "allowed" | "allowed_warning" | "rejected";

export interface LimitWindow { utilization: number | null; resetsAt: number | null }

export interface LimitsReading {
  status: LimitStatus;
  /** 0–100 for the binding window, when the wire says */
  utilization: number | null;
  /** epoch ms */
  resetsAt: number | null;
  /** five_hour | seven_day | seven_day_opus | seven_day_sonnet | overage | … */
  windowType: string;
  /** every window the wire listed (unifiedWindows), by type */
  windows: Record<string, LimitWindow>;
  /** Date.now() when the reading arrived — the chip shows its age */
  at: number;
}

let reading: LimitsReading | null = null;
const subs = new Set<() => void>();

export function limitsReading(): LimitsReading | null { return reading; }
export function subscribeLimits(cb: () => void): () => void { subs.add(cb); return () => { subs.delete(cb); }; }
/** tests */
export function resetLimits(): void { reading = null; }

type Raw = Record<string, unknown>;
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
/** The wire says 0.54 for 54% (a fraction, measured live on claude-agent-acp
 *  0.75.1 with Claude Code 2.1), though older notes describe 0–100. Both read
 *  as a percentage: anything at or under 1 is a fraction. */
const pct = (v: unknown): number | null => { const n = num(v); return n == null ? null : n <= 1 ? Math.round(n * 1000) / 10 : n; };
const secsToMs = (v: unknown): number | null => { const n = num(v); return n == null ? null : Math.round(n * 1000); };

/** Normalise one `_claude/rateLimit` payload into the reading and publish it.
 *  Anything that is not an object records nothing and returns null. */
export function recordRateLimit(meta: unknown, now: number = Date.now()): LimitsReading | null {
  if (!meta || typeof meta !== "object") return null;
  const m = meta as Raw;
  const rawStatus = typeof m.status === "string" ? m.status : "";
  const status: LimitStatus = rawStatus === "allowed_warning" || rawStatus === "rejected" ? rawStatus : "allowed";
  const windowType = typeof m.rateLimitType === "string" && m.rateLimitType ? m.rateLimitType : "unknown";
  const windows: Record<string, LimitWindow> = {};
  const unified = m.unifiedWindows;
  if (unified && typeof unified === "object") {
    for (const [k, w] of Object.entries(unified as Raw)) {
      if (!w || typeof w !== "object") continue;
      const win = w as Raw;
      windows[k] = { utilization: pct(win.utilization), resetsAt: secsToMs(win.resetsAt) };
    }
  }
  const binding = windows[windowType];
  reading = {
    status,
    utilization: pct(m.utilization) ?? binding?.utilization ?? null,
    resetsAt: secsToMs(m.resetsAt) ?? binding?.resetsAt ?? null,
    windowType,
    windows,
    at: now,
  };
  for (const cb of subs) cb();
  return reading;
}

/* ---------- words ---------- */

const WINDOW_WORDS: Record<string, string> = {
  five_hour: "5-hour window",
  seven_day: "7-day window",
  seven_day_opus: "7-day Opus window",
  seven_day_sonnet: "7-day Sonnet window",
  overage: "overage",
};
export function windowLabel(type: string): string {
  return WINDOW_WORDS[type] ?? type.replace(/_/g, " ");
}

/** "4:10 PM" — the local clock, the way the rest of the title bar reads time. */
export function fmtResetTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function ageLabel(at: number, now: number = Date.now()): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return "read just now";
  const m = Math.round(s / 60);
  if (m < 60) return `read ${m} min ago`;
  return `read ${Math.round(m / 60)} h ago`;
}
