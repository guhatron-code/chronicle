//! Runs: a plan executed as lanes (docs/superpowers/specs/2026-10-14-agent-orchestrator-design.md).
//! Policy lives here, in Rust; the record in `.chronicle/runs/<n>.json` has one writer.
#[allow(dead_code)] // wired by Task 11
pub mod record;
// the modules below are filled by later tasks of the Runs plan; the attribute goes when Task 11 wires them
#[allow(dead_code)] pub mod checks;
#[allow(dead_code)] pub mod lane_map;
#[allow(dead_code)] pub mod fence;
#[allow(dead_code)] pub mod gate;
#[allow(dead_code)] pub mod oracle;
#[allow(dead_code)] pub mod judge;
#[allow(dead_code)] pub mod review;
#[allow(dead_code)] pub mod scheduler;
#[allow(dead_code)] pub mod prompts;
#[allow(dead_code)] pub mod runner;
#[allow(dead_code)] pub mod tools;
#[allow(dead_code)] pub mod host;
#[allow(dead_code)] pub mod commands;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

/// The live runs, and how a record reaches the frontend (`run-update`).
pub struct Runs {
    ctls: Mutex<HashMap<(PathBuf, u64), Arc<runner::RunCtl>>>,
    emit: Mutex<Option<runner::Publish>>,
}

impl Runs {
    pub fn new() -> Self { Runs { ctls: Mutex::new(HashMap::new()), emit: Mutex::new(None) } }
    #[allow(dead_code)] // the app's emitter is set by Task 11
    pub fn set_emit(&self, f: runner::Publish) { if let Ok(mut g) = self.emit.lock() { *g = Some(f); } }
    pub fn publish(&self, dir: &Path, rec: &record::RunRecord) {
        if let Some(f) = self.emit.lock().ok().and_then(|g| g.clone()) { f(dir, rec); }
    }
    /// What a controller publishes through (the emitter set at app start).
    #[allow(dead_code)] // the controller is started by Task 11
    pub fn publisher(&self) -> runner::Publish {
        let f = self.emit.lock().ok().and_then(|g| g.clone());
        Arc::new(move |d: &Path, r: &record::RunRecord| if let Some(f) = &f { f(d, r) })
    }
    #[allow(dead_code)] // the controller is started by Task 11
    pub fn insert(&self, ctl: Arc<runner::RunCtl>) {
        if let Ok(mut g) = self.ctls.lock() {
            g.retain(|_, c| !c.snapshot().state.terminal());
            g.insert((ctl.dir.clone(), ctl.n), ctl);
        }
    }
    pub fn get(&self, dir: &Path, n: u64) -> Option<Arc<runner::RunCtl>> {
        self.ctls.lock().ok()?.get(&(dir.to_path_buf(), n)).cloned()
    }
}
