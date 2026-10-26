//! The run controller (spec §3, §5 amended): one thread per live run. It asks
//! the scheduler what to do, starts each lane as its own session through a
//! `LaneHost` (ACP in the app, a fake in tests), answers the lane's asks with
//! `RunPolicy`, gates each finished turn, runs the head check and triage, and
//! closes the round. Every record change goes through `update` — saved,
//! journalled, published — so Rust stays the only writer.
use super::checks::Check;
use super::fence::{tool_name, write_target, Fence, Verdict, PUBLISH_REFUSAL, WRITE_TOOLS};
use super::gate::{self, Saved};
use super::judge::{BlockOutcome, Judge, ShellAsk, TriageLane};
use super::lane_map;
use super::oracle::Fallback;
use super::prompts;
use super::record::*;
use super::review;
use super::scheduler::{self, Action, Tick, MAX_ATTEMPTS, MAX_FIX_PASSES};
use crate::acp::{LanePolicy, PolicyAnswer};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex, Weak};
use std::time::Duration;

/// How the controller reaches a lane's session. The contract: `start`, `prompt`
/// and `stop` (and `cancel`) return at once, without waiting for the session to
/// initialise or the turn to end — the event loop and the gate (holding the
/// gate lock) call them. Everything that happens afterwards comes back as `Ev`s
/// on `ctl.tx`.
pub trait LaneHost: Send + Sync {
    /// Start lane `lane`'s session. Its lifecycle comes back as `Ev`s on
    /// `ctl.tx`; `Ready` always arrives through the channel, never by a call.
    fn start(&self, ctl: &Arc<RunCtl>, lane: &str, k: u16, policy: Arc<dyn LanePolicy>) -> Result<(), String>;
    fn prompt(&self, ctl: &Arc<RunCtl>, lane: &str, k: u16, text: &str) -> Result<(), String>;
    fn cancel(&self, ctl: &Arc<RunCtl>, lane: &str, k: u16);
    fn stop(&self, ctl: &Arc<RunCtl>, lane: &str, k: u16);
}

#[derive(Debug, Clone, PartialEq)]
pub enum Ev {
    Ready { lane: String, session: String },
    Wire { lane: String },
    Usage { lane: String, usd: f64 },
    TurnEnd { lane: String, stop: Option<String>, error: bool },
    Died { lane: String, reason: String },
    Kick,
    Stop,
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum PromptKind { Work, Fix }

pub type Publish = Arc<dyn Fn(&Path, &RunRecord) + Send + Sync>;

fn now_ms() -> u64 { crate::epoch_ms() }
fn lk<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> { m.lock().unwrap_or_else(|e| e.into_inner()) }

/// The scheduler's own reading of a dependency that will never close.
fn dead(rec: &RunRecord, id: &str) -> bool {
    rec.lane(id).map_or(false, |l| {
        matches!(l.state, LaneState::Parked | LaneState::Cancelled) || (l.state.between_tries() && l.attempt >= MAX_ATTEMPTS)
    })
}
fn waited_on(dep: &str) -> String { format!("Lane {} did not finish.", dep.to_uppercase()) }

pub struct CtlParts {
    pub dir: PathBuf, pub repo: PathBuf, pub scratch: PathBuf, pub rec: RunRecord,
    pub checks: Vec<Check>, pub max_lanes: usize,
    /// decisions on the Decisions role; second opinions and lane questions on the review side
    pub judge: Judge,
    /// the review side (`oracle::for_project`'s second), shared with the judge
    pub reviewer: Arc<Fallback>,
    pub host: Arc<dyn LaneHost>, pub publish: Publish,
}

pub struct RunCtl {
    pub dir: PathBuf,
    pub repo: PathBuf,
    pub n: u64,
    pub scratch: PathBuf,
    pub checks: Vec<Check>,
    pub max_lanes: usize,
    pub judge: Judge,
    pub reviewer: Arc<Fallback>,
    pub tx: Sender<Ev>,
    host: Arc<dyn LaneHost>,
    publish: Publish,
    rec: Mutex<RunRecord>,
    /// one gate (or head check) at a time: one scratch copy holds one checkout
    gate_lock: Mutex<()>,
    main_tree: AtomicBool,
    stopping: AtomicBool,
    /// added to the wall clock — tests move time forward with `advance_clock`
    skew_ms: AtomicU64,
    last_wire: Mutex<HashMap<String, u64>>,
    tool_writes: Mutex<HashMap<String, HashSet<String>>>,
    snapshots: Mutex<HashMap<String, String>>,
    active: Mutex<HashMap<String, HashSet<String>>>,
    pending: Mutex<HashMap<String, (PromptKind, String)>>,
    cost_base: Mutex<HashMap<String, f64>>,
    nudges: Mutex<HashMap<String, Vec<String>>>,
    recent: Mutex<HashMap<String, Vec<String>>>,
}

impl RunCtl {
    pub fn new(p: CtlParts) -> (Arc<RunCtl>, Receiver<Ev>) {
        let (tx, rx) = std::sync::mpsc::channel();
        let ctl = Arc::new(RunCtl {
            n: p.rec.n, dir: p.dir, repo: p.repo, scratch: p.scratch, checks: p.checks, max_lanes: p.max_lanes,
            judge: p.judge, reviewer: p.reviewer, tx, host: p.host, publish: p.publish, rec: Mutex::new(p.rec),
            gate_lock: Mutex::new(()), main_tree: AtomicBool::new(false), stopping: AtomicBool::new(false), skew_ms: AtomicU64::new(0),
            last_wire: Default::default(), tool_writes: Default::default(), snapshots: Default::default(), active: Default::default(),
            pending: Default::default(), cost_base: Default::default(), nudges: Default::default(), recent: Default::default(),
        });
        (ctl, rx)
    }

    fn now(&self) -> u64 { now_ms() + self.skew_ms.load(Ordering::SeqCst) }
    #[cfg(test)]
    pub(crate) fn advance_clock(&self, ms: u64) { self.skew_ms.fetch_add(ms, Ordering::SeqCst); }

    pub fn snapshot(&self) -> RunRecord { lk(&self.rec).clone() }

    /// Every change to the record: applied, saved, journalled, published.
    pub fn update(&self, f: impl FnOnce(&mut RunRecord)) -> RunRecord {
        let mut g = lk(&self.rec);
        let before = g.clone();
        f(&mut g);
        g.cost = g.total_cost();
        if let Err(e) = save(&self.dir, &mut g) { eprintln!("run {}: couldn't save its record: {e}", self.n); }
        let after = g.clone();
        drop(g);
        for line in transition_lines(&before, &after) { crate::journal_append_in(&self.dir, "run", &line); }
        (self.publish)(&self.dir, &after);
        after
    }

    fn k_of(&self, lane: &str) -> u16 {
        lk(&self.rec).lane_map.as_ref().and_then(|m| m.lanes.iter().position(|l| l.id == lane)).unwrap_or(0) as u16
    }
    fn spec(&self, lane: &str) -> Option<LaneSpec> { lk(&self.rec).lane_map.as_ref()?.lanes.iter().find(|l| l.id == lane).cloned() }
    fn set_lane(&self, lane: &str, to: LaneState) { self.update(|r| { let _ = r.set_lane_state(lane, to); }); }

    fn tick(self: &Arc<Self>) -> bool {
        if self.snapshot().state.terminal() { return false; }
        self.unpark_dependents();
        let rec = self.snapshot();
        let wire = lk(&self.last_wire).clone();
        let t = Tick { now_ms: self.now(), last_wire: &wire, max_lanes: self.max_lanes, main_tree: self.main_tree.load(Ordering::SeqCst) };
        for a in scheduler::next_actions(&rec, &t) { self.perform(a); }
        true
    }

