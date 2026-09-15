//! One implementation of every capability an agent (or a shell) can ask Chronicle for.
//! `main()` fronts it twice: `chronicle --mcp <dir>` (stdio MCP) and `chronicle <group>
//! <verb>` (CLI). Notes and state need no running app.
//!
//! wired up by the CLI (cli.rs) and the MCP server (mcp.rs); until then nothing calls it
#![allow(dead_code)]

use serde_json::{json, Value};
use std::path::{Path, PathBuf};

use crate::notes::{index, parse};

#[derive(Debug)]
pub(crate) struct Outcome { pub summary: String, pub data: Value }

pub(crate) struct ToolSpec {
    pub name: &'static str,
    pub description: &'static str,
    pub input_schema: Value,
}

type Handler = fn(&Path, &Value) -> Result<Outcome, String>;

struct Capability { spec: ToolSpec, run: Handler }

fn caps() -> Vec<Capability> {
    vec![
        Capability {
            spec: ToolSpec {
                name: "chronicle.notes.list",
                description: "List the project's notes, newest first. Filter by status, round, tag, or a text search over titles and bodies.",
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "status": { "type": "string", "description": "queued, in_progress, done, or any status the vault uses" },
                        "round": { "type": "integer", "description": "only notes in this round" },
                        "tag": { "type": "string" },
                        "text": { "type": "string", "description": "case-insensitive substring over title and body" },
                        "limit": { "type": "integer", "default": 200 }
                    }
                }),
            },
            run: notes_list,
        },
        Capability {
            spec: ToolSpec {
                name: "chronicle.notes.read",
                description: "Read one note: its front matter as a map of raw strings, and its body.",
                input_schema: json!({
                    "type": "object",
                    "required": ["path"],
                    "properties": { "path": { "type": "string", "description": "vault-relative path, e.g. Tasks/T-012 Login.md" } }
                }),
            },
            run: notes_read,
        },
    ]
}

pub(crate) fn catalog() -> Vec<ToolSpec> { caps().into_iter().map(|c| c.spec).collect() }

pub(crate) fn call(dir: &Path, name: &str, args: &Value) -> Result<Outcome, String> {
    match caps().into_iter().find(|c| c.spec.name == name) {
        Some(c) => (c.run)(dir, args),
        None => Err(format!("No capability named {name}. Known: {}.",
            caps().iter().map(|c| c.spec.name).collect::<Vec<_>>().join(", "))),
    }
}

/// The folder Chronicle would open for `start`: the first ancestor (inclusive) that
/// holds chronicle.json or .chronicle/.
pub(crate) fn resolve_project_dir(start: &Path) -> Option<PathBuf> {
    let mut p = start.canonicalize().ok()?;
    loop {
        if p.join("chronicle.json").is_file() || p.join(".chronicle").is_dir() { return Some(p); }
        p = p.parent()?.to_path_buf();
    }
}

/* ---------- argument helpers: one sentence per refusal ---------- */

fn arg_str<'a>(args: &'a Value, key: &str) -> Result<Option<&'a str>, String> {
    match args.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(s)) => Ok(Some(s.as_str())),
        Some(_) => Err(format!("{key} must be a string.")),
    }
}
fn arg_u64(args: &Value, key: &str) -> Result<Option<u64>, String> {
    match args.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(v) => v.as_u64().map(Some).ok_or_else(|| format!("{key} must be a whole number.")),
    }
}
fn required_str<'a>(args: &'a Value, key: &str) -> Result<&'a str, String> {
    arg_str(args, key)?.filter(|s| !s.trim().is_empty()).ok_or_else(|| format!("{key} is required."))
}

/* ---------- notes ---------- */

fn read_note_file(dir: &Path, rel: &str) -> Result<(parse::FrontMatter, String), String> {
    let full = crate::notes::note_file_in(dir, rel)?;
    let text = std::fs::read_to_string(&full).map_err(|_| format!("There is no note at {rel}."))?;
    Ok(parse::split_front_matter(&text))
}

