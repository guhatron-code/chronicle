# Agent actions, the bridge and opt-in, plan 3 of 3

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An agent can plan a round, start one in the pane or a terminal, open a project, and read a terminal's tail through the same MCP/CLI fronts as plan 1, every action visible in the app; a project opts in through one Setup row that writes `.mcp.json` and installs a `chronicle` skill.

**Architecture:** A Unix socket the app listens on (`~/Library/Application Support/Chronicle/app.sock`) with a per-launch token file beside it. The MCP/CLI process (`chronicle --mcp`, `chronicle round …`) connects, sends one JSON line, and waits for one JSON line. The app validates the token and the project, emits a Tauri event to the frontend, which performs the action with the same functions the buttons use and replies through a command. Notes and state capabilities stay disk-only. Opt-in is a per-project Setup row backed by three Rust commands.

**Tech Stack:** Rust std (`UnixListener`, threads, `Mutex<HashMap>`), Tauri events/commands, TypeScript (App.tsx dispatcher, agent-session, round-run, term-sessions), the existing skill installer pattern, vitest, cargo test.

**Spec:** `docs/superpowers/specs/2026-09-16-agent-access-and-visible-rounds-design.md` §2 (Actions), §3, §4, §7, §8.

## Global Constraints

- Socket path `config_dir()/app.sock`, token `config_dir()/app.token` (32 random bytes hex, mode 0600, rewritten on every launch; a stale token is refused). Request: one JSON line `{ "token", "dir", "action", "args" }`; reply: one JSON line `{ "ok": bool, "summary": String, "data"?: Value }`.
- Without a listening app, both fronts answer exactly: `Chronicle isn't open on this project, so it can't <verb>. Open it and try again.` where `<verb>` is `plan a round` / `start a round` / `open a project` / `read a terminal`.
- Actions require `dir` to be an OPENED project (the `OpenRoots` allowlist), except `project.open`, which requires `dir` to exist and be a directory; unknown actions and bad tokens are refused with one sentence and never reach the frontend.
- Every action the frontend performs appends a journal line via `announce(dir, "agent-action", <summary>)` and shows a toast, so nothing an agent does is silent.
- No bypass flags anywhere; the pane's permission mode governs a round; `terminal.read` returns text only.
- Nothing is registered automatically: `.mcp.json` is written only by the Setup row (merge, never clobber other servers); the `chronicle` skill installs next to `chronicle-init` with the same managed-marker rule; opt-in is recorded in `.chronicle/agent/access.json` (`{ "mcp": true, "at": <epoch ms> }`).
- The MCP `serverInfo.version` reports the app version from `tauri.conf.json`, not Cargo's.
- Copy: sentence case, no em dashes in UI strings, ` · ` separators. Shared-tree rules as in plans 1 and 2; never run an action against this repository from a test (tests use scratch dirs and a fake responder).
- Rust: `cd src-tauri && cargo test`; frontend: `npm test`, `npm run typecheck`; `cargo check` warning baseline is 1 real warning (`any_conds`).
- Commit messages end with:
  `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` and
  `Claude-Session: https://claude.ai/code/session_016TqoaAozoZzEomhGSMc6Yr`

---

### Task 1: The bridge, server and client

**Files:**
- Create: `src-tauri/src/bridge.rs`
- Modify: `src-tauri/src/main.rs` (`mod bridge;`, `.setup(...)` hook that starts the listener, `agent_action_reply` command, `generate_handler!`)
- Test: `src-tauri/src/bridge.rs` (mod tests)

