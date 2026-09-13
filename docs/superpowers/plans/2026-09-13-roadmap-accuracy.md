# Roadmap Accuracy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A phase that is done stays done (markers + ledger + unbounded evidence), and the roadmap tells the user when it has fallen behind the repo and brings itself up to date with one click.

**Architecture:** All derivation stays in `src-tauri/src/main.rs` (`Ctx`, `eval_cond`, `derive_statuses`, `state_for_project`); the ledger is a new small module `src-tauri/src/ledger.rs`. Order of truth per phase is marker → ledger → rules. The frontend maps three new state fields into "what needs you" rows and two phase-detail actions; the existing background chronicle-init session (`init_start`) is reused in refresh mode for "Bring the roadmap up to date", with a note listing what changed.

**Tech Stack:** Rust (Tauri 2, serde_json, regex, sha2, std only for time), React + TypeScript (vitest), the chronicle-init skill markdown.

**Spec:** `docs/superpowers/specs/2026-09-13-roadmap-accuracy-design.md`

## Global Constraints

- Never `git add -A`, `git stash`, `git reset`, `git checkout -- <file>`, or `git clean` in this tree: the user's installed Chronicle writes `.chronicle/` live. Stage by explicit path only.
- Rust tests run with `cd src-tauri && cargo test <name>`; frontend with `npm test -- <file>`; types with `npm run typecheck`. Run all three before every commit that touches that side.
- Copy rules (from the skill): sentence case, no em dashes in user-facing strings, a middot ` · ` for label separators.
- The ledger file is the only project file the app writes on its own in this plan. Its writes are atomic (temp + rename) and only happen when something new is done.
- Round overlay phases have ids `FX-<n>`; the spec's `round-<n>` wording is superseded by this plan.
- `at` timestamps in the ledger are epoch milliseconds from `epoch_ms()` (no chrono dependency), not ISO strings.
- Three deviations from the spec, all deliberate: (1) "Bring the roadmap up to date" reuses the existing background init session in refresh mode with a note, not the agent pane; (2) the existing `StaleAlert` banner is replaced by the needs-you rows so one finding has one UI; (3) the marker commit command is the two-message form so git parses the trailer; (4) there is no "Not now" suppression of the behind rows: they stay until the roadmap is updated, and the confirm dialog's cancel is the only dismissal.

---

### Task 1: Commit subjects cover the whole history

**Files:**
- Modify: `src-tauri/src/main.rs:569-585` (`Ctx`, `Ctx::build`)
- Modify: `src-tauri/src/main.rs:661-666` (`commit_subject` branch of `eval_cond`)
- Test: `src-tauri/src/main.rs` (mod `r3_tests`)
- Modify: `skill/chronicle-init/SCHEMA.md:83`

**Interfaces:**
- Produces: `Ctx.subjects: Vec<(String, String)>` — `(short_hash, subject)` for every commit on every branch, newest first. Task 2 reads the hash for the proof string.

- [ ] **Step 1: Write the failing test**

Add to `mod r3_tests` in `src-tauri/src/main.rs`, after `every_condition_type_true_and_false`:

```rust
    #[test]
    fn subject_evidence_never_falls_out_of_a_window() {
        let d = repo("deep");
        git(&d, &["-c", "user.email=t@t", "-c", "user.name=t", "commit", "--allow-empty", "-m", "feat: per-step evidence lands"]);
        for i in 0..205 {
            git(&d, &["-c", "user.email=t@t", "-c", "user.name=t", "commit", "--allow-empty", "-m", &format!("chore: filler {i}")]);
        }
        let ctx = Ctx::build(&Project { dir: d.clone(), repo: d.clone(), extras: vec![], manifest: None, manifest_error: None });
        assert_eq!(ctx.subjects.len(), 207, "every commit, not the newest 200");
        assert_eq!(eval_cond(&ctx, &json!({"commit_subject": "(?i)per-step evidence"})), Some(true));
        assert!(ctx.subjects[0].0.len() >= 7, "each subject carries its short hash");
    }
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd src-tauri && cargo test subject_evidence_never_falls_out_of_a_window`
Expected: compile error — `ctx.subjects[0].0` does not exist on `String` (subjects is `Vec<String>`), or, once compiled, `assertion failed: 200 == 207`.

- [ ] **Step 3: Make subjects unbounded and carry the hash**

In `Ctx` change the field and its collection:

```rust
struct Ctx {
    repo: PathBuf,
    extras: Vec<(String, PathBuf)>,
    tags: HashSet<String>,
    /// (short hash, subject) for EVERY commit on every branch, newest first.
    /// Unbounded on purpose: a proving commit must never fall out of a window.
    subjects: Vec<(String, String)>,
}

impl Ctx {
    fn build(p: &Project) -> Ctx {
        Ctx {
            repo: p.repo.clone(),
            extras: p.extras.clone(),
            tags: git_in(&p.repo, &["tag"]).lines().map(String::from).collect(),
            subjects: git_in(&p.repo, &["log", "--all", "--format=%h%x09%s"])
                .lines()
                .map(|l| match l.split_once('\t') {
                    Some((h, s)) => (h.to_string(), s.to_string()),
                    None => (String::new(), l.to_string()),
                })
                .collect(),
        }
    }
```

In `eval_cond`, the `commit_subject` branch becomes:

```rust
        if let Some(pat) = cond.get("commit_subject").and_then(|v| v.as_str()) {
            if let Ok(re) = Regex::new(pat) {
                return Some(ctx.subjects.iter().any(|(_, s)| re.is_match(s)));
            }
            return Some(false);
        }
```

Search the file for any other reader of `ctx.subjects` (`grep -n "subjects" src-tauri/src/main.rs`) and adapt each to the tuple. The `r3_tests::ctx_for` helper at line 3296 constructs a `Ctx` by hand if it exists; update its `subjects` field to the tuple form.

- [ ] **Step 4: Run the tests**

Run: `cd src-tauri && cargo test r3_tests`
Expected: all pass, including the new one.

- [ ] **Step 5: Update the schema doc**

