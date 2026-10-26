//! The three entry points (spec §7) and the run card's buttons, as commands.
//! Each `_in` function works on disk and is tested; the `#[tauri::command]`
//! wrappers add the project allowlist and the live controller.
use super::checks::{max_lanes, repo_checks};
use super::gate;
use super::judge::Judge;
use super::oracle;
use super::prompts;
use super::record::*;
use super::runner::{self, CtlParts, RunCtl};
use super::scheduler::{self, Action};
use super::Runs;
use crate::{OpenRoots, Project};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::BTreeSet;
use std::path::Path;
use std::sync::Arc;
use tauri::State;

#[derive(Deserialize, Debug, Clone)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Source { Notes, Plan { path: String }, Prompt { text: String } }

#[derive(Deserialize, Debug, Clone)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum NeedsAct { Skip { item: String }, Rewrite { item: String, text: String }, Retry { lane: String }, Recheck, Dismiss { index: usize } }

pub enum Settle { Launch(RunRecord), Retry(String), Failed(String) }

fn plan_number(path: &str) -> Option<u64> {
    regex::Regex::new(r"^fixes/phase_(\d+)_fixes_plan\.md$").ok()?.captures(path)?.get(1)?.as_str().parse().ok()
}

/// Items, the files each names, and the pairs that share a file — the state
/// of the sizing decision (spec §6, decision 4). Never whole files.
pub fn sizing_table(items: &[(String, String)]) -> String {
    let re = regex::Regex::new(r"[A-Za-z0-9_\-./]+\.(?:tsx?|jsx?|rs|css|json|md|py|toml|html)").expect("pattern");
    let files: Vec<(String, BTreeSet<String>)> = items.iter().map(|(id, body)| (id.clone(), re.find_iter(body).map(|m| m.as_str().to_string()).collect())).collect();
    let mut out: Vec<String> = files.iter().map(|(id, f)| if f.is_empty() { format!("{id}: (no files named)") } else { format!("{id}: {}", f.iter().cloned().collect::<Vec<_>>().join(", ")) }).collect();
    for i in 0..files.len() {
        for j in i + 1..files.len() {
            let shared: Vec<String> = files[i].1.intersection(&files[j].1).cloned().collect();
            if !shared.is_empty() { out.push(format!("{} and {} share {}", files[i].0, files[j].0, shared.join(", "))); }
        }
    }
    out.join("\n")
}

/// A finished record under the number a new run takes keeps its history beside it.
fn move_aside(dir: &Path, n: u64) {
    if let Ok(Some(old)) = load(dir, n) {
        if old.state.terminal() {
            let _ = std::fs::rename(path(dir, n), runs_dir(dir).join(format!("{n}.prev-{}.json", crate::epoch_ms())));
        }
    }
}

fn set_round(dir: &Path, n: u64, state: &str, plan: &str, prompt: &str) -> Result<(), String> {
    let mut rounds = crate::notes::rounds::load(dir)?;
    match rounds.iter_mut().find(|r| r.n == n) {
        Some(r) => r.state = state.into(),
        None => rounds.push(crate::notes::rounds::Round { n, state: state.into(), kind: None, task_ids: vec![], note_paths: vec![],
            created_at: crate::epoch_ms(), plan_path: plan.into(), prompt_path: prompt.into() }),
    }
    crate::notes::rounds::save(dir, &rounds)
}

/// The planner prompt for a record — at the start, and again on Resume.
pub fn planner_prompt_for(p: &Project, rec: &RunRecord) -> String {
    let checks = repo_checks(&p.repo, p.manifest.as_ref());
    let lanes = rec.target_lanes.unwrap_or(max_lanes(p.manifest.as_ref()) as u32);
    let n = rec.round_n();
    match rec.kind {
        RunKind::Notes => prompts::planner_notes(&crate::FIXES_PROMPT_HEAD.replace("{N}", &n.to_string()).replace("{TASKS}", &format!(".chronicle/round_{n}_notes.json")), lanes, &checks),
        RunKind::Plan => prompts::planner_plan(n, &rec.plan_path, &rec.prompt_path, lanes, &checks),
        RunKind::Prompt => prompts::planner_prompt(n, &rec.source, lanes, &checks),
    }
}

pub fn begin_in(p: &Project, source: &Source, judge: Option<&Judge>) -> Result<Value, String> {
    begin_on(p, source, judge, crate::agents::project_profile(&p.dir))
}

/// Begin on a given agent: refused before anything is opened when that agent can't run lanes (R28).
pub fn begin_on(p: &Project, source: &Source, judge: Option<&Judge>, agent: &crate::agents::AgentProfile) -> Result<Value, String> {
    if let Some(why) = crate::acp::worker_refusal(agent) { return Err(why); }
    let dir = &p.dir;
    if list(dir).iter().any(|r| !r.state.terminal()) { return Err("A round is already running in this project. Stop it or let it finish first.".into()); }
    let max = max_lanes(p.manifest.as_ref()) as u32;
    let (n, total, kind, text, items): (u64, u64, RunKind, String, Vec<(String, String)>) = match source {
        Source::Notes => {
            let out = crate::round_plan_begin_in(dir)?;
            let n = out["n"].as_u64().ok_or("the round has no number")?;
            let notes: Vec<Value> = serde_json::from_str(&std::fs::read_to_string(dir.join(format!(".chronicle/round_{n}_notes.json"))).unwrap_or_default()).unwrap_or_default();
            let items = notes.iter().map(|v| (v["title"].as_str().unwrap_or("").to_string(), v["body"].as_str().unwrap_or("").to_string())).collect();
            (n, out["total"].as_u64().unwrap_or(0), RunKind::Notes, String::new(), items)
        }
        Source::Plan { path: plan } => {
            let n = plan_number(plan).ok_or("That isn't a fixes/phase_N_fixes_plan.md file.")?;
            let body = std::fs::read_to_string(dir.join(plan)).map_err(|_| format!("There's no plan at {plan}."))?;
            set_round(dir, n, "generating", plan, &plan.replace("_plan.md", "_prompt.md"))?;
            let total = crate::notes::rounds::load(dir)?.into_iter().find(|r| r.n == n).map(|r| r.note_paths.len() as u64).unwrap_or(0);
            let items = body.lines().filter(|l| { let t = l.trim_start(); t.starts_with("- ") || t.starts_with("## ") }).map(|l| (l.trim().to_string(), l.to_string())).collect();
            (n, total, RunKind::Plan, plan.clone(), items)
        }
        Source::Prompt { text } => {
            if text.trim().is_empty() { return Err("Write what the round should do first.".into()); }
            let n = crate::notes::rounds::load(dir)?.iter().map(|r| r.n).max().unwrap_or(0).max(list(dir).iter().map(|r| r.n).max().unwrap_or(0)) + 1;
            set_round(dir, n, "generating", &format!("fixes/phase_{n}_fixes_plan.md"), &format!("fixes/phase_{n}_fixes_prompt.md"))?;
            (n, 0, RunKind::Prompt, text.clone(), vec![("the request".into(), text.clone())])
        }
    };
    move_aside(dir, n);
    let mut rec = RunRecord::new(n, kind, Some(n), &format!("fixes/phase_{n}_fixes_plan.md"), &format!("fixes/phase_{n}_fixes_prompt.md"), &text);
    let (lanes, logs) = match judge {
        Some(j) if items.len() > 1 => j.sizing(&sizing_table(&items), max),
        _ => ((items.len() as u32).clamp(1, max), vec![]),
    };
    rec.target_lanes = Some(lanes);
    // the lanes' reviews read each lane's whole diff from here (spec §3)
    rec.base_commit = super::gate::git(&p.repo, &["rev-parse", "HEAD"]).ok().filter(|h| !h.is_empty());
    rec.decisions.extend(logs);
    if let Some(j) = judge {
        // spec §6: with no decisions key the agent is the judge, and the card says so once
        if j.decisions_ride_agent() { rec.notices.push(oracle::AGENT_DECISIONS_NOTICE.into()); }
        rec.notices.extend(j.take_notice());
        rec.judge_usd += j.spent_usd();
    }
    rec.cost = rec.total_cost();
    save(dir, &mut rec)?;
    let prompt = planner_prompt_for(p, &rec);
    Ok(json!({ "n": n, "total": total, "prompt": prompt }))
}