    /// A lane parked because a dependency would never finish goes back to
    /// waiting once that dependency is alive again (the user's Retry), and its
    /// needs-you row goes with the park.
    fn unpark_dependents(&self) {
        let rec = self.snapshot();
        if !matches!(rec.state, RunState::Running | RunState::NeedsYou) { return; }
        let Some(map) = rec.lane_map.as_ref() else { return };
        let back: Vec<(String, String)> = map.lanes.iter().filter_map(|s| {
            let l = rec.lane(&s.id).filter(|l| l.state == LaneState::Parked)?;
            let why = l.parked.clone()?;
            s.depends_on.iter().any(|d| waited_on(d) == why).then_some(())?;
            s.depends_on.iter().all(|d| !dead(&rec, d)).then(|| (s.id.clone(), why))
        }).collect();
        if back.is_empty() { return; }
        self.update(|r| {
            for (id, why) in &back {
                if r.set_lane_state(id, LaneState::Waiting).is_err() { continue; }
                if let Some(l) = r.lane_mut(id) { l.parked = None; l.ended = None; l.retry_at_ms = None; }
                r.needs_you.retain(|x| !(x.kind == "exhausted" && x.lane.as_deref() == Some(id.as_str()) && &x.reason == why));
            }
            if r.state == RunState::NeedsYou && scheduler::blocking(r) == 0 { let _ = r.set_state(RunState::Running); }
        });
    }

    fn perform(self: &Arc<Self>, a: Action) {
        match a {
            Action::Start(id) => self.start_lane(&id),
            Action::Gate(id) => {
                self.set_lane(&id, LaneState::Gating);
                let me = self.clone();
                std::thread::spawn(move || { me.gate(&id); let _ = me.tx.send(Ev::Kick); });
            }
            Action::Stall(id) => self.fail_lane(&id, LaneState::Stalled),
            Action::Park { lane, reason } => {
                self.update(|r| {
                    if r.set_lane_state(&lane, LaneState::Parked).is_err() { return; }
                    if let Some(l) = r.lane_mut(&lane) { l.parked = Some(reason.clone()); }
                    r.needs_you.push(NeedsYou { kind: "exhausted".into(), lane: Some(lane.clone()), item: None, reason, reading: None });
                });
            }
            Action::HeadCheck => {
                self.update(|r| { let _ = r.set_state(RunState::Gating); });
                let me = self.clone();
                std::thread::spawn(move || { me.head(); let _ = me.tx.send(Ev::Kick); });
            }
            Action::Close => {
                self.update(|r| { let _ = r.set_state(RunState::Closing); });
                let me = self.clone();
                std::thread::spawn(move || { me.close(); let _ = me.tx.send(Ev::Kick); });
            }
            Action::NeedsYou => { self.update(|r| { let _ = r.set_state(RunState::NeedsYou); }); }
        }
    }

    fn handle(self: &Arc<Self>, ev: Ev) {
        match ev {
            Ev::Wire { lane } => { lk(&self.last_wire).insert(lane, self.now()); }
            Ev::Usage { lane, usd } => {
                let base = lk(&self.cost_base).get(&lane).copied().unwrap_or(0.0);
                lk(&self.last_wire).insert(lane.clone(), self.now());
                self.update(|r| if let Some(l) = r.lane_mut(&lane) { l.cost_usd = base + usd; });
            }
            Ev::Ready { lane, session } => self.on_ready(&lane, session),
            Ev::TurnEnd { lane, stop, error } => self.on_turn_end(&lane, stop.as_deref(), error),
            Ev::Died { lane, .. } => {
                let working = self.snapshot().lane(&lane)
                    .map(|l| matches!(l.state, LaneState::Preparing | LaneState::BuildingPrompt | LaneState::Launching | LaneState::Initialising | LaneState::Streaming | LaneState::Fixing))
                    .unwrap_or(false);
                if working && !self.stopping.load(Ordering::SeqCst) { self.fail_lane(&lane, LaneState::Failed); }
            }
            Ev::Kick | Ev::Stop => {}
        }
    }

    fn start_lane(self: &Arc<Self>, id: &str) {
        let k = self.k_of(id);
        let retry = self.snapshot().lane(id).map(|l| l.state.between_tries()).unwrap_or(false);
        if retry { self.host.stop(self, id, k); }
        self.update(|r| {
            if let Some(l) = r.lane_mut(id) {
                l.attempt = if retry { l.attempt + 1 } else { l.attempt.max(1) };
                l.retry_at_ms = None;
                l.fixes = 0;
            }
            let _ = r.set_lane_state(id, LaneState::Preparing);
        });
        let policy: Arc<dyn LanePolicy> = Arc::new(RunPolicy::new(self, id));
        self.set_lane(id, LaneState::BuildingPrompt);
        let text = self.lane_prompt(id);
        lk(&self.pending).insert(id.to_string(), (PromptKind::Work, text));
        self.set_lane(id, LaneState::Launching);
        // the scheduler's contract: a launched lane's silence is measured from now
        lk(&self.last_wire).insert(id.to_string(), self.now());
        match self.host.start(self, id, k, policy) {
            Ok(()) => self.set_lane(id, LaneState::Initialising),
            Err(_) => self.fail_lane(id, LaneState::Failed),
        }
    }

    fn lane_prompt(&self, id: &str) -> String {
        let rec = self.snapshot();
        let map = rec.lane_map.clone().unwrap_or_default();
        let spec = map.lanes.iter().find(|l| l.id == id).cloned().unwrap_or_default();
        prompts::lane_prompt(rec.round_n(), &spec, &map.items, &rec.plan_path)
    }

    fn on_ready(self: &Arc<Self>, lane: &str, session: String) {
        let cost = self.snapshot().lane(lane).map(|l| l.cost_usd).unwrap_or(0.0);
        lk(&self.cost_base).insert(lane.to_string(), cost);
        self.update(|r| if let Some(l) = r.lane_mut(lane) { l.session = Some(session.clone()); });
        let next = lk(&self.pending).remove(lane);
        if let Some((kind, text)) = next { self.send_turn(lane, kind, &text); }
    }

    /// Snapshot the tree, note who else is working, then prompt the lane.
    fn send_turn(self: &Arc<Self>, lane: &str, kind: PromptKind, text: &str) {
        if let Ok(tree) = crate::acp::checkpoint::snapshot_tree_as(&self.repo, &format!("run-{}-{lane}", self.n)) {
            lk(&self.snapshots).insert(lane.to_string(), tree);
        }
        let others: HashSet<String> = self.snapshot().lanes.iter().filter(|l| l.id != lane && l.state.busy()).map(|l| l.id.clone()).collect();
        {
            let mut act = lk(&self.active);
            for o in &others { act.entry(o.clone()).or_default().insert(lane.to_string()); }
            act.insert(lane.to_string(), others);
        }
        lk(&self.last_wire).insert(lane.to_string(), self.now());
        self.set_lane(lane, if kind == PromptKind::Fix { LaneState::Fixing } else { LaneState::Streaming });
        if self.host.prompt(self, lane, self.k_of(lane), text).is_err() { self.fail_lane(lane, LaneState::Failed); }
    }

    fn on_turn_end(self: &Arc<Self>, lane: &str, stop: Option<&str>, error: bool) {
        if self.stopping.load(Ordering::SeqCst) { return; }
        let st = self.snapshot().lane(lane).map(|l| l.state);
        if !matches!(st, Some(LaneState::Streaming | LaneState::Fixing)) { return; }
        if error || stop == Some("cancelled") { return self.fail_lane(lane, LaneState::Failed); }
        self.set_lane(lane, LaneState::Finishing);
        let nudges = lk(&self.nudges).remove(lane).unwrap_or_default();
        if !nudges.is_empty() { self.send_turn(lane, PromptKind::Work, &prompts::nudge_prompt(&nudges)); }
    }

    fn fail_lane(self: &Arc<Self>, lane: &str, st: LaneState) {
        self.host.stop(self, lane, self.k_of(lane));
        lk(&self.pending).remove(lane);
        let now = self.now();
        self.update(|r| if r.set_lane_state(lane, st).is_ok() {
            if let Some(l) = r.lane_mut(lane) { l.retry_at_ms = Some(now + scheduler::backoff_ms(l.attempt)); }
        });
    }

