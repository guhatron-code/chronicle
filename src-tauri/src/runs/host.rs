//! The real `LaneHost`: each lane is an ACP session (`Lane::Worker`) on the
//! project's agent profile (agents spec §3, §12.7), carrying the lane's run
//! server and Chronicle's policy. Its acp-updates go to the pane as usual and
//! to the controller as `Ev`s. Plus the chat lane's screen: during a run, a
//! push, tag, publish or release from the chat session is refused and shown.
use super::fence::{classify, tool_name, write_target, Shell, GIT_REFUSAL, PUBLISH_REFUSAL, RUN_SERVER, WRITE_TOOLS};
use super::judge::{Judge, ShellAsk};
use super::record::{list, save, DecisionLog, NeedsYou, RunRecord, RunState};
use super::runner::{Ev, LaneHost, RunCtl};
use super::{tools, Runs};
use crate::acp::{self, AskScreen, LanePolicy, PolicyAnswer};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::Sender;
use std::sync::{Arc, Mutex, OnceLock};
use tauri::{Emitter, Manager};

pub fn lane_event(lane: &str, v: &Value) -> Ev {
    let m = &v["message"];
    let l = || lane.to_string();
    match m["method"].as_str().unwrap_or("") {
        "_chronicle/session_state" => match m["params"]["state"].as_str().unwrap_or("") {
            "ready" => Ev::Ready { lane: l(), session: m["params"]["sessionId"].as_str().unwrap_or("").to_string() },
            s @ ("error" | "ended" | "needs-login") => Ev::Died { lane: l(), reason: m["params"]["message"].as_str().map(String::from).unwrap_or_else(|| format!("the session is {s}")) },
            _ => Ev::Wire { lane: l() },
        },
        "_chronicle/turn_end" => Ev::TurnEnd { lane: l(), stop: m["params"]["stopReason"].as_str().map(String::from), error: !m["params"]["error"].is_null() },
        "session/update" if m["params"]["update"]["sessionUpdate"] == "usage_update" => match m["params"]["update"]["cost"]["amount"].as_f64() {
            Some(usd) => Ev::Usage { lane: l(), usd },
            None => Ev::Wire { lane: l() },
        },
        _ => Ev::Wire { lane: l() },
    }
}

/// What one session start says to the controller: its events, while it is the
/// lane's current session. Once the controller stops it (a passed gate, a
/// failed try, Stop), its late lines — the "ended" of its own shutdown, a
/// cancelled turn's end — would read as the lane's NEXT try dying, so they go
/// to the pane only.
fn forward(tx: Sender<Ev>, lane: String, current: Arc<AtomicBool>) -> impl Fn(&Value) + Send + Sync {
    let tx = Mutex::new(tx);
    move |v: &Value| { if let Ok(t) = tx.lock() { tell(&current, &t, lane_event(&lane, v)); } }
}

/// Every word from one session start to the controller — its wire, and the
/// host's own `Died` / failed-turn reports for it — goes through its flag.
fn tell(current: &AtomicBool, tx: &Sender<Ev>, ev: Ev) {
    if current.load(Ordering::SeqCst) { let _ = tx.send(ev); }
}

