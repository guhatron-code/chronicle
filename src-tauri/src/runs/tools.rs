//! The run tools a planner and its lanes call (spec §5a's list, trimmed for
//! the amended engine: gating and closing are Rust-internal now). They reach
//! the app over the bridge socket and are answered here, in Rust — never by
//! the frontend — so the record keeps one writer.
use super::checks::repo_checks;
use super::lane_map::validate;
use super::record::*;
use super::Runs;
use crate::bridge::Reply;
use serde_json::{json, Value};
use std::path::Path;
use std::time::Duration;

/// What a planner's server shows, and what a lane's shows. Neither set is ever
/// visible to the project's own `.mcp.json` server.
pub const PLANNER_TOOLS: [&str; 2] = ["chronicle.run.declare", "chronicle.run.lane_state"];
pub const LANE_TOOLS: [&str; 3] = ["chronicle.run.block", "chronicle.run.ask", "chronicle.run.lane_state"];
pub fn is_scoped_tool(name: &str) -> bool { PLANNER_TOOLS.contains(&name) || LANE_TOOLS.contains(&name) }

#[derive(Clone, Debug)]
pub enum RunScope { Planner, Lane { n: u64, lane: String } }

impl RunScope {
    /// `chronicle --mcp <dir> --planner` or `--run <n> --lane <id>`.
    pub fn from_args(args: &[String]) -> Option<RunScope> {
        if args.iter().any(|a| a == "--planner") { return Some(RunScope::Planner); }
        let after = |flag: &str| args.iter().position(|a| a == flag).and_then(|i| args.get(i + 1)).cloned();
        let n = after("--run")?.parse().ok()?;
        let lane = after("--lane").filter(|l| l.len() == 1 && l.chars().all(|c| c.is_ascii_lowercase()))?;
        Some(RunScope::Lane { n, lane })
    }
    /// Whether a tool is shown to (and callable from) this scope's server.
    pub fn shows(&self, name: &str) -> bool {
        match self {
            RunScope::Planner => PLANNER_TOOLS.contains(&name),
            RunScope::Lane { .. } => LANE_TOOLS.contains(&name),
        }
    }
}

/// A lane's calls carry its run and lane, set by its own server — never by the agent.
pub fn scoped_args(scope: Option<&RunScope>, args: &Value) -> Value {
    let mut a = if args.is_object() { args.clone() } else { json!({}) };
    if let Some(RunScope::Lane { n, lane }) = scope {
        a["_run"] = json!(n);
        a["_lane"] = json!(lane);
    }
    a
}

fn server(dir: &Path, exe: &Path, extra: &[&str]) -> Value {
    let mut args = vec!["--mcp".to_string(), dir.to_string_lossy().into_owned()];
    args.extend(extra.iter().map(|s| s.to_string()));
    let mut env = vec![json!({ "name": "PATH", "value": crate::setup::tool_env_path() })];
    // the bridge's test seam travels to the server too (the gated test, Task 17)
    for k in ["CHRONICLE_BRIDGE_SOCKET", "CHRONICLE_BRIDGE_TOKEN"] {
        if let Ok(v) = std::env::var(k) { env.push(json!({ "name": k, "value": v })); }
    }
    json!({ "name": super::fence::RUN_SERVER, "command": exe.to_string_lossy(), "args": args, "env": env })
}
pub fn planner_server(dir: &Path, exe: &Path) -> Value { server(dir, exe, &["--planner"]) }
pub fn lane_server(dir: &Path, exe: &Path, n: u64, lane: &str) -> Value { server(dir, exe, &["--run", &n.to_string(), "--lane", lane]) }

/// How long a lane's block or ask may take: inside the bridge's six-minute
/// cut-off for them (bridge.rs), whatever the providers and the agent do, and
/// inside the scheduler's stall bound (R29).
pub const ANSWER_WITHIN: Duration = Duration::from_secs(240);
const NOT_DECIDED: &str = "Chronicle hasn't decided on that item yet. Carry on with your other items, then call chronicle_run_block again for it.";

