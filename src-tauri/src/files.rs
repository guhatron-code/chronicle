//! Reading and CHANGING files inside a project. Everything here goes through the
//! same jail as `list_dir`, refuses `.git/` and `node_modules/` outright, writes
//! atomically (temp file beside the target, then rename), and deletes to the
//! user's Trash — never `rm`, never an unlink the user cannot undo from Finder.

use crate::{OpenRoots, Project};
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::State;

#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct ReadFile {
    pub text: String,
    pub mtime_ms: u64,
    pub size: u64,
    pub binary: bool,
    pub too_large: bool,
}

/// Past this the viewer shows the "too large" body and offers no edit affordance.
pub const MAX_EDIT_BYTES: u64 = 4 * 1024 * 1024;

/// `.git/` and `node_modules/` are off limits to every write, and `.git/` to
/// reads-for-editing as well. Segment-exact: `.gitignore` and a folder called
/// `node_modules_helper` are ordinary files.
pub fn refused(rel: &str) -> Option<String> {
    for seg in rel.split('/') {
        if seg == ".git" { return Some("that's git's own folder — Chronicle won't touch it".into()); }
        if seg == "node_modules" { return Some("node_modules is installed, not written — leave it to npm".into()); }
    }
    None
}

/// The jail for a path that may not exist yet: canonicalise the deepest existing
/// ancestor, then require it to sit under one of the project's roots. A symlinked
/// parent that leaves the project is refused even when the leaf is new.
///
/// `.chronicle/…` resolves against `p.dir`, not `p.repo`, exactly as `crate::jailed`
/// does: notes and attachments live beside the manifest, and in a sub-project the
/// manifest folder is not the repo root.
pub fn jailed_target(p: &Project, rel: &str) -> Result<PathBuf, String> {
    if rel.is_empty() || rel.starts_with('/') || rel.contains('\0') || rel.split('/').any(|s| s == "..") {
        return Err("that path isn't inside this project".into());
    }
    let base = if rel == ".chronicle" || rel.starts_with(".chronicle/") { &p.dir } else { &p.repo };
    let full = base.join(rel);
    let mut probe = full.clone();
    while !probe.exists() {
        match probe.parent() { Some(par) => probe = par.to_path_buf(), None => break }
    }
    let real = probe.canonicalize().map_err(|_| "that path isn't inside this project".to_string())?;
    let mut roots: Vec<PathBuf> = vec![p.repo.clone(), p.dir.clone()];
    roots.extend(p.extras.iter().map(|(_, b)| b.clone()));
    let inside = roots.iter().filter_map(|r| r.canonicalize().ok()).any(|r| real.starts_with(&r));
    if !inside { return Err("that path isn't inside this project".into()); }
    if full.symlink_metadata().map(|m| m.file_type().is_symlink()).unwrap_or(false) {
        return Err("that path isn't inside this project".into());
    }
    Ok(full)
}

// The helpers below are what the tests drive, not the Tauri commands — a command
// takes `State<'_, OpenRoots>`, which no unit test can build. The commands are
// two-line wrappers over exactly these, which is the shape `notes/mod.rs` already
// uses (`write_note` / `move_note` / `delete_note` behind `notes_write` /
// `notes_move` / `notes_delete`).
pub(crate) fn mtime_ms_of(full: &Path) -> Result<u64, String> {
    let md = std::fs::metadata(full).map_err(|e| e.to_string())?;
    let t = md.modified().map_err(|e| e.to_string())?;
    Ok(t.duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0))
}

pub(crate) fn read_at(p: &Project, rel: &str) -> Result<ReadFile, String> {
    if rel.split('/').any(|s| s == ".git") {
        return Err("that's git's own folder — Chronicle won't touch it".into());
    }
    let full = jailed_target(p, rel)?;
    let md = std::fs::metadata(&full).map_err(|e| e.to_string())?;
    let size = md.len();
    let mtime_ms = mtime_ms_of(&full)?;
    if size > MAX_EDIT_BYTES {
        return Ok(ReadFile { text: String::new(), mtime_ms, size, binary: false, too_large: true });
    }
    // the sniff is the viewer's existing one: a NUL in the first 8 KiB
    let mut head = [0u8; 8192];
    let n = std::fs::File::open(&full)
        .and_then(|mut f| std::io::Read::read(&mut f, &mut head)).unwrap_or(0);
    if head[..n].contains(&0) {
        return Ok(ReadFile { text: String::new(), mtime_ms, size, binary: true, too_large: false });
    }
    let bytes = std::fs::read(&full).map_err(|e| e.to_string())?;
    match String::from_utf8(bytes) {
        Ok(text) => Ok(ReadFile { text, mtime_ms, size, binary: false, too_large: false }),
        // valid-UTF-8 is the editable contract; anything else is "binary" here
        Err(_) => Ok(ReadFile { text: String::new(), mtime_ms, size, binary: true, too_large: false }),
    }
}

