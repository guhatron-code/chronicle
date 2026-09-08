//! The Web pane's backend: native child webviews (one per tab), their status
//! events, the jailed `chronicle-file://` protocol that serves a project's own
//! files to those webviews, and per-project tab persistence in app data.

use objc2_web_kit::WKWebView;
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, Position, Size, State, Webview, WebviewBuilder, WebviewUrl};

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
pub struct WebState {
    /// project hash -> canonical root, for the chronicle-file protocol
    pub roots: Mutex<HashMap<String, PathBuf>>,
    /// tab label -> live tab
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

/// A live tab: the project it belongs to, its native child webview, and whether
/// its last page-load event said "started".
pub struct WebTab {
    /// the project this tab belongs to — recorded at open, read when Task 7
    /// saves and restores a project's tabs
    #[allow(dead_code)]
    pub dir: String,
    pub webview: tauri::Webview,
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

/* ================= tabs: native child webviews ================= */

/// A fixed UUID naming the browser tabs' own `WKWebsiteDataStore` on macOS 14+,
/// so their cookies and caches live apart from Chronicle's own webview. On
/// older macOS the identifier is ignored and the tabs share the app's store.
/// (`data_directory` looks like the knob for this but is a no-op on macOS.)
const WEB_PROFILE_ID: [u8; 16] = [0x7c, 0x1e, 0x02, 0x9a, 0x5d, 0x44, 0x4f, 0xa1, 0x9b, 0x3c, 0x2e, 0x61, 0x8f, 0x0d, 0xc7, 0x55];

/// Every event this module emits goes to Chronicle's own UI only — never to the
/// browser tabs, which are untrusted pages sharing the same window.
fn ui() -> tauri::EventTarget { tauri::EventTarget::webview("main") }

/// The only schemes a tab may sit on: the open web, project files, and the
/// blank page a fresh tab starts at.
const ALLOWED: [&str; 4] = ["http", "https", "chronicle-file", "about"];

/// Read the live status straight from WKWebView on the main thread and emit it.
/// `title` overrides what WKWebView reports — the title-changed callback is
/// handed the new title before the view itself answers with it.
fn emit_status(app: &AppHandle, label: &str, loading: bool, title: Option<String>) {
    let Some(wv) = app.get_webview(label) else { return };
    let app2 = app.clone();
    let label = label.to_string();
    let _ = wv.with_webview(move |pw| {
        let wk: &WKWebView = unsafe { &*(pw.inner() as *const WKWebView) };
        let title = title.unwrap_or_else(|| unsafe { wk.title() }.map(|t| t.to_string()).unwrap_or_default());
        let url = unsafe { wk.URL() }.and_then(|u| u.absoluteString()).map(|s| s.to_string()).unwrap_or_default();
        let (back, fwd) = unsafe { (wk.canGoBack(), wk.canGoForward()) };
        let _ = app2.emit_to(ui(), "web-tab-changed", json!({
            "label": label, "url": url, "title": title, "loading": loading, "can_back": back, "can_forward": fwd,
        }));
    });
}

fn current_bounds(web: &WebState) -> tauri::Rect {
    web.bounds.lock().ok().and_then(|b| *b).unwrap_or(tauri::Rect {
        position: Position::Physical(PhysicalPosition { x: 0, y: 0 }),
        size: Size::Physical(PhysicalSize { width: 10, height: 10 }),
    })
}

/// Remember a tab's last page-load state, so showing it later reports the truth
/// rather than a hopeful `false`. Never holds the lock across a WebKit call.
fn set_loading(app: &AppHandle, label: &str, loading: bool) {
    if let Some(web) = app.try_state::<WebState>() {
        if let Ok(mut tabs) = web.tabs.lock() {
            if let Some(t) = tabs.get_mut(label) { t.loading = loading; }
        }
    }
}

fn is_loading(web: &WebState, label: &str) -> bool {
    web.tabs.lock().ok().and_then(|t| t.get(label).map(|t| t.loading)).unwrap_or(false)
}

fn is_loading_of(app: &AppHandle, label: &str) -> bool {
    app.try_state::<WebState>().map(|web| is_loading(&web, label)).unwrap_or(false)
}

#[tauri::command]
pub fn web_tab_open(app: AppHandle, roots: State<crate::OpenRoots>, web: State<WebState>, block: State<crate::blocklists::BlockState>, dir: String, url: Option<String>) -> Result<String, String> {
    let _ = crate::project_for(&roots, &dir)?;
    {
        let s = block.status.lock().map_err(|e| e.to_string())?;
        if *s == "idle" || *s == "compiling" { return Err("blocking isn't ready yet".into()); }
    }
    // vet the first address before a webview exists, so a bad one strands nothing
    let first: Option<url::Url> = match url {
        Some(u) => {
            let parsed: url::Url = u.parse().map_err(|_| "that address isn't valid".to_string())?;
            if !ALLOWED.contains(&parsed.scheme()) { return Err("only web pages and project files open here".into()); }
            Some(parsed)
        }
        None => None,
    };
    let n = web.next_id.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let label = format!("web-{n}");
    let window = app.get_window("main").ok_or("no main window")?;
    let app_new = app.clone(); let label_new = label.clone();
    let app_dl = app.clone();
    let app_title = app.clone(); let label_title = label.clone();
    let app_load = app.clone(); let label_load = label.clone();
    let builder = WebviewBuilder::new(&label, WebviewUrl::External("about:blank".parse().unwrap()))
        .data_store_identifier(WEB_PROFILE_ID)
        .zoom_hotkeys_enabled(false)
        .on_navigation(move |u| ALLOWED.contains(&u.scheme()))
        .on_new_window(move |u, _features| {
            let _ = app_new.emit_to(ui(), "web-open-tab", json!({ "from_label": label_new, "url": u.to_string() }));
            tauri::webview::NewWindowResponse::Deny
        })
        .on_download(move |_wv, ev| {
            match ev {
                tauri::webview::DownloadEvent::Requested { url, destination } => {
                    let name = url.path_segments().and_then(|s| s.last()).filter(|s| !s.is_empty()).unwrap_or("download").to_string();
                    let dir = app_dl.path().download_dir().unwrap_or_else(|_| std::env::temp_dir());
                    *destination = dir.join(name);
                    true
                }
                tauri::webview::DownloadEvent::Finished { url, success, .. } => {
                    let _ = app_dl.emit_to(ui(), "web-download", json!({ "url": url.to_string(), "ok": success }));
                    true
                }
                _ => true,
            }
        })
        .on_document_title_changed(move |_wv, t| {
            let loading = is_loading_of(&app_title, &label_title);
            emit_status(&app_title, &label_title, loading, Some(t));
        })
        .on_page_load(move |_wv, payload| {
            let loading = matches!(payload.event(), tauri::webview::PageLoadEvent::Started);
            set_loading(&app_load, &label_load, loading);
            emit_status(&app_load, &label_load, loading, None);
        });
    let bounds = current_bounds(&web);
    let wv = window.add_child(builder, bounds.position, bounds.size).map_err(|e| e.to_string())?;
    // add_child reports a *dispatch* failure, not a build one: confirm the
    // manager really knows this label before anyone can be handed it
    if app.get_webview(&label).is_none() { return Err("the page view couldn't be created".into()); }
    crate::blocklists::attach(&wv);                // rules go in before the first real load
    let _ = wv.hide();                             // shown only by web_tab_show
    web.tabs.lock().map_err(|e| e.to_string())?.insert(label.clone(), WebTab { dir, webview: wv.clone(), loading: false });
    if let Some(u) = first { wv.navigate(u).map_err(|e| e.to_string())?; }
    Ok(label)
}

fn tab_webview(web: &WebState, label: &str) -> Result<Webview, String> {
    web.tabs.lock().map_err(|e| e.to_string())?.get(label).map(|t| t.webview.clone()).ok_or_else(|| "no such tab".into())
}

#[tauri::command]
pub fn web_tab_close(web: State<WebState>, label: String) -> Result<(), String> {
    let t = web.tabs.lock().map_err(|e| e.to_string())?.remove(&label);
    if let Some(t) = t { let _ = t.webview.close(); }
    let mut shown = web.shown.lock().map_err(|e| e.to_string())?;
    if shown.as_deref() == Some(&label) { *shown = None; }
    Ok(())
}

#[tauri::command]
pub fn web_hide_all(web: State<WebState>) -> Result<(), String> {
    let label = web.shown.lock().map_err(|e| e.to_string())?.take();
    if let Some(label) = label {
        if let Ok(wv) = tab_webview(&web, &label) { let _ = wv.hide(); }
    }
    Ok(())
}

#[tauri::command]
pub fn web_tab_show(app: AppHandle, web: State<WebState>, label: String) -> Result<(), String> {
    let wv = tab_webview(&web, &label)?;
    wv.set_bounds(current_bounds(&web)).map_err(|e| e.to_string())?;
    wv.show().map_err(|e| e.to_string())?;   // only a shown tab becomes `shown`
    let prev = {
        let mut shown = web.shown.lock().map_err(|e| e.to_string())?;
        shown.replace(label.clone())
    };
    if let Some(prev) = prev {
        if prev != label { if let Ok(p) = tab_webview(&web, &prev) { let _ = p.hide(); } }
    }
    emit_status(&app, &label, is_loading(&web, &label), None);
    Ok(())
}

#[tauri::command]
pub fn web_set_bounds(web: State<WebState>, x: i32, y: i32, width: u32, height: u32) -> Result<(), String> {
    let rect = tauri::Rect { position: Position::Physical(PhysicalPosition { x, y }), size: Size::Physical(PhysicalSize { width: width.max(1), height: height.max(1) }) };
    *web.bounds.lock().map_err(|e| e.to_string())? = Some(rect);
    let shown = web.shown.lock().map_err(|e| e.to_string())?.clone();
    if let Some(label) = shown {
        if let Ok(wv) = tab_webview(&web, &label) { let _ = wv.set_bounds(rect); }
    }
    Ok(())
}

#[tauri::command]
pub fn web_tab_navigate(web: State<WebState>, label: String, url: String) -> Result<(), String> {
    let parsed: url::Url = url.parse().map_err(|_| "that address isn't valid".to_string())?;
    if !ALLOWED.contains(&parsed.scheme()) { return Err("only web pages and project files open here".into()); }
    tab_webview(&web, &label)?.navigate(parsed).map_err(|e| e.to_string())
}

fn with_wk(web: &WebState, label: &str, f: impl FnOnce(&WKWebView) + Send + 'static) -> Result<(), String> {
    tab_webview(web, label)?.with_webview(move |pw| f(unsafe { &*(pw.inner() as *const WKWebView) })).map_err(|e| e.to_string())
}
#[tauri::command]
pub fn web_tab_back(web: State<WebState>, label: String) -> Result<(), String> { with_wk(&web, &label, |wk| { unsafe { wk.goBack() }; }) }
#[tauri::command]
pub fn web_tab_forward(web: State<WebState>, label: String) -> Result<(), String> { with_wk(&web, &label, |wk| { unsafe { wk.goForward() }; }) }
#[tauri::command]
pub fn web_tab_reload(web: State<WebState>, label: String) -> Result<(), String> { tab_webview(&web, &label)?.reload().map_err(|e| e.to_string()) }

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

