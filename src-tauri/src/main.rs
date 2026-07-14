// Chronicle — a manifest-driven build companion for ANY project.
// A project = any folder with a chronicle.json (written by the /chronicle-init skill).
// The manifest declares the roadmap; this app DERIVES all state deterministically
// (git + filesystem rules) and never stores anything of its own beyond a recents list.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use base64::Engine;
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use regex::Regex;
use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager, State};

/* ================= project model ================= */

#[derive(Clone)]
struct Project {
    dir: PathBuf,                       // the folder that was opened (holds chronicle.json)
    repo: PathBuf,                      // git root (manifest roots.repo, relative to dir)
    extras: Vec<(String, PathBuf)>,     // alias -> absolute path
    manifest: Option<Value>,            // None => no/invalid manifest (degraded view)
    manifest_error: Option<String>,
}

/// Background /chronicle-init runs, keyed by the CANONICALIZED project path (same-named
/// folders in different places must never share a run or a log).
struct InitState {
    runs: Mutex<std::collections::HashMap<String, (std::process::Child, PathBuf)>>,
}

/// The trust anchor: the set of project roots the USER opened (open_project /
/// create_project / the recents list). Every path-taking command resolves its `dir`
/// against this allowlist — an arbitrary `dir` from the webview is rejected, so the
/// per-project jail can't be relocated by the caller.
struct OpenRoots(Mutex<HashSet<PathBuf>>);

/// Canonical key + a collision-free log path for an init run.
fn canon_key(dir: &str) -> Result<(String, PathBuf), String> {
    let canon = PathBuf::from(dir).canonicalize().map_err(|e| e.to_string())?;
    let key = canon.to_string_lossy().to_string();
    let mut h = Sha256::new();
    h.update(key.as_bytes());
    let hex = format!("{:x}", h.finalize());
    let log = std::env::temp_dir().join(format!("chronicle-init-{}.log", &hex[..16]));
    Ok((key, log))
}

/// SIGTERM, give the child a moment to exit cleanly, then SIGKILL; always reap.
fn term_then_kill(child: &mut std::process::Child) {
    let pid = child.id() as i32;
    unsafe { libc::kill(pid, libc::SIGTERM) };
    for _ in 0..20 {
        if let Ok(Some(_)) = child.try_wait() { return; }
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
    let _ = child.kill();
    let _ = child.wait();
}

/* ================= agents (Claude Code · Codex) ================= */

/// Resolve agent binaries through a login shell: GUI apps have a minimal PATH,
/// so a bare `claude`/`codex` would fail on a Finder-launched install.
fn agent_paths() -> (Option<String>, Option<String>) {
    let out = Command::new("/bin/zsh")
        .args(["-lc", "command -v claude; echo ---; command -v codex"])
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
        .unwrap_or_default();
    let mut parts = out.split("---");
    let claude = parts.next().map(|x| x.trim().to_string()).filter(|x| !x.is_empty());
    let codex = parts.next().map(|x| x.trim().to_string()).filter(|x| !x.is_empty());
    (claude, codex)
}

fn load_config() -> Value {
    std::fs::read_to_string(config_dir().join("config.json"))
        .ok().and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| json!({}))
}

#[tauri::command]
fn agents_available() -> Value {
    let (claude, codex) = agent_paths();
    let cfg = load_config();
    let pref = cfg.get("agent").and_then(|v| v.as_str()).unwrap_or("");
    let default = match pref {
        "codex" if codex.is_some() => "codex",
        "claude" if claude.is_some() => "claude",
        _ if claude.is_some() => "claude",
        _ if codex.is_some() => "codex",
        _ => "",
    };
    json!({ "claude": claude, "codex": codex, "default": default })
}

#[tauri::command]
fn set_default_agent(agent: String) -> Result<(), String> {
    let mut cfg = load_config();
    if let Some(obj) = cfg.as_object_mut() { obj.insert("agent".into(), json!(agent)); }
    let _ = std::fs::create_dir_all(config_dir());
    std::fs::write(config_dir().join("config.json"),
        serde_json::to_string_pretty(&cfg).unwrap_or_default()).map_err(|e| e.to_string())
}

/// Codex has no skill system, so the whole task travels inline as the prompt.
const CODEX_INIT_PROMPT_HEAD: &str = "You are running the chronicle-init task in the current working directory (the folder the user opened in the Chronicle app). Follow the instructions below exactly. The referenced example files are not available to you; follow the schema strictly instead. Where the instructions mention naming the destination tool for paste rows, use \"Codex\" for terminal prompts if this project is worked with Codex.\n\n";

fn config_dir() -> PathBuf {
    PathBuf::from(std::env::var("HOME").unwrap_or_default())
        .join("Library/Application Support/Chronicle")
}

fn load_recents() -> Vec<Value> {
    std::fs::read_to_string(config_dir().join("recents.json"))
        .ok()
        .and_then(|s| serde_json::from_str::<Vec<Value>>(&s).ok())
        .unwrap_or_default()
}

fn save_recents(recents: &[Value]) {
    let _ = std::fs::create_dir_all(config_dir());
    let _ = std::fs::write(
        config_dir().join("recents.json"),
        serde_json::to_string_pretty(recents).unwrap_or_default(),
    );
}

fn load_project(dir: &Path) -> Project {
    let mpath = dir.join("chronicle.json");
    let (manifest, manifest_error) = match std::fs::read_to_string(&mpath) {
        Err(_) => (None, None), // missing — a valid degraded state
        Ok(text) => match serde_json::from_str::<Value>(&text) {
            Ok(v) => (Some(v), None),
            Err(e) => (None, Some(format!("{e}"))),
        },
    };
    let mut repo = dir.to_path_buf();
    let mut extras = Vec::new();
    if let Some(m) = &manifest {
        if let Some(r) = m.pointer("/roots/repo").and_then(|v| v.as_str()) {
            let p = if Path::new(r).is_absolute() { PathBuf::from(r) } else { dir.join(r) };
            if p.exists() { repo = p.canonicalize().unwrap_or(p); }
        }
        if let Some(arr) = m.pointer("/roots/extra").and_then(|v| v.as_array()) {
            for e in arr {
                if let (Some(alias), Some(path)) =
                    (e.get("alias").and_then(|v| v.as_str()), e.get("path").and_then(|v| v.as_str()))
                {
                    let p = if Path::new(path).is_absolute() { PathBuf::from(path) } else { dir.join(path) };
                    let p = p.canonicalize().unwrap_or(p);
                    extras.push((alias.to_string(), p));
                }
            }
        }
    }
    Project { dir: dir.to_path_buf(), repo, extras, manifest, manifest_error }
}

/* ================= git + condition context ================= */

fn git_in(repo: &Path, args: &[&str]) -> String {
    git_in_checked(repo, args).unwrap_or_default()
}

/// Err ONLY when git itself couldn't run (missing binary / spawn failure). A broken
/// environment must surface as DEGRADED — never silently derive "0 commits / not a
/// repo" from it. (A normal non-zero git exit, e.g. not-a-repo, is still empty output.)
fn git_in_checked(repo: &Path, args: &[&str]) -> Result<String, String> {
    Command::new("git").arg("-C").arg(repo).args(args).output()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .map_err(|e| e.to_string())
}

struct Ctx {
    repo: PathBuf,
    extras: Vec<(String, PathBuf)>,
    tags: HashSet<String>,
    subjects: Vec<String>,
}

impl Ctx {
    fn build(p: &Project) -> Ctx {
        Ctx {
            repo: p.repo.clone(),
            extras: p.extras.clone(),
            tags: git_in(&p.repo, &["tag"]).lines().map(String::from).collect(),
            // bounded + --all: the doc promises "the last 200 subjects", and the graph
            // shows all branches — the rules must see the same history the user sees.
            subjects: git_in(&p.repo, &["log", "--all", "-n", "200", "--format=%s"]).lines().map(String::from).collect(),
        }
    }
    fn resolve(&self, path: &str) -> PathBuf {
        if let Some(rest) = path.strip_prefix('@') {
            if let Some((alias, tail)) = rest.split_once('/') {
                if let Some((_, base)) = self.extras.iter().find(|(a, _)| a == alias) {
                    return base.join(tail);
                }
            } else if let Some((_, base)) = self.extras.iter().find(|(a, _)| a == rest) {
                return base.clone();
            }
        }
        self.repo.join(path)
    }

    /// The jailed resolve for MANIFEST-DECLARED paths (conditions, docs, generatedFrom).
    /// Manifest content is data, never trusted: absolute paths and `..` traversal are
    /// rejected outright; the resolved path (symlinks followed) must stay inside a
    /// declared root. Returns None for anything that escapes or doesn't exist.
    fn resolve_jailed(&self, path: &str) -> Option<PathBuf> {
        if Path::new(path).is_absolute() { return None; }
        if Path::new(path).components().any(|c| matches!(c, std::path::Component::ParentDir)) {
            return None;
        }
        let full = self.resolve(path);
        let canon = full.canonicalize().ok()?; // nonexistent → None (file_exists = false)
        let mut roots: Vec<&PathBuf> = vec![&self.repo];
        roots.extend(self.extras.iter().map(|(_, b)| b));
        for r in roots {
            if let Ok(cr) = r.canonicalize() {
                if canon.starts_with(&cr) { return Some(canon); }
            }
        }
        None
    }
}

/// One condition. Supported keys (exactly one per object, plus optional "not": true):
///   tag              — a git tag with this exact name exists
///   file_exists      — the path exists (roots-relative; "@alias/…" for extra roots)
///   file_matches     — { path, pattern } — regex (multiline) matches the file's contents
///   commit_subject   — regex matches any commit subject in the log
///   file_glob        — { dir?, contains } — some entry in dir (default the project dir)
///                      whose lowercased name contains this string exists
/// Three-valued: Some(bool) for a recognized rule, None for an UNKNOWN condition.
/// Unknown is unknown — it never satisfies, even under "not": true (a typo'd rule must
/// not silently flip a phase done). Validation (validate_manifest) surfaces the typo.
fn eval_cond(ctx: &Ctx, cond: &Value) -> Option<bool> {
    let negate = cond.get("not").and_then(|v| v.as_bool()).unwrap_or(false);
    let result = (|| {
        if let Some(t) = cond.get("tag").and_then(|v| v.as_str()) {
            return Some(ctx.tags.contains(t));
        }
        if let Some(p) = cond.get("file_exists").and_then(|v| v.as_str()) {
            return Some(ctx.resolve_jailed(p).is_some());
        }
        if let Some(fm) = cond.get("file_matches") {
            if let (Some(p), Some(pat)) = (
                fm.get("path").and_then(|v| v.as_str()),
                fm.get("pattern").and_then(|v| v.as_str()),
            ) {
                let Some(full) = ctx.resolve_jailed(p) else { return Some(false) };
                let text = std::fs::read_to_string(full).unwrap_or_default();
                return Some(Regex::new(&format!("(?m){pat}")).map(|re| re.is_match(&text)).unwrap_or(false));
            }
            return Some(false);
        }
        if let Some(pat) = cond.get("commit_subject").and_then(|v| v.as_str()) {
            if let Ok(re) = Regex::new(pat) {
                return Some(ctx.subjects.iter().any(|s| re.is_match(s)));
            }
            return Some(false);
        }
        if let Some(wb) = cond.get("worktree_branch").and_then(|v| v.as_str()) {
            // LINKED worktrees only — the primary checkout (first block) being on a
            // branch is normal life, not a leftover workspace.
            return Some(git_in(&ctx.repo, &["worktree", "list", "--porcelain"])
                .split("\n\n").skip(1)
                .any(|b| b.lines().any(|l| l.strip_prefix("branch refs/heads/") == Some(wb))));
        }
        if let Some(fg) = cond.get("file_glob") {
            let dir = match fg.get("dir").and_then(|v| v.as_str()) {
                Some(d) => match ctx.resolve_jailed(d) { Some(p) => p, None => return Some(false) },
                None => ctx.repo.clone(),
            };
            // "contains" is REQUIRED — an omitted needle must not match everything
            let Some(needle) = fg.get("contains").and_then(|v| v.as_str()) else { return None };
            let needle = needle.to_lowercase();
            if let Ok(rd) = std::fs::read_dir(dir) {
                return Some(rd.flatten().any(|e| e.file_name().to_string_lossy().to_lowercase().contains(&needle)));
            }
            return Some(false);
        }
        None // unknown condition key
    })();
    result.map(|r| if negate { !r } else { r })
}

