//! `.chronicle/rounds.json` — what `kanban.json`'s `rounds[]` became, plus the
//! two things the board used to compute in the frontend: which notes a live
//! round has locked, and when a round is finished.

use super::{index, parse};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Round {
    pub n: u64,
    pub state: String,               // generating | ready | failed | done
    pub kind: Option<String>,        // "bug fixes" | "feature additions"
    #[serde(default)] pub task_ids: Vec<String>,   // kept from the migrated board
    #[serde(default)] pub note_paths: Vec<String>, // vault-relative
    #[serde(default)] pub created_at: u64,
    pub plan_path: String,
    pub prompt_path: String,
}

fn file(dir: &Path) -> PathBuf { dir.join(".chronicle/rounds.json") }

pub fn load(dir: &Path) -> Vec<Round> {
    let Ok(text) = std::fs::read_to_string(file(dir)) else { return vec![] };
    serde_json::from_str::<serde_json::Value>(&text).ok()
        .and_then(|v| v.get("rounds").cloned())
        .and_then(|r| serde_json::from_value(r).ok())
        .unwrap_or_default()
}

pub fn save(dir: &Path, rounds: &[Round]) -> Result<(), String> {
    std::fs::create_dir_all(dir.join(".chronicle")).map_err(|e| e.to_string())?;
    let body = serde_json::to_string_pretty(&serde_json::json!({ "version": 1, "rounds": rounds }))
        .map_err(|e| e.to_string())?;
    let path = file(dir);
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, body).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

fn front_of(dir: &Path, rel: &str) -> Option<parse::FrontMatter> {
    let text = std::fs::read_to_string(index::vault_dir(dir).join(rel)).ok()?;
    Some(parse::split_front_matter(&text).0)
}

/// True while the note's round is `generating` or `ready` — the editor refuses
/// to write, the agent's own edits are untouched.
pub fn is_locked(dir: &Path, rel: &str) -> bool {
    let Some(fm) = front_of(dir, rel) else { return false };
    let Some(n) = parse::round_of(&fm) else { return false };
    load(dir).iter().any(|r| r.n == n && (r.state == "generating" || r.state == "ready"))
}

pub fn statuses_for(dir: &Path, paths: &[String]) -> HashMap<String, Option<String>> {
    paths.iter()
        .map(|p| (p.clone(), front_of(dir, p).and_then(|fm| parse::status_of(&fm))))
        .collect()
}

/// Front-matter-only edit: read, change the two keys, write back atomically.
/// The body is never touched, so an open editor's text cannot be clobbered.
pub fn set_status(dir: &Path, rel: &str, status: Option<&str>, round: Option<u64>) -> Result<(), String> {
    let full = index::vault_dir(dir).join(rel);
    let text = std::fs::read_to_string(&full).map_err(|e| e.to_string())?;
    let (mut fm, body) = parse::split_front_matter(&text);
    match status { Some(s) => fm.set("status", s), None => fm.remove("status") }
    match round { Some(n) => fm.set("round", &n.to_string()), None => fm.remove("round") }
    let tmp = full.with_extension("md.tmp");
    std::fs::write(&tmp, parse::join_front_matter(&fm, &body)).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &full).map_err(|e| e.to_string())
}

pub fn queued_notes(dir: &Path) -> Vec<String> {
    let vault = index::vault_dir(dir);
    let mut out: Vec<String> = index::walk(&vault).into_iter().map(|(r, _, _)| r)
        .filter(|rel| match front_of(dir, rel) {
            Some(fm) => parse::status_of(&fm).as_deref() == Some("queued") && parse::round_of(&fm).is_none(),
            None => false,
        })
        .collect();
    out.sort();
    out
}