/// `f`'s result if it comes within `limit`; it carries on in the background either way.
fn within<T: Send + 'static>(limit: Duration, f: impl FnOnce() -> T + Send + 'static) -> Option<T> {
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || { let _ = tx.send(f()); });
    rx.recv_timeout(limit).ok()
}

pub fn handle(runs: &Runs, p: &crate::Project, action: &str, args: &Value) -> Reply {
    let r = match action {
        "run.declare" => declare(runs, p, args),
        "run.block" => lane_call(runs, p, args).and_then(|(ctl, lane)| {
            let item = args.get("item").and_then(|v| v.as_str()).filter(|s| !s.trim().is_empty()).ok_or("item is required.")?.to_string();
            let reason = args.get("reason").and_then(|v| v.as_str()).filter(|s| !s.trim().is_empty()).ok_or("reason is required.")?.to_string();
            within(ANSWER_WITHIN, move || ctl.block(&lane, &item, &reason)).unwrap_or_else(|| Ok(NOT_DECIDED.into())).map(|s| (s, json!({})))
        }),
        "run.ask" => lane_call(runs, p, args).and_then(|(ctl, lane)| {
            let q = args.get("question").and_then(|v| v.as_str()).filter(|s| !s.trim().is_empty()).ok_or("question is required.")?.to_string();
            Ok((within(ANSWER_WITHIN, move || ctl.ask(&lane, &q)).unwrap_or_else(|| super::judge::NO_ANSWER.into()), json!({})))
        }),
        "run.lane_state" => lane_state(runs, p, args),
        other => Err(format!("No action named {other}.")),
    };
    match r {
        Ok((summary, data)) => Reply { ok: true, summary, data: Some(data) },
        Err(summary) => Reply { ok: false, summary, data: None },
    }
}

fn lane_call(runs: &Runs, p: &crate::Project, args: &Value) -> Result<(std::sync::Arc<super::runner::RunCtl>, String), String> {
    let n = args.get("_run").and_then(|v| v.as_u64()).ok_or("This tool is for a round's lanes.")?;
    let lane = args.get("_lane").and_then(|v| v.as_str()).ok_or("This tool is for a round's lanes.")?.to_string();
    let ctl = runs.get(&p.dir, n).filter(|c| !c.snapshot().state.terminal()).ok_or_else(|| format!("Round {n} isn't running."))?;
    Ok((ctl, lane))
}

/// `chronicle_run_declare`: validate and store the planner's lane map. Every
/// reason goes back at once; the last ones are kept for the retry prompt.
pub fn declare(runs: &Runs, p: &crate::Project, args: &Value) -> Result<(String, Value), String> {
    let mut rec = list(&p.dir).into_iter().rev().find(|r| r.state == RunState::Planning)
        .ok_or("No round is being planned right now, so there's no lane map to declare.")?;
    if rec.lane_map.is_some() { return Err("This round's lane map is already accepted. End your turn.".into()); }
    let map: LaneMap = serde_json::from_value(args.clone())
        .map_err(|e| format!("The map isn't in the expected shape ({e}). Send {{\"items\": [...], \"lanes\": [...]}}."))?;
    let checks = repo_checks(&p.repo, p.manifest.as_ref());
    let notes: Vec<String> = if rec.kind == RunKind::Notes {
        crate::notes::rounds::load(&p.dir).unwrap_or_default().into_iter().find(|r| r.n == rec.round_n()).map(|r| r.note_paths).unwrap_or_default()
    } else { vec![] };
    match validate(&map, &p.repo, &checks, &notes) {
        Ok(ok) => {
            let (items, lanes) = (ok.items.len(), ok.lanes.len());
            rec.lanes = ok.lanes.iter().map(|l| LaneRecord::new(&l.id)).collect();
            rec.lane_map = Some(ok);
            rec.planner_error = None;
            save(&p.dir, &mut rec)?;
            runs.publish(&p.dir, &rec);
            Ok((format!("Lane map accepted: {items} items in {lanes} lanes."), json!({})))
        }
        Err(reasons) => {
            let text = format!("- {}", reasons.join("\n- "));
            rec.planner_error = Some(text.clone());
            save(&p.dir, &mut rec)?;
            runs.publish(&p.dir, &rec);
            Err(format!("The lane map isn't valid yet:\n{text}"))
        }
    }
}

