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
| A | **The Agent pane** — chat thread over ACP: streaming markdown, plain-language tool cards, permission handshake, stop/cancel, session resume, light usage line, the Asks-first / Works-freely mode control | The core of the update — Chronicle finally *drives* the agent instead of watching it |
| B | **Edit review** — every agent file-edit tracked as a diff; a review strip ("4 files changed · Review"); keep/undo per file, Keep all / Undo all; diffs render in the existing repo viewer | The single biggest trust feature for a non-developer: *see what the AI changed, undo any part* |
| C | **Checkpoints** — a git-plumbing snapshot of the working tree before each user message; "Undo everything since this message" restores it | Cheap (we already speak git), and it converts fear into willingness to let the agent work |
| D | **Integrations** — "Start this phase" preloads the agent pane with the phase prompt (a NEW secondary "Run in a terminal" appears beside it — today the row has only one action); kanban "Run the round for me" runs *in the agent pane* with visible cards instead of a log tail | Makes it the *Chronicle* agent — wired into the roadmap and rounds, not a bolt-on chat |
| E | **Plain-language git remote output** — translate push/pull/fetch results into sentences; detect GitHub's "create a pull request" hint | Direct upgrade to our publish/bring-down toasts; the mapping table exists in Zed (`git_ui/remote_output.rs`) |
| F | **Clickable paths in terminal output** — `src/App.tsx:42` in any terminal opens in the repo viewer | Non-developers won't type paths; agents print them constantly |
| G | **Honest terminal-tab status** — read the pty's foreground process (`claude` running vs idle shell); tab dot + picker badge say what's actually happening | We currently guess from tab titles; Zed reads truth (`terminal/pty_info.rs` via sysinfo) |
| H | **Draft-it prompt upgrade** — adopt Zed's commit-message prompt (imperative, 50-char subject, omit useless bodies) | Free quality win, zero surface change |
| I | **Update download progress** — the update line gains Checking / Downloading n% / Installing states; silent on failed auto-checks, loud on manual ones | Our updater says nothing between click and relaunch; Zed's state machine is the model |

### Out — and why

- **Agent registry / multi-agent marketplace** — we pin ONE adapter version ourselves; Codex-over-ACP can come later if its adapter matures. Registry plumbing is bloat for a single-user tool.
- **Native agent, tool suite, LLM-provider registry, model picker** — Chronicle delegates the brain to Claude Code entirely. The adapter owns model choice (we keep our per-job `--model` pinning for headless work).
- **Profiles / per-tool permission maps** — permissioning is ACP-native: two session modes (Asks first / Works freely) plus the per-request options each permission card carries from the agent. No Zed-style profile system on top.
- **Follow-the-agent mode, collab, channels, screen-share** — single-user app; the fs-watcher + explorer already show changes live.
- **Extensions/WASM, inline assistant, multibuffer, skills browser** — editor concepts; Chronicle's skill ships inside the app already.
- **Queued messages, thread archive/import, which-key, onboarding pages, Mermaid, branch/stash pickers, blame** — nice, not now; each is deferred, not rejected. Revisit after the agent lands.
- **OS sandboxing (Seatbelt)** — worth a future pass for auto-mode; ask-mode covers v0.3. Noted as the follow-up hardening item.

## 2 · Architecture

### 2.1 The ACP seam (Rust, `src-tauri`)

- **Spawn**: the Claude ACP adapter via `npx --yes -- <package>@<version>`.
  **Provenance, stated precisely**: Zed does not hardcode a package — it resolves
  the claude adapter (`claude-acp`) from the ACP registry CDN and runs it via
  `npm exec`, deliberately using a version *ceiling* rather than an exact pin
  (exact pins can fail under npm's min-release-age). Chronicle skips the registry:
  we verify the adapter package name on npm at build time, pin a known-good version
  in a const, and prefer a bounded range only if exact-pin installs prove flaky.
  Resolve `npx`/`node` through the existing `find_tool` ladder. Env: inherit; blank
  `ANTHROPIC_API_KEY` so the adapter uses the user's Claude Code login (verified:
  Zed does exactly this). `process_group(0)`; kill via `term_then_kill`.
- **Transport**: stdin/stdout pipes, one JSON message per line. A reader thread parses
  each line and forwards agent→client traffic to the webview as Tauri events
  (`acp-update`, payload = the raw JSON + our session key). Client→agent requests go
  through a writer guarded by a mutex, with u64 request ids and a pending-response map.
