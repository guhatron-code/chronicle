# The Zed update — the Chronicle Agent + five stolen refinements

*Chronicle v0.3. Everything here is derived from a source-level read of Zed
(`~/Downloads/zed-main`), filtered hard against bloat. Chronicle stays what it is: a
local-first tracking studio for a non-developer. It does not become an editor, an IDE,
or a model marketplace.*

---

## 0 · The one idea

Today Chronicle runs Claude Code inside a **pty** — a screen the agent paints and we
can only display or scrape. Zed proves the better seam: spawn the agent as a plain
child process speaking the **Agent Client Protocol** (ACP) — newline-delimited
JSON-RPC over stdio — and every meaningful thing the agent does arrives as a typed
event: message chunks, tool calls, permission requests, file edits, token usage.

**Terminal tab = Claude's cockpit rendered in Chronicle. Agent pane = Claude's engine
with Chronicle as the cockpit.** The cockpit we build speaks plain language, asks
consent through our own dialogs, shows every file change as a reviewable diff, and can
undo an entire answer with one click. The terminal stays for power use.

## 1 · Scope

### In

| # | Feature | Why it earns its place |
|---|---------|------------------------|
| A | **The Agent pane** — chat thread over ACP: streaming markdown, plain-language tool cards, permission handshake, stop/cancel, session resume, light usage line, ask/auto mode toggle | The core of the update — Chronicle finally *drives* the agent instead of watching it |
| B | **Edit review** — every agent file-edit tracked as a diff; a review strip ("4 files changed · Review"); keep/undo per file, Keep all / Undo all; diffs render in the existing repo viewer | The single biggest trust feature for a non-developer: *see what the AI changed, undo any part* |
| C | **Checkpoints** — a git-plumbing snapshot of the working tree before each user message; "Undo everything since this message" restores it | Cheap (we already speak git), and it converts fear into willingness to let the agent work |
| D | **Integrations** — "Start this phase" preloads the agent pane with the phase prompt (terminal remains a secondary choice); kanban "Run the round for me" runs *in the agent pane* with visible cards instead of a log tail | Makes it the *Chronicle* agent — wired into the roadmap and rounds, not a bolt-on chat |
| E | **Plain-language git remote output** — translate push/pull/fetch results into sentences; detect GitHub's "create a pull request" hint | Direct upgrade to our publish/bring-down toasts; the mapping table exists in Zed (`git_ui/remote_output.rs`) |
| F | **Clickable paths in terminal output** — `src/App.tsx:42` in any terminal opens in the repo viewer | Non-developers won't type paths; agents print them constantly |
| G | **Honest terminal-tab status** — read the pty's foreground process (`claude` running vs idle shell); tab dot + picker badge say what's actually happening | We currently guess from tab titles; Zed reads truth (`terminal/pty_info.rs` via sysinfo) |
| H | **Draft-it prompt upgrade** — adopt Zed's commit-message prompt (imperative, 50-char subject, omit useless bodies) | Free quality win, zero surface change |
| I | **Update download progress** — the update line gains Checking / Downloading n% / Installing states; silent on failed auto-checks, loud on manual ones | Our updater says nothing between click and relaunch; Zed's state machine is the model |

### Out — and why

- **Agent registry / multi-agent marketplace** — we pin ONE adapter version ourselves; Codex-over-ACP can come later if its adapter matures. Registry plumbing is bloat for a single-user tool.
- **Native agent, tool suite, LLM-provider registry, model picker** — Chronicle delegates the brain to Claude Code entirely. The adapter owns model choice (we keep our per-job `--model` pinning for headless work).
- **Profiles / per-tool permission maps** — ACP session modes (ask / auto) are the whole permission story. Two modes, one toggle.
- **Follow-the-agent mode, collab, channels, screen-share** — single-user app; the fs-watcher + explorer already show changes live.
- **Extensions/WASM, inline assistant, multibuffer, skills browser** — editor concepts; Chronicle's skill ships inside the app already.
- **Queued messages, thread archive/import, which-key, onboarding pages, Mermaid, branch/stash pickers, blame** — nice, not now; each is deferred, not rejected. Revisit after the agent lands.
- **OS sandboxing (Seatbelt)** — worth a future pass for auto-mode; ask-mode covers v0.3. Noted as the follow-up hardening item.