/// `chronicle_run_lane_state`: the asking lane's own spec, and which lanes have
/// closed — enough for a lane that resumes to see where it stands.
fn lane_state(runs: &Runs, p: &crate::Project, args: &Value) -> Result<(String, Value), String> {
    let rec = match args.get("_run").and_then(|v| v.as_u64()) {
        Some(n) => runs.get(&p.dir, n).map(|c| c.snapshot()).or_else(|| load(&p.dir, n).ok().flatten()),
        None => list(&p.dir).into_iter().rev().find(|r| !r.state.terminal()),
    }.ok_or("No round is running.")?;
    let lane = args.get("_lane").and_then(|v| v.as_str())
        .and_then(|id| rec.lane_map.as_ref()?.lanes.iter().find(|l| l.id == id).cloned());
    let closed: Vec<&str> = rec.lanes.iter().filter(|l| l.state == LaneState::Closed).map(|l| l.id.as_str()).collect();
    let state = json!(rec.state);
    Ok((format!("Round {} is {}; {} of {} lanes finished.", rec.round_n(), state.as_str().unwrap_or_default().replace('-', " "), closed.len(), rec.lanes.len()),
        json!({ "round": rec.round_n(), "state": rec.state, "lane": lane, "closed": closed })))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::runs::oracle::fake::*;
    use crate::runs::runner::testkit::*;
    use serde_json::json;

    fn project(name: &str) -> crate::Project {
        let d = std::env::temp_dir().join(format!("chronicle-tools-{}-{}", name, std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        for p in ["src/lib", "src-tauri/src", ".chronicle/notes/Tasks"] { std::fs::create_dir_all(d.join(p)).unwrap(); }
        std::fs::write(d.join("package.json"), r#"{"scripts":{"test":"vitest run"}}"#).unwrap();
        crate::Project::bare(&d.canonicalize().unwrap())
    }
    fn planning(p: &crate::Project, n: u64, notes: &[&str]) {
        crate::notes::rounds::save(&p.dir, &[crate::notes::rounds::Round { n, state: "generating".into(), kind: None, task_ids: vec![],
            note_paths: notes.iter().map(|s| s.to_string()).collect(), created_at: 0, plan_path: String::new(), prompt_path: String::new() }]).unwrap();
        let mut r = RunRecord::new(n, RunKind::Notes, Some(n), &format!("fixes/phase_{n}_fixes_plan.md"), &format!("fixes/phase_{n}_fixes_prompt.md"), "");
        save(&p.dir, &mut r).unwrap();
    }

    #[test]
    fn the_planner_declares_a_map_and_hears_what_to_fix() {
        let p = project("declare");
        planning(&p, 3, &["Tasks/A.md"]);
        let runs = Runs::new();
        let bad = json!({ "items": [{ "id": "T-1", "title": "x" }], "lanes": [{ "id": "a", "title": "A", "items": ["T-1"], "owns": ["src/lib/**"], "checks": ["lint"] }] });
        let e = declare(&runs, &p, &bad).unwrap_err();
        assert!(e.contains("The note Tasks/A.md isn't covered") && e.contains("names the check \"lint\""), "{e}");
        let rec = load(&p.dir, 3).unwrap().unwrap();
        assert!(rec.lane_map.is_none());
        assert!(rec.planner_error.unwrap().contains("isn't covered"), "kept for the retry prompt");
        let good = json!({ "items": [{ "id": "T-1", "title": "x", "note": "Tasks/A.md" }, { "id": "T-2", "title": "y", "note": "Tasks/A.md" }],
            "lanes": [{ "id": "a", "title": "A", "items": ["T-1"], "owns": ["src/lib/"], "checks": ["test"] },
                      { "id": "b", "title": "B", "items": ["T-2"], "owns": ["src-tauri/src/**"], "depends_on": ["a"] }] });
        let (summary, _) = declare(&runs, &p, &good).unwrap();
        assert_eq!(summary, "Lane map accepted: 2 items in 2 lanes.");
        let rec = load(&p.dir, 3).unwrap().unwrap();
        assert_eq!(rec.lane_map.unwrap().lanes[0].owns, vec!["src/lib/**"]);
        assert_eq!(rec.lanes.iter().map(|l| (l.id.as_str(), l.state)).collect::<Vec<_>>(), vec![("a", LaneState::Waiting), ("b", LaneState::Waiting)]);
        assert!(declare(&runs, &p, &good).unwrap_err().contains("already accepted"));
    }

    #[test]
    fn a_slow_answer_is_cut_off_inside_the_bridges_wait() {
        assert_eq!(within(Duration::from_secs(5), || 7), Some(7));
        assert_eq!(within(Duration::from_millis(50), || { std::thread::sleep(Duration::from_millis(500)); 7 }), None);
        assert!(ANSWER_WITHIN < Duration::from_secs(6 * 60));
        assert!(ANSWER_WITHIN.as_millis() < super::super::scheduler::STALL_MS as u128, "an answer is cut off before the lane could stall");
    }

    #[test]
    fn declare_with_no_round_being_planned_says_so() {
        let p = project("none");
        assert!(declare(&Runs::new(), &p, &json!({ "items": [], "lanes": [] })).unwrap_err().contains("No round is being planned"));
    }

    #[test]
    fn scopes_come_from_the_mcp_flags_and_lanes_carry_their_identity() {
        let a = |xs: &[&str]| xs.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert!(matches!(RunScope::from_args(&a(&[".", "--planner"])), Some(RunScope::Planner)));
        assert!(matches!(RunScope::from_args(&a(&[".", "--run", "10", "--lane", "c"])), Some(RunScope::Lane { n: 10, ref lane }) if lane == "c"));
        assert!(RunScope::from_args(&a(&["."])).is_none());
        assert!(RunScope::from_args(&a(&[".", "--run", "x", "--lane", "c"])).is_none());
        let s = RunScope::Lane { n: 10, lane: "c".into() };
        assert_eq!(scoped_args(Some(&s), &json!({ "item": "T-1" })), json!({ "item": "T-1", "_run": 10, "_lane": "c" }));
        assert_eq!(scoped_args(Some(&s), &json!({ "_lane": "a" }))["_lane"], "c", "a lane can't speak for another");
        let srv = lane_server(Path::new("/p"), Path::new("/x/chronicle"), 10, "c");
        assert_eq!(srv["name"], "chronicle-run");
        assert_eq!(srv["args"], json!(["--mcp", "/p", "--run", "10", "--lane", "c"]));
        assert_eq!(planner_server(Path::new("/p"), Path::new("/x/chronicle"))["args"], json!(["--mcp", "/p", "--planner"]));
    }

    #[test]
    fn block_ask_and_lane_state_reach_the_live_run() {
        let r = repo("tools-live", 20);
        let k = kit(&r, two_lanes(20, &[], &[]), vec![], FakeHost::new(Box::new(|_, _| vec![])));
        k.decide.decide_with(decision(vec![noul("impossible_as_written", 0.9)], "jev-1.13.0", false));
        let runs = Runs::new();
        runs.insert(k.ctl.clone());
        let p = crate::Project::bare(&r);
        let rep = handle(&runs, &p, "run.block", &json!({ "_run": 20, "_lane": "a", "item": "I-1", "reason": "the file doesn't exist" }));
        assert!(rep.ok && rep.summary.starts_with("Accepted"), "{rep:?}");
        let st = handle(&runs, &p, "run.lane_state", &json!({ "_run": 20, "_lane": "b" }));
        assert!(st.ok);
        assert_eq!(st.data.unwrap()["lane"]["owns"], json!(["b/**"]));
        let no = handle(&runs, &p, "run.block", &json!({ "_run": 99, "_lane": "a", "item": "I-1", "reason": "x" }));
        assert!(!no.ok && no.summary.contains("isn't running"));
        let missing = handle(&runs, &p, "run.ask", &json!({ "_run": 20, "_lane": "a" }));
        assert!(!missing.ok && missing.summary.contains("question is required"));
    }
}
