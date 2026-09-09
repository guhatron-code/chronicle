# Repo pane: editing and creating files, and an honest history section

Status: approved in conversation 2026-09-10, awaiting spec review.
Related: `docs/superpowers/specs/2026-09-09-notes-design.md` (the conflict bar, the jail, the shared tree and tab strip this spec reuses).

## Decisions already made

| Question | Decision |
|---|---|
| Editor engine | CodeMirror 6. Real code editing, ~300 KB, themed from the app's tokens. Not Monaco, not a textarea. |
| Saving | Explicit: ⌘S writes the file. No autosave for code. Unsaved buffers survive tab and pane switches and are flagged on close. |
| What is editable | Any text file under the project root up to the size cap; binaries and oversize files stay view-only. Same jail as every other file command. |
| Diff view | Stays read-only. Editing happens in the Contents view; Changes keeps Keep and Undo. |
| Conflicts with the agent | The notes editor's rule: a file changed on disk while the buffer is clean reloads silently; while dirty, a bar offers Reload or Keep mine. Never a silent overwrite. |
| Explorer | New file, new folder, rename, delete to the Trash, on the shared tree component. |
| History section | Replaced by four literal lines: last save, uncommitted files, ahead/behind the remote as of the last fetch with "Check now", last publish. Milestones row dropped; a release tag on the last published commit is named inline. The five git-plumbing bugs from the 2026-09-10 audit are fixed underneath. |
| Shortcuts | ⌘S save. ⌘N is "new note" on the Notes pane and "new file" on the Repo pane. Both in the Go menu. |

## Part 1: Editing files

### The editor

- `src/screens/repo/CodeEditor.tsx` wraps CodeMirror 6: `@codemirror/state`, `@codemirror/view`, `@codemirror/commands` (default keymap, history, indent), `@codemirror/language` (bracket matching, fold gutter off by default), `@codemirror/search` (⌘F inside the editor), and language packages for what the project already shows: `@codemirror/lang-javascript` (JS/TS/JSX/TSX), `lang-json`, `lang-css`, `lang-html`, `lang-markdown`, `lang-rust`, `lang-python`, `@codemirror/legacy-modes` for shell, TOML, YAML. Every package pinned to one exact version.
- Theme: one `EditorView.theme` built from the app's CSS tokens (surface, text, hairline, selection, focus ring), plus a `HighlightStyle` mapped to the viewer's existing colour vocabulary, so the Contents view looks the same whether read-only or editable. Light and dark both come from the tokens.
- Line numbers on, wrap off (horizontal scroll inside the editor, never the page), tab size from `.editorconfig` when present, else 2. Trailing-whitespace and final-newline behaviour: leave the file as the user typed it; no automatic formatting.
- Read-only mode is the same component with `EditorState.readOnly` for files that are view-only, so the Contents view has one code path.

### The buffer model (`src/lib/repo-editor.ts`, pure)

Per open file tab: `{ path, text, savedText, mtime, state: "clean" | "dirty" | "saving" | "conflict" | "error", incoming?: {text, mtime}, error?: string }`.

