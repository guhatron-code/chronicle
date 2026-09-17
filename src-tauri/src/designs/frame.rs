//! What a design frame is served with: a policy that keeps generated pages off
//! the network and away from Chronicle, CORS so an opaque-origin page can load
//! its own fonts, and a tiny reporter that tells the canvas how the page went.

/// A design path is anything under `.chronicle/designs/<slug>/…` — including a
/// slug's own `.versions/…` (thumbnails and version frames need the same
/// treatment as the live frame) — except the sibling housekeeping entries that
/// sit directly under `.chronicle/designs/` itself (`.threads/`, `.gitignore`,
/// `order.json`'s neighbours-to-be, anything else starting with a dot). Those
/// are Chronicle's own bookkeeping, never a page to hand to a frame.
pub fn is_design_path(rel: &str) -> bool {
    let Some(after) = rel.strip_prefix(".chronicle/designs/") else { return false };
    match after.split('/').next() {
        Some(first) if !first.is_empty() && !first.starts_with('.') => true,
        _ => false,
    }
}

pub const DESIGN_CSP: &str = "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; media-src 'self'; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'";

pub fn design_headers() -> Vec<(&'static str, String)> {
    vec![("Content-Security-Policy", DESIGN_CSP.to_string()), ("Access-Control-Allow-Origin", "*".to_string())]
}

/// Posted to `parent` as it happens: `ready` (fonts settled, first paint size),
/// `height` (a later resize), `error` (a script error), `blank` (nothing ever
/// painted), and `escape` (Escape was pressed inside the frame — the canvas
/// can't see key events once a sandboxed iframe has focus, so the frame has to
/// say so itself). Every reported height is capped at 16000: a page sized with
/// `100vh` and no other constraint can otherwise report an unbounded height,
/// since the canvas sets the iframe's own height to whatever is reported.
pub const REPORTER: &str = r#"<script>(function(){var P=window.parent,top=P===window;function H(){var d=document.documentElement,b=document.body;var h=Math.max(d?d.scrollHeight:0,b?b.scrollHeight:0);return Math.min(h,16000)}function S(m){m.__chronicleFrame=1;try{P.postMessage(m,'*')}catch(e){}}addEventListener('error',function(e){S({type:'error',message:String(e.message||'The page hit an error'),line:e.lineno||0})});addEventListener('keydown',function(e){if(e.key==='Escape'||e.keyCode===27){S({type:'escape'})}});addEventListener('load',function(){var f=document.fonts&&document.fonts.ready?document.fonts.ready:Promise.resolve();f.then(function(){var b=document.body;if(!b||(!b.children.length&&!b.textContent.trim())){S({type:'blank'});return}var h=H();S({type:'ready',height:h});if(top)document.title='chronicle-ready:'+h})});if(window.ResizeObserver){var last=0;new ResizeObserver(function(){var h=H();if(h!==last){last=h;S({type:'height',height:h})}}).observe(document.documentElement)}})();</script>"#;

pub fn inject_reporter(html: &[u8]) -> Vec<u8> {
    let text = String::from_utf8_lossy(html);
    // ASCII-only case folding: every byte it touches is a single-byte ASCII
    // character, and every UTF-8 continuation byte (>= 0x80) is left alone, so
    // byte length and char-boundary offsets stay identical to `text` — the
    // index found in `lower` is safe to slice `text` with.
    let lower = text.to_ascii_lowercase();
    match lower.find("</head>") {
        Some(i) => { let mut s = String::with_capacity(text.len() + REPORTER.len()); s.push_str(&text[..i]); s.push_str(REPORTER); s.push_str(&text[i..]); s.into_bytes() }
        None => { let mut s = String::from(REPORTER); s.push_str(&text); s.into_bytes() }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_design_pages_get_the_design_treatment() {
        assert!(is_design_path(".chronicle/designs/home/frames/a.html"));
        assert!(is_design_path(".chronicle/designs/home/assets/fonts/x.woff2"));
        assert!(!is_design_path(".chronicle/designs/.threads/s/thread.jsonl"));
        assert!(!is_design_path("docs/index.html"));
        assert!(!is_design_path(".chronicle/notes/a.md"));
        // dot entries directly under designs/ are Chronicle's own bookkeeping,
        // never a design page — but a slug's own .versions/ is still a design page
        assert!(!is_design_path(".chronicle/designs/.gitignore"));
        assert!(is_design_path(".chronicle/designs/home/.versions/v1/frames/a.html"));
    }
    #[test]
    fn the_design_policy_blocks_the_network_and_allows_its_own_files() {
        for part in ["default-src 'none'", "connect-src 'none'", "font-src 'self'", "frame-src 'none'", "form-action 'none'", "img-src 'self' data: https:"] {
            assert!(DESIGN_CSP.contains(part), "missing {part}");
        }
        let h = design_headers();
        assert!(h.iter().any(|(k, v)| *k == "Content-Security-Policy" && v == DESIGN_CSP));
        assert!(h.iter().any(|(k, v)| *k == "Access-Control-Allow-Origin" && v == "*"));
    }
    #[test]
    fn the_reporter_goes_before_head_close_or_first() {
        let out = String::from_utf8(inject_reporter(b"<html><HEAD><title>x</title></HEAD><body>hi</body></html>")).unwrap();
        let r = out.find("__chronicleFrame").unwrap();
        assert!(r < out.find("</HEAD>").unwrap());
        let bare = String::from_utf8(inject_reporter(b"<p>no head</p>")).unwrap();
        assert!(bare.starts_with("<script>"));
    }
    #[test]
    fn the_reporter_reports_escape_and_caps_height() {
        assert!(REPORTER.contains("escape"), "must post an escape message so the canvas can react to it from inside a sandboxed iframe");
        assert!(REPORTER.contains("16000"), "every reported height must be capped at 16000");
    }
    #[test]
    fn the_reporter_survives_non_ascii_html_without_panicking() {
        // a multi-byte character sitting right next to the closing tag must not
        // break the byte-offset slice — to_ascii_lowercase preserves char
        // boundaries because it only ever rewrites single-byte ASCII bytes
        let html = "<html><head><title>caf\u{e9} \u{2603}</title></head><body>hi</body></html>".as_bytes();
        let out = String::from_utf8(inject_reporter(html)).unwrap();
        assert!(out.contains("__chronicleFrame"));
        assert!(out.contains("caf\u{e9}"));
    }
}
