//! The done ledger: `.chronicle/roadmap-ledger.json`. Once a phase derives done,
//! the app records what proved it; a later scan trusts the ledger even when the
//! rule stopped matching. The only project file the roadmap writes on its own.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

pub const FILE: &str = ".chronicle/roadmap-ledger.json";

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Entry {
    pub by: String,    // marker | tag | commit_subject | file_exists | file_matches | file_glob | worktree_branch | user
    pub proof: String, // hash / tag name / path / branch; empty for user
    pub at: u64,       // epoch ms
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct Ledger {
    #[serde(default = "one")]
    pub version: u32,
    #[serde(default)]
    pub done: BTreeMap<String, Entry>,
    /// True when THIS load found a corrupt file and moved it to `.bad`.
    #[serde(skip)]
    pub set_aside: bool,
}
/// The shape this build writes and can read.
pub const VERSION: u32 = 1;
fn one() -> u32 { VERSION }

fn path(dir: &Path) -> PathBuf { dir.join(FILE) }

/// A missing file is an empty ledger. A file that cannot be parsed, or that a
/// newer Chronicle wrote (`version` above ours), is renamed to
/// `roadmap-ledger.json.bad` (never overwritten in place) and reported via
/// `set_aside`: a shape this build does not know is never half-read. A caller that
/// must not write anything uses `load_readonly` instead.
pub fn load(dir: &Path) -> Ledger {
    let l = load_readonly(dir);
    if l.set_aside {
        let p = path(dir);
        let _ = std::fs::rename(&p, p.with_extension("json.bad"));
    }
    l
}

/// The same read with nothing written: a file this build cannot use is reported via
/// `set_aside` and left exactly where it is. Every read-only caller (an agent's state
/// capability, a status export) goes through this, so asking what is done never moves
/// a project file.
pub fn load_readonly(dir: &Path) -> Ledger {
    let text = match std::fs::read_to_string(path(dir)) {
        Ok(t) => t,
        Err(_) => return Ledger { version: 1, ..Default::default() },
    };
    match serde_json::from_str::<Ledger>(&text) {
        Ok(l) if l.version <= VERSION => l,
        _ => Ledger { version: 1, set_aside: true, ..Default::default() },
    }
}

pub fn save(dir: &Path, l: &Ledger) -> Result<(), String> {
    std::fs::create_dir_all(dir.join(".chronicle")).map_err(|e| e.to_string())?;
    let body = serde_json::to_string_pretty(l).map_err(|e| e.to_string())?;
    let p = path(dir);
    let tmp = p.with_extension("json.tmp");
    std::fs::write(&tmp, body).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &p).map_err(|e| e.to_string())
}

/// Serializes every load-mutate-save cycle in this module so a user's mark and a
/// background poll's latch can never race and clobber one another.
static LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn locked<T>(f: impl FnOnce() -> T) -> T {
    let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    f()
}

pub fn mark(dir: &Path, id: &str, by: &str, proof: &str) -> Result<(), String> {
    locked(|| {
        let mut l = load(dir);
        l.done.insert(id.to_string(), Entry { by: by.into(), proof: proof.into(), at: crate::epoch_ms() });
        save(dir, &l)
    })
}

pub fn unmark(dir: &Path, id: &str) -> Result<bool, String> {
    locked(|| {
        let mut l = load(dir);
        let had = l.done.remove(id).is_some();
        if had { save(dir, &l)?; }
        Ok(had)
    })
}

/// Insert every `(id, Entry)` whose id the ledger doesn't already have, under the
/// same lock `mark`/`unmark` take, and save if anything changed. Returns the
/// ledger as saved (or as loaded, if nothing was new) so a caller like `latch`
/// can adopt it instead of trusting its own possibly-stale copy.
pub fn record(dir: &Path, new: Vec<(String, Entry)>) -> Result<Ledger, String> {
    locked(|| {
        let mut l = load(dir);
        let mut changed = false;
        for (id, entry) in new {
            if !l.done.contains_key(&id) {
                l.done.insert(id, entry);
                changed = true;
            }
        }
        if changed { save(dir, &l)?; }
        Ok(l)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("chronicle-ledger-{}-{}", name, std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn a_missing_file_is_an_empty_ledger() {
        let d = tmp("missing");
        let l = load(&d);
        assert!(l.done.is_empty());
        assert!(!l.set_aside);
    }

    #[test]
    fn mark_writes_and_unmark_removes() {
        let d = tmp("mark");
        mark(&d, "SE", "commit_subject", "1d75d57").unwrap();
        let l = load(&d);
        assert_eq!(l.done["SE"].by, "commit_subject");
        assert_eq!(l.done["SE"].proof, "1d75d57");
        assert!(l.done["SE"].at > 0);
        assert!(!d.join(FILE).with_extension("json.tmp").exists(), "atomic: no temp left behind");
        assert!(unmark(&d, "SE").unwrap());
        assert!(!unmark(&d, "SE").unwrap(), "removing twice is a no-op");
        assert!(load(&d).done.is_empty());
    }

    #[test]
    fn mark_overwrites_an_existing_entry() {
        let d = tmp("keep");
        mark(&d, "A", "tag", "v1").unwrap();
        let first = load(&d).done["A"].at;
        mark(&d, "A", "user", "").unwrap();
        let l = load(&d);
        assert_eq!(l.done["A"].by, "user");
        assert!(l.done["A"].at >= first);
    }

    #[test]
    fn a_file_from_a_newer_chronicle_is_set_aside_not_read() {
        let d = tmp("version");
        std::fs::create_dir_all(d.join(".chronicle")).unwrap();
        let body = r#"{"version":2,"done":{"A":{"by":"user","proof":"","at":1}}}"#;
        std::fs::write(d.join(FILE), body).unwrap();
        let l = load(&d);
        assert!(l.done.is_empty(), "a shape this build does not know is never half-read");
        assert!(l.set_aside);
        assert_eq!(std::fs::read_to_string(d.join(FILE).with_extension("json.bad")).unwrap(), body);
        assert!(!d.join(FILE).exists());
        assert!(!load(&d).set_aside, "the next load is clean");
    }

    #[test]
    fn a_read_only_load_reports_a_corrupt_file_without_moving_it() {
        let d = tmp("readonly");
        std::fs::create_dir_all(d.join(".chronicle")).unwrap();
        std::fs::write(d.join(FILE), "{ not json").unwrap();
        let l = load_readonly(&d);
        assert!(l.done.is_empty(), "a shape this build does not know is never half-read");
        assert!(l.set_aside, "the caller still hears the file could not be read");
        assert_eq!(std::fs::read_to_string(d.join(FILE)).unwrap(), "{ not json", "a read never moves a project file");
        assert!(!d.join(FILE).with_extension("json.bad").exists());

        let ok = tmp("readonly-ok");
        mark(&ok, "A", "tag", "v1").unwrap();
        assert_eq!(load_readonly(&ok).done["A"].proof, "v1", "a healthy file reads the same either way");
        assert!(!load_readonly(&ok).set_aside);
    }

    #[test]
    fn a_corrupt_file_is_set_aside_not_wiped() {
        let d = tmp("corrupt");
        std::fs::create_dir_all(d.join(".chronicle")).unwrap();
        std::fs::write(d.join(FILE), "{ not json").unwrap();
        let l = load(&d);
        assert!(l.done.is_empty());
        assert!(l.set_aside);
        assert_eq!(std::fs::read_to_string(d.join(FILE).with_extension("json.bad")).unwrap(), "{ not json");
        assert!(!d.join(FILE).exists());
        // the next load is clean
        assert!(!load(&d).set_aside);
    }
}