fn all_conds(ctx: &Ctx, conds: Option<&Value>) -> bool {
    match conds.and_then(|v| v.as_array()) {
        None => false,
        Some(arr) => !arr.is_empty() && arr.iter().all(|c| eval_cond(ctx, c) == Some(true)),
    }
}
fn any_conds(ctx: &Ctx, conds: Option<&Value>) -> bool {
    match conds.and_then(|v| v.as_array()) {
        None => false,
        Some(arr) => arr.iter().any(|c| eval_cond(ctx, c) == Some(true)),
    }
}

/// The ONE definition of "does this manifest action fire" — an omitted `when` means
/// always-on. (get_state and get_picker previously disagreed on this.)
fn action_fires(ctx: &Ctx, action: &Value) -> bool {
    match action.get("when") {
        None => true,
        Some(w) => all_conds(ctx, Some(w)),
    }
}

/* ================= manifest validation (structured warnings) ================= */

const KNOWN_COND_KEYS: [&str; 6] =
    ["tag", "file_exists", "file_matches", "commit_subject", "worktree_branch", "file_glob"];
const SUPPORTED_CHRONICLE_VERSION: u64 = 1;

fn validate_conds(conds: Option<&Value>, at: &str, warns: &mut Vec<String>) {
    let Some(arr) = conds.and_then(|v| v.as_array()) else { return };
    for c in arr {
        let Some(obj) = c.as_object() else {
            warns.push(format!("{at}: a condition must be an object"));
            continue;
        };
        let keys: Vec<&str> = obj.keys().map(|k| k.as_str()).filter(|k| *k != "not").collect();
        let known: Vec<&&str> = keys.iter().filter(|k| KNOWN_COND_KEYS.contains(*k)).collect();
        if known.len() != 1 {
            warns.push(format!(
                "{at}: a condition needs exactly one known rule key (got {keys:?}) — this rule can't be checked"
            ));
            continue;
        }
        if let Some(fm) = obj.get("file_matches") {
            match (fm.get("path").and_then(|v| v.as_str()), fm.get("pattern").and_then(|v| v.as_str())) {
                (Some(p), Some(pat)) => {
                    if Regex::new(&format!("(?m){pat}")).is_err() {
                        warns.push(format!("{at}: file_matches pattern {pat:?} isn't a valid regex"));
                    }
                    check_manifest_path(p, at, warns);
                }
                _ => warns.push(format!("{at}: file_matches needs both path and pattern")),
            }
        }
        if let Some(pat) = obj.get("commit_subject").and_then(|v| v.as_str()) {
            if Regex::new(pat).is_err() {
                warns.push(format!("{at}: commit_subject pattern {pat:?} isn't a valid regex"));
            }
        }
        if let Some(fg) = obj.get("file_glob") {
            if fg.get("contains").and_then(|v| v.as_str()).is_none() {
                warns.push(format!("{at}: file_glob needs \"contains\" — this rule can't be checked"));
            }
            if let Some(d) = fg.get("dir").and_then(|v| v.as_str()) { check_manifest_path(d, at, warns); }
        }
        if let Some(p) = obj.get("file_exists").and_then(|v| v.as_str()) { check_manifest_path(p, at, warns); }
    }
}

fn check_manifest_path(p: &str, at: &str, warns: &mut Vec<String>) {
    if Path::new(p).is_absolute() {
        warns.push(format!("{at}: path {p:?} is absolute — paths are root-relative and this one will never resolve"));
    } else if Path::new(p).components().any(|c| matches!(c, std::path::Component::ParentDir)) {
        warns.push(format!("{at}: path {p:?} climbs out of the roots (\"..\") and will never resolve"));
    }
}

/// Every problem that would make a rule silently unevaluable, as plain sentences the
/// UI can count ("N rules in this roadmap can't be checked") and --derive can print.
fn validate_manifest(m: &Value) -> Vec<String> {
    let mut warns = Vec::new();
    if let Some(v) = m.get("chronicleVersion").and_then(|v| v.as_u64()) {
        if v > SUPPORTED_CHRONICLE_VERSION {
            warns.push(format!(
                "this roadmap is from a newer Chronicle (version {v}; this app understands {SUPPORTED_CHRONICLE_VERSION}) — statuses may be incomplete"
            ));
        }
    }
    let mut seen_ids: HashSet<String> = HashSet::new();
    if let Some(stages) = m.get("stages").and_then(|v| v.as_array()) {
        for st in stages {
            for ph in st.get("phases").and_then(|v| v.as_array()).cloned().unwrap_or_default() {
                let id = match ph.get("id").and_then(|v| v.as_str()) {
                    Some(i) => i.to_string(),
                    None => { warns.push("a phase is missing its \"id\"".into()); continue; }
                };
                if !seen_ids.insert(id.clone()) {
                    warns.push(format!("phase id {id:?} appears more than once — statuses for it are ambiguous"));
                }
                if let Some(status) = ph.get("status") {
                    validate_conds(status.get("done_when"), &format!("phase {id} done_when"), &mut warns);
                    if let Some(labels) = status.get("current_labels").and_then(|v| v.as_array()) {
                        for l in labels {
                            validate_conds(l.get("when"), &format!("phase {id} current_labels"), &mut warns);
                        }
                    }
                }
                for key in ["paste", "docs"] {
                    for d in ph.get(key).and_then(|v| v.as_array()).cloned().unwrap_or_default() {
                        if let Some(pp) = d.get("path").and_then(|v| v.as_str()) {
                            check_manifest_path(pp, &format!("phase {id} {key}"), &mut warns);
                        } else if key == "paste" && d.get("label").is_none() {
                            warns.push(format!("phase {id}: a paste row needs a path or a label"));
                        }
                    }
                }
            }
        }
    }
    if let Some(actions) = m.get("actions").and_then(|v| v.as_array()) {
        for (i, a) in actions.iter().enumerate() {
            validate_conds(a.get("when"), &format!("action {}", i + 1), &mut warns);
        }
    }
    warns
}

/* ================= status derivation ================= */

#[derive(Serialize, Clone)]
struct PhaseState {
    id: String,
    state: String, // done | now | later | window | pool
    label: String,
}

fn derive_statuses(ctx: &Ctx, manifest: &Value) -> Vec<PhaseState> {
    let mut out = Vec::new();
    let mut current_taken = false;
    let stages = manifest.get("stages").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    for stage in &stages {
        for phase in stage.get("phases").and_then(|v| v.as_array()).cloned().unwrap_or_default() {
            let id = phase.get("id").and_then(|v| v.as_str()).unwrap_or("?").to_string();
            let pool = phase.get("pool").and_then(|v| v.as_bool()).unwrap_or(false);
            let window = phase.get("window").and_then(|v| v.as_bool()).unwrap_or(false);
            let status = phase.get("status").cloned().unwrap_or(json!({}));
            let done = any_conds(ctx, status.get("done_when"));
            let labels = status.get("current_labels").and_then(|v| v.as_array()).cloned().unwrap_or_default();
            let pick_label = |fallback: &str| -> String {
                for l in &labels {
                    if all_conds(ctx, l.get("when")) {
                        return l.get("label").and_then(|v| v.as_str()).unwrap_or(fallback).to_string();
                    }
                }
                status.get("default_label").and_then(|v| v.as_str()).unwrap_or(fallback).to_string()
            };
            // kanban overlay phases carry their precomputed truth (from task columns)
            if let Some(frs) = phase.get("fixRoundState") {
                let rdone = frs.get("done").and_then(|v| v.as_bool()).unwrap_or(false);
                let label = frs.get("label").and_then(|v| v.as_str()).unwrap_or("ready to run").to_string();
                let ps = if rdone {
                    PhaseState { id, state: "done".into(), label: "done".into() }
                } else if !current_taken {
                    current_taken = true;
                    PhaseState { id, state: "now".into(), label }
                } else {
                    PhaseState { id, state: "later".into(), label }
                };
                out.push(ps);
                continue;
            }
            let ps = if pool {
                PhaseState { id, state: "pool".into(), label: "ideas".into() }
            } else if done {
                PhaseState { id, state: "done".into(), label: "done".into() }
            } else if window {
                PhaseState { id, state: "window".into(), label: pick_label("ongoing") }
            } else if !current_taken {
                current_taken = true;
                PhaseState { id, state: "now".into(), label: pick_label("up next") }
            } else {
                PhaseState { id, state: "later".into(), label: "later".into() }
            };
            out.push(ps);
        }
    }
    out
}

fn derive_for_dir(dir: &Path) -> Value {
    let p = load_project(dir);
    match &p.manifest {
        None => json!({"error": p.manifest_error.unwrap_or_else(|| "no manifest".into())}),
        Some(m) => {
            let ctx = Ctx::build(&p);
            let merged = inject_rounds(&p.dir, m);
            json!({
                "name": m.get("name"),
                "statuses": derive_statuses(&ctx, &merged),
                "warnings": validate_manifest(m), // validate the REAL manifest, not the overlay
            })
        }
    }
}

/* ================= commands ================= */

#[derive(Serialize)]
struct Worktree { path: String, branch: String, prunable: bool }
#[derive(Serialize)]
struct DirtyEntry { code: String, path: String }

#[tauri::command]
async fn get_picker() -> Value {
    let recents: Vec<Value> = load_recents().into_iter().map(|mut r| {
        if let Some(path) = r.get("path").and_then(|v| v.as_str()) {
            let dir = PathBuf::from(path);
            // the manifest's one-line description, for the recents tile
            let desc = std::fs::read_to_string(dir.join("chronicle.json")).ok()
                .and_then(|s| serde_json::from_str::<Value>(&s).ok())
                .and_then(|m| m.get("description").and_then(|v| v.as_str()).map(String::from))
                .unwrap_or_default();
            if let Some(obj) = r.as_object_mut() { obj.insert("description".into(), json!(desc)); }
            if let Some(obj) = r.as_object_mut() { obj.insert("missing".into(), json!(!dir.exists())); }
            // mission-control extras: the current phase, progress, and a needs-you count
            if dir.exists() {
                let p = load_project(&dir);
                if let Some(m) = &p.manifest {
                    let ctx = Ctx::build(&p);
                    let statuses = derive_statuses(&ctx, m);
                    let mut flat: Vec<Value> = Vec::new();
                    if let Some(stages) = m.get("stages").and_then(|v| v.as_array()) {
                        for st in stages {
                            for ph in st.get("phases").and_then(|v| v.as_array()).cloned().unwrap_or_default() {
                                flat.push(ph);
                            }
                        }
                    }
                    let real: Vec<&PhaseState> = statuses.iter()
                        .filter(|x| matches!(x.state.as_str(), "done" | "now" | "later")).collect();
                    let done = real.iter().filter(|x| x.state == "done").count();
                    let cur = statuses.iter().position(|x| x.state == "now");
                    let current = cur.and_then(|i| flat.get(i).map(|ph| json!({
                        "id": ph.get("id"), "name": ph.get("name"),
                        "label": statuses[i].label,
                    }))).unwrap_or(Value::Null);
                    // needs-you: firing custom actions + the built-in publish nags
                    let mut needs = 0usize;
                    if let Some(actions) = m.get("actions").and_then(|v| v.as_array()) {
                        for a in actions { if action_fires(&ctx, a) { needs += 1; } }
                    }
                    let branch = git_in(&p.repo, &["rev-parse", "--abbrev-ref", "HEAD"]);
                    if !branch.is_empty() {
                        let upstream = Command::new("git").arg("-C").arg(&p.repo)
                            .args(["rev-parse", "--abbrev-ref", "@{u}"]).output()
                            .map(|o| o.status.success()).unwrap_or(false);
                        if !upstream { needs += 1; }
                        else {
                            let lr = git_in(&p.repo, &["rev-list", "--left-right", "--count", "@{u}...HEAD"]);
                            let mut it = lr.split_whitespace();
                            let behind: u32 = it.next().and_then(|x| x.parse().ok()).unwrap_or(0);
                            let ahead: u32 = it.next().and_then(|x| x.parse().ok()).unwrap_or(0);
                            if ahead > 0 { needs += 1; }
                            if behind > 0 { needs += 1; }
                        }
                    }
                    if let Some(obj) = r.as_object_mut() {
                        obj.insert("current".into(), current);
                        obj.insert("done".into(), json!(done));
                        obj.insert("total".into(), json!(real.len()));
                        obj.insert("needs".into(), json!(needs));
                    }
                }
            }
            let summary = if !dir.exists() { json!("folder missing") } else {
                let d = derive_for_dir(&dir);
                match d.get("statuses").and_then(|v| v.as_array()) {
                    None => json!("no manifest"),
                    Some(sts) => {
                        let real: Vec<_> = sts.iter().filter(|s| {
                            let st = s.get("state").and_then(|v| v.as_str()).unwrap_or("");
                            st == "done" || st == "now" || st == "later"
                        }).collect();
                        let done = real.iter().filter(|s| s.get("state").and_then(|v| v.as_str()) == Some("done")).count();
                        if done == real.len() && !real.is_empty() { json!(format!("done · all {} phases", real.len())) }
                        else { json!(format!("phase {} of {}", done + 1, real.len())) }
                    }
                }
            };
            if let Some(obj) = r.as_object_mut() { obj.insert("summary".into(), summary); }
        }
        r
    }).collect();
    json!({ "recents": recents })
}