    fn gate(self: &Arc<Self>, id: &str) {
        let _g = lk(&self.gate_lock);
        if self.stopping.load(Ordering::SeqCst) { return; }
        let rec = self.snapshot();
        let Some(map) = rec.lane_map.clone() else { return };
        let Some(spec) = map.lanes.iter().find(|l| l.id == id).cloned() else { return };
        let lane = rec.lane(id).cloned().unwrap_or_else(|| LaneRecord::new(id));
        // 1 · what the turn changed: the lane's own files, and leaks
        let from = lk(&self.snapshots).get(id).cloned();
        let to = crate::acp::checkpoint::snapshot_tree_as(&self.repo, &format!("run-{}-{id}", self.n)).ok();
        let changed = match (from, to) { (Some(f), Some(t)) => gate::changed_between(&self.repo, &f, &t), _ => gate::dirty_paths(&self.repo) };
        let active: Vec<String> = lk(&self.active).get(id).map(|s| s.iter().cloned().collect()).unwrap_or_default();
        let writes = lk(&self.tool_writes).clone();
        let (owned, leaks) = gate::split_changes(&changed, id, &map, &active, &writes);
        // 2 · save the lane's own files, by explicit path
        let titles: Vec<String> = spec.items.iter().map(|i| map.items.iter().find(|x| &x.id == i).map(|x| format!("{i}: {}", x.title)).unwrap_or_else(|| i.clone())).collect();
        let message = format!("{}\n\nRound {} · lane {}: {}\n\nChronicle-Run: {}/{}", spec.title, rec.round_n(), id.to_uppercase(), spec.items.join(", "), rec.n, id);
        let head = || gate::git(&self.repo, &["rev-parse", "HEAD"]).unwrap_or_default();
        let (commit, save_failure) = match gate::save_paths(&self.repo, &owned, &message) {
            Ok(Saved::Commit(c)) => (c, None),
            Ok(Saved::AlreadySaved(h)) => (lane.commit.clone().unwrap_or(h), None),
            Ok(Saved::Nothing) => (lane.commit.clone().unwrap_or_else(head), None),
            Err(e) if e.starts_with(gate::BUSY) => {
                // the index stayed busy: this gate runs again shortly, nothing lost
                let at = self.now() + 10_000;
                self.update(|r| { let _ = r.set_lane_state(id, LaneState::Finishing); if let Some(l) = r.lane_mut(id) { l.retry_at_ms = Some(at); } });
                return;
            }
            Err(e) => (lane.commit.clone().unwrap_or_else(head), Some(e)),
        };
        // 3 · the checks, in the scratch copy; 4 · the review, once they pass
        let checks: Vec<Check> = self.checks.iter().filter(|c| spec.checks.contains(&c.name)).cloned().collect();
        let mut checked = gate::run_checks_at(&self.repo, &self.scratch, &commit, &checks);
        if checked.main_tree { self.main_tree.store(true, Ordering::SeqCst); }
        if let Some(e) = save_failure { checked.results.insert(0, CheckResult { name: "save".into(), exit: Some(1), ms: 0, timed_out: false, tail: e }); }
        let review = checked.results.iter().all(|c| c.exit == Some(0))
            .then(|| review::review(&self.reviewer, &titles, &gate::diff_for(&self.repo, &commit), &checked.results));
        let notice = self.reviewer.take_notice();
        let g = Gate { commit: commit.clone(), checks: checked.results, review, notice: checked.notice, fix: lane.fixes };
        let passed = g.passed();
        let fixes = lane.fixes;
        // Stop may have come while the checks ran: the save and its gate are still recorded, the lane isn't moved
        let stopped = self.stopping.load(Ordering::SeqCst);
        self.update(|r| {
            if let Some(n) = notice { r.notices.push(n); }
            for leak in &leaks {
                if let Some(owner) = leak.owner.as_ref().filter(|o| o.as_str() != id) {
                    let mirrored = Leak { path: leak.path.clone(), owner: Some(owner.clone()), by: Some(id.to_string()) };
                    if let Some(o) = r.lane_mut(owner) { if !o.leak.contains(&mirrored) { o.leak.push(mirrored); } }
                }
            }
            if let Some(l) = r.lane_mut(id) {
                l.commit = Some(commit.clone());
                l.retry_at_ms = None;
                for leak in &leaks { if !l.leak.contains(leak) { l.leak.push(leak.clone()); } }
                l.gates.push(g.clone());
            }
            if stopped { return; }
            if passed { let _ = r.set_lane_state(id, LaneState::Closed); }
            else if fixes >= MAX_FIX_PASSES {
                let _ = r.set_lane_state(id, LaneState::Parked);
                if let Some(l) = r.lane_mut(id) { l.parked = Some("Its checks still failed after two fixes.".into()); }
                r.needs_you.push(NeedsYou { kind: "exhausted".into(), lane: Some(id.into()), item: None,
                    reason: format!("Lane {}’s checks still failed after two fixes.", id.to_uppercase()), reading: None });
            } else {
                if let Some(l) = r.lane_mut(id) { l.fixes += 1; }
                let _ = r.set_lane_state(id, LaneState::Fixing);
            }
        });
        if stopped { return; }
        if passed { self.host.stop(self, id, self.k_of(id)); }
        else if fixes < MAX_FIX_PASSES && !self.stopping.load(Ordering::SeqCst) {
            self.send_turn(id, PromptKind::Fix, &prompts::fix_prompt(fixes + 1, &g));
        }
    }

    fn head(self: &Arc<Self>) {
        let _g = lk(&self.gate_lock);
        if self.stopping.load(Ordering::SeqCst) { return; }
        let head = gate::git(&self.repo, &["rev-parse", "HEAD"]).unwrap_or_default();
        let names: Vec<String> = self.checks.iter().map(|c| c.name.clone()).collect();
        self.update(|r| r.head_pending = names);
        let checked = gate::run_checks_at(&self.repo, &self.scratch, &head, &self.checks);
        if checked.main_tree { self.main_tree.store(true, Ordering::SeqCst); }
        if self.stopping.load(Ordering::SeqCst) { return; }
        let ok = checked.results.iter().all(|c| c.exit == Some(0));
        let reopened = self.snapshot().head_check.and_then(|h| h.reopened);
        let results = checked.results.clone();
        self.update(|r| { r.head_pending.clear(); r.head_check = Some(HeadCheck { commit: head.clone(), checks: results, reopened: reopened.clone() }); });
        if ok {
            self.update(|r| { let _ = r.set_state(RunState::Closing); });
            return self.close();
        }
        let failing = prompts::failing_text(&checked.results);
        let needs = |why: &str| { self.update(|r| {
            r.needs_you.push(NeedsYou { kind: "head".into(), lane: None, item: None, reason: why.to_string(), reading: None });
            let _ = r.set_state(RunState::NeedsYou);
        }); };
        if reopened.is_some() { return needs(&failing); }
        let rec = self.snapshot();
        let map = rec.lane_map.clone().unwrap_or_default();
        let lanes: Vec<TriageLane> = map.lanes.iter().map(|s| TriageLane {
            id: s.id.clone(), title: s.title.clone(), items: s.items.clone(),
            files: rec.lane(&s.id).and_then(|l| l.commit.clone()).map(|c| gate::files_in(&self.repo, &c)).unwrap_or_default(),
        }).collect();
        let (pick, logs) = self.judge.triage(&failing, &lanes);
        let notice = self.judge.take_notice();
        self.update(|r| { r.decisions.extend(logs); r.notices.extend(notice); });
        let Some(lane) = pick else { return needs(&failing) };
        let fixes_before = rec.lane(&lane).map(|l| l.fixes).unwrap_or(0);
        self.update(|r| {
            if let Some(h) = r.head_check.as_mut() { h.reopened = Some(lane.clone()); }
            if let Some(l) = r.lane_mut(&lane) { l.fixes = MAX_FIX_PASSES; } // exactly one pass
            let _ = r.set_lane_state(&lane, LaneState::Fixing);
            let _ = r.set_state(RunState::Running);
        });
        lk(&self.pending).insert(lane.clone(), (PromptKind::Fix, prompts::head_fix_prompt(&failing)));
        lk(&self.last_wire).insert(lane.clone(), self.now());
        let policy: Arc<dyn LanePolicy> = Arc::new(RunPolicy::new(self, &lane));
        if self.host.start(self, &lane, self.k_of(&lane), policy).is_err() {
            lk(&self.pending).remove(&lane);
            // the lane's own save stands: back to closed, by the attempt machine's own steps (fixing → finishing → gating → closed)
            self.update(|r| {
                for to in [LaneState::Finishing, LaneState::Gating, LaneState::Closed] { let _ = r.set_lane_state(&lane, to); }
                if let Some(l) = r.lane_mut(&lane) { l.fixes = fixes_before; }
            });
            needs(&failing);
        }
    }

