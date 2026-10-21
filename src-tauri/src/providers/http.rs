//! The keyed providers, over `curl` (no HTTP crate in the build). The key goes
//! to curl in a config read from stdin, the body in a 0600 temp file: neither
//! shows up in `ps`.
use super::{emulate_decide, schema, CallError, Calls, CompleteRequest, Decision, DecisionRequest};
use serde_json::{json, Value};
use std::io::Write;
use std::path::Path;
use std::sync::Arc;

pub struct HttpReply { pub status: u16, pub body: Value }

pub trait Transport: Send + Sync {
    fn post_json(&self, url: &str, headers: &[(&str, String)], body: &Value) -> Result<HttpReply, String>;
}

/// A curl config string: control characters are escaped so a value can't end its line or add a directive.
fn q(s: &str) -> String {
    s.replace('\\', "\\\\").replace('"', "\\\"").replace('\n', "\\n").replace('\r', "\\r").replace('\t', "\\t")
}

pub fn curl_config(url: &str, headers: &[(&str, String)], body_file: &Path) -> String {
    let mut c = format!("url = \"{}\"\nrequest = \"POST\"\nsilent\nshow-error\nmax-time = 120\nwrite-out = \"\\n%{{http_code}}\"\n", q(url));
    for (k, v) in headers { c.push_str(&format!("header = \"{}: {}\"\n", q(k), q(v))); }
    c.push_str(&format!("data-binary = \"@{}\"\n", q(&body_file.to_string_lossy())));
    c
}

/// curl's stdout with `write-out "\n%{http_code}"`: the body, a newline, the status.
pub fn parse_curl_output(out: &str) -> Result<HttpReply, String> {
    let (body, code) = out.rsplit_once('\n').ok_or("the provider sent nothing back")?;
    let status: u16 = code.trim().parse().map_err(|_| "the provider's answer had no status".to_string())?;
    if status == 0 { return Err("no connection was made".into()); }
    let body = serde_json::from_str(body).unwrap_or_else(|_| json!({ "error": { "message": body.trim().chars().take(200).collect::<String>() } }));
    Ok(HttpReply { status, body })
}

/// curl's stdout and stderr → a reply, or why no reply came. A failed connection still
/// writes "\n000", so status 0 is the signal, and curl's stderr says why.
fn curl_result(url: &str, stdout: &str, stderr: &str) -> Result<HttpReply, String> {
    match parse_curl_output(stdout) {
        Ok(r) => Ok(r),
        Err(e) => {
            let host = url.split("://").nth(1).unwrap_or(url).split('/').next().unwrap_or(url);
            let why = stderr.lines().map(str::trim).find(|l| !l.is_empty()).unwrap_or(&e);
            Err(format!("couldn't reach {host}: {why}"))
        }
    }
}

pub struct CurlTransport;

impl Transport for CurlTransport {
    fn post_json(&self, url: &str, headers: &[(&str, String)], body: &Value) -> Result<HttpReply, String> {
        use std::os::unix::fs::OpenOptionsExt;
        let n = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
        let path = std::env::temp_dir().join(format!("chronicle-provider-{}-{n}.json", std::process::id()));
        let write = || -> Result<(), String> {
            let mut f = std::fs::OpenOptions::new().write(true).create_new(true).mode(0o600).open(&path).map_err(|e| e.to_string())?;
            f.write_all(serde_json::to_string(body).map_err(|e| e.to_string())?.as_bytes()).map_err(|e| e.to_string())
        };
        if let Err(e) = write() { let _ = std::fs::remove_file(&path); return Err(e); }
        let run = || -> Result<HttpReply, String> {
            let mut child = std::process::Command::new("curl").args(["-K", "-"])
                .stdin(std::process::Stdio::piped()).stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped())
                .spawn().map_err(|e| format!("couldn't run curl: {e}"))?;
            child.stdin.take().ok_or("no stdin")?.write_all(curl_config(url, headers, &path).as_bytes()).map_err(|e| e.to_string())?;
            let out = child.wait_with_output().map_err(|e| e.to_string())?;
            curl_result(url, &String::from_utf8_lossy(&out.stdout), &String::from_utf8_lossy(&out.stderr))
        };
        let r = run();
        let _ = std::fs::remove_file(&path);
        r
    }
}