- Opening a file reads it once (`read_file` returns text + mtime + size + `binary` flag); a buffer is created only when the user first edits, so read-only browsing costs nothing new.
- ⌘S on a dirty buffer: `write_file(dir, path, text, expected_mtime)` (atomic temp + rename, refuses with `changed on disk` when the file's mtime moved since `expected_mtime`). Success sets `savedText`, `mtime`, `clean`. Refusal sets `conflict` with the disk version as `incoming`.
- The project watcher already emits a change for the path. Clean buffer: reload silently. Dirty buffer: fetch the disk text; if it equals `savedText` (our own write echo) do nothing, else `conflict` with the bar. Reload replaces the buffer; Keep mine leaves the buffer and updates `mtime` so the next ⌘S wins.
- Closing a dirty tab, switching projects, or quitting with dirty buffers asks once: Save, Discard, Cancel. Pane switches never ask.
- The tab strip's dot shows `dirty`; the viewer header shows "unsaved", "saving", "saved · Ns ago", or the conflict bar.
- Undo history is per buffer and survives tab switches (the CodeMirror state is kept, not recreated).

### Rust (`src-tauri/src/main.rs`, the existing file commands' module)

| Command | Does |
|---|---|
| `read_file(dir, path)` | Existing, extended to return `{ text, mtime_ms, size, binary }`. Binary = a NUL byte in the first 8 KiB. Files over 4 MiB return `{ text: "", size, too_large: true }`. |
| `write_file(dir, path, text, expected_mtime_ms?)` | Jailed. Atomic temp + rename in the file's directory. If `expected_mtime_ms` is given and the file's mtime differs, refuse with `changed on disk`. Preserves the file's mode bits. Returns the new mtime. |
| `create_path(dir, path, kind: "file" \| "dir")` | Jailed. Refuses if it exists. Creates parents. A file is created empty. |
| `rename_path(dir, from, to)` | Jailed both ends. Refuses if `to` exists. Open tabs and dirty buffers follow the rename (frontend). |
| `trash_path(dir, path)` | Jailed. Moves to the user's Trash via the `trash` crate (Finder's Trash, restorable). Never `rm`. |

All refuse paths inside `.git/` and `node_modules/` for create/rename/trash; editing a file under `.git/` is refused too. The ACL is generated from `generate_handler!` as today.

### Explorer operations (`src/screens/repo/FileTree.tsx`, shared `Tree.tsx`)

