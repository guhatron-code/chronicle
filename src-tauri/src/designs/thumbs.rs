//! One PNG per frame per version, rendered by a hidden native web view that loads
//! the frame through `chronicle-file://` (the design host, never the project
//! host), waits for the reporter's ready title (fonts included, at most five
//! seconds; a frame that never says it's ready fails there and the next one goes
//! on), grows to the page height, runs Chronicle's own audit in the page,
//! and snapshots. The same window serves the review at turn end (thumbs, audit,
//! detector, lint report) and the director's mid-turn capture and lint.
//!
//! The hidden window's label never matches "main", so the capability in
//! `capabilities/default.json` (scoped to webview "main") gives it no IPC.
use serde_json::{json, Value};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Mutex};
use std::time::{Duration, Instant};
use tauri::{State, WebviewUrl, WebviewWindowBuilder};
use crate::{project_for, OpenRoots};
use super::lint::Finding;

/// The reporter caps the height it reports at this; the window never grows past it either.
const MAX_PAGE_HEIGHT: u32 = 16_000;
const MAX_FRAME_WIDTH: u32 = 8_000;
const READY_WAIT: Duration = Duration::from_secs(5);
/// Thumbnails are captured at most this wide (points); the height follows the aspect ratio.
const MAX_SNAPSHOT_WIDTH: u32 = 720;
/// Captures are 2x on Retina; the captured pixel height stays under this (GPU texture limits).
const MAX_SNAPSHOT_PIXELS_TALL: u32 = 16_000;
const BACKING_SCALE: u32 = 2;

/// One capture window at a time, app-wide, for the whole render of a version.
static RENDER: Mutex<()> = Mutex::new(());

/// (snapshot width in points, window height in points) for a frame `frame_w` wide
/// whose page reports `page_h` tall. The snapshot is at most 720 wide; the window
/// height is capped so the captured image, scaled to that width at 2x, stays under
/// 16000 pixels tall (and never exceeds the reporter's own 16000 cap).
pub fn capture_size(frame_w: u32, page_h: u32) -> (u32, u32) {
    let frame_w = frame_w.clamp(1, MAX_FRAME_WIDTH);
    let snap_w = frame_w.min(MAX_SNAPSHOT_WIDTH);
    // pixel_h = win_h * snap_w / frame_w * 2 < 16000  ⇔  win_h < 8000 * frame_w / snap_w
    let limit = ((MAX_SNAPSHOT_PIXELS_TALL / BACKING_SCALE) as u64 * frame_w as u64 / snap_w as u64).saturating_sub(1);
    let win_h = (page_h as u64).clamp(1, limit.min(MAX_PAGE_HEIGHT as u64)) as u32;
    (snap_w, win_h)
}

pub fn thumb_rel(slug: &str, n: u32, frame_id: &str) -> String { format!("{slug}/.versions/v{n}/thumbs/{frame_id}.png") }

/// A frame id becomes a file name, so it must be a plain name — no separators, no dots.
fn safe_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 80 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// A frame file is joined under the version's folder and put in a URL: relative, no `..`, no root.
fn safe_file(file: &str) -> bool {
    let p = Path::new(file);
    !file.is_empty() && !file.contains('\\') && !file.contains('?') && !file.contains('#')
        && p.components().all(|c| matches!(c, Component::Normal(_)))
}

/// (id, file, width, height) for each well-formed frame in that version's `design.json`.
/// Frames missing an id, file or width — or whose id/file couldn't be used safely — are skipped.
pub fn thumb_frames(version_dir: &Path) -> Vec<(String, String, u32, u32)> {
    let Ok(t) = std::fs::read_to_string(version_dir.join("design.json")) else { return vec![] };
    let Ok(v) = serde_json::from_str::<Value>(&t) else { return vec![] };
    v["frames"].as_array().map(|a| a.iter().filter_map(|f| Some((
        f["id"].as_str()?.to_string(), f["file"].as_str()?.to_string(),
        f["width"].as_u64()? as u32, f["height"].as_u64().unwrap_or(900) as u32,
    ))).filter(|(id, file, w, _)| safe_id(id) && safe_file(file) && *w > 0).collect()).unwrap_or_default()
}

