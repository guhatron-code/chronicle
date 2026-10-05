/* The review loop as a pure decision function: no I/O, no clock. The store sends the prompts and persists the state. */
import type { CritiqueRound, LintReport, PromptKind, ReviewSettings, ReviewState } from "./design-review-model";

export const MAX_LINT_PASSES = 2;

export interface TurnResult { version: number | null; questionsPending: boolean; lint: LintReport | null; critique: CritiqueRound | null; cancelled: boolean }
export type Next =
  | { kind: "wait" }
  | { kind: "send"; prompt: PromptKind }
  | { kind: "questions" }
  | { kind: "done" }
  | { kind: "belowBar" }
  | { kind: "critiqueMissing" }
  | { kind: "stopped" }
  | { kind: "regate" };

const NEW_ATTEMPT: PromptKind[] = ["brief", "user", "answers", "continue"];
const FIX_PROMPTS: PromptKind[] = ["lintFix", "critiqueFix", "fixFinding", "resolve"];

export function onSend(st: ReviewState, prompt: PromptKind, now: number): ReviewState {
  const base: ReviewState = { ...st, phase: prompt === "critique" ? "critique" : prompt === "lintFix" ? "fixing" : "building", lastPrompt: prompt };
  if (NEW_ATTEMPT.includes(prompt)) return { ...base, round: 0, fixPass: 0, best: null, accepted: false, startedAt: now };
  if (prompt === "resolve") return { ...base, accepted: false };
  return base;
}

export function afterTurn(st: ReviewState, s: ReviewSettings, t: TurnResult): { state: ReviewState; next: Next } {
  const version = t.version ?? st.version;
  if (t.cancelled) return { state: { ...st, phase: "stopped", version }, next: { kind: "stopped" } };

  if (st.phase === "critique") {
    const c = t.critique;
    if (!c) return { state: { ...st, phase: "critique", version }, next: { kind: "critiqueMissing" } };
    const best = !st.best || c.weighted > st.best.score ? { round: c.round, score: c.weighted } : st.best;
    if (c.passed) return { state: { ...st, phase: "done", version, best }, next: { kind: "done" } };
    if (st.round < s.rounds) return { state: { ...st, phase: "building", version, best }, next: { kind: "send", prompt: "critiqueFix" } };
    return { state: { ...st, phase: "below-bar", version, best }, next: { kind: "belowBar" } };
  }

  if (t.questionsPending) return { state: { ...st, phase: "questions", version }, next: { kind: "questions" } };
  const noProgress = t.version == null && st.lastPrompt != null && FIX_PROMPTS.includes(st.lastPrompt);
  if (!noProgress && s.lint && t.lint && t.lint.severe.length > 0 && st.fixPass < MAX_LINT_PASSES) {
    return { state: { ...st, phase: "fixing", fixPass: st.fixPass + 1, version }, next: { kind: "send", prompt: "lintFix" } };
  }
  if (s.critique) return { state: { ...st, phase: "critique", round: st.round + 1, fixPass: 0, version }, next: { kind: "send", prompt: "critique" } };
  return { state: { ...st, phase: "done", version }, next: { kind: "done" } };
}

export const onStop = (st: ReviewState): ReviewState => ({ ...st, phase: "stopped" });
export const onAccept = (st: ReviewState): ReviewState => ({ ...st, phase: "done", accepted: true });

export function resumeAfterRestart(st: ReviewState, turnActive: boolean): { state: ReviewState; next: Next } {
  if (turnActive) return { state: st, next: { kind: "wait" } };
  if (st.phase === "building" || st.phase === "fixing" || st.phase === "gate") return { state: { ...st, phase: "gate" }, next: { kind: "regate" } };
  if (st.phase === "critique") return { state: st, next: { kind: "critiqueMissing" } };
  return { state: st, next: { kind: "wait" } };
}
