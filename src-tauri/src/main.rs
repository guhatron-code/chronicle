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
use std::sync::Mutex;
use tauri::{Emitter, State};

/* ================= project model ================= */

#[derive(Clone)]
struct Project {
    dir: PathBuf,                       // the folder that was opened (holds chronicle.json)
    repo: PathBuf,                      // git root (manifest roots.repo, relative to dir)
    extras: Vec<(String, PathBuf)>,     // alias -> absolute path
    manifest: Option<Value>,            // None => no/invalid manifest (degraded view)
    manifest_error: Option<String>,
}

/// Background /chronicle-init runs, keyed by project dir.
struct InitState {
    runs: Mutex<std::collections::HashMap<String, (std::process::Child, PathBuf)>>,
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
    Command::new("git").arg("-C").arg(repo).args(args).output()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_default()
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
            subjects: git_in(&p.repo, &["log", "--format=%s"]).lines().map(String::from).collect(),
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
}

/// One condition. Supported keys (exactly one per object, plus optional "not": true):
///   tag              — a git tag with this exact name exists
///   file_exists      — the path exists (roots-relative; "@alias/…" for extra roots)
///   file_matches     — { path, pattern } — regex (multiline) matches the file's contents
///   commit_subject   — regex matches any commit subject in the log
///   file_glob        — { dir?, contains } — some entry in dir (default the project dir)
///                      whose lowercased name contains this string exists
fn eval_cond(ctx: &Ctx, cond: &Value) -> bool {
    let negate = cond.get("not").and_then(|v| v.as_bool()).unwrap_or(false);
    let result = (|| {
        if let Some(t) = cond.get("tag").and_then(|v| v.as_str()) {
            return ctx.tags.contains(t);
        }
        if let Some(p) = cond.get("file_exists").and_then(|v| v.as_str()) {
            return ctx.resolve(p).exists();
        }
        if let Some(fm) = cond.get("file_matches") {
            if let (Some(p), Some(pat)) = (
                fm.get("path").and_then(|v| v.as_str()),
                fm.get("pattern").and_then(|v| v.as_str()),
            ) {
                let text = std::fs::read_to_string(ctx.resolve(p)).unwrap_or_default();
                return Regex::new(&format!("(?m){pat}")).map(|re| re.is_match(&text)).unwrap_or(false);
            }
            return false;
        }
        if let Some(pat) = cond.get("commit_subject").and_then(|v| v.as_str()) {
            if let Ok(re) = Regex::new(pat) {
                return ctx.subjects.iter().any(|s| re.is_match(s));
            }
            return false;
        }
        if let Some(wb) = cond.get("worktree_branch").and_then(|v| v.as_str()) {
            return git_in(&ctx.repo, &["worktree", "list", "--porcelain"])
                .lines()
                .any(|l| l.strip_prefix("branch refs/heads/") == Some(wb));
        }
        if let Some(fg) = cond.get("file_glob") {
            let dir = fg.get("dir").and_then(|v| v.as_str()).map(|d| ctx.resolve(d));
            let needle = fg.get("contains").and_then(|v| v.as_str()).unwrap_or("").to_lowercase();
            let dir = dir.unwrap_or_else(|| ctx.repo.clone());
            if let Ok(rd) = std::fs::read_dir(dir) {
                return rd.flatten().any(|e| e.file_name().to_string_lossy().to_lowercase().contains(&needle));
            }
            return false;
        }
        false
    })();
    if negate { !result } else { result }
}

fn all_conds(ctx: &Ctx, conds: Option<&Value>) -> bool {
    match conds.and_then(|v| v.as_array()) {
        None => false,
        Some(arr) => !arr.is_empty() && arr.iter().all(|c| eval_cond(ctx, c)),
    }
}
fn any_conds(ctx: &Ctx, conds: Option<&Value>) -> bool {
    match conds.and_then(|v| v.as_array()) {
        None => false,
        Some(arr) => arr.iter().any(|c| eval_cond(ctx, c)),
    }
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
            json!({ "name": m.get("name"), "statuses": derive_statuses(&ctx, m) })
        }
    }
}

/* ================= commands ================= */

#[derive(Serialize)]
struct Worktree { path: String, branch: String, prunable: bool }
#[derive(Serialize)]
struct DirtyEntry { code: String, path: String }

