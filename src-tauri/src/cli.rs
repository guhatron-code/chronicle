//! `chronicle <group> <verb> [--flag value …] [--json] [<project-dir>]`: the shell front
//! of the capability catalog. Flags become the same JSON args MCP sends.

use crate::agent_api::{self, Outcome};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

#[derive(Debug)]
pub(crate) struct Invocation { pub name: String, pub args: Value, pub dir: Option<PathBuf>, pub json: bool }
#[derive(Debug)]
pub(crate) struct Usage(pub String);

const GROUPS: [(&str, &[&str]); 7] = [
    ("notes", &["list", "read", "create", "update", "set_status", "attach"]),
    ("state", &["phases", "needs_you", "rounds"]),
    ("round", &["plan", "start"]),
    ("run", &["begin", "list", "state", "stop", "resume", "needs_you", "lane_nudge", "lane_discard"]),
    ("project", &["open"]),
    ("terminal", &["read"]),
    ("designs", &["list", "read", "capture", "lint", "bench"]),
];
/// Flags that repeat into a list, and flags whose value is `key=value` into an object.
const LIST_FLAGS: [&str; 2] = ["tag", "unset"];
const MAP_FLAGS: [&str; 1] = ["set"];
const CSV_FLAGS: [&str; 1] = ["tags"];
const BOOL_FLAGS: [&str; 1] = ["quick"];
const INT_FLAGS: [&str; 6] = ["round", "limit", "n", "lines", "id", "version"];
/// Flags whose value is JSON, handed over as the object it parses to.
const JSON_FLAGS: [&str; 1] = ["act"];

fn usage(group: &str) -> Usage {
    match GROUPS.iter().find(|(g, _)| *g == group) {
        Some((g, verbs)) => Usage(format!("Usage: chronicle {g} <{}> [--flag value] [--json] [dir].", verbs.join("|"))),
        None => Usage(format!("Usage: chronicle <{}> <verb> [--flag value] [--json] [dir].", GROUPS.iter().map(|(g, _)| *g).collect::<Vec<_>>().join("|"))),
    }
}

