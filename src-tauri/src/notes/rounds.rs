//! `.chronicle/rounds.json` — what `kanban.json`'s `rounds[]` became, plus the
//! two things the board used to compute in the frontend: which notes a live
//! round has locked, and when a round is finished.
//!
//! Two rules run through the whole file. **A file we cannot parse is never
//! written over**: `load` tells "absent" (fine, no rounds yet) apart from
//! "unreadable" (an error), writers refuse, and readers fall back to "no
//! rounds" without saving. And **a lock can always be lifted**: every default
//! and every fallback here is chosen so that a damaged record leaves notes
//! editable rather than frozen.

use super::{index, parse};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

/// A round whose `state` went missing reads as `done`: finished rounds lock
/// nothing, so a truncated record can never freeze a note's editor.
fn state_done() -> String { "done".into() }

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Round {
    pub n: u64,
    #[serde(default = "state_done")] pub state: String, // generating | ready | failed | done
    #[serde(default)] pub kind: Option<String>,    // "bug fixes" | "feature additions"
    #[serde(default)] pub task_ids: Vec<String>,   // kept from the migrated board
    #[serde(default)] pub note_paths: Vec<String>, // vault-relative
    #[serde(default)] pub created_at: u64,
    #[serde(default)] pub plan_path: String,
    #[serde(default)] pub prompt_path: String,
}

/// What the index carries to the frontend: enough to draw the round card and
/// to know which notes are locked, without the pane reading the file itself.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct RoundSummary {
    pub n: u64,
    pub state: String,
    pub kind: Option<String>,
    pub note_paths: Vec<String>,
}

/// The read-only view for the index. A file we cannot parse reads as no rounds
/// — never an error: the index must always be able to answer, and "no rounds"
/// is the fallback that leaves every note editable (the rule at the top of
/// this file). `load` stays the one that tells corrupt from absent.
pub fn summaries(dir: &Path) -> Vec<RoundSummary> {
    load_or_none(dir).into_iter()
        .map(|r| RoundSummary { n: r.n, state: r.state, kind: r.kind, note_paths: r.note_paths })
        .collect()
}

fn file(dir: &Path) -> PathBuf { dir.join(".chronicle/rounds.json") }

/// No file (or an empty one) means no rounds yet. Anything else that will not
/// parse is an error, never an empty list: answering "no rounds" for a corrupt
/// file would restart the numbering at 1 and let the next `save` overwrite the
/// user's whole round history.
pub fn load(dir: &Path) -> Result<Vec<Round>, String> {
    let text = match std::fs::read_to_string(file(dir)) {
        Ok(t) => t,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(vec![]),
        Err(e) => return Err(format!("couldn't read .chronicle/rounds.json: {e}")),
    };
    if text.trim().is_empty() { return Ok(vec![]); }
    let bad = |what: String| format!(".chronicle/rounds.json {what} — fix or move that file, then try again");
    let v: serde_json::Value = serde_json::from_str(&text)
        .map_err(|e| bad(format!("isn't valid JSON ({e})")))?;
    let Some(r) = v.get("rounds") else { return Err(bad("has no rounds list".into())) };
    serde_json::from_value(r.clone()).map_err(|e| bad(format!("has a round that can't be read ({e})")))
}

/// The read-only paths: a file we cannot parse is reported as no rounds and is
/// left exactly as it is. Never call this before a `save`.
fn load_or_none(dir: &Path) -> Vec<Round> { load(dir).unwrap_or_default() }

pub fn save(dir: &Path, rounds: &[Round]) -> Result<(), String> {
    std::fs::create_dir_all(dir.join(".chronicle")).map_err(|e| e.to_string())?;
    let body = serde_json::to_string_pretty(&serde_json::json!({ "version": 1, "rounds": rounds }))
        .map_err(|e| e.to_string())?;
    let path = file(dir);
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, body).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

/// Every note path from rounds.json goes through the same canonicalise-and-prefix
/// jail the commands use: the file is user-editable, so a hand-written `../..`
/// must not read or write outside the vault.
fn note_path(dir: &Path, rel: &str) -> Option<PathBuf> { super::note_file_in(dir, rel).ok() }

