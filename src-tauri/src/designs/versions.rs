//! One snapshot per director turn, only when the design's content changed.
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

const CONTENT: [&str; 3] = ["design.json", "frames", "assets"];

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct VersionMeta { pub n: u32, pub at: String, pub session: String, pub prompt: String, pub summary: String, pub hash: String }

/// Collects files under `base.join(rel)`, recording paths relative to `base`.
/// Symlinks are skipped rather than followed: a symlink planted inside
/// `frames/` or `assets/` must never let a snapshot, restore, or branch read
/// or copy content from outside the design directory.
fn files_under(base: &Path, rel: &str, out: &mut Vec<String>) {
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

fn copy_content(from: &Path, to: &Path) -> Result<(), String> {
    for c in CONTENT {
        let src = from.join(c);
        let dst = to.join(c);
        if dst.is_dir() { std::fs::remove_dir_all(&dst).map_err(|e| e.to_string())?; }
        else if dst.is_file() { std::fs::remove_file(&dst).map_err(|e| e.to_string())?; }
        let src_meta = std::fs::symlink_metadata(&src).ok();
        let src_is_symlink = src_meta.as_ref().map(|m| m.file_type().is_symlink()).unwrap_or(false);
        if src_is_symlink {
            // Never follow a symlink at the top of a content root either.
            continue;
        } else if src.is_file() {
            std::fs::copy(&src, &dst).map_err(|e| e.to_string())?;
        } else if src.is_dir() {
            let mut files = Vec::new();
            files_under(from, c, &mut files);
            std::fs::create_dir_all(&dst).map_err(|e| e.to_string())?;
            for f in files {
                let t = to.join(&f);
                if let Some(parent) = t.parent() { std::fs::create_dir_all(parent).map_err(|e| e.to_string())?; }
                std::fs::copy(from.join(&f), &t).map_err(|e| e.to_string())?;
            }
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
    let hash = content_hash(design_dir);
    let prev = list(design_dir);
    if prev.first().map(|m| m.hash == hash).unwrap_or(false) { return Ok(None); }
    let n = prev.first().map(|m| m.n + 1).unwrap_or(1);
    write_version(design_dir, &VersionMeta { n, at: at.into(), session: session.into(), prompt: prompt.into(), summary: summary.into(), hash })?;
    Ok(Some(n))
}

pub fn restore(design_dir: &Path, n: u32, at: &str) -> Result<u32, String> {
    let vd = versions_dir(design_dir).join(format!("v{n}"));
    if !vd.join("meta.json").is_file() { return Err(format!("there's no version {n}")); }
    copy_content(&vd, design_dir)?;
    let hash = content_hash(design_dir);
    let next = latest(design_dir).unwrap_or(0) + 1;
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
}
