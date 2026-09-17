# The Design pane, foundation · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A fifth rail pane, Design: a second Claude Code session writes HTML frames into `.chronicle/designs/<slug>/`, a zoomable canvas renders them safely, and every turn is a restorable version.

**Architecture:** The ACP layer gains a `Lane` (chat | design) so two sessions live per project with separate keys, storage and policy; the design lane is fenced to `.chronicle/designs/` in three layers. A new Rust `designs` module owns the folder (model files, management, versions, thumbnails, protocol headers, watcher). The frontend carries the lane inside the existing store key (`<dir>#design`), adds a design model/store, and a Design pane made of a sidebar, an iframe canvas and the reused agent thread.

**Tech Stack:** Rust (Tauri 2, notify 6, objc2 / objc2-web-kit / block2, serde_json, sha2), TypeScript + React 19, Vitest, the pinned ACP adapter `@agentclientprotocol/claude-agent-acp@0.75.1`.

**Spec:** `docs/superpowers/specs/2026-09-17-design-pane-foundation-design.md` (read it first; this plan argues from it). Comps: `design/comps/design-pane/*.dc.html` (source of truth for layout and copy; open them in a browser, or read `gen.py` for exact sizes and strings).

## Global Constraints

- Work on branch `react-shadcn` in place (no worktree). Never `git stash`, `reset`, or `checkout` in the shared tree; another lane may be writing files. Commit only the files your task names.
- Dark theme only. Use design tokens (`--surface-*`, `--text-*`, `--border-*`, `--state-*`), never raw hex in app UI (hex is allowed only inside design frames and tests).
- Meaningful small text uses `--text-faint` (or brighter), never `--text-dim`/`--text-dimmer` (they fail WCAG AA).
- Copy register: plain language, sentence case, errors say what happened and the one next step; no "MCP", "ACP", "Playwright", "CLI" in headlines.
- No bare `setTimeout`/`setInterval` in scanned frontend files: use `every()` from `@/lib/scheduler`, or add `// timer-ok: <why>` plus an `ALLOWED` entry in `src/lib/no-bare-timers.test.ts`.
- In-app drag and drop is pointer-event driven (`elementFromPoint` hit tests). HTML5 drag and drop does not work in this webview.
- `acp::ledger` (edit ledger, in `src-tauri/src/acp.rs`) is not `crate::ledger` (roadmap ledger, `src-tauri/src/ledger.rs`).
- Every new `#[tauri::command]` goes in `tauri::generate_handler![…]` in `src-tauri/src/main.rs`; `build.rs` derives the ACL from that list automatically.
- Design lane key suffix is exactly `#design`. Design kinds are exactly `app`, `marketing`, `deck`, `brand`, `ecommerce`.
- Designs folder: `notes::index::vault_root(project).join(".chronicle/designs")`. Its `.gitignore` contains exactly `*\n`.
- Idle stop: 15 minutes with no turn running. Watcher debounce: 250 ms trailing per design. Live iframes: at most 6, only at ≥ 15% zoom.
- Rust tests: `cd src-tauri && cargo test <name>` (put `$HOME/.cargo/bin` on PATH first). Frontend tests: `npx vitest run <file>`. Typecheck: `npx tsc --noEmit -p .`.
- Commit messages follow the repo style `type(scope): plain sentence`, ending with the line `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.

## File map

Rust (`src-tauri/src/`):
- `acp.rs` — modify: `Lane`, per-lane store for `ledger`/`transcript`, lane on events, design fence (permission auto-answers, write jail, outside-change reconcile), session `_meta`, mode lock, idle watchdog.
- `designs/mod.rs` — create: folder root, `.gitignore`, slugs, `design.json`/`canvas.json`/`order.json` IO with `.bad`, list, create, rename, kind, trash/untrash, Tauri commands.
- `designs/versions.rs` — create: content hash, snapshot-if-changed, list, restore, branch/duplicate.
- `designs/frame.rs` — create: protocol headers and reporter injection for design HTML.
- `designs/thumbs.rs` — create: hidden native web view snapshots.
- `designs/prompt.rs` — create: the basic design-lane system prompt and session `_meta`.
- `main.rs` — modify: `mod designs;`, lane param on `agent_*` commands, new commands in `generate_handler!`, protocol response headers, watcher routing.
- `web.rs` — modify: `serve_project_file` returns extra headers; root registration helper.
- `agent_api.rs`, `cli.rs`, `mcp.rs` — modify: `chronicle.designs.list` / `.read`.
- `tauri.conf.json` — modify: CSP `frame-src chronicle-file:`.

Frontend (`src/`):
- `lib/agent-session.ts`, `lib/ipc.ts` — modify: lane keys, lane-aware IPC, new reducer methods.
- `lib/design-model.ts` — create: types, parsing, default placement, reading order.
- `lib/canvas-math.ts` — create: zoom/pan/fit, live-frame choice.
- `lib/design-store.ts` — create: per-project design list, active design, frame states, undo stack, turn-end snapshots, send-with-resume.
- `components/chrome/Rail.tsx`, `components/chrome/icons.tsx`, `App.tsx` — modify: Design pane wiring.
- `screens/design/DesignPane.tsx`, `DesignSidebar.tsx`, `DesignCanvas.tsx`, `FrameView.tsx`, `Minimap.tsx`, `DesignThread.tsx`, `NewDesign.tsx`, `HistoryPanel.tsx`, `CanvasToolbar.tsx` — create.
- `lib/__fixtures__/design-lane.jsonl` + `lib/agent-session.design.test.ts` — create.

Docs: `docs/agent-api.md`, `skill/chronicle/SKILL.md` — modify. `chronicle.json` — commit the Part 17 phases already present in the working tree (Task 20).

---

## Phase A · The second lane (Rust)

### Task 1: `Lane` and per-lane storage in `acp.rs`

**Files:**
- Modify: `src-tauri/src/acp.rs` (ledger module ~80-314, transcript module ~323-409, checkpoint `snapshot_tree`/`create` ~413-543, `AcpSession` ~563-598, `start` ~653-723, `emit_msg` ~744, `handshake` ~811-894, `stop` ~1293, `reconcile_turn_end` ~1311, tests ~1344+)
- Modify: `src-tauri/src/main.rs` (every caller of `acp::ledger::*` and `acp::transcript::*`, the two `acp::start` calls ~3210 and ~3228)

**Interfaces:**
- Produces:
  - `pub enum Lane { Chat, Design }` with `pub fn parse(s: Option<&str>) -> Result<Lane, String>`, `pub fn as_str(self) -> &'static str`, `pub fn key(self, canon: &str) -> String`, `pub fn store(self, project: &Path) -> PathBuf`.
  - `acp::start(state, emit, key: String, lane: Lane, cwd, project_dir, roots, resume, cmd)` (new `lane` after `key`).
  - Every `ledger::*` and `transcript::*` function's first path parameter is now `store: &Path` (the lane's storage dir), not the project dir. `ledger::agent_dir(project)` stays and is the chat store.
  - `checkpoint::snapshot_tree_as(repo: &Path, tag: &str)` and `checkpoint::create_as(repo: &Path, sid: &str, tag: &str)`; `snapshot_tree`/`create` keep their signatures and call the `_as` versions with tag `"chat"`.
  - Every emitted `acp-update` payload is `{ "dir": <canonical project path>, "lane": "chat"|"design", "message": … }`.

- [ ] **Step 1: Write the failing tests** (append inside `mod acp_tests`)

```rust
#[test]
fn lanes_parse_key_and_store() {
    assert_eq!(Lane::parse(None).unwrap(), Lane::Chat);
    assert_eq!(Lane::parse(Some("chat")).unwrap(), Lane::Chat);
    assert_eq!(Lane::parse(Some("design")).unwrap(), Lane::Design);
    assert!(Lane::parse(Some("other")).is_err());
    assert_eq!(Lane::Chat.key("/p"), "/p");
    assert_eq!(Lane::Design.key("/p"), "/p#design");
    let d = tmp("lane-store");
    assert_eq!(Lane::Chat.store(&d), d.join(".chronicle/agent"));
    assert_eq!(Lane::Design.store(&d), d.join(".chronicle/designs/.threads"));
}

#[test]
fn two_lanes_live_at_once_and_events_carry_their_lane() {
    let Some(h) = start_mock("two-lanes") else { return };
    let py = python3().unwrap();
    let script = h.dir.join(".mock-agent.py");
    let mut cmd = std::process::Command::new(py);
    cmd.arg(&script).arg(&h.dir);
    let (tx, rx2) = mpsc::channel::<Value>();
    let emit: Emit = Arc::new(move |v| { let _ = tx.send(v); });
    let dkey = Lane::Design.key(&h.key);
    assert!(start(&h.state, emit, dkey.clone(), Lane::Design, h.dir.clone(), h.dir.clone(), vec![h.dir.clone()], None, cmd).unwrap());
    let chat_ready = wait_for(&h.rx, 20, |v| state_is(v, "ready"));
    let design_ready = wait_for(&rx2, 20, |v| state_is(v, "ready"));
    assert_eq!(chat_ready["lane"], "chat");
    assert_eq!(chat_ready["dir"], h.key.as_str());
    assert_eq!(design_ready["lane"], "design");
    assert_eq!(design_ready["dir"], h.key.as_str());
    assert!(h.state.get(&h.key).is_some());
    assert!(h.state.get(&dkey).is_some());
    // separate `current` pointers
    assert!(Lane::Chat.store(&h.dir).join("current").exists());
    assert!(Lane::Design.store(&h.dir).join("current").exists());
    h.state.get(&dkey).unwrap().stop(false);
    assert!(h.state.get(&h.key).is_some(), "stopping the design lane leaves chat alive");
    h.state.drain();
}
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd src-tauri && cargo test lanes_parse_key_and_store two_lanes_live_at_once -- --nocapture`
Expected: compile errors (`Lane` not found, `start` takes 8 arguments).

- [ ] **Step 3: Implement `Lane`** (top of `acp.rs`, after the constants)

```rust
/// Which of a project's two agent sessions a key belongs to. The chat lane keeps
/// the historic key (the canonical project path) and `.chronicle/agent/`; the
/// design lane gets `<path>#design` and keeps its records beside the designs.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Lane { Chat, Design }

impl Lane {
    pub fn parse(s: Option<&str>) -> Result<Lane, String> {
        match s {
            None | Some("chat") => Ok(Lane::Chat),
            Some("design") => Ok(Lane::Design),
            Some(other) => Err(format!("there's no agent lane called {other}")),
        }
    }
    pub fn as_str(self) -> &'static str { match self { Lane::Chat => "chat", Lane::Design => "design" } }
    pub fn key(self, canon: &str) -> String {
        match self { Lane::Chat => canon.to_string(), Lane::Design => format!("{canon}#design") }
    }
    /// Where this lane's transcripts, ledger and `current` pointer live.
    pub fn store(self, project: &Path) -> PathBuf {
        match self {
            Lane::Chat => ledger::agent_dir(project),
            Lane::Design => crate::designs::designs_root(project).join(".threads"),
        }
    }
}
```

`crate::designs::designs_root` is created in Task 3. For this task add a minimal `src-tauri/src/designs/mod.rs` containing only:

```rust
//! The Design pane's folder: `.chronicle/designs/` in the project (or the main
//! checkout when the project is a linked worktree). Filled in by later tasks.
use std::path::{Path, PathBuf};

pub fn designs_root(project: &Path) -> PathBuf {
    crate::notes::index::vault_root(project).join(".chronicle/designs")
}
```

and `mod designs;` next to the other `mod` lines in `main.rs`.

- [ ] **Step 4: Make ledger and transcript take a store dir**

In `mod ledger`: keep `pub fn agent_dir(project: &Path) -> PathBuf` unchanged. Change `current_file`, `set_current_session`, `clear_current_session`, `current_session`, `bases_dir`, `index_path`, `load_index`, `save_index`, `record_base`, `files`, `diff`, `keep`, `undo`, `clear` so their first parameter is `store: &Path` and every internal `agent_dir(project)` becomes `store`:

```rust
fn current_file(store: &Path) -> PathBuf { store.join("current") }
pub fn set_current_session(store: &Path, sid: &str) {
    let _ = std::fs::create_dir_all(store);
    let _ = std::fs::write(current_file(store), sid);
}
fn bases_dir(store: &Path, sid: &str) -> PathBuf { store.join(sid).join("bases") }
```

In `mod transcript`: `path(store, sid) = store.join(sid).join("thread.jsonl")`; `save_caps(store, …)` writes `store.join("caps.json")`; `load_session_supported(store)`; `sessions_list(store, live)` scans `store`; `read(store, sid)`.

- [ ] **Step 5: Thread the lane through the session**

Add fields to `AcpSession`: `lane: Lane,` and `store: PathBuf,`. In `start`, add the `lane: Lane` parameter after `key`, and set `lane, store: lane.store(&project_dir)` in the struct literal. Replace every `&self.project_dir` passed to `ledger::` or `transcript::` inside `impl AcpSession` with `&self.store`.

Change `emit_msg`:

```rust
fn emit_msg(&self, message: Value) {
    let dir = self.key.strip_suffix("#design").unwrap_or(&self.key);
    (self.emit)(json!({ "dir": dir, "lane": self.lane.as_str(), "message": message }));
}
```

In `mod checkpoint`, rename the body of `snapshot_tree` to `pub fn snapshot_tree_as(repo: &Path, tag: &str)` and include `tag` in the temp-index name (the name is currently derived from sha(repo) + pid; append `-{tag}`). `pub fn snapshot_tree(repo: &Path) -> Result<String, String> { snapshot_tree_as(repo, "chat") }`. Same for `create` → `create_as(repo, sid, tag)` calling `snapshot_tree_as`. In `AcpSession::prompt`, call `checkpoint::create_as(&self.repo, &sid, self.lane.as_str())`, and in `reconcile_turn_end` call `snapshot_tree_as(&self.repo, self.lane.as_str())`.

Update both `AcpSession { … }` literals in the tests (`jail_refuses_relative_traversal_and_outside_paths`, `turn_end_reconciliation_finds_command_changes_only`) with `lane: Lane::Chat, store: ledger::agent_dir(&d),` (use the variable those tests already use for the project dir). Update `start_mock` to pass `Lane::Chat`. Fix every test call to `ledger::`/`transcript::` to pass `&ledger::agent_dir(&d)`.

- [ ] **Step 6: Update `main.rs` callers**

Both `acp::start(...)` calls get `acp::Lane::Chat` after `key` (Task 2 makes this dynamic). Every `acp::ledger::X(&p.dir, …)` and `acp::transcript::X(&p.dir, …)` becomes `acp::ledger::X(&acp::ledger::agent_dir(&p.dir), …)`. `emit_edits_changed` adds `"lane": "chat"` to its payload.

- [ ] **Step 7: Run tests**

Run: `cd src-tauri && cargo test acp_tests`
Expected: all pass, including the two new tests (the mock-agent tests skip themselves when `python3` is absent).

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/acp.rs src-tauri/src/main.rs src-tauri/src/designs/mod.rs
git commit -m "feat(agent): two lanes per project, each with its own key, records and events"
```

### Task 2: The lane on every `agent_*` command

**Files:**
- Modify: `src-tauri/src/main.rs` (`agent_session_start` ~3199, `agent_session_resume` ~3217, `agent_sessions_list` ~3234, `agent_history_read` ~3246, `agent_session_state` ~3340, `agent_for` ~3346, `agent_prompt`, `agent_cancel`, `agent_set_mode`, `agent_set_config_option`, `agent_respond_permission` ~3377, `agent_session_stop` ~3386)

**Interfaces:**
- Consumes: `acp::Lane` (Task 1).
- Produces: each command above takes an extra `lane: Option<String>` argument (JSON field `lane`), default chat. `fn agent_for(roots, agents, dir: &str, lane: acp::Lane)`. `fn session_key(dir: &str, lane: acp::Lane) -> Result<String, String>`. The `agent_edits*` and `agent_restore_checkpoint` commands stay chat-only.

- [ ] **Step 1: Write the failing test** (in `main.rs` tests near `canon_key_is_collision_free_for_same_named_dirs`)

```rust
#[test]
fn session_keys_follow_the_lane() {
    let d = std::env::temp_dir().join(format!("chronicle-lane-key-{}", std::process::id()));
    std::fs::create_dir_all(&d).unwrap();
    let canon = d.canonicalize().unwrap().to_string_lossy().to_string();
    assert_eq!(session_key(d.to_str().unwrap(), acp::Lane::Chat).unwrap(), canon);
    assert_eq!(session_key(d.to_str().unwrap(), acp::Lane::Design).unwrap(), format!("{canon}#design"));
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd src-tauri && cargo test session_keys_follow_the_lane`
Expected: FAIL, `session_key` not found.

- [ ] **Step 3: Implement**

```rust
fn session_key(dir: &str, lane: acp::Lane) -> Result<String, String> {
    let (canon, _) = canon_key(dir)?;
    Ok(lane.key(&canon))
}

fn agent_for(roots: &OpenRoots, agents: &acp::AcpState, dir: &str, lane: acp::Lane) -> Result<Arc<acp::AcpSession>, String> {
    let _ = project_for(roots, dir)?;
    let key = session_key(dir, lane)?;
    agents.get(&key).ok_or_else(|| match lane {
        acp::Lane::Chat => "there's no agent session running for this project".to_string(),
        acp::Lane::Design => "the design session isn't running".to_string(),
    })
}
```

For every command listed above, add the parameter `lane: Option<String>`, compute `let lane = acp::Lane::parse(lane.as_deref())?;`, and pass `lane` to `agent_for` / `session_key`. In `agent_session_start` and `agent_session_resume`, replace `let (key, _) = canon_key(&dir)?;` with `let key = session_key(&dir, lane)?;` and pass `lane` to `acp::start`. In `agent_sessions_list` and `agent_history_read`, use `lane.store(&p.dir)` instead of `acp::ledger::agent_dir(&p.dir)`. In `agent_session_start`/`resume` for `Lane::Design`, call `designs::ensure_root(&p.dir)?;` before `acp::start` (`ensure_root` arrives in Task 3; until then this line is added in Task 3, Step 5).

- [ ] **Step 4: Run tests**

Run: `cd src-tauri && cargo test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/main.rs
git commit -m "feat(agent): every session command takes a lane, chat unless it says design"
```

### Task 3: The designs folder, its files, and managing designs

**Files:**
- Modify: `src-tauri/src/designs/mod.rs`
- Modify: `src-tauri/src/main.rs` (register commands; `ensure_root` call from Task 2 Step 3)
- Test: inline `#[cfg(test)] mod tests` in `designs/mod.rs`

**Interfaces:**
- Produces (Rust):
  - `pub const KINDS: [&str; 5] = ["app", "marketing", "deck", "brand", "ecommerce"];`
  - `pub fn designs_root(project: &Path) -> PathBuf` (Task 1), `pub fn ensure_root(project: &Path) -> Result<PathBuf, String>`
  - `pub fn slugify(title: &str) -> String`, `pub fn valid_slug(s: &str) -> bool`, `pub fn unique_slug(root: &Path, base: &str) -> String`
  - `pub fn design_dir(project: &Path, slug: &str) -> Result<PathBuf, String>` (validates slug)
  - `pub fn read_json_or_bad(path: &Path) -> Result<Option<Value>, ()>` — `Ok(None)` missing, `Err(())` unreadable (renamed to `.json.bad`)
  - `#[derive(Serialize)] #[serde(rename_all = "camelCase")] pub struct DesignRow { pub slug: String, pub title: String, pub kind: String, pub frames: usize, pub created: String, pub latest_version: Option<u32>, pub updated_ms: u64, pub bad: bool }`
  - `pub fn list(project: &Path) -> Vec<DesignRow>` (sorted by `updated_ms` desc)
  - `pub fn create(project: &Path, kind: &str, title: &str, brief: &str, now_iso: &str) -> Result<String, String>`
  - `pub fn rename(project: &Path, slug: &str, title: &str) -> Result<(), String>`
  - `pub fn set_kind(project: &Path, slug: &str, kind: &str) -> Result<(), String>`
  - `pub fn trash(project: &Path, slug: &str, ms: u128) -> Result<String, String>` → returns `.chronicle/trash/designs/<slug>-<ms>`
  - `pub fn untrash(project: &Path, trash_rel: &str) -> Result<String, String>` → returns the restored slug
- Produces (Tauri commands; all `dir: String`, all run `project_for` first):
  - `designs_list(dir) -> { rows: DesignRow[], order: Value }`
  - `design_create(dir, kind, title, brief) -> String`
  - `design_read(dir, slug) -> { design: Value|null, canvas: Value, bad: bool }`
  - `design_rename(dir, slug, title)`, `design_set_kind(dir, slug, kind)`
  - `design_trash(dir, slug) -> String`, `design_untrash(dir, trash_rel) -> String`
  - `design_canvas_save(dir, slug, canvas: Value)`, `designs_order_save(dir, order: Value)`

- [ ] **Step 1: Write the failing tests** (in `designs/mod.rs`)

```rust
#[cfg(test)]
mod tests {
    use super::*;
    fn proj(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("chronicle-designs-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d.canonicalize().unwrap()
    }

    #[test]
    fn the_folder_ignores_itself() {
        let p = proj("ignore");
        let root = ensure_root(&p).unwrap();
        assert_eq!(std::fs::read_to_string(root.join(".gitignore")).unwrap(), "*\n");
    }

    #[test]
    fn slugs_are_plain_and_unique() {
        assert_eq!(slugify("Product page · Ethiopia Guji!"), "product-page-ethiopia-guji");
        assert_eq!(slugify("   "), "design");
        assert!(valid_slug("a-b-2") && !valid_slug("../x") && !valid_slug("A") && !valid_slug(""));
        let p = proj("unique");
        let root = ensure_root(&p).unwrap();
        std::fs::create_dir_all(root.join("home")).unwrap();
        assert_eq!(unique_slug(&root, "home"), "home-2");
    }

    #[test]
    fn create_list_rename_kind_trash_untrash() {
        let p = proj("manage");
        let slug = create(&p, "ecommerce", "Product page", "a brief", "2026-09-17T10:00:00Z").unwrap();
        assert_eq!(slug, "product-page");
        let d: Value = serde_json::from_str(&std::fs::read_to_string(designs_root(&p).join("product-page/design.json")).unwrap()).unwrap();
        assert_eq!(d["v"], 1); assert_eq!(d["kind"], "ecommerce"); assert_eq!(d["frames"], json!([]));
        assert!(create(&p, "poster", "x", "", "t").is_err());
        rename(&p, &slug, "Guji page").unwrap();
        set_kind(&p, &slug, "marketing").unwrap();
        let rows = list(&p);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].title, "Guji page"); assert_eq!(rows[0].kind, "marketing"); assert_eq!(rows[0].slug, "product-page");
        let t = trash(&p, &slug, 42).unwrap();
        assert_eq!(t, ".chronicle/trash/designs/product-page-42");
        assert!(list(&p).is_empty());
        assert_eq!(untrash(&p, &t).unwrap(), "product-page");
        assert_eq!(list(&p).len(), 1);
    }

    #[test]
    fn unreadable_files_are_set_aside() {
        let p = proj("bad");
        let slug = create(&p, "app", "Dash", "", "t").unwrap();
        let f = designs_root(&p).join(&slug).join("design.json");
        std::fs::write(&f, "{not json").unwrap();
        assert!(read_json_or_bad(&f).is_err());
        assert!(f.with_extension("json.bad").exists());
        let rows = list(&p);
        assert!(rows[0].bad);
    }
}
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd src-tauri && cargo test designs::tests`
Expected: compile errors for the missing functions.

