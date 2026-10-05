//! The Design pane's folder: `.chronicle/designs/` in the project (or the main
//! checkout when the project is a linked worktree). Filled in by later tasks.
use std::path::{Path, PathBuf};
use serde::Serialize;
use serde_json::{json, Value};

pub mod versions;
pub mod frame;
pub mod prompt;
pub mod thumbs;
pub mod watch;
pub mod plugin;
pub mod lint;
pub mod review;

pub const KINDS: [&str; 5] = ["app", "marketing", "deck", "brand", "ecommerce"];

pub fn designs_root(project: &Path) -> PathBuf {
    crate::notes::index::vault_root(project).join(".chronicle/designs")
}

pub fn ensure_root(project: &Path) -> Result<PathBuf, String> {
    let root = designs_root(project);
    std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    let gi = root.join(".gitignore");
    if std::fs::read_to_string(&gi).ok().as_deref() != Some("*\n") {
        std::fs::write(&gi, "*\n").map_err(|e| e.to_string())?;
    }
    Ok(root)
}

pub fn slugify(title: &str) -> String {
    let mut out = String::new();
    let mut dash = false;
    for c in title.to_lowercase().chars() {
        if c.is_ascii_alphanumeric() { out.push(c); dash = false; }
        else if !dash && !out.is_empty() { out.push('-'); dash = true; }
        if out.len() >= 60 { break; }
    }
    let s = out.trim_matches('-').to_string();
    if s.is_empty() { "design".into() } else { s }
}

pub fn valid_slug(s: &str) -> bool {
    !s.is_empty() && s.len() <= 80
        && s.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
        && !s.starts_with('-')
}

pub fn unique_slug(root: &Path, base: &str) -> String {
    if !root.join(base).exists() { return base.to_string(); }
    (2..).map(|n| format!("{base}-{n}")).find(|s| !root.join(s).exists()).unwrap()
}

pub fn design_dir(project: &Path, slug: &str) -> Result<PathBuf, String> {
    if !valid_slug(slug) { return Err("that isn't a design name Chronicle made".into()); }
    let d = designs_root(project).join(slug);
    if !d.is_dir() { return Err("that design isn't here any more".into()); }
    Ok(d)
}

pub fn read_json_or_bad(path: &Path) -> Result<Option<Value>, ()> {
    let Ok(text) = std::fs::read_to_string(path) else { return Ok(None) };
    match serde_json::from_str::<Value>(&text) {
        Ok(v) if v.is_object() => Ok(Some(v)),
        _ => { let _ = std::fs::rename(path, path.with_extension("json.bad")); Err(()) }
    }
}

fn write_json(path: &Path, v: &Value) -> Result<(), String> {
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_string_pretty(v).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, path).map_err(|e| e.to_string())
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DesignRow {
    pub slug: String, pub title: String, pub kind: String, pub frames: usize,
    pub created: String, pub latest_version: Option<u32>, pub updated_ms: u64, pub bad: bool,
}

/// When a design's content last changed: design.json or any file in frames/.
/// Never the design directory's own mtime, and never canvas.json — panning or
/// zooming rewrites canvas.json and must not reorder the sidebar.
fn content_updated_ms(design_dir: &Path, design_json: &Path) -> u64 {
    let mut newest = modified_ms(design_json);
    let mut stack = vec![design_dir.join("frames")];
    while let Some(d) = stack.pop() {
        let Ok(rd) = std::fs::read_dir(&d) else { continue };
        for e in rd.flatten() {
            let Ok(ft) = e.file_type() else { continue };
            if ft.is_dir() { stack.push(e.path()); } else if ft.is_file() { newest = newest.max(modified_ms(&e.path())); }
        }
    }
    newest
}

fn modified_ms(p: &Path) -> u64 {
    std::fs::metadata(p).and_then(|m| m.modified()).ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis() as u64).unwrap_or(0)
}

