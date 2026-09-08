//! The Web pane's backend: native child webviews (one per tab), their status
//! events, the jailed `chronicle-file://` protocol that serves a project's own
//! files to those webviews, and per-project tab persistence in app data.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::State;

/// 16 hex chars of sha256(canonical root) — the host part of chronicle-file URLs
/// and the per-project tabs file name.
pub fn project_hash(root: &Path) -> String {
    let canon = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());
    let mut h = Sha256::new();
    h.update(canon.to_string_lossy().as_bytes());
    format!("{:x}", h.finalize())[..16].to_string()
}

/// The jail: a relative path resolves to a real file only if, after
/// canonicalising (which follows symlinks), it still sits under the root.
pub fn resolve_project_file(root: &Path, rel: &str) -> Option<PathBuf> {
    if rel.starts_with('/') || rel.contains('\0') { return None; }
    let root = root.canonicalize().ok()?;
    let candidate = root.join(rel).canonicalize().ok()?;
    if !candidate.starts_with(&root) || !candidate.is_file() { return None; }
    Some(candidate)
}

pub fn mime_for(p: &Path) -> &'static str {
    match p.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()).as_deref() {
        Some("html") | Some("htm") => "text/html; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("js") | Some("mjs") => "text/javascript; charset=utf-8",
        Some("json") => "application/json",
        Some("svg") => "image/svg+xml",
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("ico") => "image/x-icon",
        Some("woff") => "font/woff",
        Some("woff2") => "font/woff2",
        Some("ttf") => "font/ttf",
        Some("txt") | Some("md") => "text/plain; charset=utf-8",
        Some("pdf") => "application/pdf",
        Some("mp4") => "video/mp4",
        Some("webm") => "video/webm",
        Some("mp3") => "audio/mpeg",
        Some("wasm") => "application/wasm",
        _ => "application/octet-stream",
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SavedTab { pub url: String, pub title: String }

/// Everything the Web pane's backend keeps between commands.
#[allow(dead_code)] // used from Task 5
pub struct WebState {
    /// project hash -> canonical root, for the chronicle-file protocol
    pub roots: Mutex<HashMap<String, PathBuf>>,
    /// tab label -> live tab (Task 5 fills this)
    pub tabs: Mutex<HashMap<String, WebTab>>,
    pub next_id: std::sync::atomic::AtomicU32,
    /// last bounds pushed by the frontend, physical pixels
    pub bounds: Mutex<Option<tauri::Rect>>,
    /// the label currently shown, if any
    pub shown: Mutex<Option<String>>,
}
impl WebState {
    pub fn new() -> Self {
        Self { roots: Mutex::new(HashMap::new()), tabs: Mutex::new(HashMap::new()),
               next_id: std::sync::atomic::AtomicU32::new(1), bounds: Mutex::new(None), shown: Mutex::new(None) }
    }
}

/// A live tab. Task 5 gives it a webview; until then only the label and dir exist.
#[allow(dead_code)] // used from Task 5
pub struct WebTab {
    pub dir: String,
    pub webview: Option<tauri::Webview>,
    pub loading: bool,
}

fn tabs_dir() -> PathBuf { crate::config_dir().join("web-tabs") }

/// `dir` must be an opened project (same jail as every other command); registers
/// the root for the protocol and returns the tab URL for a file inside it.
#[tauri::command]
pub fn web_open_file(roots: State<crate::OpenRoots>, web: State<WebState>, dir: String, path: String) -> Result<String, String> {
    let p = crate::project_for(&roots, &dir)?;
    let root = p.dir.canonicalize().map_err(|e| e.to_string())?;
    resolve_project_file(&root, &path).ok_or_else(|| "that file isn't inside this project".to_string())?;
    let hash = project_hash(&root);
    web.roots.lock().map_err(|e| e.to_string())?.insert(hash.clone(), root);
    let rel = path.trim_start_matches("./");
    let enc = percent_encoding::utf8_percent_encode(rel, percent_encoding::NON_ALPHANUMERIC).to_string().replace("%2F", "/").replace("%2E", ".").replace("%2D", "-").replace("%5F", "_");
    Ok(format!("chronicle-file://{hash}/{enc}"))
}

#[tauri::command]
pub fn web_tabs_load(roots: State<crate::OpenRoots>, dir: String) -> Result<Vec<SavedTab>, String> {
    let p = crate::project_for(&roots, &dir)?;
    let file = tabs_dir().join(format!("{}.json", project_hash(&p.dir)));
    Ok(std::fs::read_to_string(file).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default())
}

#[tauri::command]
pub fn web_tabs_save(roots: State<crate::OpenRoots>, dir: String, tabs: Vec<SavedTab>) -> Result<(), String> {
    let p = crate::project_for(&roots, &dir)?;
    let d = tabs_dir();
    std::fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    let file = d.join(format!("{}.json", project_hash(&p.dir)));
    let tmp = file.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_string_pretty(&tabs).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &file).map_err(|e| e.to_string())
}

