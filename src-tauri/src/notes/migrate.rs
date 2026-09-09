//! One-way, one-time: the kanban board becomes notes. Runs on the first
//! heartbeat of a project that still has tasks in `.chronicle/kanban.json` and
//! no `.chronicle/notes/` yet. Nothing is renamed unless every note landed, so a
//! failed migration leaves the board working and the next heartbeat retries.

use super::{index, parse};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

pub struct MigratedNote { pub path: String, pub front: parse::FrontMatter, pub body: String }

pub fn map_status(column: &str) -> (&'static str, Option<&'static str>) {
    match column {
        "in_progress" => ("in_progress", None),
        "completed" => ("done", None),
        "blocked" => ("queued", Some("blocked")),
        _ => ("queued", None), // later, queued, and anything unrecognised
    }
}

pub fn note_file_name(id: &str, title: &str) -> String {
    format!("{id} {}.md", parse::sanitize_title(title))
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

pub fn needs_migration(dir: &Path) -> bool {
    // a vault that exists but holds no notes is not a migrated vault — an
    // ordinary jail check or a stray mkdir must never strand the board
    if !index::walk(&index::vault_dir(dir)).is_empty() { return false; }
    let Ok(text) = std::fs::read_to_string(board_path(dir)) else { return false };
    let Ok(v) = serde_json::from_str::<Value>(&text) else { return false };
    v.get("tasks").and_then(|t| t.as_array()).map(|a| !a.is_empty()).unwrap_or(false)
}

pub fn run(dir: &Path) -> Result<usize, String> {
    if !needs_migration(dir) { return Err("nothing to migrate".into()); }
    let text = std::fs::read_to_string(board_path(dir)).map_err(|e| e.to_string())?;
    let store: Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    let tasks = store.get("tasks").and_then(|t| t.as_array()).cloned().unwrap_or_default();

    let mapped: Vec<MigratedNote> = tasks.iter().map(map_task).collect();
    let vault = index::vault_dir(dir);
    for n in &mapped {
        let full = vault.join(&n.path);
        std::fs::create_dir_all(full.parent().ok_or("bad note path")?).map_err(|e| e.to_string())?;
        std::fs::write(&full, parse::join_front_matter(&n.front, &n.body)).map_err(|e| e.to_string())?;
    }

    // ids → new paths, so a round keeps pointing at its work
    let by_id: std::collections::HashMap<&str, &str> = tasks.iter().zip(&mapped)
        .filter_map(|(t, n)| t.get("id").and_then(|v| v.as_str()).map(|i| (i, n.path.as_str())))
        .collect();
    let rounds: Vec<Value> = store.get("rounds").and_then(|r| r.as_array()).cloned().unwrap_or_default()
        .into_iter().map(|mut r| {
            let paths: Vec<String> = r.get("task_ids").and_then(|v| v.as_array())
                .map(|a| a.iter().filter_map(|x| x.as_str()).filter_map(|i| by_id.get(i).map(|p| p.to_string())).collect())
                .unwrap_or_default();
            if let Some(o) = r.as_object_mut() { o.insert("note_paths".into(), json!(paths)); }
            r
        }).collect();
    std::fs::write(dir.join(".chronicle/rounds.json"),
        serde_json::to_string_pretty(&json!({ "version": 1, "rounds": rounds })).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;

    // last, and only once everything above landed
    std::fs::rename(board_path(dir), dir.join(".chronicle/kanban.json.migrated")).map_err(|e| e.to_string())?;
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
        assert_eq!(run(&d).unwrap(), 2);
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
    fn an_empty_vault_folder_does_not_count_as_migrated() {
        let d = tmp("emptyvault");
        std::fs::write(d.join(".chronicle/kanban.json"), json!({
            "version": 1, "next_id": 2,
            "tasks": [ { "id": "T-001", "title": "One", "column": "queued" } ], "rounds": []
        }).to_string()).unwrap();
        // a read-side jail check, or any stray mkdir, must not strand the board
        std::fs::create_dir_all(d.join(".chronicle/notes")).unwrap();
        assert!(needs_migration(&d));
        assert_eq!(run(&d).unwrap(), 1);
    }

    #[test]
    fn an_empty_or_absent_board_is_not_migrated() {
        let d = tmp("empty");
        assert!(!needs_migration(&d), "no kanban.json at all");
        std::fs::write(d.join(".chronicle/kanban.json"),
                       json!({ "version": 1, "next_id": 1, "tasks": [], "rounds": [] }).to_string()).unwrap();
        assert!(!needs_migration(&d), "a board with no tasks is nothing to move");
    }
}
