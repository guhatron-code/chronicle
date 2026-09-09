//! The per-project vault index. Built on first look, refreshed only when the
//! project watcher reports a write under `notes/`, and only for the files whose
//! mtime or size actually moved. The `generation` counter is what the heartbeat
//! carries, so an untouched vault costs the frontend nothing (the same discipline
//! `kanban_mtime` used to give the board).

use super::parse::{self, links_of, round_of, snippet_of, split_front_matter, status_of, tags_of};
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::{Emitter, EventTarget};

const MAX_INDEXED: u64 = 4 * 1024 * 1024;

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct NoteEntry {
    pub path: String,
    pub title: String,
    pub folder: String,
    pub status: Option<String>,
    pub round: Option<u64>,
    pub tags: Vec<String>,
    pub links: Vec<parse::RawLink>,
    pub resolved: Vec<Option<String>>,
    pub ambiguous: Vec<bool>,
    pub mtime: u64,
    pub size: u64,
    pub snippet: String,
    pub unreadable: bool,
}

#[derive(Serialize, Clone, Debug)]
pub struct NotesIndex {
    pub notes: Vec<NoteEntry>,
    pub generation: u64,
}

pub struct Vault {
    pub notes: Vec<NoteEntry>,
    pub generation: u64,
}

pub struct NotesState {
    pub vaults: Mutex<HashMap<PathBuf, Vault>>,
    /// One mutex per vault, held across `refresh`'s walk+parse+swap — never the
    /// same lock `vaults` uses. Readers (`snapshot`, `generation`) never wait on
    /// this; it only serialises concurrent refreshers of the SAME vault so a
    /// walk that started later can never lose a race and install a stale result
    /// at a higher generation than a walk that started earlier already claimed.
    refresh_locks: Mutex<HashMap<PathBuf, Arc<Mutex<()>>>>,
}

pub fn vault_dir(dir: &Path) -> PathBuf { dir.join(".chronicle/notes") }

pub fn walk(vault: &Path) -> Vec<(String, u64, u64)> {
    let mut out = Vec::new();
    let mut stack = vec![(vault.to_path_buf(), String::new())];
    while let Some((d, prefix)) = stack.pop() {
        let Ok(rd) = std::fs::read_dir(&d) else { continue };
        for e in rd.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            if name.starts_with('.') { continue; }
            // symlinks are never followed — a link out of the vault is not a note
            let Ok(md) = e.path().symlink_metadata() else { continue };
            if md.file_type().is_symlink() { continue; }
            let rel = if prefix.is_empty() { name.clone() } else { format!("{prefix}/{name}") };
            if md.is_dir() {
                if prefix.is_empty() && name == "trash" { continue; }
                stack.push((e.path(), rel));
            } else if name.ends_with(".md") {
                let mtime = md.modified().ok()
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_millis() as u64).unwrap_or(0);
                out.push((rel, mtime, md.len()));
            }
        }
    }
    out
}

pub fn parse_note(vault: &Path, rel: &str, mtime: u64, size: u64) -> NoteEntry {
    let title = rel.rsplit_once('/').map(|(_, f)| f).unwrap_or(rel).trim_end_matches(".md").to_string();
    let folder = rel.rsplit_once('/').map(|(d, _)| d.to_string()).unwrap_or_default();
    let mut e = NoteEntry {
        path: rel.to_string(), title, folder,
        status: None, round: None, tags: vec![], links: vec![], resolved: vec![], ambiguous: vec![],
        mtime, size, snippet: String::new(), unreadable: false,
    };
    if size > MAX_INDEXED { e.unreadable = true; return e; }
    let Ok(text) = std::fs::read_to_string(vault.join(rel)) else { e.unreadable = true; return e };
    let (fm, body) = split_front_matter(&text);
    e.status = status_of(&fm);
    e.round = round_of(&fm);
    e.tags = tags_of(&fm, &body);
    e.links = links_of(&body);
    e.snippet = snippet_of(&body);
    e
}