In `skill/chronicle-init/SCHEMA.md` line 83 replace `any of the last 200 commit subjects, across ALL branches (the same history the graph shows)` with `any commit subject on ANY branch, however old (the whole history the graph shows)`.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/main.rs skill/chronicle-init/SCHEMA.md
git commit -m "fix(roadmap): commit-subject evidence searches the whole history, never a window"
```

---

### Task 2: The phase marker and the proof on every status

**Files:**
- Modify: `src-tauri/src/main.rs` (`Ctx`, `eval_cond` helpers, `PhaseState`, `derive_statuses`)
- Test: `src-tauri/src/main.rs` (mod `r3_tests`)

**Interfaces:**
- Consumes: `Ctx.subjects: Vec<(String, String)>` from Task 1.
- Produces:
  - `Ctx.markers: HashMap<String, String>` — phase id → full commit hash of the newest commit carrying `Chronicle-Phase: <id> done`.
  - `fn parse_markers(raw: &str) -> HashMap<String, String>`.
  - `fn proving_cond(ctx: &Ctx, conds: Option<&Value>) -> Option<Value>` — the first condition that holds, or None.
  - `fn proof_of(ctx: &Ctx, cond: &Value) -> (String, String)` — `(by, proof)` such as `("commit_subject", "1d75d57")`, `("tag", "v0.3.0")`, `("file_matches", "c-zed/PROGRESS.md")`.
  - `PhaseState { id, state, label, proof: Option<String> }` where `proof` is `"<by> <proof>"` e.g. `"marker f8a0e01"`; Task 3 adds `"ledger …"`.

- [ ] **Step 1: Write the failing tests**

Add to `mod r3_tests`:

```rust
    #[test]
    fn markers_are_read_from_trailers() {
        let raw = "aaaa1111\u{1e}M-1 done\u{1f}SE done\nbbbb2222\u{1e}\ncccc3333\u{1e}M-1 done\ndddd4444\u{1e}Z-9 started\n";
        let m = parse_markers(raw);
        assert_eq!(m.get("M-1").map(String::as_str), Some("aaaa1111"), "newest marker wins");
        assert_eq!(m.get("SE").map(String::as_str), Some("aaaa1111"), "several trailers on one commit");
        assert!(m.get("Z-9").is_none(), "only `<id> done` counts");
        assert_eq!(m.len(), 2);
    }

    #[test]
    fn a_marker_commit_proves_a_phase_with_no_rule() {
        let d = repo("marker");
        git(&d, &["-c", "user.email=t@t", "-c", "user.name=t", "commit", "--allow-empty",
                  "-m", "chore: close the slash menu phase", "-m", "Chronicle-Phase: M-1 done"]);
        let ctx = Ctx::build(&Project { dir: d.clone(), repo: d.clone(), extras: vec![], manifest: None, manifest_error: None });
        assert!(ctx.markers.contains_key("M-1"));
        let m = json!({"stages": [{"phases": [
            {"id": "M-1", "status": {"done_when": [{"commit_subject": "never matches"}]}},
            {"id": "M-2", "status": {"done_when": [{"tag": "phase-1"}]}},
            {"id": "ID", "pool": true}
        ]}]});
        let st = derive_statuses(&ctx, &m);
        assert_eq!(st[0].state, "done");
        assert!(st[0].proof.as_deref().unwrap_or("").starts_with("marker "), "{:?}", st[0].proof);
        assert_eq!(st[1].state, "now");
        assert_eq!(st[1].proof, None);
        assert_eq!(st[2].state, "pool");
        // a pool phase with a marker is done too: the marker outranks any rule
        git(&d, &["-c", "user.email=t@t", "-c", "user.name=t", "commit", "--allow-empty",
                  "-m", "chore: the shelf item shipped", "-m", "Chronicle-Phase: ID done"]);
        let ctx = Ctx::build(&Project { dir: d.clone(), repo: d.clone(), extras: vec![], manifest: None, manifest_error: None });
        assert_eq!(derive_statuses(&ctx, &m)[2].state, "done");
    }

    #[test]
    fn a_rule_that_fires_names_its_proof() {
        let d = repo("proof");
        git(&d, &["tag", "phase-1"]);
        std::fs::write(d.join("REPORT.md"), "## R-1 · closed\n").unwrap();
        let ctx = Ctx::build(&Project { dir: d.clone(), repo: d.clone(), extras: vec![], manifest: None, manifest_error: None });
        assert_eq!(proof_of(&ctx, &json!({"tag": "phase-1"})), ("tag".to_string(), "phase-1".to_string()));
        let (by, proof) = proof_of(&ctx, &json!({"commit_subject": "(?i)first save"}));
        assert_eq!(by, "commit_subject");
        assert_eq!(proof, ctx.subjects[0].0, "the matching commit's short hash");
        assert_eq!(proof_of(&ctx, &json!({"file_matches": {"path": "REPORT.md", "pattern": "(?m)^## R-1"}})),
                   ("file_matches".to_string(), "REPORT.md".to_string()));
        let m = json!({"stages": [{"phases": [{"id": "A", "status": {"done_when": [{"tag": "nope"}, {"tag": "phase-1"}]}}]}]});
        assert_eq!(derive_statuses(&ctx, &m)[0].proof.as_deref(), Some("tag phase-1"));
    }
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd src-tauri && cargo test r3_tests`
Expected: compile errors — `parse_markers`, `proof_of`, `ctx.markers`, `PhaseState.proof` do not exist.

- [ ] **Step 3: Implement markers, proofs and the status field**

Add `use std::collections::HashMap;` next to the `HashSet` import (line 24).

Add the field to `Ctx` and its collection in `Ctx::build`:

```rust
    /// phase id → full hash of the newest commit carrying `Chronicle-Phase: <id> done`
    markers: HashMap<String, String>,
```

```rust
            markers: parse_markers(&git_in(&p.repo, &["log", "--all",
                "--format=%H%x1e%(trailers:key=Chronicle-Phase,valueonly,separator=%x1f)"])),
```

Add the parser and the proof helpers right after `impl Ctx`:

```rust
/// `git log --format=%H%x1e%(trailers:key=Chronicle-Phase,valueonly,separator=%x1f)`
/// gives one line per commit: `<hash>\x1e<value>\x1f<value>…` (the value list is
/// empty for a commit with no such trailer). Only `<id> done` counts; the first
/// occurrence (newest commit) wins.
fn parse_markers(raw: &str) -> HashMap<String, String> {
    let mut out = HashMap::new();
    for line in raw.lines() {
        let Some((hash, values)) = line.split_once('\u{1e}') else { continue };
        for v in values.split('\u{1f}') {
            let v = v.trim();
            let Some(id) = v.strip_suffix(" done") else { continue };
            let id = id.trim();
            if id.is_empty() { continue }
            out.entry(id.to_string()).or_insert_with(|| hash.trim().to_string());
        }
    }
    out
}

/// The first condition in `conds` that holds, so a status can say what proved it.
fn proving_cond(ctx: &Ctx, conds: Option<&Value>) -> Option<Value> {
    conds.and_then(|v| v.as_array())?
        .iter().find(|c| eval_cond(ctx, c) == Some(true)).cloned()
}

/// `(by, proof)` for a condition that holds: the rule key and the thing it matched.
fn proof_of(ctx: &Ctx, cond: &Value) -> (String, String) {
    if let Some(t) = cond.get("tag").and_then(|v| v.as_str()) {
        return ("tag".into(), t.into());
    }
    if let Some(pat) = cond.get("commit_subject").and_then(|v| v.as_str()) {
        let hash = Regex::new(pat).ok()
            .and_then(|re| ctx.subjects.iter().find(|(_, s)| re.is_match(s)).map(|(h, _)| h.clone()))
            .unwrap_or_default();
        return ("commit_subject".into(), hash);
    }
    if let Some(p) = cond.get("file_exists").and_then(|v| v.as_str()) {
        return ("file_exists".into(), p.into());
    }
    if let Some(p) = cond.pointer("/file_matches/path").and_then(|v| v.as_str()) {
        return ("file_matches".into(), p.into());
    }
    if let Some(d) = cond.pointer("/file_glob/dir").and_then(|v| v.as_str()) {
        return ("file_glob".into(), d.into());
    }
    if cond.get("file_glob").is_some() {
        return ("file_glob".into(), ".".into());
    }
    if let Some(b) = cond.get("worktree_branch").and_then(|v| v.as_str()) {
        return ("worktree_branch".into(), b.into());
    }
    ("rule".into(), String::new())
}
```

Change `PhaseState` and `derive_statuses`:

```rust
#[derive(Serialize, Clone)]
struct PhaseState {
    id: String,
    state: String, // done | now | later | window | pool
    label: String,
    /// What proved a done phase: "marker <hash>", "ledger <by> <proof>", "tag v1",
    /// "commit_subject 1d75d57", "file_matches PROGRESS.md" … None when not done.
    #[serde(skip_serializing_if = "Option::is_none")]
    proof: Option<String>,
}
```

Inside the loop of `derive_statuses`, replace `let done = any_conds(ctx, status.get("done_when"));` with:

```rust
            // order of truth: a marker commit, then the rules the manifest wrote
            let proof: Option<String> = if let Some(h) = ctx.markers.get(&id) {
                Some(format!("marker {}", &h[..h.len().min(7)]))
            } else {
                proving_cond(ctx, status.get("done_when")).map(|c| {
                    let (by, p) = proof_of(ctx, &c);
                    if p.is_empty() { by } else { format!("{by} {p}") }
                })
            };
            let done = proof.is_some();
```

Then in the `PhaseState { … }` constructions: every `done` arm gets `proof: proof.clone()`, every other arm gets `proof: None`. Move the `pool` check so a marker beats it:

```rust
            let ps = if done {
                PhaseState { id, state: "done".into(), label: "done".into(), proof: proof.clone() }
            } else if pool {
                PhaseState { id, state: "pool".into(), label: "ideas".into(), proof: None }
            } else if window {
                PhaseState { id, state: "window".into(), label: pick_label("ongoing"), proof: None }
            } else if !current_taken {
                current_taken = true;
                PhaseState { id, state: "now".into(), label: pick_label("up next"), proof: None }
            } else {
                PhaseState { id, state: "later".into(), label: "later".into(), proof: None }
            };
