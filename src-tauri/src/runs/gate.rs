//! The gate (spec §3, §4, §11). After a lane's turn: what it changed is split
//! into its own files and leaks; its own files are saved by explicit path
//! under one git mutex; the save is checked in a scratch worktree outside the
//! repo (CARGO_TARGET_DIR on the main tree's target, node_modules linked);
//! exit codes are law; a check is killed with its whole process group at ten
//! minutes. Leaks are reported, never reverted. Only Rust writes git, here.
use super::checks::{cargo_dir, Check};
use super::lane_map::compile;
use super::record::{CheckResult, LaneMap, Leak};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// Every git write a run makes goes through this one lock (spec §4, "Index").
pub static GIT: Mutex<()> = Mutex::new(());
pub const CHECK_TIMEOUT: Duration = Duration::from_secs(600);
pub const BUSY: &str = "Git is busy";
const TAIL_BYTES: usize = 6000;
const DIFF_CAP: usize = 60_000;
static NEXT_LOG: AtomicU64 = AtomicU64::new(0);

fn lock() -> std::sync::MutexGuard<'static, ()> { GIT.lock().unwrap_or_else(|e| e.into_inner()) }

pub fn git_raw(repo: &Path, args: &[&str]) -> Result<String, String> {
    let out = git_cmd(repo, args).output()
        .map_err(|e| format!("couldn't run git: {e}"))?;
    if out.status.success() { Ok(String::from_utf8_lossy(&out.stdout).into_owned()) }
    else { Err(String::from_utf8_lossy(&out.stderr).trim().to_string()) }
}
pub fn git(repo: &Path, args: &[&str]) -> Result<String, String> { git_raw(repo, args).map(|s| s.trim().to_string()) }
fn git_ok(repo: &Path, args: &[&str]) -> bool {
    git_cmd(repo, args).stdout(Stdio::null()).stderr(Stdio::null()).status().map(|s| s.success()).unwrap_or(false)
}
/// Every git this file runs: no hooks (a husky/lint-staged hook rewrites files
/// across the whole tree, and a hung one would hold `GIT` forever), no signing
/// (a pinentry prompt would hold it just as long), and pathspecs are literal (`app/[id]/page.tsx` must not also match `app/i/…`).
fn git_cmd(repo: &Path, args: &[&str]) -> Command {
    let mut c = Command::new("git");
    c.arg("-C").arg(repo).args(["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false"]).args(args)
        .env("GIT_LITERAL_PATHSPECS", "1").stdin(Stdio::null());
    // the tests never inherit the user's global config (hooksPath, templateDir, …)
    #[cfg(test)] c.env("GIT_CONFIG_GLOBAL", "/dev/null").env("GIT_CONFIG_NOSYSTEM", "1");
    c
}
/// Paths from a `-z` listing, split on NUL: never quoted, never escaped.
fn nul_paths(out: &str) -> Vec<String> {
    out.split('\0').filter(|s| !s.is_empty()).map(String::from).collect()
}

/// `~/Library/Application Support/Chronicle/scratch/<repo-hash>/` (spec §15.8).
pub fn scratch_dir(repo: &Path) -> PathBuf {
    use sha2::{Digest, Sha256};
    let mut h = Sha256::new();
    h.update(repo.to_string_lossy().as_bytes());
    crate::config_dir().join("scratch").join(&format!("{:x}", h.finalize())[..16])
}

/// The scratch worktree, detached at `commit`. Made once, moved after; a copy
/// that can no longer be moved is thrown away and made again, once.
pub fn prepare_scratch(repo: &Path, scratch: &Path, commit: &str) -> Result<(), String> {
    let _g = lock();
    let moved = scratch.join(".git").exists() && (|| {
        git(scratch, &["checkout", "--detach", "--force", "-q", commit])?;
        // Chronicle's own copy, never the user's tree: the last check's leftovers go
        git(scratch, &["clean", "-fdq", "-e", "node_modules"])
    })().is_ok();
    if !moved {
        let _ = git(repo, &["worktree", "prune"]);
        if let Some(parent) = scratch.parent() { std::fs::create_dir_all(parent).map_err(|e| e.to_string())?; }
        let _ = std::fs::remove_dir_all(scratch);
        let _ = git(repo, &["worktree", "prune"]);
        git(repo, &["worktree", "add", "--detach", "--force", "-q", &scratch.to_string_lossy(), commit])?;
    }
    let nm = repo.join("node_modules");
    let link = scratch.join("node_modules");
    if nm.is_dir() && std::fs::symlink_metadata(&link).is_err() {
        std::os::unix::fs::symlink(&nm, &link).map_err(|e| format!("couldn't link node_modules: {e}"))?;
    }
    Ok(())
}

