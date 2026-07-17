// The ACP seam — Chronicle drives Claude Code as a child process speaking the
// Agent Client Protocol (newline-delimited JSON-RPC over stdio), instead of
// scraping a pty. Plain threads + channels, mirroring the pty reader pattern:
// no async runtime. Types come from agent-client-protocol-schema (never
// hand-written); anything unstable-only (usage updates) is optional-consume.
//
// Every agent→client message is forwarded to the webview as an `acp-update`
// event (payload = the raw JSON + our session key). Chronicle-synthesized
// lifecycle events travel on the same channel under `_chronicle/*` methods so
// the frontend has ONE stream to consume (and probes can stub it wholesale).

use agent_client_protocol_schema::v1 as proto;
use agent_client_protocol_schema::ProtocolVersion;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};

/// The pinned adapter. Zed resolves its claude adapter from the ACP registry
/// (id `claude-acp`) and deliberately uses a version ceiling; Chronicle skips
/// the registry and pins the npm package directly.
/// VERIFIED on the npm registry 2026-07-17: `@zed-industries/claude-code-acp`
/// is DEPRECATED ("renamed to @agentclientprotocol/claude-agent-acp") — the
/// rename is the pin: `@agentclientprotocol/claude-agent-acp`, latest 0.59.0,
/// installed and exercised end-to-end by the gated integration test below.
/// Exact pin first; loosen to a bounded range only if exact-pin installs prove
/// flaky under npm min-release-age.
pub const ADAPTER_PACKAGE: &str = "@agentclientprotocol/claude-agent-acp";
pub const ADAPTER_VERSION: &str = "0.59.0";

const INIT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(180); // first npx run downloads the bridge
const NEW_SESSION_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(60);
const AUTH_REQUIRED_CODE: i64 = -32000;

/// The mode deliberately NOT exposed in the pane: an unconfirmed irreversible
/// non-repo action has no undo (checkpoints only cover the worktree).
const FORBIDDEN_MODE: &str = "bypassPermissions";

pub type Emit = Arc<dyn Fn(Value) + Send + Sync>;

pub struct AcpState {
    sessions: Arc<Mutex<HashMap<String, Arc<AcpSession>>>>,
}

impl AcpState {
    pub fn new() -> Self {
        AcpState { sessions: Arc::new(Mutex::new(HashMap::new())) }
    }

    pub fn get(&self, key: &str) -> Option<Arc<AcpSession>> {
        self.sessions.lock().ok()?.get(key).cloned()
    }

    /// App exit: every adapter child dies through the same kill-and-reap path.
    pub fn drain(&self) {
        let all: Vec<Arc<AcpSession>> = match self.sessions.lock() {
            Ok(mut g) => g.drain().map(|(_, s)| s).collect(),
            Err(_) => return,
        };
        for s in all {
            s.shutdown(None);
        }
    }
}

/// What a response arriving for one of OUR request ids should do.
enum Pending {
    /// A blocking caller (handshake, set_mode) waits on the channel.
    Waiter(mpsc::Sender<Result<Value, Value>>),
    /// A prompt turn — nobody blocks; the reader emits `_chronicle/turn_end`.
    TurnEnd,
}

/* ================= the edit ledger (disk-backed — undo survives a restart) =================
   Source of truth: .chronicle/agent/<session>/bases/ — one raw base file per
   touched path (the bytes before the agent's FIRST change this session; no
   base file = the path didn't exist, so undo DELETES it) plus index.json
   mapping absolute paths → { base, via_command }. `.chronicle/agent/current`
   names the session whose ledger is live; a CLEAN session end auto-keeps and
   clears it — a quit or crash leaves everything reviewable after restart. */

pub mod ledger {
    use super::path_in_roots;
    use serde_json::{json, Value};
    use sha2::{Digest, Sha256};
    use std::collections::BTreeMap;
    use std::path::{Path, PathBuf};
    use std::sync::Mutex;

    static LOCK: Mutex<()> = Mutex::new(());

    pub fn agent_dir(project: &Path) -> PathBuf {
        project.join(".chronicle/agent")
    }
    fn current_file(project: &Path) -> PathBuf {
        agent_dir(project).join("current")
    }
    pub fn set_current_session(project: &Path, sid: &str) {
        let _ = std::fs::create_dir_all(agent_dir(project));
        let _ = std::fs::write(current_file(project), sid);
    }
    pub fn clear_current_session(project: &Path) {
        let _ = std::fs::remove_file(current_file(project));
    }
    pub fn current_session(project: &Path) -> Option<String> {
        let s = std::fs::read_to_string(current_file(project)).ok()?;
        let s = s.trim().to_string();
        if s.is_empty() { None } else { Some(s) }
    }

    fn bases_dir(project: &Path, sid: &str) -> PathBuf {
        agent_dir(project).join(sid).join("bases")
    }
    fn index_path(project: &Path, sid: &str) -> PathBuf {
        bases_dir(project, sid).join("index.json")
    }

    /// abs path → { "base": "<file name>"|null, "via_command": bool }
    fn load_index(project: &Path, sid: &str) -> BTreeMap<String, Value> {
        std::fs::read_to_string(index_path(project, sid))
            .ok()
            .and_then(|s| serde_json::from_str::<BTreeMap<String, Value>>(&s).ok())
            .unwrap_or_default()
    }
    fn save_index(project: &Path, sid: &str, idx: &BTreeMap<String, Value>) -> Result<(), String> {
        let dir = bases_dir(project, sid);
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        std::fs::write(index_path(project, sid), serde_json::to_string_pretty(idx).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())
    }

    fn base_name(abs: &str) -> String {
        let mut h = Sha256::new();
        h.update(abs.as_bytes());
        format!("{:x}", h.finalize())[..16].to_string()
    }

    /// Record the pre-change bytes for a path (first touch only — later writes
    /// keep the ORIGINAL base). `base: None` = the file didn't exist.
    pub fn record_base(
        project: &Path,
        sid: &str,
        abs: &Path,
        via_command: bool,
        base: Option<&[u8]>,
    ) -> Result<bool, String> {
        let _g = LOCK.lock().map_err(|e| e.to_string())?;
        let key = abs.to_string_lossy().to_string();
        let mut idx = load_index(project, sid);
        if idx.contains_key(&key) {
            return Ok(false); // the original base wins
        }
        let name = match base {
            Some(bytes) => {
                let n = base_name(&key);
                let dir = bases_dir(project, sid);
                std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
                std::fs::write(dir.join(&n), bytes).map_err(|e| e.to_string())?;
                Some(n)
            }
            None => None,
        };
        idx.insert(key, json!({ "base": name, "via_command": via_command }));
        save_index(project, sid, &idx)?;
        Ok(true)
    }

    /// The strip's list: every unresolved entry with an honest ± stat
    /// (real `git diff --no-index --numstat`, never a guess).
    pub fn files(project: &Path, sid: &str, repo: &Path) -> Vec<Value> {
        let idx = load_index(project, sid);
        let mut out = Vec::new();
        for (abs, meta) in idx {
            let base = meta.get("base").and_then(|v| v.as_str()).map(|n| bases_dir(project, sid).join(n));
            let via_command = meta.get("via_command").and_then(|v| v.as_bool()).unwrap_or(false);
            let target = PathBuf::from(&abs);
            let exists = target.exists();
            let kind = match (&base, exists) {
                (None, _) => "created",
                (Some(_), false) => "deleted",
                (Some(_), true) => "modified",
            };
            let (plus, minus) = numstat(repo, base.as_deref(), if exists { Some(&target) } else { None });
            let rel = abs.strip_prefix(&format!("{}/", repo.to_string_lossy()))
                .map(String::from)
                .unwrap_or_else(|| abs.clone());
            out.push(json!({
                "path": rel, "abs": abs, "kind": kind,
                "viaCommand": via_command, "plus": plus, "minus": minus,
            }));
        }
        out
    }

    fn numstat(repo: &Path, base: Option<&Path>, target: Option<&Path>) -> (u64, u64) {
        let dev_null = Path::new("/dev/null");
        let a = base.unwrap_or(dev_null);
        let b = target.unwrap_or(dev_null);
        let out = std::process::Command::new("git")
            .arg("-C").arg(repo)
            .args(["diff", "--no-index", "--numstat", "--"])
            .arg(a).arg(b)
            .output();
        if let Ok(o) = out {
            let s = String::from_utf8_lossy(&o.stdout);
            if let Some(line) = s.lines().next() {
                let mut it = line.split_whitespace();
                let plus = it.next().and_then(|x| x.parse().ok()).unwrap_or(0);
                let minus = it.next().and_then(|x| x.parse().ok()).unwrap_or(0);
                return (plus, minus);
            }
        }
        (0, 0)
    }

    /// The reviewable diff for one entry — base vs disk, straight from git.
    pub fn diff(project: &Path, sid: &str, repo: &Path, abs: &str) -> Result<String, String> {
        let idx = load_index(project, sid);
        let meta = idx.get(abs).ok_or("that file isn't in the agent's changes")?;
        let base = meta.get("base").and_then(|v| v.as_str()).map(|n| bases_dir(project, sid).join(n));
        let target = PathBuf::from(abs);
        let dev_null = PathBuf::from("/dev/null");
        let a = base.clone().unwrap_or_else(|| dev_null.clone());
        let b = if target.exists() { target } else { dev_null };
        let out = std::process::Command::new("git")
            .arg("-C").arg(repo)
            .args(["diff", "--no-index", "--"])
            .arg(&a).arg(&b)
            .output()
            .map_err(|e| e.to_string())?;
        let code = out.status.code().unwrap_or(0);
        if code > 1 {
            return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
        }
        Ok(String::from_utf8_lossy(&out.stdout).to_string())
    }

    /// Keep = accept: drop the entry (and its base). `path: None` keeps all.
    pub fn keep(project: &Path, sid: &str, path: Option<&str>) -> Result<(), String> {
        let _g = LOCK.lock().map_err(|e| e.to_string())?;
        let mut idx = load_index(project, sid);
        let victims: Vec<String> = match path {
            Some(p) => idx.keys().filter(|k| k.as_str() == p).cloned().collect(),
            None => idx.keys().cloned().collect(),
        };
        for k in victims {
            if let Some(meta) = idx.remove(&k) {
                if let Some(n) = meta.get("base").and_then(|v| v.as_str()) {
                    let _ = std::fs::remove_file(bases_dir(project, sid).join(n));
                }
            }
        }
        save_index(project, sid, &idx)
    }