/// If `dir` has no manifest of its own but is a declared root (repo or extra) of a
/// project in the recents list, name that project so the UI can redirect.
fn part_of_hint(dir: &Path) -> Value {
    for r in load_recents() {
        let Some(rp) = r.get("path").and_then(|v| v.as_str()) else { continue };
        let rdir = PathBuf::from(rp);
        if rdir == dir { continue; }
        let rproj = load_project(&rdir);
        if rproj.manifest.is_none() { continue; }
        let mut roots = vec![rproj.repo.clone()];
        roots.extend(rproj.extras.iter().map(|(_, b)| b.clone()));
        if roots.iter().any(|b| b == dir) {
            return json!({ "name": r.get("name"), "path": rp });
        }
    }
    Value::Null
}

/// A blank project: a fresh folder in ~/Documents to ideate in. The roadmap stays an
/// empty state (marked by .chronicle-blank) until the user asks to build it.
#[tauri::command]
fn create_project(roots: State<OpenRoots>, name: String) -> Result<String, String> {
    let name = name.trim();
    if name.is_empty() || name.contains('/') || name.starts_with('.') {
        return Err("give the project a simple name (no slashes)".into());
    }
    let dir = PathBuf::from(std::env::var("HOME").unwrap_or_default())
        .join("Documents").join(name);
    if dir.exists() { return Err(format!("a folder named “{name}” already exists in Documents")); }
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let _ = Command::new("git").arg("-C").arg(&dir).arg("init").output();
    let _ = std::fs::write(dir.join(".chronicle-blank"),
        "created by Chronicle — deleted automatically once the roadmap exists\n");
    if let Ok(canon) = dir.canonicalize() { allow_root(&roots, &canon); }
    Ok(dir.to_string_lossy().into())
}

/// A manifest saved one level too deep (a session writing into the repo instead of the
/// opened folder). Detected so the UI can offer a one-click move.
fn misplaced_manifest(dir: &Path) -> Option<String> {
    let rd = std::fs::read_dir(dir).ok()?;
    for e in rd.flatten() {
        let p = e.path();
        if p.is_dir() && p.join("chronicle.json").exists() {
            return Some(e.file_name().to_string_lossy().to_string());
        }
    }
    None
}

/// Move a misplaced sub-folder manifest up to the opened folder's root.
#[tauri::command]
fn adopt_manifest(roots: State<OpenRoots>, dir: String, sub: String) -> Result<(), String> {
    if sub.contains('/') || sub.contains("..") { return Err("bad folder name".into()); }
    let dir = project_for(&roots, &dir)?.dir;
    let from = dir.join(&sub).join("chronicle.json");
    let to = dir.join("chronicle.json");
    if to.exists() { return Err("a chronicle.json already exists here".into()); }
    std::fs::rename(&from, &to).map_err(|e| e.to_string())
}

/// Remove a project from Chronicle's recents. Never touches the folder itself.
#[tauri::command]
fn remove_recent(path: String) -> Result<(), String> {
    let mut recents = load_recents();
    recents.retain(|r| r.get("path").and_then(|v| v.as_str()) != Some(path.as_str()));
    save_recents(&recents);
    Ok(())
}

#[tauri::command]
async fn open_project(roots: State<'_, OpenRoots>, path: String) -> Result<Value, String> {
    let dir = PathBuf::from(&path).canonicalize().map_err(|e| e.to_string())?;
    if !dir.is_dir() { return Err("not a folder".into()); }
    allow_root(&roots, &dir); // the USER opened it — this is the trust anchor
    let p = load_project(&dir);
    let part_of = if p.manifest.is_none() { part_of_hint(&dir) } else { Value::Null };
    // recents: newest first, dedup by path, keep 10
    let name = p.manifest.as_ref()
        .and_then(|m| m.get("name")).and_then(|v| v.as_str())
        .map(String::from)
        .unwrap_or_else(|| dir.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default());
    let mut recents = load_recents();
    recents.retain(|r| r.get("path").and_then(|v| v.as_str()) != Some(dir.to_string_lossy().as_ref()));
    if part_of.is_null() {
        // a folder that's really part of another project is not itself a recent
        recents.insert(0, json!({"name": name, "path": dir.to_string_lossy(),
            "opened_at": Command::new("date").arg("+%s").output().map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string()).unwrap_or_default()}));
        recents.truncate(10);
    }
    save_recents(&recents);
    Ok(json!({
        "dir": dir.to_string_lossy(), "repo": p.repo.to_string_lossy(),
        "manifest": p.manifest, "manifest_error": p.manifest_error, "part_of": part_of,
        "extras": p.extras.iter().map(|(a, pp)| json!({"alias": a, "path": pp.to_string_lossy()})).collect::<Vec<_>>(),
    }))
}

/// State is derived FRESH from disk on every call — a chronicle.json written or fixed
/// while the project is open (e.g. by a background /chronicle-init) is picked up on the
/// next poll or refresh, no reopen needed.
#[tauri::command]
async fn get_state(roots: State<'_, OpenRoots>, dir: String) -> Result<Value, String> {
    let p = project_for(&roots, &dir)?;
    let mut s = state_for_project(&p);
    let marker = p.dir.join(".chronicle-blank");
    let blank = marker.exists();
    if blank && p.manifest.is_some() { let _ = std::fs::remove_file(&marker); } // roadmap arrived
    if let Some(obj) = s.as_object_mut() {
        // the MERGED manifest (kanban rounds injected) — statuses are derived from it,
        // so the phase list and the status list must describe the same document
        obj.insert("manifest".into(), p.manifest.as_ref()
            .map(|m| inject_rounds(&p.dir, m)).unwrap_or(Value::Null));
        obj.insert("blank".into(), json!(blank && p.manifest.is_none()));
        if p.manifest.is_none() {
            obj.insert("misplaced".into(), json!(misplaced_manifest(&p.dir)));
        }
        obj.insert("extras".into(), json!(p.extras.iter()
            .map(|(a, pp)| json!({"alias": a, "path": pp.to_string_lossy()})).collect::<Vec<_>>()));
        obj.insert("init_consent".into(), init_consent_for(&p.dir));
    }
    Ok(s)
}

/* ================= background /chronicle-init ================= */

#[tauri::command]
async fn init_start(roots: State<'_, OpenRoots>, init: State<'_, InitState>, dir: String, agent: Option<String>) -> Result<(), String> {
    let dirp = project_for(&roots, &dir)?.dir; // only an OPENED project may run a session
    let (key, log) = canon_key(&dir)?; // canonical path key + hashed log name — no collisions
    let mut runs = init.runs.lock().map_err(|e| e.to_string())?;
    if let Some((child, _)) = runs.get_mut(&key) {
        if child.try_wait().map_err(|e| e.to_string())?.is_none() {
            return Ok(()); // already running
        }
    }
    let logf = std::fs::File::create(&log).map_err(|e| e.to_string())?;
    let errf = logf.try_clone().map_err(|e| e.to_string())?;
    // full auto mode either way: the session must finish without a single prompt.
    let (claude_bin, codex_bin) = agent_paths();
    let use_codex = agent.as_deref() == Some("codex")
        || (agent.is_none() && claude_bin.is_none() && codex_bin.is_some());
    let child = if use_codex {
        let bin = codex_bin.ok_or("Codex isn't installed (couldn't find `codex`)")?;
        let prompt = format!("{}{}\n\n---\n\n{}",
            CODEX_INIT_PROMPT_HEAD,
            include_str!("../../skill/chronicle-init/SKILL.md"),
            include_str!("../../skill/chronicle-init/SCHEMA.md"));
        std::process::Command::new(bin)
            .args(["exec", "--json", "--skip-git-repo-check",
                   "--dangerously-bypass-approvals-and-sandbox", &prompt])
            .current_dir(&dirp)
            .stdin(std::process::Stdio::null())
            .stdout(logf).stderr(errf)
            .spawn()
            .map_err(|e| format!("couldn't start a Codex session: {e}"))?
    } else {
        let bin = claude_bin.ok_or("Claude Code isn't installed (couldn't find `claude`)")?;
        std::process::Command::new(bin)
            .args(["-p", "/chronicle-init", "--permission-mode", "bypassPermissions",
                   "--verbose", "--output-format", "stream-json"])
            .current_dir(&dirp)
            .stdin(std::process::Stdio::null())
            .stdout(logf).stderr(errf)
            .spawn()
            .map_err(|e| format!("couldn't start a Claude session: {e}"))?
    };
    runs.insert(key, (child, log));
    Ok(())
}

/// Stop a running roadmap session: SIGTERM, a grace period, then SIGKILL — always reaped.
/// Wired to every dismiss path and to agent-switch (cancel before respawn).
#[tauri::command]
async fn init_cancel(init: State<'_, InitState>, dir: String) -> Result<(), String> {
    let (key, _) = canon_key(&dir)?;
    let entry = init.runs.lock().map_err(|e| e.to_string())?.remove(&key);
    if let Some((mut child, _log)) = entry {
        term_then_kill(&mut child);
    }
    Ok(())
}

/// Persist the user's per-project consent choice for the roadmap session
/// ("auto" build it for me · "manual" I'll run it myself · "basic" basic view).
/// Survives relaunch; get_state reports it as "init_consent".
#[tauri::command]
fn set_init_consent(roots: State<OpenRoots>, dir: String, choice: String) -> Result<(), String> {
    if !matches!(choice.as_str(), "auto" | "manual" | "basic") {
        return Err("unknown choice".into());
    }
    let d = project_for(&roots, &dir)?.dir;
    let mut cfg = load_config();
    let obj = cfg.as_object_mut().ok_or("bad config")?;
    let map = obj.entry("initConsent").or_insert(json!({}));
    if let Some(m) = map.as_object_mut() {
        m.insert(d.to_string_lossy().to_string(), json!(choice));
    }
    let _ = std::fs::create_dir_all(config_dir());
    std::fs::write(config_dir().join("config.json"),
        serde_json::to_string_pretty(&cfg).unwrap_or_default()).map_err(|e| e.to_string())
}

fn init_consent_for(dir: &Path) -> Value {
    load_config().get("initConsent")
        .and_then(|m| m.get(dir.to_string_lossy().as_ref()))
        .cloned().unwrap_or(Value::Null)
}

/// Read at most `max` bytes from the END of the log — never the whole file, and never
/// while holding the runs lock.
fn read_tail(path: &Path, max: u64) -> String {
    use std::io::{Read, Seek, SeekFrom};
    let Ok(mut f) = std::fs::File::open(path) else { return String::new() };
    let len = f.metadata().map(|m| m.len()).unwrap_or(0);
    let _ = f.seek(SeekFrom::Start(len.saturating_sub(max)));
    let mut buf = Vec::new();
    let _ = f.read_to_end(&mut buf);
    String::from_utf8_lossy(&buf).into_owned()
}

