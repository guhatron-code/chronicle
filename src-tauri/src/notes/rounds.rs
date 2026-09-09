//! `.chronicle/rounds.json` — the rounds that used to live inside kanban.json,
//! and the editor lock a live round puts on its notes. Filled in by Task 5.
use std::path::Path;

/// True while the note's round is `generating` or `ready` — the editor refuses
/// to write, the agent's own edits are untouched.
pub fn is_locked(_dir: &Path, _rel: &str) -> bool { false }