fn check_status(r: &HttpReply, who: &str) -> Result<(), CallError> {
    match r.status {
        200..=299 => Ok(()),
        401 => Err(CallError::KeyRefused(format!("{who} refused the saved key"))),
        s => Err(CallError::Failed(format!("{who} answered {s}: {}", r.body.pointer("/error/message").and_then(Value::as_str).unwrap_or("no detail")))),
    }
}

fn finish(text: &str, who: &str, req: &CompleteRequest) -> Result<Value, CallError> {
    if text.trim().is_empty() { return Err(CallError::Failed(format!("{who} returned no text"))); }
    let v = schema::extract_json(text).map_err(CallError::Failed)?;
    schema::check_schema(&v, &req.schema).map_err(CallError::Failed)?;
    Ok(v)
}

pub struct AnthropicCalls { pub key: String, pub model: String, pub t: Arc<dyn Transport> }

impl Calls for AnthropicCalls {
    fn complete_json(&self, req: &CompleteRequest) -> Result<Value, CallError> {
        let body = json!({
            "model": self.model,
            "max_tokens": req.max_tokens,
            "system": req.system,
            "messages": [{ "role": "user", "content": req.prompt }],
            "output_config": { "format": { "type": "json_schema", "schema": req.schema } },
        });
        let r = self.t.post_json("https://api.anthropic.com/v1/messages",
            &[("x-api-key", self.key.clone()), ("anthropic-version", "2023-06-01".into()), ("content-type", "application/json".into())], &body)
            .map_err(CallError::Failed)?;
        check_status(&r, "Anthropic")?;
        if r.body["stop_reason"] == "refusal" { return Err(CallError::Failed("Anthropic declined to answer this one".into())); }
        let text: String = r.body["content"].as_array().into_iter().flatten()
            .filter(|b| b["type"] == "text").filter_map(|b| b["text"].as_str()).collect();
        finish(&text, "Anthropic", req)
    }
    fn decide(&self, req: &DecisionRequest) -> Result<Decision, CallError> { emulate_decide(self, req) }
    fn model(&self) -> String { format!("anthropic/{}", self.model) }
}

pub struct OpenAICalls { pub key: String, pub model: String, pub t: Arc<dyn Transport> }

impl Calls for OpenAICalls {
    fn complete_json(&self, req: &CompleteRequest) -> Result<Value, CallError> {
        let body = json!({
            "model": self.model,
            "instructions": req.system,
            "input": req.prompt,
            "max_output_tokens": req.max_tokens,
            "text": { "format": { "type": "json_schema", "name": "chronicle", "schema": req.schema, "strict": true } },
        });
        let r = self.t.post_json("https://api.openai.com/v1/responses",
            &[("authorization", format!("Bearer {}", self.key)), ("content-type", "application/json".into())], &body)
            .map_err(CallError::Failed)?;
        check_status(&r, "OpenAI")?;
        let text: String = r.body["output"].as_array().into_iter().flatten()
            .filter(|o| o["type"] == "message")
            .flat_map(|o| o["content"].as_array().cloned().unwrap_or_default())
            .filter(|c| c["type"] == "output_text").filter_map(|c| c["text"].as_str().map(String::from)).collect();
        finish(&text, "OpenAI", req)
    }
    fn decide(&self, req: &DecisionRequest) -> Result<Decision, CallError> { emulate_decide(self, req) }
    fn model(&self) -> String { format!("openai/{}", self.model) }
}

pub const OPENROUTER_URL: &str = "https://openrouter.ai/api/v1/chat/completions";

/// A local server's chat endpoint from the address the user typed.
pub fn local_url(base: &str) -> String {
    let b = base.trim().trim_end_matches('/');
    if b.ends_with("/v1") { format!("{b}/chat/completions") } else { format!("{b}/v1/chat/completions") }
}

