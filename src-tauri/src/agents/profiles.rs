//! Agent profiles — what Chronicle knows about each agent, as data. Launch
//! instructions are NOT here: they come from the bundled ACP registry entry
//! for `id` at `registry_version` (registry.rs). The Codex, Gemini CLI and
//! OpenCode values were recorded by the probe (spec §11, "Probe result").

use serde_json::{json, Value};

/// How a signed-out user signs in (spec §5).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Login {
    /// Type this into a terminal tab; the session restarts when that tab exits.
    Terminal { command: &'static str },
    /// The adapter's own `authenticate` with this method id works headless.
    AuthMethod { id: &'static str },
    /// The agent runs on its own keys and config.
    None,
}

/// The agent's mode id for each of Chronicle's stances (spec §6). `None`: no such mode.
#[derive(Debug, Clone, Copy)]
pub struct Modes {
    pub ask: Option<&'static str>,
    pub execute: Option<&'static str>,
    pub auto: Option<&'static str>,
    pub unattended: Option<&'static str>,
}

/// JSON pointers into a tool call / usage update (spec §7). Relative to the
/// update object; `~1` escapes a `/` inside a key, as RFC 6901 says.
#[derive(Debug, Clone, Copy)]
pub struct MetaKeys {
    pub parent_tool_use: Option<&'static str>,
    pub tool_name: Option<&'static str>,
    /// A boolean the agent sets on a call that IS a subagent.
    pub subagent: Option<&'static str>,
    /// Tool names that are subagents even without the flag.
    pub subagent_tools: &'static [&'static str],
    pub rate_limit: Option<&'static str>,
}

pub const NO_META: MetaKeys = MetaKeys { parent_tool_use: None, tool_name: None, subagent: None, subagent_tools: &[], rate_limit: None };

/// What a session may be given beyond the prompt (spec §8).
#[derive(Debug, Clone, Copy)]
pub struct Extras { pub mcp_servers: bool, pub plugins: bool, pub settings: bool }

/// Where a signed-in agent leaves its login, for the Setup row (probe-recorded).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Credentials { ClaudeKeychain, HomeFile(&'static str), Unknown }

/// An npx package to run while the profile's pin is not in the bundled registry.
#[derive(Debug, Clone, Copy)]
pub struct PinnedNpx { pub package: &'static str, pub args: &'static [&'static str] }

#[derive(Debug)]
pub struct AgentProfile {
    pub id: &'static str,
    pub name: &'static str,
    pub registry_version: &'static str,
    pub pinned_npx: Option<PinnedNpx>,
    /// false: the probe did not pass on this Mac — listed as "not yet supported".
    pub shipped: bool,
    pub login: Login,
    pub modes: Modes,
    pub meta: MetaKeys,
    pub extras: Extras,
    /// The agent's own CLI the adapter needs on this Mac (claude-acp wraps `claude`).
    pub requires_cli: Option<&'static str>,
    /// Env vars blanked on spawn so the agent uses its own login, never a stray key.
    pub blank_env: &'static [&'static str],
    pub credentials: Credentials,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Stance { Ask, Execute, Auto, Unattended }

impl Stance {
    pub const ALL: [Stance; 4] = [Stance::Ask, Stance::Execute, Stance::Auto, Stance::Unattended];
    pub fn parse(s: &str) -> Option<Stance> {
        match s { "ask" => Some(Stance::Ask), "execute" => Some(Stance::Execute), "auto" => Some(Stance::Auto), "unattended" => Some(Stance::Unattended), _ => None }
    }
    pub fn as_str(self) -> &'static str {
        match self { Stance::Ask => "ask", Stance::Execute => "execute", Stance::Auto => "auto", Stance::Unattended => "unattended" }
    }
}

const ALL_EXTRAS: Extras = Extras { mcp_servers: true, plugins: true, settings: true };
const MCP_ONLY: Extras = Extras { mcp_servers: true, plugins: false, settings: false };

pub static PROFILES: [AgentProfile; 4] = [
    AgentProfile {
        id: "claude-acp",
        name: "Claude Code",
        registry_version: "0.75.1",
        pinned_npx: Some(PinnedNpx { package: "@agentclientprotocol/claude-agent-acp@0.75.1", args: &[] }),
        shipped: true,
        login: Login::Terminal { command: "claude /login" },
        modes: Modes { ask: Some("default"), execute: Some("acceptEdits"), auto: Some("auto"), unattended: Some("bypassPermissions") },
        meta: MetaKeys {
            parent_tool_use: Some("/_meta/claudeCode/parentToolUseId"),
            tool_name: Some("/_meta/claudeCode/toolName"),
            subagent: Some("/_meta/claudeCode/subagent"),
            subagent_tools: &["Agent", "Task"],
            rate_limit: Some("/_meta/_claude~1rateLimit"),
        },
        extras: ALL_EXTRAS,
        requires_cli: Some("claude"),
        blank_env: &["ANTHROPIC_API_KEY"],
        credentials: Credentials::ClaudeKeychain,
    },
    AgentProfile {
        id: "codex-acp",
        name: "Codex",
        registry_version: "2.2.3-preview.10",
        pinned_npx: None,
        shipped: true,
        login: Login::Terminal { command: "codex login" },
        modes: Modes { ask: Some("read-only"), execute: None, auto: Some("auto"), unattended: Some("full-access") },
        meta: NO_META,
        extras: MCP_ONLY,
        requires_cli: None,
        blank_env: &[],
        credentials: Credentials::HomeFile(".codex/auth.json"),
    },
    AgentProfile {
        id: "gemini",
        name: "Gemini CLI",
        registry_version: "0.64.0",
        pinned_npx: None,
        shipped: true,
        login: Login::AuthMethod { id: "oauth-personal" },
        modes: Modes { ask: Some("default"), execute: Some("autoEdit"), auto: None, unattended: Some("yolo") },
        meta: NO_META,
        extras: MCP_ONLY,
        requires_cli: None,
        blank_env: &[],
        credentials: Credentials::HomeFile(".gemini/oauth_creds.json"),
    },
    AgentProfile {
        id: "opencode",
        name: "OpenCode",
        registry_version: "1.19.0",
        pinned_npx: None,
        shipped: true,
        login: Login::None,
        modes: Modes { ask: None, execute: None, auto: None, unattended: None },
        meta: NO_META,
        extras: MCP_ONLY,
        requires_cli: None,
        blank_env: &[],
        credentials: Credentials::HomeFile(".local/share/opencode/auth.json"),
    },
];

pub fn profile(id: &str) -> Option<&'static AgentProfile> {
    PROFILES.iter().find(|p| p.id == id)
}