pub fn check_env(repo: &Path) -> Vec<(String, String)> {
    let mut env = vec![("PATH".to_string(), crate::setup::tool_env_path()), ("CI".to_string(), "1".to_string())];
    if let Some(d) = cargo_dir(repo) { env.push(("CARGO_TARGET_DIR".into(), d.join("target").to_string_lossy().into_owned())); }
    env
}

fn human(d: Duration) -> String {
    match d.as_secs() { 1 => "1 second".into(), s if s >= 60 => format!("{} minutes", s / 60), s => format!("{s} seconds") }
}

fn tail_of(p: &Path) -> String {
    let bytes = std::fs::read(p).unwrap_or_default();
    let start = bytes.len().saturating_sub(TAIL_BYTES);
    String::from_utf8_lossy(&bytes[start..]).trim_end().to_string()
}

/// One check, in its own process group, output to a file (a child that keeps a
/// pipe open can never wedge us), killed with the whole group at `timeout`.
pub fn run_check(cwd: &Path, check: &Check, env: &[(String, String)], timeout: Duration) -> CheckResult {
    use std::os::unix::process::CommandExt;
    let started = Instant::now();
    let log = std::env::temp_dir().join(format!("chronicle-check-{}-{}.log", std::process::id(), NEXT_LOG.fetch_add(1, Ordering::SeqCst)));
    let fail = |tail: String| CheckResult { name: check.name.clone(), exit: None, ms: 0, timed_out: false, tail };
    let out = match std::fs::File::create(&log) { Ok(f) => f, Err(e) => return fail(format!("couldn't open a log for the check: {e}")) };
    let out2 = match out.try_clone() { Ok(f) => f, Err(e) => return fail(e.to_string()) };
    let mut cmd = Command::new("/bin/sh");
    cmd.arg("-c").arg(&check.command).current_dir(cwd).stdin(Stdio::null()).stdout(out).stderr(out2).process_group(0);
    for (k, v) in env { cmd.env(k, v); }
    let mut child = match cmd.spawn() { Ok(c) => c, Err(e) => return fail(format!("couldn't start the check: {e}")) };
    let pgid = child.id() as i32;
    let (exit, timed_out) = loop {
        match child.try_wait() {
            Ok(Some(st)) => break (st.code(), false),
            Ok(None) if started.elapsed() >= timeout => {
                unsafe { libc::killpg(pgid, libc::SIGKILL); }
                let _ = child.wait();
                break (None, true);
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(100)),
            Err(_) => break (None, false),
        }
    };
    // anything the check left running dies with its group
    unsafe { libc::killpg(pgid, libc::SIGKILL); }
    let mut tail = tail_of(&log);
    let _ = std::fs::remove_file(&log);
    if timed_out { tail.push_str(&format!("\n[stopped after {}]", human(timeout))); }
    CheckResult { name: check.name.clone(), exit, ms: started.elapsed().as_millis() as u64, timed_out, tail }
}

pub struct Checked { pub results: Vec<CheckResult>, pub notice: Option<String>, pub main_tree: bool }

/// Run `checks` against `commit` in the scratch copy; without one, in the
/// project itself with a notice, and the caller pauses lanes while they run.
pub fn run_checks_at(repo: &Path, scratch: &Path, commit: &str, checks: &[Check]) -> Checked {
    if checks.is_empty() { return Checked { results: vec![], notice: None, main_tree: false }; }
    let env = check_env(repo);
    match prepare_scratch(repo, scratch, commit) {
        Ok(()) => Checked { results: checks.iter().map(|c| run_check(scratch, c, &env, CHECK_TIMEOUT)).collect(), notice: None, main_tree: false },
        Err(e) => Checked {
            results: checks.iter().map(|c| run_check(repo, c, &env, CHECK_TIMEOUT)).collect(),
            notice: Some(format!("Chronicle couldn't make its scratch copy ({e}), so the checks ran in your project while the lanes waited.")),
            main_tree: true,
        },
    }
}

#[derive(Debug, PartialEq)]
pub enum Saved { Commit(String), AlreadySaved(String), Nothing }