    /// Undo one DIRECT edit: write the base back (or delete a created file).
    /// Command-changed files are refused — only "Undo to here" covers those
    /// (the strip never claims per-file undo it can't do). `path: None`
    /// undoes every direct entry.
    pub fn undo(project: &Path, sid: &str, path: Option<&str>, roots: &[PathBuf]) -> Result<usize, String> {
        let _g = LOCK.lock().map_err(|e| e.to_string())?;
        let mut idx = load_index(project, sid);
        let targets: Vec<String> = match path {
            Some(p) => {
                if !idx.contains_key(p) {
                    return Err("that file isn't in the agent's changes".into());
                }
                vec![p.to_string()]
            }
            None => idx.iter()
                .filter(|(_, m)| !m.get("via_command").and_then(|v| v.as_bool()).unwrap_or(false))
                .map(|(k, _)| k.clone())
                .collect(),
        };
        let mut undone = 0usize;
        for key in targets {
            let meta = idx.get(&key).cloned().unwrap_or(Value::Null);
            if meta.get("via_command").and_then(|v| v.as_bool()).unwrap_or(false) {
                return Err("this file changed through commands — Undo to here covers it".into());
            }
            let target = PathBuf::from(&key);
            if !path_in_roots(&target, roots) {
                return Err("the path is outside this project — refused".into());
            }
            match meta.get("base").and_then(|v| v.as_str()) {
                Some(n) => {
                    let bytes = std::fs::read(bases_dir(project, sid).join(n)).map_err(|e| e.to_string())?;
                    if let Some(parent) = target.parent() {
                        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
                    }
                    std::fs::write(&target, bytes).map_err(|e| e.to_string())?;
                    let _ = std::fs::remove_file(bases_dir(project, sid).join(n));
                }
                None => {
                    // created by the agent — undo = deletion
                    match std::fs::remove_file(&target) {
                        Ok(()) => {}
                        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                        Err(e) => return Err(e.to_string()),
                    }
                }
            }
            idx.remove(&key);
            undone += 1;
        }
        save_index(project, sid, &idx)?;
        Ok(undone)
    }

    /// Wipe the ledger without touching any file (after a checkpoint restore
    /// put the tree back itself).
    pub fn clear(project: &Path, sid: &str) {
        let _g = LOCK.lock();
        let _ = std::fs::remove_dir_all(bases_dir(project, sid));
    }
}

/* ================= the transcript store (Chronicle owns the conversation) =================
   Every thread-relevant wire message appends to
   .chronicle/agent/<session>/thread.jsonl AS IT STREAMS — this is also what
   survives a crash. History lists sessions from this store; the read-only
   view (and the thread rebuild on resume) replays these lines through the
   same frontend reducer that handles live events. */

pub mod transcript {
    use super::ledger::agent_dir;
    use serde_json::{json, Value};
    use std::io::Write;
    use std::path::{Path, PathBuf};

    pub fn path(project: &Path, sid: &str) -> PathBuf {
        agent_dir(project).join(sid).join("thread.jsonl")
    }

    pub fn append(project: &Path, sid: &str, msg: &Value) {
        let p = path(project, sid);
        if let Some(parent) = p.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&p) {
            let _ = writeln!(f, "{}", serde_json::to_string(msg).unwrap_or_default());
        }
    }

    /// The adapter's resume capability, persisted at handshake so the history
    /// list can gate "Resume" honestly with no live session around.
    pub fn save_caps(project: &Path, load_session: bool) {
        let _ = std::fs::create_dir_all(agent_dir(project));
        let _ = std::fs::write(
            agent_dir(project).join("caps.json"),
            serde_json::to_string(&json!({ "loadSession": load_session })).unwrap_or_default(),
        );
    }
    pub fn load_session_supported(project: &Path) -> bool {
        std::fs::read_to_string(agent_dir(project).join("caps.json"))
            .ok()
            .and_then(|s| serde_json::from_str::<Value>(&s).ok())
            .and_then(|v| v.get("loadSession").and_then(|b| b.as_bool()))
            .unwrap_or(false)
    }

    /// Previous sessions, newest first: id · first-message excerpt · user
    /// message count · last activity (epoch ms) · whether it's the live one.
    pub fn sessions_list(project: &Path, live_sid: Option<&str>) -> Vec<Value> {
        let resumable = load_session_supported(project);
        let mut out = Vec::new();
        let Ok(rd) = std::fs::read_dir(agent_dir(project)) else { return out };
        for e in rd.flatten() {
            if !e.path().is_dir() { continue; }
            let sid = e.file_name().to_string_lossy().to_string();
            let tp = path(project, &sid);
            let Ok(body) = std::fs::read_to_string(&tp) else { continue };
            let mut first = String::new();
            let mut users = 0usize;
            for line in body.lines() {
                let Ok(v) = serde_json::from_str::<Value>(line) else { continue };
                if v.get("method").and_then(|m| m.as_str()) == Some("_chronicle/user_message") {
                    users += 1;
                    if first.is_empty() {
                        first = v.pointer("/params/text").and_then(|t| t.as_str())
                            .unwrap_or("").chars().take(120).collect();
                    }
                }
            }
            if users == 0 { continue; } // an empty session isn't history
            let updated = std::fs::metadata(&tp).ok()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0);
            let active = live_sid == Some(sid.as_str());
            out.push(json!({
                "id": sid, "firstMessage": first, "userMessages": users,
                "updatedAt": updated, "active": active,
                "resumable": resumable && !active,
            }));
        }
        out.sort_by_key(|v| std::cmp::Reverse(v.get("updatedAt").and_then(|u| u.as_u64()).unwrap_or(0)));
        out
    }

    /// The stored lines for one session (capped — a runaway transcript must
    /// not freeze the pane). The frontend replays them through its reducer.
    pub fn read(project: &Path, sid: &str) -> Vec<Value> {
        const CAP: usize = 5000;
        let Ok(body) = std::fs::read_to_string(path(project, sid)) else { return Vec::new() };
        let lines: Vec<&str> = body.lines().collect();
        let start = lines.len().saturating_sub(CAP);
        lines[start..].iter().filter_map(|l| serde_json::from_str(l).ok()).collect()
    }
}

/* ================= checkpoints (git plumbing — never the user's index) ================= */

pub mod checkpoint {
    use std::path::{Path, PathBuf};

    pub fn ref_name(sid: &str) -> String {
        format!("refs/chronicle/checkpoints/{sid}")
    }

    fn git(repo: &Path, index: Option<&Path>, args: &[&str]) -> Result<String, String> {
        let mut cmd = std::process::Command::new("git");
        cmd.arg("-C").arg(repo)
            .args(["-c", "user.email=chronicle@local", "-c", "user.name=Chronicle"])
            .args(args);
        if let Some(ix) = index {
            cmd.env("GIT_INDEX_FILE", ix);
        }
        let out = cmd.output().map_err(|e| e.to_string())?;
        if out.status.success() {
            Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
        } else {
            Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
        }
    }

    fn temp_index(repo: &Path) -> PathBuf {
        use sha2::{Digest, Sha256};
        let mut h = Sha256::new();
        h.update(repo.to_string_lossy().as_bytes());
        let hex = format!("{:x}", h.finalize());
        std::env::temp_dir().join(format!("chronicle-cpix-{}-{}", &hex[..16], std::process::id()))
    }

    /// Snapshot the WORKING TREE (tracked + untracked, minus gitignored — the
    /// add -A semantics) into a tree object via a temp index.
    pub fn snapshot_tree(repo: &Path) -> Result<String, String> {
        let ix = temp_index(repo);
        let _ = std::fs::remove_file(&ix);
        git(repo, Some(&ix), &["add", "-A"])?;
        let tree = git(repo, Some(&ix), &["write-tree"])?;
        let _ = std::fs::remove_file(&ix);
        Ok(tree)
    }

    /// Before each user message: commit the snapshot onto the session's ref
    /// (never on a branch, never in the log UI). Returns the commit id.
    pub fn create(repo: &Path, sid: &str) -> Result<String, String> {
        let tree = snapshot_tree(repo)?;
        let rname = ref_name(sid);
        let parent = git(repo, None, &["rev-parse", "--verify", "-q", &rname]).ok();
        let commit = match &parent {
            Some(p) if !p.is_empty() => git(repo, None, &["commit-tree", &tree, "-p", p, "-m", "chronicle checkpoint"])?,
            _ => git(repo, None, &["commit-tree", &tree, "-m", "chronicle checkpoint"])?,
        };
        git(repo, None, &["update-ref", &rname, &commit])?;
        Ok(commit)
    }

    /// Restore is a TWO-TREE update, not a checkout-index (checkout-index only
    /// writes — it can never DELETE a file created after the snapshot):
    /// re-snapshot the current state into the temp index, then
    /// `read-tree --reset -u <checkpoint-tree>` — writes changed files AND
    /// removes paths present now but absent then. Gitignored files are not
    /// covered (add -A semantics), stated honestly in the UI.
    pub fn restore(repo: &Path, commit: &str) -> Result<(), String> {
        let tree = git(repo, None, &["rev-parse", &format!("{commit}^{{tree}}")])?;
        let ix = temp_index(repo);
        let _ = std::fs::remove_file(&ix);
        git(repo, Some(&ix), &["add", "-A"])?;
        let res = git(repo, Some(&ix), &["read-tree", "--reset", "-u", &tree]);
        let _ = std::fs::remove_file(&ix);
        res.map(|_| ())
    }

    /// Paths that differ between a checkpoint and the tree `now` —
    /// (status letter, relative path) pairs, for turn-end reconciliation.
    pub fn changed_since(repo: &Path, commit: &str, now_tree: &str) -> Vec<(char, String)> {
        let base_tree = match git(repo, None, &["rev-parse", &format!("{commit}^{{tree}}")]) {
            Ok(t) => t,
            Err(_) => return Vec::new(),
        };
        let out = git(repo, None, &["diff-tree", "-r", "--name-status", &base_tree, now_tree]).unwrap_or_default();
        out.lines()
            .filter_map(|l| {
                let mut it = l.split('\t');
                let status = it.next()?.chars().next()?;
                let path = it.next()?.to_string();
                Some((status, path))
            })
            .collect()
    }

    /// The file's bytes AT a checkpoint (None = it didn't exist then).
    pub fn bytes_at(repo: &Path, commit: &str, rel: &str) -> Option<Vec<u8>> {
        let out = std::process::Command::new("git")
            .arg("-C").arg(repo)
            .args(["show", &format!("{commit}:{rel}")])
            .output()
            .ok()?;
        if out.status.success() { Some(out.stdout) } else { None }
    }

    /// Restores are only honored for commits on this session's own ref.
    pub fn contains(repo: &Path, sid: &str, commit: &str) -> bool {
        git(repo, None, &["rev-list", &ref_name(sid)])
            .map(|list| list.lines().any(|l| l == commit))
            .unwrap_or(false)
    }

