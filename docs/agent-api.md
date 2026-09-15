# Agent API

Chronicle's notes and roadmap state are reachable from outside the app: one Rust
implementation (`src-tauri/src/agent_api.rs`), fronted by an MCP server and a CLI. Both
answer from disk; no running app is needed for anything on this page.

## The two fronts

**MCP**: `chronicle --mcp <project-dir>` runs a stdio JSON-RPC 2.0 server. One tool per
capability, named `chronicle.<group>.<verb>`.

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

## Flag grammar

- `--tag` repeats: `--tag ui --tag bug` becomes `["ui", "bug"]`.
- `--set key=value` repeats: `--set status=done --set owner=me` becomes an object.
- `--tags a,b` is a single comma-separated flag, only on `notes create`.
- `--round N` and `--limit N` take a whole number.
- `--json` prints the same JSON the MCP tool returns instead of a table.
- A trailing bare argument, if given, is the project directory; otherwise the current
  directory is walked up to the first folder holding `chronicle.json` or `.chronicle/`.

## Exit codes

- `0`: the call succeeded.
- `1`: the call was refused or failed (unknown status, a jailed path outside the project,
  no Chronicle project found).
- `2`: a usage error (bad flags, unknown group or verb).

## What is not here yet

Actions (planning and starting a round, opening a project, reading a terminal) and
`.mcp.json` registration through Setup arrive in plans 2 and 3. Until then, register the
server by hand:

```json
{ "mcpServers": { "chronicle": { "command": "/Applications/Chronicle.app/Contents/MacOS/chronicle", "args": ["--mcp", "."] } } }
```
