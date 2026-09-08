//! uBlock's filter lists, compiled once into WebKit content-rule lists and
//! attached to every browser webview before its first navigation. Lists ship
//! as bundle resources (scripts/blocklists.mjs); an app-data copy, if present,
//! wins. Compilation runs on the main thread through WKContentRuleListStore,
//! which caches compiled lists by identifier, so a matching sha is a lookup.

use block2::RcBlock;
use objc2::rc::Retained;
use objc2::MainThreadMarker;
use objc2_foundation::{NSError, NSString};
use objc2_web_kit::{WKContentRuleList, WKContentRuleListStore, WKWebView};
use serde::Deserialize;
use serde_json::{json, Value};
use std::cell::RefCell;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Deserialize, Debug, Clone)]
#[allow(dead_code)] // the manifest's provenance rows — parsed whole; only the chunks drive compilation
pub struct Source { pub name: String, pub url: String, pub filters: u64 }
#[derive(Deserialize, Debug, Clone)]
pub struct Chunk { pub file: String, pub rules: u64, pub sha256: String }
#[derive(Deserialize, Debug, Clone)]
pub struct Manifest {
    pub fetched_at: String,
    /// where the filters came from — kept so the manifest round-trips whole;
    /// compilation only needs `chunks`
    #[allow(dead_code)]
    pub sources: Vec<Source>,
    pub chunks: Vec<Chunk>,
}

pub fn parse_manifest(s: &str) -> Result<Manifest, String> {
    serde_json::from_str(s).map_err(|e| format!("manifest: {e}"))
}
pub fn identifier(c: &Chunk, n: usize) -> String { format!("chronicle-{n}-{}", c.sha256) }

thread_local! {
    /// compiled lists live on the main thread only (WebKit objects are not Send)
    static LISTS: RefCell<Vec<Retained<WKContentRuleList>>> = RefCell::new(Vec::new());
}

pub struct BlockState {
    pub status: Mutex<String>,     // idle | compiling | ready | partial | missing
    pub fetched_at: Mutex<String>,
    pub failed: Mutex<Vec<String>>,
    pub total: Mutex<usize>,
    /// how many lists compiled — mirrors LISTS.len() so any thread can report it
    pub compiled: Mutex<usize>,
}
impl BlockState {
    pub fn new() -> Self {
        Self { status: Mutex::new("idle".into()), fetched_at: Mutex::new(String::new()), failed: Mutex::new(vec![]), total: Mutex::new(0), compiled: Mutex::new(0) }
    }
}

fn info_json(st: &BlockState) -> Value {
    let lists = st.compiled.lock().map(|c| *c).unwrap_or(0);
    json!({
        "status": st.status.lock().map(|s| s.clone()).unwrap_or_default(),
        "lists": lists,
        "fetched_at": st.fetched_at.lock().map(|s| s.clone()).unwrap_or_default(),
        "failed": st.failed.lock().map(|f| f.clone()).unwrap_or_default(),
    })
}

/// App-data copy first (a future updater's home), bundled resources otherwise.
fn locate(app: &AppHandle) -> Option<PathBuf> {
    let candidates = [
        crate::config_dir().join("blocklists"),
        app.path().resource_dir().ok()?.join("resources").join("blocklists"),
        app.path().resource_dir().ok()?.join("blocklists"),
    ];
    candidates.into_iter().find(|d| d.join("manifest.json").is_file())
}

