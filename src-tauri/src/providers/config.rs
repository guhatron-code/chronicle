//! Which provider answers each role (spec §9), read from config.json, with
//! keys from the Keychain. A role whose key or address is missing is the agent.
use super::agent::AgentCalls;
use super::http::{local_url, AnthropicCalls, ChatCompatCalls, OpenAICalls, Transport, TypeSafeCalls, OPENROUTER_URL};
use super::keys::Secrets;
use super::{Calls, Provider};
use serde_json::{json, Value};
use std::sync::Arc;

pub const KEY_PROVIDERS: [(&str, &str); 4] = [("anthropic", "Anthropic"), ("openai", "OpenAI"), ("openrouter", "OpenRouter"), ("typesafe", "TypeSafe")];

const DEFAULT_MODELS: [(&str, &str); 5] = [
    ("anthropic", "claude-opus-5-5"),
    ("openai", "gpt-5"),
    ("openrouter", "openai/gpt-5"),
    ("typesafe", "jev-1.13.0"),
    ("local", "llama3.1"),
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Role { Review, Decisions }

impl Role {
    pub fn parse(s: &str) -> Option<Role> { match s { "review" => Some(Role::Review), "decisions" => Some(Role::Decisions), _ => None } }
    pub fn as_str(self) -> &'static str { match self { Role::Review => "review", Role::Decisions => "decisions" } }
}

fn name_of(id: &str) -> &'static str {
    KEY_PROVIDERS.iter().find(|(p, _)| *p == id).map(|(_, n)| *n).unwrap_or("Local")
}

pub fn model_for(cfg: &Value, id: &str) -> String {
    cfg.pointer(&format!("/providers/models/{id}")).and_then(Value::as_str).map(String::from)
        .unwrap_or_else(|| DEFAULT_MODELS.iter().find(|(p, _)| *p == id).map(|(_, m)| m.to_string()).unwrap_or_default())
}

pub fn role_choice(cfg: &Value, role: Role) -> String {
    cfg.pointer(&format!("/providers/{}", role.as_str())).and_then(Value::as_str).unwrap_or("agent").to_string()
}

fn local_base(cfg: &Value) -> Option<String> {
    cfg.pointer("/providers/local_base_url").and_then(Value::as_str).filter(|s| !s.is_empty()).map(String::from)
}

fn allowed(role: Role, id: &str) -> bool { !(role == Role::Review && id == "typesafe") }

/// The provider that will actually answer: the chosen one when its key or address is there, else the agent.
pub fn resolve(cfg: &Value, role: Role, secrets: &dyn Secrets) -> Provider {
    let id = role_choice(cfg, role);
    if !allowed(role, &id) { return Provider::Agent; }
    let p = match id.as_str() {
        "anthropic" => secrets.get("anthropic").map(|key| Provider::Anthropic { key }),
        "openai" => secrets.get("openai").map(|key| Provider::OpenAI { key }),
        "openrouter" => secrets.get("openrouter").map(|key| Provider::OpenRouter { key }),
        "typesafe" => secrets.get("typesafe").map(|key| Provider::TypeSafe { key }),
        "local" => local_base(cfg).map(|base_url| Provider::Local { base_url }),
        _ => None,
    };
    p.unwrap_or(Provider::Agent)
}

/// `resolve` without reading a secret: what the Setup row shows as the role's provider.
pub fn effective_choice(cfg: &Value, role: Role, secrets: &dyn Secrets) -> String {
    let id = role_choice(cfg, role);
    let ok = allowed(role, &id) && match id.as_str() {
        "local" => local_base(cfg).is_some(),
        "agent" => true,
        other => KEY_PROVIDERS.iter().any(|(p, _)| *p == other) && secrets.has(other),
    };
    if ok { id } else { "agent".into() }
}

fn providers_obj(cfg: &mut Value) -> &mut serde_json::Map<String, Value> {
    if !cfg.is_object() { *cfg = json!({}); }
    if !cfg.get("providers").map(Value::is_object).unwrap_or(false) { cfg["providers"] = json!({}); }
    cfg["providers"].as_object_mut().expect("just made an object")
}