/// The design's kind from its `design.json` ("app" when it says nothing usable).
pub fn design_kind(dir: &Path) -> String {
    std::fs::read_to_string(dir.join("design.json")).ok().and_then(|t| serde_json::from_str::<Value>(&t).ok())
        .and_then(|v| v["kind"].as_str().map(String::from)).unwrap_or_else(|| "app".into())
}

/// The call that runs the audit in a frame: `fold` is the first screen's height.
/// Built field by field so the keys keep this order; the kind is a JSON string, so
/// any value is valid JS.
pub fn audit_call(kind: &str, width: u32, fold: u32) -> String {
    format!("window.__chronicleAudit&&window.__chronicleAudit({{\"kind\":{},\"width\":{width},\"fold\":{fold}}})", json!(kind))
}

/// The audit's JavaScript without its `<script>` wrapper. Frames never carry it:
/// it is evaluated here, in the capture window, right before the call, so the
/// function that runs is always Chronicle's own, whatever the page defines.
pub fn audit_source() -> String {
    let s = super::frame::AUDIT.trim();
    let s = s.strip_prefix("<script>").unwrap_or(s);
    let s = s.strip_suffix("</script>").unwrap_or(s);
    s.trim().to_string()
}

/// One rendered frame: the picture and what the audit found in it.
pub struct Capture { pub png: Vec<u8>, pub audit: Vec<Finding> }

/// Destroys the hidden window however the render ends — success, error, or panic.
struct CloseOnDrop(tauri::WebviewWindow);
impl Drop for CloseOnDrop {
    fn drop(&mut self) { let _ = self.0.destroy(); }
}

fn title_of(win: &tauri::WebviewWindow) -> Option<String> {
    let (tx, rx) = mpsc::channel();
    win.with_webview(move |pw| {
        let wk: &objc2_web_kit::WKWebView = unsafe { &*(pw.inner() as *const objc2_web_kit::WKWebView) };
        let t = unsafe { wk.title() }.map(|s| s.to_string());
        let _ = tx.send(t);
    }).ok()?;
    rx.recv_timeout(Duration::from_secs(2)).ok().flatten()
}

fn snapshot_png(win: &tauri::WebviewWindow, snapshot_width: u32) -> Result<Vec<u8>, String> {
    use block2::RcBlock;
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep, NSImage};
    use objc2_foundation::{NSDictionary, NSError, NSNumber};
    use objc2_web_kit::WKSnapshotConfiguration;
    let (tx, rx) = mpsc::channel::<Result<Vec<u8>, String>>();
    win.with_webview(move |pw| {
        let wk: &objc2_web_kit::WKWebView = unsafe { &*(pw.inner() as *const objc2_web_kit::WKWebView) };
        // with_webview runs this on the main thread
        let Some(mtm) = MainThreadMarker::new() else { let _ = tx.send(Err("the capture didn't run on the main thread".into())); return };
        let config = unsafe { WKSnapshotConfiguration::new(mtm) };
        unsafe { config.setSnapshotWidth(Some(&NSNumber::new_f64(snapshot_width as f64))) };
        let block = RcBlock::new(move |img: *mut NSImage, _err: *mut NSError| {
            let out = (|| {
                let img = unsafe { img.as_ref() }.ok_or("the page couldn't be captured")?;
                let tiff = img.TIFFRepresentation().ok_or("the capture had no image data")?;
                let rep = NSBitmapImageRep::imageRepWithData(&tiff).ok_or("the capture couldn't be read")?;
                let png = unsafe { rep.representationUsingType_properties(NSBitmapImageFileType::PNG, &NSDictionary::new()) }
                    .ok_or("the capture couldn't be saved as a picture")?;
                Ok::<Vec<u8>, &str>(png.to_vec())
            })().map_err(|e| e.to_string());
            let _ = tx.send(out);
        });
        unsafe { wk.takeSnapshotWithConfiguration_completionHandler(Some(&config), &block) };
    }).map_err(|e| e.to_string())?;
    rx.recv_timeout(Duration::from_secs(10)).map_err(|_| "the capture timed out".to_string())?
}

