//! The notes vault: the parser, the index, the commands, the migration, and the
//! rounds store that used to live inside kanban.json.
//!
//! Every command takes `dir`, resolves it through the opened-roots allowlist like
//! every other command in the app, and then resolves the note path through the
//! vault jail below. The commands are thin: the interesting work is in `parse`
//! (text) and `index` (state).
//!
//! `parse::sanitize_title`, `FrontMatter::remove` and `FrontMatter::set_list`
//! are still only exercised by tests — `migrate` (Task 4) and `rounds` (Task 5)
//! are the production callers — so `dead_code` stays allowed until they land.
#![allow(dead_code)]

pub mod index;
pub mod migrate;
pub mod parse;
pub mod rounds;

use crate::{epoch_ms, project_for, OpenRoots, Project};
use index::{NotesIndex, NotesState};
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, State};

#[derive(Serialize, Clone, Debug)]
pub struct SearchHit { pub path: String, pub title: String, pub kind: String, pub snippet: String }

/// The vault jail. A note path is vault-relative, uses forward slashes, ends in
/// `.md`, and — after canonicalising every component that exists — still sits
/// under `.chronicle/notes`. The file itself need not exist: `notes_write`
/// creates new notes.
pub fn note_file(p: &Project, rel: &str) -> Result<PathBuf, String> { note_file_in(&p.dir, rel) }

/// The same jail, addressed by project dir alone — `rounds` resolves the note
/// paths it reads out of `.chronicle/rounds.json` through this, since that file
/// is user-editable and a hand-written `../..` must not escape.
pub fn note_file_in(dir: &Path, rel: &str) -> Result<PathBuf, String> {
    if !rel.ends_with(".md") { return Err("only .md files live in the vault".into()); }
    // the vault is created on the first WRITE, never on a read or a jail check —
    // creating it here would make migrate::needs_migration answer "already done"
    // for a project that has only ever been looked at (spec: error handling)
    let raw = index::vault_dir(dir);
    let vault = match raw.canonicalize() {
        Ok(v) => v,
        Err(_) => dir.canonicalize().map_err(|e| e.to_string())?.join(".chronicle/notes"),
    };
    if rel.starts_with('/') || rel.contains('\0') || rel.split('/').any(|s| s == "..") {
        return Err("that path isn't inside the notes vault".into());
    }
    let full = vault.join(rel);
    // canonicalise the deepest existing ancestor: a symlinked parent (or file)
    // that leaves the vault must be refused even when the leaf is new
    let mut probe = full.clone();
    while !probe.exists() {
        match probe.parent() { Some(par) => probe = par.to_path_buf(), None => break }
    }
    let real = probe.canonicalize().map_err(|_| "that path isn't inside the notes vault".to_string())?;
    if !real.starts_with(&vault) { return Err("that path isn't inside the notes vault".into()); }
    if full.exists() {
        let md = full.symlink_metadata().map_err(|e| e.to_string())?;
        if md.file_type().is_symlink() { return Err("that path isn't inside the notes vault".into()); }
    }
    Ok(full)
}

fn iso_now() -> String {
    // ISO-8601 UTC without a chrono dependency (main.rs does the same trick for hh:mm:ss)
    let secs = epoch_ms() / 1000;
    let days = secs / 86_400;
    let (h, m, s) = ((secs % 86_400) / 3600, (secs % 3600) / 60, secs % 60);
    let (y, mo, d) = civil_from_days(days as i64);
    format!("{y:04}-{mo:02}-{d:02}T{h:02}:{m:02}:{s:02}Z")
}
/// Howard Hinnant's days→y/m/d, the standard branch-free version.
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

/// Atomic: a temp file beside the target, then rename. A crash mid-write can
/// never leave a truncated note (the same rule `write_kanban` followed).
pub fn write_note(p: &Project, rel: &str, text: &str) -> Result<(), String> {
    std::fs::create_dir_all(index::vault_dir(&p.dir)).map_err(|e| e.to_string())?; // first write makes the vault
    let full = note_file(p, rel)?;
    if rounds::is_locked(&p.dir, rel) { return Err("locked".into()); }
    let existed = full.exists();
    let (mut fm, body) = parse::split_front_matter(text);
    if !existed || fm.get("created").is_none() {
        let previous = std::fs::read_to_string(&full).ok()
            .map(|t| parse::split_front_matter(&t).0)
            .and_then(|f| f.get("created").map(str::to_string));
        fm.set("created", &previous.unwrap_or_else(iso_now));
    }
    fm.set("updated", &iso_now());
    if let Some(parent) = full.parent() { std::fs::create_dir_all(parent).map_err(|e| e.to_string())?; }
    let tmp = full.with_extension("md.tmp");
    std::fs::write(&tmp, parse::join_front_matter(&fm, &body)).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &full).map_err(|e| e.to_string())
}