- [ ] **Step 3: Implement** (append to `designs/mod.rs`)

```rust
use serde::Serialize;
use serde_json::{json, Value};

pub mod versions;
pub mod frame;
pub mod prompt;
pub mod thumbs;

pub const KINDS: [&str; 5] = ["app", "marketing", "deck", "brand", "ecommerce"];

pub fn ensure_root(project: &Path) -> Result<PathBuf, String> {
    let root = designs_root(project);
    std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    let gi = root.join(".gitignore");
    if std::fs::read_to_string(&gi).ok().as_deref() != Some("*\n") {
        std::fs::write(&gi, "*\n").map_err(|e| e.to_string())?;
    }
    Ok(root)
}

pub fn slugify(title: &str) -> String {
    let mut out = String::new();
    let mut dash = false;
    for c in title.to_lowercase().chars() {
        if c.is_ascii_alphanumeric() { out.push(c); dash = false; }
        else if !dash && !out.is_empty() { out.push('-'); dash = true; }
        if out.len() >= 60 { break; }
    }
    let s = out.trim_matches('-').to_string();
    if s.is_empty() { "design".into() } else { s }
}

pub fn valid_slug(s: &str) -> bool {
    !s.is_empty() && s.len() <= 80
        && s.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
        && !s.starts_with('-')
}

pub fn unique_slug(root: &Path, base: &str) -> String {
    if !root.join(base).exists() { return base.to_string(); }
    (2..).map(|n| format!("{base}-{n}")).find(|s| !root.join(s).exists()).unwrap()
}

pub fn design_dir(project: &Path, slug: &str) -> Result<PathBuf, String> {
    if !valid_slug(slug) { return Err("that isn't a design name Chronicle made".into()); }
    let d = designs_root(project).join(slug);
    if !d.is_dir() { return Err("that design isn't here any more".into()); }
    Ok(d)
}

pub fn read_json_or_bad(path: &Path) -> Result<Option<Value>, ()> {
    let Ok(text) = std::fs::read_to_string(path) else { return Ok(None) };
    match serde_json::from_str::<Value>(&text) {
        Ok(v) if v.is_object() => Ok(Some(v)),
        _ => { let _ = std::fs::rename(path, path.with_extension("json.bad")); Err(()) }
    }
}

fn write_json(path: &Path, v: &Value) -> Result<(), String> {
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_string_pretty(v).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, path).map_err(|e| e.to_string())
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DesignRow {
    pub slug: String, pub title: String, pub kind: String, pub frames: usize,
    pub created: String, pub latest_version: Option<u32>, pub updated_ms: u64, pub bad: bool,
}

fn modified_ms(p: &Path) -> u64 {
    std::fs::metadata(p).and_then(|m| m.modified()).ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis() as u64).unwrap_or(0)
}

pub fn list(project: &Path) -> Vec<DesignRow> {
    let root = designs_root(project);
    let Ok(rd) = std::fs::read_dir(&root) else { return vec![] };
    let mut rows: Vec<DesignRow> = rd.flatten()
        .filter(|e| e.path().is_dir())
        .filter_map(|e| {
            let slug = e.file_name().to_string_lossy().to_string();
            if !valid_slug(&slug) { return None; }
            let f = e.path().join("design.json");
            let (d, bad) = match read_json_or_bad(&f) {
                Ok(Some(v)) => (v, false),
                Ok(None) if f.with_extension("json.bad").exists() => (json!({}), true),
                Ok(None) => return None,
                Err(()) => (json!({}), true),
            };
            Some(DesignRow {
                title: d["title"].as_str().unwrap_or(&slug).to_string(),
                kind: d["kind"].as_str().unwrap_or("app").to_string(),
                frames: d["frames"].as_array().map(|a| a.len()).unwrap_or(0),
                created: d["created"].as_str().unwrap_or("").to_string(),
                latest_version: versions::latest(&e.path()),
                updated_ms: modified_ms(&e.path()).max(modified_ms(&f)),
                slug, bad,
            })
        })
        .collect();
    rows.sort_by(|a, b| b.updated_ms.cmp(&a.updated_ms));
    rows
}

pub fn create(project: &Path, kind: &str, title: &str, brief: &str, now_iso: &str) -> Result<String, String> {
    if !KINDS.contains(&kind) { return Err(format!("{kind} isn't a kind of design Chronicle knows")); }
    let root = ensure_root(project)?;
    let slug = unique_slug(&root, &slugify(title));
    let dir = root.join(&slug);
    std::fs::create_dir_all(dir.join("frames")).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(dir.join("assets")).map_err(|e| e.to_string())?;
    write_json(&dir.join("design.json"), &json!({
        "v": 1, "title": title.trim(), "kind": kind, "brief": brief, "created": now_iso,
        "frames": [], "groups": [], "chosen": null
    }))?;
    write_json(&dir.join("canvas.json"), &json!({ "positions": {}, "viewport": null }))?;
    Ok(slug)
}

fn edit_design(project: &Path, slug: &str, f: impl FnOnce(&mut serde_json::Map<String, Value>)) -> Result<(), String> {
    let path = design_dir(project, slug)?.join("design.json");
    let mut v = match read_json_or_bad(&path) { Ok(Some(v)) => v, _ => return Err("couldn't read this design".into()) };
    f(v.as_object_mut().unwrap());
    write_json(&path, &v)
}

pub fn rename(project: &Path, slug: &str, title: &str) -> Result<(), String> {
    let t = title.trim();
    if t.is_empty() { return Err("a design needs a name".into()); }
    edit_design(project, slug, |m| { m.insert("title".into(), json!(t)); })
}

pub fn set_kind(project: &Path, slug: &str, kind: &str) -> Result<(), String> {
    if !KINDS.contains(&kind) { return Err(format!("{kind} isn't a kind of design Chronicle knows")); }
    edit_design(project, slug, |m| { m.insert("kind".into(), json!(kind)); })
}

pub fn trash(project: &Path, slug: &str, ms: u128) -> Result<String, String> {
    let src = design_dir(project, slug)?;
    let base = crate::notes::index::vault_root(project);
    let trash = base.join(".chronicle/trash/designs");
    std::fs::create_dir_all(&trash).map_err(|e| e.to_string())?;
    let name = format!("{slug}-{ms}");
    std::fs::rename(&src, trash.join(&name)).map_err(|e| e.to_string())?;
    Ok(format!(".chronicle/trash/designs/{name}"))
}

pub fn untrash(project: &Path, trash_rel: &str) -> Result<String, String> {
    let name = trash_rel.strip_prefix(".chronicle/trash/designs/").ok_or("that isn't a trashed design")?;
    if name.contains('/') || name.contains("..") { return Err("that isn't a trashed design".into()); }
    let slug_base = name.rsplit_once('-').map(|(s, _)| s).unwrap_or(name);
    if !valid_slug(slug_base) { return Err("that isn't a trashed design".into()); }
    let base = crate::notes::index::vault_root(project);
    let root = ensure_root(project)?;
    let slug = unique_slug(&root, slug_base);
    std::fs::rename(base.join(trash_rel), root.join(&slug)).map_err(|e| e.to_string())?;
    Ok(slug)
}
```

Create empty placeholder modules so it compiles: `designs/versions.rs` with `pub fn latest(_: &std::path::Path) -> Option<u32> { None }`, and empty `designs/frame.rs`, `designs/prompt.rs`, `designs/thumbs.rs` (each with a one-line `//!` doc comment). Tasks 5–9 fill them.

- [ ] **Step 4: Run tests**

Run: `cd src-tauri && cargo test designs::tests`
Expected: 4 passed.

- [ ] **Step 5: Add the Tauri commands** (in `designs/mod.rs`, then list them in `generate_handler!` as `designs::designs_list, designs::design_create, …`)

```rust
use tauri::State;
use crate::{project_for, OpenRoots};

fn now_iso() -> String { chrono_like_now() }
/// RFC 3339 UTC without pulling a date crate: seconds precision is enough here.
fn chrono_like_now() -> String {
    let secs = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    crate::iso8601_utc(secs)
}

#[tauri::command]
pub fn designs_list(roots: State<OpenRoots>, dir: String) -> Result<Value, String> {
    let p = project_for(&roots, &dir)?;
    let order = match read_json_or_bad(&designs_root(&p.dir).join("order.json")) { Ok(Some(v)) => v, _ => json!({}) };
    Ok(json!({ "rows": list(&p.dir), "order": order }))
}
#[tauri::command]
pub fn design_create(roots: State<OpenRoots>, dir: String, kind: String, title: String, brief: String) -> Result<String, String> {
    let p = project_for(&roots, &dir)?;
    create(&p.dir, &kind, &title, &brief, &now_iso())
}
#[tauri::command]
pub fn design_read(roots: State<OpenRoots>, dir: String, slug: String) -> Result<Value, String> {
    let p = project_for(&roots, &dir)?;
    let d = design_dir(&p.dir, &slug)?;
    let (design, bad) = match read_json_or_bad(&d.join("design.json")) { Ok(v) => (v.unwrap_or(Value::Null), false), Err(()) => (Value::Null, true) };
    let canvas = match read_json_or_bad(&d.join("canvas.json")) { Ok(Some(v)) => v, _ => json!({ "positions": {}, "viewport": null }) };
    Ok(json!({ "design": design, "canvas": canvas, "bad": bad }))
}
#[tauri::command]
pub fn design_rename(roots: State<OpenRoots>, dir: String, slug: String, title: String) -> Result<(), String> {
    rename(&project_for(&roots, &dir)?.dir, &slug, &title)
}
#[tauri::command]
pub fn design_set_kind(roots: State<OpenRoots>, dir: String, slug: String, kind: String) -> Result<(), String> {
    set_kind(&project_for(&roots, &dir)?.dir, &slug, &kind)
}
#[tauri::command]
pub fn design_trash(roots: State<OpenRoots>, dir: String, slug: String) -> Result<String, String> {
    let ms = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
    trash(&project_for(&roots, &dir)?.dir, &slug, ms)
}
#[tauri::command]
pub fn design_untrash(roots: State<OpenRoots>, dir: String, trash_rel: String) -> Result<String, String> {
    untrash(&project_for(&roots, &dir)?.dir, &trash_rel)
}
#[tauri::command]
pub fn design_canvas_save(roots: State<OpenRoots>, dir: String, slug: String, canvas: Value) -> Result<(), String> {
    let p = project_for(&roots, &dir)?;
    if !canvas.is_object() { return Err("that canvas layout isn't valid".into()); }
    write_json(&design_dir(&p.dir, &slug)?.join("canvas.json"), &canvas)
}
#[tauri::command]
pub fn designs_order_save(roots: State<OpenRoots>, dir: String, order: Value) -> Result<(), String> {
    let p = project_for(&roots, &dir)?;
    if !order.is_object() { return Err("that order isn't valid".into()); }
    write_json(&ensure_root(&p.dir)?.join("order.json"), &order)
}
```

Before writing `chrono_like_now`, search `main.rs` for an existing UTC timestamp helper (`rg "fn .*iso|rfc3339|fn now_" src-tauri/src`); if one exists, use it and delete `chrono_like_now`. If none exists, add to `main.rs`:

```rust
pub(crate) fn iso8601_utc(secs: u64) -> String {
    let days = secs / 86_400; let rem = secs % 86_400;
    let (h, m, s) = (rem / 3600, rem % 3600 / 60, rem % 60);
    // civil-from-days (Howard Hinnant)
    let z = days as i64 + 719_468; let era = z.div_euclid(146_097); let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365; let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1; let mo = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if mo <= 2 { y + 1 } else { y };
    format!("{y:04}-{mo:02}-{d:02}T{h:02}:{m:02}:{s:02}Z")
}
#[test]
fn iso8601_utc_known_dates() {
    assert_eq!(iso8601_utc(0), "1970-01-01T00:00:00Z");
    assert_eq!(iso8601_utc(1_789_560_000), "2026-09-16T12:00:00Z");
}
```

In `agent_session_start` and `agent_session_resume` (Task 2), add `if lane == acp::Lane::Design { designs::ensure_root(&p.dir)?; }` before `acp::start`.

- [ ] **Step 6: Build and run all Rust tests**

Run: `cd src-tauri && cargo test`
Expected: all pass (the ACL test in `web.rs` passes because `build.rs` regenerated the manifest).

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/designs src-tauri/src/main.rs
git commit -m "feat(design): a designs folder that ignores itself, and designs you can create, rename, re-kind and trash"
```

### Task 4: The fence around the design session

**Files:**
- Modify: `src-tauri/src/acp.rs` (`AcpSession` gains `designs_root: Option<PathBuf>`; `handle_agent_request` ~996; `handle_fs_write` ~1083; `handle_response` TurnEnd branch ~971; new `reconcile_design_turn_end`; `ledger::revert`)
- Modify: `src-tauri/src/main.rs` (pass `designs_root` into `acp::start`; commands `design_outside_files`, `design_outside_undo`)
- Modify: `src-tauri/src/acp.rs` `MOCK_AGENT` (a turn that asks to Write inside and outside the designs folder)

**Interfaces:**
- Consumes: `Lane`, `designs::designs_root`, `designs::ensure_root`.
- Produces:
  - `acp::start(state, emit, key, lane, cwd, project_dir, roots, designs_root: Option<PathBuf>, resume, cmd)` — `designs_root` is `Some` exactly for the design lane.
  - `pub enum WriteDecision { Allow { option_id: String }, Refuse { option_id: String, path: String } }`
  - `pub fn design_write_decision(params: &Value, designs_root: &Path) -> Option<WriteDecision>`
  - Wire messages emitted (and appended to the transcript) by the design lane: `_chronicle/guard { toolCallId, allowed: bool, path, reason }` and `_chronicle/outside_changes { paths: [String] }`.
  - `pub fn ledger::revert(store: &Path, sid: &str, path: Option<&str>, roots: &[PathBuf]) -> Result<usize, String>` — like `undo` but also reverts `via_command` entries.
  - Commands: `design_outside_files(dir) -> Vec<Value>` (same row shape as `agent_edits`), `design_outside_undo(dir, path: Option<String>) -> u64`.

- [ ] **Step 1: Write the failing unit test** (in `mod acp_tests`)

```rust
fn perm(tool: &str, path: &str) -> Value {
    json!({
        "sessionId": "s",
        "toolCall": { "toolCallId": "t1", "name": tool, "rawInput": { "file_path": path }, "locations": [{ "path": path }] },
        "options": [
            { "optionId": "allow", "name": "Allow", "kind": "allow_once" },
            { "optionId": "always", "name": "Always", "kind": "allow_always" },
            { "optionId": "reject", "name": "Reject", "kind": "reject_once" }
        ]
    })
}

#[test]
fn design_writes_inside_are_allowed_and_outside_refused() {
    let d = tmp("fence");
    let root = d.join(".chronicle/designs");
    std::fs::create_dir_all(root.join("home/frames")).unwrap();
    let inside = root.join("home/frames/desktop.html");
    match design_write_decision(&perm("Write", inside.to_str().unwrap()), &root) {
        Some(WriteDecision::Allow { option_id }) => assert_eq!(option_id, "allow"),
        other => panic!("expected allow, got {other:?}"),
    }
    let outside = d.join("src/app.tsx");
    match design_write_decision(&perm("Edit", outside.to_str().unwrap()), &root) {
        Some(WriteDecision::Refuse { option_id, path }) => { assert_eq!(option_id, "reject"); assert!(path.ends_with("src/app.tsx")); }
        other => panic!("expected refuse, got {other:?}"),
    }
    let climb = format!("{}/home/../../../src/x.ts", root.display());
    assert!(matches!(design_write_decision(&perm("Write", &climb), &root), Some(WriteDecision::Refuse { .. })));
    #[cfg(unix)] {
        std::os::unix::fs::symlink(&d, root.join("home/escape")).unwrap();
        let via_link = root.join("home/escape/src/y.ts");
        assert!(matches!(design_write_decision(&perm("Write", via_link.to_str().unwrap()), &root), Some(WriteDecision::Refuse { .. })));
    }
    assert!(design_write_decision(&perm("Bash", "/tmp/x"), &root).is_none(), "non-write tools are not decided here");
    assert!(design_write_decision(&perm("Write", "relative/path.html"), &root).map(|w| matches!(w, WriteDecision::Refuse { .. })).unwrap_or(false));
}
```

Add `#[derive(Debug)]` to `WriteDecision`.

- [ ] **Step 2: Run to verify it fails**

Run: `cd src-tauri && cargo test design_writes_inside_are_allowed_and_outside_refused`
Expected: compile error, `design_write_decision` not found.

- [ ] **Step 3: Implement the decision**

```rust
#[derive(Debug)]
pub enum WriteDecision { Allow { option_id: String }, Refuse { option_id: String, path: String } }

const WRITE_TOOLS: [&str; 4] = ["Write", "Edit", "MultiEdit", "NotebookEdit"];

/// Layer 1 of the design lane's fence: a permission request for a file-writing
/// tool is answered here, never shown. Inside the designs folder → allow once;
/// anywhere else (or a path that can't be proven inside) → reject once.
pub fn design_write_decision(params: &Value, designs_root: &Path) -> Option<WriteDecision> {
    let call = params.get("toolCall")?;
    let name = call.get("name").and_then(|v| v.as_str())
        .or_else(|| call.pointer("/_meta/claudeCode/toolName").and_then(|v| v.as_str()))?;
    if !WRITE_TOOLS.contains(&name) { return None; }
    let path = call.pointer("/rawInput/file_path").and_then(|v| v.as_str())
        .or_else(|| call.pointer("/rawInput/notebook_path").and_then(|v| v.as_str()))
        .or_else(|| call.pointer("/locations/0/path").and_then(|v| v.as_str()))
        .unwrap_or("");
    let options = params.get("options").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    let pick = |kind: &str| options.iter().find(|o| o["kind"] == kind).and_then(|o| o["optionId"].as_str()).map(String::from);
    let p = Path::new(path);
    let inside = p.is_absolute()
        && !p.components().any(|c| matches!(c, std::path::Component::ParentDir))
        && path_in_roots(p, &[designs_root.to_path_buf()]);
    if inside {
        pick("allow_once").or_else(|| pick("allow_always")).map(|option_id| WriteDecision::Allow { option_id })
    } else {
        pick("reject_once").or_else(|| pick("reject_always")).map(|option_id| WriteDecision::Refuse { option_id, path: path.to_string() })
    }
}
```

- [ ] **Step 4: Wire it into the session**

