# Rounds you can watch, plan 2 of 3

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A round is never headless: planning a round is a turn in the agent pane, and running one happens in the pane (default) or in a terminal tab the user can watch; the background `claude -p` sessions, their log panel and the progress modal are deleted.

**Architecture:** The Rust side keeps the round *record* logic (freeze queued notes into round N, write the notes JSON, settle the record from the plan files on disk) as three small commands with no process spawn: `round_plan_begin`, `round_plan_settle`, `round_plan_cancel`. The frontend owns the visible execution: `agent-session.ts` gains a `round-plan` thread entry and sends the planning prompt as a turn; `startRoundInPane` (existing) and a new `startRoundInTerminal` run the round; a single `running round` mark (`{ n, route, termId? }`) in `round-log.ts` (renamed in place, kept small) replaces the headless-session liveness. Everything that read the `fixes`/`exec` session status (RoundLog, RoundFlow, the roadmap's building card branches) goes.

**Tech Stack:** Rust (Tauri commands, existing `notes::rounds`), TypeScript/React (agent-session, notes-store, round-log, xterm `spawnTerm` with `autoType`), vitest.

**Spec:** `docs/superpowers/specs/2026-09-16-agent-access-and-visible-rounds-design.md` §5 (Rounds you can watch), §8 frontend tests.

## Global Constraints

- No background agent process is spawned for rounds anywhere after this plan: `fixes_generate`, `fixes_status`, `fixes_cancel`, `fixes_log_path`, `fixes_run_key`, `round_execute`, `round_exec_status`, `round_exec_cancel`, `exec_log_path`, `exec_run_key` are deleted from main.rs and from `generate_handler!` (build.rs reads that list for the ACL). `watch_run` keeps only the `init` kind. `SessionKind` becomes `"init"`.
- The planning prompt text stays `FIXES_PROMPT_HEAD` with `{N}` and `{TASKS}` substituted (it already carries the marker instruction); the run message stays the sentence `startRoundInPane` sends today (with `marker_instruction("FX-<n>")` appended, as `round_execute` did).
- Progress stays file-driven: note statuses flip as the agent edits front matter; `settle_done` (unchanged) marks a round done. Nothing in this plan infers progress from agent prose.
- Routes are `"pane" | "terminal"`; the old `"headless" | "agent"` vocabulary disappears from types, copy and tests.
- The round record states stay `generating | ready | failed | done`; `settle_round` (unchanged) is what moves `generating` to `ready`/`failed`, now called only from `round_plan_settle` and never mid-turn.
- Copy: sentence case, no em dashes in UI strings, ` · ` as a separator. Existing sentences that stay unchanged keep their wording.
- Shared-tree rules: never `git add -A`, `git stash`, `git reset`, `git checkout -- <file>`, `git clean`; stage by explicit path; the installed Chronicle writes `.chronicle/` live; never run a round against this repository during the plan.
- Rust: `cd src-tauri && cargo test`; frontend: `npm test`, `npm run typecheck`; both green before every commit. `cargo check` warning baseline is 2 (`unused variable: log`, `any_conds`).
- Commit messages end with:
  `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` and
  `Claude-Session: https://claude.ai/code/session_016TqoaAozoZzEomhGSMc6Yr`

---

### Task 1: The round record commands, and the headless commands go

**Files:**
- Modify: `src-tauri/src/main.rs` (replace `fixes_generate` with `round_plan_begin`; add `round_plan_settle`, `round_plan_cancel`; delete `fixes_status`, `fixes_cancel`, `fixes_log_path`, `fixes_run_key`, `round_execute`, `round_exec_status`, `round_exec_cancel`, `exec_log_path`, `exec_run_key`; trim `watch_run`; update `generate_handler!`)
- Test: `src-tauri/src/main.rs` (mod `r4_tests`, next to the existing `settle_round` tests)

**Interfaces:**
- Produces Tauri commands:
  - `round_plan_begin(dir) -> Result<Value, String>` → `{ "n": u64, "total": usize, "prompt": String }`. Refuses with "no queued notes to execute" and "a round is already being planned" (when a `generating` record exists).
  - `round_plan_settle(dir) -> Result<Value, String>` → `{ "n": u64, "state": "ready" | "failed" | "none" }` after `settle_round`.
  - `round_plan_cancel(dir) -> Result<(), String>` — removes the newest `generating` record and requeues its notes (the second half of the old `fixes_cancel`).
- `pub(crate) fn round_run_message(n: u64) -> String` — the run sentence plus `marker_instruction("FX-<n>")`, used by Task 3's frontend through a new command `round_run_message(dir, n) -> String` (so the marker text has one home).

- [ ] **Step 1: Write the failing tests**

In `mod r4_tests` (it has `tmp`, `vault_round` helpers; read them first):

```rust
    #[test]
    fn planning_a_round_freezes_the_queued_notes_and_returns_the_prompt() {
        let d = tmp("plan-begin");
        std::fs::create_dir_all(d.join(".chronicle/notes/Tasks")).unwrap();
        std::fs::write(d.join(".chronicle/notes/Tasks/A.md"), "---\nstatus: queued\n---\n\n# A\n\nfix a\n").unwrap();
        std::fs::write(d.join(".chronicle/notes/Tasks/B.md"), "---\nstatus: queued\n---\n\n# B\n").unwrap();
        std::fs::write(d.join(".chronicle/notes/Tasks/C.md"), "---\nstatus: done\n---\n\n# C\n").unwrap();
        let out = round_plan_begin_in(&d).unwrap();
        assert_eq!(out["n"], 1);
        assert_eq!(out["total"], 2);
        let prompt = out["prompt"].as_str().unwrap();
        assert!(prompt.contains("fixes/phase_1_fixes_plan.md") && prompt.contains(".chronicle/round_1_notes.json"), "{prompt}");
        assert!(!prompt.contains("{N}") && !prompt.contains("{TASKS}"));
        assert!(prompt.contains("Chronicle-Phase: FX-{N} done") == false && prompt.contains("Chronicle-Phase: FX-1 done"), "the marker names the round");
        let rounds = notes::rounds::load(&d).unwrap();
        assert_eq!((rounds[0].n, rounds[0].state.as_str()), (1, "generating"));
        let text = std::fs::read_to_string(d.join(".chronicle/notes/Tasks/A.md")).unwrap();
        assert!(text.contains("status: in_progress") && text.contains("round: 1"), "{text}");
        assert!(d.join(".chronicle/round_1_notes.json").exists());
        assert_eq!(round_plan_begin_in(&d).unwrap_err(), "a round is already being planned");
    }

    #[test]
    fn settling_reads_the_plan_files_and_cancel_requeues() {
        let d = tmp("plan-settle");
        std::fs::create_dir_all(d.join(".chronicle/notes/Tasks")).unwrap();
        std::fs::write(d.join(".chronicle/notes/Tasks/A.md"), "---\nstatus: queued\n---\n\n# A\n").unwrap();
        round_plan_begin_in(&d).unwrap();
        // nothing written yet → failed, notes requeued
        let s = round_plan_settle_in(&d).unwrap();
        assert_eq!((s["n"], s["state"].as_str()), (json!(1), Some("failed")));
        assert!(std::fs::read_to_string(d.join(".chronicle/notes/Tasks/A.md")).unwrap().contains("status: queued"));
        // second round: plan + prompt written → ready, kind from the first line
        round_plan_begin_in(&d).unwrap();
        std::fs::create_dir_all(d.join("fixes")).unwrap();
        std::fs::write(d.join("fixes/phase_2_fixes_plan.md"), "Round kind: feature additions\n\n1. A\n").unwrap();
        std::fs::write(d.join("fixes/phase_2_fixes_prompt.md"), "Execute the plan.\n").unwrap();
        let s = round_plan_settle_in(&d).unwrap();
        assert_eq!((s["n"], s["state"].as_str()), (json!(2), Some("ready")));
        assert_eq!(notes::rounds::load(&d).unwrap()[1].kind.as_deref(), Some("feature additions"));
        // settle with nothing generating → none
        assert_eq!(round_plan_settle_in(&d).unwrap()["state"], "none");
        // cancel: a third generating round is removed and its note requeued
        std::fs::write(d.join(".chronicle/notes/Tasks/D.md"), "---\nstatus: queued\n---\n\n# D\n").unwrap();
        round_plan_begin_in(&d).unwrap();
        round_plan_cancel_in(&d).unwrap();
        assert_eq!(notes::rounds::load(&d).unwrap().len(), 2, "the generating record is gone");
        assert!(std::fs::read_to_string(d.join(".chronicle/notes/Tasks/D.md")).unwrap().contains("status: queued"));
        assert!(round_run_message(2).contains("fixes/phase_2_fixes_prompt.md") && round_run_message(2).contains("Chronicle-Phase: FX-2 done"));
    }
```

`round_plan_begin_in`, `round_plan_settle_in`, `round_plan_cancel_in` are the `Path`-taking cores the Tauri commands wrap (the commands add `project_for`); define them as `pub(crate) fn … (dir: &Path)`.

- [ ] **Step 2: Run to see them fail**

Run: `cd src-tauri && cargo test r4_tests`
Expected: compile errors, the four functions missing.

- [ ] **Step 3: Implement the three cores and the commands**

Replace `fixes_generate` (keep its record-and-freeze half, drop the spawn) with:

```rust
/// "Plan a round": freeze every queued note into round N and hand back the planning
/// prompt. No process is spawned here; the frontend sends the prompt as a turn in
/// the agent pane so the user watches the plan being written.
pub(crate) fn round_plan_begin_in(dir: &Path) -> Result<Value, String> {
    let mut rounds = notes::rounds::load(dir)?;
    if rounds.iter().any(|r| r.state == "generating") {
        return Err("a round is already being planned".into());
    }
    let picked = notes::rounds::queued_notes(dir);
    if picked.is_empty() { return Err("no queued notes to execute".into()); }
    let round_n = rounds.iter().map(|r| r.n).max().unwrap_or(0) + 1;
    rounds.push(notes::rounds::Round {
        n: round_n, state: "generating".into(), kind: None,
        task_ids: vec![], note_paths: picked.clone(), created_at: epoch_ms(),
        plan_path: format!("fixes/phase_{round_n}_fixes_plan.md"),
        prompt_path: format!("fixes/phase_{round_n}_fixes_prompt.md"),
    });
    notes::rounds::save(dir, &rounds)?;
    for rel in &picked {
        notes::rounds::set_status(dir, rel, Some("in_progress"), Some(round_n))?;
    }
    let vault = notes::index::vault_dir(dir);
    let payload: Vec<Value> = picked.iter().map(|rel| {
        let text = std::fs::read_to_string(vault.join(rel)).unwrap_or_default();
        let (_, body) = notes::parse::split_front_matter(&text);
        json!({ "path": rel, "title": rel.rsplit('/').next().unwrap_or(rel).trim_end_matches(".md"), "body": body })
    }).collect();
    let tasks_rel = format!(".chronicle/round_{round_n}_notes.json");
    std::fs::write(dir.join(&tasks_rel), serde_json::to_string_pretty(&payload).unwrap_or_default())
        .map_err(|e| e.to_string())?;
    let prompt = FIXES_PROMPT_HEAD.replace("{N}", &round_n.to_string()).replace("{TASKS}", &tasks_rel);
    Ok(json!({ "n": round_n, "total": picked.len(), "prompt": prompt }))
}

/// The turn ended: settle the generating record from what landed on disk.
pub(crate) fn round_plan_settle_in(dir: &Path) -> Result<Value, String> {
    let before = notes::rounds::load(dir)?;
    let Some(n) = before.iter().rev().find(|r| r.state == "generating").map(|r| r.n) else {
        return Ok(json!({ "n": Value::Null, "state": "none" }));
    };
    settle_round(dir);
    let after = notes::rounds::load(dir)?;
    let state = after.iter().find(|r| r.n == n).map(|r| r.state.clone()).unwrap_or_else(|| "none".into());
    Ok(json!({ "n": n, "state": state }))
}

/// The user stopped the planning turn: drop the generating record, requeue its notes.
pub(crate) fn round_plan_cancel_in(dir: &Path) -> Result<(), String> {
    let mut rounds = notes::rounds::load(dir)?;
    if let Some(i) = rounds.iter().rposition(|r| r.state == "generating") {
        let paths = rounds.remove(i).note_paths;
        for rel in &paths { let _ = notes::rounds::set_status(dir, rel, Some("queued"), None); }
        notes::rounds::save(dir, &rounds)?;
    }
    Ok(())
}

/// The one sentence that runs a settled round, wherever it runs.
pub(crate) fn round_run_message(n: u64) -> String {
    format!(
        "Read fixes/phase_{n}_fixes_prompt.md and fixes/phase_{n}_fixes_plan.md in this project and execute the round exactly as the prompt instructs: every item, verified honestly, and after each item completes set `status: done` in that note's front matter (the file named by the item's path, under .chronicle/notes/), changing nothing else in that file. {}",
        marker_instruction(&format!("FX-{n}"))
    )
}

#[tauri::command]
async fn round_plan_begin(roots: State<'_, OpenRoots>, dir: String) -> Result<Value, String> {
    let p = project_for(&roots, &dir)?; round_plan_begin_in(&p.dir)
}
#[tauri::command]
async fn round_plan_settle(roots: State<'_, OpenRoots>, dir: String) -> Result<Value, String> {
    let p = project_for(&roots, &dir)?; round_plan_settle_in(&p.dir)
}
#[tauri::command]
async fn round_plan_cancel(roots: State<'_, OpenRoots>, dir: String) -> Result<(), String> {
    let p = project_for(&roots, &dir)?; round_plan_cancel_in(&p.dir)
}
#[tauri::command]
fn round_run_message_cmd(roots: State<OpenRoots>, dir: String, n: u64) -> Result<String, String> {
    let _ = project_for(&roots, &dir)?; Ok(round_run_message(n))
}
```

Note: `FIXES_PROMPT_HEAD` ends with the marker instruction sentence containing `FX-{N}`; the `.replace("{N}", …)` above turns it into `FX-1`, which the first test asserts. Delete `fixes_status`, `fixes_cancel`, `fixes_log_path`, `fixes_run_key`, `round_execute`, `round_exec_status`, `round_exec_cancel`, `exec_log_path`, `exec_run_key`. In `watch_run`, delete the line `if kind == "fixes" { settle_round(&dir_path); }` and the now-unused `dir_path` parameter (update `init_start`'s call). In `generate_handler!` replace the removed names with `round_plan_begin, round_plan_settle, round_plan_cancel, round_run_message_cmd`. Keep `round_retro`, `settle_round`, `FIXES_PROMPT_HEAD`, `marker_instruction`. Fix compile fallout (e.g. `term_then_kill` may now be used only by `init_cancel`; that is fine).

- [ ] **Step 4: Run the Rust suite**

Run: `cd src-tauri && cargo test 2>&1 | tail -3 && cargo check 2>&1 | grep -c "^warning"`
Expected: green; warning count 2 (+ summary line). If a helper became dead (e.g. `read_tail` still used by `init_status`; check), remove it rather than allow it.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/main.rs
git commit -m "feat(rounds): planning and running a round spawn nothing in the background; three record commands replace the headless sessions"
```

---

### Task 2: One running-round mark, one route vocabulary

**Files:**
- Modify: `src/lib/ipc.ts` (wrappers; `SessionKind`)
- Modify: `src/lib/round-log.ts` (drop the log store and the session watch; keep and extend the mark and the dismissals)
- Modify: `src/lib/notes-model.ts` (`roundPhaseOf`, `roundSubline`, `RoundRoute`)
- Modify: `src/lib/notes-store.ts` (`roundPhase`, `roundRoute`, imports)
- Test: `src/lib/round-log.test.ts`, `src/lib/notes-model.test.ts`

**Interfaces:**
- `ipc.ts`: remove `fixesGenerate`, `fixesStatus`, `fixesCancel`, `fixesLogPath`, `roundExecute`, `roundExecStatus`, `roundExecCancel`, `execLogPath`; add
  `roundPlanBegin(dir) => invoke<{ n: number; total: number; prompt: string }>("round_plan_begin", { dir })`,
  `roundPlanSettle(dir) => invoke<{ n: number | null; state: "ready" | "failed" | "none" }>("round_plan_settle", { dir })`,
  `roundPlanCancel(dir) => invoke<void>("round_plan_cancel", { dir })`,
  `roundRunMessage(dir, n) => invoke<string>("round_run_message_cmd", { dir, n })`. `export type SessionKind = "init";`.
- `notes-model.ts`: `export type RoundRoute = "pane" | "terminal";` `roundPhaseOf(rounds, running: { n: number } | null, dismissed = 0)`; `roundSubline(phase, route: RoundRoute | null, done, total)` — executing reads `… · in the agent pane` or `… · in a terminal`.
- `round-log.ts` (file name kept to limit churn; header comment rewritten): `export interface RunningRound { n: number; route: RoundRoute; termId?: number }`, `markRunningRound(dir, r: RunningRound)`, `clearRunningRound(dir)`, `runningRoundFor(dir): RunningRound | null`, `subscribeRoundSession`, `dismissRound`, `dismissedRoundFor`, `evictRoundLog(dir)` (drops the mark and the dismissal cache). Deleted: `RoundLogKind`, `subscribeRoundLog`, `roundLogFor`, `armRoundLog`, `execRunning`, `fixesRunning`, `armRoundWatch`, `markAgentRound`, `clearAgentRound`, `agentRoundFor`.
- `notes-store.ts`: `roundPhase(dir)` = `roundPhaseOf(indexFor(dir).rounds, runningRoundFor(dir), dismissedRoundFor(dir))`; `roundRoute(dir, n): RoundRoute | null` = the mark's route when it names `n`; `hasLiveRound` unchanged; `generatingRoundFor` unchanged; `roundGenerating`/`setRoundGenerating` unchanged.

- [ ] **Step 1: Rewrite the tests first**

`src/lib/notes-model.test.ts`: replace the `roundSubline` expectations with

```ts
    expect(roundSubline("generating", null, 0, 2)).toBe("2 notes · writing the plan…");
    expect(roundSubline("plan-ready", null, 0, 2)).toBe("2 notes · plan ready · not started");
    expect(roundSubline("executing", "pane", 1, 2)).toBe("2 notes · executing · 1 of 2 done · in the agent pane");
    expect(roundSubline("executing", "terminal", 0, 1)).toBe("1 note · executing · 0 of 1 done · in a terminal");
    expect(roundSubline("finished", null, 2, 2)).toBe("2 notes · done · 2 of 2");
    expect(roundSubline("failed", null, 0, 2)).toBe("2 notes · didn't finish · 0 of 2 done");
```

and the `roundPhaseOf` calls: the second argument is now `{ n }` or `null` (e.g. `roundPhaseOf(ready, { n: 3 })` → executing for round 3; `roundPhaseOf(ready, { n: 2 })` with newest ready round 3 → `plan-ready`, the mark names an older round). Keep every existing case, translated.

`src/lib/round-log.test.ts`: delete the "the round watch" describe (its subject is gone). Rewrite "the agent-pane mark" as "the running-round mark": `markRunningRound(dir, { n: 3, route: "pane" })` → `runningRoundFor(dir)` equals it; marking the same again does not notify; `{ n: 3, route: "terminal", termId: 7 }` replaces it and notifies; `clearRunningRound` notifies once and a second clear does not. Keep the dismissal describe.

Run: `npm test -- src/lib/notes-model.test.ts src/lib/round-log.test.ts` → Expected: FAIL (types/functions missing).

- [ ] **Step 2: Implement**

`notes-model.ts`:

```ts
export type RoundRoute = "pane" | "terminal";

export function roundPhaseOf(
  rounds: RoundRecord[],
  running: { n: number } | null,
  dismissed = 0,
): { phase: RoundPhase; n: number } | null {
  const newest = (rs: RoundRecord[]) => rs.reduce((m, r) => Math.max(m, r.n), 0);
  const generating = rounds.filter((r) => r.state === "generating");
  if (generating.length > 0) return { phase: "generating", n: newest(generating) };
  const ready = rounds.filter((r) => r.state === "ready");
  if (ready.length > 0) {
    const n = newest(ready);
    return { phase: running?.n === n ? "executing" : "plan-ready", n };
  }
  const over = rounds.filter((r) => r.state === "done" || r.state === "failed");
  if (over.length === 0) return null;
  const n = newest(over);
  if (n <= dismissed) return null;
  return { phase: over.find((r) => r.n === n)?.state === "failed" ? "failed" : "finished", n };
}

export function roundSubline(phase: RoundPhase, route: RoundRoute | null, done: number, total: number): string {
  const notes = `${total} ${total === 1 ? "note" : "notes"}`;
  if (phase === "generating") return `${notes} · writing the plan…`;
  if (phase === "plan-ready") return `${notes} · plan ready · not started`;
  if (phase === "finished") return `${notes} · done · ${done} of ${total}`;
  if (phase === "failed") return `${notes} · didn't finish · ${done} of ${total} done`;
  return `${notes} · executing · ${done} of ${total} done · ${route === "terminal" ? "in a terminal" : "in the agent pane"}`;
}
```

Delete `roundLogHeader`, `tailLines`, `LOG_MAX_LINES` from notes-model.ts if nothing else imports them after Task 4 (grep; if RoundLog was the only consumer, delete now and drop their tests).

`round-log.ts`: keep the file, rewrite its header to "The running-round mark and the dismissed-round memory", delete the log/watch sections and their imports, and replace the mark:

```ts
export interface RunningRound { n: number; route: RoundRoute; termId?: number }
const runs = new Map<string, RunningRound>();
export function markRunningRound(dir: string, r: RunningRound): void {
  const cur = runs.get(dir);
  if (cur && cur.n === r.n && cur.route === r.route && cur.termId === r.termId) return;
  runs.set(dir, r);
  notifySession();
}
export function clearRunningRound(dir: string): void {
  if (runs.delete(dir)) notifySession();
}
export function runningRoundFor(dir: string): RunningRound | null { return runs.get(dir) ?? null; }
```

`evictRoundLog` drops `runs` and `dismissed` only. `notes-store.ts`: update imports (`runningRoundFor`, `dismissedRoundFor`, `evictRoundLog`), `roundPhase`, and `roundRoute`:

```ts
export function roundRoute(dir: string, n: number): RoundRoute | null {
  const r = runningRoundFor(dir);
  return r?.n === n ? r.route : null;
}
```

`ipc.ts` per the interfaces block. `agent-session.ts`'s `clearAgentRound` import becomes `clearRunningRound` (Task 3 rewires it properly; for this task only rename so typecheck passes).

- [ ] **Step 3: Typecheck and test; commit**

Run: `npm run typecheck && npm test 2>&1 | tail -3`. Typecheck will fail in files Tasks 3–5 rewrite (RoundCard, RoundFlow, RoundLog, RoadmapPane, NotesPane) — fix ONLY import/rename breakage here (e.g. `markAgentRound` → `markRunningRound(dir, { n, route: "pane" })`), leaving behaviour changes to their tasks. Expected: typecheck clean, tests green.

```bash
git add src/lib/ipc.ts src/lib/round-log.ts src/lib/notes-model.ts src/lib/notes-store.ts src/lib/round-log.test.ts src/lib/notes-model.test.ts src/screens/notes/RoundCard.tsx src/lib/agent-session.ts
git commit -m "refactor(rounds): one running-round mark with a pane or terminal route replaces the headless session watch"
```

---

### Task 3: Planning is a pane turn

**Files:**
- Modify: `src/lib/agent-session.ts` (`AgentEntry` gains `round-plan`; `startRoundPlanInPane`; turn-end settles; `startRoundInPane` marks the route)
- Modify: `src/screens/agent/AgentPane.tsx` (render the `round-plan` entry)
- Modify: `src/App.tsx` (`onPlanRound` handler alongside `onRunRoundInPane`)
- Delete: `src/screens/notes/RoundFlow.tsx`
- Modify: `src/screens/notes/NotesPane.tsx`, `src/screens/notes/Sidebar.tsx` (the start-round control calls `onPlanRound`)
- Test: `src/lib/notes-model.test.ts` (pure `roundPlanOutcome` helper)

**Interfaces:**
- `agent-session.ts`:
  - `AgentEntry` union gains `{ kind: "round-plan"; n: number; total: number; ended?: boolean; outcome?: "ready" | "failed" | "cancelled" }`.
  - `export async function startRoundPlanInPane(dir: string): Promise<void>` — `await roundPlanBegin(dir)` → `setRoundGenerating(dir, true)` → push the entry → send the prompt as the next message (same ready/starting logic as `startRoundInPane`); on failure (`Err`) → `setRoundGenerating(dir, false)` and rethrow.
  - On `_chronicle/turn_end`: if the newest un-ended `round-plan` entry exists: mark ended; `stopReason === "cancelled"` → `roundPlanCancel(dir)`, outcome `cancelled`; else `roundPlanSettle(dir)` → outcome from `state`; then `setRoundGenerating(dir, false)`, `refreshNotes(dir)`, and a toast: ready → `toastAction("Round N is ready", "Run it in the pane", () => startRoundInPane(dir, n, total))`; failed → `toastError("The plan wasn't written", "Your notes are back in the queue")`.
  - `startRoundInPane(dir, n, total)` calls `markRunningRound(dir, { n, route: "pane" })` itself (RoundCard stops doing it); the turn-end branch for `round` entries calls `clearRunningRound(dir)` and announces: all notes done → `announce(dir, "round-done", "Round N finished", "Chronicle")` + `toastSuccess("The round finished", "Check Notes — finished items are ticked")`; otherwise `announce(dir, "round-ended", "Round N ended early", "Chronicle")` (import `announce` from wherever RoadmapPane imports it; read that import).
- `notes-model.ts`: `export function roundPlanOutcome(stopReason: string | null | undefined, settled: "ready" | "failed" | "none"): "ready" | "failed" | "cancelled"` — `"cancelled"` when stopReason is `"cancelled"`, else `"ready"` when settled is ready, else `"failed"`.
- `App.tsx`: `onPlanRound={() => { patchLayout({ agent: true, agentCollapsed: false }); void startRoundPlanInPane(active.dir).catch((e) => toastError("Couldn't start the round", String(e).slice(0, 110))); }}` passed to `NotesPane`, which passes it to `Sidebar` as `onStartRound`.

- [ ] **Step 1: Test the pure helper first**

```ts
  it("a planning turn's outcome comes from the stop reason and the record", () => {
    expect(roundPlanOutcome("cancelled", "none")).toBe("cancelled");
    expect(roundPlanOutcome(null, "ready")).toBe("ready");
    expect(roundPlanOutcome("end_turn", "failed")).toBe("failed");
    expect(roundPlanOutcome("error", "none")).toBe("failed");
  });
```

Run: `npm test -- src/lib/notes-model.test.ts` → FAIL. Implement the four-line helper. → PASS.

- [ ] **Step 2: The pane turn**

In `agent-session.ts` add the entry variant, `startRoundPlanInPane` (mirror `startRoundInPane`'s two branches: session ready and idle → push + send; otherwise start the session, subscribe until ready, then push + send; on `error`/`needs-login` → `roundPlanCancel(dir)` + `setRoundGenerating(dir, false)`), and the turn-end handling described above (run it BEFORE the `round` branch; a turn carries one or the other). Import `roundPlanBegin`, `roundPlanSettle`, `roundPlanCancel` from `./ipc`, `setRoundGenerating`, `refreshNotes` from `./notes-store` (check for import cycles: notes-store imports round-log, agent-session imports notes-store already for `indexFor`? verify; if a cycle appears, pass the two store functions in via a small `setRoundHooks({ … })` registered from App.tsx, the way `setTermUrlHandler` works).

`AgentPane.tsx`: next to the `round` render (~:381), render `round-plan`:

```tsx
  if (entry.kind === "round-plan")
    return (
      <div data-round-plan className="mx-3.5 my-1 flex items-center gap-2 rounded-lg border border-border-hairline bg-surface-card-raised px-3.5 py-2.5">
        <span className="text-[13px] font-semibold text-text-primary">Round {entry.n} · planning {entry.total} {entry.total === 1 ? "note" : "notes"}</span>
        <span className="flex-1" />
        {!entry.ended ? (
          <span className="inline-flex items-center gap-[5px] text-xs text-state-neutral"><span className="size-[5px] rounded-full bg-state-neutral" style={{ animation: "wv-pulse 1.6s ease-in-out infinite" }} />writing the plan</span>
        ) : entry.outcome === "ready" ? (
          <span className="text-xs text-state-success">plan ready</span>
        ) : entry.outcome === "cancelled" ? (
          <span className="text-xs text-text-dim">stopped</span>
        ) : (
          <span className="text-xs text-state-error">not written</span>
        )}
      </div>
    );
```

Delete `src/screens/notes/RoundFlow.tsx`; in `NotesPane.tsx` remove its import, ref, mount, `onStartRound`'s ref call (replace with the `onPlanRound` prop), and `onGoRoadmap` if it was only for RoundFlow's toast (grep). `Sidebar.tsx` keeps its `onStartRound` prop name and disabled reasons.

- [ ] **Step 3: Verify and commit**

Run: `npm run typecheck && npm test 2>&1 | tail -3`. Expected: green (RoundCard/RoundLog/RoadmapPane may still reference removed things; fix only what blocks typecheck by stubbing nothing — if `RoundLog` blocks, do Task 4's deletion of it here and say so in the report).

```bash
git add src/lib/agent-session.ts src/lib/notes-model.ts src/lib/notes-model.test.ts src/screens/agent/AgentPane.tsx src/App.tsx src/screens/notes/NotesPane.tsx src/screens/notes/Sidebar.tsx
git rm src/screens/notes/RoundFlow.tsx
git commit -m "feat(rounds): planning a round is a turn you watch in the agent pane; the progress modal goes"
```

---

### Task 4: The terminal route, and the card with two visible routes

**Files:**
- Modify: `src/lib/notes-model.ts` (`terminalRoundCommand`)
- Modify: `src/lib/term-sessions.ts` (a `onTermDead` subscription if none exists: `subscribeTerms` already fires on changes; use it)
- Modify: `src/lib/agent-session.ts` or a new `src/lib/round-run.ts` (`startRoundInTerminal`)
- Modify: `src/screens/notes/RoundCard.tsx` (buttons and copy), `src/screens/notes/NotesPane.tsx` (props), `src/screens/notes/Sidebar.tsx` (pass-through), `src/App.tsx` (`onRunRoundInTerminal`)
- Delete: `src/screens/notes/RoundLog.tsx` and its `logOpen` state/`View log` button/`loadLogOpen` helper in NotesPane
- Test: `src/lib/notes-model.test.ts`

**Interfaces:**
- `notes-model.ts`: `export function terminalRoundCommand(bin: "claude" | "codex", message: string): string` → `` `${bin} '${message.replace(/'/g, "'\\''")}'\n` `` (single-quoted so backticks and double quotes in the message survive; the trailing newline is what `autoType` needs to submit).
- `round-run.ts` (new, small): `export async function startRoundInTerminal(dir, n, total, agent: "claude" | "codex"): Promise<void>` — `const msg = await roundRunMessage(dir, n)`; `const sess = await spawnTerm(dir, { title: \`Round ${n}\`, kind: agent, autoType: terminalRoundCommand(agent, msg) })`; `setActiveTermFor(dir, sess.id)`; `markRunningRound(dir, { n, route: "terminal", termId: sess.id })`; then subscribe with `subscribeTerms` and, when `getTerm(sess.id)?.dead` becomes true (or the session disappears), `clearRunningRound(dir)`, `refreshNotes(dir)`, and announce like the pane route does (all notes done → round-done, else round-ended), then unsubscribe.
- `RoundCard`: props gain `onRunInTerminal?: (n, total) => void`, `onRevealPane?: () => void`, `onRevealTerminal?: (termId: number) => void`; `RoundCardData.route: RoundRoute | null`, plus `termId?: number`. Buttons: plan-ready → `Run in the pane`, `Run in a terminal`, `Copy the prompt`; generating → `Stop` (calls `cancelAgentTurn(dir)`; the turn-end path does the record cancel); executing with route pane → `Open the pane` and `Not running anymore`; executing with route terminal → `Open the terminal` and `Not running anymore`; finished/failed unchanged. `View log` button and the `logOpen` props are removed.

