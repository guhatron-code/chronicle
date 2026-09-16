# Agent access to Chronicle, and rounds you can watch · design

Date: 2026-09-16. Status: approved in conversation, awaiting spec review.

## The problem

Three things, decided together in one brainstorm:

1. **Nothing outside the app can find a project's notes.** The vault at
   `<project>/.chronicle/notes/` is indexed only for the app's own IPC commands
   (`notes_index`, `notes_search`, `notes_read`, `notes_write`, …). An agent working in the
   project greps markdown, guesses the front-matter vocabulary, and cannot ask what is done
   or what is next. The user chose the widest surface: notes, project state, and actions.
2. **Rounds feel like nothing is happening.** A round today has two routes: `Run headless`
   (a background `claude -p` process, visible only as a tailed log) and `Run in the pane`
   (the agent pane, where every tool call, diff and permission prompt is visible). The
   plan-writing step before a round is headless too, behind a progress modal. The user
   wants no background route: a round is something you watch.
3. **The vault should follow the project.** A linked git worktree has no `.chronicle/`, so a
   round run from a worktree writes notes nowhere the app shows them.

Decisions taken: notes + state + actions (widest); rounds run in the pane or in a terminal
tab, never headless; one Rust implementation fronted by both an MCP server and CLI
subcommands (option C, MCP-first); explicit opt-in per project, every agent action visible
in the app; clones are out of scope unless the vault is committed.

## Design

### 1 · One implementation, two fronts

A new module `src-tauri/src/agent_api.rs` holds one function per capability. Each takes a
`Project` (loaded from a directory the way `load_project` does today) plus typed
arguments, and returns a serde-serialisable result or a one-sentence `Err(String)`. The two
fronts are thin:

- **MCP**: `chronicle --mcp <project-dir>` runs a stdio JSON-RPC server implementing the
  MCP handshake (`initialize`, `tools/list`, `tools/call`) with one tool per capability.
  Tool names are `chronicle.<group>.<verb>`; input schemas are generated from the same
  argument structs. Results are returned as a JSON text block plus a one-line
  human summary, so an agent can read either.
- **CLI**: `chronicle <group> <verb> [--flag …] [<project-dir>]` prints the same JSON
  (`--json`) or a plain table by default. Exit code 0 on success, 1 on a refused or failed
  call, 2 on usage.

Both fronts share argument parsing through the capability's struct, so a tool and its
subcommand cannot drift. Project directory resolution is the same as the app's: the
argument if given, else the current directory, walked up to the first folder containing
`chronicle.json` or `.chronicle/`.

### 2 · The surface

**Notes** (served from disk; no app needed):

| capability | arguments | result |
|---|---|---|
| `notes.list` | `status?`, `round?`, `tag?`, `text?`, `limit?` (default 200) | rows: path, id, title, status, round, tags, created, updated |
| `notes.read` | `path` | front matter as a map, body text |
| `notes.create` | `title`, `body?`, `folder?` (default `Tasks`), `tags?`, `status?` (default `queued`) | the new note's path and id |
| `notes.update` | `path`, `body?`, `set?` (front-matter keys to set), `unset?` | the note's new front matter |
| `notes.set_status` | `path`, `status` | new status |
| `notes.attach` | `path`, `file` (absolute or root-relative) | the attachment's vault path |

Ids come from the existing id allocator (`T-###`); writes go through the same `write_note`
path the app uses, so the index, the atomic temp file and the trash behave identically.
Status vocabulary is the vault's (`queued`, `in_progress`, `done`, plus whatever the vault
already contains); an unknown status is refused with the list of known ones.

**State** (served from disk; no app needed):

| capability | result |
|---|---|
| `state.phases` | every phase: id, name, state, label, `proof?`, `live`; plus `new_plans`, `newer_release`, `ledger_set_aside`, `manifest_present`, warnings — the `--derive` shape, never latching (write = false) |
| `state.needs_you` | the built-in rows the app would show (branch, publish, pull, prune, behind) as plain sentences with their commands |
| `state.rounds` | every round: n, kind, state, and per note path → status |