/// One list row, plus its lowercased body for the `text` filter (`None` when the
/// note was never opened — too big, mirroring `index::parse_note`'s `unreadable`).
/// One read per note: `notes_list`'s filter reuses the body this returns instead of
/// opening the file a second time.
fn row_and_body(vault: &Path, rel: &str, size: u64) -> (Value, Option<String>) {
    let title = rel.rsplit_once('/').map(|(_, f)| f).unwrap_or(rel).trim_end_matches(".md");
    if size > index::MAX_INDEXED {
        let row = json!({
            "path": rel,
            "id": Value::Null,
            "title": title,
            "status": Value::Null,
            "round": Value::Null,
            "tags": Value::Array(vec![]),
            "created": Value::Null,
            "updated": Value::Null,
            "unreadable": true,
        });
        return (row, None);
    }
    let text = std::fs::read_to_string(vault.join(rel)).unwrap_or_default();
    let (fm, body) = parse::split_front_matter(&text);
    let row = json!({
        "path": rel,
        "id": fm.get("id"),
        "title": title,
        "status": parse::status_of(&fm),
        "round": parse::round_of(&fm),
        "tags": parse::tags_of(&fm, &body),
        "created": fm.get("created"),
        "updated": fm.get("updated"),
        "unreadable": false,
    });
    (row, Some(body.to_lowercase()))
}

/// One list row. Front-matter keys the file lacks are null; nothing is invented.
/// A note larger than `index::MAX_INDEXED` is `unreadable` and never opened.
pub(crate) fn note_row(vault: &Path, rel: &str, size: u64) -> Value { row_and_body(vault, rel, size).0 }

fn notes_list(dir: &Path, args: &Value) -> Result<Outcome, String> {
    let status = arg_str(args, "status")?;
    let round = arg_u64(args, "round")?;
    let tag = arg_str(args, "tag")?;
    let text = arg_str(args, "text")?.map(|t| t.to_lowercase());
    let limit = arg_u64(args, "limit")?.unwrap_or(200) as usize;
    let vault = index::vault_dir(dir);
    let mut entries = index::walk(&vault);
    entries.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0))); // newest first, then path
    let mut rows = Vec::new();
    for (rel, _, size) in entries {
        let (row, body_lower) = row_and_body(&vault, &rel, size);
        if let Some(s) = status { if row["status"].as_str() != Some(s) { continue } }
        if let Some(r) = round { if row["round"].as_u64() != Some(r) { continue } }
        if let Some(t) = tag { if !row["tags"].as_array().map(|a| a.iter().any(|x| x == t)).unwrap_or(false) { continue } }
        if let Some(q) = &text {
            // an unreadable note was never opened, so it can never match a text
            // search — it is skipped rather than falling back to a path match
            let Some(body) = &body_lower else { continue };
            if !body.contains(q) && !rel.to_lowercase().contains(q) { continue }
        }
        rows.push(row);
        if rows.len() >= limit { break }
    }
    let n = rows.len();
    Ok(Outcome { summary: format!("{n} note{}.", if n == 1 { "" } else { "s" }), data: json!({ "notes": rows }) })
}

fn notes_read(dir: &Path, args: &Value) -> Result<Outcome, String> {
    let rel = required_str(args, "path")?;
    let (fm, body) = read_note_file(dir, rel)?;
    let front: serde_json::Map<String, Value> = fm.entries.iter()
        .map(|(k, v)| (k.clone(), Value::String(v.clone()))).collect();
    let mut summary = rel.to_string();
    if let Some(s) = parse::status_of(&fm) { summary.push_str(&format!(" · {s}")); }
    if let Some(r) = parse::round_of(&fm) { summary.push_str(&format!(" · round {r}")); }
    summary.push('.');
    Ok(Outcome { summary, data: json!({ "path": rel, "front": front, "body": body }) })
}

#[cfg(test)]
mod tests {
    use super::*;

    pub(super) fn vault(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("chronicle-api-{}-{}", name, std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(d.join(".chronicle/notes/Tasks")).unwrap();
        d.canonicalize().unwrap()
    }
    pub(super) fn put(root: &Path, rel: &str, text: &str) {
        let p = root.join(".chronicle/notes").join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, text).unwrap();
    }

    #[test]
    fn the_catalog_names_every_capability_once() {
        let names: Vec<&str> = catalog().iter().map(|t| t.name).collect();
        for n in ["chronicle.notes.list", "chronicle.notes.read"] {
            assert!(names.contains(&n), "{n} missing from {names:?}");
        }
        let mut dedup = names.clone(); dedup.sort(); dedup.dedup();
        assert_eq!(dedup.len(), names.len(), "no duplicate names");
        for t in catalog() {
            assert_eq!(t.input_schema["type"], "object", "{}: schema is an object", t.name);
            assert!(!t.description.is_empty());
        }
    }