fn with_index_retry<T>(mut f: impl FnMut() -> Result<T, String>) -> Result<T, String> {
    for _ in 0..40 {
        match f() {
            Err(e) if e.contains("index.lock") => std::thread::sleep(Duration::from_millis(250)),
            r => return r,
        }
    }
    Err(format!("{BUSY}: another git command holds the index. Chronicle will save this lane on its next try."))
}

/// Save exactly `paths` (stage by explicit path, `commit --only` so nothing
/// else the index holds — the user's own staged files — rides along).
pub fn save_paths(repo: &Path, paths: &[String], message: &str) -> Result<Saved, String> {
    if paths.is_empty() { return Ok(Saved::Nothing); }
    let _g = lock();
    let mut ls = vec!["ls-files", "-z", "--"];
    ls.extend(paths.iter().map(|s| s.as_str()));
    let tracked: HashSet<String> = nul_paths(&git_raw(repo, &ls).unwrap_or_default()).into_iter().collect();
    let live: Vec<&str> = paths.iter().map(|s| s.as_str()).filter(|p| repo.join(p).exists() || tracked.contains(*p)).collect();
    if live.is_empty() { return Ok(Saved::Nothing); }
    let saved = (|| {
        let mut add = vec!["add", "--"];
        add.extend(live.iter().copied());
        with_index_retry(|| git(repo, &add))?;
        let mut diff = vec!["diff", "--cached", "--quiet", "HEAD", "--"];
        diff.extend(live.iter().copied());
        if git_ok(repo, &diff) { return Ok(Saved::AlreadySaved(git(repo, &["rev-parse", "HEAD"])?)); }
        let mut commit = vec!["commit", "--only", "--no-verify", "-q", "-m", message, "--"];
        commit.extend(live.iter().copied());
        with_index_retry(|| git(repo, &commit))?;
        Ok(Saved::Commit(git(repo, &["rev-parse", "HEAD"])?))
    })();
    if saved.is_err() {
        // a save that didn't happen leaves nothing of the lane's staged
        let mut reset = vec!["reset", "-q", "--"];
        reset.extend(live.iter().copied());
        let _ = with_index_retry(|| git(repo, &reset));
    }
    saved
}

pub fn changed_between(repo: &Path, from_tree: &str, to_tree: &str) -> Vec<String> {
    nul_paths(&git_raw(repo, &["diff-tree", "-r", "-z", "--name-only", "--no-renames", from_tree, to_tree]).unwrap_or_default())
}

/// After a restart there is no turn snapshot: everything that differs from HEAD.
pub fn dirty_paths(repo: &Path) -> Vec<String> {
    // porcelain v1 with -z keeps the `XY ` prefix and never quotes the path
    nul_paths(&git_raw(repo, &["status", "--porcelain=v1", "-z", "--untracked-files=all", "--no-renames"]).unwrap_or_default())
        .into_iter().filter_map(|l| l.get(3..).map(String::from)).filter(|p| !p.is_empty()).collect()
}

/// The lane's own files, and the rest as leaks (spec §4, the shell hole). A
/// path another lane owns is that lane's when that lane was working too AND
/// wrote it through a tool Chronicle allowed; otherwise it is a leak. The
/// app's own `.chronicle/` writes are never anyone's.
pub fn split_changes(changed: &[String], lane: &str, map: &LaneMap, active: &[String], tool_writes: &HashMap<String, HashSet<String>>) -> (Vec<String>, Vec<Leak>) {
    let globs: Vec<(String, Vec<super::lane_map::Glob>)> = map.lanes.iter().map(|l| (l.id.clone(), compile(&l.owns))).collect();
    let mut owned = vec![];
    let mut leaks = vec![];
    for p in changed {
        if p.starts_with(".chronicle/") { continue; }
        match globs.iter().find(|(_, gs)| gs.iter().any(|g| g.matches(p))).map(|(id, _)| id.clone()) {
            Some(id) if id == lane => owned.push(p.clone()),
            Some(id) => {
                let theirs = active.contains(&id) && tool_writes.get(&id).map(|s| s.contains(p)).unwrap_or(false);
                if !theirs { leaks.push(Leak { path: p.clone(), owner: Some(id), by: None }); }
            }
            None => leaks.push(Leak { path: p.clone(), owner: None, by: None }),
        }
    }
    (owned, leaks)
}

