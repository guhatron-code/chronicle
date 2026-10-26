//! What a running run does next (spec §3), as a pure function of its record
//! and the clock — the controller performs what this returns. Symphony's
//! attempt machine: start a lane when its dependencies closed and a slot is
//! free; stall after five minutes without a wire message; back off
//! `min(10 s × 2^(n−1), 300 s)`; three attempts, then parked.
use super::record::{LaneRecord, LaneState, NeedsYou, RunRecord, RunState};
use std::collections::HashMap;

pub const MAX_ATTEMPTS: u32 = 3;
pub const MAX_FIX_PASSES: u32 = 2;
pub const STALL_MS: u64 = 300_000;

pub fn backoff_ms(attempt: u32) -> u64 {
    let a = attempt.clamp(1, 20);
    (10_000u64 << (a - 1)).min(300_000)
}

#[derive(Debug, PartialEq, Clone)]
pub enum Action { Start(String), Gate(String), Stall(String), Park { lane: String, reason: String }, HeadCheck, Close, NeedsYou }

pub struct Tick<'a> { pub now_ms: u64, pub last_wire: &'a HashMap<String, u64>, pub max_lanes: usize, pub main_tree: bool }

fn holds(n: &NeedsYou) -> bool { matches!(n.kind.as_str(), "parked" | "exhausted" | "head") }
pub fn blocking(rec: &RunRecord) -> usize { rec.needs_you.iter().filter(|n| holds(n)).count() }

pub fn next_actions(rec: &RunRecord, t: &Tick) -> Vec<Action> {
    use LaneState::*;
    if rec.state != RunState::Running { return vec![]; }
    let Some(map) = &rec.lane_map else { return vec![] };
    let state_of = |id: &str| rec.lane(id).map(|l| l.state);
    let mut out = vec![];
    let busy = rec.lanes.iter().filter(|l| l.state.busy()).count();
    let mut free = t.max_lanes.saturating_sub(busy);
    let working = rec.lanes.iter().any(|l| matches!(l.state, Preparing | BuildingPrompt | Launching | Initialising | Streaming | Fixing));
    let gating = rec.lanes.iter().any(|l| l.state == Gating);
    // checks running in the project itself: nothing new starts, and a gate waits for quiet
    let hold_starts = t.main_tree && rec.lanes.iter().any(|l| matches!(l.state, Finishing | Gating));
    for l in &rec.lanes {
        if matches!(l.state, Initialising | Streaming | Fixing) {
            let last = t.last_wire.get(&l.id).copied().unwrap_or(t.now_ms);
            if t.now_ms.saturating_sub(last) > STALL_MS { out.push(Action::Stall(l.id.clone())); }
        }
    }
    for l in &rec.lanes {
        let due = l.retry_at_ms.map(|at| at <= t.now_ms).unwrap_or(true);
        if l.state == Finishing && due && !(t.main_tree && (working || gating)) { out.push(Action::Gate(l.id.clone())); }
    }
    for l in &rec.lanes {
        if !l.state.between_tries() { continue; }
        if l.attempt >= MAX_ATTEMPTS {
            out.push(Action::Park { lane: l.id.clone(), reason: format!("Lane {} didn’t finish after three tries.", l.id.to_uppercase()) });
        } else if !hold_starts && free > 0 && l.retry_at_ms.map(|at| at <= t.now_ms).unwrap_or(true) {
            out.push(Action::Start(l.id.clone()));
            free -= 1;
        }
    }
    if !hold_starts {
        for spec in &map.lanes {
            if free == 0 { break; }
            if state_of(&spec.id) != Some(Waiting) { continue; }
            if spec.depends_on.iter().all(|d| state_of(d) == Some(Closed)) {
                out.push(Action::Start(spec.id.clone()));
                free -= 1;
            }
        }
    }
    let all_closed = !rec.lanes.is_empty() && rec.lanes.iter().all(|l| l.state == Closed);
    if all_closed && blocking(rec) == 0 && out.is_empty() { out.push(Action::HeadCheck); }
    let moving = rec.lanes.iter().any(|l: &LaneRecord| l.state.busy() || l.state.between_tries())
        || out.iter().any(|a| matches!(a, Action::Start(_) | Action::Park { .. } | Action::HeadCheck));
    if !moving && blocking(rec) > 0 { out.push(Action::NeedsYou); }
    out
}