/// Runs `js` in the page and returns the string it evaluates to ("" for
/// undefined/null). Anything that isn't a string is an error, never a cast.
fn evaluate(win: &tauri::WebviewWindow, js: &str) -> Result<String, String> {
    use block2::RcBlock;
    use objc2::runtime::AnyObject;
    use objc2_foundation::{NSError, NSString};
    let (tx, rx) = mpsc::channel::<Result<String, String>>();
    let js = js.to_string();
    win.with_webview(move |pw| {
        let wk: &objc2_web_kit::WKWebView = unsafe { &*(pw.inner() as *const objc2_web_kit::WKWebView) };
        let block = RcBlock::new(move |result: *mut AnyObject, err: *mut NSError| {
            let out = if !err.is_null() { Err("the audit couldn't run in the page".to_string()) }
                else { match unsafe { result.as_ref() } {
                    None => Ok(String::new()),
                    Some(obj) => obj.downcast_ref::<NSString>().map(|s| s.to_string())
                        .ok_or_else(|| "the audit answered with something that isn't text".to_string()),
                } };
            let _ = tx.send(out);
        });
        unsafe { wk.evaluateJavaScript_completionHandler(&NSString::from_str(&js), Some(&block)) };
    }).map_err(|e| e.to_string())?;
    rx.recv_timeout(Duration::from_secs(5)).map_err(|_| "the audit timed out".to_string())?
}

/// Polls the page's title until the reporter's `chronicle-ready:<height>` appears
/// or `wait` runs out. → the reported height (`fallback` when unparsable), or
/// None when the page never said it was ready.
fn wait_ready(wait: Duration, fallback: u32, mut title: impl FnMut() -> Option<String>) -> Option<u32> {
    let started = Instant::now();
    loop {
        if let Some(h) = title().as_deref().and_then(|t| t.strip_prefix("chronicle-ready:")) {
            return Some(h.trim().parse().unwrap_or(fallback));
        }
        if started.elapsed() >= wait { return None; }
        std::thread::sleep(Duration::from_millis(100));
    }
}

/// The only place a capture window may go: `chronicle-file://<that design host's hash>/…`.
fn stays_on_design_host(u: &url::Url, hash: &str) -> bool {
    u.scheme() == "chronicle-file" && u.host_str() == Some(hash)
}

static THUMB_WINDOWS: AtomicU64 = AtomicU64::new(0);