/// Temp file beside the target, then rename — a crash mid-write can never leave
/// a truncated source file. The mode bits are copied onto the temp file BEFORE
/// the rename, so an executable script stays executable.
pub(crate) fn write_at(p: &Project, rel: &str, text: &str, expected_mtime_ms: Option<u64>) -> Result<u64, String> {
    if let Some(why) = refused(rel) { return Err(why); }
    let full = jailed_target(p, rel)?;
    let existed = full.exists();
    if let Some(expected) = expected_mtime_ms {
        if !existed { return Err("changed on disk".into()); }
        if mtime_ms_of(&full)? != expected { return Err("changed on disk".into()); }
    }
    let parent = full.parent().ok_or("that path has no folder")?;
    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let name = full.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    let tmp = tmp_beside(parent, &name);
    std::fs::write(&tmp, text).map_err(|e| e.to_string())?;
    if existed {
        if let Ok(md) = std::fs::metadata(&full) {
            let _ = std::fs::set_permissions(&tmp, md.permissions());
        }
    }
    // check again with the temp already written: the gap between the precondition
    // and the rename is now one syscall wide instead of one whole file write.
    if let Some(expected) = expected_mtime_ms {
        if mtime_ms_of(&full).unwrap_or(0) != expected {
            let _ = std::fs::remove_file(&tmp);
            return Err("changed on disk".into());
        }
    }
    if let Err(e) = std::fs::rename(&tmp, &full) {
        let _ = std::fs::remove_file(&tmp); // only OUR temp, never a neighbour's
        return Err(e.to_string());
    }
    mtime_ms_of(&full)
}

/// A temp name no other save can be holding: the pid plus a per-process counter.
/// A fixed `.{name}.chronicle-tmp` meant two saves of the same file in flight at
/// once wrote over each other's temp — and the loser's cleanup deleted the
/// winner's, or worse, half of one file's bytes landed under the other's name.
fn tmp_beside(parent: &Path, name: &str) -> PathBuf {
    use std::sync::atomic::{AtomicU64, Ordering};
    static SEQ: AtomicU64 = AtomicU64::new(0);
    let n = SEQ.fetch_add(1, Ordering::Relaxed);
    parent.join(format!(".{name}.{}-{n}.chronicle-tmp", std::process::id()))
}

pub(crate) fn create_at(p: &Project, rel: &str, kind: &str) -> Result<(), String> {
    if let Some(why) = refused(rel) { return Err(why); }
    let full = jailed_target(p, rel)?;
    if full.exists() { return Err("something with that name is already there".into()); }
    match kind {
        "dir" => std::fs::create_dir_all(&full).map_err(|e| e.to_string()),
        "file" => {
            if let Some(parent) = full.parent() { std::fs::create_dir_all(parent).map_err(|e| e.to_string())?; }
            std::fs::write(&full, "").map_err(|e| e.to_string())
        }
        _ => Err("a new thing is either a file or a folder".into()),
    }
}

pub(crate) fn rename_at(p: &Project, from: &str, to: &str) -> Result<(), String> {
    if let Some(why) = refused(from) { return Err(why); }
    if let Some(why) = refused(to) { return Err(why); }
    let src = jailed_target(p, from)?;
    let dst = jailed_target(p, to)?;
    if !src.exists() { return Err("that file isn't there anymore".into()); }
    // APFS is case-insensitive by default, so `a.txt` and `A.txt` are the SAME file
    // and `exists()` calls a rename that only changes the case a collision. Same
    // device + same inode means the "collision" is the file we are moving.
    if dst.exists() && !same_file(&src, &dst) {
        return Err("something with that name is already there".into());
    }
    if let Some(parent) = dst.parent() { std::fs::create_dir_all(parent).map_err(|e| e.to_string())?; }
    std::fs::rename(&src, &dst).map_err(|e| e.to_string())
}

/// Two paths that name one file on disk — the case-only rename above, and any
/// hard link. Metadata that won't read is not a match; the caller refuses then.
fn same_file(a: &Path, b: &Path) -> bool {
    use std::os::unix::fs::MetadataExt;
    match (std::fs::metadata(a), std::fs::metadata(b)) {
        (Ok(x), Ok(y)) => x.dev() == y.dev() && x.ino() == y.ino(),
        _ => false,
    }
}

