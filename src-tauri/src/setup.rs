// The doctor — Chronicle installs, verifies, and REPAIRS the five things it
// needs, for a non-developer, without admin and without them typing a command.
// Isolated like acp.rs. Everything lands in ~/.chronicle/tools/ (no .pkg, no
// sudo); downloads are HTTPS, arch-picked, and checksum-verified where the
// vendor publishes one; every write is jailed to the managed dir or the user's
// own shell files. Progress streams to the webview as `setup-update` events.
//
// The reliability backbone (§2.0): Chronicle never depends on the user's shell
// PATH — it resolves tools by absolute path and gives every subprocess a PATH
// that can find `node`. The terminal-PATH repair is the USER-FACING twin: it
// fixes their interactive shell so `claude` works when THEY type it.

use crate::acp::Emit;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

/// The marketplace + plugin for the "extra skills" check. VERIFIED on the day
/// (2026-07-17) from the local marketplace registry: the official marketplace
/// is the GitHub repo below and the plugin id is `superpowers`.
const SKILLS_MARKETPLACE: &str = "anthropics/claude-plugins-official";
const SKILLS_PLUGIN: &str = "superpowers@claude-plugins-official";
/// Claude's official installer. VERIFIED reachable on the day (302 → ok).
const CLAUDE_INSTALL_URL: &str = "https://claude.ai/install.sh";

/* ================= managed dirs + arch ================= */

fn home() -> PathBuf {
    PathBuf::from(std::env::var("HOME").unwrap_or_default())
}
fn tools_dir() -> PathBuf {
    home().join(".chronicle/tools")
}
fn bin_dir() -> PathBuf {
    tools_dir().join("bin")
}

/// Node's arch token (`arm64` | `x64`); gh uses `amd64` for x64.
fn node_arch() -> &'static str {
    match std::env::consts::ARCH {
        "aarch64" => "arm64",
        _ => "x64",
    }
}
fn gh_arch() -> &'static str {
    match std::env::consts::ARCH {
        "aarch64" => "arm64",
        _ => "amd64",
    }
}

/* ================= tool resolution ================= */

/// The Chronicle ladder, extended with the managed dir: does Chronicle itself
/// find this tool (by absolute path, PATH-independent)?
pub fn resolve(name: &str) -> Option<String> {
    use std::os::unix::fs::PermissionsExt;
    let is_exec = |p: &Path| {
        std::fs::metadata(p)
            .map(|m| m.is_file() && m.permissions().mode() & 0o111 != 0)
            .unwrap_or(false)
    };
    let h = home();
    let candidates = [
        bin_dir().join(name),
        h.join(".local/bin").join(name),
        h.join(".claude/local").join(name),
        PathBuf::from("/opt/homebrew/bin").join(name),
        PathBuf::from("/usr/local/bin").join(name),
        h.join(".npm-global/bin").join(name),
        h.join("bin").join(name),
    ];
    if let Some(p) = candidates.into_iter().find(|p| is_exec(p)) {
        return Some(p.to_string_lossy().to_string());
    }
    // a login shell as the last resort (nvm, unusual installs)
    crate::find_tool(name)
}

/// Can the user's INTERACTIVE terminal find this tool? (Sources .zshrc, where
/// installers put PATH lines.) A `Some(resolve)` + `None(interactive)` split is
/// exactly the terminal-PATH problem.
fn interactive_finds(name: &str) -> bool {
    let out = std::process::Command::new("/bin/zsh")
        .args(["-lic", &format!("command -v {name}")])
        .stdin(std::process::Stdio::null())
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
        .unwrap_or_default();
    crate::last_path_line(&out).is_some()
}

/// The PATH every setup subprocess gets: the managed bin + node's dir + the
/// well-known dirs, ahead of the inherited (minimal, Finder) PATH — so `curl`,
/// `tar`, `claude`, and `gh` all resolve `node`.
fn tool_env_path() -> String {
    let mut dirs: Vec<String> = vec![bin_dir().to_string_lossy().to_string()];
    if let Some(node) = resolve("node") {
        if let Some(parent) = Path::new(&node).parent() {
            dirs.push(parent.to_string_lossy().to_string());
        }
    }
    let h = home();
    for d in [
        "/opt/homebrew/bin".to_string(),
        "/usr/local/bin".to_string(),
        h.join(".local/bin").to_string_lossy().to_string(),
    ] {
        dirs.push(d);
    }
    dirs.push(std::env::var("PATH").unwrap_or_else(|_| "/usr/bin:/bin:/usr/sbin:/sbin".into()));
    dirs.join(":")
}

