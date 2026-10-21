//! The `Agent` provider (spec §9): Chronicle's own calls ride the user's agent
//! through a one-turn reviewer session that only reads. Chronicle holds no
//! key; the agent's own login does the work. Each call opens a session of its
//! own on a private `AcpState`, so it never collides with the pane's sessions.
use super::{emulate_decide, schema, CallError, Calls, CompleteRequest, Decision, DecisionRequest};
use crate::acp::{self, AcpState, Emit, Lane, LaneExtras};
use crate::agents::AgentProfile;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant};

/// How the adapter process is built; tests inject a mock agent.
pub type Spawn = Arc<dyn Fn() -> Result<std::process::Command, String> + Send + Sync>;

pub struct AgentCalls {
    pub profile: &'static AgentProfile,
    pub repo: PathBuf,
    pub project_dir: PathBuf,
    pub spawn: Spawn,
    pub timeout: Duration,
}

impl AgentCalls {
    /// The project's agent, launched from the bundled pin like the pane's own session.
    pub fn for_project(profile: &'static AgentProfile, repo: PathBuf, project_dir: PathBuf) -> AgentCalls {
        let spawn: Spawn = Arc::new(move || {
            let launch = crate::setup::agent_launch(profile.id)
                .ok_or_else(|| format!("{} isn't installed — set it up in Setup first", profile.name))?;
            Ok(acp::adapter_command_for(&launch, profile))
        });
        AgentCalls { profile, repo, project_dir, spawn, timeout: Duration::from_secs(300) }
    }

    /// One reviewer turn: the prompt out, the assistant's text back.
    fn turn(&self, text: String) -> Result<String, CallError> {
        let fail = |m: String| CallError::Failed(m);
        let cmd = (self.spawn)().map_err(fail)?;
        let (tx, rx) = mpsc::channel::<Value>();
        let tx = Mutex::new(tx);
        let emit: Emit = Arc::new(move |v| { if let Ok(t) = tx.lock() { let _ = t.send(v); } });
        let state = AcpState::new();
        let canon = self.repo.canonicalize().unwrap_or_else(|_| self.repo.clone());
        let key = Lane::Reviewer.key(&canon.to_string_lossy());
        let result = self.run(&state, emit, &rx, key.clone(), text, cmd);
        if let Some(s) = state.get(&key) { s.stop(false); }
        state.drain();
        result
    }

    fn run(&self, state: &AcpState, emit: Emit, rx: &mpsc::Receiver<Value>, key: String, text: String, cmd: std::process::Command) -> Result<String, CallError> {
        let deadline = Instant::now() + self.timeout;
        let name = self.profile.name;
        acp::start(state, emit, key.clone(), Lane::Reviewer, self.profile, self.repo.clone(), self.project_dir.clone(),
            vec![self.repo.clone(), self.project_dir.clone()], None, LaneExtras::default(), None, cmd)
            .map_err(CallError::Failed)?;
        let mut prompted = false;
        let mut reply = String::new();
        loop {
            let left = deadline.saturating_duration_since(Instant::now());
            let ev = rx.recv_timeout(left).map_err(|_| CallError::Failed(format!("{name} took too long to answer")))?;
            let m = ev.get("message").unwrap_or(&Value::Null);
            let params = m.get("params").unwrap_or(&Value::Null);
            match m.get("method").and_then(Value::as_str) {
                Some("_chronicle/session_state") => match params.get("state").and_then(Value::as_str) {
                    Some("ready") if !prompted => {
                        let s = state.get(&key).ok_or_else(|| CallError::Failed(format!("{name} ended before it could answer")))?;
                        s.prompt(vec![json!({ "type": "text", "text": text })], "Chronicle review".into()).map_err(CallError::Failed)?;
                        prompted = true;
                    }
                    Some("needs-login") => return Err(CallError::Failed(format!("{name} isn't signed in — sign in from the agent pane, then try again"))),
                    Some("error") => return Err(CallError::Failed(format!("{name} couldn't start: {}", params.get("message").and_then(Value::as_str).unwrap_or("no detail")))),
                    Some("ended") => return Err(CallError::Failed(format!("{name} ended before it answered"))),
                    _ => {}
                },
                Some("session/update") if params.pointer("/update/sessionUpdate").and_then(Value::as_str) == Some("agent_message_chunk") => {
                    if let Some(t) = params.pointer("/update/content/text").and_then(Value::as_str) { reply.push_str(t); }
                }
                Some("_chronicle/turn_end") => {
                    if let Some(e) = params.get("error") {
                        let why = e.get("message").and_then(Value::as_str).unwrap_or("no detail");
                        return Err(CallError::Failed(format!("{name} couldn't finish the turn: {why}")));
                    }
                    return Ok(reply);
                }
                _ => {}
            }
        }
    }
}