pub(crate) fn parse(args: &[String]) -> Result<Invocation, Usage> {
    let group = args.first().filter(|g| GROUPS.iter().any(|(k, _)| k == g)).ok_or_else(|| usage(""))?;
    let verb = args.get(1).ok_or_else(|| usage(group))?;
    if verb.starts_with("--") { return Err(usage(group)) }
    let name = format!("chronicle.{group}.{verb}");
    if !agent_api::catalog().iter().any(|t| t.name == name) {
        return Err(Usage(format!("No capability named {name}. Known verbs for {group}: {}.",
            GROUPS.iter().find(|(g, _)| g == group).map(|(_, v)| v.join(", ")).unwrap_or_default())));
    }
    // `project open <path>` is the one verb whose bare argument is not the project to
    // run in: it names the folder to OPEN. The project dir stays wherever the shell is.
    let target_is_positional = (group.as_str(), verb.as_str()) == ("project", "open");
    let mut obj = serde_json::Map::new();
    let mut json = false;
    let mut dir = None;
    let mut i = 2;
    while i < args.len() {
        let a = &args[i];
        if a == "--json" { json = true; i += 1; continue }
        if let Some(flag) = a.strip_prefix("--") {
            if BOOL_FLAGS.contains(&flag) { obj.insert(flag.into(), json!(true)); i += 1; continue }
            let val = args.get(i + 1).filter(|v| !v.starts_with("--")).ok_or_else(|| Usage(format!("--{flag} needs a value.")))?;
            if LIST_FLAGS.contains(&flag) {
                obj.entry(flag).or_insert_with(|| json!([])).as_array_mut().unwrap().push(json!(val));
            } else if MAP_FLAGS.contains(&flag) {
                let (k, v) = val.split_once('=').ok_or_else(|| Usage(format!("--{flag} takes key=value.")))?;
                obj.entry(flag).or_insert_with(|| json!({})).as_object_mut().unwrap().insert(k.into(), json!(v));
            } else if CSV_FLAGS.contains(&flag) {
                obj.insert(flag.into(), json!(val.split(',').map(str::trim).filter(|s| !s.is_empty()).collect::<Vec<_>>()));
            } else if JSON_FLAGS.contains(&flag) {
                let v: Value = serde_json::from_str(val).ok().filter(Value::is_object)
                    .ok_or_else(|| Usage(format!("--{flag} takes JSON, like '{{\"kind\":\"recheck\"}}'.")))?;
                obj.insert(flag.into(), v);
            } else if INT_FLAGS.contains(&flag) {
                obj.insert(flag.into(), json!(val.parse::<u64>().map_err(|_| Usage(format!("--{flag} must be a whole number.")))?));
            } else {
                obj.insert(flag.into(), json!(val));
            }
            i += 2;
        } else if target_is_positional {
            if obj.contains_key("dir") { return Err(Usage("Only one folder can be given to project open.".into())) }
            obj.insert("dir".into(), json!(a));
            i += 1;
        } else {
            // one bare argument is the project directory; a second is a typo, and
            // silently keeping the last one would run the call somewhere else
            if dir.is_some() { return Err(Usage("Only one project directory can be given.".into())) }
            dir = Some(PathBuf::from(a));
            i += 1;
        }
    }
    // `run begin --kind K [--path P] [--text T]`: the tool takes these as one source
    if name == "chronicle.run.begin" {
        let kind = obj.remove("kind").ok_or_else(|| Usage("--kind is required: notes, plan or prompt.".into()))?;
        let mut source = serde_json::Map::new();
        source.insert("kind".into(), kind);
        for k in ["path", "text"] { if let Some(v) = obj.remove(k) { source.insert(k.into(), v); } }
        obj.insert("source".into(), Value::Object(source));
    }
    Ok(Invocation { name, args: Value::Object(obj), dir, json })
}

/// `fmtElapsed` on the card: 45s, 4m 05s, 1h 02m.
fn elapsed(ms: u64) -> String {
    let s = ms / 1000;
    if s < 60 { return format!("{s}s") }
    let m = s / 60;
    if m < 60 { return format!("{m}m {:02}s", s % 60) }
    format!("{}h {:02}m", m / 60, m % 60)
}

/// `run list`: one row per run, newest first, then the summary.
fn render_run_list(out: &Outcome) -> String {
    let row = |c: [&str; 6]| format!("{:>5}  {:<11}  {:>5}  {:<6}  {:<7}  {}\n", c[0], c[1], c[2], c[3], c[4], c[5]);
    let mut s = row(["round", "state", "lanes", "cost", "elapsed", "needs you"]);
    for r in out.data["runs"].as_array().cloned().unwrap_or_default() {
        let (round, lanes, ny) = (r["round"].as_u64().unwrap_or(0).to_string(), r["lanes"].as_u64().unwrap_or(0).to_string(), r["needs_you"].as_u64().unwrap_or(0).to_string());
        let cost = format!("${:.2}", r["cost_usd"].as_f64().unwrap_or(0.0));
        let el = elapsed(r["elapsed_ms"].as_u64().unwrap_or(0));
        s.push_str(&row([&round, r["state"].as_str().unwrap_or(""), &lanes, &cost, &el, &ny]));
    }
    s.push_str(&format!("{}\n", out.summary));
    s
}