    /// A cleanly-ended session deletes its ref (objects fall to normal gc).
    pub fn delete_ref(repo: &Path, sid: &str) {
        let _ = git(repo, None, &["update-ref", "-d", &ref_name(sid)]);
    }

    /// Orphaned session refs older than 14 days are pruned at the next
    /// session start.
    pub fn prune_old(repo: &Path) {
        let refs = git(repo, None, &["for-each-ref", "--format=%(refname) %(committerdate:unix)", "refs/chronicle/checkpoints/"])
            .unwrap_or_default();
        let cutoff = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0)
            .saturating_sub(14 * 24 * 3600);
        for line in refs.lines() {
            let mut it = line.split_whitespace();
            let (Some(name), Some(ts)) = (it.next(), it.next()) else { continue };
            if ts.parse::<u64>().map(|t| t < cutoff).unwrap_or(false) {
                let _ = git(repo, None, &["update-ref", "-d", name]);
            }
        }
    }
}

/// Shared jail predicate: the canonicalized path must sit inside one of the
/// project's roots.
pub fn path_in_roots(p: &Path, roots: &[PathBuf]) -> bool {
    // canonicalize the deepest existing ancestor (the file may be gone)
    let mut existing = p.to_path_buf();
    let mut tail: Vec<std::ffi::OsString> = Vec::new();
    while !existing.exists() {
        let Some(name) = existing.file_name().map(|n| n.to_os_string()) else { return false };
        tail.push(name);
        if !existing.pop() { return false; }
    }
    let Ok(mut canon) = existing.canonicalize() else { return false };
    for part in tail.iter().rev() {
        canon.push(part);
    }
    roots.iter().any(|r| r.canonicalize().map(|cr| canon.starts_with(&cr)).unwrap_or(false))
}

pub struct AcpSession {
    key: String,
    /// The jail: fs/read + fs/write must resolve inside these roots.
    roots: Vec<PathBuf>,
    /// The git root — checkpoints and reconciliation live here.
    repo: PathBuf,
    /// The project dir (holds .chronicle) — the ledger lives here.
    project_dir: PathBuf,
    /// The latest pre-message snapshot (this session's ref carries them all).
    last_checkpoint: Mutex<Option<String>>,
    /// Set when this session resumes an earlier one via session/load.
    resume: Option<String>,
    /// During a session/load replay the adapter re-streams history — the
    /// frontend rebuilds from OUR transcript instead, so replayed updates are
    /// neither forwarded nor re-appended.
    suppress_updates: AtomicBool,
    child: Mutex<Option<std::process::Child>>,
    writer: Mutex<Option<std::process::ChildStdin>>,
    next_id: AtomicU64,
    pending: Mutex<HashMap<u64, Pending>>,
    /// Outstanding permission asks: our stringified request id → the raw wire id.
    /// Cancel and stop RESOLVE every one of these — a pending ask must never
    /// hang the adapter.
    perms: Mutex<HashMap<String, Value>>,
    session_id: Mutex<Option<String>>,
    /// The SessionModeState from the session response, raw. Modes are agent-
    /// defined ids READ from this — never assumed.
    modes: Mutex<Value>,
    agent_caps: Mutex<Value>,
    /// The agent's session config options (model, effort, …) from the session
    /// response — read, never assumed. The model picker renders from this.
    config_options: Mutex<Value>,
    turn_active: AtomicBool,
    emit: Emit,
    sessions: Arc<Mutex<HashMap<String, Arc<AcpSession>>>>,
}

/// Build the pinned adapter spawn: `npx --yes -- <package>@<version>`.
/// ANTHROPIC_API_KEY is blanked so the adapter uses the user's Claude Code
/// login (verified: Zed does exactly this).
pub fn adapter_command(npx: &str) -> std::process::Command {
    let mut cmd = std::process::Command::new(npx);
    cmd.arg("--yes")
        .arg("--")
        .arg(format!("{ADAPTER_PACKAGE}@{ADAPTER_VERSION}"))
        .env("ANTHROPIC_API_KEY", "")
        // the adapter's inner claude refuses to launch when it thinks it's
        // nested in another Claude Code session — Chronicle's session is a
        // deliberate, independent child, not a nested one
        .env_remove("CLAUDECODE")
        // CRUCIAL for a Finder-launched app: our PATH is minimal
        // (/usr/bin:/bin:/usr/sbin:/sbin), but `npx` is a Node script whose
        // `#!/usr/bin/env node` shebang needs `node` ON THE CHILD'S PATH.
        // Resolving npx by absolute path is not enough — without this the
        // adapter dies instantly with `env: node: No such file or directory`
        // (exit 127) and the pane reports "session ended". Prepend npx's own
        // dir (node sits beside it) + the well-known tool dirs.
        .env("PATH", child_path(npx));
    cmd
}

/// Build a child PATH that can find `node`: the resolved tool's own directory
/// (node lives beside npx) and the well-known install dirs, ahead of whatever
/// PATH this process inherited. Idempotent-ish — duplicate dirs are harmless.
fn child_path(tool: &str) -> String {
    let home = std::env::var("HOME").unwrap_or_default();
    let mut dirs: Vec<String> = Vec::new();
    if let Some(parent) = Path::new(tool).parent() {
        dirs.push(parent.to_string_lossy().to_string());
    }
    for d in [
        "/opt/homebrew/bin",
        "/usr/local/bin",
        &format!("{home}/.local/bin"),
        &format!("{home}/.npm-global/bin"),
        &format!("{home}/bin"),
    ] {
        dirs.push(d.to_string());
    }
    if let Ok(existing) = std::env::var("PATH") {
        dirs.push(existing);
    } else {
        dirs.push("/usr/bin:/bin:/usr/sbin:/sbin".to_string());
    }
    dirs.join(":")
}

/// Start (or return) the one live session for a project. `cmd` is the adapter
/// spawn (tests inject a mock agent); cwd/stdio/process_group are set HERE so
/// no caller can skip them. Returns false when a live session already exists.
pub fn start(
    state: &AcpState,
    emit: Emit,
    key: String,
    cwd: PathBuf,
    project_dir: PathBuf,
    roots: Vec<PathBuf>,
    resume: Option<String>,
    mut cmd: std::process::Command,
) -> Result<bool, String> {
    use std::os::unix::process::CommandExt;
    let mut sessions = state.sessions.lock().map_err(|e| e.to_string())?;
    if let Some(existing) = sessions.get(&key) {
        if existing.is_alive() {
            return Ok(false); // single-flight: one live session per project
        }
        sessions.remove(&key);
    }

    let log = session_log_path(&key);
    let errf = std::fs::File::create(&log).map_err(|e| e.to_string())?;
    let mut child = cmd
        .current_dir(&cwd)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(errf)
        .process_group(0)
        .spawn()
        .map_err(|e| format!("couldn't start the agent bridge: {e}"))?;

    let stdin = child.stdin.take().ok_or("no stdin pipe")?;
    let stdout = child.stdout.take().ok_or("no stdout pipe")?;

    let session = Arc::new(AcpSession {
        key: key.clone(),
        roots,
        repo: cwd.clone(),
        project_dir,
        last_checkpoint: Mutex::new(None),
        resume,
        suppress_updates: AtomicBool::new(false),
        child: Mutex::new(Some(child)),
        writer: Mutex::new(Some(stdin)),
        next_id: AtomicU64::new(1),
        pending: Mutex::new(HashMap::new()),
        perms: Mutex::new(HashMap::new()),
        session_id: Mutex::new(None),
        modes: Mutex::new(Value::Null),
        agent_caps: Mutex::new(Value::Null),
        config_options: Mutex::new(Value::Null),
        turn_active: AtomicBool::new(false),
        emit,
        sessions: state.sessions.clone(),
    });
    sessions.insert(key, session.clone());
    drop(sessions);

    // the reader owns the stdout pipe for the child's whole life
    let rs = session.clone();
    std::thread::spawn(move || rs.reader_loop(stdout));

    // the handshake runs off-thread: npx may download the bridge first
    session.emit_state(json!({ "state": "installing" }));
    let hs = session.clone();
    let hcwd = cwd;
    std::thread::spawn(move || hs.handshake(&hcwd));
    Ok(true)
}

fn session_log_path(key: &str) -> PathBuf {
    use sha2::{Digest, Sha256};
    let mut h = Sha256::new();
    h.update(key.as_bytes());
    let hex = format!("{:x}", h.finalize());
    std::env::temp_dir().join(format!("chronicle-acp-{}.log", &hex[..16]))
}

impl AcpSession {
    fn is_alive(&self) -> bool {
        match self.child.lock() {
            Ok(mut g) => match g.as_mut() {
                Some(c) => matches!(c.try_wait(), Ok(None)),
                None => false,
            },
            Err(_) => false,
        }
    }

    fn emit_msg(&self, message: Value) {
        (self.emit)(json!({ "dir": self.key, "message": message }));
    }

    fn append_transcript(&self, msg: &Value) {
        if let Some(sid) = self.session_id.lock().ok().and_then(|g| g.clone()) {
            transcript::append(&self.project_dir, &sid, msg);
        }
    }

    fn emit_state(&self, params: Value) {
        self.emit_msg(json!({ "method": "_chronicle/session_state", "params": params }));
    }

    /* ---------- wire primitives ---------- */

    fn send_raw(&self, v: &Value) -> Result<(), String> {
        let mut guard = self.writer.lock().map_err(|e| e.to_string())?;
        let w = guard.as_mut().ok_or("the session has ended")?;
        let line = serde_json::to_string(v).map_err(|e| e.to_string())?;
        w.write_all(line.as_bytes()).map_err(|e| e.to_string())?;
        w.write_all(b"\n").map_err(|e| e.to_string())?;
        w.flush().map_err(|e| e.to_string())
    }

    fn notify(&self, method: &str, params: Value) -> Result<(), String> {
        self.send_raw(&json!({ "jsonrpc": "2.0", "method": method, "params": params }))
    }

    fn respond_ok(&self, id: &Value, result: Value) {
        let _ = self.send_raw(&json!({ "jsonrpc": "2.0", "id": id, "result": result }));
    }

    fn respond_err(&self, id: &Value, code: i64, message: &str) {
        let _ = self.send_raw(&json!({
            "jsonrpc": "2.0", "id": id,
            "error": { "code": code, "message": message }
        }));
    }