pub fn diff_for(repo: &Path, commit: &str) -> String {
    let d = git_raw(repo, &["show", "--format=", "--patch", "--no-color", commit]).unwrap_or_default();
    if d.len() <= DIFF_CAP { return d; }
    let mut end = DIFF_CAP;
    while !d.is_char_boundary(end) { end -= 1; }
    format!("{}\n[the diff is longer; the rest was cut]", &d[..end])
}

pub fn files_in(repo: &Path, commit: &str) -> Vec<String> {
    nul_paths(&git_raw(repo, &["diff-tree", "--no-commit-id", "--root", "-r", "-z", "--name-only", "--no-renames", commit]).unwrap_or_default())
}

/// The user's Discard on a stopped lane (spec §3, Stop): its files are put
/// back to what was saved (HEAD — not whatever the index holds). Nothing that
/// HEAD lacks is deleted. Returns how many were put back.
pub fn discard_paths(repo: &Path, paths: &[String]) -> Result<usize, String> {
    if paths.is_empty() { return Ok(0); }
    let _g = lock();
    let mut ls = vec!["ls-tree", "-r", "-z", "--name-only", "HEAD", "--"];
    ls.extend(paths.iter().map(|s| s.as_str()));
    let tracked = nul_paths(&git_raw(repo, &ls)?);
    if tracked.is_empty() { return Ok(0); }
    let mut co = vec!["checkout", "HEAD", "--"];
    co.extend(tracked.iter().map(|s| s.as_str()));
    with_index_retry(|| git(repo, &co))?;
    Ok(tracked.len())
}

/// HEAD already is round `round`'s closing save (its `Chronicle-Phase` trailer).
pub fn head_has_trailer(repo: &Path, round: u64) -> bool {
    let want = format!("Chronicle-Phase: FX-{round} done");
    git(repo, &["log", "-1", "--format=%B"]).map(|m| m.lines().any(|l| l.trim() == want)).unwrap_or(false)
}