pub fn claude() -> &'static AgentProfile {
    &PROFILES[0]
}

/// A stored agent name (old or new) → the profile id.
pub fn canonical_id(s: &str) -> Option<&'static str> {
    match s {
        "claude" | "claude-acp" => Some("claude-acp"),
        "codex" | "codex-acp" => Some("codex-acp"),
        "gemini" => Some("gemini"),
        "opencode" => Some("opencode"),
        _ => None,
    }
}

fn shipped_by_name(s: Option<&str>) -> Option<&'static AgentProfile> {
    s.and_then(canonical_id).and_then(profile).filter(|p| p.shipped)
}

/// The agent for a project: its own choice, else the default, else Claude Code.
pub fn chosen_in(cfg: &Value, project: Option<&str>) -> &'static AgentProfile {
    let own = project.and_then(|k| cfg.pointer("/project_agents").and_then(|m| m.get(k))).and_then(Value::as_str);
    shipped_by_name(own)
        .or_else(|| shipped_by_name(cfg.get("agent").and_then(Value::as_str)))
        .unwrap_or_else(claude)
}

/// `"claude"` → `"claude-acp"`, `"codex"` → `"codex-acp"` (spec §3). True when it changed something.
pub fn migrate_config(cfg: &mut Value) -> bool {
    let Some(cur) = cfg.get("agent").and_then(Value::as_str).map(String::from) else { return false };
    match canonical_id(&cur) {
        Some(id) if id != cur => { cfg["agent"] = json!(id); true }
        _ => false,
    }
}

pub fn login_json(l: Login) -> Value {
    match l {
        Login::Terminal { command } => json!({ "kind": "terminal", "command": command }),
        Login::AuthMethod { id } => json!({ "kind": "auth_method", "id": id }),
        Login::None => json!({ "kind": "none" }),
    }
}

pub fn mode_for(p: &AgentProfile, s: Stance) -> Option<&'static str> {
    match s { Stance::Ask => p.modes.ask, Stance::Execute => p.modes.execute, Stance::Auto => p.modes.auto, Stance::Unattended => p.modes.unattended }
}

/// `{ "<stance>": "<mode id>" }` for each stance whose mode the session advertised.
pub fn stances(p: &AgentProfile, modes: &Value) -> Value {
    let advertised: Vec<&str> = modes.get("availableModes").and_then(Value::as_array)
        .map(|a| a.iter().filter_map(|m| m.get("id").and_then(Value::as_str)).collect()).unwrap_or_default();
    let mut out = serde_json::Map::new();
    for s in Stance::ALL {
        if let Some(id) = mode_for(p, s).filter(|id| advertised.contains(id)) {
            out.insert(s.as_str().into(), json!(id));
        }
    }
    Value::Object(out)
}

#[cfg(test)]
mod profile_tests {
    use super::*;
    use serde_json::json;

