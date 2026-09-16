//! The action bridge: the app listens on a Unix socket; `chronicle --mcp` and the CLI
//! connect, send one JSON line, and read one back. A per-launch token keeps a stale
//! process out; the project allowlist keeps an unopened project out.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::{Path, PathBuf};
use std::sync::Arc;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub(crate) struct Request { pub token: String, pub dir: String, pub action: String, #[serde(default)] pub args: Value }

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub(crate) struct Reply { pub ok: bool, pub summary: String, #[serde(skip_serializing_if = "Option::is_none")] pub data: Option<Value> }

pub(crate) fn socket_path() -> PathBuf { crate::config_dir().join("app.sock") }
pub(crate) fn token_path() -> PathBuf { crate::config_dir().join("app.token") }

/// A fresh 32-byte token as hex, written 0600 — a stale `chronicle` process holding
/// the previous launch's token is refused rather than answered.
pub(crate) fn write_token_at(path: &Path) -> Result<String, String> {
    use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
    let mut bytes = [0u8; 32];
    std::fs::File::open("/dev/urandom")
        .and_then(|mut f| std::io::Read::read_exact(&mut f, &mut bytes))
        .map_err(|e| e.to_string())?;
    let token: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    if let Some(p) = path.parent() { std::fs::create_dir_all(p).map_err(|e| e.to_string())?; }
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

/// One connection: read a line, check the token, hand the request to the app, write
/// one line back. Anything malformed still gets a reply the caller can print.
pub(crate) fn serve_connection(stream: UnixStream, token: &str, handle: &dyn Fn(Request) -> Reply) {
    let _ = stream.set_read_timeout(Some(std::time::Duration::from_secs(30)));
    let mut reader = BufReader::new(match stream.try_clone() { Ok(s) => s, Err(_) => return });
    let mut line = String::new();
    if reader.read_line(&mut line).is_err() { return }
    let reply = match serde_json::from_str::<Request>(line.trim()) {
        Err(_) => Reply { ok: false, summary: "That request isn't one line of JSON with token, dir, action and args.".into(), data: None },
        Ok(req) if req.token != token => Reply { ok: false, summary: BAD_TOKEN.into(), data: None },
        Ok(req) => handle(req),
    };
    let mut w = stream;
    let _ = writeln!(w, "{}", serde_json::to_string(&reply).unwrap_or_default());
    let _ = w.flush();
}

/// Bind the socket and answer forever, one thread per connection. A socket file left
/// behind by a crashed launch is removed first, so a bind never fails on our own litter.
pub(crate) fn listen(token: String, handle: Arc<dyn Fn(Request) -> Reply + Send + Sync>) -> Result<(), String> {
    let sock = socket_path();
    if let Some(p) = sock.parent() { std::fs::create_dir_all(p).map_err(|e| e.to_string())?; }
    let _ = std::fs::remove_file(&sock);
    let listener = UnixListener::bind(&sock).map_err(|e| format!("couldn't listen on {}: {e}", sock.display()))?;
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
// the callers are the CLI and MCP fronts, which arrive with the action capabilities
#[allow(dead_code)]
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
    BufReader::new(stream).read_line(&mut line).map_err(|_| "Chronicle didn't answer.".to_string())?;
    let reply: Reply = serde_json::from_str(line.trim()).map_err(|_| "Chronicle answered with something that isn't a reply.".to_string())?;
    if reply.ok { Ok(reply) } else { Err(reply.summary) }
}

#[allow(dead_code)]
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
        let a = write_token_at(&d.join("app.token")).unwrap();
        let b = write_token_at(&d.join("app.token")).unwrap();
        assert_ne!(a, b);
        assert_eq!(a.len(), 64);
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(std::fs::metadata(d.join("app.token")).unwrap().permissions().mode() & 0o777, 0o600);
    }
}