    /// The Web pane's tabs are only safe because app commands sit behind the ACL:
    /// build.rs turns `generate_handler![…]` into the `__app-acl__` manifest, and
    /// `capabilities/default.json` grants its `default` set to the `main` webview
    /// alone. If a command ever escapes that pipeline it would be callable from a
    /// page loaded in a tab, so check every registered name arrives.
    #[test]
    fn every_registered_command_is_in_the_app_acl() {
        // exactly the list build.rs extracted and fed to the manifest
        let commands: Vec<&str> = include_str!(concat!(env!("OUT_DIR"), "/commands.txt"))
            .lines().map(str::trim).filter(|l| !l.is_empty()).collect();
        assert!(commands.len() > 50, "suspiciously few commands: {}", commands.len());
        assert!(commands.contains(&"web_tab_open"), "the tab commands must be registered");

        let manifests: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/gen/schemas/acl-manifests.json"))
                .expect("gen/schemas/acl-manifests.json (written by build.rs)"),
        ).unwrap();
        let app = &manifests["__app-acl__"];
        assert!(!app.is_null(), "no __app-acl__ manifest: local pages would bypass the ACL entirely");
        let default: Vec<&str> = app["default_permission"]["permissions"].as_array()
            .expect("__app-acl__ has no default permission set")
            .iter().map(|v| v.as_str().unwrap()).collect();

        for c in &commands {
            let id = format!("allow-{}", c.replace('_', "-"));
            assert!(app["permissions"].get(&id).is_some(), "{c}: no `{id}` permission in __app-acl__");
            assert!(default.contains(&id.as_str()), "{c}: `{id}` missing from the default set");
        }
    }

    /// The capability that carries those permissions must be pinned to the `main`
    /// webview by label. `windows: ["main"]` would hand the same IPC to every
    /// child webview of that window — i.e. to every browser tab.
    #[test]
    fn the_capability_is_scoped_to_the_main_webview() {
        let cap: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/capabilities/default.json")).unwrap(),
        ).unwrap();
        assert!(cap.get("windows").is_none(), "`windows` covers child webviews too — use `webviews`");
        assert_eq!(cap["webviews"], serde_json::json!(["main"]));
        let perms: Vec<&str> = cap["permissions"].as_array().unwrap().iter().map(|v| v.as_str().unwrap()).collect();
        assert!(perms.contains(&"default"), "the app's own commands are not granted");
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
