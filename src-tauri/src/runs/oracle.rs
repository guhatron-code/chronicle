//! The one seam between runs and the provider layer (agents spec §9–§10). The
//! judge and the reviewer see only `Oracle`; `ProviderOracle` puts Plan C's
//! `Calls` behind it; `Fallback` falls to the user's agent for the rest of the
//! run the first time a provider fails (spec §11), with one notice. (Plan C's
//! per-call `decide_with_fallback` covers only a refused key; this is the
//! run-level, sticky one, and it falls back on any failure.)
use crate::providers::{Calls, CompleteRequest, Decision, DecisionRequest};
use serde_json::Value;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

/// Room for a decision's or a second opinion's answer.
pub const DECISION_TOKENS: u32 = 2000;
/// Room for a review's findings.
pub const REVIEW_TOKENS: u32 = 4000;

pub trait Oracle: Send + Sync {
    fn decide(&self, req: DecisionRequest) -> Result<Decision, String>;
    /// The schema-checked JSON answer, and the model that gave it.
    fn complete_json(&self, system: &str, prompt: &str, schema: &Value) -> Result<(Value, String), String>;
}

pub struct ProviderOracle {
    calls: Box<dyn Calls + Send + Sync>,
    /// The role this oracle answers for, in failure messages only — the record names `calls.model()`.
    label: String,
    max_tokens: u32,
}

impl ProviderOracle {
    pub fn new(calls: Box<dyn Calls + Send + Sync>, label: &str) -> Self {
        ProviderOracle { calls, label: label.into(), max_tokens: DECISION_TOKENS }
    }
    pub fn with_max_tokens(mut self, max_tokens: u32) -> Self { self.max_tokens = max_tokens; self }
}

impl Oracle for ProviderOracle {
    fn decide(&self, req: DecisionRequest) -> Result<Decision, String> {
        self.calls.decide(&req).map_err(|e| format!("{}: {e}", self.label))
    }
    fn complete_json(&self, system: &str, prompt: &str, schema: &Value) -> Result<(Value, String), String> {
        let v = self.calls.complete_json(&CompleteRequest {
            system: system.to_string(), prompt: prompt.to_string(), schema: schema.clone(), max_tokens: self.max_tokens,
        }).map_err(|e| format!("{}: {e}", self.label))?;
        Ok((v, self.calls.model()))
    }
}

pub const DECISIONS_FALLBACK: &str = "The decision model couldn’t be reached, so your agent answers the run’s small questions from here on.";
pub const REVIEW_FALLBACK: &str = "The review model couldn’t be reached, so your agent reviews the lanes from here on.";

pub struct Fallback {
    primary: Arc<dyn Oracle>,
    /// `None` when the primary already is the agent: there is nothing else to fall to.
    fallback: Option<Arc<dyn Oracle>>,
    degraded: AtomicBool,
    notice: Mutex<Option<String>>,
    what: &'static str,
}

impl Fallback {
    pub fn new(primary: Arc<dyn Oracle>, fallback: Arc<dyn Oracle>, what: &'static str) -> Self {
        Fallback { primary, fallback: Some(fallback), degraded: AtomicBool::new(false), notice: Mutex::new(None), what }
    }
    /// A role with no separate fallback: its failure is just the error, and there is no notice.
    pub fn alone(primary: Arc<dyn Oracle>) -> Self {
        Fallback { primary, fallback: None, degraded: AtomicBool::new(false), notice: Mutex::new(None), what: "" }
    }
    fn degrade(&self) {
        if !self.degraded.swap(true, Ordering::SeqCst) {
            if let Ok(mut g) = self.notice.lock() { *g = Some(self.what.to_string()); }
        }
    }
    pub fn decide(&self, mk: &dyn Fn() -> DecisionRequest) -> Result<Decision, String> {
        let Some(fallback) = &self.fallback else { return self.primary.decide(mk()) };
        if !self.degraded.load(Ordering::SeqCst) {
            match self.primary.decide(mk()) { Ok(d) => return Ok(d), Err(_) => self.degrade() }
        }
        fallback.decide(mk())
    }
    pub fn complete_json(&self, system: &str, prompt: &str, schema: &Value) -> Result<(Value, String), String> {
        let Some(fallback) = &self.fallback else { return self.primary.complete_json(system, prompt, schema) };
        if !self.degraded.load(Ordering::SeqCst) {
            match self.primary.complete_json(system, prompt, schema) { Ok(v) => return Ok(v), Err(_) => self.degrade() }
        }
        fallback.complete_json(system, prompt, schema)
    }
    /// The one notice for the run card, once.
    pub fn take_notice(&self) -> Option<String> { self.notice.lock().ok()?.take() }
}