```

For the `fixRoundState` overlay branch: its `done` arm gets `proof: Some("notes".into())` when `rdone`, else `proof: None`; a marker for `FX-<n>` also counts: `let rdone = rdone || ctx.markers.contains_key(&id);`.

Fix every other constructor of `PhaseState` the compiler reports (search `PhaseState {`).

- [ ] **Step 4: Run the tests**

Run: `cd src-tauri && cargo test r3_tests && cargo test overlay_injects_a_round_phase_and_derives_its_truth`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/main.rs
git commit -m "feat(roadmap): a Chronicle-Phase trailer proves a phase done, and every done status says what proved it"
```

---

### Task 3: The ledger — done never regresses

**Files:**
- Create: `src-tauri/src/ledger.rs`
- Modify: `src-tauri/src/main.rs` (`mod ledger;`, `derive_statuses` signature, `derive_for_dir`, `state_for_project`, `fs_event_matters`, `generate_handler!`)
- Test: `src-tauri/src/ledger.rs` (unit tests) and `mod r3_tests`

**Interfaces:**
- Consumes: `PhaseState` with `proof` from Task 2; `epoch_ms()` from main.rs.
- Produces (in `ledger.rs`, all `pub`):
  - `struct Entry { by: String, proof: String, at: u64 }`
  - `struct Ledger { done: BTreeMap<String, Entry>, set_aside: bool }` (`set_aside` is not serialized; true when a corrupt file was moved to `.bad` on this load)
  - `fn load(dir: &Path) -> Ledger`
  - `fn save(dir: &Path, l: &Ledger) -> Result<(), String>`
  - `fn mark(dir: &Path, id: &str, by: &str, proof: &str) -> Result<(), String>` — insert or overwrite and save
  - `fn unmark(dir: &Path, id: &str) -> Result<bool, String>` — remove and save; Ok(false) when absent
  - `pub const FILE: &str = ".chronicle/roadmap-ledger.json"`
- `derive_statuses(ctx: &Ctx, manifest: &Value, ledger: &Ledger) -> Vec<PhaseState>`; a ledgered phase not proven by a marker is done with `proof = "ledger <by> <proof>"`.
- `fn latch(dir: &Path, ledger: &mut Ledger, statuses: &[PhaseState])` in main.rs — writes new done phases (marker/rule proofs only, never re-writes existing entries).
- Tauri command `ledger_mark(dir: String, id: String, done: bool) -> Result<(), String>`.
- `state_for_project` output gains `"ledger_set_aside": bool`.

- [ ] **Step 1: Write the failing ledger unit tests**

Create `src-tauri/src/ledger.rs` with only the tests first:

```rust
//! The done ledger: `.chronicle/roadmap-ledger.json`. Once a phase derives done,
//! the app records what proved it; a later scan trusts the ledger even when the
//! rule stopped matching. The only project file the roadmap writes on its own.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

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
    fn mark_keeps_the_first_entry_unless_overwritten_on_purpose() {
        let d = tmp("keep");
        mark(&d, "A", "tag", "v1").unwrap();
        let first = load(&d).done["A"].at;
        mark(&d, "A", "user", "").unwrap();
        let l = load(&d);
        assert_eq!(l.done["A"].by, "user");
        assert!(l.done["A"].at >= first);
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
```

- [ ] **Step 2: Run to see them fail**

Add `mod ledger;` to `src-tauri/src/main.rs` after `mod notes;` (line 16). Run: `cd src-tauri && cargo test ledger::`
Expected: compile errors — `load`, `mark`, `unmark`, `FILE`, `Ledger` missing.

- [ ] **Step 3: Implement the module**

Above the tests in `ledger.rs`:

```rust
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
fn one() -> u32 { 1 }

fn path(dir: &Path) -> PathBuf { dir.join(FILE) }

/// A missing file is an empty ledger. A file that cannot be parsed is renamed to
/// `roadmap-ledger.json.bad` (never overwritten in place) and reported via `set_aside`.
pub fn load(dir: &Path) -> Ledger {
    let p = path(dir);
    let text = match std::fs::read_to_string(&p) {
        Ok(t) => t,
        Err(_) => return Ledger { version: 1, ..Default::default() },
    };
    match serde_json::from_str::<Ledger>(&text) {
        Ok(l) => l,
        Err(_) => {
            let _ = std::fs::rename(&p, p.with_extension("json.bad"));
            Ledger { version: 1, set_aside: true, ..Default::default() }
        }
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

pub fn mark(dir: &Path, id: &str, by: &str, proof: &str) -> Result<(), String> {
    let mut l = load(dir);
    l.done.insert(id.to_string(), Entry { by: by.into(), proof: proof.into(), at: crate::epoch_ms() });
    save(dir, &l)
}

pub fn unmark(dir: &Path, id: &str) -> Result<bool, String> {
    let mut l = load(dir);
    let had = l.done.remove(id).is_some();
    if had { save(dir, &l)?; }
    Ok(had)
}
```

Run: `cd src-tauri && cargo test ledger::` → Expected: 4 pass.

- [ ] **Step 4: Write the failing derivation tests**

Add to `mod r3_tests` in main.rs:

```rust
    #[test]
    fn the_ledger_keeps_a_phase_done_after_its_rule_stops_matching() {
        let d = repo("latch");
        std::fs::write(d.join("PROGRESS.md"), "## SE · done\n").unwrap();
        let p = Project { dir: d.clone(), repo: d.clone(), extras: vec![], manifest: None, manifest_error: None };
        let m = json!({"stages": [{"phases": [
            {"id": "SE", "status": {"done_when": [{"file_matches": {"path": "PROGRESS.md", "pattern": "(?m)^## SE"}}]}},
            {"id": "ID", "status": {"done_when": [{"tag": "never"}]}}
        ]}]});
        let mut l = ledger::load(&d);
        let st = derive_statuses(&Ctx::build(&p), &m, &l);
        assert_eq!(st[0].state, "done");
        latch(&d, &mut l, &st);
        assert_eq!(ledger::load(&d).done["SE"].by, "file_matches");
        assert_eq!(ledger::load(&d).done["SE"].proof, "PROGRESS.md");
        assert!(!ledger::load(&d).done.contains_key("ID"), "a not-done phase is never latched");
        // the evidence disappears
        std::fs::remove_file(d.join("PROGRESS.md")).unwrap();
        let l = ledger::load(&d);
        let st = derive_statuses(&Ctx::build(&p), &m, &l);
        assert_eq!(st[0].state, "done", "the ledger holds");
        assert_eq!(st[0].proof.as_deref(), Some("ledger file_matches PROGRESS.md"));
        assert_eq!(st[1].state, "now");
        // a user override reads as such, and unmarking lets the rules speak again
        ledger::mark(&d, "ID", "user", "").unwrap();
        let st = derive_statuses(&Ctx::build(&p), &m, &ledger::load(&d));
        assert_eq!(st[1].proof.as_deref(), Some("ledger user"));
        ledger::unmark(&d, "ID").unwrap();
        assert_eq!(derive_statuses(&Ctx::build(&p), &m, &ledger::load(&d))[1].state, "now");
    }

    #[test]
    fn latch_does_not_rewrite_an_unchanged_ledger() {
        let d = repo("quiet");
        git(&d, &["tag", "v1"]);
        let p = Project { dir: d.clone(), repo: d.clone(), extras: vec![], manifest: None, manifest_error: None };
        let m = json!({"stages": [{"phases": [{"id": "A", "status": {"done_when": [{"tag": "v1"}]}}]}]});
        let mut l = ledger::load(&d);
        latch(&d, &mut l, &derive_statuses(&Ctx::build(&p), &m, &l));
        let first = std::fs::metadata(d.join(ledger::FILE)).unwrap().modified().unwrap();
        std::thread::sleep(std::time::Duration::from_millis(20));
        let mut l = ledger::load(&d);
        latch(&d, &mut l, &derive_statuses(&Ctx::build(&p), &m, &l));
        assert_eq!(std::fs::metadata(d.join(ledger::FILE)).unwrap().modified().unwrap(), first);
    }
```

Run: `cd src-tauri && cargo test the_ledger_keeps_a_phase_done_after_its_rule_stops_matching`
Expected: compile errors — `derive_statuses` takes two arguments, `latch` missing.

- [ ] **Step 5: Wire the ledger into derivation**

Change the signature: `fn derive_statuses(ctx: &Ctx, manifest: &Value, ledger: &ledger::Ledger) -> Vec<PhaseState>`. In the loop, extend the order of truth from Task 2:

```rust
            let proof: Option<String> = if let Some(h) = ctx.markers.get(&id) {
                Some(format!("marker {}", &h[..h.len().min(7)]))
            } else if let Some(e) = ledger.done.get(&id) {
                Some(if e.proof.is_empty() { format!("ledger {}", e.by) } else { format!("ledger {} {}", e.by, e.proof) })
            } else {
                proving_cond(ctx, status.get("done_when")).map(|c| {
                    let (by, p) = proof_of(ctx, &c);
                    if p.is_empty() { by } else { format!("{by} {p}") }
                })
            };
```

The `fixRoundState` branch: `let rdone = rdone || ctx.markers.contains_key(&id) || ledger.done.contains_key(&id);`.

Add `latch` after `derive_statuses`:

```rust
/// Record every newly done phase whose proof is live evidence (a marker or a
/// rule). Ledger-proven phases are already there; nothing is ever re-written.
fn latch(dir: &Path, ledger: &mut ledger::Ledger, statuses: &[PhaseState]) {
    let mut changed = false;
    for s in statuses {
        if s.state != "done" || ledger.done.contains_key(&s.id) { continue }
        let Some(proof) = s.proof.as_deref() else { continue };
        if proof.starts_with("ledger ") || proof == "notes" { continue }
        let (by, p) = proof.split_once(' ').unwrap_or((proof, ""));
        ledger.done.insert(s.id.clone(), ledger::Entry { by: by.into(), proof: p.into(), at: epoch_ms() });
        changed = true;
    }
    if changed { let _ = ledger::save(dir, ledger); } // a failed write is retried next scan
}
```

Update the callers:

- `derive_for_dir` (line 881): `let mut l = ledger::load(&p.dir); let statuses = derive_statuses(&ctx, &merged, &l); latch(&p.dir, &mut l, &statuses);` and add `"ledger_set_aside": l.set_aside` to its JSON.
- `state_for_project` (line 1383): load the ledger once before the `match &merged_manifest`, pass it to `derive_statuses`, call `latch` right after, and add `"ledger_set_aside": ledger.set_aside` to the output JSON.
- Every test that calls `derive_statuses` with two arguments (the Task 2 tests `a_marker_commit_proves_a_phase_with_no_rule` and `a_rule_that_fires_names_its_proof`, plus `overlay_injects_a_round_phase_and_derives_its_truth` and its neighbours around line 3715): pass `&ledger::load(&d)` as the third argument.

Add the command next to `journal_append`:

```rust
/// Phase detail's "Mark done" / "Mark not done". `done` writes a user entry; `!done`
/// removes the entry (the rules still speak next scan, so a phase with live proof
/// comes straight back).
#[tauri::command]
async fn ledger_mark(roots: State<'_, OpenRoots>, dir: String, id: String, done: bool) -> Result<(), String> {
    let p = project_for(&roots, &dir)?;
    if done { ledger::mark(&p.dir, &id, "user", "") } else { ledger::unmark(&p.dir, &id).map(|_| ()) }
}
```

Register `ledger_mark` in `generate_handler![…]` (line 3219; keep the list's existing order style, append after `journal_read`).

In `fs_event_matters` do NOT filter the ledger file: the app's own latch write wakes one poll, which finds nothing new and writes nothing. That is the refresh the "Mark done" button relies on.

- [ ] **Step 6: Run the Rust suite**

Run: `cd src-tauri && cargo test`
Expected: all pass (existing overlay/round tests adapted to the third argument).

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/ledger.rs src-tauri/src/main.rs
git commit -m "feat(roadmap): a done ledger under .chronicle/ keeps a finished phase finished"
```

---

### Task 4: The roadmap-is-behind detector and the refresh note

**Files:**
- Modify: `src-tauri/src/main.rs` (`state_for_project`, `derive_for_dir`, `init_start`)
- Test: `src-tauri/src/main.rs` (mod `r3_tests`)

**Interfaces:**
- Produces:
  - `fn newer_plans(ctx: &Ctx, manifest: &Value, manifest_mtime: SystemTime) -> Vec<String>` — repo-relative paths, sorted.
  - `fn newer_release(ctx: &Ctx, manifest: &Value) -> Option<(String, String)>` — `(newest tag in git, newest tag mentioned in the manifest)`.
  - `fn semver_of(s: &str) -> Option<(u64, u64, u64)>`.
  - `state_for_project` JSON: `"new_plans": [String]`, `"newer_release": [newest, mentioned] | null` (existing `"stale"` unchanged).
  - `init_start(..., note: Option<String>)` — appended to the refresh invocation.
  - Manifest key `planDirs: [String]` (optional) adds to the default `docs/superpowers/specs` and `docs/superpowers/plans`.

- [ ] **Step 1: Write the failing tests**

```rust
    #[test]
    fn semver_tags_compare_numerically() {
        assert_eq!(semver_of("v0.8.1"), Some((0, 8, 1)));
        assert_eq!(semver_of("0.10.0"), Some((0, 10, 0)));
        assert_eq!(semver_of("v2-merged"), None);
        assert!(semver_of("v0.10.0") > semver_of("v0.9.9"));
    }

    #[test]
    fn the_detector_sees_new_plans_and_newer_releases() {
        let d = repo("behind");
        std::fs::write(d.join("chronicle.json"), r#"{"chronicleVersion":1,"stages":[{"phases":[
            {"id":"A","docs":[{"path":"docs/superpowers/specs/old.md"}],"status":{"done_when":[{"tag":"v0.5.1"}]}}]}]}"#).unwrap();
        let mtime = std::fs::metadata(d.join("chronicle.json")).unwrap().modified().unwrap();
        std::fs::create_dir_all(d.join("docs/superpowers/specs")).unwrap();
        std::fs::create_dir_all(d.join("docs/superpowers/plans")).unwrap();
        std::fs::create_dir_all(d.join("planning")).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(20));
        std::fs::write(d.join("docs/superpowers/specs/old.md"), "mentioned").unwrap();
        std::fs::write(d.join("docs/superpowers/specs/new-design.md"), "not mentioned").unwrap();
        std::fs::write(d.join("docs/superpowers/plans/new-plan.md"), "not mentioned").unwrap();
        std::fs::write(d.join("planning/extra.md"), "in a planDirs folder").unwrap();
        git(&d, &["tag", "v0.5.1"]);
        git(&d, &["tag", "v0.8.1"]);
        git(&d, &["tag", "v2-merged"]);
        let p = load_project(&d);
        let ctx = Ctx::build(&p);
        let m = p.manifest.clone().unwrap();
        assert_eq!(newer_plans(&ctx, &m, mtime),
                   vec!["docs/superpowers/plans/new-plan.md".to_string(), "docs/superpowers/specs/new-design.md".to_string()],
                   "newer AND unmentioned; the mentioned one is skipped even though it is newer");
        let mut m2 = m.clone();
        m2["planDirs"] = json!(["planning"]);
        assert!(newer_plans(&ctx, &m2, mtime).contains(&"planning/extra.md".to_string()));
        assert_eq!(newer_release(&ctx, &m), Some(("v0.8.1".into(), "v0.5.1".into())));
        let st = state_for_project(&p);
        assert_eq!(st["new_plans"].as_array().unwrap().len(), 2);
        assert_eq!(st["newer_release"], json!(["v0.8.1", "v0.5.1"]));
        // nothing behind: no rows
        git(&d, &["tag", "-d", "v0.8.1"]);
        let ctx = Ctx::build(&p);
        assert_eq!(newer_release(&ctx, &m), None);
        let old = std::fs::read_to_string(d.join("chronicle.json")).unwrap()
            .replace("old.md", "old.md\"},{\"path\":\"docs/superpowers/specs/new-design.md\"},{\"path\":\"docs/superpowers/plans/new-plan.md");
        std::fs::write(d.join("chronicle.json"), old).unwrap();
        let p = load_project(&d);
        assert!(state_for_project(&p)["new_plans"].as_array().unwrap().is_empty());
    }

    #[test]
    fn a_manifest_with_no_release_rule_is_not_behind_on_releases() {
        let d = repo("norel");
        git(&d, &["tag", "v0.1.0"]);
        let ctx = Ctx::build(&Project { dir: d.clone(), repo: d.clone(), extras: vec![], manifest: None, manifest_error: None });
        assert_eq!(newer_release(&ctx, &json!({"stages": []})), None, "no tag mentioned means nothing to be behind");
    }