#[tauri::command]
async fn init_status(init: State<'_, InitState>, dir: String) -> Result<Value, String> {
    let (key, _) = canon_key(&dir)?;
    // probe under the lock (fast), read the log AFTER releasing it
    let probed = {
        let mut runs = init.runs.lock().map_err(|e| e.to_string())?;
        match runs.get_mut(&key) {
            None => None,
            Some((child, log)) => Some((child.try_wait().map_err(|e| e.to_string())?, log.clone())),
        }
    };
    match probed {
        None => Ok(json!({"running": false, "started": false})),
        Some((code, log)) => Ok(json!({
            "running": code.is_none(), "started": true,
            "code": code.and_then(|c| c.code()),
            "log_tail": read_tail(&log, 30000),
        })),
    }
}

fn state_for_project(p: &Project) -> Value {
    let ctx = Ctx::build(p);

    let branch_probe = git_in_checked(&p.repo, &["rev-parse", "--abbrev-ref", "HEAD"]);
    let git_degraded = branch_probe.is_err(); // git didn't run — not the same as "not a repo"
    let branch = branch_probe.unwrap_or_default();
    let is_git = !branch.is_empty();
    // does this project have an online home at all? (no network — just the configured remote)
    let remote_url = git_in(&p.repo, &["remote", "get-url", "origin"]);
    let commits: u32 = git_in(&p.repo, &["rev-list", "--count", "HEAD"]).parse().unwrap_or(0);
    let upstream = Command::new("git").arg("-C").arg(&p.repo)
        .args(["rev-parse", "--abbrev-ref", "@{u}"]).output()
        .map(|o| o.status.success()).unwrap_or(false);
    let (behind, ahead) = if upstream {
        let lr = git_in(&p.repo, &["rev-list", "--left-right", "--count", "@{u}...HEAD"]);
        let mut it = lr.split_whitespace();
        (it.next().and_then(|s| s.parse::<u32>().ok()).unwrap_or(0),
         it.next().and_then(|s| s.parse::<u32>().ok()).unwrap_or(0))
    } else { (0, 0) };
    let dirty: Vec<DirtyEntry> = git_in(&p.repo, &["status", "--porcelain"]).lines()
        .filter(|l| l.len() > 3)
        .map(|l| DirtyEntry { code: l[..2].trim().to_string(), path: l[3..].trim_matches('"').to_string() })
        .collect();
    let worktrees: Vec<Worktree> = git_in(&p.repo, &["worktree", "list", "--porcelain"])
        .split("\n\n").filter(|b| !b.trim().is_empty())
        .map(|b| {
            let mut path = String::new(); let mut br = String::new(); let mut prunable = false;
            for line in b.lines() {
                if let Some(x) = line.strip_prefix("worktree ") { path = x.into(); }
                if let Some(x) = line.strip_prefix("branch refs/heads/") { br = x.into(); }
                if line.starts_with("prunable") { prunable = true; }
            }
            Worktree { path, branch: br, prunable }
        }).collect();

    let merged_manifest = p.manifest.as_ref().map(|m| inject_rounds(&p.dir, m));
    let (statuses, doc_existence, stale, custom_actions) = match &merged_manifest {
        None => (Vec::new(), json!({}), json!([]), json!([])),
        Some(m) => {
            let statuses = derive_statuses(&ctx, m);
            // existence for every path the manifest references (paste + docs)
            let mut docs = serde_json::Map::new();
            let mut walk = |path: &str| {
                docs.insert(path.to_string(), json!(ctx.resolve_jailed(path).is_some()));
            };
            if let Some(stages) = m.get("stages").and_then(|v| v.as_array()) {
                for st in stages {
                    for ph in st.get("phases").and_then(|v| v.as_array()).cloned().unwrap_or_default() {
                        for key in ["paste", "docs"] {
                            for d in ph.get(key).and_then(|v| v.as_array()).cloned().unwrap_or_default() {
                                if let Some(pp) = d.get("path").and_then(|v| v.as_str()) { walk(pp); }
                            }
                        }
                    }
                }
            }
            if let Some(spine) = m.get("spine").and_then(|v| v.as_array()) {
                for d in spine { if let Some(pp) = d.get("path").and_then(|v| v.as_str()) { walk(pp); } }
            }
            // staleness: generatedFrom sha256 mismatches
            let mut stale = Vec::new();
            if let Some(gf) = m.get("generatedFrom").and_then(|v| v.as_array()) {
                for g in gf {
                    if let (Some(pp), Some(want)) =
                        (g.get("path").and_then(|v| v.as_str()), g.get("sha256").and_then(|v| v.as_str()))
                    {
                        let got = ctx.resolve_jailed(pp)
                            .and_then(|full| std::fs::read(full).ok())
                            .map(|b| {
                                let mut h = Sha256::new(); h.update(&b); format!("{:x}", h.finalize())
                            }).unwrap_or_default();
                        if got != want { stale.push(json!(pp)); }
                    }
                }
            }
            // manifest-declared custom actions
            let mut acts = Vec::new();
            if let Some(actions) = m.get("actions").and_then(|v| v.as_array()) {
                for a in actions {
                    if action_fires(&ctx, a) { acts.push(a.clone()); }
                }
            }
            (statuses, Value::Object(docs), json!(stale), json!(acts))
        }
    };

    let mut tags_sorted = ctx.tags.iter().cloned().collect::<Vec<String>>();
    tags_sorted.sort();
    json!({
        "repo": p.repo.to_string_lossy(), "dir": p.dir.to_string_lossy(),
        "manifest_present": p.manifest.is_some(), "manifest_error": p.manifest_error,
        "is_git": is_git, "git_degraded": git_degraded,
        "branch": branch, "upstream": upstream, "ahead": ahead, "behind": behind,
        "remote_url": remote_url, "commits": commits,
        "last_commit": git_in(&p.repo, &["log", "-1", "--format=%h · %s"]),
        "tags": tags_sorted,
        "worktrees": worktrees, "dirty": dirty,
        "statuses": statuses, "docs": doc_existence, "stale": stale, "custom_actions": custom_actions,
        "manifest_warnings": p.manifest.as_ref().map(validate_manifest).unwrap_or_default(),
        "work_branch": p.manifest.as_ref().and_then(|m| m.get("workBranch")).cloned().unwrap_or(Value::Null),
        "checked_at": Command::new("date").arg("+%H:%M:%S").output()
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string()).unwrap_or_default(),
    })
}

/* ================= the kanban engine (R4) =================
   Tasks live IN the project (.chronicle/kanban.json) so they travel with the repo;
   attachments beside them (.chronicle/attachments/). The project is only ever written
   by explicit user actions (editing tasks, attaching, "Ready to execute"). Fix rounds
   surface on the roadmap as OVERLAY phases at derive time — chronicle.json is never
   mutated, so a /chronicle-init re-run can't wipe a round. */

fn kanban_path(dir: &Path) -> PathBuf { dir.join(".chronicle/kanban.json") }

fn load_kanban(dir: &Path) -> Value {
    std::fs::read_to_string(kanban_path(dir)).ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| json!({ "version": 1, "next_id": 1, "tasks": [], "rounds": [] }))
}

#[tauri::command]
async fn kanban_get(roots: State<'_, OpenRoots>, dir: String) -> Result<Value, String> {
    let p = project_for(&roots, &dir)?;
    Ok(load_kanban(&p.dir))
}

/// Whole-store save (the board is small; last-write-wins is fine for a single user).
#[tauri::command]
async fn kanban_save(roots: State<'_, OpenRoots>, dir: String, data: Value) -> Result<(), String> {
    let p = project_for(&roots, &dir)?;
    if !data.is_object() || !data.get("tasks").map(|t| t.is_array()).unwrap_or(false) {
        return Err("malformed kanban data".into());
    }
    std::fs::create_dir_all(p.dir.join(".chronicle")).map_err(|e| e.to_string())?;
    std::fs::write(kanban_path(&p.dir),
        serde_json::to_string_pretty(&data).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())
}