/// The protocol handler body: `chronicle-file://<hash>/<rel>` → the file's bytes
/// with a content type, or 404 for anything outside the jail.
pub fn serve_project_file(web: &WebState, url: &str) -> (u16, &'static str, Vec<u8>) {
    let Ok(u) = url::Url::parse(url) else { return (404, "text/plain", b"not found".to_vec()) };
    let hash = u.host_str().unwrap_or("").to_string();
    let rel = percent_encoding::percent_decode_str(u.path().trim_start_matches('/')).decode_utf8_lossy().into_owned();
    let root = web.roots.lock().ok().and_then(|g| g.get(&hash).cloned());
    match root.and_then(|r| resolve_project_file(&r, &rel)) {
        Some(file) => match std::fs::read(&file) {
            Ok(bytes) => (200, mime_for(&file), bytes),
            Err(_) => (404, "text/plain", b"not found".to_vec()),
        },
        None => (404, "text/plain", b"not found".to_vec()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("chronicle-web-{}-{}", name, std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d.canonicalize().unwrap()
    }

    #[test]
    fn jail_serves_inside_and_refuses_outside() {
        let root = tmp("jail");
        std::fs::create_dir_all(root.join("artifacts")).unwrap();
        std::fs::write(root.join("artifacts/report.html"), "<h1>hi</h1>").unwrap();
        let outside = tmp("outside");
        std::fs::write(outside.join("secret.txt"), "no").unwrap();
        std::os::unix::fs::symlink(outside.join("secret.txt"), root.join("link.txt")).unwrap();

        assert_eq!(resolve_project_file(&root, "artifacts/report.html"), Some(root.join("artifacts/report.html")));
        assert_eq!(resolve_project_file(&root, "artifacts/../artifacts/report.html"), Some(root.join("artifacts/report.html")), "normalised inside stays inside");
        assert_eq!(resolve_project_file(&root, "../outside/secret.txt"), None, "dot-dot escape");
        assert_eq!(resolve_project_file(&root, "/etc/passwd"), None, "absolute");
        assert_eq!(resolve_project_file(&root, "link.txt"), None, "symlink escaping the root");
        assert_eq!(resolve_project_file(&root, "missing.html"), None);
    }

    #[test]
    fn mime_by_extension() {
        assert_eq!(mime_for(Path::new("a.html")), "text/html; charset=utf-8");
        assert_eq!(mime_for(Path::new("a.HTM")), "text/html; charset=utf-8");
        assert_eq!(mime_for(Path::new("a.css")), "text/css; charset=utf-8");
        assert_eq!(mime_for(Path::new("a.js")), "text/javascript; charset=utf-8");
        assert_eq!(mime_for(Path::new("a.json")), "application/json");
        assert_eq!(mime_for(Path::new("a.svg")), "image/svg+xml");
        assert_eq!(mime_for(Path::new("a.png")), "image/png");
        assert_eq!(mime_for(Path::new("a.woff2")), "font/woff2");
        assert_eq!(mime_for(Path::new("a.unknownext")), "application/octet-stream");
    }

    #[test]
    fn hash_is_stable_and_short() {
        let root = tmp("hash");
        let h = project_hash(&root);
        assert_eq!(h.len(), 16);
        assert_eq!(h, project_hash(&root));
        assert!(h.chars().all(|c| c.is_ascii_hexdigit()));
    }
}