/// Idempotent: the first call compiles (or looks up) every chunk on the main
/// thread and emits `web-blocklists-changed` when the last one settles.
#[tauri::command]
pub fn web_blocklists_prepare(app: AppHandle, st: State<BlockState>) -> Result<(), String> {
    {
        let mut s = st.status.lock().map_err(|e| e.to_string())?;
        if *s != "idle" && *s != "missing" { return Ok(()); }
        *s = "compiling".into();
    }
    let Some(dir) = locate(&app) else {
        *st.status.lock().map_err(|e| e.to_string())? = "missing".into();
        let _ = app.emit("web-blocklists-changed", info_json(&st));
        return Ok(());
    };
    let manifest = parse_manifest(&std::fs::read_to_string(dir.join("manifest.json")).map_err(|e| e.to_string())?)?;
    *st.fetched_at.lock().map_err(|e| e.to_string())? = manifest.fetched_at.clone();
    *st.total.lock().map_err(|e| e.to_string())? = manifest.chunks.len();
    let app2 = app.clone();
    app.run_on_main_thread(move || {
        let mtm = MainThreadMarker::new().expect("run_on_main_thread");
        let store = unsafe { WKContentRuleListStore::defaultStore(mtm) };
        let Some(store) = store else { settle(&app2, "partial", Some("no rule-list store")); return };
        let remaining = std::rc::Rc::new(RefCell::new(manifest.chunks.len()));
        if manifest.chunks.is_empty() { settle(&app2, "ready", None); return }
        for (n, chunk) in manifest.chunks.iter().enumerate() {
            let id = identifier(chunk, n);
            let ns_id = NSString::from_str(&id);
            let app3 = app2.clone();
            let remaining = remaining.clone();
            let dir = dir.clone();
            let file = chunk.file.clone();
            let chunk_name = format!("{} ({} rules)", chunk.file, chunk.rules);
            // look up first (WebKit caches by identifier); compile on a miss
            let on_done: RcBlock<dyn Fn(*mut WKContentRuleList, *mut NSError)> = RcBlock::new(move |list: *mut WKContentRuleList, err: *mut NSError| {
                if !list.is_null() {
                    if let Some(l) = unsafe { Retained::retain(list) } {
                        LISTS.with(|v| v.borrow_mut().push(l));
                        if let Some(st) = app3.try_state::<BlockState>() { if let Ok(mut c) = st.compiled.lock() { *c += 1; } }
                    }
                } else {
                    let msg = if err.is_null() { "unknown error".to_string() } else { unsafe { (*err).localizedDescription().to_string() } };
                    if let Some(st) = app3.try_state::<BlockState>() { if let Ok(mut f) = st.failed.lock() { f.push(format!("{chunk_name}: {msg}")); } }
                }
                *remaining.borrow_mut() -= 1;
                if *remaining.borrow() == 0 {
                    let failed = app3.try_state::<BlockState>().map(|s| s.failed.lock().map(|f| !f.is_empty()).unwrap_or(false)).unwrap_or(false);
                    settle(&app3, if failed { "partial" } else { "ready" }, None);
                }
            });
            let compile_app = app2.clone();
            let ns_id2 = ns_id.clone();
            let on_done2 = on_done.clone();
            let on_lookup: RcBlock<dyn Fn(*mut WKContentRuleList, *mut NSError)> = RcBlock::new(move |list: *mut WKContentRuleList, err: *mut NSError| {
                if !list.is_null() { on_done2.call((list, err)); return; }
                match read_chunk(&dir.join(&file)) {
                    Ok(text) => {
                        let mtm = MainThreadMarker::new().expect("main");
                        if let Some(store) = unsafe { WKContentRuleListStore::defaultStore(mtm) } {
                            unsafe { store.compileContentRuleListForIdentifier_encodedContentRuleList_completionHandler(Some(&ns_id2), Some(&NSString::from_str(&text)), Some(&on_done2)) };
                        } else { on_done2.call((std::ptr::null_mut(), std::ptr::null_mut())); }
                    }
                    Err(_) => { let _ = &compile_app; on_done2.call((std::ptr::null_mut(), std::ptr::null_mut())); }
                }
            });
            unsafe { store.lookUpContentRuleListForIdentifier_completionHandler(Some(&ns_id), Some(&on_lookup)) };
        }
    }).map_err(|e| e.to_string())
}

/// Chunks ship gzipped (`N.json.gz`, ~1 MB each; the raw JSON is ~20 MB). A
/// plain `.json` still works for hand-made lists.
fn read_chunk(path: &std::path::Path) -> Result<String, String> {
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    if path.extension().and_then(|e| e.to_str()) == Some("gz") {
        use std::io::Read;
        let mut out = String::new();
        flate2::read::GzDecoder::new(&bytes[..]).read_to_string(&mut out).map_err(|e| e.to_string())?;
        Ok(out)
    } else {
        String::from_utf8(bytes).map_err(|e| e.to_string())
    }
}

fn settle(app: &AppHandle, status: &str, note: Option<&str>) {
    if let Some(st) = app.try_state::<BlockState>() {
        if let Ok(mut s) = st.status.lock() { *s = status.into(); }
        if let Some(n) = note { if let Ok(mut f) = st.failed.lock() { f.push(n.into()); } }
        let _ = app.emit("web-blocklists-changed", info_json(&st));
    }
}

#[tauri::command]
pub fn web_blocklists_info(st: State<BlockState>) -> Value { info_json(&st) }

/// Add every compiled list to this webview. Must run on the main thread —
/// `Webview::with_webview` guarantees that.
#[allow(dead_code)] // used from Task 5 (the browser child webviews)
pub fn attach(webview: &tauri::Webview) {
    let _ = webview.with_webview(|pw| {
        let wk: &WKWebView = unsafe { &*(pw.inner() as *const WKWebView) };
        let ucc = unsafe { wk.configuration().userContentController() };
        LISTS.with(|v| for l in v.borrow().iter() { unsafe { ucc.addContentRuleList(l) } });
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn manifest_parses_and_identifiers_are_stable() {
        let m = parse_manifest(r#"{"fetched_at":"2026-09-09T10:00:00Z","converter":"x","sources":[{"name":"A","url":"u","filters":3}],"filters":3,"rules":2,"chunks":[{"file":"0.json","rules":2,"sha256":"abc"}]}"#).unwrap();
        assert_eq!(m.chunks.len(), 1);
        assert_eq!(m.sources[0].name, "A");
        assert_eq!(identifier(&m.chunks[0], 0), "chronicle-0-abc");
        assert!(parse_manifest("{}").is_err());
        assert!(parse_manifest(r#"{"fetched_at":"t","sources":[],"chunks":[]}"#).unwrap().chunks.is_empty());
    }

    #[test]
    fn read_chunk_handles_gzip_and_plain() {
        use std::io::Write;
        let text = r#"[{"trigger":{"url-filter":"ads"},"action":{"type":"block"}}]"#;
        let dir = std::env::temp_dir().join(format!("chronicle-blocklists-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();

        let gz = dir.join("x.json.gz");
        let mut enc = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
        enc.write_all(text.as_bytes()).unwrap();
        std::fs::write(&gz, enc.finish().unwrap()).unwrap();
        assert_eq!(read_chunk(&gz).unwrap(), text);

        let plain = dir.join("y.json");
        std::fs::write(&plain, text).unwrap();
        assert_eq!(read_chunk(&plain).unwrap(), text);

        assert!(read_chunk(&dir.join("missing.json")).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