/// One role's fallback: the agent behind a provider, or, when what answers the role
/// already is the agent (`<provider>/<model>` starting `agent/`), the agent alone, so an
/// agent failure isn't retried on the same agent under a false notice.
fn role(primary: Arc<dyn Oracle>, primary_model: &str, agent: impl FnOnce() -> Arc<dyn Oracle>, what: &'static str) -> Fallback {
    if primary_model.starts_with("agent/") { Fallback::alone(primary) } else { Fallback::new(primary, agent(), what) }
}

/// The project's Decisions and Review roles (agents spec §9), each falling back
/// to the user's agent — which is also what both roles are when no key is set.
/// The review side is shared: the judge asks its second opinions and lane
/// questions there, and `review::review` gives its verdict there.
pub fn for_project(project: &Path) -> (Fallback, Arc<Fallback>) {
    use crate::providers::{agent_calls, config::Role, for_role};
    let side = |r: Role, tokens: u32, what: &'static str| -> Fallback {
        let calls = for_role(r, project);
        let model = calls.model();
        let primary: Arc<dyn Oracle> = Arc::new(ProviderOracle::new(calls, r.as_str()).with_max_tokens(tokens));
        role(primary, &model, || Arc::new(ProviderOracle::new(Box::new(agent_calls(project)), "agent").with_max_tokens(tokens)), what)
    };
    (side(Role::Decisions, DECISION_TOKENS, DECISIONS_FALLBACK), Arc::new(side(Role::Review, REVIEW_TOKENS, REVIEW_FALLBACK)))
}

#[cfg(test)]
pub(crate) mod fake {
    use super::*;
    use crate::providers::{Answer, Decision};
    use std::collections::{HashMap, VecDeque};
    use std::sync::atomic::AtomicUsize;