Add the field `designs_root: Option<PathBuf>` to `AcpSession`, the `designs_root: Option<PathBuf>` parameter to `start` (after `roots`), and set it in the literal. Update the test literals (`designs_root: None`), `start_mock` (`None`), and every other `start(` call in the tests (including Task 1's `two_lanes_live_at_once_and_events_carry_their_lane`, which passes `Some(h.dir.join(".chronicle/designs"))` for its design lane). In `main.rs` pass `if lane == acp::Lane::Design { Some(designs::designs_root(&p.dir)) } else { None }`.

In `handle_agent_request`, replace the `"session/request_permission"` arm:

```rust
"session/request_permission" => {
    if let Some(root) = &self.designs_root {
        if let Some(decision) = design_write_decision(&params, root) {
            let tool_call_id = params.pointer("/toolCall/toolCallId").cloned().unwrap_or(Value::Null);
            let (option_id, allowed, path, reason) = match decision {
                WriteDecision::Allow { option_id } => {
                    let path = params.pointer("/toolCall/rawInput/file_path").and_then(|v| v.as_str()).unwrap_or("").to_string();
                    (option_id, true, path, String::new())
                }
                WriteDecision::Refuse { option_id, path } => (option_id, false, path,
                    "The design session can only change files in .chronicle/designs/.".to_string()),
            };
            self.respond_ok(&id, json!({ "outcome": { "outcome": "selected", "optionId": option_id } }));
            let guard = json!({ "method": "_chronicle/guard", "params": {
                "toolCallId": tool_call_id, "allowed": allowed, "path": path, "reason": reason } });
            self.append_transcript(&guard);
            self.emit_msg(guard);
            return;
        }
    }
    if let Ok(mut g) = self.perms.lock() { g.insert(id.to_string(), id.clone()); }
    self.append_transcript(msg);
    self.emit_msg(msg.clone());
}
```

In `handle_fs_write`, right after `let full = …jail_abs…;`:

```rust
if let Some(root) = &self.designs_root {
    if !path_in_roots(&full, &[root.clone()]) {
        return self.respond_err(id, -32602, "the design session can only change files in .chronicle/designs/");
    }
}
```

and skip `ledger::record_base` plus the `_chronicle/edits_changed` emit for the design lane (versions cover design files):

```rust
if self.designs_root.is_none() {
    if let Err(e) = ledger::record_base(&self.store, &sid, &full, false, base.as_deref()) { return self.respond_err(id, -32603, &e); }
}
```

(wrap the later `_chronicle/edits_changed` emit in the same `if self.designs_root.is_none()`).

- [ ] **Step 5: Turn-end check (layer 3) and revert**

In `handle_response`'s `Pending::TurnEnd` branch, replace `self.reconcile_turn_end();` with:

```rust
if self.designs_root.is_some() { self.reconcile_design_turn_end(); } else { self.reconcile_turn_end(); }
```

Add:

```rust
/// Layer 3: anything the design turn changed outside `.chronicle/` (a shell command,
/// or a write the user's own Claude settings auto-allowed) is recorded with its base
/// so it can be undone, and listed in the thread.
fn reconcile_design_turn_end(&self) {
    let Some(cp) = self.last_checkpoint.lock().ok().and_then(|g| g.clone()) else { return };
    let Some(sid) = self.session_id.lock().ok().and_then(|g| g.clone()) else { return };
    let Ok(now_tree) = checkpoint::snapshot_tree_as(&self.repo, self.lane.as_str()) else { return };
    let mut paths = Vec::new();
    for (status, rel) in checkpoint::changed_since(&self.repo, &cp, &now_tree) {
        if rel.starts_with(".chronicle/") { continue; }
        let abs = self.repo.join(&rel);
        let base = if status == 'A' { None } else { checkpoint::bytes_at(&self.repo, &cp, &rel) };
        if ledger::record_base(&self.store, &sid, &abs, true, base.as_deref()).is_ok() { paths.push(rel); }
    }
    if !paths.is_empty() {
        let msg = json!({ "method": "_chronicle/outside_changes", "params": { "paths": paths } });
        self.append_transcript(&msg);
        self.emit_msg(msg);
    }
}
```

In `mod ledger`, add `revert` by copying `undo`'s body and removing its `via_command` refusal (keep the jail check against `roots`):

```rust
/// Like `undo`, but also puts back files a command changed: the design lane's
/// outside changes are recorded with via_command and must still be undoable.
pub fn revert(store: &Path, sid: &str, path: Option<&str>, roots: &[PathBuf]) -> Result<usize, String>
```

- [ ] **Step 6: Commands**

```rust
#[tauri::command]
async fn design_outside_files(roots: State<'_, OpenRoots>, dir: String) -> Result<Vec<Value>, String> {
    let p = project_for(&roots, &dir)?;
    let store = acp::Lane::Design.store(&p.dir);
    Ok(match acp::ledger::current_session(&store) { Some(sid) => acp::ledger::files(&store, &sid, &p.repo), None => vec![] })
}
#[tauri::command]
async fn design_outside_undo(app: tauri::AppHandle, roots: State<'_, OpenRoots>, dir: String, path: Option<String>) -> Result<u64, String> {
    let p = project_for(&roots, &dir)?;
    let store = acp::Lane::Design.store(&p.dir);
    let sid = acp::ledger::current_session(&store).ok_or("there's nothing to undo")?;
    let n = acp::ledger::revert(&store, &sid, path.as_deref(), &project_roots(&p))?;
    let key = canon_key(&dir)?.0;
    let _ = app.emit("acp-update", json!({ "dir": key, "lane": "design", "message": { "method": "_chronicle/outside_changes", "params": { "paths": [] , "reverted": n } } }));
    Ok(n as u64)
}
```

Register both in `generate_handler!`.

- [ ] **Step 7: Extend the mock and write an integration test**

In `MOCK_AGENT`'s `session/prompt` handling, add a branch: if the prompt text contains `DESIGN-FENCE`, send two `session/request_permission` requests (ids 300 and 301) whose `toolCall` is `{"toolCallId":"w1","name":"Write","rawInput":{"file_path": PROJECT + "/.chronicle/designs/home/frames/a.html"}}` and the same with `/src/escape.ts` for id 301, each with the three options from Step 1; record the responses it receives into `PROJECT/.fence-answers.json` as `{"300": optionId, "301": optionId}`; then end the turn.

```rust
#[test]
fn the_design_lane_answers_write_permissions_itself() {
    let Some(py) = python3() else { return };
    let dir = tmp("fence-live");
    std::fs::create_dir_all(dir.join(".chronicle/designs/home/frames")).unwrap();
    let script = dir.join(".mock-agent.py");
    std::fs::write(&script, MOCK_AGENT).unwrap();
    let mut cmd = std::process::Command::new(py); cmd.arg(&script).arg(&dir);
    let (tx, rx) = mpsc::channel::<Value>();
    let emit: Emit = Arc::new(move |v| { let _ = tx.send(v); });
    let state = AcpState::new();
    let key = Lane::Design.key(&dir.to_string_lossy());
    assert!(start(&state, emit, key.clone(), Lane::Design, dir.clone(), dir.clone(), vec![dir.clone()], Some(dir.join(".chronicle/designs")), None, cmd).unwrap());
    wait_for(&rx, 20, |v| state_is(v, "ready"));
    state.get(&key).unwrap().prompt(vec![json!({"type":"text","text":"DESIGN-FENCE"})], "DESIGN-FENCE".into()).unwrap();
    let g1 = wait_for(&rx, 20, |v| method_is(v, "_chronicle/guard"));
    let g2 = wait_for(&rx, 20, |v| method_is(v, "_chronicle/guard"));
    let allowed: Vec<bool> = [g1, g2].iter().map(|g| g["message"]["params"]["allowed"].as_bool().unwrap()).collect();
    assert!(allowed.contains(&true) && allowed.contains(&false));
    wait_for(&rx, 20, |v| method_is(v, "_chronicle/turn_end"));
    let answers: Value = serde_json::from_str(&std::fs::read_to_string(dir.join(".fence-answers.json")).unwrap()).unwrap();
    assert_eq!(answers["300"], "allow"); assert_eq!(answers["301"], "reject");
    state.drain();
}
```

- [ ] **Step 8: Run tests**

Run: `cd src-tauri && cargo test acp_tests`
Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add src-tauri/src/acp.rs src-tauri/src/main.rs
git commit -m "feat(design): the design session writes only inside its folder, and anything it changes elsewhere can be undone"
```

### Task 5: The design session's prompt, rules, mode lock and idle stop

**Files:**
- Modify: `src-tauri/src/designs/prompt.rs`
- Modify: `src-tauri/src/acp.rs` (`handshake` ~846 and ~843; `AcpSession` gains `last_activity: Mutex<std::time::Instant>`; `start` spawns a watchdog for the design lane; `prompt` and TurnEnd stamp activity)

**Interfaces:**
- Consumes: `AcpSession.designs_root` (Task 4).
- Produces:
  - `pub const DESIGN_PROMPT: &str`
  - `pub fn design_session_meta(designs_root: &Path) -> serde_json::Map<String, Value>` → `{ "systemPrompt": { "append": DESIGN_PROMPT }, "claudeCode": { "options": { "settings": { "permissions": { "allow": ["Edit(/<abs>/**)", "Write(/<abs>/**)"] } } } } }` where `<abs>` is the absolute designs root (so the rule reads `Edit(//Users/…/.chronicle/designs/**)`).
  - `pub fn idle_due(last: Instant, now: Instant, turn_active: bool, limit: Duration) -> bool`
  - `pub const DESIGN_IDLE: Duration = Duration::from_secs(15 * 60);`
  - The design lane's `ended` state carries `"reason": "idle"` when the watchdog stopped it.

- [ ] **Step 1: Write the failing tests**

In `designs/prompt.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn meta_appends_the_prompt_and_allows_only_the_designs_folder() {
        let m = design_session_meta(std::path::Path::new("/Users/t/p/.chronicle/designs"));
        assert_eq!(m["systemPrompt"]["append"], DESIGN_PROMPT);
        assert!(m["systemPrompt"].get("type").is_none(), "the adapter locks type/preset itself");
        let allow = m["claudeCode"]["options"]["settings"]["permissions"]["allow"].as_array().unwrap();
        assert_eq!(allow, &vec![json!("Edit(//Users/t/p/.chronicle/designs/**)"), json!("Write(//Users/t/p/.chronicle/designs/**)")]);
    }
    #[test]
    fn the_prompt_states_the_file_contract() {
        for needle in [".chronicle/designs/", "design.json", "frames/", "assets/fonts/", "[design:", "one sentence"] {
            assert!(DESIGN_PROMPT.contains(needle), "prompt is missing {needle}");
        }
    }
}
```

In `mod acp_tests`:

```rust
#[test]
fn idle_is_due_only_after_the_limit_and_never_mid_turn() {
    let t0 = std::time::Instant::now();
    let lim = std::time::Duration::from_secs(900);
    assert!(!idle_due(t0, t0 + std::time::Duration::from_secs(899), false, lim));
    assert!(idle_due(t0, t0 + std::time::Duration::from_secs(900), false, lim));
    assert!(!idle_due(t0, t0 + std::time::Duration::from_secs(5000), true, lim));
}
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd src-tauri && cargo test meta_appends the_prompt_states idle_is_due`
Expected: compile errors.

- [ ] **Step 3: Implement `prompt.rs`**

```rust
//! The design lane's basic system prompt (sub-project 1) and its session `_meta`.
//! Sub-project 2 replaces the persona paragraph; the file contract stays.
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

pub fn design_session_meta(designs_root: &Path) -> Map<String, Value> {
    let abs = designs_root.to_string_lossy();
    let rule = |tool: &str| format!("{tool}(/{abs}/**)");
    let mut m = Map::new();
    m.insert("systemPrompt".into(), json!({ "append": DESIGN_PROMPT }));
    m.insert("claudeCode".into(), json!({ "options": { "settings": { "permissions": { "allow": [rule("Edit"), rule("Write")] } } } }));
    m
}
```

- [ ] **Step 4: Use the meta in the handshake**

In `handshake`, for `session/new`:

```rust
None => {
    let mut new_req = proto::NewSessionRequest::new(cwd);
    if let Some(root) = &self.designs_root {
        new_req = new_req.meta(crate::designs::prompt::design_session_meta(root));
    }
    match serde_json::to_value(&new_req) { Ok(v) => ("session/new", v), Err(e) => return self.fail_handshake(&e.to_string()) }
}
```

For `session/load`, build the params and add `_meta` when `designs_root` is `Some`:

```rust
let mut load = json!({ "sessionId": old_sid, "cwd": cwd, "mcpServers": [] });
if let Some(root) = &self.designs_root {
    load["_meta"] = Value::Object(crate::designs::prompt::design_session_meta(root));
}
("session/load", load)
```

After a successful `session/new`/`session/load` in the design lane, lock the mode: read `resp.pointer("/modes/currentModeId")`; if it is not `"default"` or `"plan"`, call `self.set_mode("default")` from a spawned thread (the handshake runs on its own thread; `set_mode` blocks on a response, so call it after `emit_state(ready)`), ignoring its error.

- [ ] **Step 5: Idle watchdog**

```rust
pub const DESIGN_IDLE: std::time::Duration = std::time::Duration::from_secs(15 * 60);

pub fn idle_due(last: std::time::Instant, now: std::time::Instant, turn_active: bool, limit: std::time::Duration) -> bool {
    !turn_active && now.saturating_duration_since(last) >= limit
}
```

Add `last_activity: Mutex<std::time::Instant>` to `AcpSession` (init `Instant::now()`; update test literals). Stamp it at the top of `prompt` and in the TurnEnd branch: `if let Ok(mut g) = self.last_activity.lock() { *g = std::time::Instant::now(); }`.

In `start`, after spawning the handshake, for the design lane:

```rust
if session.designs_root.is_some() {
    let w = session.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_secs(30));
        if !w.is_alive() { break; }
        let last = w.last_activity.lock().map(|g| *g).unwrap_or_else(|_| std::time::Instant::now());
        if idle_due(last, std::time::Instant::now(), w.turn_active.load(Ordering::SeqCst), DESIGN_IDLE) {
            w.emit_state(json!({ "state": "ended", "reason": "idle" }));
            w.stop(false);
            break;
        }
    });
}
```

`stop(false)` does not clear the lane's records, so `session/load` can resume it.

- [ ] **Step 6: Run tests**

Run: `cd src-tauri && cargo test`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/designs/prompt.rs src-tauri/src/acp.rs
git commit -m "feat(design): the design session knows its file contract, stays in ask-first mode, and rests after fifteen idle minutes"
```

### Task 6: Versions

**Files:**
- Modify: `src-tauri/src/designs/versions.rs`
- Modify: `src-tauri/src/designs/mod.rs` (commands), `src-tauri/src/main.rs` (`generate_handler!`)

**Interfaces:**
- Produces:
  - `pub fn content_hash(design_dir: &Path) -> String`
  - `pub fn latest(design_dir: &Path) -> Option<u32>`
  - `#[derive(Serialize, Deserialize, Clone, Debug)] #[serde(rename_all = "camelCase")] pub struct VersionMeta { pub n: u32, pub at: String, pub session: String, pub prompt: String, pub summary: String, pub hash: String }`
  - `pub fn snapshot_if_changed(design_dir: &Path, at: &str, session: &str, prompt: &str, summary: &str) -> Result<Option<u32>, String>`
  - `pub fn list(design_dir: &Path) -> Vec<VersionMeta>` (newest first)
  - `pub fn restore(design_dir: &Path, n: u32, at: &str) -> Result<u32, String>` (returns the new version number)
  - `pub fn branch(project: &Path, slug: &str, n: Option<u32>, at: &str) -> Result<String, String>` (`None` = latest; used for Duplicate)
  - Commands: `design_snapshot(dir, slug, prompt, summary, session) -> Option<u32>`, `design_versions(dir, slug) -> Vec<VersionMeta>`, `design_restore(dir, slug, n) -> u32`, `design_branch(dir, slug, n: Option<u32>) -> String`.

- [ ] **Step 1: Write the failing tests** (in `versions.rs`)

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::designs::{create, designs_root};
    fn proj(name: &str) -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("chronicle-versions-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d); std::fs::create_dir_all(&d).unwrap(); d.canonicalize().unwrap()
    }
    #[test]
    fn snapshots_only_on_change_restore_and_branch() {
        let p = proj("v");
        let slug = create(&p, "app", "Home", "b", "t0").unwrap();
        let dir = designs_root(&p).join(&slug);
        std::fs::write(dir.join("frames/a.html"), "<h1>one</h1>").unwrap();
        assert_eq!(snapshot_if_changed(&dir, "t1", "s", "p1", "First draft.").unwrap(), Some(1));
        assert_eq!(snapshot_if_changed(&dir, "t2", "s", "p2", "Nothing.").unwrap(), None, "unchanged → no version");
        std::fs::write(dir.join("frames/a.html"), "<h1>two</h1>").unwrap();
        std::fs::write(dir.join("canvas.json"), "{\"positions\":{\"a\":{\"x\":5,\"y\":5}}}").unwrap();
        assert_eq!(snapshot_if_changed(&dir, "t3", "s", "p3", "Second.").unwrap(), Some(2));
        let l = list(&dir);
        assert_eq!(l.iter().map(|m| m.n).collect::<Vec<_>>(), vec![2, 1]);
        assert_eq!(l[1].summary, "First draft.");
        assert_eq!(restore(&dir, 1, "t4").unwrap(), 3);
        assert_eq!(std::fs::read_to_string(dir.join("frames/a.html")).unwrap(), "<h1>one</h1>");
        assert!(std::fs::read_to_string(dir.join("canvas.json")).unwrap().contains("\"x\":5"), "restore keeps the app's canvas");
        assert_eq!(list(&dir)[0].summary, "Restored v1");
        let b = branch(&p, &slug, Some(2), "t5").unwrap();
        assert_eq!(b, "home-2");
        let bd = designs_root(&p).join(&b);
        assert_eq!(std::fs::read_to_string(bd.join("frames/a.html")).unwrap(), "<h1>two</h1>");
        assert_eq!(latest(&bd), Some(1));
        let dup = branch(&p, &slug, None, "t6").unwrap();
        assert_eq!(std::fs::read_to_string(designs_root(&p).join(&dup).join("frames/a.html")).unwrap(), "<h1>one</h1>");
    }
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd src-tauri && cargo test designs::versions`
Expected: compile errors.

- [ ] **Step 3: Implement**

```rust
//! One snapshot per director turn, only when the design's content changed.
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

const CONTENT: [&str; 3] = ["design.json", "frames", "assets"];

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct VersionMeta { pub n: u32, pub at: String, pub session: String, pub prompt: String, pub summary: String, pub hash: String }

fn files_under(base: &Path, rel: &str, out: &mut Vec<String>) {
    let p = base.join(rel);
    if p.is_file() { out.push(rel.to_string()); return; }
    if let Ok(rd) = std::fs::read_dir(&p) {
        for e in rd.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            files_under(base, &format!("{rel}/{name}"), out);
        }
    }
}

pub fn content_hash(design_dir: &Path) -> String {
    let mut files = Vec::new();
    for c in CONTENT { files_under(design_dir, c, &mut files); }
    files.sort();
    let mut h = Sha256::new();
    for f in files {
        h.update(f.as_bytes()); h.update([0u8]);
        h.update(std::fs::read(design_dir.join(&f)).unwrap_or_default()); h.update([0u8]);
    }
    format!("{:x}", h.finalize())
}

fn versions_dir(d: &Path) -> PathBuf { d.join(".versions") }

pub fn list(design_dir: &Path) -> Vec<VersionMeta> {
    let Ok(rd) = std::fs::read_dir(versions_dir(design_dir)) else { return vec![] };
    let mut v: Vec<VersionMeta> = rd.flatten()
        .filter_map(|e| std::fs::read_to_string(e.path().join("meta.json")).ok())
        .filter_map(|t| serde_json::from_str(&t).ok())
        .collect();
    v.sort_by(|a, b| b.n.cmp(&a.n));
    v
}

pub fn latest(design_dir: &Path) -> Option<u32> { list(design_dir).first().map(|m| m.n) }

fn copy_content(from: &Path, to: &Path) -> Result<(), String> {
    for c in CONTENT {
        let src = from.join(c);
        let dst = to.join(c);
        if dst.is_dir() { std::fs::remove_dir_all(&dst).map_err(|e| e.to_string())?; }
        else if dst.is_file() { std::fs::remove_file(&dst).map_err(|e| e.to_string())?; }
        if src.is_file() {
            std::fs::copy(&src, &dst).map_err(|e| e.to_string())?;
        } else if src.is_dir() {
            let mut files = Vec::new();
            files_under(from, c, &mut files);
            std::fs::create_dir_all(&dst).map_err(|e| e.to_string())?;
            for f in files {
                let t = to.join(&f);
                if let Some(parent) = t.parent() { std::fs::create_dir_all(parent).map_err(|e| e.to_string())?; }
                std::fs::copy(from.join(&f), &t).map_err(|e| e.to_string())?;
            }
        }
    }
    Ok(())
}

fn write_version(design_dir: &Path, meta: &VersionMeta) -> Result<(), String> {
    let vd = versions_dir(design_dir).join(format!("v{}", meta.n));
    std::fs::create_dir_all(&vd).map_err(|e| e.to_string())?;
    copy_content(design_dir, &vd)?;
    std::fs::write(vd.join("meta.json"), serde_json::to_string_pretty(meta).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}

pub fn snapshot_if_changed(design_dir: &Path, at: &str, session: &str, prompt: &str, summary: &str) -> Result<Option<u32>, String> {
    let hash = content_hash(design_dir);
    let prev = list(design_dir);
    if prev.first().map(|m| m.hash == hash).unwrap_or(false) { return Ok(None); }
    let n = prev.first().map(|m| m.n + 1).unwrap_or(1);
    write_version(design_dir, &VersionMeta { n, at: at.into(), session: session.into(), prompt: prompt.into(), summary: summary.into(), hash })?;
    Ok(Some(n))
}

pub fn restore(design_dir: &Path, n: u32, at: &str) -> Result<u32, String> {
    let vd = versions_dir(design_dir).join(format!("v{n}"));
    if !vd.join("meta.json").is_file() { return Err(format!("there's no version {n}")); }
    copy_content(&vd, design_dir)?;
    let hash = content_hash(design_dir);
    let next = latest(design_dir).unwrap_or(0) + 1;
    write_version(design_dir, &VersionMeta { n: next, at: at.into(), session: String::new(), prompt: String::new(), summary: format!("Restored v{n}"), hash })?;
    Ok(next)
}

pub fn branch(project: &Path, slug: &str, n: Option<u32>, at: &str) -> Result<String, String> {
    let src_dir = crate::designs::design_dir(project, slug)?;
    let (from, label) = match n.or_else(|| latest(&src_dir)) {
        Some(v) => (versions_dir(&src_dir).join(format!("v{v}")), format!("Branched from {slug} v{v}")),
        None => (src_dir.clone(), format!("Duplicated from {slug}")),
    };
    if !from.exists() { return Err("there's no such version".into()); }
    let root = crate::designs::ensure_root(project)?;
    let new_slug = crate::designs::unique_slug(&root, slug);
    let dst = root.join(&new_slug);
    std::fs::create_dir_all(&dst).map_err(|e| e.to_string())?;
    copy_content(&from, &dst)?;
    let design_json = dst.join("design.json");
    if let Ok(Some(mut v)) = crate::designs::read_json_or_bad(&design_json) {
        let title = v["title"].as_str().unwrap_or(slug).to_string();
        v["title"] = json!(format!("{title} (copy)"));
        std::fs::write(&design_json, serde_json::to_string_pretty(&v).unwrap()).map_err(|e| e.to_string())?;
    }
    std::fs::write(dst.join("canvas.json"), "{\"positions\":{},\"viewport\":null}").map_err(|e| e.to_string())?;
    snapshot_if_changed(&dst, at, "", "", &label)?;
    Ok(new_slug)
}
```

(The test expects `home-2` for `branch` and `unique_slug` gives that; the `(copy)` title suffix is only a title change.)

- [ ] **Step 4: Commands** (in `designs/mod.rs`; register in `generate_handler!`)

```rust
#[tauri::command]
pub fn design_snapshot(roots: State<OpenRoots>, dir: String, slug: String, prompt: String, summary: String, session: String) -> Result<Option<u32>, String> {
    let p = project_for(&roots, &dir)?;
    versions::snapshot_if_changed(&design_dir(&p.dir, &slug)?, &now_iso(), &session, &prompt, &summary)
}
#[tauri::command]
pub fn design_versions(roots: State<OpenRoots>, dir: String, slug: String) -> Result<Vec<versions::VersionMeta>, String> {
    let p = project_for(&roots, &dir)?;
    Ok(versions::list(&design_dir(&p.dir, &slug)?))
}
#[tauri::command]
pub fn design_restore(roots: State<OpenRoots>, dir: String, slug: String, n: u32) -> Result<u32, String> {
    let p = project_for(&roots, &dir)?;
    versions::restore(&design_dir(&p.dir, &slug)?, n, &now_iso())
}
#[tauri::command]
pub fn design_branch(roots: State<OpenRoots>, dir: String, slug: String, n: Option<u32>) -> Result<String, String> {
    let p = project_for(&roots, &dir)?;
    versions::branch(&p.dir, &slug, n, &now_iso())
}
```

- [ ] **Step 5: Run tests**

Run: `cd src-tauri && cargo test designs`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/designs src-tauri/src/main.rs
git commit -m "feat(design): every turn that changes a design becomes a version you can restore or branch from"
```

### Task 7: Serving design frames safely

**Files:**
- Modify: `src-tauri/src/designs/frame.rs`
- Modify: `src-tauri/src/web.rs` (`serve_project_file` ~176; add `register_root`; its tests)
- Modify: `src-tauri/src/main.rs` (protocol registration ~3597; command `design_frame_base`)
- Modify: `src-tauri/tauri.conf.json` (CSP line 29)

**Interfaces:**
- Produces:
  - `pub struct Served { pub status: u16, pub mime: &'static str, pub body: Vec<u8>, pub headers: Vec<(&'static str, String)> }` and `pub fn serve_project_file(web: &WebState, url: &str) -> Served`.
  - `pub fn web::register_root(web: &WebState, root: &Path) -> Result<String, String>` (returns the hash; the same insert `web_open_file` does).
  - `pub fn designs::frame::is_design_path(rel: &str) -> bool`, `pub const DESIGN_CSP: &str`, `pub fn design_headers() -> Vec<(&'static str, String)>`, `pub fn inject_reporter(html: &[u8]) -> Vec<u8>`, `pub const REPORTER: &str`.
  - Command `design_frame_base(dir) -> String` = `chronicle-file://<hash>/.chronicle/designs/`.
  - Reporter messages posted to `parent`: `{ __chronicleFrame: 1, type: "ready", height }`, `{ __chronicleFrame: 1, type: "height", height }`, `{ __chronicleFrame: 1, type: "error", message, line }`, `{ __chronicleFrame: 1, type: "blank" }`. When the page is top-level (a thumbnail window), `ready` also sets `document.title = "chronicle-ready:<height>"`.

- [ ] **Step 1: Write the failing tests** (in `frame.rs`)

```rust
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_design_pages_get_the_design_treatment() {
        assert!(is_design_path(".chronicle/designs/home/frames/a.html"));
        assert!(is_design_path(".chronicle/designs/home/assets/fonts/x.woff2"));
        assert!(!is_design_path(".chronicle/designs/.threads/s/thread.jsonl"));
        assert!(!is_design_path("docs/index.html"));
        assert!(!is_design_path(".chronicle/notes/a.md"));
    }
    #[test]
    fn the_design_policy_blocks_the_network_and_allows_its_own_files() {
        for part in ["default-src 'none'", "connect-src 'none'", "font-src 'self'", "frame-src 'none'", "form-action 'none'", "img-src 'self' data: https:"] {
            assert!(DESIGN_CSP.contains(part), "missing {part}");
        }
        let h = design_headers();
        assert!(h.iter().any(|(k, v)| *k == "Content-Security-Policy" && v == DESIGN_CSP));
        assert!(h.iter().any(|(k, v)| *k == "Access-Control-Allow-Origin" && v == "*"));
    }
    #[test]
    fn the_reporter_goes_before_head_close_or_first() {
        let out = String::from_utf8(inject_reporter(b"<html><HEAD><title>x</title></HEAD><body>hi</body></html>")).unwrap();
        let r = out.find("__chronicleFrame").unwrap();
        assert!(r < out.find("</HEAD>").unwrap());
        let bare = String::from_utf8(inject_reporter(b"<p>no head</p>")).unwrap();
        assert!(bare.starts_with("<script>"));
    }
}
```

In `web.rs` tests add:

```rust
#[test]
fn design_frames_are_served_with_their_policy_and_reporter_and_others_are_not() {
    let d = std::env::temp_dir().join(format!("chronicle-serve-design-{}", std::process::id()));
    std::fs::create_dir_all(d.join(".chronicle/designs/home/frames")).unwrap();
    std::fs::write(d.join(".chronicle/designs/home/frames/a.html"), "<html><head></head><body>x</body></html>").unwrap();
    std::fs::write(d.join("page.html"), "<html><head></head><body>y</body></html>").unwrap();
    let web = WebState::new();
    let hash = register_root(&web, &d).unwrap();
    let s = serve_project_file(&web, &format!("chronicle-file://{hash}/.chronicle/designs/home/frames/a.html"));
    assert_eq!(s.status, 200);
    assert!(String::from_utf8(s.body).unwrap().contains("__chronicleFrame"));
    assert!(s.headers.iter().any(|(k, _)| *k == "Content-Security-Policy"));
    let o = serve_project_file(&web, &format!("chronicle-file://{hash}/page.html"));
    assert_eq!(o.status, 200);
    assert!(!String::from_utf8(o.body).unwrap().contains("__chronicleFrame"));
    assert!(o.headers.is_empty());
}
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd src-tauri && cargo test designs::frame design_frames_are_served`
Expected: compile errors.

- [ ] **Step 3: Implement `frame.rs`**

```rust
//! What a design frame is served with: a policy that keeps generated pages off
//! the network and away from Chronicle, CORS so an opaque-origin page can load
//! its own fonts, and a tiny reporter that tells the canvas how the page went.

pub fn is_design_path(rel: &str) -> bool {
    rel.starts_with(".chronicle/designs/") && !rel.starts_with(".chronicle/designs/.threads/")
}

pub const DESIGN_CSP: &str = "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; media-src 'self'; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'";

pub fn design_headers() -> Vec<(&'static str, String)> {
    vec![("Content-Security-Policy", DESIGN_CSP.to_string()), ("Access-Control-Allow-Origin", "*".to_string())]
}

pub const REPORTER: &str = r#"<script>(function(){var P=window.parent,top=P===window;function H(){var d=document.documentElement,b=document.body;return Math.max(d?d.scrollHeight:0,b?b.scrollHeight:0)}function S(m){m.__chronicleFrame=1;try{P.postMessage(m,'*')}catch(e){}}addEventListener('error',function(e){S({type:'error',message:String(e.message||'The page hit an error'),line:e.lineno||0})});addEventListener('load',function(){var f=document.fonts&&document.fonts.ready?document.fonts.ready:Promise.resolve();f.then(function(){var b=document.body;if(!b||(!b.children.length&&!b.textContent.trim())){S({type:'blank'});return}var h=H();S({type:'ready',height:h});if(top)document.title='chronicle-ready:'+h})});if(window.ResizeObserver){var last=0;new ResizeObserver(function(){var h=H();if(h!==last){last=h;S({type:'height',height:h})}}).observe(document.documentElement)}})();</script>"#;

pub fn inject_reporter(html: &[u8]) -> Vec<u8> {
    let text = String::from_utf8_lossy(html);
    let lower = text.to_ascii_lowercase();
    match lower.find("</head>") {
        Some(i) => { let mut s = String::with_capacity(text.len() + REPORTER.len()); s.push_str(&text[..i]); s.push_str(REPORTER); s.push_str(&text[i..]); s.into_bytes() }
        None => { let mut s = String::from(REPORTER); s.push_str(&text); s.into_bytes() }
    }
}
```

- [ ] **Step 4: Change `serve_project_file` and add `register_root`** (in `web.rs`)

```rust
pub struct Served { pub status: u16, pub mime: &'static str, pub body: Vec<u8>, pub headers: Vec<(&'static str, String)> }

fn plain(status: u16, msg: &[u8]) -> Served { Served { status, mime: "text/plain", body: msg.to_vec(), headers: vec![] } }

pub fn serve_project_file(web: &WebState, url: &str) -> Served {
    let Ok(u) = url::Url::parse(url) else { return plain(404, b"not found") };
    let hash = u.host_str().unwrap_or("").to_string();
    let rel = percent_encoding::percent_decode_str(u.path().trim_start_matches('/')).decode_utf8_lossy().into_owned();
    let root = web.roots.lock().ok().and_then(|g| g.get(&hash).cloned());
    match root.and_then(|r| resolve_project_file(&r, &rel)) {
        Some(file) => {
            if std::fs::metadata(&file).map(|m| m.len() > MAX_SERVED_BYTES).unwrap_or(false) {
                return plain(413, b"file too large to show here");
            }
            match std::fs::read(&file) {
                Ok(bytes) => {
                    let mime = mime_for(&file);
                    if crate::designs::frame::is_design_path(&rel) {
                        let body = if mime.starts_with("text/html") { crate::designs::frame::inject_reporter(&bytes) } else { bytes };
                        Served { status: 200, mime, body, headers: crate::designs::frame::design_headers() }
                    } else {
                        Served { status: 200, mime, body: bytes, headers: vec![] }
                    }
                }
                Err(_) => plain(404, b"not found"),
            }
        }
        None => plain(404, b"not found"),
    }
}

pub fn register_root(web: &WebState, root: &Path) -> Result<String, String> {
    let root = root.canonicalize().map_err(|e| e.to_string())?;
    let hash = project_hash(&root);
    web.roots.lock().map_err(|e| e.to_string())?.insert(hash.clone(), root);
    Ok(hash)
}
```

Refactor `web_open_file` to call `register_root(&web, &p.dir)` instead of its inline insert. Update any existing `web.rs` test that destructures the old tuple to use `.status`/`.mime`/`.body`.

- [ ] **Step 5: Protocol headers and the base command** (in `main.rs`)

```rust
let served = web::serve_project_file(&web, &uri);
let mut b = tauri::http::Response::builder()
    .status(served.status)
    .header("Content-Type", served.mime)
    .header("Cache-Control", "no-store");
for (k, v) in served.headers { b = b.header(k, v); }
responder.respond(b.body(served.body).unwrap());
```

```rust
#[tauri::command]
fn design_frame_base(roots: State<OpenRoots>, web: State<web::WebState>, dir: String) -> Result<String, String> {
    let p = project_for(&roots, &dir)?;
    let base = notes::index::vault_root(&p.dir);
    designs::ensure_root(&p.dir)?;
    let hash = web::register_root(&web, &base)?;
    Ok(format!("chronicle-file://{hash}/.chronicle/designs/"))
}
```

Register `design_frame_base` in `generate_handler!`.

- [ ] **Step 6: App CSP** (`tauri.conf.json` line 29) — add `frame-src chronicle-file:;` and add `chronicle-file:` to `img-src` (thumbnails):

```
"csp": "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' asset: http://asset.localhost data: chronicle-file:; font-src 'self' data:; connect-src ipc: http://ipc.localhost; frame-src chronicle-file:"
```

- [ ] **Step 7: Run tests**

Run: `cd src-tauri && cargo test`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/designs/frame.rs src-tauri/src/web.rs src-tauri/src/main.rs src-tauri/tauri.conf.json
git commit -m "feat(design): design frames are served off the network, able to load their own fonts, and able to say how they rendered"
```

### Task 8: Watching the designs folder

**Files:**
- Create: `src-tauri/src/designs/watch.rs` (add `pub mod watch;` in `designs/mod.rs`)
- Modify: `src-tauri/src/main.rs` (`fs_event_matters` ~2236, the watcher closure in `watch_project` ~2263)

**Interfaces:**
- Produces:
  - `pub fn design_event(path: &Path) -> Option<(String, String)>` → `(slug, rel-inside-design)`; `None` for `.threads`, `.versions`, `order.json`, `.gitignore`.
  - `pub fn queue(dir: &str, slug: &str, rel: String) -> bool` (true when this is the first path of a new burst) and `pub fn drain(dir: &str, slug: &str) -> Vec<String>`.
  - Event `designs-changed` to the main webview: `{ dir, slug, paths: [String] }`, 250 ms after the first change of a burst.
  - `fs_event_matters` returns false for any path containing `/.chronicle/designs/`.

- [ ] **Step 1: Write the failing tests** (in `watch.rs`)

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;
    #[test]
    fn design_events_name_their_design() {
        assert_eq!(design_event(Path::new("/p/.chronicle/designs/home/frames/a.html")), Some(("home".into(), "frames/a.html".into())));
        assert_eq!(design_event(Path::new("/p/.chronicle/designs/home/design.json")), Some(("home".into(), "design.json".into())));
        assert_eq!(design_event(Path::new("/p/.chronicle/designs/home/.versions/v1/meta.json")), None);
        assert_eq!(design_event(Path::new("/p/.chronicle/designs/.threads/s/thread.jsonl")), None);
        assert_eq!(design_event(Path::new("/p/.chronicle/designs/order.json")), None);
        assert_eq!(design_event(Path::new("/p/src/a.ts")), None);
    }
    #[test]
    fn bursts_collect_until_drained() {
        assert!(queue("/d", "s", "a".into()));
        assert!(!queue("/d", "s", "b".into()));
        assert!(!queue("/d", "s", "a".into()));
        let mut got = drain("/d", "s"); got.sort();
        assert_eq!(got, vec!["a".to_string(), "b".to_string()]);
        assert!(queue("/d", "s", "c".into()), "a new burst starts after a drain");
        drain("/d", "s");
    }
}
```

In `main.rs` tests near `the_watcher_ignores_both_atomic_write_temps`:

```rust
#[test]
fn project_watching_ignores_the_designs_folder() {
    assert!(!fs_event_matters(std::path::Path::new("/p/.chronicle/designs/home/frames/a.html")));
}
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd src-tauri && cargo test designs::watch project_watching_ignores_the_designs_folder`
Expected: compile error / assertion failure.

- [ ] **Step 3: Implement `watch.rs`**

```rust
//! The designs folder is watched on its own: bursts of writes from a design turn
//! collapse to one `designs-changed` per design, and never touch the project-wide
//! rescan or the notes index.
use std::collections::{BTreeSet, HashMap};
use std::path::Path;
use std::sync::Mutex;

static PENDING: Mutex<Option<HashMap<(String, String), BTreeSet<String>>>> = Mutex::new(None);

pub fn design_event(path: &Path) -> Option<(String, String)> {
    let s = path.to_string_lossy();
    let (_, rest) = s.split_once("/.chronicle/designs/")?;
    let (slug, rel) = rest.split_once('/')?;
    if !super::valid_slug(slug) || rel.is_empty() || rel.starts_with(".versions/") { return None; }
    Some((slug.to_string(), rel.to_string()))
}

pub fn queue(dir: &str, slug: &str, rel: String) -> bool {
    let mut g = PENDING.lock().unwrap();
    let map = g.get_or_insert_with(HashMap::new);
    let key = (dir.to_string(), slug.to_string());
    let first = !map.contains_key(&key);
    map.entry(key).or_default().insert(rel);
    first
}

pub fn drain(dir: &str, slug: &str) -> Vec<String> {
    let mut g = PENDING.lock().unwrap();
    g.as_mut().and_then(|m| m.remove(&(dir.to_string(), slug.to_string()))).map(|s| s.into_iter().collect()).unwrap_or_default()
}
```

- [ ] **Step 4: Route events in `main.rs`**

In `fs_event_matters`, before the other checks: `if p.to_string_lossy().contains("/.chronicle/designs/") { return false; }`.

In the `watch_project` closure, after computing `vault_touched`:

```rust
for pa in &ev.paths {
    if let Some((slug, rel)) = designs::watch::design_event(pa) {
        if designs::watch::queue(&emit_dir, &slug, rel) {
            let app2 = app.clone();
            let d2 = emit_dir.clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(250));
                let paths = designs::watch::drain(&d2, &slug);
                let _ = app2.emit_to(tauri::EventTarget::webview("main"), "designs-changed",
                    serde_json::json!({ "dir": d2, "slug": slug, "paths": paths }));
            });
        }
    }
}
```

(`app` must be cloned into the closure the same way it already is for `project-fs-changed`.)

- [ ] **Step 5: Run tests**

Run: `cd src-tauri && cargo test`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/designs/watch.rs src-tauri/src/designs/mod.rs src-tauri/src/main.rs
git commit -m "feat(design): changes to a design arrive as one quiet event per burst, apart from the project's own rescans"
```

### Task 9: Thumbnails from a hidden native web view

**Files:**
- Modify: `src-tauri/src/designs/thumbs.rs`
- Modify: `src-tauri/Cargo.toml` (feature flags)
- Modify: `src-tauri/src/main.rs` (`generate_handler!`)

**Interfaces:**
- Consumes: `web::register_root`, `versions::list`, frame reporter's `document.title = "chronicle-ready:<h>"`.
- Produces: `pub fn thumb_rel(slug: &str, n: u32, frame_id: &str) -> String` = `<slug>/.versions/v<n>/thumbs/<frame_id>.png`; `pub fn thumb_frames(version_dir: &Path) -> Vec<(String, String, u32, u32)>` (id, file, width, height from that version's `design.json`); command `design_thumbnails(dir, slug, n) -> Vec<String>` returning the rels it wrote (paths relative to the designs root).

- [ ] **Step 1: Write the failing test** (pure parts)

```rust
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn thumbnail_paths_and_frames_come_from_the_version() {
        assert_eq!(thumb_rel("home", 3, "desktop"), "home/.versions/v3/thumbs/desktop.png");
        let d = std::env::temp_dir().join(format!("chronicle-thumbs-{}", std::process::id()));
        std::fs::create_dir_all(&d).unwrap();
        std::fs::write(d.join("design.json"), r#"{"frames":[{"id":"desktop","file":"frames/desktop.html","width":1440,"height":900},{"id":"bad"}]}"#).unwrap();
        assert_eq!(thumb_frames(&d), vec![("desktop".to_string(), "frames/desktop.html".to_string(), 1440, 900)]);
    }
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd src-tauri && cargo test designs::thumbs`
Expected: compile error.

- [ ] **Step 3: Implement the pure parts**

```rust
//! One PNG per frame per version, rendered by a hidden native web view that loads
//! the frame through `chronicle-file://`, waits for the reporter's ready title
//! (fonts included, at most five seconds), grows to the page height, and snapshots.
use serde_json::Value;
use std::path::Path;

pub fn thumb_rel(slug: &str, n: u32, frame_id: &str) -> String { format!("{slug}/.versions/v{n}/thumbs/{frame_id}.png") }

pub fn thumb_frames(version_dir: &Path) -> Vec<(String, String, u32, u32)> {
    let Ok(t) = std::fs::read_to_string(version_dir.join("design.json")) else { return vec![] };
    let Ok(v) = serde_json::from_str::<Value>(&t) else { return vec![] };
    v["frames"].as_array().map(|a| a.iter().filter_map(|f| Some((
        f["id"].as_str()?.to_string(), f["file"].as_str()?.to_string(),
        f["width"].as_u64()? as u32, f["height"].as_u64().unwrap_or(900) as u32,
    ))).collect()).unwrap_or_default()
}
```

- [ ] **Step 4: Run the pure test**

Run: `cd src-tauri && cargo test designs::thumbs`
Expected: PASS.

- [ ] **Step 5: Add the Cargo features**

In `src-tauri/Cargo.toml`, add `"WKSnapshotConfiguration"` to `objc2-web-kit` features, `"NSImage", "NSImageRep", "NSBitmapImageRep"` to `objc2-app-kit`, and `"NSData", "NSDictionary"` to `objc2-foundation`.

- [ ] **Step 6: Implement the command**

```rust
use std::sync::mpsc;
use std::time::{Duration, Instant};
use tauri::{Manager, State, WebviewUrl, WebviewWindowBuilder};
use crate::{project_for, OpenRoots};

fn title_of(win: &tauri::WebviewWindow) -> Option<String> {
    let (tx, rx) = mpsc::channel();
    win.with_webview(move |pw| {
        let wk: &objc2_web_kit::WKWebView = unsafe { &*(pw.inner() as *const objc2_web_kit::WKWebView) };
        let t = unsafe { wk.title() }.map(|s| s.to_string());
        let _ = tx.send(t);
    }).ok()?;
    rx.recv_timeout(Duration::from_secs(2)).ok().flatten()
}

fn snapshot_png(win: &tauri::WebviewWindow) -> Result<Vec<u8>, String> {
    use block2::RcBlock;
    use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep, NSImage};
    use objc2_foundation::{NSDictionary, NSError};
    let (tx, rx) = mpsc::channel::<Result<Vec<u8>, String>>();
    win.with_webview(move |pw| {
        let wk: &objc2_web_kit::WKWebView = unsafe { &*(pw.inner() as *const objc2_web_kit::WKWebView) };
        let tx2 = tx.clone();
        let block = RcBlock::new(move |img: *mut NSImage, _err: *mut NSError| {
            let out = (|| {
                let img = unsafe { img.as_ref() }.ok_or("the page couldn't be captured")?;
                let tiff = unsafe { img.TIFFRepresentation() }.ok_or("no image data")?;
                let rep = unsafe { NSBitmapImageRep::imageRepWithData(&tiff) }.ok_or("no bitmap")?;
                let png = unsafe { rep.representationUsingType_properties(NSBitmapImageFileType::PNG, &NSDictionary::new()) }.ok_or("no png")?;
                Ok::<Vec<u8>, &str>(png.to_vec())
            })().map_err(|e| e.to_string());
            let _ = tx2.send(out);
        });
        unsafe { wk.takeSnapshotWithConfiguration_completionHandler(None, &block) };
    }).map_err(|e| e.to_string())?;
    rx.recv_timeout(Duration::from_secs(10)).map_err(|_| "the capture timed out".to_string())?
}

#[tauri::command]
pub async fn design_thumbnails(app: tauri::AppHandle, roots: State<'_, OpenRoots>, web: State<'_, crate::web::WebState>, dir: String, slug: String, n: u32) -> Result<Vec<String>, String> {
    let p = project_for(&roots, &dir)?;
    let design = super::design_dir(&p.dir, &slug)?;
    let vdir = design.join(format!(".versions/v{n}"));
    let hash = crate::web::register_root(&web, &crate::notes::index::vault_root(&p.dir))?;
    std::fs::create_dir_all(vdir.join("thumbs")).map_err(|e| e.to_string())?;
    let mut written = Vec::new();
    for (id, file, width, height) in thumb_frames(&vdir) {
        let url = format!("chronicle-file://{hash}/.chronicle/designs/{slug}/.versions/v{n}/{file}");
        let label = format!("thumb-{}-{}", n, id.chars().filter(|c| c.is_ascii_alphanumeric()).collect::<String>());
        let win = WebviewWindowBuilder::new(&app, &label, WebviewUrl::External(url.parse().map_err(|_| "bad frame url")?))
            .visible(false).focused(false).skip_taskbar(true).decorations(false)
            .inner_size(width as f64, height as f64)
            .build().map_err(|e| e.to_string())?;
        let started = Instant::now();
        let mut page_h = height;
        while started.elapsed() < Duration::from_secs(5) {
            if let Some(t) = title_of(&win) {
                if let Some(h) = t.strip_prefix("chronicle-ready:") { page_h = h.parse().unwrap_or(height); break; }
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        let _ = win.set_size(tauri::LogicalSize::new(width as f64, page_h.min(16_000) as f64));
        std::thread::sleep(Duration::from_millis(150));
        let png = snapshot_png(&win);
        let _ = win.close();
        let bytes = png?;
        std::fs::write(vdir.join("thumbs").join(format!("{id}.png")), bytes).map_err(|e| e.to_string())?;
        written.push(thumb_rel(&slug, n, &id));
    }
    Ok(written)
}
```

The objc2 method names above follow objc2 0.6 / objc2-app-kit 0.3 naming; if the compiler reports a different name or signature (for example `imageRepWithData` returning `Option<Retained<…>>` directly, or `NSData::to_vec` requiring a feature), fix it to what the crate docs show — keep the behaviour: TIFF → bitmap rep → PNG bytes.

Register `designs::thumbs::design_thumbnails` in `generate_handler!`.

- [ ] **Step 7: Note the probe for the live check**

Whether a window built with `.visible(false)` actually paints before `takeSnapshot` can only be proven in the running app, so it is checked in Task 20's live check (a thumbnail that is a single flat colour means it did not paint). If it fails there, the fix is to build the window with `.visible(true).position(-30000.0, -30000.0)` (off-screen, still unfocused and out of the Dock). Leave a one-line comment above the builder saying so.

- [ ] **Step 8: Run tests and commit**

Run: `cd src-tauri && cargo test`
Expected: all pass.

```bash
git add src-tauri/src/designs/thumbs.rs src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/main.rs
git commit -m "feat(design): each version keeps a full-height picture of every frame"
```

### Task 10: Designs in Chronicle's agent tools (read-only)

**Files:**
- Modify: `src-tauri/src/agent_api.rs` (`caps()` ~25; handlers; tests ~613)
- Modify: `src-tauri/src/cli.rs` (`GROUPS` ~13, `INT_FLAGS` ~24, `help_text` ~147)
- Modify: `src-tauri/src/mcp.rs` (`INSTRUCTIONS`: add one line naming the two tools)
- Modify: `docs/agent-api.md` (`## Capabilities` table), `skill/chronicle/SKILL.md` (new section `## 4 · designs — read-only`, and the CLI equivalents block)

**Interfaces:**
- Consumes: `designs::list`, `designs::design_dir`, `versions::list`, `thumbs::thumb_rel`.
- Produces: tools `chronicle.designs.list` (no args) and `chronicle.designs.read` (`slug` required, `version` optional integer); CLI `chronicle designs list` and `chronicle designs read --slug home [--version 3]`.

- [ ] **Step 1: Write the failing test** (in `agent_api.rs` tests)

```rust
#[test]
fn designs_are_listed_and_read_but_never_written() {
    let d = std::env::temp_dir().join(format!("chronicle-api-designs-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d); std::fs::create_dir_all(&d).unwrap();
    let d = d.canonicalize().unwrap();
    let slug = crate::designs::create(&d, "app", "Home", "the brief", "t").unwrap();
    let dir = crate::designs::designs_root(&d).join(&slug);
    std::fs::write(dir.join("frames/a.html"), "<p>a</p>").unwrap();
    crate::designs::versions::snapshot_if_changed(&dir, "t1", "", "", "First.").unwrap();
    let l = call(&d, "chronicle.designs.list", &json!({})).unwrap();
    assert_eq!(l.data[0]["slug"], "home");
    let r = call(&d, "chronicle.designs.read", &json!({ "slug": "home" })).unwrap();
    assert_eq!(r.data["brief"], "the brief");
    assert_eq!(r.data["version"], 1);
    assert!(r.data["frameFiles"].as_array().unwrap().is_empty(), "design.json lists no frames yet");
    assert_eq!(r.data["title"], "Home");
    assert!(call(&d, "chronicle.designs.read", &json!({ "slug": "../x" })).is_err());
    assert!(catalog().iter().all(|t| !t.name.starts_with("chronicle.designs.") || t.name.ends_with(".list") || t.name.ends_with(".read")));
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd src-tauri && cargo test designs_are_listed_and_read`
Expected: FAIL, unknown tool.

- [ ] **Step 3: Implement**

Add to `caps()`:

```rust
Capability {
    spec: ToolSpec {
        name: "chronicle.designs.list",
        description: "List the project's designs from the Design pane: slug, title, kind, frame count, latest version.",
        input_schema: json!({ "type": "object", "properties": {} }),
    },
    run: designs_list,
},
Capability {
    spec: ToolSpec {
        name: "chronicle.designs.read",
        description: "Read one design: its brief, design.json, and absolute paths of its frame files and thumbnails for a version (latest by default). Read-only.",
        input_schema: json!({
            "type": "object", "required": ["slug"],
            "properties": {
                "slug": { "type": "string", "description": "the design's folder name, from chronicle.designs.list" },
                "version": { "type": "integer", "description": "a version number; omit for the latest" }
            }
        }),
    },
    run: designs_read,
},
```

Handlers:

```rust
fn designs_list(dir: &Path, _args: &Value) -> Result<Outcome, String> {
    let rows = crate::designs::list(dir);
    let summary = format!("{} design{}.", rows.len(), if rows.len() == 1 { "" } else { "s" });
    Ok(Outcome { summary, data: json!(rows) })
}

fn designs_read(dir: &Path, args: &Value) -> Result<Outcome, String> {
    let slug = required_str(args, "slug")?;
    let design = crate::designs::design_dir(dir, slug)?;
    let versions = crate::designs::versions::list(&design);
    let want = arg_u64(args, "version")?.map(|v| v as u32).or_else(|| versions.first().map(|m| m.n));
    let base = match want { Some(n) => design.join(format!(".versions/v{n}")), None => design.clone() };
    if !base.join("design.json").is_file() { return Err(format!("{slug} has no version {}", want.unwrap_or(0))); }
    let d: Value = serde_json::from_str(&std::fs::read_to_string(base.join("design.json")).map_err(|e| e.to_string())?).map_err(|_| "couldn't read this design".to_string())?;
    let frames: Vec<Value> = d["frames"].as_array().cloned().unwrap_or_default();
    let frame_files: Vec<String> = frames.iter().filter_map(|f| f["file"].as_str()).map(|f| base.join(f).to_string_lossy().to_string()).collect();
    let thumbs: Vec<String> = match want {
        Some(n) => frames.iter().filter_map(|f| f["id"].as_str())
            .map(|id| crate::designs::designs_root(dir).join(crate::designs::thumbs::thumb_rel(slug, n, id)))
            .filter(|p| p.is_file()).map(|p| p.to_string_lossy().to_string()).collect(),
        None => vec![],
    };
    let summary = format!("{} · {} frame{}{}", d["title"].as_str().unwrap_or(slug), frames.len(), if frames.len() == 1 { "" } else { "s" }, want.map(|n| format!(" · v{n}")).unwrap_or_default());
    Ok(Outcome { summary, data: json!({ "slug": slug, "title": d["title"], "kind": d["kind"], "brief": d["brief"], "design": d, "version": want, "frameFiles": frame_files, "thumbnails": thumbs }) })
}
```

(If `arg_u64` has a different return type, adapt the `version` read to it; the tool must accept a missing `version`.)

In `cli.rs`: `const GROUPS: [(&str, &[&str]); 6] = [ …existing…, ("designs", &["list", "read"]) ];` and `const INT_FLAGS: [&str; 6] = ["round", "limit", "n", "lines", "id", "version"];`. Add `designs list|read` to `help_text()`.

In `docs/agent-api.md`, add two rows to the capabilities table:

```
| `designs.list` | none | each design's slug, title, kind, frame count, latest version | `chronicle designs list` |
| `designs.read` | `slug`, optional `version` | brief, design.json, frame file and thumbnail paths | `chronicle designs read --slug home --version 3` |
```

In `skill/chronicle/SKILL.md`, add after section 3:

```
## 4 · designs — read-only

- `chronicle.designs.list` — the Design pane's designs.
- `chronicle.designs.read { slug, version? }` — a design's brief, its design.json, and the absolute paths of its frame HTML and thumbnails. Read the frame files to see exactly what was approved. Nothing here changes a design.
```

and `chronicle designs list|read [--slug s] [--version n] [dir]` in the CLI equivalents block.

- [ ] **Step 4: Run tests**

Run: `cd src-tauri && cargo test`
Expected: all pass (including `the_catalog_names_every_capability_once` and the CLI usage test).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/agent_api.rs src-tauri/src/cli.rs src-tauri/src/mcp.rs docs/agent-api.md skill/chronicle/SKILL.md
git commit -m "feat(agent): agents can list and read designs, and never change them"
```

---

## Phase B · The frontend core

### Task 11: The lane in the agent store and IPC

**Files:**
- Modify: `src/lib/ipc.ts` (~523-575)
- Modify: `src/lib/agent-session.ts`
- Test: `src/lib/agent-session.lanes.test.ts` (create)

**Interfaces:**
- Produces:
  - `export type Lane = "chat" | "design";`
  - `export const laneKey = (dir: string, lane: Lane): string` → `dir` or `` `${dir}#design` ``
  - `export function splitLaneKey(key: string): { dir: string; lane: Lane }`
  - Every existing store function keeps its `dir: string` parameter, which may now be a lane key. IPC wrappers accept that key and send `{ dir, lane }`.
  - `AcpUpdate` gains `lane?: Lane`.
  - `AgentSessionState` gains `lane: Lane`, `outside: string[]`, `endedReason: "idle" | null`, `turnEnds: number`, `lastPrompt: string`.
  - `AgentEntry` gains `{ kind: "guard"; allowed: boolean; path: string; reason: string }`.
  - `sendAgentMessage(dir, text, blocks?, opts?: { prefix?: string })` — `prefix` is prepended (plus a blank line) to the text block sent to the agent; the thread and the `display` string show `text` without it.
  - New IPC: `designOutsideFiles(dir)`, `designOutsideUndo(dir, path: string | null)`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ onUpdate: null as ((u: unknown) => void) | null, agentPrompt: vi.fn(async (..._a: unknown[]) => {}) }));
const agentPrompt = h.agentPrompt;
vi.mock("./ipc", async (orig) => ({
  ...(await orig<typeof import("./ipc")>()),
  onAcpUpdate: vi.fn(async (cb: (u: unknown) => void) => { h.onUpdate = cb; return () => {}; }),
  agentPrompt: h.agentPrompt,
  agentSessionState: vi.fn(async () => ({ alive: false })),
  agentSessionStart: vi.fn(async () => ({ started: true })),
  agentEdits: vi.fn(async () => []),
}));
vi.mock("./notes-store", () => ({}));
vi.mock("./journal", () => ({ announce: vi.fn() }));
vi.mock("@/overlays/toasts", () => ({ toastError: vi.fn(), toastSuccess: vi.fn() }));

const DIR = "/home/u/proj";

describe("lanes", () => {
  beforeEach(() => { agentPrompt.mockClear(); });

  it("keys and splits", async () => {
    const m = await import("./agent-session");
    expect(m.laneKey(DIR, "chat")).toBe(DIR);
    expect(m.laneKey(DIR, "design")).toBe(`${DIR}#design`);
    expect(m.splitLaneKey(`${DIR}#design`)).toEqual({ dir: DIR, lane: "design" });
    expect(m.splitLaneKey(DIR)).toEqual({ dir: DIR, lane: "chat" });
  });

  it("routes updates to the lane they name and never crosses", async () => {
    const m = await import("./agent-session");
    m.agentSessionFor(DIR);
    h.onUpdate!({ dir: DIR, lane: "design", message: { method: "_chronicle/session_state", params: { state: "ready", sessionId: "d1" } } });
    expect(m.agentSessionFor(m.laneKey(DIR, "design")).phase).toBe("ready");
    expect(m.agentSessionFor(DIR).phase).toBe("none");
    h.onUpdate!({ dir: DIR, message: { method: "_chronicle/session_state", params: { state: "ready", sessionId: "c1" } } });
    expect(m.agentSessionFor(DIR).phase).toBe("ready");
  });

  it("records guards, outside changes, idle ends and turn ends in the design lane", async () => {
    const m = await import("./agent-session");
    const key = m.laneKey(DIR, "design");
    h.onUpdate!({ dir: DIR, lane: "design", message: { method: "_chronicle/guard", params: { toolCallId: "t", allowed: false, path: "/p/src/a.ts", reason: "no" } } });
    h.onUpdate!({ dir: DIR, lane: "design", message: { method: "_chronicle/outside_changes", params: { paths: ["src/a.ts"] } } });
    h.onUpdate!({ dir: DIR, lane: "design", message: { method: "_chronicle/turn_end", params: { stopReason: "end_turn" } } });
    h.onUpdate!({ dir: DIR, lane: "design", message: { method: "_chronicle/session_state", params: { state: "ended", reason: "idle" } } });
    const s = m.agentSessionFor(key);
    expect(s.entries.some((e) => e.kind === "guard" && !e.allowed)).toBe(true);
    expect(s.outside).toEqual(["src/a.ts"]);
    expect(s.turnEnds).toBe(1);
    expect(s.phase).toBe("ended");
    expect(s.endedReason).toBe("idle");
  });

  it("sends the prefix to the agent but shows the plain text", async () => {
    const m = await import("./agent-session");
    const key = m.laneKey(DIR, "design");
    m.agentSessionFor(key).phase = "ready";
    await m.sendAgentMessage(key, "Make it bolder", undefined, { prefix: "[design: home · .chronicle/designs/home/]" });
    expect(agentPrompt).toHaveBeenCalledWith(key, [{ type: "text", text: "[design: home · .chronicle/designs/home/]\n\nMake it bolder" }], "Make it bolder");
    const last = m.agentSessionFor(key).entries.at(-1)!;
    expect(last.kind === "user" && last.text).toBe("Make it bolder");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/agent-session.lanes.test.ts`
Expected: FAIL (`laneKey` is not a function).

- [ ] **Step 3: IPC**

In `ipc.ts`, add near the agent section:

```ts
export type Lane = "chat" | "design";
export function splitLaneKey(key: string): { dir: string; lane: Lane } {
  return key.endsWith("#design") ? { dir: key.slice(0, -"#design".length), lane: "design" } : { dir: key, lane: "chat" };
}
const laneArgs = (key: string) => splitLaneKey(key);
```

Change every agent wrapper that takes `dir` (`agentSessionStart`, `agentSessionState`, `agentPrompt`, `agentCancel`, `agentSetMode`, `agentSetConfigOption`, `agentRespondPermission`, `agentSessionStop`, `agentSessionResume`, `agentSessionsList`, `agentHistoryRead`) to spread `laneArgs(dir)` into its invoke args, e.g.:

```ts
export const agentPrompt = (dir: string, blocks: unknown[], display: string) =>
  invoke<void>("agent_prompt", { ...laneArgs(dir), blocks, display });
```

`AcpUpdate` becomes `{ dir: string; lane?: Lane; message: … }`. Add:

```ts
export const designOutsideFiles = (dir: string) => invoke<AgentEditFile[]>("design_outside_files", { dir });
export const designOutsideUndo = (dir: string, path: string | null) => invoke<number>("design_outside_undo", { dir, path });
```

(`AgentEditFile` is the type `agentEdits` already returns; import or reuse it.)

- [ ] **Step 4: Store**

In `agent-session.ts`:
- Re-export: `export { splitLaneKey, type Lane } from "./ipc";` and `export const laneKey = (dir: string, lane: Lane) => (lane === "chat" ? dir : `${dir}#design`);`
- Extend `AgentSessionState` and `blank()` with `lane: "chat"`, `outside: []`, `endedReason: null`, `turnEnds: 0`, `lastPrompt: ""`. In `agentSessionFor(dir)`, when creating, set `s.lane = splitLaneKey(dir).lane`.
- `routeUpdate`: `const key = laneKey(u.dir, u.lane ?? "chat"); reduceInto(agentSessionFor(key), key, u.message ?? {}, true);`
- Inside `reduceInto`, compute `const { dir: projectDir, lane } = splitLaneKey(dir);` once. Use `projectDir` wherever a path is made project-relative (`projectRelative`/`toolDetail` calls). Guard the chat-only side effects with `if (lane === "chat")`: `refreshAgentEdits`, `dropQueueWaiters`, `clearRunningRound`, `dropQueuedPrompts`, `settleRoundPlan`, `settleRoundRun`, and the round-related branches.
- New branches:

```ts
} else if (method === "_chronicle/guard") {
  s.entries.push({ kind: "guard", allowed: !!params.allowed, path: str(params.path), reason: str(params.reason) });
} else if (method === "_chronicle/outside_changes") {
  const paths = Array.isArray(params.paths) ? (params.paths as unknown[]).map(String) : [];
  s.outside = typeof params.reverted === "number" ? [] : Array.from(new Set([...s.outside, ...paths]));
}
```

- In the `_chronicle/turn_end` branch add `if (live) s.turnEnds += 1;`.
- In the `session_state` `ended` branch add `s.endedReason = params.reason === "idle" ? "idle" : null;` and in `ready` set `s.endedReason = null`.
- `sendAgentMessage(dir, text, blocks?, opts?: { prefix?: string })`: build `const sent = opts?.prefix ? `${opts.prefix}\n\n${body}` : body;`, call `agentPrompt(dir, blocks ?? [{ type: "text", text: sent }], body)`, and set `s.lastPrompt = body`.
- Add `{ kind: "guard"; allowed: boolean; path: string; reason: string }` to the `AgentEntry` union.

- [ ] **Step 5: Run the new test and every agent-session suite**

Run: `npx vitest run src/lib/agent-session`
Expected: all pass (the existing replay, limits, resume, thoughts and tree suites still pass because chat keys are unchanged).

- [ ] **Step 6: Typecheck and commit**

Run: `npx tsc --noEmit -p .` — Expected: no errors.

```bash
git add src/lib/ipc.ts src/lib/agent-session.ts src/lib/agent-session.lanes.test.ts
git commit -m "feat(agent): the store keeps a design lane beside the chat, keyed by the same project"
```

### Task 12: The design model and canvas maths

**Files:**
- Create: `src/lib/design-model.ts`, `src/lib/design-model.test.ts`
- Create: `src/lib/canvas-math.ts`, `src/lib/canvas-math.test.ts`

**Interfaces:**
- Produces (`design-model.ts`):
  - `export type DesignKind = "app" | "marketing" | "deck" | "brand" | "ecommerce";`
  - `export const KIND_LABEL: Record<DesignKind, string>` = App UI, Marketing, Deck, Brand, E-commerce.
  - `export interface Frame { id: string; file: string; label: string; width: number; height: number; group: string }`
  - `export interface Group { id: string; label: string; kind: "breakpoints" | "variations" }`
  - `export interface Design { v: 1; title: string; kind: DesignKind; brief: string; created: string; frames: Frame[]; groups: Group[]; chosen: string | null }`
  - `export interface CanvasFile { positions: Record<string, { x: number; y: number }>; viewport: Viewport | null }`
  - `export function parseDesign(raw: unknown): Design | null` (drops invalid frames; unknown kind → null)
  - `export function placeFrames(d: Design, positions: CanvasFile["positions"], heights: Record<string, number>): Record<string, { x: number; y: number; w: number; h: number }>`
  - `export function readingOrder(rects: Record<string, { x: number; y: number }>): string[]`
  - `export interface DesignRow { slug: string; title: string; kind: DesignKind; frames: number; created: string; latestVersion: number | null; updatedMs: number; bad: boolean }`
  - `export function orderRows(rows: DesignRow[], order: Record<string, string[]>): Record<DesignKind, DesignRow[]>`
- Produces (`canvas-math.ts`):
  - `export interface Viewport { x: number; y: number; zoom: number }` (screen = world × zoom + (x, y))
  - `export const ZOOM_MIN = 0.05, ZOOM_MAX = 2, LIVE_MIN_ZOOM = 0.15, LIVE_MAX = 6;`
  - `export function clampZoom(z: number): number`
  - `export function zoomAt(v: Viewport, factor: number, sx: number, sy: number): Viewport`
  - `export function fit(rects: Rect[], w: number, h: number, pad = 48): Viewport`
  - `export function worldToScreen(v: Viewport, x: number, y: number): { x: number; y: number }`
  - `export function liveFrames(rects: Record<string, Rect>, v: Viewport, w: number, h: number): Set<string>`
  - `export type Rect = { x: number; y: number; w: number; h: number }`

- [ ] **Step 1: Write the failing tests**

`design-model.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseDesign, placeFrames, readingOrder, orderRows, type DesignRow } from "./design-model";

const raw = {
  v: 1, title: "Home", kind: "ecommerce", brief: "b", created: "t",
  frames: [
    { id: "desktop", file: "frames/desktop.html", label: "Desktop", width: 1440, height: 900, group: "bp" },
    { id: "mobile", file: "frames/mobile.html", label: "Mobile", width: 390, height: 844, group: "bp" },
    { id: "a", file: "frames/a.html", label: "A", width: 1440, height: 720, group: "hero" },
    { id: "broken" },
  ],
  groups: [{ id: "bp", label: "Breakpoints", kind: "breakpoints" }, { id: "hero", label: "Hero", kind: "variations" }],
  chosen: null,
};

describe("design model", () => {
  it("parses and drops broken frames", () => {
    const d = parseDesign(raw)!;
    expect(d.frames.map((f) => f.id)).toEqual(["desktop", "mobile", "a"]);
    expect(parseDesign({ ...raw, kind: "poster" })).toBeNull();
    expect(parseDesign("nope")).toBeNull();
  });
  it("places groups in rows, keeps stored positions, and uses reported heights", () => {
    const d = parseDesign(raw)!;
    const r = placeFrames(d, { mobile: { x: 5000, y: 10 } }, { desktop: 2600 });
    expect(r.desktop).toEqual({ x: 0, y: 0, w: 1440, h: 2600 });
    expect(r.mobile).toEqual({ x: 5000, y: 10, w: 390, h: 844 });
    expect(r.a.y).toBeGreaterThanOrEqual(2600 + 120);
  });
  it("orders frames top to bottom, left to right", () => {
    expect(readingOrder({ b: { x: 900, y: 0 }, a: { x: 0, y: 0 }, c: { x: 0, y: 1000 } })).toEqual(["a", "b", "c"]);
  });
  it("groups rows by kind in the user's order, newest first otherwise", () => {
    const rows: DesignRow[] = [
      { slug: "x", title: "X", kind: "app", frames: 1, created: "", latestVersion: 1, updatedMs: 1, bad: false },
      { slug: "y", title: "Y", kind: "app", frames: 1, created: "", latestVersion: 1, updatedMs: 5, bad: false },
      { slug: "z", title: "Z", kind: "brand", frames: 0, created: "", latestVersion: null, updatedMs: 9, bad: false },
    ];
    const g = orderRows(rows, { app: ["x"] });
    expect(g.app.map((r) => r.slug)).toEqual(["x", "y"]);
    expect(g.brand.map((r) => r.slug)).toEqual(["z"]);
    expect(g.deck).toEqual([]);
  });
});
```

`canvas-math.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { clampZoom, zoomAt, fit, worldToScreen, liveFrames } from "./canvas-math";

describe("canvas maths", () => {
  it("clamps zoom", () => { expect(clampZoom(10)).toBe(2); expect(clampZoom(0.001)).toBe(0.05); });
  it("zooms about the pointer", () => {
    const v = zoomAt({ x: 0, y: 0, zoom: 1 }, 2, 100, 100);
    expect(worldToScreen(v, 100, 100)).toEqual({ x: 100, y: 100 });
    expect(v.zoom).toBe(2);
  });
  it("fits every frame inside the view with padding", () => {
    const v = fit([{ x: 0, y: 0, w: 1000, h: 500 }, { x: 1100, y: 0, w: 400, h: 800 }], 800, 600, 50);
    const a = worldToScreen(v, 0, 0); const b = worldToScreen(v, 1500, 800);
    expect(a.x).toBeGreaterThanOrEqual(50); expect(b.x).toBeLessThanOrEqual(750);
    expect(a.y).toBeGreaterThanOrEqual(50); expect(b.y).toBeLessThanOrEqual(550);
  });
  it("makes at most six on-screen frames live, only when zoomed in enough, nearest the centre first", () => {
    const rects = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`f${i}`, { x: i * 200, y: 0, w: 150, h: 150 }]));
    expect(liveFrames(rects, { x: 0, y: 0, zoom: 0.1 }, 2000, 1000).size).toBe(0);
    const live = liveFrames(rects, { x: 0, y: 0, zoom: 1 }, 1000, 400);
    expect(live.size).toBeLessThanOrEqual(6);
    expect(live.has("f8")).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/lib/design-model.test.ts src/lib/canvas-math.test.ts`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement `canvas-math.ts`**

```ts
/* The canvas's coordinate maths, pure. World units are CSS px of the design;
   screen = world × zoom + (x, y). */
export interface Viewport { x: number; y: number; zoom: number }
export type Rect = { x: number; y: number; w: number; h: number };
export const ZOOM_MIN = 0.05, ZOOM_MAX = 2, LIVE_MIN_ZOOM = 0.15, LIVE_MAX = 6;

export const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));

export function worldToScreen(v: Viewport, x: number, y: number) {
  return { x: x * v.zoom + v.x, y: y * v.zoom + v.y };
}

export function zoomAt(v: Viewport, factor: number, sx: number, sy: number): Viewport {
  const zoom = clampZoom(v.zoom * factor);
  const wx = (sx - v.x) / v.zoom, wy = (sy - v.y) / v.zoom;
  return { zoom, x: sx - wx * zoom, y: sy - wy * zoom };
}

export function fit(rects: Rect[], w: number, h: number, pad = 48): Viewport {
  if (!rects.length) return { x: pad, y: pad, zoom: 1 };
  const minX = Math.min(...rects.map((r) => r.x)), minY = Math.min(...rects.map((r) => r.y));
  const maxX = Math.max(...rects.map((r) => r.x + r.w)), maxY = Math.max(...rects.map((r) => r.y + r.h));
  const zoom = clampZoom(Math.min((w - pad * 2) / (maxX - minX || 1), (h - pad * 2) / (maxY - minY || 1)));
  return { zoom, x: pad - minX * zoom + ((w - pad * 2) - (maxX - minX) * zoom) / 2, y: pad - minY * zoom };
}

export function liveFrames(rects: Record<string, Rect>, v: Viewport, w: number, h: number): Set<string> {
  if (v.zoom < LIVE_MIN_ZOOM) return new Set();
  const cx = w / 2, cy = h / 2;
  const visible = Object.entries(rects)
    .map(([id, r]) => {
      const a = worldToScreen(v, r.x, r.y), b = worldToScreen(v, r.x + r.w, r.y + r.h);
      const on = b.x > 0 && a.x < w && b.y > 0 && a.y < h;
      const d = Math.hypot((a.x + b.x) / 2 - cx, (a.y + b.y) / 2 - cy);
      return { id, on, d };
    })
    .filter((f) => f.on)
    .sort((p, q) => p.d - q.d)
    .slice(0, LIVE_MAX);
  return new Set(visible.map((f) => f.id));
}
```

- [ ] **Step 4: Implement `design-model.ts`**

```ts
/* A design as the canvas sees it: design.json (the session's) + canvas.json (the app's). */
import type { Viewport } from "./canvas-math";

export type DesignKind = "app" | "marketing" | "deck" | "brand" | "ecommerce";
export const KINDS: DesignKind[] = ["ecommerce", "app", "marketing", "brand", "deck"];
export const KIND_LABEL: Record<DesignKind, string> = { app: "App UI", marketing: "Marketing", deck: "Deck", brand: "Brand", ecommerce: "E-commerce" };

export interface Frame { id: string; file: string; label: string; width: number; height: number; group: string }
export interface Group { id: string; label: string; kind: "breakpoints" | "variations" }
export interface Design { v: 1; title: string; kind: DesignKind; brief: string; created: string; frames: Frame[]; groups: Group[]; chosen: string | null }
export interface CanvasFile { positions: Record<string, { x: number; y: number }>; viewport: Viewport | null }
export interface DesignRow { slug: string; title: string; kind: DesignKind; frames: number; created: string; latestVersion: number | null; updatedMs: number; bad: boolean }

const isKind = (k: unknown): k is DesignKind => typeof k === "string" && (KINDS as string[]).includes(k);
const num = (n: unknown) => (typeof n === "number" && Number.isFinite(n) && n > 0 ? n : null);

export function parseDesign(raw: unknown): Design | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!isKind(r.kind)) return null;
  const frames: Frame[] = (Array.isArray(r.frames) ? r.frames : []).flatMap((f) => {
    const o = f as Record<string, unknown>;
    const width = num(o.width), height = num(o.height);
    if (typeof o.id !== "string" || typeof o.file !== "string" || !width) return [];
    return [{ id: o.id, file: o.file, label: typeof o.label === "string" ? o.label : o.id, width, height: height ?? 900, group: typeof o.group === "string" ? o.group : "" }];
  });
  const groups: Group[] = (Array.isArray(r.groups) ? r.groups : []).flatMap((g) => {
    const o = g as Record<string, unknown>;
    if (typeof o.id !== "string") return [];
    return [{ id: o.id, label: typeof o.label === "string" ? o.label : o.id, kind: o.kind === "variations" ? "variations" : "breakpoints" }];
  });
  return { v: 1, title: typeof r.title === "string" ? r.title : "Untitled", kind: r.kind, brief: typeof r.brief === "string" ? r.brief : "", created: typeof r.created === "string" ? r.created : "", frames, groups, chosen: typeof r.chosen === "string" ? r.chosen : null };
}

