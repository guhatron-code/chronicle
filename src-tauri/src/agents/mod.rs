//! The agents Chronicle can drive through ACP (spec 2026-10-15 §3-§8): one
//! profile per agent, launched from the bundled registry at a pinned version.
pub mod normalize;
pub mod profiles;
pub mod registry;

#[allow(unused_imports)]
pub use profiles::{claude, profile, AgentProfile, PROFILES};

/// The agent this project runs on: the project's own choice, else the default, else Claude Code —
/// the same rule as `profiles::chosen_in`, keyed by the project's canonical path (what `canon_key` stores).
pub fn project_profile(project_dir: &std::path::Path) -> &'static AgentProfile {
    let canon = std::fs::canonicalize(project_dir).unwrap_or_else(|_| project_dir.to_path_buf());
    profiles::chosen_in(&crate::load_config(), Some(&canon.to_string_lossy()))
}