- Header buttons: New file, New folder (the notes sidebar's 26 px icon buttons). Both act on the selected folder, or the root.
- Row context menu (right-click, and a ⋯ on hover for the selected row): Rename, Reveal in Finder, Open in Web (HTML only, as today), Delete… (confirm; goes to the Trash).
- Inline name editing for new and renamed entries, Enter commits, Escape cancels, names go through the same sanitiser the notes use, refusing `/` and leading dots.
- The tree reflects the change from the watcher; no optimistic insert.

### Shortcuts

- ⌘S: save the active buffer. In the Go menu so it works with the editor focused. On the Notes pane ⌘S flushes the note's pending save.
- ⌘N on the Repo pane: new file in the selected folder. The Go menu row stays "New Note or File" and the App keymap branches on the active pane.
- ⌘F inside the editor is CodeMirror's search; ⌘⇧F stays the project search overlay.

## Part 2: The history section

### The plumbing fixes (from the audit, all in `src-tauri/src/main.rs` and `src/lib/roadmap-data.ts`)

1. `git_in` returns stdout with only the trailing newline trimmed; callers trim per line. Fixes the first porcelain line losing its leading space (the missing-dot bug).
2. Publish state no longer reads the branch's upstream config. It resolves, in order, `@{u}`, `refs/remotes/origin/<branch>`, `origin/HEAD`; "never published" only when no remote ref contains HEAD; "not on GitHub" only when there is no remote.
3. The dirty set comes from `git -c core.quotePath=false status --porcelain -uall`, splits ` -> ` renames, and excludes `.chronicle/` runtime paths (`agent/`, `attachments/`, `journal.jsonl`, `rounds.json`, `notes/`, `trash/`, `kanban.json.migrated`).
4. Change badges map `??` → new, `A` → new, `M` → edited, `D` → deleted, `R` → renamed.
5. The publish notification fires only from the push command's own success result, never from a counter delta.
6. The panel reads `git_degraded` and shows "Can't read git" instead of "No history yet".
7. The "saves" number is dropped from the panel (the detail pane's graph keeps its own count).

### The panel (`src/screens/roadmap/HistoryPanel.tsx`)

Four lines, each a fact with a time, nothing computed by subtraction:

| Line | Source |
|---|---|
| **Last save** · `3 hours ago · "fix(notes): …"` | `git log -1 --format=%ct%n%s HEAD` |
| **Uncommitted** · `5 files` (expandable list with the badge words above; "Everything saved" when zero) | the fixed dirty set |
| **Remote** · `2 ahead · 0 behind origin/react-shadcn · checked 20 min ago` with a **Check now** button; `no remote` or `never published` per rule 2 | `git rev-list --left-right --count <remote-ref>...HEAD`; the checked time is the last `git fetch` Chronicle ran (stored per project in app support), "never checked" until the first click |
| **Last publish** · `3 weeks ago · v0.7.0` | committer date of the newest commit reachable from any `origin/*` ref; the release tag named when one points at that commit (`git tag --points-at`) |

- **Check now** runs `git fetch --prune origin` once, then recomputes. Nothing fetches on a timer, on a heartbeat, or on pane open. If the fetch fails (offline, auth) the line shows the error sentence and the old numbers stay with their old time.
- "View details" keeps opening the Repo pane's history view.
- The section refreshes with the existing heartbeat and watcher; it never polls on its own.

## Energy

- No new timers. The editor's CodeMirror instance is created on first edit and disposed when the tab closes.
- The watcher already covers the repo; buffers react to its events, no polling.
- Fetch only on explicit click.

## Error handling

- Write failure (permissions, disk): toast with the OS sentence, buffer stays dirty.
- `changed on disk`: the conflict bar, never a toast.
- Binary or oversize: the viewer's existing "binary" and "too large" bodies, with no edit affordance.
- Rename/create collisions: inline error under the name field, nothing created.
- Trash unavailable (network volumes): refuse with a sentence; never fall back to `rm`.

## Testing

- Rust: jail refusals for every new command (absolute, `..`, symlink, `.git/`), atomic write + mtime precondition, mode bits preserved, binary sniff, size cap, trash on a temp dir, `git_in` first-line integrity on porcelain output with a leading space, publish-state resolution with and without `@{u}`, dirty-set exclusions and rename splitting, badge mapping.
- Vitest: the buffer state machine (edit → save → clean; edit → disk change → conflict; Reload; Keep mine; own-write echo ignored; rename follows), `.editorconfig` tab size, the four history lines' formatting from fixture payloads including degraded git and no remote.
- Live test on a signed local build: edit and save a file, watch a terminal `echo >> file` produce the bar, rename an open file, create and trash a file from the explorer, ⌘N/⌘S from a focused editor, the history lines on this repo (which was wrong in every line before), Check now offline and online.

## Live test

Run 2026-09-10 on a signed local bundle against a throwaway rsync copy of this repo (branch `repo-editing`, no remote branch of its own, 120 commits ahead of `origin/main`, four human uncommitted files once `.chronicle/` runtime paths are excluded).

| Check | Result |
|---|---|
| History panel vs `git`: last save with subject; "4 files" uncommitted; "120 ahead · 0 behind" against the resolved remote ref; last publish 2 weeks ago | pass (matched the git facts read beside it) |
| "checked never" wording on the Remote line before the first Check now | pass after fix (read "checked never checked") |
| Editing a file in the Contents view: syntax colours, "unsaved" in the header, dirty dot on the tab, ⌘S → "saved · Ns ago" | pass (observed in the window) |
| Contents/Changes toggle at the right end of the bar; an empty Changes view says "No changes since the last save." | fixed during the test; not re-observed on a modified file |
| Conflict bar (Reload / Keep mine) on an external write; rename/trash from the explorer; ⌘N per pane; Save / Discard / Cancel on close and quit; Check now online and offline | not exercised by the controller (keyboard steps are the user's); covered by the store, mapper and Rust tests listed under Testing |

Found during the test: the Contents/Changes toggle sat mid-bar; the Changes view rendered nothing for a file git has no diff for (gitignored `.sign.env`); "checked never checked".
