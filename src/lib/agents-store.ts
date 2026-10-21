/*
 * The project's agent, as the composer's picker changes it (spec §3). A live
 * session is never re-pointed: it ends after a confirm and the new agent's
 * session starts. Rust keeps each session's own profile until it ends.
 */
import { setProjectAgent } from "./ipc";
import { agentSessionFor, endAgentSession, startAgentSession, type AgentPhase } from "./agent-session";
import { agentMeta } from "./agents";
import type { ConfirmSpec } from "@/overlays/ConfirmDialog";

export type SwitchPlan = "noop" | "start" | "confirm-restart";

export function agentSwitchPlan(input: { phase: AgentPhase; current: string; next: string }): SwitchPlan {
  if (input.next === input.current) return "noop";
  if (input.phase === "installing" || input.phase === "starting" || input.phase === "ready") return "confirm-restart";
  return "start";
}

export async function switchProjectAgent(dir: string, next: string, confirm: (spec: ConfirmSpec) => void): Promise<void> {
  const s = agentSessionFor(dir);
  const plan = agentSwitchPlan({ phase: s.phase, current: s.agent, next });
  if (plan === "noop") return;
  if (plan === "start") {
    await setProjectAgent(dir, next);
    await startAgentSession(dir);
    return;
  }
  const to = agentMeta(next).name;
  confirm({
    title: `Switch to ${to}?`,
    body: s.turnActive
      ? `The agent is still working. Switching ends this session — changes it already made are kept and stay reviewable — and starts a new one with ${to}.`
      : `This ends the current session. Changes it made are kept and stay reviewable. The new session starts fresh with ${to}.`,
    cancelLabel: `Keep ${agentMeta(s.agent).name}`,
    confirmLabel: `Switch to ${to}`,
    onConfirm: async () => {
      await setProjectAgent(dir, next);
      await endAgentSession(dir);
      await startAgentSession(dir);
    },
  });
}