    /// None when the probe fixture has not been recorded yet.
    fn fixture(id: &str) -> Option<Vec<Value>> {
        let p = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(format!("../src/lib/__fixtures__/acp-{id}.raw.jsonl"));
        let text = std::fs::read_to_string(&p).ok()?;
        Some(text.lines().filter(|l| !l.trim().is_empty()).map(|l| serde_json::from_str(l).unwrap()).collect())
    }

    #[test]
    fn ids_are_unique_and_lookup_works() {
        let mut ids: Vec<&str> = PROFILES.iter().map(|p| p.id).collect();
        ids.sort(); ids.dedup();
        assert_eq!(ids.len(), PROFILES.len());
        assert_eq!(claude().id, "claude-acp");
        assert_eq!(profile("gemini").map(|p| p.name), Some("Gemini CLI"));
        assert!(profile("amp-acp").is_none(), "the other registry agents are not offered");
    }

    #[test]
    fn every_profile_is_pinned_to_something_it_can_launch() {
        let reg = crate::agents::registry::bundled();
        for p in PROFILES.iter() {
            let in_registry = reg.agents.iter().any(|e| e.id == p.id && e.version == p.registry_version);
            let pinned = p.pinned_npx.map(|n| n.package.ends_with(&format!("@{}", p.registry_version))).unwrap_or(false);
            assert!(in_registry || pinned, "{}: {} is neither in the bundled registry nor a pinned npx package", p.id, p.registry_version);
        }
    }

    #[test]
    fn profiles_agree_with_the_probe_fixtures() {
        for p in PROFILES.iter().filter(|p| p.shipped) {
            let Some(lines) = fixture(p.id) else { eprintln!("skip {}: no probe fixture recorded yet", p.id); continue };
            let probe = lines.iter().find(|l| l["method"] == "_chronicle/probe").expect("a probe line");
            assert_eq!(probe["params"]["agent"], p.id);
            let ready = lines.iter().find(|l| l["method"] == "_chronicle/session_state" && l["params"]["state"] == "ready").expect("a ready line");
            let ids: Vec<&str> = ready["params"]["modes"]["availableModes"].as_array().map(|a| a.iter().filter_map(|m| m["id"].as_str()).collect()).unwrap_or_default();
            for m in [p.modes.ask, p.modes.execute, p.modes.auto, p.modes.unattended].into_iter().flatten() {
                assert!(ids.contains(&m), "{}: mode {m} is not among the probe's {ids:?}", p.id);
            }
            if !ids.is_empty() { assert!(p.modes.ask.is_some(), "{}: the agent has modes, so Ask first maps to one", p.id); }
            if let Login::AuthMethod { id } = p.login {
                let methods: Vec<&str> = probe["params"]["authMethods"].as_array().map(|a| a.iter().filter_map(|m| m["id"].as_str()).collect()).unwrap_or_default();
                assert!(methods.contains(&id), "{}: auth method {id} is not among {methods:?}", p.id);
            }
        }
    }

    #[test]
    fn legacy_agent_names_migrate_to_ids() {
        let mut cfg = json!({ "agent": "codex", "other": 1 });
        assert!(migrate_config(&mut cfg));
        assert_eq!(cfg, json!({ "agent": "codex-acp", "other": 1 }));
        assert!(!migrate_config(&mut cfg), "a second pass changes nothing");
        let mut c2 = json!({ "agent": "claude" });
        assert!(migrate_config(&mut c2));
        assert_eq!(c2["agent"], "claude-acp");
        let mut empty = json!({});
        assert!(!migrate_config(&mut empty));
    }

    #[test]
    fn the_project_choice_wins_then_the_default_then_claude() {
        let cfg = json!({ "agent": "gemini", "project_agents": { "/p/a": "codex-acp", "/p/bad": "amp-acp" } });
        assert_eq!(chosen_in(&cfg, Some("/p/a")).id, "codex-acp");
        assert_eq!(chosen_in(&cfg, Some("/p/other")).id, "gemini");
        assert_eq!(chosen_in(&cfg, Some("/p/bad")).id, "gemini", "an unknown project choice falls through");
        assert_eq!(chosen_in(&json!({}), None).id, "claude-acp");
        assert_eq!(chosen_in(&json!({ "agent": "codex" }), None).id, "codex-acp", "a legacy name still reads");
    }

    #[test]
    fn login_json_names_the_kind() {
        assert_eq!(login_json(Login::Terminal { command: "codex login" }), json!({ "kind": "terminal", "command": "codex login" }));
        assert_eq!(login_json(Login::AuthMethod { id: "oauth-personal" }), json!({ "kind": "auth_method", "id": "oauth-personal" }));
        assert_eq!(login_json(Login::None), json!({ "kind": "none" }));
    }
}