```

Run: `cd src-tauri && cargo test the_detector_sees_new_plans_and_newer_releases`
Expected: compile errors — `semver_of`, `newer_plans`, `newer_release` missing.

- [ ] **Step 2: Implement the detector**

Add after `validate_manifest`:

```rust
/* ================= the roadmap-is-behind detector ================= */

fn semver_of(s: &str) -> Option<(u64, u64, u64)> {
    let t = s.strip_prefix('v').unwrap_or(s);
    let mut it = t.split('.');
    let a = it.next()?.parse().ok()?;
    let b = it.next()?.parse().ok()?;
    let c = it.next()?.parse().ok()?;
    if it.next().is_some() { return None }
    Some((a, b, c))
}

const DEFAULT_PLAN_DIRS: [&str; 2] = ["docs/superpowers/specs", "docs/superpowers/plans"];

/// Plan or spec files written after the manifest that the manifest never mentions.
/// Non-recursive, jailed to the roots, sorted for stable rows.
fn newer_plans(ctx: &Ctx, manifest: &Value, manifest_mtime: std::time::SystemTime) -> Vec<String> {
    let text = manifest.to_string();
    let mut dirs: Vec<String> = DEFAULT_PLAN_DIRS.iter().map(|s| s.to_string()).collect();
    if let Some(extra) = manifest.get("planDirs").and_then(|v| v.as_array()) {
        dirs.extend(extra.iter().filter_map(|v| v.as_str()).map(String::from));
    }
    let mut out = Vec::new();
    for dir in dirs {
        let Some(full) = ctx.resolve_jailed(&dir) else { continue };
        let Ok(rd) = std::fs::read_dir(&full) else { continue };
        for e in rd.flatten() {
            let Ok(md) = e.metadata() else { continue };
            if !md.is_file() { continue }
            let Ok(mt) = md.modified() else { continue };
            if mt <= manifest_mtime { continue }
            let rel = format!("{}/{}", dir.trim_end_matches('/'), e.file_name().to_string_lossy());
            if text.contains(&rel) { continue }
            out.push(rel);
        }
    }
    out.sort();
    out
}