fn front_of(dir: &Path, rel: &str) -> Option<parse::FrontMatter> {
    let text = std::fs::read_to_string(note_path(dir, rel)?).ok()?;
    Some(parse::split_front_matter(&text).0)
}

/// A round that still owns its notes: the editor refuses to write, move or
/// delete them, and the agent's own edits are untouched.
fn live(r: &Round) -> bool { r.state == "generating" || r.state == "ready" }

/// True while the note's round is `generating` or `ready`. Two ways in, because
/// there is a window between them: `fixes_generate` saves the round record
/// FIRST and only then stamps `round:` into each note's front matter, so during
/// that window the record is the only place the ownership is written down.
/// The record's own list is therefore checked first, and the front matter
/// second (a note the round took whose stamp outlives a rewritten record).
/// An unreadable rounds.json locks nothing: the alternative would strand every
/// note that ever carried a `round:` key.
pub fn is_locked(dir: &Path, rel: &str) -> bool {
    let rounds = load_or_none(dir);
    if rounds.iter().any(|r| live(r) && r.note_paths.iter().any(|p| p == rel)) { return true; }
    let Some(fm) = front_of(dir, rel) else { return false };
    let Some(n) = parse::round_of(&fm) else { return false };
    rounds.iter().any(|r| r.n == n && live(r))
}

pub fn statuses_for(dir: &Path, paths: &[String]) -> HashMap<String, Option<String>> {
    paths.iter()
        .map(|p| (p.clone(), front_of(dir, p).and_then(|fm| parse::status_of(&fm))))
        .collect()
}

