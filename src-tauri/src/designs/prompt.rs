//! The design lane's basic system prompt (sub-project 1) and its session `_meta`.
//! Sub-project 2 replaces the persona paragraph; the file contract stays.
//!
//! Ruling (verified against adapter 0.75.1): `_meta.claudeCode.options` is
//! spread into the SDK options, so a `settings.permissions.allow` rule there
//! would make Claude Code auto-allow writes WITHOUT ever calling
//! `canUseTool` — and a rule broad enough to cover the designs root also
//! covers its dot entries (`.threads/**`), because `*` matches dot names in
//! Claude Code's gitignore-style matcher. That would let the agent write
//! `.chronicle/designs/.threads/…` (the design session's own records)
//! without Chronicle ever being asked, breaking the Task 4 guarantee that
//! every design write is fenced. So no allow rules are emitted here at all:
//! `design_session_meta` returns `systemPrompt` and, at most, a local plugin
//! under `claudeCode.options.plugins` — never `settings`. Every design write
//! then reaches `session/request_permission`, and Task 4's layer 1
//! (`design_write_decision`) answers it automatically — allow_once inside
//! the designs folder, reject_once/cancel outside or on a dot entry. The
//! mode lock (`handshake`, ~acp.rs:1056) keeps the session in an ask-first
//! mode so those asks actually happen.
use serde_json::{json, Map, Value};
use std::path::Path;

pub const DESIGN_PROMPT: &str = include_str!("../../resources/design/DIRECTOR.md");

/// The project-context files at the repo root, in reading order.
pub fn context_files(repo: &Path) -> Vec<String> {
    ["PRODUCT.md", "DESIGN.md"].iter().filter(|n| repo.join(n).is_file()).map(|n| n.to_string()).collect()
}

/// The design lane's session `_meta`: a prompt append and, when given, a
/// local plugin under `claudeCode.options.plugins` — the ONLY option set
/// there. See the module doc comment for why no permission rules are emitted.
pub fn design_session_meta(_designs_root: &Path, plugin_dir: Option<&Path>) -> Map<String, Value> {
    let mut m = Map::new();
    m.insert("systemPrompt".into(), json!({ "append": DESIGN_PROMPT }));
    if let Some(p) = plugin_dir {
        m.insert("claudeCode".into(), json!({ "options": { "plugins": [ { "type": "local", "path": p.to_string_lossy() } ] } }));
    }
    m
}

pub const DESIGN_IDLE: std::time::Duration = std::time::Duration::from_secs(15 * 60);

/// Due exactly when no turn is running and the limit has elapsed since the
/// last activity stamp (a prompt sent, or a turn ending).
pub fn idle_due(
    last: std::time::Instant,
    now: std::time::Instant,
    turn_active: bool,
    limit: std::time::Duration,
) -> bool {
    !turn_active && now.saturating_duration_since(last) >= limit
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn meta_appends_the_prompt_and_carries_no_permission_rules() {
        let m = design_session_meta(std::path::Path::new("/Users/t/p/.chronicle/designs"), None);
        assert_eq!(m["systemPrompt"]["append"], DESIGN_PROMPT);
        assert!(m["systemPrompt"].get("type").is_none(), "the adapter locks type/preset itself");
        assert!(m.get("claudeCode").is_none(), "no allow rules — every design write must still ask (Task 4 fences it)");
    }

    #[test]
    fn meta_carries_the_plugin_and_still_no_permission_rules() {
        let m = design_session_meta(Path::new("/p/.chronicle/designs"), Some(Path::new("/app/Resources/design-plugin")));
        assert_eq!(m["systemPrompt"]["append"], DESIGN_PROMPT);
        assert_eq!(m["claudeCode"]["options"]["plugins"], json!([{ "type": "local", "path": "/app/Resources/design-plugin" }]));
        assert_eq!(m["claudeCode"]["options"].as_object().unwrap().len(), 1, "plugins is the only option");
        let none = design_session_meta(Path::new("/p/.chronicle/designs"), None);
        assert!(none.get("claudeCode").is_none());
    }

    #[test]
    fn the_prompt_states_the_file_contract() {
        for needle in ["as an absolute path", "design.json", "frames/", "assets/fonts/", "[design:", "one sentence"] {
            assert!(DESIGN_PROMPT.contains(needle), "prompt is missing {needle}");
        }
    }

    #[test]
    fn the_director_prompt_keeps_the_file_contract_and_names_its_new_files() {
        for must in ["frames/", "design.json", "assets/fonts/", "Never write outside", "questions.json", "tokens.json", "critique/round-", "Never run a critique yourself", "one sentence"] {
            assert!(DESIGN_PROMPT.contains(must), "missing: {must}");
        }
        assert!(!DESIGN_PROMPT.contains("context.mjs"));
        assert!(DESIGN_PROMPT.len() < 12_000, "the append stays short enough to sit beside Claude Code's own prompt");
    }

    #[test]
    fn context_files_lists_only_what_exists() {
        let d = std::env::temp_dir().join(format!("chronicle-ctx-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        assert!(context_files(&d).is_empty());
        std::fs::write(d.join("DESIGN.md"), "x").unwrap();
        std::fs::write(d.join("PRODUCT.md"), "x").unwrap();
        assert_eq!(context_files(&d), vec!["PRODUCT.md", "DESIGN.md"]);
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn idle_is_due_only_after_the_limit_and_never_mid_turn() {
        let t0 = std::time::Instant::now();
        let lim = std::time::Duration::from_secs(900);
        assert!(!idle_due(t0, t0 + std::time::Duration::from_secs(899), false, lim));
        assert!(idle_due(t0, t0 + std::time::Duration::from_secs(900), false, lim));
        assert!(!idle_due(t0, t0 + std::time::Duration::from_secs(5000), true, lim));
    }
}