/// The app's lane host. `start`, `prompt` and `stop` return at once (the
/// `LaneHost` contract): the adapter's spawn, a session's shutdown (up to two
/// seconds of SIGTERM grace) and a prompt's checkpoint run on their own thread.
pub struct AcpHost {
    pub app: tauri::AppHandle,
    /// per session key: whether that key's session is still the one the controller started
    current: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

impl AcpHost {
    pub fn new(app: tauri::AppHandle) -> Self { AcpHost { app, current: Mutex::new(HashMap::new()) } }
    fn key(ctl: &RunCtl, k: u16) -> String { acp::Lane::Worker { run: ctl.n, k }.key(&ctl.dir.to_string_lossy()) }
    fn session(&self, ctl: &RunCtl, k: u16) -> Option<Arc<acp::AcpSession>> { self.app.state::<acp::AcpState>().get(&Self::key(ctl, k)) }
    fn flag(&self, key: &str) -> Option<Arc<AtomicBool>> {
        self.current.lock().unwrap_or_else(|e| e.into_inner()).get(key).cloned()
    }
    /// The key's current session stops speaking to the controller; a new start's flag, if any, replaces it.
    fn retire(&self, key: &str, next: Option<Arc<AtomicBool>>) {
        let mut g = self.current.lock().unwrap_or_else(|e| e.into_inner());
        let old = match next { Some(f) => g.insert(key.to_string(), f), None => g.remove(key) };
        if let Some(f) = old { f.store(false, Ordering::SeqCst); }
    }
}

impl LaneHost for AcpHost {
    fn start(&self, ctl: &Arc<RunCtl>, lane: &str, k: u16, policy: Arc<dyn LanePolicy>) -> Result<(), String> {
        let key = Self::key(ctl, k);
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let flag = Arc::new(AtomicBool::new(true));
        self.retire(&key, Some(flag.clone()));
        let old = self.session(ctl, k);
        let to_ctl = forward(ctl.tx.clone(), lane.to_string(), flag.clone());
        let app = self.app.clone();
        let emit: acp::Emit = Arc::new(move |v: Value| {
            to_ctl(&v);
            let _ = app.emit("acp-update", v);
        });
        let extras = acp::LaneExtras {
            mcp_servers: vec![tools::lane_server(&ctl.dir, &exe, ctl.n, lane)],
            policy: Some(acp::PolicyHandle(policy)),
            ..Default::default()
        };
        let (app, dir, n, tx, id) = (self.app.clone(), ctl.dir.clone(), ctl.n, ctl.tx.clone(), lane.to_string());
        std::thread::spawn(move || {
            // the lane's previous try ends first, or `acp::start` would find it alive and start nothing
            if let Some(s) = old { s.stop(false); }
            let agents = app.state::<acp::AcpState>();
            let started = launch_worker(&agents, emit, key.clone(), acp::Lane::Worker { run: n, k }, &dir, extras);
            let reason = match started {
                // stopped while it was launching: `stop` found nothing to end, so this does
                Ok(true) if !flag.load(Ordering::SeqCst) => { if let Some(s) = agents.get(&key) { s.stop(false); } return }
                Ok(true) => return,
                Ok(false) => "the lane's previous session was still running".to_string(),
                Err(e) => e,
            };
            tell(&flag, &tx, Ev::Died { lane: id, reason });
        });
        Ok(())
    }
    fn prompt(&self, ctl: &Arc<RunCtl>, lane: &str, k: u16, text: &str) -> Result<(), String> {
        let s = self.session(ctl, k).ok_or("the lane's session isn't running")?;
        let flag = self.flag(&Self::key(ctl, k)).ok_or("the lane's session was stopped")?;
        let (tx, id, text) = (ctl.tx.clone(), lane.to_string(), text.to_string());
        std::thread::spawn(move || {
            // the thread shows the first line ("You are lane C of round 10: …"), the agent gets it all
            let display = text.lines().next().unwrap_or("").to_string();
            if s.prompt(vec![json!({ "type": "text", "text": text })], display).is_err() {
                tell(&flag, &tx, Ev::TurnEnd { lane: id, stop: None, error: true });
            }
        });
        Ok(())
    }
    fn cancel(&self, ctl: &Arc<RunCtl>, _lane: &str, k: u16) { if let Some(s) = self.session(ctl, k) { let _ = s.cancel(); } }
    fn stop(&self, ctl: &Arc<RunCtl>, _lane: &str, k: u16) {
        let key = Self::key(ctl, k);
        self.retire(&key, None);
        // looked up now, stopped off-thread: a later try's session is never the one this stops
        if let Some(s) = self.session(ctl, k) { std::thread::spawn(move || s.stop(false)); }
    }
}

/// The one place a worker session meets Plan C's names: the project's agent
/// profile, its launch, and `acp::start`'s profile argument.
pub(crate) fn launch_worker(agents: &acp::AcpState, emit: acp::Emit, key: String, lane: acp::Lane, dir: &Path, extras: acp::LaneExtras) -> Result<bool, String> {
    let p = crate::load_project(dir);
    let profile = crate::agents::project_profile(&p.dir);
    let launch = crate::setup::agent_launch(profile.id).ok_or_else(|| format!("{} isn't installed — open Setup & health", profile.name))?;
    let mut jail = vec![p.repo.clone(), p.dir.clone()];
    jail.extend(p.extras.iter().map(|(_, b)| b.clone()));
    acp::start(agents, emit, key, lane, profile, p.repo.clone(), p.dir.clone(), jail, None, extras, None, acp::adapter_command_for(&launch, profile))
}

/// The chat lane during a run (spec §4): publish verbs are refused there too,
/// and the refusal is a needs-you row on the live run. Hands off (spec §3, §5):
/// the run server's own tools, and the planner's writes of its round's two
/// fixes/ files while the round is planned, are answered here, not by the user.
/// And while the round is planned, its shell commands are answered as a lane's
/// are, owning nothing: reads allowed, git writes refused, anything else the
/// judge's (spec §5, §6). Once the lanes run, only the publish refusal stays (R29).
pub struct RunsScreen {
    pub dir: PathBuf,
    /// adds the row to the live run; false when no run is live
    pub record: Arc<dyn Fn(&Path, NeedsYou) -> bool + Send + Sync>,
    /// the live run's state and round, if a run is live on the project
    pub live: Arc<dyn Fn(&Path) -> Option<(RunState, u64)> + Send + Sync>,
    /// adds the judge's rows, notices and cost to the live run; false when no run is live
    pub log: Arc<dyn Fn(&Path, Vec<DecisionLog>, Vec<String>, f64) -> bool + Send + Sync>,
    /// the judge for the project, built the first time a command needs it
    pub make_judge: Arc<dyn Fn(&Path) -> Judge + Send + Sync>,
    pub judge: Arc<OnceLock<Judge>>,
}

/// The live run: not finished, and not an interrupted one nobody drives.
fn live_run(dir: &Path) -> Option<(RunState, u64)> {
    list(dir).into_iter().rev().find(|r| !r.state.terminal() && r.state != RunState::Interrupted).map(|r| (r.state, r.round_n()))
}

/// A change to the live run: through its controller when one drives it, else
/// to the saved record (a run being planned has none). False when no run is live.
fn on_live_run(app: &tauri::AppHandle, dir: &Path, f: impl FnOnce(&mut RunRecord)) -> bool {
    // an interrupted run is nobody's round in progress: the chat lane is itself again
    let Some(mut rec) = list(dir).into_iter().rev().find(|r| !r.state.terminal() && r.state != RunState::Interrupted) else { return false };
    let runs = app.state::<Runs>();
    match runs.get(dir, rec.n).filter(|c| !c.snapshot().state.terminal()) {
        Some(ctl) => { ctl.update(f); }
        None => { f(&mut rec); let _ = save(dir, &mut rec); runs.publish(dir, &rec); }
    }
    true
}

impl RunsScreen {
    pub fn for_app(app: &tauri::AppHandle, dir: &Path) -> RunsScreen {
        let (a1, a2) = (app.clone(), app.clone());
        RunsScreen {
            dir: dir.to_path_buf(), live: Arc::new(live_run),
            record: Arc::new(move |dir: &Path, row: NeedsYou| on_live_run(&a1, dir, |r| r.needs_you.push(row))),
            log: Arc::new(move |dir: &Path, logs: Vec<DecisionLog>, notices: Vec<String>, usd: f64| on_live_run(&a2, dir, |r| {
                r.decisions.extend(logs); r.notices.extend(notices); r.judge_usd += usd; r.cost = r.total_cost();
            })),
            make_judge: Arc::new(|dir: &Path| { let (decisions, review) = super::oracle::for_project(dir); Judge::new(decisions, review) }),
            judge: Default::default(),
        }
    }
}

impl RunsScreen {
    /// Chronicle's own answer to the chat lane's ask while a run is live, if it has one.
    fn hands_off(&self, params: &Value) -> Option<PolicyAnswer> {
        let name = tool_name(params)?;
        let (state, round) = (self.live)(&self.dir)?;
        let allow = |path: String| PolicyAnswer { allow: true, path, reason: String::new(), decision: None };
        if name.starts_with(&format!("mcp__{RUN_SERVER}__")) { return Some(allow(name.to_string())); }
        if state != RunState::Planning || !WRITE_TOOLS.contains(&name) { return None; }
        let target = write_target(params.get("toolCall")?);
        if target.is_empty() { return None; }
        let at = acp::canonical_deep(Path::new(target))?;
        ["plan", "prompt"].iter()
            .any(|k| acp::canonical_deep(&self.dir.join(format!("fixes/phase_{round}_fixes_{k}.md"))).as_ref() == Some(&at))
            .then(|| allow(target.to_string()))
    }
}

/// The command of a shell ask, the way a lane's fence reads one.
fn shell_command(params: &Value) -> Option<&str> {
    let call = params.get("toolCall")?;
    let shell = matches!(tool_name(params), Some("Bash" | "Terminal")) || call.get("kind").and_then(|v| v.as_str()) == Some("execute");
    if !shell { return None; }
    call.pointer("/rawInput/command").and_then(|v| v.as_str())
}

impl AskScreen for RunsScreen {
    fn screen(&self, params: &Value) -> Option<PolicyAnswer> {
        if let Some(a) = self.hands_off(params) { return Some(a); }
        let cmd = params.pointer("/toolCall/rawInput/command").and_then(|v| v.as_str())?;
        let class = classify(cmd);
        if class == Shell::Publish {
            let row = NeedsYou { kind: "refused".into(), lane: None, item: None, reason: cmd.to_string(), reading: None };
            if !(self.record)(&self.dir, row) { return None; }
            return Some(PolicyAnswer { allow: false, path: cmd.to_string(), reason: PUBLISH_REFUSAL.into(), decision: None });
        }
        // the planner owns no files: a read is fine, a git write never is. Only while it plans
        // (R29): once the lanes run, the chat lane is the user's again, but for publishing
        let cmd = shell_command(params)?;
        let (state, _) = (self.live)(&self.dir)?;
        if state != RunState::Planning { return None; }
        match class {
            Shell::ReadOnly | Shell::ReadOnlyGit => Some(PolicyAnswer { allow: true, path: cmd.to_string(), reason: String::new(), decision: None }),
            Shell::GitWrite => Some(PolicyAnswer { allow: false, path: cmd.to_string(), reason: GIT_REFUSAL.into(), decision: None }),
            _ => None,
        }
    }