/// A round the agent has finished. Without this a `ready` round would keep its
/// notes locked in the editor forever — the board used to recompute openness
/// from task columns on every render instead.
pub fn settle_done(dir: &Path) {
    let mut rounds = load(dir);
    let mut moved = false;
    for r in rounds.iter_mut().filter(|r| r.state == "ready") {
        if r.note_paths.is_empty() { continue; }
        let st = statuses_for(dir, &r.note_paths);
        let all_done = r.note_paths.iter()
            .all(|p| st.get(p).and_then(|s| s.as_deref()) == Some("done"));
        if all_done { r.state = "done".into(); moved = true; }
    }
    if moved { let _ = save(dir, &rounds); }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("chronicle-rnd-{}-{}", name, std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(d.join(".chronicle/notes/Tasks")).unwrap();
        d.canonicalize().unwrap()
    }
    fn note(d: &Path, rel: &str, fm: &str, body: &str) {
        std::fs::write(super::super::index::vault_dir(d).join(rel), format!("---\n{fm}---\n\n{body}")).unwrap();
    }
    fn round(n: u64, state: &str, paths: &[&str]) -> Round {
        Round { n, state: state.into(), kind: None, task_ids: vec![],
                note_paths: paths.iter().map(|s| s.to_string()).collect(), created_at: 0,
                plan_path: format!("fixes/phase_{n}_fixes_plan.md"),
                prompt_path: format!("fixes/phase_{n}_fixes_prompt.md") }
    }

    #[test]
    fn rounds_round_trip_through_the_file() {
        let d = tmp("io");
        assert!(load(&d).is_empty(), "no file yet");
        save(&d, &[round(1, "ready", &["Tasks/A.md"])]).unwrap();
        let back = load(&d);
        assert_eq!(back.len(), 1);
        assert_eq!(back[0].n, 1);
        assert_eq!(back[0].note_paths, vec!["Tasks/A.md"]);
        assert!(d.join(".chronicle/rounds.json").exists());
    }

    #[test]
    fn a_note_is_locked_by_a_generating_or_ready_round_only() {
        let d = tmp("lock");
        note(&d, "Tasks/A.md", "status: in_progress\nround: 1\n", "a\n");
        note(&d, "Tasks/B.md", "status: queued\n", "b\n");
        save(&d, &[round(1, "generating", &["Tasks/A.md"])]).unwrap();
        assert!(is_locked(&d, "Tasks/A.md"));
        assert!(!is_locked(&d, "Tasks/B.md"), "a note with no round is never locked");
        save(&d, &[round(1, "ready", &["Tasks/A.md"])]).unwrap();
        assert!(is_locked(&d, "Tasks/A.md"));
        for state in ["done", "failed"] {
            save(&d, &[round(1, state, &["Tasks/A.md"])]).unwrap();
            assert!(!is_locked(&d, "Tasks/A.md"), "the lock lifts on {state}");
        }
    }

    #[test]
    fn set_status_edits_the_front_matter_and_leaves_the_body_alone() {
        let d = tmp("status");
        note(&d, "Tasks/A.md", "status: queued\ntags: [ui]\n", "# A\n\nbody with #ui\n");
        set_status(&d, "Tasks/A.md", Some("in_progress"), Some(2)).unwrap();
        let text = std::fs::read_to_string(super::super::index::vault_dir(&d).join("Tasks/A.md")).unwrap();
        let (fm, body) = super::super::parse::split_front_matter(&text);
        assert_eq!(fm.get("status"), Some("in_progress"));
        assert_eq!(fm.get("round"), Some("2"));
        assert_eq!(fm.get("tags"), Some("[ui]"), "unrelated keys survive");
        assert_eq!(body, "# A\n\nbody with #ui\n");
        set_status(&d, "Tasks/A.md", None, None).unwrap();
        let (fm2, _) = super::super::parse::split_front_matter(
            &std::fs::read_to_string(super::super::index::vault_dir(&d).join("Tasks/A.md")).unwrap());
        assert_eq!(fm2.get("status"), None);
        assert_eq!(fm2.get("round"), None);
    }

    #[test]
    fn queued_notes_are_the_ones_a_round_would_take() {
        let d = tmp("queued");
        note(&d, "Tasks/B.md", "status: queued\n", "b\n");
        note(&d, "Tasks/A.md", "status: queued\n", "a\n");
        note(&d, "Tasks/C.md", "status: queued\nround: 1\n", "c\n");
        note(&d, "Tasks/D.md", "status: done\n", "d\n");
        note(&d, "Tasks/E.md", "", "plain note\n");
        assert_eq!(queued_notes(&d), vec!["Tasks/A.md", "Tasks/B.md"], "path order, no rounded, no plain");
    }

    #[test]
    fn a_ready_round_settles_to_done_when_every_note_says_done() {
        let d = tmp("settle");
        note(&d, "Tasks/A.md", "status: done\nround: 1\n", "a\n");
        note(&d, "Tasks/B.md", "status: in_progress\nround: 1\n", "b\n");
        save(&d, &[round(1, "ready", &["Tasks/A.md", "Tasks/B.md"])]).unwrap();
        settle_done(&d);
        assert_eq!(load(&d)[0].state, "ready", "one note is still open");
        set_status(&d, "Tasks/B.md", Some("done"), Some(1)).unwrap();
        settle_done(&d);
        assert_eq!(load(&d)[0].state, "done");
        assert!(!is_locked(&d, "Tasks/A.md"), "and the lock is gone");
    }

    #[test]
    fn statuses_for_reads_front_matter_without_an_index() {
        let d = tmp("statuses");
        note(&d, "Tasks/A.md", "status: done\n", "a\n");
        let m = statuses_for(&d, &["Tasks/A.md".into(), "Tasks/Gone.md".into()]);
        assert_eq!(m.get("Tasks/A.md"), Some(&Some("done".to_string())));
        assert_eq!(m.get("Tasks/Gone.md"), Some(&None));
    }
}