**Interfaces:**
- `pub(crate) struct Request { pub token: String, pub dir: String, pub action: String, pub args: Value }` (serde).
- `pub(crate) struct Reply { pub ok: bool, pub summary: String, pub data: Option<Value> }` (serde).
- `pub(crate) fn token_path() -> PathBuf`, `pub(crate) fn socket_path() -> PathBuf` (both under `crate::config_dir()`).
- `pub(crate) fn write_token() -> Result<String, String>` — generates, writes 0600, returns the token.
- `pub(crate) fn serve_connection(stream: UnixStream, token: &str, handle: &dyn Fn(Request) -> Reply)` — reads one line, checks the token (mismatch → `Reply { ok: false, summary: "That token isn't this Chronicle's. Reopen the app and try again." }`), calls `handle`, writes one line.
- `pub(crate) fn listen(token: String, handle: Arc<dyn Fn(Request) -> Reply + Send + Sync>) -> Result<(), String>` — removes a stale socket file, binds, spawns one thread per connection (each connection handled on its own thread with a 30 s read timeout).
- `pub(crate) fn call(dir: &Path, action: &str, args: Value, verb: &str) -> Result<Reply, String>` — client: reads the token, connects with a 35 s read timeout, sends, reads; connect failure → `Err(format!("Chronicle isn't open on this project, so it can't {verb}. Open it and try again."))`; `ok: false` replies come back as `Err(summary)`.
- In main.rs: `struct BridgeState { pending: Mutex<HashMap<u64, std::sync::mpsc::Sender<Reply>>>, next: AtomicU64 }` managed; the `.setup` hook calls `bridge::write_token()` then `bridge::listen(token, handler)` where `handler` checks `dir` against `OpenRoots` (for every action except `project.open`), assigns an id, inserts a channel, `app.emit("agent-action", json!({ id, dir, action, args }))`, and `recv_timeout(30 s)` → `Reply` (timeout → `Reply { ok: false, summary: "Chronicle didn't answer in time." }`). Command `agent_action_reply(state, id: u64, ok: bool, summary: String, data: Option<Value>)` sends into the channel.

- [ ] **Step 1: Write the failing tests**

```rust
//! The action bridge: the app listens on a Unix socket; `chronicle --mcp` and the CLI
//! connect, send one JSON line, and read one back. A per-launch token keeps a stale
//! process out; the project allowlist keeps an unopened project out.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::{Path, PathBuf};
use std::sync::Arc;

#[cfg(test)]
mod tests {
    use super::*;

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
```

`call_at(sock, token_file, dir, action, args, verb)` and `write_token_at(path)` are the path-taking cores; `call` and `write_token` wrap them with the default paths.

- [ ] **Step 2: Run to see them fail**

Add `mod bridge;` to main.rs. Run: `cd src-tauri && cargo test bridge::`
Expected: compile errors.

- [ ] **Step 3: Implement**

```rust
#[derive(Serialize, Deserialize, Debug, Clone)]
pub(crate) struct Request { pub token: String, pub dir: String, pub action: String, #[serde(default)] pub args: Value }

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub(crate) struct Reply { pub ok: bool, pub summary: String, #[serde(skip_serializing_if = "Option::is_none")] pub data: Option<Value> }

pub(crate) fn socket_path() -> PathBuf { crate::config_dir().join("app.sock") }
pub(crate) fn token_path() -> PathBuf { crate::config_dir().join("app.token") }

pub(crate) fn write_token_at(path: &Path) -> Result<String, String> {
    use std::os::unix::fs::OpenOptionsExt;
    let mut bytes = [0u8; 32];
    std::fs::File::open("/dev/urandom").and_then(|mut f| std::io::Read::read_exact(&mut f, &mut bytes)).map_err(|e| e.to_string())?;
    let token: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    if let Some(p) = path.parent() { std::fs::create_dir_all(p).map_err(|e| e.to_string())?; }
    let mut f = std::fs::OpenOptions::new().write(true).create(true).truncate(true).mode(0o600).open(path).map_err(|e| e.to_string())?;
    f.write_all(token.as_bytes()).map_err(|e| e.to_string())?;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600)).map_err(|e| e.to_string())?;
    Ok(token)
}
pub(crate) fn write_token() -> Result<String, String> { write_token_at(&token_path()) }

const BAD_TOKEN: &str = "That token isn't this Chronicle's. Reopen the app and try again.";

pub(crate) fn serve_connection(stream: UnixStream, token: &str, handle: &dyn Fn(Request) -> Reply) {
    let _ = stream.set_read_timeout(Some(std::time::Duration::from_secs(30)));
    let mut reader = BufReader::new(stream.try_clone().expect("clone"));
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

pub(crate) fn call_at(sock: &Path, token_file: &Path, dir: &Path, action: &str, args: Value, verb: &str) -> Result<Reply, String> {
    let not_open = || format!("Chronicle isn't open on this project, so it can't {verb}. Open it and try again.");
    let token = std::fs::read_to_string(token_file).map_err(|_| not_open())?;
    let mut stream = UnixStream::connect(sock).map_err(|_| not_open())?;
    let _ = stream.set_read_timeout(Some(std::time::Duration::from_secs(35)));
    let req = Request { token: token.trim().to_string(), dir: dir.to_string_lossy().into_owned(), action: action.into(), args };
    writeln!(stream, "{}", serde_json::to_string(&req).map_err(|e| e.to_string())?).map_err(|_| not_open())?;
    let mut line = String::new();
    BufReader::new(stream).read_line(&mut line).map_err(|_| "Chronicle didn't answer.".to_string())?;
    let reply: Reply = serde_json::from_str(line.trim()).map_err(|_| "Chronicle answered with something that isn't a reply.".to_string())?;
    if reply.ok { Ok(reply) } else { Err(reply.summary) }
}
pub(crate) fn call(dir: &Path, action: &str, args: Value, verb: &str) -> Result<Reply, String> {
    call_at(&socket_path(), &token_path(), dir, action, args, verb)
}
```