    fn close(self: &Arc<Self>) {
        let rec = self.snapshot();
        let round = rec.round_n();
        if let Some(map) = &rec.lane_map { flip_notes(&self.dir, round, map, &rec); }
        // a resume from `closing` may find the trailer already at HEAD: never a second one
        let closing = if gate::head_has_trailer(&self.repo, round) { Ok(String::new()) } else { gate::close_commit(&self.repo, round) };
        for l in &rec.lanes { self.host.stop(self, &l.id, self.k_of(&l.id)); }
        set_round_state(&self.dir, round, "done");
        self.update(|r| {
            if let Err(e) = &closing { r.notices.push(format!("The closing save didn’t happen ({e}); each lane’s own save is in place.")); }
            let _ = r.set_state(RunState::Done);
        });
    }

    /// The controller's owner let go of it: every working lane's session ends.
    fn release(self: &Arc<Self>) {
        for l in self.snapshot().lanes.iter().filter(|l| l.state.busy()) { self.host.stop(self, &l.id, self.k_of(&l.id)); }
    }

    /// Stop (spec §3): every lane's turn cancelled and its session ended.
    /// Nothing is reverted; Discard is per lane, on the user's click.
    pub fn stop_all(self: &Arc<Self>) {
        let rec = self.snapshot();
        // a closing run finishes its close; a finished one stays as it is
        if rec.state.terminal() || !can_move(rec.state, RunState::Stopped) { return; }
        self.stopping.store(true, Ordering::SeqCst);
        for l in &rec.lanes {
            if l.state.busy() || l.state.between_tries() {
                let k = self.k_of(&l.id);
                self.host.cancel(self, &l.id, k);
                self.host.stop(self, &l.id, k);
            }
        }
        let after = self.update(|r| {
            if r.set_state(RunState::Stopped).is_err() { return; }
            for l in r.lanes.iter_mut() {
                if l.state.busy() || l.state.between_tries() { l.state = LaneState::Cancelled; l.ended = Some(iso_now()); }
            }
        });
        if after.state == RunState::Stopped { set_round_state(&self.dir, rec.round_n(), "failed"); }
    }

    /// `chronicle_run_block` (spec §3, §6 decision 2).
    pub fn block(self: &Arc<Self>, lane: &str, item: &str, reason: &str) -> Result<String, String> {
        let rec = self.snapshot();
        let map = rec.lane_map.as_ref().ok_or("This round has no lanes yet.")?;
        let spec = map.lanes.iter().find(|l| l.id == lane).ok_or_else(|| format!("There's no lane {lane} in this round."))?;
        if !spec.items.iter().any(|i| i == item) {
            return Err(format!("Item {item} isn't one of lane {}'s items ({}).", lane.to_uppercase(), spec.items.join(", ")));
        }
        if rec.needs_you.iter().any(|x| x.kind == "parked" && x.item.as_deref() == Some(item)) {
            return Ok(format!("{item} is already parked for the user; carry on with your other items."));
        }
        let title = map.items.iter().find(|i| i.id == item).map(|i| i.title.clone()).unwrap_or_default();
        let excerpt = plan_excerpt(&self.dir.join(&rec.plan_path), item);
        let (outcome, logs) = self.judge.block(lane, &format!("{item}: {title}"), reason, &excerpt, &spec.owns);
        let notice = self.judge.take_notice();
        self.update(|r| { r.decisions.extend(logs); r.notices.extend(notice); });
        match outcome {
            BlockOutcome::Park { reading } => {
                self.update(|r| r.needs_you.push(NeedsYou { kind: "parked".into(), lane: Some(lane.into()), item: Some(item.into()), reason: reason.into(), reading }));
                Ok(format!("Accepted: leave {item} as it is and carry on with your other items. Chronicle shows it to the user."))
            }
            BlockOutcome::Retry { pushback } => Ok(format!("Not accepted yet: {pushback}")),
        }
    }

    /// `chronicle_run_ask`: the judge answers, never the user.
    pub fn ask(self: &Arc<Self>, lane: &str, question: &str) -> String {
        let spec = self.spec(lane).unwrap_or_default();
        let ctx = format!("Lane {}: {} — owns {}", lane.to_uppercase(), spec.title, spec.owns.join(", "));
        let (answer, logs) = self.judge.ask(lane, question, &ctx);
        let notice = self.judge.take_notice();
        self.update(|r| { r.decisions.extend(logs); r.notices.extend(notice); });
        answer
    }

    /// The lane view's composer: delivered when the lane's turn ends.
    pub fn nudge(&self, lane: &str, text: &str) -> Result<(), String> {
        let st = self.snapshot().lane(lane).map(|l| l.state).ok_or_else(|| format!("There's no lane {lane} in this round."))?;
        if !(st.busy() || st == LaneState::Waiting || st.between_tries()) {
            return Err(format!("Lane {} has finished; there's nothing to nudge.", lane.to_uppercase()));
        }
        lk(&self.nudges).entry(lane.to_string()).or_default().push(text.to_string());
        Ok(())
    }

    /// The lane's last two tool calls (what the judge is shown), then this one.
    fn remember(&self, lane: &str, call: &str) -> Vec<String> {
        let mut g = lk(&self.recent);
        let v = g.entry(lane.to_string()).or_default();
        let last = v.clone();
        v.push(call.to_string());
        if v.len() > 2 { v.remove(0); }
        last
    }