- **Types**: depend on **`agent-client-protocol-schema`** (pure serde types — no
  async/transport deps; the parent `agent-client-protocol` crate ships connection
  machinery and Zed enables its `unstable` feature). Do NOT hand-write the schema.
  Initialize with `ProtocolVersion::V1`, advertise fs read/write client capability
  (that's what routes edits through us). Anything only in the unstable surface
  (notably usage updates) is treated as optional: consume when present, never
  required (the usage meter hides when the adapter doesn't send it).
- **Client-handled requests** (agent → Chronicle): `fs/read_text_file`,
  `fs/write_text_file` (jailed to the project; each write recorded in the edit ledger
  before applying), `session/request_permission` (forwarded to the frontend, answered
  by the user's dialog; a oneshot per request), elicitation for `/login` if needed.
- **Lifecycle commands** (Chronicle frontend → Rust): `agent_session_start(dir)`,
  `agent_prompt(dir, message, mentions)`, `agent_cancel(dir)`, `agent_set_mode(dir, mode)`,
  `agent_respond_permission(dir, request_id, outcome)`, `agent_session_stop(dir)`,
  `agent_sessions_list(dir)`. One live session per project (single-flight).
  `agent_cancel` and session stop RESOLVE every outstanding permission oneshot as
  cancelled — a pending ask must never hang the adapter.
- **Session persistence & resume**: Chronicle owns the transcript — every thread
  entry appends to `.chronicle/agent/<session>/thread.jsonl` as it streams (this is
  also what survives a crash). History lists sessions from that store. TRUE resume
  uses the adapter's `loadSession` only when its initialize response advertises it;
  otherwise "resume" opens the transcript read-only with a "Continue in a new
  session" affordance. No capability is assumed.
- **Auth**: there is no elicitation-based login — the adapter surfaces login as an
  auth method run in a terminal. On auth-required, the pane shows a "needs login"
  state whose action opens a Chronicle terminal tab running `claude /login`; the
  session retries after it exits.
- **Close/quit**: closing a project (⌘W) with a live agent session gets the same
  live-session confirm terminals have ("Close and stop the session"); app exit
  drains agent children through the existing kill-and-reap path. Ended-by-quit
  sessions show as ended in history with their transcript intact.
- **The edit ledger**: per session, a map path → { base: the file bytes before the
  agent's FIRST write this session (empty marker when the file didn't exist — undo
  DELETES a created file), applied: bool }. Bases persist under
  `.chronicle/agent/<session>/bases/` so undo survives an app restart; at session
  end, unresolved entries are auto-kept and the strip resolves ("All changes kept").
  Diffs derive from base vs disk. Undo per file = write base back (or delete).
  **Honesty rule**: only client-routed writes are ledgered — the agent's own shell
  commands also change files. At each turn end the ledger reconciles against git
  status (the fs-watcher already fires): shell-changed files appear in the strip
  count as "changed by commands — covered by Undo to here", reviewable as diffs but
  undoable only via the checkpoint. The strip never claims per-file undo it can't do.
- **Checkpoints**: before each prompt, snapshot via git plumbing WITHOUT touching the
  user's index: temp `GIT_INDEX_FILE` → `git add -A` → `write-tree` → `commit-tree`
  onto `refs/chronicle/checkpoints/<session>` (never on a branch, never in the log UI).
  **Restore is a two-tree update, not a checkout-index** (checkout-index only writes,
  it can never DELETE a file created after the snapshot): re-snapshot the current
  state into the temp index (`git add -A`), then
  `GIT_INDEX_FILE=<tmp> git read-tree --reset -u <checkpoint-tree>` — the `-u`
  two-tree update writes changed files AND removes paths present now but absent
  then. Clear the edit ledger after. Semantics stated honestly: the snapshot covers
  tracked + untracked files but NOT gitignored ones (add -A semantics) — agent
  artifacts inside ignored dirs are not restored. Pruning: one ref per session;
  a cleanly-ended session deletes its ref; orphaned session refs older than 14 days
  are pruned at the next session start (objects fall to normal git gc).
  **The Z-3 round-trip test MUST cover created, deleted, and modified files, both
  tracked and untracked** — "restores bytes" alone would pass a broken restore.

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
- **Supersession, explicit**: the shipped rule "the terminal column is absent on
  Kanban (full-bleed)" is RETIRED by this model — the right column may sit beside
  any content pane, kanban included; the visibility toggles are how a user gets
  full-bleed now. All three docs share this ruling.
- The rail keeps switching the content pane's view; clicking a rail destination
  while the content unit is hidden auto-reveals it. Keyboard: ⌥⌘1/2/3 toggle
  content/agent/terminal; ⌘J's content-view cycle is unchanged. The title-bar
  cluster sits leftmost of the existing right-side items (update line · Checked).

### 2.2b The Agent section (React, `src/screens/agent/`)

Presentational components built to comps (see DESIGN_PROMPT.md), wired like every
other surface:

- `AgentPane` (container: session state, event subscription, IPC) →
  `Thread` (entries) → `UserMessage` / `AssistantMessage` (mini-md, streaming) /
  `ToolCard` (kind-aware: *Edited `path` — view the changes* · *Ran `cmd` — finished* ·
  *Read `path`* · waiting/failed/rejected states) / `PermissionCard` (inline
  allow/deny — the thread's own consent moment, mirroring ConfirmDialog's anatomy).
- `Composer`: input (⌘Enter sends), Stop while running, the mode control, quiet
  usage line (hidden when the adapter sends no usage data).
- **Modes, stated precisely**: ACP session modes are agent-defined ids read from
  the session response — never assumed. The claude adapter's set (default /
  acceptEdits / bypassPermissions / plan) maps: **Asks first = `default`**,
  **Works freely = `acceptEdits`** — edits pre-approved, commands still ask.
  `bypassPermissions` is deliberately NOT exposed in the pane (an unconfirmed
  irreversible non-repo action has no undo; checkpoints only cover the worktree).
  Switching to Works freely is confirmed **per session** (not per project), and the
  confirm copy states exactly what it covers ("file edits happen without asking;
  commands still ask"). Permission options rendered on cards come from the agent's
  own PermissionOptions in each request — the design's Allow / Don't allow /
  Always-allow-this-session map onto the offered options; options not offered are
  not rendered.
- `ReviewStrip`: appears when the ledger is non-empty — "4 files changed · Review ·
  Keep all · Undo all". Review opens the repo viewer on the ledger diff with
  Keep/Undo per file in the viewer's action bar.
- `CheckpointRow`: a thin divider above each user message — the affordance reads
  "↺ Undo to here"; the confirm is titled "Undo everything since this message?"
  and its body is honest about scope: "Puts every file back the way it was before
  this message — including changes you made yourself since. Your conversation stays."
  (One affordance name, one confirm title — used identically in the design.)
- Session header: agent identity (Claude mark), session state word, End session.
- Empty state: mirrors the terminal START card — "Ask for anything. Chronicle asks
  before the agent touches your project."

### 2.3 Integrations

- **Start this phase**: the phase detail's primary becomes *Start with the agent*
  (reveals the agent section, preloads the phase prompt as the drafted first message — the user
  still presses send); *Run in a terminal* becomes the new secondary (the shipped row has a single action today). Pre-flight row logic unchanged. If the composer already holds a non-empty draft, preloading asks before replacing it; preload never auto-sends.
- **Run the round for me**: `round_execute` gains an agent-pane path: the round's
  prompt becomes the session's first message; tool cards replace the log tail; the
  board still ticks via the executor's kanban updates + fs watcher. The headless mode
  remains for background use; the pane is the default. **Round done/failed is
  ground truth, never prose**: done = every round task completed in kanban.json
  after the turn ends; failed = the session's stop reason (error/cancel) with tasks
  left open. The round card derives from those signals only.
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
- **Z-2a · The shell rework.** F31 built first: the stacked right column, the
  horizontal splitter (persisted), the visibility cluster + per-section collapse +
  re-open handles, ⌥⌘1/2/3, the kanban full-bleed retirement, rail auto-reveal.
  Probes: visibility floor (last unit's toggle disabled), persistence, sessions
  survive hiding.
- **Z-2b · The pane (read-only thread).** Build comps 100%: thread, cards, composer,
  states — wired to Z-1 for streaming text + tool cards + permissions. Probe suite:
  stubbed `acp-update` events drive the full card taxonomy, including needs-login
  and installing-the-bridge states.
- **Z-3 · Edits + checkpoints.** The ledger, ReviewStrip, viewer keep/undo, checkpoint
  snapshot/restore. Probes: scripted write_text_file events produce reviewable diffs;
  undo round-trips created + deleted + modified files, tracked and untracked (rust test).
- **Z-4 · Integrations + history.** Phase-start preload, round-in-pane,
  journal/notify hooks, the session store + history list + capability-gated resume.
  Probe: featwire-style flows + resume/read-only fallback.
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
