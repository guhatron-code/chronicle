//! One snapshot per director turn, only when the design's content changed.
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

const CONTENT: [&str; 3] = ["design.json", "frames", "assets"];
/// Suffix for a temp sibling used while atomically swapping a content root
/// into place (see `swap_content_atomically`). Never part of `CONTENT`, so
/// `content_hash`/`files_under` naturally skip it; the guard in
/// `files_under` below makes that explicit rather than incidental.
const RESTORE_TMP_SUFFIX: &str = ".restore-tmp";

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct VersionMeta { pub n: u32, pub at: String, pub session: String, pub prompt: String, pub summary: String, pub hash: String }

/// Collects files under `base.join(rel)`, recording paths relative to `base`.
/// Symlinks are skipped rather than followed: a symlink planted inside
/// `frames/` or `assets/` must never let a snapshot, restore, or branch read
/// or copy content from outside the design directory.
fn files_under(base: &Path, rel: &str, out: &mut Vec<String>) {
    if rel.ends_with(RESTORE_TMP_SUFFIX) { return; }
    let p = base.join(rel);
    let Ok(meta) = std::fs::symlink_metadata(&p) else { return };
    if meta.file_type().is_symlink() { return; }
    if meta.is_file() { out.push(rel.to_string()); return; }
    if meta.is_dir() {
        if let Ok(rd) = std::fs::read_dir(&p) {
            for e in rd.flatten() {
                let name = e.file_name().to_string_lossy().to_string();
                files_under(base, &format!("{rel}/{name}"), out);
            }
        }
    }
}

pub fn content_hash(design_dir: &Path) -> String {
    let mut files = Vec::new();
    for c in CONTENT { files_under(design_dir, c, &mut files); }
    files.sort();
    let mut h = Sha256::new();
    for f in files {
        h.update(f.as_bytes()); h.update([0u8]);
        h.update(std::fs::read(design_dir.join(&f)).unwrap_or_default()); h.update([0u8]);
    }
    format!("{:x}", h.finalize())
}

fn versions_dir(d: &Path) -> PathBuf { d.join(".versions") }

pub fn list(design_dir: &Path) -> Vec<VersionMeta> {
    let Ok(rd) = std::fs::read_dir(versions_dir(design_dir)) else { return vec![] };
    let mut v: Vec<VersionMeta> = rd.flatten()
        .filter_map(|e| std::fs::read_to_string(e.path().join("meta.json")).ok())
        .filter_map(|t| serde_json::from_str(&t).ok())
        .collect();
    v.sort_by(|a, b| b.n.cmp(&a.n));
    v
}

pub fn latest(design_dir: &Path) -> Option<u32> { list(design_dir).first().map(|m| m.n) }

/// The next version number to hand out: one past the highest `v<n>`
/// *directory name* under `.versions/`, not one past the highest number
/// `list()` can read. `list()` silently drops a version whose `meta.json`
/// is unreadable — using its numbering here would let a fresh snapshot or
/// restore reuse (and overwrite) that damaged version's directory. A
/// damaged version's number stays retired even though it never appears in
/// `list()`.
fn next_version_number(design_dir: &Path) -> u32 {
    let Ok(rd) = std::fs::read_dir(versions_dir(design_dir)) else { return 1 };
    rd.flatten()
        .filter(|e| e.path().is_dir())
        .filter_map(|e| e.file_name().to_string_lossy().strip_prefix('v').and_then(|s| s.parse::<u32>().ok()))
        .max()
        .unwrap_or(0)
        + 1
}

/// Copies `src` (a file, a directory tree, or nothing if it's missing) to
/// `dst`, which must not already exist. Symlinks — at `src` itself or
/// anywhere within it — are skipped rather than followed, so a symlink
/// planted inside `frames/` or `assets/` can never make this read or copy
/// content from outside the design.
fn copy_tree(src: &Path, dst: &Path) -> Result<(), String> {
    let Ok(meta) = std::fs::symlink_metadata(src) else { return Ok(()) };
    if meta.file_type().is_symlink() { return Ok(()); }
    if meta.is_file() {
        std::fs::copy(src, dst).map_err(|e| e.to_string())?;
    } else if meta.is_dir() {
        std::fs::create_dir_all(dst).map_err(|e| e.to_string())?;
        if let Ok(rd) = std::fs::read_dir(src) {
            for e in rd.flatten() {
                let name = e.file_name();
                copy_tree(&src.join(&name), &dst.join(&name))?;
            }
        }
    }
    Ok(())
}