/// Finder's Trash, restorable with ⌘Z in Finder. If the Trash is unavailable
/// (a network volume, a sandboxed path) this REFUSES — it never falls back to
/// deleting the file, because that is the one mistake nobody can undo.
pub(crate) fn trash_at(p: &Project, rel: &str) -> Result<(), String> {
    if let Some(why) = refused(rel) { return Err(why); }
    let full = jailed_target(p, rel)?;
    if !full.exists() { return Err("that file isn't there anymore".into()); }
    trash::delete(&full).map_err(|e| format!("couldn't move it to the Trash — {e}"))
}

#[tauri::command]
pub async fn read_file(roots: State<'_, OpenRoots>, dir: String, path: String) -> Result<ReadFile, String> {
    let p = crate::project_for(&roots, &dir)?;
    read_at(&p, &path)
}

#[tauri::command]
pub async fn write_file(roots: State<'_, OpenRoots>, dir: String, path: String, text: String,
                        expected_mtime_ms: Option<u64>) -> Result<u64, String> {
    let p = crate::project_for(&roots, &dir)?;
    write_at(&p, &path, &text, expected_mtime_ms)
}

#[tauri::command]
pub async fn create_path(roots: State<'_, OpenRoots>, dir: String, path: String, kind: String) -> Result<(), String> {
    let p = crate::project_for(&roots, &dir)?;
    create_at(&p, &path, &kind)
}

#[tauri::command]
pub async fn rename_path(roots: State<'_, OpenRoots>, dir: String, from: String, to: String) -> Result<(), String> {
    let p = crate::project_for(&roots, &dir)?;
    rename_at(&p, &from, &to)
}

#[tauri::command]
pub async fn trash_path(roots: State<'_, OpenRoots>, dir: String, path: String) -> Result<(), String> {
    let p = crate::project_for(&roots, &dir)?;
    trash_at(&p, &path)
}

