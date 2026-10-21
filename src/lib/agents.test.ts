import { readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AGENT_ORDER, agentMeta } from "./agents";

describe("agent names and marks", () => {
  it("names every probed agent", () => {
    const ids = readdirSync(path.join(__dirname, "__fixtures__")).filter((f) => /^acp-.+\.raw\.jsonl$/.test(f)).map((f) => f.slice(4, -10));
    for (const id of ids) expect(AGENT_ORDER).toContain(id);
  });
  it("keeps Chronigirl for Claude Code and the agent's own name for the others", () => {
    expect(agentMeta("claude-acp").headerName).toBe("Chronigirl");
    expect(agentMeta("codex-acp")).toMatchObject({ name: "Codex", headerName: "Codex", short: "Cx" });
  });
  it("never throws on an id it doesn't know", () => {
    expect(agentMeta("amp-acp")).toMatchObject({ name: "amp-acp", short: "am" });
  });
});
