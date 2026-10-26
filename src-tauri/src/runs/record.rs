//! `.chronicle/runs/<n>.json` — one run: a plan executed as lanes (spec §3).
//! Rust is the only writer. The two rules of rounds.rs hold here too: a file we
//! cannot parse is never written over, and nothing here can strand a note locked.
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum RunKind { Notes, Plan, Prompt }

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum RunState { Planning, Running, Gating, Closing, Done, NeedsYou, Failed, Stopped, Interrupted }

impl RunState {
    pub fn terminal(self) -> bool { matches!(self, RunState::Done | RunState::Failed | RunState::Stopped) }
}

/// Symphony's attempt states (preparing … finishing, then the outcomes), plus
/// the gate's own: `finishing` is a turn that ended and waits for its gate.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LaneState {
    Waiting, Preparing, BuildingPrompt, Launching, Initialising, Streaming, Finishing, Gating, Fixing,
    Closed, Failed, TimedOut, Stalled, Cancelled, Parked,
}

impl LaneState {
    /// Holds a slot: a session is starting, working, or being checked.
    pub fn busy(self) -> bool {
        use LaneState::*;
        matches!(self, Preparing | BuildingPrompt | Launching | Initialising | Streaming | Finishing | Gating | Fixing)
    }
    /// An attempt ended badly and the next one waits for its backoff.
    pub fn between_tries(self) -> bool { matches!(self, LaneState::Failed | LaneState::TimedOut | LaneState::Stalled) }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
pub struct Item {
    pub id: String,
    pub title: String,
    /// the note this item came from (vault-relative), when the run is from notes
    #[serde(default, skip_serializing_if = "Option::is_none")] pub note: Option<String>,
    /// the user's rewrite after the item was parked (needs-you · Rewrite the item)
    #[serde(default, skip_serializing_if = "Option::is_none")] pub rewrite: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
pub struct LaneSpec {
    pub id: String,
    pub title: String,
    pub items: Vec<String>,
    pub owns: Vec<String>,
    #[serde(default)] pub depends_on: Vec<String>,
    #[serde(default)] pub checks: Vec<String>,
    /// USER DECISION 2026-10-22 ("stay one tree, worktree isolation opt-in per lane"): the default
    /// is the shared tree behind the fence; `"worktree"` gives this lane its own scratch worktree
    /// (under Application Support, like the gate's) and its commit is merged by Chronicle at the
    /// gate. Validation: a worktree lane may overlap another lane's `owns`; two shared-tree lanes
    /// may not. Lands with Task 2's schema so it is never retrofitted; the worktree *runtime* is a
    /// follow-up task after Task 9 (the controller), not this release unless time allows.
    #[serde(default, skip_serializing_if = "Option::is_none")] pub isolation: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
pub struct LaneMap {
    #[serde(default)] pub items: Vec<Item>,
    pub lanes: Vec<LaneSpec>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
pub struct Tokens { #[serde(rename = "in")] pub input: u64, pub out: u64 }

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
pub struct CheckResult {
    pub name: String,
    /// `None` when the check was killed or never started
    pub exit: Option<i32>,
    pub ms: u64,
    #[serde(default)] pub timed_out: bool,
    /// the last few KB of output — the fix prompt and the gate card show it
    #[serde(default)] pub tail: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
pub struct Finding { pub file: String, pub line: u32, pub what: String }

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
pub struct Review { pub model: String, pub pass: bool, #[serde(default)] pub findings: Vec<Finding> }

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
pub struct Gate {
    pub commit: String,
    pub checks: Vec<CheckResult>,
    #[serde(default)] pub review: Option<Review>,
    /// e.g. "the checks ran in your project while the lanes waited" (spec §11)
    #[serde(default)] pub notice: Option<String>,
    /// how many fix passes came before this gate in its attempt (0 = the first save)
    #[serde(default)] pub fix: u32,
}

impl Gate {
    /// Exit codes are law; the review only counts once they all pass.
    pub fn passed(&self) -> bool {
        self.checks.iter().all(|c| c.exit == Some(0)) && self.review.as_ref().map_or(true, |r| r.pass)
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Leak {
    pub path: String,
    /// the lane that owns the path (`None`: no lane does)
    #[serde(default)] pub owner: Option<String>,
    /// on the OWNER's row: the lane whose turn changed it
    #[serde(default)] pub by: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct LaneRecord {
    pub id: String,
    pub state: LaneState,
    pub attempt: u32,
    #[serde(default)] pub started: Option<String>,
    #[serde(default)] pub ended: Option<String>,
    #[serde(default)] pub cost_usd: f64,
    #[serde(default)] pub tokens: Tokens,
    #[serde(default)] pub commit: Option<String>,
    #[serde(default)] pub leak: Vec<Leak>,
    #[serde(default)] pub gates: Vec<Gate>,
    /// why the lane is parked (three tries, or fixes that never passed)
    #[serde(default)] pub parked: Option<String>,
    #[serde(default)] pub retry_at_ms: Option<u64>,
    /// the lane session's id — the lane view replays its transcript after a restart
    #[serde(default)] pub session: Option<String>,
    /// fix passes used in this attempt
    #[serde(default)] pub fixes: u32,
}

impl LaneRecord {
    pub fn new(id: &str) -> Self {
        LaneRecord { id: id.into(), state: LaneState::Waiting, attempt: 0, started: None, ended: None, cost_usd: 0.0,
            tokens: Tokens::default(), commit: None, leak: vec![], gates: vec![], parked: None, retry_at_ms: None, session: None, fixes: 0 }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
pub struct HeadCheck {
    pub commit: String,
    pub checks: Vec<CheckResult>,
    /// the lane triage reopened for its one fix pass
    #[serde(default)] pub reopened: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
pub struct DecisionLog {
    pub at: String,
    /// shell | block | triage | sizing | ask
    pub kind: String,
    pub model: String,
    pub choice: String,
    #[serde(default)] pub probabilities: BTreeMap<String, f32>,
    pub confidence: f32,
    /// act | second-opinion | strict
    pub band: String,
    pub action: String,
    #[serde(default)] pub self_reported: bool,
    #[serde(default)] pub lane: Option<String>,
    /// what was decided about: the command, the item, the failing check
    #[serde(default)] pub subject: String,
    /// the half-sentence the decision line ends with ("it reads only")
    #[serde(default)] pub reason: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct NeedsYou {
    /// parked | exhausted | head | refused
    pub kind: String,
    #[serde(default)] pub lane: Option<String>,
    #[serde(default)] pub item: Option<String>,
    pub reason: String,
    /// the judge's reading (yes-probability "impossible as written") for a parked item
    #[serde(default)] pub reading: Option<f32>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
pub struct Cost { pub usd: f64, #[serde(rename = "in")] pub input: u64, pub out: u64 }

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct RunRecord {
    pub n: u64,
    pub round: Option<u64>,
    pub kind: RunKind,
    pub state: RunState,
    pub created: String,
    pub updated: String,
    pub plan_path: String,
    pub prompt_path: String,
    /// the prompt text (prompt kind) or the plan path (plan kind)
    #[serde(default)] pub source: String,
    pub lane_map: Option<LaneMap>,
    pub lanes: Vec<LaneRecord>,
    pub head_check: Option<HeadCheck>,
    pub decisions: Vec<DecisionLog>,
    pub needs_you: Vec<NeedsYou>,
    pub cost: Cost,
    #[serde(default)] pub planner_tries: u32,
    #[serde(default)] pub planner_error: Option<String>,
    #[serde(default)] pub planner_cost_usd: f64,
    /// what the judge's and the reviewer's agent sessions cost, where the agent reports it
    #[serde(default)] pub judge_usd: f64,
    #[serde(default)] pub notices: Vec<String>,
    /// the lane count the sizing decision told the planner to aim for
    #[serde(default)] pub target_lanes: Option<u32>,
    #[serde(default)] pub interrupted_from: Option<RunState>,
    /// items the user skipped from needs-you; their notes went back to the queue
    #[serde(default)] pub skipped: Vec<String>,
    /// the check names the final check is running right now (the card lists them)
    #[serde(default)] pub head_pending: Vec<String>,
    /// the repo's HEAD when the run began: each lane's review reads its whole diff from here
    #[serde(default, skip_serializing_if = "Option::is_none")] pub base_commit: Option<String>,
}

pub fn can_move(from: RunState, to: RunState) -> bool {
    use RunState::*;
    if from == to { return true; }
    matches!((from, to),
        (Planning, Running | Failed | Stopped | Interrupted)
        | (Running, Gating | NeedsYou | Failed | Stopped | Interrupted)
        | (Gating, Closing | Running | NeedsYou | Stopped | Interrupted)
        | (Closing, Done | Interrupted)
        | (NeedsYou, Running | Gating | Closing | Stopped)
        | (Interrupted, Planning | Running | Gating | Closing | Stopped))
}

pub fn lane_can_move(from: LaneState, to: LaneState) -> bool {
    use LaneState::*;
    if from == to { return true; }
    if to == Cancelled { return from != Closed; }
    matches!((from, to),
        (Waiting, Preparing)
        | (Preparing, BuildingPrompt) | (BuildingPrompt, Launching) | (Launching, Initialising) | (Initialising, Streaming)
        | (Streaming, Finishing)
        | (Finishing, Gating) | (Finishing, Streaming)
        | (Gating, Closed | Fixing | Parked | Finishing)
        | (Fixing, Finishing)
        | (Preparing | BuildingPrompt | Launching | Initialising | Streaming | Finishing | Gating | Fixing, Failed | TimedOut | Stalled)
        | (Preparing | BuildingPrompt | Launching | Initialising | Streaming | Fixing, Waiting)
        | (Failed | TimedOut | Stalled, Preparing | Parked)
        | (Parked, Waiting) | (Waiting, Parked)
        | (Cancelled, Waiting)
        | (Closed, Fixing))
}

impl RunRecord {
    pub fn new(n: u64, kind: RunKind, round: Option<u64>, plan_path: &str, prompt_path: &str, source: &str) -> Self {
        let now = iso_now();
        RunRecord { n, round, kind, state: RunState::Planning, created: now.clone(), updated: now,
            plan_path: plan_path.into(), prompt_path: prompt_path.into(), source: source.into(),
            lane_map: None, lanes: vec![], head_check: None, decisions: vec![], needs_you: vec![], cost: Cost::default(),
            planner_tries: 0, planner_error: None, planner_cost_usd: 0.0, judge_usd: 0.0, notices: vec![], target_lanes: None,
            interrupted_from: None, skipped: vec![], head_pending: vec![], base_commit: None }
    }
    pub fn round_n(&self) -> u64 { self.round.unwrap_or(self.n) }
    pub fn set_state(&mut self, to: RunState) -> Result<(), String> {
        if !can_move(self.state, to) { return Err(format!("a run can't go from {:?} to {to:?}", self.state)); }
        self.state = to;
        Ok(())
    }
    pub fn lane(&self, id: &str) -> Option<&LaneRecord> { self.lanes.iter().find(|l| l.id == id) }
    pub fn lane_mut(&mut self, id: &str) -> Option<&mut LaneRecord> { self.lanes.iter_mut().find(|l| l.id == id) }
    pub fn set_lane_state(&mut self, id: &str, to: LaneState) -> Result<(), String> {
        let l = self.lane_mut(id).ok_or_else(|| format!("there's no lane {id}"))?;
        if !lane_can_move(l.state, to) { return Err(format!("lane {id} can't go from {:?} to {to:?}", l.state)); }
        if to == LaneState::Preparing { l.started = Some(iso_now()); l.ended = None; }
        if matches!(to, LaneState::Closed | LaneState::Parked | LaneState::Cancelled) { l.ended = Some(iso_now()); }
        l.state = to;
        Ok(())
    }
    pub fn total_cost(&self) -> Cost {
        Cost {
            usd: self.planner_cost_usd + self.judge_usd + self.lanes.iter().map(|l| l.cost_usd).sum::<f64>(),
            input: self.lanes.iter().map(|l| l.tokens.input).sum(),
            out: self.lanes.iter().map(|l| l.tokens.out).sum(),
        }
    }
}

/// What the round record says while its run is in a given state (spec §7:
/// "the round's state follows the run"). Live rounds lock their notes.
pub fn round_state_for(s: RunState) -> &'static str {
    match s {
        RunState::Planning => "generating",
        RunState::Done => "done",
        RunState::Failed | RunState::Stopped => "failed",
        _ => "ready",
    }
}

pub fn runs_dir(dir: &Path) -> PathBuf { dir.join(".chronicle/runs") }
pub fn path(dir: &Path, n: u64) -> PathBuf { runs_dir(dir).join(format!("{n}.json")) }

/// `Ok(None)`: no record. `Err`: a record we can't read — never overwritten.
pub fn load(dir: &Path, n: u64) -> Result<Option<RunRecord>, String> {
    let text = match std::fs::read_to_string(path(dir, n)) {
        Ok(t) => t,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(format!("couldn't read .chronicle/runs/{n}.json: {e}")),
    };
    if text.trim().is_empty() { return Ok(None); }
    serde_json::from_str(&text).map(Some)
        .map_err(|e| format!(".chronicle/runs/{n}.json can't be read ({e}) — fix or move that file, then try again"))
}

pub fn save(dir: &Path, rec: &mut RunRecord) -> Result<(), String> {
    load(dir, rec.n)?; // an unreadable file stays exactly as it is
    std::fs::create_dir_all(runs_dir(dir)).map_err(|e| e.to_string())?;
    rec.updated = iso_now();
    let body = serde_json::to_string_pretty(rec).map_err(|e| e.to_string())?;
    let p = path(dir, rec.n);
    let tmp = p.with_extension("json.tmp");
    std::fs::write(&tmp, body).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &p).map_err(|e| e.to_string())
}

/// Every readable record, oldest first. An unreadable one is skipped, not fatal.
pub fn list(dir: &Path) -> Vec<RunRecord> {
    let Ok(rd) = std::fs::read_dir(runs_dir(dir)) else { return vec![] };
    let mut out: Vec<RunRecord> = rd.filter_map(|e| e.ok())
        .filter_map(|e| e.file_name().to_str()?.strip_suffix(".json")?.parse::<u64>().ok())
        .filter_map(|n| load(dir, n).ok().flatten())
        .collect();
    out.sort_by_key(|r| r.n);
    out
}

pub fn is_live(dir: &Path, round: u64) -> bool {
    list(dir).iter().any(|r| r.round_n() == round && !r.state.terminal())
}

/// RFC 3339 UTC, to the second (Howard Hinnant's civil-from-days).
pub fn iso(ms: u64) -> String {
    let secs = ms / 1000;
    let days = (secs / 86_400) as i64;
    let rem = secs % 86_400;
    let (h, mi, s) = (rem / 3600, (rem % 3600) / 60, rem % 60);
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let mo = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + if mo <= 2 { 1 } else { 0 };
    format!("{y:04}-{mo:02}-{d:02}T{h:02}:{mi:02}:{s:02}Z")
}
pub fn iso_now() -> String { iso(crate::epoch_ms()) }

/// One journal line per transition the user would want to hear about (spec §8).
pub fn transition_lines(before: &RunRecord, after: &RunRecord) -> Vec<String> {
    let n = after.round_n();
    let mut out = vec![];
    if before.state != after.state {
        let ids: Vec<&str> = after.lane_map.as_ref().map(|m| m.items.iter().map(|i| i.id.as_str()).collect()).unwrap_or_default();
        let skipped = ids.iter().filter(|i| after.skipped.iter().any(|s| s == *i)).count();
        let done = ids.len() - skipped;
        let count = |n: usize, w: &str| format!("{n} {w}{}", if n == 1 { "" } else { "s" });
        match after.state {
            RunState::Running if before.state == RunState::Planning => out.push(format!("Round {n} started: {}.", count(after.lanes.len(), "lane"))),
            RunState::Gating => out.push(format!("Round {n}: every lane passed; checking the whole project.")),
            RunState::Done => out.push(format!("Round {n} is saved: {} done{}.", count(done, "item"),
                if skipped > 0 { format!(", {skipped} skipped") } else { String::new() })),
            RunState::NeedsYou => out.push(format!("Round {n} needs you.")),
            RunState::Stopped => out.push(format!("Round {n} was stopped.")),
            RunState::Failed => out.push(format!("Round {n} couldn't start: the plan couldn't be split into lanes.")),
            RunState::Interrupted => out.push(format!("Round {n} was interrupted.")),
            _ => {}
        }
    }
    for l in &after.lanes {
        let was = before.lane(&l.id).map(|b| b.state);
        if was == Some(l.state) { continue; }
        match l.state {
            LaneState::Closed => out.push(format!("Round {n} · lane {} finished.", l.id.to_uppercase())),
            LaneState::Parked => out.push(format!("Round {n} · lane {} needs you.", l.id.to_uppercase())),
            _ => {}
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("chronicle-run-{}-{}", name, std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(d.join(".chronicle")).unwrap();
        d.canonicalize().unwrap()
    }
    fn sample(n: u64) -> RunRecord {
        RunRecord::new(n, RunKind::Notes, Some(n), &format!("fixes/phase_{n}_fixes_plan.md"), &format!("fixes/phase_{n}_fixes_prompt.md"), "")
    }

    #[test]
    fn a_record_round_trips_in_the_spec_shape() {
        let d = tmp("io");
        assert!(load(&d, 10).unwrap().is_none(), "no file yet");
        let mut r = sample(10);
        save(&d, &mut r).unwrap();
        let v: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(path(&d, 10)).unwrap()).unwrap();
        for key in ["n", "round", "kind", "state", "created", "updated", "plan_path", "prompt_path", "lane_map", "lanes", "head_check", "decisions", "needs_you", "cost"] {
            assert!(v.get(key).is_some(), "{key} is in the record");
        }
        assert_eq!(v["kind"], "notes");
        assert_eq!(v["state"], "planning");
        assert_eq!(v["cost"], serde_json::json!({ "usd": 0.0, "in": 0, "out": 0 }));
        let back = load(&d, 10).unwrap().unwrap();
        assert_eq!(back.n, 10);
        assert_eq!(list(&d).len(), 1);
    }

    #[test]
    fn an_unreadable_record_is_never_written_over() {
        let d = tmp("corrupt");
        std::fs::create_dir_all(d.join(".chronicle/runs")).unwrap();
        std::fs::write(path(&d, 3), "{ not json").unwrap();
        assert!(load(&d, 3).is_err());
        assert!(save(&d, &mut sample(3)).is_err(), "refuses to overwrite");
        assert_eq!(std::fs::read_to_string(path(&d, 3)).unwrap(), "{ not json");
        assert!(list(&d).is_empty(), "the listing skips it rather than failing");
    }

    #[test]
    fn run_states_move_only_along_the_lifecycle() {
        use RunState::*;
        for (a, b) in [(Planning, Running), (Running, Gating), (Gating, Closing), (Closing, Done), (Running, NeedsYou),
                       (NeedsYou, Running), (Gating, Running), (Interrupted, Gating), (Planning, Failed), (Running, Stopped)] {
            assert!(can_move(a, b), "{a:?} → {b:?}");
        }
        for (a, b) in [(Done, Running), (Failed, Running), (Stopped, Running), (Planning, Closing), (Closing, Running)] {
            assert!(!can_move(a, b), "{a:?} ↛ {b:?}");
        }
        let mut r = sample(1);
        assert!(r.set_state(Closing).is_err());
        r.set_state(Running).unwrap();
        assert_eq!(r.state, Running);
        assert!(Done.terminal() && Failed.terminal() && Stopped.terminal() && !Interrupted.terminal());
    }

    #[test]
    fn lane_states_follow_the_attempt_machine() {
        use LaneState::*;
        let path = [Waiting, Preparing, BuildingPrompt, Launching, Initialising, Streaming, Finishing, Gating, Fixing, Finishing, Gating, Closed];
        for w in path.windows(2) { assert!(lane_can_move(w[0], w[1]), "{:?} → {:?}", w[0], w[1]); }
        for s in [Failed, TimedOut, Stalled] {
            assert!(lane_can_move(Streaming, s));
            assert!(lane_can_move(s, Preparing), "a retry");
            assert!(lane_can_move(s, Parked), "three tries, then parked");
        }
        assert!(lane_can_move(Closed, Fixing), "head triage reopens a closed lane");
        assert!(lane_can_move(Gating, Finishing), "resume re-gates");
        assert!(!lane_can_move(Closed, Cancelled), "a finished lane is never cancelled");
        assert!(!lane_can_move(Waiting, Streaming));
        let mut r = sample(1);
        r.lanes.push(LaneRecord::new("a"));
        r.set_lane_state("a", Preparing).unwrap();
        assert!(r.lane("a").unwrap().started.is_some());
        assert!(r.set_lane_state("a", Closed).is_err());
        assert!(Streaming.busy() && Gating.busy() && !Waiting.busy() && !Closed.busy());
        assert!(Stalled.between_tries() && !Parked.between_tries());
    }

    #[test]
    fn iso_dates_are_utc() {
        assert_eq!(iso(0), "1970-01-01T00:00:00Z");
        assert_eq!(iso(1_789_571_787_592), "2026-09-16T15:16:27Z");
        assert_eq!(iso(951_782_400_000), "2000-02-29T00:00:00Z");
    }

    #[test]
    fn transitions_become_journal_lines() {
        let mut a = sample(10);
        a.lane_map = Some(LaneMap { items: vec![Item { id: "T-1".into(), title: "x".into(), note: None, rewrite: None }; 7], lanes: vec![] });
        a.lanes = vec![LaneRecord::new("a"), LaneRecord::new("b")];
        let mut b = a.clone();
        b.state = RunState::Running;
        assert_eq!(transition_lines(&a, &b), vec!["Round 10 started: 2 lanes."]);
        let mut c = b.clone();
        c.lanes[1].state = LaneState::Closed;
        assert_eq!(transition_lines(&b, &c), vec!["Round 10 · lane B finished."]);
        let mut d = c.clone();
        d.state = RunState::Done;
        assert_eq!(transition_lines(&c, &d), vec!["Round 10 is saved: 7 items done."]);
        assert!(transition_lines(&d, &d).is_empty());
    }

    #[test]
    fn the_close_line_counts_only_what_was_done_and_says_what_was_skipped() {
        let item = |id: &str| Item { id: id.into(), title: "x".into(), note: None, rewrite: None };
        let mut a = sample(1);
        a.lane_map = Some(LaneMap { items: vec![item("T-1"), item("T-2"), item("T-3"), item("T-4")], lanes: vec![] });
        a.lanes = vec![LaneRecord::new("a")];
        a.state = RunState::Closing;
        let mut b = a.clone();
        b.state = RunState::Done;
        b.skipped = vec!["T-3".into(), "T-4".into()];
        assert_eq!(transition_lines(&a, &b), vec!["Round 1 is saved: 2 items done, 2 skipped."]);
        b.skipped = vec!["T-2".into(), "T-3".into(), "T-4".into()];
        assert_eq!(transition_lines(&a, &b), vec!["Round 1 is saved: 1 item done, 3 skipped."]);
        let mut p = a.clone();
        p.state = RunState::Planning;
        let mut r = a.clone();
        r.state = RunState::Running;
        assert_eq!(transition_lines(&p, &r), vec!["Round 1 started: 1 lane."]);
    }

    #[test]
    fn a_live_run_is_seen_by_round_number() {
        let d = tmp("live");
        let mut r = sample(4);
        save(&d, &mut r).unwrap();
        assert!(is_live(&d, 4));
        r.state = RunState::Done;
        save(&d, &mut r).unwrap();
        assert!(!is_live(&d, 4));
        assert!(!is_live(&d, 5));
    }

    #[test]
    fn the_frontend_fixture_is_a_record_rust_reads() {
        let text = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/../src/lib/__fixtures__/run-record.json")).unwrap();
        let r: RunRecord = serde_json::from_str(&text).expect("the TypeScript fixture and the Rust record are one shape");
        assert_eq!((r.n, r.state, r.lanes.len()), (10, RunState::Running, 4));
        assert_eq!(r.lane("c").unwrap().state, LaneState::Gating);
        assert!((r.total_cost().usd - 1.84).abs() < 1e-9, "the fixture's cost is what Rust would compute");
    }
}