## 2 · Architecture

### 2.1 The ACP seam (Rust, `src-tauri`)

- **Spawn**: `npx --yes @zed-industries/claude-code-acp@<PINNED>` (the Claude Code ACP
  adapter; version pinned in a const, bumped deliberately). Resolve `npx`/`node` through
  the existing `find_tool` ladder. Env: inherit; blank `ANTHROPIC_API_KEY` so the
  adapter uses the user's Claude Code login (Zed does exactly this). `process_group(0)`;
  kill via the existing `term_then_kill`.
- **Transport**: stdin/stdout pipes, one JSON message per line. A reader thread parses
  each line and forwards agent→client traffic to the webview as Tauri events
  (`acp-update`, payload = the raw JSON + our session key). Client→agent requests go
  through a writer guarded by a mutex, with u64 request ids and a pending-response map.
- **Types**: depend on the `agent-client-protocol` crate (= the crate Zed uses, v1.1)
  for serde types; do NOT hand-write the schema. Initialize with `ProtocolVersion::V1`,
  advertise fs read/write client capability (that's what routes edits through us).
- **Client-handled requests** (agent → Chronicle): `fs/read_text_file`,
  `fs/write_text_file` (jailed to the project; each write recorded in the edit ledger
  before applying), `session/request_permission` (forwarded to the frontend, answered
  by the user's dialog; a oneshot per request), elicitation for `/login` if needed.
- **Lifecycle commands** (Chronicle frontend → Rust): `agent_session_start(dir)`,
  `agent_prompt(dir, message, mentions)`, `agent_cancel(dir)`, `agent_set_mode(dir, mode)`,
  `agent_respond_permission(dir, request_id, outcome)`, `agent_session_stop(dir)`.
  One live session per project (same single-flight discipline as everything else).
- **The edit ledger**: per session, a map path → { base: the file content before the
  agent's FIRST write this session, applied: bool }. Diffs derive from base vs disk
  (reusing `git diff --no-index` or in-process diff). Undo per file = write base back.
  Keep = drop the ledger entry. This is Zed's `action_log` reduced to Chronicle's needs.
- **Checkpoints**: before each prompt, snapshot via git plumbing WITHOUT touching the
  user's index: temp `GIT_INDEX_FILE` → `git add -A` → `write-tree` → `commit-tree`
  onto `refs/chronicle/checkpoints/<session>` (never on a branch, never in the log UI).
  Restore = `read-tree` + `checkout-index` from that tree + clear the edit ledger.
  Checkpoints are pruned when the session ends cleanly (keep the last N=20).

### 2.2 The shell layout (operator-directed)

The agent is NOT a fourth rail destination. The window becomes three units:

```
[rail] [ content pane (roadmap / repo / kanban via rail) ] | [ right column ]
                                                              [   AGENT     ]
                                                              [ ──splitter─ ]
                                                              [  TERMINAL   ]
```

- The right column stacks **Agent on top, Terminal below**, separated by a
  horizontal splitter (persisted per project, like the existing vertical one).
- **Pane visibility**: each unit (content · agent · terminal) can be shown or
  hidden — all three visible at max, exactly one at min. The toggle that would
  hide the last visible unit is disabled. Visibility persists per project.
  Affordance: a three-toggle cluster (content/agent/terminal) in the title bar's
  right side, plus each column section's own collapse control in its header.
- Hiding the agent or terminal never kills sessions — both keep running exactly
  as hidden terminal tabs already do.

### 2.2b The Agent section (React, `src/screens/agent/`)

Presentational components built to comps (see DESIGN_PROMPT.md), wired like every
other surface:

- `AgentPane` (container: session state, event subscription, IPC) →
  `Thread` (entries) → `UserMessage` / `AssistantMessage` (mini-md, streaming) /
  `ToolCard` (kind-aware: *Edited `path` — view the changes* · *Ran `cmd` — finished* ·
  *Read `path`* · waiting/failed/rejected states) / `PermissionCard` (inline
  allow/deny — the thread's own consent moment, mirroring ConfirmDialog's anatomy).
- `Composer`: input (⌘Enter sends), Stop while running, the ask/auto mode toggle
  (auto requires one explicit confirm, ever, per project), quiet usage line.
- `ReviewStrip`: appears when the ledger is non-empty — "4 files changed · Review ·
  Keep all · Undo all". Review opens the repo viewer on the ledger diff with
  Keep/Undo per file in the viewer's action bar.
- `CheckpointRow`: a thin divider above each user message — "↺ Undo everything since
  this message" behind a confirm.
- Session header: agent identity (Claude mark), session state word, End session.
- Empty state: mirrors the terminal START card — "Ask for anything. Chronicle asks
  before the agent touches your project."

### 2.3 Integrations

- **Start this phase**: the phase detail's primary becomes *Start with the agent*
  (reveals the agent section, preloads the phase prompt as the drafted first message — the user
  still presses send); *Run in a terminal* stays as secondary. Pre-flight row logic
  unchanged.
- **Run the round for me**: `round_execute` gains an agent-pane path: the round's
  prompt becomes the session's first message; tool cards replace the log tail; the
  board still ticks via the executor's kanban updates + fs watcher. The headless mode
  remains for background use; the pane is the default.
- The journal/notifications treat agent-session endings exactly like today's session
  endings.

### 2.4 The five refinements (independent of the agent)

- **E — remote output translation**: a pure Rust fn mapping git push/pull/fetch stderr
  to sentences + PR-hint detection; used by `git_push`/`git_pull` responses and toasts.
- **F — terminal path links**: scan visible terminal output with a bounded regex
  (paths + `file:line`), resolve against the terminal's cwd, cmd-click opens
  `openFileInRepo`. Budgeted (timeout per frame) like Zed.
- **G — pty foreground process**: `sysinfo`-based read of the pty's foreground pid
  (name + cwd) exposed via `pty_info(id)`; terminal tabs show a live dot + word when a
  known agent binary is foreground; the picker badge says "Claude running".
- **H — Draft-it prompt**: swap the prompt text; keep haiku.
- **I — update states**: the updater plugin exposes download progress; the update line
  becomes a tiny state machine (Checking… / Downloading 42% / Installing… / Restart).

## 3 · Build order (each phase: build → verify → STOP-worthy checkpoint)

- **Z-0 · Comps.** The design prompt (this folder) goes to Claude Design; comps return
  and are accepted before any pane UI is built. Backend work may start meanwhile.
- **Z-1 · The ACP client.** Rust seam end-to-end against the real adapter: start a
  session, send a prompt, receive streamed chunks + tool calls, answer a permission,
  cancel, stop. Proven by a Rust integration test against the adapter (skipped in CI
  when `npx` is absent) + `acp-update` events visible in the dev console.
- **Z-2 · The pane (read-only thread).** Build comps 100%: thread, cards, composer,
  states — wired to Z-1 for streaming text + tool cards + permissions. Probe suite:
  stubbed `acp-update` events drive the full card taxonomy.
- **Z-3 · Edits + checkpoints.** The ledger, ReviewStrip, viewer keep/undo, checkpoint
  snapshot/restore. Probes: scripted write_text_file events produce reviewable diffs;
  undo restores byte-identical files (rust test).
- **Z-4 · Integrations.** Phase-start preload, round-in-pane, journal/notify hooks.
  Probe: featwire-style flows.
- **Z-5 · The refinements.** E–I, each with its own probe or rust test.
- **Z-6 · Ship.** Full probe sweep + cargo tests, docs, memory, `./release.sh 0.3.0`.

## 4 · Risks & mitigations

- **Adapter drift** (npm package evolves): pinned version; a startup handshake failure
  surfaces as an honest card ("The agent bridge needs an update") — never a hang.
- **ACP crate vs Tauri async**: the crate is transport-agnostic types; our loop is
  plain threads + channels like the pty reader. No new runtime.
- **Non-developer trust**: ask-mode default; auto-mode one-time consent per project;
  every edit reviewable; checkpoint before every turn. The product laws hold: nothing
  irreversible without explicit confirmation.
- **Scope creep**: anything not in §1-In is out. The deferred list exists so "no" has
  a memory.