impl Calls for AgentCalls {
    fn complete_json(&self, req: &CompleteRequest) -> Result<Value, CallError> {
        let prompt = format!(
            "{}\n\n{}\n\nAnswer with one JSON object only, no other text, matching this JSON Schema:\n{}",
            req.system, req.prompt, req.schema
        );
        let text = self.turn(prompt)?;
        if text.trim().is_empty() { return Err(CallError::Failed(format!("{} returned no text", self.profile.name))); }
        let v = schema::extract_json(&text).map_err(CallError::Failed)?;
        schema::check_schema(&v, &req.schema).map_err(CallError::Failed)?;
        Ok(v)
    }
    fn decide(&self, req: &DecisionRequest) -> Result<Decision, CallError> { emulate_decide(self, req) }
    fn model(&self) -> String { format!("agent/{}", self.profile.id) }
}

#[cfg(test)]
mod agent_provider_tests {
    use super::*;
    use crate::providers::{Answer, Calls, CompleteRequest, Criterion, DecisionRequest};
    use serde_json::json;

    const MOCK_REVIEWER: &str = r#"
import sys, json
reply, mode = sys.argv[1], sys.argv[2]
def send(o):
    sys.stdout.write(json.dumps(o) + "\n"); sys.stdout.flush()
for line in sys.stdin:
    m = json.loads(line); meth = m.get("method")
    if meth == "initialize":
        send({"jsonrpc":"2.0","id":m["id"],"result":{"protocolVersion":1,"agentCapabilities":{},"authMethods":[]}})
    elif meth == "session/new":
        if mode == "signed-out":
            send({"jsonrpc":"2.0","id":m["id"],"error":{"code":-32000,"message":"Authentication required"}})
        else:
            send({"jsonrpc":"2.0","id":m["id"],"result":{"sessionId":"r1","modes":{"currentModeId":"default","availableModes":[{"id":"default","name":"Ask"}]}}})
    elif meth == "session/set_mode":
        send({"jsonrpc":"2.0","id":m["id"],"result":{}})
    elif meth == "session/prompt":
        send({"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"r1","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":reply}}}})
        send({"jsonrpc":"2.0","id":m["id"],"result":{"stopReason":"end_turn"}})
"#;

    fn mock(name: &str, reply: &str, mode: &str) -> Option<AgentCalls> {
        let py = ["/usr/bin/python3", "/opt/homebrew/bin/python3", "/usr/local/bin/python3"].iter().find(|p| std::path::Path::new(p).exists())?.to_string();
        let dir = std::env::temp_dir().join(format!("chronicle-review-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let dir = dir.canonicalize().unwrap();
        let script = dir.join(".mock-reviewer.py");
        std::fs::write(&script, MOCK_REVIEWER).unwrap();
        let (reply, mode) = (reply.to_string(), mode.to_string());
        Some(AgentCalls {
            profile: crate::agents::claude(),
            repo: dir.clone(),
            project_dir: dir,
            spawn: std::sync::Arc::new(move || { let mut c = std::process::Command::new(&py); c.arg(&script).arg(&reply).arg(&mode); Ok(c) }),
            timeout: std::time::Duration::from_secs(20),
        })
    }

    #[test]
    fn the_agent_answers_a_schema_checked_json_turn() {
        let Some(a) = mock("json", "Here you go:\n```json\n{\"verdict\":\"pass\",\"notes\":[]}\n```", "ok") else { return };
        let schema = json!({ "type": "object", "required": ["verdict", "notes"], "properties": { "verdict": { "type": "string" }, "notes": { "type": "array" } } });
        let v = a.complete_json(&CompleteRequest { system: "You review diffs.".into(), prompt: "diff --git …".into(), schema, max_tokens: 2000 }).unwrap();
        assert_eq!(v["verdict"], "pass");
        assert_eq!(a.model(), "agent/claude-acp");
    }

    #[test]
    fn the_agent_decides_by_emulation() {
        let Some(a) = mock("decide", "{\"outside\":{\"yes\":0.2}}", "ok") else { return };
        let d = a.decide(&DecisionRequest { state: "ls".into(), instructions: "Does it write?".into(), criteria: vec![Criterion::Noul { name: "outside".into() }] }).unwrap();
        assert!(d.self_reported);
        assert_eq!(d.answers["outside"], Answer::Noul { yes: 0.2 });
    }

    #[test]
    fn a_signed_out_agent_says_so() {
        let Some(a) = mock("signed-out", "{}", "signed-out") else { return };
        let e = a.complete_json(&CompleteRequest { system: String::new(), prompt: "x".into(), schema: json!({ "type": "object" }), max_tokens: 100 }).unwrap_err();
        assert!(e.to_string().contains("isn't signed in"), "{e}");
    }

    #[test]
    fn a_reply_that_breaks_the_schema_is_an_error_not_a_guess() {
        let Some(a) = mock("bad", "{\"verdict\":3}", "ok") else { return };
        let schema = json!({ "type": "object", "required": ["verdict"], "properties": { "verdict": { "type": "string" } } });
        assert!(a.complete_json(&CompleteRequest { system: String::new(), prompt: "x".into(), schema, max_tokens: 100 }).is_err());
    }
}
