//! The two facts the history section states that nothing else on screen knows —
//! when the last save landed and when the last publish did — and the one place in
//! the app that runs `git fetch`. Every line is read straight out of git; nothing
//! is derived by subtracting one number from another, which is how the old panel
//! came to claim "2 saves waiting" on a branch that had never been published at all.
//!
//! THE COST: this used to recompute the whole remote picture — the ref, the kind,
//! ahead/behind, the dirty set — every time the roadmap polled, and `get_state` had
//! just computed all of it on the same heartbeat. It answers only what get_state
//! cannot now: the Remote and Uncommitted lines are built in the frontend from
//! `StateData` (`published`, `remote_ref`, `ahead`, `behind`, `dirty`), and three
//! `git` spawns cover what is left.

use crate::{git_in, OpenRoots};
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::State;

#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct LastSave { pub ts: u64, pub subject: String }

#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct LastPublish { pub ts: u64, pub tag: Option<String> }

#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct HistoryFacts {
    pub last_save: Option<LastSave>,
    pub last_publish: Option<LastPublish>,
    /// when Chronicle last ran a fetch for this project; `None` = never checked
    pub checked_ms: Option<u64>,
    /// only ever set by `git_fetch` — reading git cannot fail into a sentence
    pub error: Option<String>,
}

fn fetch_dir() -> PathBuf { crate::config_dir().join("fetch") }
fn fetch_file(project_dir: &Path) -> PathBuf {
    fetch_dir().join(format!("{}.json", crate::web::project_hash(project_dir)))
}

/// When Chronicle last ran a fetch for this project. `None` = never checked.
pub fn checked_ms(project_dir: &Path) -> Option<u64> {
    let text = std::fs::read_to_string(fetch_file(project_dir)).ok()?;
    serde_json::from_str::<serde_json::Value>(&text).ok()?
        .get("checked_ms")?.as_u64()
}

pub fn store_checked(project_dir: &Path, ms: u64) {
    let _ = std::fs::create_dir_all(fetch_dir());
    let file = fetch_file(project_dir);
    let tmp = file.with_extension("json.tmp");
    if std::fs::write(&tmp, format!("{{\"checked_ms\":{ms}}}")).is_ok() {
        let _ = std::fs::rename(&tmp, &file);
    }
}

/// The newest commit any `origin/*` ref can reach, and the release tag pointing
/// at it if there is one. Committer date, not author date: what the user calls
/// "published" is when the commit landed, not when it was first written.
fn last_publish_of(repo: &Path) -> Option<LastPublish> {
    let raw = git_in(repo, &["log", "-1", "--format=%ct\x1f%H", "--remotes=origin"]);
    let (ts, hash) = raw.split_once('\x1f')?;
    let ts: u64 = ts.trim().parse().ok()?;
    let tag = git_in(repo, &["tag", "--points-at", hash.trim()])
        .lines().map(str::trim).find(|l| !l.is_empty()).map(str::to_string);
    Some(LastPublish { ts, tag })
}

fn last_save_of(repo: &Path) -> Option<LastSave> {
    let raw = git_in(repo, &["log", "-1", "--format=%ct\x1f%s", "HEAD"]);
    let (ts, subject) = raw.split_once('\x1f')?;
    Some(LastSave { ts: ts.trim().parse().ok()?, subject: subject.trim().to_string() })
}

/// Three `git` spawns: the last save, the newest commit any `origin/*` ref can
/// reach, and the tag on it. The checked time is a file beside the app's config.
pub fn facts(repo: &Path, project_dir: &Path) -> HistoryFacts {
    HistoryFacts {
        last_save: last_save_of(repo),
        last_publish: last_publish_of(repo),
        checked_ms: checked_ms(project_dir),
        error: None,
    }
}

#[tauri::command]
pub async fn history_facts(roots: State<'_, OpenRoots>, dir: String) -> Result<HistoryFacts, String> {
    let p = crate::project_for(&roots, &dir)?;
    Ok(facts(&p.repo, &p.dir))
}

