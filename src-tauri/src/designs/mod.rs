//! The Design pane's folder: `.chronicle/designs/` in the project (or the main
//! checkout when the project is a linked worktree). Filled in by later tasks.
use std::path::{Path, PathBuf};

pub fn designs_root(project: &Path) -> PathBuf {
    crate::notes::index::vault_root(project).join(".chronicle/designs")
}