/// Save an image attachment; returns the repo-relative path for the task to reference.
#[tauri::command]
async fn kanban_attach(roots: State<'_, OpenRoots>, dir: String, task_id: String, name: String, b64: String) -> Result<String, String> {
    let p = project_for(&roots, &dir)?;
    let safe_id: String = task_id.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-').collect();
    let safe_name: String = name.chars()
        .map(|c| if c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_') { c } else { '-' })
        .collect();
    if safe_id.is_empty() || safe_name.is_empty() { return Err("bad attachment name".into()); }
    let bytes = base64::engine::general_purpose::STANDARD.decode(b64).map_err(|e| e.to_string())?;
    if bytes.len() > 10_000_000 { return Err("attachment is over 10 MB".into()); }
    let adir = p.dir.join(".chronicle/attachments");
    std::fs::create_dir_all(&adir).map_err(|e| e.to_string())?;
    let rel = format!(".chronicle/attachments/{safe_id}-{safe_name}");
    std::fs::write(p.dir.join(&rel), bytes).map_err(|e| e.to_string())?;
    Ok(rel)
}

const FIXES_PROMPT_HEAD: &str = "You are turning a queue of user-written tasks (bugs, issues, ideas — with optional screenshots and design links) into an executable fix plan for this project. Write EXACTLY two files, creating the fixes/ folder if needed:\n\n1. fixes/phase_{N}_fixes_plan.md — every task below, parsed, deduplicated, and expanded into precise, unambiguous, actionable items a coding agent can execute without questions. Reference concrete files/components where inferable from the repo. Keep each item traceable to its task id. THE FIRST LINE of this file must be exactly `Round kind: bug fixes` or `Round kind: feature additions` — decide from the tasks' content (mostly defects => bug fixes; mostly new capability => feature additions).\n\n2. fixes/phase_{N}_fixes_prompt.md — the execution instructions to paste into Claude Code or Codex: read the plan, execute every item, verify each fix like a shipping change (run/build/screenshot where applicable), and report per-item outcomes honestly. The prompt MUST also instruct the executor: after each item is completed AND verified, edit .chronicle/kanban.json and set that task's \"column\" to \"completed\" (match by task id; touch \"updated_at\" with epoch ms; change nothing else in the file) — this is how the board and the roadmap track the round live.\n\nDo not change any other file. The tasks (JSON):\n\n";

fn fixes_run_key(dir: &str) -> Result<(String, PathBuf), String> {
    let (key, log) = canon_key(dir)?;
    let mut h = Sha256::new();
    h.update(format!("fixes::{key}").as_bytes());
    let hex = format!("{:x}", h.finalize());
    Ok((format!("fixes::{key}"), std::env::temp_dir().join(format!("chronicle-fixes-{}.log", &hex[..16]))))
}

/// "Ready to execute": freeze the queued, un-rounded tasks into round N and start the
/// background session that writes fixes/phase_N_fixes_plan.md + _prompt.md.
#[tauri::command]
async fn fixes_generate(roots: State<'_, OpenRoots>, init: State<'_, InitState>, dir: String, agent: Option<String>) -> Result<u64, String> {
    let p = project_for(&roots, &dir)?;
    let mut store = load_kanban(&p.dir);
    // the round takes every QUEUED task not already frozen into a round
    let mut picked: Vec<Value> = Vec::new();
    let round_n = store.get("rounds").and_then(|r| r.as_array()).map(|r| r.len() as u64).unwrap_or(0) + 1;
    if let Some(tasks) = store.get_mut("tasks").and_then(|t| t.as_array_mut()) {
        for t in tasks.iter_mut() {
            let queued = t.get("column").and_then(|c| c.as_str()) == Some("queued");
            let unrounded = t.get("round").is_none() || t.get("round") == Some(&Value::Null);
            if queued && unrounded {
                if let Some(obj) = t.as_object_mut() {
                    obj.insert("round".into(), json!(round_n));
                    // frozen tasks move to the round's lane so the board shows it
                    obj.insert("column".into(), json!("in_progress"));
                }
                picked.push(t.clone());
            }
        }
    }
    if picked.is_empty() { return Err("no queued tasks to execute".into()); }
    let task_ids: Vec<Value> = picked.iter().filter_map(|t| t.get("id").cloned()).collect();
    if let Some(rounds) = store.get_mut("rounds").and_then(|r| r.as_array_mut()) {
        rounds.push(json!({
            "n": round_n, "state": "generating", "kind": Value::Null,
            "task_ids": task_ids,
            "plan_path": format!("fixes/phase_{round_n}_fixes_plan.md"),
            "prompt_path": format!("fixes/phase_{round_n}_fixes_prompt.md"),
        }));
    }
    std::fs::create_dir_all(p.dir.join(".chronicle")).map_err(|e| e.to_string())?;
    std::fs::write(kanban_path(&p.dir), serde_json::to_string_pretty(&store).unwrap_or_default())
        .map_err(|e| e.to_string())?;

    // spawn the generation session (same machinery + lifecycle as /chronicle-init)
    let prompt = format!("{}{}",
        FIXES_PROMPT_HEAD.replace("{N}", &round_n.to_string()),
        serde_json::to_string_pretty(&picked).unwrap_or_default());
    let (key, log) = fixes_run_key(&dir)?;
    let mut runs = init.runs.lock().map_err(|e| e.to_string())?;
    if let Some((child, _)) = runs.get_mut(&key) {
        if child.try_wait().map_err(|e| e.to_string())?.is_none() {
            return Err("a fix round is already generating".into());
        }
    }
    let logf = std::fs::File::create(&log).map_err(|e| e.to_string())?;
    let errf = logf.try_clone().map_err(|e| e.to_string())?;
    let (claude_bin, codex_bin) = agent_paths();
    let use_codex = agent.as_deref() == Some("codex")
        || (agent.is_none() && claude_bin.is_none() && codex_bin.is_some());
    let child = if use_codex {
        let bin = codex_bin.ok_or("Codex isn't installed (couldn't find `codex`)")?;
        std::process::Command::new(bin)
            .args(["exec", "--json", "--skip-git-repo-check",
                   "--dangerously-bypass-approvals-and-sandbox", &prompt])
            .current_dir(&p.dir)
            .stdin(std::process::Stdio::null())
            .stdout(logf).stderr(errf)
            .spawn().map_err(|e| format!("couldn't start a Codex session: {e}"))?
    } else {
        let bin = claude_bin.ok_or("Claude Code isn't installed (couldn't find `claude`)")?;
        std::process::Command::new(bin)
            .args(["-p", &prompt, "--permission-mode", "bypassPermissions",
                   "--verbose", "--output-format", "stream-json"])
            .current_dir(&p.dir)
            .stdin(std::process::Stdio::null())
            .stdout(logf).stderr(errf)
            .spawn().map_err(|e| format!("couldn't start a Claude session: {e}"))?
    };
    runs.insert(key, (child, log));
    Ok(round_n)
}

#[tauri::command]
async fn fixes_status(roots: State<'_, OpenRoots>, init: State<'_, InitState>, dir: String) -> Result<Value, String> {
    let p = project_for(&roots, &dir)?;
    let (key, _) = fixes_run_key(&dir)?;
    let probed = {
        let mut runs = init.runs.lock().map_err(|e| e.to_string())?;
        match runs.get_mut(&key) {
            None => None,
            Some((child, log)) => Some((child.try_wait().map_err(|e| e.to_string())?, log.clone())),
        }
    };
    let Some((code, log)) = probed else { return Ok(json!({"running": false, "started": false})) };
    // on completion, settle the newest generating round from what actually landed on disk
    if code.is_some() { settle_round(&p.dir); }
    Ok(json!({
        "running": code.is_none(), "started": true,
        "code": code.and_then(|c| c.code()),
        "log_tail": read_tail(&log, 30000),
    }))
}

#[tauri::command]
async fn fixes_cancel(roots: State<'_, OpenRoots>, init: State<'_, InitState>, dir: String) -> Result<(), String> {
    let p = project_for(&roots, &dir)?;
    let (key, _) = fixes_run_key(&dir)?;
    let entry = init.runs.lock().map_err(|e| e.to_string())?.remove(&key);
    if let Some((mut child, _)) = entry { term_then_kill(&mut child); }
    // a cancelled generating round unfreezes its tasks
    let mut store = load_kanban(&p.dir);
    let cancelled: Option<u64> = store.get_mut("rounds").and_then(|r| r.as_array_mut()).and_then(|rounds| {
        let last = rounds.last_mut()?;
        if last.get("state").and_then(|s| s.as_str()) == Some("generating") {
            let n = last.get("n").and_then(|v| v.as_u64());
            rounds.pop();
            n
        } else { None }
    });
    if let Some(n) = cancelled {
        if let Some(tasks) = store.get_mut("tasks").and_then(|t| t.as_array_mut()) {
            for t in tasks.iter_mut() {
                if t.get("round").and_then(|v| v.as_u64()) == Some(n) {
                    if let Some(obj) = t.as_object_mut() { obj.insert("round".into(), Value::Null); }
                }
            }
        }
        let _ = std::fs::write(kanban_path(&p.dir), serde_json::to_string_pretty(&store).unwrap_or_default());
    }
    Ok(())
}

/// After a generation session exits: read what it actually wrote and record the truth —
/// the plan file's first line names the round kind; both files must exist or it failed.
fn settle_round(dir: &Path) {
    let mut store = load_kanban(dir);
    let Some(rounds) = store.get_mut("rounds").and_then(|r| r.as_array_mut()) else { return };
    let Some(last) = rounds.last_mut() else { return };
    if last.get("state").and_then(|s| s.as_str()) != Some("generating") { return; }
    let n = last.get("n").and_then(|v| v.as_u64()).unwrap_or(0);
    let plan = dir.join(format!("fixes/phase_{n}_fixes_plan.md"));
    let prompt = dir.join(format!("fixes/phase_{n}_fixes_prompt.md"));
    if plan.exists() && prompt.exists() {
        let first = std::fs::read_to_string(&plan).unwrap_or_default()
            .lines().next().unwrap_or("").to_lowercase();
        let kind = if first.contains("feature") { "feature additions" } else { "bug fixes" };
        if let Some(obj) = last.as_object_mut() {
            obj.insert("state".into(), json!("ready"));
            obj.insert("kind".into(), json!(kind));
        }
    } else if let Some(obj) = last.as_object_mut() {
        obj.insert("state".into(), json!("failed"));
    }
    let _ = std::fs::write(kanban_path(dir), serde_json::to_string_pretty(&store).unwrap_or_default());
}

/// The roadmap overlay: settled rounds become synthetic phases in a synthetic stage
/// inserted right after the stage holding the LAST DONE phase. The manifest on disk is
/// never touched. Each phase carries fixRound metadata + precomputed done/label (from
/// the tasks' columns) that derive_statuses honors.
fn inject_rounds(dir: &Path, manifest: &Value) -> Value {
    let store = load_kanban(dir);
    let rounds = store.get("rounds").and_then(|r| r.as_array()).cloned().unwrap_or_default();
    let settled: Vec<&Value> = rounds.iter()
        .filter(|r| matches!(r.get("state").and_then(|s| s.as_str()), Some("ready") | Some("done")))
        .collect();
    if settled.is_empty() { return manifest.clone(); }
    let tasks = store.get("tasks").and_then(|t| t.as_array()).cloned().unwrap_or_default();

    let mut phases: Vec<Value> = Vec::new();
    for r in settled {
        let n = r.get("n").and_then(|v| v.as_u64()).unwrap_or(0);
        let kind = r.get("kind").and_then(|v| v.as_str()).unwrap_or("bug fixes");
        let ids: Vec<String> = r.get("task_ids").and_then(|v| v.as_array())
            .map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect())
            .unwrap_or_default();
        let mine: Vec<&Value> = tasks.iter()
            .filter(|t| t.get("id").and_then(|i| i.as_str()).map(|i| ids.contains(&i.to_string())).unwrap_or(false))
            .collect();
        let done = !mine.is_empty()
            && mine.iter().all(|t| t.get("column").and_then(|c| c.as_str()) == Some("completed"));
        let in_progress = mine.iter().any(|t| matches!(t.get("column").and_then(|c| c.as_str()), Some("in_progress")));
        let title = {
            let cap = { let mut c = kind.chars(); match c.next() { Some(f) => f.to_uppercase().collect::<String>() + c.as_str(), None => String::new() } };
            if n > 1 { format!("{cap} · round {n}") } else { cap }
        };
        phases.push(json!({
            "id": format!("FX-{n}"),
            "name": title,
            "desc": format!("{} tasks from the kanban, frozen into an executable plan.", ids.len()),
            "paste": [ { "path": format!("fixes/phase_{n}_fixes_prompt.md"), "into": "Claude Code", "when": "run the whole round in one session" } ],
            "docs": [ { "path": format!("fixes/phase_{n}_fixes_plan.md") } ],
            "fixRound": n,
            "fixRoundState": { "done": done, "label": if done { "done" } else if in_progress { "being fixed" } else { "ready to run" } }
        }));
    }

    let mut m = manifest.clone();
    let Some(stages) = m.get_mut("stages").and_then(|s| s.as_array_mut()) else { return manifest.clone() };
    // find the stage containing the last done-ish content: walk with a throwaway derive
    // is circular; instead place after the LAST stage whose every phase has a satisfied
    // done_when — cheap approximation: insert after the last stage index where any phase
    // exists (fallback: append). The precise "after the last completed phase" placement
    // is refined by the frontend when rendering (it has the statuses).
    let synth = json!({ "title": "Fixes & ideas", "note": "from the kanban", "synthetic": true, "phases": phases });
    stages.push(synth);
    m
}

/* ================= the git pane (M1/M2) ================= */

fn git_full(repo: &Path, args: &[&str]) -> Result<String, String> {
    let out = Command::new("git").arg("-C").arg(repo).args(args).output()
        .map_err(|e| e.to_string())?;
    if out.status.success() { Ok(String::from_utf8_lossy(&out.stdout).to_string()) }
    else {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        Err(if err.is_empty() { String::from_utf8_lossy(&out.stdout).trim().to_string() } else { err })
    }
}

#[tauri::command]
async fn git_status_detail(roots: State<'_, OpenRoots>, dir: String) -> Result<Value, String> {
    let p = project_for(&roots, &dir)?;
    let raw = git_full(&p.repo, &["status", "--porcelain=v1"])?;
    let mut staged = Vec::new();
    let mut unstaged = Vec::new();
    for l in raw.lines() {
        if l.len() < 4 { continue; }
        let x = l.as_bytes()[0] as char;
        let y = l.as_bytes()[1] as char;
        let rawp = &l[3..];
        let path = rawp.split(" -> ").last().unwrap_or(rawp).trim_matches('"').to_string();
        if x != ' ' && x != '?' { staged.push(json!({"path": path, "code": x.to_string()})); }
        if y != ' ' { unstaged.push(json!({"path": path, "code": if x=='?' {"A".into()} else {y.to_string()}, "untracked": x=='?'})); }
    }
    Ok(json!({ "staged": staged, "unstaged": unstaged }))
}

#[tauri::command]
async fn git_stage(roots: State<'_, OpenRoots>, dir: String, path: Option<String>) -> Result<(), String> {
    let p = project_for(&roots, &dir)?;
    match path {
        Some(f) => git_full(&p.repo, &["add", "--", &f]).map(|_| ()),
        None => git_full(&p.repo, &["add", "-A"]).map(|_| ()),
    }
}

#[tauri::command]
async fn git_unstage(roots: State<'_, OpenRoots>, dir: String, path: String) -> Result<(), String> {
    let p = project_for(&roots, &dir)?;
    git_full(&p.repo, &["reset", "-q", "HEAD", "--", &path]).map(|_| ())
}

/// Destructive; the UI always confirms first. Untracked files are deleted, tracked restored.
#[tauri::command]
async fn git_discard(roots: State<'_, OpenRoots>, dir: String, path: String, untracked: bool) -> Result<(), String> {
    let p = project_for(&roots, &dir)?;
    if untracked { git_full(&p.repo, &["clean", "-fd", "--", &path]).map(|_| ()) }
    else { git_full(&p.repo, &["checkout", "--", &path]).map(|_| ()) }
}

/// Turn a plain folder into a tracked project: git init + a first save.
#[tauri::command]
async fn git_init_here(roots: State<'_, OpenRoots>, dir: String) -> Result<(), String> {
    let d = project_for(&roots, &dir)?.dir;
    if d.join(".git").exists() { return Ok(()); }
    git_full(&d, &["init"])?;
    git_full(&d, &["add", "-A"])?;
    // an empty tree still commits with --allow-empty; a first save either way
    git_full(&d, &["commit", "--allow-empty", "-m", "First save"]).map(|_| ())
}