/// Rename or move, then rewrite every link that resolved to the old path.
/// Best-effort per file: a note that cannot be rewritten is returned, not fatal.
pub fn move_note(p: &Project, from: &str, to: &str) -> Result<Vec<String>, String> {
    let src = note_file(p, from)?;
    let dst = note_file(p, to)?;
    // the same refusal `write_note` gives: a live round's notes are the agent's
    // until it finishes, and renaming one would strand the round's other notes
    if rounds::is_locked(&p.dir, from) { return Err("locked".into()); }
    if dst.exists() { return Err("a note with that name is already there".into()); }
    if !src.exists() { return Err("that note isn't there anymore".into()); }
    let vault = index::vault_dir(&p.dir);
    let before: Vec<String> = index::walk(&vault).into_iter().map(|(r, _, _)| r).collect();
    if let Some(parent) = dst.parent() { std::fs::create_dir_all(parent).map_err(|e| e.to_string())?; }
    std::fs::rename(&src, &dst).map_err(|e| e.to_string())?;
    let after: Vec<String> = index::walk(&vault).into_iter().map(|(r, _, _)| r).collect();
    let mut failed = Vec::new();
    for rel in &after {
        let Ok(text) = std::fs::read_to_string(vault.join(rel)) else { failed.push(rel.clone()); continue };
        let (fm, body) = parse::split_front_matter(&text);
        let (new_body, n) = parse::rewrite_links(&body, rel, from, to, &before, &after);
        if n == 0 { continue; }
        let tmp = vault.join(rel).with_extension("md.tmp");
        let joined = parse::join_front_matter(&fm, &new_body);
        if std::fs::write(&tmp, joined).is_err() || std::fs::rename(&tmp, vault.join(rel)).is_err() {
            failed.push(rel.clone());
        }
    }
    Ok(failed)
}

/// Never unlinks: the file moves to `.chronicle/trash/<epoch ms>-<name>.md`.
pub fn delete_note(p: &Project, rel: &str) -> Result<String, String> {
    let full = note_file(p, rel)?;
    if rounds::is_locked(&p.dir, rel) { return Err("locked".into()); }
    let name = rel.rsplit('/').next().unwrap_or(rel);
    let trash = p.dir.join(".chronicle/trash");
    std::fs::create_dir_all(&trash).map_err(|e| e.to_string())?;
    let out_rel = format!(".chronicle/trash/{}-{}", epoch_ms(), name);
    std::fs::rename(&full, p.dir.join(&out_rel)).map_err(|e| e.to_string())?;
    Ok(out_rel)
}

/// Title hits, then tag hits, then body hits; within a bucket, path order.
pub fn search_notes(state: &NotesState, dir: &Path, query: &str) -> Vec<SearchHit> {
    let q = query.trim().to_lowercase();
    if q.chars().count() < 2 { return vec![]; }
    let idx = index::snapshot(state, dir);
    let vault = index::vault_dir(dir);
    let (mut titles, mut tags, mut bodies) = (vec![], vec![], vec![]);
    for n in &idx.notes {
        let hit = |kind: &str, snippet: String| SearchHit {
            path: n.path.clone(), title: n.title.clone(), kind: kind.into(), snippet,
        };
        if n.title.to_lowercase().contains(&q) { titles.push(hit("title", n.snippet.clone())); continue; }
        if n.tags.iter().any(|t| t.to_lowercase().contains(&q)) {
            tags.push(hit("tag", n.snippet.clone()));
            continue;
        }
        if n.unreadable { continue; }
        let Ok(text) = std::fs::read_to_string(vault.join(&n.path)) else { continue };
        if let Some(line) = text.lines().find(|l| l.to_lowercase().contains(&q)) {
            bodies.push(hit("body", line.trim().chars().take(160).collect()));
        }
    }
    titles.append(&mut tags);
    titles.append(&mut bodies);
    titles
}