/// The ONLY fetch in the app, and it only happens when the user clicks
/// "Check now". Nothing fetches on a timer, on the heartbeat, or on pane open.
/// A failure keeps the old numbers and the old checked time and hands the
/// sentence back on the line — the panel never blanks because the wifi dropped.
#[tauri::command]
pub async fn git_fetch(roots: State<'_, OpenRoots>, dir: String) -> Result<HistoryFacts, String> {
    let p = crate::project_for(&roots, &dir)?;
    let out = std::process::Command::new("git").arg("-C").arg(&p.repo)
        .args(["fetch", "--prune", "origin"]).output().map_err(|e| e.to_string())?;
    if out.status.success() {
        store_checked(&p.dir, crate::epoch_ms());
        return Ok(facts(&p.repo, &p.dir));
    }
    // git says WHY on the `fatal:`/`ERROR:` line and then prints a generic
    // "could not read from remote repository" epilogue underneath it. The last line
    // was the epilogue — the useless half of the message.
    let stderr = String::from_utf8_lossy(&out.stderr);
    let lines: Vec<&str> = stderr.lines().map(str::trim).filter(|l| !l.is_empty()).collect();
    let sentence = lines.iter()
        .find(|l| l.starts_with("fatal:") || l.starts_with("ERROR:"))
        .or_else(|| lines.last())
        .map(|l| l.to_string())
        .unwrap_or_else(|| "couldn't reach the online copy".to_string());
    let mut f = facts(&p.repo, &p.dir);
    f.error = Some(sentence.chars().take(140).collect());
    Ok(f)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("chronicle-facts-{}-{}", name, std::process::id()));
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
        git(&d, &["config", "user.email", "t@t"]);
        git(&d, &["config", "user.name", "t"]);
        std::fs::write(d.join("a.txt"), "one\n").unwrap();
        git(&d, &["add", "-A"]);
        git(&d, &["commit", "-q", "-m", "feat: first save"]);
        d
    }

    #[test]
    fn a_plain_repo_reports_its_last_save() {
        let d = repo("plain");
        let f = facts(&d, &d);
        let ls = f.last_save.expect("a last save");
        assert_eq!(ls.subject, "feat: first save");
        assert!(ls.ts > 1_600_000_000, "a real unix second: {}", ls.ts);
        assert!(f.last_publish.is_none(), "nothing was ever pushed");
        assert_eq!(f.checked_ms, None);
        assert_eq!(f.error, None);
    }

    #[test]
    fn a_published_repo_names_the_publish_time_and_the_tag() {
        let origin = tmp("pub-origin");
        git(&origin, &["init", "-q", "--bare", "-b", "main"]);
        let d = repo("pub");
        git(&d, &["remote", "add", "origin", origin.to_string_lossy().as_ref()]);
        git(&d, &["tag", "v0.7.0"]);
        git(&d, &["push", "-q", "origin", "main", "--tags"]);

        let f = facts(&d, &d);
        let lp = f.last_publish.expect("a last publish");
        assert_eq!(lp.tag.as_deref(), Some("v0.7.0"));

        // one save on top: the publish line does NOT move
        std::fs::write(d.join("a.txt"), "two\n").unwrap();
        git(&d, &["commit", "-qam", "fix: second save"]);
        let f2 = facts(&d, &d);
        assert_eq!(f2.last_publish.unwrap().ts, lp.ts, "publishing is not saving");
        assert_eq!(f2.last_save.unwrap().subject, "fix: second save");
    }

    #[test]
    fn a_folder_that_is_not_a_repo_states_nothing() {
        let d = tmp("nogit");
        let f = facts(&d, &d);
        assert!(f.last_save.is_none());
        assert!(f.last_publish.is_none());
    }

    /// THE COST: the roadmap polls this every 8 seconds beside `get_state`, which
    /// has just read the branch, the remote ref, ahead/behind and the dirty set on
    /// the same heartbeat. Recomputing all of that here cost ~16 `git` processes a
    /// poll. These are the only three facts get_state does not already carry.
    #[test]
    fn the_facts_cost_three_git_spawns() {
        let origin = tmp("spawn-origin");
        git(&origin, &["init", "-q", "--bare", "-b", "main"]);
        let d = repo("spawns");
        git(&d, &["remote", "add", "origin", origin.to_string_lossy().as_ref()]);
        git(&d, &["push", "-qu", "origin", "main"]);
        std::fs::write(d.join("a.txt"), "two\n").unwrap();
        git(&d, &["commit", "-qam", "fix: second save"]);

        let (f, spawns) = crate::git_spawns(|| facts(&d, &d));
        assert_eq!(spawns, 3, "log -1 HEAD, log -1 --remotes=origin, tag --points-at");
        assert_eq!(f.last_save.unwrap().subject, "fix: second save");
        assert!(f.last_publish.is_some());
    }

    #[test]
    fn the_checked_time_round_trips_per_project() {
        let a = tmp("checked-a");
        let b = tmp("checked-b");
        assert_eq!(checked_ms(&a), None);
        store_checked(&a, 1_757_000_000_000);
        assert_eq!(checked_ms(&a), Some(1_757_000_000_000));
        assert_eq!(checked_ms(&b), None, "the file is keyed by project");
        store_checked(&a, 1_757_000_050_000);
        assert_eq!(checked_ms(&a), Some(1_757_000_050_000), "a second check overwrites");
    }
}
