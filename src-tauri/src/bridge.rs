//! The action bridge: the app listens on a Unix socket; `chronicle --mcp` and the CLI
//! connect, send one JSON line, and read one back. A per-launch token keeps a stale
//! process out; the project allowlist keeps an unopened project out.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::io::{BufRead, BufReader, Read, Write};
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::{Path, PathBuf};
use std::sync::Arc;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub(crate) struct Request { pub token: String, pub dir: String, pub action: String, #[serde(default)] pub args: Value }

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub(crate) struct Reply { pub ok: bool, pub summary: String, #[serde(skip_serializing_if = "Option::is_none")] pub data: Option<Value> }

/// Both paths live in the app's config dir. The two env vars are a seam for the tests,
/// which cannot bind a socket in the real one without fighting a running Chronicle.
pub(crate) fn socket_path() -> PathBuf {
    std::env::var_os("CHRONICLE_BRIDGE_SOCKET").map(PathBuf::from)
        .unwrap_or_else(|| crate::config_dir().join("app.sock"))
}
pub(crate) fn token_path() -> PathBuf {
    std::env::var_os("CHRONICLE_BRIDGE_TOKEN").map(PathBuf::from)
        .unwrap_or_else(|| crate::config_dir().join("app.token"))
}

/// The four actions the app performs for an agent, and how to say each one in a
/// sentence. An action outside this list never reaches the frontend.
pub(crate) const ACTIONS: [&str; 4] = ["round.plan", "round.start", "project.open", "terminal.read"];

pub(crate) fn known_action(name: &str) -> bool { ACTIONS.contains(&name) }

/// "…so it can't {verb}. Open it and try again." — the refusal names what was asked for.
pub(crate) fn verb_for(action: &str) -> &'static str {
    match action {
        "round.plan" => "plan a round",
        "round.start" => "start a round",
        "project.open" => "open a project",
        "terminal.read" => "read a terminal",
        _ => "do that",
    }
}

/// A fresh 32-byte token as hex, written 0600 — a stale `chronicle` process holding
/// the previous launch's token is refused rather than answered.
pub(crate) fn write_token_at(path: &Path) -> Result<String, String> {
    use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
    let mut bytes = [0u8; 32];
    std::fs::File::open("/dev/urandom")
        .and_then(|mut f| std::io::Read::read_exact(&mut f, &mut bytes))
        .map_err(|e| e.to_string())?;
    let token: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    if let Some(p) = path.parent() {
        std::fs::create_dir_all(p).map_err(|e| e.to_string())?;
        // a 0600 token inside a world-readable folder still leaks who is listening and
        // lets another user drop files beside the socket — the folder is the user's alone
        std::fs::set_permissions(p, std::fs::Permissions::from_mode(0o700)).map_err(|e| e.to_string())?;
    }
    let mut f = std::fs::OpenOptions::new().write(true).create(true).truncate(true).mode(0o600)
        .open(path).map_err(|e| e.to_string())?;
    f.write_all(token.as_bytes()).map_err(|e| e.to_string())?;
    // the file may already have existed with wider permissions — .mode() only applies
    // when the open creates it, so set them again either way
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600)).map_err(|e| e.to_string())?;
    Ok(token)
}
pub(crate) fn write_token() -> Result<String, String> { write_token_at(&token_path()) }

const BAD_TOKEN: &str = "That token isn't this Chronicle's. Reopen the app and try again.";
const NOT_A_REQUEST: &str = "That request isn't one line of JSON with token, dir, action and args.";
/// One request is a few hundred bytes. A peer that writes and never sends a newline
/// would otherwise grow `line` until the app runs out of memory, so the read stops here.
const MAX_REQUEST: u64 = 1 << 20;

/// One connection: read a line, check the token, hand the request to the app, write
/// one line back. Anything malformed still gets a reply the caller can print.
pub(crate) fn serve_connection(stream: UnixStream, token: &str, handle: &dyn Fn(Request) -> Reply) {
    let _ = stream.set_read_timeout(Some(std::time::Duration::from_secs(30)));
    let mut reader = BufReader::new(match stream.try_clone() { Ok(s) => s, Err(_) => return }).take(MAX_REQUEST);
    let mut line = String::new();
    let Ok(n) = reader.read_line(&mut line) else { return };
    // the cap was reached with no newline in sight: this is not a request, and the rest
    // of whatever the peer is sending is never read
    let over = n as u64 >= MAX_REQUEST && !line.ends_with('\n');
    let reply = if over {
        Reply { ok: false, summary: NOT_A_REQUEST.into(), data: None }
    } else {
        match serde_json::from_str::<Request>(line.trim()) {
            Err(_) => Reply { ok: false, summary: NOT_A_REQUEST.into(), data: None },
            Ok(req) if req.token != token => Reply { ok: false, summary: BAD_TOKEN.into(), data: None },
            Ok(req) => handle(req),
        }
    };
    let mut w = stream;
    let _ = writeln!(w, "{}", serde_json::to_string(&reply).unwrap_or_default());
    let _ = w.flush();
}

