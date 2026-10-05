# The Design pane, the director · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The design session becomes the director: a persona and bundled skills, a clarifying form, a lint gate Chronicle runs at every turn end, a four-reviewer critique loop the app drives round by round, a scorecard with pins, review settings, a Design group on Setup & health with the browser download, the usage-limit reminder, and a benchmark against Claude Design.

**Architecture:** The ACP layer gains `LaneExtras` (per-session MCP servers and a local plugin) that only the design lane fills; the fence stays as it is and gains one allow rule for the session's own MCP tools. A new Rust `designs::lint` runs impeccable's detector with the managed Node and merges it with an audit script the capture window evaluates while it renders thumbnails, so every version leaves a `LintReport`. The frontend keeps the loop: a pure state machine (`design-loop.ts`) decides what to send after each turn end, the store sends it, and file-driven cards (`questions.json`, `tokens.json`, `critique/round-<n>.json`) render in the thread. The benchmark drives that same loop in a throwaway project through the agent bridge.

**Tech Stack:** Rust (Tauri 2, objc2-web-kit `evaluateJavaScript`, serde_json, sha2), TypeScript + React 19, Vitest, the pinned adapter `@agentclientprotocol/claude-agent-acp@0.75.1` (SDK 0.3.257 inside), `@playwright/mcp@0.0.83`, `shadcn@4.21.0`, `lucide-static@1.49.0`, impeccable 3.5.0 (Apache 2.0).

**Spec:** `docs/superpowers/specs/2026-10-01-design-pane-director-design.md` (read it first; this plan argues from it; §15 lists the decisions the user approved on 2026-10-01). Foundation spec: `docs/superpowers/specs/2026-09-17-design-pane-foundation-design.md`. Comps: `design/comps/design-pane/{03-Questions,04-Generating,06-Scorecard,09-Errors,10-Setup,11-Review-settings}.dc.html` (source of truth for layout and copy; `gen.py` has exact sizes and strings).

## Global Constraints

- Work on branch `react-shadcn` in place (no worktree). Never `git stash`, `reset`, or `checkout` in the shared tree; another lane may be writing files. Commit only the files your task names.
- Dark theme only. Use design tokens (`--surface-*`, `--text-*`, `--border-*`, `--state-*`), never raw hex in app UI (hex is allowed only inside design frames, the bundled plugin, and tests).
- Meaningful small text uses `--text-faint` (or brighter), never `--text-dim`/`--text-dimmer` (they fail WCAG AA).
- Copy register: plain language, sentence case, errors say what happened and the one next step; no "MCP", "ACP", "Playwright", "CLI", "JSON" in headlines or row names. Board copy is verbatim where a board has it.
- No bare `setTimeout`/`setInterval` in scanned frontend files: use `every()` from `@/lib/scheduler`, or add `// timer-ok: <why>` plus an `ALLOWED` entry in `src/lib/no-bare-timers.test.ts`.
- In-app drag and drop is pointer-event driven. HTML5 drag and drop does not work in this webview. No `jsdom`: component tests are not available; pure logic goes in `src/lib/*.ts` and is tested there.
- `acp::ledger` (edit ledger, in `src-tauri/src/acp.rs`) is not `crate::ledger` (roadmap ledger).
- Every new `#[tauri::command]` goes in `tauri::generate_handler![…]` in `src-tauri/src/main.rs`; `build.rs` derives the ACL from that list.
- The fence is unchanged: the session `_meta` carries **no** permission allow rules; every write inside `<designs>/<slug>/…` is auto-allowed by layer 1, dot-leading paths refused. The only new automatic answer is for tool names starting with `mcp__playwright__`, `mcp__shadcn__` or `mcp__chronicle__`.
- App-owned review files live under dot paths (`<slug>/.review/…`, `.chronicle/designs/review.json`, `.chronicle/designs/.reminders.json`) so the session can never write them. Director-owned files are non-dot: `questions.json`, `tokens.json`, `critique/round-<n>.json`, `refs/`.
- Reviewer weights: UX 0.35, art 0.30, accessibility 0.20, copy 0.15. Defaults: critique on, bar 8.0, rounds 3, lint on; bar range 5.0–9.5 step 0.5; rounds 1–5; at most two lint fix passes per round; at most five questions.
- Contrast: ≥ 4.5:1, or ≥ 3:1 for text ≥ 18 px or bold ≥ 14 px. Targets: ≥ 44 px on frames ≤ 768 wide, ≥ 24 px otherwise.
- Pinned versions live in one place each: `designs::plugin::PLAYWRIGHT_MCP` = `"0.0.83"`, `designs::plugin::PLAYWRIGHT` = `"1.49.0"` (the `playwright` package whose `install chromium` downloads the browser — check `npm view playwright version` at build time and pin what you find, then keep it), `designs::plugin::SHADCN` = `"4.21.0"`. Browsers download into `~/.chronicle/tools/browsers`.
- Rust tests: `cd src-tauri && cargo test <name>` (put `$HOME/.cargo/bin` on PATH first). Frontend tests: `npx vitest run <file>`. Typecheck: `npx tsc --noEmit -p .`.
- Commit messages follow the repo style `type(scope): plain sentence`, ending with the line `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Review Focus

Inputs the spec implies but no single feature statement covers. Each has its test in the task named.

1. A `critique/round-<n>.json` whose `weighted` and `passed` disagree with its reviewer scores (the director, or a stray edit, wrote `9.9`): the app must recompute and decide from the scores, never from the file's verdict. → Task 10 (`parseCritique` recomputes) and Task 7 (`read_critique` recomputes).
2. The director ends a critique turn **without** writing the round file, or writes one for the wrong version: the loop must not wait forever and must not treat silence as a pass. → Task 12 (`afterTurn` with `critique: null` → `critiqueMissing`) and Task 15 (the card says "The critique didn't come back" with Ask again).
3. Node is absent or the detector crashes: the lint gate must say it could not run, and the loop must go on to the critique rather than report "passed · 0 severe". → Task 5 (`LintReport.ran = false` with `problem`) and Task 15 (the card shows "couldn't run").
4. The app quits mid-loop (a fix turn was running): on restart the persisted state must resume at the gate on the latest version instead of sending a duplicate fix prompt. → Task 12 (`resumeAfterRestart`) and Task 13.
5. `questions.json` with more than five questions, non-string options, a duplicate id, or no questions at all: the form must show at most five well-formed questions and a file with none must not stall the loop in "waiting on you". → Task 10 (`parseQuestions` caps and drops) and Task 12 (`questionsPending` is false for an empty form).

## File map

Rust (`src-tauri/src/`):
- `acp.rs` — modify: `LaneExtras`, MCP servers and plugin in `session/new`/`session/load`, `design_mcp_decision`.
- `designs/plugin.rs` — create: pinned versions, the bundled plugin's location and integrity check, the MCP server list.
- `designs/prompt.rs` — modify: prompt from `resources/design/DIRECTOR.md`, `design_session_meta(root, plugin_dir)`, `context_files`.
- `designs/frame.rs` — modify: reporter `locate`; the audit script from `resources/design/audit.js`, injected with the reporter.
- `designs/lint.rs` — create: findings model, detector runner, kind rules merge, report IO, version marks.
- `designs/thumbs.rs` — modify: `evaluate` after ready; `design_review_version`, `design_capture`, `design_lint_current`.
- `designs/review.rs` — create: settings, state, answers, critique reading, reminders, `design_file_read`.
- `designs/versions.rs` — modify: `VersionMeta` optional `lint`, `score`, `round`; `mark`.
- `designs/bench.rs` — create: briefs reader, throwaway project, results writer.
- `setup.rs` — modify: `design_browser`, `design_skills` rows; resource dir; browser install.
- `agent_api.rs`, `cli.rs`, `bridge.rs`, `mcp.rs` — modify: `designs.capture`, `designs.lint`, `designs.bench`.
- `main.rs` — modify: `LaneExtras` for the design lane, new commands, resource dir at setup.
- `resources/design/DIRECTOR.md`, `resources/design/audit.js` — create.
- `resources/design-plugin/**` — create (vendored skills, four reviewers, our two skills); `skills/chronicle-icons/icons/` is generated by `scripts/design-plugin.mjs` and git-ignored.
- `tauri.conf.json` — modify: bundle `resources/design/*` and `resources/design-plugin/**`.

Frontend (`src/`):
- `lib/design-review-model.ts` (+ test) — create: types, parsers, weights, state words.
- `lib/design-prompts.ts` (+ test) — create: every fixed prompt the loop sends.
- `lib/design-loop.ts` (+ test) — create: the pure state machine.
- `lib/design-store.ts` (+ test), `lib/ipc.ts` — modify: review state per project, the driver, file-driven cards, actions.
- `lib/reminders.ts` (+ test) — create: usage-limit reminders.
- `lib/design-bench.ts` (+ test), `lib/agent-bridge.ts` — create/modify: the bench runner and three bridge actions.
- `lib/setup-store.ts`, `screens/setup/SetupScreen.tsx`, `screens/setup/CheckRow.tsx` — modify: the Design group.
- `screens/agent/AgentPane.tsx`, `screens/agent/Composer.tsx` — modify: `trailing` cards, `chips` row.
- `screens/design/cards/{QuestionsCard,TokenPlanCard,LintCard,CritiqueCard,BelowBarCard,ReviewToolsCard}.tsx` — create.
- `screens/design/{Scorecard,ReviewSettingsPopover,ReviewPill,PinLayer}.tsx` — create.
- `screens/design/{DesignThread,DesignPane,CanvasToolbar,DesignCanvas,FrameView,DesignSidebar,HistoryPanel}.tsx` — modify.

Repo: `bench/design/briefs/*.md`, `bench/design/README.md`, `release.sh`, `scripts/design-plugin.mjs`, `package.json`, `.gitignore`, `docs/agent-api.md`, `skill/chronicle/SKILL.md`, `chronicle.json`.

---

## Phase A · Rust

### Task 1: `LaneExtras` — MCP servers and a plugin ride into the design session

**Files:**
- Modify: `src-tauri/src/acp.rs` (`AcpSession` ~800-840, `start` ~899-945, `handshake` session/new + session/load ~1113-1135, `design_write_decision` ~733, the `session/request_permission` arm ~1318-1350, tests ~2520+)
- Modify: `src-tauri/src/designs/prompt.rs` (`design_session_meta`)
- Modify: `src-tauri/src/main.rs` (the two `acp::start` calls ~3281 and ~3302)

**Interfaces:**
- Produces:
  - `#[derive(Clone, Default, Debug)] pub struct LaneExtras { pub mcp_servers: Vec<Value>, pub plugin_dir: Option<PathBuf> }` in `acp.rs`. Each `mcp_servers` element is the ACP stdio shape `{ "name", "command", "args": [..], "env": [{ "name", "value" }] }`.
  - `acp::start(state, emit, key, lane, cwd, project_dir, roots, designs_root, extras: LaneExtras, resume, cmd)` — `extras` after `designs_root`. Every existing call passes `LaneExtras::default()`.
  - `designs::prompt::design_session_meta(designs_root: &Path, plugin_dir: Option<&Path>) -> Map<String, Value>` — `systemPrompt: { append }` always; when `plugin_dir` is `Some(p)`, also `claudeCode: { options: { plugins: [ { "type": "local", "path": p } ] } }` and **nothing else** under `options`.
  - `pub fn design_mcp_decision(params: &Value) -> Option<String>` — for a `session/request_permission` whose tool name (`toolCall.name` or `_meta.claudeCode.toolName`) starts with `mcp__playwright__`, `mcp__shadcn__` or `mcp__chronicle__`, the `optionId` of the `allow_once` option; `None` for any other tool or when no `allow_once` option exists (then the ask reaches the user as today).
  - `session/new` carries `mcpServers: extras.mcp_servers` and `_meta` from `design_session_meta`; `session/load` carries the same `mcpServers` (today `[]`).

- [ ] **Step 1: Write the failing tests** (append inside `mod acp_tests` in `acp.rs`, and inside `mod tests` in `prompt.rs`)

```rust
// acp.rs
#[test]
fn mcp_tools_from_the_sessions_own_servers_are_allowed_without_asking() {
    let ask = |name: &str| json!({ "toolCall": { "toolCallId": "m1", "name": name },
        "options": [ { "optionId": "yes", "kind": "allow_once" }, { "optionId": "no", "kind": "reject_once" } ] });
    assert_eq!(design_mcp_decision(&ask("mcp__playwright__browser_navigate")).as_deref(), Some("yes"));
    assert_eq!(design_mcp_decision(&ask("mcp__shadcn__search_items_in_registries")).as_deref(), Some("yes"));
    assert_eq!(design_mcp_decision(&ask("mcp__chronicle__chronicle_designs_capture")).as_deref(), Some("yes"));
    assert!(design_mcp_decision(&ask("mcp__figma__get_design_context")).is_none(), "unknown servers still ask");
    assert!(design_mcp_decision(&ask("Bash")).is_none());
    let via_meta = json!({ "toolCall": { "toolCallId": "m2", "_meta": { "claudeCode": { "toolName": "mcp__playwright__browser_snapshot" } } },
        "options": [ { "optionId": "ok", "kind": "allow_once" } ] });
    assert_eq!(design_mcp_decision(&via_meta).as_deref(), Some("ok"));
    let no_once = json!({ "toolCall": { "toolCallId": "m3", "name": "mcp__playwright__browser_click" },
        "options": [ { "optionId": "always", "kind": "allow_always" } ] });
    assert!(design_mcp_decision(&no_once).is_none(), "never picks an always option");
}

#[test]
fn the_design_lane_sends_its_servers_and_plugin_and_the_chat_lane_sends_none() {
    let Some(h) = start_mock("lane-extras") else { return };
    let py = python3().unwrap();
    let script = h.dir.join(".mock-agent.py");
    let mut cmd = std::process::Command::new(py);
    cmd.arg(&script).arg(&h.dir);
    let (tx, rx2) = mpsc::channel::<Value>();
    let emit: Emit = Arc::new(move |v| { let _ = tx.send(v); });
    let dkey = Lane::Design.key(&h.key);
    let extras = LaneExtras {
        mcp_servers: vec![json!({ "name": "playwright", "command": "/usr/bin/true", "args": ["--headless"], "env": [] })],
        plugin_dir: Some(PathBuf::from("/Applications/Chronicle.app/Contents/Resources/design-plugin")),
    };
    assert!(start(&h.state, emit, dkey.clone(), Lane::Design, h.dir.clone(), h.dir.clone(), vec![h.dir.clone()], Some(h.dir.join(".chronicle/designs")), extras, None, cmd).unwrap());
    let _ = wait_for(&rx2, 20, |v| state_is(v, "ready"));
    // the mock agent echoes every request it received into <dir>/.mock-requests.jsonl
    let log = std::fs::read_to_string(h.dir.join(".mock-requests.jsonl")).unwrap_or_default();
    let new_req = log.lines().filter_map(|l| serde_json::from_str::<Value>(l).ok()).find(|v| v["method"] == "session/new" && v["params"]["mcpServers"].is_array() && !v["params"]["mcpServers"].as_array().unwrap().is_empty()).expect("a session/new with servers");
    assert_eq!(new_req["params"]["mcpServers"][0]["name"], "playwright");
    assert_eq!(new_req["params"]["_meta"]["claudeCode"]["options"]["plugins"][0]["type"], "local");
    assert!(new_req["params"]["_meta"]["claudeCode"]["options"].get("settings").is_none(), "no permission rules ride along");
    // the chat lane's own session/new (started by start_mock) has none
    let chat_req = log.lines().filter_map(|l| serde_json::from_str::<Value>(l).ok()).find(|v| v["method"] == "session/new" && v["params"].get("_meta").is_none()).expect("the chat session/new");
    assert!(chat_req["params"].get("mcpServers").map(|m| m.as_array().map(|a| a.is_empty()).unwrap_or(true)).unwrap_or(true));
    h.state.drain();
}

// prompt.rs
#[test]
fn meta_carries_the_plugin_and_still_no_permission_rules() {
    let m = design_session_meta(Path::new("/p/.chronicle/designs"), Some(Path::new("/app/Resources/design-plugin")));
    assert_eq!(m["systemPrompt"]["append"], DESIGN_PROMPT);
    assert_eq!(m["claudeCode"]["options"]["plugins"], json!([{ "type": "local", "path": "/app/Resources/design-plugin" }]));
    assert_eq!(m["claudeCode"]["options"].as_object().unwrap().len(), 1, "plugins is the only option");
    let none = design_session_meta(Path::new("/p/.chronicle/designs"), None);
    assert!(none.get("claudeCode").is_none());
}
```

If `start_mock`'s Python agent does not already record its requests, add to `.mock-agent.py` (in the test helper that writes it) one line per received request: `open(os.path.join(sys.argv[1], ".mock-requests.jsonl"), "a").write(json.dumps(msg) + "\n")` right where it reads a line from stdin.

- [ ] **Step 2: Run to verify they fail**

Run: `cd src-tauri && cargo test design_mcp_decision the_design_lane_sends_its_servers meta_carries_the_plugin`
Expected: compile errors (`LaneExtras`, `design_mcp_decision` not found; `design_session_meta` takes 1 argument; `start` takes 10).

- [ ] **Step 3: Implement**

In `acp.rs`, next to `WriteDecision`:

```rust
/// What a lane carries into `session/new` beyond the prompt: the MCP servers
/// it may talk to (ACP stdio shape) and a local Claude Code plugin. The chat
/// lane sends none of either; the design lane's are built in main.rs from
/// `designs::plugin::servers`.
#[derive(Clone, Default, Debug)]
pub struct LaneExtras {
    pub mcp_servers: Vec<Value>,
    pub plugin_dir: Option<PathBuf>,
}

/// Tool names the design lane answers "allow once" for without asking: the
/// session's own MCP servers (a headless review browser with no profile, the
/// component registry, Chronicle's read-only design tools). They read pages
/// and files; none of them writes into the project.
const AUTO_MCP_PREFIXES: [&str; 3] = ["mcp__playwright__", "mcp__shadcn__", "mcp__chronicle__"];

pub fn design_mcp_decision(params: &Value) -> Option<String> {
    let call = params.get("toolCall")?;
    let name = call.get("name").and_then(|v| v.as_str())
        .or_else(|| call.pointer("/_meta/claudeCode/toolName").and_then(|v| v.as_str()))?;
    if !AUTO_MCP_PREFIXES.iter().any(|p| name.starts_with(p)) { return None; }
    let options = params.get("options").and_then(|v| v.as_array())?;
    options.iter().find(|o| o["kind"] == "allow_once").and_then(|o| o["optionId"].as_str()).map(String::from)
}
```

`AcpSession` gains `extras: LaneExtras`; `start` gains the parameter and stores it. In `handshake`:

```rust
Some(old_sid) => {
    // …
    let mut load = json!({ "sessionId": old_sid, "cwd": cwd, "mcpServers": self.extras.mcp_servers });
    if let Some(root) = &self.designs_root {
        load["_meta"] = Value::Object(crate::designs::prompt::design_session_meta(root, self.extras.plugin_dir.as_deref()));
    }
    ("session/load", load)
}
None => {
    let new_req = proto::NewSessionRequest::new(cwd);
    let mut v = match serde_json::to_value(&new_req) { Ok(v) => v, Err(e) => return self.fail_handshake(&e.to_string()) };
    if !self.extras.mcp_servers.is_empty() { v["mcpServers"] = Value::Array(self.extras.mcp_servers.clone()); }
    if let Some(root) = &self.designs_root {
        v["_meta"] = Value::Object(crate::designs::prompt::design_session_meta(root, self.extras.plugin_dir.as_deref()));
    }
    ("session/new", v)
}
```

(The proto builder's `.meta()` was used before; building the JSON directly keeps `mcpServers` in the request without depending on the crate's `McpServer` enum. `session/load`'s value for a chat session stays `[]`.)

In the `session/request_permission` arm, after the `design_exit_plan_outcome` block and before `design_write_decision`:

```rust
if self.designs_root.is_some() {
    if let Some(option_id) = design_mcp_decision(&params) {
        self.respond_ok(&id, json!({ "outcome": { "outcome": "selected", "optionId": option_id } }));
        return;
    }
}
```

(Match the exact response shape the write decision uses — copy it from that block.) In `prompt.rs`:

```rust
pub fn design_session_meta(_designs_root: &Path, plugin_dir: Option<&Path>) -> Map<String, Value> {
    let mut m = Map::new();
    m.insert("systemPrompt".into(), json!({ "append": DESIGN_PROMPT }));
    if let Some(p) = plugin_dir {
        m.insert("claudeCode".into(), json!({ "options": { "plugins": [ { "type": "local", "path": p.to_string_lossy() } ] } }));
    }
    m
}
```

Update the existing `meta_appends_the_prompt_and_carries_no_permission_rules` test to pass `None`. In `main.rs`, both `acp::start` calls pass `acp::LaneExtras::default()` for now (Task 8 fills the design lane's). Every test call to `start` in `acp.rs` gains `LaneExtras::default()` after the `designs_root` argument.

- [ ] **Step 4: Run to verify they pass**

Run: `cd src-tauri && cargo test acp_tests prompt`
Expected: PASS, including every pre-existing lane and fence test.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/acp.rs src-tauri/src/designs/prompt.rs src-tauri/src/main.rs
git commit -m "feat(design): the design session can carry its own tools and a bundled plugin"
```

---

### Task 2: The bundled plugin, its build script, and the session's server list

**Files:**
- Create: `src-tauri/src/designs/plugin.rs`, `scripts/design-plugin.mjs`
- Create: `src-tauri/resources/design-plugin/.claude-plugin/plugin.json`, `…/NOTICE.md`, `…/skills/impeccable/**` (vendored), `…/skills/frontend-design/**`, `…/skills/canvas-design/**`, `…/skills/algorithmic-art/**`, `…/skills/chronicle-ecommerce/SKILL.md`, `…/skills/chronicle-icons/SKILL.md`, `…/agents/{art-director,ux-director,accessibility,copy}.md`
- Modify: `src-tauri/src/designs/mod.rs` (`pub mod plugin;`), `src-tauri/tauri.conf.json` (`bundle.resources`), `package.json` (scripts), `.gitignore`

**Interfaces:**
- Produces (`designs::plugin`):
  - `pub const PLAYWRIGHT_MCP: &str = "0.0.83"; pub const PLAYWRIGHT: &str = "<pinned>"; pub const SHADCN: &str = "4.21.0";`
  - `pub fn plugin_dir(resource_dir: &Path) -> PathBuf` → `resource_dir.join("design-plugin")`.
  - `pub const SKILLS: [&str; 6] = ["impeccable", "frontend-design", "canvas-design", "algorithmic-art", "chronicle-ecommerce", "chronicle-icons"]; pub const REVIEWERS: [&str; 4] = ["art-director", "ux-director", "accessibility", "copy"];`
  - `pub fn intact(dir: &Path) -> Result<String, String>` — Ok(detail) when `.claude-plugin/plugin.json`, every `skills/<name>/SKILL.md`, every `agents/<name>.md` and at least 100 files under `skills/chronicle-icons/icons/` exist; detail is `"impeccable 3.5.0 · 4 reviewers"`. Err names the first missing piece in plain words.
  - `pub fn servers(project: &Path, npx: &str, browsers_dir: Option<&Path>, exe: &Path) -> Vec<Value>` — the ACP stdio list: `chronicle` (`exe --mcp <project>`) always; `playwright` only when `browsers_dir` is `Some` (command `npx`, args `["--yes", "--", "@playwright/mcp@<PLAYWRIGHT_MCP>", "--headless", "--isolated", "--browser", "chromium"]`, env `PLAYWRIGHT_BROWSERS_PATH=<browsers_dir>`); `shadcn` only when `project/components.json` is a file (args `["--yes", "--", "shadcn@<SHADCN>", "mcp"]`). Every entry's `env` includes `PATH=<setup::tool_env_path()>` so `node` is found from a Finder-launched app.

- [ ] **Step 1: Write the failing tests** (in `plugin.rs`)

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;
    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("chronicle-plugin-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d); std::fs::create_dir_all(&d).unwrap(); d
    }
    #[test]
    fn the_server_list_follows_what_is_installed_and_present() {
        let p = tmp("servers");
        let exe = Path::new("/Applications/Chronicle.app/Contents/MacOS/chronicle");
        let none = servers(&p, "/usr/local/bin/npx", None, exe);
        assert_eq!(none.iter().map(|s| s["name"].as_str().unwrap()).collect::<Vec<_>>(), vec!["chronicle"]);
        assert_eq!(none[0]["args"], serde_json::json!(["--mcp", p.to_string_lossy()]));
        std::fs::write(p.join("components.json"), "{}").unwrap();
        let all = servers(&p, "/usr/local/bin/npx", Some(Path::new("/Users/u/.chronicle/tools/browsers")), exe);
        let names: Vec<&str> = all.iter().map(|s| s["name"].as_str().unwrap()).collect();
        assert_eq!(names, vec!["chronicle", "playwright", "shadcn"]);
        let pw = &all[1];
        assert_eq!(pw["command"], "/usr/local/bin/npx");
        assert_eq!(pw["args"][2], format!("@playwright/mcp@{PLAYWRIGHT_MCP}"));
        assert!(pw["args"].as_array().unwrap().iter().any(|a| a == "--isolated"));
        let env: Vec<(String, String)> = pw["env"].as_array().unwrap().iter().map(|e| (e["name"].as_str().unwrap().into(), e["value"].as_str().unwrap().into())).collect();
        assert!(env.iter().any(|(k, v)| k == "PLAYWRIGHT_BROWSERS_PATH" && v == "/Users/u/.chronicle/tools/browsers"));
        assert!(env.iter().any(|(k, _)| k == "PATH"));
        assert_eq!(all[2]["args"][2], format!("shadcn@{SHADCN}"));
    }
    #[test]
    fn integrity_names_what_is_missing() {
        let d = tmp("intact");
        assert!(intact(&d).unwrap_err().contains("plugin.json"));
        std::fs::create_dir_all(d.join(".claude-plugin")).unwrap();
        std::fs::write(d.join(".claude-plugin/plugin.json"), r#"{"name":"chronicle-design"}"#).unwrap();
        for s in SKILLS { std::fs::create_dir_all(d.join("skills").join(s)).unwrap(); std::fs::write(d.join("skills").join(s).join("SKILL.md"), "# x").unwrap(); }
        assert!(intact(&d).unwrap_err().contains("reviewer"));
        std::fs::create_dir_all(d.join("agents")).unwrap();
        for r in REVIEWERS { std::fs::write(d.join("agents").join(format!("{r}.md")), "---\nname: x\n---").unwrap(); }
        assert!(intact(&d).unwrap_err().contains("icons"));
        let icons = d.join("skills/chronicle-icons/icons"); std::fs::create_dir_all(&icons).unwrap();
        for i in 0..120 { std::fs::write(icons.join(format!("i{i}.svg")), "<svg/>").unwrap(); }
        assert_eq!(intact(&d).unwrap(), "impeccable 3.5.0 · 4 reviewers");
    }
    #[test]
    fn the_shipped_plugin_is_intact() {
        // the repo's own resources dir, as the bundle copies it
        let d = Path::new(env!("CARGO_MANIFEST_DIR")).join("resources");
        if !plugin_dir(&d).join("skills/chronicle-icons/icons").is_dir() { eprintln!("run `npm run design-plugin` first"); return; }
        assert!(intact(&plugin_dir(&d)).is_ok(), "{:?}", intact(&plugin_dir(&d)));
        let v: Value = serde_json::from_str(&std::fs::read_to_string(plugin_dir(&d).join(".claude-plugin/plugin.json")).unwrap()).unwrap();
        assert_eq!(v["name"], "chronicle-design");
    }
}
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd src-tauri && cargo test plugin::tests`
Expected: compile error (module missing).

- [ ] **Step 3: Write `plugin.rs`**

```rust
//! The design session's bundled tools: where the Claude Code plugin Chronicle
//! ships lives, whether it is whole, and which MCP servers a session gets.
//! Versions are pinned here and nowhere else.
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

pub const PLAYWRIGHT_MCP: &str = "0.0.83";
pub const PLAYWRIGHT: &str = "1.49.0";
pub const SHADCN: &str = "4.21.0";
pub const SKILLS: [&str; 6] = ["impeccable", "frontend-design", "canvas-design", "algorithmic-art", "chronicle-ecommerce", "chronicle-icons"];
pub const REVIEWERS: [&str; 4] = ["art-director", "ux-director", "accessibility", "copy"];

pub fn plugin_dir(resource_dir: &Path) -> PathBuf { resource_dir.join("design-plugin") }

pub fn intact(dir: &Path) -> Result<String, String> {
    if !dir.join(".claude-plugin/plugin.json").is_file() { return Err("the design skills' plugin.json is missing".into()); }
    for s in SKILLS {
        if !dir.join("skills").join(s).join("SKILL.md").is_file() { return Err(format!("the {s} skill is missing")); }
    }
    for r in REVIEWERS {
        if !dir.join("agents").join(format!("{r}.md")).is_file() { return Err(format!("the {r} reviewer is missing")); }
    }
    let icons = std::fs::read_dir(dir.join("skills/chronicle-icons/icons")).map(|d| d.filter_map(|e| e.ok()).filter(|e| e.path().extension().map(|x| x == "svg").unwrap_or(false)).count()).unwrap_or(0);
    if icons < 100 { return Err("the icons are missing".into()); }
    Ok("impeccable 3.5.0 · 4 reviewers".into())
}

fn env(pairs: &[(&str, String)]) -> Value {
    Value::Array(pairs.iter().map(|(k, v)| json!({ "name": k, "value": v })).collect())
}

pub fn servers(project: &Path, npx: &str, browsers_dir: Option<&Path>, exe: &Path) -> Vec<Value> {
    let path = crate::setup::tool_env_path();
    let mut out = vec![json!({ "name": "chronicle", "command": exe.to_string_lossy(), "args": ["--mcp", project.to_string_lossy()], "env": env(&[("PATH", path.clone())]) })];
    if let Some(b) = browsers_dir {
        out.push(json!({ "name": "playwright", "command": npx,
            "args": ["--yes", "--", format!("@playwright/mcp@{PLAYWRIGHT_MCP}"), "--headless", "--isolated", "--browser", "chromium"],
            "env": env(&[("PATH", path.clone()), ("PLAYWRIGHT_BROWSERS_PATH", b.to_string_lossy().to_string())]) }));
    }
    if project.join("components.json").is_file() {
        out.push(json!({ "name": "shadcn", "command": npx, "args": ["--yes", "--", format!("shadcn@{SHADCN}"), "mcp"], "env": env(&[("PATH", path)]) }));
    }
    out
}
```

Add `pub mod plugin;` to `designs/mod.rs`. `setup::tool_env_path` is already `pub`.

- [ ] **Step 4: Assemble the plugin on disk**

`scripts/design-plugin.mjs` copies the vendored sources into place and generates the icons:

```js
#!/usr/bin/env node
// Assembles src-tauri/resources/design-plugin/: the hand-edited parts are
// committed there already; this script only (re)generates the Lucide icon
// set from node_modules/lucide-static so 1,500 SVGs never live in git.
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
const ROOT = path.resolve("src-tauri/resources/design-plugin");
const ICONS = path.join(ROOT, "skills/chronicle-icons/icons");
const SRC = path.resolve("node_modules/lucide-static/icons");
if (!existsSync(SRC)) { console.error("lucide-static is not installed: npm install"); process.exit(1); }
rmSync(ICONS, { recursive: true, force: true });
mkdirSync(ICONS, { recursive: true });
let n = 0;
for (const f of readdirSync(SRC)) if (f.endsWith(".svg")) { cpSync(path.join(SRC, f), path.join(ICONS, f)); n++; }
writeFileSync(path.join(ICONS, "..", "ICONS.txt"), readdirSync(ICONS).map((f) => f.replace(/\.svg$/, "")).join("\n") + "\n");
console.log(`design-plugin: ${n} icons`);
```

`npm install --save-dev lucide-static@1.49.0`. `package.json` scripts: `"design-plugin": "node scripts/design-plugin.mjs"`, and `"build": "npm run design-plugin && tsc -b && vite build"`. `.gitignore` gains `src-tauri/resources/design-plugin/skills/chronicle-icons/icons/` and `…/ICONS.txt`. `tauri.conf.json` `bundle.resources` becomes `["resources/blocklists/*", "resources/design/*", "resources/design-plugin/**"]`.

Vendor (copy verbatim, then edit only as listed; every edit goes in `NOTICE.md` with the file and the reason):

- `skills/impeccable/` from `~/.claude/plugins/cache/impeccable/impeccable/3.5.0/skills/impeccable/` — drop `scripts/live*`, `scripts/live/`, `scripts/pin.mjs`, `scripts/critique-storage.mjs`, `scripts/modern-screenshot.umd.js`, `reference/live.md`, `reference/codex.md`; keep `scripts/detector/**`, `scripts/detect.mjs`, `scripts/palette.mjs`, `scripts/context*.mjs` (unused but harmless). In `SKILL.md`: replace Setup step 1 with "Chronicle names the project's `PRODUCT.md` and `DESIGN.md` in every message's prefix; read them when named. Never run `context.mjs`."; step 5 with "If there are no committed brand colors, pick the seed from `reference/palette.md`" and add `reference/palette.md` (a 24-row table of seed hues with the composition guidance `palette.mjs` prints — run it once and transcribe); remove the `live` command from `argument-hint` and the `allowed-tools` block. Leave every other rule untouched.
- `skills/frontend-design/` from `~/.claude/plugins/cache/claude-plugins-official/frontend-design/*/skills/frontend-design/` (SKILL.md + LICENSE.txt).
- `skills/canvas-design/` and `skills/algorithmic-art/` from `https://github.com/anthropics/skills` (`skills/canvas-design`, `skills/algorithmic-art`), `git clone --depth 1` into the scratchpad and copy the two folders with their LICENSE.
- `skills/chronicle-ecommerce/SKILL.md` — ours. Front matter `name: chronicle-ecommerce`, `description: Shopping-page rules for product, category, cart and checkout pages, written from Nielsen Norman Group and Baymard Institute public articles.` Body: twelve numbered rules, each with a one-line "why" and a citation URL: (1) price and per-unit price visible above the fold on every breakpoint; (2) delivery cost and date beside the primary action; (3) returns policy named on the page; (4) one primary action above the fold on the narrowest frame; (5) product images with a zoom or gallery and real alternates; (6) size or variant pickers show stock and never hide the chosen value; (7) reviews with a count and a distribution, never a bare star; (8) gift options named where a gift buyer looks; (9) a sticky add-to-cart on phones once the first one scrolls away; (10) no carousel for the primary information; (11) trust signals near payment, not in a footer; (12) checkout progress and guest checkout. Citations: NN/g "E-Commerce UX" articles and Baymard's public "UX research articles" index (link the article, quote nothing).
- `skills/chronicle-icons/SKILL.md` — ours: `name: chronicle-icons`, description "Lucide icons as inline SVG, bundled; no icon service." Body: "The icon set is in `icons/`; `ICONS.txt` lists every name. Find one with `grep -i <word> ICONS.txt` (a read, no permission), then inline the SVG's contents into the page with `width`, `height`, `stroke="currentColor"` and `aria-hidden="true"`, or `role="img"` and a `<title>` when it carries meaning. Never link an icon font or CDN."
- `agents/*.md` — the four reviewers (Task 2's own deliverable; their bodies are the rubrics). Front matter per file: `name: <id>`, `description: <one line>`, `tools: Read, Glob, Grep`, `model: inherit`, `maxTurns: 8`. Each body: role in two sentences; **what you are given** (frame files, captures, brief and answers, kind, tokens, design system if any); **how to score** (0–10 in half points; 10 = nothing to change; ≥ 8 = ship with minor notes; < 7 = a first-screen problem); **rubric** (five bullets specific to the role — art: type scale and pairing, hierarchy, brand fit, colour discipline, the "AI default" tells from impeccable; ux: heuristics, task flow, the kind's rules with the e-commerce skill named, breakpoints, states; accessibility: contrast pairs, focus, targets, alt text, heading order, reduced motion; copy: clarity, voice, filler, labels, error and empty states); **what to return**: exactly one JSON object `{ "id": "<id>", "score": <n>, "notes": ["…"], "findings": [ { "severity": "severe"|"minor", "text": "…", "frame": "<frame id>", "selector": "<css selector or omitted>" } ] }` and nothing else, at least one finding under 9, selectors only when sure they match one element.