/// `(newest semver tag in git, newest semver tag the manifest mentions)` when the
/// repo has moved past the roadmap. None when the manifest mentions no tag at all.
fn newer_release(ctx: &Ctx, manifest: &Value) -> Option<(String, String)> {
    let re = Regex::new(r"v?\d+\.\d+\.\d+").ok()?;
    let text = manifest.to_string();
    let mentioned = re.find_iter(&text).map(|m| m.as_str().to_string())
        .filter(|t| semver_of(t).is_some())
        .max_by_key(|t| semver_of(t))?;
    let newest = ctx.tags.iter().filter(|t| semver_of(t).is_some()).max_by_key(|t| semver_of(t))?.clone();
    (semver_of(&newest) > semver_of(&mentioned)).then_some((newest, mentioned))
}
```

In `state_for_project`, inside the `Some(m) =>` arm after the `stale` block, compute:

```rust
            let mtime = std::fs::metadata(p.dir.join("chronicle.json")).and_then(|m| m.modified())
                .unwrap_or(std::time::UNIX_EPOCH);
            let new_plans = newer_plans(&ctx, m, mtime);
            let newer_rel = newer_release(&ctx, m).map(|(a, b)| json!([a, b])).unwrap_or(Value::Null);
```

Thread both out of the match (extend the tuple) and add `"new_plans": new_plans, "newer_release": newer_rel,` to the JSON. The `None` arm supplies `Vec::<String>::new()` and `Value::Null`. Add the same two keys to `derive_for_dir`'s output so the CLI prints them.

- [ ] **Step 3: The refresh note on `init_start`**

Change the signature to `…, dir: String, agent: Option<String>, fresh: Option<bool>, note: Option<String>)`. Build the instruction once:

```rust
    let note = note.filter(|n| !n.trim().is_empty())
        .map(|n| format!("REFRESH MODE. Since this roadmap was written the repo moved on. Update only what changed, never drop a phase the plan still contains, and recompute every generatedFrom hash. What changed: {n}"));
```

Claude branch:

```rust
        let slash = match (fresh == Some(true), &note) {
            (true, _) => format!("/chronicle-init {FRESH_REBUILD_NOTE}"),
            (false, Some(n)) => format!("/chronicle-init {n}"),
            (false, None) => "/chronicle-init".to_string(),
        };
```

Codex branch: `let fresh_note = if fresh == Some(true) { format!("{FRESH_REBUILD_NOTE}\n\n") } else if let Some(n) = &note { format!("{n}\n\n") } else { String::new() };`.

- [ ] **Step 4: Run the Rust suite**

Run: `cd src-tauri && cargo test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/main.rs
git commit -m "feat(roadmap): the scan notices plans, docs and releases the roadmap never saw; a refresh can be told what changed"
```

---

### Task 5: Prompts carry the marker instruction; the skill prefers it

**Files:**
- Modify: `src-tauri/src/main.rs:1538` (`FIXES_PROMPT_HEAD`), `src-tauri/src/main.rs:1960-1962` (the `round_execute` prompt)
- Modify: `skill/chronicle-init/SCHEMA.md` (Status derivation, Condition table, `planDirs`)
- Modify: `skill/chronicle-init/SKILL.md` (§2 principles, §4 refresh mode)
- Test: `src-tauri/src/main.rs` (mod `r3_tests`)

**Interfaces:**
- Produces: `const MARKER_INSTRUCTION: &str` and `fn marker_instruction(id: &str) -> String` in main.rs.

- [ ] **Step 1: Write the failing test**

```rust
    #[test]
    fn every_prompt_chronicle_writes_asks_for_the_marker() {
        let s = marker_instruction("FX-3");
        assert!(s.contains("Chronicle-Phase: FX-3 done"));
        assert!(s.contains("--allow-empty"));
        assert!(FIXES_PROMPT_HEAD.contains("Chronicle-Phase: FX-{N} done"));
    }
```

Run: `cd src-tauri && cargo test every_prompt_chronicle_writes_asks_for_the_marker` → Expected: compile error, `marker_instruction` missing.

- [ ] **Step 2: Implement**

Above `FIXES_PROMPT_HEAD`:

```rust
/// The one line every prompt Chronicle writes ends with. The two-message commit form
/// matters: git only reads a trailer that sits in its own paragraph after the subject.
fn marker_instruction(id: &str) -> String {
    format!("When every item above is complete and verified, make the final commit with this trailer as its own last paragraph: `Chronicle-Phase: {id} done`. If the work is already committed, add an empty commit carrying it: git commit --allow-empty -m \"Close {id}\" -m \"Chronicle-Phase: {id} done\". Chronicle reads that trailer as the proof the phase is done.")
}
```

Append to `FIXES_PROMPT_HEAD`'s second numbered item (inside the string, after "this is how the pane and the roadmap track the round live."):

```
 The prompt MUST also end with this instruction, verbatim with the round number filled in: when every item is complete and verified, make the final commit with the trailer `Chronicle-Phase: FX-{N} done` as its own last paragraph (or `git commit --allow-empty -m \"Close FX-{N}\" -m \"Chronicle-Phase: FX-{N} done\"` if the work is already committed).