    #[test]
    fn list_filters_and_reads() {
        let d = vault("list");
        put(&d, "Tasks/T-001 Login.md", "---\nid: T-001\nstatus: done\nround: 1\ntags: [ui]\ncreated: 2026-07-14T18:36:56Z\nupdated: 2026-07-14T20:24:40Z\n---\n\n# Login\n\nBody one.\n");
        put(&d, "Tasks/T-002 Crash.md", "---\nid: T-002\nstatus: queued\ntags: [bug, ui]\n---\n\n# Crash\n\nBody two mentions kanban.\n");
        put(&d, "Ideas/Someday.md", "# Someday\n\nNo front matter at all.\n");

        let all = call(&d, "chronicle.notes.list", &json!({})).unwrap();
        assert_eq!(all.data["notes"].as_array().unwrap().len(), 3);
        assert_eq!(all.summary, "3 notes.");
        let queued = call(&d, "chronicle.notes.list", &json!({"status": "queued"})).unwrap();
        let rows = queued.data["notes"].as_array().unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0]["path"], "Tasks/T-002 Crash.md");
        assert_eq!(rows[0]["id"], "T-002");
        assert_eq!(rows[0]["tags"], json!(["bug", "ui"]));
        assert_eq!(rows[0]["created"], Value::Null, "absent keys are null, not invented");
        assert_eq!(call(&d, "chronicle.notes.list", &json!({"round": 1})).unwrap().data["notes"][0]["id"], "T-001");
        assert_eq!(call(&d, "chronicle.notes.list", &json!({"tag": "ui"})).unwrap().data["notes"].as_array().unwrap().len(), 2);
        assert_eq!(call(&d, "chronicle.notes.list", &json!({"text": "kanban"})).unwrap().data["notes"][0]["id"], "T-002");
        assert_eq!(call(&d, "chronicle.notes.list", &json!({"limit": 1})).unwrap().data["notes"].as_array().unwrap().len(), 1);
        assert_eq!(call(&d, "chronicle.notes.list", &json!({"status": 7})).unwrap_err(),
                   "status must be a string.");

        let one = call(&d, "chronicle.notes.read", &json!({"path": "Tasks/T-001 Login.md"})).unwrap();
        assert_eq!(one.data["front"]["status"], "done");
        assert_eq!(one.data["front"]["tags"], "[ui]", "front matter values are the raw strings the file holds");
        assert!(one.data["body"].as_str().unwrap().starts_with("# Login"));
        assert_eq!(one.summary, "Tasks/T-001 Login.md · done · round 1.");
        assert_eq!(call(&d, "chronicle.notes.read", &json!({"path": "../../etc/passwd.md"})).unwrap_err(),
                   "that path isn't inside the notes vault");
        assert_eq!(call(&d, "chronicle.notes.read", &json!({})).unwrap_err(), "path is required.");
        assert!(call(&d, "chronicle.nope.x", &json!({})).unwrap_err().starts_with("No capability named chronicle.nope.x."));
    }

    #[test]
    fn a_note_over_the_index_size_cap_is_unreadable_and_skipped_by_text_search() {
        let d = vault("huge");
        put(&d, "Tasks/T-001 Login.md", "---\nstatus: done\n---\n\n# Login\n\nBody one.\n");
        let huge = format!("---\nstatus: queued\n---\n\n{}", "x".repeat(6_000_001));
        put(&d, "Tasks/T-999 Huge.md", &huge);

        let all = call(&d, "chronicle.notes.list", &json!({})).unwrap();
        let rows = all.data["notes"].as_array().unwrap();
        let row = rows.iter().find(|r| r["path"] == "Tasks/T-999 Huge.md").unwrap();
        assert_eq!(row["unreadable"], true);
        assert_eq!(row["status"], Value::Null, "never opened, so status is null, not the file's real value");
        assert_eq!(row["title"], "T-999 Huge");

        let hits = call(&d, "chronicle.notes.list", &json!({"text": "x"})).unwrap();
        let hit_paths: Vec<&str> = hits.data["notes"].as_array().unwrap().iter()
            .map(|r| r["path"].as_str().unwrap()).collect();
        assert!(!hit_paths.contains(&"Tasks/T-999 Huge.md"), "an unreadable note is never opened for a text search: {hit_paths:?}");
    }

    #[test]
    fn the_project_dir_is_found_by_walking_up() {
        let d = vault("walk");
        let deep = d.join("src/deep/er");
        std::fs::create_dir_all(&deep).unwrap();
        assert_eq!(resolve_project_dir(&deep), Some(d.clone()));
        let nowhere = std::env::temp_dir().join(format!("chronicle-api-nowhere-{}", std::process::id()));
        std::fs::create_dir_all(&nowhere).unwrap();
        assert_eq!(resolve_project_dir(&nowhere), None);
    }
}