/// Bind the socket and answer forever, one thread per connection. A socket file left
/// behind by a crashed launch is removed first, so a bind never fails on our own litter.
pub(crate) fn listen(token: String, handle: Arc<dyn Fn(Request) -> Reply + Send + Sync>) -> Result<(), String> {
    listen_at(&socket_path(), token, handle)
}

pub(crate) fn listen_at(sock: &Path, token: String, handle: Arc<dyn Fn(Request) -> Reply + Send + Sync>) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    if let Some(p) = sock.parent() { std::fs::create_dir_all(p).map_err(|e| e.to_string())?; }
    let _ = std::fs::remove_file(sock);
    let listener = UnixListener::bind(sock).map_err(|e| format!("couldn't listen on {}: {e}", sock.display()))?;
    // the socket carries the token check, but only this user should be able to knock
    std::fs::set_permissions(sock, std::fs::Permissions::from_mode(0o600)).map_err(|e| e.to_string())?;
    std::thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let h = handle.clone(); let t = token.clone();
            std::thread::spawn(move || serve_connection(stream, &t, &*h));
        }
    });
    Ok(())
}

/// The client side: one request, one reply. Every failure is a sentence a person can
/// act on — no socket path, no errno.
pub(crate) fn call_at(sock: &Path, token_file: &Path, dir: &Path, action: &str, args: Value, verb: &str) -> Result<Reply, String> {
    let not_open = || format!("Chronicle isn't open on this project, so it can't {verb}. Open it and try again.");
    let token = std::fs::read_to_string(token_file).map_err(|_| not_open())?;
    let mut stream = UnixStream::connect(sock).map_err(|_| not_open())?;
    // longer than the app's own 30 s wait on the frontend, so a slow action surfaces
    // as the app's own sentence rather than as a client-side cut-off
    let _ = stream.set_read_timeout(Some(std::time::Duration::from_secs(35)));
    let req = Request { token: token.trim().to_string(), dir: dir.to_string_lossy().into_owned(), action: action.into(), args };
    writeln!(stream, "{}", serde_json::to_string(&req).map_err(|e| e.to_string())?).map_err(|_| not_open())?;
    let mut line = String::new();
    let n = BufReader::new(stream).read_line(&mut line).map_err(|_| "Chronicle didn't answer.".to_string())?;
    // end of input, not a malformed reply: the app hung up, and saying "answered with
    // something that isn't a reply" would send the caller looking for a reply that
    // never existed
    if n == 0 { return Err("Chronicle closed the connection without answering.".into()) }
    let reply: Reply = serde_json::from_str(line.trim()).map_err(|_| "Chronicle answered with something that isn't a reply.".to_string())?;
    if reply.ok { Ok(reply) } else { Err(reply.summary) }
}

