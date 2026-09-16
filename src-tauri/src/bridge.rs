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

/// The gate on `project.open`, and the only one: every other action runs on a project
/// the user already opened, so the allowlist speaks for it. This one runs on a folder
/// the app has never seen, and opening a folder is what PUTS it on the allowlist — so
/// whoever holds the token could otherwise hand the app `/etc`. Two conditions, and the
/// canonical path back: the caller's string is never what the app is told to open.
pub(crate) fn admit_project_open(dir: &str) -> Result<PathBuf, String> {
    // relative means "from where the caller is standing", and the app is standing
    // somewhere else entirely — resolving one here would open a folder nobody named
    if !Path::new(dir).is_absolute() { return Err(format!("{dir} isn't an absolute path.")) }
    // `..` inside an absolute path is no threat once it resolves: the resolved folder
    // still has to be a Chronicle project to get past the next line
    let canon = PathBuf::from(dir).canonicalize().map_err(|_| format!("There is no folder at {dir}."))?;
    if !canon.is_dir() { return Err(format!("There is no folder at {dir}.")) }
    if !(canon.join("chronicle.json").is_file() || canon.join(".chronicle").is_dir()) {
        return Err(format!("{dir} isn't a Chronicle project."));
    }
    Ok(canon)
}

/// Make a directory 0700, but only if we are the ones creating it — `DirBuilder`'s mode
/// applies to what it creates and leaves an existing folder (`$HOME`, say, when the
/// token path is overridden) exactly as it was.
fn make_private_dir(p: &Path) -> Result<(), String> {
    use std::os::unix::fs::DirBuilderExt;
    std::fs::DirBuilder::new().recursive(true).mode(0o700).create(p).map_err(|e| e.to_string())
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
    // a 0600 token inside a world-readable folder still leaks who is listening and lets
    // another user drop files beside the socket — a folder we make is the user's alone
    if let Some(p) = path.parent() { make_private_dir(p)?; }
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

/// Equal lengths, then every byte, with no early exit. A `==` on the token would return
/// the moment it found a mismatch, and a peer that can time the answer learns the token
/// one byte at a time.
fn token_matches(given: &str, want: &str) -> bool {
    let (a, b) = (given.as_bytes(), want.as_bytes());
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

const NOT_A_REQUEST: &str = "That request isn't one line of JSON with token, dir, action and args.";
/// One request is a few hundred bytes. A peer that writes and never sends a newline
/// would otherwise grow `line` until the app runs out of memory, so the read stops here.
const MAX_REQUEST: u64 = 1 << 20;

/// One connection: read a line, check the token, hand the request to the app, write
/// one line back. Anything malformed still gets a reply the caller can print.
pub(crate) fn serve_connection(stream: UnixStream, token: &str, handle: &dyn Fn(Request) -> Reply) {
    let _ = stream.set_read_timeout(Some(std::time::Duration::from_secs(30)));
    // and a write timeout: a peer that sends a request and then stops reading would
    // otherwise park this thread in `write` for as long as it cared to
    let _ = stream.set_write_timeout(Some(std::time::Duration::from_secs(30)));
    let mut reader = BufReader::new(match stream.try_clone() { Ok(s) => s, Err(_) => return }).take(MAX_REQUEST);
    // bytes, not a string: a line that isn't UTF-8 is still a request someone is waiting
    // on an answer to, and `read_line` would fail it into silence
    let mut buf = Vec::new();
    let Ok(n) = reader.read_until(b'\n', &mut buf) else { return };
    // the cap was reached with no newline in sight: this is not a request, and the rest
    // of whatever the peer is sending is never read
    let over = n as u64 == MAX_REQUEST && buf.last() != Some(&b'\n');
    let line = String::from_utf8_lossy(&buf);
    let reply = if over {
        Reply { ok: false, summary: NOT_A_REQUEST.into(), data: None }
    } else {
        match serde_json::from_str::<Request>(line.trim()) {
            Err(_) => Reply { ok: false, summary: NOT_A_REQUEST.into(), data: None },
            Ok(req) if !token_matches(&req.token, token) => Reply { ok: false, summary: BAD_TOKEN.into(), data: None },
            Ok(req) => handle(req),
        }
    };
    let mut w = stream;
    let _ = writeln!(w, "{}", serde_json::to_string(&reply).unwrap_or_default());
    let _ = w.flush();
}

/// Is a Chronicle answering on this socket right now? A missing file, or one left by a
/// crash that nobody listens on, is `false`; only a peer that ANSWERS is `true`. Connect
/// alone is not proof (a just-closed listener can still accept for a moment), so an empty
/// line is sent — not a request, and a Chronicle says so — and that sentence is the proof.
/// This is what keeps a second launch from becoming a second window (main.rs).
pub(crate) fn running_instance(sock: &Path) -> bool {
    let Ok(mut s) = UnixStream::connect(sock) else { return false };
    let _ = s.set_read_timeout(Some(std::time::Duration::from_secs(3)));
    let _ = s.set_write_timeout(Some(std::time::Duration::from_secs(3)));
    if writeln!(s).is_err() { return false }
    let mut line = String::new();
    matches!(BufReader::new(s).read_line(&mut line), Ok(n) if n > 0)
}

/// Bind the socket and answer forever, one thread per connection. A socket file left
/// behind by a crashed launch is removed first, so a bind never fails on our own litter —
/// but a socket that ANSWERS is another Chronicle, not litter, and is left alone.
pub(crate) fn listen(token: String, handle: Arc<dyn Fn(Request) -> Reply + Send + Sync>) -> Result<(), String> {
    listen_at(&socket_path(), token, handle)
}

pub(crate) fn listen_at(sock: &Path, token: String, handle: Arc<dyn Fn(Request) -> Reply + Send + Sync>) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    // its own parent, the same way the token makes one: listening must not depend on
    // `write_token` having run first
    if let Some(p) = sock.parent() { make_private_dir(p)?; }
    if running_instance(sock) {
        return Err(format!("another Chronicle is already listening on {}.", sock.display()));
    }
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

    /// A second Chronicle used to sweep the first one's socket away as "litter" and
    /// overwrite its token, leaving the running app with a bridge nobody could reach
    /// (round 8, Tasks/Untitled.md). A socket that answers is a neighbour, not litter.
    #[test]
    fn a_live_socket_is_not_litter() {
        let d = scratch("live");
        let p = d.join("app.sock");
        listen_at(&p, "t".into(), Arc::new(|_| Reply { ok: true, summary: "first".into(), data: None })).unwrap();
        let e = listen_at(&p, "t".into(), Arc::new(|_| Reply { ok: true, summary: "second".into(), data: None })).unwrap_err();
        assert!(e.contains("already listening"), "{e}");
        std::fs::write(d.join("app.token"), "t").unwrap();
        let r = call_at(&p, &d.join("app.token"), Path::new("/p"), "round.plan", json!({}), "plan a round").unwrap();
        assert_eq!(r.summary, "first", "the first listener must survive the second attempt");
    }

    #[test]
    fn a_dead_socket_file_is_still_swept() {
        let d = scratch("dead");
        let p = d.join("app.sock");
        { let _l = UnixListener::bind(&p).unwrap(); } // bound, then gone: the file stays, nobody answers
        assert!(p.exists());
        listen_at(&p, "t".into(), Arc::new(|_| Reply { ok: true, summary: "new".into(), data: None })).unwrap();
        std::fs::write(d.join("app.token"), "t").unwrap();
        let r = call_at(&p, &d.join("app.token"), Path::new("/p"), "round.plan", json!({}), "plan a round").unwrap();
        assert_eq!(r.summary, "new");
    }

    #[test]
    fn running_instance_is_true_only_for_a_listener() {
        let d = scratch("running");
        assert!(!running_instance(&d.join("missing.sock")));
        let stale = d.join("stale.sock");
        { let _l = UnixListener::bind(&stale).unwrap(); }
        assert!(stale.exists());
        assert!(!running_instance(&stale), "a crash leftover is not a running app");
        let sock = fake_app(&d, "t", |_| Reply { ok: true, summary: String::new(), data: None });
        assert!(running_instance(&sock));
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

    /// The one action that runs on a folder the app has never opened, so this check is
    /// the whole of what keeps the open-project allowlist from being widened to
    /// anywhere on the disk by whoever holds the token.
    #[test]
    fn only_a_real_chronicle_project_may_be_opened() {
        let d = scratch("admit");
        let proj = d.join("proj");
        std::fs::create_dir_all(proj.join(".chronicle")).unwrap();
        let by_json = d.join("byjson");
        std::fs::create_dir_all(&by_json).unwrap();
        std::fs::write(by_json.join("chronicle.json"), "{}").unwrap();

        // admitted, and what comes back is the resolved path, not the caller's string
        assert_eq!(admit_project_open(proj.to_str().unwrap()).unwrap(), proj.canonicalize().unwrap());
        assert_eq!(admit_project_open(by_json.to_str().unwrap()).unwrap(), by_json.canonicalize().unwrap());
        // `..` inside an absolute path is fine: it resolves, and what it resolves to
        // still has to be a project
        let climbed = format!("{}/proj/../proj", d.display());
        assert_eq!(admit_project_open(&climbed).unwrap(), proj.canonicalize().unwrap());
        let out = format!("{}/proj/../..", d.display());
        assert!(admit_project_open(&out).is_err(), "climbing out lands somewhere that isn't a project");

        // a relative path would resolve against the APP's directory, not the caller's
        assert_eq!(admit_project_open("proj").unwrap_err(), "proj isn't an absolute path.");
        assert_eq!(admit_project_open("../proj").unwrap_err(), "../proj isn't an absolute path.");
        // a folder that isn't there, and a folder that is but isn't a project
        let missing = d.join("nope");
        assert_eq!(admit_project_open(missing.to_str().unwrap()).unwrap_err(),
                   format!("There is no folder at {}.", missing.display()));
        let plain = d.join("plain");
        std::fs::create_dir_all(&plain).unwrap();
        assert_eq!(admit_project_open(plain.to_str().unwrap()).unwrap_err(),
                   format!("{} isn't a Chronicle project.", plain.display()));
        // a file resolves, but it is not a folder, so it is not a folder we can open
        let f = d.join("file.txt");
        std::fs::write(&f, "x").unwrap();
        assert_eq!(admit_project_open(f.to_str().unwrap()).unwrap_err(),
                   format!("There is no folder at {}.", f.display()));
        assert_eq!(admit_project_open("/etc").unwrap_err(), "/etc isn't a Chronicle project.");
    }

    #[test]
    fn the_token_check_does_not_answer_faster_for_a_closer_guess() {
        assert!(token_matches("abc", "abc"));
        assert!(!token_matches("abd", "abc"));
        assert!(!token_matches("ab", "abc"), "a prefix is not the token");
        assert!(!token_matches("abcd", "abc"));
        assert!(token_matches("", ""));
    }

    /// The mode belongs to folders we make. An overridden token path under an existing
    /// folder (`$HOME`, in the worst case) must leave that folder exactly as it was.
    #[test]
    fn making_the_token_folder_never_re_chmods_one_that_was_already_there() {
        use std::os::unix::fs::PermissionsExt;
        let d = scratch("dirmode");
        std::fs::set_permissions(&d, std::fs::Permissions::from_mode(0o755)).unwrap();
        write_token_at(&d.join("app.token")).unwrap();
        assert_eq!(std::fs::metadata(&d).unwrap().permissions().mode() & 0o777, 0o755,
                   "the folder was already there: its mode is the user's business, not ours");
        write_token_at(&d.join("made/app.token")).unwrap();
        assert_eq!(std::fs::metadata(d.join("made")).unwrap().permissions().mode() & 0o777, 0o700,
                   "the one we made is ours to make private");
    }

    #[test]
    fn a_request_line_that_isnt_utf8_still_gets_an_answer() {
        let d = scratch("notutf8");
        let sock = fake_app(&d, "secret", |_| Reply { ok: true, summary: "never reached".into(), data: None });
        let mut s = UnixStream::connect(&sock).unwrap();
        s.write_all(&[0xff, 0xfe, b'{', 0x80, b'\n']).unwrap();
        s.flush().unwrap();
        let mut line = String::new();
        BufReader::new(s).read_line(&mut line).unwrap();
        let reply: Reply = serde_json::from_str(line.trim()).unwrap();
        assert!(!reply.ok);
        assert_eq!(reply.summary, "That request isn't one line of JSON with token, dir, action and args.");
    }
}