    /// Send a request and block THIS thread for the response (handshake and
    /// short calls only — prompt turns use Pending::TurnEnd instead).
    fn request_blocking(
        &self,
        method: &str,
        params: Value,
        timeout: std::time::Duration,
    ) -> Result<Value, String> {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = mpsc::channel();
        self.pending.lock().map_err(|e| e.to_string())?.insert(id, Pending::Waiter(tx));
        if let Err(e) = self.send_raw(&json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params })) {
            if let Ok(mut p) = self.pending.lock() { p.remove(&id); }
            return Err(e);
        }
        match rx.recv_timeout(timeout) {
            Ok(Ok(result)) => Ok(result),
            Ok(Err(err)) => Err(serde_json::to_string(&err).unwrap_or_else(|_| "agent error".into())),
            Err(_) => {
                if let Ok(mut p) = self.pending.lock() { p.remove(&id); }
                Err(format!("the agent didn't answer {method} in time"))
            }
        }
    }

    /* ---------- lifecycle ---------- */

    fn handshake(self: &Arc<Self>, cwd: &Path) {
        let init = proto::InitializeRequest::new(ProtocolVersion::V1)
            .client_capabilities(
                proto::ClientCapabilities::default().fs(
                    proto::FileSystemCapabilities::default()
                        .read_text_file(true)
                        .write_text_file(true),
                ),
            )
            .client_info(proto::Implementation::new("Chronicle", env!("CARGO_PKG_VERSION")));
        let init_params = match serde_json::to_value(&init) {
            Ok(v) => v,
            Err(e) => return self.fail_handshake(&e.to_string()),
        };
        let caps = match self.request_blocking("initialize", init_params, INIT_TIMEOUT) {
            Ok(v) => v,
            Err(e) => return self.fail_handshake(&e),
        };
        if let Ok(mut g) = self.agent_caps.lock() { *g = caps.clone(); }
        let can_load = caps.pointer("/agentCapabilities/loadSession").and_then(|v| v.as_bool()).unwrap_or(false);
        transcript::save_caps(&self.project_dir, can_load);

        self.emit_state(json!({ "state": "starting" }));
        // TRUE resume only when the adapter advertises loadSession — never assumed
        let (method, params) = match &self.resume {
            Some(old_sid) => {
                if !can_load {
                    return self.fail_handshake("this agent can't pick sessions back up — start a new one");
                }
                // the adapter replays history during load; our transcript is
                // the UI's source, so the replay stays suppressed
                self.suppress_updates.store(true, Ordering::SeqCst);
                ("session/load", json!({ "sessionId": old_sid, "cwd": cwd, "mcpServers": [] }))
            }
            None => {
                let new_req = proto::NewSessionRequest::new(cwd);
                match serde_json::to_value(&new_req) {
                    Ok(v) => ("session/new", v),
                    Err(e) => return self.fail_handshake(&e.to_string()),
                }
            }
        };
        match self.request_blocking(method, params, NEW_SESSION_TIMEOUT) {
            Ok(resp) => {
                self.suppress_updates.store(false, Ordering::SeqCst);
                let sid = match &self.resume {
                    Some(old_sid) => old_sid.clone(),
                    None => resp.get("sessionId").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                };
                if sid.is_empty() { return self.fail_handshake("the agent returned no session id"); }
                if let Ok(mut g) = self.session_id.lock() { *g = Some(sid.clone()); }
                if let Ok(mut g) = self.modes.lock() { *g = resp.get("modes").cloned().unwrap_or(Value::Null); }
                if let Ok(mut g) = self.config_options.lock() { *g = resp.get("configOptions").cloned().unwrap_or(Value::Null); }
                ledger::set_current_session(&self.project_dir, &sid);
                checkpoint::prune_old(&self.repo);
                self.emit_state(json!({
                    "state": "ready",
                    "sessionId": sid,
                    "resumed": self.resume.is_some(),
                    "modes": resp.get("modes").cloned().unwrap_or(Value::Null),
                    "configOptions": resp.get("configOptions").cloned().unwrap_or(Value::Null),
                    "agentCaps": caps,
                }));
            }
            Err(e) => {
                self.suppress_updates.store(false, Ordering::SeqCst);
                // auth_required (-32000): the adapter wants a login run in a
                // terminal — surface needs-login and end; the frontend opens
                // `claude /login` in a terminal tab and restarts after it exits.
                let is_auth = serde_json::from_str::<Value>(&e).ok()
                    .and_then(|v| v.get("code").and_then(|c| c.as_i64()))
                    == Some(AUTH_REQUIRED_CODE);
                if is_auth {
                    let methods = self.agent_caps.lock().ok()
                        .and_then(|g| g.get("authMethods").cloned())
                        .unwrap_or(Value::Null);
                    self.emit_state(json!({ "state": "needs-login", "authMethods": methods }));
                    self.shutdown(None);
                } else {
                    self.fail_handshake(&e);
                }
            }
        }
    }

    fn fail_handshake(self: &Arc<Self>, err: &str) {
        self.emit_state(json!({ "state": "error", "message": err }));
        self.shutdown(None);
    }

    /// Resolve every outstanding permission oneshot as cancelled, kill the
    /// child (SIGTERM → grace → SIGKILL, whole process group), reap, remove
    /// this session from the map, emit ended. Idempotent.
    fn shutdown(&self, exit_code: Option<i32>) {
        self.cancel_all_perms();
        let child = self.child.lock().ok().and_then(|mut g| g.take());
        if let Ok(mut w) = self.writer.lock() { *w = None; }
        if let Some(mut c) = child {
            let code = match c.try_wait() {
                Ok(Some(status)) => status.code(),
                _ => { crate::term_then_kill(&mut c); exit_code }
            };
            self.append_transcript(&json!({ "method": "_chronicle/session_state", "params": { "state": "ended" } }));
            self.emit_state(json!({ "state": "ended", "code": code }));
        }
        if let Ok(mut g) = self.sessions.lock() {
            if g.get(&self.key).map(|s| std::ptr::eq(s.as_ref(), self)).unwrap_or(false) {
                g.remove(&self.key);
            }
        }
    }

    /* ---------- the reader (owns stdout for the child's life) ---------- */

    fn reader_loop(self: Arc<Self>, stdout: std::process::ChildStdout) {
        let reader = std::io::BufReader::new(stdout);
        for line in reader.lines() {
            let Ok(line) = line else { break };
            if line.trim().is_empty() { continue; }
            let Ok(msg) = serde_json::from_str::<Value>(&line) else { continue };
            let has_id = msg.get("id").is_some();
            let has_method = msg.get("method").is_some();
            if has_method && has_id {
                self.handle_agent_request(&msg);
            } else if has_method {
                if self.suppress_updates.load(Ordering::SeqCst)
                    && msg.get("method").and_then(|m| m.as_str()) == Some("session/update")
                {
                    continue; // a session/load replay — the transcript already has it
                }
                // keep the stored config options current so a reload re-syncs
                if msg.pointer("/params/update/sessionUpdate").and_then(|v| v.as_str()) == Some("config_option_update") {
                    if let Some(opts) = msg.pointer("/params/update/configOptions") {
                        if let Ok(mut g) = self.config_options.lock() { *g = opts.clone(); }
                    }
                }
                if msg.get("method").and_then(|m| m.as_str()) == Some("session/update") {
                    self.append_transcript(&msg);
                }
                // notification (session/update et al) — raw passthrough
                self.emit_msg(msg);
            } else if has_id {
                self.handle_response(&msg);
            }
        }
        // EOF: the adapter exited (or was killed) — settle everything
        self.turn_active.store(false, Ordering::SeqCst);
        self.shutdown(None);
    }

    fn handle_response(&self, msg: &Value) {
        let Some(id) = msg.get("id").and_then(|v| v.as_u64()) else { return };
        let entry = self.pending.lock().ok().and_then(|mut p| p.remove(&id));
        let outcome: Result<Value, Value> = if let Some(err) = msg.get("error") {
            Err(err.clone())
        } else {
            Ok(msg.get("result").cloned().unwrap_or(Value::Null))
        };
        match entry {
            Some(Pending::Waiter(tx)) => { let _ = tx.send(outcome); }
            Some(Pending::TurnEnd) => {
                self.turn_active.store(false, Ordering::SeqCst);
                // a turn ending always resolves any ask still on screen
                self.cancel_all_perms();
                self.reconcile_turn_end();
                let end = match outcome {
                    Ok(result) => json!({
                        "method": "_chronicle/turn_end",
                        "params": { "stopReason": result.get("stopReason").cloned().unwrap_or(Value::Null),
                                     "usage": result.get("usage").cloned().unwrap_or(Value::Null) }
                    }),
                    Err(err) => json!({
                        "method": "_chronicle/turn_end",
                        "params": { "error": err }
                    }),
                };
                self.append_transcript(&end);
                self.emit_msg(end);
            }
            None => {}
        }
    }

    /* ---------- agent → client requests ---------- */

    fn handle_agent_request(self: &Arc<Self>, msg: &Value) {
        let id = msg.get("id").cloned().unwrap_or(Value::Null);
        let method = msg.get("method").and_then(|v| v.as_str()).unwrap_or("");
        let params = msg.get("params").cloned().unwrap_or(Value::Null);
        match method {
            "fs/read_text_file" => self.handle_fs_read(&id, params),
            "fs/write_text_file" => self.handle_fs_write(&id, params),
            "session/request_permission" => {
                // register the oneshot BEFORE the frontend hears about it —
                // an instant answer must find its entry
                if let Ok(mut g) = self.perms.lock() {
                    g.insert(id.to_string(), id.clone());
                }
                self.append_transcript(msg);
                self.emit_msg(msg.clone());
            }
            _ => self.respond_err(&id, -32601, "method not supported by this client"),
        }
    }

    /// The jail for the adapter's ABSOLUTE paths: no relative paths, no `..`,
    /// and the nearest existing ancestor (symlinks followed) must sit inside a
    /// project root — so a not-yet-existing file can still be created, but
    /// never outside the project.
    fn jail_abs(&self, path: &str) -> Result<PathBuf, String> {
        let p = Path::new(path);
        if !p.is_absolute() {
            return Err("the agent used a relative path — refused".into());
        }
        if p.components().any(|c| matches!(c, std::path::Component::ParentDir)) {
            return Err("the path climbs out of the project — refused".into());
        }
        // canonicalize the deepest EXISTING ancestor; append the remainder
        let mut existing = p.to_path_buf();
        let mut tail: Vec<std::ffi::OsString> = Vec::new();
        loop {
            if existing.exists() { break; }
            let Some(name) = existing.file_name().map(|n| n.to_os_string()) else {
                return Err("the path can't be resolved".into());
            };
            tail.push(name);
            if !existing.pop() {
                return Err("the path can't be resolved".into());
            }
        }
        let mut canon = existing.canonicalize().map_err(|e| e.to_string())?;
        for part in tail.iter().rev() {
            canon.push(part);
        }
        for root in &self.roots {
            if let Ok(cr) = root.canonicalize() {
                if canon.starts_with(&cr) {
                    return Ok(canon);
                }
            }
        }
        Err("the path is outside this project — refused".into())
    }

    fn handle_fs_read(&self, id: &Value, params: Value) {
        let req: proto::ReadTextFileRequest = match serde_json::from_value(params) {
            Ok(r) => r,
            Err(e) => return self.respond_err(id, -32602, &e.to_string()),
        };
        let full = match self.jail_abs(&req.path.to_string_lossy()) {
            Ok(f) => f,
            Err(e) => return self.respond_err(id, -32602, &e),
        };
        let content = match std::fs::read_to_string(&full) {
            Ok(c) => c,
            Err(e) => return self.respond_err(id, -32603, &e.to_string()),
        };
        let content = match (req.line, req.limit) {
            (None, None) => content,
            (line, limit) => {
                let start = line.map(|l| (l as usize).saturating_sub(1)).unwrap_or(0);
                let it = content.lines().skip(start);
                let sliced: Vec<&str> = match limit {
                    Some(n) => it.take(n as usize).collect(),
                    None => it.collect(),
                };
                sliced.join("\n")
            }
        };
        self.respond_ok(id, json!({ "content": content }));
    }

    fn handle_fs_write(&self, id: &Value, params: Value) {
        let req: proto::WriteTextFileRequest = match serde_json::from_value(params) {
            Ok(r) => r,
            Err(e) => return self.respond_err(id, -32602, &e.to_string()),
        };
        // jailed AND ledgered BEFORE the write lands — law 5
        let full = match self.jail_abs(&req.path.to_string_lossy()) {
            Ok(f) => f,
            Err(e) => return self.respond_err(id, -32602, &e),
        };
        let key = full.to_string_lossy().to_string();
        // jailed AND ledgered BEFORE the write lands — law 5. The base is the
        // file's bytes before the agent's FIRST write this session.
        let sid = self.session_id.lock().ok().and_then(|g| g.clone()).unwrap_or_else(|| "unknown".into());
        let base = std::fs::read(&full).ok();
        let created = base.is_none();
        if let Err(e) = ledger::record_base(&self.project_dir, &sid, &full, false, base.as_deref()) {
            return self.respond_err(id, -32603, &e);
        }
        if let Some(parent) = full.parent() {
            if let Err(e) = std::fs::create_dir_all(parent) {
                return self.respond_err(id, -32603, &e.to_string());
            }
        }
        if let Err(e) = std::fs::write(&full, &req.content) {
            return self.respond_err(id, -32603, &e.to_string());
        }
        self.respond_ok(id, json!({}));
        self.emit_msg(json!({
            "method": "_chronicle/write",
            "params": { "path": key, "kind": if created { "created" } else { "modified" } }
        }));
        self.emit_msg(json!({ "method": "_chronicle/edits_changed", "params": {} }));
    }

    /* ---------- client → agent operations ---------- */

    pub fn prompt(&self, message: String) -> Result<(), String> {
        let sid = self.session_id.lock().map_err(|e| e.to_string())?
            .clone().ok_or("the session isn't ready yet")?;
        if self.turn_active.swap(true, Ordering::SeqCst) {
            return Err("the agent is still working — stop it first".into());
        }
        // the checkpoint precedes every user message; a non-repo project just
        // doesn't get one (the row won't render — never a hang, never a lie)
        match checkpoint::create(&self.repo, &sid) {
            Ok(id) => {
                if let Ok(mut g) = self.last_checkpoint.lock() { *g = Some(id.clone()); }
                self.emit_msg(json!({ "method": "_chronicle/checkpoint", "params": { "id": id } }));
            }
            Err(e) => {
                self.emit_msg(json!({ "method": "_chronicle/checkpoint", "params": { "error": e } }));
            }
        }
        self.append_transcript(&json!({
            "method": "_chronicle/user_message",
            "params": { "text": message, "ts": crate::epoch_ms() }
        }));
        let req = proto::PromptRequest::new(
            sid,
            vec![proto::ContentBlock::Text(proto::TextContent::new(message))],
        );
        let params = serde_json::to_value(&req).map_err(|e| e.to_string())?;
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        self.pending.lock().map_err(|e| e.to_string())?.insert(id, Pending::TurnEnd);
        if let Err(e) = self.send_raw(&json!({ "jsonrpc": "2.0", "id": id, "method": "session/prompt", "params": params })) {
            self.turn_active.store(false, Ordering::SeqCst);
            if let Ok(mut p) = self.pending.lock() { p.remove(&id); }
            return Err(e);
        }
        Ok(())
    }

    /// session/cancel + resolve every outstanding permission oneshot as
    /// cancelled. The turn's prompt response (stop reason `cancelled`) still
    /// arrives and emits `_chronicle/turn_end` normally.
    pub fn cancel(&self) -> Result<(), String> {
        let sid = self.session_id.lock().map_err(|e| e.to_string())?
            .clone().ok_or("the session isn't ready yet")?;
        self.notify("session/cancel", json!({ "sessionId": sid }))?;
        self.cancel_all_perms();
        Ok(())
    }

    fn cancel_all_perms(&self) {
        let drained: Vec<(String, Value)> = match self.perms.lock() {
            Ok(mut g) => g.drain().collect(),
            Err(_) => return,
        };
        for (key, id) in drained {
            self.respond_ok(&id, json!({ "outcome": { "outcome": "cancelled" } }));
            let resolved = json!({
                "method": "_chronicle/permission_resolved",
                "params": { "requestId": key, "outcome": "cancelled" }
            });
            self.append_transcript(&resolved);
            self.emit_msg(resolved);
        }
    }

    /// Answer one permission ask. `option_id: None` = cancelled. The oneshot
    /// is removed first, so a second answer (or a cancel racing an answer)
    /// can't double-respond.
    pub fn respond_permission(&self, request_id: &str, option_id: Option<String>) -> Result<(), String> {
        let id = self.perms.lock().map_err(|e| e.to_string())?.remove(request_id)
            .ok_or("that request was already answered")?;
        let outcome = match &option_id {
            Some(opt) => json!({ "outcome": "selected", "optionId": opt }),
            None => json!({ "outcome": "cancelled" }),
        };
        self.respond_ok(&id, json!({ "outcome": outcome }));
        let resolved = json!({
            "method": "_chronicle/permission_resolved",
            "params": { "requestId": request_id,
                         "outcome": option_id.map(Value::String).unwrap_or(json!("cancelled")) }
        });
        self.append_transcript(&resolved);
        self.emit_msg(resolved);
        Ok(())
    }

    /// Switch session mode — only to a mode the agent itself advertised, and
    /// never to bypassPermissions (deliberately not exposed in the pane).
    pub fn set_mode(&self, mode_id: &str) -> Result<(), String> {
        if mode_id == FORBIDDEN_MODE {
            return Err("that mode isn't available in Chronicle".into());
        }
        let advertised = self.modes.lock().map_err(|e| e.to_string())?
            .get("availableModes").and_then(|v| v.as_array())
            .map(|a| a.iter().any(|m| m.get("id").and_then(|i| i.as_str()) == Some(mode_id)))
            .unwrap_or(false);
        if !advertised {
            return Err("the agent doesn't offer that mode".into());
        }
        let sid = self.session_id.lock().map_err(|e| e.to_string())?
            .clone().ok_or("the session isn't ready yet")?;
        self.request_blocking(
            "session/set_mode",
            json!({ "sessionId": sid, "modeId": mode_id }),
            std::time::Duration::from_secs(30),
        )?;
        if let Ok(mut g) = self.modes.lock() {
            if let Some(obj) = g.as_object_mut() {
                obj.insert("currentModeId".into(), json!(mode_id));
            }
        }
        Ok(())
    }

    /// End the session. `clean` = the user's explicit "End session":
    /// unresolved edits auto-keep ("All changes kept"), the checkpoint ref
    /// goes, the current pointer clears. `clean=false` (closing the project,
    /// quitting) just stops the child — the ledger stays reviewable after a
    /// restart or reopen.
    /// Set a session config option (the model picker uses this). `config_id`
    /// and `value_id` are the agent's own advertised ids — never assumed.
    pub fn set_config_option(&self, config_id: &str, value_id: &str) -> Result<(), String> {
        let sid = self.session_id.lock().map_err(|e| e.to_string())?
            .clone().ok_or("the session isn't ready yet")?;
        self.request_blocking(
            "session/set_config_option",
            json!({ "sessionId": sid, "configId": config_id, "value": { "value": value_id } }),
            std::time::Duration::from_secs(30),
        )?;
        // reflect the new current value locally so a re-sync is honest
        if let Ok(mut g) = self.config_options.lock() {
            if let Some(arr) = g.as_array_mut() {
                for opt in arr.iter_mut() {
                    if opt.get("id").and_then(|v| v.as_str()) == Some(config_id) {
                        if let Some(o) = opt.as_object_mut() {
                            o.insert("currentValue".into(), json!(value_id));
                        }
                    }
                }
            }
        }
        Ok(())
    }

    pub fn stop(&self, clean: bool) {
        if clean {
            if let Some(sid) = self.session_id.lock().ok().and_then(|g| g.clone()) {
                let _ = ledger::keep(&self.project_dir, &sid, None);
                ledger::clear(&self.project_dir, &sid);
                checkpoint::delete_ref(&self.repo, &sid);
                ledger::clear_current_session(&self.project_dir);
                self.emit_msg(json!({ "method": "_chronicle/edits_changed", "params": {} }));
            }
        }
        self.shutdown(None);
    }

    /// Turn-end honesty: the agent's own SHELL COMMANDS also change files.
    /// Everything that differs from the turn's checkpoint and isn't already
    /// ledgered (a direct write) lands as "changed by a command — covered by
    /// Undo to here", with its base pulled from the checkpoint so the diff is
    /// reviewable. The ledger's own .chronicle housekeeping is excluded.
    fn reconcile_turn_end(&self) {
        let Some(cp) = self.last_checkpoint.lock().ok().and_then(|g| g.clone()) else { return };
        let Some(sid) = self.session_id.lock().ok().and_then(|g| g.clone()) else { return };
        let Ok(now_tree) = checkpoint::snapshot_tree(&self.repo) else { return };
        let mut any = false;
        for (status, rel) in checkpoint::changed_since(&self.repo, &cp, &now_tree) {
            if rel.starts_with(".chronicle/") { continue; }
            let abs = self.repo.join(&rel);
            let base = if status == 'A' { None } else { checkpoint::bytes_at(&self.repo, &cp, &rel) };
            if let Ok(true) = ledger::record_base(&self.project_dir, &sid, &abs, true, base.as_deref()) {
                any = true;
            }
        }
        if any {
            self.emit_msg(json!({ "method": "_chronicle/edits_changed", "params": {} }));
        }
    }

    pub fn current_state(&self) -> Value {
        json!({
            "alive": self.is_alive(),
            "sessionId": self.session_id.lock().ok().and_then(|g| g.clone()),
            "modes": self.modes.lock().map(|g| g.clone()).unwrap_or(Value::Null),
            "configOptions": self.config_options.lock().map(|g| g.clone()).unwrap_or(Value::Null),
            "agentCaps": self.agent_caps.lock().map(|g| g.clone()).unwrap_or(Value::Null),
            "turnActive": self.turn_active.load(Ordering::SeqCst),
        })
    }
}