pub struct ChatCompatCalls { pub url: String, pub key: Option<String>, pub model: String, pub label: &'static str, pub t: Arc<dyn Transport> }

impl Calls for ChatCompatCalls {
    fn complete_json(&self, req: &CompleteRequest) -> Result<Value, CallError> {
        let body = json!({
            "model": self.model,
            "max_tokens": req.max_tokens,
            "messages": [{ "role": "system", "content": req.system }, { "role": "user", "content": req.prompt }],
            "response_format": { "type": "json_schema", "json_schema": { "name": "chronicle", "schema": req.schema, "strict": true } },
        });
        let mut headers = vec![("content-type", "application/json".to_string())];
        if let Some(k) = &self.key { headers.push(("authorization", format!("Bearer {k}"))); }
        let who = if self.label == "local" { "The local server" } else { "OpenRouter" };
        let r = self.t.post_json(&self.url, &headers, &body).map_err(CallError::Failed)?;
        check_status(&r, who)?;
        finish(r.body.pointer("/choices/0/message/content").and_then(Value::as_str).unwrap_or(""), who, req)
    }
    fn decide(&self, req: &DecisionRequest) -> Result<Decision, CallError> { emulate_decide(self, req) }
    fn model(&self) -> String { format!("{}/{}", self.label, self.model) }
}

pub struct TypeSafeCalls { pub key: String, pub model: String, pub t: Arc<dyn Transport> }

/// Jev's reply → answers. ASSUMED shape (not in either spec): `answers` keyed
/// by criterion name, each in the emulated decision's shape. Confirmed live in Task 19.
fn parse_jev(body: &Value, req: &DecisionRequest) -> Result<std::collections::HashMap<String, super::Answer>, String> {
    schema::parse_answers(body.get("answers").ok_or("Jev's answer had no answers in it")?, &req.criteria)
}

impl Calls for TypeSafeCalls {
    fn complete_json(&self, _req: &CompleteRequest) -> Result<Value, CallError> {
        Err(CallError::Failed("TypeSafe answers decisions only — choose another provider for review".into()))
    }
    fn decide(&self, req: &DecisionRequest) -> Result<Decision, CallError> {
        let body = json!({ "model": self.model, "state": req.state, "instructions": req.instructions, "criteria": req.criteria });
        let r = self.t.post_json("https://api.typesafe.ai/v1/systemone",
            &[("authorization", format!("Bearer {}", self.key)), ("content-type", "application/json".into())], &body)
            .map_err(CallError::Failed)?;
        check_status(&r, "TypeSafe")?;
        let answers = parse_jev(&r.body, req).map_err(CallError::Failed)?;
        let model = r.body["model"].as_str().unwrap_or(&self.model).to_string();
        Ok(Decision { answers, model: format!("typesafe/{model}"), self_reported: false })
    }
    fn model(&self) -> String { format!("typesafe/{}", self.model) }
}

#[cfg(test)]
mod http_tests {
    use super::*;
    use crate::providers::{decide_with_fallback, Answer, CallError, Calls, CompleteRequest, Criterion, DecisionRequest};
    use serde_json::json;
    use std::sync::Mutex;

    struct Fake { status: u16, body: Value, seen: Mutex<Vec<(String, Vec<(String, String)>, Value)>> }
    impl Fake {
        fn new(status: u16, body: &str) -> Arc<Fake> { Arc::new(Fake { status, body: serde_json::from_str(body).unwrap(), seen: Mutex::new(Vec::new()) }) }
    }
    impl Transport for Fake {
        fn post_json(&self, url: &str, headers: &[(&str, String)], body: &Value) -> Result<HttpReply, String> {
            self.seen.lock().unwrap().push((url.into(), headers.iter().map(|(k, v)| (k.to_string(), v.clone())).collect(), body.clone()));
            Ok(HttpReply { status: self.status, body: self.body.clone() })
        }
    }
    fn header(h: &[(String, String)], k: &str) -> Option<String> { h.iter().find(|(n, _)| n == k).map(|(_, v)| v.clone()) }
    fn noul() -> DecisionRequest {
        DecisionRequest { state: "ls -la".into(), instructions: "Does it write outside?".into(), criteria: vec![Criterion::Noul { name: "outside".into() }] }
    }

    #[test]
    fn anthropic_sends_the_messages_shape_and_reads_the_text() {
        let t = Fake::new(200, include_str!("fixtures/anthropic-messages.json"));
        let c = AnthropicCalls { key: "sk-ant-x".into(), model: "claude-opus-5-5".into(), t: t.clone() };
        let d = c.decide(&noul()).unwrap();
        assert_eq!(d.answers["outside"], Answer::Noul { yes: 0.12 });
        assert!(d.self_reported);
        assert_eq!(d.model, "anthropic/claude-opus-5-5");
        let (url, headers, body) = t.seen.lock().unwrap()[0].clone();
        assert_eq!(url, "https://api.anthropic.com/v1/messages");
        assert_eq!(header(&headers, "x-api-key").as_deref(), Some("sk-ant-x"));
        assert_eq!(header(&headers, "anthropic-version").as_deref(), Some("2023-06-01"));
        assert_eq!(body["output_config"]["format"]["type"], "json_schema");
        assert_eq!(body["messages"][0]["role"], "user");
    }

