//! One PNG per frame per version, rendered by a hidden native web view that loads
//! the frame through `chronicle-file://` (the design host, never the project
//! host), waits for the reporter's ready title (fonts included, at most five
//! seconds; a frame still loading then is captured anyway and its audit says it
//! hadn't finished), grows to the page height, runs Chronicle's own audit in the page,
//! and snapshots. The same window serves the review at turn end (thumbs, audit,
//! detector, lint report) and the director's mid-turn capture and lint. Beside
//! every PNG go two small JPEGs — the first screen and the full page, at most
//! 900 px wide — which are what the reviewers read.
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

/// The script the capture window evaluates for a frame's audit: Chronicle's own
/// source, then the call. None when the audit is not wanted (gate off, or a
/// picture only).
pub fn audit_script(audit: bool, kind: &str, width: u32, fold: u32) -> Option<String> {
    audit.then(|| format!("{};\n{}", audit_source(), audit_call(kind, width, fold)))
}

/// Review crops are at most this many pixels wide, and this JPEG quality.
const REVIEW_WIDTH: u32 = 900;
const REVIEW_QUALITY: u8 = 80;

/// The two JPEGs that go beside a capture PNG: the first screen (`fold` points
/// tall in a frame `frame_w` points wide — the PNG's own scale is read off its
/// width) and the full page, each shrunk to at most 900 px wide. These are what
/// a reviewer reads; the PNG is many times the size.
pub fn review_jpegs(png: &[u8], frame_w: u32, fold: u32) -> Result<(Vec<u8>, Vec<u8>), String> {
    use image::{codecs::jpeg::JpegEncoder, imageops::{resize, FilterType}, RgbImage};
    let img = image::load_from_memory(png).map_err(|e| format!("the capture couldn't be read: {e}"))?.into_rgb8();
    let (w, h) = img.dimensions();
    if w == 0 || h == 0 { return Err("the capture is empty".into()); }
    let fold_px = ((fold as f64 * w as f64 / frame_w.max(1) as f64).round() as u32).clamp(1, h);
    let encode = |src: &RgbImage| -> Result<Vec<u8>, String> {
        let (sw, sh) = src.dimensions();
        let shrunk;
        let src = if sw > REVIEW_WIDTH {
            let nh = ((sh as f64 * REVIEW_WIDTH as f64 / sw as f64).round() as u32).max(1);
            shrunk = resize(src, REVIEW_WIDTH, nh, FilterType::Triangle);
            &shrunk
        } else { src };
        let mut out = Vec::new();
        JpegEncoder::new_with_quality(&mut out, REVIEW_QUALITY).encode_image(src).map_err(|e| format!("the crop couldn't be saved: {e}"))?;
        Ok(out)
    };
    let fold_crop = image::imageops::crop_imm(&img, 0, 0, w, fold_px).to_image();
    Ok((encode(&fold_crop)?, encode(&img)?))
}