/// `.chronicle/attachments/<slug>-<n>.<ext>`, referenced from a note as
/// `../attachments/<file>` — relative to the vault root, so a note can move
/// between folders without breaking its images.
pub fn attach(p: &Project, slug: &str, ext: &str, bytes: &[u8]) -> Result<String, String> {
    let slug: String = slug.chars().map(|c| if c.is_ascii_alphanumeric() || c == '-' { c } else { '-' }).collect();
    let slug = slug.trim_matches('-').to_lowercase();
    let ext: String = ext.chars().filter(|c| c.is_ascii_alphanumeric()).collect::<String>().to_lowercase();
    if slug.is_empty() || ext.is_empty() { return Err("bad attachment name".into()); }
    if bytes.len() > 10_000_000 { return Err("attachment is over 10 MB".into()); }
    let adir = p.dir.join(".chronicle/attachments");
    std::fs::create_dir_all(&adir).map_err(|e| e.to_string())?;
    let mut n = 1usize;
    while adir.join(format!("{slug}-{n}.{ext}")).exists() { n += 1; }
    let name = format!("{slug}-{n}.{ext}");
    std::fs::write(adir.join(&name), bytes).map_err(|e| e.to_string())?;
    Ok(format!("../attachments/{name}"))
}

/* ---------- the commands ---------- */

#[tauri::command]
pub async fn notes_index(roots: State<'_, OpenRoots>, notes: State<'_, NotesState>, dir: String) -> Result<NotesIndex, String> {
    let p = project_for(&roots, &dir)?;
    Ok(index::snapshot(&notes, &p.dir))
}