    #[test]
    fn a_refusal_is_an_error_not_an_answer() {
        let t = Fake::new(200, r#"{"type":"message","content":[],"stop_reason":"refusal","stop_details":{"type":"refusal","category":"cyber"}}"#);
        let c = AnthropicCalls { key: "k".into(), model: "claude-opus-5-5".into(), t };
        assert!(matches!(c.decide(&noul()), Err(CallError::Failed(m)) if m.contains("declined")));
    }

    #[test]
    fn openai_sends_the_responses_shape_and_reads_output_text() {
        let t = Fake::new(200, include_str!("fixtures/openai-responses.json"));
        let c = OpenAICalls { key: "sk-x".into(), model: "gpt-5".into(), t: t.clone() };
        assert_eq!(c.decide(&noul()).unwrap().answers["outside"], Answer::Noul { yes: 0.2 });
        let (url, headers, body) = t.seen.lock().unwrap()[0].clone();
        assert_eq!(url, "https://api.openai.com/v1/responses");
        assert_eq!(header(&headers, "authorization").as_deref(), Some("Bearer sk-x"));
        assert_eq!(body["text"]["format"]["type"], "json_schema");
        assert_eq!(body["text"]["format"]["strict"], true);
    }

    #[test]
    fn openrouter_and_local_speak_chat_completions() {
        let t = Fake::new(200, include_str!("fixtures/chat-completions.json"));
        let or = ChatCompatCalls { url: OPENROUTER_URL.into(), key: Some("or-x".into()), model: "openai/gpt-5".into(), label: "openrouter", t: t.clone() };
        assert_eq!(or.decide(&noul()).unwrap().answers["outside"], Answer::Noul { yes: 0.3 });
        let local = ChatCompatCalls { url: local_url("http://localhost:11434/"), key: None, model: "llama3.1".into(), label: "local", t: t.clone() };
        local.decide(&noul()).unwrap();
        let seen = t.seen.lock().unwrap();
        assert_eq!(seen[0].0, "https://openrouter.ai/api/v1/chat/completions");
        assert_eq!(header(&seen[0].1, "authorization").as_deref(), Some("Bearer or-x"));
        assert_eq!(seen[1].0, "http://localhost:11434/v1/chat/completions");
        assert_eq!(header(&seen[1].1, "authorization"), None, "a local server gets no key");
        assert_eq!(seen[1].2["response_format"]["type"], "json_schema");
        assert_eq!(local_url("http://localhost:1234/v1"), "http://localhost:1234/v1/chat/completions");
    }

    #[test]
    fn typesafe_decides_natively_and_does_not_review() {
        let t = Fake::new(200, include_str!("fixtures/typesafe-systemone.json"));
        let c = TypeSafeCalls { key: "ts-x".into(), model: "jev-1.13.0".into(), t: t.clone() };
        let d = c.decide(&noul()).unwrap();
        assert!(!d.self_reported, "Jev's confidence is its own measurement");
        assert_eq!(d.model, "typesafe/jev-1.13.0");
        assert_eq!(d.answers["outside"], Answer::Noul { yes: 0.04 });
        let (url, _, body) = t.seen.lock().unwrap()[0].clone();
        assert_eq!(url, "https://api.typesafe.ai/v1/systemone");
        assert_eq!(body["criteria"][0], json!({ "type": "noul", "name": "outside" }));
        assert_eq!(body["state"], "ls -la");
        assert!(c.complete_json(&CompleteRequest { system: String::new(), prompt: String::new(), schema: json!({}), max_tokens: 1 }).is_err());
    }

    #[test]
    fn a_refused_key_falls_back_to_the_agent_and_says_so() {
        let t = Fake::new(401, include_str!("fixtures/error-401.json"));
        let anthropic = AnthropicCalls { key: "revoked".into(), model: "claude-opus-5-5".into(), t };
        assert!(matches!(anthropic.decide(&noul()), Err(CallError::KeyRefused(_))));
        // the fallback is a canned agent here; Task 13 tests the real Agent provider
        struct AgentStub;
        impl Calls for AgentStub {
            fn complete_json(&self, _: &CompleteRequest) -> Result<Value, CallError> { Ok(json!({ "outside": { "yes": 0.5 } })) }
            fn decide(&self, r: &DecisionRequest) -> Result<crate::providers::Decision, CallError> { crate::providers::emulate_decide(self, r) }
            fn model(&self) -> String { "agent/claude-acp".into() }
        }
        let d = decide_with_fallback(&anthropic, &AgentStub, &noul()).unwrap();
        assert_eq!(d.model, "agent/claude-acp (Anthropic refused the saved key)");
    }

    #[test]
    fn a_server_error_is_not_masked_as_a_key_problem() {
        let t = Fake::new(529, r#"{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}"#);
        let c = AnthropicCalls { key: "k".into(), model: "m".into(), t };
        assert!(matches!(c.decide(&noul()), Err(CallError::Failed(m)) if m.contains("529") && m.contains("Overloaded")));
    }

    #[test]
    fn the_curl_config_carries_headers_never_argv_and_escapes_quotes() {
        let c = curl_config("https://x/y", &[("authorization", "Bearer a\"b".into())], std::path::Path::new("/tmp/body.json"));
        assert!(c.contains("url = \"https://x/y\""));
        assert!(c.contains("header = \"authorization: Bearer a\\\"b\""));
        assert!(c.contains("data-binary = \"@/tmp/body.json\""));
        assert!(c.contains("write-out = \"\\n%{http_code}\""));
    }

    #[test]
    fn the_curl_config_cannot_be_broken_or_extended_by_a_control_character() {
        let c = curl_config("https://x/y\n", &[("authorization", "Bearer a\nurl = \"evil\"".into()), ("x", "a\\b".into())], std::path::Path::new("/tmp/b.json"));
        assert!(c.contains("url = \"https://x/y\\n\"\n"));
        assert!(c.contains("header = \"authorization: Bearer a\\nurl = \\\"evil\\\"\"\n"));
        assert!(c.contains("header = \"x: a\\\\b\""));
        assert!(c.lines().all(|l| l.is_empty() || l.starts_with("url") || l.starts_with("header") || l.starts_with("data-binary") || l.starts_with("request") || ["silent", "show-error"].contains(&l) || l.starts_with("max-time") || l.starts_with("write-out")));
        assert_eq!(c.lines().filter(|l| l.starts_with("url")).count(), 1);
    }

    #[test]
    fn a_failed_connection_says_why_not_answered_zero() {
        assert!(parse_curl_output("\n000").is_err());
        let e = curl_result("http://localhost:11434/v1/chat/completions", "\n000", "curl: (7) Failed to connect to localhost port 11434\n").err().unwrap();
        assert_eq!(e, "couldn't reach localhost:11434: curl: (7) Failed to connect to localhost port 11434");
        assert_eq!(curl_result("https://x/y", "{}\n200", "").map(|r| r.status), Ok(200));
    }

    #[test]
    fn only_a_401_is_a_refused_key() {
        let t = Fake::new(403, r#"{"error":{"message":"region not supported"}}"#);
        let c = AnthropicCalls { key: "k".into(), model: "m".into(), t };
        assert!(matches!(c.decide(&noul()), Err(CallError::Failed(m)) if m.contains("403") && m.contains("region not supported")));
    }

    #[test]
    fn an_empty_reply_says_no_text() {
        let t = Fake::new(200, r#"{"choices":[]}"#);
        let c = ChatCompatCalls { url: local_url("http://localhost:1/"), key: None, model: "m".into(), label: "local", t };
        assert!(matches!(c.decide(&noul()), Err(CallError::Failed(m)) if m.contains("returned no text")));
    }

    #[test]
    fn curl_output_splits_into_body_and_status() {
        let r = parse_curl_output("{\"ok\":true}\n200").unwrap();
        assert_eq!(r.status, 200);
        assert_eq!(r.body, json!({ "ok": true }));
        let e = parse_curl_output("<html>bad gateway</html>\n502").unwrap();
        assert_eq!(e.status, 502);
        assert_eq!(e.body, json!({ "error": { "message": "<html>bad gateway</html>" } }));
        assert!(parse_curl_output("").is_err());
    }
}