fn fail_round(dir: &Path, rec: &RunRecord) {
    let n = rec.round_n();
    // a plan was the user's before the run: its round goes back to ready and its notes stay as they are
    if rec.kind == RunKind::Plan { return runner::set_round_state(dir, n, "ready"); }
    runner::release_notes(dir, rec);
    runner::set_round_state(dir, n, round_state_for(RunState::Failed));
}

/// What the chat lane's planner said in its last turn: the agent's text after
/// the last message sent to it, from the lane's own thread (spec §11: a run
/// whose planner never declared shows the planner's last text).
fn planner_last_text(dir: &Path) -> Option<String> {
    let store = crate::acp::ledger::agent_dir(dir);
    let sid = crate::acp::ledger::current_session(&store)?;
    let lines = crate::acp::transcript::read(&store, &sid);
    let from = lines.iter().rposition(|l| l["method"] == "_chronicle/user_message").map(|i| i + 1).unwrap_or(0);
    let text: String = lines[from..].iter()
        .filter(|l| l["method"] == "session/update" && l["params"]["update"]["sessionUpdate"] == "agent_message_chunk")
        .filter_map(|l| l["params"]["update"]["content"]["text"].as_str())
        .collect();
    let mut text = text.trim().to_string();
    if text.is_empty() { return None; }
    if text.chars().count() > 600 { text = format!("{}…", text.chars().take(600).collect::<String>().trim_end()); }
    Some(text)
}

/// The planner's turn ended: a declared map launches the run; no map is
/// retried twice with the reasons, then the run fails (spec §3, §11). Each
/// settle's planner cost is added to the record's.
pub fn settle_in(p: &Project, n: u64, planner_cost: f64) -> Result<Settle, String> {
    let mut rec = load(&p.dir, n)?.ok_or_else(|| format!("There's no round {n} being planned."))?;
    if rec.state != RunState::Planning { return Err(format!("Round {n} isn't being planned any more.")); }
    rec.planner_cost_usd += planner_cost.max(0.0);
    if rec.lane_map.is_some() {
        rec.set_state(RunState::Running)?;
        save(&p.dir, &mut rec)?;
        runner::set_round_state(&p.dir, rec.round_n(), round_state_for(rec.state));
        return Ok(Settle::Launch(rec));
    }
    rec.planner_tries += 1;
    if rec.planner_tries > 2 {
        rec.set_state(RunState::Failed)?;
        // the footer reads this one field: the validation reasons when a map was refused, else what the planner said
        rec.planner_error = rec.planner_error.clone().or_else(|| planner_last_text(&p.dir));
        let why = rec.planner_error.clone().unwrap_or_else(|| "The planner never declared a lane map.".into());
        save(&p.dir, &mut rec)?;
        fail_round(&p.dir, &rec);
        return Ok(Settle::Failed(format!("No lane map Chronicle could accept after three tries. {why}")));
    }
    save(&p.dir, &mut rec)?;
    Ok(Settle::Retry(prompts::planner_retry(rec.planner_error.as_deref()
        .unwrap_or("- No lane map was declared. Call chronicle_run_declare with the items and the lanes."))))
}

/// The user stopped the planning turn (or Stop on a run still being planned).
pub fn cancel_planning_in(p: &Project, n: u64) -> Result<(), String> {
    let mut rec = load(&p.dir, n)?.ok_or_else(|| format!("There's no round {n}."))?;
    let planning = rec.state == RunState::Planning || (rec.state == RunState::Interrupted && rec.interrupted_from == Some(RunState::Planning));
    if !planning { return Ok(()); }
    rec.set_state(RunState::Stopped)?;
    save(&p.dir, &mut rec)?;
    match rec.kind {
        // the plan was the user's before the run: it stays, and so does its round
        RunKind::Plan => runner::set_round_state(&p.dir, rec.round_n(), "ready"),
        _ => crate::round_plan_cancel_in(&p.dir)?,
    }
    Ok(())
}

/// After a restart: a run nobody drives is interrupted, remembering where.
/// Each record it marks is handed to `marked` (the app publishes it).
pub fn recover_in(dir: &Path, live: &dyn Fn(u64) -> bool, marked: &dyn Fn(&RunRecord)) -> Vec<RunRecord> {
    let mut out = list(dir);
    for r in out.iter_mut() {
        if !r.state.terminal() && r.state != RunState::Interrupted && !live(r.n) {
            r.interrupted_from = Some(r.state);
            r.state = RunState::Interrupted;
            if save(dir, r).is_ok() { marked(r); }
        }
    }
    out
}

/// Driven right now: a controller holds it, or (still planning) the chat lane
/// was handed its prompt in this app session.
pub fn is_live(runs: &Runs, dir: &Path, n: u64) -> bool {
    runs.get(dir, n).map(|c| !c.snapshot().state.terminal()).unwrap_or(false) || runs.is_planning(dir, n)
}

