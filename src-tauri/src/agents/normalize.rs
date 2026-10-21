//! One shape for every agent (spec §7). Rust reads each agent's own `_meta`
//! through its profile's pointers and stamps `_chronicle` on what the pane
//! reads; the TypeScript store never looks inside an agent's namespace.

use super::profiles::AgentProfile;
use serde_json::{json, Map, Value};

fn read_str<'a>(v: &'a Value, ptr: Option<&str>) -> Option<&'a str> {
    ptr.and_then(|p| v.pointer(p)).and_then(Value::as_str).filter(|s| !s.is_empty())
}

/// The tool a call is for: the call's own `name`, else the stamped name.
pub fn tool_name(call: &Value) -> Option<&str> {
    call.get("name").and_then(Value::as_str).filter(|s| !s.is_empty())
        .or_else(|| call.pointer("/_chronicle/toolName").and_then(Value::as_str))
}

fn stamp_tool(call: &mut Value, p: &AgentProfile) {
    if !call.is_object() || call.get("_chronicle").is_some() { return; }
    let mut ch = Map::new();
    ch.insert("agent".into(), json!(p.id));
    let id = call.get("toolCallId").and_then(Value::as_str).unwrap_or("");
    if let Some(parent) = read_str(call, p.meta.parent_tool_use) {
        // a Task's own progress updates carry the Task's own id: never its own parent
        if parent != id { ch.insert("parentId".into(), json!(parent)); }
    }
    let name = call.get("name").and_then(Value::as_str).filter(|s| !s.is_empty())
        .or_else(|| read_str(call, p.meta.tool_name)).map(String::from);
    let flagged = p.meta.subagent.and_then(|ptr| call.pointer(ptr)).and_then(Value::as_bool).unwrap_or(false);
    if flagged || name.as_deref().map(|n| p.meta.subagent_tools.contains(&n)).unwrap_or(false) {
        ch.insert("subagent".into(), json!(true));
    }
    if let Some(n) = name { ch.insert("toolName".into(), json!(n)); }
    call["_chronicle"] = Value::Object(ch);
}

fn stamp_usage(update: &mut Value, p: &AgentProfile) {
    if !update.is_object() || update.get("_chronicle").is_some() { return; }
    let mut ch = Map::new();
    ch.insert("agent".into(), json!(p.id));
    if let Some(rl) = p.meta.rate_limit.and_then(|ptr| update.pointer(ptr)).cloned() {
        ch.insert("rateLimit".into(), rl);
    }
    update["_chronicle"] = Value::Object(ch);
}

pub fn normalize(msg: &mut Value, p: &AgentProfile) {
    match msg.get("method").and_then(Value::as_str) {
        Some("session/update") => {
            let Some(update) = msg.pointer_mut("/params/update") else { return };
            match update.get("sessionUpdate").and_then(Value::as_str) {
                Some("tool_call") | Some("tool_call_update") => stamp_tool(update, p),
                Some("usage_update") => stamp_usage(update, p),
                _ => {}
            }
        }
        Some("session/request_permission") => {
            if let Some(params) = msg.get_mut("params") { normalize_permission(params, p); }
        }
        _ => {}
    }
}

pub fn normalize_permission(params: &mut Value, p: &AgentProfile) {
    if let Some(call) = params.get_mut("toolCall") { stamp_tool(call, p); }
}

/// What a `ready` state line carries beyond the session response.
pub fn ready_extras(msg: &mut Value, p: &AgentProfile) {
    if msg.get("method").and_then(Value::as_str) != Some("_chronicle/session_state") { return; }
    let Some(params) = msg.get_mut("params") else { return };
    if params.get("state").and_then(Value::as_str) != Some("ready") { return; }
    params["agent"] = json!(p.id);
}

