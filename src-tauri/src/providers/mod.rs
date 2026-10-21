//! Chronicle's own model calls (spec 2026-10-15 §9-§10): the Runs reviewer's
//! verdict and the judge's bounded decisions. Every provider answers the same
//! two calls; `Agent` needs no key and rides the user's agent.
pub mod agent;
pub mod http;
pub mod schema;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;

pub enum Provider {
    /// A one-turn reviewer session on the project's agent — the default, no key.
    Agent,
    Anthropic { key: String },
    OpenAI { key: String },
    OpenRouter { key: String },
    /// Jev: native decisions only.
    TypeSafe { key: String },
    /// An OpenAI-compatible server on this Mac (Ollama, LM Studio).
    Local { base_url: String },
}

impl Provider {
    pub fn id(&self) -> &'static str {
        match self {
            Provider::Agent => "agent",
            Provider::Anthropic { .. } => "anthropic",
            Provider::OpenAI { .. } => "openai",
            Provider::OpenRouter { .. } => "openrouter",
            Provider::TypeSafe { .. } => "typesafe",
            Provider::Local { .. } => "local",
        }
    }
}

pub struct CompleteRequest { pub system: String, pub prompt: String, pub schema: Value, pub max_tokens: u32 }

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Criterion {
    Choice { name: String, options: Vec<String> },
    Score { name: String, min: i32, max: i32 },
    Noul { name: String },
}

impl Criterion {
    pub fn name(&self) -> &str {
        match self { Criterion::Choice { name, .. } | Criterion::Score { name, .. } | Criterion::Noul { name } => name }
    }
}

pub struct DecisionRequest { pub state: String, pub instructions: String, pub criteria: Vec<Criterion> }

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Answer {
    Choice { choice: String, probabilities: HashMap<String, f32>, confidence: f32 },
    Score { value: i32, confidence: f32 },
    Noul { yes: f32 },
}

#[derive(Debug, Clone, Serialize)]
pub struct Decision {
    pub answers: HashMap<String, Answer>,
    pub model: String,
    /// true when the confidence is the model's own claim (every provider but a
    /// native decision model): the REFLEX bands treat it one band stricter.
    pub self_reported: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub enum CallError {
    /// HTTP 401/403: the saved key no longer works. The caller falls back to the agent.
    KeyRefused(String),
    Failed(String),
}

impl std::fmt::Display for CallError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self { CallError::KeyRefused(m) | CallError::Failed(m) => f.write_str(m) }
    }
}

pub trait Calls: Send + Sync {
    /// One schema-checked JSON answer.
    fn complete_json(&self, req: &CompleteRequest) -> Result<Value, CallError>;
    /// The judge's bounded decisions (spec §10).
    fn decide(&self, req: &DecisionRequest) -> Result<Decision, CallError>;
    /// What answered, for the run record: "<provider>/<model>".
    fn model(&self) -> String;
}

const DECIDE_SYSTEM: &str = "You make small, bounded decisions for a coding tool. For each named criterion give your answer, a probability for every option, and how confident you are, as numbers from 0 to 1. Answer with JSON only.";

/// A decision through `complete_json`, for every provider without native decisions.
pub fn emulate_decide(c: &dyn Calls, req: &DecisionRequest) -> Result<Decision, CallError> {
    let schema = schema::decision_schema(&req.criteria);
    let v = c.complete_json(&CompleteRequest {
        system: DECIDE_SYSTEM.into(),
        prompt: format!("{}\n\n## State\n{}", req.instructions, req.state),
        schema,
        max_tokens: 2000,
    })?;
    let answers = schema::parse_answers(&v, &req.criteria).map_err(CallError::Failed)?;
    Ok(Decision { answers, model: c.model(), self_reported: true })
}

/// A refused key (and only that) falls back; the decision says why.
pub fn decide_with_fallback(primary: &dyn Calls, fallback: &dyn Calls, req: &DecisionRequest) -> Result<Decision, CallError> {
    match primary.decide(req) {
        Err(CallError::KeyRefused(why)) => fallback.decide(req).map(|mut d| { d.model = format!("{} ({why})", d.model); d }),
        other => other,
    }
}

pub fn complete_with_fallback(primary: &dyn Calls, fallback: &dyn Calls, req: &CompleteRequest) -> Result<(Value, Option<String>), CallError> {
    match primary.complete_json(req) {
        Err(CallError::KeyRefused(why)) => fallback.complete_json(req).map(|v| (v, Some(why))),
        other => other.map(|v| (v, None)),
    }
}

#[cfg(test)]
mod provider_tests {
    use super::*;
    use serde_json::json;

    struct Canned { reply: Result<Value, CallError>, name: &'static str }
    impl Calls for Canned {
        fn complete_json(&self, _req: &CompleteRequest) -> Result<Value, CallError> { self.reply.clone() }
        fn decide(&self, req: &DecisionRequest) -> Result<Decision, CallError> { emulate_decide(self, req) }
        fn model(&self) -> String { self.name.into() }
    }

    fn noul() -> DecisionRequest {
        DecisionRequest { state: "rm -rf build/".into(), instructions: "Does this command write outside the owned files?".into(), criteria: vec![Criterion::Noul { name: "outside".into() }] }
    }

    #[test]
    fn an_emulated_decision_is_marked_self_reported() {
        let c = Canned { reply: Ok(json!({ "outside": { "yes": 0.1 } })), name: "anthropic/claude-opus-5-5" };
        let d = c.decide(&noul()).unwrap();
        assert!(d.self_reported, "only a native decision model's confidence is not self-reported");
        assert_eq!(d.model, "anthropic/claude-opus-5-5");
        assert_eq!(d.answers["outside"], Answer::Noul { yes: 0.1 });
    }

    #[test]
    fn a_refused_key_falls_back_and_any_other_failure_does_not() {
        let refused = Canned { reply: Err(CallError::KeyRefused("Anthropic refused the saved key".into())), name: "anthropic/x" };
        let broken = Canned { reply: Err(CallError::Failed("Anthropic answered 500".into())), name: "anthropic/x" };
        let agent = Canned { reply: Ok(json!({ "outside": { "yes": 0.3 } })), name: "agent/claude-acp" };
        let d = decide_with_fallback(&refused, &agent, &noul()).unwrap();
        assert_eq!(d.model, "agent/claude-acp (Anthropic refused the saved key)");
        assert!(matches!(decide_with_fallback(&broken, &agent, &noul()), Err(CallError::Failed(m)) if m.contains("500")));
    }

    #[test]
    fn criteria_serialise_with_their_type_tag() {
        let c = Criterion::Choice { name: "action".into(), options: vec!["allow".into()] };
        assert_eq!(serde_json::to_value(&c).unwrap(), json!({ "type": "choice", "name": "action", "options": ["allow"] }));
    }
}