/// Front-matter-only edit: read, change the two keys, write back atomically.
/// The body is never touched, so an open editor's text cannot be clobbered.
pub fn set_status(dir: &Path, rel: &str, status: Option<&str>, round: Option<u64>) -> Result<(), String> {
    let full = super::note_file_in(dir, rel)?;
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
///
/// A note that is no longer there counts as settled. `notes_move`/`notes_delete`
/// refuse while a round is live, but a note removed outside the app (git, Finder,
/// a stale path from the migration) must not be able to wedge its siblings shut.
/// A round with no notes at all settles for the same reason.
pub fn settle_done(dir: &Path) {
    // never write over a rounds.json we could not read
    let Ok(mut rounds) = load(dir) else { return };
    let mut moved = false;
    for r in rounds.iter_mut().filter(|r| r.state == "ready") {
        let st = statuses_for(dir, &r.note_paths);
        let all_done = r.note_paths.iter().all(|p| {
            match st.get(p).and_then(|s| s.as_deref()) {
                Some("done") => true,
                _ => !note_path(dir, p).map(|f| f.exists()).unwrap_or(false),
            }
        });
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
        assert!(load(&d).unwrap().is_empty(), "no file yet");
        save(&d, &[round(1, "ready", &["Tasks/A.md"])]).unwrap();
        let back = load(&d).unwrap();
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
    fn the_round_record_locks_before_the_front_matter_is_stamped() {
        // fixes_generate saves the round, THEN writes `round: n` into each note.
        // A save in that window used to slip through and clobber the agent's input.
        let d = tmp("window");
        note(&d, "Tasks/A.md", "status: queued\n", "a\n");
        save(&d, &[round(1, "generating", &["Tasks/A.md"])]).unwrap();
        assert!(is_locked(&d, "Tasks/A.md"), "the record alone is enough");
        save(&d, &[round(1, "ready", &["Tasks/A.md"])]).unwrap();
        assert!(is_locked(&d, "Tasks/A.md"));
        // and a listed note that was never written still answers, rather than panicking
        save(&d, &[round(1, "ready", &["Tasks/Gone.md"])]).unwrap();
        assert!(is_locked(&d, "Tasks/Gone.md"));
        assert!(!is_locked(&d, "Tasks/A.md"), "a note no round lists and no round stamped is free");
        for state in ["done", "failed"] {
            save(&d, &[round(1, state, &["Tasks/A.md"])]).unwrap();
            assert!(!is_locked(&d, "Tasks/A.md"), "and the record's lock lifts on {state} too");
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
        assert_eq!(load(&d).unwrap()[0].state, "ready", "one note is still open");
        set_status(&d, "Tasks/B.md", Some("done"), Some(1)).unwrap();
        settle_done(&d);
        assert_eq!(load(&d).unwrap()[0].state, "done");
        assert!(!is_locked(&d, "Tasks/A.md"), "and the lock is gone");
    }

    #[test]
    fn a_corrupt_rounds_file_is_an_error_and_is_never_written_over() {
        let d = tmp("corrupt");
        note(&d, "Tasks/A.md", "status: in_progress\nround: 1\n", "a\n");
        let f = d.join(".chronicle/rounds.json");
        let garbage = b"{ not json at all\n";
        std::fs::write(&f, garbage).unwrap();
        assert!(load(&d).is_err(), "unparseable is an error, never an empty list");
        // every writer goes through that error: `fixes_generate` and `round_execute`
        // return it with `?` before they save, `settle_done` bails out here.
        settle_done(&d);
        assert!(!is_locked(&d, "Tasks/A.md"), "a store we cannot read locks nothing");
        assert_eq!(std::fs::read(&f).unwrap(), garbage, "the file is byte-identical afterwards");
        // absent or empty is simply "no rounds yet"
        std::fs::write(&f, "  \n").unwrap();
        assert!(load(&d).unwrap().is_empty());
        std::fs::remove_file(&f).unwrap();
        assert!(load(&d).unwrap().is_empty());
    }

    #[test]
    fn a_thin_round_record_still_loads_and_holds_no_lock() {
        let d = tmp("defaults");
        note(&d, "Tasks/A.md", "status: in_progress\nround: 7\n", "a\n");
        std::fs::write(d.join(".chronicle/rounds.json"),
            r#"{"version":1,"rounds":[{"n":7,"note_paths":["Tasks/A.md"]}]}"#).unwrap();
        let r = load(&d).unwrap();
        assert_eq!(r.len(), 1, "a missing key drops neither the round nor the ones beside it");
        assert_eq!(r[0].state, "done", "and the default state is one that cannot re-lock a note");
        assert!(!is_locked(&d, "Tasks/A.md"));
    }

    #[test]
    fn a_round_settles_when_a_note_is_gone_and_when_it_has_none() {
        let d = tmp("strand");
        note(&d, "Tasks/A.md", "status: done\nround: 1\n", "a\n");
        note(&d, "Tasks/B.md", "status: in_progress\nround: 1\n", "b\n");
        save(&d, &[round(1, "ready", &["Tasks/A.md", "Tasks/B.md"])]).unwrap();
        std::fs::remove_file(index::vault_dir(&d).join("Tasks/B.md")).unwrap();
        settle_done(&d);
        assert_eq!(load(&d).unwrap()[0].state, "done", "a note that is gone cannot wedge its siblings shut");
        assert!(!is_locked(&d, "Tasks/A.md"));

        save(&d, &[round(2, "ready", &[])]).unwrap();
        settle_done(&d);
        assert_eq!(load(&d).unwrap()[0].state, "done", "a round with no notes settles at once");
    }

    #[test]
    fn note_paths_out_of_rounds_json_stay_inside_the_vault() {
        let d = tmp("jail");
        let outside = "---\nstatus: queued\n---\n\nsecret\n";
        std::fs::write(d.join("outside.md"), outside).unwrap();
        assert!(set_status(&d, "../../outside.md", Some("done"), None).is_err());
        assert!(set_status(&d, "Tasks/../../../outside.md", Some("done"), None).is_err());
        assert!(set_status(&d, "Tasks/A", Some("done"), None).is_err(), "and it is still .md only");
        assert_eq!(statuses_for(&d, &["../../outside.md".into()]).get("../../outside.md"),
                   Some(&None), "a path that escapes reads as nothing");
        assert_eq!(std::fs::read_to_string(d.join("outside.md")).unwrap(), outside, "untouched");
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