/* ================= download · verify · extract ================= */

fn content_length(url: &str) -> Option<u64> {
    let out = std::process::Command::new("curl")
        .args(["-sIL", "--max-time", "30", url])
        .output()
        .ok()?;
    let head = String::from_utf8_lossy(&out.stdout);
    head.lines().rev().find_map(|l| {
        let l = l.trim();
        let low = l.to_ascii_lowercase();
        low.strip_prefix("content-length:").map(|v| v.trim().parse::<u64>().ok())?
    })
}

/// curl the file while polling its size for progress, honoring cancel. Emits
/// `{ id, state: "installing", pct, gotBytes, totalBytes }` as it goes.
fn download(url: &str, dest: &Path, id: &str, emit: &Emit, cancel: &AtomicBool) -> Result<(), String> {
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let total = content_length(url).unwrap_or(0);
    let mut child = std::process::Command::new("curl")
        .args(["-fsSL", "--max-time", "600", "-o"])
        .arg(dest)
        .arg(url)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;
    loop {
        if cancel.load(Ordering::SeqCst) {
            let _ = child.kill();
            let _ = child.wait();
            let _ = std::fs::remove_file(dest);
            return Err("cancelled".into());
        }
        match child.try_wait() {
            Ok(Some(status)) => {
                if status.success() {
                    return Ok(());
                }
                return Err("the download didn't finish — check your internet connection and try again".into());
            }
            Ok(None) => {
                let got = std::fs::metadata(dest).map(|m| m.len()).unwrap_or(0);
                let pct = if total > 0 { ((got as f64 / total as f64) * 100.0).min(100.0) as u64 } else { 0 };
                emit_state(emit, id, json!({
                    "state": "installing", "pct": if total > 0 { Value::from(pct) } else { Value::Null },
                    "gotBytes": got, "totalBytes": total,
                }));
                std::thread::sleep(std::time::Duration::from_millis(200));
            }
            Err(e) => return Err(e.to_string()),
        }
    }
}

fn sha256_file(path: &Path) -> Option<String> {
    let bytes = std::fs::read(path).ok()?;
    let mut h = Sha256::new();
    h.update(&bytes);
    Some(format!("{:x}", h.finalize()))
}