/// Writes `<id>.png` and its two review JPEGs into `dir`.
fn write_capture(dir: &Path, id: &str, c: &Capture) -> Result<(), String> {
    let (fold, full) = review_jpegs(&c.png, c.frame_w, c.fold)?;
    for (name, bytes) in [(format!("{id}.png"), &c.png), (format!("{id}.fold.jpg"), &fold), (format!("{id}.jpg"), &full)] {
        std::fs::write(dir.join(name), bytes).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// One rendered frame: the picture, what the audit found in it, and the frame's
/// own width and fold (points) so the picture's first screen can be cut out.
pub struct Capture { pub png: Vec<u8>, pub audit: Vec<Finding>, pub frame_w: u32, pub fold: u32 }

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

/// The minor finding a frame gets when its ready title never arrived; None when it did.
pub fn not_ready_finding(ready: bool, frame_id: &str, file: &str) -> Option<Finding> {
    (!ready).then(|| Finding {
        rule: "audit:not-ready".into(), severity: "minor".into(),
        text: "The frame hadn't finished loading when it was checked".into(),
        frame: frame_id.into(), file: file.into(), line: None, selector: None,
    })
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
fn render_frame(app: &tauri::AppHandle, hash: &str, url: &str, frame_id: &str, file: &str, width: u32, height: u32, kind: &str, audit: bool) -> Result<Capture, String> {
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

    // a frame that never reports ready (slow, blank, or a script that never lets it
    // load) is still captured at its declared height after READY_WAIT, and audited
    let ready = wait_ready(READY_WAIT, height, || title_of(win));
    let (snap_w, page_h) = capture_size(width, ready.unwrap_or(height));
    let _ = win.set_size(tauri::LogicalSize::new(width as f64, page_h as f64));
    std::thread::sleep(Duration::from_millis(150));
    // the first screen is the frame's own height, not the grown window's
    let mut findings = match audit_script(audit, kind, width, height).map(|js| evaluate(win, &js)) {
        None => vec![],
        Some(Ok(s)) => super::lint::from_audit(frame_id, file, &s),
        Some(Err(e)) => { eprintln!("design audit skipped for frame {frame_id}: {e}"); vec![] }
    };
    // so the gate never reads clean over a frame it saw half-loaded
    if audit { findings.extend(not_ready_finding(ready.is_some(), frame_id, file)); }
    let audit = findings;
    Ok(Capture { png: snapshot_png(win, snap_w)?, audit, frame_w: width, fold: height })
}

/// Renders each frame from `<url_base>/<file>`, writing `<out_dir>/<id>.png` and
/// its review JPEGs (`<id>.fold.jpg`, `<id>.jpg`) when there is an out dir. A frame that fails is skipped and the rest go on. Returns
/// the ids whose picture was made and every frame's audit findings; errors only
/// when frames existed and not a single one rendered.
fn render_frames(app: &tauri::AppHandle, hash: &str, url_base: &str, out_dir: Option<&Path>, frames: Vec<(String, String, u32, u32)>, kind: &str, audit: bool) -> Result<(Vec<String>, Vec<Finding>), String> {
    // a poisoned lock only means an earlier render panicked; its window is already gone
    let _one_at_a_time = RENDER.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(d) = out_dir { std::fs::create_dir_all(d).map_err(|e| e.to_string())?; }
    let total = frames.len();
    let mut done = Vec::new();
    let mut findings = Vec::new();
    let mut failures: Vec<String> = Vec::new();
    for (id, file, width, height) in frames {
        let url = format!("{url_base}/{file}");
        let out = render_frame(app, hash, &url, &id, &file, width, height, kind, audit).and_then(|mut c| {
            findings.extend(std::mem::take(&mut c.audit));
            match out_dir {
                Some(d) => write_capture(d, &id, &c),
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

/// Renders every frame of one version into its `thumbs/`, with every frame's audit when `audit`.
#[allow(clippy::too_many_arguments)]
fn render_version(app: &tauri::AppHandle, hash: &str, slug: &str, n: u32, vdir: &Path, frames: Vec<(String, String, u32, u32)>, kind: &str, audit: bool) -> Result<(Vec<String>, Vec<Finding>), String> {
    let (ids, findings) = render_frames(app, hash, &format!("chronicle-file://{hash}/{slug}/.versions/v{n}"), Some(&vdir.join("thumbs")), frames, kind, audit)?;
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
    tauri::async_runtime::spawn_blocking(move || render_version(&app, &hash, &slug, n, &vdir, frames, &kind, false).map(|(t, _)| t))
        .await.map_err(|e| e.to_string())?
}

/// Turn end: one version's thumbnails, its audit and the detector, written as
/// `.review/lint/v<n>.json` and counted on the version. → `{ thumbs, lint }`.
/// With the gate off (`lint: false`) only the thumbnails are made, and the
/// report says the gate is off: no audit, no detector, no counts on the version.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn design_review_version(app: tauri::AppHandle, roots: State<'_, OpenRoots>, web: State<'_, crate::web::WebState>, dir: String, slug: String, n: u32, lint: Option<bool>) -> Result<Value, String> {
    let lint = lint.unwrap_or(true);
    let p = project_for(&roots, &dir)?;
    let design = super::design_dir(&p.dir, &slug)?;
    let vdir = design.join(".versions").join(format!("v{n}"));
    if !vdir.is_dir() { return Err("that version isn't here any more".into()); }
    let hash = design_host(&web, &p.dir)?;
    let frames = thumb_frames(&vdir);
    let kind = design_kind(&vdir);
    let (thumbs, audits) = if frames.is_empty() { (vec![], vec![]) } else {
        let (a, v) = (app.clone(), vdir.clone());
        tauri::async_runtime::spawn_blocking(move || render_version(&a, &hash, &slug, n, &v, frames, &kind, lint))
            .await.map_err(|e| e.to_string())??
    };
    let report = if lint {
        let detector = detect(vdir.join("frames")).await;
        super::lint::report(Some(n), &super::now_iso(), detector, audits)
    } else {
        super::lint::gate_off(Some(n), &super::now_iso())
    };
    super::lint::write_report(&design, &format!("v{n}"), &report)?;
    super::versions::mark(&design, n, lint.then(|| report.counts()), None, None)?;
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
/// `.review/captures/<frame id>.png` (with `<frame id>.fold.jpg` and
/// `<frame id>.jpg` beside each). → the absolute paths of the PNGs written.
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
        tauri::async_runtime::spawn_blocking(move || render_frames(&app, &hash, &format!("chronicle-file://{hash}/{slug}"), Some(&out), frames, &kind, false))
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
        tauri::async_runtime::spawn_blocking(move || render_frames(&app, &hash, &format!("chronicle-file://{hash}/{slug}"), None, frames, &kind, true).map(|(_, f)| f))
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
    fn the_audit_runs_only_when_the_gate_wants_it() {
        assert_eq!(audit_script(false, "landing", 1440, 900), None);
        let js = audit_script(true, "landing", 1440, 900).unwrap();
        assert!(js.starts_with(&audit_source()));
        assert!(js.ends_with(&audit_call("landing", 1440, 900)));
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
    fn a_frame_that_never_reports_ready_is_captured_anyway_and_flagged() {
        let wait = Duration::from_millis(300);
        let started = Instant::now();
        assert_eq!(wait_ready(wait, 900, || Some("Untitled".into())), None);
        let took = started.elapsed();
        assert!(took >= wait && took < wait + Duration::from_millis(400), "gave up after {took:?}");
        assert_eq!(wait_ready(wait, 900, || Some("chronicle-ready:2400".into())), Some(2400));
        assert_eq!(wait_ready(wait, 900, || Some("chronicle-ready:x".into())), Some(900));
        let mut polls = 0;
        assert_eq!(wait_ready(wait, 900, || { polls += 1; (polls > 1).then(|| "chronicle-ready:10".into()) }), Some(10));
        // never ready: the capture proceeds at the declared height, and the audit says so
        assert_eq!(capture_size(1440, wait_ready(Duration::ZERO, 900, || None).unwrap_or(900)), capture_size(1440, 900));
        let f = not_ready_finding(false, "desktop", "frames/desktop.html").unwrap();
        assert_eq!(f, Finding { rule: "audit:not-ready".into(), severity: "minor".into(),
            text: "The frame hadn't finished loading when it was checked".into(),
            frame: "desktop".into(), file: "frames/desktop.html".into(), line: None, selector: None });
        assert!(not_ready_finding(true, "desktop", "frames/desktop.html").is_none());
    }
    #[test]
    fn a_capture_gets_a_fold_crop_and_a_full_page_jpeg_at_most_900_wide() {
        // a 1440-point frame captured at 720 points on a 2x screen: 1440 px wide, 4000 px tall, fold 900 points
        let mut png = Vec::new();
        image::RgbaImage::from_fn(1440, 4000, |_, y| image::Rgba([(y % 256) as u8, 40, 200, 255]))
            .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png).unwrap();
        let (fold, full) = review_jpegs(&png, 1440, 900).unwrap();
        assert_eq!(image::guess_format(&fold).unwrap(), image::ImageFormat::Jpeg);
        assert_eq!(image::guess_format(&full).unwrap(), image::ImageFormat::Jpeg);
        let fold = image::load_from_memory(&fold).unwrap();
        let full = image::load_from_memory(&full).unwrap();
        assert_eq!((fold.width(), fold.height()), (900, 563), "the first screen: 900 of 1440 points, shrunk to 900 px wide");
        assert_eq!((full.width(), full.height()), (900, 2500), "the full page, shrunk the same way");
        // a phone frame on a 2x screen (780 px wide) is narrower than 900 and keeps its size; a fold past the page's end is the page
        let mut small = Vec::new();
        image::RgbImage::from_pixel(780, 1000, image::Rgb([9, 9, 9])).write_to(&mut std::io::Cursor::new(&mut small), image::ImageFormat::Png).unwrap();
        let dims = |b: &[u8]| { let i = image::load_from_memory(b).unwrap(); (i.width(), i.height()) };
        let (fold, full) = review_jpegs(&small, 390, 844).unwrap();
        assert_eq!(dims(&fold), (780, 1000), "a fold past the page's end is the whole page");
        assert_eq!(dims(&full), (780, 1000));
        let (fold, _) = review_jpegs(&small, 390, 200).unwrap();
        assert_eq!(dims(&fold), (780, 400));
        assert!(review_jpegs(b"not a picture", 390, 200).is_err());
        // on disk: the png and both jpegs land beside each other
        let d = std::env::temp_dir().join(format!("chronicle-thumbs-jpeg-{}", std::process::id()));
        std::fs::create_dir_all(&d).unwrap();
        write_capture(&d, "desktop", &Capture { png: small, audit: vec![], frame_w: 390, fold: 200 }).unwrap();
        for f in ["desktop.png", "desktop.fold.jpg", "desktop.jpg"] { assert!(d.join(f).is_file(), "{f}"); }
        assert_eq!(image::image_dimensions(d.join("desktop.fold.jpg")).unwrap(), (780, 400));
        let _ = std::fs::remove_dir_all(&d);
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
