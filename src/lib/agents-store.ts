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

/** Runs the switch in order: save the choice, end the old session, start the new one.
 *  A failure is reported through `onError` with where the project now stands. */
async function applySwitch(dir: string, next: string, endFirst: boolean, onError: (message: string) => void): Promise<void> {
  const to = agentMeta(next).name;
  try {
    await setProjectAgent(dir, next);
  } catch (e) {
    onError(`The choice wasn't saved, so the project still uses its current agent. ${String(e).slice(0, 90)}`);
    return;
  }
  if (endFirst) {
    try {
      await endAgentSession(dir);
    } catch (e) {
      onError(`The project now uses ${to}, but the old session couldn't be ended — stop it from the header. ${String(e).slice(0, 90)}`);
      return;
    }
  }
  try {
    await startAgentSession(dir);
  } catch (e) {
    onError(`The project now uses ${to}, but it couldn't start — press Start in the composer. ${String(e).slice(0, 90)}`);
  }
}

export async function switchProjectAgent(dir: string, next: string, confirm: (spec: ConfirmSpec) => void, onError: (message: string) => void): Promise<void> {
  const s = agentSessionFor(dir);
  const plan = agentSwitchPlan({ phase: s.phase, current: s.agent, next });
  if (plan === "noop") return;
  if (plan === "start") return applySwitch(dir, next, false, onError);
  const to = agentMeta(next).name;
  confirm({
    title: `Switch to ${to}?`,
    body: s.turnActive
      ? `The agent is still working. Switching ends this session — changes it already made are kept and stay reviewable — and starts a new one with ${to}.`
      : `This ends the current session. Changes it made are kept and stay reviewable. The new session starts fresh with ${to}.`,
    cancelLabel: `Keep ${agentMeta(s.agent).name}`,
    confirmLabel: `Switch to ${to}`,
    onConfirm: () => applySwitch(dir, next, true, onError),
  });
}