/// Renders one frame in its own hidden window and returns its picture and audit.
/// The window is destroyed on every path out of here, early errors included. An
/// audit that can't run leaves the audit empty (logged); only the picture can fail.
#[allow(clippy::too_many_arguments)]
fn render_frame(app: &tauri::AppHandle, hash: &str, url: &str, frame_id: &str, file: &str, width: u32, height: u32, kind: &str) -> Result<Capture, String> {
    let parsed = url.parse().map_err(|_| "that frame's address couldn't be built".to_string())?;
    // label never "main": the IPC capability is scoped to "main", so this window gets none
    let label = format!("design-thumb-{}", THUMB_WINDOWS.fetch_add(1, Ordering::Relaxed));
    let width = width.clamp(1, MAX_FRAME_WIDTH);
    let (_, height) = capture_size(width, height);
    // if hidden windows don't paint (Task 20 live check), use .visible(true).position(-30000.0, -30000.0) instead
    let win = WebviewWindowBuilder::new(app, &label, WebviewUrl::External(parsed))
        .visible(false).focused(false).skip_taskbar(true).decorations(false)
        .inner_size(width as f64, height as f64)
        // the capture window stays on its own design host: no link or script can move it elsewhere
        .on_navigation({ let hash = hash.to_string(); move |u| stays_on_design_host(u, &hash) })
        .build().map_err(|e| e.to_string())?;
    let guard = CloseOnDrop(win);
    let win = &guard.0;

    // a frame that never reports ready (blank, or a script that never lets it load)
    // fails here, at READY_WAIT: no audit, no snapshot, the next frame goes on
    let page_h = wait_ready(READY_WAIT, height, || title_of(win))
        .ok_or_else(|| format!("the frame didn't finish loading within {} seconds (it may be blank)", READY_WAIT.as_secs()))?;
    let (snap_w, page_h) = capture_size(width, page_h);
    let _ = win.set_size(tauri::LogicalSize::new(width as f64, page_h as f64));
    std::thread::sleep(Duration::from_millis(150));
    // the first screen is the frame's own height, not the grown window's
    let js = format!("{};\n{}", audit_source(), audit_call(kind, width, height));
    let audit = match evaluate(win, &js) {
        Ok(s) => super::lint::from_audit(frame_id, file, &s),
        Err(e) => { eprintln!("design audit skipped for frame {frame_id}: {e}"); vec![] }
    };
    Ok(Capture { png: snapshot_png(win, snap_w)?, audit })
}

/// Renders each frame from `<url_base>/<file>`, writing `<out_dir>/<id>.png` when
/// there is an out dir. A frame that fails is skipped and the rest go on. Returns
/// the ids whose picture was made and every frame's audit findings; errors only
/// when frames existed and not a single one rendered.
fn render_frames(app: &tauri::AppHandle, hash: &str, url_base: &str, out_dir: Option<&Path>, frames: Vec<(String, String, u32, u32)>, kind: &str) -> Result<(Vec<String>, Vec<Finding>), String> {
    // a poisoned lock only means an earlier render panicked; its window is already gone
    let _one_at_a_time = RENDER.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(d) = out_dir { std::fs::create_dir_all(d).map_err(|e| e.to_string())?; }
    let total = frames.len();
    let mut done = Vec::new();
    let mut findings = Vec::new();
    let mut failures: Vec<String> = Vec::new();
    for (id, file, width, height) in frames {
        let url = format!("{url_base}/{file}");
        let out = render_frame(app, hash, &url, &id, &file, width, height, kind).and_then(|c| {
            findings.extend(c.audit);
            match out_dir {
                Some(d) => std::fs::write(d.join(format!("{id}.png")), c.png).map_err(|e| e.to_string()),
                None => Ok(()),
            }
        });
        match out {
            Ok(()) => done.push(id),
            Err(e) => failures.push(format!("{id}: {e}")),
        }
    }
    if done.is_empty() && !failures.is_empty() {
        return Err(format!("none of the {total} frame pictures could be made ({} failed; first: {}). Try again once the design has finished changing.", failures.len(), failures[0]));
    }
    Ok((done, findings))
}

/// Renders every frame of one version into its `thumbs/`, with every frame's audit.
fn render_version(app: &tauri::AppHandle, hash: &str, slug: &str, n: u32, vdir: &Path, frames: Vec<(String, String, u32, u32)>, kind: &str) -> Result<(Vec<String>, Vec<Finding>), String> {
    let (ids, findings) = render_frames(app, hash, &format!("chronicle-file://{hash}/{slug}/.versions/v{n}"), Some(&vdir.join("thumbs")), frames, kind)?;
    Ok((ids.iter().map(|id| thumb_rel(slug, n, id)).collect(), findings))
}

/// The design host's hash for this project, registered with the web layer.
fn design_host(web: &State<'_, crate::web::WebState>, project: &Path) -> Result<String, String> {
    let designs_dir = super::ensure_root(project)?;
    crate::web::register_design_root(web, &designs_dir)
}