/// The agent that made a stored thread: the first `ready` state line's `agent`.
/// A transcript with no such field predates the agents update, when Claude
/// Code was the only agent.
pub fn transcript_agent<'a>(lines: impl IntoIterator<Item = &'a Value>) -> &'a str {
    for l in lines {
        if l.get("method").and_then(Value::as_str) == Some("_chronicle/session_state")
            && l.pointer("/params/state").and_then(Value::as_str) == Some("ready")
        {
            return l.pointer("/params/agent").and_then(Value::as_str).filter(|s| !s.is_empty()).unwrap_or("claude-acp");
        }
    }
    "claude-acp"
}

#[cfg(test)]
mod normalize_tests {
    use super::*;
    use crate::agents::{claude, profile, PROFILES};
    use serde_json::json;
    use std::path::{Path, PathBuf};

    fn update(u: Value) -> Value { json!({ "jsonrpc": "2.0", "method": "session/update", "params": { "sessionId": "s", "update": u } }) }

    #[test]
    fn claude_parent_name_and_subagent_come_from_its_namespace() {
        let mut m = update(json!({ "sessionUpdate": "tool_call", "toolCallId": "c1", "title": "Bash",
            "_meta": { "claudeCode": { "toolName": "Bash", "parentToolUseId": "T1" } } }));
        normalize(&mut m, claude());
        assert_eq!(m["params"]["update"]["_chronicle"], json!({ "agent": "claude-acp", "parentId": "T1", "toolName": "Bash" }));
        let mut t = update(json!({ "sessionUpdate": "tool_call", "toolCallId": "T1", "_meta": { "claudeCode": { "toolName": "Task" } } }));
        normalize(&mut t, claude());
        assert_eq!(t["params"]["update"]["_chronicle"]["subagent"], true, "a Task is a subagent by name");
        let mut f = update(json!({ "sessionUpdate": "tool_call_update", "toolCallId": "T2", "_meta": { "claudeCode": { "subagent": true, "parentToolUseId": "T2" } } }));
        normalize(&mut f, claude());
        assert_eq!(f["params"]["update"]["_chronicle"], json!({ "agent": "claude-acp", "subagent": true }), "never its own parent");
    }

    #[test]
    fn the_rate_limit_key_with_a_slash_in_it_is_read() {
        let mut m = update(json!({ "sessionUpdate": "usage_update", "used": 1, "size": 2,
            "_meta": { "_claude/rateLimit": { "status": "allowed_warning", "utilization": 71 } } }));
        normalize(&mut m, claude());
        assert_eq!(m["params"]["update"]["_chronicle"]["rateLimit"]["utilization"], 71);
    }

    #[test]
    fn an_agent_without_a_namespace_gets_only_what_the_standard_fields_say() {
        let codex = profile("codex-acp").unwrap();
        let mut m = update(json!({ "sessionUpdate": "tool_call", "toolCallId": "c1", "title": "Run ls", "kind": "execute",
            "_meta": { "claudeCode": { "parentToolUseId": "T1", "toolName": "Bash" } } }));
        normalize(&mut m, codex);
        assert_eq!(m["params"]["update"]["_chronicle"], json!({ "agent": "codex-acp" }), "another agent's namespace is never read");
    }

    #[test]
    fn a_permission_ask_names_its_tool_and_a_name_field_wins() {
        let mut p = json!({ "jsonrpc": "2.0", "id": 7, "method": "session/request_permission", "params": {
            "toolCall": { "toolCallId": "w1", "_meta": { "claudeCode": { "toolName": "Write" } } }, "options": [] } });
        normalize(&mut p, claude());
        assert_eq!(tool_name(&p["params"]["toolCall"]), Some("Write"));
        let named = json!({ "toolCallId": "w2", "name": "Edit", "_chronicle": { "toolName": "Write" } });
        assert_eq!(tool_name(&named), Some("Edit"));
    }

