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
        "total": st.total.lock().map(|t| *t).unwrap_or(0),
        "fetched_at": st.fetched_at.lock().map(|s| s.clone()).unwrap_or_default(),
        "failed": st.failed.lock().map(|f| f.clone()).unwrap_or_default(),
    })
}

/// App-data copy first (a future updater's home), bundled resources otherwise.
/// A missing resource dir must not hide an app-data copy, so the two resource
/// candidates are optional rather than short-circuiting the whole search.
fn locate(app: &AppHandle) -> Option<PathBuf> {
    let res = app.path().resource_dir().ok();
    [
        Some(crate::config_dir().join("blocklists")),
        res.as_ref().map(|r| r.join("resources").join("blocklists")),
        res.as_ref().map(|r| r.join("blocklists")),
    ]
    .into_iter()
    .flatten()
    .find(|d| d.join("manifest.json").is_file())
}

/// One chunk has finished, one way or another: record the failure if there was
/// one, and settle the run when the last one lands. Main thread only.
fn finish_one(app: &AppHandle, remaining: &std::rc::Rc<RefCell<usize>>, failure: Option<String>) {
    if let Some(msg) = failure {
        if let Some(st) = app.try_state::<BlockState>() {
            if let Ok(mut f) = st.failed.lock() { f.push(msg); }
        }
    }
    let last = { let mut r = remaining.borrow_mut(); *r -= 1; *r == 0 };
    if last {
        let failed = app.try_state::<BlockState>().map(|s| s.failed.lock().map(|f| !f.is_empty()).unwrap_or(false)).unwrap_or(false);
        settle(app, if failed { "partial" } else { "ready" }, None);
    }
}

/// Idempotent: the first call compiles (or looks up) every chunk on the main
/// thread and emits `web-blocklists-changed` when the last one settles.
///
/// Once the status flips to `compiling`, the guard below refuses every further
/// call — so every exit from here on MUST settle, or blocking is wedged off for
/// the life of the process. `missing` is the retryable resting place for a
/// failure, so that is what the error paths settle to.
#[tauri::command]
pub fn web_blocklists_prepare(app: AppHandle, st: State<BlockState>) -> Result<(), String> {
    {
        let mut s = st.status.lock().map_err(|e| e.to_string())?;
        if *s != "idle" && *s != "missing" { return Ok(()); }
        *s = "compiling".into();
    }
    // this attempt's failures are its own — a retry after a `missing` must not
    // inherit the last attempt's notes and land in `partial` on their account
    if let Ok(mut f) = st.failed.lock() { f.clear(); }

    let Some(dir) = locate(&app) else {
        settle(&app, "missing", Some("no block lists on disk"));
        return Ok(());
    };
    let manifest = match std::fs::read_to_string(dir.join("manifest.json")).map_err(|e| e.to_string()).and_then(|t| parse_manifest(&t)) {
        Ok(m) => m,
        Err(e) => { settle(&app, "missing", Some(e.as_str())); return Err(e); }
    };
    match st.fetched_at.lock() {
        Ok(mut g) => *g = manifest.fetched_at.clone(),
        Err(e) => { let e = e.to_string(); settle(&app, "missing", Some(e.as_str())); return Err(e); }
    }
    match st.total.lock() {
        Ok(mut g) => *g = manifest.chunks.len(),
        Err(e) => { let e = e.to_string(); settle(&app, "missing", Some(e.as_str())); return Err(e); }
    }

    // Inflate here, on the command thread: each chunk is ~1 MB gzipped and ~20 MB
    // of JSON, and the main thread has a UI to run. WebKit still needs the
    // NSString built on the main thread, but the gunzip does not happen there.
    let chunks: Vec<(usize, Chunk, Result<String, String>)> = manifest
        .chunks
        .iter()
        .enumerate()
        .map(|(n, c)| { let text = read_chunk(&dir.join(&c.file)); (n, c.clone(), text) })
        .collect();

    let app2 = app.clone();
    let hop = app.run_on_main_thread(move || {
        let Some(mtm) = MainThreadMarker::new() else { settle(&app2, "missing", Some("not on the main thread")); return };
        let Some(store) = (unsafe { WKContentRuleListStore::defaultStore(mtm) }) else {
            settle(&app2, "missing", Some("no rule-list store"));
            return;
        };
        if chunks.is_empty() { settle(&app2, "ready", None); return }
        let remaining = std::rc::Rc::new(RefCell::new(chunks.len()));
        for (n, chunk, text) in chunks {
            let chunk_name = format!("{} ({} rules)", chunk.file, chunk.rules);
            // a chunk we could not even read is done before WebKit sees it
            let text = match text {
                Ok(t) => t,
                Err(e) => { finish_one(&app2, &remaining, Some(format!("{chunk_name}: {e}"))); continue }
            };
            let ns_id = NSString::from_str(&identifier(&chunk, n));
            let app3 = app2.clone();
            let remaining2 = remaining.clone();
            let on_done: RcBlock<dyn Fn(*mut WKContentRuleList, *mut NSError)> = RcBlock::new(move |list: *mut WKContentRuleList, err: *mut NSError| {
                let mut failure = None;
                if !list.is_null() {
                    if let Some(l) = unsafe { Retained::retain(list) } {
                        LISTS.with(|v| v.borrow_mut().push(l));
                        if let Some(st) = app3.try_state::<BlockState>() { if let Ok(mut c) = st.compiled.lock() { *c += 1; } }
                    }
                } else {
                    let msg = if err.is_null() { "unknown error".to_string() } else { unsafe { (*err).localizedDescription().to_string() } };
                    failure = Some(format!("{chunk_name}: {msg}"));
                }
                finish_one(&app3, &remaining2, failure);
            });
            // look up first (WebKit caches compiled lists by identifier, so an
            // unchanged sha never recompiles); compile the inflated text on a miss
            let ns_id2 = ns_id.clone();
            let on_done2 = on_done.clone();
            let on_lookup: RcBlock<dyn Fn(*mut WKContentRuleList, *mut NSError)> = RcBlock::new(move |list: *mut WKContentRuleList, err: *mut NSError| {
                if !list.is_null() { on_done2.call((list, err)); return; }
                let store = MainThreadMarker::new().and_then(|mtm| unsafe { WKContentRuleListStore::defaultStore(mtm) });
                match store {
                    Some(store) => unsafe {
                        store.compileContentRuleListForIdentifier_encodedContentRuleList_completionHandler(Some(&ns_id2), Some(&NSString::from_str(&text)), Some(&on_done2))
                    },
                    None => on_done2.call((std::ptr::null_mut(), std::ptr::null_mut())),
                }
            });
            unsafe { store.lookUpContentRuleListForIdentifier_completionHandler(Some(&ns_id), Some(&on_lookup)) };
        }
    });
    if let Err(e) = hop {
        let e = e.to_string();
        settle(&app, "missing", Some(e.as_str()));
        return Err(e);
    }
    Ok(())
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
pub fn attach(webview: &tauri::Webview) {
    let _ = webview.with_webview(|pw| {
        let wk: &WKWebView = unsafe { &*(pw.inner() as *const WKWebView) };
        let ucc = unsafe { wk.configuration().userContentController() };
        // clone the handles out first: addContentRuleList re-enters WebKit, and
        // LISTS must not sit borrowed across a call that could reach back in
        let lists: Vec<Retained<WKContentRuleList>> = LISTS.with(|v| v.borrow().clone());
        for l in &lists { unsafe { ucc.addContentRuleList(l) } }
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