#[tauri::command]
async fn git_commit(roots: State<'_, OpenRoots>, dir: String, message: String, stage_all: bool) -> Result<(), String> {
    let p = project_for(&roots, &dir)?;
    if message.trim().is_empty() { return Err("give the save a short message".into()); }
    if stage_all { git_full(&p.repo, &["add", "-A"])?; }
    git_full(&p.repo, &["commit", "-m", &message]).map(|_| ())
}

/// Plain push only. No force flag exists anywhere in this app.
#[tauri::command]
async fn git_push(roots: State<'_, OpenRoots>, dir: String) -> Result<(), String> {
    let p = project_for(&roots, &dir)?;
    let upstream = Command::new("git").arg("-C").arg(&p.repo)
        .args(["rev-parse", "--abbrev-ref", "@{u}"]).output()
        .map(|o| o.status.success()).unwrap_or(false);
    if upstream { git_full(&p.repo, &["push"]).map(|_| ()) }
    else {
        let br = git_in(&p.repo, &["rev-parse", "--abbrev-ref", "HEAD"]);
        git_full(&p.repo, &["push", "-u", "origin", &br]).map(|_| ())
    }
}

#[tauri::command]
async fn git_pull(roots: State<'_, OpenRoots>, dir: String) -> Result<(), String> {
    let p = project_for(&roots, &dir)?;
    git_full(&p.repo, &["pull", "--ff-only"]).map(|_| ())
}

/// One-click "Switch branch" from the needs-you queue. Plain checkout — git itself
/// refuses if uncommitted changes would be clobbered, and that error is surfaced as-is.
#[tauri::command]
async fn git_checkout(roots: State<'_, OpenRoots>, dir: String, branch: String) -> Result<(), String> {
    let p = project_for(&roots, &dir)?;
    git_full(&p.repo, &["checkout", &branch]).map(|_| ())
}

/// One-click "Clean up stale workspaces". Returns the surviving worktree list.
#[tauri::command]
async fn git_worktree_prune(roots: State<'_, OpenRoots>, dir: String) -> Result<String, String> {
    let p = project_for(&roots, &dir)?;
    git_full(&p.repo, &["worktree", "prune"])?;
    git_full(&p.repo, &["worktree", "list"])
}

/// Viewer freshness: size + mtime (cheap poll/focus re-check) + a content kind so the
/// viewer can choose text · image preview · binary card · huge-file guard.
#[tauri::command]
async fn stat_file(roots: State<'_, OpenRoots>, dir: String, path: String) -> Result<Value, String> {
    let p = project_for(&roots, &dir)?;
    let full = jailed(&p, &path)?;
    let md = std::fs::metadata(&full).map_err(|e| e.to_string())?;
    let mtime = md.modified().ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs()).unwrap_or(0);
    Ok(json!({ "size": md.len(), "mtime": mtime, "kind": sniff_kind(&full) }))
}

/// "text" | "image" | "binary" — image by extension (the viewer renders these as
/// data: URIs), binary by a NUL byte in the first 8 KB, text otherwise.
fn sniff_kind(full: &Path) -> &'static str {
    let ext = full.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
    if matches!(ext.as_str(), "png" | "jpg" | "jpeg" | "gif" | "webp" | "svg" | "bmp" | "ico" | "heic" | "avif") {
        return "image";
    }
    let mut buf = [0u8; 8192];
    let n = std::fs::File::open(full)
        .and_then(|mut f| std::io::Read::read(&mut f, &mut buf))
        .unwrap_or(0);
    if buf[..n].contains(&0) { "binary" } else { "text" }
}

/// Image preview bytes for the viewer (data: URI; img-src data: is in the CSP).
/// Capped — the huge-file guard applies before this is ever called.
#[tauri::command]
async fn read_file_b64(roots: State<'_, OpenRoots>, dir: String, path: String) -> Result<String, String> {
    let p = project_for(&roots, &dir)?;
    let full = jailed(&p, &path)?;
    let len = std::fs::metadata(&full).map_err(|e| e.to_string())?.len();
    if len > 8_000_000 {
        return Err(format!("that file is {len} bytes — too large to preview"));
    }
    let bytes = std::fs::read(&full).map_err(|e| e.to_string())?;
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

#[tauri::command]
async fn git_log_graph(roots: State<'_, OpenRoots>, dir: String, limit: Option<u32>) -> Result<Value, String> {
    let p = project_for(&roots, &dir)?;
    let n = limit.unwrap_or(30).min(200).to_string();
    // --all + topo-order so diverged branches (main vs a feature branch) render as real lanes,
    // not just the current branch as one straight line.
    let raw = git_full(&p.repo, &["log", "--all", "--topo-order", "-n", &n, "--pretty=format:%h\x1f%p\x1f%s\x1f%an\x1f%ar\x1f%D"])?;
    let commits: Vec<Value> = raw.lines().map(|l| {
        let f: Vec<&str> = l.split('\x1f').collect();
        json!({
            "hash": f.first().copied().unwrap_or(""),
            "parents": f.get(1).map(|x| x.split(' ').filter(|y| !y.is_empty()).collect::<Vec<_>>()).unwrap_or_default(),
            "subject": f.get(2).copied().unwrap_or(""),
            "author": f.get(3).copied().unwrap_or(""),
            "ago": f.get(4).copied().unwrap_or(""),
            "refs": f.get(5).copied().unwrap_or(""),
        })
    }).collect();
    Ok(json!(commits))
}

#[tauri::command]
async fn git_diff(roots: State<'_, OpenRoots>, dir: String, path: String, staged: bool, untracked: bool) -> Result<String, String> {
    let p = project_for(&roots, &dir)?;
    if untracked {
        // no-index diff exits 1 when files differ; capture output regardless
        let out = Command::new("git").arg("-C").arg(&p.repo)
            .args(["diff", "--no-index", "--", "/dev/null", &path]).output()
            .map_err(|e| e.to_string())?;
        let code = out.status.code().unwrap_or(0);
        if code > 1 { return Err(String::from_utf8_lossy(&out.stderr).trim().to_string()); }
        return Ok(String::from_utf8_lossy(&out.stdout).to_string());
    }
    if staged { git_full(&p.repo, &["diff", "--cached", "--", &path]) }
    else { git_full(&p.repo, &["diff", "--", &path]) }
}

// run a suggested command in the project's repo dir (login shell so PATH matches the user's).
// used by the roadmap "what needs you" / stale actions instead of copy-to-clipboard.
#[tauri::command]
async fn run_command(roots: State<'_, OpenRoots>, dir: String, cmd: String) -> Result<String, String> {
    let p = project_for(&roots, &dir)?;
    let out = std::process::Command::new("/bin/zsh")
        .args(["-lc", &cmd]).current_dir(&p.repo).output()
        .map_err(|e| e.to_string())?;
    let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
    if out.status.success() {
        Ok(if stdout.is_empty() { "Done.".into() } else { stdout })
    } else {
        Err(if stderr.is_empty() { if stdout.is_empty() { "command failed".into() } else { stdout } } else { stderr })
    }
}

/* ================= files (jailed to the project's roots) ================= */

fn jailed(p: &Project, path: &str) -> Result<PathBuf, String> {
    let ctx_extras = &p.extras;
    let full = if let Some(rest) = path.strip_prefix('@') {
        if let Some((alias, tail)) = rest.split_once('/') {
            ctx_extras.iter().find(|(a, _)| a == alias)
                .map(|(_, base)| base.join(tail))
                .ok_or_else(|| format!("unknown root @{alias}"))?
        } else {
            ctx_extras.iter().find(|(a, _)| a == rest)
                .map(|(_, base)| base.clone())
                .ok_or_else(|| format!("unknown root @{rest}"))?
        }
    } else {
        p.repo.join(path)
    };
    let full = full.canonicalize().map_err(|e| e.to_string())?;
    let mut roots: Vec<PathBuf> = vec![p.repo.clone(), p.dir.clone()];
    roots.extend(p.extras.iter().map(|(_, b)| b.clone()));
    for r in roots {
        if let Ok(cr) = r.canonicalize() {
            if full.starts_with(&cr) { return Ok(full); }
        }
    }
    Err("path escapes the project's roots".into())
}

#[derive(Serialize)]
struct Entry { name: String, is_dir: bool, size: u64 }

/// Resolve a command's `dir` argument against the opened-roots allowlist. The webview
/// never gets to name an arbitrary folder: only projects the user opened (or created,
/// or that live in the recents list) resolve — everything else is rejected before any
/// filesystem or git access happens.
fn project_for(roots: &OpenRoots, dir: &str) -> Result<Project, String> {
    let d = PathBuf::from(dir).canonicalize().map_err(|e| e.to_string())?;
    let allowed = roots.0.lock().map_err(|e| e.to_string())?.contains(&d);
    if !allowed {
        return Err("this folder isn't an open project".into());
    }
    Ok(load_project(&d))
}

fn allow_root(roots: &OpenRoots, dir: &Path) {
    if let Ok(mut g) = roots.0.lock() {
        g.insert(dir.to_path_buf());
    }
}

#[tauri::command]
async fn list_dir(roots: State<'_, OpenRoots>, dir: String, path: String) -> Result<Vec<Entry>, String> {
    let p = project_for(&roots, &dir)?;
    let p = &p;
    let dir = if path.is_empty() { p.repo.clone() } else { jailed(p, &path)? };
    let mut out: Vec<Entry> = std::fs::read_dir(&dir).map_err(|e| e.to_string())?
        .flatten()
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            if matches!(name.as_str(), ".git" | "node_modules" | ".DS_Store" | "target" | ".turbo" | ".chronicle-blank") { return None; }
            // follow symlinks so a linked directory lists as a directory (a
            // skills/ symlink read as a file surfaces "Is a directory (os error
            // 21)" in the viewer); a broken link falls back to the link itself.
            // Reads stay jailed — a link escaping the root is rejected at read.
            let md = std::fs::metadata(e.path()).or_else(|_| e.metadata()).ok()?;
            Some(Entry { is_dir: md.is_dir(), size: md.len(), name })
        }).collect();
    out.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then(a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    Ok(out)
}

#[tauri::command]
async fn read_file(roots: State<'_, OpenRoots>, dir: String, path: String) -> Result<String, String> {
    let p = project_for(&roots, &dir)?;
    let full = jailed(&p, &path)?;
    // size gate from METADATA — never read a huge file just to refuse it
    let len = std::fs::metadata(&full).map_err(|e| e.to_string())?.len();
    if len > 1_500_000 {
        return Ok(format!("[file is {len} bytes — too large to preview; click-to-copy still works]"));
    }
    let bytes = std::fs::read(&full).map_err(|e| e.to_string())?;
    match String::from_utf8(bytes) { Ok(s) => Ok(s), Err(_) => Ok("[binary file — no preview]".into()) }
}

#[tauri::command]
async fn copy_file(roots: State<'_, OpenRoots>, dir: String, path: String) -> Result<String, String> {
    let p = project_for(&roots, &dir)?;
    let full = jailed(&p, &path)?;
    let len = std::fs::metadata(&full).map_err(|e| e.to_string())?.len();
    if len > 5_000_000 {
        return Err(format!("that file is {len} bytes — too large to copy to the clipboard"));
    }
    let text = std::fs::read_to_string(&full).map_err(|e| e.to_string())?;
    let n = text.chars().count();
    arboard::Clipboard::new().and_then(|mut c| c.set_text(text)).map_err(|e| e.to_string())?;
    Ok(format!("{n}"))
}

#[tauri::command]
fn copy_text(text: String) -> Result<(), String> {
    arboard::Clipboard::new().and_then(|mut c| c.set_text(text)).map_err(|e| e.to_string())
}

/* ================= terminals (multi-PTY, cwd = current repo) ================= */

struct PtyHandles {
    master: Box<dyn MasterPty + Send>,
    // its own lock: pty_write must never hold the SESSIONS lock across blocking I/O
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    child: Box<dyn Child + Send + Sync>,
}
struct PtyState {
    // Arc: the per-session reader thread removes its own entry (and reaps) on exit
    sessions: Arc<Mutex<std::collections::HashMap<u32, PtyHandles>>>,
    next_id: std::sync::atomic::AtomicU32,
}

fn reap_pty(h: PtyHandles) {
    drop(h.writer);
    drop(h.master);
    let mut child = h.child;
    let _ = child.kill();
    let _ = child.wait(); // always reap — no zombies
}