```

In `round_execute`, append the instruction to the prompt: `let prompt = format!("… changing nothing else in that file. {}", marker_instruction(&format!("FX-{n}")));`.

- [ ] **Step 3: Update the schema and skill docs**

`SCHEMA.md`, in "Status derivation", add as the first bullet:

```
- A phase is **done** when any commit on any branch carries the trailer
  `Chronicle-Phase: <id> done` (a *marker*); this needs no rule and outranks every rule,
  including `pool`. Chronicle also keeps a ledger (`.chronicle/roadmap-ledger.json`) of
  every phase it has ever seen done, so a rule that stops matching never un-finishes a
  phase. Order of truth: marker → ledger → `done_when`.
```

After the Condition table add:

```
**Prefer the marker for work that hasn't happened yet.** For a phase whose prompt you write
or update, end the prompt with: "When the work is complete and verified, make the final
commit with the trailer `Chronicle-Phase: <id> done` as its own last paragraph." Then the
phase needs no `done_when` at all. Keep `done_when` rules for phases that already closed
before Chronicle existed. Never edit a prompt file you didn't write; tell the user the
marker command for that phase instead.
```

Under the top-level object comment add `"planDirs": ["planning"],  // optional; folders Chronicle watches for plan files it should be told about (docs/superpowers/specs and /plans are always watched)`.

`SKILL.md` §2, first principle, change the preference list to: `git tags → per-phase report/progress files → commit subjects (regex, (?i) for case). For phases not yet started, the Chronicle-Phase marker replaces all of these (see SCHEMA.md, "Prefer the marker").` §4 (Refresh mode) add: `When the invocation carries a "REFRESH MODE … What changed:" note, that list is the diff to work from: read each named file or tag, add or update the phases it describes, and leave everything else untouched.`

- [ ] **Step 4: Run the tests and commit**

Run: `cd src-tauri && cargo test every_prompt_chronicle_writes_asks_for_the_marker`
Expected: PASS.

```bash
git add src-tauri/src/main.rs skill/chronicle-init/SCHEMA.md skill/chronicle-init/SKILL.md
git commit -m "feat(roadmap): every prompt Chronicle writes asks for the Chronicle-Phase trailer; the skill prefers it to guessed rules"
```

---

### Task 6: Frontend — needs-you rows for a roadmap that fell behind

**Files:**
- Modify: `src/lib/ipc.ts:44-48` (`PhaseStatus`), `:80-110` (`StateData`), `:168-169` (`initStart`), add `ledgerMark`
- Modify: `src/lib/roadmap-data.ts` (`RoadmapCtx.handlers`, `needsYouRows`, remove `props.stale`)
- Modify: `src/screens/roadmap/RoadmapPane.tsx` (`startInit`, handlers, `StaleAlert` removal)
- Modify: `src/screens/roadmap/Roadmap.tsx` (drop the `stale` prop and the `StaleAlert` import)
- Delete: `src/screens/roadmap/StaleAlert.tsx`
- Test: `src/lib/roadmap-data.test.ts`

**Interfaces:**
- Consumes: `new_plans`, `newer_release`, `stale`, `ledger_set_aside` from Task 4/3 state; `init_start(note)`.
- Produces:
  - `StateData.new_plans: string[]`, `StateData.newer_release: [string, string] | null`, `StateData.ledger_set_aside?: boolean`, `PhaseStatus.proof?: string`.
  - `initStart(dir, agent, fresh = false, note?: string)`; `ledgerMark(dir, id, done)`.
  - `RoadmapCtx.handlers.onRefreshRoadmap: (note: string) => void`.
  - `export function behindNote(s: StateData): string` — the sentence handed to the refresh.

- [ ] **Step 1: Write the failing tests**

In `src/lib/roadmap-data.test.ts`, extend the `repo()` helper defaults with `new_plans: [], newer_release: null,` and add:

```ts
import { behindNote, needsYouRows } from "./roadmap-data";

describe("a roadmap that fell behind", () => {
  const handlers = { onRefreshRoadmap: vi.fn() };
  const ctx = { ...CTX, handlers } as unknown as RoadmapCtx;

  it("names each thing the roadmap never saw, one row each, sharing one action", () => {
    const s = repo({
      manifest_present: true,
      stale: ["PRODUCT.md"],
      new_plans: ["docs/superpowers/specs/2026-09-09-notes-design.md"],
      newer_release: ["v0.8.1", "v0.5.1"],
    });
    const rows = needsYouRows(s, ctx).filter((r) => r.id.startsWith("behind"));
    expect(rows.map((r) => r.title)).toEqual([
      "PRODUCT.md changed since the roadmap was written",
      "2026-09-09-notes-design.md is not on the roadmap",
      "v0.8.1 shipped, the roadmap ends at v0.5.1",
    ]);
    for (const r of rows) {
      expect(r.kind).toBe("one-click");
      if (r.kind === "one-click") expect(r.actionLabel).toBe("Bring it up to date");
    }
    if (rows[0].kind === "one-click") rows[0].onAction?.();
    expect(handlers.onRefreshRoadmap).toHaveBeenCalledWith(behindNote(s));
  });

  it("caps the plan rows at five and counts the rest", () => {
    const s = repo({ manifest_present: true, new_plans: ["a.md", "b.md", "c.md", "d.md", "e.md", "f.md", "g.md"] });
    const rows = needsYouRows(s, ctx).filter((r) => r.id.startsWith("behind"));
    expect(rows).toHaveLength(6);
    expect(rows[5].title).toBe("and 2 more plan files are not on the roadmap");
  });

  it("says nothing when nothing is behind, and nothing without a roadmap", () => {
    expect(needsYouRows(repo({ manifest_present: true }), ctx).filter((r) => r.id.startsWith("behind"))).toEqual([]);
    expect(needsYouRows(repo({ new_plans: ["x.md"] }), ctx).filter((r) => r.id.startsWith("behind"))).toEqual([]);
  });

  it("the note lists every finding in one sentence each", () => {
    const s = repo({ manifest_present: true, stale: ["PRODUCT.md"], new_plans: ["docs/a.md"], newer_release: ["v2.0.0", "v1.0.0"] });
    expect(behindNote(s)).toBe(
      "PRODUCT.md changed. New plan files: docs/a.md. The newest release is v2.0.0 but the roadmap ends at v1.0.0.",
    );
  });

  it("an unreadable ledger is reported, not hidden", () => {
    const rows = needsYouRows(repo({ manifest_present: true, ledger_set_aside: true }), ctx);
    expect(rows.find((r) => r.id === "ledger-bad")?.title).toBe("The done ledger was unreadable and set aside");
  });
});
```

Add `import { vi } from "vitest"` to the existing vitest import.

Run: `npm test -- src/lib/roadmap-data.test.ts` → Expected: FAIL, `behindNote` is not exported / rows missing.

- [ ] **Step 2: Types and IPC**

`src/lib/ipc.ts`:

```ts
export interface PhaseStatus {
  id: string;
  state: "done" | "now" | "later" | "window" | "pool";
  label: string;
  /** What proved a done phase ("marker f8a0e01", "ledger user", "tag v0.3.0"…). */
  proof?: string;
}
```

In `StateData` after `stale: string[];` add:

```ts
  /** Plan/spec files newer than the roadmap that it never mentions. */
  new_plans: string[];
  /** [newest tag in git, newest tag the roadmap mentions] when the repo moved past it. */
  newer_release: [string, string] | null;
  /** True on the scan that found a corrupt ledger and moved it aside. */
  ledger_set_aside?: boolean;
```