**Actions** (need the running app; see §3):

| capability | arguments | what the user sees |
|---|---|---|
| `round.plan` | `notes?` (paths; default every `queued` note) | the round card enters the pane thread and the plan is written as a pane turn |
| `round.start` | `n`, `where?` = `pane` (default) or `terminal` | the round runs where asked, visibly |
| `project.open` | `dir` | the app opens or switches to the project |
| `terminal.read` | `id?` (default the active tab), `lines?` (default 200) | nothing; returns the tail of that terminal's scrollback |

Every action also appends a journal line (`"An agent started round 3 in the pane"`) and
shows a toast, so nothing an agent does is silent.

### 3 · The action bridge

The app listens on a Unix socket at `~/Library/Application Support/chronicle/app.sock`.
On launch it writes a random token to `~/Library/Application Support/chronicle/app.token`
(mode 0600). A request is one JSON line: `{ token, dir, action, args }`; the reply is one
JSON line `{ ok, summary, data? }`. The app refuses a request whose token does not match,
whose `dir` is not an opened project (`project_for` already enforces this for IPC), or
whose action is unknown. Without a listening app, both fronts answer
`"Chronicle isn't open on this project, so it can't start a round. Open it and try again."`

Inside the app, each action is the existing frontend behaviour invoked from Rust: the socket
handler emits a Tauri event (`agent-action`) carrying the request; `App.tsx` dispatches it to
the same handlers the buttons use (`startRoundInPane`, the terminal spawn, project
activation) and replies through an `agent_action_reply` command. `terminal.read` is answered
the same way: the frontend serialises the last N lines of that tab's xterm buffer, since the
PTY scrollback lives only in xterm today.

### 4 · Opt-in and the skill

Nothing is registered automatically. Setup gains one row, **Let agents reach Chronicle**,
which for the opened project:

1. Writes or merges `.mcp.json` at the project root with a `chronicle` server entry
   (`command: <path to the running binary>`, `args: ["--mcp", "."]`). Existing entries are
   preserved; the file is shown in Repo like any other change.