const COL_GAP = 80, ROW_GAP = 120;

export function placeFrames(d: Design, positions: CanvasFile["positions"], heights: Record<string, number>) {
  const out: Record<string, { x: number; y: number; w: number; h: number }> = {};
  const groupIds = [...d.groups.map((g) => g.id), ...new Set(d.frames.map((f) => f.group).filter((g) => !d.groups.some((x) => x.id === g)))];
  let rowY = 0;
  for (const gid of groupIds) {
    const frames = d.frames.filter((f) => f.group === gid);
    if (!frames.length) continue;
    let x = 0, rowH = 0;
    for (const f of frames) {
      const h = heights[f.id] ?? f.height;
      const p = positions[f.id] ?? { x, y: rowY };
      out[f.id] = { x: p.x, y: p.y, w: f.width, h };
      x += f.width + COL_GAP;
      rowH = Math.max(rowH, h);
    }
    rowY += rowH + ROW_GAP;
  }
  return out;
}

export function readingOrder(rects: Record<string, { x: number; y: number }>): string[] {
  return Object.entries(rects).sort(([, a], [, b]) => (a.y === b.y ? a.x - b.x : a.y - b.y)).map(([id]) => id);
}

export function orderRows(rows: DesignRow[], order: Record<string, string[]>): Record<DesignKind, DesignRow[]> {
  const out = Object.fromEntries(KINDS.map((k) => [k, [] as DesignRow[]])) as Record<DesignKind, DesignRow[]>;
  for (const k of KINDS) {
    const mine = rows.filter((r) => r.kind === k);
    const pinned = (order[k] ?? []).map((s) => mine.find((r) => r.slug === s)).filter((r): r is DesignRow => !!r);
    const rest = mine.filter((r) => !pinned.includes(r)).sort((a, b) => b.updatedMs - a.updatedMs);
    out[k] = [...pinned, ...rest];
  }
  return out;
}
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run src/lib/design-model.test.ts src/lib/canvas-math.test.ts`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/design-model.ts src/lib/design-model.test.ts src/lib/canvas-math.ts src/lib/canvas-math.test.ts
git commit -m "feat(design): a design model and the canvas's zoom, fit and live-frame maths"
```