fn copy_content(from: &Path, to: &Path) -> Result<(), String> {
    for c in CONTENT {
        let src = from.join(c);
        let dst = to.join(c);
        if dst.is_dir() { std::fs::remove_dir_all(&dst).map_err(|e| e.to_string())?; }
        else if dst.is_file() { std::fs::remove_file(&dst).map_err(|e| e.to_string())?; }
        copy_tree(&src, &dst)?;
    }
    Ok(())
}

fn restore_tmp_path(design_dir: &Path, c: &str) -> PathBuf {
    design_dir.join(format!("{c}{RESTORE_TMP_SUFFIX}"))
}

/// Removes any stray `<content>.restore-tmp` left beside the live design by
/// a restore that crashed mid-copy. Only `restore` calls this, at its own
/// start, before it starts building its own tmp — never `snapshot_if_changed`,
/// which can race a user-initiated restore and must not delete a tmp that
/// restore is still mid-way through building. `content_hash` never looks at
/// these paths, so a stray tmp can't be mistaken for a change either way;
/// it just needs clearing before a *new* restore starts so it doesn't
/// collide with one.
fn clean_stray_restore_tmp(design_dir: &Path) {
    for c in CONTENT {
        let tmp = restore_tmp_path(design_dir, c);
        match std::fs::symlink_metadata(&tmp) {
            Ok(m) if m.is_dir() => { let _ = std::fs::remove_dir_all(&tmp); }
            Ok(_) => { let _ = std::fs::remove_file(&tmp); }
            Err(_) => {}
        }
    }
}