pub fn apply_needs_you(dir: &Path, rec: &mut RunRecord, act: &NeedsAct) -> Result<(), String> {
    let parked_at = |rec: &RunRecord, item: &str| rec.needs_you.iter().position(|x| x.kind == "parked" && x.item.as_deref() == Some(item)).ok_or_else(|| format!("{item} isn't waiting on you."));
    match act {
        NeedsAct::Skip { item } => {
            // everything that can fail comes first: a failed Skip keeps its row and changes nothing
            let i = parked_at(rec, item)?;
            let note = rec.lane_map.as_ref().and_then(|m| m.items.iter().find(|x| &x.id == item)).and_then(|x| x.note.clone());
            if let Some(note) = &note {
                crate::notes::rounds::set_status(dir, note, Some("queued"), None)?;
                if let Ok(mut rounds) = crate::notes::rounds::load(dir) {
                    if let Some(r) = rounds.iter_mut().find(|r| r.n == rec.round_n()) { r.note_paths.retain(|p| p != note); }
                    let _ = crate::notes::rounds::save(dir, &rounds);
                }
            }
            rec.needs_you.remove(i);
            rec.skipped.push(item.clone());
        }
        NeedsAct::Rewrite { item, text } => {
            let text = text.trim();
            if text.is_empty() { return Err("Write what the item should say first.".into()); }
            let i = parked_at(rec, item)?;
            let old = rec.needs_you[i].lane.clone().unwrap_or_default();
            let map = rec.lane_map.as_mut().ok_or("This round has no lanes.")?;
            let spec = map.lanes.iter().find(|l| l.id == old).cloned().ok_or_else(|| format!("There's no lane {old}."))?;
            let id = (b'a'..=b'z').map(|c| (c as char).to_string()).find(|c| !map.lanes.iter().any(|l| &l.id == c)).ok_or("A round can have at most 26 lanes.")?;
            if let Some(it) = map.items.iter_mut().find(|x| &x.id == item) { it.rewrite = Some(text.to_string()); }
            if let Some(l) = map.lanes.iter_mut().find(|l| l.id == old) { l.items.retain(|x| x != item); }
            // the rewritten item runs as its own lane on the same files, after the lane that parked it
            map.lanes.push(LaneSpec { id: id.clone(), title: format!("{item}, rewritten"), items: vec![item.clone()],
                owns: spec.owns.clone(), depends_on: vec![old.clone()], checks: spec.checks.clone(), isolation: spec.isolation.clone() });
            rec.lanes.push(LaneRecord::new(&id));
            rec.needs_you.remove(i);
        }
        NeedsAct::Retry { lane } => {
            // the controller's next tick un-parks the lanes that waited on this one (`unpark_dependents`)
            let i = rec.needs_you.iter().position(|x| x.kind == "exhausted" && x.lane.as_deref() == Some(lane)).ok_or_else(|| format!("Lane {} isn't waiting on you.", lane.to_uppercase()))?;
            if rec.lane(lane).is_none() { return Err(format!("There's no lane {lane}.")); }
            rec.needs_you.remove(i);
            let Some(l) = rec.lane_mut(lane) else { return Ok(()) };
            l.state = LaneState::Waiting;
            l.attempt = 0;
            l.fixes = 0;
            l.parked = None;
            l.ended = None;
            l.retry_at_ms = None;
        }
        NeedsAct::Recheck => {
            if !rec.needs_you.iter().any(|x| x.kind == "head") { return Err("There's no failed check waiting on you.".into()); }
            rec.needs_you.retain(|x| x.kind != "head");
            rec.head_check = None;
        }
        NeedsAct::Dismiss { index } => {
            if rec.needs_you.get(*index).map(|x| x.kind == "refused") != Some(true) { return Err("Only a refused publish can be dismissed.".into()); }
            rec.needs_you.remove(*index);
        }
    }
    if rec.state == RunState::NeedsYou && scheduler::blocking(rec) == 0 { rec.set_state(RunState::Running)?; }
    Ok(())
}

/// A needs-you action on a run no controller holds: a refused publish can be
/// dismissed from the record itself (a planning run's chat lane makes those);
/// everything else waits for the run to be driven again.
pub fn needs_you_on_record(dir: &Path, n: u64, act: &NeedsAct) -> Result<RunRecord, String> {
    let mut rec = load(dir, n)?.ok_or_else(|| format!("There's no round {n}."))?;
    if !matches!(act, NeedsAct::Dismiss { .. }) {
        return Err(match rec.state {
            RunState::Interrupted => "Resume the run first.".to_string(),
            RunState::Planning => format!("Round {n} is still being planned."),
            s if s.terminal() => format!("Round {n} has finished."),
            _ => format!("Round {n} isn't being driven right now."),
        });
    }
    apply_needs_you(dir, &mut rec, act)?;
    save(dir, &mut rec)?;
    Ok(rec)
}

/// The cancel Stop sends a planning run's turn (spec §3: Stop is session/cancel):
/// the planner is the chat lane's session. False when no session is there.
pub fn cancel_planner_turn(agents: &crate::acp::AcpState, dir: &Path) -> bool {
    agents.get(&planner_key(dir)).map(|s| s.cancel().is_ok()).unwrap_or(false)
}
/// The chat lane's session key for a canonical project dir (main.rs's `session_key`).
fn planner_key(dir: &Path) -> String { crate::acp::Lane::Chat.key(&dir.to_string_lossy()) }

/// Begin under the project's in-flight hold: a second begin (or a resume)
/// while this one sizes and saves is refused with a sentence.
pub fn begin_with(runs: &Runs, p: &Project, source: &Source, judge: Option<&Judge>) -> Result<Value, String> {
    let _hold = runs.hold(&p.dir)?;
    let out = begin_in(p, source, judge)?;
    if let Some(n) = out["n"].as_u64() { runs.planning(&p.dir, n); }
    Ok(out)
}

/// A controller for a running record, registered and started. The judge and
/// the gate's reviewer share one review side, so one degrade covers both.
fn launch(app: &tauri::AppHandle, runs: &Runs, p: &Project, rec: RunRecord, first: Vec<Action>) -> Result<(), String> {
    // the agent may have changed since the run began: lanes never run on one that can't ask first (R28)
    if let Some(why) = crate::acp::worker_refusal(crate::agents::project_profile(&p.dir)) { return Err(why); }
    let (decisions, review) = oracle::for_project(&p.dir);
    let (ctl, rx) = RunCtl::new(CtlParts {
        dir: p.dir.clone(), repo: p.repo.clone(), scratch: gate::scratch_dir(&p.repo), rec,
        checks: repo_checks(&p.repo, p.manifest.as_ref()), max_lanes: max_lanes(p.manifest.as_ref()),
        judge: Judge::new(decisions, review.clone()), reviewer: review,
        host: Arc::new(super::host::AcpHost::new(app.clone())), publish: runs.publisher(),
    });
    runs.insert(ctl.clone());
    ctl.update(|_| {});
    runner::spawn(ctl, rx, first);
    Ok(())
}

fn live_ctl(runs: &Runs, p: &Project, n: u64) -> Result<Arc<RunCtl>, String> {
    runs.get(&p.dir, n).filter(|c| !c.snapshot().state.terminal()).ok_or_else(|| format!("Round {n} isn't running — resume it first."))
}

