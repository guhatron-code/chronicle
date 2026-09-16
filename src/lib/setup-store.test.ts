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
