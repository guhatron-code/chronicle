# Notes: an Obsidian-style vault replaces the kanban board

Status: approved in conversation 2026-09-09, awaiting spec review.
Supersedes: `docs/superpowers/specs/2026-09-02-fixes-and-ideas-list-design.md` (draft, never implemented).
Mock: `design/mocks-notes.html` (accepted).

## Decisions already made

| Question | Decision |
|---|---|
| Fate of the kanban's fixes rounds | Notes absorb them: a note with a status is a task; a round takes the queued notes; the agent writes status back into the note. The roadmap keeps its synthetic "Fixes & ideas" phase. |
| Where the markdown lives | Per project, hidden: `.chronicle/notes/`. |
| Editing model | Rich editor (Notion-style, slash menu, no visible markdown syntax) saving plain markdown. Built on the vendored Tiptap component (`src/components/kibo-ui/editor`) plus `@tiptap/markdown` pinned to the same version as the other Tiptap packages (3.27.3). |
| Must-have features | Wikilinks + backlinks, folders + file tree, tags + full-text search. Daily notes: no. |
| How a note becomes a task | `status` in front matter, set from the editor header. |
| Architecture | Rust owns the vault: index, commands, search. The pane is a thin client. |
| Chronigirl | Unchanged: kept, hidden by default. |
| Agent access to notes (skill, MCP server, @note mention) | Separate spec, after this one. The `@task` mention source in the composer is repointed at notes in this spec so nothing dangles. |

## The vault on disk

- `.chronicle/notes/` is the vault. Folders nest freely. A note is one `.md` file; its title is the file name without the extension. Titles are unique within a folder (the file system enforces it) and may repeat across folders.
- Migrated kanban tasks land in `Tasks/`. Nothing in the app depends on folder names.
- `.chronicle/` is committed to git in this repo today (`kanban.json` is tracked); the notes folder follows whatever the project does. The app never touches `.gitignore`.

### Front matter

Optional YAML block at the top of the file. Parsed by a small Rust reader that handles the subset the app writes: scalar strings and numbers, ISO timestamps, and flow lists of scalars (`[a, b]`). Anything it does not understand is kept verbatim, key order preserved, and written back untouched.

```yaml
---
status: queued        # queued | in_progress | done   (absent = plain note)
tags: [bug, ui]
round: 3              # set by the app when a round takes the note
created: 2026-09-09T10:12:00Z
updated: 2026-09-09T11:40:00Z
id: T-014             # only on migrated tasks
---
```

- `status` values are exactly `queued`, `in_progress`, `done`. Any other value is shown as "unknown" in the UI and ignored by rounds.
- `tags` in front matter and inline `#tags` in the body are the same set. A tag is `#` followed by `[A-Za-z0-9_/-]+`, not inside code, and not the first thing in a line followed by a space (that is a heading).
- The app writes `created` on creation and `updated` on every save. The agent may write `status` and is told to leave everything else alone.

### Links

- `[[Note title]]` links by title. Resolution: same folder first, then the nearest ancestor folder, then the whole vault; on a tie the first in path order wins and the backlink panel shows the ambiguity.
- `[[folder/sub/Note title]]` is an exact path from the vault root.
- `[[Note title|shown text]]` renders `shown text`.
- A link to a missing note renders dashed; clicking it creates the note in the current note's folder.
- Renaming or moving a note rewrites every `[[link]]` that resolved to it. Links are rewritten to the shortest form that still resolves unambiguously.
- Standard markdown links to repo files (`[x](../../src/App.tsx)`) open in the Repo pane; `http(s)` links open in the Web pane; everything else is inert.

### Attachments

Images pasted or dropped into a note are written to `.chronicle/attachments/<note-slug>-<n>.png` (reusing the existing attach command and its jail) and inserted as `![](../attachments/<file>)`. Paths are relative to the vault root so notes can move between folders without breaking. Existing task screenshots keep their files and paths.

### Migration from the kanban

Runs once, on the first heartbeat of a project where `.chronicle/kanban.json` has at least one task and `.chronicle/notes/` does not exist.

- Each task becomes `Tasks/<id> <title>.md` (title sanitised for the file system: `/ \ : * ? " < > |` become `-`, trimmed, max 80 chars). Body: the task's content, then a `## Links` list if it had links, then one `![](../attachments/…)` per image.
- Front matter: `id`, `status` (later → queued, queued → queued, blocked → queued plus tag `blocked`, in_progress → in_progress, completed → done), `round` if the task had one, `created`/`updated` from the task's epoch stamps, `tags` from the column mapping only. `archived` tasks are written to `Tasks/Archive/`.
- `rounds[]` moves to `.chronicle/rounds.json` unchanged in shape.
- `kanban.json` is renamed `kanban.json.migrated`. Never deleted. The migration is idempotent: if `notes/` exists the file is left alone.
- A toast reports "Moved N tasks into Notes".

## The Rust side

`src-tauri/src/notes.rs`, managed state `NotesState` keyed by project dir.

### Index

Per open project, in memory: for each `.md` under the vault, `{path, title, folder, status, tags, links (raw targets), resolved (target path or null), mtime, size, snippet (first 160 chars of body)}` plus a monotonically increasing `generation`.

- Built on project open by walking the vault (symlinks not followed, hidden files and `trash/` skipped, files over 4 MiB indexed by name only).
- Refreshed only when the existing project watcher reports a change under `notes/`; only files whose mtime or size changed are re-parsed. Rename detection is by path: a vanished path is removed, a new path is added.
- After a refresh the app emits `notes-changed` to the main webview with the affected paths and the new generation. The heartbeat's project payload carries the generation, so an unchanged vault costs nothing on the frontend (same discipline as today's `kanban_mtime`).

### Commands