/* ================= Z-1 tests: the loop against a mock agent, the jail, and
   (env-gated) the real adapter ================= */

#[cfg(test)]
mod acp_tests {
    use super::*;
    use std::time::Duration;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("chronicle-acp-{}-{}", name, std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d.canonicalize().unwrap()
    }

    /// A tiny agent speaking just enough ACP to exercise every seam:
    /// initialize → session/new → prompt (chunk + in-jail write + out-of-jail
    /// write + permission ask) → turn end once both writes and the permission
    /// answer arrive. A second prompt asks permission and waits forever —
    /// only a cancel resolves it.
    const MOCK_AGENT: &str = r#"
import sys, json
def send(o):
    sys.stdout.write(json.dumps(o) + "\n"); sys.stdout.flush()
project = sys.argv[1]
turn = 0
state = {}
for line in sys.stdin:
    msg = json.loads(line)
    m = msg.get("method")
    if m == "initialize":
        send({"jsonrpc":"2.0","id":msg["id"],"result":{"protocolVersion":1,
            "agentCapabilities":{"loadSession":False},"authMethods":[]}})
    elif m == "session/new":
        send({"jsonrpc":"2.0","id":msg["id"],"result":{"sessionId":"sess-1",
            "modes":{"currentModeId":"default","availableModes":[
                {"id":"default","name":"Always Ask"},
                {"id":"acceptEdits","name":"Accept Edits"},
                {"id":"bypassPermissions","name":"Bypass"}]}}})
    elif m == "session/prompt":
        turn += 1
        sid = msg["params"]["sessionId"]
        state["prompt_id"] = msg["id"]
        if turn == 1:
            send({"jsonrpc":"2.0","method":"session/update","params":{"sessionId":sid,
                "update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"hello "}}}})
            send({"jsonrpc":"2.0","id":100,"method":"fs/write_text_file","params":{
                "sessionId":sid,"path":project+"/agent-made.txt","content":"agent wrote this"}})
            send({"jsonrpc":"2.0","id":101,"method":"fs/write_text_file","params":{
                "sessionId":sid,"path":"/tmp/chronicle-acp-escape.txt","content":"jailbreak"}})
            send({"jsonrpc":"2.0","id":102,"method":"session/request_permission","params":{
                "sessionId":sid,"toolCall":{"toolCallId":"t1","title":"Run a command"},
                "options":[{"optionId":"allow","name":"Allow","kind":"allow_once"},
                           {"optionId":"reject","name":"Don't allow","kind":"reject_once"}]}})
            state["waiting"] = {"100","101","102"}
        else:
            send({"jsonrpc":"2.0","id":200,"method":"session/request_permission","params":{
                "sessionId":sid,"toolCall":{"toolCallId":"t2","title":"Delete everything"},
                "options":[{"optionId":"allow","name":"Allow","kind":"allow_once"}]}})
            state["waiting"] = {"200"}
    elif m == "session/set_mode":
        send({"jsonrpc":"2.0","id":msg["id"],"result":{}})
    elif m == "session/cancel":
        state["cancelled"] = True
    elif m is None and "id" in msg:
        rid = str(msg["id"])
        w = state.get("waiting", set())
        if rid in w:
            if rid == "102":
                state["perm_outcome"] = msg.get("result", {}).get("outcome", {})
            if rid == "200":
                oc = msg.get("result", {}).get("outcome", {})
                # a cancelled oneshot ends the hung turn honestly
                reason = "cancelled" if oc.get("outcome") == "cancelled" else "end_turn"
                send({"jsonrpc":"2.0","id":state["prompt_id"],"result":{"stopReason":reason}})
                w.clear()
                continue
            w.discard(rid)
            if not w:
                send({"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"sess-1",
                    "update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text",
                    "text":"perm=" + state.get("perm_outcome",{}).get("outcome","?")}}}})
                send({"jsonrpc":"2.0","id":state["prompt_id"],"result":{"stopReason":"end_turn"}})
"#;