- [ ] **Step 1: Test the command builder first**

```ts
  it("the terminal route quotes the run message for the shell", () => {
    const msg = "Read fixes/phase_3_fixes_prompt.md and run `git commit -m \"Close FX-3\"` when it's done";
    const cmd = terminalRoundCommand("claude", msg);
    expect(cmd.startsWith("claude '")).toBe(true);
    expect(cmd.endsWith("'\n")).toBe(true);
    expect(cmd).toContain("when it'\\''s done");
    expect(cmd).toContain('`git commit -m "Close FX-3"`');
    expect(terminalRoundCommand("codex", "x").startsWith("codex '")).toBe(true);
  });
```

Run → FAIL → implement → PASS.

- [ ] **Step 2: The terminal route and the card**

Implement `round-run.ts` as specified (read `subscribeTerms`, `getTerm`, `setActiveTermFor`, `spawnTerm`'s `SpawnOpts` in term-sessions.ts first; `kind: agent` makes the tab carry the agent logo the way `onStartAgent` does). Rewrite `RoundCard` buttons and the subline call; delete `runHeadless`, `roundExecute`, `roundExecCancel`, `fixesCancel` imports; `cancel` in the generating phase becomes `cancelAgentTurn(dir)` (imported from agent-session). NotesPane: remove `RoundLog`, `logOpen`, `toggleLog`, `loadLogOpen`, `closeLog`, `showLog`, `revealTerminal`'s RoundLog use (keep `onRevealTerminal` for the card's `Open the terminal`, which should reveal the terminal column and activate the tab: App's `onRevealTerminal` + `setActiveTermFor`). App.tsx adds `onRunRoundInTerminal={(n, total) => { patchLayout({ terminal: true, terminalCollapsed: false }); void startRoundInTerminal(active.dir, n, total, agent).catch(…toastError("Couldn't start the round", …)) }}` (find the current `agent` state name in App.tsx) and `onRevealPane={() => patchLayout({ agent: true, agentCollapsed: false })}`. Delete `src/screens/notes/RoundLog.tsx`; delete `roundLogHeader`/`tailLines`/`LOG_MAX_LINES` and their tests if now unused.

- [ ] **Step 3: Verify and commit**

Run: `npm run typecheck && npm test 2>&1 | tail -3`. Expected: green.

```bash
git add src/lib/notes-model.ts src/lib/notes-model.test.ts src/lib/round-run.ts src/screens/notes/RoundCard.tsx src/screens/notes/NotesPane.tsx src/screens/notes/Sidebar.tsx src/App.tsx
git rm src/screens/notes/RoundLog.tsx
git commit -m "feat(rounds): a round runs in the pane or in a terminal tab you can watch; the log panel and the headless button go"
```

---

### Task 5: The roadmap stops mirroring sessions that no longer exist

**Files:**
- Modify: `src/lib/roadmap-data.ts` (`RoadmapCtx`: remove `fixesRun`, `execRun`, `execRoundN`, `onCancelFixes`, `onCancelExec`, `onViewExecLog`, `onViewFixesLog`; the two building-card branches; the `!ctx.fixesRun?.running` guards)
- Modify: `src/screens/roadmap/RoadmapPane.tsx` (remove the `execRun`/`fixesRun` state, both `useSessionStatus` calls for `exec`/`fixes`, their effects, handlers and imports)
- Modify: `src/screens/roadmap/preview-fixtures.ts`, `src/lib/roadmap-data.test.ts` (fixtures/ctx literals)
- Test: `src/lib/roadmap-data.test.ts`

**Interfaces:**
- `RoadmapCtx.initRun` stays; the building card renders only for `init`. `roadmap-data.test.ts` ctx literals drop the removed fields.

- [ ] **Step 1: Remove, typecheck, test**

Delete the fields and branches listed above (read `mapRoadmap` around the `fixesRun`/`execRun` branches: keep the `initRun` branch intact). In `RoadmapPane.tsx`, the round-done announcements that lived in the exec effect are now made by `agent-session.ts`/`round-run.ts` (Task 3/4); delete the effect. Remove `roundExecStatus`, `fixesCancel`, `fixesLogPath`, `fixesStatus`, `execLogPath`, `roundExecCancel`, `roundGenerating` imports that become unused. Add one test in `roadmap-data.test.ts`: `mapRoadmap` with `initRun: null` and a manifest present yields no `building` card (whatever the prop is named; read the existing init-run test and invert it).

Run: `npm run typecheck && npm test 2>&1 | tail -3`. Expected: green.

- [ ] **Step 2: Commit**

```bash
git add src/lib/roadmap-data.ts src/lib/roadmap-data.test.ts src/screens/roadmap/RoadmapPane.tsx src/screens/roadmap/preview-fixtures.ts
git commit -m "refactor(roadmap): the building card knows only the roadmap session; round sessions are gone"
```

---

### Task 6: Sweep, docs, live check

**Files:**
- Modify: `docs/superpowers/specs/2026-09-16-agent-access-and-visible-rounds-design.md` (implementation notes for plan 2)
- Modify: `src/lib/help-content.ts` if it mentions "Run headless" or the log panel (grep `headless`, `View log`, `Fix plan log`, `Round log` across `src/`)
- Verify: `grep -rn "headless\|fixes_generate\|round_execute\|exec_log\|RoundLog\|RoundFlow\|armRoundWatch\|execRunning" src src-tauri/src` returns nothing but the spec/plan docs.

- [ ] **Step 1: Sweep and docs**

Fix every hit from the grep above (copy in help text, stale comments). Append to the spec's implementation notes: planning is a pane turn settled by `round_plan_settle` at turn end; the terminal route types `claude '<message>'` / `codex '<message>'` into a fresh tab titled `Round N` and clears its mark when the tab dies; the round-done and round-ended announcements moved from the roadmap's exec effect to the two routes; `SessionKind` is `init` only.

- [ ] **Step 2: Full verification**

Run: `cd src-tauri && cargo test 2>&1 | tail -3 && cargo check 2>&1 | grep -c "^warning"; cd .. && npm test 2>&1 | tail -3 && npm run typecheck`.
Expected: all green; warning count at baseline.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-09-16-agent-access-and-visible-rounds-design.md src/lib/help-content.ts
git commit -m "docs(rounds): what changed when rounds became visible"
```

- [ ] **Step 4: Live check (the controller does this on a throwaway copy, never on this repo)**

Copy the repo to a scratch dir with `rsync -a --exclude node_modules --exclude src-tauri/target`, open it in a debug build (`npm run tauri dev` or the bundle with `--open <copy>`), queue two notes, click "Start a round": the agent pane shows "Round N · planning 2 notes · writing the plan", the plan lands, the card says plan ready with two run buttons; "Run in a terminal" opens a `Round N` tab with the agent started and the instructions as its first message; the notes tick as the agent sets them done.
