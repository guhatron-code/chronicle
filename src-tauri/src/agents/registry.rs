//! The bundled ACP registry (agentclientprotocol/registry, refreshed at release
//! time by scripts/acp-registry.mjs). Chronicle launches an agent only from the
//! entry at its profile's pinned version: what ships is what was probed.

use super::profiles::AgentProfile;
use serde::Deserialize;
use std::collections::HashMap;

#[derive(Debug, Deserialize)]
pub struct Registry { pub version: String, pub agents: Vec<Entry> }

#[derive(Debug, Deserialize)]
pub struct Entry {
    pub id: String,
    pub name: String,
    pub version: String,
    #[serde(default)]
    pub distribution: Distribution,
}

#[derive(Debug, Default, Deserialize)]
pub struct Distribution {
    pub npx: Option<NpxDist>,
    pub binary: Option<HashMap<String, BinaryTarget>>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct NpxDist { pub package: String, #[serde(default)] pub args: Vec<String> }

#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct BinaryTarget {
    pub archive: String,
    pub cmd: String,
    #[serde(default)]
    pub args: Vec<String>,
    /// Some registry agents we do not offer publish no checksum; those parse as empty
    /// and must never be installed (the four we ship all carry one).
    #[serde(default)]
    pub sha256: String,
}

#[derive(Debug, Clone, PartialEq)]
pub enum LaunchSpec {
    Npx { package: String, args: Vec<String> },
    Binary { version: String, target: BinaryTarget },
}

pub fn parse(text: &str) -> Result<Registry, String> {
    serde_json::from_str(text).map_err(|e| format!("the agent registry didn't parse: {e}"))
}

pub fn bundled() -> &'static Registry {
    static REG: std::sync::OnceLock<Registry> = std::sync::OnceLock::new();
    REG.get_or_init(|| parse(include_str!("../../resources/acp-registry.json")).expect("the bundled registry is valid JSON"))
}

/// The registry's platform token: `darwin-aarch64`, `darwin-x86_64`, `linux-…`.
pub fn platform_key() -> String {
    let os = match std::env::consts::OS { "macos" => "darwin", other => other };
    format!("{os}-{}", std::env::consts::ARCH)
}

pub fn launch_spec_in(reg: &Registry, p: &AgentProfile, platform: &str) -> Option<LaunchSpec> {
    if let Some(e) = reg.agents.iter().find(|e| e.id == p.id && e.version == p.registry_version) {
        if let Some(n) = &e.distribution.npx {
            let args = match p.args_override { Some(a) => a.iter().map(|s| s.to_string()).collect(), None => n.args.clone() };
            return Some(LaunchSpec::Npx { package: n.package.clone(), args });
        }
        return e.distribution.binary.as_ref()?.get(platform)
            .map(|t| LaunchSpec::Binary { version: e.version.clone(), target: t.clone() });
    }
    p.pinned_npx.map(|n| LaunchSpec::Npx { package: n.package.to_string(), args: n.args.iter().map(|s| s.to_string()).collect() })
}

/// The launch for this Mac, or None: not shipped, not pinned in the registry, or no build for this platform.
pub fn launch_spec(p: &AgentProfile) -> Option<LaunchSpec> {
    if !p.shipped { return None; }
    launch_spec_in(bundled(), p, &platform_key())
}

#[cfg(test)]
mod registry_tests {
    use super::*;
    use crate::agents::profiles::{claude, profile, PROFILES};

    #[test]
    fn the_bundled_registry_parses_and_lists_the_four() {
        let reg = bundled();
        for id in ["claude-acp", "codex-acp", "gemini", "opencode"] {
            assert!(reg.agents.iter().any(|e| e.id == id), "{id} is in the bundled registry");
        }
    }

    #[test]
    fn every_shipped_profile_launches_on_both_mac_architectures() {
        for p in PROFILES.iter().filter(|p| p.shipped) {
            for plat in ["darwin-aarch64", "darwin-x86_64"] {
                assert!(launch_spec_in(bundled(), p, plat).is_some(), "{} has a launch on {plat}", p.id);
            }
        }
    }