#[tauri::command]
pub async fn notes_read(roots: State<'_, OpenRoots>, dir: String, path: String) -> Result<String, String> {
    let p = project_for(&roots, &dir)?;
    std::fs::read_to_string(note_file(&p, &path)?).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn notes_write(app: AppHandle, roots: State<'_, OpenRoots>, notes: State<'_, NotesState>,
                         dir: String, path: String, text: String) -> Result<(), String> {
    let p = project_for(&roots, &dir)?;
    write_note(&p, &path, &text)?;
    let (changed, gen) = index::refresh(&notes, &p.dir);
    index::emit_changed(&app, &dir, &changed, gen);
    Ok(())
}

#[tauri::command]
pub async fn notes_move(app: AppHandle, roots: State<'_, OpenRoots>, notes: State<'_, NotesState>,
                        dir: String, from: String, to: String) -> Result<Vec<String>, String> {
    let p = project_for(&roots, &dir)?;
    let failed = move_note(&p, &from, &to)?;
    let (changed, gen) = index::refresh(&notes, &p.dir);
    index::emit_changed(&app, &dir, &changed, gen);
    Ok(failed)
}

#[tauri::command]
pub async fn notes_delete(app: AppHandle, roots: State<'_, OpenRoots>, notes: State<'_, NotesState>,
                          dir: String, path: String) -> Result<String, String> {
    let p = project_for(&roots, &dir)?;
    let trashed = delete_note(&p, &path)?;
    let (changed, gen) = index::refresh(&notes, &p.dir);
    index::emit_changed(&app, &dir, &changed, gen);
    Ok(trashed)
}

#[tauri::command]
pub async fn notes_search(roots: State<'_, OpenRoots>, notes: State<'_, NotesState>,
                          dir: String, query: String) -> Result<Vec<SearchHit>, String> {
    let p = project_for(&roots, &dir)?;
    Ok(search_notes(&notes, &p.dir, &query))
}

#[tauri::command]
pub async fn notes_attach(roots: State<'_, OpenRoots>, dir: String, note: String, name: String, b64: String) -> Result<String, String> {
    use base64::Engine;
    let p = project_for(&roots, &dir)?;
    let bytes = base64::engine::general_purpose::STANDARD.decode(b64).map_err(|e| e.to_string())?;
    let ext = name.rsplit('.').next().unwrap_or("png");
    attach(&p, &note, ext, &bytes)
}

/// Remove one attachment file — only ever inside `.chronicle/attachments`, so a
/// deleted image leaves no orphan. (Was `kanban_detach`; the jail is unchanged.)
#[tauri::command]
pub async fn notes_detach(roots: State<'_, OpenRoots>, dir: String, path: String) -> Result<(), String> {
    let p = project_for(&roots, &dir)?;
    if !path.starts_with(".chronicle/attachments/") || path.contains("..") {
        return Err("only attachment files can be removed".into());
    }
    let raw = p.dir.join(&path);
    if let Ok(md) = std::fs::symlink_metadata(&raw) {
        if md.file_type().is_symlink() { return Err("only attachment files can be removed".into()); }
    }
    match std::fs::remove_file(&raw) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn proj(name: &str) -> (PathBuf, crate::Project) {
        let d = std::env::temp_dir().join(format!("chronicle-cmd-{}-{}", name, std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(d.join(".chronicle/notes")).unwrap();
        let d = d.canonicalize().unwrap();
        (d.clone(), crate::Project::bare(&d))
    }
    fn put(root: &PathBuf, rel: &str, text: &str) {
        let p = root.join(".chronicle/notes").join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, text).unwrap();
    }

    #[test]
    fn the_jail_admits_md_inside_the_vault_and_nothing_else() {
        let (root, p) = proj("jail");
        put(&root, "Design/A.md", "a"); // `put` makes the vault; note_file never does
        std::fs::write(root.join("outside.md"), "no").unwrap();
        std::os::unix::fs::symlink(root.join("outside.md"), root.join(".chronicle/notes/link.md")).unwrap();

        assert_eq!(note_file(&p, "Design/A.md").unwrap(), root.join(".chronicle/notes/Design/A.md"));
        assert_eq!(note_file(&p, "New/Note.md").unwrap(), root.join(".chronicle/notes/New/Note.md"),
                   "a note that does not exist yet still resolves — notes_write creates it");
        assert_eq!(note_file(&p, "A.txt").unwrap_err(), "only .md files live in the vault");
        assert_eq!(note_file(&p, "../../etc/passwd.md").unwrap_err(), "that path isn't inside the notes vault");
        assert_eq!(note_file(&p, "/etc/passwd.md").unwrap_err(), "that path isn't inside the notes vault");
        assert_eq!(note_file(&p, "link.md").unwrap_err(), "that path isn't inside the notes vault");
    }

    #[test]
    fn write_stamps_created_once_and_updated_every_time() {
        let (root, p) = proj("write");
        write_note(&p, "Tasks/New.md", "---\nstatus: queued\n---\n\nbody\n").unwrap();
        let first = std::fs::read_to_string(root.join(".chronicle/notes/Tasks/New.md")).unwrap();
        let (fm1, _) = super::parse::split_front_matter(&first);
        let created = fm1.get("created").unwrap().to_string();
        assert!(!created.is_empty());
        assert!(fm1.get("updated").is_some());
        assert_eq!(fm1.get("status"), Some("queued"));

        write_note(&p, "Tasks/New.md", "---\nstatus: done\n---\n\nbody 2\n").unwrap();
        let (fm2, body2) = super::parse::split_front_matter(
            &std::fs::read_to_string(root.join(".chronicle/notes/Tasks/New.md")).unwrap());
        assert_eq!(fm2.get("created").unwrap(), created, "created is written once, never rewritten");
        assert_eq!(fm2.get("status"), Some("done"));
        assert_eq!(body2, "body 2\n");
        // a note with no front matter at all still gets the two stamps
        write_note(&p, "Plain.md", "just text\n").unwrap();
        let (fm3, _) = super::parse::split_front_matter(
            &std::fs::read_to_string(root.join(".chronicle/notes/Plain.md")).unwrap());
        assert!(fm3.get("created").is_some() && fm3.get("updated").is_some());
        // and no .tmp file survives the atomic write
        assert!(!root.join(".chronicle/notes/Tasks/New.md.tmp").exists());
    }

    #[test]
    fn move_refuses_a_collision_and_rewrites_the_links_that_pointed_at_it() {
        let (root, p) = proj("move");
        put(&root, "Design/Energy budget.md", "budget\n");
        put(&root, "Design/Web pane retro.md", "See [[Energy budget]].\n");
        put(&root, "Tasks/Taken.md", "x\n");

        assert_eq!(move_note(&p, "Design/Energy budget.md", "Tasks/Taken.md").unwrap_err(),
                   "a note with that name is already there");
        let failed = move_note(&p, "Design/Energy budget.md", "Archive/Energy budget.md").unwrap();
        assert!(failed.is_empty());
        assert!(root.join(".chronicle/notes/Archive/Energy budget.md").exists());
        assert!(!root.join(".chronicle/notes/Design/Energy budget.md").exists());
        assert_eq!(std::fs::read_to_string(root.join(".chronicle/notes/Design/Web pane retro.md")).unwrap(),
                   "See [[Energy budget]].\n", "still the shortest form that resolves");
    }

    #[test]
    fn delete_moves_the_file_to_trash_and_leaves_the_link_dangling() {
        let (root, p) = proj("delete");
        put(&root, "A.md", "a\n");
        put(&root, "B.md", "[[A]]\n");
        let rel = delete_note(&p, "A.md").unwrap();
        assert!(rel.starts_with(".chronicle/trash/"), "{rel}");
        assert!(rel.ends_with("-A.md"), "{rel}");
        assert!(root.join(&rel).exists());
        assert!(!root.join(".chronicle/notes/A.md").exists());
        assert_eq!(std::fs::read_to_string(root.join(".chronicle/notes/B.md")).unwrap(), "[[A]]\n");
    }

    #[test]
    fn a_live_round_locks_write_move_and_delete_alike() {
        let (root, p) = proj("locked");
        put(&root, "Tasks/A.md", "---\nstatus: in_progress\nround: 1\n---\n\na\n");
        put(&root, "Tasks/Free.md", "---\nstatus: queued\n---\n\nfree\n");
        let record = |state: &str| rounds::Round {
            n: 1, state: state.into(), kind: None, task_ids: vec![],
            note_paths: vec!["Tasks/A.md".into()], created_at: 0,
            plan_path: "fixes/phase_1_fixes_plan.md".into(),
            prompt_path: "fixes/phase_1_fixes_prompt.md".into(),
        };
        rounds::save(&root, &[record("ready")]).unwrap();

        assert_eq!(write_note(&p, "Tasks/A.md", "clobbered\n").unwrap_err(), "locked");
        assert_eq!(move_note(&p, "Tasks/A.md", "Tasks/Renamed.md").unwrap_err(), "locked",
                   "renaming a note out from under a round would strand the round's other notes");
        assert_eq!(delete_note(&p, "Tasks/A.md").unwrap_err(), "locked");
        assert!(root.join(".chronicle/notes/Tasks/A.md").exists(), "and nothing moved");

        // a note the round never took is ordinary
        assert!(move_note(&p, "Tasks/Free.md", "Tasks/Moved.md").is_ok());
        // the lock lifts with the round
        rounds::save(&root, &[record("done")]).unwrap();
        assert!(delete_note(&p, "Tasks/A.md").is_ok());
    }

    #[test]
    fn search_ranks_titles_then_tags_then_bodies_and_ignores_short_queries() {
        let (root, _p) = proj("search");
        put(&root, "Energy budget.md", "how much power the app costs\n");
        put(&root, "Tagged.md", "---\ntags: [energy]\n---\n\nnothing in the body\n");
        put(&root, "Body.md", "the ENERGY of the terminal column\n");
        let st = index::NotesState::new();
        index::refresh(&st, &root);

        assert!(search_notes(&st, &root, "e").is_empty(), "a one-character query returns nothing");
        let hits = search_notes(&st, &root, "energy");
        assert_eq!(hits.iter().map(|h| h.path.as_str()).collect::<Vec<_>>(),
                   vec!["Energy budget.md", "Tagged.md", "Body.md"]);
        assert_eq!(hits[0].kind, "title");
        assert_eq!(hits[1].kind, "tag");
        assert_eq!(hits[2].kind, "body");
        assert!(hits[2].snippet.to_lowercase().contains("energy"), "a body hit carries the matching line");
    }

    #[test]
    fn attach_writes_beside_the_vault_and_never_clobbers() {
        let (root, p) = proj("attach");
        let a = attach(&p, "web-pane-retro", "png", &[1, 2, 3]).unwrap();
        let b = attach(&p, "web-pane-retro", "png", &[4, 5, 6]).unwrap();
        assert_eq!(a, "../attachments/web-pane-retro-1.png");
        assert_eq!(b, "../attachments/web-pane-retro-2.png");
        assert!(root.join(".chronicle/attachments/web-pane-retro-1.png").exists());
        assert_eq!(std::fs::read(root.join(".chronicle/attachments/web-pane-retro-2.png")).unwrap(), vec![4, 5, 6]);
    }
}