/// Impeccable's detector over one `frames/` folder, or the sentence saying why it couldn't run.
async fn detect(frames_dir: PathBuf) -> Result<Vec<Finding>, String> {
    match (crate::setup::design_plugin_dir(), crate::setup::resolve("node")) {
        (Some(plugin), Some(node)) => tauri::async_runtime::spawn_blocking(move || {
            super::lint::run_detector(Path::new(&node), &super::lint::detector_script(&plugin), &frames_dir)
        }).await.map_err(|e| e.to_string())?,
        (None, _) => Err("The design skills aren't bundled with this build".into()),
        (_, None) => Err("The anti-pattern check needs the engine from Setup & health".into()),
    }
}

#[tauri::command]
pub async fn design_thumbnails(app: tauri::AppHandle, roots: State<'_, OpenRoots>, web: State<'_, crate::web::WebState>, dir: String, slug: String, n: u32) -> Result<Vec<String>, String> {
    let p = project_for(&roots, &dir)?;
    let design = super::design_dir(&p.dir, &slug)?;
    let vdir: PathBuf = design.join(".versions").join(format!("v{n}"));
    if !vdir.is_dir() { return Err("that version isn't here any more".into()); }
    let hash = design_host(&web, &p.dir)?;
    let frames = thumb_frames(&vdir);
    if frames.is_empty() { return Ok(vec![]); }
    let kind = design_kind(&vdir);
    // waiting on the page blocks, so it runs off the async pool; the web view work
    // itself is dispatched to the main thread by `with_webview`
    tauri::async_runtime::spawn_blocking(move || render_version(&app, &hash, &slug, n, &vdir, frames, &kind).map(|(t, _)| t))
        .await.map_err(|e| e.to_string())?
}

/// Turn end: one version's thumbnails, its audit and the detector, written as
/// `.review/lint/v<n>.json` and counted on the version. → `{ thumbs, lint }`.
#[tauri::command]
pub async fn design_review_version(app: tauri::AppHandle, roots: State<'_, OpenRoots>, web: State<'_, crate::web::WebState>, dir: String, slug: String, n: u32) -> Result<Value, String> {
    let p = project_for(&roots, &dir)?;
    let design = super::design_dir(&p.dir, &slug)?;
    let vdir = design.join(".versions").join(format!("v{n}"));
    if !vdir.is_dir() { return Err("that version isn't here any more".into()); }
    let hash = design_host(&web, &p.dir)?;
    let frames = thumb_frames(&vdir);
    let kind = design_kind(&vdir);
    let (thumbs, audits) = if frames.is_empty() { (vec![], vec![]) } else {
        let (a, v) = (app.clone(), vdir.clone());
        tauri::async_runtime::spawn_blocking(move || render_version(&a, &hash, &slug, n, &v, frames, &kind))
            .await.map_err(|e| e.to_string())??
    };
    let detector = detect(vdir.join("frames")).await;
    let report = super::lint::report(Some(n), &super::now_iso(), detector, audits);
    super::lint::write_report(&design, &format!("v{n}"), &report)?;
    super::versions::mark(&design, n, Some(report.counts()), None, None)?;
    Ok(json!({ "thumbs": thumbs, "lint": report }))
}

/// The design's current frames (or just `frame`) as they are on disk, never a version.
fn current_frames(design: &Path, frame: Option<&str>) -> Result<Vec<(String, String, u32, u32)>, String> {
    let frames = thumb_frames(design);
    match frame {
        None => Ok(frames),
        Some(id) => {
            let one: Vec<_> = frames.into_iter().filter(|f| f.0 == id).collect();
            if one.is_empty() { Err(format!("This design has no frame called \"{id}\" in design.json")) } else { Ok(one) }
        }
    }
}