#[tauri::command]
fn pty_spawn(app: tauri::AppHandle, roots: State<OpenRoots>, pty: State<PtyState>, dir: String, cols: u16, rows: u16) -> Result<u32, String> {
    let cwd = project_for(&roots, &dir).map(|p| p.repo)
        .unwrap_or_else(|_| PathBuf::from(std::env::var("HOME").unwrap_or_default()));
    let id = pty.next_id.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    let opened = native_pty_system()
        .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| e.to_string())?;
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
    let mut cmd = CommandBuilder::new(shell);
    cmd.arg("-l");
    cmd.cwd(cwd);
    cmd.env("TERM", "xterm-256color");
    let child = opened.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    let mut reader = opened.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = Arc::new(Mutex::new(opened.master.take_writer().map_err(|e| e.to_string())?));
    let sessions = pty.sessions.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match std::io::Read::read(&mut reader, &mut buf) {
                Ok(0) | Err(_) => {
                    let _ = app.emit("pty-exit", id);
                    // natural exit: remove the entry and reap — sessions never leak
                    if let Ok(mut g) = sessions.lock() {
                        if let Some(h) = g.remove(&id) { reap_pty(h); }
                    }
                    break;
                }
                Ok(n) => {
                    let b64 = base64::engine::general_purpose::STANDARD.encode(&buf[..n]);
                    let _ = app.emit("pty-out", (id, b64));
                }
            }
        }
    });
    pty.sessions.lock().map_err(|e| e.to_string())?
        .insert(id, PtyHandles { master: opened.master, writer, child });
    Ok(id)
}

/// Where the init/rebuild session writes its log — lets the UI open it as a
/// live terminal tab ("View full log"). Jailed to opened projects.
#[tauri::command]
fn init_log_path(roots: State<OpenRoots>, dir: String) -> Result<String, String> {
    let _ = project_for(&roots, &dir)?;
    let (_, log) = canon_key(&dir)?;
    Ok(log.to_string_lossy().to_string())
}