    fn note_write(&self, lane: &str, abs: &Path) {
        let (Some(c), Ok(root)) = (crate::acp::canonical_deep(abs), self.repo.canonicalize()) else { return };
        if let Ok(rel) = c.strip_prefix(&root) {
            lk(&self.tool_writes).entry(lane.to_string()).or_default().insert(rel.to_string_lossy().into_owned());
        }
    }
}

fn plan_excerpt(path: &Path, item: &str) -> String {
    let text = std::fs::read_to_string(path).unwrap_or_default();
    let lines: Vec<&str> = text.lines().collect();
    let start = lines.iter().position(|l| l.contains(item)).unwrap_or(0);
    let mut s = lines[start.min(lines.len())..lines.len().min(start + 30)].join("\n");
    if s.len() > 4000 { let mut e = 4000; while !s.is_char_boundary(e) { e -= 1; } s.truncate(e); }
    s
}

/// The run loop: events first, then one scheduler pass, until the record is
/// terminal, Stop arrives, or nobody but this loop holds the controller.
pub fn spawn(ctl: Arc<RunCtl>, rx: Receiver<Ev>, first: Vec<Action>) -> std::thread::JoinHandle<()> {
    std::thread::spawn(move || {
        for a in first { ctl.perform(a); }
        loop {
            match rx.recv_timeout(Duration::from_millis(500)) {
                Ok(Ev::Stop) => { ctl.stop_all(); return; }
                Ok(ev) => ctl.handle(ev),
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => return,
            }
            while let Ok(ev) = rx.try_recv() {
                if ev == Ev::Stop { ctl.stop_all(); return; }
                ctl.handle(ev);
            }
            // dropped by its owner (the registry, a test): sessions end, the record stays as it is, for resume
            if Arc::strong_count(&ctl) == 1 { ctl.release(); return; }
            if !ctl.tick() { return; }
        }
    })
}

pub fn set_round_state(dir: &Path, n: u64, state: &str) {
    let Ok(mut rounds) = crate::notes::rounds::load(dir) else { return };
    if let Some(r) = rounds.iter_mut().find(|r| r.n == n) {
        r.state = state.into();
        let _ = crate::notes::rounds::save(dir, &rounds);
    }
}

/// Closing (spec §3): Chronicle, not the agent, marks the notes done — every
/// item except one still parked or skipped by the user.
pub fn flip_notes(dir: &Path, round: u64, map: &LaneMap, rec: &RunRecord) {
    let parked: HashSet<&str> = rec.needs_you.iter().filter(|x| x.kind == "parked").filter_map(|x| x.item.as_deref()).collect();
    for item in &map.items {
        if parked.contains(item.id.as_str()) || rec.skipped.contains(&item.id) { continue; }
        if let Some(note) = &item.note { let _ = crate::notes::rounds::set_status(dir, note, Some("done"), Some(round)); }
    }
}

/// Chronicle answering a lane's asks (spec §4): the fence for writes, the git
/// guard, publish refused and shown, the judge for any other command.
pub struct RunPolicy { ctl: Weak<RunCtl>, lane: String, fence: Fence }

impl RunPolicy {
    pub fn new(ctl: &Arc<RunCtl>, lane: &str) -> Self {
        let map = ctl.snapshot().lane_map.unwrap_or_default();
        let owns = map.lanes.iter().find(|l| l.id == lane).map(|l| lane_map::compile(&l.owns)).unwrap_or_default();
        let others = map.lanes.iter().filter(|l| l.id != lane).map(|l| (l.id.clone(), lane_map::compile(&l.owns))).collect();
        RunPolicy { ctl: Arc::downgrade(ctl), lane: lane.into(), fence: Fence::Lane { repo: ctl.repo.clone(), lane: lane.into(), owns, others } }
    }
}

impl LanePolicy for RunPolicy {
    fn answer(&self, params: &Value) -> PolicyAnswer {
        let refuse = |path: String, reason: String| PolicyAnswer { allow: false, path, reason, decision: None };
        let Some(ctl) = self.ctl.upgrade() else { return refuse(String::new(), "The round is over.".into()) };
        let name = tool_name(params).unwrap_or("");
        let call = params.get("toolCall").cloned().unwrap_or(Value::Null);
        let summary = format!("{name} {}", call.pointer("/rawInput/command").or_else(|| call.pointer("/rawInput/file_path")).and_then(|v| v.as_str()).unwrap_or(""));
        let last = ctl.remember(&self.lane, summary.trim());
        match self.fence.verdict(params) {
            Verdict::Allow { what } => {
                let kind = call.get("kind").and_then(|v| v.as_str()).unwrap_or("");
                if WRITE_TOOLS.contains(&name) || matches!(kind, "edit" | "delete" | "move") { ctl.note_write(&self.lane, Path::new(write_target(&call))); }
                PolicyAnswer { allow: true, path: what, reason: String::new(), decision: None }
            }
            Verdict::Refuse { path, reason } => refuse(path, reason),
            Verdict::NotMine => refuse(String::new(), "Chronicle has no rule for that ask, so it wasn't used.".into()),
            Verdict::Publish { command } => {
                ctl.update(|r| r.needs_you.push(NeedsYou { kind: "refused".into(), lane: Some(self.lane.clone()), item: None, reason: command.clone(), reading: None }));
                refuse(command, PUBLISH_REFUSAL.into())
            }
            Verdict::Judge { command } => {
                let rec = ctl.snapshot();
                let map = rec.lane_map.clone().unwrap_or_default();
                let spec = map.lanes.iter().find(|l| l.id == self.lane).cloned().unwrap_or_default();
                let item = spec.items.first().and_then(|i| map.items.iter().find(|x| &x.id == i)).map(|x| format!("{}: {}", x.id, x.title)).unwrap_or_default();
                let (allow, reason, logs) = ctl.judge.shell(&ShellAsk { lane: &self.lane, command: &command, owns: &spec.owns, item: &item, last_calls: &last });
                let decision = logs.first().map(|l| json!({ "choice": l.choice, "confidence": l.confidence, "model": l.model, "band": l.band, "probabilities": l.probabilities }));
                let notice = ctl.judge.take_notice();
                ctl.update(|r| { r.decisions.extend(logs); r.notices.extend(notice); });
                PolicyAnswer { allow, path: command, reason, decision }
            }
        }
    }
    fn may_write(&self, abs: &Path) -> Result<(), String> {
        self.fence.may_write(abs)?;
        if let Some(ctl) = self.ctl.upgrade() { ctl.note_write(&self.lane, abs); }
        Ok(())
    }
}

#[cfg(test)]
pub(crate) mod testkit {
    use super::*;
    use crate::runs::oracle::fake::{fallback, FakeOracle};
    use crate::runs::oracle::{Fallback, REVIEW_FALLBACK};

    /// What a fake lane does when prompted: files it writes, and whether each
    /// went through a tool Chronicle allowed (true) or a shell command (false).
    pub(crate) type Work = Box<dyn Fn(&str, &str) -> Vec<(String, String, bool)> + Send + Sync>;

    pub(crate) struct FakeHost {
        work: Work,
        end_turns: bool,
        policies: Mutex<HashMap<String, Arc<dyn LanePolicy>>>,
        pub started: Mutex<Vec<String>>,
        pub stopped: Mutex<Vec<String>>,
        /// this many `start` calls fail before they succeed again
        pub fail_starts: std::sync::atomic::AtomicUsize,
    }
    impl FakeHost {
        fn with(work: Work, end_turns: bool) -> Arc<Self> {
            Arc::new(FakeHost { work, end_turns, policies: Default::default(), started: Default::default(), stopped: Default::default(), fail_starts: Default::default() })
        }
        pub fn new(work: Work) -> Arc<Self> { Self::with(work, true) }
        pub fn hanging(work: Work) -> Arc<Self> { Self::with(work, false) }
    }
    impl LaneHost for FakeHost {
        fn start(&self, ctl: &Arc<RunCtl>, lane: &str, _k: u16, policy: Arc<dyn LanePolicy>) -> Result<(), String> {
            let failing = self.fail_starts.fetch_update(Ordering::SeqCst, Ordering::SeqCst, |n| n.checked_sub(1)).is_ok();
            if failing { return Err("the agent couldn't start".into()); }
            lk(&self.started).push(lane.into());
            lk(&self.policies).insert(lane.into(), policy);
            let _ = ctl.tx.send(Ev::Ready { lane: lane.into(), session: format!("s-{lane}") });
            Ok(())
        }
        fn prompt(&self, ctl: &Arc<RunCtl>, lane: &str, _k: u16, text: &str) -> Result<(), String> {
            let policy = lk(&self.policies).get(lane).cloned();
            for (rel, body, via_tool) in (self.work)(lane, text) {
                let abs = ctl.repo.join(&rel);
                if via_tool && policy.as_ref().map(|p| p.may_write(&abs).is_err()).unwrap_or(true) { continue; }
                std::fs::create_dir_all(abs.parent().unwrap()).unwrap();
                std::fs::write(abs, body).unwrap();
            }
            if self.end_turns { let _ = ctl.tx.send(Ev::TurnEnd { lane: lane.into(), stop: Some("end_turn".into()), error: false }); }
            Ok(())
        }
        fn cancel(&self, _: &Arc<RunCtl>, _: &str, _: u16) {}
        fn stop(&self, _: &Arc<RunCtl>, lane: &str, _: u16) { lk(&self.stopped).push(lane.into()); }
    }

