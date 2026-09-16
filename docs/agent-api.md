# Agent API

Chronicle's notes and roadmap state are reachable from outside the app: one Rust
implementation (`src-tauri/src/agent_api.rs`), fronted by an MCP server and a CLI. Both
answer from disk; no running app is needed for anything on this page.

## The two fronts

**MCP**: `chronicle --mcp <project-dir>` runs a stdio JSON-RPC 2.0 server. One tool per
capability, named `chronicle.<group>.<verb>`. `initialize`'s `serverInfo.version` is the
app's own version, read from `tauri.conf.json`, not the crate's.

```
$ chronicle --mcp . <<'EOF'
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"agent","version":"0"}}}
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"chronicle.notes.list","arguments":{"status":"queued","tag":"ui"}}}
EOF
```

**CLI**: `chronicle <group> <verb> [--flag value ...] [--json] [project-dir]`. Prints a
plain table by default, or the same JSON with `--json`.

```
$ chronicle notes list --status queued --tag ui
T-041  queued       3  ui   Tasks/T-041 Composer overflow.md
1 note.
```

Both fronts parse arguments through the same struct per capability, so a tool and its
subcommand cannot drift.

## Capabilities

Notes are served straight from `.chronicle/notes/`; state is derived from git and the
roadmap rules, never from memory. Neither group needs the app running.

| capability | arguments | result | CLI |
|---|---|---|---|
| `notes.list` | `status?`, `round?`, `tag?`, `text?`, `limit?` (default 200) | rows: path, id, title, status, round, tags, created, updated | `chronicle notes list --status queued --tag ui` |
| `notes.read` | `path` | front matter as a map, body text | `chronicle notes read --path "Tasks/T-012 Login.md"` |
| `notes.create` | `title`, `body?`, `folder?` (default `Tasks`), `tags?`, `status?` (default `queued`) | the new note's path and id | `chronicle notes create --title "Fix the thing" --tags bug,ui` |
| `notes.update` | `path`, `body?`, `set?` (front-matter keys to set), `unset?` | the note's new front matter | `chronicle notes update --path "Tasks/T-012 Login.md" --set status=done --unset owner` |
| `notes.set_status` | `path`, `status` | new status | `chronicle notes set_status --path "Tasks/T-012 Login.md" --status done` |
| `notes.attach` | `path`, `file` (absolute or project-relative) | the attachment's vault-relative embed and its project-relative path | `chronicle notes attach --path "Tasks/T-012 Login.md" --file screenshot.png` |
| `state.phases` | none | every phase: id, name, state, label, proof, live; plus `new_plans`, `newer_release`, `ledger_set_aside`, `manifest_present`, warnings | `chronicle state phases` |
| `state.needs_you` | none | the built-in rows the app would show, as plain sentences with their commands | `chronicle state needs_you` |
| `state.rounds` | none | every round: n, kind, state, and per note path, its status | `chronicle state rounds` |

On `notes.attach`: in a linked worktree the attachment is stored beside the borrowed
vault, in the main checkout; the app shows it when that checkout is open.

Front matter is one line per key: `notes.update`'s `set` refuses a key holding a colon or
a line break, and a value (or a `notes.create` tag) holding a line break, rather than
writing a line the note never meant to carry.

## Flag grammar

- `--tag` repeats: `--tag ui --tag bug` becomes `["ui", "bug"]`.
- `--set key=value` repeats: `--set status=done --set owner=me` becomes an object.
- `--tags a,b` is a single comma-separated flag, only on `notes create`.
- `--round N` and `--limit N` take a whole number.
- `--json` prints the same JSON the MCP tool returns instead of a table.
- A trailing bare argument, if given, is the project directory; otherwise the current
  directory is walked up to the first folder holding `chronicle.json` or `.chronicle/`.
  `project open`'s bare argument is the exception: it names the folder to open, not the
  project the shell is standing in, so it works from anywhere, and nothing above the
  shell's own directory needs to be a Chronicle project.

## Exit codes

- `0`: the call succeeded.
- `1`: the call was refused or failed (unknown status, a jailed path outside the project,
  no Chronicle project found).
- `2`: a usage error (bad flags, unknown group or verb).

## Actions

Four more capabilities ask the running app to do what its own buttons do, over a private
bridge, and hand back the sentence it answered with, so an agent and a click leave the same
trace. Chronicle must already be open on the project the call targets, except
`project.open`, whose whole point is to open one.