/// An interrupted run, set back on its feet from what the record says
/// (spec §3, Resume). Closed lanes stay closed; a lane caught mid-gate is
/// re-gated on what it has (the save finds nothing new to commit); a turn cut
/// off mid-way starts again without spending an attempt.
pub fn resume(rec: &RunRecord) -> (RunRecord, Vec<Action>) {
    use LaneState::*;
    let mut r = rec.clone();
    let from = rec.interrupted_from.unwrap_or(RunState::Running);
    r.interrupted_from = None;
    for l in r.lanes.iter_mut() {
        l.state = match l.state {
            Finishing | Gating => Finishing,
            Preparing | BuildingPrompt | Launching | Initialising | Streaming | Fixing | Cancelled => Waiting,
            s => s,
        };
        if l.state == Waiting { l.retry_at_ms = None; }
    }
    match from {
        RunState::Planning => { r.state = RunState::Planning; (r, vec![]) }
        RunState::Gating => { r.state = RunState::Gating; (r, vec![Action::HeadCheck]) }
        RunState::Closing => { r.state = RunState::Closing; (r, vec![Action::Close]) }
        _ => { r.state = RunState::Running; (r, vec![]) }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::runs::record::{Gate, HeadCheck, LaneMap, LaneRecord, LaneSpec, LaneState, NeedsYou, RunKind};

    fn run(lanes: &[(&str, &[&str])]) -> RunRecord {
        let mut r = RunRecord::new(10, RunKind::Notes, Some(10), "p", "q", "");
        r.lane_map = Some(LaneMap { items: vec![], lanes: lanes.iter().map(|(id, deps)| LaneSpec {
            id: id.to_string(), title: id.to_string(), items: vec![], owns: vec![format!("{id}/**")],
            depends_on: deps.iter().map(|d| d.to_string()).collect(), checks: vec![], isolation: None }).collect() });
        r.lanes = lanes.iter().map(|(id, _)| LaneRecord::new(id)).collect();
        r.state = RunState::Running;
        r
    }
    fn set(r: &mut RunRecord, id: &str, s: LaneState) { r.lane_mut(id).unwrap().state = s; }
    fn tick(now: u64, wire: &HashMap<String, u64>) -> Tick<'_> { Tick { now_ms: now, last_wire: wire, max_lanes: 3, main_tree: false } }

    #[test]
    fn backoff_doubles_from_ten_seconds_to_a_five_minute_cap() {
        assert_eq!(backoff_ms(1), 10_000);
        assert_eq!(backoff_ms(2), 20_000);
        assert_eq!(backoff_ms(3), 40_000);
        assert_eq!(backoff_ms(6), 300_000);
        assert_eq!(backoff_ms(40), 300_000);
    }

    #[test]
    fn lanes_start_when_their_dependencies_closed_and_a_slot_is_free() {
        let w = HashMap::new();
        let mut r = run(&[("a", &[]), ("b", &[]), ("c", &[]), ("d", &[]), ("e", &["a"])]);
        assert_eq!(next_actions(&r, &tick(0, &w)), vec![Action::Start("a".into()), Action::Start("b".into()), Action::Start("c".into())], "three slots by default");
        for id in ["a", "b", "c"] { set(&mut r, id, LaneState::Streaming); }
        assert!(next_actions(&r, &tick(0, &w)).is_empty(), "every slot is busy");
        set(&mut r, "a", LaneState::Closed);
        assert_eq!(next_actions(&r, &tick(0, &w)), vec![Action::Start("d".into())], "d first: map order; e's dependency a has closed but only one slot is free");
    }

    #[test]
    fn a_lane_silent_for_five_minutes_is_stalled() {
        let mut r = run(&[("a", &[])]);
        set(&mut r, "a", LaneState::Streaming);
        let w = HashMap::from([("a".to_string(), 1_000u64)]);
        assert!(next_actions(&r, &tick(1_000 + STALL_MS, &w)).is_empty());
        assert_eq!(next_actions(&r, &tick(1_001 + STALL_MS, &w)), vec![Action::Stall("a".into())]);
    }

    #[test]
    fn a_failed_attempt_retries_after_its_backoff_and_parks_after_three() {
        let w = HashMap::new();
        let mut r = run(&[("a", &[])]);
        set(&mut r, "a", LaneState::Failed);
        r.lane_mut("a").unwrap().attempt = 1;
        r.lane_mut("a").unwrap().retry_at_ms = Some(10_000);
        assert!(next_actions(&r, &tick(9_999, &w)).is_empty());
        assert_eq!(next_actions(&r, &tick(10_000, &w)), vec![Action::Start("a".into())]);
        r.lane_mut("a").unwrap().attempt = 3;
        assert_eq!(next_actions(&r, &tick(10_000, &w)), vec![Action::Park { lane: "a".into(), reason: "Lane A didn’t finish after three tries.".into() }]);
    }

    #[test]
    fn a_finished_turn_is_gated_and_in_main_tree_mode_waits_for_quiet() {
        let w = HashMap::new();
        let mut r = run(&[("a", &[]), ("b", &[]), ("c", &[])]);
        set(&mut r, "a", LaneState::Finishing);
        set(&mut r, "b", LaneState::Streaming);
        assert_eq!(next_actions(&r, &tick(0, &w)), vec![Action::Gate("a".into()), Action::Start("c".into())]);
        let quiet = Tick { main_tree: true, ..tick(0, &w) };
        assert!(next_actions(&r, &quiet).is_empty(), "checks in the project wait for b's turn, and nothing new starts");
        set(&mut r, "b", LaneState::Finishing);
        assert_eq!(next_actions(&r, &quiet), vec![Action::Gate("a".into()), Action::Gate("b".into())]);
        r.lane_mut("a").unwrap().retry_at_ms = Some(5_000);
        assert_eq!(next_actions(&r, &tick(0, &w)), vec![Action::Gate("b".into()), Action::Start("c".into())], "a save that met a busy index waits its retry");
    }

    #[test]
    fn every_lane_closed_means_the_head_check_and_a_parked_item_means_needs_you() {
        let w = HashMap::new();
        let mut r = run(&[("a", &[]), ("b", &[])]);
        set(&mut r, "a", LaneState::Closed);
        set(&mut r, "b", LaneState::Closed);
        assert_eq!(next_actions(&r, &tick(0, &w)), vec![Action::HeadCheck]);
        r.needs_you.push(NeedsYou { kind: "refused".into(), lane: Some("a".into()), item: None, reason: "git push".into(), reading: None });
        assert_eq!(next_actions(&r, &tick(0, &w)), vec![Action::HeadCheck], "a refused publish never holds the run");
        r.needs_you.push(NeedsYou { kind: "parked".into(), lane: Some("b".into()), item: Some("T-147".into()), reason: "x".into(), reading: Some(0.86) });
        assert_eq!(next_actions(&r, &tick(0, &w)), vec![Action::NeedsYou]);
        assert_eq!(blocking(&r), 1);
    }

    #[test]
    fn a_lane_whose_dependency_is_parked_waits_and_the_run_needs_you() {
        let w = HashMap::new();
        let mut r = run(&[("a", &[]), ("b", &["a"])]);
        set(&mut r, "a", LaneState::Parked);
        r.needs_you.push(NeedsYou { kind: "exhausted".into(), lane: Some("a".into()), item: None, reason: "three tries".into(), reading: None });
        assert_eq!(next_actions(&r, &tick(0, &w)), vec![Action::NeedsYou]);
    }

    #[test]
    fn resume_from_gating_runs_the_head_check_again() {
        let mut r = run(&[("a", &[]), ("b", &[])]);
        set(&mut r, "a", LaneState::Closed);
        set(&mut r, "b", LaneState::Closed);
        r.head_check = Some(HeadCheck { commit: "abc".into(), checks: vec![], reopened: None });
        r.state = RunState::Interrupted;
        r.interrupted_from = Some(RunState::Gating);
        let (back, acts) = resume(&r);
        assert_eq!(back.state, RunState::Gating);
        assert_eq!(acts, vec![Action::HeadCheck]);
        assert_eq!(back.interrupted_from, None);
    }

    #[test]
    fn resume_rechecks_a_lane_caught_mid_gate() {
        let mut r = run(&[("a", &[]), ("b", &[]), ("c", &[])]);
        set(&mut r, "a", LaneState::Closed);
        set(&mut r, "b", LaneState::Gating);
        r.lane_mut("b").unwrap().commit = Some("b1".into());
        r.lane_mut("b").unwrap().gates.push(Gate { commit: "b1".into(), ..Default::default() });
        set(&mut r, "c", LaneState::Streaming);
        r.lane_mut("c").unwrap().attempt = 2;
        r.state = RunState::Interrupted;
        r.interrupted_from = Some(RunState::Running);
        let (back, acts) = resume(&r);
        assert_eq!(back.state, RunState::Running);
        assert_eq!(back.lane("a").unwrap().state, LaneState::Closed, "a closed lane stays closed");
        assert_eq!(back.lane("b").unwrap().state, LaneState::Finishing, "re-gated on the commit it has");
        assert_eq!(back.lane("c").unwrap().state, LaneState::Waiting, "a turn cut off mid-way starts again");
        assert_eq!(back.lane("c").unwrap().attempt, 2, "an interruption is not the lane's failure");
        assert!(acts.is_empty(), "the next tick gates b and starts c");
        let w = HashMap::new();
        assert_eq!(next_actions(&back, &tick(0, &w)), vec![Action::Gate("b".into()), Action::Start("c".into())]);
    }

    #[test]
    fn resume_from_closing_closes() {
        let mut r = run(&[("a", &[])]);
        set(&mut r, "a", LaneState::Closed);
        r.state = RunState::Interrupted;
        r.interrupted_from = Some(RunState::Closing);
        assert_eq!(resume(&r), ({ let mut b = r.clone(); b.state = RunState::Closing; b.interrupted_from = None; b }, vec![Action::Close]));
    }
}
