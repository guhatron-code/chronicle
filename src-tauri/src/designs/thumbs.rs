//! One PNG per frame per version, rendered by a hidden native web view that loads
//! the frame through `chronicle-file://` (the design host, never the project
//! host), waits for the reporter's ready title (fonts included, at most five
//! seconds), grows to the page height, and snapshots.
//!
//! The hidden window's label never matches "main", so the capability in
//! `capabilities/default.json` (scoped to webview "main") gives it no IPC.
use serde_json::Value;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc;
use std::time::{Duration, Instant};
use tauri::{State, WebviewUrl, WebviewWindowBuilder};
use crate::{project_for, OpenRoots};

/// The reporter caps the height it reports at this; the window never grows past it either.
const MAX_PAGE_HEIGHT: u32 = 16_000;
const MAX_FRAME_WIDTH: u32 = 8_000;
const READY_WAIT: Duration = Duration::from_secs(5);

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

fn snapshot_png(win: &tauri::WebviewWindow) -> Result<Vec<u8>, String> {
    use block2::RcBlock;
    use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep, NSImage};
    use objc2_foundation::{NSDictionary, NSError};
    let (tx, rx) = mpsc::channel::<Result<Vec<u8>, String>>();
    win.with_webview(move |pw| {
        let wk: &objc2_web_kit::WKWebView = unsafe { &*(pw.inner() as *const objc2_web_kit::WKWebView) };
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
        unsafe { wk.takeSnapshotWithConfiguration_completionHandler(None, &block) };
    }).map_err(|e| e.to_string())?;
    rx.recv_timeout(Duration::from_secs(10)).map_err(|_| "the capture timed out".to_string())?
}

static THUMB_WINDOWS: AtomicU64 = AtomicU64::new(0);

/// Renders one frame in its own hidden window and returns PNG bytes. The window is
/// destroyed on every path out of here, early errors included.
fn render_frame(app: &tauri::AppHandle, url: &str, width: u32, height: u32) -> Result<Vec<u8>, String> {
    let parsed = url.parse().map_err(|_| "that frame's address couldn't be built".to_string())?;
    // label never "main": the IPC capability is scoped to "main", so this window gets none
    let label = format!("design-thumb-{}", THUMB_WINDOWS.fetch_add(1, Ordering::Relaxed));
    let (width, height) = (width.min(MAX_FRAME_WIDTH), height.clamp(1, MAX_PAGE_HEIGHT));
    // if hidden windows don't paint (Task 20 live check), use .visible(true).position(-30000.0, -30000.0) instead
    let win = WebviewWindowBuilder::new(app, &label, WebviewUrl::External(parsed))
        .visible(false).focused(false).skip_taskbar(true).decorations(false)
        .inner_size(width as f64, height as f64)
        .build().map_err(|e| e.to_string())?;
    let guard = CloseOnDrop(win);
    let win = &guard.0;

    let started = Instant::now();
    let mut page_h = height;
    while started.elapsed() < READY_WAIT {
        if let Some(h) = title_of(win).as_deref().and_then(|t| t.strip_prefix("chronicle-ready:")) {
            page_h = h.trim().parse().unwrap_or(height);
            break;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    let page_h = page_h.clamp(1, MAX_PAGE_HEIGHT);
    let _ = win.set_size(tauri::LogicalSize::new(width as f64, page_h as f64));
    std::thread::sleep(Duration::from_millis(150));
    snapshot_png(win)
}

/// Renders every frame of one version; a frame that fails is skipped and the rest go on.
/// Errors only when frames existed and not a single picture was written.
fn render_version(app: &tauri::AppHandle, hash: &str, slug: &str, n: u32, vdir: &Path, frames: Vec<(String, String, u32, u32)>) -> Result<Vec<String>, String> {
    let thumbs = vdir.join("thumbs");
    std::fs::create_dir_all(&thumbs).map_err(|e| e.to_string())?;
    let total = frames.len();
    let mut written = Vec::new();
    let mut failures: Vec<String> = Vec::new();
    for (id, file, width, height) in frames {
        let url = format!("chronicle-file://{hash}/{slug}/.versions/v{n}/{file}");
        let out = render_frame(app, &url, width, height)
            .and_then(|bytes| std::fs::write(thumbs.join(format!("{id}.png")), bytes).map_err(|e| e.to_string()));
        match out {
            Ok(()) => written.push(thumb_rel(slug, n, &id)),
            Err(e) => failures.push(format!("{id}: {e}")),
        }
    }
    if written.is_empty() && !failures.is_empty() {
        return Err(format!("none of the {total} frame pictures could be made ({} failed; first: {}). Try again once the design has finished changing.", failures.len(), failures[0]));
    }
    Ok(written)
}

#[tauri::command]
pub async fn design_thumbnails(app: tauri::AppHandle, roots: State<'_, OpenRoots>, web: State<'_, crate::web::WebState>, dir: String, slug: String, n: u32) -> Result<Vec<String>, String> {
    let p = project_for(&roots, &dir)?;
    let design = super::design_dir(&p.dir, &slug)?;
    let vdir: PathBuf = design.join(".versions").join(format!("v{n}"));
    if !vdir.is_dir() { return Err("that version isn't here any more".into()); }
    let designs_dir = super::ensure_root(&p.dir)?;
    let hash = crate::web::register_design_root(&web, &designs_dir)?;
    let frames = thumb_frames(&vdir);
    if frames.is_empty() { return Ok(vec![]); }
    // waiting on the page blocks, so it runs off the async pool; the web view work
    // itself is dispatched to the main thread by `with_webview`
    tauri::async_runtime::spawn_blocking(move || render_version(&app, &hash, &slug, n, &vdir, frames))
        .await.map_err(|e| e.to_string())?
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