| capability | CLI | args | what the app does | what you see |
|---|---|---|---|---|
| `round.plan` | `chronicle round plan [dir]` | none | asks the running Chronicle to plan the next round: it picks the queued notes and writes the plan for the user to approve | the pane comes to front, a toast, and a journal line |
| `round.start` | `chronicle round start --n N [--where pane\|terminal] [dir]` | `n` (required), `where?` = `pane` (default) or `terminal` | asks the running Chronicle to start round n, in the agent pane or in a terminal tab | the pane runs it, or a `Round N` terminal tab opens; a toast and a journal line |
| `project.open` | `chronicle project open <path>` | `dir` (required; the target, not the project the shell is standing in) | opens or switches to the project at `dir` and brings the app to the front; the folder must already be a Chronicle project (`chronicle.json` or `.chronicle/`), and the app canonicalises it itself rather than trusting the caller's string | the app switches to that project, a toast and a journal line |
| `terminal.read` | `chronicle terminal read [--id N] [--lines N] [dir]` | `id?` (default: the terminal the user is looking at), `lines?` (default 200) | reads the last lines of a terminal tab's scrollback; text only, nothing is ever written to a PTY | nothing changes in the app; the caller gets the text back, plus a toast and a journal line |

`round.start`'s `where` must be `pane` or `terminal`; anything else is refused with "where
must be pane or terminal." A `terminal.read` naming a tab that belongs to another project is
refused with "Terminal N isn't in this project." rather than read.

### The bridge

The app listens on a Unix socket at `config_dir()/app.sock`, and writes a fresh token to
`config_dir()/app.token` on every launch (`config_dir()` is `~/Library/Application
Support/Chronicle` on macOS). The token file is mode 0600 and rewritten per launch, so a
stale token held by an older process is refused. Two environment variables,
`CHRONICLE_BRIDGE_SOCKET` and `CHRONICLE_BRIDGE_TOKEN`, override both paths; they are a
test-only seam, so the test suite can bind a socket without fighting a running Chronicle,
and are not meant for real use.

A request is one JSON line, `{ "token", "dir", "action", "args" }`; the reply is one JSON
line, `{ "ok", "summary", "data"? }`. `dir` must name a project the app already has open,
except for `project.open`, whose target only needs to exist and hold `chronicle.json` or
`.chronicle/`: the app resolves and canonicalises that path itself rather than trusting
what crossed the socket. An action asked for before the app's window has mounted is refused,
never queued.

When Chronicle isn't reachable, whichever front asked hears one of these, depending on the
action:

- "Chronicle isn't open on this project, so it can't plan a round. Open it and try again."
- "Chronicle isn't open on this project, so it can't start a round. Open it and try again."
- "Chronicle isn't open on this project, so it can't open a project. Open it and try again."
- "Chronicle isn't open on this project, so it can't read a terminal. Open it and try again."

The same sentence answers both cases: nothing listening on the socket at all, or the app up
but its window not mounted yet. A `dir` that resolves but isn't on the app's open-project
allowlist gets "That project isn't open in Chronicle. Open it and try again." instead. An
action name outside the four above never reaches the frontend: the socket answers "No action
named X." itself.

Every action Chronicle performs shows a toast and writes a journal line, so nothing an agent
does is silent; a refusal gets the toast only, since a thing the app declined to do is not
part of the project's history.

The newest launched app instance owns the socket: opening a second Chronicle rewrites the
token and rebinds the socket, so an older instance's requests start failing the token check.
Newest launch wins.

There are no bypass flags on any of this. The pane's permission mode governs a round exactly
as it governs a chat, and `terminal.read` can only read, never write to a PTY.

## The setup row

Setup has a row, **Let agents reach Chronicle**, that opts one project in. Turning it on:

- Merges (or creates) `.mcp.json` at the project root with a `chronicle` entry under
  `mcpServers` (`command`: the running binary's path, `args: ["--mcp", "."]`), preserving
  every other key and server already there. If `.mcp.json` exists but can't be parsed as
  JSON, enable refuses to touch it, and nothing is changed.
- Installs the `chronicle` skill at `~/.claude/skills/chronicle/`, with the same
  clobber-safe rule `chronicle-init` uses: a hand-managed copy (no `.chronicle-managed`
  marker, or one that no longer matches) is never overwritten.
- Records the opt-in at `<project>/.chronicle/agent/access.json`:
  `{ "mcp": true, "at": <epoch ms>, "createdBy": "chronicle" }` when Chronicle created
  `.mcp.json` itself; that provenance survives turning the row off and back on.

Turning it off removes only the `chronicle` server from `.mcp.json`, and deletes the file
itself only when Chronicle created it and it is now empty. The skill stays installed, since
other projects may share it.

Without the row, register the server by hand:

```json
{ "mcpServers": { "chronicle": { "command": "/Applications/Chronicle.app/Contents/MacOS/chronicle", "args": ["--mcp", "."] } } }
```
