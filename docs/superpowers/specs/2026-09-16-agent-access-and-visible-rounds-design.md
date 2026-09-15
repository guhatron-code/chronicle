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
| `state.phases` | every phase: id, name, state, label, `proof?`, `live`; plus `new_plans`, `newer_release`, `stale`, warnings — the `--derive` shape, never latching (write = false) |
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
  message. The card shows "Writing the plan…" until `fixes/phase_N_fixes_plan.md` and the
  prompt file appear on disk, which the existing file watcher already reports; then the
  round is `ready`. If the turn ends without both files, the card says so and offers to
  try again.
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
