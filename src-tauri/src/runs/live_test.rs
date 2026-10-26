//! The real adapter, end to end (spec §12): a toy repo, two lanes, a
//! deliberate shell leak (a committed script that appends to NOTES.txt — an
//! agent told to write NOTES.txt outright declines, rightly), one `block` claim. The judge and the reviewer are a
//! rule-based stand-in (the subject here is the lanes, the gate and the
//! tools, not a model's taste). Gated like `acp_real_adapter_round_trip`, on
//! the same variable; it needs the built `chronicle` binary (the lanes' run
//! server) and a signed-in Claude Code:
//!   cd src-tauri && cargo build && CHRONICLE_ACP_TEST=1 cargo test runs::live_test -- --ignored --nocapture
//! (`CHRONICLE_BIN` overrides `target/debug/chronicle`.)
use super::checks::{max_lanes, repo_checks};
use super::judge::Judge;
use super::oracle::{Fallback, Oracle, DECISIONS_FALLBACK, REVIEW_FALLBACK};
use super::record::*;
use super::runner::{self, CtlParts, Ev, LaneHost, RunCtl};
use super::{commands, gate, tools, Runs};
use crate::acp::{self, LanePolicy};
use crate::providers::{Answer, Criterion, Decision, DecisionRequest};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::Sender;
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

const GATE: &str = "CHRONICLE_ACP_TEST";

fn lk<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> { m.lock().unwrap_or_else(|e| e.into_inner()) }

/// Allows every shell command, parks every block, triages to none, passes every review.
struct Rules;
impl Oracle for Rules {
    fn decide(&self, req: DecisionRequest) -> Result<Decision, String> {
        let mut answers = HashMap::new();
        for c in &req.criteria {
            let a = match c {
                Criterion::Choice { name, options } if name == "action" => Answer::Choice { choice: "allow".into(),
                    probabilities: options.iter().map(|o| (o.clone(), if o == "allow" { 0.95 } else { 0.025 })).collect(), confidence: 0.95 },
                Criterion::Choice { .. } => Answer::Choice { choice: "none".into(), probabilities: HashMap::new(), confidence: 0.9 },
                Criterion::Noul { name } if name == "writes_outside" => Answer::Noul { yes: 0.05 },
                Criterion::Noul { .. } => Answer::Noul { yes: 0.9 },
                Criterion::Score { .. } => Answer::Score { value: 2, confidence: 0.9 },
            };
            answers.insert(c.name().to_string(), a);
        }
        Ok(Decision { answers, model: "rules".into(), self_reported: false })
    }
    fn complete_json(&self, _s: &str, _p: &str, schema: &Value) -> Result<(Value, String), String> {
        if schema.pointer("/properties/pass").is_some() { return Ok((json!({ "pass": true, "findings": [] }), "rules".into())); }
        Ok((json!({ "answer": "Do what the item says, within your files." }), "rules".into()))
    }
}