pub fn set_role(cfg: &mut Value, role: Role, id: &str, secrets: &dyn Secrets) -> Result<(), String> {
    match id {
        "agent" => {}
        "local" => { if local_base(cfg).is_none() { return Err("add the local server's address first".into()); } }
        k if KEY_PROVIDERS.iter().any(|(p, _)| *p == k) => {
            if !allowed(role, k) { return Err("TypeSafe answers decisions only".into()); }
            if !secrets.has(k) { return Err(format!("add your {} key first", name_of(k))); }
        }
        other => return Err(format!("there's no provider called {other}")),
    }
    providers_obj(cfg).insert(role.as_str().into(), json!(id));
    Ok(())
}

/// Remove a key from the store, then (only if that worked) put its roles back on the agent.
/// A failed removal leaves the roles alone: the key is still there.
pub fn remove_key(cfg: &mut Value, id: &str, secrets: &dyn Secrets) -> Result<bool, String> {
    secrets.remove(id)?;
    Ok(forget_key(cfg, id))
}

/// A key (or the local address) went away: every role that used it is the agent again.
pub fn forget_key(cfg: &mut Value, id: &str) -> bool {
    let mut changed = false;
    for role in [Role::Review, Role::Decisions] {
        if role_choice(cfg, role) == id {
            providers_obj(cfg).insert(role.as_str().into(), json!("agent"));
            changed = true;
        }
    }
    changed
}

pub fn set_local(cfg: &mut Value, base: Option<&str>) -> Result<(), String> {
    match base.map(str::trim).filter(|s| !s.is_empty()) {
        Some(b) if b.split('/').nth(2).map(|h| h.contains('@')).unwrap_or(false) && (b.starts_with("http://") || b.starts_with("https://")) =>
            Err("leave the user name and password out of the address; a local server doesn't need them here".into()),
        Some(b) if b.starts_with("http://") || b.starts_with("https://") => { providers_obj(cfg).insert("local_base_url".into(), json!(b)); Ok(()) }
        Some(_) => Err("the address starts with http:// — for example http://localhost:11434".into()),
        None => { providers_obj(cfg).remove("local_base_url"); forget_key(cfg, "local"); Ok(()) }
    }
}

pub fn calls_for(p: &Provider, cfg: &Value, t: Arc<dyn Transport>, agent: AgentCalls) -> Box<dyn Calls + Send + Sync> {
    match p {
        Provider::Agent => Box::new(agent),
        Provider::Anthropic { key } => Box::new(AnthropicCalls { key: key.clone(), model: model_for(cfg, "anthropic"), t }),
        Provider::OpenAI { key } => Box::new(OpenAICalls { key: key.clone(), model: model_for(cfg, "openai"), t }),
        Provider::OpenRouter { key } => Box::new(ChatCompatCalls { url: OPENROUTER_URL.into(), key: Some(key.clone()), model: model_for(cfg, "openrouter"), label: "openrouter", t }),
        Provider::TypeSafe { key } => Box::new(TypeSafeCalls { key: key.clone(), model: model_for(cfg, "typesafe"), t }),
        Provider::Local { base_url } => Box::new(ChatCompatCalls { url: local_url(base_url), key: None, model: model_for(cfg, "local"), label: "local", t }),
    }
}

/// What the Providers rows show. Says whether a key is saved — never the key. `agent` is the
/// project's agent: when it has no Ask mode it can't answer either role read-only, and the
/// group says so in place of "sends nothing new".
pub fn status(cfg: &Value, secrets: &dyn Secrets, agent: &crate::agents::AgentProfile) -> Value {
    let mut rows: Vec<Value> = KEY_PROVIDERS.iter().map(|(id, name)| json!({ "id": id, "name": name, "saved": secrets.has(id) })).collect();
    rows.push(json!({ "id": "local", "name": "Local", "saved": local_base(cfg).is_some(), "address": local_base(cfg) }));
    json!({
        "roles": { "review": effective_choice(cfg, Role::Review, secrets), "decisions": effective_choice(cfg, Role::Decisions, secrets) },
        "providers": rows,
        "agent": {
            "id": agent.id,
            "name": agent.name,
            "refusal": crate::acp::reviewer_refusal(agent).map(|_| json!({
                "review": format!("{} can't review without changing files — choose a provider for Review.", agent.name),
                "decisions": format!("{} can't answer decisions without changing files — choose a provider for Decisions.", agent.name),
            })),
        },
    })
}