All commands take `dir` and resolve paths inside the vault through the same canonicalise-and-prefix jail the attachment commands use. A path that escapes, or that is not `.md`, is an error.

| Command | Does |
|---|---|
| `notes_index(dir)` | Returns the index. Used at pane open and after `notes-changed`. |
| `notes_read(dir, path)` | Returns the file text. |
| `notes_write(dir, path, text)` | Creates parent folders and the file if new (stamping `created`), rewrites `updated`, writes atomically (temp file + rename). Refuses with `locked` when the note's `round` is a round whose state is `generating` or `ready`. |
| `notes_move(dir, from, to)` | Rename and move. Refuses if `to` exists. Rewrites links in every note that resolved to `from`. |
| `notes_delete(dir, path)` | Moves the file to `.chronicle/trash/<timestamp>-<name>.md`. Links to it become missing links. |
| `notes_search(dir, query)` | Case-insensitive full-text over titles and bodies. Title hits rank first, then tag hits, then body hits; each hit carries one snippet with the match. Query shorter than 2 chars returns nothing. |

Events: `notes-changed { dir, paths, generation }`.

### Rounds and the roadmap

- "Start a round" takes every note with `status: queued` and no `round`, writes their `round: N`, sets `status: in_progress`, and starts the fixes session exactly as today except for the prompt.
- The fixes prompt no longer mentions `kanban.json`. It receives `{TASKS}` as a JSON array of `{path, title, body}` and instructs the executor: "after each item is completed and verified, set `status: done` in that note's front matter (the file at `path`); change nothing else in the file".
- `settle_round` and `inject_rounds` read status from the index and round membership from `.chronicle/rounds.json`. The synthetic roadmap phase is unchanged in shape and copy except `note: "from the kanban"` becomes `note: "from Notes"`.
- Notes that a round holds are locked in the editor (header shows "locked by the round"); the lock lifts when the round is `done` or `failed`.

## The pane

Replaces the Kanban pane in the rail: id `kanban` becomes `notes` everywhere user-visible; the rail badge shows the queued count. Layout as in the mock.

- **Sidebar.** Search box (opens the ⌘⇧F overlay filtered to notes), the tree (folders collapsible, state remembered per project), status chips on task notes, a tag list with counts that filters the tree. A running round pins above the tree with per-note progress. "Start a round" lives at the bottom with the queued count and is disabled when nothing is queued or a round is open.
- **Editor.** Tiptap with the vendored kit: headings, lists, task lists, code blocks with lowlight, tables, images, typography. Slash menu for blocks. `[[` opens the link suggester (fuzzy over titles, "Create" as the last row); `#` opens the tag suggester. Wikilinks and tags are custom inline nodes serialised back to `[[…]]` and `#tag` text. Front matter is not shown in the editor; the header pill edits `status`, tags are edited in the body.
- **Header.** Breadcrumb (folder / title, click the title to rename), status pill (none / queued / in progress / done), save state ("saved · 2s ago", "saving", "locked by the round"), ⋯ menu (move, delete, reveal in Finder, copy path).
- **Footer.** Linked from (with context snippet), Links to (missing ones greyed with "not created yet").
- **Saving.** 600 ms after the last keystroke, or on blur, pane switch, project switch, and window close. A note edited on disk while open and not dirty reloads silently; if dirty, a bar offers "Reload" / "Keep mine".
- **Rows never wrap.** Names truncate with an ellipsis and marquee on hover; secondary text takes the remaining width and truncates.
- **Shortcuts** (added to the Go menu and the help overlay): ⌘N new note, ⌘⇧F search, ⌘P jump to note, ⌘] follow link under caret / ⌘[ back in note history. ⌘N replaces the kanban's ⌘N composer.
- **Energy.** No timers except the save debounce and the existing heartbeat. The pane subscribes to `notes-changed` only while on screen; off screen it refetches the index once when it returns if the generation moved.

## Touchpoints outside the pane

- Rail, icons, help content, shortcuts overlay: "Kanban" → "Notes", glyph from the mock.
- Search overlay: the "Kanban tasks" group becomes "Notes", backed by `notes_search`.
- Composer mentions: the `task` kind becomes `note` — inserts `@note:<title>` and inlines the note body at send time, same mechanism as today's task mention. The richer agent access is the next spec.
- Agent pane round card, roadmap phase detail, current-state banner: read from the index instead of the kanban store.
- Removed: `src/screens/kanban/*`, `src/lib/kanban-store.ts`, `src/components/kibo-ui/kanban`, the `kanban_get/save` commands. `kanban_attach/detach` stay, renamed `notes_attach/detach`, jail unchanged.

## Error handling

- Vault missing: created on first write, not on open. An empty vault shows an empty state with "New note".
- A file that fails to parse (bad UTF-8, unreadable) is listed by name with a warning chip and opens read-only.
- Write failures surface as a toast with the OS error and the editor keeps the unsaved text; the save retries on the next keystroke pause.
- Link rewrite on move is best-effort per file: a file that cannot be rewritten is reported in the toast and its link becomes a missing link.
- Migration failure: nothing is renamed, the toast says why, and the kanban keeps working until the next heartbeat retries.

## Testing

- Rust unit tests: front matter round-trip (unknown keys preserved), tag extraction rules, link resolution (same folder, ancestor, vault, ambiguity), link rewriting on move (all three link forms), file name sanitising, migration mapping table, jail refusals, search ranking.
- Vitest: markdown ↔ editor round-trip for every block type the pane supports plus wikilinks and tags; the ellipsis/marquee row component; the save debounce through the scheduler's fake clock; the status pill state machine.
- Live test on a signed local build: migrate this repo's real kanban, create/link/rename/move/delete notes, run a round end-to-end and watch the agent flip `status: done`, relaunch and confirm the tree state and open note come back.