In main.rs add the state, the command and the setup hook:

```rust
pub(crate) struct BridgeState {
    pending: Mutex<HashMap<u64, std::sync::mpsc::Sender<bridge::Reply>>>,
    next: std::sync::atomic::AtomicU64,
}

#[tauri::command]
fn agent_action_reply(state: State<BridgeState>, id: u64, ok: bool, summary: String, data: Option<Value>) -> Result<(), String> {
    let tx = state.pending.lock().map_err(|e| e.to_string())?.remove(&id).ok_or("no such action is waiting")?;
    tx.send(bridge::Reply { ok, summary, data }).map_err(|_| "the action already timed out".to_string())
}
```

In the builder: `.manage(BridgeState { pending: Mutex::new(HashMap::new()), next: AtomicU64::new(1) })` and

```rust
        .setup(|app| {
            let handle = app.handle().clone();
            match bridge::write_token() {
                Ok(token) => {
                    let h = handle.clone();
                    let handler: Arc<dyn Fn(bridge::Request) -> bridge::Reply + Send + Sync> = Arc::new(move |req| {
                        // only an opened project may be acted on; opening a project is the exception
                        if req.action != "project.open" {
                            let canon = PathBuf::from(&req.dir).canonicalize().unwrap_or_else(|_| PathBuf::from(&req.dir));
                            let open = h.state::<OpenRoots>().0.lock().map(|s| s.contains(&canon)).unwrap_or(false);
                            if !open { return bridge::Reply { ok: false, summary: "That project isn't open in Chronicle. Open it and try again.".into(), data: None }; }
                        }
                        let st = h.state::<BridgeState>();
                        let id = st.next.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                        let (tx, rx) = std::sync::mpsc::channel();
                        if let Ok(mut p) = st.pending.lock() { p.insert(id, tx); }
                        let _ = h.emit("agent-action", json!({ "id": id, "dir": req.dir, "action": req.action, "args": req.args }));
                        match rx.recv_timeout(std::time::Duration::from_secs(30)) {
                            Ok(r) => r,
                            Err(_) => { if let Ok(mut p) = st.pending.lock() { p.remove(&id); } bridge::Reply { ok: false, summary: "Chronicle didn't answer in time.".into(), data: None } }
                        }
                    });
                    if let Err(e) = bridge::listen(token, handler) { eprintln!("agent bridge: {e}"); }
                }
                Err(e) => eprintln!("agent bridge: {e}"),
            }
            Ok(())
        })
```

Register `agent_action_reply` in `generate_handler!`. Add `use std::sync::atomic::AtomicU64;` as needed. The CLI/MCP branches in `main()` run before the builder, so a `chronicle notes …` invocation never binds the socket.

- [ ] **Step 4: Run, commit**

Run: `cd src-tauri && cargo test bridge:: && cargo test 2>&1 | tail -3`
Expected: 4 new tests pass; suite green.

```bash
git add src-tauri/src/bridge.rs src-tauri/src/main.rs
git commit -m "feat(agent): the app listens on a private socket, and a token keeps stale processes out"
```

---