/// Mid-turn: pictures of the current files of one frame or all, written to
/// `.review/captures/<frame id>.png`. → the absolute paths written.
#[tauri::command]
pub async fn design_capture(app: tauri::AppHandle, roots: State<'_, OpenRoots>, web: State<'_, crate::web::WebState>, dir: String, slug: String, frame: Option<String>) -> Result<Vec<String>, String> {
    let p = project_for(&roots, &dir)?;
    let design = super::design_dir(&p.dir, &slug)?;
    let frames = current_frames(&design, frame.as_deref())?;
    if frames.is_empty() { return Ok(vec![]); }
    let hash = design_host(&web, &p.dir)?;
    let kind = design_kind(&design);
    let out = design.join(".review").join("captures");
    let (ids, _) = {
        let out = out.clone();
        tauri::async_runtime::spawn_blocking(move || render_frames(&app, &hash, &format!("chronicle-file://{hash}/{slug}"), Some(&out), frames, &kind))
            .await.map_err(|e| e.to_string())??
    };
    Ok(ids.iter().map(|id| out.join(format!("{id}.png")).to_string_lossy().to_string()).collect())
}

/// Mid-turn: the audit and the detector over the current files, written as
/// `.review/lint/current.json` (`version: null`). → that report.
#[tauri::command]
pub async fn design_lint_current(app: tauri::AppHandle, roots: State<'_, OpenRoots>, web: State<'_, crate::web::WebState>, dir: String, slug: String) -> Result<Value, String> {
    let p = project_for(&roots, &dir)?;
    let design = super::design_dir(&p.dir, &slug)?;
    let frames = thumb_frames(&design);
    let kind = design_kind(&design);
    let audits = if frames.is_empty() { vec![] } else {
        let hash = design_host(&web, &p.dir)?;
        tauri::async_runtime::spawn_blocking(move || render_frames(&app, &hash, &format!("chronicle-file://{hash}/{slug}"), None, frames, &kind).map(|(_, f)| f))
            .await.map_err(|e| e.to_string())??
    };
    let detector = detect(design.join("frames")).await;
    let report = super::lint::report(None, &super::now_iso(), detector, audits);
    super::lint::write_report(&design, "current", &report)?;
    serde_json::to_value(&report).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn thumbnail_paths_and_frames_come_from_the_version() {
        assert_eq!(thumb_rel("home", 3, "desktop"), "home/.versions/v3/thumbs/desktop.png");
        let d = std::env::temp_dir().join(format!("chronicle-thumbs-{}", std::process::id()));
        std::fs::create_dir_all(&d).unwrap();
        std::fs::write(d.join("design.json"), r#"{"frames":[{"id":"desktop","file":"frames/desktop.html","width":1440,"height":900},{"id":"bad"}]}"#).unwrap();
        assert_eq!(thumb_frames(&d), vec![("desktop".to_string(), "frames/desktop.html".to_string(), 1440, 900)]);
    }

    #[test]
    fn the_audit_call_names_the_kind_width_and_fold() {
        assert_eq!(audit_call("ecommerce", 390, 844), r#"window.__chronicleAudit&&window.__chronicleAudit({"kind":"ecommerce","width":390,"fold":844})"#);
        // a kind that isn't one of ours still produces valid JS (the audit falls back to "app")
        assert!(audit_call("x\"y", 1, 1).contains("x\\\"y"));
    }

    #[test]
    fn the_audit_is_redefined_from_chronicles_own_source() {
        let src = audit_source();
        assert!(!src.trim_start().starts_with("<script>"));
        assert!(!src.trim_end().ends_with("</script>"));
        assert!(src.contains("window.__chronicleAudit"));
    }

    #[test]
    fn current_frames_are_read_from_design_json_with_the_same_safety_rules() {
        let d = std::env::temp_dir().join(format!("chronicle-thumbs-cur-{}", std::process::id()));
        std::fs::create_dir_all(&d).unwrap();
        std::fs::write(d.join("design.json"), r#"{"kind":"ecommerce","frames":[{"id":"desktop","file":"frames/desktop.html","width":1440,"height":900},{"id":"../x","file":"frames/a.html","width":10}]}"#).unwrap();
        assert_eq!(thumb_frames(&d), vec![("desktop".to_string(), "frames/desktop.html".to_string(), 1440, 900)]);
        assert_eq!(design_kind(&d), "ecommerce");
        std::fs::write(d.join("design.json"), r#"{"frames":[]}"#).unwrap();
        assert_eq!(design_kind(&d), "app");
    }

    #[test]
    fn captures_are_at_most_720_wide_and_never_too_tall_to_capture() {
        // wide frame: shrunk to 720, so the window may be twice 8000 points tall (capped by the reporter's 16000)
        assert_eq!(capture_size(1440, 900), (720, 900));
        assert_eq!(capture_size(1440, 16_000), (720, 15_999));
        assert_eq!(capture_size(1440, 50_000), (720, 15_999));
        // narrow frame: captured at its own width, so at 2x the window stays under 8000 points
        assert_eq!(capture_size(390, 20_000), (390, 7_999));
        assert_eq!(capture_size(390, 844), (390, 844));
        // very wide frame: the reporter's cap wins
        assert_eq!(capture_size(2880, 40_000), (720, 16_000));
        // degenerate input never divides by zero or makes an empty window
        assert_eq!(capture_size(0, 0), (1, 1));
        for (w, h) in [(1440, 16_000), (390, 20_000), (2880, 40_000), (721, 99_999)] {
            let (sw, wh) = capture_size(w, h);
            assert!((wh as u64 * sw as u64 * 2 / w as u64) < 16_000, "{w}x{h}");
        }
    }

    #[test]
    fn a_frame_that_never_reports_ready_fails_at_the_ready_wait() {
        let wait = Duration::from_millis(300);
        let started = Instant::now();
        assert_eq!(wait_ready(wait, 900, || Some("Untitled".into())), None);
        let took = started.elapsed();
        assert!(took >= wait && took < wait + Duration::from_millis(400), "gave up after {took:?}");
        assert_eq!(wait_ready(wait, 900, || Some("chronicle-ready:2400".into())), Some(2400));
        assert_eq!(wait_ready(wait, 900, || Some("chronicle-ready:x".into())), Some(900));
        let mut polls = 0;
        assert_eq!(wait_ready(wait, 900, || { polls += 1; (polls > 1).then(|| "chronicle-ready:10".into()) }), Some(10));
    }
    #[test]
    fn the_capture_window_only_goes_to_its_own_design_host() {
        let ok = |s: &str| stays_on_design_host(&s.parse().unwrap(), "abc123");
        assert!(ok("chronicle-file://abc123/home/.versions/v1/frames/a.html"));
        assert!(!ok("chronicle-file://other/home/.versions/v1/frames/a.html"));
        assert!(!ok("https://abc123/home"));
        assert!(!ok("about:blank"));
    }

    #[test]
    fn a_frame_that_would_write_or_load_outside_its_version_is_skipped() {
        let d = std::env::temp_dir().join(format!("chronicle-thumbs-unsafe-{}", std::process::id()));
        std::fs::create_dir_all(&d).unwrap();
        std::fs::write(d.join("design.json"), r#"{"frames":[
            {"id":"../../escape","file":"frames/a.html","width":100},
            {"id":"a.b","file":"frames/a.html","width":100},
            {"id":"up","file":"../../other/frames/a.html","width":100},
            {"id":"abs","file":"/etc/passwd","width":100},
            {"id":"query","file":"frames/a.html?x=1","width":100},
            {"id":"zero","file":"frames/a.html","width":0},
            {"id":"mobile_1","file":"frames/mobile.html","width":390}
        ]}"#).unwrap();
        assert_eq!(thumb_frames(&d), vec![("mobile_1".to_string(), "frames/mobile.html".to_string(), 390, 900)]);
        std::fs::write(d.join("design.json"), "not json").unwrap();
        assert!(thumb_frames(&d).is_empty());
    }
}