/// Every link target resolved against the whole vault at once — resolution needs
/// the full path list, so it cannot happen while a note is being parsed.
pub fn fill_resolved(notes: &mut [NoteEntry]) {
    let paths: Vec<String> = notes.iter().map(|n| n.path.clone()).collect();
    for n in notes.iter_mut() {
        let mut resolved = Vec::with_capacity(n.links.len());
        let mut ambiguous = Vec::with_capacity(n.links.len());
        for l in &n.links {
            let (p, amb) = parse::resolve_link(&l.target, &n.path, &paths);
            resolved.push(p);
            ambiguous.push(amb);
        }
        n.resolved = resolved;
        n.ambiguous = ambiguous;
    }
}

impl NotesState {
    pub fn new() -> Self { Self { vaults: Mutex::new(HashMap::new()), refresh_locks: Mutex::new(HashMap::new()) } }
}

/// The per-vault refresh mutex, created on first use. Held by `refresh` for its
/// whole body — the lock lives in its own map so acquiring it never contends
/// with `vaults`, which readers need to stay fast.
fn refresh_lock(state: &NotesState, dir: &Path) -> Arc<Mutex<()>> {
    let mut g = match state.refresh_locks.lock() { Ok(g) => g, Err(e) => e.into_inner() };
    g.entry(dir.to_path_buf()).or_insert_with(|| Arc::new(Mutex::new(()))).clone()
}

/// Walk the vault and reparse whatever moved, then install the result. The walk
/// and every `parse_note` call run with the `vaults` lock released — only the
/// snapshot of the previous entries (cheap: a clone of what's already in memory)
/// and the final swap take it, each briefly. The per-vault `refresh_lock` is
/// held for the whole call so two concurrent refreshes of the same vault can
/// never interleave: the second one's walk starts only after the first has
/// already installed its result, so the index can never regress to an older
/// snapshot at a newer generation.
pub fn refresh(state: &NotesState, dir: &Path) -> (Vec<String>, u64) {
    let serial = refresh_lock(state, dir);
    let _serial = match serial.lock() { Ok(g) => g, Err(e) => e.into_inner() };

    let vault = vault_dir(dir);
    let on_disk = walk(&vault);

    let (old, prev_generation, prev_len): (HashMap<String, NoteEntry>, u64, usize) = {
        let guard = match state.vaults.lock() { Ok(g) => g, Err(e) => e.into_inner() };
        match guard.get(dir) {
            Some(v) => (v.notes.iter().map(|n| (n.path.clone(), n.clone())).collect(), v.generation, v.notes.len()),
            None => (HashMap::new(), 0, 0),
        }
    };

    let mut changed: Vec<String> = Vec::new();
    let mut next: Vec<NoteEntry> = Vec::with_capacity(on_disk.len());
    for (rel, mtime, size) in &on_disk {
        match old.get(rel) {
            Some(prev) if prev.mtime == *mtime && prev.size == *size => next.push(prev.clone()),
            _ => { changed.push(rel.clone()); next.push(parse_note(&vault, rel, *mtime, *size)); }
        }
    }
    let seen: std::collections::HashSet<&String> = on_disk.iter().map(|(r, _, _)| r).collect();
    for gone in old.keys().filter(|p| !seen.contains(p)) { changed.push((*gone).clone()); }
    if changed.is_empty() && next.len() == prev_len { return (vec![], prev_generation); }
    fill_resolved(&mut next);
    next.sort_by(|a, b| a.path.cmp(&b.path));

    let mut guard = match state.vaults.lock() { Ok(g) => g, Err(e) => e.into_inner() };
    let v = guard.entry(dir.to_path_buf()).or_insert_with(|| Vault { notes: vec![], generation: 0 });
    v.notes = next;
    v.generation += 1;
    (changed, v.generation)
}

