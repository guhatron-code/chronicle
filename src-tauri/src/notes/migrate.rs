//! One-way, one-time: the kanban board becomes notes. Runs on the first
//! heartbeat of a project that still has tasks in `.chronicle/kanban.json` and
//! no `.chronicle/notes/` yet.
//!
//! Every note and the new `rounds.json` are written into a staging directory
//! (`.chronicle/notes.migrating/`) first. Only once every write has landed does
//! `run` write an empty `.complete` marker inside staging — that marker is the
//! single bit of durable state that says "safe to commit" — and then perform
//! the commit renames in order: (a) the staged `rounds.json` replaces the real
//! one, (b) `kanban.json` retires to `kanban.json.migrated`, (c) staging
//! becomes `.chronicle/notes`, (d) the marker (which rode along with (c)) is
//! deleted. A crash at any point before the marker is written leaves
//! `kanban.json` untouched and the (discardable) staging dir the only trace —
//! the next run starts over. A crash at any point AFTER the marker is written
//! resumes: whichever of (a)-(d) is still outstanding runs, nothing is
//! re-staged. A process-wide guard keyed by the project dir means only one
//! `run` is ever mid-flight for a given project at a time; a concurrent caller
//! gets `Ok(None)` — nothing to report — instead of racing the first one.

use super::{index, parse};
use serde_json::{json, Value};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

pub struct MigratedNote { pub path: String, pub front: parse::FrontMatter, pub body: String }

const MARKER: &str = ".complete";
const ROUNDS_STAGED: &str = ".rounds.json";

pub fn map_status(column: &str) -> (&'static str, Option<&'static str>) {
    match column {
        "in_progress" => ("in_progress", None),
        "completed" => ("done", None),
        "blocked" => ("queued", Some("blocked")),
        _ => ("queued", None), // later, queued, and anything unrecognised
    }
}

pub fn note_file_name(id: &str, title: &str) -> String {
    let name = parse::sanitize_title(title);
    if id.is_empty() { format!("{name}.md") } else { format!("{id} {name}.md") }
}

fn iso_from_ms(ms: u64) -> String {
    let secs = ms / 1000;
    let (h, m, s) = ((secs % 86_400) / 3600, (secs % 3600) / 60, secs % 60);
    let (y, mo, d) = super::civil_from_days((secs / 86_400) as i64);
    format!("{y:04}-{mo:02}-{d:02}T{h:02}:{m:02}:{s:02}Z")
}

pub fn map_task(task: &Value) -> MigratedNote {
    let get = |k: &str| task.get(k).and_then(|v| v.as_str()).unwrap_or("");
    let id = get("id");
    let title = get("title");
    let archived = task.get("archived").and_then(|a| a.as_bool()).unwrap_or(false);
    let folder = if archived { "Tasks/Archive" } else { "Tasks" };
    let (status, extra_tag) = map_status(get("column"));

    let mut front = parse::FrontMatter::default();
    if !id.is_empty() { front.set("id", id); }
    front.set("status", status);
    if let Some(t) = extra_tag { front.set_list("tags", &[t.to_string()]); }
    if let Some(r) = task.get("round").and_then(|v| v.as_u64()) { front.set("round", &r.to_string()); }
    if let Some(c) = task.get("created_at").and_then(|v| v.as_u64()) { front.set("created", &iso_from_ms(c)); }
    if let Some(u) = task.get("updated_at").and_then(|v| v.as_u64()) { front.set("updated", &iso_from_ms(u)); }

    let mut body = format!("# {}\n", if title.is_empty() { "Untitled" } else { title });
    let content = get("content").trim();
    if !content.is_empty() { body.push_str(&format!("\n{content}\n")); }
    let links: Vec<&str> = task.get("links").and_then(|v| v.as_array())
        .map(|a| a.iter().filter_map(|x| x.as_str()).collect()).unwrap_or_default();
    if !links.is_empty() {
        body.push_str("\n## Links\n\n");
        for l in links { body.push_str(&format!("- {l}\n")); }
    }
    let images: Vec<&str> = task.get("images").and_then(|v| v.as_array())
        .map(|a| a.iter().filter_map(|x| x.as_str()).collect()).unwrap_or_default();
    if !images.is_empty() {
        body.push('\n');
        for i in images {
            // task images were stored project-relative (.chronicle/attachments/x.png);
            // notes reference them from the vault root instead
            let file = i.rsplit('/').next().unwrap_or(i);
            body.push_str(&format!("![](../attachments/{file})\n"));
        }
    }
    MigratedNote { path: format!("{folder}/{}", note_file_name(id, title)), front, body }
}