### Task 13: The design store

**Files:**
- Modify: `src/lib/ipc.ts` (design wrappers + `onDesignsChanged`)
- Create: `src/lib/design-store.ts`, `src/lib/design-store.test.ts`

**Interfaces:**
- Consumes: Task 3/6/7/9 commands, `laneKey`, `agentSessionFor`, `subscribeAgent`, `sendAgentMessage`, `startAgentSession`, `resumeAgentSession`, `limitsReading`.
- Produces (ipc): `designsList(dir)`, `designCreate(dir, kind, title, brief)`, `designRead(dir, slug)`, `designRename(dir, slug, title)`, `designSetKind(dir, slug, kind)`, `designTrash(dir, slug)`, `designUntrash(dir, trashRel)`, `designCanvasSave(dir, slug, canvas)`, `designsOrderSave(dir, order)`, `designSnapshot(dir, slug, prompt, summary, session)`, `designVersions(dir, slug)`, `designRestore(dir, slug, n)`, `designBranch(dir, slug, n: number | null)`, `designFrameBase(dir)`, `designThumbnails(dir, slug, n)`, `onDesignsChanged(cb: (e: { dir: string; slug: string; paths: string[] }) => void)`, `export interface VersionMeta { n: number; at: string; session: string; prompt: string; summary: string; hash: string }`.
- Produces (store):
  - `export type FrameState = { kind: "placeholder" } | { kind: "rendering" } | { kind: "rendered"; height: number } | { kind: "failed"; message: string; line: number }`
  - `export interface DesignProject { rows: DesignRow[]; order: Record<string, string[]>; active: string | null; design: Design | null; canvas: CanvasFile; bad: boolean; frameStates: Record<string, FrameState>; base: string | null; versions: VersionMeta[]; reloadTick: number; undo: UndoEntry[]; redo: UndoEntry[] }`
  - `export function designProjectFor(dir: string): DesignProject`, `export function subscribeDesigns(cb: () => void): () => void`
  - `export async function loadDesigns(dir: string): Promise<void>`, `export async function openDesign(dir: string, slug: string): Promise<void>`
  - `export function frameMessage(dir: string, frameId: string, data: unknown): void` — validates `__chronicleFrame === 1` and updates `frameStates`.
  - `export async function startDesign(dir: string, kind: DesignKind, brief: string): Promise<string>`
  - `export async function sendDesignMessage(dir: string, text: string): Promise<void>` — starts or resumes the design lane when needed, waits for `ready` (90 s), then sends with prefix `[design: <slug> · .chronicle/designs/<slug>/]`.
  - `export function designPrefix(slug: string): string`
  - `export type UndoEntry = { label: string; undo: () => Promise<void>; redo: () => Promise<void> }`; `export async function runUndoable(dir: string, e: UndoEntry): Promise<void>` (runs `redo`, pushes to `undo`, clears `redo`); `undoDesign(dir)`, `redoDesign(dir)`.
  - `export function moveFrame(dir: string, frameId: string, x: number, y: number): Promise<void>` (undoable; saves canvas).
  - `export function renameDesign`, `trashDesign` (undo = untrash), `setDesignKind`, `reorderDesigns(dir, kind, slugs)` — all undoable.
  - `export function summaryOf(entries: AgentEntry[]): string` — first sentence of the last assistant entry.
  - Snapshots: when the design lane's `turnEnds` increases, the store calls `designSnapshot(dir, active, lastPrompt, summaryOf(entries), sessionId)`, then, if a number came back, `designThumbnails(dir, active, n)` and `designVersions`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from "vitest";