    struct Harness {
        state: AcpState,
        rx: mpsc::Receiver<Value>,
        key: String,
        dir: PathBuf,
    }

    fn python3() -> Option<String> {
        ["/usr/bin/python3", "/opt/homebrew/bin/python3", "/usr/local/bin/python3"]
            .iter().find(|p| Path::new(p).exists()).map(|s| s.to_string())
    }

    fn start_mock(name: &str) -> Option<Harness> {
        let py = python3()?;
        let dir = tmp(name);
        let script = dir.join(".mock-agent.py");
        std::fs::write(&script, MOCK_AGENT).unwrap();
        let mut cmd = std::process::Command::new(py);
        cmd.arg(&script).arg(&dir);
        let (tx, rx) = mpsc::channel::<Value>();
        let emit: Emit = Arc::new(move |v| { let _ = tx.send(v); });
        let state = AcpState::new();
        let key = dir.to_string_lossy().to_string();
        assert!(start(&state, emit, key.clone(), dir.clone(), dir.clone(), vec![dir.clone()], None, cmd).unwrap());
        Some(Harness { state, rx, key, dir })
    }

    /// Pull events until `pred` matches (or fail loudly after `secs`).
    fn wait_for(rx: &mpsc::Receiver<Value>, secs: u64, pred: impl Fn(&Value) -> bool) -> Value {
        let deadline = std::time::Instant::now() + Duration::from_secs(secs);
        loop {
            let left = deadline.saturating_duration_since(std::time::Instant::now());
            if left.is_zero() { panic!("timed out waiting for an acp-update event"); }
            let v = rx.recv_timeout(left).expect("timed out waiting for an acp-update event");
            if pred(&v) { return v; }
        }
    }

    fn method_is(v: &Value, m: &str) -> bool {
        v.pointer("/message/method").and_then(|x| x.as_str()) == Some(m)
    }
    fn state_is(v: &Value, s: &str) -> bool {
        method_is(v, "_chronicle/session_state")
            && v.pointer("/message/params/state").and_then(|x| x.as_str()) == Some(s)
    }

    #[test]
    fn full_round_against_the_mock_agent() {
        let Some(h) = start_mock("round") else { eprintln!("skipped: no python3"); return };
        wait_for(&h.rx, 20, |v| state_is(v, "ready"));
        let s = h.state.get(&h.key).unwrap();

        // modes came from the session response, never assumed
        let st = s.current_state();
        assert_eq!(st.pointer("/modes/currentModeId").and_then(|v| v.as_str()), Some("default"));

        s.prompt("do the round".into()).unwrap();
        // a second prompt while the turn runs is refused (single-flight)
        assert!(s.prompt("again".into()).is_err());

        wait_for(&h.rx, 20, |v| {
            v.pointer("/message/params/update/content/text").and_then(|x| x.as_str()) == Some("hello ")
        });
        // the in-jail write landed AND was ledgered as created
        wait_for(&h.rx, 20, |v| method_is(v, "_chronicle/write"));
        assert_eq!(std::fs::read_to_string(h.dir.join("agent-made.txt")).unwrap(), "agent wrote this");
        {
            let entries = ledger::files(&h.dir, "sess-1", &h.dir);
            assert!(entries.iter().any(|e| e["kind"] == "created"), "created file ledgered with an empty base: {entries:?}");
        }
        // the out-of-jail write must NOT land
        assert!(!Path::new("/tmp/chronicle-acp-escape.txt").exists(), "the jail must refuse writes outside the project");

        // answer the permission ask
        let ask = wait_for(&h.rx, 20, |v| method_is(v, "session/request_permission"));
        let req_id = ask.pointer("/message/id").unwrap().to_string();
        s.respond_permission(&req_id, Some("allow".into())).unwrap();
        // answering twice is refused
        assert!(s.respond_permission(&req_id, Some("allow".into())).is_err());
        // the mock echoes the outcome it received back as a chunk
        wait_for(&h.rx, 20, |v| {
            v.pointer("/message/params/update/content/text").and_then(|x| x.as_str()) == Some("perm=selected")
        });
        let end = wait_for(&h.rx, 20, |v| method_is(v, "_chronicle/turn_end"));
        assert_eq!(end.pointer("/message/params/stopReason").and_then(|v| v.as_str()), Some("end_turn"));

        // mode guard: bypassPermissions is advertised by the mock but still refused
        assert!(s.set_mode("bypassPermissions").is_err());
        assert!(s.set_mode("madeUpMode").is_err());
        s.set_mode("acceptEdits").unwrap();
        assert_eq!(s.current_state().pointer("/modes/currentModeId").and_then(|v| v.as_str()), Some("acceptEdits"));

        s.stop(true);
        wait_for(&h.rx, 20, |v| state_is(v, "ended"));
        assert!(h.state.get(&h.key).is_none(), "a stopped session leaves the map");
        let _ = std::fs::remove_dir_all(&h.dir);
    }

    #[test]
    fn cancel_resolves_a_pending_permission_and_never_hangs_the_adapter() {
        let Some(h) = start_mock("cancel") else { eprintln!("skipped: no python3"); return };
        wait_for(&h.rx, 20, |v| state_is(v, "ready"));
        let s = h.state.get(&h.key).unwrap();

        // first turn completes normally (answer its ask)
        s.prompt("turn one".into()).unwrap();
        let ask = wait_for(&h.rx, 20, |v| method_is(v, "session/request_permission"));
        s.respond_permission(&ask.pointer("/message/id").unwrap().to_string(), Some("allow".into())).unwrap();
        wait_for(&h.rx, 20, |v| method_is(v, "_chronicle/turn_end"));

        // second turn: the mock asks permission and waits FOREVER — only the
        // cancelled oneshot lets it finish. If cancel didn't resolve the ask,
        // this test times out (= the adapter would hang).
        s.prompt("turn two".into()).unwrap();
        let ask = wait_for(&h.rx, 20, |v| method_is(v, "session/request_permission"));
        let req_id = ask.pointer("/message/id").unwrap().to_string();
        s.cancel().unwrap();
        let resolved = wait_for(&h.rx, 20, |v| method_is(v, "_chronicle/permission_resolved"));
        assert_eq!(resolved.pointer("/message/params/requestId").and_then(|v| v.as_str()), Some(req_id.as_str()));
        assert_eq!(resolved.pointer("/message/params/outcome").and_then(|v| v.as_str()), Some("cancelled"));
        let end = wait_for(&h.rx, 20, |v| method_is(v, "_chronicle/turn_end"));
        assert_eq!(end.pointer("/message/params/stopReason").and_then(|v| v.as_str()), Some("cancelled"));

        // after the cancelled turn a new prompt is accepted again
        s.prompt("turn three".into()).unwrap();
        s.stop(true);
        wait_for(&h.rx, 20, |v| state_is(v, "ended"));
        let _ = std::fs::remove_dir_all(&h.dir);
    }