fn board_path(dir: &Path) -> PathBuf { dir.join(".chronicle/kanban.json") }
fn migrated_board_path(dir: &Path) -> PathBuf { dir.join(".chronicle/kanban.json.migrated") }
fn rounds_path(dir: &Path) -> PathBuf { dir.join(".chronicle/rounds.json") }
fn staging_dir(dir: &Path) -> PathBuf { dir.join(".chronicle/notes.migrating") }

/// True when there's work to do: an unmigrated board, OR a commit that started
/// (the marker exists — in staging if step (c) hasn't run yet, in the vault if
/// it has) and needs to finish. The marker check comes first and ignores the
/// vault's contents on purpose: after (c) the vault legitimately holds the
/// migrated notes already, but (d) still hasn't run.
pub fn needs_migration(dir: &Path) -> bool {
    let vault = index::vault_dir(dir);
    if staging_dir(dir).join(MARKER).exists() || vault.join(MARKER).exists() { return true; }
    // a vault that exists but holds no notes is not a migrated vault — an
    // ordinary jail check or a stray mkdir must never strand the board
    if !index::walk(&vault).is_empty() { return false; }
    let Ok(text) = std::fs::read_to_string(board_path(dir)) else { return false };
    let Ok(v) = serde_json::from_str::<Value>(&text) else { return false };
    v.get("tasks").and_then(|t| t.as_array()).map(|a| !a.is_empty()).unwrap_or(false)
}

/// Run whichever commit steps are still outstanding, in order, each skipped
/// when its postcondition already holds — so this is safe to call from a fresh
/// `run` (nothing done yet) or mid-recovery (some steps already done). Every
/// step here is a single `rename`, atomic on its own; the only thing that can
/// leave a step "half done" is the process dying between two of them, which is
/// exactly the case the next call resumes from.
fn commit(dir: &Path) -> Result<(), String> {
    let staging = staging_dir(dir);
    let vault = index::vault_dir(dir);
    let board = board_path(dir);

    // (a) the staged rounds.json replaces the real one — derived data, so
    // overwriting on a resume is correct, not just harmless
    let staged_rounds = staging.join(ROUNDS_STAGED);
    if staged_rounds.exists() {
        std::fs::rename(&staged_rounds, rounds_path(dir)).map_err(|e| e.to_string())?;
    }
    // (b) the board is retired
    if board.exists() {
        std::fs::rename(&board, migrated_board_path(dir)).map_err(|e| e.to_string())?;
    }
    // (c) staging becomes the vault — carrying the marker along with it
    if staging.exists() {
        if vault.exists() {
            if !index::walk(&vault).is_empty() {
                // (a) and (b) already happened and cannot be undone; this is
                // the one step that can legitimately need a retry rather than
                // completing here (something else populated the vault)
                return Err("the vault already holds notes; the migration can't land yet".into());
            }
            std::fs::remove_dir_all(&vault).map_err(|e| e.to_string())?;
        }
        std::fs::rename(&staging, &vault).map_err(|e| e.to_string())?;
    }
    // (d) the marker's job is done — it now lives wherever (c) left it
    let _ = std::fs::remove_file(vault.join(MARKER));
    let _ = std::fs::remove_file(staging.join(MARKER));
    Ok(())
}

/// The process-wide set of project dirs with a `run` in flight right now.
/// Keyed by the canonical dir so two different-looking paths to the same
/// project can't both slip through.
fn migrating() -> &'static Mutex<HashSet<String>> {
    static MIGRATING: std::sync::LazyLock<Mutex<HashSet<String>>> =
        std::sync::LazyLock::new(|| Mutex::new(HashSet::new()));
    &MIGRATING
}

fn migrating_key(dir: &Path) -> String {
    dir.canonicalize().map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|_| dir.to_string_lossy().into_owned())
}

/// Releases its key from `MIGRATING` in `Drop` — including on an unwind — so a
/// panic anywhere inside `run_locked` can never leak the key and permanently
/// disable migration for that project until the process restarts. Sequential
/// "call run_locked, then remove the key" code only releases on the ok path;
/// this releases on every exit path (`Ok`, `Err`, or a panic) because `Drop`
/// runs during unwinding too.
struct MigratingGuard(String);
impl Drop for MigratingGuard {
    fn drop(&mut self) {
        migrating().lock().unwrap_or_else(|e| e.into_inner()).remove(&self.0);
    }
}