/// `run state`: the summary, each lane with its try, checks, leaks and last line, then
/// what needs the user with the `--act` each row takes.
fn render_run_state(out: &Outcome) -> String {
    let mut s = format!("{}\n", out.summary);
    for l in out.data["lanes"].as_array().cloned().unwrap_or_default() {
        let id = l["id"].as_str().unwrap_or("").to_uppercase();
        let title = l["title"].as_str().map(|t| format!(" · {t}")).unwrap_or_default();
        let tries = l["attempt"].as_u64().filter(|n| *n > 0).map(|n| format!(" · try {n}")).unwrap_or_default();
        s.push_str(&format!("lane {id}{title} · {}{tries}\n", l["state"].as_str().unwrap_or("")));
        if let Some(g) = l["gates"].as_array().and_then(|g| g.last()) {
            let checks: Vec<String> = g["checks"].as_array().cloned().unwrap_or_default().iter()
                .map(|c| format!("{} → {}", c["name"].as_str().unwrap_or(""), if c["pass"] == true { "pass" } else { "fail" })).collect();
            if !checks.is_empty() { s.push_str(&format!("  {}\n", checks.join(" · "))); }
        }
        let leak: Vec<&str> = l["leak"].as_array().map(|a| a.iter().filter_map(|p| p.as_str()).collect()).unwrap_or_default();
        if !leak.is_empty() { s.push_str(&format!("  also touched: {}\n", leak.join(", "))); }
        if let Some(last) = l["last_line"].as_str() { s.push_str(&format!("  last: {last}\n")); }
    }
    let rows = out.data["needs_you"].as_array().cloned().unwrap_or_default();
    if !rows.is_empty() {
        s.push_str("needs you:\n");
        for x in rows {
            let lane = x["lane"].as_str().map(|l| format!(" · lane {}", l.to_uppercase())).unwrap_or_default();
            let item = x["item"].as_str().map(|i| format!(" · {i}")).unwrap_or_default();
            s.push_str(&format!("  {} · {}{lane}{item}: {}\n", x["index"], x["kind"].as_str().unwrap_or(""), x["reason"].as_str().unwrap_or("")));
            for act in x["acts"].as_array().cloned().unwrap_or_default() {
                // one shell word: a quote inside the JSON closes and reopens the quoting
                let word = act.to_string().replace('\'', "'\\''");
                // a rewrite is the user's new wording, never a placeholder Chronicle invents
                let more = if act["kind"] == "rewrite" { "   (add \"text\": the item's new wording, from the user)" } else { "" };
                s.push_str(&format!("    --act '{word}'{more}\n"));
            }
        }
    }
    s
}

/// The list tables (notes, runs) and the run view; other capabilities print the summary.
pub(crate) fn render_table(name: &str, out: &Outcome) -> String {
    if name == "chronicle.run.list" { return render_run_list(out) }
    if name == "chronicle.run.state" { return render_run_state(out) }
    if name != "chronicle.notes.list" { return format!("{}\n", out.summary) }
    let mut s = String::new();
    let cell = |v: &Value| v.as_str().map(str::to_string).or_else(|| v.as_u64().map(|n| n.to_string())).unwrap_or_else(|| "·".into());
    for n in out.data["notes"].as_array().cloned().unwrap_or_default() {
        let tags = n["tags"].as_array().map(|a| a.iter().filter_map(|t| t.as_str()).collect::<Vec<_>>().join(",")).unwrap_or_default();
        s.push_str(&format!("{:<5}  {:<11}  {:>1}  {:<4} {}\n", cell(&n["id"]), cell(&n["status"]), cell(&n["round"]), if tags.is_empty() { "·".to_string() } else { tags }, n["path"].as_str().unwrap_or("")));
    }
    s.push_str(&format!("{}\n", out.summary));
    s
}

/// Which project the call runs in. Every capability but one answers about the project
/// the shell is standing in, so that project has to exist. `project open` is the
/// exception: it NAMES the folder, and needing to already be inside a Chronicle project
/// to open another one would make it useless from anywhere a person actually types it.
fn project_dir_for(name: &str, start: &Path) -> Result<PathBuf, String> {
    if name == "chronicle.project.open" { return Ok(start.to_path_buf()) }
    agent_api::resolve_project_dir(start).ok_or_else(||
        format!("No Chronicle project here: nothing above {} holds chronicle.json or .chronicle/.", start.display()))
}