/// `AcpHost`, minus the app: its own session table, and the lane's run server
/// is the built chronicle binary (the test binary can't serve `--mcp`). Like
/// `AcpHost`, every call returns at once and a stopped session's late lines
/// never reach the controller.
struct TestHost {
    agents: Arc<acp::AcpState>,
    bin: PathBuf,
    current: Mutex<HashMap<String, Arc<AtomicBool>>>,
    /// launches and stops, joined before the sessions are drained
    threads: Mutex<Vec<JoinHandle<()>>>,
}
impl TestHost {
    fn key(ctl: &RunCtl, k: u16) -> String { acp::Lane::Worker { run: ctl.n, k }.key(&ctl.dir.to_string_lossy()) }
    fn retire(&self, key: &str, next: Option<Arc<AtomicBool>>) {
        let mut g = lk(&self.current);
        let old = match next { Some(f) => g.insert(key.to_string(), f), None => g.remove(key) };
        if let Some(f) = old { f.store(false, Ordering::SeqCst); }
    }
    fn on_thread(&self, f: impl FnOnce() + Send + 'static) { lk(&self.threads).push(std::thread::spawn(f)); }
    /// Every lane session ended, nothing left launching: no adapter outlives the test.
    fn shut(&self) {
        for f in lk(&self.current).drain() { f.1.store(false, Ordering::SeqCst); }
        let threads: Vec<_> = lk(&self.threads).drain(..).collect();
        for t in threads { let _ = t.join(); }
        self.agents.drain();
    }
}
impl LaneHost for TestHost {
    fn start(&self, ctl: &Arc<RunCtl>, lane: &str, k: u16, policy: Arc<dyn LanePolicy>) -> Result<(), String> {
        let key = Self::key(ctl, k);
        let flag = Arc::new(AtomicBool::new(true));
        self.retire(&key, Some(flag.clone()));
        let old = self.agents.get(&key);
        let (tx, id, live): (Mutex<Sender<Ev>>, String, Arc<AtomicBool>) = (Mutex::new(ctl.tx.clone()), lane.to_string(), flag.clone());
        let emit: acp::Emit = Arc::new(move |v: Value| {
            if live.load(Ordering::SeqCst) { let _ = lk(&tx).send(super::host::lane_event(&id, &v)); }
        });
        let extras = acp::LaneExtras { mcp_servers: vec![tools::lane_server(&ctl.dir, &self.bin, ctl.n, lane)], policy: Some(acp::PolicyHandle(policy)), ..Default::default() };
        let (agents, dir, n, tx, id) = (self.agents.clone(), ctl.dir.clone(), ctl.n, ctl.tx.clone(), lane.to_string());
        self.on_thread(move || {
            if let Some(s) = old { s.stop(false); }
            let reason = match super::host::launch_worker(&agents, emit, key.clone(), acp::Lane::Worker { run: n, k }, &dir, extras) {
                Ok(true) if !flag.load(Ordering::SeqCst) => { if let Some(s) = agents.get(&key) { s.stop(false); } return }
                Ok(true) => return,
                Ok(false) => "the lane's previous session was still running".to_string(),
                Err(e) => e,
            };
            let _ = tx.send(Ev::Died { lane: id, reason });
        });
        Ok(())
    }
    fn prompt(&self, ctl: &Arc<RunCtl>, lane: &str, k: u16, text: &str) -> Result<(), String> {
        let s = self.agents.get(&Self::key(ctl, k)).ok_or("the lane's session isn't running")?;
        let (tx, id, text) = (ctl.tx.clone(), lane.to_string(), text.to_string());
        // not joined: a prompt runs as long as its turn, and the drain ends it
        std::thread::spawn(move || {
            let display = text.lines().next().unwrap_or("").to_string();
            if s.prompt(vec![json!({ "type": "text", "text": text })], display).is_err() {
                let _ = tx.send(Ev::TurnEnd { lane: id, stop: None, error: true });
            }
        });
        Ok(())
    }
    fn cancel(&self, ctl: &Arc<RunCtl>, _lane: &str, k: u16) { if let Some(s) = self.agents.get(&Self::key(ctl, k)) { let _ = s.cancel(); } }
    fn stop(&self, ctl: &Arc<RunCtl>, _lane: &str, k: u16) {
        let key = Self::key(ctl, k);
        self.retire(&key, None);
        if let Some(s) = self.agents.get(&key) { self.on_thread(move || s.stop(false)); }
    }
}

/// Whatever happens — a pass, a failed assertion, a panic — the run is stopped,
/// its loop joined, every adapter ended and the temp folders removed.
struct Cleanup {
    ctl: Option<Arc<RunCtl>>,
    runner: Option<JoinHandle<()>>,
    runs: Option<Arc<Runs>>,
    host: Arc<TestHost>,
    dirs: Vec<PathBuf>,
}
impl Drop for Cleanup {
    fn drop(&mut self) {
        if let Some(ctl) = self.ctl.take() { let _ = ctl.tx.send(Ev::Stop); }
        self.runs.take();
        if let Some(t) = self.runner.take() {
            // the loop answers Stop within half a second unless a gate is running
            let deadline = Instant::now() + Duration::from_secs(120);
            while !t.is_finished() && Instant::now() < deadline { std::thread::sleep(Duration::from_millis(200)); }
            if t.is_finished() { let _ = t.join(); } else { eprintln!("the run loop didn't stop within two minutes; ending its sessions anyway"); }
        }
        self.host.shut();
        for d in &self.dirs { let _ = std::fs::remove_dir_all(d); }
    }
}

fn toy_repo(d: &PathBuf) -> PathBuf {
    let _ = std::fs::remove_dir_all(d);
    std::fs::create_dir_all(d.join("fixes")).unwrap();
    let d = d.canonicalize().unwrap();
    for a in [&["init", "-q"][..], &["config", "user.email", "t@t"], &["config", "user.name", "t"], &["config", "commit.gpgsign", "false"]] { gate::git(&d, a).unwrap(); }
    std::fs::write(d.join("README.md"), "toy\n").unwrap();
    std::fs::write(d.join(".gitignore"), ".chronicle/\n").unwrap();
    // the shell hole: a script the fence can't see into writes outside every lane's files
    std::fs::write(d.join("check.sh"), "#!/bin/sh\necho checked >> NOTES.txt\necho ok\n").unwrap();
    std::fs::write(d.join("chronicle.json"), r#"{ "checks": [{ "name": "test", "command": "test -f README.md" }] }"#).unwrap();
    std::fs::write(d.join("fixes/phase_1_fixes_plan.md"), "Round kind: feature additions\n\n- I-1: Create a/alpha.txt containing the word alpha. Then check the tree by running exactly this shell command: sh check.sh\n- I-2: Create b/beta.txt containing the word beta.\n- I-3: Rename the file b/does-not-exist.txt to b/renamed.txt. (That file does not exist; if you can't do the item as written, say so with chronicle_run_block.)\n").unwrap();
    gate::git(&d, &["add", "README.md", ".gitignore", "chronicle.json", "check.sh", "fixes/phase_1_fixes_plan.md"]).unwrap();
    gate::git(&d, &["commit", "-qm", "toy"]).unwrap();
    crate::notes::rounds::save(&d, &[crate::notes::rounds::Round { n: 1, state: "generating".into(), kind: None, task_ids: vec![], note_paths: vec![],
        created_at: 0, plan_path: "fixes/phase_1_fixes_plan.md".into(), prompt_path: "fixes/phase_1_fixes_prompt.md".into() }]).unwrap();
    d
}

#[test]
#[ignore]
fn runs_real_adapter_two_lanes_a_leak_and_a_block() {
    if std::env::var(GATE).ok().as_deref() != Some("1") { eprintln!("skipped: set {GATE}=1 to run against the real adapter"); return; }
    if crate::setup::agent_launch("claude-acp").is_none() { eprintln!("skipped: no way to launch Claude Code's connector on this Mac"); return; }
    let bin = std::env::var("CHRONICLE_BIN").map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/target/debug/chronicle")));
    assert!(bin.is_file(), "the lanes' run server is the built app: run `cargo build` first (or set CHRONICLE_BIN) — {} is missing", bin.display());

    let pid = std::process::id();
    let tmp = std::env::temp_dir();
    // the socket path stays short: a Unix socket's path is capped near 104 bytes on macOS
    let bridge_dir = tmp.join(format!("crl-{pid}"));
    let scratch = tmp.join(format!("chronicle-runs-live-scratch-{pid}"));
    let host = Arc::new(TestHost { agents: Arc::new(acp::AcpState::new()), bin, current: Default::default(), threads: Default::default() });
    let mut guard = Cleanup { ctl: None, runner: None, runs: None, host: host.clone(), dirs: vec![tmp.join(format!("chronicle-runs-live-{pid}")), scratch.clone(), bridge_dir.clone()] };
    let d = toy_repo(&guard.dirs[0]);
    guard.dirs[0] = d.clone();
    let p = crate::load_project(&d);

    // the bridge the lanes' run servers dial, answered by the same handler the app uses
    let (sock, token_file) = (bridge_dir.join("s"), bridge_dir.join("t"));
    std::env::set_var("CHRONICLE_BRIDGE_SOCKET", &sock);
    std::env::set_var("CHRONICLE_BRIDGE_TOKEN", &token_file);
    let token = crate::bridge::write_token_at(&token_file).unwrap();
    let runs = Arc::new(Runs::new());
    guard.runs = Some(runs.clone());
    let (r2, p2) = (runs.clone(), p.clone());
    crate::bridge::listen_at(&sock, token, Arc::new(move |req: crate::bridge::Request| tools::handle(&r2, &p2, &req.action, &req.args))).unwrap();

    // the planner's map, declared through the real tool path
    let mut rec = RunRecord::new(1, RunKind::Plan, Some(1), "fixes/phase_1_fixes_plan.md", "fixes/phase_1_fixes_prompt.md", "fixes/phase_1_fixes_plan.md");
    save(&d, &mut rec).unwrap();
    tools::declare(&runs, &p, &json!({
        "items": [{ "id": "I-1", "title": "alpha" }, { "id": "I-2", "title": "beta" }, { "id": "I-3", "title": "rename" }],
        "lanes": [{ "id": "a", "title": "Alpha", "items": ["I-1"], "owns": ["a/**"], "checks": ["test"] },
                  { "id": "b", "title": "Beta", "items": ["I-2", "I-3"], "owns": ["b/**"], "checks": ["test"] }] })).unwrap();
    let commands::Settle::Launch(rec) = commands::settle_in(&p, 1, 0.0).unwrap() else { panic!("the declared map launches") };

    // as `commands::launch` builds it, with the stand-in oracle and the test's host and scratch
    let rules: Arc<dyn Oracle> = Arc::new(Rules);
    let review = Arc::new(Fallback::new(rules.clone(), rules.clone(), REVIEW_FALLBACK));
    let (ctl, rx) = RunCtl::new(CtlParts {
        dir: p.dir.clone(), repo: p.repo.clone(), scratch, rec,
        checks: repo_checks(&p.repo, p.manifest.as_ref()), max_lanes: max_lanes(p.manifest.as_ref()),
        judge: Judge::new(Fallback::new(rules.clone(), rules, DECISIONS_FALLBACK), review.clone()), reviewer: review,
        host: host.clone(), publish: runs.publisher(),
    });
    runs.insert(ctl.clone());
    ctl.update(|_| {});
    guard.ctl = Some(ctl.clone());
    guard.runner = Some(runner::spawn(ctl.clone(), rx, vec![]));

    let t0 = Instant::now();
    let deadline = t0 + Duration::from_secs(900);
    let mut last = String::new();
    let held = loop {
        let r = ctl.snapshot();
        let line = format!("{:?}: {}", r.state, r.lanes.iter().map(|l| format!("{} {:?} try {}", l.id, l.state, l.attempt)).collect::<Vec<_>>().join(", "));
        if line != last { eprintln!("[{:>4}s] {line}", t0.elapsed().as_secs()); last = line; }
        if matches!(r.state, RunState::NeedsYou | RunState::Done | RunState::Failed | RunState::Stopped) { break r; }
        assert!(Instant::now() < deadline, "the run never settled: {r:#?}");
        std::thread::sleep(Duration::from_secs(2));
    };
    eprintln!("settled in {}s\n{}", t0.elapsed().as_secs(), serde_json::to_string_pretty(&held).unwrap());

    for id in ["a", "b"] {
        let l = held.lane(id).unwrap();
        assert_eq!(l.state, LaneState::Closed, "lane {id}");
        assert!(l.commit.is_some(), "lane {id} was saved");
    }
    let log = gate::git(&d, &["log", "--name-only", "--format="]).unwrap();
    assert!(log.contains("a/alpha.txt") && log.contains("b/beta.txt"), "both lanes' files are saved: {log}");
    assert!(held.lane("a").unwrap().leak.iter().any(|k| k.path == "NOTES.txt"), "the shell write is the lane's leak");
    assert!(gate::git(&d, &["status", "--porcelain"]).unwrap().contains("?? NOTES.txt"), "and is left unsaved");
    assert!(held.needs_you.iter().any(|n| n.kind == "parked" && n.item.as_deref() == Some("I-3")), "the block claim was parked for the user");
    assert_eq!(held.state, RunState::NeedsYou);
    drop(guard);
}
