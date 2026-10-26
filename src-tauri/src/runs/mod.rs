//! Runs: a plan executed as lanes (docs/superpowers/specs/2026-10-14-agent-orchestrator-design.md).
//! Policy lives here, in Rust; the record in `.chronicle/runs/<n>.json` has one writer.
pub mod record;
pub mod checks;
pub mod lane_map;
pub mod fence;
pub mod gate;
pub mod oracle;
pub mod judge;
pub mod review;
pub mod scheduler;
pub mod prompts;
pub mod runner;
pub mod tools;
pub mod host;
pub mod commands;

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

/// The live runs, and how a record reaches the frontend (`run-update`).
pub struct Runs {
    ctls: Mutex<HashMap<(PathBuf, u64), Arc<runner::RunCtl>>>,
    emit: Mutex<Option<runner::Publish>>,
    /// runs whose planner prompt went to the chat lane in this app session —
    /// a planning run from before a restart is nobody's, so it reads as interrupted
    planning: Mutex<HashSet<(PathBuf, u64)>>,
}

impl Runs {
    pub fn new() -> Self { Runs { ctls: Mutex::new(HashMap::new()), emit: Mutex::new(None), planning: Mutex::new(HashSet::new()) } }
    pub fn set_emit(&self, f: runner::Publish) { if let Ok(mut g) = self.emit.lock() { *g = Some(f); } }
    pub fn publish(&self, dir: &Path, rec: &record::RunRecord) {
        if let Some(f) = self.emit.lock().ok().and_then(|g| g.clone()) { f(dir, rec); }
    }
    /// What a controller publishes through (the emitter set at app start).
    pub fn publisher(&self) -> runner::Publish {
        let f = self.emit.lock().ok().and_then(|g| g.clone());
        Arc::new(move |d: &Path, r: &record::RunRecord| if let Some(f) = &f { f(d, r) })
    }
    pub fn insert(&self, ctl: Arc<runner::RunCtl>) {
        if let Ok(mut g) = self.ctls.lock() {
            g.retain(|_, c| !c.snapshot().state.terminal());
            g.insert((ctl.dir.clone(), ctl.n), ctl);
        }
    }
    pub fn planning(&self, dir: &Path, n: u64) {
        if let Ok(mut g) = self.planning.lock() { g.insert((dir.to_path_buf(), n)); }
    }
    pub fn is_planning(&self, dir: &Path, n: u64) -> bool {
        self.planning.lock().map(|g| g.contains(&(dir.to_path_buf(), n))).unwrap_or(false)
    }
    pub fn get(&self, dir: &Path, n: u64) -> Option<Arc<runner::RunCtl>> {
        self.ctls.lock().ok()?.get(&(dir.to_path_buf(), n)).cloned()
    }
}