### Task 2: The action capabilities, the CLI groups, and the honest MCP version

**Files:**
- Modify: `src-tauri/src/agent_api.rs` (four capabilities), `src-tauri/src/cli.rs` (groups `round`, `project`, `terminal`; INT flag `n`, `lines`), `src-tauri/src/mcp.rs` (version)
- Test: the three modules' test mods

**Interfaces:**
- Capabilities (all through `bridge::call`): `chronicle.round.plan` (no args; verb "plan a round"), `chronicle.round.start` (`n` required integer, `where` = `pane` default | `terminal`; verb "start a round"), `chronicle.project.open` (`dir` required; verb "open a project"; the request's `dir` is that path), `chronicle.terminal.read` (`id?` integer, `lines?` default 200; verb "read a terminal"). Each returns `Outcome { summary: reply.summary, data: reply.data.unwrap_or(json!({})) }`.
- `pub(crate) fn app_version() -> &'static str` in mcp.rs, parsed once from `include_str!("../tauri.conf.json")` (`"version"`), falling back to `CARGO_PKG_VERSION`.
- CLI: `chronicle round plan`, `chronicle round start --n 3 [--where terminal]`, `chronicle project open <dir>` (the positional is the target, not the project dir: parse `project open` specially so its positional lands in args.dir), `chronicle terminal read [--id 7] [--lines 100]`.

- [ ] **Step 1: Tests first**

agent_api tests (no socket: use a fake listener like bridge's tests, and point the capability at it via an env override `CHRONICLE_BRIDGE_SOCKET`/`CHRONICLE_BRIDGE_TOKEN` read by `bridge::socket_path()`/`token_path()` when set — add that override to bridge.rs, test-only in spirit but plain code):

```rust
    #[test]
    fn actions_go_through_the_bridge_and_report_its_sentence() {
        let d = vault("actions");
        std::fs::write(d.join("app.token"), "t").unwrap();
        let sock = d.join("app.sock");
        let listener = std::os::unix::net::UnixListener::bind(&sock).unwrap();
        std::thread::spawn(move || {
            for s in listener.incoming().flatten() {
                crate::bridge::serve_connection(s, "t", &|r| crate::bridge::Reply { ok: true, summary: format!("{} · {}", r.action, r.args), data: Some(json!({ "echo": r.args })) });
            }
        });
        std::env::set_var("CHRONICLE_BRIDGE_SOCKET", &sock);
        std::env::set_var("CHRONICLE_BRIDGE_TOKEN", d.join("app.token"));
        let r = call(&d, "chronicle.round.start", &json!({"n": 3, "where": "terminal"})).unwrap();
        assert_eq!(r.summary, r#"round.start · {"n":3,"where":"terminal"}"#);
        assert_eq!(r.data["echo"]["n"], 3);
        assert_eq!(call(&d, "chronicle.round.start", &json!({})).unwrap_err(), "n is required.");
        assert_eq!(call(&d, "chronicle.round.start", &json!({"n": 3, "where": "cloud"})).unwrap_err(), "where must be pane or terminal.");
        let r = call(&d, "chronicle.round.plan", &json!({})).unwrap();
        assert!(r.summary.starts_with("round.plan"));
        let r = call(&d, "chronicle.terminal.read", &json!({"lines": 50})).unwrap();
        assert_eq!(r.data["echo"]["lines"], 50);
        assert_eq!(call(&d, "chronicle.project.open", &json!({})).unwrap_err(), "dir is required.");
        std::env::remove_var("CHRONICLE_BRIDGE_SOCKET"); std::env::remove_var("CHRONICLE_BRIDGE_TOKEN");
        assert_eq!(call(&d, "chronicle.round.plan", &json!({})).unwrap_err(),
                   "Chronicle isn't open on this project, so it can't plan a round. Open it and try again.");
    }
```

Note the env vars make this test order-sensitive with any other bridge-using test; keep it the only one. cli tests: `parse(a("round start --n 3 --where terminal"))` → name `chronicle.round.start`, args `{"n":3,"where":"terminal"}`; `parse(a("project open /tmp/x"))` → args `{"dir":"/tmp/x"}`, `dir: None`; `parse(a("terminal read --lines 50"))`. mcp test: `initialize` reply's `serverInfo.version` equals the `"version"` in `tauri.conf.json` (read the file in the test).

- [ ] **Step 2: Implement**

bridge.rs: `socket_path()`/`token_path()` honour `CHRONICLE_BRIDGE_SOCKET`/`CHRONICLE_BRIDGE_TOKEN` when set. agent_api.rs: four `Capability` entries with schemas (`where`: `enum: ["pane", "terminal"]`), handlers:

```rust
fn action(dir: &Path, name: &str, args: Value, verb: &str) -> Result<Outcome, String> {
    let r = crate::bridge::call(dir, name, args, verb)?;
    Ok(Outcome { summary: r.summary, data: r.data.unwrap_or(json!({})) })
}
fn round_plan(dir: &Path, _a: &Value) -> Result<Outcome, String> { action(dir, "round.plan", json!({}), "plan a round") }
fn round_start(dir: &Path, a: &Value) -> Result<Outcome, String> {
    let n = arg_u64(a, "n")?.ok_or("n is required.")?;
    let wh = arg_str(a, "where")?.unwrap_or("pane");
    if wh != "pane" && wh != "terminal" { return Err("where must be pane or terminal.".into()) }
    action(dir, "round.start", json!({ "n": n, "where": wh }), "start a round")
}
fn project_open(_dir: &Path, a: &Value) -> Result<Outcome, String> {
    let target = required_str(a, "dir")?;
    let p = Path::new(target);
    if !p.is_dir() { return Err(format!("There is no folder at {target}.")) }
    action(p, "project.open", json!({ "dir": target }), "open a project")
}
fn terminal_read(dir: &Path, a: &Value) -> Result<Outcome, String> {
    let id = arg_u64(a, "id")?;
    let lines = arg_u64(a, "lines")?.unwrap_or(200);
    action(dir, "terminal.read", json!({ "id": id, "lines": lines }), "read a terminal")
}
```

cli.rs: add groups `("round", &["plan", "start"])`, `("project", &["open"])`, `("terminal", &["read"])`; add `n`, `lines`, `id` to `INT_FLAGS`; for `project open`, treat the first positional as `args.dir` (not the project dir). mcp.rs: `app_version()`.

- [ ] **Step 3: Verify, commit**

Run: `cd src-tauri && cargo test 2>&1 | tail -3`. Smoke without the app: `./target/debug/chronicle round plan ..` → exit 1 with the "isn't open" sentence.

```bash
git add src-tauri/src/agent_api.rs src-tauri/src/cli.rs src-tauri/src/mcp.rs src-tauri/src/bridge.rs
git commit -m "feat(agent): round, project and terminal actions reach the app over the bridge; MCP reports the app's version"
```

---

### Task 3: The frontend dispatcher

**Files:**
- Create: `src/lib/agent-bridge.ts`
- Modify: `src/lib/ipc.ts` (`onAgentAction`, `agentActionReply`), `src/App.tsx` (mount the dispatcher), `src/lib/term-sessions.ts` (`termTail(id, lines)`)
- Test: `src/lib/agent-bridge.test.ts`

**Interfaces:**
- `ipc.ts`: `export interface AgentAction { id: number; dir: string; action: string; args: Record<string, unknown> }`, `onAgentAction(cb) => listen("agent-action", …)`, `agentActionReply(id, ok, summary, data?) => invoke("agent_action_reply", { id, ok, summary, data: data ?? null })`.
- `term-sessions.ts`: `export function termTail(id: number, lines: number): string | null` — the last `lines` non-empty rows of that tab's active buffer (`translateToString(true)`), or null when no such live tab; `activeTermFor(dir)` gives the default id.
- `agent-bridge.ts`: `export interface BridgeDeps { planRound(dir): Promise<void>; startRound(dir, n, total, where): Promise<void>; openProject(dir): void; revealPane(): void; revealTerminal(): void; roundTotal(dir, n): number }`; `export function describeAction(action: string, args: Record<string, unknown>): string | null` (pure: "Plan a round" / "Start round 3 in the pane" / "Start round 3 in a terminal" / "Open <dir>" / "Read terminal 7's last 200 lines"; null for unknown); `export async function handleAgentAction(a: AgentAction, deps: BridgeDeps): Promise<{ ok: boolean; summary: string; data?: unknown }>`; `export function mountAgentBridge(deps): () => void` (listens, handles, replies, toasts and `announce(dir, "agent-action", summary, "Chronicle")`).

- [ ] **Step 1: Tests first (pure parts)**

```ts
import { describe, expect, it, vi } from "vitest";
import { describeAction, handleAgentAction } from "./agent-bridge";

describe("what an agent asked for, in words", () => {
  it("names each action", () => {
    expect(describeAction("round.plan", {})).toBe("Plan a round");
    expect(describeAction("round.start", { n: 3, where: "pane" })).toBe("Start round 3 in the pane");
    expect(describeAction("round.start", { n: 3, where: "terminal" })).toBe("Start round 3 in a terminal");
    expect(describeAction("project.open", { dir: "/x/y" })).toBe("Open /x/y");
    expect(describeAction("terminal.read", { lines: 200 })).toBe("Read the terminal's last 200 lines");
    expect(describeAction("nope", {})).toBeNull();
  });
});

describe("handling an action", () => {
  const deps = () => ({
    planRound: vi.fn(async () => {}), startRound: vi.fn(async () => {}), openProject: vi.fn(),
    revealPane: vi.fn(), revealTerminal: vi.fn(), roundTotal: vi.fn(() => 2),
    termTail: vi.fn(() => "line a\nline b"),
  });
  it("plans a round in the pane and says so", async () => {
    const d = deps();
    const r = await handleAgentAction({ id: 1, dir: "/p", action: "round.plan", args: {} }, d);
    expect(d.planRound).toHaveBeenCalledWith("/p");
    expect(d.revealPane).toHaveBeenCalled();
    expect(r).toEqual({ ok: true, summary: "An agent started planning a round in the pane." });
  });
  it("starts a round where asked", async () => {
    const d = deps();
    const r = await handleAgentAction({ id: 1, dir: "/p", action: "round.start", args: { n: 3, where: "terminal" } }, d);
    expect(d.startRound).toHaveBeenCalledWith("/p", 3, 2, "terminal");
    expect(d.revealTerminal).toHaveBeenCalled();
    expect(r.summary).toBe("An agent started round 3 in a terminal.");
  });
  it("reads a terminal tail", async () => {
    const d = deps();
    const r = await handleAgentAction({ id: 1, dir: "/p", action: "terminal.read", args: { id: 7, lines: 2 } }, d);
    expect(d.termTail).toHaveBeenCalledWith(7, 2);
    expect(r).toEqual({ ok: true, summary: "2 lines from terminal 7.", data: { text: "line a\nline b", lines: 2 } });
  });
  it("refuses what it does not know, and reports a failure honestly", async () => {
    const d = deps();
    expect((await handleAgentAction({ id: 1, dir: "/p", action: "nope", args: {} }, d)).ok).toBe(false);
    d.startRound.mockRejectedValueOnce(new Error("no queued notes"));
    const r = await handleAgentAction({ id: 1, dir: "/p", action: "round.start", args: { n: 1 } }, d);
    expect(r).toEqual({ ok: false, summary: "Couldn't start round 1: no queued notes" });
  });
});
```

(`termTail` joins `BridgeDeps`; `handleAgentAction` for `terminal.read` with no `id` uses `deps.termTail(null, lines)` and the summary "N lines from the terminal.".)

- [ ] **Step 2: Implement**

`agent-bridge.ts` per the interfaces; `mountAgentBridge` wires `onAgentAction` → `handleAgentAction` → `agentActionReply` and, on success, `toastSuccess(summary)` + `announce(dir, "agent-action", summary, "Chronicle")`; on refusal `toastError("An agent asked for something Chronicle couldn't do", summary)` (no journal line). In App.tsx, mount once (a `useEffect` near the other listeners) with deps: `planRound: startRoundPlanInPane`, `startRound: (dir, n, total, where) => where === "terminal" ? startRoundInTerminal(dir, n, total, agentRef.current) : startRoundInPane(dir, n, total)`, `openProject: doOpenProject`, `revealPane`/`revealTerminal` via `patchLayout`, `roundTotal: (dir, n) => roundNotesFor(dir, n).length`, `termTail`. `project.open` replies `"Opened <dir>."` (or "Switched to <dir>." when already open: `projectsRef.current.has(dir)`).

- [ ] **Step 3: Verify, commit**

Run: `npm run typecheck && npm test 2>&1 | tail -3`.

```bash
git add src/lib/agent-bridge.ts src/lib/agent-bridge.test.ts src/lib/ipc.ts src/App.tsx src/lib/term-sessions.ts
git commit -m "feat(agent): the app performs an agent's action with the same code its buttons use, and says so"
```

---

### Task 4: Opt-in: the Setup row, `.mcp.json`, the skill, `access.json`

**Files:**
- Create: `skill/chronicle/SKILL.md`
- Modify: `src-tauri/src/main.rs` (generalise `install_init_skill` into `install_skill(base, name, files)`; three commands `agents_access_status(dir)`, `agents_access_enable(dir)`, `agents_access_disable(dir)`; `generate_handler!`)
- Modify: `src/lib/ipc.ts`, `src/lib/setup-store.ts` (`CHECK_META` gains `{ id: "agents", name: "Let agents reach Chronicle", blurb: "Claude Code in this project can read and write its notes, see the roadmap, and start rounds you watch.", kind: "agents" }`), `src/screens/setup/SetupScreen.tsx` / `CheckRow.tsx` (kind `agents`: install = enable, an "Undo" secondary = disable; needs the opened `dir`, so the row shows "Open a project first" when `dir` is null)
- Test: `src-tauri/src/main.rs` (mod r3_tests), `src/lib/setup-store.test.ts` if one exists (else a pure helper test for the row state mapping)

**Interfaces:**
- `agents_access_status(dir) -> { "mcp": bool, "skill": "installed" | "hand-managed" | "missing", "command": String }` where `mcp` is true when `.mcp.json` at the project root has `mcpServers.chronicle` and `.chronicle/agent/access.json` says `mcp: true`; `command` is `std::env::current_exe()`.
- `agents_access_enable(dir)`: merges `.mcp.json` (create if missing; preserve every other key and server; `mcpServers.chronicle = { command: <current_exe>, args: ["--mcp", "."] }`), installs the `chronicle` skill at `~/.claude/skills/chronicle/` via `install_skill` with the managed marker, writes `access.json`. Returns the status.
- `agents_access_disable(dir)`: removes `mcpServers.chronicle` (deletes `.mcp.json` only if it is now `{ "mcpServers": {} }` and Chronicle created it, tracked by `"createdBy": "chronicle"` in access.json), removes `access.json`; the skill stays. Returns the status.
- `skill/chronicle/SKILL.md` frontmatter `name: chronicle`, description "Use when working in a project that Chronicle tracks: its notes, its roadmap state, and rounds. Prefer the chronicle MCP tools over grepping .chronicle/." Body: the three groups and when to use each; "never start a round unless the user asked for one in this conversation"; "state before claiming what is done"; the CLI equivalents; that actions need the app open.

- [ ] **Step 1: Rust tests**

```rust
    #[test]
    fn enabling_agent_access_merges_mcp_json_and_records_the_choice() {
        let d = repo("access");
        std::fs::write(d.join(".mcp.json"), r#"{"mcpServers":{"other":{"command":"x"}},"note":"keep"}"#).unwrap();
        let home = tmp("access-home");
        let st = agents_access_enable_in(&d, &home, Path::new("/Applications/Chronicle.app/Contents/MacOS/chronicle")).unwrap();
        assert_eq!(st["mcp"], true);
        let m: Value = serde_json::from_str(&std::fs::read_to_string(d.join(".mcp.json")).unwrap()).unwrap();
        assert_eq!(m["mcpServers"]["other"]["command"], "x", "other servers survive");
        assert_eq!(m["note"], "keep");
        assert_eq!(m["mcpServers"]["chronicle"]["args"], json!(["--mcp", "."]));
        assert!(home.join(".claude/skills/chronicle/SKILL.md").exists());
        assert!(home.join(".claude/skills/chronicle/.chronicle-managed").exists());
        let a: Value = serde_json::from_str(&std::fs::read_to_string(d.join(".chronicle/agent/access.json")).unwrap()).unwrap();
        assert_eq!(a["mcp"], true);
        assert_eq!(a["createdBy"], Value::Null, "we did not create .mcp.json");
        let st = agents_access_disable_in(&d).unwrap();
        assert_eq!(st["mcp"], false);
        let m: Value = serde_json::from_str(&std::fs::read_to_string(d.join(".mcp.json")).unwrap()).unwrap();
        assert!(m["mcpServers"].get("chronicle").is_none());
        assert_eq!(m["mcpServers"]["other"]["command"], "x");
        assert!(!d.join(".chronicle/agent/access.json").exists());
        // a project with no .mcp.json: we create it and delete it again on disable
        let d2 = repo("access2");
        agents_access_enable_in(&d2, &home, Path::new("/x/chronicle")).unwrap();
        assert!(d2.join(".mcp.json").exists());
        agents_access_disable_in(&d2).unwrap();
        assert!(!d2.join(".mcp.json").exists(), "created by us and now empty: gone");
    }
```

- [ ] **Step 2: Implement** the `_in` cores (taking `home` and the exe path so tests never touch the real home), the commands (`project_for` + `config`/`current_exe`), the skill file, and the Setup row. `install_skill(base, name, files: &[(&str, &str)])` generalises `install_init_skill` (keep the existing function as a one-line wrapper so its test stands). Frontend: `agentsAccessStatus(dir)`, `agentsAccessEnable(dir)`, `agentsAccessDisable(dir)` wrappers; `setup-store.ts` fetches the `agents` row from `agentsAccessStatus` when a `dir` is set and maps it to a `SetupCheck` (`ready` when `mcp`; `needs_you` otherwise with detail "Writes .mcp.json in this project and installs the chronicle skill."; `blocked` with "Open a project first" when no dir); `CheckRow` for kind `agents` shows "Turn on" (install) and, when ready, a quiet "Turn off" (disable). Tests: a pure `agentsRowFor(status | null, dir | null): SetupCheck` in setup-store.ts with three cases.

- [ ] **Step 3: Verify, commit**

Run: `cd src-tauri && cargo test 2>&1 | tail -3; cd .. && npm run typecheck && npm test 2>&1 | tail -3`.

```bash
git add skill/chronicle/SKILL.md src-tauri/src/main.rs src/lib/ipc.ts src/lib/setup-store.ts src/screens/setup/SetupScreen.tsx src/screens/setup/CheckRow.tsx src/lib/setup-store.test.ts
git commit -m "feat(agent): a Setup row lets agents reach Chronicle for this project, and an undo takes it back"
```

---

### Task 5: Docs, the skill's voice, and the live check

**Files:**
- Modify: `docs/agent-api.md` (actions section, the Setup row, the CLI spellings, the `.mcp.json` the row writes), the spec's implementation notes (plan 3)
- Verify: the end-to-end live check

- [ ] **Step 1: Docs**

Add the actions table with CLI spellings; replace the "arrive in plans 2 and 3" line; document the socket and token paths, the "isn't open" sentence, that every action shows a toast and a journal line, and the Setup row. Spec implementation notes: the bridge design as built, `project.open`'s allowlist exception, the env overrides used by tests, the skill's location, `access.json`'s `createdBy`, the MCP version source.

- [ ] **Step 2: Live check (controller, on a throwaway rsync copy with the debug bundle open on it)**

From a shell in the copy: `chronicle round plan .` with the app closed → the "isn't open" sentence, exit 1. Open the copy in the app, turn on "Let agents reach Chronicle" in Setup → `.mcp.json` appears in Repo with the `chronicle` server; `chronicle round plan .` → the pane shows "Round N · planning …", a toast and a journal line appear; `chronicle round start --n N --where terminal .` → a `Round N` tab opens; `chronicle terminal read --lines 20 .` prints its tail; `chronicle project open <other copy>` switches projects. Through MCP: pipe an `initialize` + `tools/call chronicle.state.rounds` into `chronicle --mcp .` and read the round list.

- [ ] **Step 3: Commit**

```bash
git add docs/agent-api.md docs/superpowers/specs/2026-09-16-agent-access-and-visible-rounds-design.md
git commit -m "docs(agent): actions, the bridge, and the opt-in row"
```