const h = vi.hoisted(() => ({ calls: [] as string[], restore: vi.fn(async (_d: string, _s: string, n: number) => n + 10) }));
const calls = h.calls;
vi.mock("./ipc", async (orig) => ({
  ...(await orig<typeof import("./ipc")>()),
  onDesignsChanged: vi.fn(async () => () => {}),
  designsList: vi.fn(async () => ({ rows: [{ slug: "home", title: "Home", kind: "app", frames: 1, created: "", latestVersion: 1, updatedMs: 1, bad: false }], order: {} })),
  designRead: vi.fn(async () => ({ design: { v: 1, title: "Home", kind: "app", brief: "", created: "", frames: [{ id: "d", file: "frames/d.html", label: "D", width: 1440, height: 900, group: "bp" }], groups: [{ id: "bp", label: "BP", kind: "breakpoints" }], chosen: null }, canvas: { positions: {}, viewport: null }, bad: false })),
  designFrameBase: vi.fn(async () => "chronicle-file://h/.chronicle/designs/"),
  designVersions: vi.fn(async () => []),
  designCanvasSave: vi.fn(async (_d: string, _s: string, c: unknown) => { h.calls.push(JSON.stringify(c)); }),
  designRename: vi.fn(async (_d: string, _s: string, t: string) => { h.calls.push(`rename:${t}`); }),
  designRestore: h.restore,
  designBranch: vi.fn(async () => "home-2"),
}));
vi.mock("./agent-session", async () => ({
  laneKey: (d: string) => `${d}#design`,
  agentSessionFor: () => ({ phase: "ready", entries: [], turnEnds: 0, lastPrompt: "", sessionId: "s" }),
  subscribeAgent: () => () => {},
  sendAgentMessage: vi.fn(async () => {}),
  startAgentSession: vi.fn(async () => {}),
  resumeAgentSession: vi.fn(async () => {}),
}));

const DIR = "/p";