#[tauri::command]
pub async fn run_begin(app: tauri::AppHandle, roots: State<'_, OpenRoots>, runs: State<'_, Runs>, dir: String, source: Source) -> Result<Value, String> {
    let p = crate::project_for(&roots, &dir)?;
    // the sizing decision may wait on a provider or the agent: off the async runtime
    let (q, h) = (p.clone(), app.clone());
    let out = tauri::async_runtime::spawn_blocking(move || {
        use tauri::Manager;
        let (decisions, review) = oracle::for_project(&q.dir);
        begin_with(&h.state::<Runs>(), &q, &source, Some(&Judge::new(decisions, review)))
    }).await.map_err(|e| e.to_string())??;
    if let Some(n) = out["n"].as_u64() {
        if let Some(rec) = load(&p.dir, n).ok().flatten() { runs.publish(&p.dir, &rec); }
    }
    Ok(out)
}

#[tauri::command]
pub async fn run_plan_settle(app: tauri::AppHandle, roots: State<'_, OpenRoots>, runs: State<'_, Runs>, dir: String, n: u64, planner_cost: Option<f64>) -> Result<Value, String> {
    let p = crate::project_for(&roots, &dir)?;
    let out = match settle_in(&p, n, planner_cost.unwrap_or(0.0))? {
        Settle::Launch(rec) => { launch(&app, &runs, &p, rec, vec![])?; json!({ "state": "running" }) }
        Settle::Retry(prompt) => json!({ "state": "retry", "prompt": prompt }),
        Settle::Failed(reason) => json!({ "state": "failed", "reason": reason }),
    };
    if let Some(rec) = load(&p.dir, n)? { runs.publish(&p.dir, &rec); }
    Ok(out)
}

#[tauri::command]
pub async fn run_plan_cancel(roots: State<'_, OpenRoots>, runs: State<'_, Runs>, dir: String, n: u64) -> Result<(), String> {
    let p = crate::project_for(&roots, &dir)?;
    cancel_planning_in(&p, n)?;
    if let Some(rec) = load(&p.dir, n)? { runs.publish(&p.dir, &rec); }
    Ok(())
}

#[tauri::command]
pub async fn runs_list(roots: State<'_, OpenRoots>, runs: State<'_, Runs>, dir: String) -> Result<Vec<RunRecord>, String> {
    let p = crate::project_for(&roots, &dir)?;
    let live = |n: u64| is_live(&runs, &p.dir, n);
    let marked = |r: &RunRecord| runs.publish(&p.dir, r);
    Ok(recover_in(&p.dir, &live, &marked).into_iter().map(|r| runs.get(&p.dir, r.n).map(|c| c.snapshot()).unwrap_or(r)).collect())
}

#[tauri::command]
pub async fn run_stop(roots: State<'_, OpenRoots>, runs: State<'_, Runs>, agents: State<'_, crate::acp::AcpState>, dir: String, n: u64) -> Result<(), String> {
    let p = crate::project_for(&roots, &dir)?;
    if let Ok(ctl) = live_ctl(&runs, &p, n) { return ctl.tx.send(runner::Ev::Stop).map_err(|e| e.to_string()); }
    let rec = load(&p.dir, n)?.ok_or_else(|| format!("There's no round {n}."))?;
    match rec.state {
        RunState::Planning => {
            // the planner's turn ends first, so it writes nothing after its files are swept
            cancel_planner_turn(&agents, &p.dir);
            cancel_planning_in(&p, n)?
        }
        RunState::Interrupted if rec.interrupted_from == Some(RunState::Planning) => cancel_planning_in(&p, n)?,
        RunState::Interrupted => {
            let mut r = rec;
            r.set_state(RunState::Stopped)?;
            save(&p.dir, &mut r)?;
            runner::release_notes(&p.dir, &r);
            runner::set_round_state(&p.dir, r.round_n(), round_state_for(r.state));
        }
        _ => {}
    }
    if let Some(rec) = load(&p.dir, n)? { runs.publish(&p.dir, &rec); }
    Ok(())
}

#[tauri::command]
pub async fn run_resume(app: tauri::AppHandle, roots: State<'_, OpenRoots>, runs: State<'_, Runs>, dir: String, n: u64) -> Result<Value, String> {
    let p = crate::project_for(&roots, &dir)?;
    // one resume (or begin) at a time: the check below and the controller's insert happen under it
    let _hold = runs.hold(&p.dir)?;
    let rec = load(&p.dir, n)?.ok_or_else(|| format!("There's no round {n}."))?;
    if rec.state != RunState::Interrupted { return Err(format!("Round {n} wasn't interrupted.")); }
    let (mut back, first) = scheduler::resume(&rec);
    save(&p.dir, &mut back)?;
    if back.state == RunState::Planning {
        runs.planning(&p.dir, n);
        runs.publish(&p.dir, &back);
        return Ok(json!({ "state": "planning", "prompt": planner_prompt_for(&p, &back) }));
    }
    launch(&app, &runs, &p, back, first)?;
    Ok(json!({ "state": "running" }))
}

#[tauri::command]
pub async fn run_needs_you(roots: State<'_, OpenRoots>, runs: State<'_, Runs>, dir: String, n: u64, act: NeedsAct) -> Result<(), String> {
    let p = crate::project_for(&roots, &dir)?;
    let Some(ctl) = runs.get(&p.dir, n).filter(|c| !c.snapshot().state.terminal()) else {
        let rec = needs_you_on_record(&p.dir, n, &act)?;
        runs.publish(&p.dir, &rec);
        return Ok(());
    };
    let mut result = Ok(());
    ctl.update(|r| { result = apply_needs_you(&p.dir, r, &act); });
    // the next tick acts on it — a retried lane starts and the lanes that waited on it un-park
    let _ = ctl.tx.send(runner::Ev::Kick);
    result
}

#[tauri::command]
pub async fn run_lane_nudge(roots: State<'_, OpenRoots>, runs: State<'_, Runs>, dir: String, n: u64, lane: String, text: String) -> Result<(), String> {
    let p = crate::project_for(&roots, &dir)?;
    if text.trim().is_empty() { return Err("Write a message first.".into()); }
    live_ctl(&runs, &p, n)?.nudge(&lane, &text)
}