pub fn list(project: &Path) -> Vec<DesignRow> {
    let root = designs_root(project);
    let Ok(rd) = std::fs::read_dir(&root) else { return vec![] };
    let mut rows: Vec<DesignRow> = rd.flatten()
        .filter(|e| e.path().is_dir())
        .filter_map(|e| {
            let slug = e.file_name().to_string_lossy().to_string();
            if !valid_slug(&slug) { return None; }
            let f = e.path().join("design.json");
            let (d, bad) = match read_json_or_bad(&f) {
                Ok(Some(v)) => (v, false),
                Ok(None) if f.with_extension("json.bad").exists() => (json!({}), true),
                Ok(None) => return None,
                Err(()) => (json!({}), true),
            };
            Some(DesignRow {
                title: d["title"].as_str().unwrap_or(&slug).to_string(),
                kind: d["kind"].as_str().unwrap_or("app").to_string(),
                frames: d["frames"].as_array().map(|a| a.len()).unwrap_or(0),
                created: d["created"].as_str().unwrap_or("").to_string(),
                latest_version: versions::latest(&e.path()),
                updated_ms: content_updated_ms(&e.path(), &f),
                slug, bad,
            })
        })
        .collect();
    rows.sort_by(|a, b| b.updated_ms.cmp(&a.updated_ms));
    rows
}

pub fn create(project: &Path, kind: &str, title: &str, brief: &str, now_iso: &str) -> Result<String, String> {
    if !KINDS.contains(&kind) { return Err(format!("{kind} isn't a kind of design Chronicle knows")); }
    let root = ensure_root(project)?;
    let slug = unique_slug(&root, &slugify(title));
    let dir = root.join(&slug);
    std::fs::create_dir_all(dir.join("frames")).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(dir.join("assets")).map_err(|e| e.to_string())?;
    write_json(&dir.join("design.json"), &json!({
        "v": 1, "title": title.trim(), "kind": kind, "brief": brief, "created": now_iso,
        "frames": [], "groups": [], "chosen": null
    }))?;
    write_json(&dir.join("canvas.json"), &json!({ "positions": {}, "viewport": null }))?;
    Ok(slug)
}

fn edit_design(project: &Path, slug: &str, f: impl FnOnce(&mut serde_json::Map<String, Value>)) -> Result<(), String> {
    let path = design_dir(project, slug)?.join("design.json");
    let mut v = match read_json_or_bad(&path) { Ok(Some(v)) => v, _ => return Err("couldn't read this design".into()) };
    f(v.as_object_mut().unwrap());
    write_json(&path, &v)
}

pub fn rename(project: &Path, slug: &str, title: &str) -> Result<(), String> {
    let t = title.trim();
    if t.is_empty() { return Err("a design needs a name".into()); }
    edit_design(project, slug, |m| { m.insert("title".into(), json!(t)); })
}

pub fn set_kind(project: &Path, slug: &str, kind: &str) -> Result<(), String> {
    if !KINDS.contains(&kind) { return Err(format!("{kind} isn't a kind of design Chronicle knows")); }
    edit_design(project, slug, |m| { m.insert("kind".into(), json!(kind)); })
}

pub fn trash(project: &Path, slug: &str, ms: u128) -> Result<String, String> {
    let src = design_dir(project, slug)?;
    let base = crate::notes::index::vault_root(project);
    let trash = base.join(".chronicle/trash/designs");
    std::fs::create_dir_all(&trash).map_err(|e| e.to_string())?;
    let name = format!("{slug}-{ms}");
    std::fs::rename(&src, trash.join(&name)).map_err(|e| e.to_string())?;
    Ok(format!(".chronicle/trash/designs/{name}"))
}

pub fn untrash(project: &Path, trash_rel: &str) -> Result<String, String> {
    let name = trash_rel.strip_prefix(".chronicle/trash/designs/").ok_or("that isn't a trashed design")?;
    if name.contains('/') || name.contains("..") { return Err("that isn't a trashed design".into()); }
    let slug_base = name.rsplit_once('-').map(|(s, _)| s).unwrap_or(name);
    if !valid_slug(slug_base) { return Err("that isn't a trashed design".into()); }
    let base = crate::notes::index::vault_root(project);
    let root = ensure_root(project)?;
    let slug = unique_slug(&root, slug_base);
    std::fs::rename(base.join(trash_rel), root.join(&slug)).map_err(|e| e.to_string())?;
    Ok(slug)
}