    /// A throwaway repository, `.chronicle/` ignored as the app's own, with round `n` ready.
    pub(crate) fn repo(name: &str, n: u64) -> PathBuf {
        let d = std::env::temp_dir().join(format!("chronicle-runner-{}-{}", name, std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        let d = d.canonicalize().unwrap();
        for a in [&["init", "-q"][..], &["config", "user.email", "t@t"], &["config", "user.name", "t"], &["config", "commit.gpgsign", "false"]] { gate::git(&d, a).unwrap(); }
        std::fs::write(d.join("README.md"), "toy\n").unwrap();
        std::fs::write(d.join(".gitignore"), ".chronicle/\n").unwrap();
        gate::git(&d, &["add", "README.md", ".gitignore"]).unwrap();
        gate::git(&d, &["commit", "-qm", "init"]).unwrap();
        crate::notes::rounds::save(&d, &[crate::notes::rounds::Round { n, state: "ready".into(), kind: None, task_ids: vec![], note_paths: vec![],
            created_at: 0, plan_path: format!("fixes/phase_{n}_fixes_plan.md"), prompt_path: format!("fixes/phase_{n}_fixes_prompt.md") }]).unwrap();
        d
    }

    /// Lanes a and b, owning a/** and b/**, with the checks each names.
    pub(crate) fn two_lanes(n: u64, checks_a: &[&str], checks_b: &[&str]) -> RunRecord {
        let mut r = RunRecord::new(n, RunKind::Prompt, Some(n), &format!("fixes/phase_{n}_fixes_plan.md"), &format!("fixes/phase_{n}_fixes_prompt.md"), "toy");
        let v = |xs: &[&str]| xs.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        r.lane_map = Some(LaneMap {
            items: vec![Item { id: "I-1".into(), title: "the a work".into(), note: None, rewrite: None }, Item { id: "I-2".into(), title: "the b work".into(), note: None, rewrite: None }],
            lanes: vec![
                LaneSpec { id: "a".into(), title: "Lane a work".into(), items: v(&["I-1"]), owns: v(&["a/**"]), depends_on: vec![], checks: v(checks_a), isolation: None },
                LaneSpec { id: "b".into(), title: "Lane b work".into(), items: v(&["I-2"]), owns: v(&["b/**"]), depends_on: vec![], checks: v(checks_b), isolation: None },
            ],
        });
        r.lanes = vec![LaneRecord::new("a"), LaneRecord::new("b")];
        r.state = RunState::Running;
        r
    }

    pub(crate) struct Kit { pub ctl: Arc<RunCtl>, pub rx: Option<Receiver<Ev>>, pub decide: Arc<FakeOracle>, pub published: Arc<Mutex<Vec<RunRecord>>> }

    pub(crate) fn kit(dir: &Path, rec: RunRecord, checks: Vec<Check>, host: Arc<dyn LaneHost>) -> Kit {
        let decide = FakeOracle::named("jev-1.13.0");
        let review = FakeOracle::named("review");
        for _ in 0..8 { review.complete_with(serde_json::json!({ "pass": true, "findings": [] })); }
        let published: Arc<Mutex<Vec<RunRecord>>> = Default::default();
        let sink = published.clone();
        // the review side is shared, as `oracle::for_project` shares it: the judge's second opinions and the reviewer
        let reviewer = Arc::new(Fallback::new(review.clone(), review, REVIEW_FALLBACK));
        let (ctl, rx) = RunCtl::new(CtlParts {
            dir: dir.to_path_buf(), repo: dir.to_path_buf(),
            scratch: std::env::temp_dir().join(format!("chronicle-runner-scratch-{}-{}", dir.file_name().unwrap().to_string_lossy(), std::process::id())),
            rec, checks, max_lanes: 3,
            judge: Judge::new(fallback(&decide, &FakeOracle::named("agent")), reviewer.clone()),
            reviewer,
            host, publish: Arc::new(move |_d: &Path, r: &RunRecord| lk(&sink).push(r.clone())),
        });
        Kit { ctl, rx: Some(rx), decide, published }
    }

    pub(crate) fn wait_until(ctl: &RunCtl, secs: u64, pred: impl Fn(&RunRecord) -> bool) -> RunRecord {
        let deadline = std::time::Instant::now() + Duration::from_secs(secs);
        loop {
            let r = ctl.snapshot();
            if pred(&r) { return r; }
            if std::time::Instant::now() > deadline { panic!("the run never got there: {r:#?}"); }
            std::thread::sleep(Duration::from_millis(50));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::testkit::*;
    use super::*;
    use crate::runs::oracle::fake::*;
    use serde_json::json;

    fn check(name: &str, command: &str) -> Check { Check { name: name.into(), command: command.into() } }

    #[test]
    fn two_lanes_run_gate_and_close_and_a_shell_leak_is_left_unsaved() {
        let r = repo("close", 10);
        let host = FakeHost::new(Box::new(|lane, _text| {
            let mut w = vec![(format!("{lane}/work.txt"), lane.to_string(), true)];
            if lane == "a" { w.push(("NOTES.txt".into(), "a shell wrote this".into(), false)); }
            w
        }));
        let mut k = kit(&r, two_lanes(10, &["test"], &["test"]), vec![check("test", "test -f README.md")], host);
        spawn(k.ctl.clone(), k.rx.take().unwrap(), vec![]);
        let done = wait_until(&k.ctl, 60, |x| x.state.terminal());
        assert_eq!(done.state, RunState::Done, "{:#?}", done);
        for id in ["a", "b"] {
            let l = done.lane(id).unwrap();
            assert_eq!(l.state, LaneState::Closed);
            assert!(l.commit.is_some());
            assert_eq!(l.gates.len(), 1);
            assert!(l.gates[0].passed());
        }
        assert_eq!(done.lane("a").unwrap().leak, vec![Leak { path: "NOTES.txt".into(), owner: None, by: None }], "b's own write while both worked is b's");
        assert!(done.lane("b").unwrap().leak.is_empty());
        let log = gate::git(&r, &["log", "--format=%s"]).unwrap();
        let subjects: Vec<&str> = log.lines().collect();
        assert_eq!(subjects[0], "Close FX-10");
        assert!(subjects.contains(&"Lane a work") && subjects.contains(&"Lane b work"), "{log}");
        assert_eq!(gate::git(&r, &["status", "--porcelain"]).unwrap(), "?? NOTES.txt", "the leak is left for the user, never committed or reverted");
        assert_eq!(crate::notes::rounds::load(&r).unwrap()[0].state, "done");
        let journal = std::fs::read_to_string(r.join(".chronicle/journal.jsonl")).unwrap();
        assert!(journal.contains("Round 10 · lane A finished.") && journal.contains("Round 10 is saved: 2 items done."), "{journal}");
        assert!(k.published.lock().unwrap().len() > 5, "every change was published");
    }

    #[test]
    fn a_failed_check_gets_a_fix_pass_with_its_output_and_then_closes() {
        let r = repo("fix", 11);
        let host = FakeHost::new(Box::new(|lane, text| {
            if lane == "b" && text.contains("fix 1 of 2") && text.contains("`fixed` failed") { vec![("b/fixed.txt".into(), "ok".into(), true)] }
            else { vec![(format!("{lane}/work.txt"), lane.to_string(), true)] }
        }));
        let mut k = kit(&r, two_lanes(11, &[], &["fixed"]), vec![check("fixed", "test -f b/fixed.txt")], host);
        spawn(k.ctl.clone(), k.rx.take().unwrap(), vec![]);
        let done = wait_until(&k.ctl, 60, |x| x.state.terminal());
        assert_eq!(done.state, RunState::Done);
        let b = done.lane("b").unwrap();
        assert_eq!(b.gates.len(), 2);
        assert!(!b.gates[0].passed());
        assert_eq!(b.gates[0].checks[0].exit, Some(1));
        assert_eq!(b.gates[1].fix, 1);
        assert!(b.gates[1].passed());
    }

    #[test]
    fn fixes_that_never_pass_park_the_lane_after_two() {
        let r = repo("park", 12);
        let host = FakeHost::new(Box::new(|lane, _| vec![(format!("{lane}/work.txt"), "x".into(), true)]));
        let mut k = kit(&r, two_lanes(12, &[], &["never"]), vec![check("never", "exit 1")], host);
        spawn(k.ctl.clone(), k.rx.take().unwrap(), vec![]);
        let done = wait_until(&k.ctl, 60, |x| x.state == RunState::NeedsYou);
        let b = done.lane("b").unwrap();
        assert_eq!(b.state, LaneState::Parked);
        assert_eq!(b.gates.len(), 3, "the save and two fix passes");
        assert_eq!(done.needs_you[0].kind, "exhausted");
        assert_eq!(done.lane("a").unwrap().state, LaneState::Closed);
        k.ctl.tx.send(Ev::Stop).unwrap();
    }

    #[test]
    fn stop_cancels_the_lanes_and_reverts_nothing() {
        let r = repo("stop", 13);
        let host = FakeHost::hanging(Box::new(|lane, _| vec![(format!("{lane}/half.txt"), "half done".into(), true)]));
        let mut k = kit(&r, two_lanes(13, &[], &[]), vec![], host.clone());
        spawn(k.ctl.clone(), k.rx.take().unwrap(), vec![]);
        wait_until(&k.ctl, 20, |x| x.lanes.iter().all(|l| l.state == LaneState::Streaming));
        k.ctl.tx.send(Ev::Stop).unwrap();
        let done = wait_until(&k.ctl, 20, |x| x.state.terminal());
        assert_eq!(done.state, RunState::Stopped);
        assert!(done.lanes.iter().all(|l| l.state == LaneState::Cancelled));
        assert!(r.join("a/half.txt").exists() && r.join("b/half.txt").exists(), "nothing is reverted");
        assert_eq!(crate::notes::rounds::load(&r).unwrap()[0].state, "failed", "the round's notes unlock");
        assert_eq!(host.stopped.lock().unwrap().len(), 2);
    }

    #[test]
    fn resuming_a_run_caught_in_its_final_check_saves_nothing_twice() {
        let r = repo("resume", 14);
        let mut rec = two_lanes(14, &[], &[]);
        for id in ["a", "b"] {
            std::fs::create_dir_all(r.join(id)).unwrap();
            std::fs::write(r.join(id).join("work.txt"), id).unwrap();
            let gate::Saved::Commit(c) = gate::save_paths(&r, &[format!("{id}/work.txt")], &format!("Lane {id} work")).unwrap() else { panic!() };
            let l = rec.lane_mut(id).unwrap();
            l.state = LaneState::Closed;
            l.commit = Some(c.clone());
            l.gates.push(Gate { commit: c, ..Default::default() });
        }
        rec.head_check = Some(HeadCheck { commit: "x".into(), checks: vec![], reopened: None });
        rec.state = RunState::Interrupted;
        rec.interrupted_from = Some(RunState::Gating);
        let before: u32 = gate::git(&r, &["rev-list", "--count", "HEAD"]).unwrap().parse().unwrap();
        let (back, first) = scheduler::resume(&rec);
        let host = FakeHost::new(Box::new(|_, _| vec![]));
        let mut k = kit(&r, back, vec![check("test", "test -f a/work.txt")], host.clone());
        spawn(k.ctl.clone(), k.rx.take().unwrap(), first);
        let done = wait_until(&k.ctl, 60, |x| x.state.terminal());
        assert_eq!(done.state, RunState::Done);
        let after: u32 = gate::git(&r, &["rev-list", "--count", "HEAD"]).unwrap().parse().unwrap();
        assert_eq!(after, before + 1, "only the close commit");
        assert!(host.started.lock().unwrap().is_empty(), "no lane was started again");
        assert_eq!(done.head_check.unwrap().checks[0].exit, Some(0), "the head check ran again");
    }

    #[test]
    fn a_block_claim_parks_its_item_and_the_round_waits_for_you() {
        let r = repo("block", 15);
        let host = FakeHost::new(Box::new(|lane, _| vec![(format!("{lane}/work.txt"), "x".into(), true)]));
        let mut k = kit(&r, two_lanes(15, &[], &[]), vec![], host);
        k.decide.decide_with(decision(vec![noul("impossible_as_written", 0.9)], "jev-1.13.0", false));
        k.decide.decide_with(decision(vec![noul("impossible_as_written", 0.1)], "jev-1.13.0", false));
        let said = k.ctl.block("a", "I-1", "the file it names doesn't exist").unwrap();
        assert!(said.starts_with("Accepted"), "{said}");
        assert!(k.ctl.block("a", "I-1", "still").unwrap().contains("already"), "a parked item isn't parked twice");
        assert!(k.ctl.block("b", "I-2", "hard").unwrap().starts_with("Not accepted yet"));
        assert!(k.ctl.block("a", "I-2", "x").is_err(), "a lane can only block its own items");
        spawn(k.ctl.clone(), k.rx.take().unwrap(), vec![]);
        let held = wait_until(&k.ctl, 60, |x| x.state == RunState::NeedsYou);
        let row = &held.needs_you[0];
        assert_eq!((row.kind.as_str(), row.lane.as_deref(), row.item.as_deref()), ("parked", Some("a"), Some("I-1")));
        assert_eq!(row.reading, Some(0.9));
        assert!(held.lanes.iter().all(|l| l.state == LaneState::Closed), "both lanes finished their other work");
        assert_eq!(held.decisions.iter().filter(|d| d.kind == "block").count(), 2);
        k.ctl.tx.send(Ev::Stop).unwrap();
    }

    #[test]
    fn the_lane_policy_refuses_a_publish_judges_a_command_and_fences_writes() {
        let r = repo("policy", 16);
        let k = kit(&r, two_lanes(16, &[], &[]), vec![], FakeHost::new(Box::new(|_, _| vec![])));
        let p = RunPolicy::new(&k.ctl, "a");
        let bash = |c: &str| json!({ "toolCall": { "toolCallId": "t", "name": "Bash", "kind": "execute", "rawInput": { "command": c } }, "options": [] });
        let a = p.answer(&bash("git push origin main"));
        assert!(!a.allow);
        assert_eq!(a.reason, crate::runs::fence::PUBLISH_REFUSAL);
        assert_eq!(k.ctl.snapshot().needs_you[0].kind, "refused");
        k.decide.decide_with(decision(vec![choice("action", "allow", &[("allow", 0.93)], 0.93), noul("writes_outside", 0.05)], "jev-1.13.0", false));
        let j = p.answer(&bash("npx vitest run src/lib"));
        assert!(j.allow);
        let d = j.decision.unwrap();
        assert_eq!(d["confidence"], json!(0.93f32));
        assert_eq!(d["probabilities"], json!({ "allow": 0.93f32 }), "the guard carries the reading (R13)");
        assert_eq!((d["choice"].as_str(), d["model"].as_str(), d["band"].as_str()), (Some("allow"), Some("jev-1.13.0"), Some("act")));
        assert_eq!(k.ctl.snapshot().decisions[0].subject, "npx vitest run src/lib");
        let w = |path: &Path| json!({ "toolCall": { "toolCallId": "w", "name": "Write", "kind": "edit", "rawInput": { "file_path": path.to_string_lossy() } }, "options": [] });
        assert!(p.answer(&w(&r.join("a/x.ts"))).allow);
        assert!(!p.answer(&w(&r.join("b/x.ts"))).allow);
        assert!(p.may_write(&r.join("b/y.ts")).is_err());
    }

    #[test]
    fn a_lane_that_never_speaks_stalls_after_five_minutes() {
        let r = repo("stall", 17);
        let host = FakeHost::hanging(Box::new(|_, _| vec![]));
        let mut k = kit(&r, two_lanes(17, &[], &[]), vec![], host.clone());
        spawn(k.ctl.clone(), k.rx.take().unwrap(), vec![]);
        wait_until(&k.ctl, 20, |x| x.lanes.iter().all(|l| l.state == LaneState::Streaming));
        // the launch seeded last_wire: a quiet minute is not a stall
        k.ctl.advance_clock(60_000);
        k.ctl.tx.send(Ev::Kick).unwrap();
        std::thread::sleep(Duration::from_millis(700));
        assert!(k.ctl.snapshot().lanes.iter().all(|l| l.state == LaneState::Streaming), "one minute without a word isn't a stall");
        // a wire message from b keeps it alive; a stays silent past five minutes
        // b's wire message lands first (no loop tick can fall into the gap), then the clock moves on
        let seen = lk(&k.ctl.last_wire).get("b").copied();
        k.ctl.advance_clock(scheduler::STALL_MS - 30_000);
        k.ctl.tx.send(Ev::Wire { lane: "b".into() }).unwrap();
        let deadline = std::time::Instant::now() + Duration::from_secs(10);
        while lk(&k.ctl.last_wire).get("b").copied() == seen { assert!(std::time::Instant::now() < deadline, "b's wire was never handled"); std::thread::sleep(Duration::from_millis(10)); }
        k.ctl.advance_clock(60_000);
        k.ctl.tx.send(Ev::Kick).unwrap();
        let stalled = wait_until(&k.ctl, 20, |x| x.lane("a").map(|l| l.state) == Some(LaneState::Stalled));
        let a = stalled.lane("a").unwrap();
        assert_eq!(a.attempt, 1);
        assert!(a.retry_at_ms.is_some(), "the next try waits for its backoff");
        assert_eq!(stalled.lane("b").unwrap().state, LaneState::Streaming, "b spoke a minute ago");
        assert!(host.stopped.lock().unwrap().contains(&"a".to_string()), "the stalled session is ended");
        k.ctl.tx.send(Ev::Stop).unwrap();
        wait_until(&k.ctl, 20, |x| x.state.terminal());
    }

    #[test]
    fn a_retried_lane_unparks_the_lane_that_waited_on_it() {
        let r = repo("unpark", 18);
        let mut rec = two_lanes(18, &[], &[]);
        if let Some(m) = rec.lane_map.as_mut() { m.lanes[1].depends_on = vec!["a".into()]; }
        // a used its three tries; b waits on it
        let a = rec.lane_mut("a").unwrap();
        a.state = LaneState::Failed;
        a.attempt = scheduler::MAX_ATTEMPTS;
        let host = FakeHost::new(Box::new(|lane, _| vec![(format!("{lane}/work.txt"), lane.to_string(), true)]));
        let mut k = kit(&r, rec, vec![], host);
        spawn(k.ctl.clone(), k.rx.take().unwrap(), vec![]);
        let held = wait_until(&k.ctl, 20, |x| x.state == RunState::NeedsYou);
        assert_eq!(held.lane("a").unwrap().state, LaneState::Parked);
        let b = held.lane("b").unwrap();
        assert_eq!((b.state, b.parked.as_deref()), (LaneState::Parked, Some("Lane A did not finish.")));
        assert!(held.needs_you.iter().any(|x| x.kind == "exhausted" && x.lane.as_deref() == Some("b") && x.reason == "Lane A did not finish."), "{:#?}", held.needs_you);
        // the user's Retry on a (what `commands::apply_needs_you` does), then a kick
        k.ctl.update(|r| {
            r.needs_you.retain(|x| x.lane.as_deref() != Some("a"));
            let l = r.lane_mut("a").unwrap();
            l.state = LaneState::Waiting;
            l.attempt = 0;
            l.parked = None;
        });
        k.ctl.tx.send(Ev::Kick).unwrap();
        let done = wait_until(&k.ctl, 60, |x| x.state.terminal());
        assert_eq!(done.state, RunState::Done, "{:#?}", done);
        assert!(done.lanes.iter().all(|l| l.state == LaneState::Closed));
        assert!(done.needs_you.is_empty(), "b's row went with its park");
        assert_eq!(done.lane("b").unwrap().parked, None);
    }

    /// Lanes a and b already closed with their own saves.
    fn closed_lanes(r: &Path, n: u64) -> RunRecord {
        let mut rec = two_lanes(n, &[], &[]);
        for id in ["a", "b"] {
            std::fs::create_dir_all(r.join(id)).unwrap();
            std::fs::write(r.join(id).join("work.txt"), id).unwrap();
            let gate::Saved::Commit(c) = gate::save_paths(r, &[format!("{id}/work.txt")], &format!("Lane {id} work")).unwrap() else { panic!() };
            let l = rec.lane_mut(id).unwrap();
            l.state = LaneState::Closed;
            l.commit = Some(c.clone());
            l.gates.push(Gate { commit: c, ..Default::default() });
        }
        rec
    }

    #[test]
    fn resuming_a_run_caught_closing_saves_nothing_twice() {
        let r = repo("closing", 19);
        let mut rec = closed_lanes(&r, 19);
        gate::close_commit(&r, 19).unwrap(); // the close commit landed; the record never heard
        rec.state = RunState::Interrupted;
        rec.interrupted_from = Some(RunState::Closing);
        let (back, first) = scheduler::resume(&rec);
        assert_eq!(first, vec![Action::Close]);
        let mut k = kit(&r, back, vec![], FakeHost::new(Box::new(|_, _| vec![])));
        spawn(k.ctl.clone(), k.rx.take().unwrap(), first);
        let done = wait_until(&k.ctl, 30, |x| x.state.terminal());
        assert_eq!(done.state, RunState::Done);
        let log = gate::git(&r, &["log", "--format=%s"]).unwrap();
        assert_eq!(log.lines().filter(|s| *s == "Close FX-19").count(), 1, "exactly one close commit: {log}");
        assert!(done.notices.is_empty(), "{:?}", done.notices);
        assert_eq!(crate::notes::rounds::load(&r).unwrap()[0].state, "done");
    }

    #[test]
    fn a_triage_lane_that_cannot_start_goes_back_to_closed_and_the_round_waits_for_you() {
        let r = repo("triage", 20);
        let mut rec = closed_lanes(&r, 20);
        rec.state = RunState::Interrupted;
        rec.interrupted_from = Some(RunState::Gating);
        let (back, first) = scheduler::resume(&rec);
        let host = FakeHost::new(Box::new(|_, _| vec![]));
        host.fail_starts.store(1, Ordering::SeqCst);
        let mut k = kit(&r, back, vec![check("whole", "exit 1")], host.clone());
        k.decide.decide_with(decision(vec![choice("lane", "a", &[("a", 0.9), ("b", 0.05), ("none", 0.05)], 0.9)], "jev-1.13.0", false));
        spawn(k.ctl.clone(), k.rx.take().unwrap(), first);
        let held = wait_until(&k.ctl, 30, |x| x.state == RunState::NeedsYou);
        let a = held.lane("a").unwrap();
        assert_eq!(a.state, LaneState::Closed, "not left fixing forever");
        assert_eq!(a.fixes, 0);
        assert_eq!(held.head_check.as_ref().unwrap().reopened.as_deref(), Some("a"));
        assert!(held.needs_you.iter().any(|x| x.kind == "head"), "{:#?}", held.needs_you);
        assert!(host.started.lock().unwrap().is_empty());
        k.ctl.tx.send(Ev::Stop).unwrap();
        wait_until(&k.ctl, 20, |x| x.state.terminal());
    }

    #[test]
    fn dropping_the_controller_ends_the_lane_sessions() {
        let r = repo("drop", 21);
        let host = FakeHost::hanging(Box::new(|_, _| vec![]));
        let mut k = kit(&r, two_lanes(21, &[], &[]), vec![], host.clone());
        let h = spawn(k.ctl.clone(), k.rx.take().unwrap(), vec![]);
        wait_until(&k.ctl, 20, |x| x.lanes.iter().all(|l| l.state == LaneState::Streaming));
        drop(k);
        h.join().unwrap();
        let mut stopped = host.stopped.lock().unwrap().clone();
        stopped.sort();
        assert_eq!(stopped, vec!["a", "b"], "both working sessions were ended");
        let rec = crate::runs::record::load(&r, 21).unwrap().unwrap();
        assert!(rec.lanes.iter().all(|l| l.state == LaneState::Streaming), "the record stays as it was, for resume");
    }

    #[test]
    fn stop_during_closing_leaves_a_done_round_done() {
        let r = repo("stopclose", 22);
        let mut rec = closed_lanes(&r, 22);
        rec.state = RunState::Closing;
        let k = kit(&r, rec, vec![], FakeHost::new(Box::new(|_, _| vec![])));
        k.ctl.stop_all();
        assert_eq!(k.ctl.snapshot().state, RunState::Closing, "a closing run can't be stopped");
        assert_eq!(crate::notes::rounds::load(&r).unwrap()[0].state, "ready", "the round isn't marked failed");
        assert!(k.ctl.snapshot().lanes.iter().all(|l| l.state == LaneState::Closed));
    }
}
