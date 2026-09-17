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
//! `design_session_meta` returns only `systemPrompt`. Every design write
//! then reaches `session/request_permission`, and Task 4's layer 1
//! (`design_write_decision`) answers it automatically — allow_once inside
//! the designs folder, reject_once/cancel outside or on a dot entry. The
//! mode lock (`handshake`, ~acp.rs:1020) keeps the session in an ask-first
//! mode so those asks actually happen.
use serde_json::{json, Map, Value};
use std::path::Path;

pub const DESIGN_PROMPT: &str = r#"You are working in Chronicle's Design pane. You make designs as real HTML files that Chronicle shows side by side on a canvas.

Every message starts with a line like `[design: <slug> · .chronicle/designs/<slug>/]`. That names the active design and its folder. Work only on that design.

File contract:
- One self-contained HTML page per frame, in `frames/` inside the design's folder (for example `frames/desktop.html`).
- List every frame in the folder's `design.json` under "frames": {"id", "file", "label", "width", "height", "group"}. "width" is the viewport width the page is designed for; "height" is the first screen (the fold). Keep "v", "title", "kind", "brief" and "created" as they are.
- Put breakpoints in a group of kind "breakpoints" and alternative directions in a group of kind "variations", under "groups": {"id", "label", "kind"}.
- Put images, stylesheets and scripts in `assets/`, and link them with relative paths.
- Fonts are local: download any font you use once into `assets/fonts/` and load it with @font-face from there. Never link a font service.
- Never write outside the active design's folder. Never edit `canvas.json`; Chronicle owns it.

End every turn with one sentence saying what changed."#;

/// The design lane's session `_meta`: only a prompt append. See the module
/// doc comment for why no `claudeCode` permission rules are emitted.
pub fn design_session_meta(_designs_root: &Path) -> Map<String, Value> {
    let mut m = Map::new();
    m.insert("systemPrompt".into(), json!({ "append": DESIGN_PROMPT }));
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
        let m = design_session_meta(std::path::Path::new("/Users/t/p/.chronicle/designs"));
        assert_eq!(m["systemPrompt"]["append"], DESIGN_PROMPT);
        assert!(m["systemPrompt"].get("type").is_none(), "the adapter locks type/preset itself");
        assert!(m.get("claudeCode").is_none(), "no allow rules — every design write must still ask (Task 4 fences it)");
    }

    #[test]
    fn the_prompt_states_the_file_contract() {
        for needle in [".chronicle/designs/", "design.json", "frames/", "assets/fonts/", "[design:", "one sentence"] {
            assert!(DESIGN_PROMPT.contains(needle), "prompt is missing {needle}");
        }
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