#[tauri::command]
fn get_picker() -> Value {
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
                        for a in actions { if all_conds(&ctx, a.get("when")) { needs += 1; } }
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
fn create_project(name: String) -> Result<String, String> {
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
fn adopt_manifest(dir: String, sub: String) -> Result<(), String> {
    if sub.contains('/') || sub.contains("..") { return Err("bad folder name".into()); }
    let dir = PathBuf::from(&dir).canonicalize().map_err(|e| e.to_string())?;
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
fn open_project(path: String) -> Result<Value, String> {
    let dir = PathBuf::from(&path).canonicalize().map_err(|e| e.to_string())?;
    if !dir.is_dir() { return Err("not a folder".into()); }
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
fn get_state(dir: String) -> Result<Value, String> {
    let dir = PathBuf::from(&dir).canonicalize().map_err(|e| e.to_string())?;
    let p = load_project(&dir);
    let mut s = state_for_project(&p);
    let marker = p.dir.join(".chronicle-blank");
    let blank = marker.exists();
    if blank && p.manifest.is_some() { let _ = std::fs::remove_file(&marker); } // roadmap arrived
    if let Some(obj) = s.as_object_mut() {
        obj.insert("manifest".into(), p.manifest.clone().unwrap_or(Value::Null));
        obj.insert("blank".into(), json!(blank && p.manifest.is_none()));
        if p.manifest.is_none() {
            obj.insert("misplaced".into(), json!(misplaced_manifest(&p.dir)));
        }
        obj.insert("extras".into(), json!(p.extras.iter()
            .map(|(a, pp)| json!({"alias": a, "path": pp.to_string_lossy()})).collect::<Vec<_>>()));
    }
    Ok(s)
}

/* ================= background /chronicle-init ================= */

#[tauri::command]
fn init_start(init: State<InitState>, dir: String, agent: Option<String>) -> Result<(), String> {
    let dirp = PathBuf::from(&dir).canonicalize().map_err(|e| e.to_string())?;
    let mut runs = init.runs.lock().map_err(|e| e.to_string())?;
    if let Some((child, _)) = runs.get_mut(&dir) {
        if child.try_wait().map_err(|e| e.to_string())?.is_none() {
            return Ok(()); // already running
        }
    }
    let log = std::env::temp_dir().join(format!("chronicle-init-{}.log",
        dirp.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default()));
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
    runs.insert(dir, (child, log));
    Ok(())
}

#[tauri::command]
fn init_status(init: State<InitState>, dir: String) -> Result<Value, String> {
    let mut runs = init.runs.lock().map_err(|e| e.to_string())?;
    match runs.get_mut(&dir) {
        None => Ok(json!({"running": false, "started": false})),
        Some((child, log)) => {
            let code = child.try_wait().map_err(|e| e.to_string())?;
            let tail = std::fs::read_to_string(&*log).unwrap_or_default();
            let tail: String = tail.chars().rev().take(30000).collect::<String>().chars().rev().collect();
            Ok(json!({
                "running": code.is_none(), "started": true,
                "code": code.and_then(|c| c.code()),
                "log_tail": tail,
            }))
        }
    }
}

fn state_for_project(p: &Project) -> Value {
    let ctx = Ctx::build(p);

    let branch = git_in(&p.repo, &["rev-parse", "--abbrev-ref", "HEAD"]);
    let is_git = !branch.is_empty();
    // does this project have an online home at all? (no network — just the configured remote)
    let remote_url = git_in(&p.repo, &["remote", "get-url", "origin"]);
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

    let (statuses, doc_existence, stale, custom_actions) = match &p.manifest {
        None => (Vec::new(), json!({}), json!([]), json!([])),
        Some(m) => {
            let statuses = derive_statuses(&ctx, m);
            // existence for every path the manifest references (paste + docs)
            let mut docs = serde_json::Map::new();
            let mut walk = |path: &str| {
                docs.insert(path.to_string(), json!(ctx.resolve(path).exists()));
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
                        let got = std::fs::read(ctx.resolve(pp)).map(|b| {
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
                    let fire = match a.get("when") {
                        None => true,
                        Some(w) => all_conds(&ctx, Some(w)),
                    };
                    if fire { acts.push(a.clone()); }
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
        "is_git": is_git, "branch": branch, "upstream": upstream, "ahead": ahead, "behind": behind,
        "remote_url": remote_url,
        "last_commit": git_in(&p.repo, &["log", "-1", "--format=%h · %s"]),
        "tags": tags_sorted,
        "worktrees": worktrees, "dirty": dirty,
        "statuses": statuses, "docs": doc_existence, "stale": stale, "custom_actions": custom_actions,
        "work_branch": p.manifest.as_ref().and_then(|m| m.get("workBranch")).cloned().unwrap_or(Value::Null),
        "checked_at": Command::new("date").arg("+%H:%M:%S").output()
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string()).unwrap_or_default(),
    })
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
fn git_status_detail(dir: String) -> Result<Value, String> {
    let p = project_for(&dir)?;
    let raw = git_full(&p.repo, &["status", "--porcelain=v1"]).unwrap_or_default();
    let mut staged = Vec::new();
    let mut unstaged = Vec::new();
    for l in raw.lines() {
        if l.len() < 4 { continue; }
        let x = l.as_bytes()[0] as char;
        let y = l.as_bytes()[1] as char;
        let path = l[3..].trim_matches('"').to_string();
        if x != ' ' && x != '?' { staged.push(json!({"path": path, "code": x.to_string()})); }
        if y != ' ' { unstaged.push(json!({"path": path, "code": if x=='?' {"A".into()} else {y.to_string()}, "untracked": x=='?'})); }
    }
    Ok(json!({ "staged": staged, "unstaged": unstaged }))
}

#[tauri::command]
fn git_stage(dir: String, path: Option<String>) -> Result<(), String> {
    let p = project_for(&dir)?;
    match path {
        Some(f) => git_full(&p.repo, &["add", "--", &f]).map(|_| ()),
        None => git_full(&p.repo, &["add", "-A"]).map(|_| ()),
    }
}

#[tauri::command]
fn git_unstage(dir: String, path: String) -> Result<(), String> {
    let p = project_for(&dir)?;
    git_full(&p.repo, &["reset", "-q", "HEAD", "--", &path]).map(|_| ())
}

/// Destructive; the UI always confirms first. Untracked files are deleted, tracked restored.
#[tauri::command]
fn git_discard(dir: String, path: String, untracked: bool) -> Result<(), String> {
    let p = project_for(&dir)?;
    if untracked { git_full(&p.repo, &["clean", "-f", "--", &path]).map(|_| ()) }
    else { git_full(&p.repo, &["checkout", "--", &path]).map(|_| ()) }
}

#[tauri::command]
fn git_commit(dir: String, message: String, stage_all: bool) -> Result<(), String> {
    let p = project_for(&dir)?;
    if message.trim().is_empty() { return Err("give the save a short message".into()); }
    if stage_all { git_full(&p.repo, &["add", "-A"])?; }
    git_full(&p.repo, &["commit", "-m", &message]).map(|_| ())
}

/// Plain push only. No force flag exists anywhere in this app.
#[tauri::command]
fn git_push(dir: String) -> Result<(), String> {
    let p = project_for(&dir)?;
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
fn git_pull(dir: String) -> Result<(), String> {
    let p = project_for(&dir)?;
    git_full(&p.repo, &["pull", "--ff-only"]).map(|_| ())
}

#[tauri::command]
fn git_log_graph(dir: String, limit: Option<u32>) -> Result<Value, String> {
    let p = project_for(&dir)?;
    let n = limit.unwrap_or(30).min(200).to_string();
    let raw = git_full(&p.repo, &["log", "-n", &n, "--pretty=format:%h\x1f%p\x1f%s\x1f%an\x1f%ar\x1f%D"])
        .unwrap_or_default();
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
fn git_diff(dir: String, path: String, staged: bool, untracked: bool) -> Result<String, String> {
    let p = project_for(&dir)?;
    if untracked {
        // no-index diff exits 1 when files differ; capture output regardless
        let out = Command::new("git").arg("-C").arg(&p.repo)
            .args(["diff", "--no-index", "--", "/dev/null", &path]).output()
            .map_err(|e| e.to_string())?;
        return Ok(String::from_utf8_lossy(&out.stdout).to_string());
    }
    if staged { git_full(&p.repo, &["diff", "--cached", "--", &path]) }
    else { git_full(&p.repo, &["diff", "--", &path]) }
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

fn project_for(dir: &str) -> Result<Project, String> {
    let d = PathBuf::from(dir).canonicalize().map_err(|e| e.to_string())?;
    Ok(load_project(&d))
}

#[tauri::command]
fn list_dir(dir: String, path: String) -> Result<Vec<Entry>, String> {
    let p = project_for(&dir)?;
    let p = &p;
    let dir = if path.is_empty() { p.repo.clone() } else { jailed(p, &path)? };
    let mut out: Vec<Entry> = std::fs::read_dir(&dir).map_err(|e| e.to_string())?
        .flatten()
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            if matches!(name.as_str(), ".git" | "node_modules" | ".DS_Store" | "target" | ".turbo" | ".chronicle-blank") { return None; }
            let md = e.metadata().ok()?;
            Some(Entry { is_dir: md.is_dir(), size: md.len(), name })
        }).collect();
    out.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then(a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    Ok(out)
}

#[tauri::command]
fn read_file(dir: String, path: String) -> Result<String, String> {
    let p = project_for(&dir)?;
    let full = jailed(&p, &path)?;
    let bytes = std::fs::read(&full).map_err(|e| e.to_string())?;
    if bytes.len() > 1_500_000 {
        return Ok(format!("[file is {} bytes — too large to preview; click-to-copy still works]", bytes.len()));
    }
    match String::from_utf8(bytes) { Ok(s) => Ok(s), Err(_) => Ok("[binary file — no preview]".into()) }
}

#[tauri::command]
fn copy_file(dir: String, path: String) -> Result<String, String> {
    let p = project_for(&dir)?;
    let full = jailed(&p, &path)?;
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
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
}
struct PtyState {
    sessions: Mutex<std::collections::HashMap<u32, PtyHandles>>,
    next_id: std::sync::atomic::AtomicU32,
}

#[tauri::command]
fn pty_spawn(app: tauri::AppHandle, pty: State<PtyState>, dir: String, cols: u16, rows: u16) -> Result<u32, String> {
    let cwd = project_for(&dir).map(|p| p.repo)
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
    let writer = opened.master.take_writer().map_err(|e| e.to_string())?;
    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match std::io::Read::read(&mut reader, &mut buf) {
                Ok(0) | Err(_) => { let _ = app.emit("pty-exit", id); break; }
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

#[tauri::command]
fn pty_write(pty: State<PtyState>, id: u32, data: String) -> Result<(), String> {
    let mut guard = pty.sessions.lock().map_err(|e| e.to_string())?;
    if let Some(h) = guard.get_mut(&id) {
        h.writer.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
        h.writer.flush().map_err(|e| e.to_string())?;
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
        drop(h.writer);
        let mut child = h.child;
        let _ = child.kill();
    }
    Ok(())
}

/* ================= main (with --derive CLI for the golden test) ================= */

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if let Some(i) = args.iter().position(|a| a == "--derive") {
        let dir = args.get(i + 1).map(PathBuf::from).unwrap_or_else(|| PathBuf::from("."));
        println!("{}", serde_json::to_string_pretty(&derive_for_dir(&dir)).unwrap());
        std::process::exit(0);
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
            obj.insert("manifest".into(), p.manifest.clone().unwrap_or(Value::Null));
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
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(InitState { runs: Mutex::new(std::collections::HashMap::new()) })
        .manage(PtyState {
            sessions: Mutex::new(std::collections::HashMap::new()),
            next_id: std::sync::atomic::AtomicU32::new(1),
        })
        .invoke_handler(tauri::generate_handler![
            get_picker, open_project, create_project, remove_recent, adopt_manifest, get_state, init_start, init_status, agents_available, set_default_agent,
            git_status_detail, git_stage, git_unstage, git_discard, git_commit, git_push, git_pull, git_log_graph, git_diff,
            list_dir, read_file, copy_file, copy_text,
            pty_spawn, pty_write, pty_resize, pty_kill
        ])
        .run(tauri::generate_context!())
        .expect("error while running Chronicle");
}