#[tauri::command]
fn pty_write(pty: State<PtyState>, id: u32, data: String) -> Result<(), String> {
    // clone the writer handle under the map lock, WRITE outside it (lock hygiene:
    // a slow pty must not stall every other terminal + spawn/resize)
    let writer = pty.sessions.lock().map_err(|e| e.to_string())?
        .get(&id).map(|h| h.writer.clone());
    if let Some(w) = writer {
        let mut w = w.lock().map_err(|e| e.to_string())?;
        w.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
        w.flush().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn pty_resize(pty: State<PtyState>, id: u32, cols: u16, rows: u16) -> Result<(), String> {
    let guard = pty.sessions.lock().map_err(|e| e.to_string())?;
    if let Some(h) = guard.get(&id) {
        h.master.resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 }).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn pty_kill(pty: State<PtyState>, id: u32) -> Result<(), String> {
    if let Some(h) = pty.sessions.lock().map_err(|e| e.to_string())?.remove(&id) {
        reap_pty(h);
    }
    Ok(())
}

/* ================= main (with --derive CLI for the golden test) ================= */

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if let Some(i) = args.iter().position(|a| a == "--derive") {
        let dir = args.get(i + 1).map(PathBuf::from).unwrap_or_else(|| PathBuf::from("."));
        let out = derive_for_dir(&dir);
        println!("{}", serde_json::to_string_pretty(&out).unwrap());
        // a missing/broken manifest is an ERROR exit — scripts must not read it as fine
        std::process::exit(if out.get("error").is_some() { 1 } else { 0 });
    }
    if let Some(i) = args.iter().position(|a| a == "--state") {
        let dir = args.get(i + 1).map(PathBuf::from).unwrap_or_else(|| PathBuf::from("."))
            .canonicalize().unwrap_or_else(|_| PathBuf::from("."));
        let p = load_project(&dir);
        let mut st = state_for_project(&p);
        let marker = p.dir.join(".chronicle-blank");
        let blank = marker.exists();
        if blank && p.manifest.is_some() { let _ = std::fs::remove_file(&marker); }
        if let Some(obj) = st.as_object_mut() {
            obj.insert("manifest".into(), p.manifest.as_ref()
                .map(|m| inject_rounds(&p.dir, m)).unwrap_or(Value::Null));
            obj.insert("blank".into(), json!(blank && p.manifest.is_none()));
            if p.manifest.is_none() {
                obj.insert("misplaced".into(), json!(misplaced_manifest(&p.dir)));
            }
        }
        println!("{}", serde_json::to_string_pretty(&json!({
            "open": { "dir": p.dir.to_string_lossy(), "repo": p.repo.to_string_lossy(),
                "manifest": p.manifest, "manifest_error": p.manifest_error,
                "part_of": if p.manifest.is_none() { part_of_hint(&p.dir) } else { Value::Null },
                "extras": p.extras.iter().map(|(a, pp)| json!({"alias": a, "path": pp.to_string_lossy()})).collect::<Vec<_>>() },
            "state": st,
        })).unwrap());
        std::process::exit(0);
    }
    // Seed the allowlist from the recents the user built up — those were all opened
    // through open_project at some point, so they carry the same trust.
    let seeded: HashSet<PathBuf> = load_recents().iter()
        .filter_map(|r| r.get("path").and_then(|v| v.as_str()))
        .filter_map(|p| PathBuf::from(p).canonicalize().ok())
        .collect();
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(OpenRoots(Mutex::new(seeded)))
        .manage(InitState { runs: Mutex::new(std::collections::HashMap::new()) })
        .manage(PtyState {
            sessions: Arc::new(Mutex::new(std::collections::HashMap::new())),
            next_id: std::sync::atomic::AtomicU32::new(1),
        })
        .on_window_event(|window, event| {
            // the window is gone: no orphaned children, ever — kill + reap every PTY
            // shell and every background roadmap session.
            if matches!(event, tauri::WindowEvent::Destroyed) {
                let app = window.app_handle();
                if let Some(pty) = app.try_state::<PtyState>() {
                    if let Ok(mut g) = pty.sessions.lock() {
                        for (_, h) in g.drain() { reap_pty(h); }
                    }
                }
                if let Some(init) = app.try_state::<InitState>() {
                    if let Ok(mut g) = init.runs.lock() {
                        for (_, (mut child, _)) in g.drain() { term_then_kill(&mut child); }
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_picker, open_project, create_project, remove_recent, adopt_manifest, get_state,
            init_start, init_status, init_cancel, set_init_consent, agents_available, set_default_agent,
            kanban_get, kanban_save, kanban_attach, fixes_generate, fixes_status, fixes_cancel,
            git_status_detail, git_stage, git_unstage, git_discard, git_commit, git_init_here, git_push, git_pull, git_log_graph, git_diff, run_command,
            git_checkout, git_worktree_prune, stat_file, read_file_b64,
            list_dir, read_file, copy_file, copy_text,
            pty_spawn, init_log_path,
            pty_write, pty_resize, pty_kill
        ])
        .run(tauri::generate_context!())
        .expect("error while running Chronicle");
}

/* ================= R1 gate tests (the jail, the allowlist, the reaper) ================= */

#[cfg(test)]
mod r1_tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("chronicle-test-{}-{}", name, std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d.canonicalize().unwrap()
    }

    fn ctx_for(repo: &Path) -> Ctx {
        Ctx { repo: repo.to_path_buf(), extras: vec![], tags: HashSet::new(), subjects: vec![] }
    }

    #[test]
    fn jail_rejects_absolute_and_parent_paths() {
        let repo = tmp("jail");
        std::fs::write(repo.join("inside.txt"), "ok").unwrap();
        let ctx = ctx_for(&repo);
        assert!(ctx.resolve_jailed("inside.txt").is_some(), "in-root file must resolve");
        assert!(ctx.resolve_jailed("/etc/passwd").is_none(), "absolute path must be rejected");
        assert!(ctx.resolve_jailed("../outside.txt").is_none(), "parent traversal must be rejected");
        assert!(ctx.resolve_jailed("a/../../outside.txt").is_none(), "embedded traversal must be rejected");
    }

    #[test]
    fn jail_rejects_symlink_escape() {
        let repo = tmp("jail-sym");
        let outside = tmp("jail-sym-outside");
        std::fs::write(outside.join("secret.txt"), "secret").unwrap();
        std::os::unix::fs::symlink(outside.join("secret.txt"), repo.join("link.txt")).unwrap();
        let ctx = ctx_for(&repo);
        assert!(ctx.resolve_jailed("link.txt").is_none(), "a symlink escaping the root must be rejected");
    }

    #[test]
    fn eval_cond_cannot_read_outside_roots() {
        let repo = tmp("cond");
        let ctx = ctx_for(&repo);
        // an absolute file_matches path used to read anywhere on disk — must be dead
        let cond = json!({"file_matches": {"path": "/etc/passwd", "pattern": "root"}});
        assert_eq!(eval_cond(&ctx, &cond), Some(false));
        let cond = json!({"file_exists": "/etc/passwd"});
        assert_eq!(eval_cond(&ctx, &cond), Some(false));
        let cond = json!({"file_exists": "/etc/passwd", "not": true});
        assert_eq!(eval_cond(&ctx, &cond), Some(true), "negated escape reports the jail verdict, not the disk");
    }

    #[test]
    fn allowlist_rejects_unopened_dirs() {
        let opened = tmp("allow-open");
        let stranger = tmp("allow-stranger");
        let roots = OpenRoots(Mutex::new(HashSet::from([opened.clone()])));
        assert!(project_for(&roots, opened.to_string_lossy().as_ref()).is_ok());
        let err = match project_for(&roots, stranger.to_string_lossy().as_ref()) {
            Err(e) => e, Ok(_) => panic!("a never-opened dir resolved"),
        };
        assert!(err.contains("isn't an open project"), "got: {err}");
        assert!(project_for(&roots, "/").is_err(), "the filesystem root must never resolve");
    }

    #[test]
    fn canon_key_is_collision_free_for_same_named_dirs() {
        let a = tmp("proj-a").join("weave"); std::fs::create_dir_all(&a).unwrap();
        let b = tmp("proj-b").join("weave"); std::fs::create_dir_all(&b).unwrap();
        let (ka, la) = canon_key(a.to_string_lossy().as_ref()).unwrap();
        let (kb, lb) = canon_key(b.to_string_lossy().as_ref()).unwrap();
        assert_ne!(ka, kb, "same-named folders must not share a run key");
        assert_ne!(la, lb, "same-named folders must not share a log file");
    }

    #[test]
    fn term_then_kill_stops_and_reaps() {
        let mut child = std::process::Command::new("sleep").arg("100").spawn().unwrap();
        let pid = child.id();
        term_then_kill(&mut child);
        // reaped: the pid must be gone from the process table
        let alive = std::process::Command::new("ps").args(["-p", &pid.to_string()])
            .output().map(|o| o.status.success()).unwrap_or(false);
        assert!(!alive, "the child must be dead and reaped (ps -p must fail)");
    }

    #[test]
    fn sniff_kind_classifies() {
        let d = tmp("sniff");
        std::fs::write(d.join("a.txt"), "hello").unwrap();
        std::fs::write(d.join("b.png"), [0x89u8, 0x50, 0x4e, 0x47]).unwrap();
        std::fs::write(d.join("c.bin"), [1u8, 0, 2, 0]).unwrap();
        assert_eq!(sniff_kind(&d.join("a.txt")), "text");
        assert_eq!(sniff_kind(&d.join("b.png")), "image");
        assert_eq!(sniff_kind(&d.join("c.bin")), "binary");
    }

    #[test]
    fn checkout_and_prune_work_on_a_real_repo() {
        let d = tmp("r2-git");
        let run = |args: &[&str]| {
            let o = std::process::Command::new("git").arg("-C").arg(&d).args(args).output().unwrap();
            assert!(o.status.success(), "git {:?}: {}", args, String::from_utf8_lossy(&o.stderr));
        };
        run(&["init", "-q", "-b", "main"]);
        run(&["-c", "user.email=t@t", "-c", "user.name=t", "commit", "--allow-empty", "-m", "first"]);
        run(&["branch", "side"]);
        git_full(&d, &["checkout", "side"]).unwrap();
        assert_eq!(git_in(&d, &["rev-parse", "--abbrev-ref", "HEAD"]), "side");
        let list = { git_full(&d, &["worktree", "prune"]).unwrap(); git_full(&d, &["worktree", "list"]).unwrap() };
        assert!(list.contains(d.to_string_lossy().as_ref()));
    }

    #[test]
    fn read_tail_reads_only_the_end() {
        let d = tmp("tail");
        let f = d.join("log.txt");
        std::fs::write(&f, format!("{}END", "x".repeat(100_000))).unwrap();
        let t = read_tail(&f, 100);
        assert!(t.len() <= 100 && t.ends_with("END"));
    }
}

#[cfg(test)]
mod r3_tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("chronicle-r3-{}-{}", name, std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d.canonicalize().unwrap()
    }

    fn git(d: &Path, args: &[&str]) {
        let o = std::process::Command::new("git").arg("-C").arg(d).args(args).output().unwrap();
        assert!(o.status.success(), "git {:?}: {}", args, String::from_utf8_lossy(&o.stderr));
    }

    fn repo(name: &str) -> PathBuf {
        let d = tmp(name);
        git(&d, &["init", "-q", "-b", "main"]);
        git(&d, &["-c", "user.email=t@t", "-c", "user.name=t", "commit", "--allow-empty", "-m", "feat: first save"]);
        d
    }

    #[test]
    fn every_condition_type_true_and_false() {
        let d = repo("conds");
        git(&d, &["tag", "phase-1"]);
        std::fs::write(d.join("REPORT.md"), "Status: **CLOSED**\n").unwrap();
        let ctx = Ctx::build(&Project { dir: d.clone(), repo: d.clone(), extras: vec![], manifest: None, manifest_error: None });

        assert_eq!(eval_cond(&ctx, &json!({"tag": "phase-1"})), Some(true));
        assert_eq!(eval_cond(&ctx, &json!({"tag": "phase-9"})), Some(false));
        assert_eq!(eval_cond(&ctx, &json!({"file_exists": "REPORT.md"})), Some(true));
        assert_eq!(eval_cond(&ctx, &json!({"file_exists": "MISSING.md"})), Some(false));
        assert_eq!(eval_cond(&ctx, &json!({"file_matches": {"path": "REPORT.md", "pattern": "\\*\\*CLOSED\\*\\*"}})), Some(true));
        assert_eq!(eval_cond(&ctx, &json!({"file_matches": {"path": "REPORT.md", "pattern": "OPEN"}})), Some(false));
        assert_eq!(eval_cond(&ctx, &json!({"commit_subject": "(?i)first save"})), Some(true));
        assert_eq!(eval_cond(&ctx, &json!({"commit_subject": "nope"})), Some(false));
        assert_eq!(eval_cond(&ctx, &json!({"file_glob": {"contains": "report"}})), Some(true));
        assert_eq!(eval_cond(&ctx, &json!({"file_glob": {"contains": "zzz"}})), Some(false));
        assert_eq!(eval_cond(&ctx, &json!({"worktree_branch": "main"})), Some(false),
            "the PRIMARY checkout must not count as a worktree");
    }

    #[test]
    fn failure_modes_are_dead() {
        let d = repo("fail");
        let ctx = Ctx::build(&Project { dir: d.clone(), repo: d.clone(), extras: vec![], manifest: None, manifest_error: None });
        // a regex that matches empty used to pass on a MISSING file
        assert_eq!(eval_cond(&ctx, &json!({"file_matches": {"path": "MISSING.md", "pattern": ".*"}})), Some(false));
        // unknown key: unsatisfiable, negated or not
        assert_eq!(eval_cond(&ctx, &json!({"file_exist": "typo.md"})), None);
        assert_eq!(eval_cond(&ctx, &json!({"file_exist": "typo.md", "not": true})), None,
            "a negated TYPO must not evaluate true");
        assert!(!any_conds(&ctx, Some(&json!([{"file_exist": "typo.md", "not": true}]))));
        // file_glob without contains: unsatisfiable, not match-everything
        assert_eq!(eval_cond(&ctx, &json!({"file_glob": {"dir": "."}})), None);
    }

    #[test]
    fn linked_worktree_counts() {
        let d = repo("wt");
        let wt = std::env::temp_dir().join(format!("chronicle-r3-wt-linked-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&wt);
        git(&d, &["worktree", "add", "-q", "-b", "medan", wt.to_string_lossy().as_ref()]);
        let ctx = Ctx::build(&Project { dir: d.clone(), repo: d.clone(), extras: vec![], manifest: None, manifest_error: None });
        assert_eq!(eval_cond(&ctx, &json!({"worktree_branch": "medan"})), Some(true));
        assert_eq!(eval_cond(&ctx, &json!({"worktree_branch": "main"})), Some(false));
        let _ = std::fs::remove_dir_all(&wt);
    }

    #[test]
    fn validation_catches_the_audit_findings() {
        let m = json!({
            "chronicleVersion": 9,
            "stages": [{"phases": [
                {"id": "A", "status": {"done_when": [{"file_exist": "typo.md"}]}},
                {"id": "A", "status": {"done_when": [{"file_matches": {"path": "x.md", "pattern": "(unclosed"}}]}},
                {"id": "B", "status": {"done_when": [{"file_glob": {"dir": "docs"}}, {"file_exists": "/etc/passwd"}]}}
            ]}],
            "actions": [{"when": [{"commit_subject": "(bad"}], "text": "x"}]
        });
        let w = validate_manifest(&m);
        let all = w.join("\n");
        assert!(all.contains("newer Chronicle"), "version: {all}");
        assert!(all.contains("exactly one known rule key"), "typo key: {all}");
        assert!(all.contains("appears more than once"), "dup id: {all}");
        assert!(all.contains("isn't a valid regex"), "regex: {all}");
        assert!(all.contains("contains"), "file_glob contains: {all}");
        assert!(all.contains("absolute"), "absolute path: {all}");
        assert!(validate_manifest(&json!({"chronicleVersion": 1, "stages": []})).is_empty());
    }

    #[test]
    fn action_fires_treats_omitted_when_as_always() {
        let d = repo("acts");
        let ctx = Ctx::build(&Project { dir: d.clone(), repo: d.clone(), extras: vec![], manifest: None, manifest_error: None });
        assert!(action_fires(&ctx, &json!({"text": "always on"})));
        assert!(!action_fires(&ctx, &json!({"text": "gated", "when": [{"tag": "nope"}]})));
    }
}

#[cfg(test)]
mod r4_tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("chronicle-r4-{}-{}", name, std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d.canonicalize().unwrap()
    }

    fn store_with_round(dir: &Path, cols: &[&str], state: &str) {
        let tasks: Vec<Value> = cols.iter().enumerate()
            .map(|(i, c)| json!({"id": format!("T-00{}", i + 1), "title": format!("task {}", i + 1), "column": c, "round": 1}))
            .collect();
        let ids: Vec<Value> = tasks.iter().map(|t| t["id"].clone()).collect();
        let store = json!({"version": 1, "next_id": cols.len() + 1, "tasks": tasks,
            "rounds": [{"n": 1, "state": state, "kind": "bug fixes", "task_ids": ids,
                        "plan_path": "fixes/phase_1_fixes_plan.md", "prompt_path": "fixes/phase_1_fixes_prompt.md"}]});
        std::fs::create_dir_all(dir.join(".chronicle")).unwrap();
        std::fs::write(kanban_path(dir), serde_json::to_string_pretty(&store).unwrap()).unwrap();
    }

    #[test]
    fn kanban_store_defaults_and_roundtrips() {
        let d = tmp("store");
        let fresh = load_kanban(&d);
        assert_eq!(fresh["next_id"], 1);
        assert!(fresh["tasks"].as_array().unwrap().is_empty());
        store_with_round(&d, &["queued"], "ready");
        assert_eq!(load_kanban(&d)["rounds"][0]["n"], 1);
    }

    #[test]
    fn settle_round_reads_the_truth_from_disk() {
        let d = tmp("settle");
        store_with_round(&d, &["queued"], "generating");
        // no files written → failed
        settle_round(&d);
        assert_eq!(load_kanban(&d)["rounds"][0]["state"], "failed");
        // files present + kind line → ready + kind
        store_with_round(&d, &["queued"], "generating");
        std::fs::create_dir_all(d.join("fixes")).unwrap();
        std::fs::write(d.join("fixes/phase_1_fixes_plan.md"), "Round kind: feature additions\n\n- T-001 …").unwrap();
        std::fs::write(d.join("fixes/phase_1_fixes_prompt.md"), "Execute the plan.").unwrap();
        settle_round(&d);
        let s = load_kanban(&d);
        assert_eq!(s["rounds"][0]["state"], "ready");
        assert_eq!(s["rounds"][0]["kind"], "feature additions");
    }

    #[test]
    fn overlay_injects_a_round_phase_and_derives_its_truth() {
        let d = tmp("overlay");
        let manifest = json!({"name": "x", "stages": [{"title": "S", "phases": [
            {"id": "P1", "name": "one", "status": {"done_when": [{"file_exists": "done.marker"}]}}
        ]}]});
        std::fs::write(d.join("done.marker"), "x").unwrap();
        store_with_round(&d, &["queued", "in_progress"], "ready");
        std::fs::create_dir_all(d.join("fixes")).unwrap();

        let merged = inject_rounds(&d, &manifest);
        let stages = merged["stages"].as_array().unwrap();
        assert_eq!(stages.len(), 2, "a synthetic stage is appended");
        let fix = &stages[1]["phases"][0];
        assert_eq!(fix["id"], "FX-1");
        assert_eq!(fix["name"], "Bug fixes");
        assert_eq!(fix["paste"][0]["path"], "fixes/phase_1_fixes_prompt.md");

        let ctx = Ctx { repo: d.clone(), extras: vec![], tags: HashSet::new(), subjects: vec![] };
        let sts = derive_statuses(&ctx, &merged);
        let m: std::collections::HashMap<&str, (&str, &str)> = sts.iter()
            .map(|s| (s.id.as_str(), (s.state.as_str(), s.label.as_str()))).collect();
        assert_eq!(m["P1"].0, "done");
        assert_eq!(m["FX-1"], ("now", "being fixed"), "an in-progress round is the current work");

        // all tasks completed → the round phase derives done
        store_with_round(&d, &["completed", "completed"], "ready");
        let merged = inject_rounds(&d, &manifest);
        let sts = derive_statuses(&ctx, &merged);
        let fx = sts.iter().find(|s| s.id == "FX-1").unwrap();
        assert_eq!(fx.state, "done");
    }

    #[test]
    fn round_two_gets_its_own_name() {
        let d = tmp("round2");
        let tasks = vec![
            json!({"id": "T-001", "column": "completed", "round": 1}),
            json!({"id": "T-002", "column": "queued", "round": 2}),
        ];
        let store = json!({"version": 1, "next_id": 3, "tasks": tasks, "rounds": [
            {"n": 1, "state": "ready", "kind": "bug fixes", "task_ids": ["T-001"],
             "plan_path": "fixes/phase_1_fixes_plan.md", "prompt_path": "fixes/phase_1_fixes_prompt.md"},
            {"n": 2, "state": "ready", "kind": "bug fixes", "task_ids": ["T-002"],
             "plan_path": "fixes/phase_2_fixes_plan.md", "prompt_path": "fixes/phase_2_fixes_prompt.md"}
        ]});
        std::fs::create_dir_all(d.join(".chronicle")).unwrap();
        std::fs::write(kanban_path(&d), serde_json::to_string(&store).unwrap()).unwrap();
        let merged = inject_rounds(&d, &json!({"name": "x", "stages": [{"title": "S", "phases": []}]}));
        let phases = merged["stages"][1]["phases"].as_array().unwrap();
        assert_eq!(phases.len(), 2);
        assert_eq!(phases[0]["name"], "Bug fixes");
        assert_eq!(phases[1]["name"], "Bug fixes · round 2");
        assert_eq!(phases[1]["id"], "FX-2");
    }

    #[test]
    fn no_rounds_means_no_overlay() {
        let d = tmp("noop");
        let manifest = json!({"name": "x", "stages": [{"title": "S", "phases": []}]});
        let merged = inject_rounds(&d, &manifest);
        assert_eq!(merged, manifest, "no kanban store → the manifest passes through untouched");
    }
}