    #[test]
    fn adapter_command_puts_node_on_the_child_path() {
        // the Finder-launched bug: without node's dir on the child PATH, npx's
        // `#!/usr/bin/env node` shebang fails and the adapter exits 127. The
        // command MUST carry a PATH that includes npx's own directory so node
        // (which sits beside it) resolves.
        let cmd = adapter_command("/opt/homebrew/bin/npx");
        let path = cmd.get_envs()
            .find(|(k, _)| *k == std::ffi::OsStr::new("PATH"))
            .and_then(|(_, v)| v)
            .map(|v| v.to_string_lossy().to_string())
            .expect("adapter_command must set PATH");
        assert!(path.starts_with("/opt/homebrew/bin"), "npx's own dir leads the PATH: {path}");
        // ANTHROPIC_API_KEY blanked, CLAUDECODE removed — the other spawn seams
        assert!(cmd.get_envs().any(|(k, v)| k == std::ffi::OsStr::new("ANTHROPIC_API_KEY") && v == Some(std::ffi::OsStr::new(""))));
    }

    #[test]
    fn child_path_prepends_the_tool_dir_and_keeps_standard_dirs() {
        let p = child_path("/Users/x/.nvm/versions/node/v24/bin/npx");
        assert!(p.starts_with("/Users/x/.nvm/versions/node/v24/bin"), "{p}");
        assert!(p.contains("/opt/homebrew/bin"), "{p}");
        assert!(p.contains("/usr/local/bin"), "{p}");
    }

    #[test]
    fn jail_refuses_relative_traversal_and_outside_paths() {
        let dir = tmp("jail");
        let s = AcpSession {
            key: "k".into(),
            roots: vec![dir.clone()],
            repo: dir.clone(),
            project_dir: dir.clone(),
            last_checkpoint: Mutex::new(None),
            child: Mutex::new(None),
            writer: Mutex::new(None),
            next_id: AtomicU64::new(1),
            pending: Mutex::new(HashMap::new()),
            perms: Mutex::new(HashMap::new()),
            session_id: Mutex::new(None),
            modes: Mutex::new(Value::Null),
            agent_caps: Mutex::new(Value::Null),
            config_options: Mutex::new(Value::Null),
            turn_active: AtomicBool::new(false),
            resume: None,
            suppress_updates: AtomicBool::new(false),
            emit: Arc::new(|_| {}),
            sessions: Arc::new(Mutex::new(HashMap::new())),
        };
        assert!(s.jail_abs("relative/path.txt").is_err(), "relative paths are refused");
        assert!(s.jail_abs(&format!("{}/../escape.txt", dir.display())).is_err(), "`..` is refused");
        assert!(s.jail_abs("/etc/passwd").is_err(), "outside paths are refused");
        assert!(s.jail_abs(&format!("{}/ok.txt", dir.display())).is_ok(), "a new in-root file resolves");
        assert!(s.jail_abs(&format!("{}/new/nested/ok.txt", dir.display())).is_ok(), "new nested dirs resolve");
        // a symlinked dir inside the root pointing outside must be refused
        let outside = tmp("jail-outside");
        std::os::unix::fs::symlink(&outside, dir.join("sneaky")).unwrap();
        assert!(s.jail_abs(&format!("{}/sneaky/x.txt", dir.display())).is_err(), "symlink escapes are refused");
        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::remove_dir_all(&outside);
    }

    /* ---------- Z-3: the ledger + checkpoints ---------- */

    fn git(d: &Path, args: &[&str]) -> String {
        let o = std::process::Command::new("git").arg("-C").arg(d)
            .args(["-c", "user.email=t@t", "-c", "user.name=t"])
            .args(args).output().unwrap();
        assert!(o.status.success(), "git {:?}: {}", args, String::from_utf8_lossy(&o.stderr));
        String::from_utf8_lossy(&o.stdout).trim().to_string()
    }

    fn repo(name: &str) -> PathBuf {
        let d = tmp(name);
        git(&d, &["init", "-q", "-b", "main"]);
        d
    }

    #[test]
    fn checkpoint_round_trip_created_deleted_modified_tracked_and_untracked() {
        let d = repo("cp-roundtrip");
        // tracked files
        std::fs::write(d.join("tracked-mod.txt"), "tracked original").unwrap();
        std::fs::write(d.join("tracked-del.txt"), "tracked doomed").unwrap();
        git(&d, &["add", "-A"]);
        git(&d, &["commit", "-q", "-m", "first"]);
        // untracked files
        std::fs::write(d.join("untracked-mod.txt"), "untracked original").unwrap();
        std::fs::write(d.join("untracked-del.txt"), "untracked doomed").unwrap();

        let cp = checkpoint::create(&d, "sess-t").unwrap();

        // the turn: MODIFY tracked+untracked, DELETE tracked+untracked,
        // CREATE tracked-dir + untracked files
        std::fs::write(d.join("tracked-mod.txt"), "tracked mangled").unwrap();
        std::fs::write(d.join("untracked-mod.txt"), "untracked mangled").unwrap();
        std::fs::remove_file(d.join("tracked-del.txt")).unwrap();
        std::fs::remove_file(d.join("untracked-del.txt")).unwrap();
        std::fs::write(d.join("created-top.txt"), "agent made this").unwrap();
        std::fs::create_dir_all(d.join("newdir")).unwrap();
        std::fs::write(d.join("newdir/created-nested.txt"), "agent made this too").unwrap();

        checkpoint::restore(&d, &cp).unwrap();

        // MODIFIED: bytes back, both classes
        assert_eq!(std::fs::read_to_string(d.join("tracked-mod.txt")).unwrap(), "tracked original");
        assert_eq!(std::fs::read_to_string(d.join("untracked-mod.txt")).unwrap(), "untracked original");
        // DELETED: back, both classes
        assert_eq!(std::fs::read_to_string(d.join("tracked-del.txt")).unwrap(), "tracked doomed");
        assert_eq!(std::fs::read_to_string(d.join("untracked-del.txt")).unwrap(), "untracked doomed");
        // CREATED: GONE — the known failure mode (checkout-index can't do this)
        assert!(!d.join("created-top.txt").exists(), "a created file must be DELETED by restore");
        assert!(!d.join("newdir/created-nested.txt").exists(), "a nested created file must be DELETED by restore");
        // the user's real index was never touched: still clean HEAD, no staged junk
        assert_eq!(git(&d, &["diff", "--cached", "--name-only"]), "");
        // the session ref carries the checkpoint until a clean end deletes it
        assert!(checkpoint::contains(&d, "sess-t", &cp));
        checkpoint::delete_ref(&d, "sess-t");
        assert!(!checkpoint::contains(&d, "sess-t", &cp));
    }

    #[test]
    fn ledger_diffs_undo_and_created_file_undo_is_deletion() {
        let d = repo("ledger");
        let sid = "sess-l";
        // modified file: base recorded before the write
        std::fs::write(d.join("app.txt"), "line one\nline two\n").unwrap();
        let modified = d.join("app.txt");
        ledger::record_base(&d, sid, &modified, false, Some(b"line one\nline two\n")).unwrap();
        std::fs::write(&modified, "line one\nline CHANGED\nline three\n").unwrap();
        // created file: no base
        let created = d.join("fresh.txt");
        ledger::record_base(&d, sid, &created, false, None).unwrap();
        std::fs::write(&created, "made by the agent\n").unwrap();

        let files = ledger::files(&d, sid, &d);
        assert_eq!(files.len(), 2);
        let modf = files.iter().find(|f| f["path"] == "app.txt").unwrap();
        assert_eq!(modf["kind"], "modified");
        assert_eq!(modf["plus"], 2);
        assert_eq!(modf["minus"], 1);
        let newf = files.iter().find(|f| f["path"] == "fresh.txt").unwrap();
        assert_eq!(newf["kind"], "created");
        assert_eq!(newf["plus"], 1);

        // the diff derives from base vs disk
        let diff = ledger::diff(&d, sid, &d, modified.to_string_lossy().as_ref()).unwrap();
        assert!(diff.contains("-line two") && diff.contains("+line CHANGED"), "{diff}");

        // a second write keeps the ORIGINAL base
        assert!(!ledger::record_base(&d, sid, &modified, false, Some(b"not the base")).unwrap());

        // undo: modified restores bytes; created is DELETED
        let roots = vec![d.clone()];
        ledger::undo(&d, sid, Some(modified.to_string_lossy().as_ref()), &roots).unwrap();
        assert_eq!(std::fs::read_to_string(&modified).unwrap(), "line one\nline two\n");
        ledger::undo(&d, sid, Some(created.to_string_lossy().as_ref()), &roots).unwrap();
        assert!(!created.exists(), "created-file undo must DELETE the file");
        assert!(ledger::files(&d, sid, &d).is_empty());
    }

    #[test]
    fn ledger_bases_survive_a_restart_and_keep_resolves() {
        let d = repo("ledger-restart");
        let sid = "sess-r";
        ledger::set_current_session(&d, sid);
        let target = d.join("kept.txt");
        std::fs::write(&target, "before").unwrap();
        ledger::record_base(&d, sid, &target, false, Some(b"before")).unwrap();
        std::fs::write(&target, "after").unwrap();
        // "restart": nothing in memory — the current pointer + disk index carry it
        assert_eq!(ledger::current_session(&d).as_deref(), Some(sid));
        let files = ledger::files(&d, sid, &d);
        assert_eq!(files.len(), 1);
        // undo still round-trips from the persisted base
        ledger::undo(&d, sid, Some(target.to_string_lossy().as_ref()), &[d.clone()]).unwrap();
        assert_eq!(std::fs::read_to_string(&target).unwrap(), "before");
        // keep-all clears the rest
        std::fs::write(&target, "after again").unwrap();
        ledger::record_base(&d, sid, &target, false, Some(b"before")).unwrap();
        ledger::keep(&d, sid, None).unwrap();
        assert!(ledger::files(&d, sid, &d).is_empty(), "keep resolves everything");
    }

