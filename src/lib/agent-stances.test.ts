import { describe, expect, it } from "vitest";
import { askFirstLine, availableStances, currentStance, ownSettingsChip, parseStances, stanceNeedsConfirm, STANCE_COPY } from "./agent-stances";

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
    expect(currentStance({}, null)).toBeNull();
  });

  it("reads the current stance back from the session's mode id", () => {
    expect(currentStance(claude, "acceptEdits")).toBe("execute");
  });

  it("reads a mode no stance maps to as no stance, and still offers Ask first", () => {
    expect(currentStance(claude, "plan")).toBeNull();
    expect(availableStances(claude)).toContain("ask");
  });

  it("offers stances even when the session has no modes object", () => {
    expect(currentStance(claude, undefined)).toBeNull();
    expect(availableStances(claude)).toEqual(["ask", "execute", "unattended"]);
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

describe("an agent with no Ask mode", () => {
  it("is never promised to ask first", () => {
    expect(askFirstLine({ name: "OpenCode", headerName: "OpenCode" }, false)).toBe("OpenCode runs on its own settings — it doesn't ask before changing files. Every change stays reviewable.");
    expect(askFirstLine({ name: "Codex", headerName: "Codex" }, true)).toBe("Chronicle asks before Codex touches your project.");
    expect(askFirstLine({ name: "Claude Code", headerName: "Chronigirl" }, null)).toBe("Chronicle asks before Chronigirl touches your project.");
  });
  it("gets a static chip, not a stance control", () => {
    expect(ownSettingsChip("OpenCode")).toEqual({ label: "Its own settings", hint: "OpenCode doesn't ask before changing files. Every change stays reviewable." });
  });
});
