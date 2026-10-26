/*
 * The run commands and the `run-update` event (src-tauri/src/runs/commands.rs).
 * Its own module so the agent-session suites, which mock ./ipc wholesale,
 * never need to know runs exist.
 */
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { RunRecord } from "./runs-model";

export type RunSource = { kind: "notes" } | { kind: "plan"; path: string } | { kind: "prompt"; text: string };
export type NeedsAct =
  | { kind: "skip"; item: string }
  | { kind: "rewrite"; item: string; text: string }
  | { kind: "retry"; lane: string }
  | { kind: "recheck" }
  | { kind: "dismiss"; index: number };

export const runBegin = (dir: string, source: RunSource) =>
  invoke<{ n: number; total: number; prompt: string }>("run_begin", { dir, source });
export const runPlanSettle = (dir: string, n: number, plannerCost: number) =>
  invoke<{ state: "running" | "retry" | "failed"; prompt?: string; reason?: string }>("run_plan_settle", { dir, n, plannerCost });
export const runPlanCancel = (dir: string, n: number) => invoke<void>("run_plan_cancel", { dir, n });
export const runsList = (dir: string) => invoke<RunRecord[]>("runs_list", { dir });
export const runStop = (dir: string, n: number) => invoke<void>("run_stop", { dir, n });
export const runResume = (dir: string, n: number) => invoke<{ state: "running" | "planning"; prompt?: string }>("run_resume", { dir, n });
export const runNeedsYou = (dir: string, n: number, act: NeedsAct) => invoke<void>("run_needs_you", { dir, n, act });
export const runLaneNudge = (dir: string, n: number, lane: string, text: string) => invoke<void>("run_lane_nudge", { dir, n, lane, text });
export const runLaneDiscard = (dir: string, n: number, lane: string) => invoke<number>("run_lane_discard", { dir, n, lane });
export const onRunUpdate = (cb: (u: { dir: string; record: RunRecord }) => void): Promise<UnlistenFn> =>
  listen<{ dir: string; record: RunRecord }>("run-update", (e) => cb(e.payload));