/// Swaps the live design's content roots for those under `from` (a version
/// directory), one root at a time, atomically per root: the replacement is
/// built completely at a `<root>.restore-tmp` sibling first (a plain
/// temp-file-then-rename for `design.json`, a temp directory for
/// `frames`/`assets`), and only once that copy has fully succeeded is the
/// live root removed and the tmp renamed into place. A crash during the
/// copy — the long part — leaves the live content completely untouched,
/// with at worst a stray `*.restore-tmp` beside it, which the next
/// `restore` clears via `clean_stray_restore_tmp` before it starts.
fn swap_content_atomically(from: &Path, to: &Path) -> Result<(), String> {
    clean_stray_restore_tmp(to);
    for c in CONTENT {
        let src = from.join(c);
        let tmp = restore_tmp_path(to, c);
        copy_tree(&src, &tmp)?;
        let live = to.join(c);
        if live.is_dir() { std::fs::remove_dir_all(&live).map_err(|e| e.to_string())?; }
        else if live.is_file() { std::fs::remove_file(&live).map_err(|e| e.to_string())?; }
        if tmp.exists() {
            std::fs::rename(&tmp, &live).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

fn write_version(design_dir: &Path, meta: &VersionMeta) -> Result<(), String> {
    let vd = versions_dir(design_dir).join(format!("v{}", meta.n));
    std::fs::create_dir_all(&vd).map_err(|e| e.to_string())?;
    copy_content(design_dir, &vd)?;
    std::fs::write(vd.join("meta.json"), serde_json::to_string_pretty(meta).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}

pub fn snapshot_if_changed(design_dir: &Path, at: &str, session: &str, prompt: &str, summary: &str) -> Result<Option<u32>, String> {
    // Deliberately does NOT call clean_stray_restore_tmp: a turn-end
    // snapshot can race a user-initiated restore, and must never delete a
    // `*.restore-tmp` that restore is still mid-way through building.
    // content_hash already ignores those paths by name, so there's nothing
    // for a snapshot to gain by cleaning them up — only restore does, at
    // its own start, before it starts building its own tmp.
    let hash = content_hash(design_dir);
    let prev = list(design_dir);
    if prev.first().map(|m| m.hash == hash).unwrap_or(false) { return Ok(None); }
    let n = next_version_number(design_dir);
    write_version(design_dir, &VersionMeta { n, at: at.into(), session: session.into(), prompt: prompt.into(), summary: summary.into(), hash })?;
    Ok(Some(n))
}

pub fn restore(design_dir: &Path, n: u32, at: &str) -> Result<u32, String> {
    let vd = versions_dir(design_dir).join(format!("v{n}"));
    if !vd.join("meta.json").is_file() { return Err(format!("there's no version {n}")); }
    swap_content_atomically(&vd, design_dir)?;
    let hash = content_hash(design_dir);
    let next = next_version_number(design_dir);
    write_version(design_dir, &VersionMeta { n: next, at: at.into(), session: String::new(), prompt: String::new(), summary: format!("Restored v{n}"), hash })?;
    Ok(next)
}

pub fn branch(project: &Path, slug: &str, n: Option<u32>, at: &str) -> Result<String, String> {
    let src_dir = crate::designs::design_dir(project, slug)?;
    let (from, label) = match n.or_else(|| latest(&src_dir)) {
        Some(v) => (versions_dir(&src_dir).join(format!("v{v}")), format!("Branched from {slug} v{v}")),
        None => (src_dir.clone(), format!("Duplicated from {slug}")),
    };
    if !from.exists() { return Err("there's no such version".into()); }
    let root = crate::designs::ensure_root(project)?;
    let new_slug = crate::designs::unique_slug(&root, slug);
    let dst = root.join(&new_slug);
    std::fs::create_dir_all(&dst).map_err(|e| e.to_string())?;
    copy_content(&from, &dst)?;
    let design_json = dst.join("design.json");
    if let Ok(Some(mut v)) = crate::designs::read_json_or_bad(&design_json) {
        let title = v["title"].as_str().unwrap_or(slug).to_string();
        v["title"] = json!(format!("{title} (copy)"));
        std::fs::write(&design_json, serde_json::to_string_pretty(&v).unwrap()).map_err(|e| e.to_string())?;
    }
    std::fs::write(dst.join("canvas.json"), "{\"positions\":{},\"viewport\":null}").map_err(|e| e.to_string())?;
    snapshot_if_changed(&dst, at, "", "", &label)?;
    Ok(new_slug)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::designs::{create, designs_root};
    fn proj(name: &str) -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("chronicle-versions-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d); std::fs::create_dir_all(&d).unwrap(); d.canonicalize().unwrap()
    }
    #[test]
    fn snapshots_only_on_change_restore_and_branch() {
        let p = proj("v");
        let slug = create(&p, "app", "Home", "b", "t0").unwrap();
        let dir = designs_root(&p).join(&slug);
        std::fs::write(dir.join("frames/a.html"), "<h1>one</h1>").unwrap();
        assert_eq!(snapshot_if_changed(&dir, "t1", "s", "p1", "First draft.").unwrap(), Some(1));
        assert_eq!(snapshot_if_changed(&dir, "t2", "s", "p2", "Nothing.").unwrap(), None, "unchanged → no version");
        std::fs::write(dir.join("frames/a.html"), "<h1>two</h1>").unwrap();
        std::fs::write(dir.join("canvas.json"), "{\"positions\":{\"a\":{\"x\":5,\"y\":5}}}").unwrap();
        assert_eq!(snapshot_if_changed(&dir, "t3", "s", "p3", "Second.").unwrap(), Some(2));
        let l = list(&dir);
        assert_eq!(l.iter().map(|m| m.n).collect::<Vec<_>>(), vec![2, 1]);
        assert_eq!(l[1].summary, "First draft.");
        assert_eq!(restore(&dir, 1, "t4").unwrap(), 3);
        assert_eq!(std::fs::read_to_string(dir.join("frames/a.html")).unwrap(), "<h1>one</h1>");
        assert!(std::fs::read_to_string(dir.join("canvas.json")).unwrap().contains("\"x\":5"), "restore keeps the app's canvas");
        assert_eq!(list(&dir)[0].summary, "Restored v1");
        let b = branch(&p, &slug, Some(2), "t5").unwrap();
        assert_eq!(b, "home-2");
        let bd = designs_root(&p).join(&b);
        assert_eq!(std::fs::read_to_string(bd.join("frames/a.html")).unwrap(), "<h1>two</h1>");
        assert_eq!(latest(&bd), Some(1));
        let dup = branch(&p, &slug, None, "t6").unwrap();
        assert_eq!(std::fs::read_to_string(designs_root(&p).join(&dup).join("frames/a.html")).unwrap(), "<h1>one</h1>");
    }

    #[test]
    fn restore_recovers_from_a_stray_tmp_and_hash_ignores_it() {
        let p = proj("stray-tmp");
        let slug = create(&p, "app", "Stray", "b", "t0").unwrap();
        let dir = designs_root(&p).join(&slug);
        std::fs::write(dir.join("frames/a.html"), "<h1>one</h1>").unwrap();
        assert_eq!(snapshot_if_changed(&dir, "t1", "s", "p1", "v1").unwrap(), Some(1));
        std::fs::write(dir.join("frames/a.html"), "<h1>two</h1>").unwrap();
        assert_eq!(snapshot_if_changed(&dir, "t2", "s", "p2", "v2").unwrap(), Some(2));

        let before = content_hash(&dir);
        // Simulate what a crash mid-restore leaves behind: a stray tmp
        // sibling of a live content root, with content that would change
        // the hash if it were ever counted.
        std::fs::create_dir_all(dir.join("frames.restore-tmp")).unwrap();
        std::fs::write(dir.join("frames.restore-tmp/leftover.html"), "<h1>stray</h1>").unwrap();
        assert_eq!(content_hash(&dir), before, "content_hash must ignore a stray *.restore-tmp sibling");

        // restore must succeed despite the stray tmp, produce the right
        // content, and clean the stray up rather than leaving it behind.
        let n = restore(&dir, 1, "t3").unwrap();
        assert_eq!(n, 3);
        assert_eq!(std::fs::read_to_string(dir.join("frames/a.html")).unwrap(), "<h1>one</h1>");
        assert!(!dir.join("frames.restore-tmp").exists(), "restore must clean up a leftover tmp");
    }

    #[test]
    fn a_damaged_version_keeps_its_number() {
        let p = proj("damaged");
        let slug = create(&p, "app", "Damaged", "b", "t0").unwrap();
        let dir = designs_root(&p).join(&slug);
        std::fs::write(dir.join("frames/a.html"), "<h1>one</h1>").unwrap();
        assert_eq!(snapshot_if_changed(&dir, "t1", "s", "p1", "v1").unwrap(), Some(1));
        std::fs::write(dir.join("frames/a.html"), "<h1>two</h1>").unwrap();
        assert_eq!(snapshot_if_changed(&dir, "t2", "s", "p2", "v2").unwrap(), Some(2));

        // Corrupt v2's meta.json so list()/latest() can no longer see it —
        // simulating a version directory damaged some other way.
        std::fs::write(dir.join(".versions/v2/meta.json"), "{not json").unwrap();
        assert_eq!(list(&dir).iter().map(|m| m.n).collect::<Vec<_>>(), vec![1], "the damaged version drops out of list()");

        std::fs::write(dir.join("frames/a.html"), "<h1>three</h1>").unwrap();
        assert_eq!(snapshot_if_changed(&dir, "t3", "s", "p3", "v3").unwrap(), Some(3), "the next version must not reuse v2's number");

        // v2's directory, though unreadable, must be untouched — not
        // silently overwritten by the v3 snapshot.
        assert_eq!(std::fs::read_to_string(dir.join(".versions/v2/meta.json")).unwrap(), "{not json");
    }

    #[cfg(unix)]
    #[test]
    fn a_symlink_in_frames_is_excluded_from_hash_and_restore() {
        use std::os::unix::fs::symlink;
        let p = proj("symlink");
        let slug = create(&p, "app", "Linked", "b", "t0").unwrap();
        let dir = designs_root(&p).join(&slug);
        std::fs::write(dir.join("frames/a.html"), "<h1>one</h1>").unwrap();
        assert_eq!(snapshot_if_changed(&dir, "t1", "s", "p1", "v1").unwrap(), Some(1));

        let before = content_hash(&dir);

        // A file outside the design directory, and a symlink inside
        // frames/ pointing at it — what a hostile or buggy tool might
        // plant to make content_hash/copy_tree read or copy content from
        // outside the design.
        let outside = p.join("outside-secret.txt");
        std::fs::write(&outside, "must never leave the outside world").unwrap();
        symlink(&outside, dir.join("frames/linked.html")).unwrap();
        assert_eq!(content_hash(&dir), before, "a symlink inside frames/ must not affect content_hash");

        // Even a symlink planted directly inside a version directory (as
        // if it had somehow gotten in some other way) must not let
        // restore copy it back out into the live design.
        symlink(&outside, dir.join(".versions/v1/frames/linked.html")).unwrap();
        let n = restore(&dir, 1, "t2").unwrap();
        assert_eq!(n, 2);
        assert_eq!(std::fs::read_to_string(dir.join("frames/a.html")).unwrap(), "<h1>one</h1>");
        assert!(!dir.join("frames/linked.html").exists(), "restore must not copy a symlink (or its target) out of a version directory");
    }
}