    #[test]
    fn normalising_twice_changes_nothing() {
        let mut m = update(json!({ "sessionUpdate": "tool_call", "toolCallId": "c1", "_meta": { "claudeCode": { "toolName": "Read" } } }));
        normalize(&mut m, claude());
        let once = m.clone();
        normalize(&mut m, profile("gemini").unwrap());
        assert_eq!(m, once, "a stamped line keeps the agent that produced it");
    }

    #[test]
    fn a_thread_belongs_to_the_agent_its_ready_line_names() {
        let ready = |a: Option<&str>| { let mut m = json!({ "method": "_chronicle/session_state", "params": { "state": "ready" } }); if let Some(a) = a { m["params"]["agent"] = json!(a); } m };
        let user = json!({ "method": "_chronicle/user_message", "params": { "text": "hi" } });
        assert_eq!(transcript_agent(&[user.clone(), ready(Some("codex-acp")), ready(Some("claude-acp"))]), "codex-acp", "the first ready line wins");
        assert_eq!(transcript_agent(&[ready(None)]), "claude-acp", "an old ready line is Claude Code's");
        assert_eq!(transcript_agent(&[user]), "claude-acp", "no ready line at all is Claude Code's");
        let mut stamped = ready(None);
        ready_extras(&mut stamped, profile("codex-acp").unwrap());
        assert_eq!(transcript_agent(&[stamped]), "codex-acp");
    }

    fn fixtures() -> PathBuf { Path::new(env!("CARGO_MANIFEST_DIR")).join("../src/lib/__fixtures__") }
    fn read_lines(p: &Path) -> Vec<Value> {
        std::fs::read_to_string(p).unwrap_or_else(|e| panic!("{}: {e}", p.display()))
            .lines().filter(|l| !l.trim().is_empty()).map(|l| serde_json::from_str(l).unwrap()).collect()
    }
    fn render(lines: &[Value]) -> String { lines.iter().map(|l| serde_json::to_string(l).unwrap() + "\n").collect() }
    /// Compare with the committed file, or write it with CHRONICLE_WRITE_FIXTURES=1.
    fn check_or_write(path: &Path, text: &str) {
        if std::env::var("CHRONICLE_WRITE_FIXTURES").ok().as_deref() == Some("1") {
            std::fs::write(path, text).unwrap();
        } else {
            let have = std::fs::read_to_string(path).unwrap_or_default();
            assert_eq!(have, text, "{} is stale — run CHRONICLE_WRITE_FIXTURES=1 cargo test normalize_tests", path.display());
        }
    }

    #[test]
    fn every_probe_fixture_normalises_to_its_committed_pane_shape() {
        for p in PROFILES.iter().filter(|p| p.shipped) {
            let raw = fixtures().join(format!("acp-{}.raw.jsonl", p.id));
            // a shipped agent whose probe has not landed has no raw fixture: skip it
            // rather than invent one (gemini is not shipped until its probe lands)
            if !raw.exists() { continue; }
            let mut lines = read_lines(&raw);
            for l in lines.iter_mut() { normalize(l, p); ready_extras(l, p); }
            for l in &lines {
                let u = &l["params"]["update"];
                if matches!(u["sessionUpdate"].as_str(), Some("tool_call" | "tool_call_update")) {
                    assert_eq!(u["_chronicle"]["agent"], p.id, "every tool call carries its agent");
                    if p.meta.parent_tool_use.is_none() { assert!(u["_chronicle"].get("parentId").is_none(), "{}: a flat agent never gets a parent", p.id); }
                }
            }
            check_or_write(&fixtures().join(format!("acp-{}.jsonl", p.id)), &render(&lines));
        }
    }

    #[test]
    fn transcripts_from_before_the_update_read_as_claude() {
        // the pane replays these exactly as agent_history_read now serves them
        for name in ["agent-fanout.jsonl", "design-lane.jsonl", "design-director.jsonl"] {
            let mut lines = read_lines(&fixtures().join(name));
            for l in lines.iter_mut() { normalize(l, claude()); }
            check_or_write(&fixtures().join(name), &render(&lines));
        }
    }
}