```ts
export const initStart = (dir: string, agent: string | null, fresh = false, note?: string) =>
  invoke<void>("init_start", { dir, agent, fresh, note: note ?? null });
/** Phase detail's Mark done / Mark not done — writes or removes a user ledger entry. */
export const ledgerMark = (dir: string, id: string, done: boolean) =>
  invoke<void>("ledger_mark", { dir, id, done });
```

- [ ] **Step 3: The rows and the note**

In `src/lib/roadmap-data.ts` add `onRefreshRoadmap: (note: string) => void;` to `RoadmapCtx.handlers` and, above `needsYouRows`:

```ts
/** The one-paragraph diff handed to the chronicle-init refresh. */
export function behindNote(s: StateData): string {
  const parts: string[] = [];
  for (const d of s.stale) parts.push(`${d} changed.`);
  if (s.new_plans.length > 0) parts.push(`New plan files: ${s.new_plans.join(", ")}.`);
  if (s.newer_release) parts.push(`The newest release is ${s.newer_release[0]} but the roadmap ends at ${s.newer_release[1]}.`);
  return parts.join(" ");
}
```

Inside `needsYouRows`, after the `is_git` block and before the `custom_actions` loop:

```ts
  if (s.manifest_present) {
    const note = behindNote(s);
    const behind = (id: string, title: string, sub: string): NeedsYouRow => ({
      id, icon: createElement(ClockGlyph, { size: 14 }), title, sub, command: "",
      kind: "one-click", actionLabel: "Bring it up to date",
      onAction: () => H.onRefreshRoadmap(note),
    });
    for (const d of s.stale) {
      rows.push(behind(`behind-doc-${d}`, `${d} changed since the roadmap was written`,
        "A refresh reads it again and updates only what changed. You review the diff before anything lands."));
    }
    const plans = s.new_plans.slice(0, 5);
    for (const p of plans) {
      rows.push(behind(`behind-plan-${p}`, `${p.split("/").pop()} is not on the roadmap`,
        "A plan file newer than the roadmap that it never mentions."));
    }
    if (s.new_plans.length > 5) {
      rows.push(behind("behind-plan-more", `and ${s.new_plans.length - 5} more plan files are not on the roadmap`,
        "The refresh reads all of them."));
    }
    if (s.newer_release) {
      rows.push(behind("behind-release", `${s.newer_release[0]} shipped, the roadmap ends at ${s.newer_release[1]}`,
        "Releases after the last phase the roadmap knows about."));
    }
    if (s.ledger_set_aside) {
      rows.push({
        id: "ledger-bad", icon: createElement(ClockGlyph, { size: 14 }),
        title: "The done ledger was unreadable and set aside",
        sub: "It is next to the original as roadmap-ledger.json.bad. Phases re-prove themselves from the rules; anything only the ledger knew will need Mark done again.",
        command: "", kind: "copy-only",
      });
    }
  }
```

Import `ClockGlyph` from `@/components/chrome/icons` alongside the other glyphs. Delete the `if (s.stale.length > 0) { props.stale = … }` block near line 486 and the `StaleAlertProps` import / `stale?:` prop in `Roadmap.tsx` (line 24 and 88); delete `src/screens/roadmap/StaleAlert.tsx`. Search for other `StaleAlert` users (`grep -rn StaleAlert src`) and remove them; the preview fixtures may reference it.

- [ ] **Step 4: Wire the pane**

`src/screens/roadmap/RoadmapPane.tsx`: change `startInit` to `(fresh = false, note?: string)` and pass `note` to `initStart(dir, agent, fresh, note)`. Add the handler next to `onScan`:

```ts
      onRefreshRoadmap: (note: string) =>
        onConfirm({
          title: "Bring the roadmap up to date?",
          body: `${agent === "codex" ? "A Codex" : "A Claude"} session reads what changed and updates only those phases. Your files aren't changed; review the roadmap diff in Repo before you save anything else.`,
          cancelLabel: "Not now",
          confirmLabel: "Update",
          onConfirm: () => startInit(false, note),
        }),
```

Keep `onScan` as the existing full rebuild (it is still used by the "can't read" problem card).

- [ ] **Step 5: Run the checks**

Run: `npm test -- src/lib/roadmap-data.test.ts && npm run typecheck`
Expected: all pass, no type errors (fixtures in `preview-fixtures.ts` may need the two new fields added to their `StateData` literals).

- [ ] **Step 6: Commit**

```bash
git add src/lib/ipc.ts src/lib/roadmap-data.ts src/lib/roadmap-data.test.ts src/screens/roadmap/RoadmapPane.tsx src/screens/roadmap/Roadmap.tsx src/screens/roadmap/preview-fixtures.ts
git rm src/screens/roadmap/StaleAlert.tsx
git commit -m "feat(roadmap): what the roadmap never saw shows as needs-you rows with one 'Bring it up to date'"
```

---

### Task 7: Frontend — phase detail shows the proof, the marker command, and the overrides

**Files:**
- Modify: `src/screens/roadmap/PhaseDetail.tsx` (props + a "Proof" block under "You paste")
- Modify: `src/screens/roadmap/PhaseDetailHost.tsx` (pass-through)
- Modify: `src/screens/roadmap/RoadmapPane.tsx:396-415` (wire `ledgerMark` behind a confirm)
- Test: `src/lib/roadmap-data.test.ts` (pure helper) — the component itself has no test harness in this repo

**Interfaces:**
- Consumes: `PhaseStatus.proof`, `ledgerMark` from Task 6.
- Produces:
  - `export function proofSentence(proof: string | undefined): string | null` in `roadmap-data.ts`.
  - `export function markerCommand(id: string): string` in `roadmap-data.ts`.
  - `PhaseDetailProps` gains `proof?: string | null`, `markerCommand?: string`, `onCopyCommand?: (cmd: string) => void`, `onMarkDone?: () => void`, `onMarkNotDone?: () => void`, `markNotDoneBlocked?: string | null`.

- [ ] **Step 1: Write the failing tests**

```ts
import { markerCommand, proofSentence } from "./roadmap-data";

describe("what proved a phase", () => {
  it("reads each proof as a sentence", () => {
    expect(proofSentence("marker f8a0e01")).toBe("Proved by a marker commit (f8a0e01).");
    expect(proofSentence("ledger commit_subject 1d75d57")).toBe("Recorded done on an earlier scan, from a save (1d75d57).");
    expect(proofSentence("ledger user")).toBe("Marked done by you.");
    expect(proofSentence("tag v0.3.0")).toBe("Proved by the tag v0.3.0.");
    expect(proofSentence("commit_subject 1d75d57")).toBe("Proved by a save (1d75d57).");
    expect(proofSentence("file_matches c-zed/PROGRESS.md")).toBe("Proved by c-zed/PROGRESS.md.");
    expect(proofSentence("notes")).toBe("Every note in the round is done.");
    expect(proofSentence(undefined)).toBeNull();
  });
  it("the marker command is the two-message form git parses", () => {
    expect(markerCommand("M-1")).toBe('git commit --allow-empty -m "Close M-1" -m "Chronicle-Phase: M-1 done"');
  });
});
```

Run: `npm test -- src/lib/roadmap-data.test.ts` → Expected: FAIL, not exported.

- [ ] **Step 2: The helpers**

In `roadmap-data.ts`:

```ts
export function markerCommand(id: string): string {
  return `git commit --allow-empty -m "Close ${id}" -m "Chronicle-Phase: ${id} done"`;
}

const BY_WORDS: Record<string, (p: string) => string> = {
  marker: (p) => `a marker commit (${p})`,
  tag: (p) => `the tag ${p}`,
  commit_subject: (p) => `a save (${p})`,
  file_exists: (p) => p,
  file_matches: (p) => p,
  file_glob: (p) => `a file in ${p}`,
  worktree_branch: (p) => `the workspace on ${p}`,
};