pub(crate) fn call(dir: &Path, action: &str, args: Value, verb: &str) -> Result<Reply, String> {
    call_at(&socket_path(), &token_path(), dir, action, args, verb)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn scratch(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("chronicle-bridge-{}-{}", name, std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    /// A listener bound to a scratch socket with a closure for the app side.
    fn fake_app(dir: &Path, token: &str, handle: impl Fn(Request) -> Reply + Send + Sync + 'static) -> PathBuf {
        let sock = dir.join("app.sock");
        let listener = UnixListener::bind(&sock).unwrap();
        let token = token.to_string();
        let handle: Arc<dyn Fn(Request) -> Reply + Send + Sync> = Arc::new(handle);
        std::thread::spawn(move || {
            for stream in listener.incoming().flatten() {
                let h = handle.clone(); let t = token.clone();
                std::thread::spawn(move || serve_connection(stream, &t, &*h));
            }
        });
        sock
    }

    #[test]
    fn a_request_round_trips_and_a_bad_token_is_refused() {
        let d = scratch("roundtrip");
        std::fs::write(d.join("app.token"), "secret").unwrap();
        let sock = fake_app(&d, "secret", |r| Reply { ok: true, summary: format!("did {} in {}", r.action, r.dir), data: Some(json!({ "n": 3 })) });
        let r = call_at(&sock, &d.join("app.token"), Path::new("/p"), "round.plan", json!({}), "plan a round").unwrap();
        assert_eq!(r.summary, "did round.plan in /p");
        assert_eq!(r.data, Some(json!({ "n": 3 })));
        std::fs::write(d.join("app.token"), "stale").unwrap();
        let e = call_at(&sock, &d.join("app.token"), Path::new("/p"), "round.plan", json!({}), "plan a round").unwrap_err();
        assert_eq!(e, "That token isn't this Chronicle's. Reopen the app and try again.");
    }

    #[test]
    fn no_app_means_one_plain_sentence() {
        let d = scratch("noapp");
        std::fs::write(d.join("app.token"), "secret").unwrap();
        let e = call_at(&d.join("missing.sock"), &d.join("app.token"), Path::new("/p"), "round.start", json!({}), "start a round").unwrap_err();
        assert_eq!(e, "Chronicle isn't open on this project, so it can't start a round. Open it and try again.");
    }

    #[test]
    fn a_refusal_from_the_app_is_an_error_with_its_sentence() {
        let d = scratch("refuse");
        std::fs::write(d.join("app.token"), "secret").unwrap();
        let sock = fake_app(&d, "secret", |_| Reply { ok: false, summary: "That project isn't open in Chronicle.".into(), data: None });
        let e = call_at(&sock, &d.join("app.token"), Path::new("/p"), "terminal.read", json!({}), "read a terminal").unwrap_err();
        assert_eq!(e, "That project isn't open in Chronicle.");
    }

    #[test]
    fn the_token_file_is_private_and_fresh_each_time() {
        let d = scratch("token");
        let inner = d.join("cfg");
        let a = write_token_at(&inner.join("app.token")).unwrap();
        let b = write_token_at(&inner.join("app.token")).unwrap();
        assert_ne!(a, b);
        assert_eq!(a.len(), 64);
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(std::fs::metadata(inner.join("app.token")).unwrap().permissions().mode() & 0o777, 0o600);
        // the folder holding the token is the user's alone: a token nobody else can
        // read is no good inside a directory anybody can list
        assert_eq!(std::fs::metadata(&inner).unwrap().permissions().mode() & 0o777, 0o700);
    }

    #[test]
    fn a_peer_that_never_sends_a_newline_is_cut_off_not_let_grow() {
        let d = scratch("flood");
        let sock = fake_app(&d, "secret", |_| Reply { ok: true, summary: "never reached".into(), data: None });
        let mut s = UnixStream::connect(&sock).unwrap();
        // a megabyte and a half of one unterminated line: the reader stops at the cap
        let chunk = vec![b'x'; 64 * 1024];
        for _ in 0..24 { let _ = s.write_all(&chunk); }
        let _ = s.flush();
        let mut line = String::new();
        BufReader::new(s).read_line(&mut line).unwrap();
        let reply: Reply = serde_json::from_str(line.trim()).unwrap();
        assert!(!reply.ok);
        assert_eq!(reply.summary, "That request isn't one line of JSON with token, dir, action and args.");
    }

    #[test]
    fn a_connection_that_closes_without_answering_says_so() {
        let d = scratch("eof");
        std::fs::write(d.join("app.token"), "secret").unwrap();
        let sock = d.join("app.sock");
        let listener = UnixListener::bind(&sock).unwrap();
        // take the request, then hang up without a reply line
        std::thread::spawn(move || {
            for s in listener.incoming().flatten() {
                let mut line = String::new();
                let _ = BufReader::new(s).read_line(&mut line);
            }
        });
        let e = call_at(&sock, &d.join("app.token"), Path::new("/p"), "round.plan", json!({}), "plan a round").unwrap_err();
        assert_eq!(e, "Chronicle closed the connection without answering.");
    }

    #[test]
    fn the_socket_is_private_to_the_user() {
        // listen_at, not listen: the env override is the agent_api test's alone, and
        // two tests setting it in one binary would race each other
        let d = scratch("sockmode");
        let sock = d.join("app.sock");
        listen_at(&sock, "secret".into(), Arc::new(|_| Reply { ok: true, summary: "ok".into(), data: None })).unwrap();
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(std::fs::metadata(&sock).unwrap().permissions().mode() & 0o777, 0o600);
    }

    #[test]
    fn the_verb_is_the_action_said_as_a_person_would() {
        assert_eq!(verb_for("round.plan"), "plan a round");
        assert_eq!(verb_for("round.start"), "start a round");
        assert_eq!(verb_for("project.open"), "open a project");
        assert_eq!(verb_for("terminal.read"), "read a terminal");
        assert_eq!(verb_for("round.explode"), "do that");
        for a in ["round.plan", "round.start", "project.open", "terminal.read"] {
            assert!(known_action(a), "{a} is an action the app performs");
        }
        assert!(!known_action("round.explode"));
        assert!(!known_action("chronicle.round.plan"), "the capability name is not the action name");
    }
}