describe("design store", () => {
  it("loads, opens, tracks frame reports and ignores foreign messages", async () => {
    const m = await import("./design-store");
    await m.loadDesigns(DIR);
    await m.openDesign(DIR, "home");
    const p = m.designProjectFor(DIR);
    expect(p.active).toBe("home");
    expect(p.design?.frames[0].id).toBe("d");
    m.frameMessage(DIR, "d", { __chronicleFrame: 1, type: "ready", height: 2400 });
    expect(p.frameStates.d).toEqual({ kind: "rendered", height: 2400 });
    m.frameMessage(DIR, "d", { type: "error", message: "x", line: 1 });
    expect(p.frameStates.d.kind).toBe("rendered");
    m.frameMessage(DIR, "d", { __chronicleFrame: 1, type: "error", message: "Unexpected token", line: 214 });
    expect(p.frameStates.d).toEqual({ kind: "failed", message: "Unexpected token", line: 214 });
  });
  it("undoes and redoes a move and a rename", async () => {
    const m = await import("./design-store");
    calls.length = 0;
    await m.moveFrame(DIR, "d", 10, 20);
    await m.renameDesign(DIR, "home", "Front");
    await m.undoDesign(DIR);
    await m.undoDesign(DIR);
    await m.redoDesign(DIR);
    expect(calls).toEqual([
      JSON.stringify({ positions: { d: { x: 10, y: 20 } }, viewport: null }),
      "rename:Front",
      "rename:Home",
      JSON.stringify({ positions: {}, viewport: null }),
      JSON.stringify({ positions: { d: { x: 10, y: 20 } }, viewport: null }),
    ]);
  });
  it("summarises and prefixes", async () => {
    const m = await import("./design-store");
    expect(m.designPrefix("home")).toBe("[design: home · .chronicle/designs/home/]");
    expect(m.summaryOf([{ kind: "assistant", text: "Added three frames. Then more." } as never])).toBe("Added three frames.");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/design-store.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: IPC wrappers** (in `ipc.ts`)

```ts
export interface VersionMeta { n: number; at: string; session: string; prompt: string; summary: string; hash: string }
export interface DesignsChanged { dir: string; slug: string; paths: string[] }
export const designsList = (dir: string) => invoke<{ rows: import("./design-model").DesignRow[]; order: Record<string, string[]> }>("designs_list", { dir });
export const designCreate = (dir: string, kind: string, title: string, brief: string) => invoke<string>("design_create", { dir, kind, title, brief });
export const designRead = (dir: string, slug: string) => invoke<{ design: unknown; canvas: unknown; bad: boolean }>("design_read", { dir, slug });
export const designRename = (dir: string, slug: string, title: string) => invoke<void>("design_rename", { dir, slug, title });
export const designSetKind = (dir: string, slug: string, kind: string) => invoke<void>("design_set_kind", { dir, slug, kind });
export const designTrash = (dir: string, slug: string) => invoke<string>("design_trash", { dir, slug });
export const designUntrash = (dir: string, trashRel: string) => invoke<string>("design_untrash", { dir, trashRel });
export const designCanvasSave = (dir: string, slug: string, canvas: unknown) => invoke<void>("design_canvas_save", { dir, slug, canvas });
export const designsOrderSave = (dir: string, order: unknown) => invoke<void>("designs_order_save", { dir, order });
export const designSnapshot = (dir: string, slug: string, prompt: string, summary: string, session: string) => invoke<number | null>("design_snapshot", { dir, slug, prompt, summary, session });
export const designVersions = (dir: string, slug: string) => invoke<VersionMeta[]>("design_versions", { dir, slug });
export const designRestore = (dir: string, slug: string, n: number) => invoke<number>("design_restore", { dir, slug, n });
export const designBranch = (dir: string, slug: string, n: number | null) => invoke<string>("design_branch", { dir, slug, n });
export const designFrameBase = (dir: string) => invoke<string>("design_frame_base", { dir });
export const designThumbnails = (dir: string, slug: string, n: number) => invoke<string[]>("design_thumbnails", { dir, slug, n });
export const onDesignsChanged = (cb: (e: DesignsChanged) => void) => listen<DesignsChanged>("designs-changed", (e) => cb(e.payload));
```

(Tauri converts camelCase JS args to snake_case Rust params, so `trashRel` reaches `trash_rel`.)

- [ ] **Step 4: Implement `design-store.ts`**

```ts
/* The Design pane's state per project: the design list, the open design, how each
   frame rendered, the user's undo stack, and the glue that turns a finished design
   turn into a version. Mirrors notes-store: module Maps, one subscribe, no React. */
import {
  designsList, designRead, designFrameBase, designVersions, designCanvasSave, designRename, designSetKind,
  designTrash, designUntrash, designsOrderSave, designCreate, designSnapshot, designThumbnails, onDesignsChanged,
  type VersionMeta,
} from "./ipc";
import { parseDesign, type CanvasFile, type Design, type DesignKind, type DesignRow } from "./design-model";
import {
  laneKey, agentSessionFor, subscribeAgent, sendAgentMessage, startAgentSession, resumeAgentSession, type AgentEntry,
} from "./agent-session";

export type FrameState = { kind: "placeholder" } | { kind: "rendering" } | { kind: "rendered"; height: number } | { kind: "failed"; message: string; line: number };
export type UndoEntry = { label: string; undo: () => Promise<void>; redo: () => Promise<void> };
export interface DesignProject {
  rows: DesignRow[]; order: Record<string, string[]>; active: string | null; design: Design | null; canvas: CanvasFile;
  bad: boolean; frameStates: Record<string, FrameState>; base: string | null; versions: VersionMeta[]; reloadTick: number;
  undo: UndoEntry[]; redo: UndoEntry[]; seenTurnEnds: number;
}

const projects = new Map<string, DesignProject>();
const subs = new Set<() => void>();
let ready = false;
const notify = () => { for (const cb of subs) cb(); };
const emptyCanvas = (): CanvasFile => ({ positions: {}, viewport: null });

export function designProjectFor(dir: string): DesignProject {
  ensure();
  let p = projects.get(dir);
  if (!p) {
    p = { rows: [], order: {}, active: null, design: null, canvas: emptyCanvas(), bad: false, frameStates: {}, base: null, versions: [], reloadTick: 0, undo: [], redo: [], seenTurnEnds: 0 };
    projects.set(dir, p);
  }
  return p;
}

export function subscribeDesigns(cb: () => void): () => void { ensure(); subs.add(cb); return () => subs.delete(cb); }

function ensure() {
  if (ready) return;
  ready = true;
  void onDesignsChanged((e) => {
    const p = projects.get(e.dir);
    if (!p) return;
    void loadDesigns(e.dir);
    if (p.active === e.slug && e.paths.some((x) => x !== "canvas.json")) void openDesign(e.dir, e.slug, true);
  });
  subscribeAgent(() => {
    for (const [dir, p] of projects) {
      const s = agentSessionFor(laneKey(dir, "design"));
      if (s.turnEnds > p.seenTurnEnds) {
        p.seenTurnEnds = s.turnEnds;
        if (p.active) void snapshotTurn(dir, p.active);
      }
    }
  });
}

export const designPrefix = (slug: string) => `[design: ${slug} · .chronicle/designs/${slug}/]`;

export function summaryOf(entries: AgentEntry[]): string {
  const last = [...entries].reverse().find((e) => e.kind === "assistant") as { text?: string } | undefined;
  const text = (last?.text ?? "").trim();
  const m = text.match(/^[\s\S]*?[.!?](\s|$)/);
  return (m ? m[0] : text).trim().slice(0, 200);
}

async function snapshotTurn(dir: string, slug: string) {
  const s = agentSessionFor(laneKey(dir, "design"));
  const n = await designSnapshot(dir, slug, s.lastPrompt, summaryOf(s.entries), s.sessionId ?? "").catch(() => null);
  const p = designProjectFor(dir);
  if (n != null) await designThumbnails(dir, slug, n).catch(() => []);
  p.versions = await designVersions(dir, slug).catch(() => p.versions);
  await loadDesigns(dir);
  notify();
}

export async function loadDesigns(dir: string): Promise<void> {
  const p = designProjectFor(dir);
  const r = await designsList(dir);
  p.rows = r.rows; p.order = r.order ?? {};
  notify();
}

export async function openDesign(dir: string, slug: string, reload = false): Promise<void> {
  const p = designProjectFor(dir);
  if (!p.base) p.base = await designFrameBase(dir);
  const r = await designRead(dir, slug);
  p.active = slug;
  p.design = parseDesign(r.design);
  p.bad = r.bad || (!!r.design && !p.design);
  p.canvas = (r.canvas as CanvasFile) ?? emptyCanvas();
  if (!reload) p.frameStates = {};
  for (const f of p.design?.frames ?? []) if (!p.frameStates[f.id] || reload) p.frameStates[f.id] = { kind: "rendering" };
  if (reload) p.reloadTick += 1;
  p.versions = await designVersions(dir, slug).catch(() => []);
  notify();
}

export function frameMessage(dir: string, frameId: string, data: unknown): void {
  if (!data || typeof data !== "object" || (data as Record<string, unknown>).__chronicleFrame !== 1) return;
  const d = data as Record<string, unknown>;
  const p = designProjectFor(dir);
  if (d.type === "ready" || d.type === "height") {
    const h = Number(d.height);
    if (Number.isFinite(h) && h > 0) p.frameStates[frameId] = { kind: "rendered", height: h };
  } else if (d.type === "error") {
    p.frameStates[frameId] = { kind: "failed", message: String(d.message ?? "The page hit an error"), line: Number(d.line) || 0 };
  } else if (d.type === "blank") {
    p.frameStates[frameId] = { kind: "failed", message: "The page came out empty", line: 0 };
  } else return;
  notify();
}

export async function runUndoable(dir: string, e: UndoEntry): Promise<void> {
  const p = designProjectFor(dir);
  await e.redo();
  p.undo.push(e); p.redo = [];
  notify();
}
export async function undoDesign(dir: string) {
  const p = designProjectFor(dir); const e = p.undo.pop(); if (!e) return;
  await e.undo(); p.redo.push(e); notify();
}
export async function redoDesign(dir: string) {
  const p = designProjectFor(dir); const e = p.redo.pop(); if (!e) return;
  await e.redo(); p.undo.push(e); notify();
}

export function moveFrame(dir: string, frameId: string, x: number, y: number): Promise<void> {
  const p = designProjectFor(dir); const slug = p.active; if (!slug) return Promise.resolve();
  const before = structuredClone(p.canvas);
  const after: CanvasFile = { ...before, positions: { ...before.positions, [frameId]: { x, y } } };
  const apply = (c: CanvasFile) => async () => { p.canvas = structuredClone(c); await designCanvasSave(dir, slug, p.canvas); notify(); };
  return runUndoable(dir, { label: "Move frame", undo: apply(before), redo: apply(after) });
}

export function renameDesign(dir: string, slug: string, title: string): Promise<void> {
  const p = designProjectFor(dir);
  const old = p.rows.find((r) => r.slug === slug)?.title ?? p.design?.title ?? slug;
  const apply = (t: string) => async () => { await designRename(dir, slug, t); await loadDesigns(dir); if (p.active === slug && p.design) p.design.title = t; };
  return runUndoable(dir, { label: "Rename", undo: apply(old), redo: apply(title) });
}

export function setDesignKind(dir: string, slug: string, kind: DesignKind): Promise<void> {
  const p = designProjectFor(dir);
  const old = p.rows.find((r) => r.slug === slug)?.kind ?? "app";
  const apply = (k: DesignKind) => async () => { await designSetKind(dir, slug, k); await loadDesigns(dir); };
  return runUndoable(dir, { label: "Change kind", undo: apply(old), redo: apply(kind) });
}

export function trashDesign(dir: string, slug: string): Promise<void> {
  const p = designProjectFor(dir);
  let trashRel = ""; let current = slug;
  return runUndoable(dir, {
    label: "Delete design",
    redo: async () => { trashRel = await designTrash(dir, current); if (p.active === current) { p.active = null; p.design = null; } await loadDesigns(dir); },
    undo: async () => { current = await designUntrash(dir, trashRel); await loadDesigns(dir); },
  });
}

export function reorderDesigns(dir: string, kind: DesignKind, slugs: string[]): Promise<void> {
  const p = designProjectFor(dir);
  const before = structuredClone(p.order);
  const after = { ...before, [kind]: slugs };
  const apply = (o: Record<string, string[]>) => async () => { p.order = structuredClone(o); await designsOrderSave(dir, p.order); notify(); };
  return runUndoable(dir, { label: "Reorder", undo: apply(before), redo: apply(after) });
}

export async function startDesign(dir: string, kind: DesignKind, brief: string): Promise<string> {
  const title = brief.split(/[.,;\n]/)[0].trim().slice(0, 60) || "Untitled design";
  const slug = await designCreate(dir, kind, title, brief);
  await loadDesigns(dir);
  await openDesign(dir, slug);
  await sendDesignMessage(dir, brief);
  return slug;
}

function waitForReady(key: string, ms: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const check = () => {
      const s = agentSessionFor(key);
      if (s.phase === "ready") { un(); resolve(); }
      else if (s.phase === "error" || s.phase === "needs-login") { un(); reject(new Error(s.errorMessage ?? "The design session couldn't start.")); }
      else if (Date.now() - started > ms) { un(); reject(new Error("The design session took too long to start.")); }
    };
    const un = subscribeAgent(check);
    check();
  });
}

export async function sendDesignMessage(dir: string, text: string): Promise<void> {
  const p = designProjectFor(dir); const slug = p.active;
  if (!slug) throw new Error("Pick a design first.");
  const key = laneKey(dir, "design");
  const s = agentSessionFor(key);
  if (s.phase !== "ready") {
    if (s.phase === "ended" && s.sessionId) await resumeAgentSession(key, s.sessionId);
    else if (s.phase === "none" || s.phase === "ended" || s.phase === "error") await startAgentSession(key);
    await waitForReady(key, 90_000);
  }
  await sendAgentMessage(key, text, undefined, { prefix: designPrefix(slug) });
}
```

`waitForReady` measures elapsed time on each store change instead of arming a timer, so the no-bare-timers guard is satisfied; a session that never reports again is caught when the user retries.

- [ ] **Step 5: Run tests and typecheck**

Run: `npx vitest run src/lib/design-store.test.ts && npx tsc --noEmit -p .`
Expected: pass; no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/ipc.ts src/lib/design-store.ts src/lib/design-store.test.ts
git commit -m "feat(design): a design store that loads designs, tracks how frames render, undoes your changes and versions each turn"
```

---

## Phase C · The pane

Every component below follows the approved comps (`design/comps/design-pane/Main.dc.html`, `02-Empty`, `05-Canvas`, `07-History`, `09-Errors`); sizes and copy are taken from `gen.py`. Components read stores the way the rest of the app does: `const [, bump] = useState(0); useEffect(() => subscribeX(() => bump((n) => n + 1)), []);`.

### Task 14: The Design pane in the rail, the cycle and ⌘N

**Files:**
- Modify: `src/components/chrome/icons.tsx` (after `WebGlyph` ~95), `src/components/chrome/Rail.tsx` (:17, after the Web button ~100)
- Modify: `src/App.tsx` (`PANES` :112, the ⌘N branch :820, the render ternary :1218-1285)
- Create: `src/screens/design/DesignPane.tsx` (a first version: layout frame only)
- Test: `src/screens/design/DesignPane.test.tsx`

**Interfaces:**
- Produces: `export const DesignGlyph`, `Pane` includes `"design"`, `export function DesignPane({ dir, onScreen, onConfirm }: { dir: string; onScreen: boolean; onConfirm: (spec: ConfirmSpec) => void })`, and a `window` event `chronicle:new-design` that ⌘N dispatches while the Design pane is showing (the pane listens for it).

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/design-store", () => ({
  designProjectFor: () => ({ rows: [], order: {}, active: null, design: null, canvas: { positions: {}, viewport: null }, bad: false, frameStates: {}, base: null, versions: [], reloadTick: 0, undo: [], redo: [], seenTurnEnds: 0 }),
  subscribeDesigns: () => () => {},
  loadDesigns: vi.fn(async () => {}),
}));
vi.mock("./NewDesign", () => ({ NewDesign: () => <div>What should we design?</div> }));

describe("DesignPane", () => {
  it("shows the new-design screen when the project has no designs", async () => {
    const { DesignPane } = await import("./DesignPane");
    render(<DesignPane dir="/p" onScreen onConfirm={() => {}} />);
    expect(screen.getByText("What should we design?")).toBeTruthy();
    expect(screen.getByText(/No designs yet/)).toBeTruthy();
  });
});
```

(If `@testing-library/react` is not in `package.json`, check how other `.test.tsx` files render — `rg -l "\.test\.tsx" src` — and use the same approach; if no component tests exist, test only `Rail`'s `Pane` type via `tsc` in Step 5 and skip this file.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/screens/design/DesignPane.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Glyph and rail**

```tsx
/** Crop marks around a small square — the Design pane. */
export const DesignGlyph = ({ size = 15, ...p }: P) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" {...p}>
    <path d="M4.5 1.5v3h-3M11.5 1.5v3h3M4.5 14.5v-3h-3M11.5 14.5v-3h3" />
    <rect x="6" y="6" width="4" height="4" rx=".6" />
  </svg>
);
```

`Rail.tsx`: `export type Pane = "road" | "repo" | "notes" | "web" | "design";`, import `DesignGlyph`, and after the Web button:

```tsx
<RailButton label="Design" tooltip="Design" mono="⌘J to cycle" selected={pane === "design"} onClick={() => onPane("design")}>
  <DesignGlyph />
</RailButton>
```

- [ ] **Step 4: App wiring**

- `const PANES: Pane[] = ["road", "repo", "notes", "web", "design"];`
- ⌘N branch: change the pane check to `(pane === "notes" || pane === "repo" || pane === "design")` and add `else if (pane === "design") window.dispatchEvent(new CustomEvent("chronicle:new-design"));` before the repo `else`.
- Render: turn the final `else` into an explicit `pane === "web" ? (<WebPane …/>) : (<DesignPane key={active.dir} dir={active.dir} onScreen={paneLayout.content && !overlayOpen} onConfirm={setConfirm} />)`.
- In `src-tauri/src/menu.rs`, change the `go-new-note` row's `text` to `"New Note, File or Design"` (the chord is unchanged, so the menu tests still pass).

- [ ] **Step 5: First `DesignPane`**

```tsx
/* The Design pane (comps board 1): designs on the left, the canvas in the middle,
   the design session's thread on the right. With no designs, the new-design screen
   (board 2) takes the canvas and thread's place. */
import { useEffect, useState } from "react";
import type { ConfirmSpec } from "@/overlays/ConfirmDialog";
import { designProjectFor, loadDesigns, subscribeDesigns } from "@/lib/design-store";
import { NewDesign } from "./NewDesign";

export function DesignPane({ dir, onScreen, onConfirm }: { dir: string; onScreen: boolean; onConfirm: (spec: ConfirmSpec) => void }) {
  const [, bump] = useState(0);
  useEffect(() => subscribeDesigns(() => bump((n) => n + 1)), []);
  useEffect(() => { void loadDesigns(dir); }, [dir]);
  const p = designProjectFor(dir);
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    const on = () => setCreating(true);
    window.addEventListener("chronicle:new-design", on);
    return () => window.removeEventListener("chronicle:new-design", on);
  }, []);
  const empty = p.rows.length === 0;
  return (
    <div data-chrome className="flex h-full min-w-0 flex-1">
      <aside className="flex w-[248px] shrink-0 flex-col border-r border-border-hairline">
        <div className="flex h-10 items-center border-b border-border-hairline px-3.5 text-[10px] uppercase tracking-[0.09em] text-text-faint">Designs</div>
        {empty && (
          <p className="px-3.5 py-3.5 text-[11.5px] leading-relaxed text-text-faint">
            No designs yet. Anything you make lands here, saved in <span className="font-mono text-[10.5px]">.chronicle/designs/</span>.
          </p>
        )}
      </aside>
      {empty || creating ? <NewDesign dir={dir} onDone={() => setCreating(false)} /> : <div className="flex-1" />}
    </div>
  );
}
```

`onScreen` and `onConfirm` are used from Task 15 on. Create a placeholder `NewDesign.tsx` exporting `NewDesign({ dir, onDone }: { dir: string; onDone: () => void })` that renders `<div className="flex-1" />` (Task 18 replaces it).

- [ ] **Step 6: Run tests and typecheck**

Run: `npx vitest run src/screens/design && npx tsc --noEmit -p . && (cd src-tauri && cargo test menu)`
Expected: pass.

- [ ] **Step 7: Commit**

```bash
git add src/components/chrome/icons.tsx src/components/chrome/Rail.tsx src/App.tsx src/screens/design src-tauri/src/menu.rs
git commit -m "feat(design): a Design pane on the rail, in the ⌘J cycle, with ⌘N for a new design"
```

### Task 15: The designs sidebar

**Files:**
- Create: `src/screens/design/DesignSidebar.tsx`
- Modify: `src/screens/design/DesignPane.tsx` (use it)
- Test: `src/lib/design-sidebar-model.test.ts` + `src/lib/design-sidebar-model.ts` (the pure drop logic)

**Interfaces:**
- Consumes: `orderRows`, `KINDS`, `KIND_LABEL`, `openDesign`, `renameDesign`, `trashDesign`, `setDesignKind`, `reorderDesigns`, `designBranch`, `loadDesigns`.
- Produces: `export function DesignSidebar({ dir, onNew }: { dir: string; onNew: () => void })`; `export function dropOrder(slugs: string[], moved: string, before: string | null): string[]` in `design-sidebar-model.ts`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { dropOrder } from "./design-sidebar-model";
describe("dropOrder", () => {
  it("moves before a row, or to the end", () => {
    expect(dropOrder(["a", "b", "c"], "c", "a")).toEqual(["c", "a", "b"]);
    expect(dropOrder(["a", "b", "c"], "a", null)).toEqual(["b", "c", "a"]);
    expect(dropOrder(["a", "b"], "z", "b")).toEqual(["a", "z", "b"]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/design-sidebar-model.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the model**

```ts
export function dropOrder(slugs: string[], moved: string, before: string | null): string[] {
  const rest = slugs.filter((s) => s !== moved);
  const i = before == null ? -1 : rest.indexOf(before);
  return i < 0 ? [...rest, moved] : [...rest.slice(0, i), moved, ...rest.slice(i)];
}
```

- [ ] **Step 4: Implement `DesignSidebar.tsx`**

Build it from `TreeHeader`, `TreeIconButton` and `TreeRow` (`src/components/chrome/Tree.tsx`), the same parts the notes and Web sidebars use:

- Header: `Designs · <count>` with a `+` button calling `onNew`.
- One group per kind that has designs, in `KINDS` order: an eyebrow row (`KIND_LABEL[kind]`, `text-text-faint`) with the count on the right.
- Rows: kind glyph (inline SVGs from the comps: screen, megaphone, deck, brand circle, bag), the title (marquee on overflow, as `TreeRow` does), and a trailing state: `working` with a pulsing neutral dot when the design lane is mid-turn and this is the active design (`agentSessionFor(laneKey(dir,"design")).turnActive && p.active === slug`), `draft` in `text-text-faint` when `latestVersion == null`, otherwise the version as `v<n>` in mono `text-text-faint`. A `bad` row shows "couldn't read this design" in `text-state-error`.
- Selected row = `p.active`.
- Click → `openDesign(dir, slug)`.
- Right-click and a hover `⋯` open the same menu (use the `RowMenus`/`MenuNodes` pattern from `src/screens/web/WebSidebar.tsx`): Rename (inline input like WebSidebar's `NameInput`; Enter commits via `renameDesign`), Duplicate (`designBranch(dir, slug, null)` then `loadDesigns`), Move to ▸ (the other four kinds → `setDesignKind`), separator, Delete (`trashDesign`, then a toast "Moved to trash" with an Undo action calling `undoDesign(dir)`).
- Reorder within a kind by pointer drag, copied from WebSidebar's pointer drag: `data-design-drop="<kind>:<slug>"` on rows, 5 px slop, a ghost label, `elementFromPoint` on release; dropping on a row of the same kind calls `reorderDesigns(dir, kind, dropOrder(currentSlugs, moved, targetSlug))`; dropping below the last row of the kind uses `before = null`. Dropping on another kind's row does nothing.

- [ ] **Step 5: Use it in `DesignPane`** — replace the placeholder `<aside>` with `<DesignSidebar dir={dir} onNew={() => setCreating(true)} />`.

- [ ] **Step 6: Run tests, typecheck, commit**

Run: `npx vitest run src/lib/design-sidebar-model.test.ts src/screens/design && npx tsc --noEmit -p .`
Expected: pass.

```bash
git add src/lib/design-sidebar-model.ts src/lib/design-sidebar-model.test.ts src/screens/design
git commit -m "feat(design): the designs list, grouped by kind, with rename, duplicate, move, delete and drag to reorder"
```

### Task 16: The canvas

**Files:**
- Create: `src/screens/design/DesignCanvas.tsx`, `src/screens/design/FrameView.tsx`, `src/screens/design/Minimap.tsx`, `src/screens/design/CanvasToolbar.tsx`
- Create: `src/lib/canvas-keys.ts`, `src/lib/canvas-keys.test.ts`
- Modify: `src/screens/design/DesignPane.tsx`

**Interfaces:**
- Consumes: `designProjectFor`, `frameMessage`, `moveFrame`, `undoDesign`, `redoDesign`, `placeFrames`, `readingOrder`, `fit`, `zoomAt`, `liveFrames`, `worldToScreen`, `sendDesignMessage`.
- Produces:
  - `export type CanvasAction = { type: "zoom"; factor: number } | { type: "fit" } | { type: "actual" } | { type: "nudge"; dx: number; dy: number } | { type: "next"; back: boolean } | { type: "live" } | { type: "exitLive" } | { type: "undo" } | { type: "redo" } | null`
  - `export function canvasKey(e: { key: string; metaKey: boolean; shiftKey: boolean; ctrlKey: boolean; altKey: boolean }): CanvasAction`
  - `export function DesignCanvas({ dir, onScreen }: { dir: string; onScreen: boolean })`
  - `export function FrameView(props: { dir: string; frame: Frame; rect: Rect; zoom: number; live: boolean; interactive: boolean; selected: boolean; base: string; slug: string; state: FrameState; thumb: string | null; reloadTick: number; onSelect: () => void; onEnterLive: () => void; onDragStart: (e: React.PointerEvent) => void })`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { canvasKey } from "./canvas-keys";
const k = (key: string, m: Partial<{ metaKey: boolean; shiftKey: boolean; ctrlKey: boolean; altKey: boolean }> = {}) =>
  canvasKey({ key, metaKey: false, shiftKey: false, ctrlKey: false, altKey: false, ...m });
describe("canvas keys", () => {
  it("maps plain keys, arrows, tab, enter, escape and undo", () => {
    expect(k("=")).toEqual({ type: "zoom", factor: 1.25 });
    expect(k("+", { shiftKey: true })).toEqual({ type: "zoom", factor: 1.25 });
    expect(k("-")).toEqual({ type: "zoom", factor: 0.8 });
    expect(k("0")).toEqual({ type: "fit" });
    expect(k("1")).toEqual({ type: "actual" });
    expect(k("ArrowLeft")).toEqual({ type: "nudge", dx: -1, dy: 0 });
    expect(k("ArrowDown", { shiftKey: true })).toEqual({ type: "nudge", dx: 0, dy: 10 });
    expect(k("Tab")).toEqual({ type: "next", back: false });
    expect(k("Tab", { shiftKey: true })).toEqual({ type: "next", back: true });
    expect(k("Enter")).toEqual({ type: "live" });
    expect(k("Escape")).toEqual({ type: "exitLive" });
    expect(k("z", { metaKey: true })).toEqual({ type: "undo" });
    expect(k("z", { metaKey: true, shiftKey: true })).toEqual({ type: "redo" });
  });
  it("leaves app chords alone", () => {
    expect(k("1", { metaKey: true })).toBeNull();
    expect(k("=", { metaKey: true })).toBeNull();
    expect(k("j", { metaKey: true })).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/canvas-keys.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `canvas-keys.ts`**

```ts
export type CanvasAction =
  | { type: "zoom"; factor: number } | { type: "fit" } | { type: "actual" }
  | { type: "nudge"; dx: number; dy: number } | { type: "next"; back: boolean }
  | { type: "live" } | { type: "exitLive" } | { type: "undo" } | { type: "redo" } | null;

export function canvasKey(e: { key: string; metaKey: boolean; shiftKey: boolean; ctrlKey: boolean; altKey: boolean }): CanvasAction {
  if (e.metaKey) {
    if (e.key.toLowerCase() === "z" && !e.altKey && !e.ctrlKey) return { type: e.shiftKey ? "redo" : "undo" };
    return null;
  }
  if (e.ctrlKey || e.altKey) return null;
  const step = e.shiftKey ? 10 : 1;
  switch (e.key) {
    case "=": case "+": return { type: "zoom", factor: 1.25 };
    case "-": case "_": return { type: "zoom", factor: 0.8 };
    case "0": return { type: "fit" };
    case "1": return { type: "actual" };
    case "ArrowLeft": return { type: "nudge", dx: -step, dy: 0 };
    case "ArrowRight": return { type: "nudge", dx: step, dy: 0 };
    case "ArrowUp": return { type: "nudge", dx: 0, dy: -step };
    case "ArrowDown": return { type: "nudge", dx: 0, dy: step };
    case "Tab": return { type: "next", back: e.shiftKey };
    case "Enter": return { type: "live" };
    case "Escape": return { type: "exitLive" };
    default: return null;
  }
}
```

- [ ] **Step 4: Run the key test**

Run: `npx vitest run src/lib/canvas-keys.test.ts`
Expected: PASS.

- [ ] **Step 5: `FrameView.tsx`**

- Outer `div` absolutely positioned at `worldToScreen(rect)` with width `rect.w * zoom` and height `rect.h * zoom`, `role="group"`, `aria-label={`${frame.label}, ${frame.width} wide, ${stateWord}`}` where `stateWord` is `rendering`, `rendered` or `didn't render`, and `tabIndex={-1}` (focus stays on the canvas; selection is announced through the canvas's live region).
- Name strip above the frame (20 px, as in the comps): label, `<width>` in mono `text-text-faint`, and the state on the right (a pulsing dot + "rendering", or `didn't render` in `text-state-error`).
- Selected: 2 px `outline` in `--text-primary` with 3 px offset.
- Body when `live`: an `<iframe>` with `src={`${base}${slug}/${frame.file}`}`, `sandbox="allow-scripts"`, `title={frame.label}`, `width={frame.width}`, `height={rect.h}`, `style={{ transform: `scale(${zoom})`, transformOrigin: "0 0", border: 0, pointerEvents: interactive ? "auto" : "none", background: "white" }}`, and `key={reloadTick}` so a changed file reloads it. Otherwise: `thumb ? <img src={thumb} …/> : <div className="bg-fill-subtle" />` scaled the same way.
- The fold: a 1 px dashed line at `frame.height * zoom` from the top, `border-border-strong`, only when `rect.h > frame.height`.
- `state.kind === "failed"`: an overlay card (board 9): "The page stopped at line <line>." / the message in mono / a primary button "Ask the design session to fix it" calling `sendDesignMessage(dir, `The frame ${frame.file} didn't render: ${message} (line ${line}). Fix it.`)`.
- `onPointerDown` on the name strip or the body (when not interactive) → `onSelect()` then `onDragStart(e)`; `onDoubleClick` → `onEnterLive()`.

- [ ] **Step 6: `DesignCanvas.tsx`**

State: `viewport` (initialised from `p.canvas.viewport` or `fit(...)` once the container is measured), `selected: string | null`, `liveId: string | null` (the interactive frame), container size from a `ResizeObserver`.

- Rects: `placeFrames(p.design, p.canvas.positions, heights)` where `heights[id] = state.kind === "rendered" ? state.height : undefined` (omit undefined).
- Live set: `onScreen ? liveFrames(rects, viewport, w, h) : new Set()`; the interactive frame is always in it.
- Message routing: one `window` `message` listener; find which iframe sent it by comparing `e.source` with each mounted iframe's `contentWindow` (keep refs in a `Map<frameId, HTMLIFrameElement>` passed down through a callback ref prop `iframeRef`), then `frameMessage(dir, frameId, e.data)`. Ignore messages from any other source.
- Thumbnails: `thumb = p.base && latestVersion ? `${p.base}${p.active}/.versions/v${latestVersion}/thumbs/${frame.id}.png` : null`.
- Gestures on the canvas `div` (`tabIndex={0}`, `aria-label="Design canvas"`, background = dot grid as in the comps via `radial-gradient(var(--border-hairline) 1px, transparent 1px)` at 20 px):
  - `wheel` (non-passive): `if (e.ctrlKey || e.metaKey)` → `zoomAt(viewport, Math.exp(-e.deltaY * 0.01), localX, localY)`; else pan by `-deltaX, -deltaY`. `preventDefault()`.
  - Space held + pointer drag → pan.
  - Pointer down on empty canvas → deselect.
  - Frame drag: capture the pointer on the canvas, move a local offset while dragging, and on release call `moveFrame(dir, id, rect.x + dx / zoom, rect.y + dy / zoom)` (one undo entry per drag).
  - `keydown` → `canvasKey(e)`; for a non-null action call `e.preventDefault()` and apply: zoom about the centre; `fit` over all rects; `actual` = zoom 1 about the centre; `nudge` → `moveFrame` by the delta (selected frame only); `next` → move selection along `readingOrder(rects)` and pan so the frame is visible; `live` → `setLiveId(selected)`; `exitLive` → `setLiveId(null)` and refocus the canvas; `undo`/`redo` → `undoDesign`/`redoDesign`.
  - Persist the viewport with `designCanvasSave` when it has been still for a moment: save on `pointerup` and on `wheel` end detected by the next `pointermove` or `keydown` rather than a timer; also save when the pane unmounts.
- A visually hidden `aria-live="polite"` region announces the selected frame's label and state changes.
- `CanvasToolbar` (40 px, board 1): title, kind chip, then on the right a History toggle (Task 19) and nothing else in this sub-project (Scorecard/System arrive later; do not draw them). The zoom control (bottom-left, board 5): `−`, the percentage as a button (click cycles fit → 100%), `+`, fit.
- `Minimap` (bottom-right, 132×84): scaled rects in `--fill-hover`, the viewport rectangle in `--text-muted`; pointer drag pans.
- Empty design (no frames yet): three dashed placeholders labelled Desktop / Tablet / Mobile with "waiting for the first frame" (board 3's placeholder style).

- [ ] **Step 7: Mount it** — in `DesignPane`, when not empty and not creating and `p.active` is set, render `<div className="flex min-w-0 flex-1 flex-col"><CanvasToolbar dir={dir} /><DesignCanvas dir={dir} onScreen={onScreen} /></div>`; when no design is open yet, open the first row (`useEffect` → `openDesign(dir, rows[0].slug)` if `!p.active && rows.length`).

- [ ] **Step 8: Typecheck, test, commit**

Run: `npx tsc --noEmit -p . && npx vitest run src/lib src/screens/design && npx vitest run src/lib/no-bare-timers.test.ts`
Expected: pass (no bare timers were added).

```bash
git add src/lib/canvas-keys.ts src/lib/canvas-keys.test.ts src/screens/design
git commit -m "feat(design): the canvas — live frames at full height, pan and zoom, drag, keyboard, minimap and a frame that says why it didn't render"
```

### Task 17: The design thread

**Files:**
- Modify: `src/screens/agent/AgentPane.tsx` (props :506-521, auto-start effect :525-543, footer :745-748)
- Modify: `src/screens/agent/Composer.tsx` (props :148-157, `send` :367, mode options :589-599)
- Modify: `src/lib/agent-session.ts` (`adoptAgentSession` :738 — chat-only `refreshAgentEdits`)
- Create: `src/screens/design/DesignThread.tsx`
- Modify: `src/screens/design/DesignPane.tsx`

**Interfaces:**
- Consumes: `laneKey`, `splitLaneKey`, `sendDesignMessage`, `designOutsideUndo`, `limitsReading`, `fmtResetTime`, `designProjectFor`.
- Produces:
  - `AgentPane` prop `variant?: "chat" | "design"` (default chat). In design: no auto-start, no `ReviewStrip`, no round cards; renders a `GuardRow` for `guard` entries; `Composer` gets `onSend`.
  - `Composer` prop `onSend?: (text: string) => Promise<void>` — when set, `send` flattens mentions to text (`flattenMentions(withRefs, mentions.current, splitLaneKey(dir).dir)`) and calls `onSend` instead of `buildBlocks` + `sendAgentMessage`. When `splitLaneKey(dir).lane === "design"`, the mode options are only `{ value: "default", name: "Ask first", description: "The design session asks before running commands. It never changes files outside the designs folder." }` and `{ value: "plan", name: "Plan", description: "It thinks through the design with you and changes nothing." }`, and the queue button is hidden.
  - `export function DesignThread({ dir, onConfirm }: { dir: string; onConfirm: (spec: ConfirmSpec) => void })`

- [ ] **Step 1: Write the failing test** (`src/lib/agent-session.lanes.test.ts`, add a case)

```ts
it("adopting the design lane never touches the chat's edit review", async () => {
  const ipc = await import("./ipc");
  const m = await import("./agent-session");
  (ipc.agentEdits as unknown as { mockClear: () => void }).mockClear();
  await m.adoptAgentSession(m.laneKey(DIR, "design"));
  expect(ipc.agentEdits).not.toHaveBeenCalled();
});
```

(Add `agentSessionState: vi.fn(async () => ({ alive: false }))` to that file's `vi.mock("./ipc")` block.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/agent-session.lanes.test.ts`
Expected: FAIL (`agentEdits` was called).

- [ ] **Step 3: Store fix** — in `adoptAgentSession`, change the first line to `if (splitLaneKey(dir).lane === "chat") refreshAgentEdits(dir);`. Run the test: PASS.

- [ ] **Step 4: `Composer` changes** — add the `onSend` prop and the design-lane mode list exactly as in Interfaces. In `send`, branch:

```ts
const job = onSend
  ? onSend(flattenMentions(withRefs, mentions.current, splitLaneKey(dir).dir))
  : buildBlocks(withRefs, mentions.current, dir).then((blocks) => sendAgentMessage(dir, withRefs, blocks));
job.then(() => { /* the existing reset lines */ }).catch(/* existing */).finally(/* existing */);
```

- [ ] **Step 5: `AgentPane` changes** — add `variant` prop; guard the auto-start effect with `if (variant === "design") { void adoptAgentSession(dir); return; }`; render `ReviewStrip`, round cards and `QueuedMessages` only for chat; pass `onSend={variant === "design" ? (t) => sendDesignMessage(splitLaneKey(dir).dir, t) : undefined}` to `Composer`; in `Entry`, render `guard` entries:

```tsx
function GuardRow({ entry }: { entry: { allowed: boolean; path: string; reason: string } }) {
  if (entry.allowed) return null;
  return (
    <div className="mx-3.5 my-1 flex items-start gap-2 rounded-md border border-border-hairline bg-surface-card px-[11px] py-2">
      <span className="mt-0.5 shrink-0 text-state-warn"><ErrorGlyph size={12} /></span>
      <span className="min-w-0 text-xs leading-[1.55] text-text-muted">
        Kept a change out of your project: <span className="font-mono text-[11px]">{entry.path}</span>. {entry.reason}
      </span>
    </div>
  );
}
```

(Allowed writes inside the designs folder are not shown; the frames appearing on the canvas show them.)

- [ ] **Step 6: `DesignThread.tsx`**

```tsx
/* The design session's thread (board 1, right column): the agent pane's parts in
   the design lane, plus the two cards only this lane has — changes found outside
   the designs folder, and the usage limit. */
import { useEffect, useState } from "react";
import type { ConfirmSpec } from "@/overlays/ConfirmDialog";
import { AgentPane } from "@/screens/agent/AgentPane";
import { agentSessionFor, laneKey, subscribeAgent } from "@/lib/agent-session";
import { designOutsideUndo } from "@/lib/ipc";
import { limitsReading, subscribeLimits, fmtResetTime } from "@/lib/limits-store";
import { designProjectFor, subscribeDesigns } from "@/lib/design-store";
import { BtnSecondary } from "@/components/chrome/atoms";
import { toastError } from "@/overlays/toasts";

export function DesignThread({ dir, onConfirm }: { dir: string; onConfirm: (spec: ConfirmSpec) => void }) {
  const [, bump] = useState(0);
  useEffect(() => subscribeAgent(() => bump((n) => n + 1)), []);
  useEffect(() => subscribeLimits(() => bump((n) => n + 1)), []);
  useEffect(() => subscribeDesigns(() => bump((n) => n + 1)), []);
  const key = laneKey(dir, "design");
  const s = agentSessionFor(key);
  const limits = limitsReading();
  const p = designProjectFor(dir);
  const latest = p.versions[0]?.n;
  return (
    <div className="flex w-[392px] shrink-0 flex-col border-l border-border-hairline bg-surface-panel">
      {s.outside.length > 0 && (
        <div className="mx-3 mt-3 flex flex-col gap-2 rounded-md border border-border-hairline bg-surface-card px-3 py-2.5">
          <span className="text-[12.5px] text-text-primary">Changed outside the designs folder</span>
          <ul className="flex flex-col gap-0.5">
            {s.outside.map((f) => (
              <li key={f} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-text-muted">{f}</span>
                <button className="text-[11.5px] text-text-secondary hover:text-text-primary"
                  onClick={() => void designOutsideUndo(dir, f).catch((e) => toastError("Couldn't undo it", String(e).slice(0, 90)))}>Undo</button>
              </li>
            ))}
          </ul>
          <BtnSecondary size="sm" onClick={() => void designOutsideUndo(dir, null).catch((e) => toastError("Couldn't undo them", String(e).slice(0, 90)))}>Undo all</BtnSecondary>
        </div>
      )}
      {limits?.status === "rejected" && (
        <div className="mx-3 mt-3 flex flex-col gap-1.5 rounded-md border border-border-hairline bg-surface-card px-3 py-2.5">
          <span className="text-[12.5px] text-text-primary">Your Claude plan’s limit is used up.</span>
          <span className="text-[11.5px] leading-relaxed text-text-muted">
            It resets at {fmtResetTime(limits.resetsAt)}.{latest ? ` Everything up to v${latest} is saved.` : ""} Send your next message then.
          </span>
        </div>
      )}
      <div className="min-h-0 flex-1">
        <AgentPane dir={key} variant="design" onConfirm={onConfirm} onRevealTerminal={() => {}} onOpenReview={() => {}} />
      </div>
    </div>
  );
}
```

(Check `fmtResetTime`'s exact signature in `src/lib/limits-store.ts:88` and adapt the call; check `BtnSecondary`'s import path. "Remind me at <time>" from board 9 is deferred to sub-project 2 with the other notifications; say so in the commit body.)

- [ ] **Step 7: Mount it** — in `DesignPane`, next to the canvas column: `<DesignThread dir={dir} onConfirm={onConfirm} />`.

- [ ] **Step 8: Test, typecheck, commit**

Run: `npx vitest run src/lib src/screens && npx tsc --noEmit -p .`
Expected: pass.

```bash
git add src/lib/agent-session.ts src/lib/agent-session.lanes.test.ts src/screens/agent src/screens/design
git commit -m "feat(design): the design session's thread, with only safe modes, kept-out changes, and the usage limit

Remind-me-at-reset from board 9 moves to sub-project 2 with the other notifications."
```

### Task 18: Starting a design

**Files:**
- Modify: `src/screens/design/NewDesign.tsx`

**Interfaces:**
- Consumes: `startDesign`, `KIND_LABEL`, `DesignKind`.
- Produces: `export function NewDesign({ dir, onDone }: { dir: string; onDone: () => void })`.

- [ ] **Step 1: Implement** (board 2, copy verbatim from the comps)

- Centred column 720 px on the dot-grid background.
- Eyebrow "Design"; heading "What should we design?" (24 px, 600); body "Describe it the way you would to a design lead. The design session reads this project’s code for your colors and type, and draws real pages you can open, compare and restore." (13 px, `text-text-muted`, max 560 px). This sub-project has no reviewer, so the comps' "work that has already passed its own review" sentence is not shown.
- Five kind cards in a 5-column grid (`ecommerce`, `app`, `marketing`, `brand`, `deck` in that order, using `KIND_LABEL` and the comps' one-line descriptions: "Product, cart and checkout pages", "Screens, flows and clickable prototypes", "Landing pages, launches, social", "Identity, palette, type, guidelines", "Pitch and update decks with notes"). Real `<button>`s with `aria-pressed`; the selected card uses `border-text-primary bg-fill-hover`.
- A textarea (not contenteditable), `aria-label="Brief"`, min 72 px, placeholder "A product page for our single origin. Lots of gift buyers, mostly on phones."
- Below it: "References" and "Capture a site" buttons rendered `disabled` with `title="Arrives with the design director"`; a `↵ to start` hint; primary button "Start designing" (disabled until a kind is picked and the brief has text). Enter (without Shift) in the textarea starts.
- Start: `setBusy(true)`; `startDesign(dir, kind, brief)`; on success `onDone()`; on error `toastError("Couldn't start the design", String(e).slice(0, 90))`; `setBusy(false)`.
- Keyboard: the textarea is focused on mount; Escape calls `onDone()` when the project already has designs.

- [ ] **Step 2: Typecheck, run the pane test, commit**

Run: `npx tsc --noEmit -p . && npx vitest run src/screens/design`
Expected: pass.

```bash
git add src/screens/design/NewDesign.tsx
git commit -m "feat(design): pick a kind, write a brief, and the design session starts drawing"
```

### Task 19: History

**Files:**
- Create: `src/screens/design/HistoryPanel.tsx`
- Modify: `src/screens/design/CanvasToolbar.tsx` (History toggle), `src/screens/design/DesignPane.tsx` (the panel replaces the thread while open), `src/screens/design/DesignCanvas.tsx` (compare mode)
- Modify: `src/lib/design-store.ts` (`restoreVersion`, `branchVersion`, `compare` state)
- Test: `src/lib/design-store.test.ts` (add a case)

**Interfaces:**
- Produces: `DesignProject.compare: number | null`; `export function setCompare(dir: string, n: number | null): void`; `export async function restoreVersion(dir: string, n: number): Promise<void>` (undoable: undo restores the version that was newest before, via another `designRestore`); `export async function branchVersion(dir: string, n: number): Promise<string>`.

- [ ] **Step 1: Write the failing test**

```ts
it("restoring is undoable", async () => {
  const restore = h.restore;
  const m = await import("./design-store");
  const p = m.designProjectFor(DIR);
  p.versions = [{ n: 7, at: "", session: "", prompt: "", summary: "", hash: "" }];
  await m.restoreVersion(DIR, 5);
  expect(restore).toHaveBeenLastCalledWith(DIR, "home", 5);
  await m.undoDesign(DIR);
  expect(restore).toHaveBeenLastCalledWith(DIR, "home", 7);
});
```

(`h.restore` and `designBranch` are already in the file's hoisted `vi.mock("./ipc")` from Task 13.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/design-store.test.ts`
Expected: FAIL (`restoreVersion` is not a function).

- [ ] **Step 3: Implement in `design-store.ts`**

```ts
export function setCompare(dir: string, n: number | null) { designProjectFor(dir).compare = n; notify(); }

export function restoreVersion(dir: string, n: number): Promise<void> {
  const p = designProjectFor(dir); const slug = p.active; if (!slug) return Promise.resolve();
  const newestBefore = p.versions[0]?.n ?? n;
  const to = (v: number) => async () => { await designRestore(dir, slug, v); await openDesign(dir, slug, true); };
  return runUndoable(dir, { label: `Restore v${n}`, redo: to(n), undo: to(newestBefore) });
}

export async function branchVersion(dir: string, n: number): Promise<string> {
  const p = designProjectFor(dir); const slug = p.active; if (!slug) throw new Error("Pick a design first.");
  const copy = await designBranch(dir, slug, n);
  await loadDesigns(dir); await openDesign(dir, copy);
  return copy;
}
```

Add `compare: null` to the `DesignProject` initialiser and type; import `designRestore`, `designBranch`.

- [ ] **Step 4: `HistoryPanel.tsx`** (board 7, right column, 392 px)

- Header "History" + "one snapshot per turn" (`text-text-faint`) + close button.
- Timeline rows, newest first: dot (filled for the current = newest), `v<n>` mono, relative time (`at`), the summary (12.5 px), and a click target that sets `setCompare(dir, n)`; the compared row has `bg-fill-hover` and a "comparing" chip; each row has a hover thumbnail of its first frame (`.versions/v<n>/thumbs/<firstFrameId>.png`).
- Footer (when `compare` is set and not the newest): "Restoring makes v<n> the newest version. Nothing is deleted, and the files stay in this project." + primary "Restore v<n>" (`restoreVersion`) + secondary "Branch from v<n>" (`branchVersion`, then toast "Opened <new title>").
- Empty: "No versions yet. The first one is saved when the design session finishes a turn."

- [ ] **Step 5: Compare mode in `DesignCanvas`**

When `p.compare` is set: split the canvas into two halves with a 1 px `--border-strong` divider; the left half shows the compared version's frames as thumbnails (`.versions/v<compare>/thumbs/<id>.png`) at the same viewport; the right half shows the current frames as now; chips at the top-left of each half ("v<compare>", "v<newest> · current"). Pan and zoom move both halves together. Esc or closing History clears `compare`.

- [ ] **Step 6: Toolbar and pane** — `CanvasToolbar` gets a "History" segmented button (clock glyph from the comps) toggling `historyOpen` in `DesignPane`; while open, `HistoryPanel` renders in the thread's place.

- [ ] **Step 7: Test, typecheck, commit**

Run: `npx vitest run src/lib/design-store.test.ts src/screens/design && npx tsc --noEmit -p .`
Expected: pass.

```bash
git add src/lib/design-store.ts src/lib/design-store.test.ts src/screens/design
git commit -m "feat(design): history — every version side by side with now, restorable and branchable"
```

---

## Phase D · Proof

### Task 20: Replay fixture, roadmap, and the live check

**Files:**
- Create: `src/lib/__fixtures__/design-lane.jsonl`, `src/lib/agent-session.design.test.ts`
- Commit: `chronicle.json` (Part 17 phases already in the working tree)
- Modify: `docs/superpowers/specs/2026-09-17-design-pane-foundation-design.md` (append "Live test" section)

- [ ] **Step 1: Build a release binary**

```bash
export PATH="$HOME/.cargo/bin:$PATH"
npm run build && (cd src-tauri && cargo build --release --features tauri/custom-protocol)
```

- [ ] **Step 2: Prepare a throwaway project** — `rsync -a --exclude node_modules --exclude src-tauri/target /Users/tuneerguha/Downloads/chronicle/ <scratchpad>/design-live/` (or any small repo with a `chronicle.json`). If the user's installed Chronicle is running, launch the test build with `CHRONICLE_BRIDGE_SOCKET=/tmp/cdl.sock` so `--open` is not handed off to it: `CHRONICLE_BRIDGE_SOCKET=/tmp/cdl.sock src-tauri/target/release/chronicle --open <scratchpad>/design-live`. Bring the test window to the front before any synthetic click, and hand focus back afterwards.

- [ ] **Step 3: Run the live checklist** (the spec's §13 list), recording each result:

1. Design pane → pick E-commerce → brief "A product page for a coffee roaster's Ethiopia Guji, mostly phone traffic" → Start. Frames appear; fonts are local (`ls .chronicle/designs/<slug>/assets/fonts/`); the canvas shows full-height frames with a fold line.
2. Edit one frame by hand to throw (`<script>throw new Error("boom")</script>`): its state becomes "didn't render" with the line; the button sends the error and the next turn fixes it.
3. History: versions listed with summaries; compare v1 with now; Restore v1 then ⌘Z; Branch from v1 opens "<title> (copy)". Thumbnails are real pictures, not a flat colour (if flat: apply Task 9 Step 7's off-screen fix, rebuild, recheck).
4. Rename, Duplicate, Move to Brand, Delete → Undo, drag to reorder; all persist after reopening the project.
5. In a frame's live mode, run in Safari Web Inspector (Develop → the Chronicle window → the frame's context): `typeof window.__TAURI_INTERNALS__` → `"undefined"`; `fetch("https://example.com")` → blocked by CSP; `parent.postMessage({__chronicleFrame:1,type:"ready",height:1},"*")` from a non-frame context (the main page's console) → no state change.
6. Ask the design session: "Also update src/App.tsx to add a link to this design." The write is refused ("Kept a change out of your project"). Then ask it to run `echo x >> README.md`; approve the command; at turn end "Changed outside the designs folder" lists README.md; Undo restores it.
7. `git status --short` in the project shows nothing under `.chronicle/designs/`.
8. Keyboard only: Tab into the canvas, Tab between frames (VoiceOver announces "Desktop, 1440 wide, rendered"), arrows move, Enter/Esc, `0`, `1`, `=`, `-`, ⌘Z/⇧⌘Z.
9. Idle stop: temporarily set `DESIGN_IDLE` to 60 s in a scratch build, wait, see the session end quietly; send a message; it resumes the same conversation. Revert the constant.
10. The chat agent pane works while the design session runs (send a message in each).
11. Energy: with the pane open and idle for 60 s, measure as the energy plan did (`docs/superpowers/plans/2026-09-08-energy-efficiency.md`); within 1 ms/s of the Web pane idle figure.
12. `chronicle designs list` and `chronicle designs read --slug <slug>` in a terminal inside the project.

- [ ] **Step 4: Record the replay fixture**

Copy the design lane's transcript of run 1 (`.chronicle/designs/.threads/<session>/thread.jsonl`), trim it to at most 400 lines (keep the first `_chronicle/user_message`, the writes' `tool_call`/`tool_call_update`s, a `_chronicle/guard` if present, and the final `_chronicle/turn_end`), replace absolute paths with `/home/u/proj`, and save it as `src/lib/__fixtures__/design-lane.jsonl`.

```ts
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
vi.mock("./ipc", async (orig) => ({ ...(await orig<typeof import("./ipc")>()), onAcpUpdate: vi.fn(async () => () => {}), agentEdits: vi.fn(async () => []) }));
vi.mock("./notes-store", () => ({}));
vi.mock("./journal", () => ({ announce: vi.fn() }));
vi.mock("@/overlays/toasts", () => ({ toastError: vi.fn(), toastSuccess: vi.fn() }));

const lines = readFileSync(path.join(__dirname, "__fixtures__/design-lane.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as unknown);

describe("a recorded design-lane session replays through the reducer", async () => {
  const { reduceLines, laneKey } = await import("./agent-session");
  const s = reduceLines(laneKey("/home/u/proj", "design"), lines);
  it("is a whole turn", () => {
    expect(lines.length).toBeLessThanOrEqual(400);
    expect((lines[0] as { method: string }).method).toBe("_chronicle/user_message");
    expect((lines.at(-1) as { method: string }).method).toBe("_chronicle/turn_end");
  });
  it("wrote frames inside the designs folder", () => {
    const tools = s.entries.filter((e) => e.kind === "tool");
    expect(tools.length).toBeGreaterThan(0);
    expect(JSON.stringify(tools)).toContain(".chronicle/designs/");
  });
  it("shows the sent brief without the design prefix", () => {
    const u = s.entries.find((e) => e.kind === "user") as { text: string } | undefined;
    expect(u?.text.startsWith("[design:")).toBe(false);
  });
});
```

Run: `npx vitest run src/lib/agent-session.design.test.ts` — Expected: PASS. (If the transcript's `_chronicle/user_message` stores the prefixed text, change `sendAgentMessage` so the Rust `display` string — which is what the transcript records — is the unprefixed text; it already is per Task 11, so this should hold.)

- [ ] **Step 5: Commit the fixture**

```bash
git add src/lib/__fixtures__/design-lane.jsonl src/lib/agent-session.design.test.ts
git commit -m "test(design): a recorded design-lane turn replays through the reducer"
```

- [ ] **Step 6: Roadmap** — `git diff chronicle.json` must show only the Part 17 "The Design pane" phases (DP-0…DP-8), the renumbered "Part 18 · What comes next", and the spec's `generatedFrom` entry. Refresh that entry's `sha256` to the spec's current hash (`shasum -a 256 docs/superpowers/specs/2026-09-17-design-pane-foundation-design.md`). Validate with `/Applications/Chronicle.app/Contents/MacOS/chronicle --derive .` (no warnings; DP-0 done). Then:

```bash
git add chronicle.json
git commit -m "chore(roadmap): the Design pane joins the roadmap as nine parts"
```

If the diff contains anything else, stop and ask the user whose change it is before committing.

- [ ] **Step 7: Live test notes and done**

Append to the spec a `## Live test (<date>)` section listing the twelve checks with pass/fail and any fix made, then commit it with the exact subject DP-1's rule matches:

```bash
git add docs/superpowers/specs/2026-09-17-design-pane-foundation-design.md
git commit -m "docs(design): live test of the Design pane foundation"
```

- [ ] **Step 8: Full suite**

Run: `(cd src-tauri && cargo test) && npx vitest run && npx tsc --noEmit -p .`
Expected: everything passes. Report the counts.