pub fn snapshot(state: &NotesState, dir: &Path) -> NotesIndex {
    ensure(state, dir);
    let guard = match state.vaults.lock() { Ok(g) => g, Err(e) => e.into_inner() };
    match guard.get(dir) {
        Some(v) => NotesIndex { notes: v.notes.clone(), generation: v.generation },
        None => NotesIndex { notes: vec![], generation: 0 },
    }
}

pub fn generation(state: &NotesState, dir: &Path) -> u64 {
    ensure(state, dir);
    let guard = match state.vaults.lock() { Ok(g) => g, Err(e) => e.into_inner() };
    guard.get(dir).map(|v| v.generation).unwrap_or(0)
}

/// First look at a project builds the index; later looks are free.
fn ensure(state: &NotesState, dir: &Path) {
    let known = { match state.vaults.lock() { Ok(g) => g.contains_key(dir), Err(e) => e.into_inner().contains_key(dir) } };
    if !known { refresh(state, dir); }
}

pub fn emit_changed(app: &tauri::AppHandle, dir: &str, paths: &[String], generation: u64) {
    let _ = app.emit_to(EventTarget::webview("main"), "notes-changed",
        serde_json::json!({ "dir": dir, "paths": paths, "generation": generation }));
}

pub fn evict(state: &NotesState, dir: &Path) {
    if let Ok(mut g) = state.vaults.lock() { g.remove(dir); }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("chronicle-notes-{}-{}", name, std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(d.join(".chronicle/notes")).unwrap();
        d.canonicalize().unwrap()
    }
    fn write(dir: &Path, rel: &str, text: &str) {
        let p = vault_dir(dir).join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, text).unwrap();
    }

    #[test]
    fn the_walk_finds_md_files_and_skips_hidden_and_trash() {
        let d = tmp("walk");
        write(&d, "Root.md", "a");
        write(&d, "Design/Deep/Nested.md", "b");
        write(&d, "notes.txt", "not markdown");
        write(&d, ".hidden/Secret.md", "no");
        write(&d, "trash/Old.md", "no");
        let mut got: Vec<String> = walk(&vault_dir(&d)).into_iter().map(|(p, _, _)| p).collect();
        got.sort();
        assert_eq!(got, vec!["Design/Deep/Nested.md", "Root.md"]);
    }

    #[test]
    fn a_missing_vault_walks_to_nothing() {
        let d = std::env::temp_dir().join(format!("chronicle-notes-none-{}", std::process::id()));
        assert!(walk(&vault_dir(&d)).is_empty());
    }

    #[test]
    fn an_entry_carries_the_front_matter_the_tags_and_the_links() {
        let d = tmp("entry");
        write(&d, "Tasks/T-012 Login.md",
              "---\nstatus: in_progress\nround: 4\ntags: [bug]\n---\n\nSee [[Energy budget]] and #ui.\n");
        write(&d, "Design/Energy budget.md", "budget\n");
        let mut notes: Vec<NoteEntry> = walk(&vault_dir(&d)).into_iter()
            .map(|(p, m, s)| parse_note(&vault_dir(&d), &p, m, s)).collect();
        fill_resolved(&mut notes);
        let e = notes.iter().find(|n| n.path == "Tasks/T-012 Login.md").unwrap();
        assert_eq!(e.title, "T-012 Login");
        assert_eq!(e.folder, "Tasks");
        assert_eq!(e.status.as_deref(), Some("in_progress"));
        assert_eq!(e.round, Some(4));
        assert_eq!(e.tags, vec!["bug", "ui"]);
        assert_eq!(e.links.len(), 1);
        assert_eq!(e.resolved, vec![Some("Design/Energy budget.md".to_string())]);
        assert_eq!(e.ambiguous, vec![false]);
        assert_eq!(e.snippet, "See [[Energy budget]] and #ui.");
        assert!(!e.unreadable);
        let root = notes.iter().find(|n| n.path == "Design/Energy budget.md").unwrap();
        assert_eq!(root.status, None);
    }

    #[test]
    fn a_missing_link_resolves_to_none() {
        let d = tmp("missing");
        write(&d, "A.md", "[[Nowhere]]\n");
        let mut notes: Vec<NoteEntry> = walk(&vault_dir(&d)).into_iter()
            .map(|(p, m, s)| parse_note(&vault_dir(&d), &p, m, s)).collect();
        fill_resolved(&mut notes);
        assert_eq!(notes[0].resolved, vec![None]);
    }

    #[test]
    fn refresh_bumps_the_generation_only_when_something_moved() {
        let d = tmp("gen");
        write(&d, "A.md", "one\n");
        let st = NotesState::new();
        let (paths, g1) = refresh(&st, &d);
        assert_eq!(paths, vec!["A.md"]);
        assert_eq!(g1, 1);
        let (paths2, g2) = refresh(&st, &d);
        assert!(paths2.is_empty(), "nothing changed");
        assert_eq!(g2, 1, "an unchanged vault costs the frontend nothing");
        std::thread::sleep(std::time::Duration::from_millis(1100)); // mtime has 1s resolution on some fs
        write(&d, "A.md", "one and two\n");
        let (paths3, g3) = refresh(&st, &d);
        assert_eq!(paths3, vec!["A.md"]);
        assert_eq!(g3, 2);
        assert_eq!(snapshot(&st, &d).notes[0].snippet, "one and two");
    }

    /// Two threads racing `refresh` on the same vault must never let the one
    /// that started first (and so may still be walking/parsing) install its
    /// result AFTER the one that started second and already has the newer
    /// body — that would regress the index to stale content at a higher
    /// generation, with nothing to repair it. The per-vault `refresh_lock`
    /// (index.rs) exists to rule this out: it serialises the whole
    /// walk+parse+swap, so whichever refresh finishes last always finishes
    /// having walked the vault after the other one's swap completed.
    #[test]
    fn two_concurrent_refreshes_after_a_write_leave_the_newer_body_in_the_index() {
        let d = tmp("racing-refresh");
        write(&d, "A.md", "one\n");
        let st = Arc::new(NotesState::new());
        refresh(&st, &d);
        std::thread::sleep(std::time::Duration::from_millis(1100)); // mtime has 1s resolution on some fs
        write(&d, "A.md", "one and two\n");

        let handles: Vec<_> = (0..2).map(|_| {
            let st = st.clone();
            let d = d.clone();
            std::thread::spawn(move || refresh(&st, &d))
        }).collect();
        for h in handles { h.join().unwrap(); }

        let idx = snapshot(&st, &d);
        assert_eq!(idx.notes[0].snippet, "one and two",
                   "the newer body must survive two concurrent refreshes, never regress to the older one");
    }

    #[test]
    fn a_vanished_path_is_removed_and_a_new_one_added() {
        let d = tmp("rename");
        write(&d, "Old.md", "x\n");
        let st = NotesState::new();
        refresh(&st, &d);
        std::fs::rename(vault_dir(&d).join("Old.md"), vault_dir(&d).join("New.md")).unwrap();
        let (mut paths, _) = refresh(&st, &d);
        paths.sort();
        assert_eq!(paths, vec!["New.md", "Old.md"]);
        let idx = snapshot(&st, &d);
        assert_eq!(idx.notes.len(), 1);
        assert_eq!(idx.notes[0].path, "New.md");
    }

    #[test]
    fn a_huge_file_is_indexed_by_name_only() {
        let d = tmp("huge");
        write(&d, "Big.md", &"z".repeat(4 * 1024 * 1024 + 10));
        let st = NotesState::new();
        refresh(&st, &d);
        let e = &snapshot(&st, &d).notes[0];
        assert!(e.unreadable);
        assert_eq!(e.title, "Big");
        assert!(e.tags.is_empty() && e.links.is_empty() && e.snippet.is_empty());
    }
}
