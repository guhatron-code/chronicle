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
    /// true: the spec §11 probe ran this agent and the fixture `acp-<id>.raw.jsonl` records it.
    #[allow(dead_code)] // read by the fixture test; the Setup row reads `shipped`
    pub probed: bool,
    /// Replaces the registry entry's npx args when present (claude-acp: never `--hide-claude-auth`,
    /// it refuses claude.ai subscription logins; probed on 0.90.1).
    pub args_override: Option<&'static [&'static str]>,
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
        probed: true,
        args_override: Some(&[]),
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
        probed: true,
        args_override: None,
        login: Login::Terminal { command: "codex login" },
        // `agent` is the agent's default and stays unmapped (controller ruling R6).
        modes: Modes { ask: Some("read-only"), execute: Some("workspace-write"), auto: None, unattended: Some("agent-full-access") },
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
        // Deferred probe: session/new needed a key. Values below are unverified, so not shipped.
        shipped: false,
        probed: false,
        args_override: None,
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
        probed: true,
        args_override: None,
        login: Login::AuthMethod { id: "opencode-login" },
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

    fn fixture_path(id: &str) -> std::path::PathBuf {
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(format!("../src/lib/__fixtures__/acp-{id}.raw.jsonl"))
    }

    fn fixture(id: &str) -> Vec<Value> {
        let p = fixture_path(id);
        std::fs::read_to_string(&p).unwrap_or_else(|e| panic!("{}: {e}", p.display()))
            .lines().filter(|l| !l.trim().is_empty()).map(|l| serde_json::from_str(l).unwrap()).collect()
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
        use crate::agents::registry::{bundled, launch_spec_in, LaunchSpec};
        let reg = bundled();
        for p in PROFILES.iter() {
            assert_eq!(reg.agents.iter().filter(|e| e.id == p.id).count(), 1, "{}: exactly one registry entry", p.id);
            let at_pin = reg.agents.iter().filter(|e| e.id == p.id && e.version == p.registry_version).count();
            if p.id == "claude-acp" {
                let n = p.pinned_npx.expect("claude-acp runs its pinned npx");
                assert!(n.package.ends_with(&format!("@{}", p.registry_version)));
                assert_eq!(at_pin, 0, "the registry carries a newer claude-acp; the pin is not in it");
            } else {
                assert!(p.pinned_npx.is_none(), "{}: only claude-acp pins an npx package", p.id);
                assert_eq!(at_pin, 1, "{}: the bundled registry has {} exactly once", p.id, p.registry_version);
            }
        }
        for p in PROFILES.iter().filter(|p| p.shipped) {
            let spec = launch_spec_in(reg, p, "darwin-aarch64").unwrap_or_else(|| panic!("{} launches", p.id));
            match (p.id, spec) {
                ("claude-acp", LaunchSpec::Npx { package, args }) => {
                    assert_eq!(package, "@agentclientprotocol/claude-agent-acp@0.75.1");
                    assert!(args.is_empty());
                }
                ("codex-acp", LaunchSpec::Npx { package, args }) => {
                    assert_eq!(package, "@agentclientprotocol/codex-acp@2.2.3-preview.10");
                    assert!(args.is_empty());
                }
                ("opencode", LaunchSpec::Binary { version, target }) => {
                    assert_eq!(version, "1.19.0");
                    assert_eq!(target.cmd, "./opencode");
                    assert_eq!(target.args, vec!["acp".to_string()]);
                }
                (id, other) => panic!("{id}: unexpected launch {other:?}"),
            }
        }
    }

    #[test]
    fn profiles_agree_with_the_probe_fixtures() {
        for p in PROFILES.iter() {
            if !p.probed {
                assert!(!fixture_path(p.id).exists(), "{}: a probe fixture exists, so flip `probed` to true and verify the profile", p.id);
                assert!(!p.shipped, "{}: an unprobed agent is not shipped", p.id);
                continue;
            }
            let lines = fixture(p.id);
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
    fn claude_meta_pointers_resolve_on_the_fixture() {
        // The recorded Claude turn carries toolName on a tool_call and `_claude/rateLimit` on a
        // usage_update. parentToolUseId is NOT in the fixture (the probe prompt used no subagent);
        // it stays unverified here and is covered by the agent-fanout replay fixture in TypeScript.
        let m = claude().meta;
        let updates: Vec<Value> = fixture("claude-acp").iter().filter(|l| l["method"] == "session/update").map(|l| l["params"]["update"].clone()).collect();
        assert!(updates.iter().any(|u| u.pointer(m.tool_name.unwrap()).and_then(Value::as_str) == Some("Bash")), "toolName resolves");
        assert!(updates.iter().any(|u| u.pointer(m.rate_limit.unwrap()).map(|v| v["status"] == "allowed").unwrap_or(false)), "rate limit resolves through the ~1 escape");
    }

    #[test]
    fn canonical_id_rejects_what_it_does_not_ship() {
        assert_eq!(canonical_id("amp-acp"), None);
        assert_eq!(canonical_id(""), None);
        assert_eq!(canonical_id("Claude"), None);
    }

    #[test]
    fn stances_are_the_advertised_modes_only() {
        let modes = json!({ "currentModeId": "default", "availableModes": [ { "id": "default" }, { "id": "acceptEdits" }, { "id": "plan" } ] });
        assert_eq!(stances(claude(), &modes), json!({ "ask": "default", "execute": "acceptEdits" }), "no auto or bypass when the session didn't offer them");
        assert_eq!(mode_for(claude(), Stance::Unattended), Some("bypassPermissions"));
        assert_eq!(Stance::parse("unattended"), Some(Stance::Unattended));
        assert_eq!(Stance::parse("plan"), None);
    }

    #[test]
    fn an_agent_with_no_modes_offers_no_stances() {
        assert_eq!(stances(claude(), &Value::Null), json!({}));
        assert_eq!(stances(claude(), &json!({ "availableModes": [] })), json!({}));
        let none = profile("opencode").unwrap();
        if none.modes.ask.is_none() { assert_eq!(stances(none, &json!({ "availableModes": [ { "id": "build" } ] })), json!({})); }
    }

    #[test]
    fn the_stance_maps_follow_the_probe() {
        let codex = profile("codex-acp").unwrap();
        assert_eq!(mode_for(codex, Stance::Ask), Some("read-only"));
        assert_eq!(mode_for(codex, Stance::Execute), Some("workspace-write"));
        assert_eq!(mode_for(codex, Stance::Auto), None);
        assert_eq!(mode_for(codex, Stance::Unattended), Some("agent-full-access"));
        let oc = profile("opencode").unwrap();
        assert!(Stance::ALL.iter().all(|s| mode_for(oc, *s).is_none()), "opencode advertises no modes");
        assert!(!profile("gemini").unwrap().probed);
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
        let cfg = json!({ "agent": "opencode", "project_agents": { "/p/a": "codex-acp", "/p/bad": "amp-acp" } });
        assert_eq!(chosen_in(&cfg, Some("/p/a")).id, "codex-acp");
        assert_eq!(chosen_in(&cfg, Some("/p/other")).id, "opencode");
        assert_eq!(chosen_in(&cfg, Some("/p/bad")).id, "opencode", "an unknown project choice falls through");
        assert_eq!(chosen_in(&json!({}), None).id, "claude-acp");
        assert_eq!(chosen_in(&json!({ "agent": "codex" }), None).id, "codex-acp", "a legacy name still reads");
        assert_eq!(chosen_in(&json!({ "agent": "gemini" }), None).id, "claude-acp", "an unshipped agent falls through");
    }

    #[test]
    fn a_project_choice_beats_the_default_which_beats_claude() {
        let cfg = json!({ "agent": "codex-acp", "project_agents": { "/p/one": "opencode" } });
        assert_eq!(chosen_in(&cfg, Some("/p/one")).id, "opencode");
        assert_eq!(chosen_in(&cfg, Some("/p/two")).id, "codex-acp");
        assert_eq!(chosen_in(&json!({}), Some("/p/two")).id, "claude-acp");
    }

    #[test]
    fn login_json_names_the_kind() {
        assert_eq!(login_json(Login::Terminal { command: "codex login" }), json!({ "kind": "terminal", "command": "codex login" }));
        assert_eq!(login_json(Login::AuthMethod { id: "oauth-personal" }), json!({ "kind": "auth_method", "id": "oauth-personal" }));
        assert_eq!(login_json(Login::None), json!({ "kind": "none" }));
    }
}