export function proofSentence(proof: string | undefined): string | null {
  if (!proof) return null;
  if (proof === "notes") return "Every note in the round is done.";
  const [head, ...rest] = proof.split(" ");
  if (head === "ledger") {
    const [by, ...p] = rest;
    if (by === "user") return "Marked done by you.";
    const words = BY_WORDS[by]?.(p.join(" ")) ?? by;
    return `Recorded done on an earlier scan, from ${words}.`;
  }
  const words = BY_WORDS[head]?.(rest.join(" ")) ?? head;
  return `Proved by ${words}.`;
}
```

- [ ] **Step 3: The detail block**

In `PhaseDetail.tsx` add the props listed above to `PhaseDetailProps`, and after the "You paste" block render:

```tsx
          {(p.proof || p.markerCommand) && (
          <div className="flex flex-col gap-2">
            <Eyebrow>{p.proof ? "Done because" : "To mark it done"}</Eyebrow>
            {p.proof && <p className="text-[12.5px] text-text-secondary">{p.proof}</p>}
            {!p.proof && p.markerCommand && (
              <>
                <p className="text-[12.5px] text-text-secondary">
                  When the work is saved, the agent adds this line to the commit message. Or close it yourself:
                </p>
                <button
                  type="button"
                  onClick={() => p.onCopyCommand?.(p.markerCommand ?? "")}
                  className="w-fit rounded-md bg-fill-subtle px-2.5 py-1.5 text-left font-mono text-[11.5px] text-text-primary hover:bg-fill-hover"
                  title="Copy"
                >
                  {p.markerCommand}
                </button>
              </>
            )}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              {!p.proof && p.onMarkDone && (
                <BtnSecondary size="sm" onClick={p.onMarkDone}>Mark done</BtnSecondary>
              )}
              {p.proof && p.onMarkNotDone && (
                <BtnSecondary size="sm" onClick={p.onMarkNotDone} disabled={!!p.markNotDoneBlocked}>Mark not done</BtnSecondary>
              )}
              {p.markNotDoneBlocked && <span className="text-[11.5px] text-text-subtle">{p.markNotDoneBlocked}</span>}
            </div>
          </div>
          )}
```

`PhaseDetailHost.tsx`: accept `onMarkDone`, `onMarkNotDone`, `onCopyCommand` props and pass through; compute `proof={proofSentence(status?.proof)}`, `markerCommand={fixRound == null ? markerCommand(id) : undefined}`, and

```ts
      markNotDoneBlocked={
        status?.proof && !status.proof.startsWith("ledger ")
          ? "Still proved by the repo: remove the tag, marker or file first."
          : null
      }
```

`RoadmapPane.tsx` where `PhaseDetailHost` is mounted:

```tsx
          onCopyCommand={(cmd) => { void copyText(cmd); toastSuccess("Copied"); }}
          onMarkDone={() =>
            onConfirm({
              title: `Mark ${phase.id} done?`,
              body: "Chronicle records it in the done ledger. Nothing in your project changes. You can undo this from the same place.",
              cancelLabel: "Not yet", confirmLabel: "Mark done",
              onConfirm: () => { ledgerMark(dir, phase.id ?? "?", true).catch((e) => toastError("Couldn't mark it", String(e).slice(0, 90))); },
            })}
          onMarkNotDone={() =>
            onConfirm({
              title: `Mark ${phase.id} not done?`,
              body: "The ledger entry is removed. If a tag, marker or file still proves it, it comes straight back on the next scan.",
              cancelLabel: "Keep it", confirmLabel: "Mark not done",
              onConfirm: () => { ledgerMark(dir, phase.id ?? "?", false).catch((e) => toastError("Couldn't change it", String(e).slice(0, 90))); },
            })}
```

Import `ledgerMark` and `copyText` from `@/lib/ipc` and `toastSuccess`/`toastError` from `@/overlays/toasts` (check the existing imports in the file and reuse them; `copyText` already exists as the `copy_text` command wrapper — find its exported name with `grep -n copy_text src/lib/ipc.ts`).

- [ ] **Step 4: Run the checks and commit**

Run: `npm test -- src/lib/roadmap-data.test.ts && npm run typecheck`
Expected: pass.

```bash
git add src/lib/roadmap-data.ts src/lib/roadmap-data.test.ts src/screens/roadmap/PhaseDetail.tsx src/screens/roadmap/PhaseDetailHost.tsx src/screens/roadmap/RoadmapPane.tsx
git commit -m "feat(roadmap): phase detail says what proved a phase, shows the marker command, and lets you mark it done or not"
```

---

### Task 8: The CLI prints proofs and findings; live check on this repo

**Files:**
- Modify: `src-tauri/src/main.rs` (`derive_for_dir` — already extended in Tasks 3 and 4; verify the shape)
- Modify: `skill/chronicle-init/SCHEMA.md` (CLI section)
- Modify: `docs/superpowers/specs/2026-09-13-roadmap-accuracy-design.md` (record the three deviations)

- [ ] **Step 1: Build and derive this repo**

Run: `cd src-tauri && cargo build --release 2>&1 | tail -2 && ./target/release/chronicle --derive .. | python3 -c "import json,sys; d=json.load(sys.stdin); print([(s['id'],s['state'],s.get('proof')) for s in d['statuses'] if s['id'] in ('SE','M-1','M-2','AA')]); print(d['new_plans']); print(d['newer_release'])"`

Expected: SE is `done` with proof `commit_subject 1d75d57` (the queue-doc commit matches `(?i)per-step evidence`; that is the rule the manifest wrote, not a judgement about SE). M-1 is `now` (no marker yet). `new_plans` lists the four September specs and plans; `newer_release` is `["v0.8.1", "v0.5.1"]`.

- [ ] **Step 2: Close M-1 with a marker and see it latch**

Run:
```bash
git commit --allow-empty -m "Close M-1" -m "Chronicle-Phase: M-1 done"
./src-tauri/target/release/chronicle --derive . | python3 -c "import json,sys; d=json.load(sys.stdin); print([(s['id'],s['state'],s.get('proof')) for s in d['statuses'] if s['id'] in ('M-1','M-2')])"
cat .chronicle/roadmap-ledger.json
```
Expected: M-1 `done` with `marker <hash>`, M-2 `now`; the ledger holds SE and M-1 (and every other done phase, each with its proof).

- [ ] **Step 3: Update the CLI doc and the spec**

In `SCHEMA.md` "CLI" section: `chronicle --derive <project-dir>` prints `{ "name", "statuses": [{id, state, label, proof?}], "new_plans", "newer_release", "ledger_set_aside", "warnings" }`.

In the spec, add a short "Implementation notes (2026-09-13)" section at the end recording: round ids are `FX-<n>`; `at` is epoch ms; the refresh reuses the background init session with a note instead of the agent pane; `StaleAlert` was replaced by the rows; the marker command is the two-message form; the behind rows have no "Not now" suppression.

- [ ] **Step 4: Full verification**

Run: `cd src-tauri && cargo test 2>&1 | tail -3; cd .. && npm test 2>&1 | tail -3 && npm run typecheck`
Expected: every suite green.

- [ ] **Step 5: Commit**

```bash
git add skill/chronicle-init/SCHEMA.md docs/superpowers/specs/2026-09-13-roadmap-accuracy-design.md
git commit -m "docs(roadmap): the derive CLI shape, and the spec's implementation notes"
```

- [ ] **Step 6: Live check in the app (the user does the keyboard steps)**

Build and sign a local bundle (`npm run tauri:build && npm run sign-local`), open this repo, and check: the roadmap shows SE and M-1 done; "What needs you" lists the four September specs/plans and "v0.8.1 shipped, the roadmap ends at v0.5.1", each with "Bring it up to date"; clicking it confirms, runs the refresh session, and the resulting `chronicle.json` diff in the Repo pane adds phases for energy, the Web pane, notes and repo editing. Open M-2's detail: it shows the marker command and "Mark done"; M-1's detail says "Proved by a marker commit".
