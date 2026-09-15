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
        Capability {
            spec: ToolSpec {
                name: "chronicle.notes.create",
                description: "Create a note in the vault. Allocates the next T-id, writes the front matter, and returns the path.",
                input_schema: json!({
                    "type": "object", "required": ["title"],
                    "properties": {
                        "title": { "type": "string" },
                        "body": { "type": "string", "description": "markdown below the title" },
                        "folder": { "type": "string", "default": "Tasks" },
                        "tags": { "type": "array", "items": { "type": "string" } },
                        "status": { "type": "string", "default": "queued" }
                    }
                }),
            },
            run: notes_create,
        },
        Capability {
            spec: ToolSpec {
                name: "chronicle.notes.update",
                description: "Edit a note in place: set or unset front-matter keys, replace the body, or both. Unknown keys are kept.",
                input_schema: json!({
                    "type": "object", "required": ["path"],
                    "properties": {
                        "path": { "type": "string" },
                        "set": { "type": "object", "additionalProperties": { "type": "string" } },
                        "unset": { "type": "array", "items": { "type": "string" } },
                        "body": { "type": "string" }
                    }
                }),
            },
            run: notes_update,
        },
        Capability {
            spec: ToolSpec {
                name: "chronicle.notes.set_status",
                description: "Set a note's status (queued, in_progress, done, or any status the vault uses).",
                input_schema: json!({ "type": "object", "required": ["path", "status"],
                    "properties": { "path": { "type": "string" }, "status": { "type": "string" } } }),
            },
            run: notes_set_status,
        },
        Capability {
            spec: ToolSpec {
                name: "chronicle.notes.attach",
                description: "Copy a file from the project into the vault's attachments and embed it at the end of the note.",
                input_schema: json!({ "type": "object", "required": ["path", "file"],
                    "properties": { "path": { "type": "string" }, "file": { "type": "string", "description": "project-relative or absolute path inside the project" } } }),
            },
            run: notes_attach,
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

const BASE_STATUSES: [&str; 3] = ["queued", "in_progress", "done"];

/// queued, in_progress, done, plus every status the vault already uses. Sorted.
fn known_statuses(dir: &Path) -> Vec<String> {
    let vault = index::vault_dir(dir);
    let mut out: Vec<String> = BASE_STATUSES.iter().map(|s| s.to_string()).collect();
    for (rel, _, size) in index::walk(&vault) {
        if let Some(s) = note_row(&vault, &rel, size)["status"].as_str() { out.push(s.to_string()); }
    }
    out.sort(); out.dedup(); out
}

fn check_status(dir: &Path, status: &str) -> Result<(), String> {
    let known = known_statuses(dir);
    if known.iter().any(|k| k == status) { return Ok(()) }
    Err(format!("{status} isn't a status this vault uses. Known: {}.", known.join(", ")))
}

/// T-<n>: one past the highest numeric T-id in the vault. Migrated notes carry ids; the
/// app's own new notes do not, so the first agent-created note after a migration of
/// T-001..T-140 is T-141.
fn next_id(dir: &Path) -> String {
    let vault = index::vault_dir(dir);
    let max = index::walk(&vault).into_iter()
        .filter_map(|(rel, _, size)| note_row(&vault, &rel, size)["id"].as_str().map(str::to_string))
        .filter_map(|id| id.strip_prefix("T-").and_then(|n| n.parse::<u64>().ok()))
        .max().unwrap_or(0);
    format!("T-{:03}", max + 1)
}

/// `<folder>/<sanitized title>.md`, then ` 2`, ` 3` … on collision (the app's newNotePath).
fn new_note_path(dir: &Path, folder: &str, title: &str) -> Result<String, String> {
    let base = { let s = parse::sanitize_title(title); if s.is_empty() { "Untitled".to_string() } else { s } };
    let at = |name: &str| if folder.is_empty() { format!("{name}.md") } else { format!("{folder}/{name}.md") };
    let full = crate::notes::note_file_in(dir, &at(&base))?; // jails the folder too
    if !full.exists() { return Ok(at(&base)) }
    for n in 2.. {
        let rel = at(&format!("{base} {n}"));
        if !crate::notes::note_file_in(dir, &rel)?.exists() { return Ok(rel) }
    }
    unreachable!()
}

fn write_locked_aware(dir: &Path, rel: &str, text: &str) -> Result<(), String> {
    if let Some(n) = crate::notes::rounds::locking_round(dir, rel) {
        return Err(format!("{rel} is locked by round {n} while it runs."));
    }
    crate::notes::write_note(&crate::Project::bare(dir), rel, text)
}

fn notes_create(dir: &Path, args: &Value) -> Result<Outcome, String> {
    let title = required_str(args, "title")?;
    let folder = arg_str(args, "folder")?.unwrap_or("Tasks").trim_matches('/');
    let status = arg_str(args, "status")?.unwrap_or("queued");
    check_status(dir, status)?;
    let tags: Vec<String> = match args.get("tags") {
        None | Some(Value::Null) => vec![],
        Some(Value::Array(a)) => a.iter().filter_map(|v| v.as_str().map(str::to_string)).collect(),
        Some(_) => return Err("tags must be a list of strings.".into()),
    };
    let body = arg_str(args, "body")?.unwrap_or("").trim_end();
    let rel = new_note_path(dir, folder, title)?;
    let id = next_id(dir);
    let mut fm = parse::FrontMatter { entries: vec![] };
    fm.set("id", &id);
    fm.set("status", status);
    if !tags.is_empty() { fm.set_list("tags", &tags); }
    let text = parse::join_front_matter(&fm, &format!("# {title}\n\n{}{}", body, if body.is_empty() { "" } else { "\n" }));
    write_locked_aware(dir, &rel, &text)?;
    Ok(Outcome { summary: format!("Created {rel} as {id} · {status}."), data: json!({ "path": rel, "id": id, "status": status }) })
}

fn notes_update(dir: &Path, args: &Value) -> Result<Outcome, String> {
    let rel = required_str(args, "path")?;
    let (mut fm, old_body) = read_note_file(dir, rel)?;
    if let Some(set) = args.get("set") {
        let obj = set.as_object().ok_or("set must be an object of strings.")?;
        for (k, v) in obj {
            let v = v.as_str().ok_or_else(|| format!("set.{k} must be a string."))?;
            if k == "status" { check_status(dir, v)?; }
            fm.set(k, v);
        }
    }
    if let Some(unset) = args.get("unset") {
        for k in unset.as_array().ok_or("unset must be a list of keys.")? {
            fm.remove(k.as_str().ok_or("unset must be a list of keys.")?);
        }
    }
    let body = arg_str(args, "body")?.map(str::to_string).unwrap_or(old_body);
    write_locked_aware(dir, rel, &parse::join_front_matter(&fm, &body))?;
    let (fm, _) = read_note_file(dir, rel)?;
    let front: serde_json::Map<String, Value> = fm.entries.iter().map(|(k, v)| (k.clone(), Value::String(v.clone()))).collect();
    let status = parse::status_of(&fm).unwrap_or_else(|| "no status".into());
    Ok(Outcome { summary: format!("Updated {rel} · {status}."), data: json!({ "path": rel, "front": front }) })
}

fn notes_set_status(dir: &Path, args: &Value) -> Result<Outcome, String> {
    let rel = required_str(args, "path")?;
    let status = required_str(args, "status")?;
    check_status(dir, status)?;
    let (mut fm, body) = read_note_file(dir, rel)?;
    fm.set("status", status);
    write_locked_aware(dir, rel, &parse::join_front_matter(&fm, &body))?;
    Ok(Outcome { summary: format!("{rel} is now {status}."), data: json!({ "path": rel, "status": status }) })
}

fn notes_attach(dir: &Path, args: &Value) -> Result<Outcome, String> {
    let rel = required_str(args, "path")?;
    let file = required_str(args, "file")?;
    let p = crate::load_project(dir);
    let ctx = crate::Ctx::build(&p);
    let src = if Path::new(file).is_absolute() {
        let canon = Path::new(file).canonicalize().map_err(|_| format!("There is no file at {file}."))?;
        let root = p.dir.canonicalize().map_err(|e| e.to_string())?;
        if !canon.starts_with(&root) { return Err("file must be inside the project.".into()) }
        canon
    } else {
        ctx.resolve_jailed(file).ok_or_else(|| if file.contains("..") || file.starts_with('/') {
            "file must be inside the project.".to_string() } else { format!("There is no file at {file}.") })?
    };
    let bytes = std::fs::read(&src).map_err(|_| format!("There is no file at {file}."))?;
    let stem = src.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| "file".into());
    let ext = src.extension().map(|e| e.to_string_lossy().into_owned()).unwrap_or_default();
    let att = crate::notes::attach(&p, &stem, &ext, &bytes)?;
    let (fm, body) = read_note_file(dir, rel)?;
    let body = format!("{}\n\n![{stem}]({att})\n", body.trim_end());
    write_locked_aware(dir, rel, &parse::join_front_matter(&fm, &body))?;
    Ok(Outcome { summary: format!("Attached {file} to {rel}."), data: json!({ "path": rel, "attachment": att }) })
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

    #[test]
    fn create_allocates_the_next_id_and_a_safe_file_name() {
        let d = vault("create");
        put(&d, "Tasks/T-007 Old.md", "---\nid: T-007\nstatus: done\n---\n\n# Old\n");
        put(&d, "Tasks/T-012 Older.md", "---\nid: T-012\nstatus: done\n---\n\n# Older\n");
        let r = call(&d, "chronicle.notes.create", &json!({"title": "Login: card overlaps / 13\" screens", "tags": ["bug"], "body": "It overlaps."})).unwrap();
        assert_eq!(r.data["id"], "T-013");
        let expect = format!("Tasks/{}.md", parse::sanitize_title("Login: card overlaps / 13\" screens"));
        assert_eq!(r.data["path"], expect, "the app's sanitize_title names the file");
        assert!(!expect.contains(':') && !expect.contains('/') || expect.matches('/').count() == 1, "{expect}");
        assert_eq!(r.summary, format!("Created {expect} as T-013 · queued."));
        let text = std::fs::read_to_string(d.join(".chronicle/notes").join(r.data["path"].as_str().unwrap())).unwrap();
        assert!(text.starts_with("---\n"), "{text}");
        for line in ["id: T-013", "status: queued", "tags: [bug]"] { assert!(text.contains(&format!("\n{line}\n")), "{line} in {text}"); }
        assert!(text.contains("created: "), "write_note stamps created/updated");
        assert!(text.ends_with("# Login: card overlaps / 13\" screens\n\nIt overlaps.\n"), "{text}");
        // a second note with the same title gets ` 2`
        let r2 = call(&d, "chronicle.notes.create", &json!({"title": "Login: card overlaps / 13\" screens"})).unwrap();
        assert_eq!(r2.data["path"], expect.replace(".md", " 2.md"));
        assert_eq!(r2.data["id"], "T-014");
        // folder and status are honoured; an unknown status is refused with the list
        let r3 = call(&d, "chronicle.notes.create", &json!({"title": "Idea", "folder": "Ideas", "status": "done"})).unwrap();
        assert_eq!(r3.data["path"], "Ideas/Idea.md");
        let e = call(&d, "chronicle.notes.create", &json!({"title": "X", "status": "shipped"})).unwrap_err();
        assert_eq!(e, "shipped isn't a status this vault uses. Known: done, in_progress, queued.");
        assert_eq!(call(&d, "chronicle.notes.create", &json!({})).unwrap_err(), "title is required.");
        assert_eq!(call(&d, "chronicle.notes.create", &json!({"title": "X", "folder": "../out"})).unwrap_err(),
                   "that path isn't inside the notes vault");
    }

    #[test]
    fn update_and_set_status_edit_front_matter_and_body_in_place() {
        let d = vault("update");
        put(&d, "Tasks/T-001 A.md", "---\nid: T-001\nstatus: queued\nweird: kept\n---\n\n# A\n\nold body\n");
        let r = call(&d, "chronicle.notes.update", &json!({"path": "Tasks/T-001 A.md", "set": {"status": "in_progress", "owner": "me"}, "unset": ["weird"], "body": "# A\n\nnew body\n"})).unwrap();
        assert_eq!(r.data["front"]["status"], "in_progress");
        assert_eq!(r.data["front"]["owner"], "me");
        assert_eq!(r.data["front"].get("weird"), None);
        let text = std::fs::read_to_string(d.join(".chronicle/notes/Tasks/T-001 A.md")).unwrap();
        assert!(text.contains("owner: me"));
        assert!(!text.contains("weird"));
        assert!(text.ends_with("# A\n\nnew body\n"));
        assert_eq!(r.summary, "Updated Tasks/T-001 A.md · in_progress.");
        let e = call(&d, "chronicle.notes.update", &json!({"path": "Tasks/T-001 A.md", "set": {"status": "nope"}})).unwrap_err();
        assert!(e.starts_with("nope isn't a status this vault uses."));
        let s = call(&d, "chronicle.notes.set_status", &json!({"path": "Tasks/T-001 A.md", "status": "done"})).unwrap();
        assert_eq!(s.data["status"], "done");
        assert_eq!(s.summary, "Tasks/T-001 A.md is now done.");
        assert_eq!(call(&d, "chronicle.notes.set_status", &json!({"path": "Tasks/Missing.md", "status": "done"})).unwrap_err(),
                   "There is no note at Tasks/Missing.md.");
        // a note locked by a live round is refused the way the app refuses it
        std::fs::write(d.join(".chronicle/rounds.json"), r#"{"version":1,"rounds":[{"n":1,"state":"ready","note_paths":["Tasks/T-001 A.md"]}]}"#).unwrap();
        assert_eq!(call(&d, "chronicle.notes.update", &json!({"path": "Tasks/T-001 A.md", "body": "x"})).unwrap_err(),
                   "Tasks/T-001 A.md is locked by round 1 while it runs.");
    }

    #[test]
    fn attach_copies_a_file_into_the_vault_and_links_it() {
        let d = vault("attach");
        put(&d, "Tasks/T-001 A.md", "---\nid: T-001\nstatus: queued\n---\n\n# A\n");
        std::fs::write(d.join("shot.png"), b"\x89PNGfake").unwrap();
        let r = call(&d, "chronicle.notes.attach", &json!({"path": "Tasks/T-001 A.md", "file": "shot.png"})).unwrap();
        let att = r.data["attachment"].as_str().unwrap().to_string();
        // notes::attach returns a vault-root-relative embed ref ("../attachments/<file>"),
        // the same convention migrate.rs and the frontend's ATTACHMENT_REF regex use —
        // not a project-relative ".chronicle/attachments/…" path (adjusted from the brief,
        // see task-3-report.md).
        assert!(att.starts_with("../attachments/") && att.ends_with(".png"), "{att}");
        let file_name = att.strip_prefix("../attachments/").unwrap();
        assert!(d.join(".chronicle/attachments").join(file_name).exists());
        let text = std::fs::read_to_string(d.join(".chronicle/notes/Tasks/T-001 A.md")).unwrap();
        assert!(text.trim_end().ends_with(&format!("![shot]({att})")), "the note ends with the embed: {text}");
        assert_eq!(call(&d, "chronicle.notes.attach", &json!({"path": "Tasks/T-001 A.md", "file": "/etc/passwd"})).unwrap_err(),
                   "file must be inside the project.");
        assert_eq!(call(&d, "chronicle.notes.attach", &json!({"path": "Tasks/T-001 A.md", "file": "missing.png"})).unwrap_err(),
                   "There is no file at missing.png.");
    }
}
