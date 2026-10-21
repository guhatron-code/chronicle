/*
 * Chronicle's stances (spec §6): what the user picks in the composer. Each
 * agent maps them to its own mode ids in Rust (profiles.rs); the ready event
 * carries that map for the modes the session actually advertised. The store
 * keeps the stance; `agent_set_mode` translates it.
 */
export type Stance = "ask" | "execute" | "auto" | "unattended";
export type StanceMap = Partial<Record<Stance, string>>;

export const STANCE_ORDER: Stance[] = ["ask", "execute", "auto", "unattended"];

export const STANCE_COPY: Record<Stance, { name: string; description: string }> = {
  ask: { name: "Ask first", description: "The agent asks before editing files or running commands." },
  execute: { name: "Execute", description: "File edits happen without asking. Commands still ask." },
  auto: { name: "Auto", description: "The agent approves routine edits and commands itself and still asks about risky ones." },
  unattended: { name: "Unattended", description: "Edits and commands both run without asking — nothing is confirmed." },
};

export function parseStances(raw: unknown): StanceMap {
  const out: StanceMap = {};
  if (!raw || typeof raw !== "object") return out;
  for (const k of STANCE_ORDER) {
    const v = (raw as Record<string, unknown>)[k];
    if (typeof v === "string" && v) out[k] = v;
  }
  return out;
}

/** The stances to offer, in order. Empty when the agent has no modes: it always asks. */
export function availableStances(map: StanceMap): Stance[] {
  return STANCE_ORDER.filter((k) => map[k] != null);
}

/** The stance the session is in, read back from its current mode id; null when no stance maps to it (the agent's own mode, e.g. plan). */
export function currentStance(map: StanceMap, currentModeId: string | null | undefined): Stance | null {
  return STANCE_ORDER.find((k) => currentModeId != null && map[k] === currentModeId) ?? null;
}

/** The once-per-session confirm before a stance that stops asking. */
export function stanceNeedsConfirm(
  stance: Stance,
  s: { worksFreelyConfirmed: boolean; autoConfirmed: boolean; fullAutoConfirmed: boolean },
): boolean {
  if (stance === "execute") return !s.worksFreelyConfirmed;
  if (stance === "auto") return !s.autoConfirmed;
  if (stance === "unattended") return !s.fullAutoConfirmed;
  return false;
}

/** The empty pane's promise. An agent with no Ask mode never asks before changing files
 *  (`asksFirst` false, from Rust), so the pane must not say Chronicle asks first for it. */
export function askFirstLine(agent: { name: string; headerName: string }, asksFirst: boolean | null): string {
  return asksFirst === false
    ? `${agent.name} runs on its own settings — it doesn't ask before changing files. Every change stays reviewable.`
    : `Chronicle asks before ${agent.headerName} touches your project.`;
}

/** The static chip shown in place of the stance control for an agent with no Ask mode. */
export function ownSettingsChip(name: string): { label: string; hint: string } {
  return { label: "Its own settings", hint: `${name} doesn't ask before changing files. Every change stays reviewable.` };
}
