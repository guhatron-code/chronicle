//! What a design frame is served with: a policy that keeps generated pages off
//! the network and away from Chronicle, CORS so an opaque-origin page can load
//! its own fonts, and a tiny reporter that tells the canvas how the page went.
//!
//! None of this runs against the URL string a request arrives with. The design
//! host (`WebState::design_roots` in `web.rs`) is rooted at a project's
//! `.chronicle/designs` directory and nowhere above it, so there is no vault or
//! checkout file for a clever relative path to reach even if it tried — and
//! `is_design_file` below runs on the CANONICAL path the filesystem actually
//! resolved to (after `resolve_project_file`'s jail and macOS's case-insensitive
//! canonicalisation have both already run), never on the raw request string, so
//! case-folding or a `../` sequence can't talk it into treating housekeeping
//! (`.threads/`, `.gitignore`, anything else sitting directly under the design
//! root) as a design page.

use std::path::{Component, Path};

/// True if `rel` — the file's path relative to the canonical design root,
/// itself already canonical — is a real design page: at least two components
/// (a slug directory plus something inside it, which admits a slug's own
/// `.versions/…` — thumbnails and version frames need the same treatment as
/// the live frame), every component a plain name, and the slug itself not
/// starting with a dot. That last rule is what keeps `.threads/`, `.gitignore`,
/// and any other file Chronicle keeps directly under the design root off the
/// design host — the check runs after canonicalisation, so it can't be argued
/// around by case or `..`.
pub fn is_design_file(rel: &Path) -> bool {
    let comps: Vec<Component> = rel.components().collect();
    if comps.len() < 2 { return false; }
    if !comps.iter().all(|c| matches!(c, Component::Normal(_))) { return false; }
    match comps[0] {
        Component::Normal(s) => !s.to_string_lossy().starts_with('.'),
        _ => false,
    }
}

/// The CSP for one design frame's response, scoped to exactly that design:
/// every source is `chronicle-file://<hash>/<slug>/` and nothing else — never
/// widened to the bare `chronicle-file:` scheme, which would let one design
/// reach another's files, or another project's (the design host and a
/// project's own `chronicle-file://` host share the scheme, only the host
/// segment tells them apart). `'unsafe-inline'` stays on script/style because
/// a generated page's own `<script>`/`<style>` tags need to run; everything a
/// design page could use to reach the network or Chronicle stays `'none'`.
///
/// Whether WebKit actually matches a custom-scheme host source like this one
/// against requests from an opaque-origin SANDBOXED iframe — rather than, say,
/// folding the whole directive to nothing because the origin is opaque — is
/// not something a Rust unit test can confirm. That is what Task 20's live
/// check in a real window is for; this module only builds the string.
///
/// `slug` becomes a fragment of an HTTP header, so it must already be the
/// shape `super::valid_slug` promises before it gets here — a folder named
/// e.g. `a; connect-src *` would otherwise inject its own directive into the
/// policy the browser parses (CSP takes the first of a duplicated directive,
/// so an attacker-chosen folder name could win). The caller (`web::
/// serve_design_file`) is the one place a slug comes from disk rather than
/// `slugify()`, and it checks this before ever calling here; this debug
/// assertion is the belt to that caller's suspenders, not a substitute for it
/// — it does nothing in a release build.
pub fn design_csp(hash: &str, slug: &str) -> String {
    debug_assert!(super::valid_slug(slug), "a design CSP must never be built from an unvalidated slug");
    let src = format!("chronicle-file://{hash}/{slug}/");
    format!(
        "default-src 'none'; script-src {src} 'unsafe-inline'; style-src {src} 'unsafe-inline'; img-src {src} data: https:; font-src {src}; media-src {src}; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'"
    )
}

/// Extensions a design page may fetch cross-origin from its own host: font
/// files (a sandboxed frame's opaque origin still puts `Origin: null` on its
/// own `@font-face` request, which the browser checks against the response's
/// CORS headers) and ES module scripts (`<script type=module>`/`import`, which
/// carry the same opaque-origin check). Nothing else gets
/// `Access-Control-Allow-Origin`: a design page has no legitimate reason to
/// `fetch()` its own HTML or images cross-origin, `connect-src 'none'` already
/// refuses the attempt, and there is no reason to widen CORS beyond what fonts
/// and modules actually need.
fn wants_acao(ext: Option<&str>) -> bool {
    matches!(ext, Some("woff") | Some("woff2") | Some("ttf") | Some("otf") | Some("mjs"))
}

/// The headers one design response gets: always the CSP scoped to `hash`/`slug`,
/// plus `Access-Control-Allow-Origin: *` only when `ext` (lower-cased, no dot)
/// is a font or `.mjs`.
pub fn design_headers(hash: &str, slug: &str, ext: Option<&str>) -> Vec<(&'static str, String)> {
    let mut h = vec![("Content-Security-Policy", design_csp(hash, slug))];
    if wants_acao(ext) { h.push(("Access-Control-Allow-Origin", "*".to_string())); }
    h
}

