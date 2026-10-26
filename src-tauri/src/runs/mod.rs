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