    #[test]
    fn turn_end_reconciliation_finds_command_changes_only() {
        let d = repo("reconcile");
        std::fs::write(d.join("by-command.txt"), "shell original").unwrap();
        git(&d, &["add", "-A"]);
        git(&d, &["commit", "-q", "-m", "first"]);
        let sid = "sess-1";

        // a session whose turn starts here
        let (tx, _rx) = mpsc::channel::<Value>();
        let s = AcpSession {
            key: d.to_string_lossy().to_string(),
            roots: vec![d.clone()],
            repo: d.clone(),
            project_dir: d.clone(),
            last_checkpoint: Mutex::new(None),
            child: Mutex::new(None),
            writer: Mutex::new(None),
            next_id: AtomicU64::new(1),
            pending: Mutex::new(HashMap::new()),
            perms: Mutex::new(HashMap::new()),
            session_id: Mutex::new(Some(sid.into())),
            modes: Mutex::new(Value::Null),
            agent_caps: Mutex::new(Value::Null),
            config_options: Mutex::new(Value::Null),
            turn_active: AtomicBool::new(false),
            resume: None,
            suppress_updates: AtomicBool::new(false),
            emit: Arc::new(move |v| { let _ = tx.send(v); }),
            sessions: Arc::new(Mutex::new(HashMap::new())),
        };
        let cp = checkpoint::create(&d, sid).unwrap();
        *s.last_checkpoint.lock().unwrap() = Some(cp);

        // a DIRECT write (already ledgered) + a SHELL change + a shell creation
        let direct = d.join("direct.txt");
        ledger::record_base(&d, sid, &direct, false, None).unwrap();
        std::fs::write(&direct, "via fs/write_text_file").unwrap();
        std::fs::write(d.join("by-command.txt"), "shell mangled").unwrap();
        std::fs::write(d.join("command-made.txt"), "spawned by npm").unwrap();

        s.reconcile_turn_end();

        let files = ledger::files(&d, sid, &d);
        let by = |p: &str| files.iter().find(|f| f["path"] == p).cloned().unwrap_or_else(|| panic!("{p} missing: {files:?}"));
        assert_eq!(by("direct.txt")["viaCommand"], false, "a direct write keeps its own entry");
        let cmd_mod = by("by-command.txt");
        assert_eq!(cmd_mod["viaCommand"], true);
        assert_eq!(cmd_mod["kind"], "modified");
        let cmd_new = by("command-made.txt");
        assert_eq!(cmd_new["viaCommand"], true);
        assert_eq!(cmd_new["kind"], "created");
        // the command-changed base came from the checkpoint — diff is reviewable
        let diff = ledger::diff(&d, sid, &d, d.join("by-command.txt").to_string_lossy().as_ref()).unwrap();
        assert!(diff.contains("-shell original") && diff.contains("+shell mangled"), "{diff}");
        // …but per-file undo is refused: only Undo to here covers it
        let err = ledger::undo(&d, sid, Some(d.join("by-command.txt").to_string_lossy().as_ref()), &[d.clone()]).unwrap_err();
        assert!(err.contains("Undo to here"), "{err}");
        // undo-all only touches direct entries
        let n = ledger::undo(&d, sid, None, &[d.clone()]).unwrap();
        assert_eq!(n, 1);
        assert!(!direct.exists(), "the direct created file is undone (deleted)");
        assert_eq!(std::fs::read_to_string(d.join("by-command.txt")).unwrap(), "shell mangled");
    }

    #[test]
    fn ledger_jail_refusals() {
        let d = repo("ledger-jail");
        let outside = tmp("ledger-jail-outside");
        let sid = "sess-j";
        let victim = outside.join("victim.txt");
        std::fs::write(&victim, "outside bytes").unwrap();
        // an entry that somehow names an outside path must still be refused at undo
        ledger::record_base(&d, sid, &victim, false, Some(b"evil base")).unwrap();
        let err = ledger::undo(&d, sid, Some(victim.to_string_lossy().as_ref()), &[d.clone()]).unwrap_err();
        assert!(err.contains("outside"), "{err}");
        assert_eq!(std::fs::read_to_string(&victim).unwrap(), "outside bytes", "the outside file is untouched");
        assert!(!path_in_roots(&victim, &[d.clone()]));
        assert!(path_in_roots(&d.join("inside.txt"), &[d.clone()]));
        let _ = std::fs::remove_dir_all(&outside);
    }

    #[test]
    fn old_checkpoint_refs_are_pruned_fresh_ones_stay() {
        let d = repo("cp-prune");
        std::fs::write(d.join("x.txt"), "x").unwrap();
        let fresh = checkpoint::create(&d, "sess-fresh").unwrap();
        // an orphaned session ref from 20 days ago
        let tree = checkpoint::snapshot_tree(&d).unwrap();
        let old = {
            let o = std::process::Command::new("git").arg("-C").arg(&d)
                .env("GIT_COMMITTER_DATE", "2020-01-01T00:00:00Z")
                .env("GIT_AUTHOR_DATE", "2020-01-01T00:00:00Z")
                .args(["-c", "user.email=t@t", "-c", "user.name=t", "commit-tree", &tree, "-m", "orphan"])
                .output().unwrap();
            assert!(o.status.success());
            String::from_utf8_lossy(&o.stdout).trim().to_string()
        };
        git(&d, &["update-ref", "refs/chronicle/checkpoints/sess-orphan", &old]);
        checkpoint::prune_old(&d);
        assert!(!checkpoint::contains(&d, "sess-orphan", &old), "the 2020 ref is pruned");
        assert!(checkpoint::contains(&d, "sess-fresh", &fresh), "a fresh ref survives");
    }

    /* ---------- Z-4: the transcript store ---------- */

    #[test]
    fn transcript_store_lists_reads_and_gates_resume() {
        let d = tmp("transcript");
        transcript::append(&d, "s1", &json!({"method":"_chronicle/user_message","params":{"text":"make the pricing cards align"}}));
        transcript::append(&d, "s1", &json!({"method":"session/update","params":{"update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"ok"}}}}));
        transcript::append(&d, "s1", &json!({"method":"_chronicle/turn_end","params":{"stopReason":"end_turn"}}));
        std::thread::sleep(std::time::Duration::from_millis(20));
        transcript::append(&d, "s2", &json!({"method":"_chronicle/user_message","params":{"text":"round 5"}}));
        // a dir with no user message is not history
        let _ = std::fs::create_dir_all(super::ledger::agent_dir(&d).join("empty"));

        // no caps file yet → resume is NEVER promised
        let list = transcript::sessions_list(&d, None);
        assert_eq!(list.len(), 2, "{list:?}");
        assert!(list.iter().all(|s| s["resumable"] == false));
        assert_eq!(list[0]["id"], "s2", "newest first");
        assert_eq!(list[1]["firstMessage"], "make the pricing cards align");
        assert_eq!(list[1]["userMessages"], 1);

        // capability saved at handshake → resumable, except the live session
        transcript::save_caps(&d, true);
        let list = transcript::sessions_list(&d, Some("s2"));
        let s2 = list.iter().find(|s| s["id"] == "s2").unwrap();
        assert_eq!(s2["active"], true);
        assert_eq!(s2["resumable"], false, "the live session doesn't offer Resume");
        let s1 = list.iter().find(|s| s["id"] == "s1").unwrap();
        assert_eq!(s1["resumable"], true);

        // the read replays the stored lines in order
        let lines = transcript::read(&d, "s1");
        assert_eq!(lines.len(), 3);
        assert_eq!(lines[0]["method"], "_chronicle/user_message");
        assert_eq!(lines[2]["method"], "_chronicle/turn_end");
    }

    /// The real adapter, end to end: gated behind CHRONICLE_ACP_TEST=1 (needs
    /// npx + a logged-in Claude Code). Run with:
    ///   CHRONICLE_ACP_TEST=1 cargo test acp_real_adapter -- --ignored --nocapture
    #[test]
    #[ignore]
    fn acp_real_adapter_round_trip() {
        if std::env::var("CHRONICLE_ACP_TEST").ok().as_deref() != Some("1") {
            eprintln!("skipped: set CHRONICLE_ACP_TEST=1 to run against the real adapter");
            return;
        }
        let Some(npx) = crate::find_tool("npx") else {
            eprintln!("skipped: npx not found");
            return;
        };
        let dir = tmp("real");
        let _ = std::process::Command::new("git").arg("-C").arg(&dir).arg("init").output();
        let (tx, rx) = mpsc::channel::<Value>();
        let emit: Emit = Arc::new(move |v| { let _ = tx.send(v); });
        let state = AcpState::new();
        let key = dir.to_string_lossy().to_string();
        start(&state, emit, key.clone(), dir.clone(), dir.clone(), vec![dir.clone()], None, adapter_command(&npx)).unwrap();

        let ready = wait_for(&rx, 300, |v| state_is(v, "ready") || state_is(v, "needs-login") || state_is(v, "error"));
        if !state_is(&ready, "ready") {
            panic!("the adapter didn't reach ready: {ready}");
        }
        assert!(ready.pointer("/message/params/modes/availableModes").and_then(|v| v.as_array()).map(|a| !a.is_empty()).unwrap_or(false),
            "the session response must carry the agent's own modes");

        let s = state.get(&key).unwrap();
        s.prompt("Reply with exactly the word: pong".into()).unwrap();
        let mut saw_chunk = false;
        let deadline = std::time::Instant::now() + Duration::from_secs(180);
        loop {
            let left = deadline.saturating_duration_since(std::time::Instant::now());
            if left.is_zero() { panic!("no turn_end from the real adapter"); }
            let v = rx.recv_timeout(left).expect("no event from the real adapter");
            if v.pointer("/message/params/update/sessionUpdate").and_then(|x| x.as_str()) == Some("agent_message_chunk") {
                saw_chunk = true;
            }
            if method_is(&v, "session/request_permission") {
                // answer with the first rejecting option so the turn can end
                let id = v.pointer("/message/id").unwrap().to_string();
                let opts = v.pointer("/message/params/options").and_then(|o| o.as_array()).cloned().unwrap_or_default();
                let reject = opts.iter().find(|o| o.get("kind").and_then(|k| k.as_str()).map(|k| k.starts_with("reject")).unwrap_or(false))
                    .or(opts.first())
                    .and_then(|o| o.get("optionId")).and_then(|x| x.as_str()).unwrap_or("").to_string();
                s.respond_permission(&id, Some(reject)).unwrap();
            }
            if method_is(&v, "_chronicle/turn_end") { break; }
        }
        assert!(saw_chunk, "streamed message chunks must arrive");
        s.stop(true);
        wait_for(&rx, 30, |v| state_is(v, "ended"));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