2. Installs the `chronicle` skill next to `chronicle-init` (`~/.claude/skills/chronicle/`)
   with the same managed-marker rule (`install_init_skill`'s clobber-safety, generalised),
   telling the agent: use `chronicle.notes.*` for anything about the project's notes and
   tasks, `chronicle.state.*` before claiming what is done or next, and `chronicle.round.*`
   only when the user asked for a round.
3. Records the opt-in in the project's `.chronicle/agent/caps.json` so Setup shows the row
   as done and the composer can offer `@note` mentions backed by the same capability.

The row's undo removes the `.mcp.json` entry and the cap; the skill is left installed.

### 5 · Rounds you can watch

- **Two routes, both visible.** The round card offers `Run in the pane` and `Run in a
  terminal`. `Run headless`, `round_execute`, `round_exec_status`, `round_exec_cancel`,
  `exec_log_path`, and the `exec` session kind are deleted.
- **Planning is a pane turn.** `fixes_generate` (the background plan writer) and the
  `RoundFlow` progress modal are deleted. `round.plan` (from the card's `Plan a round` or
  from an agent) pushes a `round-plan` entry into the pane thread and sends the planning
  prompt (`FIXES_PROMPT_HEAD` unchanged, marker instruction included) as the session's next
  message. The card shows "writing the plan" until the turn ends; the turn ending is what
  flips it, because that is when `round_plan_settle` reads `fixes/phase_N_fixes_plan.md`
  and the prompt file back off disk and decides `ready` or `failed` from what actually
  landed there (see the plan 2 implementation notes below — the file watcher never settles
  a record). If the turn ends without both files, the card says so and offers to try again.
- **The terminal route.** `Run in a terminal` spawns a terminal tab titled `Round N` with
  `autoType` set to the agent command followed by the round prompt (the same message
  `startRoundInPane` sends), so the agent starts interactively with the instructions as
  its first message. The card links to the tab.
- **Progress is file-driven on both routes.** Note statuses flip as the agent edits front
  matter; `settle_done` marks the round done when every note is done. This is unchanged.
- **Cancel** is the pane's stop button or closing the terminal tab; the card reflects
  whichever route is live via `route: "pane" | "terminal"`.

### 6 · The vault follows the project

`vault_root(dir)`: if `dir` is a linked git worktree (`git rev-parse --git-common-dir`
differs from `--git-dir`), the vault is `<main checkout>/.chronicle/notes/`, where the main
checkout is the parent of the common dir. Every notes capability, the app's notes commands,
and `inject_rounds` resolve the vault through it. The app's tree shows one line under the
vault name when it is borrowed from another checkout ("notes live in
`/path/to/main`"). A moved project needs nothing. A clone gets an empty vault unless the
vault was committed; the skill and Setup say so in one sentence.

### 7 · Safety

- Every path argument is jailed to the project's declared roots via `resolve_jailed`.
- The MCP server has no bypass flags and takes none; the pane's permission mode governs a
  round exactly as it governs a chat. The terminal route runs the agent the way the user
  would.
- The socket token is per launch; a stale token from a previous launch is refused.
- `terminal.read` returns text only, never writes to a PTY.

### 8 · Testing

Rust: each capability driven through both fronts on a scratch repo with a vault (list with
each filter, create → read round-trip, set_status refused on an unknown status, jail
refusals); the MCP handshake and `tools/list` schema snapshot; the socket round trip with a
good token, a bad token, and no listener; `vault_root` on a linked worktree. Frontend: the
round card's state machine for `planning → ready → running(pane|terminal) → done|failed`,
and the `agent-action` dispatch mapping. Live check: from a Claude Code terminal inside
Chronicle, `chronicle notes list --status queued`, then through MCP plan and start a round
in the pane and watch it; then `where: terminal` and watch the tab.

## Delivery

Three plans, in this order, each shippable on its own: (1) notes and state over MCP and
CLI plus the vault resolution (§1, §2 notes/state, §6); (2) rounds you can watch (§5);
(3) the action bridge, the action capabilities, opt-in and the skill (§2 actions, §3, §4).

## Out of scope

- Clones without a committed vault.
- Write actions beyond rounds (editing the roadmap, git operations).
- Any automatic registration of `.mcp.json`.

## Implementation notes (plan 1, 2026-09-16)

- **The id allocator.** There was no allocator before this plan; app-created notes carry
  no id. `notes.create` now allocates `T-<n>` as one past the highest numeric `T-id`
  already in the vault, so a migration ending at `T-140` hands its first agent-created
  note `T-141` regardless of how many app-created, id-less notes sit alongside it.
- **`notes.attach`.** Returns both `attachment`, the vault-relative embed written into the
  note body (`../attachments/<name>`), and `file`, the same attachment addressed from the
  project root (`.chronicle/attachments/<name>`). Both the project-relative source and the
  attachments folder are jailed to the project directory.
- **The borrowed vault.** A linked git worktree has no `.chronicle/` of its own;
  `notes::index::vault_root` resolves it to the main checkout's vault, and every notes
  capability, the app's own notes commands, and round settlement go through it. The app
  watches that borrowed vault too, and the notes sidebar shows one line under the vault
  name: "Notes live in the main checkout · `<name>`".
- **`state.*` never writes.** `state.phases` calls `derive_project` with `write: false`,
  so the phase derivation never latches the roadmap ledger. `state.rounds` reads
  `rounds.json` and computed note statuses directly, never through `inject_rounds`'s
  `settle` gate, so listing rounds never settles one. Both were verified against a live
  repository with unchanged file mtimes on `.chronicle/roadmap-ledger.json` and
  `.chronicle/rounds.json` before and after the call.
- **The `notes list` table.** Columns are id, status, round, tags (comma-joined, `·` when
  empty), and path, in that fixed order, one row per note, no header row, with the
  summary sentence last. Other capabilities print their one-line summary only.
  `--limit 0` is a valid call and returns zero rows (and, for `notes list`, the summary
  "0 notes.").
- **`notes.list`'s `tag` takes one tag or several.** The schema accepts a string or an
  array of strings; a bare string becomes a one-element list, and a note matches when its
  tags intersect the list (`{"tag": ["bug", "nope"]}` matches any note tagged `bug`, `nope`,
  or both). This is required, not optional: the CLI's `--tag` flag already repeats into a
  JSON array (`--tag ui --tag bug` → `["ui", "bug"]`, cli.rs's `LIST_FLAGS`), so a
  schema that only accepted a string made `chronicle notes list --tag ui` fail on every
  call through the CLI front. A non-string, non-array value (a number, an object) is
  refused with "tag must be a string or a list of strings."
- **`state.phases`'s fields.** `derive_project`'s result is `name`, `statuses`, `warnings`,
  `ledger_set_aside`, `new_plans`, `newer_release`, plus `manifest_present` that
  `state_phases` adds itself. There is no `stale` field here: `stale` (the
  `generatedFrom` sha256 mismatch list) is computed only by the app's fuller
  `state_for_project`, which `state.needs_you` calls; it surfaces there as
  `behind-doc:<path>` rows, distinct from the `behind-plan:...` rows (`new_plans`) and
  the `behind-release` row (`newer_release`) that `state.phases` does carry.
- **MCP protocol.** `initialize` answers `protocolVersion: "2025-06-18"`. A tool error
  (an unknown tool, a refused call) is returned as a normal `tools/call` result with
  `isError: true` and the message as its text content, not a JSON-RPC error; only
  protocol-level problems (bad JSON, an unknown method) are JSON-RPC errors.
- **Live check.** Run against this repository (139 notes, all `done`; 7 rounds, all
  settled) on the Task 6 debug binary: `notes list --status queued` correctly printed "0
  notes." (a valid outcome, not a bug); `state phases` reported `M-1 done`, `M-2 now (up
  next)`, `SE done`, `new_plans` naming the September 2026 specs and plans ahead of the
  roadmap, and `newer_release: ["v0.8.1", "v0.5.1"]`; `state needs_you` and `state rounds`
  matched the app's own wording; every call exited 0 and left the ledger and rounds files
  untouched.
- **Front matter is one line per key.** `join_front_matter` writes `key: value` verbatim,
  so an agent-supplied value holding a line break would write a whole new front-matter
  line (`{"owner": "me\nround: 3"}` stamping a real round), and one holding `---` would
  close the block and spill into the body. `notes.update`'s `set` and `notes.create`'s
  `tags` refuse rather than escape: a key holding `\n`, `\r` or `:` with "front-matter
  keys are one word, no colon or line break." and a value or tag holding `\n` or `\r`
  with "front-matter values and tags are one line." The check runs before anything is
  set, so a refused call leaves the note byte for byte as it was.
- **A read never sets the ledger aside.** `ledger::load` renames a corrupt or
  newer-version `roadmap-ledger.json` to `.bad`; `ledger::load_readonly` reports the same
  `set_aside` flag and leaves the file where it is. `derive_project` and
  `state_for_project` call the read-only one whenever `write` is false, so
  `state.phases` and `state.needs_you` still tell the caller the ledger could not be
  read without moving a project file out from under the app.
- **Attachments follow the borrowed vault.** `notes::attach` writes to
  `vault_root(&p.dir)/.chronicle/attachments`, not `p.dir`, so the `../attachments/<name>`
  ref it puts in the note resolves from wherever `write_note` put that note. In a linked
  worktree the attachment therefore lands in the main checkout; the app shows it when
  that checkout is open, and a project opened AS the worktree reading it back is deferred.
  `notes.attach`'s `file` field stays the project-relative `.chronicle/attachments/<name>`.
- **Only a `.git` directory has a checkout to borrow.** `resolve_root` treats the parent
  of the git common dir as the main checkout only when that common dir is named exactly
  `.git`. A bare repo with sibling worktrees (`repo.git` beside them) has no main
  checkout: its parent is the folder that holds the worktrees, and borrowing it would put
  the vault outside every project and leave that parent's `.chronicle` findable from
  anywhere beneath it. Such a worktree is its own vault root.

## Implementation notes (plan 2, 2026-09-16)

- **Planning is a pane turn.** "Start a round" sends the planning prompt as an ordinary
  turn in the agent pane, so the user watches the plan get written the same way they watch
  any other agent work. `round_plan_begin_in` freezes the queued notes into a `generating`
  record and stamps `round: n` into each note's front matter before the turn is sent, so a
  save mid-turn can never clobber what the agent is reading. The turn's end is the only
  place the record is settled: `round_plan_settle` reads `fixes/phase_{n}_fixes_plan.md`
  and `..._fixes_prompt.md` back off disk and decides `ready` or `failed` from what
  actually landed there, never from what the agent said about itself.
- **A stranded `generating` record is cleared by Stop, not by the turn.** If the pane has
  no live turn — the app restarted mid-plan, say — the round card's Stop button still
  works: it calls `round_plan_cancel` directly, with no turn to cancel first. Either path
  into `round_plan_cancel_in` does the same three things: drop the `generating` record,
  requeue its notes, and sweep the abandoned attempt's half-written files
  (`fixes/phase_{n}_fixes_plan.md`, `..._fixes_prompt.md`, `.chronicle/round_{n}_notes.json`)
  so a later round reusing `n` never settles "ready" on a stale plan.
- **The terminal route's command and tab title.** `startRoundInTerminal` opens a tab
  titled `Round N` and types `terminalRoundCommand(agent, message)` into it — the agent
  binary (`claude` or `codex`) followed by the Rust-built run message as one single-quoted
  argument (quotes escaped as `'\''`) and a trailing newline as the submit, so the prompt's
  own backticks, quotes and line breaks reach the agent instead of the shell.
- **The mark goes up before the spawn.** `markRunningRound` is called with no tab id
  before the first `await`, so the card flips from "plan ready" to "executing" ahead of
  the two awaits between click and a running tab — marking afterwards left both Run
  buttons live for that whole window, and a second click during it spawned a second agent
  on the same round. The tab's id is written into the mark once `spawnTerm` returns; a
  start that fails takes the interim (tab-less) mark back down, but only if nothing has
  since claimed the round on a real tab.
- **A finished round is announced once, from the record, on either route.** `refreshNotes`
  is the single place that compares a round's before/after state on every notes read; it
  fires `round-done` the moment a round's state moves `ready` → `done` (every note ticked),
  regardless of whether the pane turn or the terminal tab is what triggered the read. Ending
  a run — the pane's turn ending, or the round's terminal tab dying — is a separate, narrower
  event handled by the shared `settleRoundRun` (`agent-session.ts`, called from both
  `round-run.ts`'s tab-death watcher and the pane's turn-end path): it reads the round back
  and announces `round-ended` only if the record is still `ready`, i.e. the run stopped with
  work left in it. A round that finished in the same instant its run ended never double-fires,
  because `round-done` already fired from the record moving off `ready` and `settleRoundRun`'s
  check finds it no longer there.
- **The pane and the terminal send the same run message.** Both routes call the one Rust
  `round_run_message(n)` builder for the sentence that starts (or resumes) a round's
  execution — "read the plan and prompt, execute every item, set `status: done` on each
  note as it's verified" — plus `marker_instruction`, the same commit-trailer instruction
  every agent turn gets. Neither route writes its own copy of that text.
- **The round-plan journal line.** Task 5 kept it: `refreshNotes` also detects a round's
  state moving `generating` → `ready` (`roundsJustReady`, a `notes-store.ts`-local helper
  mirroring `roundsJustFinished`) and journals "A round's fix plan is ready" once, on
  either route, the same way `round-done` does. The toast that used to accompany it
  (`toastSuccess("The fix plan is written", ...)`, from the deleted roadmap effect) was not
  re-created — the brief's ruling covered only the journal line.
- **`SessionKind` is `init` only.** The `"exec"`/`"fixes"` stub kinds Task 2 left for
  typecheck are gone along with the roadmap's session-mirroring effects (Task 5); the type
  now names the one session the roadmap still watches.
- **Gone:** the `RoundFlow` progress modal, the `RoundLog` panel, and the "Run headless"
  button. Watching a round now means watching the pane turn that plans it, or a `Round N`
  terminal tab; there is no separate log view or headless process to check on.

## Implementation notes (plan 3, 2026-09-16)

- **The bridge's paths.** `bridge::socket_path()` and `bridge::token_path()` are
  `config_dir().join("app.sock")` and `config_dir().join("app.token")`; `config_dir()` is
  `~/Library/Application Support/Chronicle` (capital C, matching the app's own name), not
  the lowercase `chronicle` this design's §3 wrote when it was drafted. Both are overridable
  by `CHRONICLE_BRIDGE_SOCKET` / `CHRONICLE_BRIDGE_TOKEN`, a seam used by exactly one test
  (`agent_api::tests::actions_go_through_the_bridge_and_report_its_sentence`, the only test
  in the crate allowed to set them, since the crate's tests run as threads in one process
  and the vars are shared state); with both unset, `socket_path()`/`token_path()` fall back
  to the real `config_dir()` paths.
- **The token is content-compared in constant time.** `token_matches` walks every byte of
  both strings and ORs the differences, rather than short-circuiting on the first mismatch
  the way `==` would, so a peer that can time the answer cannot learn the token one byte at
  a time.
- **`ACTIONS` is a closed list.** `bridge::ACTIONS` names exactly `round.plan`,
  `round.start`, `project.open`, `terminal.read`; `bridge::known_action` checks against it
  before an action ever reaches the frontend, and `main.rs`'s socket handler answers an
  unknown name with `"No action named {action}."` itself, without emitting `agent-action` at
  all. `verb_for` turns each of the four into the phrase its refusal sentence names ("plan a
  round", "start a round", "open a project", "read a terminal"); anything else maps to the
  generic "do that", which is unreachable in practice because `known_action` gates first.
- **`project.open`'s allowlist exception, both sides of the socket.** Every other action's
  `dir` is checked against `OpenRoots` (the app's set of already-opened, canonicalised
  project paths); `project.open` instead runs `bridge::admit_project_open`, which requires
  the target to be an absolute path ("{dir} isn't an absolute path." for a relative one, so
  a shell's own working directory never leaks in as the resolved folder), to exist as a
  directory ("There is no folder at {dir}."), and to hold `chronicle.json` or `.chronicle/`
  ("{dir} isn't a Chronicle project."). `agent_api::project_open` (the client side, in
  `agent_api.rs`) runs the identical check before ever dialling the socket, so a caller
  hears the refusal without a round trip; `main.rs`'s socket handler (the app side) runs it
  again and rewrites `req.dir` and `req.args["dir"]` to the canonical path it resolved,
  never the string that crossed the wire. Neither side trusts the other's canonicalisation.
- **The window-not-mounted refusal reuses the not-open sentence.** `BridgeState.ready` is an
  atomic flag the frontend flips once its `agent-action` listener is mounted; a request that
  arrives before that returns the identical "Chronicle isn't open on this project, so it
  can't {verb}. Open it and try again." sentence the client already produces when nothing is
  listening on the socket at all (`bridge::call_at`'s `not_open` closure), so an agent
  cannot tell "no app" from "app still starting up" apart, and is refused rather than made
  to wait: the request is answered immediately, never queued for the window to catch up to.
- **One reply per action, always.** `main.rs`'s handler blocks on an mpsc channel with a 30
  second timeout; a timeout removes the pending slot before answering "Chronicle didn't
  answer in time.", so a reply that arrives late from a frontend that took its time has
  nowhere left to deliver to. On the frontend, `mountAgentBridge` treats
  `handleAgentAction` as never throwing (it does not throw by construction) but still wraps
  it in `.catch` for defence, and never re-announces after a reply the app could not send
  (`agentActionReply` rejecting): the agent already heard it timed out, so a toast/journal
  line at that point would tell the user a story the agent never received.
- **Every performed action is visible twice: a toast and a journal line.**
  `mountAgentBridge` (`src/lib/agent-bridge.ts`) calls `toastSuccess`/`toastError` and, only
  on success, `announce(dir, "agent-action", summary, "Chronicle")`: a refusal gets the
  toast alone, since the design in §2 treats a declined action as not part of the project's
  history.
- **The env overrides are the test's alone.** The crate's tests run as parallel threads in
  one process; `CHRONICLE_BRIDGE_SOCKET`/`CHRONICLE_BRIDGE_TOKEN` are process-wide state, so
  exactly one test is allowed to set them, and it unsets both before its last assertion
  (which re-checks that `socket_path()`/`token_path()` fall back to the real `config_dir()`
  paths with nothing set). No other test may touch either variable.
- **The skill's location and content.** The Setup row installs `skill/chronicle/SKILL.md`
  (embedded at compile time via `include_str!`) at `~/.claude/skills/chronicle/SKILL.md`,
  through the same `install_skill` helper `chronicle-init` uses: a `.chronicle-managed`
  marker records the sha256 of what Chronicle wrote, and only a copy whose on-disk marker
  still matches is upgraded; a copy with no marker, or one that no longer matches (a human
  edited it), is left alone and reported "hand-managed — left alone". The skill names all
  three tool groups, tells the agent to prefer them over reading `.chronicle/` directly
  (an implementation detail that can change shape), and carries the same warning the plan's
  §4 called for: never start a round unless the user asked for one in this conversation.
- **`access.json`'s shape and its `createdBy` provenance.** `agents_access_enable_in`
  (`main.rs`) writes `<project>/.chronicle/agent/access.json` as
  `{ "mcp": true, "at": <epoch ms from epoch_ms()>, "createdBy": "chronicle" | null }`:
  `"chronicle"` when enabling created `.mcp.json` (it did not exist before), `null` when a
  `.mcp.json` was already there and enable only added a server entry to it. That value is
  what `agents_access_disable_in` reads back to decide whether disabling may delete
  `.mcp.json`: only `createdBy == "chronicle"`, AND the file being nothing but an empty
  `mcpServers` object after the `chronicle` entry is removed, clears the file itself;
  otherwise disable rewrites `.mcp.json` with the entry removed and leaves the file in
  place. Provenance is meant to survive a disable/enable cycle on the same project rather
  than being reset to "we probably created it" on every enable.
- **Enable refuses an unparsable `.mcp.json` rather than overwriting it.** `read_json_object`
  treats a missing file, invalid JSON, or a non-object top-level value alike, as `{}`, safe
  for every other caller of that helper, which only ever adds or removes keys, but not safe
  for `agents_access_enable_in`, whose whole point is to preserve what was already in the
  file: silently starting from `{}` would replace a `.mcp.json` a person hand-edited into
  invalid JSON with one holding only the `chronicle` entry. Enable checks first and, when
  `.mcp.json` exists but does not parse as a JSON object, refuses with a sentence naming
  that, and writes nothing.
- **Disable's file cleanup, both levels.** Besides `.mcp.json`, `agents_access_disable_in`
  always removes `.chronicle/agent/access.json`, and then tries `remove_dir` (not
  `remove_dir_all`) on `.chronicle/agent/` itself, which only succeeds if the skill left
  nothing else there, a tidy-up that is fine to fail silently otherwise.
- **`serverInfo.version` is the app's version, not the crate's.** `mcp::app_version()`
  parses `version` out of `tauri.conf.json` (`include_str!`'d in at compile time, the same
  file the app's own "About" reads), falling back to `CARGO_PKG_VERSION` only if that parse
  ever fails; `initialize`'s `serverInfo` reports that value so an agent asking an MCP
  session what it's talking to sees the same number the user sees, not `0.1.0`.