/// `Some(code)` when this was a CLI call (already printed); `None` to launch the app.
pub(crate) fn run(args: &[String]) -> Option<i32> {
    let first = args.first()?;
    if !GROUPS.iter().any(|(g, _)| g == first) { return None }
    let inv = match parse(args) {
        Ok(i) => i,
        Err(Usage(u)) => { eprintln!("{u}"); return Some(2) }
    };
    let start = inv.dir.clone().unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));
    let dir = match project_dir_for(&inv.name, &start) {
        Ok(d) => d,
        Err(e) => { eprintln!("{e}"); return Some(1) }
    };
    match agent_api::call(&dir, &inv.name, &inv.args) {
        Ok(out) => {
            if inv.json { println!("{}", serde_json::to_string_pretty(&json!({ "summary": out.summary, "data": out.data })).unwrap()); }
            else { print!("{}", render_table(&inv.name, &out)); }
            Some(0)
        }
        Err(e) => { eprintln!("{e}"); Some(1) }
    }
}

/* ================= the launch plan: what a command line that is NOT a verb gets ==========
   Everything the binary is asked for that isn't a capability verb, `--mcp`, `--derive` or
   `--state` ends here. Only a bare launch or `--open <dir>` may reach the desktop app: a
   rebuild agent once ran `chronicle --help` to see whether the CLI existed, and every
   such probe opened another Chronicle window (round 8, Tasks/Untitled.md). */

#[derive(Debug, PartialEq)]
pub(crate) enum Launch {
    /// The ONLY path that reaches `tauri::Builder`.
    Gui { open: Option<String> },
    /// Usage on stdout, exit 0.
    Help,
    /// `chronicle <version>` on stdout, exit 0.
    Version,
    /// One sentence on stderr, exit 2. Never a window.
    Usage(String),
}

/// The forms the binary knows, one per line, for `--help` and for the refusal.
pub(crate) fn help_text() -> String {
    let groups = GROUPS.iter().map(|(g, _)| *g).collect::<Vec<_>>().join("|");
    format!(
        "Chronicle {}\n\n\
         Usage:\n\
         \x20 chronicle                          open the app\n\
         \x20 chronicle --open <dir>             open the app on that project\n\
         \x20 chronicle --derive <dir>           the derived roadmap state as JSON (exit 1 on a broken manifest)\n\
         \x20 chronicle --state <dir>            the full project state as JSON\n\
         \x20 chronicle --mcp <dir>              serve the capability catalog over MCP on stdin/stdout\n\
         \x20 chronicle <{groups}> <verb> [--flag value] [--json] [dir]\n\
         \x20                                    the same catalog from the shell (chronicle <group> for its verbs)\n\
         \x20 chronicle --version                print the version\n\
         \x20 chronicle --help                   this text\n\n\
         Any other command line is refused with this text and exit code 2 instead of opening the app.\n",
        crate::mcp::app_version()
    )
}

