import { beforeEach, describe, expect, it } from "vitest";
import { ageLabel, fmtResetTime, limitsReading, recordRateLimit, resetLimits, windowLabel } from "./limits-store";

const NOW = 1_800_000_000_000;

describe("recordRateLimit normalises what the adapter forwards", () => {
  beforeEach(() => resetLimits());

  it("keeps utilization, converts resetsAt from seconds to ms, and stamps the reading", () => {
    const r = recordRateLimit({ status: "allowed", utilization: 62, resetsAt: 1_800_000_600, rateLimitType: "five_hour" }, NOW);
    expect(r).toEqual({ status: "allowed", utilization: 62, resetsAt: 1_800_000_600_000, windowType: "five_hour", windows: {}, at: NOW });
    expect(limitsReading()).toBe(r);
  });

  it("falls back to the binding window inside unifiedWindows when utilization is absent", () => {
    const r = recordRateLimit({
      status: "allowed_warning", resetsAt: 1_800_000_600, rateLimitType: "seven_day",
      unifiedWindows: { five_hour: { utilization: 12, resetsAt: 1_800_000_100 }, seven_day: { utilization: 88, resetsAt: 1_800_000_600 } },
    }, NOW);
    expect(r?.utilization).toBe(88);
    expect(r?.status).toBe("allowed_warning");
    expect(r?.windows).toEqual({ five_hour: { utilization: 12, resetsAt: 1_800_000_100_000 }, seven_day: { utilization: 88, resetsAt: 1_800_000_600_000 } });
  });

  it("missing fields read as null, an unknown status reads as allowed, and junk records nothing", () => {
    const r = recordRateLimit({ status: "weird", rateLimitType: "overage" }, NOW);
    expect(r).toEqual({ status: "allowed", utilization: null, resetsAt: null, windowType: "overage", windows: {}, at: NOW });
    expect(recordRateLimit("nope", NOW)).toBeNull();
    expect(recordRateLimit(null, NOW)).toBeNull();
    expect(limitsReading()).toBe(r);
  });

  it("rejected is kept as rejected", () => {
    expect(recordRateLimit({ status: "rejected", rateLimitType: "five_hour" }, NOW)?.status).toBe("rejected");
  });
});

describe("the words on the chip", () => {
  it("names each window for a person", () => {
    expect(windowLabel("five_hour")).toBe("5-hour window");
    expect(windowLabel("seven_day")).toBe("7-day window");
    expect(windowLabel("seven_day_opus")).toBe("7-day Opus window");
    expect(windowLabel("seven_day_sonnet")).toBe("7-day Sonnet window");
    expect(windowLabel("overage")).toBe("overage");
    expect(windowLabel("something_new")).toBe("something new");
  });
  it("formats a reset as a clock time and an age in plain words", () => {
    expect(fmtResetTime(NOW)).toMatch(/^\d{1,2}:\d{2}/);
    expect(ageLabel(NOW - 20_000, NOW)).toBe("read just now");
    expect(ageLabel(NOW - 3 * 60_000, NOW)).toBe("read 3 min ago");
    expect(ageLabel(NOW - 2 * 3_600_000, NOW)).toBe("read 2 h ago");
  });
});