/// The round's closing trailer as an empty commit made with plumbing, so the
/// index — and anything the user has staged — is never part of it.
pub fn close_commit(repo: &Path, round: u64) -> Result<String, String> {
    let _g = lock();
    let head = git(repo, &["rev-parse", "HEAD"])?;
    let tree = git(repo, &["rev-parse", "HEAD^{tree}"])?;
    let id = format!("FX-{round}");
    let commit = git(repo, &["commit-tree", &tree, "-p", &head, "-m", &format!("Close {id}"), "-m", &format!("Chronicle-Phase: {id} done")])?;
    git(repo, &["update-ref", "-m", &format!("chronicle: close {id}"), "HEAD", &commit, &head])?;
    Ok(commit)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::runs::record::LaneSpec;

    fn tmpdir(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("chronicle-gate-{}-{}", name, std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d.canonicalize().unwrap()
    }
    /// A throwaway repository with one commit. Every git write in these tests lands here.
    fn repo(name: &str) -> PathBuf {
        let d = tmpdir(name);
        for a in [&["init", "-q"][..], &["config", "user.email", "t@t"], &["config", "user.name", "t"], &["config", "commit.gpgsign", "false"]] {
            git(&d, a).unwrap();
        }
        std::fs::write(d.join("README.md"), "toy\n").unwrap();
        git(&d, &["add", "README.md"]).unwrap();
        git(&d, &["commit", "-qm", "init"]).unwrap();
        d
    }
    fn spec(id: &str, owns: &[&str]) -> LaneSpec {
        LaneSpec { id: id.into(), title: id.into(), items: vec![], owns: owns.iter().map(|s| s.to_string()).collect(), depends_on: vec![], checks: vec![], isolation: None }
    }

    #[test]
    fn checks_report_exit_codes_and_tails() {
        let d = tmpdir("exit");
        let r = run_check(&d, &Check { name: "t".into(), command: "echo hi; echo oops 1>&2; exit 3".into() }, &[], Duration::from_secs(10));
        assert_eq!(r.exit, Some(3));
        assert!(!r.timed_out);
        assert!(r.tail.contains("hi") && r.tail.contains("oops"), "{}", r.tail);
        assert_eq!(run_check(&d, &Check { name: "ok".into(), command: "true".into() }, &[], Duration::from_secs(10)).exit, Some(0));
    }

    #[test]
    fn a_check_that_never_exits_is_killed_with_its_children() {
        let d = tmpdir("hang");
        let c = Check { name: "hang".into(), command: "echo started; sleep 30 & echo $! > child.pid; wait".into() };
        let t = Instant::now();
        let r = run_check(&d, &c, &[], Duration::from_secs(1));
        assert!(t.elapsed() < Duration::from_secs(5), "killed at the timeout, not after the sleep");
        assert!(r.timed_out);
        assert_eq!(r.exit, None, "counted as failed");
        assert!(r.tail.contains("started"), "the partial output is kept: {}", r.tail);
        assert!(r.tail.contains("[stopped after 1 second]"), "{}", r.tail);
        std::thread::sleep(Duration::from_millis(300));
        let pid: i32 = std::fs::read_to_string(d.join("child.pid")).unwrap().trim().parse().unwrap();
        assert_ne!(unsafe { libc::kill(pid, 0) }, 0, "the background child died with its group");
    }

    #[test]
    fn the_scratch_copy_checks_a_commit_outside_the_repo() {
        let r = repo("scratch");
        std::fs::create_dir_all(r.join("node_modules/x")).unwrap();
        std::fs::write(r.join(".gitignore"), "node_modules\n").unwrap();
        std::fs::write(r.join("a.txt"), "one").unwrap();
        git(&r, &["add", "a.txt", ".gitignore"]).unwrap();
        git(&r, &["commit", "-qm", "a"]).unwrap();
        let c1 = git(&r, &["rev-parse", "HEAD"]).unwrap();
        std::fs::write(r.join("a.txt"), "two").unwrap(); // the user's own unsaved edit
        let s = tmpdir("scratch-copy").join("copy");
        let checks = vec![Check { name: "test".into(), command: "test \"$(cat a.txt)\" = one && test -d node_modules/x".into() }];
        let out = run_checks_at(&r, &s, &c1, &checks);
        assert_eq!(out.results[0].exit, Some(0), "{}", out.results[0].tail);
        assert!(!out.main_tree && out.notice.is_none());
        assert_eq!(git(&r, &["status", "--porcelain"]).unwrap(), "M a.txt", "the user's tree is untouched");
        git(&r, &["commit", "-qam", "b"]).unwrap();
        let c2 = git(&r, &["rev-parse", "HEAD"]).unwrap();
        assert_eq!(run_checks_at(&r, &s, &c2, &checks).results[0].exit, Some(1), "the copy moves to the next commit");
        let bad = run_checks_at(&r, Path::new("/dev/null/cannot"), &c2, &checks);
        assert!(bad.main_tree, "no scratch copy: the checks run in the project (spec §11)");
        assert!(bad.notice.unwrap().contains("ran in your project while the lanes waited"));
    }

    #[test]
    fn a_lane_save_commits_only_its_paths() {
        let r = repo("save");
        std::fs::write(r.join("old.txt"), "x").unwrap();
        git(&r, &["add", "old.txt"]).unwrap();
        git(&r, &["commit", "-qm", "old"]).unwrap();
        std::fs::create_dir_all(r.join("a")).unwrap();
        std::fs::write(r.join("a/new.txt"), "lane").unwrap();
        std::fs::remove_file(r.join("old.txt")).unwrap();
        std::fs::write(r.join("other.txt"), "not the lane's").unwrap();
        let Saved::Commit(c) = save_paths(&r, &["a/new.txt".into(), "old.txt".into(), "a/ghost.txt".into()], "lane a").unwrap() else { panic!("expected a commit") };
        let mut files: Vec<String> = git(&r, &["show", "--name-only", "--format=", &c]).unwrap().lines().map(String::from).collect();
        files.sort();
        assert_eq!(files, vec!["a/new.txt", "old.txt"], "a deletion is saved; a path that never existed is skipped");
        assert_eq!(git(&r, &["status", "--porcelain"]).unwrap(), "?? other.txt", "everything else stays as it was");
        assert_eq!(save_paths(&r, &["a/new.txt".into()], "again").unwrap(), Saved::AlreadySaved(c.clone()));
        assert_eq!(save_paths(&r, &[], "none").unwrap(), Saved::Nothing);
    }

    #[test]
    fn a_lane_save_waits_out_the_users_index_lock_and_leaves_their_staged_files_alone() {
        let r = repo("race");
        std::fs::write(r.join("mine.txt"), "the user's work").unwrap();
        git(&r, &["add", "mine.txt"]).unwrap(); // staged by the user, not yet committed
        std::fs::write(r.join("lane.txt"), "lane a's work").unwrap();
        let lock = r.join(".git/index.lock");
        std::fs::write(&lock, "").unwrap(); // the user's own git is mid-commit
        let l2 = lock.clone();
        let t = std::thread::spawn(move || { std::thread::sleep(Duration::from_millis(800)); std::fs::remove_file(l2).unwrap(); });
        let saved = save_paths(&r, &["lane.txt".into()], "lane a").unwrap();
        t.join().unwrap();
        let Saved::Commit(c) = saved else { panic!("expected a commit once the lock lifted") };
        assert_eq!(git(&r, &["show", "--name-only", "--format=", &c]).unwrap(), "lane.txt");
        assert_eq!(git(&r, &["diff", "--cached", "--name-only"]).unwrap(), "mine.txt", "the user's staged file is still staged, and still theirs");
    }

    #[test]
    fn changes_split_into_owned_files_and_leaks() {
        let map = LaneMap { items: vec![], lanes: vec![spec("a", &["src/a/**"]), spec("b", &["src/b/**"]), spec("c", &["src/c/**"])] };
        let changed: Vec<String> = ["src/a/x.ts", "src/b/own.ts", "src/b/sneaky.ts", "src/c/y.ts", "README.md", ".chronicle/journal.jsonl"].iter().map(|s| s.to_string()).collect();
        let writes = HashMap::from([("b".to_string(), HashSet::from(["src/b/own.ts".to_string()]))]);
        let (owned, leaks) = split_changes(&changed, "a", &map, &["b".to_string()], &writes);
        assert_eq!(owned, vec!["src/a/x.ts"]);
        assert_eq!(leaks, vec![
            Leak { path: "src/b/sneaky.ts".into(), owner: Some("b".into()), by: None },
            Leak { path: "src/c/y.ts".into(), owner: Some("c".into()), by: None },
            Leak { path: "README.md".into(), owner: None, by: None },
        ], "b's own tool write while b was working is b's; .chronicle/ is the app's");
    }

    #[test]
    fn the_close_commit_is_empty_and_leaves_the_index_alone() {
        let r = repo("close");
        std::fs::write(r.join("mine.txt"), "staged by the user").unwrap();
        git(&r, &["add", "mine.txt"]).unwrap();
        let c = close_commit(&r, 10).unwrap();
        assert_eq!(git(&r, &["rev-parse", "HEAD"]).unwrap(), c);
        assert_eq!(git(&r, &["show", "--name-only", "--format=", &c]).unwrap(), "", "no files in the close commit");
        assert_eq!(git(&r, &["log", "-1", "--format=%(trailers:key=Chronicle-Phase,valueonly)"]).unwrap(), "FX-10 done");
        assert_eq!(git(&r, &["diff", "--cached", "--name-only"]).unwrap(), "mine.txt");
    }

    #[test]
    fn discard_puts_back_only_the_lanes_tracked_files() {
        let r = repo("discard");
        std::fs::write(r.join("README.md"), "changed by the lane").unwrap();
        std::fs::write(r.join("keep.txt"), "the user's").unwrap();
        assert_eq!(discard_paths(&r, &["README.md".into(), "never-tracked.txt".into()]).unwrap(), 1);
        assert_eq!(std::fs::read_to_string(r.join("README.md")).unwrap(), "toy\n");
        assert!(r.join("keep.txt").exists());
    }

    #[test]
    fn dirty_paths_reads_porcelain_without_losing_the_first_letter() {
        let r = repo("dirty");
        std::fs::write(r.join("README.md"), "edited").unwrap();
        std::fs::write(r.join("new.txt"), "").unwrap();
        let mut d = dirty_paths(&r);
        d.sort();
        assert_eq!(d, vec!["README.md", "new.txt"]);
    }

    #[test]
    fn a_lane_save_never_runs_the_users_hooks() {
        use std::os::unix::fs::PermissionsExt;
        let r = repo("hooks");
        let hook = r.join(".git/hooks/pre-commit");
        std::fs::create_dir_all(hook.parent().unwrap()).unwrap();
        std::fs::write(&hook, format!("#!/bin/sh\ntouch '{}'\nexit 1\n", r.join("sentinel").display())).unwrap();
        std::fs::set_permissions(&hook, std::fs::Permissions::from_mode(0o755)).unwrap();
        git(&r, &["config", "commit.gpgsign", "true"]).unwrap(); // no key exists: a signed save would fail or prompt
        std::fs::write(r.join("lane.txt"), "lane").unwrap();
        assert!(matches!(save_paths(&r, &["lane.txt".into()], "lane a").unwrap(), Saved::Commit(_)), "saved unsigned, no prompt");
        assert!(!r.join("sentinel").exists(), "the pre-commit hook never ran");
        close_commit(&r, 1).unwrap();
        assert!(!r.join("sentinel").exists());
    }

    #[test]
    fn a_bracketed_path_is_literal_for_save_and_discard() {
        let r = repo("literal");
        std::fs::write(r.join("[x]"), "one").unwrap();
        std::fs::write(r.join("x"), "one").unwrap();
        git(&r, &["add", "--", "[x]", "x"]).unwrap();
        git(&r, &["commit", "-qm", "both"]).unwrap();
        std::fs::write(r.join("[x]"), "lane").unwrap();
        std::fs::write(r.join("x"), "the user's unsaved edit").unwrap();
        let Saved::Commit(c) = save_paths(&r, &["[x]".into()], "lane a").unwrap() else { panic!("expected a commit") };
        assert_eq!(files_in(&r, &c), vec!["[x]"], "only the lane's file is saved");
        std::fs::write(r.join("[x]"), "lane again").unwrap();
        assert_eq!(discard_paths(&r, &["[x]".into()]).unwrap(), 1);
        assert_eq!(std::fs::read_to_string(r.join("[x]")).unwrap(), "lane");
        assert_eq!(std::fs::read_to_string(r.join("x")).unwrap(), "the user's unsaved edit", "x is left alone");
    }

    #[test]
    fn a_failed_save_leaves_nothing_staged() {
        let r = repo("failed");
        std::fs::write(r.join("lane.txt"), "lane").unwrap();
        std::fs::write(r.join("README.md"), "lane edit").unwrap();
        // an empty message makes git abort the commit after the paths were added
        assert!(save_paths(&r, &["lane.txt".into(), "README.md".into()], "").is_err());
        assert_eq!(git(&r, &["diff", "--cached", "--name-only"]).unwrap(), "", "nothing of the lane's is left staged");
        assert_eq!(git(&r, &["rev-list", "--count", "HEAD"]).unwrap(), "1");
    }

    #[test]
    fn discard_restores_what_was_saved_not_what_was_staged() {
        let r = repo("discard-staged");
        std::fs::write(r.join("README.md"), "staged by a save that never finished").unwrap();
        git(&r, &["add", "README.md"]).unwrap();
        assert_eq!(discard_paths(&r, &["README.md".into()]).unwrap(), 1);
        assert_eq!(std::fs::read_to_string(r.join("README.md")).unwrap(), "toy\n");
        assert_eq!(git(&r, &["status", "--porcelain"]).unwrap(), "");
    }

    #[test]
    fn a_non_ascii_file_name_is_read_and_saved() {
        let r = repo("unicode");
        std::fs::write(r.join("café.txt"), "lane").unwrap();
        let dirty = dirty_paths(&r);
        assert_eq!(dirty, vec!["café.txt"]);
        let Saved::Commit(c) = save_paths(&r, &dirty, "lane a").unwrap() else { panic!("expected a commit") };
        assert_eq!(files_in(&r, &c), vec!["café.txt"]);
        let tree = |rev: &str| git(&r, &["rev-parse", &format!("{rev}^{{tree}}")]).unwrap();
        assert_eq!(changed_between(&r, &tree("HEAD~1"), &tree("HEAD")), vec!["café.txt"]);
        assert_eq!(git(&r, &["status", "--porcelain"]).unwrap(), "");
    }

    #[test]
    fn a_broken_scratch_copy_is_made_again() {
        let r = repo("broken-scratch");
        let c = git(&r, &["rev-parse", "HEAD"]).unwrap();
        let s = tmpdir("broken-scratch-copy").join("copy");
        std::fs::create_dir_all(&s).unwrap();
        std::fs::write(s.join(".git"), "gitdir: /nonexistent/chronicle-gate\n").unwrap();
        std::fs::write(s.join("junk"), "").unwrap();
        let out = run_checks_at(&r, &s, &c, &[Check { name: "t".into(), command: "test -f README.md && test ! -e junk".into() }]);
        assert!(!out.main_tree && out.notice.is_none(), "{:?}", out.notice);
        assert_eq!(out.results[0].exit, Some(0), "{}", out.results[0].tail);
    }
}