/// `args` is everything after argv[0], with the verb groups, `--mcp`, `--derive` and
/// `--state` already answered by the caller. Left to right, first decision wins.
pub(crate) fn launch_plan(args: &[String]) -> Launch {
    let mut open = None;
    let mut i = 0;
    while i < args.len() {
        let a = args[i].as_str();
        match a {
            "--help" | "-h" | "help" => return Launch::Help,
            "--version" | "-V" | "version" => return Launch::Version,
            "--open" => {
                let Some(v) = args.get(i + 1).filter(|v| !v.starts_with("--")) else {
                    return Launch::Usage("--open needs a folder.".into());
                };
                if open.is_some() { return Launch::Usage("Only one folder can be given to --open.".into()) }
                open = Some(v.clone());
                i += 2;
                continue;
            }
            // legacy LaunchServices process serial numbers: noise, not a request
            _ if a.starts_with("-psn_") => {}
            _ => return Launch::Usage(format!("Unknown argument {a}. Run chronicle --help for the forms Chronicle knows.")),
        }
        i += 1;
    }
    Launch::Gui { open }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn a(s: &str) -> Vec<String> { s.split_whitespace().map(String::from).collect() }

    /// The desktop app is what a command line that nobody recognises used to get: a
    /// rebuild agent ran `chronicle --help` to see whether the CLI existed and opened a
    /// second Chronicle window every time. Only a bare launch or `--open <dir>` reaches
    /// the app now; everything else is words on the terminal and an exit code.
    #[test]
    fn only_a_bare_launch_or_open_reaches_the_app() {
        assert!(matches!(launch_plan(&[]), Launch::Gui { open: None }));
        assert!(matches!(launch_plan(&a("--open /tmp/x")), Launch::Gui { open: Some(ref d) } if d == "/tmp/x"));
        // legacy LaunchServices process serial numbers are noise, not a request
        assert!(matches!(launch_plan(&a("-psn_0_12345")), Launch::Gui { open: None }));
        assert!(matches!(launch_plan(&a("--open /tmp/x -psn_0_1")), Launch::Gui { open: Some(ref d) } if d == "/tmp/x"));
        assert!(matches!(launch_plan(&a("--open")), Launch::Usage(ref u) if u == "--open needs a folder."));
        assert!(matches!(launch_plan(&a("--open /a --open /b")), Launch::Usage(ref u) if u == "Only one folder can be given to --open."));
    }

    #[test]
    fn help_and_version_are_words_not_windows() {
        for form in ["--help", "-h", "help"] {
            assert!(matches!(launch_plan(&a(form)), Launch::Help), "{form}");
        }
        // whatever follows --help is irrelevant: the person asked for help
        assert!(matches!(launch_plan(&a("--help | head -5")), Launch::Help));
        for form in ["--version", "-V", "version"] {
            assert!(matches!(launch_plan(&a(form)), Launch::Version), "{form}");
        }
        let h = help_text();
        for line in ["chronicle --open <dir>", "chronicle --derive <dir>", "chronicle --state <dir>", "chronicle --mcp <dir>",
                     "chronicle <notes|state|round|run|project|terminal|designs> <verb> [--flag value] [--json] [dir]", "chronicle --version"] {
            assert!(h.contains(line), "help text is missing {line:?}:\n{h}");
        }
        assert!(!h.contains('\u{2014}'), "no em dash in the help text");
    }

    #[test]
    fn anything_else_is_refused_instead_of_opening_the_app() {
        assert!(matches!(launch_plan(&a("--bogus")), Launch::Usage(ref u)
            if u == "Unknown argument --bogus. Run chronicle --help for the forms Chronicle knows."));
        assert!(matches!(launch_plan(&a("roadmap")), Launch::Usage(ref u)
            if u == "Unknown argument roadmap. Run chronicle --help for the forms Chronicle knows."));
        assert!(matches!(launch_plan(&a("--open /tmp/x extra")), Launch::Usage(ref u)
            if u == "Unknown argument extra. Run chronicle --help for the forms Chronicle knows."));
        // --derive, --state and --mcp are answered BEFORE the launch plan is consulted (main);
        // if one ever reaches it, it is refused rather than turned into a window
        for form in ["--derive .", "--state .", "--mcp ."] {
            assert!(matches!(launch_plan(&a(form)), Launch::Usage(_)), "{form}");
        }
    }

    #[test]
    fn flags_become_the_same_json_args_mcp_sends() {
        let i = parse(&a("notes list --status queued --round 3 --tag ui --tag bug --limit 5 --json /tmp/p")).unwrap();
        assert_eq!(i.name, "chronicle.notes.list");
        assert_eq!(i.args, json!({"status": "queued", "round": 3, "tag": ["ui", "bug"], "limit": 5}));
        assert!(i.json);
        assert_eq!(i.dir, Some(PathBuf::from("/tmp/p")));
        let i = parse(&a("notes update --path Tasks/A.md --set status=done --set owner=me --unset weird")).unwrap();
        assert_eq!(i.args, json!({"path": "Tasks/A.md", "set": {"status": "done", "owner": "me"}, "unset": ["weird"]}));
        assert_eq!(i.dir, None);
        let i = parse(&a("notes create --title Hello --tags bug,ui")).unwrap();
        assert_eq!(i.args["tags"], json!(["bug", "ui"]));
        let i = parse(&a("state phases")).unwrap();
        assert_eq!(i.name, "chronicle.state.phases");
    }

    #[test]
    fn the_action_groups_reach_the_running_app() {
        let i = parse(&a("round plan")).unwrap();
        assert_eq!(i.name, "chronicle.round.plan");
        assert_eq!(i.args, json!({}));
        let i = parse(&a("round start --n 3 --where terminal")).unwrap();
        assert_eq!(i.name, "chronicle.round.start");
        assert_eq!(i.args, json!({"n": 3, "where": "terminal"}));
        let i = parse(&a("terminal read --lines 50 --id 7")).unwrap();
        assert_eq!(i.name, "chronicle.terminal.read");
        assert_eq!(i.args, json!({"lines": 50, "id": 7}));
        // `project open <path>`: the positional is the folder to OPEN, not the project
        // the call runs in — that one is wherever the shell already is
        let i = parse(&a("project open /tmp/x")).unwrap();
        assert_eq!(i.name, "chronicle.project.open");
        assert_eq!(i.args, json!({"dir": "/tmp/x"}));
        assert_eq!(i.dir, None);
        let i = parse(&a("project open /tmp/x --json")).unwrap();
        assert!(i.json);
        assert_eq!(i.args, json!({"dir": "/tmp/x"}));
        assert_eq!(parse(&a("project open /tmp/x /tmp/y")).unwrap_err().0, "Only one folder can be given to project open.");
        assert_eq!(parse(&a("round start --n three")).unwrap_err().0, "--n must be a whole number.");
        assert_eq!(parse(&a("round")).unwrap_err().0, "Usage: chronicle round <plan|start> [--flag value] [--json] [dir].");
    }

    /// `chronicle project open ~/code/foo` has to work from anywhere a person types it.
    /// Every other verb answers about the project the shell is standing in, so that one
    /// still has to be found before the call goes anywhere.
    #[test]
    fn opening_a_project_does_not_need_the_shell_to_already_be_in_one() {
        let d = std::env::temp_dir().join(format!("chronicle-cli-start-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        let elsewhere = d.join("elsewhere");
        std::fs::create_dir_all(&elsewhere).unwrap();
        let elsewhere = elsewhere.canonicalize().unwrap();
        // from a folder that is not a Chronicle project and has none above it either
        assert!(agent_api::resolve_project_dir(&elsewhere).is_none(), "nothing above {} is a project", elsewhere.display());

        // project open gets past resolution and is handed the folder it started from
        assert_eq!(project_dir_for("chronicle.project.open", &elsewhere).unwrap(), elsewhere);
        // everything else still stops here, with the sentence that says why
        assert_eq!(project_dir_for("chronicle.notes.list", &elsewhere).unwrap_err(),
                   format!("No Chronicle project here: nothing above {} holds chronicle.json or .chronicle/.", elsewhere.display()));

        // and inside a project, every verb resolves to the project root
        let proj = d.join("proj");
        std::fs::create_dir_all(proj.join(".chronicle")).unwrap();
        let proj = proj.canonicalize().unwrap();
        assert_eq!(project_dir_for("chronicle.notes.list", &proj).unwrap(), proj);
    }

    #[test]
    fn usage_errors_are_one_sentence_and_not_an_app_launch() {
        assert_eq!(parse(&a("notes")).unwrap_err().0, "Usage: chronicle notes <list|read|create|update|set_status|attach> [--flag value] [--json] [dir].");
        assert!(parse(&a("notes frobnicate")).unwrap_err().0.starts_with("No capability named chronicle.notes.frobnicate."));
        assert_eq!(parse(&a("notes list --status")).unwrap_err().0, "--status needs a value.");
        // one bare argument is the project directory; a second one is a typo, not a silent overwrite
        assert_eq!(parse(&a("notes list /tmp/a /tmp/b")).unwrap_err().0, "Only one project directory can be given.");
        assert!(parse(&a("")).is_err());
        // not a CLI call at all: the app launches
        assert_eq!(run(&a("--open /tmp/x")), None);
        assert_eq!(run(&[]), None);
    }

    #[test]
    fn the_table_reads_like_the_app() {
        let out = Outcome { summary: "2 notes.".into(), data: json!({"notes": [
            {"path": "Tasks/T-001 A.md", "id": "T-001", "status": "done", "round": 1, "tags": ["ui"]},
            {"path": "Ideas/B.md", "id": null, "status": null, "round": null, "tags": []}]}) };
        let t = render_table("chronicle.notes.list", &out);
        assert_eq!(t, "T-001  done         1  ui   Tasks/T-001 A.md\n·      ·            ·  ·    Ideas/B.md\n2 notes.\n");
        let out = Outcome { summary: "A done.".into(), data: json!({"x": 1}) };
        assert_eq!(render_table("chronicle.other", &out), "A done.\n");
    }

    #[test]
    fn the_run_verbs_parse_to_the_same_args_the_tools_take() {
        let i = parse(&a("run state --n 10 --json")).unwrap();
        assert_eq!((i.name.as_str(), &i.args, i.json), ("chronicle.run.state", &json!({"n": 10}), true));
        assert_eq!(parse(&a("run list")).unwrap().args, json!({}));
        for v in ["stop", "resume"] {
            let i = parse(&a(&format!("run {v} --n 3"))).unwrap();
            assert_eq!((i.name, i.args), (format!("chronicle.run.{v}"), json!({"n": 3})));
        }
        // begin folds --kind/--path/--text into the one source the tool takes
        assert_eq!(parse(&a("run begin --kind notes /tmp/p")).unwrap().args, json!({"source": {"kind": "notes"}}));
        assert_eq!(parse(&a("run begin --kind plan --path fixes/phase_4_fixes_plan.md")).unwrap().args,
                   json!({"source": {"kind": "plan", "path": "fixes/phase_4_fixes_plan.md"}}));
        let i = parse(&["run".into(), "begin".into(), "--kind".into(), "prompt".into(), "--text".into(), "tidy the copy".into()]).unwrap();
        assert_eq!(i.args, json!({"source": {"kind": "prompt", "text": "tidy the copy"}}));
        assert_eq!(parse(&a("run begin")).unwrap_err().0, "--kind is required: notes, plan or prompt.");
        // --act is JSON, handed over as the object NeedsAct reads
        let i = parse(&["run".into(), "needs_you".into(), "--n".into(), "2".into(), "--act".into(), r#"{"kind":"skip","item":"T-3"}"#.into()]).unwrap();
        assert_eq!(i.args, json!({"n": 2, "act": {"kind": "skip", "item": "T-3"}}));
        assert_eq!(parse(&a("run needs_you --n 2 --act skip")).unwrap_err().0, "--act takes JSON, like '{\"kind\":\"recheck\"}'.");
        let i = parse(&["run".into(), "lane_nudge".into(), "--n".into(), "2".into(), "--lane".into(), "a".into(), "--text".into(), "look at b.ts".into()]).unwrap();
        assert_eq!(i.args, json!({"n": 2, "lane": "a", "text": "look at b.ts"}));
        assert_eq!(parse(&a("run lane_discard --n 2 --lane b")).unwrap().args, json!({"n": 2, "lane": "b"}));
        assert_eq!(parse(&a("run")).unwrap_err().0,
                   "Usage: chronicle run <begin|list|state|stop|resume|needs_you|lane_nudge|lane_discard> [--flag value] [--json] [dir].");
    }

    #[test]
    fn a_run_list_and_a_run_state_read_like_the_card() {
        let out = Outcome { summary: "2 runs · round 2 needs you · round 1 done.".into(), data: json!({"runs": [
            {"n": 2, "round": 2, "state": "needs you", "lanes": 2, "cost_usd": 0.25, "elapsed_ms": 245_000, "needs_you": 2},
            {"n": 1, "round": 1, "state": "done", "lanes": 1, "cost_usd": 0.5, "elapsed_ms": 45_000, "needs_you": 0}]}) };
        let want = [
            "round  state        lanes  cost    elapsed  needs you",
            "    2  needs you        2  $0.25   4m 05s   2",
            "    1  done             1  $0.50   45s      0",
            "2 runs · round 2 needs you · round 1 done.",
        ];
        assert_eq!(render_table("chronicle.run.list", &out), want.iter().map(|l| format!("{l}\n")).collect::<String>());

        let out = Outcome { summary: "Round 2 · needs you · 2 lanes · $0.25.".into(), data: json!({
            "lanes": [
                {"id": "a", "title": "Crash fix", "state": "being checked", "attempt": 2, "leak": ["src/c.ts"], "last_line": "Fixed it.",
                 "gates": [{"fix": 0, "checks": [{"name": "test", "pass": true}, {"name": "lint", "pass": false}]}]},
                {"id": "b", "title": "Copy", "state": "needs you", "attempt": 3, "leak": [], "last_line": null, "gates": []}],
            "needs_you": [{"index": 0, "kind": "parked", "lane": "b", "item": "T-3", "reason": "it names a file that isn't there",
                           "acts": [{"kind": "skip", "item": "T-3"}, {"kind": "rewrite", "item": "T-3"}]},
                          {"index": 1, "kind": "parked", "lane": "b", "item": "it's", "reason": "r", "acts": [{"kind": "skip", "item": "it's"}]}]}) };
        assert_eq!(render_table("chronicle.run.state", &out),
            "Round 2 · needs you · 2 lanes · $0.25.\n\
             lane A · Crash fix · being checked · try 2\n\
             \x20 test → pass · lint → fail\n\
             \x20 also touched: src/c.ts\n\
             \x20 last: Fixed it.\n\
             lane B · Copy · needs you · try 3\n\
             needs you:\n\
             \x20 0 · parked · lane B · T-3: it names a file that isn't there\n\
             \x20   --act '{\"kind\":\"skip\",\"item\":\"T-3\"}'\n\
             \x20   --act '{\"kind\":\"rewrite\",\"item\":\"T-3\"}'   (add \"text\": the item's new wording, from the user)\n\
             \x20 1 · parked · lane B · it's: r\n\
             \x20   --act '{\"kind\":\"skip\",\"item\":\"it'\\''s\"}'\n");
    }

    #[test]
    fn designs_bench_and_capture_parse_with_a_bare_quick_flag() {
        let a = |s: &str| s.split_whitespace().map(String::from).collect::<Vec<_>>();
        let i = parse(&a("designs bench --quick --kind app")).unwrap();
        assert_eq!(i.name, "chronicle.designs.bench");
        assert_eq!(i.args, json!({ "quick": true, "kind": "app" }));
        let i = parse(&a("designs capture --slug home --frame desktop")).unwrap();
        assert_eq!(i.args, json!({ "slug": "home", "frame": "desktop" }));
        assert_eq!(parse(&a("designs lint --slug home")).unwrap().name, "chronicle.designs.lint");
    }
}
