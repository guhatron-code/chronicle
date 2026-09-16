---
name: chronicle
description: Use when working in a project that Chronicle tracks: its notes, its roadmap state, and rounds. Prefer the chronicle MCP tools over grepping .chronicle/.
---

# chronicle — read and steer a project Chronicle tracks

Chronicle is the desktop app the user has open on this project. It keeps the project's
notes (tasks, bugs, ideas) in a vault, derives a roadmap from git + the manifest, and runs
work in rounds the user watches. Three groups of tools cover it; prefer them over reading
`.chronicle/` files directly — the files are an implementation detail and can change shape.

## 1 · notes — the task vault

`chronicle.notes.list` / `read` / `create` / `update` / `set_status` / `attach`. Use these
to see what is queued, read one note's full body, write a new note, edit an existing one's
front matter or body, move it between statuses, or attach a file to it. These never touch
the running app — they read and write the vault on disk, so they work even when Chronicle
isn't open.

## 2 · state — the roadmap, from evidence

`chronicle.state.phases` (every phase, its state, and what proved it), `chronicle.state.needs_you`
(what needs the user right now), `chronicle.state.rounds` (every round and each note's status
in it). **Call these before claiming what is done or what is next.** They answer from git and
the manifest's rules, not from memory or from what a note's front matter merely says — a note
marked `done` and a phase the roadmap still calls open are both real answers, and only `state`
resolves which one is current.

## 3 · actions — reaching the running app

`chronicle.round.plan`, `chronicle.round.start` (`n`, `where`: `pane` or `terminal`),
`chronicle.project.open` (`dir`), `chronicle.terminal.read` (`id?`, `lines?`). These ask the
running Chronicle to do something a person would otherwise click — plan the next round, start
one, open a project, or read a terminal's recent output. **Chronicle must be open on the
project the call targets**; if it isn't, the tool answers "Chronicle isn't open on this
project, so it can't <verb>. Open it and try again." — open it with `chronicle.project.open`
first, or ask the user to.

**Never start a round unless the user asked for one in this conversation.** Planning or
reading state is always safe; starting a round runs real work the user then watches, so it
needs their ask, not just an opportunity.

## CLI equivalents

Every tool has a shell form, useful outside an MCP session or for a quick check:

```
chronicle notes list|read|create|update|set_status|attach [--flag value ...] [dir]
chronicle state phases|needs_you|rounds [dir]
chronicle round plan [dir]
chronicle round start --n N [--where pane|terminal] [dir]
chronicle project open <path>
chronicle terminal read [--lines N] [dir]
```

Add `--json` to any of them for the same JSON a tool call returns instead of the table/plain
text a person would read. `dir` defaults to the current directory and walks up to find the
project; `project open` is the one exception — its bare argument is the folder to open, not
where the command runs.
