import { describe, expect, it } from "vitest";
import { availableStances, currentStance, parseStances, stanceNeedsConfirm, STANCE_COPY } from "./agent-stances";

describe("stances", () => {
  const claude = parseStances({ ask: "default", execute: "acceptEdits", unattended: "bypassPermissions", bogus: "x" });

  it("keeps only the four stance words, with string ids", () => {
    expect(claude).toEqual({ ask: "default", execute: "acceptEdits", unattended: "bypassPermissions" });
    expect(parseStances(null)).toEqual({});
    expect(parseStances({ ask: 3 })).toEqual({});
  });

  it("lists what the agent offers, in the composer's order", () => {
    expect(availableStances(claude)).toEqual(["ask", "execute", "unattended"]);
    expect(availableStances({ unattended: "yolo", ask: "default" })).toEqual(["ask", "unattended"]);
  });

  it("offers nothing to pick for an agent with no modes", () => {
    expect(availableStances({})).toEqual([]);
    expect(currentStance({}, null)).toBe("ask");
  });

  it("reads the current stance back from the session's mode id", () => {
    expect(currentStance(claude, "acceptEdits")).toBe("execute");
    expect(currentStance(claude, "plan")).toBe("ask"); // a mode no stance maps to reads as asking
  });

  it("asks once per session before the stances that stop asking", () => {
    const fresh = { worksFreelyConfirmed: false, autoConfirmed: false, fullAutoConfirmed: false };
    expect(stanceNeedsConfirm("ask", fresh)).toBe(false);
    expect(stanceNeedsConfirm("execute", fresh)).toBe(true);
    expect(stanceNeedsConfirm("execute", { ...fresh, worksFreelyConfirmed: true })).toBe(false);
    expect(stanceNeedsConfirm("unattended", { ...fresh, fullAutoConfirmed: true })).toBe(false);
  });

  it("names every stance in sentence case", () => {
    expect(STANCE_COPY.ask.name).toBe("Ask first");
    expect(STANCE_COPY.unattended.name).toBe("Unattended");
  });
});