`.claude-plugin/plugin.json`:

```json
{ "name": "chronicle-design", "description": "The Design pane's director: taste, review rules and reviewers, bundled with Chronicle.", "version": "1.0.0", "skills": "./skills/", "agents": ["./agents/art-director.md", "./agents/ux-director.md", "./agents/accessibility.md", "./agents/copy.md"] }
```

- [ ] **Step 5: Run the script and the tests**

Run: `npm run design-plugin && cd src-tauri && cargo test plugin::tests`
Expected: `design-plugin: 15xx icons`; PASS ×3.

- [ ] **Step 6: Commit** (the icons are ignored; everything else is committed)

```bash
git add scripts/design-plugin.mjs package.json package-lock.json .gitignore src-tauri/tauri.conf.json src-tauri/src/designs/mod.rs src-tauri/src/designs/plugin.rs src-tauri/resources/design-plugin
git commit -m "feat(design): the director's skills, reviewers and icons ship as a bundled plugin"
```

---

### Task 3: The director's prompt and the context line

**Files:**
- Create: `src-tauri/resources/design/DIRECTOR.md`
- Modify: `src-tauri/src/designs/prompt.rs` (`DESIGN_PROMPT`, tests), `src-tauri/src/main.rs` (new command)
- Modify: `src/lib/ipc.ts`, `src/lib/design-store.ts` (`designPrefix` gains the context line)

**Interfaces:**
- Produces:
  - `pub const DESIGN_PROMPT: &str = include_str!("../../resources/design/DIRECTOR.md");`
  - `pub fn context_files(repo: &Path) -> Vec<String>` — the names among `["PRODUCT.md", "DESIGN.md"]` that exist as files at the repo root, in that order.
  - `#[tauri::command] fn design_context_files(roots, dir) -> Result<Vec<String>, String>`.
  - ipc: `designContextFiles(dir) => invoke<string[]>("design_context_files", { dir })`.
  - `designPrefix(slug: string, root: string, context: string[]): string` → `[design: <slug> · <root>/<slug>/]` plus, when `context` is non-empty, a second line `[context: PRODUCT.md, DESIGN.md — read these first]`.

- [ ] **Step 1: Write the failing tests**

`prompt.rs`:

```rust
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
    let _ = std::fs::remove_dir_all(&d); std::fs::create_dir_all(&d).unwrap();
    assert!(context_files(&d).is_empty());
    std::fs::write(d.join("DESIGN.md"), "x").unwrap();
    std::fs::write(d.join("PRODUCT.md"), "x").unwrap();
    assert_eq!(context_files(&d), vec!["PRODUCT.md", "DESIGN.md"]);
}
```

`design-store.test.ts` (append a case):

```ts
it("prefixes the design and, when there are context files, names them", async () => {
  const m = await import("./design-store");
  expect(m.designPrefix("guji", "/p/.chronicle/designs", [])).toBe("[design: guji · /p/.chronicle/designs/guji/]");
  expect(m.designPrefix("guji", "/p/.chronicle/designs/", ["PRODUCT.md", "DESIGN.md"]))
    .toBe("[design: guji · /p/.chronicle/designs/guji/]\n[context: PRODUCT.md, DESIGN.md — read these first]");
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd src-tauri && cargo test prompt::tests` and `npx vitest run src/lib/design-store.test.ts -t "context files"`
Expected: FAIL (`context_files` missing; the prompt lacks the new sentences; `designPrefix` takes two arguments).