/// Finder, at the file. The absolute binary and an argument vector — never a
/// shell line, and never a bare name resolved through the inherited PATH.
#[tauri::command]
pub async fn reveal_path(roots: State<'_, OpenRoots>, dir: String, path: String) -> Result<(), String> {
    let p = crate::project_for(&roots, &dir)?;
    let full = jailed_target(&p, &path)?;
    if !full.exists() { return Err("that file isn't there anymore".into()); }
    std::process::Command::new("/usr/bin/open").arg("-R").arg(&full).output().map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn proj(name: &str) -> (PathBuf, Project) {
        let d = std::env::temp_dir().join(format!("chronicle-files-{}-{}", name, std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        let d = d.canonicalize().unwrap();
        let p = Project {
            dir: d.clone(), repo: d.clone(), extras: vec![],
            manifest: None, manifest_error: None,
        };
        (d, p)
    }

    #[test]
    fn the_two_refusals_are_absolute() {
        for bad in [".git/config", ".git", "a/.git/HEAD", "node_modules/x/index.js", "node_modules"] {
            assert!(refused(bad).is_some(), "{bad} must be refused");
        }
        for ok in ["src/main.rs", ".gitignore", "my.git.notes", "node_modules_helper/x.ts"] {
            assert!(refused(ok).is_none(), "{ok} must be allowed");
        }
    }

    #[test]
    fn the_jail_refuses_absolute_dotdot_and_symlinked_escapes() {
        let (root, p) = proj("jail");
        let outside = root.parent().unwrap().join(format!("chronicle-files-outside-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&outside);
        std::fs::create_dir_all(&outside).unwrap();

        assert!(jailed_target(&p, "/etc/passwd").is_err());
        assert!(jailed_target(&p, "../escape.txt").is_err());
        assert!(jailed_target(&p, "a/../../escape.txt").is_err());
        // a symlinked PARENT must be refused even though the leaf is new
        std::os::unix::fs::symlink(&outside, root.join("link")).unwrap();
        assert!(jailed_target(&p, "link/new.txt").is_err());
        // a path that does not exist yet, inside the root, resolves
        assert!(jailed_target(&p, "fresh/deep/new.txt").is_ok());
        let _ = std::fs::remove_dir_all(&outside);
    }

    #[test]
    fn write_is_atomic_keeps_the_mode_and_honours_the_precondition() {
        use std::os::unix::fs::PermissionsExt;
        let (root, p) = proj("write");
        let f = root.join("a.sh");
        std::fs::write(&f, "one\n").unwrap();
        std::fs::set_permissions(&f, std::fs::Permissions::from_mode(0o755)).unwrap();
        let before = mtime_ms_of(&f).unwrap();

        // no precondition: writes, returns a new mtime, leaves 0755
        let m1 = write_at(&p, "a.sh", "two\n", None).unwrap();
        assert_eq!(std::fs::read_to_string(&f).unwrap(), "two\n");
        assert_eq!(std::fs::metadata(&f).unwrap().permissions().mode() & 0o777, 0o755);
        assert!(m1 >= before);
        // no .tmp survives
        let leftovers: Vec<_> = std::fs::read_dir(&root).unwrap().flatten()
            .filter(|e| e.file_name().to_string_lossy().contains(".tmp")).collect();
        assert!(leftovers.is_empty(), "a temp file survived the write");

        // the right precondition: accepted
        let m2 = write_at(&p, "a.sh", "three\n", Some(m1)).unwrap();
        assert_eq!(std::fs::read_to_string(&f).unwrap(), "three\n");

        // a stale precondition: refused with the exact sentence, file untouched
        let err = write_at(&p, "a.sh", "four\n", Some(m2.saturating_sub(5_000))).unwrap_err();
        assert_eq!(err, "changed on disk");
        assert_eq!(std::fs::read_to_string(&f).unwrap(), "three\n");
    }

    #[test]
    fn read_sniffs_binary_and_caps_the_size() {
        let (root, p) = proj("read");
        std::fs::write(root.join("t.txt"), "hello\n").unwrap();
        let r = read_at(&p, "t.txt").unwrap();
        assert_eq!(r.text, "hello\n");
        assert!(!r.binary && !r.too_large);
        assert_eq!(r.size, 6);
        assert!(r.mtime_ms > 1_600_000_000_000);

        // a NUL inside the first 8 KiB
        let mut bytes = vec![b'a'; 100];
        bytes[50] = 0;
        std::fs::write(root.join("b.bin"), &bytes).unwrap();
        let r = read_at(&p, "b.bin").unwrap();
        assert!(r.binary);
        assert_eq!(r.text, "");

        // a NUL AFTER the first 8 KiB is not sniffed — it is still read as text
        let mut late = vec![b'a'; 9000];
        late[8500] = 0;
        std::fs::write(root.join("c.bin"), &late).unwrap();
        assert!(!read_at(&p, "c.bin").unwrap().binary);

        // over the cap
        std::fs::write(root.join("big.txt"), vec![b'x'; (MAX_EDIT_BYTES + 1) as usize]).unwrap();
        let r = read_at(&p, "big.txt").unwrap();
        assert!(r.too_large);
        assert_eq!(r.text, "");
        assert_eq!(r.size, MAX_EDIT_BYTES + 1);
    }

    #[test]
    fn create_refuses_a_collision_and_makes_parents() {
        let (root, p) = proj("create");
        create_at(&p, "docs/deep/new.md", "file").unwrap();
        assert!(root.join("docs/deep/new.md").is_file());
        assert_eq!(std::fs::read_to_string(root.join("docs/deep/new.md")).unwrap(), "");
        assert!(create_at(&p, "docs/deep/new.md", "file").is_err(), "a collision must refuse");
        create_at(&p, "docs/empty", "dir").unwrap();
        assert!(root.join("docs/empty").is_dir());
        assert!(create_at(&p, ".git/hook", "file").is_err());
        assert!(create_at(&p, "node_modules/x", "dir").is_err());
    }

    #[test]
    fn rename_refuses_an_existing_target_and_both_refusals() {
        let (root, p) = proj("rename");
        std::fs::write(root.join("a.txt"), "a\n").unwrap();
        std::fs::write(root.join("b.txt"), "b\n").unwrap();
        assert!(rename_at(&p, "a.txt", "b.txt").is_err(), "must not clobber");
        rename_at(&p, "a.txt", "sub/c.txt").unwrap();
        assert!(root.join("sub/c.txt").is_file());
        assert!(!root.join("a.txt").exists());
        std::fs::create_dir_all(root.join("node_modules")).unwrap();
        assert!(rename_at(&p, "b.txt", "node_modules/b.txt").is_err());
    }

    #[test]
    fn trash_moves_the_file_out_and_never_unlinks_on_failure() {
        let (root, p) = proj("trash");
        // the refusals cost nothing and always run
        std::fs::create_dir_all(root.join(".git")).unwrap();
        std::fs::write(root.join(".git/HEAD"), "ref\n").unwrap();
        assert!(trash_at(&p, ".git/HEAD").is_err());
        assert!(root.join(".git/HEAD").exists(), "a refusal never deletes");
        std::fs::create_dir_all(root.join("node_modules")).unwrap();
        std::fs::write(root.join("node_modules/x.js"), "x\n").unwrap();
        assert!(trash_at(&p, "node_modules/x.js").is_err());
        assert!(root.join("node_modules/x.js").exists(), "a refusal never deletes");
        assert!(trash_at(&p, "../outside.txt").is_err(), "the jail applies here too");
        assert!(trash_at(&p, "never-was.txt").is_err());

        // The move itself puts a file in whoever is running this suite's Trash, so
        // it is opt-in: CHRONICLE_TRASH_TEST=1 cargo test files::
        if std::env::var("CHRONICLE_TRASH_TEST").as_deref() != Ok("1") {
            eprintln!("note: skipping the real Trash move — set CHRONICLE_TRASH_TEST=1 to run it");
            return;
        }
        std::fs::write(root.join("bye.txt"), "bye\n").unwrap();
        trash_at(&p, "bye.txt").unwrap();
        assert!(!root.join("bye.txt").exists(), "the file left the project");
    }

    /// THE BUG: a fixed `.{name}.chronicle-tmp` is the same path for every writer,
    /// so two saves of one file in flight at once shared a temp — and the loser's
    /// cleanup deleted the winner's.
    #[test]
    fn two_writers_of_one_file_never_share_a_temp() {
        let (root, p) = proj("tmp");
        assert_ne!(tmp_beside(&root, "shared.txt"), tmp_beside(&root, "shared.txt"));

        std::fs::write(root.join("shared.txt"), "one\n").unwrap();
        let other = p.clone();
        let h = std::thread::spawn(move || {
            for _ in 0..40 { write_at(&other, "shared.txt", "thread\n", None).unwrap(); }
        });
        for _ in 0..40 { write_at(&p, "shared.txt", "main\n", None).unwrap(); }
        h.join().unwrap();

        let leftovers: Vec<_> = std::fs::read_dir(&root).unwrap().flatten()
            .filter(|e| e.file_name().to_string_lossy().contains("chronicle-tmp")).collect();
        assert!(leftovers.is_empty(), "a temp file survived concurrent writes: {leftovers:?}");
        let body = std::fs::read_to_string(root.join("shared.txt")).unwrap();
        assert!(body == "thread\n" || body == "main\n", "a torn write: {body:?}");
    }

    /// APFS is case-insensitive by default, so `A.txt` "exists" the moment `a.txt`
    /// does. Renaming a file to its own name in another case is not a collision.
    #[test]
    fn a_case_only_rename_is_not_a_collision() {
        let (root, p) = proj("case");
        std::fs::write(root.join("a.txt"), "a\n").unwrap();
        rename_at(&p, "a.txt", "A.txt").unwrap();
        let names: Vec<String> = std::fs::read_dir(&root).unwrap().flatten()
            .map(|e| e.file_name().to_string_lossy().to_string()).collect();
        assert!(names.contains(&"A.txt".to_string()), "the new case did not stick: {names:?}");
        assert_eq!(std::fs::read_to_string(root.join("A.txt")).unwrap(), "a\n");
        // a real collision is still refused
        std::fs::write(root.join("b.txt"), "b\n").unwrap();
        assert!(rename_at(&p, "b.txt", "A.txt").is_err());
    }

    /// `.chronicle/…` lives beside the MANIFEST, which in a sub-project is not the
    /// repo root — the same split `crate::jailed` makes.
    #[test]
    fn dot_chronicle_resolves_against_the_manifest_folder() {
        let (root, _) = proj("subproject");
        let repo = root.join("repo");
        std::fs::create_dir_all(&repo).unwrap();
        let p = Project {
            dir: root.clone(), repo: repo.clone(), extras: vec![],
            manifest: None, manifest_error: None,
        };
        assert_eq!(jailed_target(&p, ".chronicle/notes/A.md").unwrap(), root.join(".chronicle/notes/A.md"));
        assert_eq!(jailed_target(&p, ".chronicle").unwrap(), root.join(".chronicle"));
        // everything else still resolves against the repo root
        assert_eq!(jailed_target(&p, "src/main.rs").unwrap(), repo.join("src/main.rs"));
        // and the lookalike is an ordinary file in the repo
        assert_eq!(jailed_target(&p, ".chronicled/x").unwrap(), repo.join(".chronicled/x"));
    }
}
