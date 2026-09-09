//! The four facts the history section states, and the one place in the app that
//! runs `git fetch`. Every line is read straight out of git — nothing is derived
//! by subtracting one number from another, which is how the old panel came to
//! claim "2 saves waiting" on a branch that had never been published at all.

use crate::{ahead_behind, dirty_set, git_in, git_in_checked, publish_kind, remote_ref, DirtyEntry, OpenRoots};
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::State;

#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct LastSave { pub ts: u64, pub subject: String }

#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct LastPublish { pub ts: u64, pub tag: Option<String> }

#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct RemoteFacts {
    pub kind: String,
    pub ref_name: String,
    pub ahead: u32,
    pub behind: u32,
    pub checked_ms: Option<u64>,
    pub error: Option<String>,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct HistoryFacts {
    pub degraded: bool,
    pub is_git: bool,
    pub last_save: Option<LastSave>,
    pub dirty: Vec<DirtyEntry>,
    pub remote: RemoteFacts,
    pub last_publish: Option<LastPublish>,
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

pub fn facts(repo: &Path, project_dir: &Path) -> HistoryFacts {
    // the same probe get_state uses: an Err means git itself could not run,
    // which is DEGRADED — quite different from "this folder isn't a repo"
    let branch_probe = git_in_checked(repo, &["rev-parse", "--abbrev-ref", "HEAD"]);
    let degraded = branch_probe.is_err();
    let branch = branch_probe.unwrap_or_default();
    let is_git = !branch.is_empty();
    if !is_git {
        return HistoryFacts {
            degraded, is_git: false, last_save: None, dirty: vec![],
            remote: RemoteFacts {
                kind: "no-remote".into(), ref_name: String::new(),
                ahead: 0, behind: 0, checked_ms: None, error: None,
            },
            last_publish: None,
        };
    }
    let remote_url = git_in(repo, &["remote", "get-url", "origin"]);
    let rref = remote_ref(repo, &branch);
    let (ahead, behind) = rref.as_deref().map(|r| ahead_behind(repo, r)).unwrap_or((0, 0));
    HistoryFacts {
        degraded,
        is_git: true,
        last_save: last_save_of(repo),
        dirty: dirty_set(repo),
        remote: RemoteFacts {
            kind: publish_kind(repo, &remote_url).into(),
            ref_name: rref.unwrap_or_default(),
            ahead,
            behind,
            checked_ms: checked_ms(project_dir),
            error: None,
        },
        last_publish: last_publish_of(repo),
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
    let stderr = String::from_utf8_lossy(&out.stderr);
    let sentence = stderr.lines().map(str::trim).filter(|l| !l.is_empty())
        .next_back().unwrap_or("couldn't reach the online copy").to_string();
    let mut f = facts(&p.repo, &p.dir);
    f.remote.error = Some(sentence.chars().take(140).collect());
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
    fn a_plain_repo_reports_its_last_save_and_no_remote() {
        let d = repo("plain");
        let f = facts(&d, &d);
        assert!(!f.degraded);
        assert!(f.is_git);
        let ls = f.last_save.expect("a last save");
        assert_eq!(ls.subject, "feat: first save");
        assert!(ls.ts > 1_600_000_000, "a real unix second: {}", ls.ts);
        assert_eq!(f.remote.kind, "no-remote");
        assert_eq!(f.remote.ref_name, "");
        assert_eq!(f.remote.checked_ms, None);
        assert!(f.last_publish.is_none());
        assert!(f.dirty.is_empty());
    }

    #[test]
    fn the_dirty_list_carries_badge_words() {
        let d = repo("dirty");
        std::fs::write(d.join("a.txt"), "two\n").unwrap();
        std::fs::write(d.join("b.txt"), "new\n").unwrap();
        let f = facts(&d, &d);
        let mut got: Vec<(String, String)> =
            f.dirty.iter().map(|e| (e.path.clone(), e.badge.clone())).collect();
        got.sort();
        assert_eq!(got, vec![
            ("a.txt".to_string(), "edited".to_string()),
            ("b.txt".to_string(), "new".to_string()),
        ]);
    }

    #[test]
    fn a_published_repo_names_the_ref_the_counts_and_the_tag() {
        let origin = tmp("pub-origin");
        git(&origin, &["init", "-q", "--bare", "-b", "main"]);
        let d = repo("pub");
        git(&d, &["remote", "add", "origin", origin.to_string_lossy().as_ref()]);
        git(&d, &["tag", "v0.7.0"]);
        git(&d, &["push", "-q", "origin", "main", "--tags"]);

        let f = facts(&d, &d);
        assert_eq!(f.remote.kind, "ok");
        assert_eq!(f.remote.ref_name, "origin/main");
        assert_eq!((f.remote.ahead, f.remote.behind), (0, 0));
        let lp = f.last_publish.expect("a last publish");
        assert_eq!(lp.tag.as_deref(), Some("v0.7.0"));

        // one save on top: ahead moves, the publish line does NOT
        std::fs::write(d.join("a.txt"), "two\n").unwrap();
        git(&d, &["commit", "-qam", "fix: second save"]);
        let f2 = facts(&d, &d);
        assert_eq!((f2.remote.ahead, f2.remote.behind), (1, 0));
        assert_eq!(f2.last_publish.unwrap().ts, lp.ts, "publishing is not saving");
        assert_eq!(f2.last_save.unwrap().subject, "fix: second save");
    }

    #[test]
    fn a_never_published_repo_says_so_without_lying_about_counts() {
        let d = repo("never");
        git(&d, &["remote", "add", "origin", "https://example.invalid/x.git"]);
        let f = facts(&d, &d);
        assert_eq!(f.remote.kind, "never-published");
        assert_eq!(f.remote.ref_name, "");
        assert_eq!((f.remote.ahead, f.remote.behind), (0, 0));
        assert!(f.last_publish.is_none());
    }

    #[test]
    fn a_folder_that_is_not_a_repo_is_not_degraded() {
        let d = tmp("nogit");
        let f = facts(&d, &d);
        assert!(!f.degraded, "git ran fine — the folder just isn't a repo");
        assert!(!f.is_git);
        assert!(f.last_save.is_none());
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
