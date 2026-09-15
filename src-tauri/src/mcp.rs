//! `chronicle --mcp <dir>`: the Model Context Protocol front of the capability catalog,
//! newline-delimited JSON-RPC 2.0 over stdio. Tools answer from disk; nothing here
//! needs the app.

use serde_json::{json, Value};
use std::path::PathBuf;

use crate::agent_api;

pub(crate) struct Session { dir: PathBuf, initialized: bool }
impl Session { pub(crate) fn new(dir: PathBuf) -> Self { Self { dir, initialized: false } } }

const INSTRUCTIONS: &str = "Chronicle keeps this project's notes (tasks, bugs, ideas) and its build roadmap. Use chronicle.notes.* to list, read, create and update notes instead of grepping .chronicle/notes; use chronicle.state.* before saying what is done or what is next, because it answers from git and the roadmap rules, not from memory.";

fn reply(id: Value, result: Value) -> String {
    json!({ "jsonrpc": "2.0", "id": id, "result": result }).to_string()
}
fn error(id: Value, code: i64, message: &str) -> String {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } }).to_string()
}
fn tool_text(text: String, is_error: bool) -> Value {
    let mut r = json!({ "content": [{ "type": "text", "text": text }] });
    if is_error { r["isError"] = json!(true); }
    r
}

pub(crate) fn handle_line(s: &mut Session, line: &str) -> Option<String> {
    let line = line.trim();
    if line.is_empty() { return None }
    let msg: Value = match serde_json::from_str(line) {
        Ok(v) => v,
        Err(_) => return Some(error(Value::Null, -32700, "Parse error")),
    };
    let id = msg.get("id").cloned();
    let method = msg.get("method").and_then(|m| m.as_str()).unwrap_or("");
    let params = msg.get("params").cloned().unwrap_or(json!({}));
    let Some(id) = id else { // a notification: never answered
        if method == "notifications/initialized" { s.initialized = true; }
        return None;
    };
    Some(match method {
        "initialize" => reply(id, json!({
            "protocolVersion": "2025-06-18",
            "capabilities": { "tools": {} },
            "serverInfo": { "name": "chronicle", "version": env!("CARGO_PKG_VERSION") },
            "instructions": INSTRUCTIONS,
        })),
        "ping" => reply(id, json!({})),
        "tools/list" => reply(id, json!({ "tools": agent_api::catalog().iter().map(|t| json!({
            "name": t.name, "description": t.description, "inputSchema": t.input_schema })).collect::<Vec<_>>() })),
        "tools/call" => {
            let name = params.get("name").and_then(|n| n.as_str()).unwrap_or("");
            let args = params.get("arguments").cloned().unwrap_or(json!({}));
            match agent_api::call(&s.dir, name, &args) {
                Ok(out) => reply(id, tool_text(format!("{}\n{}", out.summary, serde_json::to_string_pretty(&out.data).unwrap_or_default()), false)),
                Err(e) => reply(id, tool_text(e, true)),
            }
        }
        _ => error(id, -32601, "Method not found"),
    })
}

/// Serve until stdin closes. Every reply is one line, flushed at once.
pub(crate) fn serve(dir: PathBuf) -> i32 {
    use std::io::{BufRead, Write};
    let mut s = Session::new(dir);
    let stdin = std::io::stdin();
    let mut out = std::io::stdout().lock();
    for line in stdin.lock().lines() {
        // a read error is not end of input: say why the server stopped instead of
        // looking like a clean shutdown to the client
        let Ok(line) = line else {
            eprintln!("chronicle --mcp: stdin is not UTF-8; stopping.");
            break
        };
        if let Some(r) = handle_line(&mut s, &line) {
            if writeln!(out, "{r}").is_err() || out.flush().is_err() { break }
        }
    }
    0
}

#[cfg(test)]
mod tests {
    use super::*;

    fn session(name: &str) -> (PathBuf, Session) {
        let d = std::env::temp_dir().join(format!("chronicle-mcp-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(d.join(".chronicle/notes/Tasks")).unwrap();
        std::fs::write(d.join(".chronicle/notes/Tasks/T-001 A.md"), "---\nid: T-001\nstatus: queued\n---\n\n# A\n").unwrap();
        let d = d.canonicalize().unwrap();
        (d.clone(), Session::new(d))
    }
    fn rpc(s: &mut Session, line: &str) -> Value {
        serde_json::from_str(&handle_line(s, line).expect("a reply")).unwrap()
    }

    #[test]
    fn the_handshake_then_list_then_call() {
        let (_, mut s) = session("handshake");
        let init = rpc(&mut s, r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"t","version":"0"}}}"#);
        assert_eq!(init["id"], 1);
        assert_eq!(init["result"]["protocolVersion"], "2025-06-18");
        assert_eq!(init["result"]["serverInfo"]["name"], "chronicle");
        assert!(init["result"]["capabilities"]["tools"].is_object());
        assert!(init["result"]["instructions"].as_str().unwrap().contains("notes"));
        assert!(handle_line(&mut s, r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#).is_none(), "notifications get no reply");
        let list = rpc(&mut s, r#"{"jsonrpc":"2.0","id":2,"method":"tools/list"}"#);
        let tools = list["result"]["tools"].as_array().unwrap();
        assert!(tools.iter().any(|t| t["name"] == "chronicle.notes.list" && t["inputSchema"]["type"] == "object"));
        let call = rpc(&mut s, r#"{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"chronicle.notes.list","arguments":{"status":"queued"}}}"#);
        let text = call["result"]["content"][0]["text"].as_str().unwrap();
        assert!(text.starts_with("1 note.\n"), "summary first, then JSON: {text}");
        assert!(text.contains("\"T-001\""));
        assert!(call["result"].get("isError").is_none());
        let bad = rpc(&mut s, r#"{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"chronicle.notes.read","arguments":{"path":"../x.md"}}}"#);
        assert_eq!(bad["result"]["isError"], true);
        assert_eq!(bad["result"]["content"][0]["text"], "that path isn't inside the notes vault");
        let ping = rpc(&mut s, r#"{"jsonrpc":"2.0","id":5,"method":"ping"}"#);
        assert_eq!(ping["result"], json!({}));
    }

    #[test]
    fn protocol_errors_are_jsonrpc_errors() {
        let (_, mut s) = session("protocol-errors");
        let e = rpc(&mut s, r#"{"jsonrpc":"2.0","id":9,"method":"tools/nope"}"#);
        assert_eq!(e["error"]["code"], -32601);
        let e = rpc(&mut s, "{not json");
        assert_eq!(e["error"]["code"], -32700);
        assert_eq!(e["id"], Value::Null);
        let e = rpc(&mut s, r#"{"jsonrpc":"2.0","id":10,"method":"tools/call","params":{"name":"chronicle.nope.x","arguments":{}}}"#);
        assert_eq!(e["result"]["isError"], true, "an unknown tool is a tool error, not a protocol error");
        assert_eq!(handle_line(&mut s, ""), None, "blank lines are ignored");
    }
}