    #[test]
    fn claude_launches_its_pinned_npx_until_the_pin_moves() {
        // the registry carries 0.90.1-preview.15; the profile ships 0.75.1 until Task 17
        let spec = launch_spec_in(bundled(), claude(), "darwin-aarch64").unwrap();
        assert_eq!(spec, LaunchSpec::Npx { package: "@agentclientprotocol/claude-agent-acp@0.75.1".into(), args: vec![] });
    }

    #[test]
    fn a_newer_registry_entry_is_ignored() {
        let reg = parse(r#"{"version":"x","agents":[{"id":"codex-acp","name":"Codex","version":"9.9.9",
            "distribution":{"npx":{"package":"@agentclientprotocol/codex-acp@9.9.9"}}}]}"#).unwrap();
        assert_eq!(launch_spec_in(&reg, profile("codex-acp").unwrap(), "darwin-aarch64"), None);
    }

    #[test]
    fn a_binary_with_no_entry_for_this_platform_has_no_launch() {
        let oc = profile("opencode").unwrap();
        assert_eq!(launch_spec_in(bundled(), oc, "freebsd-riscv64"), None);
        let linux_only = parse(&format!(r#"{{"version":"x","agents":[{{"id":"opencode","name":"OpenCode","version":"{}",
            "distribution":{{"binary":{{"linux-x86_64":{{"archive":"https://x/o.tar.gz","cmd":"./opencode","args":["acp"],"sha256":"00"}}}}}}}}]}}"#, oc.registry_version)).unwrap();
        assert_eq!(launch_spec_in(&linux_only, oc, "darwin-aarch64"), None);
    }

    #[test]
    fn a_binary_launch_carries_its_checksum_and_args() {
        let oc = profile("opencode").unwrap();
        let Some(LaunchSpec::Binary { version, target }) = launch_spec_in(bundled(), oc, "darwin-aarch64") else { panic!("opencode is a binary") };
        assert_eq!(version, oc.registry_version);
        assert_eq!(target.cmd, "./opencode");
        assert_eq!(target.sha256.len(), 64);
        assert!(target.archive.starts_with("https://"));
    }

    #[test]
    fn the_args_override_drops_the_registry_args() {
        let reg = parse(r#"{"version":"x","agents":[{"id":"claude-acp","name":"Claude","version":"0.75.1",
            "distribution":{"npx":{"package":"@agentclientprotocol/claude-agent-acp@0.75.1","args":["--hide-claude-auth"]}}}]}"#).unwrap();
        assert_eq!(launch_spec_in(&reg, claude(), "darwin-aarch64"),
            Some(LaunchSpec::Npx { package: "@agentclientprotocol/claude-agent-acp@0.75.1".into(), args: vec![] }));
        // without an override the registry's args pass through
        let gem = parse(r#"{"version":"x","agents":[{"id":"gemini","name":"G","version":"0.64.0",
            "distribution":{"npx":{"package":"@google/gemini-cli@0.64.0","args":["--acp"]}}}]}"#).unwrap();
        assert_eq!(launch_spec_in(&gem, profile("gemini").unwrap(), "darwin-aarch64"),
            Some(LaunchSpec::Npx { package: "@google/gemini-cli@0.64.0".into(), args: vec!["--acp".into()] }));
    }

    #[test]
    fn an_unshipped_agent_has_no_launch() {
        assert_eq!(launch_spec(profile("gemini").unwrap()), None);
    }

    #[test]
    fn shipped_binary_targets_carry_a_sha256() {
        for p in PROFILES.iter().filter(|p| p.shipped) {
            let e = bundled().agents.iter().find(|e| e.id == p.id).unwrap();
            for (plat, t) in e.distribution.binary.iter().flatten() {
                assert!(t.sha256.len() == 64 && t.sha256.chars().all(|c| c.is_ascii_hexdigit()), "{} {plat}: sha256 {:?}", p.id, t.sha256);
            }
        }
    }

    #[test]
    fn the_platform_key_is_darwin_on_a_mac() {
        let k = platform_key();
        assert!(k == "darwin-aarch64" || k == "darwin-x86_64", "{k}");
    }
}