#[tauri::command]
pub async fn run_lane_discard(roots: State<'_, OpenRoots>, runs: State<'_, Runs>, dir: String, n: u64, lane: String) -> Result<usize, String> {
    let p = crate::project_for(&roots, &dir)?;
    let rec = runs.get(&p.dir, n).map(|c| c.snapshot()).or_else(|| load(&p.dir, n).ok().flatten()).ok_or_else(|| format!("There's no round {n}."))?;
    let l = rec.lane(&lane).ok_or_else(|| format!("There's no lane {lane}."))?;
    if l.state.busy() { return Err(format!("Lane {} is still working.", lane.to_uppercase())); }
    let globs = rec.lane_map.as_ref().and_then(|m| m.lanes.iter().find(|s| s.id == lane)).map(|s| super::lane_map::compile(&s.owns)).unwrap_or_default();
    let mine: Vec<String> = gate::dirty_paths(&p.repo).into_iter().filter(|f| globs.iter().any(|g| g.matches(f))).collect();
    gate::discard_paths(&p.repo, &mine)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn project(name: &str) -> crate::Project {
        let d = std::env::temp_dir().join(format!("chronicle-cmds-{}-{}", name, std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        for p in ["src/lib", ".chronicle/notes/Tasks", "fixes"] { std::fs::create_dir_all(d.join(p)).unwrap(); }
        std::fs::write(d.join("package.json"), r#"{"scripts":{"test":"vitest run","build":"vite build"}}"#).unwrap();
        crate::Project::bare(&d.canonicalize().unwrap())
    }
    fn note(p: &crate::Project, rel: &str, body: &str) {
        std::fs::write(p.dir.join(".chronicle/notes").join(rel), format!("---\nstatus: queued\n---\n\n{body}\n")).unwrap();
    }
    fn accept(p: &crate::Project, n: u64, map: LaneMap) {
        let mut r = load(&p.dir, n).unwrap().unwrap();
        r.lanes = map.lanes.iter().map(|l| LaneRecord::new(&l.id)).collect();
        r.lane_map = Some(map);
        save(&p.dir, &mut r).unwrap();
    }
    fn one_lane(note: Option<&str>) -> LaneMap {
        LaneMap { items: vec![Item { id: "T-1".into(), title: "x".into(), note: note.map(String::from), rewrite: None }],
                  lanes: vec![LaneSpec { id: "a".into(), title: "A".into(), items: vec!["T-1".into()], owns: vec!["src/lib/**".into()], depends_on: vec![], checks: vec![], isolation: None }] }
    }

    #[test]
    fn a_run_whose_decisions_ride_the_agent_says_so_once_on_its_card() {
        use crate::runs::oracle::fake::{second, FakeOracle};
        use crate::runs::oracle::Fallback;
        let p = project("agent-notice");
        let agent = FakeOracle::named("agent/claude-acp");
        let on_agent = Judge::new(Fallback::agent(agent.clone()), second(&agent, &agent));
        let out = begin_on(&p, &Source::Prompt { text: "do it".into() }, Some(&on_agent), crate::agents::claude()).unwrap();
        let rec = load(&p.dir, out["n"].as_u64().unwrap()).unwrap().unwrap();
        assert_eq!(rec.notices, vec![super::super::oracle::AGENT_DECISIONS_NOTICE.to_string()]);
        assert_eq!(super::super::oracle::AGENT_DECISIONS_NOTICE, "Decisions ride your agent — add a decisions key in Setup for a cheaper, faster judge.");
        // a decisions key in Setup: no notice
        let q = project("key-notice");
        let keyed = Judge::new(crate::runs::oracle::fake::fallback(&FakeOracle::named("anthropic/claude"), &agent), second(&agent, &agent));
        let out = begin_on(&q, &Source::Prompt { text: "do it".into() }, Some(&keyed), crate::agents::claude()).unwrap();
        assert!(load(&q.dir, out["n"].as_u64().unwrap()).unwrap().unwrap().notices.is_empty());
    }

    #[test]
    fn the_sizing_decisions_cost_is_the_runs() {
        use crate::runs::oracle::fake::{decision, score, second, FakeOracle};
        use crate::runs::oracle::Fallback;
        let p = project("sizing-cost");
        note(&p, "Tasks/A.md", "Fix src/lib/a.ts");
        note(&p, "Tasks/B.md", "Fix src/lib/b.ts");
        let agent = FakeOracle::named("agent/claude-acp");
        *agent.per_call_usd.lock().unwrap() = 0.04;
        agent.decide_with(decision(vec![score("lanes", 2, 0.9)], "agent/claude-acp", false));
        let j = Judge::new(Fallback::agent(agent.clone()), second(&agent, &agent));
        let out = begin_on(&p, &Source::Notes, Some(&j), crate::agents::claude()).unwrap();
        let rec = load(&p.dir, out["n"].as_u64().unwrap()).unwrap().unwrap();
        assert!(agent.decide_calls.load(std::sync::atomic::Ordering::SeqCst) >= 1);
        assert!(rec.judge_usd > 0.0 && (rec.cost.usd - rec.judge_usd).abs() < 1e-9, "{} / {}", rec.judge_usd, rec.cost.usd);
    }

    #[test]
    fn a_run_on_an_agent_that_cannot_ask_first_is_refused_before_the_planner() {
        let p = project("no-ask");
        note(&p, "Tasks/A.md", "Fix src/lib/a.ts");
        let opencode = crate::agents::profile("opencode").unwrap();
        for source in [Source::Notes, Source::Prompt { text: "do it".into() }] {
            let e = begin_on(&p, &source, None, opencode).unwrap_err();
            assert_eq!(e, "OpenCode can't run lanes: it never asks before changing files — choose Claude Code or Codex for this project.");
        }
        assert!(list(&p.dir).is_empty(), "no run record was made");
        assert!(crate::notes::rounds::load(&p.dir).unwrap().is_empty(), "no round was opened");
        assert!(!p.dir.join(".chronicle/round_1_notes.json").exists());
        assert!(begin_on(&p, &Source::Notes, None, crate::agents::claude()).is_ok(), "an agent that asks first begins");
    }

    #[test]
    fn a_run_from_notes_freezes_them_into_a_round_and_prompts_the_planner() {
        let p = project("notes");
        note(&p, "Tasks/A.md", "Fix src/lib/a.ts");
        note(&p, "Tasks/B.md", "Fix src/lib/a.ts and src/lib/b.ts");
        let out = begin_in(&p, &Source::Notes, None).unwrap();
        assert_eq!((out["n"].as_u64(), out["total"].as_u64()), (Some(1), Some(2)));
        let prompt = out["prompt"].as_str().unwrap();
        assert!(prompt.starts_with("You are turning a queue of user-written notes"));
        assert!(prompt.contains("chronicle_run_declare") && prompt.contains("aim for 2 lanes") && prompt.contains("test, build"));
        let rec = load(&p.dir, 1).unwrap().unwrap();
        assert_eq!((rec.kind, rec.state, rec.round), (RunKind::Notes, RunState::Planning, Some(1)));
        assert_eq!(rec.target_lanes, Some(2));
        assert_eq!(crate::notes::rounds::load(&p.dir).unwrap()[0].state, "generating");
        assert!(begin_in(&p, &Source::Notes, None).unwrap_err().contains("already running"));
    }

    #[test]
    fn a_run_from_a_plan_or_a_prompt_gets_its_own_round() {
        let p = project("plan");
        // refused for what they are, with no run live
        assert!(begin_in(&p, &Source::Plan { path: "README.md".into() }, None).unwrap_err().contains("isn't a fixes/phase_N_fixes_plan.md"));
        assert!(begin_in(&p, &Source::Prompt { text: "  ".into() }, None).unwrap_err().contains("Write what the round should do"));
        std::fs::write(p.dir.join("fixes/phase_4_fixes_plan.md"), "Round kind: bug fixes\n\n- I-1 do a\n- I-2 do b\n").unwrap();
        let out = begin_in(&p, &Source::Plan { path: "fixes/phase_4_fixes_plan.md".into() }, None).unwrap();
        assert_eq!(out["n"], 4);
        assert!(out["prompt"].as_str().unwrap().contains("Do not change either file"));
        let mut r = load(&p.dir, 4).unwrap().unwrap();
        r.state = RunState::Done;
        save(&p.dir, &mut r).unwrap();
        let out2 = begin_in(&p, &Source::Prompt { text: "Make the pane faster".into() }, None).unwrap();
        assert_eq!(out2["n"], 5);
        assert!(out2["prompt"].as_str().unwrap().contains("Make the pane faster"));
        assert_eq!(load(&p.dir, 5).unwrap().unwrap().target_lanes, Some(1), "one item: one lane, still gated");
        assert!(begin_in(&p, &Source::Prompt { text: "Again".into() }, None).unwrap_err().contains("already running"));
    }

    #[test]
    fn settling_launches_retries_twice_then_fails_and_requeues_the_notes() {
        let p = project("settle");
        note(&p, "Tasks/A.md", "x");
        begin_in(&p, &Source::Notes, None).unwrap();
        for _ in 0..2 { assert!(matches!(settle_in(&p, 1, 0.1).unwrap(), Settle::Retry(ref s) if s.contains("chronicle_run_declare"))); }
        match settle_in(&p, 1, 0.1).unwrap() { Settle::Failed(why) => assert!(why.contains("lane map")), _ => panic!("the third miss fails the run") }
        let rec = load(&p.dir, 1).unwrap().unwrap();
        assert_eq!(rec.state, RunState::Failed);
        assert_eq!(rec.planner_tries, 3);
        assert!((rec.planner_cost_usd - 0.3).abs() < 1e-9);
        assert_eq!(crate::notes::rounds::load(&p.dir).unwrap()[0].state, "failed");
        let text = std::fs::read_to_string(p.dir.join(".chronicle/notes/Tasks/A.md")).unwrap();
        assert!(text.contains("status: queued") && !text.contains("round:"), "{text}");

        let q = project("settle-ok");
        note(&q, "Tasks/A.md", "x");
        begin_in(&q, &Source::Notes, None).unwrap();
        std::fs::write(q.dir.join("fixes/phase_1_fixes_plan.md"), "Round kind: bug fixes\n").unwrap();
        accept(&q, 1, one_lane(Some("Tasks/A.md")));
        match settle_in(&q, 1, 0.26).unwrap() { Settle::Launch(r) => assert_eq!(r.state, RunState::Running), _ => panic!("an accepted map launches") }
        assert_eq!(crate::notes::rounds::load(&q.dir).unwrap()[0].state, "ready");
    }

    #[test]
    fn a_failed_plan_keeps_the_reasons_or_else_what_the_planner_last_said() {
        // the validation reasons, when the planner declared a map Chronicle refused
        let p = project("why-reasons");
        note(&p, "Tasks/A.md", "x");
        begin_in(&p, &Source::Notes, None).unwrap();
        let mut r = load(&p.dir, 1).unwrap().unwrap();
        r.planner_error = Some("- Item T-3 isn't in any lane.".into());
        save(&p.dir, &mut r).unwrap();
        for _ in 0..2 { assert!(matches!(settle_in(&p, 1, 0.0).unwrap(), Settle::Retry(ref s) if s.contains("Item T-3 isn't in any lane"))); }
        assert!(matches!(settle_in(&p, 1, 0.0).unwrap(), Settle::Failed(ref s) if s.contains("Item T-3")));
        assert_eq!(load(&p.dir, 1).unwrap().unwrap().planner_error.as_deref(), Some("- Item T-3 isn't in any lane."));

        // no map ever declared: the planner's own last words, from the chat lane's thread
        let q = project("why-text");
        note(&q, "Tasks/A.md", "x");
        begin_in(&q, &Source::Notes, None).unwrap();
        let store = crate::acp::ledger::agent_dir(&q.dir);
        crate::acp::ledger::set_current_session(&store, "s1");
        let chunk = |t: &str| json!({ "method": "session/update", "params": { "update": { "sessionUpdate": "agent_message_chunk", "content": { "type": "text", "text": t } } } });
        for line in [json!({ "method": "_chronicle/user_message", "params": { "text": "old" } }), chunk("ignored"),
                     json!({ "method": "_chronicle/user_message", "params": { "text": "plan it" } }), chunk("I couldn't find "), chunk("the declare tool.")] {
            crate::acp::transcript::append(&store, "s1", &line);
        }
        for _ in 0..2 { assert!(matches!(settle_in(&q, 1, 0.0).unwrap(), Settle::Retry(_))); }
        assert!(matches!(settle_in(&q, 1, 0.0).unwrap(), Settle::Failed(ref s) if s.contains("the declare tool")));
        assert_eq!(load(&q.dir, 1).unwrap().unwrap().planner_error.as_deref(), Some("I couldn't find the declare tool."));
    }

    #[test]
    fn a_run_remembers_the_head_it_began_from() {
        let p = project("base");
        for a in [&["init", "-q"][..], &["config", "user.email", "t@t"], &["config", "user.name", "t"], &["config", "commit.gpgsign", "false"], &["add", "package.json"], &["commit", "-qm", "init"]] { gate::git(&p.repo, a).unwrap(); }
        begin_in(&p, &Source::Prompt { text: "do it".into() }, None).unwrap();
        let rec = load(&p.dir, 1).unwrap().unwrap();
        assert_eq!(rec.base_commit, Some(gate::git(&p.repo, &["rev-parse", "HEAD"]).unwrap()));
    }

    #[test]
    fn stopping_a_plan_puts_the_notes_back() {
        let p = project("cancel");
        note(&p, "Tasks/A.md", "x");
        begin_in(&p, &Source::Notes, None).unwrap();
        cancel_planning_in(&p, 1).unwrap();
        assert_eq!(load(&p.dir, 1).unwrap().unwrap().state, RunState::Stopped);
        assert!(crate::notes::rounds::load(&p.dir).unwrap().is_empty());
        assert!(std::fs::read_to_string(p.dir.join(".chronicle/notes/Tasks/A.md")).unwrap().contains("status: queued"));
    }

    #[test]
    fn a_run_nobody_is_driving_reads_as_interrupted() {
        let p = project("recover");
        let mut r = RunRecord::new(7, RunKind::Prompt, Some(7), "p", "q", "x");
        r.state = RunState::Gating;
        save(&p.dir, &mut r).unwrap();
        let marked = std::cell::RefCell::new(vec![]);
        let out = recover_in(&p.dir, &|_| false, &|r| marked.borrow_mut().push(r.n));
        assert_eq!(out[0].state, RunState::Interrupted);
        assert_eq!(out[0].interrupted_from, Some(RunState::Gating));
        assert_eq!(recover_in(&p.dir, &|_| true, &|r| marked.borrow_mut().push(r.n))[0].state, RunState::Interrupted, "an interrupted run stays so until Resume");
        assert_eq!(*marked.borrow(), vec![7], "the record it marked is published, once");
    }

    #[test]
    fn a_plan_being_written_this_session_is_live_and_one_from_before_a_restart_is_not() {
        let p = project("planning-live");
        note(&p, "Tasks/A.md", "x");
        let runs = Runs::new();
        begin_with(&runs, &p, &Source::Notes, None).unwrap();
        assert_eq!(recover_in(&p.dir, &|n| is_live(&runs, &p.dir, n), &|_| {})[0].state, RunState::Planning, "the chat lane is writing it");
        let after_restart = Runs::new();
        assert_eq!(recover_in(&p.dir, &|n| is_live(&after_restart, &p.dir, n), &|_| {})[0].state, RunState::Interrupted);
    }

    #[test]
    fn needs_you_actions_skip_rewrite_retry_recheck_and_dismiss() {
        let p = project("needs");
        note(&p, "Tasks/A.md", "x");
        crate::notes::rounds::save(&p.dir, &[crate::notes::rounds::Round { n: 2, state: "ready".into(), kind: None, task_ids: vec![],
            note_paths: vec!["Tasks/A.md".into()], created_at: 0, plan_path: String::new(), prompt_path: String::new() }]).unwrap();
        let mut r = RunRecord::new(2, RunKind::Notes, Some(2), "p", "q", "");
        r.lane_map = Some(one_lane(Some("Tasks/A.md")));
        r.lanes = vec![LaneRecord::new("a")];
        r.lanes[0].state = LaneState::Closed;
        r.state = RunState::NeedsYou;
        r.needs_you.push(NeedsYou { kind: "parked".into(), lane: Some("a".into()), item: Some("T-1".into()), reason: "no".into(), reading: Some(0.86) });
        let mut skip = r.clone();
        apply_needs_you(&p.dir, &mut skip, &NeedsAct::Skip { item: "T-1".into() }).unwrap();
        assert!(skip.needs_you.is_empty() && skip.skipped == vec!["T-1"]);
        assert_eq!(skip.state, RunState::Running, "nothing holds the run any more");
        assert!(crate::notes::rounds::load(&p.dir).unwrap()[0].note_paths.is_empty(), "the skipped note leaves the round and unlocks");
        let mut rw = r.clone();
        apply_needs_you(&p.dir, &mut rw, &NeedsAct::Rewrite { item: "T-1".into(), text: "Do it from the pane".into() }).unwrap();
        let map = rw.lane_map.unwrap();
        assert_eq!(map.lanes[1].id, "b");
        assert_eq!(map.lanes[1].owns, vec!["src/lib/**"]);
        assert_eq!(map.lanes[1].depends_on, vec!["a"]);
        assert_eq!(map.items[0].rewrite.as_deref(), Some("Do it from the pane"));
        assert_eq!(rw.lanes[1].state, LaneState::Waiting);
        assert!(apply_needs_you(&p.dir, &mut r.clone(), &NeedsAct::Rewrite { item: "T-1".into(), text: " ".into() }).is_err());
        let mut ex = r.clone();
        ex.needs_you = vec![NeedsYou { kind: "exhausted".into(), lane: Some("a".into()), item: None, reason: "three tries".into(), reading: None }];
        ex.lanes[0].state = LaneState::Parked;
        ex.lanes[0].attempt = 3;
        apply_needs_you(&p.dir, &mut ex, &NeedsAct::Retry { lane: "a".into() }).unwrap();
        assert_eq!((ex.lanes[0].state, ex.lanes[0].attempt), (LaneState::Waiting, 0));
        let mut hd = r.clone();
        hd.needs_you = vec![NeedsYou { kind: "head".into(), lane: None, item: None, reason: "boom".into(), reading: None }];
        hd.head_check = Some(HeadCheck::default());
        apply_needs_you(&p.dir, &mut hd, &NeedsAct::Recheck).unwrap();
        assert!(hd.head_check.is_none() && hd.state == RunState::Running);
        let mut rf = r.clone();
        rf.needs_you.push(NeedsYou { kind: "refused".into(), lane: Some("a".into()), item: None, reason: "git push".into(), reading: None });
        assert!(apply_needs_you(&p.dir, &mut rf.clone(), &NeedsAct::Dismiss { index: 0 }).is_err(), "only a refused row can be dismissed");
        apply_needs_you(&p.dir, &mut rf, &NeedsAct::Dismiss { index: 1 }).unwrap();
        assert_eq!(rf.needs_you.len(), 1);
    }

    #[test]
    fn retrying_a_lane_through_its_row_unparks_the_lane_that_waited_on_it() {
        use crate::runs::runner::testkit::*;
        let r = repo("cmds-retry", 31);
        let mut rec = two_lanes(31, &[], &[]);
        if let Some(m) = rec.lane_map.as_mut() { m.lanes[1].depends_on = vec!["a".into()]; }
        let a = rec.lane_mut("a").unwrap();
        a.state = LaneState::Failed;
        a.attempt = scheduler::MAX_ATTEMPTS;
        let host = FakeHost::new(Box::new(|lane, _| vec![(format!("{lane}/work.txt"), lane.to_string(), true)]));
        let mut k = kit(&r, rec, vec![], host);
        runner::spawn(k.ctl.clone(), k.rx.take().unwrap(), vec![]);
        wait_until(&k.ctl, 20, |x| x.state == RunState::NeedsYou && x.lane("b").map(|b| b.state) == Some(LaneState::Parked));
        // what `run_needs_you` does with the user's Retry on a's row
        let mut result = Ok(());
        k.ctl.update(|rec| { result = apply_needs_you(&r, rec, &NeedsAct::Retry { lane: "a".into() }); });
        result.unwrap();
        k.ctl.tx.send(runner::Ev::Kick).unwrap();
        let done = wait_until(&k.ctl, 60, |x| x.state.terminal());
        assert_eq!(done.state, RunState::Done, "{done:#?}");
        assert!(done.lanes.iter().all(|l| l.state == LaneState::Closed));
        assert!(done.needs_you.is_empty(), "b's row went with its park");
    }

    #[test]
    fn a_failed_plan_run_hands_its_round_back_with_its_notes_untouched() {
        let p = project("plan-fail");
        note(&p, "Tasks/A.md", "x");
        crate::notes::rounds::set_status(&p.dir, "Tasks/A.md", Some("done"), Some(4)).unwrap();
        crate::notes::rounds::save(&p.dir, &[crate::notes::rounds::Round { n: 4, state: "done".into(), kind: None, task_ids: vec![],
            note_paths: vec!["Tasks/A.md".into()], created_at: 0, plan_path: "fixes/phase_4_fixes_plan.md".into(), prompt_path: "fixes/phase_4_fixes_prompt.md".into() }]).unwrap();
        std::fs::write(p.dir.join("fixes/phase_4_fixes_plan.md"), "Round kind: bug fixes\n\n- I-1 do a\n").unwrap();
        begin_in(&p, &Source::Plan { path: "fixes/phase_4_fixes_plan.md".into() }, None).unwrap();
        for _ in 0..2 { assert!(matches!(settle_in(&p, 4, 0.0).unwrap(), Settle::Retry(_))); }
        assert!(matches!(settle_in(&p, 4, 0.0).unwrap(), Settle::Failed(_)));
        let round = crate::notes::rounds::load(&p.dir).unwrap().into_iter().find(|r| r.n == 4).unwrap();
        assert_eq!((round.state.as_str(), round.note_paths.len()), ("ready", 1));
        let text = std::fs::read_to_string(p.dir.join(".chronicle/notes/Tasks/A.md")).unwrap();
        assert!(text.contains("status: done"), "a done note of the plan's round stays done: {text}");
    }

    #[test]
    fn stop_on_a_planning_run_cancels_the_chat_lanes_turn() {
        let p = project("stop-planner");
        assert_eq!(planner_key(&p.dir), p.dir.to_string_lossy(), "the chat lane keeps the historic key: the canonical project path");
        assert!(!cancel_planner_turn(&crate::acp::AcpState::new(), &p.dir), "no chat session: nothing to cancel, and no error");
    }

    #[test]
    fn a_failed_needs_you_action_keeps_its_row_and_changes_nothing() {
        let p = project("needs-fail");
        let mut r = RunRecord::new(2, RunKind::Notes, Some(2), "p", "q", "");
        r.lane_map = Some(one_lane(Some("Tasks/missing.md")));
        r.lanes = vec![LaneRecord::new("a")];
        r.state = RunState::NeedsYou;
        r.needs_you.push(NeedsYou { kind: "parked".into(), lane: Some("a".into()), item: Some("T-1".into()), reason: "no".into(), reading: None });
        r.needs_you.push(NeedsYou { kind: "exhausted".into(), lane: Some("z".into()), item: None, reason: "gone".into(), reading: None });
        let before = serde_json::to_value(&r).unwrap();
        assert!(apply_needs_you(&p.dir, &mut r, &NeedsAct::Skip { item: "T-1".into() }).is_err(), "the note can't be put back");
        assert!(apply_needs_you(&p.dir, &mut r, &NeedsAct::Retry { lane: "z".into() }).unwrap_err().contains("no lane z"));
        assert_eq!(serde_json::to_value(&r).unwrap(), before);
    }

    #[test]
    fn a_refused_row_on_a_run_nobody_drives_can_be_dismissed_and_nothing_else() {
        let p = project("needs-planning");
        let mut r = RunRecord::new(3, RunKind::Prompt, Some(3), "p", "q", "x");
        r.needs_you.push(NeedsYou { kind: "refused".into(), lane: None, item: None, reason: "git push".into(), reading: None });
        r.needs_you.push(NeedsYou { kind: "parked".into(), lane: Some("a".into()), item: Some("T-1".into()), reason: "no".into(), reading: None });
        save(&p.dir, &mut r).unwrap();
        assert_eq!(needs_you_on_record(&p.dir, 3, &NeedsAct::Skip { item: "T-1".into() }).unwrap_err(), "Round 3 is still being planned.");
        let out = needs_you_on_record(&p.dir, 3, &NeedsAct::Dismiss { index: 0 }).unwrap();
        assert_eq!(out.needs_you.len(), 1);
        assert_eq!(load(&p.dir, 3).unwrap().unwrap().needs_you.len(), 1, "saved");
        let mut i = load(&p.dir, 3).unwrap().unwrap();
        i.state = RunState::Interrupted;
        save(&p.dir, &mut i).unwrap();
        assert_eq!(needs_you_on_record(&p.dir, 3, &NeedsAct::Recheck).unwrap_err(), "Resume the run first.");
    }

    #[test]
    fn a_second_begin_while_the_first_is_under_way_is_refused() {
        let p = project("begin-twice");
        note(&p, "Tasks/A.md", "x");
        let runs = Runs::new();
        let first = runs.hold(&p.dir).unwrap();
        let e = begin_with(&runs, &p, &Source::Notes, None).unwrap_err();
        assert_eq!(e, "Chronicle is already starting a round in this project. Wait a moment, then try again.");
        assert!(crate::notes::rounds::load(&p.dir).unwrap().is_empty(), "the refused begin froze nothing");
        drop(first);
        assert!(begin_with(&runs, &p, &Source::Notes, None).is_ok(), "the hold goes with the first begin");
        assert!(runs.hold(&p.dir).is_ok(), "and with the second");
    }

    #[test]
    fn the_sizing_table_names_files_and_the_items_that_share_them() {
        let t = sizing_table(&[("T-1".into(), "Fix src/lib/a.ts".into()), ("T-2".into(), "Touch src/lib/a.ts and src/index.css".into()), ("T-3".into(), "Docs only".into())]);
        assert!(t.contains("T-1: src/lib/a.ts"));
        assert!(t.contains("T-2: src/index.css, src/lib/a.ts"));
        assert!(t.contains("T-3: (no files named)"));
        assert!(t.contains("T-1 and T-2 share src/lib/a.ts"));
    }

    #[test]
    fn sources_and_actions_read_as_the_frontend_sends_them() {
        assert!(matches!(serde_json::from_value::<Source>(json!({ "kind": "notes" })).unwrap(), Source::Notes));
        assert!(matches!(serde_json::from_value::<Source>(json!({ "kind": "plan", "path": "fixes/phase_4_fixes_plan.md" })).unwrap(), Source::Plan { .. }));
        assert!(matches!(serde_json::from_value::<NeedsAct>(json!({ "kind": "rewrite", "item": "T-1", "text": "x" })).unwrap(), NeedsAct::Rewrite { .. }));
        assert!(matches!(serde_json::from_value::<NeedsAct>(json!({ "kind": "recheck" })).unwrap(), NeedsAct::Recheck));
    }
}
