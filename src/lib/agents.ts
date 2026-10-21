/*
 * The TypeScript side's names and marks for the four agents (spec §3). Rust's
 * profiles.rs is the source of truth for what an agent can do; this is only
 * how it is named and drawn. Ids are the ACP registry's.
 */
export interface AgentMeta {
  id: string;
  name: string;
  /** the pane header's name: Claude Code keeps Chronigirl; every other agent is itself */
  headerName: string;
  /** the letters on its mark ("" for Claude Code, which draws Chronigirl) */
  short: string;
  blurb: string;
}

export const AGENT_ORDER = ["claude-acp", "codex-acp", "gemini", "opencode"] as const;

export const AGENT_META: Record<string, AgentMeta> = {
  "claude-acp": { id: "claude-acp", name: "Claude Code", headerName: "Chronigirl", short: "", blurb: "Anthropic’s agent. The default for new projects." },
  "codex-acp": { id: "codex-acp", name: "Codex", headerName: "Codex", short: "Cx", blurb: "OpenAI’s agent." },
  gemini: { id: "gemini", name: "Gemini CLI", headerName: "Gemini CLI", short: "Gm", blurb: "Google’s agent." },
  opencode: { id: "opencode", name: "OpenCode", headerName: "OpenCode", short: "Oc", blurb: "An open-source agent." },
};

export function agentMeta(id: string): AgentMeta {
  return AGENT_META[id] ?? { id, name: id, headerName: id, short: id.slice(0, 2), blurb: "" };
}