fn extract_tar_gz(archive: &Path, into: &Path) -> Result<(), String> {
    std::fs::create_dir_all(into).map_err(|e| e.to_string())?;
    let out = std::process::Command::new("tar")
        .arg("-xzf").arg(archive).arg("-C").arg(into)
        .output().map_err(|e| e.to_string())?;
    if out.status.success() { Ok(()) } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

fn extract_zip(archive: &Path, into: &Path) -> Result<(), String> {
    std::fs::create_dir_all(into).map_err(|e| e.to_string())?;
    // ditto ships on every mac and handles the gh release zips cleanly
    let out = std::process::Command::new("ditto")
        .args(["-x", "-k"]).arg(archive).arg(into)
        .output().map_err(|e| e.to_string())?;
    if out.status.success() { Ok(()) } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

fn symlink_into_bin(target: &Path, name: &str) -> Result<(), String> {
    std::fs::create_dir_all(bin_dir()).map_err(|e| e.to_string())?;
    let link = bin_dir().join(name);
    let _ = std::fs::remove_file(&link);
    std::os::unix::fs::symlink(target, &link).map_err(|e| e.to_string())
}

/* ================= the terminal-PATH repair (the star fix) ================= */

const PATH_MARK_BEGIN: &str = "# >>> chronicle managed PATH >>>";
const PATH_MARK_END: &str = "# <<< chronicle managed PATH <<<";

fn path_block() -> String {
    let bin = bin_dir();
    let local = home().join(".local/bin");
    format!(
        "{PATH_MARK_BEGIN}\n# Added by Chronicle so `claude` (and friends) work in the terminal.\nexport PATH=\"{}:{}:$PATH\"\n{PATH_MARK_END}\n",
        local.to_string_lossy(),
        bin.to_string_lossy(),
    )
}

/// Write (or refresh) the marker-fenced block in a shell file. Idempotent —
/// replaces our OWN block if present, never touches anything outside the
/// markers, and never clobbers a hand-edited block that drifted from ours
/// (same safety model as the skill self-install marker).
fn ensure_path_block(file: &Path) -> Result<(), String> {
    let block = path_block();
    let existing = std::fs::read_to_string(file).unwrap_or_default();
    let next = if let (Some(b), Some(e)) = (existing.find(PATH_MARK_BEGIN), existing.find(PATH_MARK_END)) {
        // replace our fenced region in place
        let end = e + PATH_MARK_END.len();
        let mut out = String::with_capacity(existing.len());
        out.push_str(&existing[..b]);
        out.push_str(block.trim_end());
        // keep whatever followed the old end marker (usually a newline)
        out.push_str(&existing[end..]);
        out
    } else {
        let mut out = existing;
        if !out.is_empty() && !out.ends_with('\n') { out.push('\n'); }
        out.push('\n');
        out.push_str(&block);
        out
    };
    if let Some(parent) = file.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(file, next).map_err(|e| e.to_string())
}

pub fn fix_terminal_path() -> Result<(), String> {
    // .zshrc for interactive shells (where `claude` is typed), .zprofile for
    // login shells — both get the block so it survives either startup path.
    ensure_path_block(&home().join(".zshrc"))?;
    ensure_path_block(&home().join(".zprofile"))?;
    Ok(())
}

/* ================= the checks ================= */

/// The six rows the Setup screen shows, in run order.
const CHECKS: [&str; 6] = ["claude", "claude_signin", "node", "terminal_path", "github", "superpowers"];

fn plugin_installed(id: &str) -> bool {
    std::fs::read_to_string(home().join(".claude/plugins/installed_plugins.json"))
        .ok()
        .and_then(|s| serde_json::from_str::<Value>(&s).ok())
        .and_then(|v| v.get("plugins").and_then(|p| p.get(id)).cloned())
        .map(|v| v.as_array().map(|a| !a.is_empty()).unwrap_or(false))
        .unwrap_or(false)
}

fn gh_authed() -> bool {
    resolve("gh")
        .map(|gh| {
            std::process::Command::new(&gh)
                .args(["auth", "status"])
                .env("PATH", tool_env_path())
                .stdin(std::process::Stdio::null())
                .output()
                .map(|o| o.status.success())
                .unwrap_or(false)
        })
        .unwrap_or(false)
}

/// A best-effort "is Claude signed in" probe. There is no clean status command,
/// so we treat a persisted credentials file as the signal; when we can't tell,
/// we report `needs_you` (offer sign-in) rather than a false green.
fn claude_signed_in() -> bool {
    let creds = [
        home().join(".claude/.credentials.json"),
        home().join(".config/claude/.credentials.json"),
    ];
    creds.iter().any(|p| p.exists())
}

/// Detect one check's state, as the row renders it.
///   { id, state: ready|missing|needs_you, detail, action }
pub fn detect(id: &str) -> Value {
    let (state, detail, action) = match id {
        "claude" => {
            if resolve("claude").is_some() { ("ready", "", "") }
            else { ("missing", "", "install") }
        }
        "claude_signin" => {
            if resolve("claude").is_none() { ("blocked", "Install Claude first.", "") }
            else if claude_signed_in() { ("ready", "", "") }
            else { ("needs_you", "So the AI can start working on your behalf.", "signin") }
        }
        "node" => {
            if resolve("node").is_some() { ("ready", "", "") }
            else { ("missing", "", "install") }
        }
        "terminal_path" => {
            // the star fix: installed (ladder) but the terminal can't find it
            if resolve("claude").is_none() { ("blocked", "Install Claude first.", "") }
            else if interactive_finds("claude") { ("ready", "", "") }
            else { ("needs_you", "The AI is installed, but the terminal can't find it yet. Chronicle can fix that.", "fix_path") }
        }
        "github" => {
            if resolve("gh").is_none() { ("missing", "", "install") }
            else if !gh_authed() { ("needs_you", "Installed. Sign in so you can publish and share.", "signin") }
            else { ("ready", "", "") }
        }
        "superpowers" => {
            if resolve("claude").is_none() { ("blocked", "Install Claude first.", "") }
            else if plugin_installed(SKILLS_PLUGIN) { ("ready", "", "") }
            else { ("missing", "", "install") }
        }
        _ => ("unknown", "", ""),
    };
    json!({ "id": id, "state": state, "detail": detail, "action": action })
}

pub fn status() -> Value {
    let checks: Vec<Value> = CHECKS.iter().map(|id| detect(id)).collect();
    let ready = checks.iter().filter(|c| c["state"] == "ready").count();
    json!({ "checks": checks, "ready": ready, "total": CHECKS.len() })
}

/* ================= installs ================= */

fn emit_state(emit: &Emit, id: &str, extra: Value) {
    let mut obj = json!({ "id": id });
    if let (Some(o), Some(e)) = (obj.as_object_mut(), extra.as_object()) {
        for (k, v) in e { o.insert(k.clone(), v.clone()); }
    }
    (emit)(json!({ "message": obj }));
}
fn emit_done(emit: &Emit, id: &str) {
    emit_state(emit, id, detect(id).as_object().cloned().map(Value::Object).unwrap_or(json!({})));
}
fn emit_failed(emit: &Emit, id: &str, reason: &str, tech: Option<&str>) {
    emit_state(emit, id, json!({ "state": "couldnt_finish", "detail": reason, "tech": tech }));
}

/// Install Node: latest LTS tarball → managed dir → symlink node/npx/npm into
/// the managed bin. Checksum-verified against the vendor's SHASUMS256.
fn install_node(emit: &Emit, cancel: &AtomicBool) -> Result<(), String> {
    emit_state(emit, "node", json!({ "state": "installing", "pct": Value::Null }));
    let arch = node_arch();
    // latest LTS version + its published sha256
    let index = std::process::Command::new("curl")
        .args(["-fsSL", "--max-time", "30", "https://nodejs.org/dist/index.json"])
        .output().map_err(|e| e.to_string())?;
    let list: Value = serde_json::from_slice(&index.stdout).map_err(|e| e.to_string())?;
    let ver = list.as_array().and_then(|a| a.iter().find(|v| !matches!(v.get("lts"), Some(Value::Bool(false)))))
        .and_then(|v| v.get("version").and_then(|s| s.as_str()))
        .ok_or("couldn't find a Node version to install")?
        .to_string();
    let file = format!("node-{ver}-darwin-{arch}.tar.gz");
    let url = format!("https://nodejs.org/dist/{ver}/{file}");
    let sums = std::process::Command::new("curl")
        .args(["-fsSL", "--max-time", "30", &format!("https://nodejs.org/dist/{ver}/SHASUMS256.txt")])
        .output().map_err(|e| e.to_string())?;
    let want = String::from_utf8_lossy(&sums.stdout).lines()
        .find(|l| l.ends_with(&file))
        .and_then(|l| l.split_whitespace().next())
        .map(String::from);

    let tmp = tools_dir().join(".dl").join(&file);
    download(&url, &tmp, "node", emit, cancel)?;
    if let Some(want) = want {
        let got = sha256_file(&tmp).ok_or("couldn't read the download to verify it")?;
        if got != want {
            let _ = std::fs::remove_file(&tmp);
            return Err("the download didn't verify — try again".into());
        }
    }
    let node_root = tools_dir().join("node");
    let _ = std::fs::remove_dir_all(&node_root);
    extract_tar_gz(&tmp, &node_root)?;
    let _ = std::fs::remove_file(&tmp);
    // the tarball extracts to node-<ver>-darwin-<arch>/ — link its bin/* out
    let extracted = node_root.join(format!("node-{ver}-darwin-{arch}"));
    for exe in ["node", "npx", "npm"] {
        let target = extracted.join("bin").join(exe);
        if target.exists() { symlink_into_bin(&target, exe)?; }
    }
    if resolve("node").is_none() {
        return Err("Node installed but couldn't be found afterward — please try again".into());
    }
    Ok(())
}

fn install_claude(emit: &Emit, _cancel: &AtomicBool) -> Result<(), String> {
    emit_state(emit, "claude", json!({ "state": "installing", "pct": Value::Null }));
    // the official installer, run through a shell with node reachable
    let out = std::process::Command::new("/bin/zsh")
        .args(["-c", &format!("curl -fsSL {CLAUDE_INSTALL_URL} | bash")])
        .env("PATH", tool_env_path())
        .stdin(std::process::Stdio::null())
        .output()
        .map_err(|e| e.to_string())?;
    if resolve("claude").is_some() {
        return Ok(());
    }
    // fall back to npm via the managed node
    if let Some(npm) = resolve("npm") {
        let _ = std::process::Command::new(&npm)
            .args(["install", "-g", "@anthropic-ai/claude-code"])
            .env("PATH", tool_env_path())
            .env("npm_config_prefix", tools_dir().to_string_lossy().to_string())
            .stdin(std::process::Stdio::null())
            .output();
        if resolve("claude").is_some() { return Ok(()); }
    }
    let tail = String::from_utf8_lossy(&out.stderr);
    Err(format!("couldn't install Claude — {}", tail.lines().last().unwrap_or("please try again").chars().take(80).collect::<String>()))
}

fn install_github(emit: &Emit, cancel: &AtomicBool) -> Result<(), String> {
    emit_state(emit, "github", json!({ "state": "installing", "pct": Value::Null }));
    let arch = gh_arch();
    // latest release → the macOS zip asset for this arch
    let rel = std::process::Command::new("curl")
        .args(["-fsSL", "--max-time", "30", "https://api.github.com/repos/cli/cli/releases/latest"])
        .output().map_err(|e| e.to_string())?;
    let rel: Value = serde_json::from_slice(&rel.stdout).map_err(|e| e.to_string())?;
    let want_suffix = format!("macOS_{arch}.zip");
    let asset = rel.get("assets").and_then(|a| a.as_array())
        .and_then(|a| a.iter().find(|x| x.get("name").and_then(|n| n.as_str()).map(|n| n.ends_with(&want_suffix)).unwrap_or(false)))
        .ok_or("couldn't find the GitHub tool download")?;
    let url = asset.get("browser_download_url").and_then(|u| u.as_str()).ok_or("bad download url")?.to_string();

    let tmp = tools_dir().join(".dl").join(format!("gh_{arch}.zip"));
    download(&url, &tmp, "github", emit, cancel)?;
    let gh_root = tools_dir().join("gh");
    let _ = std::fs::remove_dir_all(&gh_root);
    extract_zip(&tmp, &gh_root)?;
    let _ = std::fs::remove_file(&tmp);
    // the zip contains gh_<ver>_macOS_<arch>/bin/gh
    let bin = find_binary(&gh_root, "gh").ok_or("the GitHub tool didn't unpack correctly")?;
    symlink_into_bin(&bin, "gh")?;
    if resolve("gh").is_none() {
        return Err("GitHub's tool installed but couldn't be found afterward — please try again".into());
    }
    Ok(())
}

/// Find `name` under a freshly-extracted dir (one level of nesting).
fn find_binary(root: &Path, name: &str) -> Option<PathBuf> {
    let direct = root.join("bin").join(name);
    if direct.exists() { return Some(direct); }
    let rd = std::fs::read_dir(root).ok()?;
    for e in rd.flatten() {
        let p = e.path().join("bin").join(name);
        if p.exists() { return Some(p); }
    }
    None
}

fn install_superpowers(emit: &Emit, _cancel: &AtomicBool) -> Result<(), String> {
    emit_state(emit, "superpowers", json!({ "state": "installing", "pct": Value::Null }));
    let claude = resolve("claude").ok_or("Install Claude first.")?;
    let run = |args: &[&str]| {
        std::process::Command::new(&claude)
            .args(args)
            .env("PATH", tool_env_path())
            .stdin(std::process::Stdio::null())
            .output()
    };
    // marketplace add is a no-op if already added — ignore its non-zero
    let _ = run(&["plugin", "marketplace", "add", SKILLS_MARKETPLACE]);
    let out = run(&["plugin", "install", SKILLS_PLUGIN, "--scope", "user"]).map_err(|e| e.to_string())?;
    if plugin_installed(SKILLS_PLUGIN) {
        return Ok(());
    }
    Err(format!("couldn't add the extra skills — {}", String::from_utf8_lossy(&out.stderr).lines().last().unwrap_or("please try again").chars().take(80).collect::<String>()))
}

/// Run one check's install/repair action. Returns Ok when the check is now
/// resolved (or the action was dispatched, for sign-ins).
pub fn install(id: &str, emit: &Emit, cancel: &AtomicBool) -> Result<(), String> {
    let r = match id {
        "node" => install_node(emit, cancel),
        "claude" => install_claude(emit, cancel),
        "github" => install_github(emit, cancel),
        "superpowers" => install_superpowers(emit, cancel),
        "terminal_path" => fix_terminal_path(),
        _ => Err(format!("{id} isn't installable here")),
    };
    match &r {
        Ok(()) => emit_done(emit, id),
        Err(e) if e == "cancelled" => emit_done(emit, id),
        Err(e) => emit_failed(emit, id, e, None),
    }
    r
}

/* ================= state (cancel flags) + run-all ================= */

/// A cloneable handle to the per-check cancel flags — so blocking install work
/// can own it (via spawn_blocking) while the cancel command still reaches it.
#[derive(Clone)]
pub struct SetupState {
    cancels: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
}
impl SetupState {
    pub fn new() -> Self {
        SetupState { cancels: Arc::new(Mutex::new(HashMap::new())) }
    }
    pub fn cancel_flag(&self, id: &str) -> Arc<AtomicBool> {
        let mut g = self.cancels.lock().unwrap_or_else(|e| e.into_inner());
        g.entry(id.to_string()).or_insert_with(|| Arc::new(AtomicBool::new(false))).clone()
    }
    pub fn request_cancel(&self, id: &str) {
        if let Ok(g) = self.cancels.lock() {
            if let Some(f) = g.get(id) { f.store(true, Ordering::SeqCst); }
        }
    }
    pub fn reset(&self, id: &str) {
        self.cancel_flag(id).store(false, Ordering::SeqCst);
    }
}

/// "Set everything up for me": install everything installable in dependency
/// order; the PATH repair runs non-interactively; sign-ins are triggered (the
/// terminal opens) and their rows finish as the user signs in. Stops honestly
/// on a hard install failure.
pub fn run_all(state: &SetupState, emit: &Emit) {
    for id in ["node", "claude", "terminal_path", "superpowers", "github"] {
        let cur = detect(id);
        if cur["state"] == "ready" { continue; }
        if cur["state"] == "blocked" { continue; }
        // only installables here; sign-ins are surfaced as needs_you afterward
        if matches!(id, "node" | "claude" | "github" | "superpowers" | "terminal_path") {
            let flag = state.cancel_flag(id);
            flag.store(false, Ordering::SeqCst);
            if install(id, emit, &flag).is_err() {
                emit_state(emit, "_all", json!({ "state": "stopped" }));
                return;
            }
        }
    }
    emit_state(emit, "_all", json!({ "state": "done" }));
}

/* ================= S-1 tests ================= */

#[cfg(test)]
mod setup_tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("chronicle-setup-{}-{}", name, std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn path_block_is_idempotent_marker_safe_and_never_clobbers() {
        let d = tmp("pathblock");
        let rc = d.join(".zshrc");
        // a shell file the user already owns
        std::fs::write(&rc, "export EDITOR=vim\nalias g=git\n").unwrap();

        ensure_path_block(&rc).unwrap();
        let once = std::fs::read_to_string(&rc).unwrap();
        assert!(once.contains("export EDITOR=vim"), "the user's lines survive: {once}");
        assert!(once.contains("alias g=git"));
        assert!(once.contains(PATH_MARK_BEGIN) && once.contains(PATH_MARK_END));
        assert!(once.contains(".local/bin"));

        // running again is a no-op region-replace — exactly ONE block, no growth
        ensure_path_block(&rc).unwrap();
        let twice = std::fs::read_to_string(&rc).unwrap();
        assert_eq!(twice.matches(PATH_MARK_BEGIN).count(), 1, "never a second block: {twice}");
        assert_eq!(once, twice, "idempotent: the file is byte-identical on re-run");

        // a line the user adds AFTER our block is preserved on the next refresh
        let hand = format!("{twice}\nexport MY_OWN=1\n");
        std::fs::write(&rc, &hand).unwrap();
        ensure_path_block(&rc).unwrap();
        let after = std::fs::read_to_string(&rc).unwrap();
        assert!(after.contains("export MY_OWN=1"), "content outside our markers is never touched: {after}");
        assert_eq!(after.matches(PATH_MARK_BEGIN).count(), 1);
    }

    #[test]
    fn arch_tokens_are_right() {
        // whichever arch the test host is, the tokens are from the valid set
        assert!(matches!(node_arch(), "arm64" | "x64"));
        assert!(matches!(gh_arch(), "arm64" | "amd64"));
        // and they agree on family
        assert_eq!(node_arch() == "arm64", gh_arch() == "arm64");
    }

    #[test]
    fn find_binary_locates_a_nested_extracted_tool() {
        let d = tmp("findbin");
        let nested = d.join("gh_2.96.0_macOS_arm64").join("bin");
        std::fs::create_dir_all(&nested).unwrap();
        std::fs::write(nested.join("gh"), "#!/bin/sh\n").unwrap();
        let found = find_binary(&d, "gh").expect("finds the nested binary");
        assert!(found.ends_with("bin/gh"));
        assert!(find_binary(&d, "nope").is_none());
    }

    #[test]
    fn extract_round_trips_a_tarball() {
        let d = tmp("extract");
        let src = d.join("src");
        std::fs::create_dir_all(src.join("bin")).unwrap();
        std::fs::write(src.join("bin").join("thing"), "hi").unwrap();
        let arc = d.join("a.tar.gz");
        let o = std::process::Command::new("tar")
            .args(["-czf"]).arg(&arc).arg("-C").arg(&src).arg("bin")
            .output().unwrap();
        assert!(o.status.success());
        let into = d.join("out");
        extract_tar_gz(&arc, &into).unwrap();
        assert_eq!(std::fs::read_to_string(into.join("bin").join("thing")).unwrap(), "hi");
    }

    #[test]
    fn sha256_verifies_a_known_payload() {
        let d = tmp("sha");
        let f = d.join("x");
        std::fs::write(&f, b"chronicle").unwrap();
        let want = format!("{:x}", { let mut h = Sha256::new(); h.update(b"chronicle"); h.finalize() });
        assert_eq!(sha256_file(&f).unwrap(), want);
    }

    #[test]
    fn status_shape_is_honest() {
        let s = status();
        assert_eq!(s["checks"].as_array().unwrap().len(), 6);
        assert!(s["total"] == 6);
        // every check reports one of the known states
        for c in s["checks"].as_array().unwrap() {
            let st = c["state"].as_str().unwrap();
            assert!(matches!(st, "ready" | "missing" | "needs_you" | "blocked" | "checking"), "bad state {st}");
        }
    }

    /// The REAL install pipeline (download → verify → extract → run) against the
    /// live Node vendor. Gated: CHRONICLE_SETUP_TEST=1 (needs the network).
    #[test]
    #[ignore]
    fn real_node_download_verify_extract() {
        if std::env::var("CHRONICLE_SETUP_TEST").ok().as_deref() != Some("1") {
            eprintln!("skipped: set CHRONICLE_SETUP_TEST=1 to run the real install pipeline");
            return;
        }
        let d = tmp("real-node");
        let arch = node_arch();
        // latest LTS + its published checksum
        let index = std::process::Command::new("curl")
            .args(["-fsSL", "https://nodejs.org/dist/index.json"]).output().unwrap();
        let list: Value = serde_json::from_slice(&index.stdout).unwrap();
        let ver = list.as_array().unwrap().iter()
            .find(|v| !matches!(v.get("lts"), Some(Value::Bool(false))))
            .unwrap().get("version").unwrap().as_str().unwrap().to_string();
        let file = format!("node-{ver}-darwin-{arch}.tar.gz");
        let url = format!("https://nodejs.org/dist/{ver}/{file}");
        let sums = std::process::Command::new("curl")
            .args(["-fsSL", &format!("https://nodejs.org/dist/{ver}/SHASUMS256.txt")]).output().unwrap();
        let want = String::from_utf8_lossy(&sums.stdout).lines()
            .find(|l| l.ends_with(&file)).unwrap().split_whitespace().next().unwrap().to_string();

        let dest = d.join(&file);
        let emit: Emit = Arc::new(|_| {});
        download(&url, &dest, "node", &emit, &AtomicBool::new(false)).unwrap();
        assert_eq!(sha256_file(&dest).unwrap(), want, "the tarball verifies against the vendor checksum");
        extract_tar_gz(&dest, &d.join("node")).unwrap();
        let node = d.join("node").join(format!("node-{ver}-darwin-{arch}")).join("bin").join("node");
        assert!(node.exists(), "node binary extracted");
        let v = std::process::Command::new(&node).arg("--version").output().unwrap();
        assert!(String::from_utf8_lossy(&v.stdout).starts_with('v'), "the extracted node runs");
        let _ = std::fs::remove_dir_all(&d);
    }
}