/// `Ok(None)` means a concurrent call is already migrating this project —
/// nothing was done, nothing to report, and no error: the caller (a heartbeat)
/// just tries again next time. Everything else this module does assumes only
/// one `run` is ever mid-flight per project; this is the one guard that makes
/// that true, so `run_locked` never has to worry about it.
pub fn run(dir: &Path) -> Result<Option<usize>, String> {
    let key = migrating_key(dir);
    {
        let mut set = migrating().lock().unwrap_or_else(|e| e.into_inner());
        if !set.insert(key.clone()) { return Ok(None); }
    }
    let _guard = MigratingGuard(key);
    run_locked(dir).map(Some)
}

fn run_locked(dir: &Path) -> Result<usize, String> {
    let staging = staging_dir(dir);
    let vault = index::vault_dir(dir);

    // a marker anywhere in the staging→vault lineage means every write from a
    // previous attempt already landed — resume the renames, never re-stage
    if staging.join(MARKER).exists() || vault.join(MARKER).exists() {
        commit(dir)?;
        return Ok(index::walk(&vault).len());
    }

    if !needs_migration(dir) { return Err("nothing to migrate".into()); }
    let text = std::fs::read_to_string(board_path(dir)).map_err(|e| e.to_string())?;
    let store: Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    let tasks = store.get("tasks").and_then(|t| t.as_array()).cloned().unwrap_or_default();
    let rounds_src = store.get("rounds").and_then(|r| r.as_array()).cloned().unwrap_or_default();
    let mapped: Vec<MigratedNote> = tasks.iter().map(map_task).collect();

    // a staging dir with no marker is a leftover from a run that crashed before
    // every write landed — discard it and stage fresh. kanban.json is
    // guaranteed intact: nothing irreversible happens before the marker exists
    let _ = std::fs::remove_dir_all(&staging);

    // ids → new paths, so a round keeps pointing at its work
    let by_id: std::collections::HashMap<&str, &str> = tasks.iter().zip(&mapped)
        .filter_map(|(t, n)| t.get("id").and_then(|v| v.as_str()).map(|i| (i, n.path.as_str())))
        .collect();
    let rounds: Vec<Value> = rounds_src.into_iter().map(|mut r| {
        let paths: Vec<String> = r.get("task_ids").and_then(|v| v.as_array())
            .map(|a| a.iter().filter_map(|x| x.as_str()).filter_map(|i| by_id.get(i).map(|p| p.to_string())).collect())
            .unwrap_or_default();
        if let Some(o) = r.as_object_mut() { o.insert("note_paths".into(), json!(paths)); }
        r
    }).collect();

    let staged = (|| -> Result<(), String> {
        std::fs::create_dir_all(&staging).map_err(|e| e.to_string())?;
        for n in &mapped {
            let full = staging.join(&n.path);
            std::fs::create_dir_all(full.parent().ok_or("bad note path")?).map_err(|e| e.to_string())?;
            std::fs::write(&full, parse::join_front_matter(&n.front, &n.body)).map_err(|e| e.to_string())?;
        }
        std::fs::write(staging.join(ROUNDS_STAGED),
            serde_json::to_string_pretty(&json!({ "version": 1, "rounds": rounds })).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
        // written last: everything above landed, so the marker's mere
        // existence means "safe to commit, however far that gets"
        std::fs::write(staging.join(MARKER), b"").map_err(|e| e.to_string())
    })();
    if let Err(e) = staged { let _ = std::fs::remove_dir_all(&staging); return Err(e); }

    commit(dir)?;
    Ok(mapped.len())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("chronicle-mig-{}-{}", name, std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(d.join(".chronicle")).unwrap();
        d.canonicalize().unwrap()
    }

    #[test]
    fn the_column_map_is_exactly_the_spec_table() {
        assert_eq!(map_status("later"), ("queued", None));
        assert_eq!(map_status("queued"), ("queued", None));
        assert_eq!(map_status("blocked"), ("queued", Some("blocked")));
        assert_eq!(map_status("in_progress"), ("in_progress", None));
        assert_eq!(map_status("completed"), ("done", None));
        assert_eq!(map_status("nonsense"), ("queued", None), "an unknown column is a plain queued task");
    }

    #[test]
    fn file_names_are_the_id_plus_a_sanitised_title() {
        assert_eq!(note_file_name("T-012", "Login card overlaps: 13\" screens"),
                   "T-012 Login card overlaps- 13- screens.md");
        assert_eq!(note_file_name("T-001", ""), "T-001 Untitled.md");
        let long = note_file_name("T-002", &"w".repeat(200));
        assert!(long.len() <= 80 + "T-002 ".len() + ".md".len(), "{long}");
        assert_eq!(note_file_name("", "Standalone note"), "Standalone note.md",
                   "an empty id must not leave a leading space in the file name");
    }

    #[test]
    fn a_task_becomes_a_note_with_front_matter_links_and_images() {
        let t = json!({
            "id": "T-012", "title": "Login overlaps header",
            "content": "On a 13\" screen the card sits under the tabs.",
            "column": "blocked", "round": 4,
            "images": [".chronicle/attachments/T-012-shot.png"],
            "links": ["https://example.com/comp"],
            "created_at": 1_757_000_000_000u64, "updated_at": 1_757_100_000_000u64
        });
        let n = map_task(&t);
        assert_eq!(n.path, "Tasks/T-012 Login overlaps header.md");
        assert_eq!(n.front.get("id"), Some("T-012"));
        assert_eq!(n.front.get("status"), Some("queued"));
        assert_eq!(n.front.get("round"), Some("4"));
        assert_eq!(n.front.list("tags"), vec!["blocked"]);
        // NOTE: the brief's literal (14:13:20 / 18:00:00) is off by exactly 4800s from
        // the true UTC conversion of these epoch-ms values — verified independently
        // against a reference UTC conversion. civil_from_days is inherited unchanged
        // from Task 3 (mod.rs), so this corrects the test literal, not the algorithm.
        assert_eq!(n.front.get("created"), Some("2025-09-04T15:33:20Z"));
        assert_eq!(n.front.get("updated"), Some("2025-09-05T19:20:00Z"));
        assert_eq!(n.body,
            "# Login overlaps header\n\nOn a 13\" screen the card sits under the tabs.\n\n## Links\n\n- https://example.com/comp\n\n![](../attachments/T-012-shot.png)\n");
    }

    #[test]
    fn an_archived_task_lands_in_the_archive_folder_and_a_plain_one_has_no_tags() {
        let n = map_task(&json!({ "id": "T-003", "title": "Old", "column": "completed", "archived": true }));
        assert_eq!(n.path, "Tasks/Archive/T-003 Old.md");
        assert_eq!(n.front.get("status"), Some("done"));
        assert_eq!(n.front.get("tags"), None, "the column map is the only source of tags");
        assert_eq!(n.front.get("round"), None);
        assert_eq!(n.body, "# Old\n");
    }

    #[test]
    fn migration_runs_once_writes_rounds_and_renames_the_board() {
        let d = tmp("run");
        std::fs::write(d.join(".chronicle/kanban.json"), json!({
            "version": 1, "next_id": 3,
            "tasks": [
                { "id": "T-001", "title": "One", "content": "a", "column": "queued" },
                { "id": "T-002", "title": "Two", "column": "completed", "round": 1 }
            ],
            "rounds": [ { "n": 1, "state": "ready", "kind": "bug fixes", "task_ids": ["T-002"],
                          "plan_path": "fixes/phase_1_fixes_plan.md", "prompt_path": "fixes/phase_1_fixes_prompt.md" } ]
        }).to_string()).unwrap();

        assert!(needs_migration(&d));
        assert_eq!(run(&d).unwrap(), Some(2));
        assert!(d.join(".chronicle/notes/Tasks/T-001 One.md").exists());
        assert!(d.join(".chronicle/notes/Tasks/T-002 Two.md").exists());
        assert!(d.join(".chronicle/kanban.json.migrated").exists());
        assert!(!d.join(".chronicle/kanban.json").exists());

        let rounds: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(d.join(".chronicle/rounds.json")).unwrap()).unwrap();
        assert_eq!(rounds["rounds"][0]["n"], 1);
        assert_eq!(rounds["rounds"][0]["state"], "ready");
        assert_eq!(rounds["rounds"][0]["task_ids"][0], "T-002", "the shape is unchanged");
        assert_eq!(rounds["rounds"][0]["note_paths"][0], "Tasks/T-002 Two.md", "plus the new pointer");

        assert!(!needs_migration(&d), "idempotent: the vault holds notes now");
        assert!(run(&d).is_err(), "and a second run refuses rather than duplicating");
    }

    #[test]
    fn a_partial_write_failure_leaves_no_vault_and_the_board_intact() {
        let d = tmp("partial-failure");
        std::fs::write(d.join(".chronicle/kanban.json"), json!({
            "version": 1, "next_id": 2,
            "tasks": [ { "id": "T-001", "title": "One", "column": "queued" } ], "rounds": []
        }).to_string()).unwrap();
        // block the staging directory itself so no note can ever be written under it
        std::fs::write(d.join(".chronicle/notes.migrating"), b"not a directory").unwrap();

        assert!(run(&d).is_err(), "staging cannot be created, so the whole migration must fail");
        assert!(!d.join(".chronicle/notes").exists(), "no partial vault is left behind");
        assert!(d.join(".chronicle/kanban.json").exists(), "the board is untouched");
        assert!(!d.join(".chronicle/kanban.json.migrated").exists());

        // once the underlying problem is gone, the next heartbeat's retry can succeed
        std::fs::remove_file(d.join(".chronicle/notes.migrating")).unwrap();
        assert!(needs_migration(&d), "the board still has work to do");
        assert_eq!(run(&d).unwrap(), Some(1));
    }

    #[test]
    fn a_staging_dir_without_the_marker_is_discarded_and_the_board_migrates_fresh() {
        let d = tmp("stale-staging");
        std::fs::write(d.join(".chronicle/kanban.json"), json!({
            "version": 1, "next_id": 2,
            "tasks": [ { "id": "T-001", "title": "One", "column": "queued" } ], "rounds": []
        }).to_string()).unwrap();
        // simulate a crash mid-stage, before the marker was ever written: leftover
        // staging content from an earlier attempt, no `.complete`
        std::fs::create_dir_all(d.join(".chronicle/notes.migrating/Tasks")).unwrap();
        std::fs::write(d.join(".chronicle/notes.migrating/Tasks/Stale.md"), "leftover").unwrap();

        assert_eq!(run(&d).unwrap(), Some(1));
        assert!(!d.join(".chronicle/notes/Tasks/Stale.md").exists(),
                 "stale staging content without a marker must never leak into the vault");
        assert!(d.join(".chronicle/notes/Tasks/T-001 One.md").exists());
        assert!(!d.join(".chronicle/notes.migrating").exists(), "staging is gone once committed");
    }

    #[test]
    fn an_empty_vault_folder_does_not_count_as_migrated() {
        let d = tmp("emptyvault");
        std::fs::write(d.join(".chronicle/kanban.json"), json!({
            "version": 1, "next_id": 2,
            "tasks": [ { "id": "T-001", "title": "One", "column": "queued" } ], "rounds": []
        }).to_string()).unwrap();
        // a read-side jail check, or any stray mkdir, must not strand the board
        std::fs::create_dir_all(d.join(".chronicle/notes")).unwrap();
        assert!(needs_migration(&d));
        assert_eq!(run(&d).unwrap(), Some(1));
    }

    #[test]
    fn an_empty_or_absent_board_is_not_migrated() {
        let d = tmp("empty");
        assert!(!needs_migration(&d), "no kanban.json at all");
        std::fs::write(d.join(".chronicle/kanban.json"),
                       json!({ "version": 1, "next_id": 1, "tasks": [], "rounds": [] }).to_string()).unwrap();
        assert!(!needs_migration(&d), "a board with no tasks is nothing to move");
    }

    /// Hand-builds the "everything already staged, marker written" state a real
    /// `run` produces right before it starts renaming — the shared starting
    /// point for the crash-recovery tests below.
    fn fully_staged(d: &Path) {
        std::fs::write(d.join(".chronicle/kanban.json"), json!({
            "version": 1, "next_id": 2,
            "tasks": [ { "id": "T-001", "title": "One", "column": "queued" } ], "rounds": []
        }).to_string()).unwrap();
        let staging = staging_dir(d);
        std::fs::create_dir_all(staging.join("Tasks")).unwrap();
        std::fs::write(staging.join("Tasks/T-001 One.md"), "---\nid: T-001\nstatus: queued\n---\n\n# One\n").unwrap();
        std::fs::write(staging.join(ROUNDS_STAGED), json!({ "version": 1, "rounds": [] }).to_string()).unwrap();
        std::fs::write(staging.join(MARKER), b"").unwrap();
    }

    #[test]
    fn a_crash_after_step_a_resumes_from_the_board_rename() {
        let d = tmp("resume-a");
        fully_staged(&d);
        // step (a) already happened: rounds.json landed, (b)/(c)/(d) still pending
        std::fs::rename(staging_dir(&d).join(ROUNDS_STAGED), rounds_path(&d)).unwrap();

        assert!(needs_migration(&d));
        assert_eq!(run(&d).unwrap(), Some(1));
        assert!(d.join(".chronicle/notes/Tasks/T-001 One.md").exists());
        assert!(d.join(".chronicle/kanban.json.migrated").exists());
        assert!(!d.join(".chronicle/kanban.json").exists());
        assert!(rounds_path(&d).exists());
        assert!(!staging_dir(&d).exists());
        assert!(!needs_migration(&d), "the resumed run left a clean, migrated project");
    }

    #[test]
    fn a_crash_after_step_b_resumes_from_the_vault_rename() {
        let d = tmp("resume-b");
        fully_staged(&d);
        std::fs::rename(staging_dir(&d).join(ROUNDS_STAGED), rounds_path(&d)).unwrap();
        std::fs::rename(board_path(&d), migrated_board_path(&d)).unwrap();

        assert!(needs_migration(&d));
        assert_eq!(run(&d).unwrap(), Some(1));
        assert!(d.join(".chronicle/notes/Tasks/T-001 One.md").exists());
        assert!(migrated_board_path(&d).exists());
        assert!(!staging_dir(&d).exists());
        assert!(!needs_migration(&d));
    }

    #[test]
    fn a_crash_after_step_c_resumes_by_only_dropping_the_marker() {
        let d = tmp("resume-c");
        fully_staged(&d);
        std::fs::rename(staging_dir(&d).join(ROUNDS_STAGED), rounds_path(&d)).unwrap();
        std::fs::rename(board_path(&d), migrated_board_path(&d)).unwrap();
        std::fs::rename(staging_dir(&d), index::vault_dir(&d)).unwrap(); // the marker rides along

        assert!(index::vault_dir(&d).join(MARKER).exists(), "setup: the marker moved with the vault");
        assert!(needs_migration(&d), "only the marker cleanup is left, but that's still work to do");
        assert_eq!(run(&d).unwrap(), Some(1));
        assert!(d.join(".chronicle/notes/Tasks/T-001 One.md").exists());
        assert!(!index::vault_dir(&d).join(MARKER).exists());
        assert!(!needs_migration(&d));
    }

    #[test]
    fn concurrent_runs_never_race_exactly_one_migration_happens() {
        let d = tmp("concurrent");
        std::fs::write(d.join(".chronicle/kanban.json"), json!({
            "version": 1, "next_id": 2,
            "tasks": [ { "id": "T-001", "title": "One", "column": "queued" } ], "rounds": []
        }).to_string()).unwrap();

        let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
        let handles: Vec<_> = (0..2).map(|_| {
            let d = d.clone();
            let barrier = barrier.clone();
            std::thread::spawn(move || { barrier.wait(); run(&d) })
        }).collect();
        let results: Vec<Result<Option<usize>, String>> = handles.into_iter().map(|h| h.join().unwrap()).collect();

        let migrated: Vec<usize> = results.iter().filter_map(|r| r.as_ref().ok().and_then(|o| *o)).collect();
        assert_eq!(migrated, vec![1], "exactly one call performs the migration: {results:?}");
        assert!(d.join(".chronicle/notes/Tasks/T-001 One.md").exists());
        assert!(!needs_migration(&d), "a single clean vault, no duplicate or half-written notes");
    }

    #[test]
    fn a_panic_after_the_guard_is_created_still_releases_the_key_and_a_later_run_proceeds() {
        let d = tmp("panic-guard");
        std::fs::write(d.join(".chronicle/kanban.json"), json!({
            "version": 1, "next_id": 2,
            "tasks": [ { "id": "T-001", "title": "One", "column": "queued" } ], "rounds": []
        }).to_string()).unwrap();

        let key = migrating_key(&d);
        // mirrors run()'s own sequence — insert the key, then create the guard —
        // but panics right after instead of calling run_locked
        let outcome = std::panic::catch_unwind(|| {
            {
                let mut set = migrating().lock().unwrap_or_else(|e| e.into_inner());
                assert!(set.insert(key.clone()));
            }
            let _guard = MigratingGuard(key.clone());
            panic!("simulated failure mid-migration");
        });
        assert!(outcome.is_err(), "the panic must propagate out of catch_unwind");
        assert!(!migrating().lock().unwrap_or_else(|e| e.into_inner()).contains(&key),
                 "the guard's Drop releases the key even when the body panics, not just on a normal return");

        // a leaked key would make every future run() for this project return
        // Ok(None) forever — confirm a real run isn't blocked by the panic above
        assert_eq!(run(&d).unwrap(), Some(1));
    }
}