#[cfg(test)]
mod config_tests {
    use super::*;
    use crate::providers::keys::{FakeSecrets, Secrets};
    use serde_json::json;

    #[test]
    fn both_roles_default_to_the_agent() {
        let cfg = json!({});
        let s = FakeSecrets::new();
        assert_eq!(role_choice(&cfg, Role::Review), "agent");
        assert_eq!(resolve(&cfg, Role::Decisions, &s).id(), "agent");
    }

    #[test]
    fn a_role_needs_its_key_first_and_typesafe_never_reviews() {
        let mut cfg = json!({});
        let s = FakeSecrets::new();
        assert!(set_role(&mut cfg, Role::Review, "anthropic", &s).unwrap_err().contains("Anthropic key"));
        s.set("anthropic", "sk-1").unwrap();
        set_role(&mut cfg, Role::Review, "anthropic", &s).unwrap();
        assert_eq!(cfg["providers"]["review"], "anthropic");
        assert!(matches!(resolve(&cfg, Role::Review, &s), crate::providers::Provider::Anthropic { key } if key == "sk-1"));
        s.set("typesafe", "ts-1").unwrap();
        assert!(set_role(&mut cfg, Role::Review, "typesafe", &s).unwrap_err().contains("decisions only"));
        set_role(&mut cfg, Role::Decisions, "typesafe", &s).unwrap();
        assert_eq!(resolve(&cfg, Role::Decisions, &s).id(), "typesafe");
        assert!(set_role(&mut cfg, Role::Review, "gemini", &s).is_err());
    }

    #[test]
    fn removing_a_key_falls_its_roles_back_to_the_agent() {
        let mut cfg = json!({ "providers": { "review": "openai", "decisions": "openai" } });
        assert!(forget_key(&mut cfg, "openai"));
        assert_eq!(cfg["providers"], json!({ "review": "agent", "decisions": "agent" }));
        assert!(!forget_key(&mut cfg, "openai"));
    }

    #[test]
    fn a_key_gone_from_the_keychain_reads_as_the_agent() {
        let cfg = json!({ "providers": { "decisions": "openrouter" } });
        let s = FakeSecrets::new();
        assert_eq!(resolve(&cfg, Role::Decisions, &s).id(), "agent");
        assert_eq!(effective_choice(&cfg, Role::Decisions, &s), "agent");
    }

    #[test]
    fn a_local_server_needs_an_http_address() {
        let mut cfg = json!({});
        let s = FakeSecrets::new();
        assert!(set_role(&mut cfg, Role::Decisions, "local", &s).is_err());
        assert!(set_local(&mut cfg, Some("localhost:11434")).is_err());
        set_local(&mut cfg, Some("http://localhost:11434")).unwrap();
        set_role(&mut cfg, Role::Decisions, "local", &s).unwrap();
        assert!(matches!(resolve(&cfg, Role::Decisions, &s), crate::providers::Provider::Local { base_url } if base_url == "http://localhost:11434"));
        set_local(&mut cfg, None).unwrap();
        assert_eq!(role_choice(&cfg, Role::Decisions), "agent", "clearing the address falls the role back");
    }

    #[test]
    fn a_failed_removal_leaves_the_roles_alone() {
        struct Stuck;
        impl Secrets for Stuck {
            fn get(&self, _: &str) -> Option<String> { Some("k".into()) }
            fn set(&self, _: &str, _: &str) -> Result<(), String> { Ok(()) }
            fn remove(&self, _: &str) -> Result<(), String> { Err("denied".into()) }
        }
        let mut cfg = json!({ "providers": { "review": "openai" } });
        assert!(remove_key(&mut cfg, "openai", &Stuck).is_err());
        assert_eq!(cfg["providers"]["review"], "openai");
        let f = FakeSecrets::new();
        f.set("openai", "k").unwrap();
        assert_eq!(remove_key(&mut cfg, "openai", &f), Ok(true));
        assert_eq!(cfg["providers"]["review"], "agent");
    }