/// Posted to `parent` as it happens: `ready` (fonts settled, first paint size),
/// `height` (a later resize), `error` (a script error), `blank` (nothing ever
/// painted), and `escape` (Escape was pressed inside the frame — the canvas
/// can't see key events once a sandboxed iframe has focus, so the frame has to
/// say so itself). Every reported height is capped at 16000: a page sized with
/// `100vh` and no other constraint can otherwise report an unbounded height,
/// since the canvas sets the iframe's own height to whatever is reported.
pub const REPORTER: &str = r#"<script>(function(){var P=window.parent,top=P===window;function H(){var d=document.documentElement,b=document.body;var h=Math.max(d?d.scrollHeight:0,b?b.scrollHeight:0);return Math.min(h,16000)}function S(m){m.__chronicleFrame=1;try{P.postMessage(m,'*')}catch(e){}}addEventListener('error',function(e){S({type:'error',message:String(e.message||'The page hit an error'),line:e.lineno||0})});addEventListener('keydown',function(e){if(e.key==='Escape'||e.keyCode===27){S({type:'escape'})}});addEventListener('load',function(){var f=document.fonts&&document.fonts.ready?document.fonts.ready:Promise.resolve();f.then(function(){var b=document.body;if(!b||(!b.children.length&&!b.textContent.trim())){S({type:'blank'});return}var h=H();S({type:'ready',height:h});if(top)document.title='chronicle-ready:'+h})});if(window.ResizeObserver){var last=0;new ResizeObserver(function(){var h=H();if(h!==last){last=h;S({type:'height',height:h})}}).observe(document.documentElement)}addEventListener('message',function(e){var d=e.data;if(!d||d.__chronicleCanvas!==1||d.type!=='locate')return;var rect=null;try{var el=document.querySelector(String(d.selector||''));if(el){var b=el.getBoundingClientRect();rect={x:b.left+scrollX,y:b.top+scrollY,w:b.width,h:b.height}}}catch(err){}S({type:'located',id:d.id,rect:rect})});})();</script>"#;

/// The audit the hidden capture window evaluates (`window.__chronicleAudit`),
/// from this source, after the page is ready. It is never served into a frame
/// (spec §7): the canvas's frames carry only the reporter.
pub const AUDIT: &str = include_str!("../../resources/design/audit.js");

/// Splices `REPORTER` in right after the opening `<head…>` tag (so it runs
/// before anything else in `<head>`, catching even a head script's own error),
/// falling back to right after the opening `<html…>` tag when there is no
/// `<head`, and finally prepending it when there is no `<html` either.
pub fn inject_reporter(html: &[u8]) -> Vec<u8> {
    let text = String::from_utf8_lossy(html);
    // ASCII-only case folding: every byte it touches is a single-byte ASCII
    // character, and every UTF-8 continuation byte (>= 0x80) is left alone, so
    // byte length and char-boundary offsets stay identical to `text` — an
    // offset found in `lower` is safe to slice `text` with.
    let lower = text.to_ascii_lowercase();
    if let Some(at) = tag_open_end(&lower, "<head") { return splice_at(&text, at); }
    if let Some(at) = tag_open_end(&lower, "<html") { return splice_at(&text, at); }
    let mut s = String::from(REPORTER);
    s.push_str(&text);
    s.into_bytes()
}

fn splice_at(text: &str, at: usize) -> Vec<u8> {
    let mut s = String::with_capacity(text.len() + REPORTER.len());
    s.push_str(&text[..at]);
    s.push_str(REPORTER);
    s.push_str(&text[at..]);
    s.into_bytes()
}