    /// Any other command of the chat lane's, while its run is planned: the judge's (spec §6, decision 1; R29).
    fn defer(&self, params: &Value) -> Option<acp::Deferred> {
        if self.hands_off(params).is_some() { return None; }
        let cmd = shell_command(params)?.to_string();
        if classify(&cmd) != Shell::Other { return None; }
        let (state, round) = (self.live)(&self.dir)?;
        if state != RunState::Planning { return None; }
        let (dir, judge, make, log) = (self.dir.clone(), self.judge.clone(), self.make_judge.clone(), self.log.clone());
        Some(Box::new(move || {
            let judge = judge.get_or_init(|| make(&dir));
            let item = format!("planning round {round}");
            let before = judge.spent_usd();
            let (allow, reason, logs) = judge.shell(&ShellAsk { lane: "planner", command: &cmd, owns: &[], item: &item, last_calls: &[] });
            let usd = (judge.spent_usd() - before).max(0.0);
            let decision = logs.first().map(|l| json!({ "choice": l.choice, "confidence": l.confidence, "model": l.model, "band": l.band, "probabilities": l.probabilities }));
            log(&dir, logs, judge.take_notice(), usd);
            PolicyAnswer { allow, path: cmd, reason, decision }
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::sync::Mutex;

    fn wire(method: &str, params: Value) -> Value { json!({ "dir": "/p", "lane": "w/10-0", "message": { "method": method, "params": params } }) }

    #[test]
    fn a_lane_sessions_events_become_the_controllers() {
        assert_eq!(lane_event("a", &wire("_chronicle/session_state", json!({ "state": "ready", "sessionId": "s1" }))), Ev::Ready { lane: "a".into(), session: "s1".into() });
        assert!(matches!(lane_event("a", &wire("_chronicle/session_state", json!({ "state": "error", "message": "boom" }))), Ev::Died { ref reason, .. } if reason == "boom"));
        assert!(matches!(lane_event("a", &wire("_chronicle/session_state", json!({ "state": "needs-login" }))), Ev::Died { .. }));
        assert_eq!(lane_event("a", &wire("_chronicle/session_state", json!({ "state": "starting" }))), Ev::Wire { lane: "a".into() });
        assert_eq!(lane_event("a", &wire("_chronicle/turn_end", json!({ "stopReason": "end_turn", "usage": null }))), Ev::TurnEnd { lane: "a".into(), stop: Some("end_turn".into()), error: false });
        assert_eq!(lane_event("a", &wire("_chronicle/turn_end", json!({ "error": { "message": "x" } }))), Ev::TurnEnd { lane: "a".into(), stop: None, error: true });
        assert_eq!(lane_event("a", &wire("session/update", json!({ "update": { "sessionUpdate": "usage_update", "cost": { "amount": 0.42 } } }))), Ev::Usage { lane: "a".into(), usd: 0.42 });
        assert_eq!(lane_event("a", &wire("session/update", json!({ "update": { "sessionUpdate": "agent_message_chunk" } }))), Ev::Wire { lane: "a".into() });
    }

    #[test]
    fn the_chat_screen_refuses_a_publish_only_while_a_round_runs() {
        let taken: Arc<Mutex<Vec<NeedsYou>>> = Default::default();
        let sink = taken.clone();
        let live = Arc::new(std::sync::atomic::AtomicBool::new(true));
        let l2 = live.clone();
        let screen = RunsScreen { dir: PathBuf::from("/p"), record: Arc::new(move |_d: &Path, row: NeedsYou| {
            if !l2.load(std::sync::atomic::Ordering::SeqCst) { return false; }
            sink.lock().unwrap().push(row); true
        }), live: Arc::new(|_d: &Path| None), log: Arc::new(|_d: &Path, _l: Vec<DecisionLog>, _n: Vec<String>, _u: f64| false),
            make_judge: Arc::new(|_d: &Path| panic!("no judge outside a run")), judge: Default::default() };
        let ask = |c: &str| json!({ "toolCall": { "toolCallId": "t", "name": "Bash", "rawInput": { "command": c } } });
        let a = screen.screen(&ask("git push origin main")).expect("refused during a round");
        assert!(!a.allow);
        assert_eq!(a.reason, crate::runs::fence::PUBLISH_REFUSAL);
        assert_eq!(taken.lock().unwrap()[0].kind, "refused");
        assert!(screen.screen(&ask("npm test")).is_none(), "only publish verbs are screened; the user answers the rest");
        live.store(false, std::sync::atomic::Ordering::SeqCst);
        assert!(screen.screen(&ask("git push")).is_none(), "outside a round the chat lane behaves as today");
    }

    fn screen_with(dir: &Path, live: Option<(RunState, u64)>) -> RunsScreen {
        RunsScreen { dir: dir.to_path_buf(), record: Arc::new(|_d: &Path, _row: NeedsYou| true), live: Arc::new(move |_d: &Path| live),
            log: Arc::new(|_d: &Path, _logs: Vec<DecisionLog>, _notices: Vec<String>, _u: f64| true),
            make_judge: Arc::new(|_d: &Path| panic!("no judge in this test")), judge: Default::default() }
    }

    /// What acp does with a screen: a deferred answer first (off the reader thread there), then the quick one.
    fn answered(s: &RunsScreen, ask: &Value) -> Option<PolicyAnswer> {
        s.defer(ask).map(|f| f()).or_else(|| s.screen(ask))
    }

    /// A screen on a live (or not) run with a fake judge, and what it pushed to the record.
    struct Judged { s: RunsScreen, decide: Arc<crate::runs::oracle::fake::FakeOracle>, rows: Arc<Mutex<Vec<NeedsYou>>>, logs: Arc<Mutex<Vec<DecisionLog>>>, built: Arc<std::sync::atomic::AtomicUsize> }
    fn judged(live: Option<(RunState, u64)>) -> Judged {
        use crate::runs::oracle::fake::{fallback, second, FakeOracle};
        let decide = FakeOracle::named("jev-1.13.0");
        let review = FakeOracle::named("review");
        let (rows, logs): (Arc<Mutex<Vec<NeedsYou>>>, Arc<Mutex<Vec<DecisionLog>>>) = Default::default();
        let built = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let (r2, l2, d2, b2) = (rows.clone(), logs.clone(), decide.clone(), built.clone());
        let s = RunsScreen {
            dir: PathBuf::from("/p"),
            record: Arc::new(move |_d: &Path, row: NeedsYou| { if live.is_none() { return false; } r2.lock().unwrap().push(row); true }),
            live: Arc::new(move |_d: &Path| live),
            log: Arc::new(move |_d: &Path, l: Vec<DecisionLog>, _n: Vec<String>, _u: f64| { if live.is_none() { return false; } l2.lock().unwrap().extend(l); true }),
            make_judge: Arc::new(move |_d: &Path| { b2.fetch_add(1, Ordering::SeqCst); Judge::new(fallback(&d2, &FakeOracle::named("agent")), second(&review, &FakeOracle::named("agent"))) }),
            judge: Default::default(),
        };
        Judged { s, decide, rows, logs, built }
    }
    fn bash(c: &str) -> Value {
        json!({ "toolCall": { "toolCallId": "t", "name": "Bash", "kind": "execute", "rawInput": { "command": c } },
            "options": [ { "optionId": "yes", "kind": "allow_once" }, { "optionId": "no", "kind": "reject_once" } ] })
    }

    #[test]
    fn the_planners_git_reads_are_allowed_and_its_git_writes_refused_without_the_judge() {
        let j = judged(Some((RunState::Planning, 4)));
        let a = answered(&j.s, &bash("git log --oneline -5 && git status")).expect("a git read is answered by policy");
        assert!(a.allow);
        let w = answered(&j.s, &bash("git commit -am wip")).expect("a git write is answered by policy");
        assert!(!w.allow);
        assert_eq!(w.reason, crate::runs::fence::GIT_REFUSAL);
        for c in ["cat src/greet.js", "node --version && npm run test 2>&1 | tail -20", "ls -la"] {
            assert!(answered(&j.s, &bash(c)).expect("a plain read is answered by policy").allow, "{c}");
        }
        assert_eq!(j.decide.decide_calls.load(Ordering::SeqCst), 0, "no rule needed the judge");
        assert_eq!(j.built.load(Ordering::SeqCst), 0, "the judge isn't even built");
    }

    #[test]
    fn once_the_lanes_run_the_chat_lanes_asks_go_to_the_user_but_a_publish_is_still_refused() {
        for st in [RunState::Running, RunState::NeedsYou, RunState::Gating] {
            let j = judged(Some((st, 4)));
            for c in ["ls", "git status", "git commit -m x", "npm install", "make lint"] {
                assert!(answered(&j.s, &bash(c)).is_none(), "{st:?}: {c} is the user's to answer");
            }
            let p = answered(&j.s, &bash("git push origin main")).expect("a publish is refused for the whole run");
            assert!(!p.allow);
            assert_eq!(p.reason, PUBLISH_REFUSAL);
            assert_eq!(j.rows.lock().unwrap().len(), 1, "{st:?}: and shown");
            assert_eq!(j.built.load(Ordering::SeqCst), 0, "{st:?}: no judge outside planning");
        }
    }

    #[test]
    fn a_publish_from_the_planner_is_refused_and_shown() {
        let j = judged(Some((RunState::Planning, 4)));
        let a = answered(&j.s, &bash("npm publish")).expect("refused");
        assert!(!a.allow);
        assert_eq!(a.reason, PUBLISH_REFUSAL);
        assert_eq!(j.rows.lock().unwrap().len(), 1);
        assert_eq!(j.rows.lock().unwrap()[0].kind, "refused");
        assert_eq!(j.decide.decide_calls.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn any_other_planner_command_goes_to_the_judge_and_its_answer_is_kept() {
        use crate::runs::oracle::fake::{choice, decision, noul};
        let j = judged(Some((RunState::Planning, 4)));
        assert!(j.s.screen(&bash("make lint")).is_none(), "the judge's call is never made on the reader thread");
        j.decide.decide_with(decision(vec![choice("action", "allow", &[("allow", 0.93)], 0.93), noul("writes_outside", 0.05)], "jev-1.13.0", false));
        let a = answered(&j.s, &bash("make lint")).expect("the judge answers");
        assert!(a.allow);
        let d = a.decision.expect("the guard line carries the decision");
        assert_eq!((d["choice"].as_str(), d["model"].as_str(), d["band"].as_str()), (Some("allow"), Some("jev-1.13.0"), Some("act")));
        assert_eq!(d["confidence"], json!(0.93f32));
        assert_eq!(d["probabilities"], json!({ "allow": 0.93f32 }));
        j.decide.decide_with(decision(vec![choice("action", "refuse", &[("refuse", 0.9)], 0.9), noul("writes_outside", 0.8)], "jev-1.13.0", false));
        let r = answered(&j.s, &bash("node scripts/rewrite.js")).expect("the judge answers");
        assert!(!r.allow, "the judge's refusal is honoured");
        let logs = j.logs.lock().unwrap();
        assert_eq!(logs.iter().map(|l| (l.subject.as_str(), l.action.as_str())).collect::<Vec<_>>(), vec![("make lint", "allow"), ("node scripts/rewrite.js", "refuse")]);
        assert!(logs.iter().all(|l| l.kind == "shell" && l.lane.as_deref() == Some("planner")));
        assert_eq!(j.built.load(Ordering::SeqCst), 1, "built once per screen");
        assert!(j.rows.lock().unwrap().is_empty());
    }

    #[test]
    fn outside_a_run_the_planners_shell_asks_go_to_the_user() {
        let j = judged(None);
        for c in ["ls", "git status", "git commit -m x"] {
            assert!(answered(&j.s, &bash(c)).is_none(), "{c}");
        }
        let read = json!({ "toolCall": { "toolCallId": "r", "name": "Read", "kind": "read", "rawInput": { "file_path": "/p/a" } }, "options": [] });
        assert!(answered(&judged(Some((RunState::Planning, 4))).s, &read).is_none(), "only shell asks are answered here");
        assert_eq!(j.built.load(Ordering::SeqCst), 0);
    }
    fn write_ask(name: &str, path: &Path) -> Value {
        json!({ "toolCall": { "toolCallId": "w", "name": name, "kind": "edit", "rawInput": { "file_path": path.to_string_lossy() } },
            "options": [ { "optionId": "yes", "kind": "allow_once" }, { "optionId": "no", "kind": "reject_once" } ] })
    }

    #[test]
    fn the_planners_own_fixes_files_are_allowed_while_its_round_is_planned() {
        let d = std::env::temp_dir().join(format!("chronicle-screen-plan-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        let d = d.canonicalize().unwrap();
        let s = screen_with(&d, Some((RunState::Planning, 7)));
        for f in ["fixes/phase_7_fixes_plan.md", "fixes/phase_7_fixes_prompt.md"] {
            let a = s.screen(&write_ask("Write", &d.join(f))).unwrap_or_else(|| panic!("{f} is the planner's own file"));
            assert!(a.allow, "{f}");
            assert!(s.screen(&write_ask("Edit", &d.join(f))).map(|a| a.allow).unwrap_or(false), "an edit of {f} too");
        }
        assert!(s.screen(&write_ask("Write", &d.join("fixes/phase_8_fixes_plan.md"))).is_none(), "another round's plan goes to the user");
        assert!(s.screen(&write_ask("Write", &d.join("src/main.rs"))).is_none(), "any other write goes to the user");
        assert!(s.screen(&write_ask("Write", &d.join("fixes/../src/phase_7_fixes_plan.md"))).is_none());
        assert!(s.screen(&write_ask("Write", Path::new("/elsewhere/fixes/phase_7_fixes_plan.md"))).is_none(), "another project's file goes to the user");
        // once the lanes run, the planner's turn is over: its writes are the user's to answer again
        assert!(screen_with(&d, Some((RunState::Running, 7))).screen(&write_ask("Write", &d.join("fixes/phase_7_fixes_plan.md"))).is_none());
        assert!(screen_with(&d, None).screen(&write_ask("Write", &d.join("fixes/phase_7_fixes_plan.md"))).is_none(), "no run, no screen");
    }

    #[test]
    fn the_run_servers_own_tools_are_allowed_while_a_run_is_live() {
        let ask = json!({ "toolCall": { "toolCallId": "m", "name": "mcp__chronicle-run__chronicle_run_declare", "rawInput": {} },
            "options": [ { "optionId": "yes", "kind": "allow_once" }, { "optionId": "no", "kind": "reject_once" } ] });
        for st in [RunState::Planning, RunState::Running, RunState::NeedsYou] {
            let a = screen_with(Path::new("/p"), Some((st, 3))).screen(&ask).expect("the run server is Chronicle's own");
            assert!(a.allow, "{st:?}");
        }
        assert!(screen_with(Path::new("/p"), None).screen(&ask).is_none(), "outside a run the user answers");
        let mut via_meta = json!({ "toolCall": { "toolCallId": "m2", "_meta": { "claudeCode": { "toolName": "mcp__chronicle-run__chronicle_run_state" } } },
            "options": [ { "optionId": "ok", "kind": "allow_once" } ] });
        crate::agents::normalize::normalize_permission(&mut via_meta, crate::agents::claude());
        assert!(screen_with(Path::new("/p"), Some((RunState::Planning, 3))).screen(&via_meta).map(|a| a.allow).unwrap_or(false));
        let full = json!({ "toolCall": { "toolCallId": "m3", "name": "mcp__chronicle__chronicle_notes_create" }, "options": [] });
        assert!(screen_with(Path::new("/p"), Some((RunState::Planning, 3))).screen(&full).is_none(), "the full chronicle server still asks");
    }

    #[test]
    fn a_stopped_session_no_longer_speaks_to_the_controller() {
        let (tx, rx) = std::sync::mpsc::channel();
        let (to_ctl_tx, to_ctl_rx) = std::sync::mpsc::channel::<Ev>();
        let tx_of = |t: &Sender<Ev>| t.clone();
        let current = Arc::new(AtomicBool::new(true));
        let to_ctl = forward(tx, "a".into(), current.clone());
        to_ctl(&wire("_chronicle/turn_end", json!({ "stopReason": "end_turn" })));
        assert!(matches!(rx.try_recv(), Ok(Ev::TurnEnd { .. })));
        current.store(false, Ordering::SeqCst);
        to_ctl(&wire("_chronicle/session_state", json!({ "state": "ended" })));
        assert!(rx.try_recv().is_err(), "the ended line of a session the controller stopped is not a death of the lane's next try");
        // the host's own reports about that session (a failed launch, a failed prompt) are held back the same way
        tell(&current, &tx_of(&to_ctl_tx), Ev::Died { lane: "a".into(), reason: "x".into() });
        tell(&current, &tx_of(&to_ctl_tx), Ev::TurnEnd { lane: "a".into(), stop: None, error: true });
        assert!(to_ctl_rx.try_recv().is_err());
        current.store(true, Ordering::SeqCst);
        tell(&current, &tx_of(&to_ctl_tx), Ev::Died { lane: "a".into(), reason: "x".into() });
        assert!(matches!(to_ctl_rx.try_recv(), Ok(Ev::Died { .. })), "a live session's death still reaches the controller");
    }
}