use tauri::State;
use crate::{project_for, OpenRoots};

pub(crate) fn now_iso() -> String {
    let secs = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    crate::iso8601_utc(secs)
}

#[tauri::command]
pub fn designs_list(roots: State<OpenRoots>, dir: String) -> Result<Value, String> {
    let p = project_for(&roots, &dir)?;
    let order = match read_json_or_bad(&designs_root(&p.dir).join("order.json")) { Ok(Some(v)) => v, _ => json!({}) };
    Ok(json!({ "rows": list(&p.dir), "order": order }))
}
#[tauri::command]
pub fn design_create(roots: State<OpenRoots>, dir: String, kind: String, title: String, brief: String) -> Result<String, String> {
    let p = project_for(&roots, &dir)?;
    create(&p.dir, &kind, &title, &brief, &now_iso())
}
#[tauri::command]
pub fn design_read(roots: State<OpenRoots>, dir: String, slug: String) -> Result<Value, String> {
    let p = project_for(&roots, &dir)?;
    let d = design_dir(&p.dir, &slug)?;
    let (design, bad) = match read_json_or_bad(&d.join("design.json")) { Ok(v) => (v.unwrap_or(Value::Null), false), Err(()) => (Value::Null, true) };
    let canvas = match read_json_or_bad(&d.join("canvas.json")) { Ok(Some(v)) => v, _ => json!({ "positions": {}, "viewport": null }) };
    Ok(json!({ "design": design, "canvas": canvas, "bad": bad }))
}
#[tauri::command]
pub fn design_rename(roots: State<OpenRoots>, dir: String, slug: String, title: String) -> Result<(), String> {
    rename(&project_for(&roots, &dir)?.dir, &slug, &title)
}
#[tauri::command]
pub fn design_set_kind(roots: State<OpenRoots>, dir: String, slug: String, kind: String) -> Result<(), String> {
    set_kind(&project_for(&roots, &dir)?.dir, &slug, &kind)
}
#[tauri::command]
pub fn design_trash(roots: State<OpenRoots>, dir: String, slug: String) -> Result<String, String> {
    let ms = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
    trash(&project_for(&roots, &dir)?.dir, &slug, ms)
}
#[tauri::command]
pub fn design_untrash(roots: State<OpenRoots>, dir: String, trash_rel: String) -> Result<String, String> {
    untrash(&project_for(&roots, &dir)?.dir, &trash_rel)
}
#[tauri::command]
pub fn design_canvas_save(roots: State<OpenRoots>, dir: String, slug: String, canvas: Value) -> Result<(), String> {
    let p = project_for(&roots, &dir)?;
    if !canvas.is_object() { return Err("that canvas layout isn't valid".into()); }
    write_json(&design_dir(&p.dir, &slug)?.join("canvas.json"), &canvas)
}
#[tauri::command]
pub fn designs_order_save(roots: State<OpenRoots>, dir: String, order: Value) -> Result<(), String> {
    let p = project_for(&roots, &dir)?;
    if !order.is_object() { return Err("that order isn't valid".into()); }
    write_json(&ensure_root(&p.dir)?.join("order.json"), &order)
}
#[tauri::command]
pub fn design_snapshot(roots: State<OpenRoots>, dir: String, slug: String, prompt: String, summary: String, session: String) -> Result<Option<u32>, String> {
    let p = project_for(&roots, &dir)?;
    versions::snapshot_if_changed(&design_dir(&p.dir, &slug)?, &now_iso(), &session, &prompt, &summary)
}
#[tauri::command]
pub fn design_versions(roots: State<OpenRoots>, dir: String, slug: String) -> Result<Vec<versions::VersionMeta>, String> {
    let p = project_for(&roots, &dir)?;
    Ok(versions::list(&design_dir(&p.dir, &slug)?))
}
#[tauri::command]
pub fn design_restore(roots: State<OpenRoots>, dir: String, slug: String, n: u32) -> Result<u32, String> {
    let p = project_for(&roots, &dir)?;
    versions::restore(&design_dir(&p.dir, &slug)?, n, &now_iso())
}
#[tauri::command]
pub fn design_branch(roots: State<OpenRoots>, dir: String, slug: String, n: Option<u32>) -> Result<String, String> {
    let p = project_for(&roots, &dir)?;
    versions::branch(&p.dir, &slug, n, &now_iso())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn proj(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("chronicle-designs-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d.canonicalize().unwrap()
    }

    #[test]
    fn the_folder_ignores_itself() {
        let p = proj("ignore");
        let root = ensure_root(&p).unwrap();
        assert_eq!(std::fs::read_to_string(root.join(".gitignore")).unwrap(), "*\n");
    }

    #[test]
    fn slugs_are_plain_and_unique() {
        assert_eq!(slugify("Product page · Ethiopia Guji!"), "product-page-ethiopia-guji");
        assert_eq!(slugify("   "), "design");
        assert!(valid_slug("a-b-2") && !valid_slug("../x") && !valid_slug("A") && !valid_slug(""));
        let p = proj("unique");
        let root = ensure_root(&p).unwrap();
        std::fs::create_dir_all(root.join("home")).unwrap();
        assert_eq!(unique_slug(&root, "home"), "home-2");
    }

    #[test]
    fn create_list_rename_kind_trash_untrash() {
        let p = proj("manage");
        let slug = create(&p, "ecommerce", "Product page", "a brief", "2026-09-17T10:00:00Z").unwrap();
        assert_eq!(slug, "product-page");
        let d: Value = serde_json::from_str(&std::fs::read_to_string(designs_root(&p).join("product-page/design.json")).unwrap()).unwrap();
        assert_eq!(d["v"], 1); assert_eq!(d["kind"], "ecommerce"); assert_eq!(d["frames"], json!([]));
        assert!(create(&p, "poster", "x", "", "t").is_err());
        rename(&p, &slug, "Guji page").unwrap();
        set_kind(&p, &slug, "marketing").unwrap();
        let rows = list(&p);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].title, "Guji page"); assert_eq!(rows[0].kind, "marketing"); assert_eq!(rows[0].slug, "product-page");
        let t = trash(&p, &slug, 42).unwrap();
        assert_eq!(t, ".chronicle/trash/designs/product-page-42");
        assert!(list(&p).is_empty());
        assert_eq!(untrash(&p, &t).unwrap(), "product-page");
        assert_eq!(list(&p).len(), 1);
    }

    #[test]
    fn saving_the_canvas_does_not_change_updated_ms() {
        let p = proj("updated");
        let slug = create(&p, "app", "Dash", "", "t").unwrap();
        let d = designs_root(&p).join(&slug);
        std::fs::write(d.join("frames/a.html"), "<h1>a</h1>").unwrap();
        let before = list(&p)[0].updated_ms;
        std::thread::sleep(std::time::Duration::from_millis(30));
        std::fs::write(d.join("canvas.json"), "{\"positions\":{},\"viewport\":{\"x\":1,\"y\":2,\"zoom\":0.5}}").unwrap();
        std::fs::create_dir_all(d.join(".versions/v9")).unwrap();
        assert_eq!(list(&p)[0].updated_ms, before, "canvas.json and the folder's own mtime don't count");
        std::thread::sleep(std::time::Duration::from_millis(30));
        std::fs::write(d.join("frames/a.html"), "<h1>b</h1>").unwrap();
        assert!(list(&p)[0].updated_ms > before, "a frame write does");
    }

    #[test]
    fn unreadable_files_are_set_aside() {
        let p = proj("bad");
        let slug = create(&p, "app", "Dash", "", "t").unwrap();
        let f = designs_root(&p).join(&slug).join("design.json");
        std::fs::write(&f, "{not json").unwrap();
        assert!(read_json_or_bad(&f).is_err());
        assert!(f.with_extension("json.bad").exists());
        let rows = list(&p);
        assert!(rows[0].bad);
    }
}