    #[test]
    fn a_local_address_with_a_password_is_refused() {
        let mut cfg = json!({});
        assert!(set_local(&mut cfg, Some("http://me:pw@localhost:1234")).unwrap_err().contains("password"));
    }

    #[test]
    fn models_default_and_override() {
        assert_eq!(model_for(&json!({}), "anthropic"), "claude-opus-5-5");
        assert_eq!(model_for(&json!({ "providers": { "models": { "anthropic": "claude-sonnet-5-5" } } }), "anthropic"), "claude-sonnet-5-5");
    }

    #[test]
    fn the_status_lists_five_providers_and_never_a_key() {
        let s = FakeSecrets::new();
        s.set("openrouter", "or-secret").unwrap();
        let st = status(&json!({ "providers": { "local_base_url": "http://localhost:1234" } }), &s, crate::agents::claude());
        let ids: Vec<&str> = st["providers"].as_array().unwrap().iter().map(|p| p["id"].as_str().unwrap()).collect();
        assert_eq!(ids, ["anthropic", "openai", "openrouter", "typesafe", "local"]);
        assert_eq!(st["providers"][2]["saved"], true);
        assert_eq!(st["providers"][4]["address"], "http://localhost:1234");
        assert!(!st.to_string().contains("or-secret"), "a key never leaves Rust");
        assert_eq!(st["roles"], json!({ "review": "agent", "decisions": "agent" }));
        assert_eq!(st["agent"], json!({ "id": "claude-acp", "name": "Claude Code", "refusal": null }));
    }

    #[test]
    fn the_status_says_an_agent_with_no_ask_mode_cant_review() {
        let st = status(&json!({}), &FakeSecrets::new(), crate::agents::profile("opencode").unwrap());
        assert_eq!(st["agent"]["refusal"]["review"], "OpenCode can't review without changing files — choose a provider for Review.");
        assert_eq!(st["agent"]["refusal"]["decisions"], "OpenCode can't answer decisions without changing files — choose a provider for Decisions.");
        let codex = status(&json!({}), &FakeSecrets::new(), crate::agents::profile("codex-acp").unwrap());
        assert_eq!(codex["agent"]["refusal"], Value::Null, "Codex reviews in its read-only mode");
    }

    /// Live: one decision from every provider that has a key saved on this Mac.
    /// CHRONICLE_PROVIDER_LIVE=1 cargo test live_providers -- --ignored --nocapture
    #[test]
    #[ignore]
    fn live_providers_answer_one_decision() {
        if std::env::var("CHRONICLE_PROVIDER_LIVE").ok().as_deref() != Some("1") { eprintln!("skipped"); return; }
        let keys = crate::providers::keys::Keychain;
        let t: std::sync::Arc<dyn crate::providers::http::Transport> = std::sync::Arc::new(crate::providers::http::CurlTransport);
        let req = crate::providers::DecisionRequest {
            state: "git status".into(),
            instructions: "Does this shell command change any file?".into(),
            criteria: vec![crate::providers::Criterion::Noul { name: "writes".into() }, crate::providers::Criterion::Choice { name: "action".into(), options: vec!["allow".into(), "refuse".into()] }],
        };
        for (id, _) in KEY_PROVIDERS {
            let Some(key) = keys.get(id) else { eprintln!("{id}: no key saved"); continue };
            let p = match id { "anthropic" => crate::providers::Provider::Anthropic { key }, "openai" => crate::providers::Provider::OpenAI { key }, "openrouter" => crate::providers::Provider::OpenRouter { key }, _ => crate::providers::Provider::TypeSafe { key } };
            let agent = crate::providers::agent::AgentCalls::for_project(crate::agents::claude(), std::env::temp_dir(), std::env::temp_dir());
            let c = calls_for(&p, &json!({}), t.clone(), agent);
            match c.decide(&req) { Ok(d) => eprintln!("{id}: {} {:?}", d.model, d.answers), Err(e) => eprintln!("{id}: FAILED {e}") }
        }
    }
}
