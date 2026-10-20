//! The agents Chronicle can drive through ACP (spec 2026-10-15 §3-§8): one
//! profile per agent, launched from the bundled registry at a pinned version.
pub mod profiles;
pub mod registry;

pub use profiles::{claude, profile, AgentProfile, PROFILES};