/// The byte offset right after the `>` that closes an opening `<head…>` or
/// `<html…>` tag — skipping a false match like `<header` (the character right
/// after the tag name must not itself be a name character) and an unterminated
/// one (no `>` at all). `lower` shares byte offsets with the original text
/// (see `inject_reporter`), so the offset this returns is safe to slice it at.
fn tag_open_end(lower: &str, tag: &str) -> Option<usize> {
    let mut from = 0;
    while let Some(found) = lower[from..].find(tag) {
        let start = from + found;
        let after_name = start + tag.len();
        let is_boundary = match lower.as_bytes().get(after_name) {
            Some(c) => !(c.is_ascii_alphanumeric() || *c == b'-' || *c == b'_'),
            None => false,
        };
        if is_boundary {
            return lower[after_name..].find('>').map(|gt| after_name + gt + 1);
        }
        from = start + 1;
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_real_design_pages_pass_the_design_check() {
        assert!(is_design_file(Path::new("home/frames/a.html")));
        assert!(is_design_file(Path::new("home/assets/fonts/x.woff2")));
        // a slug's own .versions/ still needs the design treatment — thumbnails
        // and version frames render there too
        assert!(is_design_file(Path::new("home/.versions/v1/frames/a.html")));
        // housekeeping directly under the design root is never a page
        assert!(!is_design_file(Path::new(".threads/s/thread.jsonl")));
        assert!(!is_design_file(Path::new(".gitignore")));
        // the slug alone, nothing inside it
        assert!(!is_design_file(Path::new("home")));
    }

    #[test]
    #[should_panic]
    fn design_csp_refuses_to_build_from_an_unvalidated_slug() {
        // a folder that reached disk without going through slugify() (hand
        // edited, or from before slugify() existed) must never be trusted as
        // a CSP header fragment — the caller is supposed to reject it before
        // this ever runs; this is the debug-only belt behind that suspenders
        let _ = design_csp("abc123", "a; connect-src *");
    }

    #[test]
    fn the_design_policy_scopes_every_source_to_the_slug_and_never_widens_to_the_whole_scheme() {
        let csp = design_csp("abc123", "home");
        for part in ["default-src 'none'", "connect-src 'none'", "frame-src 'none'", "form-action 'none'", "base-uri 'none'"] {
            assert!(csp.contains(part), "missing {part}");
        }
        let src = "chronicle-file://abc123/home/";
        for dir in ["script-src", "style-src", "img-src", "font-src", "media-src"] {
            assert!(csp.contains(&format!("{dir} {src}")), "{dir} isn't scoped to {src} in: {csp}");
        }
        assert!(!csp.contains("'self'"), "a design page's own host is the source, never 'self'");
        assert!(!csp.contains("chronicle-file: "), "must never widen to the bare scheme: {csp}");
        assert!(!csp.contains("chronicle-file:;"), "must never widen to the bare scheme: {csp}");

        let html_headers = design_headers("abc123", "home", Some("html"));
        assert!(html_headers.iter().any(|(k, v)| *k == "Content-Security-Policy" && v == &csp));
        assert!(!html_headers.iter().any(|(k, _)| *k == "Access-Control-Allow-Origin"), "an html response gets no ACAO");

        for ext in ["woff", "woff2", "ttf", "otf", "mjs"] {
            let h = design_headers("abc123", "home", Some(ext));
            assert!(h.iter().any(|(k, v)| *k == "Access-Control-Allow-Origin" && v == "*"), "{ext} must get ACAO");
        }
        for ext in ["png", "css", "js", "svg"] {
            let h = design_headers("abc123", "home", Some(ext));
            assert!(!h.iter().any(|(k, _)| *k == "Access-Control-Allow-Origin"), "{ext} must not get ACAO");
        }
    }

    #[test]
    fn the_reporter_lands_right_after_the_opening_head_tag() {
        let out = String::from_utf8(inject_reporter(b"<html><HEAD><title>x</title></HEAD><body>hi</body></html>")).unwrap();
        assert!(out.starts_with("<html><HEAD><script>"), "{out}");

        // an attribute on <head> doesn't confuse the boundary check
        let with_attrs = String::from_utf8(inject_reporter(b"<html><head lang=\"en\"><meta></head><body>hi</body></html>")).unwrap();
        assert!(with_attrs.starts_with("<html><head lang=\"en\"><script>"), "{with_attrs}");

        // no <head> at all — falls back to right after <html…>
        let no_head = String::from_utf8(inject_reporter(b"<html lang=\"en\"><body>hi</body></html>")).unwrap();
        assert!(no_head.starts_with("<html lang=\"en\"><script>"), "{no_head}");

        // <header> is a real HTML5 tag and must never be mistaken for <head>
        let with_header = String::from_utf8(inject_reporter(b"<html><header>nav</header><body>hi</body></html>")).unwrap();
        assert!(with_header.starts_with("<html><script>"), "{with_header}");

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
        // a multi-byte character sitting right next to the head tag must not
        // break the byte-offset slice — to_ascii_lowercase preserves char
        // boundaries because it only ever rewrites single-byte ASCII bytes
        let html = "<html><head><title>caf\u{e9} \u{2603}</title></head><body>hi</body></html>".as_bytes();
        let out = String::from_utf8(inject_reporter(html)).unwrap();
        assert!(out.contains("__chronicleFrame"));
        assert!(out.contains("caf\u{e9}"));
    }

    #[test]
    fn the_reporter_answers_locate_and_the_audit_is_never_served_into_a_frame() {
        assert!(REPORTER.contains("'locate'") && REPORTER.contains("'located'") && REPORTER.contains("__chronicleCanvas"));
        assert!(AUDIT.contains("window.__chronicleAudit=") || AUDIT.contains("window.__chronicleAudit ="));
        for html in [&b"<html><head><title>t</title></head><body></body></html>"[..], b"<html><body></body></html>", b"<p>bare</p>"] {
            let out = String::from_utf8(inject_reporter(html)).unwrap();
            let r = out.find(REPORTER).expect("reporter present");
            assert!(!out.contains("__chronicleAudit"), "the audit stays out of the canvas's frames");
            assert_eq!(out.len(), html.len() + REPORTER.len());
            assert!(r <= out.find("<title>").unwrap_or(usize::MAX));
        }
    }
}
