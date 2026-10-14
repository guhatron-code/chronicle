import { describe, expect, it } from "vitest";
import { agentsRowFor, agentsRowForError } from "./setup-store";
import type { AgentsAccessStatus } from "./ipc";

const status = (mcp: boolean): AgentsAccessStatus => ({ mcp, skill: "installed", command: "/x/chronicle" });

describe("agentsRowFor", () => {
  it("is blocked when no project is open", () => {
    expect(agentsRowFor(null, null)).toEqual({ id: "agents", state: "blocked", detail: "Open a project first", action: "" });
    expect(agentsRowFor(status(true), null)).toEqual({ id: "agents", state: "blocked", detail: "Open a project first", action: "" });
  });

  it("is ready when the project's mcp is on", () => {
    expect(agentsRowFor(status(true), "/tmp/p")).toEqual({ id: "agents", state: "ready" });
  });

  it("needs you to turn it on when a project is open but mcp is off", () => {
    expect(agentsRowFor(status(false), "/tmp/p")).toEqual({
      id: "agents",
      state: "needs_you",
      detail: "Writes .mcp.json in this project and installs the chronicle skill.",
      action: "install",
    });
  });

  it("says what went wrong, and still offers the button, when the check itself failed", () => {
    // a spinner with no explanation and no retry is the one thing this row must
    // never become: a backend error reads as "needs you", with the reason
    expect(agentsRowForError(new Error("no HOME"))).toEqual({
      id: "agents",
      state: "needs_you",
      detail: "Error: no HOME",
      action: "install",
    });
    expect(agentsRowForError("that project isn't open").detail).toBe("that project isn't open");
  });

  it("says the skill is hand-managed when ready but the human owns that copy", () => {
    const handManaged: AgentsAccessStatus = { mcp: true, skill: "hand-managed", command: "/x/chronicle" };
    expect(agentsRowFor(handManaged, "/tmp/p")).toEqual({
      id: "agents",
      state: "ready",
      detail: "The chronicle skill at ~/.claude/skills/chronicle is yours to manage.",
    });
  });
});

it("the Design rows exist, are never required, and do not count toward ready", async () => {
  const m = await import("./setup-store");
  expect(m.CHECK_META.map((c) => c.id)).toEqual(expect.arrayContaining(["design_browser", "design_skills"]));
  expect(m.totalRequired()).toBe(6);
  expect(m.DESIGN_META.map((c) => c.id)).toEqual(["design_browser", "design_skills"]);
});

it("the connector row exists, installs, and never counts toward ready", async () => {
  const m = await import("./setup-store");
  const row = m.CHECK_META.find((c) => c.id === "connector");
  expect(row).toMatchObject({ kind: "connector", name: "The agent’s connector" });
  expect(m.totalRequired()).toBe(6);
  // it sits right after the engine it needs
  const ids = m.CHECK_META.map((c) => c.id);
  expect(ids.indexOf("connector")).toBe(ids.indexOf("node") + 1);
});