    /// Answers queued by the test, in order; an empty queue is an unreachable provider.
    #[derive(Default)]
    pub(crate) struct FakeOracle {
        pub decides: Mutex<VecDeque<Result<Decision, String>>>,
        pub completes: Mutex<VecDeque<Result<Value, String>>>,
        pub decide_calls: AtomicUsize,
        pub complete_calls: AtomicUsize,
        /// every prompt `complete_json` was asked, in order
        pub prompts: Mutex<Vec<String>>,
        pub model: String,
    }
    impl FakeOracle {
        pub fn named(model: &str) -> Arc<Self> { Arc::new(FakeOracle { model: model.into(), ..Default::default() }) }
        pub fn decide_with(&self, d: Decision) { self.decides.lock().unwrap().push_back(Ok(d)); }
        pub fn complete_with(&self, v: Value) { self.completes.lock().unwrap().push_back(Ok(v)); }
        pub fn fail_next_decide(&self) { self.decides.lock().unwrap().push_back(Err("503 Service Unavailable".into())); }
    }
    impl Oracle for FakeOracle {
        fn decide(&self, _req: DecisionRequest) -> Result<Decision, String> {
            self.decide_calls.fetch_add(1, Ordering::SeqCst);
            self.decides.lock().unwrap().pop_front().unwrap_or_else(|| Err("unreachable".into()))
        }
        fn complete_json(&self, _s: &str, p: &str, _schema: &Value) -> Result<(Value, String), String> {
            self.complete_calls.fetch_add(1, Ordering::SeqCst);
            self.prompts.lock().unwrap().push(p.to_string());
            self.completes.lock().unwrap().pop_front().unwrap_or_else(|| Err("unreachable".into())).map(|v| (v, self.model.clone()))
        }
    }
    pub(crate) fn choice(name: &str, pick: &str, probs: &[(&str, f32)], confidence: f32) -> (String, Answer) {
        (name.into(), Answer::Choice { choice: pick.into(), probabilities: probs.iter().map(|(k, v)| (k.to_string(), *v)).collect::<HashMap<_, _>>(), confidence })
    }
    pub(crate) fn noul(name: &str, yes: f32) -> (String, Answer) { (name.into(), Answer::Noul { yes }) }
    pub(crate) fn score(name: &str, value: i32, confidence: f32) -> (String, Answer) { (name.into(), Answer::Score { value, confidence }) }
    pub(crate) fn decision(answers: Vec<(String, Answer)>, model: &str, self_reported: bool) -> Decision {
        Decision { answers: answers.into_iter().collect(), model: model.into(), self_reported }
    }
    /// A fallback over two fakes — the shape every runs test builds its judge from.
    pub(crate) fn fallback(primary: &Arc<FakeOracle>, agent: &Arc<FakeOracle>) -> Fallback {
        Fallback::new(primary.clone(), agent.clone(), DECISIONS_FALLBACK)
    }
    /// The review side, shared by the judge's second opinions and the reviewer.
    pub(crate) fn second(primary: &Arc<FakeOracle>, agent: &Arc<FakeOracle>) -> Arc<Fallback> {
        Arc::new(Fallback::new(primary.clone(), agent.clone(), REVIEW_FALLBACK))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::providers::{CallError, Criterion};
    use serde_json::json;

    struct Canned;
    impl Calls for Canned {
        fn complete_json(&self, req: &CompleteRequest) -> Result<Value, CallError> { Ok(json!({ "max_tokens": req.max_tokens })) }
        fn decide(&self, _req: &DecisionRequest) -> Result<Decision, CallError> { Err(CallError::Failed("answered 500".into())) }
        fn model(&self) -> String { "anthropic/claude-opus-5-5".into() }
    }

    #[test]
    fn a_provider_oracle_names_the_model_that_answered_and_says_which_role_failed() {
        let o = ProviderOracle::new(Box::new(Canned), "review").with_max_tokens(REVIEW_TOKENS);
        let (v, model) = o.complete_json("s", "p", &json!({})).unwrap();
        assert_eq!(model, "anthropic/claude-opus-5-5", "the record names what answered, not the role");
        assert_eq!(v["max_tokens"], 4000);
        let req = DecisionRequest { state: "x".into(), instructions: "y".into(), criteria: vec![Criterion::Noul { name: "n".into() }] };
        assert_eq!(o.decide(req).unwrap_err(), "review: answered 500");
    }

    #[test]
    fn a_role_the_agent_already_answers_has_no_fallback_and_no_notice() {
        use super::fake::FakeOracle;
        let agent = FakeOracle::named("agent/claude-acp");
        let f = role(agent.clone(), "agent/claude-acp", || panic!("no second agent for an agent role"), DECISIONS_FALLBACK);
        let req = || DecisionRequest { state: "x".into(), instructions: "y".into(), criteria: vec![] };
        assert_eq!(f.decide(&req).unwrap_err(), "unreachable", "an agent failure is just the error");
        assert!(f.complete_json("s", "p", &json!({})).is_err());
        assert_eq!(f.take_notice(), None, "no false notice");
        assert_eq!(agent.decide_calls.load(Ordering::SeqCst), 1, "asked once, not twice");
        let provider = FakeOracle::named("anthropic/claude-opus-5-5");
        let fallback_agent = FakeOracle::named("agent/claude-acp");
        let f = role(provider.clone(), "anthropic/claude-opus-5-5", || fallback_agent.clone(), DECISIONS_FALLBACK);
        assert!(f.decide(&req).is_err());
        assert_eq!(f.take_notice().as_deref(), Some(DECISIONS_FALLBACK), "a provider falls to the agent, with the notice");
        assert_eq!(fallback_agent.decide_calls.load(Ordering::SeqCst), 1);
    }
}