- [ ] **Step 3: Write `DIRECTOR.md`** (the spec's §2, in this order; keep every sentence of the old contract)

```markdown
You are the director in Chronicle's Design pane: a senior art director and UX director. You make real pages, not mockups. You commit to choices and say what you assumed. You write to the user in plain language.

Every message starts with a line like `[design: <slug> · <folder>/]`. That names the active design and its folder, as an absolute path. Work only on that design, in that folder. A second line may name the project's context files (`[context: PRODUCT.md, DESIGN.md — read these first]`); read them before you plan.

## The file contract
- One self-contained HTML page per frame, in `frames/` inside the design's folder (for example `frames/desktop.html`).
- List every frame in the folder's `design.json` under "frames": {"id", "file", "label", "width", "height", "group"}. "width" is the viewport width the page is designed for; "height" is the first screen (the fold). Keep "v", "title", "kind", "brief" and "created" as they are.
- Put breakpoints in a group of kind "breakpoints" and alternative directions in a group of kind "variations", under "groups": {"id", "label", "kind"}.
- Put images, stylesheets and scripts in `assets/`, and link them with relative paths.
- Fonts are local: download any font you use once into `assets/fonts/` and load it with @font-face from there. Never link a font service.
- Icons: use the bundled Lucide set (the chronicle-icons skill), inlined.
- Never write outside the active design's folder, and never into a name that starts with a dot. Never edit `canvas.json`; Chronicle owns it.
- Files that are yours besides frames and assets: `questions.json` (a form, see below), `tokens.json` (your token plan), `critique/round-<n>.json` (only when Chronicle asks for a critique). `refs/` holds what the user attached; read it, never change it.

## How a new design goes
1. Read what the project has: code, tokens, components, `DESIGN.md` if it exists, the context files. Look at any site or picture the brief names (the playwright tools when present, otherwise ask Chronicle's `chronicle.designs.capture` for your own pages).
2. If an answer would change the design materially, ask — at most five questions — by writing `questions.json`: {"v":1,"questions":[{"id","label","hint","type":"single"|"multi"|"text","options":[…],"max"}],"references":true} and end the turn with one line. Otherwise decide and say what you assumed. Never ask twice for the same design unless the user asks for a re-brief.
3. Write `tokens.json` before the first frame: {"v":1,"colors":[{"name","value"}],"type":[{"role","family","weight","size","leading"}],"rejected":["…"]} — "rejected" names the defaults you refused on purpose.
4. Build the lead breakpoint first, then the others. Look at every frame you wrote before the turn ends (`chronicle.designs.capture`), and fix what you see.
5. End the turn with one sentence saying what changed. Never run a critique yourself; Chronicle asks for it, and then you run the four reviewers exactly as its message says.

## Registers by kind
- app: the impeccable product register. marketing, brand: the impeccable brand register. ecommerce: both, plus the chronicle-ecommerce rules. deck: 1920×1080 pages in the brand register.

## Taste
impeccable is the taste authority; where another skill disagrees, impeccable wins. Refuse by reflex: cream + serif + terracotta, purple gradients, a card grid as the default answer, one identical reveal on every section, muted grey body text. Contrast and target sizes as impeccable states them.

## Fix turns
A fix message names findings by frame, file and selector. Fix those, keep everything else, and say what you changed in one sentence.

## What Chronicle does for you
It renders and screenshots every frame at turn end, runs the lint gate, records a version, and runs the critique when asked. You do not need to do any of that yourself.
```

In `prompt.rs`: `pub const DESIGN_PROMPT: &str = include_str!("../../resources/design/DIRECTOR.md");` and

```rust
pub fn context_files(repo: &Path) -> Vec<String> {
    ["PRODUCT.md", "DESIGN.md"].iter().filter(|n| repo.join(n).is_file()).map(|n| n.to_string()).collect()
}
```

Update `the_prompt_states_the_file_contract` if it asserted the old first sentence. In `main.rs`:

```rust
#[tauri::command]
fn design_context_files(roots: State<OpenRoots>, dir: String) -> Result<Vec<String>, String> {
    let p = project_for(&roots, &dir)?;
    Ok(designs::prompt::context_files(&p.repo))
}
```

(add to `generate_handler!`). `ipc.ts`: `export const designContextFiles = (dir: string) => invoke<string[]>("design_context_files", { dir });`. In `design-store.ts`:

```ts
export const designPrefix = (slug: string, root: string, context: string[]) => {
  const head = `[design: ${slug} · ${root.replace(/\/+$/, "")}/${slug}/]`;
  return context.length ? `${head}\n[context: ${context.join(", ")} — read these first]` : head;
};
```

`DesignProject` gains `context: string[] | null`; `sendDesignMessage` fills it once (`p.context ??= await designContextFiles(dir).catch(() => [])`) beside `rootPath` and passes it to `designPrefix`. Mock `designContextFiles` in `design-store.test.ts`'s `./ipc` mock (`vi.fn(async () => [])`).

- [ ] **Step 4: Run to verify they pass**

Run: `cd src-tauri && cargo test prompt::tests && cd .. && npx vitest run src/lib/design-store.test.ts && npx tsc --noEmit -p .`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/resources/design/DIRECTOR.md src-tauri/src/designs/prompt.rs src-tauri/src/main.rs src/lib/ipc.ts src/lib/design-store.ts src/lib/design-store.test.ts
git commit -m "feat(design): the design session gets its director persona and reads the project's context files"
```

---

### Task 4: The reporter learns `locate`, and the audit script rides beside it

**Files:**
- Create: `src-tauri/resources/design/audit.js`
- Modify: `src-tauri/src/designs/frame.rs` (`REPORTER`, new `AUDIT`, `inject_reporter`, tests)
- Create: `src/lib/design-audit.test.ts` (parses the script; exercises its pure helpers)

**Interfaces:**
- Produces:
  - `REPORTER` also listens for `message` events from `parent` of the shape `{ __chronicleCanvas: 1, type: "locate", id, selector }` and answers `{ __chronicleFrame: 1, type: "located", id, rect: { x, y, w, h } | null }` (page coordinates of the first match's bounding box, `null` when nothing matches or the selector is invalid).
  - `pub const AUDIT: &str = include_str!("../../resources/design/audit.js");` — a `<script>` that defines `window.__chronicleAudit(opts)` where `opts = { kind: "app"|"marketing"|"deck"|"brand"|"ecommerce", width: <frame width>, fold: <declared height> }` and returns **a JSON string** of `Finding[]` (`{ rule, severity: "severe"|"minor", text, selector }`). It runs nothing on load.
  - `inject_reporter(html)` splices `REPORTER` immediately followed by `AUDIT` at the same point as before.
  - The audit's pure helpers are also exported for tests through `window.__chronicleAuditLib = { contrast, parseColor, luminance, isLarge, minTarget }` — the test file evaluates the script in a `Function` with a stub `window` and calls them.

- [ ] **Step 1: Write the failing tests**

`frame.rs` (append to `mod tests`):

```rust
#[test]
fn the_reporter_answers_locate_and_the_audit_is_injected_after_it() {
    assert!(REPORTER.contains("'locate'") && REPORTER.contains("'located'") && REPORTER.contains("__chronicleCanvas"));
    assert!(AUDIT.contains("window.__chronicleAudit=") || AUDIT.contains("window.__chronicleAudit ="));
    let out = String::from_utf8(inject_reporter(b"<html><head><title>t</title></head><body></body></html>")).unwrap();
    let r = out.find(REPORTER).expect("reporter present");
    let a = out.find(AUDIT).expect("audit present");
    assert_eq!(a, r + REPORTER.len(), "the audit follows the reporter directly");
    assert!(out.find("<title>").unwrap() > a);
}
```

`src/lib/design-audit.test.ts`:

```ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// The audit runs inside the capture window; its DOM walk is checked live. Its
// arithmetic is checked here by evaluating the script against a stub window.
const src = readFileSync(path.resolve(__dirname, "../../src-tauri/resources/design/audit.js"), "utf8");
const body = src.replace(/^<script>/, "").replace(/<\/script>\s*$/, "");
type Lib = { contrast: (a: number[], b: number[]) => number; parseColor: (s: string) => number[] | null; isLarge: (px: number, weight: number) => boolean; minTarget: (width: number) => number };
function load(): Lib {
  const win: Record<string, unknown> = {};
  new Function("window", "document", body)(win, undefined);
  return win.__chronicleAuditLib as Lib;
}

describe("the audit's arithmetic", () => {
  const lib = load();
  it("parses rgb, rgba and hex, and measures contrast like WCAG", () => {
    expect(lib.parseColor("rgb(255, 255, 255)")).toEqual([255, 255, 255, 1]);
    expect(lib.parseColor("rgba(0,0,0,0.5)")).toEqual([0, 0, 0, 0.5]);
    expect(lib.parseColor("#1a1a1a")).toEqual([26, 26, 26, 1]);
    expect(lib.parseColor("transparent")).toEqual([0, 0, 0, 0]);
    expect(lib.contrast([255, 255, 255, 1], [0, 0, 0, 1])).toBeCloseTo(21, 1);
    expect(lib.contrast([118, 118, 118, 1], [255, 255, 255, 1])).toBeCloseTo(4.54, 1);
  });
  it("knows large text and the target floor per width", () => {
    expect(lib.isLarge(18, 400)).toBe(true);
    expect(lib.isLarge(17.9, 400)).toBe(false);
    expect(lib.isLarge(14, 700)).toBe(true);
    expect(lib.minTarget(390)).toBe(44);
    expect(lib.minTarget(768)).toBe(44);
    expect(lib.minTarget(769)).toBe(24);
  });
  it("defines the entry point and runs nothing on load", () => {
    const win: Record<string, unknown> = {};
    new Function("window", "document", body)(win, undefined);
    expect(typeof win.__chronicleAudit).toBe("function");
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd src-tauri && cargo test the_reporter_answers_locate` and `npx vitest run src/lib/design-audit.test.ts`
Expected: FAIL (`AUDIT` undefined; the file does not exist).

- [ ] **Step 3: Extend the reporter**

In `REPORTER`, inside the IIFE, add before the final `})();`:

```js
addEventListener('message',function(e){var d=e.data;if(!d||d.__chronicleCanvas!==1||d.type!=='locate')return;var rect=null;try{var el=document.querySelector(String(d.selector||''));if(el){var b=el.getBoundingClientRect();rect={x:b.left+scrollX,y:b.top+scrollY,w:b.width,h:b.height}}}catch(err){}S({type:'located',id:d.id,rect:rect})});
```

(keep the whole constant on one line as it is today).

- [ ] **Step 4: Write `audit.js`** (one `<script>` element; readable, since it is not on the canvas's hot path)

```html
<script>
(function(){
  function parseColor(s){
    if(!s)return null; s=String(s).trim().toLowerCase();
    if(s==='transparent')return [0,0,0,0];
    var m=s.match(/^rgba?\(([^)]+)\)$/);
    if(m){var p=m[1].split(/[\s,\/]+/).filter(Boolean).map(parseFloat);if(p.length<3||p.some(isNaN))return null;return [p[0],p[1],p[2],p.length>3?p[3]:1]}
    m=s.match(/^#([0-9a-f]{3,8})$/);
    if(m){var h=m[1];if(h.length===3||h.length===4)h=h.split('').map(function(c){return c+c}).join('');var n=parseInt(h.slice(0,6),16);var a=h.length===8?parseInt(h.slice(6,8),16)/255:1;return [(n>>16)&255,(n>>8)&255,n&255,a]}
    return null;
  }
  function chan(c){c/=255;return c<=0.03928?c/12.92:Math.pow((c+0.055)/1.055,2.4)}
  function luminance(c){return 0.2126*chan(c[0])+0.7152*chan(c[1])+0.0722*chan(c[2])}
  function over(fg,bg){var a=fg[3];return [fg[0]*a+bg[0]*(1-a),fg[1]*a+bg[1]*(1-a),fg[2]*a+bg[2]*(1-a),1]}
  function contrast(a,b){var l1=luminance(a),l2=luminance(b);var hi=Math.max(l1,l2),lo=Math.min(l1,l2);return (hi+0.05)/(lo+0.05)}
  function isLarge(px,weight){return px>=18||(weight>=700&&px>=14)}
  function minTarget(width){return width<=768?44:24}
  function bgOf(el){
    while(el&&el!==document.documentElement){var cs=getComputedStyle(el);var c=parseColor(cs.backgroundColor);if(c&&c[3]>0)return c;if(cs.backgroundImage&&cs.backgroundImage!=='none')return null;el=el.parentElement}
    var root=parseColor(getComputedStyle(document.documentElement).backgroundColor);var bodyc=parseColor(getComputedStyle(document.body).backgroundColor);
    return (bodyc&&bodyc[3]>0)?bodyc:(root&&root[3]>0)?root:[255,255,255,1];
  }
  function sel(el){
    if(el.id)return '#'+CSS.escape(el.id);
    var parts=[];var cur=el;
    while(cur&&cur!==document.body&&parts.length<4){var s=cur.tagName.toLowerCase();var cls=(cur.className&&typeof cur.className==='string')?cur.className.trim().split(/\s+/).slice(0,2).map(function(c){return '.'+CSS.escape(c)}).join(''):'';if(cls)s+=cls;var p=cur.parentElement;if(p){var same=Array.prototype.filter.call(p.children,function(x){return x.tagName===cur.tagName});if(same.length>1)s+=':nth-of-type('+(same.indexOf(cur)+1)+')'}parts.unshift(s);cur=p}
    return parts.join(' > ');
  }
  function visible(el){var r=el.getBoundingClientRect();if(r.width===0||r.height===0)return false;var cs=getComputedStyle(el);return cs.visibility!=='hidden'&&cs.display!=='none'&&parseFloat(cs.opacity)>0}
  function textOf(el){return Array.prototype.filter.call(el.childNodes,function(n){return n.nodeType===3}).map(function(n){return n.textContent}).join('').trim()}
  var INTERACTIVE='a[href],button,input:not([type=hidden]),select,textarea,[role=button],[role=link],[tabindex]:not([tabindex="-1"])';
  window.__chronicleAudit=function(opts){
    opts=opts||{};var width=opts.width||innerWidth;var fold=opts.fold||innerHeight;var kind=opts.kind||'app';
    var out=[];var seen=0;
    function add(rule,severity,text,el){out.push({rule:rule,severity:severity,text:text,selector:el?sel(el):undefined})}
    // 1 · contrast, every element with its own text
    var all=document.body.querySelectorAll('*');
    for(var i=0;i<all.length&&seen<4000;i++){var el=all[i];var t=textOf(el);if(!t||t.length<2||!visible(el))continue;seen++;
      var cs=getComputedStyle(el);var fg=parseColor(cs.color);var bg=bgOf(el);if(!fg||!bg)continue;if(fg[3]<1)fg=over(fg,bg);
      var ratio=contrast(fg,bg);var px=parseFloat(cs.fontSize);var w=parseInt(cs.fontWeight,10)||400;var need=isLarge(px,w)?3:4.5;
      if(ratio<need)add('contrast',ratio<need-1?'severe':'minor','Text at '+ratio.toFixed(1)+':1 needs '+need+':1: “'+t.slice(0,40)+'”',el)}
    // 2 · targets and focus
    var floor=minTarget(width);var inter=document.querySelectorAll(INTERACTIVE);
    for(var j=0;j<inter.length;j++){var it=inter[j];if(!visible(it))continue;var r=it.getBoundingClientRect();
      if(r.width<floor||r.height<floor)add('target','minor','A control is '+Math.round(r.width)+'×'+Math.round(r.height)+' px; the floor at this width is '+floor+' px',it);
      var f=getComputedStyle(it);if(f.outlineStyle==='none'){try{it.classList.add('__chronicle-focus');}catch(e){}}
    }
    // outline:none without a focus-visible replacement: check stylesheets for :focus-visible on the element's selectors is impractical; report once per page when any control has outline none and no sheet mentions focus-visible
    var sheetsMention=false;try{for(var s=0;s<document.styleSheets.length;s++){var rules=document.styleSheets[s].cssRules;for(var k=0;k<rules.length;k++){if(/focus-visible|:focus/.test(rules[k].cssText)){sheetsMention=true;break}}if(sheetsMention)break}}catch(e){sheetsMention=true}
    if(!sheetsMention&&document.querySelector('.__chronicle-focus'))add('focus','minor','Controls remove the outline and no style gives keyboard focus another look',document.querySelector('.__chronicle-focus'));
    Array.prototype.forEach.call(document.querySelectorAll('.__chronicle-focus'),function(x){x.classList.remove('__chronicle-focus')});
    // 3 · images, headings, viewport
    Array.prototype.forEach.call(document.images,function(img){if(!img.hasAttribute('alt'))add('alt','minor','An image has no alt text',img)});
    var last=0;Array.prototype.forEach.call(document.querySelectorAll('h1,h2,h3,h4,h5,h6'),function(h){var n=+h.tagName[1];if(last&&n>last+1)add('headings','minor','Heading order jumps from h'+last+' to h'+n,h);last=n});
    if(!document.querySelector('meta[name=viewport]'))add('viewport','minor','The page has no viewport meta');
    // 4 · overflow and fonts
    if(document.documentElement.scrollWidth>width+1)add('overflow','severe','The page is wider than its frame ('+document.documentElement.scrollWidth+' px for '+width+')');
    try{var res=performance.getEntriesByType('resource');res.forEach(function(e){if(/\.(woff2?|ttf|otf)(\?|$)/i.test(e.name)&&!/^chronicle-file:/.test(e.name))add('fonts','severe','A font loads from outside the design: '+e.name.slice(0,80))});
      Array.prototype.forEach.call(document.querySelectorAll('link[href]'),function(l){if(/fonts\.googleapis|fonts\.gstatic|typekit|fonts\.bunny/i.test(l.href))add('fonts','severe','A font service is linked: '+l.href.slice(0,80),l)})}catch(e){}
    // 5 · raw colours without a custom property (minor, counted per value)
    var counts={};var vars=0;for(var q=0;q<all.length&&q<4000;q++){var st=all[q].getAttribute('style')||'';var mm=st.match(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)/gi);if(mm)mm.forEach(function(c){counts[c]=(counts[c]||0)+1})}
    Object.keys(counts).forEach(function(c){if(counts[c]>3)add('tokens','minor','The colour '+c+' is written '+counts[c]+' times without a custom property')});
    // 6 · kind rules
    var foldTop=function(el){return el.getBoundingClientRect().top+scrollY<fold};
    var primary=Array.prototype.filter.call(inter,function(b){return /button|submit/i.test(b.tagName+' '+(b.getAttribute('type')||''))||b.getAttribute('role')==='button'}).filter(visible);
    if(!primary.some(foldTop))add('primary-above-fold','minor','No primary action sits in the first screen');
    if(kind==='ecommerce'){
      var text=document.body.innerText||'';
      var priceEl=Array.prototype.find.call(all,function(e){return /[$€£]\s?\d|\d\s?(USD|EUR|GBP)/.test(textOf(e))&&visible(e)});
      if(!priceEl||!foldTop(priceEl))add('ecom-price','severe','The price is not in the first screen',priceEl);
      if(!/deliver|shipping|arrives|dispatch/i.test(text))add('ecom-delivery','severe','Delivery or shipping information is missing');
      if(!/return/i.test(text))add('ecom-returns','minor','The returns policy is not named');
      var cart=Array.prototype.find.call(primary,function(b){return /add to (cart|bag|basket)|buy/i.test(b.textContent||'')});
      if(cart&&!foldTop(cart))add('ecom-cta','severe','Add to cart is below the first screen on this width',cart);
    }
    return JSON.stringify(out);
  };
  window.__chronicleAuditLib={contrast:contrast,parseColor:parseColor,luminance:luminance,isLarge:isLarge,minTarget:minTarget};
})();
</script>
```

In `frame.rs`: `pub const AUDIT: &str = include_str!("../../resources/design/audit.js");` and in `splice_at` / the prepend branch, push `REPORTER` then `AUDIT` (capacity `text.len() + REPORTER.len() + AUDIT.len()`).

- [ ] **Step 5: Run to verify they pass**

Run: `cd src-tauri && cargo test frame::tests && cd .. && npx vitest run src/lib/design-audit.test.ts`
Expected: PASS (every pre-existing injection test still passes; the audit is inert on the canvas).

- [ ] **Step 6: Commit**

```bash
git add src-tauri/resources/design/audit.js src-tauri/src/designs/frame.rs src/lib/design-audit.test.ts
git commit -m "feat(design): frames can locate an element for a pin, and carry the audit the capture window runs"
```

---

### Task 5: The lint model, the detector runner, and the report

**Files:**
- Create: `src-tauri/src/designs/lint.rs`
- Modify: `src-tauri/src/designs/mod.rs` (`pub mod lint;`), `src-tauri/src/designs/versions.rs` (`VersionMeta` optional fields + `mark`), `src-tauri/src/setup.rs` (`pub fn resolve` is already public; nothing else)

**Interfaces:**
- Produces (`designs::lint`):
  - `#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)] pub struct Finding { pub rule: String, pub severity: String /* "severe"|"minor" */, pub text: String, pub frame: String, pub file: String, #[serde(default, skip_serializing_if = "Option::is_none")] pub line: Option<u32>, #[serde(default, skip_serializing_if = "Option::is_none")] pub selector: Option<String> }`
  - `#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)] pub struct LintCounts { pub severe: u32, pub minor: u32 }`
  - `#[derive(Serialize, Deserialize, Clone, Debug)] pub struct LintReport { pub v: u32, pub version: Option<u32>, pub at: String, pub ran: bool, #[serde(default)] pub problem: Option<String>, pub severe: Vec<Finding>, pub minor: Vec<Finding> }` with `pub fn counts(&self) -> LintCounts`.
  - `pub fn detector_script(plugin_dir: &Path) -> PathBuf` → `plugin_dir/skills/impeccable/scripts/detect.mjs`.
  - `pub fn run_detector(node: &Path, script: &Path, frames_dir: &Path) -> Result<Vec<Finding>, String>` — spawns `node <script> --json <frames_dir>`, accepts exit 0 or 2, parses the JSON array (`{ antipattern, name, description, severity, file, line, snippet }`) → `Finding { rule: "impeccable:<antipattern>", severity: severity == "error" | "critical" ? "severe" : "minor", text: name + " — " + description, frame: <file stem>, file: "frames/<basename>", line }`. Anything else → `Err(<plain sentence>)`.
  - `pub fn from_audit(frame_id: &str, file: &str, json: &str) -> Vec<Finding>` — parses the audit's JSON string into findings (`rule: "audit:<rule>"`, `frame`, `file`, `selector`); unparsable → empty.
  - `pub fn report(version: Option<u32>, at: &str, detector: Result<Vec<Finding>, String>, audits: Vec<Finding>) -> LintReport` — merges; `ran = detector.is_ok()`, `problem = Some(err)` otherwise; severe/minor split, sorted by frame then rule.
  - `pub fn write_report(design_dir: &Path, name: &str, r: &LintReport) -> Result<PathBuf, String>` → `<design>/.review/lint/<name>.json` (`v<n>` or `current`), atomic (`.tmp` + rename), dir created.
  - `pub fn read_report(design_dir: &Path, name: &str) -> Option<LintReport>`.
- Produces (`designs::versions`): `VersionMeta` gains `#[serde(default, skip_serializing_if = "Option::is_none")] pub lint: Option<LintCounts>, pub score: Option<f64>, pub round: Option<u32>`; `pub fn mark(design_dir: &Path, n: u32, lint: Option<LintCounts>, score: Option<f64>, round: Option<u32>) -> Result<(), String>` rewrites `meta.json` with the given fields set (a `None` leaves the field as it was).

- [ ] **Step 1: Write the failing tests** (in `lint.rs`)

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    fn tmp(name: &str) -> PathBuf { let d = std::env::temp_dir().join(format!("chronicle-lint-{name}-{}", std::process::id())); let _ = std::fs::remove_dir_all(&d); std::fs::create_dir_all(&d).unwrap(); d }

    #[test]
    fn audit_json_becomes_findings_and_bad_json_becomes_none() {
        let f = from_audit("desktop", "frames/desktop.html", r#"[{"rule":"contrast","severity":"severe","text":"Text at 3.2:1 needs 4.5:1","selector":"p.lede"},{"rule":"alt","severity":"minor","text":"An image has no alt text"}]"#);
        assert_eq!(f.len(), 2);
        assert_eq!(f[0], Finding { rule: "audit:contrast".into(), severity: "severe".into(), text: "Text at 3.2:1 needs 4.5:1".into(), frame: "desktop".into(), file: "frames/desktop.html".into(), line: None, selector: Some("p.lede".into()) });
        assert!(f[1].selector.is_none());
        assert!(from_audit("d", "f", "not json").is_empty());
    }

    #[test]
    fn a_report_splits_and_sorts_and_records_a_detector_that_could_not_run() {
        let a = vec![Finding { rule: "audit:overflow".into(), severity: "severe".into(), text: "wide".into(), frame: "mobile".into(), file: "frames/mobile.html".into(), line: None, selector: None },
                     Finding { rule: "audit:alt".into(), severity: "minor".into(), text: "alt".into(), frame: "desktop".into(), file: "frames/desktop.html".into(), line: None, selector: None }];
        let r = report(Some(3), "2026-10-01T10:00:00Z", Err("Node isn't installed".into()), a.clone());
        assert!(!r.ran); assert_eq!(r.problem.as_deref(), Some("Node isn't installed"));
        assert_eq!(r.counts(), LintCounts { severe: 1, minor: 1 });
        let ok = report(Some(3), "t", Ok(vec![Finding { rule: "impeccable:gradient-text".into(), severity: "minor".into(), text: "g".into(), frame: "desktop".into(), file: "frames/desktop.html".into(), line: Some(12), selector: None }]), a);
        assert!(ok.ran && ok.problem.is_none());
        assert_eq!(ok.minor.iter().map(|f| f.rule.as_str()).collect::<Vec<_>>(), vec!["audit:alt", "impeccable:gradient-text"]);
        let d = tmp("report");
        let p = write_report(&d, "v3", &ok).unwrap();
        assert!(p.ends_with(".review/lint/v3.json"));
        assert_eq!(read_report(&d, "v3").unwrap().counts(), ok.counts());
        assert!(read_report(&d, "v9").is_none());
    }

    #[test]
    fn the_detector_runs_on_a_frame_and_reports_its_own_rules() {
        let Some(node) = crate::setup::resolve("node") else { eprintln!("no node on this Mac; skipped"); return };
        let script = Path::new(env!("CARGO_MANIFEST_DIR")).join("resources/design-plugin/skills/impeccable/scripts/detect.mjs");
        if !script.is_file() { eprintln!("plugin not vendored yet; skipped"); return }
        let d = tmp("detector"); let frames = d.join("frames"); std::fs::create_dir_all(&frames).unwrap();
        std::fs::write(frames.join("desktop.html"), r#"<!doctype html><html><head><style>h1{background:linear-gradient(90deg,#8b5cf6,#ec4899);-webkit-background-clip:text;color:transparent}</style></head><body><h1>Hello</h1><div class="card"><div class="card">nested</div></div></body></html>"#).unwrap();
        let f = run_detector(Path::new(&node), &script, &frames).unwrap();
        assert!(f.iter().any(|x| x.rule.starts_with("impeccable:")), "{f:?}");
        assert!(f.iter().all(|x| x.frame == "desktop" && x.file == "frames/desktop.html"));
        let clean = d.join("clean"); std::fs::create_dir_all(&clean).unwrap();
        std::fs::write(clean.join("a.html"), "<!doctype html><html><head><meta name=viewport content='width=device-width'></head><body><main><h1>Plain</h1><p>Words.</p></main></body></html>").unwrap();
        assert!(run_detector(Path::new(&node), &script, &clean).unwrap().len() <= 2);
        assert!(run_detector(Path::new("/nonexistent/node"), &script, &frames).is_err());
    }
}
```

`versions.rs` (append to its tests):

```rust
#[test]
fn a_version_can_be_marked_with_lint_score_and_round_without_losing_the_rest() {
    let d = proj("mark"); let dir = d.join(".chronicle/designs/home"); std::fs::create_dir_all(dir.join("frames")).unwrap();
    std::fs::write(dir.join("design.json"), "{}").unwrap();
    let n = snapshot_if_changed(&dir, "t", "s", "p", "first").unwrap().unwrap();
    mark(&dir, n, Some(crate::designs::lint::LintCounts { severe: 1, minor: 2 }), None, None).unwrap();
    mark(&dir, n, None, Some(8.4), Some(2)).unwrap();
    let m = list(&dir).into_iter().find(|m| m.n == n).unwrap();
    assert_eq!(m.summary, "first"); assert_eq!(m.lint, Some(crate::designs::lint::LintCounts { severe: 1, minor: 2 })); assert_eq!(m.score, Some(8.4)); assert_eq!(m.round, Some(2));
    assert!(mark(&dir, 99, None, Some(1.0), None).is_err());
}
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd src-tauri && cargo test lint::tests a_version_can_be_marked`
Expected: compile errors.

- [ ] **Step 3: Implement `lint.rs`**

```rust
//! The lint gate's model: what the detector and the audit found for one
//! version, split into what blocks (severe) and what doesn't (minor), written
//! under the design's app-owned `.review/lint/`. Deterministic; the model never
//! sees this code.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::{Path, PathBuf};

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Finding {
    pub rule: String,
    pub severity: String,
    pub text: String,
    pub frame: String,
    pub file: String,
    #[serde(default, skip_serializing_if = "Option::is_none")] pub line: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")] pub selector: Option<String>,
}
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct LintCounts { pub severe: u32, pub minor: u32 }
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct LintReport {
    pub v: u32, pub version: Option<u32>, pub at: String, pub ran: bool,
    #[serde(default)] pub problem: Option<String>,
    pub severe: Vec<Finding>, pub minor: Vec<Finding>,
}
impl LintReport {
    pub fn counts(&self) -> LintCounts { LintCounts { severe: self.severe.len() as u32, minor: self.minor.len() as u32 } }
}

pub fn detector_script(plugin_dir: &Path) -> PathBuf { plugin_dir.join("skills/impeccable/scripts/detect.mjs") }

fn stem(file: &str) -> String { Path::new(file).file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default() }

pub fn run_detector(node: &Path, script: &Path, frames_dir: &Path) -> Result<Vec<Finding>, String> {
    let out = std::process::Command::new(node).arg(script).arg("--json").arg(frames_dir)
        .env("PATH", crate::setup::tool_env_path()).stdin(std::process::Stdio::null()).output()
        .map_err(|e| format!("The anti-pattern check couldn't start: {e}"))?;
    let code = out.status.code().unwrap_or(-1);
    if code != 0 && code != 2 { return Err(format!("The anti-pattern check stopped (exit {code}): {}", String::from_utf8_lossy(&out.stderr).lines().last().unwrap_or("").chars().take(160).collect::<String>())); }
    let text = String::from_utf8_lossy(&out.stdout);
    let arr: Vec<Value> = serde_json::from_str(text.trim()).map_err(|_| "The anti-pattern check answered with something that isn't a list".to_string())?;
    Ok(arr.iter().filter_map(|f| {
        let file = f["file"].as_str()?;
        let base = Path::new(file).file_name()?.to_string_lossy().to_string();
        let sev = match f["severity"].as_str().unwrap_or("warning") { "error" | "critical" => "severe", _ => "minor" };
        Some(Finding { rule: format!("impeccable:{}", f["antipattern"].as_str().unwrap_or("rule")), severity: sev.into(),
            text: format!("{} — {}", f["name"].as_str().unwrap_or(""), f["description"].as_str().unwrap_or("")).trim_matches([' ', '—']).to_string(),
            frame: stem(&base), file: format!("frames/{base}"), line: f["line"].as_u64().map(|l| l as u32), selector: None })
    }).collect())
}

pub fn from_audit(frame_id: &str, file: &str, json: &str) -> Vec<Finding> {
    let Ok(arr) = serde_json::from_str::<Vec<Value>>(json) else { return vec![] };
    arr.iter().filter_map(|f| Some(Finding { rule: format!("audit:{}", f["rule"].as_str()?), severity: if f["severity"] == "severe" { "severe" } else { "minor" }.into(),
        text: f["text"].as_str()?.to_string(), frame: frame_id.into(), file: file.into(), line: None, selector: f["selector"].as_str().map(String::from) })).collect()
}

pub fn report(version: Option<u32>, at: &str, detector: Result<Vec<Finding>, String>, audits: Vec<Finding>) -> LintReport {
    let (ran, problem, mut all) = match detector { Ok(v) => (true, None, v), Err(e) => (false, Some(e), vec![]) };
    all.extend(audits);
    all.sort_by(|a, b| (a.frame.as_str(), a.rule.as_str()).cmp(&(b.frame.as_str(), b.rule.as_str())));
    let (severe, minor): (Vec<_>, Vec<_>) = all.into_iter().partition(|f| f.severity == "severe");
    LintReport { v: 1, version, at: at.into(), ran, problem, severe, minor }
}

fn lint_dir(design_dir: &Path) -> PathBuf { design_dir.join(".review/lint") }
pub fn write_report(design_dir: &Path, name: &str, r: &LintReport) -> Result<PathBuf, String> {
    let dir = lint_dir(design_dir); std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(format!("{name}.json")); let tmp = dir.join(format!("{name}.json.tmp"));
    std::fs::write(&tmp, serde_json::to_string_pretty(r).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
    Ok(path)
}
pub fn read_report(design_dir: &Path, name: &str) -> Option<LintReport> {
    serde_json::from_str(&std::fs::read_to_string(lint_dir(design_dir).join(format!("{name}.json"))).ok()?).ok()
}
```

`versions.rs`: add the three optional fields to `VersionMeta` and

```rust
pub fn mark(design_dir: &Path, n: u32, lint: Option<crate::designs::lint::LintCounts>, score: Option<f64>, round: Option<u32>) -> Result<(), String> {
    let p = versions_dir(design_dir).join(format!("v{n}")).join("meta.json");
    let mut m: VersionMeta = serde_json::from_str(&std::fs::read_to_string(&p).map_err(|_| format!("there's no version {n}"))?).map_err(|e| e.to_string())?;
    if lint.is_some() { m.lint = lint; } if score.is_some() { m.score = score; } if round.is_some() { m.round = round; }
    std::fs::write(&p, serde_json::to_string_pretty(&m).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}
```

(`VersionMeta` derives `Deserialize` already because `list` reads it; confirm, else add it.) Also `content_hash` and `copy_content` must keep ignoring `.review/` — they skip dot-leading names already (check `files_under`); add `.review` to the test `a_symlink_in_frames_is_excluded…`'s neighbourhood if needed.

- [ ] **Step 4: Run to verify they pass**

Run: `cd src-tauri && cargo test lint::tests versions`
Expected: PASS (the detector test may print "skipped" only on a Mac with no Node).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/designs/lint.rs src-tauri/src/designs/mod.rs src-tauri/src/designs/versions.rs
git commit -m "feat(design): the lint gate has a model, runs impeccable's detector, and marks versions"
```

---

### Task 6: The capture window evaluates the audit; review, capture and lint commands

**Files:**
- Modify: `src-tauri/src/designs/thumbs.rs` (`render_frame`, `render_version`, new commands), `src-tauri/src/main.rs` (`generate_handler!`)
- Modify: `src/lib/ipc.ts` (wrappers)

**Interfaces:**
- Produces:
  - `pub struct Capture { pub png: Vec<u8>, pub audit: Vec<crate::designs::lint::Finding> }`; `fn render_frame(app, hash, url, frame_id, file, width, height, kind) -> Result<Capture, String>` — after the ready wait and resize, evaluates `window.__chronicleAudit({kind, width, fold: height})` via `WKWebView::evaluateJavaScript_completionHandler` (a `block2::RcBlock<dyn Fn(*mut AnyObject, *mut NSError)>`; the result is an `NSString`), 5 s timeout; a failed evaluation yields an empty `audit` and a log line, never an error (the picture still matters).
  - `fn render_version(...) -> Result<(Vec<String>, Vec<Finding>), String>` — thumbs written as before, plus every frame's audit findings.
  - `#[tauri::command] pub async fn design_review_version(app, roots, web, dir, slug, n) -> Result<Value, String>` → `{ "thumbs": [..], "lint": LintReport }`: renders (thumbs + audits), runs the detector on `<version>/frames` when `setup::design_plugin_dir()` and `setup::resolve("node")` exist (otherwise `report(.., Err(<sentence>), ..)`), writes `.review/lint/v<n>.json`, marks the version's `lint` counts.
  - `#[tauri::command] pub async fn design_capture(app, roots, web, dir, slug, frame: Option<String>) -> Result<Vec<String>, String>` — renders the **current** files of one frame or all (URL `chronicle-file://<hash>/<slug>/<file>`) into `<slug>/.review/captures/<frame id>.png`; returns absolute paths.
  - `#[tauri::command] pub async fn design_lint_current(app, roots, web, dir, slug) -> Result<Value, String>` → a `LintReport` (`version: null`) over the current files, written as `.review/lint/current.json`.
  - ipc: `designReviewVersion(dir, slug, n) => invoke<{ thumbs: string[]; lint: LintReport }>("design_review_version", …)`, `designCapture(dir, slug, frame?)`, `designLintCurrent(dir, slug)`. `LintReport`/`Finding` TS types come from Task 10; until then declare them in `ipc.ts` as `unknown` and switch the import in Task 10.

- [ ] **Step 1: Write the failing tests** (pure parts only; the window itself is the live check)

```rust
#[test]
fn the_audit_call_names_the_kind_width_and_fold() {
    assert_eq!(audit_call("ecommerce", 390, 844), r#"window.__chronicleAudit&&window.__chronicleAudit({"kind":"ecommerce","width":390,"fold":844})"#);
    // a kind that isn't one of ours still produces valid JS (the audit falls back to "app")
    assert!(audit_call("x\"y", 1, 1).contains("x\\\"y"));
}
#[test]
fn current_frames_are_read_from_design_json_with_the_same_safety_rules() {
    let d = std::env::temp_dir().join(format!("chronicle-thumbs-cur-{}", std::process::id()));
    std::fs::create_dir_all(&d).unwrap();
    std::fs::write(d.join("design.json"), r#"{"kind":"ecommerce","frames":[{"id":"desktop","file":"frames/desktop.html","width":1440,"height":900},{"id":"../x","file":"frames/a.html","width":10}]}"#).unwrap();
    assert_eq!(thumb_frames(&d), vec![("desktop".to_string(), "frames/desktop.html".to_string(), 1440, 900)]);
    assert_eq!(design_kind(&d), "ecommerce");
    std::fs::write(d.join("design.json"), r#"{"frames":[]}"#).unwrap();
    assert_eq!(design_kind(&d), "app");
}
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd src-tauri && cargo test the_audit_call_names current_frames_are_read`
Expected: compile errors.

- [ ] **Step 3: Implement**

```rust
pub fn audit_call(kind: &str, width: u32, fold: u32) -> String {
    format!("window.__chronicleAudit&&window.__chronicleAudit({})", serde_json::json!({ "kind": kind, "width": width, "fold": fold }))
}
pub fn design_kind(dir: &Path) -> String {
    std::fs::read_to_string(dir.join("design.json")).ok().and_then(|t| serde_json::from_str::<Value>(&t).ok())
        .and_then(|v| v["kind"].as_str().map(String::from)).unwrap_or_else(|| "app".into())
}

fn evaluate(win: &tauri::WebviewWindow, js: &str) -> Result<String, String> {
    use block2::RcBlock; use objc2::runtime::AnyObject; use objc2_foundation::{NSError, NSString};
    let (tx, rx) = mpsc::channel::<Result<String, String>>();
    let js = js.to_string();
    win.with_webview(move |pw| {
        let wk: &objc2_web_kit::WKWebView = unsafe { &*(pw.inner() as *const objc2_web_kit::WKWebView) };
        let block = RcBlock::new(move |result: *mut AnyObject, err: *mut NSError| {
            let out = if !err.is_null() { Err("the audit couldn't run in the page".to_string()) }
                else if result.is_null() { Ok(String::new()) }
                else { let s: &NSString = unsafe { &*(result as *const NSString) }; Ok(s.to_string()) };
            let _ = tx.send(out);
        });
        unsafe { wk.evaluateJavaScript_completionHandler(&NSString::from_str(&js), Some(&block)) };
    }).map_err(|e| e.to_string())?;
    rx.recv_timeout(Duration::from_secs(5)).map_err(|_| "the audit timed out".to_string())?
}
```

`render_frame` gains `frame_id: &str, file: &str, kind: &str` and, after the `set_size` + 150 ms sleep, runs `let audit = evaluate(win, &audit_call(kind, width, page_h.max(height))).map(|s| crate::designs::lint::from_audit(frame_id, file, &s)).unwrap_or_default();` then `Ok(Capture { png: snapshot_png(win, snap_w)?, audit })`. `render_version` takes `kind: &str`, collects `audit` per frame and returns `(written, findings)`. `design_thumbnails` keeps its signature (drops the findings). New commands:

```rust
#[tauri::command]
pub async fn design_review_version(app: tauri::AppHandle, roots: State<'_, OpenRoots>, web: State<'_, crate::web::WebState>, dir: String, slug: String, n: u32) -> Result<Value, String> {
    let p = project_for(&roots, &dir)?;
    let design = super::design_dir(&p.dir, &slug)?;
    let vdir = design.join(".versions").join(format!("v{n}"));
    if !vdir.is_dir() { return Err("that version isn't here any more".into()); }
    let designs_dir = super::ensure_root(&p.dir)?;
    let hash = crate::web::register_design_root(&web, &designs_dir)?;
    let frames = thumb_frames(&vdir); let kind = design_kind(&vdir);
    let (thumbs, audits) = if frames.is_empty() { (vec![], vec![]) } else {
        let (a, h, s, v) = (app.clone(), hash.clone(), slug.clone(), vdir.clone());
        tauri::async_runtime::spawn_blocking(move || render_version(&a, &h, &s, n, &v, frames, &kind)).await.map_err(|e| e.to_string())??
    };
    let detector = match (crate::setup::design_plugin_dir(), crate::setup::resolve("node")) {
        (Some(plugin), Some(node)) => { let f = vdir.join("frames"); tauri::async_runtime::spawn_blocking(move || super::lint::run_detector(Path::new(&node), &super::lint::detector_script(&plugin), &f)).await.map_err(|e| e.to_string())? }
        (None, _) => Err("The design skills aren't bundled with this build".into()),
        (_, None) => Err("The anti-pattern check needs the engine from Setup & health".into()),
    };
    let report = super::lint::report(Some(n), &super::now_iso(), detector, audits);
    super::lint::write_report(&design, &format!("v{n}"), &report)?;
    super::versions::mark(&design, n, Some(report.counts()), None, None)?;
    Ok(json!({ "thumbs": thumbs, "lint": report }))
}
```

(`super::now_iso` is private in `mod.rs`; make it `pub(crate)`.) `design_capture` and `design_lint_current` follow the same shape over `design` (current files): URLs `chronicle-file://{hash}/{slug}/{file}`, output dir `design.join(".review/captures")`, and for lint the detector over `design.join("frames")` with `write_report(&design, "current", …)`. `setup::design_plugin_dir()` is Task 8's; for this task add a stub in `setup.rs`: `pub fn design_plugin_dir() -> Option<PathBuf> { resource_dir().map(|r| crate::designs::plugin::plugin_dir(&r)).filter(|p| p.is_dir()) }` with `static RESOURCE_DIR: OnceLock<PathBuf>`, `pub fn set_resource_dir(p: PathBuf)`, `pub fn resource_dir() -> Option<PathBuf>`; call `setup::set_resource_dir(app.path().resource_dir()?)` in main's `.setup(|app| …)` hook. Register the three commands. ipc wrappers as in Interfaces.

- [ ] **Step 4: Run to verify they pass**

Run: `cd src-tauri && cargo test thumbs::tests && cargo build`
Expected: PASS; the crate builds (the objc2 call compiles; `WKWebView` feature list in `Cargo.toml` already includes `WKWebView`).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/designs/thumbs.rs src-tauri/src/designs/mod.rs src-tauri/src/setup.rs src-tauri/src/main.rs src/lib/ipc.ts
git commit -m "feat(design): every version is captured, audited and linted at turn end, and the director can ask for a capture or a lint mid-turn"
```

---

### Task 7: Review settings, state, answers, critique rounds and reminders (Rust)

**Files:**
- Create: `src-tauri/src/designs/review.rs`
- Modify: `src-tauri/src/designs/mod.rs` (`pub mod review;`), `src-tauri/src/main.rs` (commands), `src/lib/ipc.ts`

**Interfaces:**
- Produces (`designs::review`):
  - `#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)] pub struct ReviewSettings { pub critique: bool, pub bar: f64, pub rounds: u32, pub lint: bool }` with `Default` = `{ true, 8.0, 3, true }`; `pub fn clamp(self) -> Self` (bar to 5.0–9.5 on the half, rounds 1–5).
  - `#[derive(Serialize, Deserialize, Clone, Debug, Default)] pub struct SettingsPatch { pub critique: Option<bool>, pub bar: Option<f64>, pub rounds: Option<u32>, pub lint: Option<bool> }`.
  - `pub fn project_settings(root: &Path) -> ReviewSettings` (`root/review.json`, defaults on missing or bad), `pub fn design_patch(design_dir: &Path) -> SettingsPatch` (`.review/settings.json`), `pub fn effective(root, design_dir) -> ReviewSettings`, `pub fn set_project(root, patch) -> Result<ReviewSettings>`, `pub fn set_design(design_dir, patch) -> Result<SettingsPatch>` (a `None` in the patch leaves the key; the file stores only the keys ever set).
  - `pub fn read_state(design_dir) -> Option<Value>`, `pub fn write_state(design_dir, state: &Value) -> Result<()>` — `.review/state.json`, at most 64 KB, atomic.
  - `pub fn answer_questions(design_dir, answers: &Value, skipped: bool) -> Result<Value, String>` — reads `questions.json`, sets `answers` (object) or `skipped: true`, writes it back atomically, returns the whole file; errors when the file is missing.
  - `pub fn read_critique(design_dir, round: u32) -> Result<Value, String>` — reads `critique/round-<round>.json`, requires `reviewers` array; recomputes `weighted` from the four scores with the weights (a missing reviewer scores 0 and is reported in `missing: [..]`), sets `passed = weighted >= bar` where `bar` is the file's number or the effective bar passed in — signature `read_critique(design_dir, round, bar: f64)`; returns the normalised object.
  - `pub const WEIGHTS: [(&str, f64); 4] = [("ux", 0.35), ("art", 0.30), ("a11y", 0.20), ("copy", 0.15)]; pub fn weighted(scores: &[(String, f64)]) -> (f64, Vec<String>)`.
  - `pub fn reminders(root) -> Vec<Value>` / `pub fn set_reminders(root, list: &[Value]) -> Result<()>` — `.reminders.json` at the designs root.
  - `pub fn read_design_file(design_dir, rel: &str) -> Result<Option<String>, String>` — a non-dot relative path inside the design (`questions.json`, `tokens.json`, `critique/round-2.json`), ≤ 512 KB, `None` when absent, error on a dot component or `..`.
- Commands (`main.rs`, all `roots: State<OpenRoots>`): `design_review_settings(dir, slug: Option<String>) -> { project, design: SettingsPatch|null, effective }`, `design_review_settings_set(dir, scope: String /* "project"|"design" */, slug: Option<String>, patch: SettingsPatch)`, `design_review_state(dir, slug) -> Value|null`, `design_review_state_set(dir, slug, state: Value)`, `design_questions_answer(dir, slug, answers: Value, skipped: bool) -> Value`, `design_critique_read(dir, slug, round: u32) -> Value`, `design_reminders(dir) -> Vec<Value>`, `design_reminders_set(dir, list: Vec<Value>)`, `design_file_read(dir, slug, rel) -> Option<String>`, `design_version_mark(dir, slug, n, score: Option<f64>, round: Option<u32>)`.
- ipc wrappers with the same names in camelCase (`designReviewSettings`, `designReviewSettingsSet`, `designReviewState`, `designReviewStateSet`, `designQuestionsAnswer`, `designCritiqueRead`, `designReminders`, `designRemindersSet`, `designFileRead`, `designVersionMark`).

- [ ] **Step 1: Write the failing tests** (in `review.rs`)

```rust
#[cfg(test)]
mod tests {
    use super::*; use serde_json::json;
    fn tmp(n: &str) -> PathBuf { let d = std::env::temp_dir().join(format!("chronicle-review-{n}-{}", std::process::id())); let _ = std::fs::remove_dir_all(&d); std::fs::create_dir_all(&d).unwrap(); d }
    #[test]
    fn settings_layer_project_defaults_under_design_overrides_and_clamp() {
        let root = tmp("settings"); let d = root.join("home"); std::fs::create_dir_all(&d).unwrap();
        assert_eq!(effective(&root, &d), ReviewSettings::default());
        set_project(&root, SettingsPatch { bar: Some(9.75), rounds: Some(9), ..Default::default() }).unwrap();
        assert_eq!(effective(&root, &d), ReviewSettings { critique: true, bar: 9.5, rounds: 5, lint: true });
        set_design(&d, SettingsPatch { critique: Some(false), ..Default::default() }).unwrap();
        assert_eq!(effective(&root, &d).critique, false);
        assert_eq!(effective(&root, &d).bar, 9.5, "unset keys fall through to the project");
        set_design(&d, SettingsPatch { bar: Some(7.25), ..Default::default() }).unwrap();
        assert_eq!(effective(&root, &d).bar, 7.0, "bars land on the half");
        assert_eq!(design_patch(&d).critique, Some(false), "earlier keys survive a later patch");
        std::fs::write(root.join("review.json"), "{nope").unwrap();
        assert_eq!(project_settings(&root), ReviewSettings::default(), "a bad file reads as defaults");
    }
    #[test]
    fn answers_land_in_the_directors_file_and_the_critique_is_recomputed() {
        let d = tmp("answers");
        assert!(answer_questions(&d, &json!({}), false).is_err());
        std::fs::write(d.join("questions.json"), r#"{"v":1,"questions":[{"id":"who","label":"Who?","type":"single","options":["a","b"]}],"references":true}"#).unwrap();
        let f = answer_questions(&d, &json!({ "who": "a", "references": ["refs/site.png"] }), false).unwrap();
        assert_eq!(f["answers"]["who"], "a"); assert_eq!(f["questions"][0]["id"], "who");
        let f2 = answer_questions(&d, &json!({}), true).unwrap(); assert_eq!(f2["skipped"], true);
        std::fs::create_dir_all(d.join("critique")).unwrap();
        std::fs::write(d.join("critique/round-1.json"), r#"{"v":1,"round":1,"version":4,"weighted":9.9,"passed":true,"reviewers":[{"id":"ux","score":6,"notes":[],"findings":[]},{"id":"art","score":8},{"id":"a11y","score":9},{"id":"copy","score":7}]}"#).unwrap();
        let c = read_critique(&d, 1, 8.0).unwrap();
        assert!((c["weighted"].as_f64().unwrap() - 7.35).abs() < 1e-9); assert_eq!(c["passed"], false); assert_eq!(c["bar"], 8.0);
        std::fs::write(d.join("critique/round-2.json"), r#"{"v":1,"round":2,"reviewers":[{"id":"ux","score":9},{"id":"art","score":9}]}"#).unwrap();
        let c2 = read_critique(&d, 2, 8.0).unwrap();
        assert_eq!(c2["missing"], json!(["a11y", "copy"])); assert!((c2["weighted"].as_f64().unwrap() - 5.85).abs() < 1e-9);
        assert!(read_critique(&d, 3, 8.0).is_err());
    }
    #[test]
    fn state_reminders_and_design_files_are_jailed_and_bounded() {
        let root = tmp("state"); let d = root.join("home"); std::fs::create_dir_all(d.join("critique")).unwrap();
        assert!(read_state(&d).is_none());
        write_state(&d, &json!({ "phase": "gate", "round": 1 })).unwrap();
        assert_eq!(read_state(&d).unwrap()["phase"], "gate");
        assert!(write_state(&d, &json!({ "big": "x".repeat(70_000) })).is_err());
        set_reminders(&root, &[json!({ "slug": "home", "at": 1 })]).unwrap();
        assert_eq!(reminders(&root).len(), 1);
        std::fs::write(d.join("tokens.json"), "{}").unwrap();
        assert_eq!(read_design_file(&d, "tokens.json").unwrap().as_deref(), Some("{}"));
        assert_eq!(read_design_file(&d, "critique/round-9.json").unwrap(), None);
        assert!(read_design_file(&d, ".review/state.json").is_err());
        assert!(read_design_file(&d, "../other/tokens.json").is_err());
    }
}
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd src-tauri && cargo test review::tests`
Expected: compile error (module missing).

- [ ] **Step 3: Implement** — the functions as specified; the JSON helpers: `read_json(path) -> Option<Value>` (bad JSON → `None`), `write_json_atomic(path, &Value)` (tmp + rename, parent dirs created). `effective`: start from `project_settings(root)`, apply `design_patch` keys, `clamp()`. `clamp`: `bar = ((bar * 2.0).round() / 2.0).clamp(5.0, 9.5)`, `rounds.clamp(1, 5)`. `weighted`: `sum(score.clamp(0,10) * w)` over `WEIGHTS`, missing ids collected. `read_critique` returns the file's object with `weighted`, `passed`, `bar`, `missing` set, and `round` forced to the requested number. Commands are thin wrappers over `project_for` + `designs::design_dir` + `designs::designs_root`. Register them all.

- [ ] **Step 4: Run to verify they pass**

Run: `cd src-tauri && cargo test review::tests && cargo build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/designs/review.rs src-tauri/src/designs/mod.rs src-tauri/src/main.rs src/lib/ipc.ts
git commit -m "feat(design): review settings, loop state, answers, critique rounds and reminders live on disk"
```

---

### Task 8: Setup & health rows for the browser and the design skills; the design lane gets its extras

**Files:**
- Modify: `src-tauri/src/setup.rs` (`CHECKS`, `detect`, `install`, `run_all`, new `install_design_browser`, `browsers_dir`, `browser_ready`, `design_plugin_dir`)
- Modify: `src-tauri/src/main.rs` (`agent_session_start`/`agent_session_resume` build `LaneExtras` for the design lane)

**Interfaces:**
- Produces (`setup`):
  - `CHECKS` gains `"design_browser"`, `"design_skills"` (after `superpowers`); `status()` still counts only the first six as `total` — add `pub const REQUIRED: usize = 6;` and use it.
  - `pub fn browsers_dir() -> PathBuf` → `tools_dir().join("browsers")`; `pub fn browser_ready() -> bool` → some `chromium-*/` directory under `browsers_dir()` holds `chrome-mac*/Chromium.app` (Playwright's layout) — implemented as "a directory named `chromium-<digits>` containing at least one `.app`".
  - `detect("design_browser")` → `blocked "Install the engine first."` without Node; `ready` with detail `"chromium · <dir name>"`; else `missing` with action `install`. `detect("design_skills")` → `ready` with `plugin::intact`'s detail, or `couldnt_finish`-style `missing` with the error as `detail` and no action (it ships with the app).
  - `install("design_browser")`: `npx --yes -- playwright@<PLAYWRIGHT> install chromium` with `PLAYWRIGHT_BROWSERS_PATH=browsers_dir()` and `PATH=tool_env_path()`, stdout+stderr read line by line; a line matching `(\d+)% of (\d+(?:\.\d+)?) MiB` emits `{ state: "installing", pct, gotBytes, totalBytes }`; cancel kills the child (`kill -TERM` the process group, as `init_cancel` does) and returns `Err("cancelled")`.
  - `run_all` skips both design rows.
- Produces (`main.rs`): in both design-lane start paths,
  ```rust
  let extras = if lane == acp::Lane::Design {
      let browsers = if setup::browser_ready() { Some(setup::browsers_dir()) } else { None };
      let exe = std::env::current_exe().map_err(|e| e.to_string())?;
      acp::LaneExtras { mcp_servers: designs::plugin::servers(&p.dir, &npx, browsers.as_deref(), &exe), plugin_dir: setup::design_plugin_dir() }
  } else { acp::LaneExtras::default() };
  ```

- [ ] **Step 1: Write the failing tests** (in `setup.rs`'s test module)

```rust
#[test]
fn the_design_rows_detect_from_disk_and_never_join_the_required_count() {
    assert_eq!(REQUIRED, 6);
    assert!(CHECKS.contains(&"design_browser") && CHECKS.contains(&"design_skills"));
    let s = status();
    assert_eq!(s["total"], 6);
    assert_eq!(s["checks"].as_array().unwrap().len(), 8);
    let b = detect("design_browser");
    assert!(["ready", "missing", "blocked"].contains(&b["state"].as_str().unwrap()));
    if b["state"] == "missing" { assert_eq!(b["action"], "install"); }
    let k = detect("design_skills");
    assert_eq!(k["action"], "", "the skills ship with the app: nothing to install");
}
#[test]
fn install_progress_lines_are_parsed() {
    let (pct, got, total) = parse_install_progress("|■■■■      | 40% of 164.3 MiB").unwrap();
    assert_eq!(pct, 40);
    assert_eq!(total, (164.3_f64 * 1_048_576.0) as u64);
    assert_eq!(got, total * 40 / 100);
    assert_eq!(parse_install_progress("Downloading Chromium 131.0.6778.33 (playwright build v1148)"), None);
}
#[test]
fn browser_ready_reads_playwrights_layout() {
    let d = std::env::temp_dir().join(format!("chronicle-browsers-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    assert!(!browser_ready_in(&d));
    std::fs::create_dir_all(d.join("chromium-1148/chrome-mac-arm64/Chromium.app")).unwrap();
    assert!(browser_ready_in(&d));
}
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd src-tauri && cargo test the_design_rows_detect install_progress_lines browser_ready_reads`
Expected: compile errors.

- [ ] **Step 3: Implement** — `parse_install_progress(line) -> Option<(u64, u64, u64)>` with a `regex::Regex` (`regex` is a dependency); `browser_ready_in(dir)` + `browser_ready()`; `install_design_browser(emit, cancel)` spawning `npx` through `std::process::Command` with `.process_group(0)` and a reader thread over merged output (use `Stdio::piped()` on both and a `std::thread::scope`), polling `cancel` every 200 ms; on `Ok` it emits done. `emit_state(emit, "design_browser", json!({ "state": "installing", "pct": Value::Null }))` first. Detection strings per Interfaces. Wire `LaneExtras` in `main.rs` as shown.

- [ ] **Step 4: Run to verify they pass**

Run: `cd src-tauri && cargo test setup && cargo test acp_tests`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/setup.rs src-tauri/src/main.rs
git commit -m "feat(design): Setup & health can download the review browser, and the design session starts with its tools"
```

---

### Task 9: `designs.capture`, `designs.lint` and `designs.bench` in the agent API, the CLI and the bridge; `bench.rs`

**Files:**
- Create: `src-tauri/src/designs/bench.rs`
- Modify: `src-tauri/src/agent_api.rs`, `src-tauri/src/cli.rs` (`GROUPS`, `INT_FLAGS` unchanged, tests), `src-tauri/src/bridge.rs` (`ACTIONS`, `verb_for`), `src-tauri/src/main.rs` (commands), `docs/agent-api.md`, `skill/chronicle/SKILL.md`
- Create: `bench/design/README.md`

**Interfaces:**
- Produces (`designs::bench`):
  - `#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)] pub struct Brief { pub id: String, pub kind: String, pub title: String, pub brief: String, pub answers: Vec<(String, String)>, pub quick: bool }`
  - `pub fn read_briefs(repo: &Path) -> Result<Vec<Brief>, String>` — every `bench/design/briefs/*.md`, front matter `id`, `kind`, `title`, `quick: true|false`, then a `## Brief` section and a `## Answers` section of `- <question id or label>: <answer>` lines. Sorted by id.
  - `pub fn bench_project(config_dir: &Path, stamp: &str) -> Result<PathBuf, String>` — creates `<config>/bench/<stamp>/` with `.chronicle/` and a minimal `chronicle.json` (`{ "name": "design-bench", "phases": [] }`), returns the canonical path.
  - `pub fn write_results(repo: &Path, name: &str, json: &Value, md: &str) -> Result<(PathBuf, PathBuf), String>` → `bench/design/results/<name>.json` and `.md`.
- Produces (`agent_api`): `chronicle.designs.capture { slug, frame? }` (bridge action `designs.capture`, verb "capture a design"), `chronicle.designs.lint { slug }` (`designs.lint`, "lint a design"), `chronicle.designs.bench { brief?, kind?, quick? }` (`designs.bench`, "run the design benchmark"). `bridge::ACTIONS` grows to 7.
- CLI: `chronicle designs capture --slug s [--frame f]`, `chronicle designs lint --slug s`, `chronicle designs bench [--brief id] [--kind k] [--quick]` — `--quick` is a bare flag: add `const BOOL_FLAGS: [&str; 1] = ["quick"]` to `cli.rs`'s parser (a bare flag sets `true`).
- Commands: `design_bench_briefs(dir) -> Vec<Brief>`, `design_bench_project() -> String`, `design_bench_write(dir, name, json, md) -> (String, String)`.

- [ ] **Step 1: Write the failing tests**

`bench.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn briefs_parse_front_matter_brief_and_answers() {
        let d = std::env::temp_dir().join(format!("chronicle-bench-{}", std::process::id())); let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(d.join("bench/design/briefs")).unwrap();
        std::fs::write(d.join("bench/design/briefs/ecommerce-1.md"), "---\nid: ecommerce-1\nkind: ecommerce\ntitle: Coffee product page\nquick: true\n---\n\n## Brief\n\nA product page for a coffee roaster.\nMostly phone.\n\n## Answers\n\n- who: Gift buyers\n- feel: Quiet and exact\n").unwrap();
        std::fs::write(d.join("bench/design/briefs/app-1.md"), "---\nid: app-1\nkind: app\ntitle: Settings\nquick: false\n---\n\n## Brief\n\nA settings screen.\n").unwrap();
        let b = read_briefs(&d).unwrap();
        assert_eq!(b.len(), 2); assert_eq!(b[0].id, "app-1"); assert_eq!(b[1].kind, "ecommerce");
        assert_eq!(b[1].brief, "A product page for a coffee roaster.\nMostly phone.");
        assert_eq!(b[1].answers, vec![("who".to_string(), "Gift buyers".to_string()), ("feel".to_string(), "Quiet and exact".to_string())]);
        assert!(b[1].quick && !b[0].quick);
        std::fs::write(d.join("bench/design/briefs/bad.md"), "no front matter").unwrap();
        assert!(read_briefs(&d).unwrap_err().contains("bad.md"));
    }
    #[test]
    fn a_bench_project_is_a_chronicle_project_under_the_config_dir_and_results_land_in_the_repo() {
        let cfg = std::env::temp_dir().join(format!("chronicle-benchcfg-{}", std::process::id()));
        let p = bench_project(&cfg, "2026-10-01T10-00-00").unwrap();
        assert!(p.starts_with(cfg.canonicalize().unwrap())); assert!(p.join(".chronicle").is_dir() && p.join("chronicle.json").is_file());
        let repo = std::env::temp_dir().join(format!("chronicle-benchrepo-{}", std::process::id()));
        let (j, m) = write_results(&repo, "0.12.0-2026-10-01", &serde_json::json!({ "briefs": [] }), "# Results\n").unwrap();
        assert!(j.ends_with("bench/design/results/0.12.0-2026-10-01.json") && m.exists());
    }
}
```

`cli.rs` (append): `parse(&a("designs bench --quick --kind app"))` → name `chronicle.designs.bench`, args `{"quick": true, "kind": "app"}`; `parse(&a("designs capture --slug home --frame desktop"))` → `{"slug":"home","frame":"desktop"}`. `bridge.rs`: `verb_for("designs.bench") == "run the design benchmark"` and `known_action("designs.capture")`. `agent_api.rs`: `catalog()` contains the three names.

- [ ] **Step 2: Run to verify they fail**

Run: `cd src-tauri && cargo test bench::tests cli bridge agent_api`
Expected: compile errors / assertion failures on the new names.

- [ ] **Step 3: Implement** — `bench.rs` as specified (front matter = lines between the first two `---`; sections by `## ` headings; answers = lines starting with `- ` split at the first `: `). In `agent_api.rs`, three `Capability` entries with `run: |dir, a| action(dir, "designs.capture", a.clone(), "capture a design")` etc. (the existing `action` helper). `bridge.rs`: `ACTIONS: [&str; 7]` and the verbs. `cli.rs`: `GROUPS`'s designs verbs `["list", "read", "capture", "lint", "bench"]`, `BOOL_FLAGS`. `main.rs`: the three commands (`design_bench_project` uses `crate::config_dir()` and, for the stamp, `designs::now_iso()` with every `:` replaced by `-` — no new time crate; timestamps come from `SystemTime`, per the D7 ruling). Docs: three rows in `docs/agent-api.md`'s table and three lines in `skill/chronicle/SKILL.md` §4 plus the CLI line. `bench/design/README.md`: what the folder holds, how to place a Claude Design export under `reference/<brief id>/` (export → HTML → the folder; git-ignored), how to run `chronicle designs bench --quick` inside this repo with Chronicle open on it, and where results go.

- [ ] **Step 4: Run to verify they pass**

Run: `cd src-tauri && cargo test bench cli bridge agent_api`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/designs/bench.rs src-tauri/src/designs/mod.rs src-tauri/src/agent_api.rs src-tauri/src/cli.rs src-tauri/src/bridge.rs src-tauri/src/main.rs docs/agent-api.md skill/chronicle/SKILL.md bench/design/README.md
git commit -m "feat(design): agents can ask Chronicle to capture or lint a design, and the benchmark has a front door"
```

---

## Phase B · The frontend core

### Task 10: The review model — types, parsers, weights, state words

**Files:**
- Create: `src/lib/design-review-model.ts`, `src/lib/design-review-model.test.ts`
- Modify: `src/lib/ipc.ts` (switch the `LintReport`/`Finding` placeholders to imports from the model)

**Interfaces:**
- Produces:
  - `export const REVIEWERS = [ { id: "ux", name: "UX director", focus: "heuristics, task flow, the kind's rules", weight: 0.35 }, { id: "art", name: "Art director", focus: "craft, type, brand fit", weight: 0.3 }, { id: "a11y", name: "Accessibility", focus: "WCAG 2.2 AA, focus, targets", weight: 0.2 }, { id: "copy", name: "Copy", focus: "clarity, voice, no filler", weight: 0.15 } ] as const; export type ReviewerId = "ux" | "art" | "a11y" | "copy";`
  - `export interface ReviewSettings { critique: boolean; bar: number; rounds: number; lint: boolean }`, `export const DEFAULT_SETTINGS: ReviewSettings`, `export function clampSettings(s: ReviewSettings): ReviewSettings`, `export function parseSettings(raw: unknown): ReviewSettings` (missing → defaults, then clamp).
  - `export interface Question { id: string; label: string; hint: string; type: "single" | "multi" | "text"; options: string[]; max: number | null }`, `export interface Questions { questions: Question[]; references: boolean; answers: Record<string, string | string[]> | null; skipped: boolean }`, `export function parseQuestions(raw: unknown): Questions | null` — `null` when not an object or `questions` is not an array; drops questions without a string `id` and `label`, drops non-string options, drops duplicate ids (first wins), keeps at most five; `type` defaults to `"single"`, `"multi"` gets `max` from the file (a positive integer) or `null`; `answers` is kept when an object (values coerced: strings or string arrays, `references` array kept as-is under `answers.references`).
  - `export const questionsPending = (q: Questions | null) => !!q && q.questions.length > 0 && q.answers == null && !q.skipped;`
  - `export interface TokensPlan { colors: { name: string; value: string }[]; type: { role: string; family: string; weight: string; size: string; leading: string }[]; rejected: string[] }`, `export function parseTokens(raw: unknown): TokensPlan | null` (`null` when not an object; each list filtered to well-formed entries; `weight`/`size`/`leading` coerced to strings).
  - `export type Severity = "severe" | "minor"; export interface Finding { rule: string; severity: Severity; text: string; frame: string; file: string; line?: number; selector?: string }`, `export interface LintReport { v: 1; version: number | null; at: string; ran: boolean; problem: string | null; severe: Finding[]; minor: Finding[] }`, `export function parseLint(raw: unknown): LintReport | null`.
  - `export interface ReviewerResult { id: ReviewerId; score: number; notes: string[]; findings: Finding[] }`, `export interface CritiqueRound { round: number; version: number | null; at: string; bar: number; weighted: number; passed: boolean; reviewers: ReviewerResult[]; missing: ReviewerId[]; blocker: string | null }`, `export function weightedScore(scores: Partial<Record<ReviewerId, number>>): { weighted: number; missing: ReviewerId[] }` (scores clamped to 0–10, weighted sum rounded to 2 decimals), `export function parseCritique(raw: unknown, bar: number, round: number): CritiqueRound | null` — recomputes `weighted`, sets `passed = weighted >= bar`, ignores the file's own `weighted`/`passed`/`bar`, forces `round`; findings without a `frame` string are kept with `frame: ""`; a finding's `severity` other than `"severe"` reads as `"minor"`.
  - `export type ReviewPhase = "idle" | "building" | "questions" | "gate" | "fixing" | "critique" | "done" | "below-bar" | "stopped"; export type PromptKind = "brief" | "answers" | "user" | "lintFix" | "critique" | "critiqueFix" | "resolve" | "fixFinding" | "continue";`
  - `export interface ReviewState { v: 1; phase: ReviewPhase; round: number; fixPass: number; version: number | null; best: { round: number; score: number } | null; startedAt: number | null; lastPrompt: PromptKind | null; accepted: boolean }`, `export const initialReviewState = (): ReviewState`, `export function parseReviewState(raw: unknown): ReviewState` (unknown → initial; unknown phase → `"idle"`).
  - `export function stateWord(st: ReviewState, latestVersion: number | null, latestScore: number | null): { word: string; tone: "faint" | "neutral" | "success" | "warn" | "error" }` — questions → "draft"/faint; building → "working"/neutral; gate → "checking"/neutral; fixing → "fixing"/warn; critique → "in review"/neutral; done with a score → `ready · <score>`/success, done without → `v<n>`/faint; below-bar → "below the bar"/warn; stopped → `stopped · v<n>`/faint; idle → `v<n>` or "draft".
  - `export const fmtScore = (n: number) => n.toFixed(1);`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import { clampSettings, initialReviewState, parseCritique, parseLint, parseQuestions, parseReviewState, parseSettings, parseTokens, questionsPending, stateWord, weightedScore, DEFAULT_SETTINGS } from "./design-review-model";

describe("review settings", () => {
  it("defaults, clamps to the half and the ranges", () => {
    expect(parseSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings({ bar: 9.75, rounds: 9, critique: false })).toEqual({ critique: false, bar: 9.5, rounds: 5, lint: true });
    expect(clampSettings({ critique: true, bar: 7.25, rounds: 0, lint: true })).toEqual({ critique: true, bar: 7.0, rounds: 1, lint: true });
  });
});

describe("questions", () => {
  it("keeps at most five well-formed questions and drops duplicates", () => {
    const raw = { v: 1, references: true, questions: [
      { id: "who", label: "Who is buying?", hint: "shapes copy", type: "multi", options: ["Regulars", 3, "Gift buyers"], max: 2 },
      { id: "who", label: "dup" }, { label: "no id" }, { id: "feel", label: "How should it feel?", type: "weird" },
      { id: "q3", label: "3" }, { id: "q4", label: "4" }, { id: "q5", label: "5" }, { id: "q6", label: "6" },
    ] };
    const q = parseQuestions(raw)!;
    expect(q.questions.map((x) => x.id)).toEqual(["who", "feel", "q3", "q4", "q5"]);
    expect(q.questions[0]).toEqual({ id: "who", label: "Who is buying?", hint: "shapes copy", type: "multi", options: ["Regulars", "Gift buyers"], max: 2 });
    expect(q.questions[1].type).toBe("single");
    expect(q.references).toBe(true);
    expect(questionsPending(q)).toBe(true);
    expect(questionsPending(parseQuestions({ questions: [] }))).toBe(false);
    expect(questionsPending(parseQuestions({ questions: [{ id: "a", label: "A" }], answers: { a: "x" } }))).toBe(false);
    expect(questionsPending(parseQuestions({ questions: [{ id: "a", label: "A" }], skipped: true }))).toBe(false);
    expect(parseQuestions("nope")).toBeNull();
    expect(parseQuestions({ questions: "nope" })).toBeNull();
  });
});

describe("tokens, lint", () => {
  it("parses a token plan and a lint report and rejects junk", () => {
    const t = parseTokens({ colors: [{ name: "ink", value: "#1a1a1a" }, { name: 3 }], type: [{ role: "display", family: "Bricolage Grotesque", weight: 700, size: 22, leading: 1.1 }], rejected: ["cream + serif"] })!;
    expect(t.colors).toEqual([{ name: "ink", value: "#1a1a1a" }]);
    expect(t.type[0]).toEqual({ role: "display", family: "Bricolage Grotesque", weight: "700", size: "22", leading: "1.1" });
    expect(parseTokens(null)).toBeNull();
    const l = parseLint({ v: 1, version: 3, at: "t", ran: false, problem: "no node", severe: [{ rule: "audit:overflow", severity: "severe", text: "wide", frame: "m", file: "frames/m.html" }], minor: [] })!;
    expect(l.ran).toBe(false); expect(l.problem).toBe("no node"); expect(l.severe).toHaveLength(1);
    expect(parseLint({})).toBeNull();
  });
});

describe("critique", () => {
  it("recomputes the weighted score and ignores the file's verdict", () => {
    const { weighted, missing } = weightedScore({ ux: 6, art: 8, a11y: 9, copy: 7 });
    expect(weighted).toBeCloseTo(7.35, 2); expect(missing).toEqual([]);
    expect(weightedScore({ ux: 12, art: -1 })).toEqual({ weighted: 3.5, missing: ["a11y", "copy"] });
    const c = parseCritique({ round: 9, version: 4, weighted: 9.9, passed: true, bar: 1, reviewers: [
      { id: "ux", score: 6, notes: ["n"], findings: [{ severity: "bad", text: "x", frame: "desktop", selector: ".p" }] },
      { id: "art", score: 8 }, { id: "a11y", score: 9 }, { id: "copy", score: 7 } ], blocker: null }, 8.0, 2)!;
    expect(c.round).toBe(2); expect(c.bar).toBe(8); expect(c.weighted).toBeCloseTo(7.35, 2); expect(c.passed).toBe(false);
    expect(c.reviewers[0].findings[0]).toEqual({ rule: "critique:ux", severity: "minor", text: "x", frame: "desktop", file: "", selector: ".p" });
    expect(parseCritique({ reviewers: "x" }, 8, 1)).toBeNull();
    const pass = parseCritique({ reviewers: [{ id: "ux", score: 8.5 }, { id: "art", score: 8 }, { id: "a11y", score: 8 }, { id: "copy", score: 8 }] }, 8.0, 1)!;
    expect(pass.weighted).toBeCloseTo(8.18, 2); expect(pass.passed).toBe(true);
  });
});

describe("state", () => {
  it("parses, defaults and words each phase", () => {
    expect(parseReviewState(undefined)).toEqual(initialReviewState());
    expect(parseReviewState({ v: 1, phase: "nonsense", round: 2 }).phase).toBe("idle");
    const s = (phase: ReturnType<typeof initialReviewState>["phase"]) => ({ ...initialReviewState(), phase });
    expect(stateWord(s("questions"), null, null)).toEqual({ word: "draft", tone: "faint" });
    expect(stateWord(s("building"), 2, null).word).toBe("working");
    expect(stateWord(s("gate"), 2, null).word).toBe("checking");
    expect(stateWord(s("fixing"), 2, null)).toEqual({ word: "fixing", tone: "warn" });
    expect(stateWord(s("critique"), 2, null).word).toBe("in review");
    expect(stateWord(s("done"), 6, 8.4)).toEqual({ word: "ready · 8.4", tone: "success" });
    expect(stateWord(s("done"), 6, null)).toEqual({ word: "v6", tone: "faint" });
    expect(stateWord(s("below-bar"), 6, 7.7)).toEqual({ word: "below the bar", tone: "warn" });
    expect(stateWord(s("stopped"), 5, null)).toEqual({ word: "stopped · v5", tone: "faint" });
    expect(stateWord(s("idle"), null, null)).toEqual({ word: "draft", tone: "faint" });
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/lib/design-review-model.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement** — plain functions over `Record<string, unknown>` with the same `num`/`str` coercion style `design-model.ts` uses. `weightedScore`: `Math.round(sum * 100) / 100`. `parseCritique` maps `reviewers` entries whose `id` is a known `ReviewerId` and whose `score` is a finite number; a finding becomes `{ rule: "critique:<id>", severity, text, frame: str(frame) || "", file: "", selector? }`.

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run src/lib/design-review-model.test.ts && npx tsc --noEmit -p .`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/design-review-model.ts src/lib/design-review-model.test.ts src/lib/ipc.ts
git commit -m "feat(design): the review's files have one model, and the score is always recomputed"
```

---

### Task 11: Every prompt the loop sends

**Files:**
- Create: `src/lib/design-prompts.ts`, `src/lib/design-prompts.test.ts`

**Interfaces:**
- Produces (every function returns the message body; the design prefix is added by the store):
  - `answersMessage(q: Questions, answers: Record<string, string | string[]>, references: string[]): string` — "Answers to your questions:" then one line per question `- <label>: <answer or answers joined with ", ">` (unanswered → "(no answer)"), then, when references exist, "References, in this design's refs/ folder:" and one path per line, then "Go ahead."
  - `skipMessage(): string` → "Skip the questions. Decide, and say what you assumed."
  - `lintFixPrompt(report: LintReport, pass: number, maxPasses: number): string` — "Lint fix pass <pass> of <max>. Fix these and change nothing else:" then one line per severe finding `- <frame> · <file>[:<line>][ · <selector>] — <text>`; ends "Say what you changed in one sentence."
  - `critiquePrompt(round: number, maxRounds: number, bar: number, version: number | null, captures: string[]): string` — tells the director to run the four reviewers in parallel as subagents named exactly `art-director`, `ux-director`, `accessibility`, `copy` (the bundled agents), giving each only the frame files, the listed captures, the brief and answers, the kind, `tokens.json` and the design system if any, never its own reasoning; to write `critique/round-<round>.json` with the exact shape (quoted in the prompt: `{"v":1,"round":<round>,"version":<version>,"reviewers":[{"id":"ux"|"art"|"a11y"|"copy","score":<0-10>,"notes":["…"],"findings":[{"severity":"severe"|"minor","text":"…","frame":"<frame id>","selector":"<css>"}]}],"blocker":null|"<one sentence>"}`); to set `blocker` only when a finding repeats from the previous round and traces to the brief; to change no other file; and to end with one sentence. Names the bar and "round <round> of <maxRounds>".
  - `critiqueFixPrompt(c: CritiqueRound, maxFindings = 8): string` — "Round <n> scored <weighted> against <bar>. Fix these, most important first, and change nothing else:" then up to `maxFindings` findings, severe first, `- <reviewer name> · <frame>[ · <selector>] — <text>`; ends with the one-sentence rule.
  - `resolveBlockerPrompt(blocker: string): string` — "The critique keeps stalling on this: <blocker>. Resolve it — you may change what the brief asked for to do so — and say in one sentence what you decided."
  - `fixFindingPrompt(f: Finding): string` — one finding, same line format as `lintFixPrompt`.
  - `fixAllMinorPrompt(findings: Finding[]): string` — "Fix these minor findings and change nothing else:" + lines.
  - `continuePrompt(): string` → "Continue where you stopped."
  - `findingLine(f: Finding): string` — the shared line format.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import { answersMessage, critiqueFixPrompt, critiquePrompt, findingLine, fixAllMinorPrompt, lintFixPrompt, resolveBlockerPrompt, skipMessage } from "./design-prompts";
import type { CritiqueRound, Finding, LintReport, Questions } from "./design-review-model";

const f = (over: Partial<Finding>): Finding => ({ rule: "audit:contrast", severity: "severe", text: "Text at 3.2:1 needs 4.5:1", frame: "desktop", file: "frames/desktop.html", ...over });

describe("prompts", () => {
  it("answers list every question by label, then references, then go", () => {
    const q: Questions = { questions: [{ id: "who", label: "Who is buying?", hint: "", type: "multi", options: ["a", "b"], max: 2 }, { id: "feel", label: "How should it feel?", hint: "", type: "single", options: [], max: null }, { id: "extra", label: "Anything to match?", hint: "", type: "text", options: [], max: null }], references: true, answers: null, skipped: false };
    const m = answersMessage(q, { who: ["Gift buyers", "New to specialty"], feel: "Quiet and exact" }, ["refs/shelf-photo.jpg"]);
    expect(m).toBe("Answers to your questions:\n- Who is buying?: Gift buyers, New to specialty\n- How should it feel?: Quiet and exact\n- Anything to match?: (no answer)\nReferences, in this design's refs/ folder:\n- refs/shelf-photo.jpg\nGo ahead.");
    expect(skipMessage()).toBe("Skip the questions. Decide, and say what you assumed.");
  });
  it("lint and finding lines name frame, file, line and selector", () => {
    expect(findingLine(f({ line: 188, selector: "p.lede" }))).toBe("- desktop · frames/desktop.html:188 · p.lede — Text at 3.2:1 needs 4.5:1");
    expect(findingLine(f({}))).toBe("- desktop · frames/desktop.html — Text at 3.2:1 needs 4.5:1");
    const r: LintReport = { v: 1, version: 3, at: "t", ran: true, problem: null, severe: [f({})], minor: [f({ severity: "minor" })] };
    const p = lintFixPrompt(r, 1, 2);
    expect(p.startsWith("Lint fix pass 1 of 2. Fix these and change nothing else:\n- desktop")).toBe(true);
    expect(p.split("\n").filter((l) => l.startsWith("- "))).toHaveLength(1);
    expect(p.endsWith("Say what you changed in one sentence.")).toBe(true);
    expect(fixAllMinorPrompt([f({ severity: "minor" })])).toContain("Fix these minor findings");
  });
  it("the critique prompt names the reviewers, the file, the round and the bar", () => {
    const p = critiquePrompt(2, 3, 8.0, 6, ["/p/.chronicle/designs/g/.versions/v6/thumbs/desktop.png"]);
    for (const must of ["art-director", "ux-director", "accessibility", "copy", "critique/round-2.json", "round 2 of 3", "8.0", "in parallel", "never your own reasoning", "thumbs/desktop.png", "\"blocker\"", "one sentence"]) expect(p).toContain(must);
    expect(p).not.toContain("version\":null");
  });
  it("the critique fix prompt lists severe first and caps the list", () => {
    const c: CritiqueRound = { round: 1, version: 5, at: "t", bar: 8, weighted: 7.6, passed: false, missing: [], blocker: "The 140 px headline pushes the price down",
      reviewers: [{ id: "ux", score: 7, notes: [], findings: [f({ rule: "critique:ux", severity: "minor", text: "m1" }), f({ rule: "critique:ux", text: "s1", selector: ".buy" })] }, { id: "copy", score: 8, notes: [], findings: Array.from({ length: 10 }, (_, i) => f({ rule: "critique:copy", severity: "minor", text: `c${i}` })) }] };
    const p = critiqueFixPrompt(c);
    expect(p.startsWith("Round 1 scored 7.6 against 8.0.")).toBe(true);
    const lines = p.split("\n").filter((l) => l.startsWith("- "));
    expect(lines).toHaveLength(8); expect(lines[0]).toBe("- UX director · desktop · .buy — s1");
    expect(resolveBlockerPrompt(c.blocker!)).toContain("you may change what the brief asked for");
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/lib/design-prompts.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement** — string builders; `REVIEWERS` from the model for names; scores formatted with `fmtScore`. The critique prompt body (keep the wording; tests match substrings):

```
Critique round <r> of <max>. The bar is <bar>. Version v<version> is what to review (use "version": <version>).
Run the four bundled reviewers in parallel as subagents: art-director, ux-director, accessibility, copy. Give each one ONLY: the frame files under frames/, these captures: <one per line>, the brief and the answers in questions.json if any, the design's kind, tokens.json, and the design system if this project has one — never your own reasoning or plan.
Then write critique/round-<r>.json exactly in this shape: <shape>
Set "blocker" only when a finding repeats from the previous round and traces to what the brief asked for; otherwise null. Change no other file in this turn. End with one sentence.
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run src/lib/design-prompts.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/design-prompts.ts src/lib/design-prompts.test.ts
git commit -m "feat(design): the loop's prompts are fixed strings with the findings in them"
```

---

### Task 12: The loop as a pure state machine

**Files:**
- Create: `src/lib/design-loop.ts`, `src/lib/design-loop.test.ts`

**Interfaces:**
- Produces:
  - `export const MAX_LINT_PASSES = 2;`
  - `export interface TurnResult { version: number | null; questionsPending: boolean; lint: LintReport | null; critique: CritiqueRound | null; cancelled: boolean }`
  - `export type Next = { kind: "wait" } | { kind: "send"; prompt: PromptKind } | { kind: "questions" } | { kind: "done" } | { kind: "belowBar" } | { kind: "critiqueMissing" } | { kind: "stopped" };`
  - `export function onSend(st: ReviewState, prompt: PromptKind, now: number): ReviewState` — every prompt kind moves to `"building"` (a `"critique"` prompt moves to `"critique"`), sets `lastPrompt`; a `"brief"`, `"user"`, `"answers"` or `"continue"` prompt resets `round: 0, fixPass: 0, best: null, accepted: false, startedAt: now` (a new attempt); `"resolve"` keeps the round count but clears `accepted`.
  - `export function afterTurn(st: ReviewState, s: ReviewSettings, t: TurnResult): { state: ReviewState; next: Next }` — the spec's §6:
    - `t.cancelled` → `stopped`, `next: stopped`.
    - phase `critique` (a critique turn just ended): `t.critique == null` → `{ phase: "critique", next: critiqueMissing }` (the state keeps `round`); else record `best` (max by score), and: `passed` → `done`; `round < s.rounds` → `building`, `next: send critiqueFix`, `round` unchanged (the next critique increments); else → `below-bar`, `next: belowBar`.
    - any other phase (a building/fixing turn ended): `t.questionsPending` → `questions`, `next: questions`; `t.version == null` (nothing changed) and `lastPrompt` was `lintFix`/`critiqueFix`/`fixFinding`/`resolve` → treat as no progress: fall through to the critique decision with the last known version; `s.lint && t.lint && t.lint.severe.length > 0 && st.fixPass < MAX_LINT_PASSES` → `fixing`, `fixPass + 1`, `next: send lintFix`; else `s.critique` → `critique`, `round + 1`, `fixPass: 0`, `next: send critique`; else → `done`, `next: done`.
    - `state.version` becomes `t.version ?? st.version`.
  - `export function onStop(st: ReviewState): ReviewState` → `stopped`.
  - `export function onAccept(st: ReviewState): ReviewState` → `done` with `accepted: true`.
  - `export function resumeAfterRestart(st: ReviewState, turnActive: boolean): { state: ReviewState; next: Next }` — with a turn running: unchanged, `wait`; in `building`/`fixing`/`gate` with no turn: `gate`, `next: { kind: "wait" }` **and** the caller re-runs the gate (see Task 13) — expose it as `next: { kind: "regate" }` (add to `Next`); in `critique` with no turn: `critiqueMissing`; every other phase: unchanged, `wait`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import { afterTurn, MAX_LINT_PASSES, onAccept, onSend, onStop, resumeAfterRestart, type TurnResult } from "./design-loop";
import { DEFAULT_SETTINGS, initialReviewState, type CritiqueRound, type LintReport, type ReviewSettings } from "./design-review-model";

const lint = (severe: number): LintReport => ({ v: 1, version: 1, at: "t", ran: true, problem: null, severe: Array.from({ length: severe }, (_, i) => ({ rule: `r${i}`, severity: "severe", text: "x", frame: "d", file: "frames/d.html" })), minor: [] });
const crit = (weighted: number, bar = 8): CritiqueRound => ({ round: 1, version: 1, at: "t", bar, weighted, passed: weighted >= bar, reviewers: [], missing: [], blocker: null });
const turn = (over: Partial<TurnResult>): TurnResult => ({ version: 2, questionsPending: false, lint: null, critique: null, cancelled: false, ...over });
const S: ReviewSettings = DEFAULT_SETTINGS;

describe("the review loop", () => {
  it("brief → questions → answers → gate fix → critique → fix → critique → done, one version per step", () => {
    let st = onSend(initialReviewState(), "brief", 1000);
    expect(st.phase).toBe("building"); expect(st.startedAt).toBe(1000);
    let r = afterTurn(st, S, turn({ version: null, questionsPending: true }));
    expect(r.next).toEqual({ kind: "questions" }); expect(r.state.phase).toBe("questions");
    st = onSend(r.state, "answers", 2000);
    r = afterTurn(st, S, turn({ version: 1, lint: lint(1) }));
    expect(r.next).toEqual({ kind: "send", prompt: "lintFix" }); expect(r.state).toMatchObject({ phase: "fixing", fixPass: 1, version: 1 });
    st = onSend(r.state, "lintFix", 3000);
    r = afterTurn(st, S, turn({ version: 2, lint: lint(0) }));
    expect(r.next).toEqual({ kind: "send", prompt: "critique" }); expect(r.state).toMatchObject({ phase: "critique", round: 1, fixPass: 0, version: 2 });
    st = onSend(r.state, "critique", 4000); expect(st.phase).toBe("critique");
    r = afterTurn(st, S, turn({ version: null, critique: crit(7.6) }));
    expect(r.next).toEqual({ kind: "send", prompt: "critiqueFix" }); expect(r.state).toMatchObject({ phase: "building", round: 1, best: { round: 1, score: 7.6 } });
    st = onSend(r.state, "critiqueFix", 5000);
    r = afterTurn(st, S, turn({ version: 3, lint: lint(0) }));
    expect(r.state).toMatchObject({ phase: "critique", round: 2 });
    r = afterTurn(onSend(r.state, "critique", 6000), S, turn({ version: null, critique: { ...crit(8.4), round: 2 } }));
    expect(r.next).toEqual({ kind: "done" }); expect(r.state).toMatchObject({ phase: "done", best: { round: 2, score: 8.4 } });
  });
  it("lint fixes stop after two passes and the findings ride into the critique", () => {
    let st = onSend(initialReviewState(), "user", 0);
    let r = afterTurn(st, S, turn({ lint: lint(2) })); expect(r.next).toEqual({ kind: "send", prompt: "lintFix" });
    r = afterTurn(onSend(r.state, "lintFix", 0), S, turn({ lint: lint(2) })); expect(r.next).toEqual({ kind: "send", prompt: "lintFix" }); expect(r.state.fixPass).toBe(MAX_LINT_PASSES);
    r = afterTurn(onSend(r.state, "lintFix", 0), S, turn({ lint: lint(2) })); expect(r.next).toEqual({ kind: "send", prompt: "critique" });
  });
  it("below the bar after the last round, and accept", () => {
    let st = { ...initialReviewState(), phase: "critique" as const, round: 3, best: { round: 2, score: 7.7 } };
    const r = afterTurn(st, { ...S, rounds: 3 }, turn({ version: null, critique: { ...crit(7.6), round: 3 } }));
    expect(r.next).toEqual({ kind: "belowBar" }); expect(r.state.best).toEqual({ round: 2, score: 7.7 });
    expect(onAccept(r.state)).toMatchObject({ phase: "done", accepted: true });
  });
  it("lint off and critique off short-circuit; a cancelled turn stops", () => {
    const r1 = afterTurn(onSend(initialReviewState(), "user", 0), { ...S, lint: false }, turn({ lint: lint(3) }));
    expect(r1.next).toEqual({ kind: "send", prompt: "critique" });
    const r2 = afterTurn(onSend(initialReviewState(), "user", 0), { ...S, critique: false }, turn({ lint: lint(0) }));
    expect(r2.next).toEqual({ kind: "done" }); expect(r2.state.phase).toBe("done");
    const r3 = afterTurn(onSend(initialReviewState(), "critique", 0), S, turn({ cancelled: true }));
    expect(r3.next).toEqual({ kind: "stopped" }); expect(onStop(r3.state).phase).toBe("stopped");
  });
  it("a critique turn that wrote no round file does not pass and does not hang", () => {
    const r = afterTurn({ ...initialReviewState(), phase: "critique", round: 1 }, S, turn({ version: null, critique: null }));
    expect(r.next).toEqual({ kind: "critiqueMissing" }); expect(r.state.phase).toBe("critique");
  });
  it("a fix turn that changed nothing falls through instead of looping on the same lint", () => {
    const st = { ...onSend(initialReviewState(), "lintFix", 0), fixPass: 1, version: 4 };
    const r = afterTurn(st, S, turn({ version: null, lint: null }));
    expect(r.next).toEqual({ kind: "send", prompt: "critique" }); expect(r.state.version).toBe(4);
  });
  it("a user message during done starts a fresh attempt", () => {
    const st = onSend({ ...initialReviewState(), phase: "done", round: 3, best: { round: 3, score: 8.2 }, accepted: true }, "user", 9);
    expect(st).toMatchObject({ phase: "building", round: 0, fixPass: 0, best: null, accepted: false, startedAt: 9 });
  });
  it("restart resumes at the gate, or asks again for a missing critique", () => {
    expect(resumeAfterRestart({ ...initialReviewState(), phase: "fixing" }, true).next).toEqual({ kind: "wait" });
    const r = resumeAfterRestart({ ...initialReviewState(), phase: "fixing", version: 3 }, false);
    expect(r.state.phase).toBe("gate"); expect(r.next).toEqual({ kind: "regate" });
    expect(resumeAfterRestart({ ...initialReviewState(), phase: "critique" }, false).next).toEqual({ kind: "critiqueMissing" });
    expect(resumeAfterRestart({ ...initialReviewState(), phase: "done" }, false).next).toEqual({ kind: "wait" });
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/lib/design-loop.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement** exactly per Interfaces (pure; no imports beyond the model types). Keep every transition in one `afterTurn` with early returns in the order the Interfaces list them.

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run src/lib/design-loop.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/design-loop.ts src/lib/design-loop.test.ts
git commit -m "feat(design): the review loop is a pure state machine with a version per step"
```

---

### Task 13: The store drives the loop and reads the director's files

**Files:**
- Modify: `src/lib/design-store.ts`, `src/lib/design-store.test.ts`, `src/lib/ipc.ts` (already has the wrappers from Tasks 6–7; add `onSetupUpdate` reuse if needed)

**Interfaces:**
- Consumes: Tasks 6, 7, 10, 11, 12.
- Produces (additions to `DesignProject`):
  - `review: ReviewState; settings: ReviewSettings; settingsScope: { design: Partial<ReviewSettings> | null }; questions: Questions | null; tokens: TokensPlan | null; critiques: CritiqueRound[]; lint: LintReport | null; scoreOpen: boolean; pin: { frame: string; selector: string; text: string } | null; toolsCard: boolean; critiqueMissing: boolean; context: string[] | null`
  - `export async function openDesign(...)` additionally loads `review` (`designReviewState` → `parseReviewState`), `settings` (`designReviewSettings(dir, slug).effective`), `questions`/`tokens` (`designFileRead` → parsers), `lint` (`.review/lint/v<latest>.json` via `designFileRead`? — no: dot paths are refused; add ipc `designLintRead(dir, slug, name)` → Rust `design_lint_read` returning `read_report`; add that command to Task 7's file list **in this task** as a one-liner in `main.rs`), and every `critique/round-<n>.json` for `n` in `1..=review.round` (`designCritiqueRead`, bar = settings.bar); then, when `review.phase` is not idle/done/stopped/below-bar and no turn is active, calls `resumeAfterRestart` and acts on `regate` (runs `reviewVersion` on `review.version`) or `critiqueMissing` (sets the flag).
  - The turn-end path replaces `snapshotTurn`: `async function reviewTurn(dir, slug)`: `n = designSnapshot(...)`; `lint = n != null ? (await designReviewVersion(dir, slug, n)).lint : null`; `questions = parseQuestions(await readDesignJson(dir, slug, "questions.json"))`; `critique = review.phase === "critique" ? await designCritiqueRead(dir, slug, review.round).then((v) => parseCritique(v, settings.bar, review.round)).catch(() => null) : null`; `cancelled = agentSessionFor(key).lastStopReason === "cancelled"` (add `lastStopReason: string | null` to `AgentSessionState`, set from `_chronicle/turn_end`'s `stopReason` in the reducer — a two-line change in `agent-session.ts`, tested in `agent-session.lanes.test.ts` with one `_chronicle/turn_end` line carrying `stopReason: "cancelled"`); then `{ state, next } = afterTurn(...)`; persists `state` (`designReviewStateSet`); marks the version (`designVersionMark(dir, slug, n, critique?.weighted, critique?.round)` when a critique passed or failed on a version); refreshes `versions`, `rows`, `lint`, `critiques`; then acts on `next`: `send` → `sendLoopPrompt(dir, slug, prompt)`; `questions` → nothing more (the card shows); `done`/`belowBar`/`stopped` → nothing more; `critiqueMissing` → `p.critiqueMissing = true`.
  - `async function sendLoopPrompt(dir, slug, kind: PromptKind)` builds the body from `design-prompts.ts` (`lintFix` from `p.lint` with `review.fixPass`; `critique` with `review.round`, `settings`, `review.version`, the version's thumbnail absolute paths from `designVersions`/`p.rootPath`; `critiqueFix` from the last critique; `resolve` from its `blocker`; `continue`), calls `onSend`, persists, and sends with the prefix (the same path `sendDesignMessage` uses, refactored into `sendPrefixed(dir, slug, body, kind)`).
  - `export async function sendDesignMessage(dir, text, forSlug?)` now calls `sendPrefixed(dir, slug, text, "user")` — the user's own message also goes through `onSend`.
  - `export async function answerQuestions(dir, answers: Record<string, string | string[]>, references: string[])` — `designQuestionsAnswer(dir, slug, { ...answers, references }, false)`, reloads `questions`, sends `answersMessage` with kind `"answers"`. `export async function skipQuestions(dir)` likewise with `skipped: true` and `skipMessage()`.
  - `export async function stopReview(dir)` — `cancelAgentTurn(key)` when a turn is active; `review = onStop(review)`; persist. `export async function askAnotherRound(dir)` — sets `review = { ...review, phase: "critique", round: review.round + 1, fixPass: 0 }`, sends `"critique"`. `export function fixFinding(dir, f)`, `fixAllMinor(dir)` — send `"fixFinding"` with the respective prompt (phase → building through `onSend`). `export async function acceptBelowBar(dir)` — `onAccept`, persist, mark the best version's score as accepted (`designVersionMark` with the best score). `export async function resolveBlocker(dir)` — sends `"resolve"` with the last critique's blocker (or the top repeated finding text). `export async function setReviewSettings(dir, scope: "project" | "design", patch)` — `designReviewSettingsSet` then reload `settings`. `export function setScoreOpen(dir, open)`, `export function setPin(dir, pin | null)`, `export function dismissCritiqueMissing(dir)`.
  - The watcher (`onDesignsChanged`): when `e.paths` includes `questions.json`, `tokens.json` or a path under `critique/`, reload just those (not the whole `openDesign`).
  - `export function reviewElapsed(p: DesignProject, now: number): string` → `m:ss` since `review.startedAt` (for the pill).

- [ ] **Step 1: Write the failing tests** (append to `design-store.test.ts`; extend the `./ipc` mock with `designReviewVersion`, `designReviewState`, `designReviewStateSet`, `designReviewSettings`, `designReviewSettingsSet`, `designQuestionsAnswer`, `designCritiqueRead`, `designFileRead`, `designLintRead`, `designVersionMark`, `designContextFiles`, and the `./agent-session` mock with `cancelAgentTurn` and a mutable session object `sess` the tests can flip)

```ts
it("drives brief → questions → answers → lint fix → critique → done, persisting each step", async () => {
  const m = await import("./design-store");
  const ipc = await import("./ipc");
  h.files.set("questions.json", JSON.stringify({ v: 1, questions: [{ id: "who", label: "Who is buying?", type: "single", options: ["Gift buyers", "Regulars"] }], references: true }));
  await m.loadDesigns(DIR); await m.openDesign(DIR, "home");
  const p = m.designProjectFor(DIR);
  await m.sendDesignMessage(DIR, "A product page", "home");
  expect(p.review.phase).toBe("building");
  // the director wrote questions.json and ended its turn with no file changes
  h.snapshot.mockResolvedValueOnce(null);
  sess.turnEnds += 1; h.fireAgent();
  await vi.waitFor(() => expect(p.review.phase).toBe("questions"));
  expect(p.questions?.questions[0].id).toBe("who");
  expect(h.stateSet).toHaveBeenLastCalledWith(DIR, "home", expect.objectContaining({ phase: "questions" }));
  await m.answerQuestions(DIR, { who: "Gift buyers" }, []);
  expect(h.answered).toHaveBeenCalledWith(DIR, "home", { who: "Gift buyers", references: [] }, false);
  expect(h.sent.at(-1)).toContain("- Who is buying?: Gift buyers");
  // the build turn ends: v1 with one severe finding
  h.files.set("questions.json", JSON.stringify({ v: 1, questions: [{ id: "who", label: "Who is buying?" }], answers: { who: "Gift buyers" } }));
  h.snapshot.mockResolvedValueOnce(1);
  h.review.mockResolvedValueOnce({ thumbs: ["home/.versions/v1/thumbs/d.png"], lint: { v: 1, version: 1, at: "t", ran: true, problem: null, severe: [{ rule: "audit:overflow", severity: "severe", text: "wide", frame: "d", file: "frames/d.html" }], minor: [] } });
  sess.turnEnds += 1; h.fireAgent();
  await vi.waitFor(() => expect(p.review).toMatchObject({ phase: "fixing", fixPass: 1 }));
  expect(h.sent.at(-1)).toMatch(/^\[design: home · .*\]\n\nLint fix pass 1 of 2/);
  // the fix turn ends clean → critique
  h.snapshot.mockResolvedValueOnce(2);
  h.review.mockResolvedValueOnce({ thumbs: [], lint: { v: 1, version: 2, at: "t", ran: true, problem: null, severe: [], minor: [] } });
  sess.turnEnds += 1; h.fireAgent();
  await vi.waitFor(() => expect(p.review).toMatchObject({ phase: "critique", round: 1 }));
  expect(h.sent.at(-1)).toContain("critique/round-1.json");
  // the critique turn ends with a passing round file
  h.snapshot.mockResolvedValueOnce(null);
  h.critique.mockResolvedValueOnce({ round: 1, version: 2, reviewers: [{ id: "ux", score: 8.5 }, { id: "art", score: 8 }, { id: "a11y", score: 9 }, { id: "copy", score: 8 }], blocker: null });
  sess.turnEnds += 1; h.fireAgent();
  await vi.waitFor(() => expect(p.review.phase).toBe("done"));
  expect(p.critiques[0].weighted).toBeCloseTo(8.38, 2);
  expect(h.mark).toHaveBeenCalledWith(DIR, "home", 2, expect.closeTo(8.38, 2), 1);
  expect(ipc.designReviewStateSet).toHaveBeenCalled();
});
it("stop cancels the running turn and a critique that never came back is flagged, not passed", async () => {
  const m = await import("./design-store");
  await m.loadDesigns(DIR); await m.openDesign(DIR, "home");
  const p = m.designProjectFor(DIR);
  await m.sendDesignMessage(DIR, "x", "home");
  sess.turnActive = true;
  await m.stopReview(DIR);
  expect(h.cancel).toHaveBeenCalled(); expect(p.review.phase).toBe("stopped");
  p.review = { ...p.review, phase: "critique", round: 1 };
  h.snapshot.mockResolvedValueOnce(null); h.critique.mockRejectedValueOnce(new Error("no file"));
  sess.turnActive = false; sess.turnEnds += 1; h.fireAgent();
  await vi.waitFor(() => expect(p.critiqueMissing).toBe(true));
  expect(p.review.phase).toBe("critique");
});
it("reopening a design mid-loop after a restart re-runs the gate on the latest version", async () => {
  h.state.mockResolvedValueOnce({ v: 1, phase: "fixing", round: 1, fixPass: 1, version: 3, best: null, startedAt: 1, lastPrompt: "lintFix", accepted: false });
  h.review.mockResolvedValueOnce({ thumbs: [], lint: { v: 1, version: 3, at: "t", ran: true, problem: null, severe: [], minor: [] } });
  const m = await import("./design-store");
  await m.loadDesigns(DIR); await m.openDesign(DIR, "home");
  const p = m.designProjectFor(DIR);
  await vi.waitFor(() => expect(h.review).toHaveBeenCalledWith(DIR, "home", 3));
  await vi.waitFor(() => expect(p.review.phase).toBe("critique"));
});
```

The `h` harness (in `vi.hoisted`): `files: Map<string, string>` served by `designFileRead`, `snapshot`, `review`, `critique`, `state`, `stateSet`, `answered`, `mark`, `cancel` mocks, `sent: string[]` filled by the `sendAgentMessage` mock (`(key, text, blocks, opts) => sent.push(opts?.prefix ? `${opts.prefix}\n\n${text}` : text)`), and `fireAgent()` that calls every callback `subscribeAgent` registered. `sess` is the object `agentSessionFor` returns (`{ phase: "ready", entries: [], turnEnds: 0, turnActive: false, lastPrompt: "", sessionId: "s", lastStopReason: null }`).

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/lib/design-store.test.ts`
Expected: FAIL (`review` undefined, functions missing).

- [ ] **Step 3: Implement** per Interfaces. Keep `snapshotTurn`'s name for the function the subscriber calls, with the new body. `readDesignJson(dir, slug, rel)` = `designFileRead` + `JSON.parse` in a try (bad JSON → `null` and `toastError("Couldn't read " + rel, …)` once per file change). The `lastStopReason` reducer change: in `agent-session.ts` where `_chronicle/turn_end` increments `turnEnds`, also `s.lastStopReason = typeof params.stopReason === "string" ? params.stopReason : null;` and initialise it in `blank()`.

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run src/lib/design-store.test.ts src/lib/agent-session.lanes.test.ts && npx tsc --noEmit -p .`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/design-store.ts src/lib/design-store.test.ts src/lib/ipc.ts src/lib/agent-session.ts src/lib/agent-session.lanes.test.ts src-tauri/src/main.rs
git commit -m "feat(design): the store runs the review loop turn by turn and reads what the director wrote"
```

---

### Task 14: The usage-limit reminder

**Files:**
- Create: `src/lib/reminders.ts`, `src/lib/reminders.test.ts`
- Modify: `src/lib/ipc.ts` (a `notify(title, body)` wrapper for the existing `notify` command, if none exists), `src/screens/design/DesignThread.tsx` (the limit card's two buttons)

**Interfaces:**
- Produces:
  - `export interface Reminder { dir: string; slug: string; title: string; version: number | null; at: number }`
  - `export async function loadReminders(dir): Promise<void>` (from `designReminders`), `export async function addReminder(r: Reminder)`, `export async function clearReminder(dir, slug)`, `export function remindersFor(dir): Reminder[]`, `export function subscribeReminders(cb)`.
  - `export function startReminderTicker(deps: { now: () => number; focused: () => boolean; toast: (msg, action, onAction) => void; notify: (title, body) => Promise<void>; continueDesign: (dir, slug) => Promise<void> }): () => void` — `every(30_000, tick)`; `tick` fires each reminder whose `at <= now()`: `toast("Your Claude plan is back. <title> is at v<n>.", "Continue", () => continueDesign(dir, slug))`, and `notify(...)` when `!focused()`; then clears it (persisted).
  - `export function dropRemindersWhenAllowed(status: LimitStatus | null)` — a reading of `"allowed"` clears every reminder (the limit cleared early).
- `DesignThread.tsx`: the limit card gains **Remind me at <time>** (`addReminder({ dir, slug: p.active, title, version: latest, at: limits.resetsAt })`, disabled without `resetsAt`) and **Open plan settings** (`newTab(dir, "https://claude.ai/settings/usage")` from `web-store` and `window.dispatchEvent(new CustomEvent("chronicle:show-pane", { detail: "web" }))` — add that event's listener in `App.tsx` beside `chronicle:new-design`, calling `goPane("web")`).

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ store: [] as unknown[], set: vi.fn(async (_d: string, l: unknown[]) => { h.store = l; }) }));
vi.mock("./ipc", () => ({ designReminders: vi.fn(async () => h.store), designRemindersSet: h.set }));
vi.mock("@/lib/scheduler", () => ({ every: (_ms: number, fn: () => void) => { (globalThis as { tick?: () => void }).tick = fn; return () => {}; } }));

describe("reminders", () => {
  it("fires due reminders once, with a notification only when unfocused, and clears them", async () => {
    const m = await import("./reminders");
    await m.addReminder({ dir: "/p", slug: "guji", title: "Product page", version: 5, at: 1000 });
    await m.addReminder({ dir: "/p", slug: "later", title: "Later", version: 1, at: 9000 });
    expect(h.set).toHaveBeenLastCalledWith("/p", expect.arrayContaining([expect.objectContaining({ slug: "guji" })]));
    let now = 500; const toast = vi.fn(); const notify = vi.fn(async () => {}); const cont = vi.fn(async () => {});
    const stop = m.startReminderTicker({ now: () => now, focused: () => false, toast, notify, continueDesign: cont });
    (globalThis as { tick?: () => void }).tick!();
    expect(toast).not.toHaveBeenCalled();
    now = 1500; (globalThis as { tick?: () => void }).tick!();
    expect(toast).toHaveBeenCalledWith("Your Claude plan is back. Product page is at v5.", "Continue", expect.any(Function));
    expect(notify).toHaveBeenCalledWith("Your Claude plan is back", "Product page is at v5.");
    toast.mock.calls[0][2](); expect(cont).toHaveBeenCalledWith("/p", "guji");
    (globalThis as { tick?: () => void }).tick!();
    expect(toast).toHaveBeenCalledTimes(1);
    expect(m.remindersFor("/p").map((r) => r.slug)).toEqual(["later"]);
    m.dropRemindersWhenAllowed("allowed");
    expect(m.remindersFor("/p")).toEqual([]);
    stop();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/lib/reminders.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement** — a module Map keyed by dir; every mutation persists through `designRemindersSet(dir, list)`; the ticker per Interfaces. Wire in `App.tsx`: `startReminderTicker({ now: Date.now, focused: () => document.hasFocus(), toast: toastAction, notify: notifyNative, continueDesign: (dir, slug) => sendDesignMessage(dir, continuePrompt(), slug) })` on mount, `loadReminders(dir)` when a project opens, and `dropRemindersWhenAllowed(limitsReading()?.status ?? null)` inside a `subscribeLimits` callback. The thread card buttons per Interfaces; copy: "Remind me at 4:10 pm" uses `fmtResetTime`.

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run src/lib/reminders.test.ts && npx tsc --noEmit -p .`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/reminders.ts src/lib/reminders.test.ts src/lib/ipc.ts src/screens/design/DesignThread.tsx src/App.tsx
git commit -m "feat(design): the limit card can remind you when the plan is back, and opens the plan's settings"
```

---

## Phase C · The pane

No component tests (no jsdom). Every card's logic that can be pure lives in the store or the model and is tested there; the components render from store state and call store actions. Each task ends with `npx tsc --noEmit -p .` and `npm run build` green, and a look at the comp it implements.

### Task 15: The thread's cards — questions, token plan, lint, critique, below the bar, review tools

**Files:**
- Modify: `src/screens/agent/AgentPane.tsx` (`trailing?: ReactNode` rendered after the entries list, inside the scroll container, before the typing dots), `src/screens/agent/Composer.tsx` (`chips?: ReactNode` rendered as a row above the textarea, `flex flex-wrap gap-1.5 px-2.5 pt-2`)
- Create: `src/screens/design/cards/QuestionsCard.tsx`, `TokenPlanCard.tsx`, `LintCard.tsx`, `CritiqueCard.tsx`, `BelowBarCard.tsx`, `ReviewToolsCard.tsx`, `src/screens/design/cards/card.tsx` (the shared `Card`, `ToolRow`, `Eyebrow`, `StateWord` pieces transcribed from `gen.py`'s `card`, `tool_row`, `eyebrow`, `state_word`)
- Modify: `src/screens/design/DesignThread.tsx` (composes the cards as `trailing`; passes `chips` in Task 16)

**Interfaces:**
- Consumes: store state (`questions`, `tokens`, `lint`, `critiques`, `review`, `critiqueMissing`, `toolsCard`, `settings`), actions (`answerQuestions`, `skipQuestions`, `askAnotherRound`, `acceptBelowBar`, `resolveBlocker`, `setScoreOpen`, `dismissCritiqueMissing`), `groupEntries` subagent items from `agentSessionFor(key).entries` for the reviewer progress, `checkFor("design_browser")` from the setup store.
- Produces:
  - `AgentPane` prop `trailing?: ReactNode`; `Composer` prop `chips?: ReactNode` (AgentPane forwards `composerChips?: ReactNode`).
  - `QuestionsCard({ dir })` — board 3's form card: eyebrow "Before I draw", `<n> questions · ~20 s`; per question the label + hint and chips (`button` with `aria-pressed`; `single` toggles one, `multi` up to `max`, `text` a 34 px input); the references block when `questions.references`: a text input ("A site, a screenshot, or “not like …”") whose Enter adds a URL chip, plus the composer's attach path reused (`agentAttach` into `refs/`: add ipc `designRefAttach(dir, slug, name, b64) => string` and a Rust `design_ref_attach` command that writes into `<slug>/refs/<safe name>` — put the command in `designs/review.rs`, two lines, tested with a `..` name refused); footer "Skip and I’ll decide, and say what I assumed." + **Skip** (ghost) + **Send answers** (primary, disabled until every non-text question has an answer). Inert (chips shown pressed, no buttons, footer reads "Answered" or "Skipped") once `answers` or `skipped`.
  - `TokenPlanCard({ tokens, base, slug })` — board 4's card: swatches (30 px, `box-shadow: inset 0 0 0 1px rgba(128,128,128,.25)`, name in mono 9.5 px), the display and body samples set in the named family via a `<style>` scoped `@font-face` pointing at `${base}${slug}/assets/fonts/<file>` — since the file name is unknown, render the sample with `font-family: "<family>", system-ui` and rely on the design's own fonts being loaded elsewhere in the page only when they are; the sample shows the family name beside it either way; "Rejected on purpose: …" line.
  - `LintCard({ lint, review, settings })` — board 4/6: header "Lint gate" + state (`passed · 0 severe · 3 minor` / `checking` while `review.phase === "gate"` / `fixing 1 severe` + "Fix pass n of 2" while `fixing` / "Lint gate off" / "couldn't run · <problem>" when `!lint.ran`); rows "Anti-pattern detector · impeccable", "Contrast + touch targets", "Shopping rules" (ecommerce only), each with check/spinner/error per the findings' rule prefixes.
  - `CritiqueCard({ dir })` — board 4/6: header "Critique panel" + `round n of N` + score chip when the round is in; four reviewer rows: while the loop is in `critique` and the round file isn't in, each row's state comes from the subagent tree (a `subagent` entry whose title contains the reviewer's agent name → spinner "reviewing" when running, check when completed, "queued" when absent); afterwards score chip + 3 px bar (`state-success` ≥ 8, `state-warn` below). Footer: previous round's sentence ("Round 1 scored 7.6. Fixed: …" from the previous round's top findings) + **Open scorecard** (`setScoreOpen(dir, true)`). When `critiqueMissing`: the body reads "The critique didn't come back." with **Ask again** (`askAnotherRound`) and the header state "waiting".
  - `BelowBarCard({ dir })` — board 9's panel: best score in `state-warn`, "below the bar of <bar>", "best of N rounds · r1 → r2 → r3", the blocker sentence or the top repeated finding, buttons **Keep it, accept <score>** (`acceptBelowBar`), **Let the director resolve it** (primary, `resolveBlocker`), **Lower the bar for this design** (ghost, opens the settings popover scoped to the design — dispatch `chronicle:review-settings` with `{ scope: "design" }`; Task 16 listens).
  - `ReviewToolsCard()` — board 9's "Getting the review tools ready": shown while `checkFor("design_browser").state === "installing"` (progress from `pct`/bytes as `CheckRow` draws it) and the rows "Design skills · ready", "Icons · lucide, bundled", "Browser · downloading" (spinner), with the line "The director can start writing now. Review scores use Chronicle's own pictures until the browser is ready."
  - `DesignThread` renders, in this order, after the entries: `TokenPlanCard` (when `tokens`), `QuestionsCard` (when `questions`), `LintCard` (when `lint` or phase gate/fixing), `CritiqueCard` (when `critiques.length` or phase critique), `BelowBarCard` (phase below-bar), `ReviewToolsCard`.

- [ ] **Step 1: Wire `trailing` and `chips`** — in `AgentPane.tsx`, after the entries `map` and before the typing-dots block: `{trailing}`; in `Composer.tsx`, first child of the outer field wrapper: `{chips && <div data-chrome className="flex flex-wrap items-center gap-1.5 px-2.5 pt-2">{chips}</div>}`. `AgentPane` accepts `composerChips` and passes it as `chips`.

- [ ] **Step 2: Build `card.tsx`** with `Card`, `ToolRow({ label, detail, state: "done" | "run" | "fail" | "queued" })`, `Eyebrow`, `StateWord({ word, tone })`, `ScoreChip({ value, passed })` transcribed from `gen.py` (sizes: card `mx-3.5 ml-[50px] rounded-lg border border-border-hairline bg-surface-card`; rows 28 px; eyebrow 10.5 px uppercase tracking; mono details 10.5 px `text-text-faint`).

- [ ] **Step 3: Build the six cards** per Interfaces, reading the boards for copy.

- [ ] **Step 4: Compose in `DesignThread.tsx`** and typecheck/build: `npx tsc --noEmit -p . && npm run build`. Expected: clean.

- [ ] **Step 5: Look at it** — `npm run tauri:dev` (or the release build) with a design whose folder you seed by hand: write `questions.json`, `tokens.json`, a `.review/lint/v1.json` and a `critique/round-1.json` into a throwaway project's design and compare each card against boards 3, 4, 6 and 9 side by side. Fix sizes and copy until they match.

- [ ] **Step 6: Commit**

```bash
git add src/screens/agent/AgentPane.tsx src/screens/agent/Composer.tsx src/screens/design/cards src/screens/design/DesignThread.tsx src/lib/ipc.ts src-tauri/src/designs/review.rs src-tauri/src/main.rs
git commit -m "feat(design): the thread shows the director's questions, its token plan, the gate, the critique and what to do below the bar"
```

---

### Task 16: Review settings — the chip and the popover

**Files:**
- Create: `src/screens/design/ReviewSettingsPopover.tsx`
- Modify: `src/screens/design/DesignThread.tsx` (`composerChips`), `src/lib/design-store.ts` (already has `setReviewSettings`, `settingsScope`)

**Interfaces:**
- `ReviewChip({ dir })` — the composer chip: `Critique on · pass 8.0` / `Critique off` / `… · lint off`, a `button` with `aria-haspopup="dialog"` and `aria-expanded`; click toggles the popover anchored above the chip (`position: fixed`, computed from the chip's rect, 340 px wide; use `@floating-ui/dom`'s `computePosition` with `flip`+`shift`, already a dependency).
- `ReviewSettingsPopover({ dir, anchor, scope, onClose })` — board 11 verbatim: title "Review before you see it"; the scope segment **This design** / **All designs in <project folder name>**; rows: Critique panel (toggle, sub "Four reviewers score each design. Off is faster and uses less of your plan."), Passing score (stepper 5.0–9.5 by 0.5, sub "Below this, the director tries again."), Most rounds (stepper 1–5, "Then it shows its best round and why."), Lint gate (toggle, "Blocks known AI-looking patterns and failed contrast."); footer "Connections live in Setup & health · Open" (dispatches `chronicle:open-setup`; add its listener in `App.tsx` → `setSetupMode("health")`). Values shown are the scope's: for the design scope, the override where set, else the effective value dimmed with "(project)" after it; a change calls `setReviewSettings(dir, scope, { key: value })`. Esc closes; focus moves into the popover on open and back to the chip on close; the whole popover is `role="dialog" aria-label="Review settings"`.
- `chronicle:review-settings` (from Task 15's BelowBarCard) opens it with `scope: "design"`.

- [ ] **Step 1: Build it**, then `npx tsc --noEmit -p . && npm run build`.
- [ ] **Step 2: Look at it** against board 11 (the highlighted chip and the popover's position).
- [ ] **Step 3: Commit**

```bash
git add src/screens/design/ReviewSettingsPopover.tsx src/screens/design/DesignThread.tsx src/App.tsx
git commit -m "feat(design): review settings open from the composer's chip, per design or for the whole project"
```

---

### Task 17: The scorecard, the Score tab, and the state words

**Files:**
- Create: `src/screens/design/Scorecard.tsx`
- Modify: `src/screens/design/CanvasToolbar.tsx` (a **Score** button beside History, `aria-pressed`, shown once `critiques.length > 0`), `src/screens/design/DesignPane.tsx` (the right column shows `Scorecard` when `p.scoreOpen`, else History, else the thread; opening one closes the other), `src/screens/design/DesignSidebar.tsx` (`trailingFor` uses `stateWord(p.review, row.latestVersion, latestScore)` for the active design — other rows keep today's `v<n>`/draft — and a score chip `8.4` in mono `text-state-success` after "ready · "), `src/screens/design/HistoryPanel.tsx` (a version with `score` shows it as a mono chip beside the time; `VersionMeta` in `ipc.ts` gains `lint?`, `score?`, `round?`)

**Interfaces:**
- `Scorecard({ dir, onClose })` — board 6: header "Scorecard" + "<frame or all> · round n" + X; the weighted score 44 px mono; `passed · bar is 8.0` / `below the bar of 8.0`; "weighted: art 0.3 · UX 0.35 · a11y 0.2 · copy 0.15"; one 18 px bar per round (`(score − 6) × 14` px tall, floor 2) with `r<n>` labels and "7.6 → 8.4 in 2 rounds · 4 min 10 s" (elapsed from `review.startedAt` to the last round's `at`); per reviewer: name, focus, score, bar, notes as a list; "Lint findings · 0 severe · 3 minor" + one row per finding (severe first) with **Fix** (`fixFinding`); footer **Fix all minor** (`fixAllMinor`, disabled with none) and **Ask for round n+1** (`askAnotherRound`). Clicking a finding row (not its Fix) calls `setPin(dir, { frame, selector, text })` when it has a selector (and `null` otherwise) and selects the frame (dispatch `chronicle:select-frame` with the frame id; Task 18's canvas listens).
- The Score tab: `setScoreOpen(dir, !p.scoreOpen)`; opening History closes the scorecard and vice versa; switching designs closes both (extend the existing effect).

- [ ] **Step 1: Build it**, `npx tsc --noEmit -p . && npm run build`.
- [ ] **Step 2: Look at it** against board 6 with the seeded critique file.
- [ ] **Step 3: Commit**

```bash
git add src/screens/design/Scorecard.tsx src/screens/design/CanvasToolbar.tsx src/screens/design/DesignPane.tsx src/screens/design/DesignSidebar.tsx src/screens/design/HistoryPanel.tsx src/lib/ipc.ts
git commit -m "feat(design): a scorecard shows every reviewer's verdict, and scores follow the design through the list and its history"
```

---

### Task 18: Pins on the canvas, "in review" labels, and the review pill

**Files:**
- Create: `src/screens/design/PinLayer.tsx`, `src/screens/design/ReviewPill.tsx`
- Modify: `src/screens/design/DesignCanvas.tsx` (locate round trip, `PinLayer`, `ReviewPill`, `chronicle:select-frame`), `src/screens/design/FrameView.tsx` (label states: "in review" while `review.phase === "critique"`; a pin count chip `<n>` after the width when the last critique has findings for this frame)
- Modify: `src/lib/design-store.ts` (`located: Record<string, { x, y, w, h } | null>` keyed by `frame:selector`; `frameMessage` accepts `located` and stores it), `src/lib/design-store.test.ts`

**Interfaces:**
- Locate: when `p.pin` changes and the pinned frame is live, the canvas posts `{ __chronicleCanvas: 1, type: "locate", id: "<frame>:<selector>", selector }` to that iframe's `contentWindow` (`"*"` target; the frame's origin is opaque); the reply lands in `frameMessage` → `p.located[id] = rect | null`. A frame that isn't live shows the pin at its last located rect if any.
- `PinLayer({ v, rects, pin, located })` — draws in the canvas layer (never inside the page): a 2 px `state-warn` outline around the located rect (world → screen through `worldToScreen` and `v.zoom`), a label chip with the finding text (max 36 ch, ellipsis) above-right, and, when `located[id] === null`, a "couldn't find it on the page" chip at the frame's top-left.
- `ReviewPill({ dir })` — board 4's bottom-centre pill, shown while `review.phase` is `gate`, `fixing` or `critique`: dot + "Checking…" / "Fixing 1 severe · pass n of 2" / "Critique round n · k of 4 reviewers in" (k = completed reviewer subagent cards this round) + elapsed `m:ss` (from `reviewElapsed`, ticked with `every(1000)`) + **Stop** (`stopReview`).
- `chronicle:select-frame` → `g.select(id)` and scroll into view (the existing selection path).

- [ ] **Step 1: Write the failing store test**

```ts
it("stores located rects from frames and ignores foreign locate replies", async () => {
  const m = await import("./design-store");
  await m.loadDesigns(DIR); await m.openDesign(DIR, "home");
  const p = m.designProjectFor(DIR);
  m.frameMessage(DIR, "d", { __chronicleFrame: 1, type: "located", id: "d:.buy", rect: { x: 10, y: 20, w: 30, h: 40 } });
  expect(p.located["d:.buy"]).toEqual({ x: 10, y: 20, w: 30, h: 40 });
  m.frameMessage(DIR, "d", { __chronicleFrame: 1, type: "located", id: "d:.nope", rect: null });
  expect(p.located["d:.nope"]).toBeNull();
  m.frameMessage(DIR, "d", { type: "located", id: "d:.x", rect: { x: 1, y: 1, w: 1, h: 1 } });
  expect(p.located["d:.x"]).toBeUndefined();
});
```

- [ ] **Step 2: Run to verify it fails**, then implement the store part, then the components; `npx vitest run src/lib/design-store.test.ts && npx tsc --noEmit -p . && npm run build`.
- [ ] **Step 3: Look at it** against boards 4 and 6 (pin + pill).
- [ ] **Step 4: Commit**

```bash
git add src/screens/design/PinLayer.tsx src/screens/design/ReviewPill.tsx src/screens/design/DesignCanvas.tsx src/screens/design/FrameView.tsx src/lib/design-store.ts src/lib/design-store.test.ts
git commit -m "feat(design): findings pin to their element on the canvas, and the review shows its progress with a Stop"
```

---

### Task 19: Setup & health — the Design group

**Files:**
- Modify: `src/lib/setup-store.ts` (`CHECK_META` gains two entries with kind `"browser"` and `"design_skills"`; `REQUIRED_META` excludes them like `agents`; `DESIGN_META = CHECK_META.filter(kind in those two)`), `src/screens/setup/SetupScreen.tsx` (`Checklist` renders `CHECK_META` minus the design rows as today, then the group: eyebrow "For the Design pane" + "the first is needed, the rest come with later parts" + the two rows in a card with the same row styling), `src/screens/setup/CheckRow.tsx` (icons for the two kinds — the `screen` and `wand` glyphs from `gen.py`'s G dict; a row whose `action` is `""` and state `missing` shows "not bundled" in `state-error` with the detail; a ready `design_skills` row shows its detail "impeccable 3.5.0 · 4 reviewers" in mono)
- Modify: `src/lib/setup-store.test.ts` (the two rows are not required; `readyCount` ignores them)

**Interfaces:**
- `CHECK_META` entries: `{ id: "design_browser", name: "A browser for checking designs", blurb: "Opens each design the way a visitor would and checks contrast and tap sizes. Downloaded once.", kind: "browser" }`, `{ id: "design_skills", name: "Design skills", blurb: "The director’s taste and review rules, including shopping-page guidelines.", kind: "design_skills" }`.
- `installCheck("design_browser")` already works (the generic path); `cancelCheck` too.

- [ ] **Step 1: Write the failing test** (append to `setup-store.test.ts`)

```ts
it("the Design rows exist, are never required, and do not count toward ready", async () => {
  const m = await import("./setup-store");
  expect(m.CHECK_META.map((c) => c.id)).toEqual(expect.arrayContaining(["design_browser", "design_skills"]));
  expect(m.totalRequired()).toBe(6);
  expect(m.DESIGN_META.map((c) => c.id)).toEqual(["design_browser", "design_skills"]);
});
```

- [ ] **Step 2: Run to verify it fails**, implement, `npx vitest run src/lib/setup-store.test.ts && npx tsc --noEmit -p . && npm run build`.
- [ ] **Step 3: Look at it** against board 10 (only the two rows; the "installing · 68%" state with the progress bar by starting the download).
- [ ] **Step 4: Commit**

```bash
git add src/lib/setup-store.ts src/lib/setup-store.test.ts src/screens/setup/SetupScreen.tsx src/screens/setup/CheckRow.tsx
git commit -m "feat(design): Setup & health gains the Design pane's browser and skills rows"
```

---

## Phase D · The benchmark and the proof

### Task 20: The benchmark runner, the briefs, and the release warning

**Files:**
- Create: `src/lib/design-bench.ts`, `src/lib/design-bench.test.ts`, `bench/design/briefs/*.md` (15), `bench/design/.gitignore` (`reference/\nresults/*.tmp\n`)
- Modify: `src/lib/agent-bridge.ts` (three actions), `src/lib/ipc.ts` (`designBenchBriefs`, `designBenchProject`, `designBenchWrite`), `release.sh`

**Interfaces:**
- Bridge actions (in `handleAgentAction`): `designs.capture { slug, frame? }` → `designCapture(a.dir, slug, frame)` → `{ ok: true, summary: "<n> pictures under .review/captures/", data: { paths } }`; `designs.lint { slug }` → `designLintCurrent` → `{ ok, summary: "<severe> severe · <minor> minor", data: report }`; `designs.bench { brief?, kind?, quick? }` → `runDesignBench(deps, a.dir, args)` → `{ ok, summary: "<k> of <m> passed the bar · mean <x.x>", data: results }`. The bench reply is sent when the run **finishes** (the bridge's timeout: raise `bridge.rs`'s per-action wait for `designs.bench` to 3 hours — add a `timeout_for(action)` beside `verb_for`, tested).
- `runDesignBench(deps: BenchDeps, repoDir: string, args: { brief?: string; kind?: string; quick?: boolean }): Promise<BenchResults>` in `design-bench.ts`, where `BenchDeps = { briefs: (repo) => Promise<Brief[]>; project: () => Promise<string>; open: (dir) => Promise<void>; startDesign: (dir, kind, brief) => Promise<string>; answer: (dir, answers, refs) => Promise<void>; waitSettled: (dir, slug) => Promise<ReviewState>; state: (dir) => DesignProject; setSettings: (dir, patch) => Promise<void>; judge: (dir, brief, a: string[], b: string[]) => Promise<{ winner: "A" | "B"; reasons: string[] }>; referenceCaptures: (repo, briefId) => Promise<string[] | null>; write: (repo, name, json, md) => Promise<void>; version: string; now: () => number }`.
  - Filters briefs by `args` (`quick` keeps `brief.quick`); creates the project; sets project settings `{ critique: true, bar: 8, rounds: 3, lint: true }`; for each brief: `startDesign`; whenever `state(dir).review.phase === "questions"`, answers from the brief's `answers` (matching by question id, then by label, else the first option) and `[]` refs; `waitSettled` resolves on `done`/`below-bar`/`stopped`; records `{ id, kind, rounds, score: best?.score ?? null, passed, lint: { severe, minor } of the last lint, seconds, cost: session.cost }`; when `referenceCaptures` returns paths, randomises A/B, calls `judge`, records `{ winner: "chronicle" | "claude-design", reasons }`.
  - `renderMarkdown(results): string` — the `.md` summary with the line "beat Claude Design on k of m compared briefs; mean score x.x; n of N passed the bar" and a table.
- `judge` in the app: a second throwaway project `<bench>/judge`; its design lane receives one message per brief (the two capture folders as A and B, the brief text) and must write `<slug>/verdict.json` `{ "winner": "A"|"B", "reasons": [..] }`; the app reads it with `designFileRead`. The judge project's own design (`startDesign(judgeDir, "app", "Judge")`) exists only to give the lane an active slug.
- `release.sh`: after the version stamps, `if ! ls bench/design/results/${VERSION}-*.json >/dev/null 2>&1; then echo "No design benchmark results for $VERSION (run: chronicle designs bench --quick). Continue? [y/N]"; read -r a; [ "$a" = "y" ] || exit 1; fi`.

- [ ] **Step 1: Write the failing test** (pure runner with fake deps)

```ts
import { describe, expect, it, vi } from "vitest";
import { renderMarkdown, runDesignBench, type BenchDeps } from "./design-bench";
import { initialReviewState } from "./design-review-model";

describe("the benchmark runner", () => {
  it("runs the filtered briefs through the loop, answers questions, judges the compared ones, and summarises", async () => {
    const phases: Record<string, "done" | "below-bar"> = { "app-1": "done", "ecommerce-1": "below-bar" };
    const state = { review: initialReviewState(), questions: null as unknown, lint: null as unknown, active: "x" };
    const deps: BenchDeps = {
      briefs: async () => [{ id: "app-1", kind: "app", title: "A", brief: "brief-app", answers: [], quick: true }, { id: "ecommerce-1", kind: "ecommerce", title: "E", brief: "brief-ecom", answers: [["who", "Gift buyers"]], quick: true }, { id: "deck-1", kind: "deck", title: "D", brief: "brief-deck", answers: [], quick: false }],
      project: async () => "/bench/p", open: vi.fn(async () => {}), setSettings: vi.fn(async () => {}),
      startDesign: vi.fn(async (_d, _k, _b) => "slug"),
      answer: vi.fn(async () => {}),
      waitSettled: vi.fn(async (_d, _s) => ({ ...initialReviewState(), phase: phases[currentId], round: 2, best: { round: 2, score: phases[currentId] === "done" ? 8.4 : 7.7 } })),
      state: () => state as never,
      judge: vi.fn(async () => ({ winner: "A" as const, reasons: ["r1", "r2", "r3"] })),
      referenceCaptures: async (_r, id) => (id === "app-1" ? ["/ref/a.png"] : null),
      write: vi.fn(async () => {}), version: "0.12.0", now: (() => { let t = 0; return () => (t += 1000); })(),
    };
    let currentId = "";
    deps.startDesign = vi.fn(async (_d, _k, b) => { currentId = b === "brief-app" ? "app-1" : "ecommerce-1"; return "slug"; });
    const r = await runDesignBench(deps, "/repo", { quick: true });
    expect(r.briefs.map((b) => b.id)).toEqual(["app-1", "ecommerce-1"]);
    expect(r.briefs[0]).toMatchObject({ passed: true, score: 8.4, rounds: 2, compared: { winner: expect.stringMatching(/chronicle|claude-design/), reasons: ["r1", "r2", "r3"] } });
    expect(r.briefs[1]).toMatchObject({ passed: false, score: 7.7, compared: null });
    expect(deps.write).toHaveBeenCalledWith("/repo", expect.stringMatching(/^0\.12\.0-\d{4}-\d{2}-\d{2}/), expect.any(Object), expect.stringContaining("1 of 2 passed the bar"));
    expect(renderMarkdown(r)).toContain("mean score 8.1");
  });
});
```

- [ ] **Step 2: Run to verify it fails**, implement, `npx vitest run src/lib/design-bench.test.ts && npx tsc --noEmit -p .`.

- [ ] **Step 3: Write the fifteen briefs** — three per kind (`ecommerce`, `app`, `marketing`, `brand`, `deck`), ids `<kind>-1..3`, one `quick: true` per kind. Each brief is two to four sentences a real user would type, and `## Answers` gives an answer for the obvious questions (`who`, `where`, `feel`, `system`). Examples: `ecommerce-1` the Guji product page (gift buyers, phone, quiet and exact, no system); `ecommerce-2` a category page for a bike shop; `ecommerce-3` a checkout for a subscription box; `app-1` a settings screen for a notes app; `app-2` a dashboard for a small team's incidents; `app-3` an onboarding flow's first three screens; `marketing-1` a landing page for a developer tool; `marketing-2` a pricing page with three tiers; `marketing-3` a launch announcement page; `brand-1` a brand identity one-pager for a bakery; `brand-2` a style tile for a fintech; `brand-3` a poster series for a jazz festival; `deck-1` a six-slide seed pitch; `deck-2` a quarterly review deck; `deck-3` a workshop title and agenda deck.

- [ ] **Step 4: Wire the bridge, the deps in `App.tsx`'s bridge mount (`openProject`, the store's functions, `judge` as described), the CLI's wait, and `release.sh`.** Then `cd src-tauri && cargo test bridge` (the `timeout_for` test) and `npx tsc --noEmit -p . && npm run build`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/design-bench.ts src/lib/design-bench.test.ts src/lib/agent-bridge.ts src/lib/ipc.ts src/App.tsx src-tauri/src/bridge.rs bench/design release.sh
git commit -m "feat(design): a fixed set of briefs runs through the director and is judged blind against Claude Design"
```

---

### Task 21: Replay fixture, roadmap, and the live check

**Files:**
- Create: `src/lib/__fixtures__/design-director.jsonl`, `src/lib/agent-session.director.test.ts`
- Modify: `chronicle.json` (DP-2's `docs`, `paste`, `status.done_when`, `current_labels`, the spec's `generatedFrom` entry), `docs/superpowers/specs/2026-10-01-design-pane-director-design.md` (append "Live test results")

- [ ] **Step 1: Build a release binary**

```bash
export PATH="$HOME/.cargo/bin:$PATH"
npm run build && (cd src-tauri && cargo build --release --features tauri/custom-protocol)
```

- [ ] **Step 2: Prepare a throwaway project** as the foundation's Task 20 did (rsync the repo without `node_modules`/`target`; `CHRONICLE_BRIDGE_SOCKET=/tmp/cdd.sock src-tauri/target/release/chronicle --open <scratchpad>/design-director`). The user's screen must be free (see the memory note on driving the app).

- [ ] **Step 3: Run the live checklist** (the spec's §13 list), recording each result:

1. Setup & health shows the Design group; install the browser; the progress bar moves; the row reads ready with the chromium directory.
2. A vague brief ("A page for our coffee") gets a form; answering starts the build; the sidebar reads draft → working. A second design with a full brief gets no form. Skip works.
3. `tokens.json` lands → the token plan card shows the swatches and the rejected line.
4. Hand-edit a frame to 3:1 body text on a 390 frame and end a turn (send "Nothing to change"): the gate reports the contrast finding as severe, the fix prompt goes out, the next version is clean; History shows both versions with lint counts.
5. The critique runs: four reviewer cards appear in the thread's subagent tree, the pill counts them in, the round file lands, the card shows scores and "Open scorecard"; the scorecard opens; clicking a finding with a selector pins it on the frame; Fix sends and the next round passes.
6. A brief written to fail (a 140 px headline on a phone product page, bar 9.5 for that design) reaches "below the bar" after three rounds with the blocker sentence; Keep it → done and accepted; (repeat) Let the director resolve it → one more round; Lower the bar → the popover opens on the design scope.
7. Stop during a critique: the turn cancels, the design reads "stopped · v<n>", the next message restarts the loop.
8. Quit the app mid-fix-turn; reopen; the design resumes at the gate and continues.
9. The review settings chip and popover: turning the critique off makes the next turn end at "ready"; the project scope changes the default for a new design.
10. `chronicle designs capture --slug <slug>` and `chronicle designs lint --slug <slug>` from a terminal in the project answer with paths and counts; inside the session, "Look at your desktop frame" makes the director call `chronicle.designs.capture` without a permission prompt; a `playwright` tool call also runs without a prompt.
11. The usage-limit card (simulate by feeding a `usage_update` with `status: "rejected"` through the replay path, or wait for a real one): Remind me schedules; a toast and a notification arrive at the time (set `at` two minutes ahead in `.reminders.json` by hand).
12. `chronicle designs bench --quick` completes in the bench project and writes results; one brief with a hand-placed reference gets a verdict.
13. Idle energy with the pane open is within 1 ms/s of the foundation's figure; `ps` shows the MCP servers gone after idle-stop.
14. The fence: "write your critique to ~/critique.json" is refused; the outside-change list is empty after a full loop.

- [ ] **Step 4: Record the replay fixture** — the design lane's transcript of run 2 or 5 (`.chronicle/designs/.threads/<session>/thread.jsonl`), trimmed to at most 500 lines that still contain: the brief, the `questions.json` write, the answers message, the `tokens.json` write, at least one frame write, the lint fix prompt and its write, the critique prompt, the four reviewer `Task` tool calls with `_meta.claudeCode.subagent`, the round file write, and the final `_chronicle/turn_end`. Paths → `/home/u/proj`, slug → `guji-product-page`, long strings cut, big bodies → `{"_trimmed":true}`. Test (same mocks as `agent-session.design.test.ts`):

```ts
describe("a recorded director session replays through the reducer", async () => {
  const { reduceLines, laneKey, groupEntries } = await import("./agent-session");
  const s = reduceLines(laneKey("/home/u/proj", "design"), lines);
  it("is bounded and ends on a turn end", () => { expect(lines.length).toBeLessThanOrEqual(500); expect((lines.at(-1) as { method: string }).method).toBe("_chronicle/turn_end"); });
  it("wrote the director's files inside the design", () => {
    const paths = s.entries.filter((e) => e.kind === "tool").map((e) => (e as { detail: string }).detail);
    for (const f of ["questions.json", "tokens.json", "critique/round-1.json"]) expect(paths.some((p) => p.endsWith(f))).toBe(true);
  });
  it("ran the four reviewers as subagents", () => {
    const subs = groupEntries(s.entries).filter((e) => e.kind === "subagent") as { tool: { title: string } }[];
    expect(subs.length).toBeGreaterThanOrEqual(4);
    for (const name of ["art", "ux", "accessib", "copy"]) expect(subs.some((x) => x.tool.title.toLowerCase().includes(name))).toBe(true);
  });
  it("shows user messages without the design prefix", () => {
    for (const u of s.entries.filter((e) => e.kind === "user") as { text: string }[]) expect(u.text.startsWith("[design:")).toBe(false);
  });
});
```

Run: `npx vitest run src/lib/agent-session.director.test.ts` — PASS. Commit: `test(design): a recorded director session replays through the reducer`.

- [ ] **Step 5: Roadmap** — in `chronicle.json`, DP-2 gains `"docs": [{ "path": "docs/superpowers/specs/2026-10-01-design-pane-director-design.md" }, { "path": "docs/superpowers/plans/2026-10-01-design-pane-director.md" }]`, `paste: [{ "label": "the director plan", "into": "Claude Code", "when": "Paste docs/superpowers/plans/2026-10-01-design-pane-director.md when it is time to build the director." }]`, `status.done_when: [{ "commit_subject": "(?i)^docs\\(design\\): director live (test|check)" }]`, `current_labels: [{ "when": [{ "file_exists": "src/lib/design-loop.ts" }], "label": "being built now" }, { "when": [{ "file_glob": { "dir": "docs/superpowers/plans", "contains": "design-pane-director" } }], "label": "plan written, ready to build" }]`, `default_label: "spec written, plan next"`; add the spec to `generatedFrom` with its `shasum -a 256`. Validate: `/Applications/Chronicle.app/Contents/MacOS/chronicle --derive .` shows DP-2 "being built now" with no warnings. Commit: `chore(roadmap): the director's spec and plan join the roadmap`.

- [ ] **Step 6: Live test notes and done** — append `## Live test results (<date>)` to the spec with the fourteen checks, pass/fail, and every fix made (each fix is its own commit before this one), then:

```bash
git add docs/superpowers/specs/2026-10-01-design-pane-director-design.md chronicle.json
git commit -m "docs(design): director live check"
```

- [ ] **Step 7: Full suite**

Run: `(cd src-tauri && cargo test) && npx vitest run && npx tsc --noEmit -p . && npm run build`
Expected: everything passes. Report the counts and confirm `chronicle state phases` derives DP-2 done and DP-3 up next.

---

## Self-review (done while writing; kept for the executor)

- **Spec coverage.** §2 persona → Task 3; §3 form → Tasks 7, 10, 13, 15; §4 token plan → Tasks 10, 13, 15; §5 plugin, MCP, Chronicle tools, permissions → Tasks 1, 2, 6, 8, 9; §6 loop → Tasks 12, 13, 18; §7 gate → Tasks 4, 5, 6, 15; §8 critique → Tasks 2 (reviewers), 11, 13, 15; §9 scorecard, pins, below the bar → Tasks 15, 17, 18; §10 settings and Setup → Tasks 7, 8, 16, 19; §11 reminder → Task 14; §12 benchmark → Tasks 9, 20; §13 tests → every task's Step 1 and Task 21; §14 deviations → honoured (no Lighthouse/DevTools/icon MCP, two Setup rows, no "Use extra usage", one score per design, lucide bundled).
- **Names used across tasks.** `LaneExtras` (1, 8); `design_session_meta(root, plugin_dir)` (1, 3); `designs::plugin::{servers, intact, plugin_dir, PLAYWRIGHT_MCP, PLAYWRIGHT, SHADCN}` (2, 8); `setup::{design_plugin_dir, browsers_dir, browser_ready, resolve, tool_env_path}` (2, 6, 8); `lint::{Finding, LintCounts, LintReport, run_detector, from_audit, report, write_report, read_report, detector_script}` (5, 6); `versions::mark` (5, 6, 13); `thumbs::{design_review_version, design_capture, design_lint_current, audit_call, design_kind}` (6, 9, 13); `review::{ReviewSettings, SettingsPatch, effective, set_project, set_design, read_state, write_state, answer_questions, read_critique, reminders, set_reminders, read_design_file}` (7, 13, 14); ipc wrappers named in 6, 7, 13, 14, 20; model exports (10) used by 11, 12, 13, 15–18, 20; prompts (11) used by 13; loop (12) used by 13; store actions (13) used by 15–18, 20; `reminders.ts` (14) used by `App.tsx`; `trailing`/`composerChips`/`chips` (15, 16); `stateWord` (10, 17, 18); `frameMessage` `located` (18).
- **Placeholders.** None: every step names code or an exact check. The four reviewer rubrics (Task 2) are specified by section and content; the fifteen briefs (Task 20) by id and subject.
- **Review Focus.** 1 → Task 10's critique test and Task 7's; 2 → Task 12's "no round file" test and Task 13's second test; 3 → Task 5's `report(.., Err, ..)` test and Task 15's card state; 4 → Task 12's `resumeAfterRestart` test and Task 13's third test; 5 → Task 10's questions test and `questionsPending` on an empty form.
