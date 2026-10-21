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

/* ================= bundled resources ================= */

/// The app's resource dir, recorded once by `main`'s setup hook so code without an
/// `AppHandle` (the design lint, the design plugin) can find bundled files.
static RESOURCE_DIR: std::sync::OnceLock<PathBuf> = std::sync::OnceLock::new();

pub fn set_resource_dir(p: PathBuf) { let _ = RESOURCE_DIR.set(p); }

pub fn resource_dir() -> Option<PathBuf> { RESOURCE_DIR.get().cloned() }

/// The bundled design skills (impeccable and ours), when this build carries them.
pub fn design_plugin_dir() -> Option<PathBuf> {
    resource_dir().map(|r| crate::designs::plugin::plugin_dir(&r)).filter(|p| p.is_dir())
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
pub fn tool_env_path() -> String {
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

/// Refuse an archive that would write outside its folder: `..` or absolute names
/// (checked from the listing, before anything is written).
fn safe_entry_name(name: &str) -> bool {
    !name.starts_with('/') && !name.split('/').any(|c| c == "..")
}

/// After unpacking: no symlink may resolve outside `root`. Each target is resolved physically,
/// one component at a time (so `b/..` through a link to `.` lands where the disk says).
/// Removes `root` and errs if one escapes.
fn reject_escaping_links(root: &Path) -> Result<(), String> {
    fn resolve_physical(start: &Path, target: &Path) -> Option<PathBuf> {
        use std::path::Component;
        let mut cur = if target.is_absolute() { PathBuf::from("/") } else { start.canonicalize().ok()? };
        for c in target.components() {
            match c {
                Component::RootDir | Component::Prefix(_) | Component::CurDir => {}
                Component::ParentDir => { cur.pop(); }
                Component::Normal(n) => {
                    cur.push(n);
                    if cur.exists() { cur = cur.canonicalize().ok()?; }
                }
            }
        }
        Some(cur)
    }
    fn walk(dir: &Path, root_c: &Path) -> bool {
        let Ok(rd) = std::fs::read_dir(dir) else { return true };
        for e in rd.flatten() {
            let p = e.path();
            let Ok(md) = std::fs::symlink_metadata(&p) else { continue };
            if md.file_type().is_symlink() {
                let Ok(target) = std::fs::read_link(&p) else { return false };
                let Some(parent) = p.parent() else { return false };
                match resolve_physical(parent, &target) {
                    Some(r) if r.starts_with(root_c) => {}
                    _ => return false,
                }
            } else if md.is_dir() && !walk(&p, root_c) { return false; }
        }
        true
    }
    let ok = root.canonicalize().map(|c| walk(root, &c)).unwrap_or(false);
    if ok { Ok(()) } else {
        let _ = std::fs::remove_dir_all(root);
        Err("the download tried to write outside its own folder, so it was refused".into())
    }
}

fn extract_tar_gz(archive: &Path, into: &Path) -> Result<(), String> {
    let list = std::process::Command::new("tar").arg("-tzf").arg(archive).output().map_err(|e| e.to_string())?;
    if !list.status.success() { return Err(String::from_utf8_lossy(&list.stderr).trim().to_string()); }
    if String::from_utf8_lossy(&list.stdout).lines().any(|n| !safe_entry_name(n)) {
        return Err("the download tried to write outside its own folder, so it was refused".into());
    }
    std::fs::create_dir_all(into).map_err(|e| e.to_string())?;
    let out = std::process::Command::new("tar")
        .arg("-xzf").arg(archive).arg("-C").arg(into)
        .output().map_err(|e| e.to_string())?;
    if out.status.success() { reject_escaping_links(into) } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

fn extract_zip(archive: &Path, into: &Path) -> Result<(), String> {
    std::fs::create_dir_all(into).map_err(|e| e.to_string())?;
    // ditto ships on every mac and handles the gh release zips cleanly
    let out = std::process::Command::new("ditto")
        .args(["-x", "-k"]).arg(archive).arg(into)
        .output().map_err(|e| e.to_string())?;
    if out.status.success() { reject_escaping_links(into) } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

/// An agent's zip is listed before anything is unpacked, as the tar path is: a `..` or absolute
/// name, or any symlink entry, is refused — `ditto` would follow a link it had just created, and the
/// after-the-fact link check can't undo that write.
fn extract_zip_checked(archive: &Path, into: &Path) -> Result<(), String> {
    let refused = || Err("the download tried to write outside its own folder, so it was refused".to_string());
    let names = std::process::Command::new("zipinfo").arg("-1").arg(archive).output().map_err(|e| e.to_string())?;
    if !names.status.success() { return Err("couldn't read the download's listing".into()); }
    if String::from_utf8_lossy(&names.stdout).lines().any(|n| !safe_entry_name(n)) { return refused(); }
    // the long listing's first column is the entry's mode; `l…` is a symlink
    let long = std::process::Command::new("zipinfo").arg(archive).output().map_err(|e| e.to_string())?;
    if !long.status.success() { return Err("couldn't read the download's listing".into()); }
    let is_mode = |w: &str| w.len() == 10 && w.starts_with('l') && w[1..].chars().all(|c| "rwxsStT-".contains(c));
    if String::from_utf8_lossy(&long.stdout).lines().any(|l| l.split_whitespace().next().map(is_mode).unwrap_or(false)) { return refused(); }
    extract_zip(archive, into)
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

/// Every row the Setup screen shows, in run order. The first `REQUIRED` gate the
/// app; the design rows are extras for the design pane and never count.
const CHECKS: [&str; 9] = ["claude", "claude_signin", "node", "terminal_path", "github", "superpowers", "design_browser", "design_skills", "connector"];
pub const REQUIRED: usize = 6;

/// Where Playwright's Chromium lives: inside the managed tools dir, never the user's.
pub fn browsers_dir() -> PathBuf { tools_dir().join("browsers") }

/// The installed Chromium's folder name, when `dir` holds Playwright's layout:
/// a `chromium-<digits>` directory containing at least one `.app`.
fn browser_build_in(dir: &Path) -> Option<String> {
    for e in std::fs::read_dir(dir).ok()?.filter_map(|e| e.ok()) {
        let name = e.file_name().to_string_lossy().to_string();
        let digits = name.strip_prefix("chromium-").map(|d| !d.is_empty() && d.chars().all(|c| c.is_ascii_digit())).unwrap_or(false);
        if !digits || !e.path().is_dir() { continue; }
        let has_app = std::fs::read_dir(e.path()).into_iter().flatten().filter_map(|x| x.ok()).any(|sub| {
            std::fs::read_dir(sub.path()).into_iter().flatten().filter_map(|x| x.ok())
                .any(|f| f.path().extension().map(|x| x == "app").unwrap_or(false))
        });
        if has_app { return Some(name); }
    }
    None
}
fn browser_ready_in(dir: &Path) -> bool { browser_build_in(dir).is_some() }
pub fn browser_ready() -> bool { browser_ready_in(&browsers_dir()) }

/// `(pct, got, total)` from a Playwright download line like `| 40% of 164.3 MiB`.
fn parse_install_progress(line: &str) -> Option<(u64, u64, u64)> {
    static RE: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let re = RE.get_or_init(|| regex::Regex::new(r"(\d+)% of (\d+(?:\.\d+)?) MiB").unwrap());
    let c = re.captures(line)?;
    let pct: u64 = c[1].parse().ok()?;
    let total = (c[2].parse::<f64>().ok()? * 1_048_576.0) as u64;
    Some((pct, total * pct / 100, total))
}

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

/// Is Claude signed in? Claude Code (2.1+) keeps its login in the macOS
/// Keychain (service `Claude Code-credentials`), NOT a file — the old
/// file-only check reported "needs sign-in" on a signed-in machine. Primary
/// signal: the Keychain item exists (metadata only, no secret read, no access
/// prompt). Fallbacks: a credentials file (older versions), then the
/// authoritative `claude auth status`. We only report NOT-signed-in when a
/// check positively says so — never on "couldn't tell" (the agent's own
/// needs-login flow is the real safety net, so a false nag is the worse bug).
fn claude_signed_in() -> bool {
    // 1 · the Keychain credentials item (current Claude Code)
    let keychain = std::process::Command::new("security")
        .args(["find-generic-password", "-s", "Claude Code-credentials"])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false);
    if keychain {
        return true;
    }
    // 2 · a persisted credentials file (older versions / alt installs)
    let files = [
        home().join(".claude/.credentials.json"),
        home().join(".config/claude/.credentials.json"),
    ];
    if files.iter().any(|p| p.exists()) {
        return true;
    }
    // 3 · authoritative last resort — `claude auth status` (exit 0 = signed in)
    if let Some(claude) = resolve("claude") {
        if let Ok(out) = std::process::Command::new(&claude)
            .args(["auth", "status"])
            .env("PATH", tool_env_path())
            .stdin(std::process::Stdio::null())
            .output()
        {
            let text = format!("{}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr)).to_lowercase();
            // positive signal only; ambiguous output does NOT flip to signed-out
            if out.status.success() && !text.contains("not logged in") && !text.contains("logged out") && !text.contains("sign in") {
                return true;
            }
        }
    }
    false
}

/// Is this agent signed in? `None` when Chronicle can't tell (the pane's own
/// needs-login flow is the safety net, so "can't tell" never nags).
pub fn signed_in(p: &crate::agents::AgentProfile) -> Option<bool> {
    use crate::agents::profiles::Credentials;
    match p.credentials {
        Credentials::ClaudeKeychain => resolve("claude").map(|_| claude_signed_in()),
        Credentials::HomeFile(rel) => Some(home().join(rel).exists()),
        Credentials::Unknown => None,
    }
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
        "design_browser" => {
            if resolve("node").is_none() { ("blocked", "Install the engine first.", "") }
            else if let Some(b) = browser_build_in(&browsers_dir()) { return json!({ "id": id, "state": "ready", "detail": format!("chromium · {b}"), "action": "" }); }
            else { ("missing", "", "install") }
        }
        "connector" => return connector_row(id),
        other if other.starts_with("agent:") => {
            return match crate::agents::profile(&other["agent:".len()..]) {
                Some(p) => agent_row(id, p),
                None => json!({ "id": id, "state": "unknown" }),
            };
        }
        "design_skills" => {
            let found = design_plugin_dir().ok_or_else(|| "the design skills aren't part of this build".to_string()).and_then(|d| crate::designs::plugin::intact(&d));
            return match found {
                Ok(d) => json!({ "id": id, "state": "ready", "detail": d, "action": "" }),
                Err(e) => json!({ "id": id, "state": "missing", "detail": e, "action": "" }),
            };
        }
        _ => ("unknown", "", ""),
    };
    json!({ "id": id, "state": state, "detail": detail, "action": action })
}

pub fn status() -> Value {
    let checks: Vec<Value> = CHECKS.iter().map(|id| detect(id)).collect();
    let ready = checks.iter().take(REQUIRED).filter(|c| c["state"] == "ready").count();
    json!({ "checks": checks, "ready": ready, "total": REQUIRED })
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

/// Download Playwright's Chromium into the managed browsers dir. Progress lines
/// from the merged output become `installing` events; cancel stops the whole group.
fn install_design_browser(emit: &Emit, cancel: &AtomicBool) -> Result<(), String> {
    use std::io::Read;
    use std::os::unix::process::CommandExt;
    use std::process::Stdio;
    let npx = resolve("npx").ok_or("the engine isn't installed yet — install it first")?;
    emit_state(emit, "design_browser", json!({ "state": "installing", "pct": Value::Null }));
    let dir = browsers_dir();
    std::fs::create_dir_all(&dir).map_err(|e| format!("couldn't prepare the browser folder — {e}"))?;
    let mut child = std::process::Command::new(&npx)
        .args(["--yes", "--", &format!("playwright@{}", crate::designs::plugin::PLAYWRIGHT), "install", "chromium"])
        .env("PLAYWRIGHT_BROWSERS_PATH", &dir)
        .env("PATH", tool_env_path())
        .stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped())
        .process_group(0)
        .spawn()
        .map_err(|e| format!("couldn't start the browser download — {e}"))?;
    let pgid = child.id() as i32;
    let (tx, rx) = std::sync::mpsc::channel::<String>();
    let mut readers = Vec::new();
    let pipes: [Box<dyn Read + Send>; 2] = [Box::new(child.stdout.take().unwrap()), Box::new(child.stderr.take().unwrap())];
    for mut pipe in pipes {
        let tx = tx.clone();
        readers.push(std::thread::spawn(move || {
            // progress bars redraw with \r, so split on both \r and \n
            let (mut buf, mut line) = ([0u8; 4096], Vec::new());
            while let Ok(n) = pipe.read(&mut buf) {
                if n == 0 { break; }
                for &b in &buf[..n] {
                    if b == b'\r' || b == b'\n' {
                        if !line.is_empty() { let _ = tx.send(String::from_utf8_lossy(&line).to_string()); line.clear(); }
                    } else { line.push(b); }
                }
            }
            if !line.is_empty() { let _ = tx.send(String::from_utf8_lossy(&line).to_string()); }
        }));
    }
    drop(tx);
    let mut tail = String::new();
    let mut cancelled = false;
    loop {
        if cancel.load(Ordering::SeqCst) {
            cancelled = true;
            unsafe { libc::kill(-pgid, libc::SIGTERM); }
            break;
        }
        match rx.recv_timeout(std::time::Duration::from_millis(200)) {
            Ok(line) => {
                if let Some((pct, got, total)) = parse_install_progress(&line) {
                    emit_state(emit, "design_browser", json!({ "state": "installing", "pct": pct, "gotBytes": got, "totalBytes": total }));
                } else if !line.trim().is_empty() { tail = line.trim().chars().take(80).collect(); }
            }
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
            Err(_) => break,
        }
    }
    let status = child.wait();
    for r in readers { let _ = r.join(); }
    if cancelled { return Err("cancelled".into()); }
    match status {
        Ok(s) if s.success() && browser_ready() => Ok(()),
        _ => Err(format!("couldn't download the review browser — {}", if tail.is_empty() { "please try again" } else { &tail })),
    }
}

/* ================= agents' connectors (spec §4) ================= */

use crate::agents::registry::{BinaryTarget, LaunchSpec};

const VERSION_FILE: &str = ".chronicle-version";

fn agents_dir() -> PathBuf { tools_dir().join("agents") }
pub fn agent_dir(id: &str) -> PathBuf { agents_dir().join(id) }

/// `"@scope/name@1.2.3"` → `("@scope/name", "1.2.3")`.
pub fn split_package(spec: &str) -> Option<(&str, &str)> {
    let at = spec.rfind('@').filter(|&i| i > 0)?;
    Some((&spec[..at], &spec[at + 1..]))
}

/// The package's bin entry under an `npm install --prefix <dir>`, only when the
/// installed version is exactly the spec's: a stale install must look like none.
pub fn npx_entry_in(dir: &Path, spec: &str) -> Option<PathBuf> {
    let (name, version) = split_package(spec)?;
    let pkg = dir.join("node_modules").join(name);
    let v: Value = serde_json::from_str(&std::fs::read_to_string(pkg.join("package.json")).ok()?).ok()?;
    if v.get("version").and_then(Value::as_str) != Some(version) { return None; }
    let short = name.rsplit('/').next().unwrap_or(name);
    let bin = match v.get("bin")? {
        Value::String(s) => s.clone(),
        Value::Object(m) => m.get(short).or_else(|| m.values().next())?.as_str()?.to_string(),
        _ => return None,
    };
    let entry = pkg.join(bin);
    entry.is_file().then_some(entry)
}

/// A JavaScript entry (run it with node) rather than a native program.
fn is_node_script(p: &Path) -> bool {
    if matches!(p.extension().and_then(|e| e.to_str()), Some("js" | "mjs" | "cjs")) { return true; }
    let head = std::fs::read(p).map(|b| b.into_iter().take(64).collect::<Vec<u8>>()).unwrap_or_default();
    let head = String::from_utf8_lossy(&head);
    head.starts_with("#!") && head.lines().next().unwrap_or("").contains("node")
}

pub fn binary_entry_in(dir: &Path, version: &str, cmd: &str) -> Option<PathBuf> {
    if std::fs::read_to_string(dir.join(VERSION_FILE)).ok()?.trim() != version { return None; }
    let p = dir.join(cmd.trim_start_matches("./"));
    p.is_file().then_some(p)
}

const NO_CHECKSUM: &str = "this agent publishes no checksum, so Chronicle won't install it";

/// A target with no published checksum is never downloaded, let alone unpacked.
fn require_checksum(t: &BinaryTarget) -> Result<(), String> {
    if t.sha256.trim().is_empty() { Err(NO_CHECKSUM.into()) } else { Ok(()) }
}

pub fn verify_sha256(path: &Path, want: &str) -> Result<(), String> {
    if want.trim().is_empty() { return Err(NO_CHECKSUM.into()); }
    match sha256_file(path) {
        Some(got) if got.eq_ignore_ascii_case(want) => Ok(()),
        Some(_) if want.len() == 64 && std::fs::metadata(path).map(|m| m.len() == 0).unwrap_or(false) => Err("the download was incomplete, so nothing was installed".into()),
        Some(_) => Err("the download didn't match its published checksum — it may be incomplete; try again. Nothing was installed".into()),
        None => Err("couldn't read the download".into()),
    }
}

/// Check, unpack beside the install, check the program is there, then swap.
/// A failure at any step leaves the previous install exactly as it was.
pub fn unpack_verified(archive: &Path, dir: &Path, version: &str, t: &BinaryTarget) -> Result<(), String> {
    if let Err(e) = verify_sha256(archive, &t.sha256) {
        let _ = std::fs::remove_file(archive);
        return Err(e);
    }
    let staging = dir.with_extension("staging");
    let _ = std::fs::remove_dir_all(&staging);
    let unpacked = if t.archive.ends_with(".zip") { extract_zip_checked(archive, &staging) } else { extract_tar_gz(archive, &staging) };
    let _ = std::fs::remove_file(archive);
    if let Err(e) = unpacked {
        let _ = std::fs::remove_dir_all(&staging);
        return Err(format!("couldn't unpack the download — {e}"));
    }
    let program = staging.join(t.cmd.trim_start_matches("./"));
    if !program.is_file() {
        let _ = std::fs::remove_dir_all(&staging);
        return Err("the download unpacked, but the agent's program isn't where its listing says".into());
    }
    use std::os::unix::fs::PermissionsExt;
    let _ = std::fs::set_permissions(&program, std::fs::Permissions::from_mode(0o755));
    if let Err(e) = std::fs::write(staging.join(VERSION_FILE), version) {
        let _ = std::fs::remove_dir_all(&staging);
        return Err(e.to_string());
    }
    swap_in(&staging, dir)
}

/// Replace `dir` with `staging` so that a failure at any step leaves the old install in place.
fn swap_in(staging: &Path, dir: &Path) -> Result<(), String> {
    if let Some(parent) = dir.parent() { std::fs::create_dir_all(parent).map_err(|e| e.to_string())?; }
    let old = dir.with_extension("old");
    let _ = std::fs::remove_dir_all(&old);
    let had_old = dir.exists();
    if had_old {
        if let Err(e) = std::fs::rename(dir, &old) {
            let _ = std::fs::remove_dir_all(staging);
            return Err(e.to_string());
        }
    }
    if let Err(e) = std::fs::rename(staging, dir) {
        if had_old { let _ = std::fs::rename(&old, dir); }
        let _ = std::fs::remove_dir_all(staging);
        return Err(e.to_string());
    }
    let _ = std::fs::remove_dir_all(&old);
    Ok(())
}

pub fn agent_launch_in(dir: &Path, spec: &LaunchSpec, node: Option<String>, npx: Option<String>) -> Option<crate::acp::AdapterLaunch> {
    use crate::acp::AdapterLaunch;
    match spec {
        LaunchSpec::Npx { package, args } => {
            if let Some(entry) = npx_entry_in(dir, package) {
                if !is_node_script(&entry) { return Some(AdapterLaunch::Binary { program: entry, args: args.clone() }); }
                if let Some(node) = node { return Some(AdapterLaunch::Direct { node, entry, args: args.clone() }); }
            }
            npx.map(|npx| AdapterLaunch::Npx { npx, package: package.clone(), args: args.clone() })
        }
        LaunchSpec::Binary { version, target } => binary_entry_in(dir, version, &target.cmd)
            .map(|program| AdapterLaunch::Binary { program, args: target.args.clone() }),
    }
}

/// The pane plan installed Claude's adapter at tools/adapter; it now lives with the others.
fn migrate_legacy_adapter_in(tools: &Path) {
    let old = tools.join("adapter");
    let new = tools.join("agents").join("claude-acp");
    if old.is_dir() && !new.exists() {
        let _ = std::fs::create_dir_all(tools.join("agents"));
        let _ = std::fs::rename(&old, &new);
    }
}

/// Called once at app start (main's setup hook): never from a lookup, so a
/// test run never moves the folder the installed app is using.
pub fn migrate_legacy_adapter() { migrate_legacy_adapter_in(&tools_dir()) }

/// Direct from the managed install, npx as the fallback for npm agents, None otherwise.
pub fn agent_launch(id: &str) -> Option<crate::acp::AdapterLaunch> {
    let p = crate::agents::profile(id)?;
    let spec = crate::agents::registry::launch_spec(p)?;
    agent_launch_in(&agent_dir(p.id), &spec, resolve("node"), resolve("npx"))
}

pub fn installed_version(dir: &Path, spec: &LaunchSpec) -> Option<String> {
    match spec {
        LaunchSpec::Npx { package, .. } => npx_entry_in(dir, package).and(split_package(package)).map(|(_, v)| v.to_string()),
        LaunchSpec::Binary { version, target } => binary_entry_in(dir, version, &target.cmd).map(|_| version.clone()),
    }
}

/// The profile's sign-in as the pane and Setup use it: a Terminal command whose program is the
/// agent's managed binary runs that binary by its absolute path (OpenCode's `opencode auth login`).
pub fn login_json_for(p: &crate::agents::AgentProfile) -> Value {
    let program = match agent_launch(p.id) { Some(crate::acp::AdapterLaunch::Binary { program, .. }) => Some(program.to_string_lossy().to_string()), _ => None };
    crate::agents::profiles::login_json_with(p.login, program.as_deref())
}

/// The one config reader (main's `load_config`), so Setup never sees a config the migrations haven't run on.
fn read_config() -> Value { crate::load_config() }

/// The agent a project runs (its own choice, else the default, else Claude Code).
pub fn chosen_agent_for(project: Option<&str>) -> &'static crate::agents::AgentProfile {
    crate::agents::profiles::chosen_in(&read_config(), project)
}
pub fn chosen_agent() -> &'static crate::agents::AgentProfile { chosen_agent_for(None) }

/// The "<Agent>'s connector" row: always about the chosen agent.
fn connector_row(id: &str) -> Value { agent_row(id, chosen_agent()) }

fn agent_row(id: &str, p: &'static crate::agents::AgentProfile) -> Value {
    let Some(spec) = crate::agents::registry::launch_spec(p) else {
        return json!({ "id": id, "agent": p.id, "state": "missing", "detail": format!("{} isn't supported on this Mac yet.", p.name), "action": "" });
    };
    if matches!(spec, LaunchSpec::Npx { .. }) && resolve("node").is_none() {
        return json!({ "id": id, "agent": p.id, "state": "blocked", "detail": "Install the engine first.", "action": "" });
    }
    match installed_version(&agent_dir(p.id), &spec) {
        Some(v) => json!({ "id": id, "agent": p.id, "state": "ready", "detail": v, "action": "" }),
        None => json!({ "id": id, "agent": p.id, "state": "missing", "detail": "", "action": "install" }),
    }
}

/// Install one agent's connector; progress is emitted under `check` ("connector" or "agent:<id>").
/// The Binary arm: the checksum is required before any byte is fetched.
fn fetch_and_install(archive: &Path, dir: &Path, version: &str, target: &BinaryTarget, check: &str, emit: &Emit, cancel: &AtomicBool) -> Result<(), String> {
    require_checksum(target)?;
    download(&target.archive, archive, check, emit, cancel)?;
    unpack_verified(archive, dir, version, target)
}

fn install_agent(check: &str, agent: &str, emit: &Emit, cancel: &AtomicBool) -> Result<(), String> {
    let p = crate::agents::profile(agent).ok_or("Chronicle doesn't know that agent")?;
    let spec = crate::agents::registry::launch_spec(p).ok_or_else(|| format!("{} isn't supported on this Mac yet", p.name))?;
    let dir = agent_dir(p.id);
    match &spec {
        LaunchSpec::Npx { package, .. } => {
            let npm = resolve("npm").ok_or("the engine isn't installed yet — install it first")?;
            emit_state(emit, check, json!({ "state": "installing", "pct": Value::Null }));
            // staged like a binary install: a failed install (a bad pin bump) never breaks the working one
            let staging = dir.with_extension("staging");
            let _ = std::fs::remove_dir_all(&staging);
            std::fs::create_dir_all(&staging).map_err(|e| e.to_string())?;
            let out = std::process::Command::new(&npm)
                .args(["install", "--prefix"]).arg(&staging)
                .args(["--no-audit", "--no-fund", "--no-package-lock", package])
                .env("PATH", tool_env_path())
                .stdin(std::process::Stdio::null())
                .output()
                .map_err(|e| e.to_string());
            let staged = match out {
                Ok(o) if o.status.success() => npx_entry_in(&staging, package).map(|_| ()).ok_or_else(|| "installed, but the connector's files aren't where expected".to_string()),
                Ok(o) => Err(format!("couldn't install {}'s connector: {}", p.name, String::from_utf8_lossy(&o.stderr).lines().last().unwrap_or("npm failed"))),
                Err(e) => Err(e),
            };
            if let Err(e) = staged { let _ = std::fs::remove_dir_all(&staging); return Err(e); }
            swap_in(&staging, &dir)
        }
        LaunchSpec::Binary { version, target } => {
            fetch_and_install(&agents_dir().join(format!("{}.download", p.id)), &dir, version, target, check, emit, cancel)
        }
    }
}

/// Run one check's install/repair action. Returns Ok when the check is now
/// resolved (or the action was dispatched, for sign-ins).
pub fn install(id: &str, emit: &Emit, cancel: &AtomicBool) -> Result<(), String> {
    let r = match id {
        "node" => install_node(emit, cancel),
        "claude" => install_claude(emit, cancel),
        "github" => install_github(emit, cancel),
        "superpowers" => install_superpowers(emit, cancel),
        "design_browser" => install_design_browser(emit, cancel),
        "connector" => install_agent("connector", chosen_agent().id, emit, cancel),
        other if other.starts_with("agent:") => install_agent(other, &other["agent:".len()..], emit, cancel),
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
/// The order `run_all` installs in. The connector is optional, so it goes last
/// and its failure does not stop the run.
const RUN_ALL_ORDER: [&str; 6] = ["node", "claude", "terminal_path", "superpowers", "github", "connector"];

pub fn run_all(state: &SetupState, emit: &Emit) {
    for id in RUN_ALL_ORDER {
        let cur = detect(id);
        if cur["state"] == "ready" { continue; }
        if cur["state"] == "blocked" { continue; }
        // only installables here; sign-ins are surfaced as needs_you afterward
        if matches!(id, "node" | "connector" | "claude" | "github" | "superpowers" | "terminal_path") {
            let flag = state.cancel_flag(id);
            flag.store(false, Ordering::SeqCst);
            if install(id, emit, &flag).is_err() {
                // the connector is optional: install() already emitted its failure for that row
                if id == "connector" { continue; }
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
    use crate::agents::registry::LaunchSpec;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("chronicle-setup-{}-{}", name, std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn the_design_rows_detect_from_disk_and_never_join_the_required_count() {
        assert_eq!(REQUIRED, 6);
        assert!(CHECKS.contains(&"design_browser") && CHECKS.contains(&"design_skills"));
        let s = status();
        assert_eq!(s["total"], 6);
        assert_eq!(s["checks"].as_array().unwrap().len(), 9);
        let b = detect("design_browser");
        assert!(["ready", "missing", "blocked"].contains(&b["state"].as_str().unwrap()));
        if b["state"] == "missing" { assert_eq!(b["action"], "install"); }
        let k = detect("design_skills");
        assert_eq!(k["action"], "", "the skills ship with the app: nothing to install");
    }
    const CLAUDE_PIN: &str = "@agentclientprotocol/claude-agent-acp@0.75.1";

    fn fake_npm_install(dir: &Path, name: &str, version: &str, bin: &str, script: &str) {
        let pkg = dir.join("node_modules").join(name);
        std::fs::create_dir_all(pkg.join(bin).parent().unwrap()).unwrap();
        let short = name.rsplit('/').next().unwrap();
        std::fs::write(pkg.join("package.json"), format!(r#"{{"name":"{name}","version":"{version}","bin":{{"{short}":"{bin}"}}}}"#)).unwrap();
        std::fs::write(pkg.join(bin), script).unwrap();
    }

    #[test]
    fn a_package_spec_splits_at_its_last_at() {
        assert_eq!(split_package(CLAUDE_PIN), Some(("@agentclientprotocol/claude-agent-acp", "0.75.1")));
        assert_eq!(split_package("@google/gemini-cli@0.64.0"), Some(("@google/gemini-cli", "0.64.0")));
        assert_eq!(split_package("@scoped/only"), None);
    }

    #[test]
    fn an_npm_install_resolves_its_bin_only_at_the_pinned_version() {
        let d = tmp("npx-entry");
        fake_npm_install(&d, "@agentclientprotocol/claude-agent-acp", "0.75.1", "dist/index.js", "#!/usr/bin/env node\n");
        let e = npx_entry_in(&d, CLAUDE_PIN).expect("the pinned install resolves");
        assert!(e.ends_with("dist/index.js"), "{e:?}");
        // a stale install after a pin bump must look like no install
        assert!(npx_entry_in(&d, "@agentclientprotocol/claude-agent-acp@0.90.1-preview.15").is_none());
    }

    #[test]
    fn a_node_bin_runs_under_node_and_a_native_bin_runs_as_itself() {
        let d = tmp("launch-npx");
        fake_npm_install(&d, "@agentclientprotocol/claude-agent-acp", "0.75.1", "dist/index.js", "#!/usr/bin/env node\n");
        let spec = LaunchSpec::Npx { package: CLAUDE_PIN.into(), args: vec!["--x".into()] };
        let l = agent_launch_in(&d, &spec, Some("/n/node".into()), Some("/n/npx".into())).unwrap();
        assert!(matches!(&l, crate::acp::AdapterLaunch::Direct { node, args, .. } if node == "/n/node" && args == &vec!["--x".to_string()]), "{l:?}");
        // no managed install: the npx fallback carries the package and args
        let empty = tmp("launch-npx-empty");
        let f = agent_launch_in(&empty, &spec, Some("/n/node".into()), Some("/n/npx".into())).unwrap();
        assert_eq!(f, crate::acp::AdapterLaunch::Npx { npx: "/n/npx".into(), package: CLAUDE_PIN.into(), args: vec!["--x".into()] });
        assert!(agent_launch_in(&empty, &spec, None, None).is_none(), "no node, no npx, no launch");
        // a package whose bin is a native program launches as itself, node or not
        let native = tmp("launch-native");
        fake_npm_install(&native, "@agentclientprotocol/codex-acp", "2.2.3-preview.10", "bin/codex-acp", "\x7fELF");
        let nspec = LaunchSpec::Npx { package: "@agentclientprotocol/codex-acp@2.2.3-preview.10".into(), args: vec![] };
        assert!(matches!(agent_launch_in(&native, &nspec, None, None), Some(crate::acp::AdapterLaunch::Binary { .. })));
    }

    fn tarball_with(d: &Path, name: &str, body: &str) -> PathBuf {
        let src = d.join("src");
        std::fs::create_dir_all(&src).unwrap();
        std::fs::write(src.join(name), body).unwrap();
        let arc = d.join("agent.tar.gz");
        assert!(std::process::Command::new("tar").args(["-czf"]).arg(&arc).arg("-C").arg(&src).arg(name).output().unwrap().status.success());
        arc
    }

    fn target(archive: &str, sha: String) -> crate::agents::registry::BinaryTarget {
        crate::agents::registry::BinaryTarget { archive: archive.into(), cmd: "./opencode".into(), args: vec!["acp".into()], sha256: sha }
    }

    #[test]
    fn a_verified_archive_unpacks_and_launches_as_a_binary() {
        let d = tmp("unpack-ok");
        let arc = tarball_with(&d, "opencode", "#!/bin/sh\necho hi\n");
        let sha = sha256_file(&arc).unwrap();
        let dir = d.join("agents/opencode");
        unpack_verified(&arc, &dir, "1.19.0", &target("https://x/opencode.tar.gz", sha.clone())).unwrap();
        assert!(binary_entry_in(&dir, "1.19.0", "./opencode").is_some());
        assert!(binary_entry_in(&dir, "1.20.0", "./opencode").is_none(), "another version is not this install");
        assert!(!arc.exists(), "the archive is removed after unpacking");
        let spec = LaunchSpec::Binary { version: "1.19.0".into(), target: target("https://x/opencode.tar.gz", sha) };
        assert!(matches!(agent_launch_in(&dir, &spec, None, None), Some(crate::acp::AdapterLaunch::Binary { args, .. }) if args == vec!["acp".to_string()]));
    }

    #[test]
    fn a_checksum_mismatch_installs_nothing_and_keeps_the_old_install() {
        let d = tmp("unpack-bad");
        let dir = d.join("agents/opencode");
        // a good older install is already there
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("opencode"), "old").unwrap();
        std::fs::write(dir.join(".chronicle-version"), "1.18.0").unwrap();
        let arc = tarball_with(&d, "opencode", "tampered");
        let err = unpack_verified(&arc, &dir, "1.19.0", &target("https://x/opencode.tar.gz", "0".repeat(64))).unwrap_err();
        assert!(err.contains("checksum"), "{err}");
        assert!(!arc.exists(), "a bad download is deleted");
        assert!(!dir.with_extension("staging").exists(), "nothing half-unpacked is left");
        assert_eq!(std::fs::read_to_string(dir.join("opencode")).unwrap(), "old", "the old install survives");
        assert!(binary_entry_in(&dir, "1.18.0", "./opencode").is_some());
    }

    #[test]
    fn an_archive_without_the_listed_program_is_refused() {
        let d = tmp("unpack-noprog");
        let arc = tarball_with(&d, "something-else", "x");
        let sha = sha256_file(&arc).unwrap();
        let dir = d.join("agents/opencode");
        let err = unpack_verified(&arc, &dir, "1.19.0", &target("https://x/opencode.tar.gz", sha)).unwrap_err();
        assert!(err.contains("isn't where"), "{err}");
        assert!(!dir.exists());
    }

    #[test]
    fn an_archive_with_no_published_checksum_is_never_installed() {
        let d = tmp("unpack-nosha");
        let arc = tarball_with(&d, "opencode", "x");
        let dir = d.join("agents/opencode");
        let err = unpack_verified(&arc, &dir, "1.19.0", &target("https://x/opencode.tar.gz", String::new())).unwrap_err();
        assert!(err.contains("checksum"), "{err}");
        // and install_agent refuses before any download: its archive path is never created
        let none = crate::agents::registry::BinaryTarget { archive: "https://invalid.invalid/x.tar.gz".into(), cmd: "./x".into(), args: vec![], sha256: String::new() };
        assert!(require_checksum(&none).unwrap_err().contains("checksum"), "refused before any download");
        let dl = d.join("fresh/agents/opencode.download");
        let emit: Emit = Arc::new(|_| {});
        let err = fetch_and_install(&dl, &dir, "1.19.0", &none, "agent:opencode", &emit, &AtomicBool::new(false)).unwrap_err();
        assert!(err.contains("checksum"), "{err}");
        assert!(!dl.exists() && !dl.parent().unwrap().exists(), "download() never ran: no file, no folder");
        assert!(require_checksum(&target("https://x/o.tar.gz", "ab".repeat(32))).is_ok());
        assert!(!dir.exists());
    }

    #[test]
    fn a_failed_swap_puts_the_old_install_back() {
        let d = tmp("swap");
        let dir = d.join("agents/opencode");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("opencode"), "old").unwrap();
        // staging does not exist, so the second rename fails after the first moved the old install aside
        let err = swap_in(&d.join("agents/opencode.staging"), &dir);
        assert!(err.is_err());
        assert_eq!(std::fs::read_to_string(dir.join("opencode")).unwrap(), "old", "the old install is back");
        assert!(!dir.with_extension("old").exists());
        // and a good swap replaces it and leaves no .old
        let st = d.join("agents/opencode.staging");
        std::fs::create_dir_all(&st).unwrap();
        std::fs::write(st.join("opencode"), "new").unwrap();
        swap_in(&st, &dir).unwrap();
        assert_eq!(std::fs::read_to_string(dir.join("opencode")).unwrap(), "new");
        assert!(!dir.with_extension("old").exists() && !st.exists());
    }

    #[test]
    fn an_archive_that_escapes_its_folder_is_refused() {
        let d = tmp("escape");
        let mk = |name: &str, py: &str| {
            let arc = d.join(name);
            assert!(std::process::Command::new("python3").arg("-I").arg("-c").arg(py).arg(&arc).status().unwrap().success());
            arc
        };
        let dotdot = mk("dd.tar.gz", "import sys,tarfile,io\nt=tarfile.open(sys.argv[1],'w:gz')\ni=tarfile.TarInfo('../evil');i.size=1\nt.addfile(i,io.BytesIO(b'x'))\nt.close()");
        let e = extract_tar_gz(&dotdot, &d.join("out1")).unwrap_err();
        assert!(e.contains("outside"), "{e}");
        assert!(!d.join("evil").exists());
        let link = mk("ln.tar.gz", "import sys,tarfile\nt=tarfile.open(sys.argv[1],'w:gz')\ni=tarfile.TarInfo('l');i.type=tarfile.SYMTYPE;i.linkname='/etc'\nt.addfile(i)\nt.close()");
        let e = extract_tar_gz(&link, &d.join("out2")).unwrap_err();
        assert!(e.contains("outside"), "{e}");
        assert!(!d.join("out2").exists(), "nothing left behind");
        // a chained link: b -> . is fine alone, but a -> b/../etc resolves to root's parent
        let chain = mk("ch.tar.gz", "import sys,tarfile\nt=tarfile.open(sys.argv[1],'w:gz')\nfor n,l in (('b','.'),('a','b/../etc')):\n i=tarfile.TarInfo(n);i.type=tarfile.SYMTYPE;i.linkname=l;t.addfile(i)\nt.close()");
        let e = extract_tar_gz(&chain, &d.join("out3")).unwrap_err();
        assert!(e.contains("outside"), "{e}");
        assert!(!d.join("out3").exists());
        // a link that stays inside is accepted
        let ok = mk("ok.tar.gz", "import sys,tarfile,io\nt=tarfile.open(sys.argv[1],'w:gz')\ni=tarfile.TarInfo('bin/x');i.size=1;t.addfile(i,io.BytesIO(b'x'))\ni=tarfile.TarInfo('c');i.type=tarfile.SYMTYPE;i.linkname='./bin/x';t.addfile(i)\nt.close()");
        extract_tar_gz(&ok, &d.join("out4")).unwrap();
        assert!(d.join("out4/c").exists());
    }

    #[test]
    fn a_zip_with_a_dotdot_entry_cannot_write_outside() {
        let d = tmp("zipescape");
        let made = std::process::Command::new("python3").arg("-I").arg("-c")
            .arg("import sys,zipfile\nz=zipfile.ZipFile(sys.argv[1],'w')\nz.writestr('../evil','x')\nz.close()")
            .arg(d.join("e.zip")).status();
        if !matches!(made, Ok(s) if s.success()) { eprintln!("skip: python3 unavailable"); return; }
        let _ = extract_zip(&d.join("e.zip"), &d.join("out"));
        assert!(!d.join("evil").exists(), "the .. entry did not land outside the folder");
    }

    #[test]
    fn an_agent_zip_is_listed_and_refused_before_it_unpacks() {
        let d = tmp("zipguard");
        let mk = |name: &str, py: &str| {
            let made = std::process::Command::new("python3").arg("-I").arg("-c").arg(py).arg(d.join(name)).status();
            matches!(made, Ok(s) if s.success()).then(|| d.join(name))
        };
        let Some(dotdot) = mk("dd.zip", "import sys,zipfile\nz=zipfile.ZipFile(sys.argv[1],'w')\nz.writestr('../evil','x')\nz.close()") else { eprintln!("skip: python3 unavailable"); return };
        assert!(extract_zip_checked(&dotdot, &d.join("o1")).unwrap_err().contains("outside"));
        assert!(!d.join("o1").exists(), "nothing unpacked");
        let link = mk("ln.zip", "import sys,zipfile,stat\nz=zipfile.ZipFile(sys.argv[1],'w')\ni=zipfile.ZipInfo('a')\ni.create_system=3\ni.external_attr=(stat.S_IFLNK|0o777)<<16\nz.writestr(i,'/etc')\nz.writestr('a/passwd','x')\nz.close()").unwrap();
        assert!(extract_zip_checked(&link, &d.join("o2")).unwrap_err().contains("outside"));
        assert!(!d.join("o2").exists(), "nothing unpacked");
        let ok = mk("ok.zip", "import sys,zipfile\nz=zipfile.ZipFile(sys.argv[1],'w')\nz.writestr('opencode','x')\nz.close()").unwrap();
        extract_zip_checked(&ok, &d.join("o3")).unwrap();
        assert!(d.join("o3/opencode").exists());
    }

    #[test]
    fn the_legacy_adapter_folder_moves_under_agents() {
        let tools = tmp("legacy");
        std::fs::create_dir_all(tools.join("adapter/node_modules")).unwrap();
        migrate_legacy_adapter_in(&tools);
        assert!(tools.join("agents/claude-acp/node_modules").is_dir());
        assert!(!tools.join("adapter").exists());
        migrate_legacy_adapter_in(&tools); // idempotent
        assert!(tools.join("agents/claude-acp/node_modules").is_dir());
    }

    #[test]
    fn the_connector_row_is_never_required_and_joins_the_list() {
        assert_eq!(REQUIRED, 6);
        assert!(CHECKS.contains(&"connector"));
        assert_eq!(RUN_ALL_ORDER.last(), Some(&"connector"), "the optional connector runs last");
        let s = status();
        assert_eq!(s["total"], 6);
        assert_eq!(s["checks"].as_array().unwrap().len(), 9);
        let c = detect("connector");
        assert!(crate::agents::profile(c["agent"].as_str().unwrap()).is_some(), "the row names the agent it is for: {c}");
        assert!(["ready", "missing", "blocked"].contains(&c["state"].as_str().unwrap()));
        if c["state"] == "missing" && crate::agents::registry::launch_spec(crate::agents::profile(c["agent"].as_str().unwrap()).unwrap()).is_some() { assert_eq!(c["action"], "install"); }
    }

    #[test]
    fn install_progress_lines_are_parsed() {
        let (pct, got, total) = parse_install_progress("|■■■■      | 40% of 164.3 MiB").unwrap();
        assert_eq!(pct, 40);
        assert_eq!(total, (164.3_f64 * 1_048_576.0) as u64);
        assert_eq!(got, total * 40 / 100);
        assert_eq!(parse_install_progress("Downloading Chromium 131.0.6778.33 (playwright build v1148)"), None);
    }
    #[test]
    fn browser_ready_reads_playwrights_layout() {
        let d = std::env::temp_dir().join(format!("chronicle-browsers-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        assert!(!browser_ready_in(&d));
        std::fs::create_dir_all(d.join("chromium-1148/chrome-mac-arm64/Chromium.app")).unwrap();
        assert!(browser_ready_in(&d));
        let _ = std::fs::remove_dir_all(&d);
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
        assert_eq!(s["checks"].as_array().unwrap().len(), 9);
        assert!(s["total"] == 6);
        // every check reports one of the known states
        for c in s["checks"].as_array().unwrap() {
            let st = c["state"].as_str().unwrap();
            assert!(matches!(st, "ready" | "missing" | "needs_you" | "blocked" | "checking"), "bad state {st}");
        }
    }

    /// On THIS machine, claude_signed_in() must agree with the Keychain — the
    /// bug was reporting "needs sign-in" on a signed-in machine. Gated on the
    /// setup env so it only runs where a real Claude login is present.
    #[test]
    #[ignore]
    fn detects_the_real_signed_in_state() {
        if std::env::var("CHRONICLE_SETUP_TEST").ok().as_deref() != Some("1") {
            eprintln!("skipped: set CHRONICLE_SETUP_TEST=1 on a machine with Claude signed in");
            return;
        }
        let keychain = std::process::Command::new("security")
            .args(["find-generic-password", "-s", "Claude Code-credentials"])
            .stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null())
            .status().map(|s| s.success()).unwrap_or(false);
        assert_eq!(claude_signed_in(), keychain || claude_signed_in(),
            "detection must not be a false negative when the Keychain has the login");
        if keychain {
            assert!(claude_signed_in(), "Keychain has the login but we reported signed-out");
            assert_eq!(detect("claude_signin")["state"], "ready", "the setup row must read ready");
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
