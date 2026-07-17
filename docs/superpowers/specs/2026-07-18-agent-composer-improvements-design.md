# Agent composer improvements — design

Date: 2026-07-18
Branch: `react-shadcn`
Status: approved

Four improvements to the Chronigirl agent composer (`src/screens/agent/Composer.tsx`)
plus the terminal drop target and the ACP seam.

## Goals

1. Warn once per session before turning on **Full auto** (`bypassPermissions`).
2. **Enter** sends the message; **Shift+Enter** inserts a newline.
3. **Attachments** in the composer — added by file picker, Finder drag-drop, or
   clipboard paste — referenced to the agent by on-disk path (approach A).
4. The composer input **grows in height** with its content.
5. An attachment chip can be **Shift-dragged into a terminal** to type its
   absolute path at the shell prompt.

## Non-goals

- True ACP image/resource content blocks (approach B). The agent reads
  attachments from disk with its own Read tool. B can be added later if inline
  vision is needed.
- Persisting attachments across app restarts beyond the files themselves living
  in `.chronicle/attachments/`. The composer's in-progress attachment list is
  local component state, cleared on send.

## Current state (what exists today)

- `Composer.tsx` is hand-rolled. ⌘Enter sends; the button row shows a `⌘↩` Kbd.
- Mode control has Asks first / Works freely / Full auto. **Full auto has no
  confirmation.** "Works freely" (`acceptEdits`) confirms once per session via
  `s.worksFreelyConfirmed` + a `ConfirmDialog`.
- `AgentSessionState.worksFreelyConfirmed` resets on every new session (see
  `blank()`); `setAgentMode` sets it when switching to `acceptEdits`.
- `.chronicle/attachments/` already exists; `kanban_attach(dir, task_id, name,
  b64) -> rel_path` (Rust, `main.rs:1161`) saves a base64 file there, jailed,
  with a `safe_id-safe_name` filename.
- The ACP `prompt()` seam (`acp.rs:1117`) sends a single Text ContentBlock.
- `ptyWrite(id, data)` (`ipc.ts:337`) sends text to a terminal's PTY stdin.
- `TerminalColumn.tsx` renders each terminal; `setActiveTermFor`/`activeTermFor`
  track the focused terminal per dir.
- `sendAgentMessage(dir, text)` trims, invokes `agent_prompt`, pushes the user
  entry, flips `turnActive`.

## Design

### 1. Full-auto warning (once per session)

- Add `fullAutoConfirmed: boolean` to `AgentSessionState`; default `false` in
  `blank()` so it resets per session, mirroring `worksFreelyConfirmed`.
- In `Composer.switchMode`, when `modeId === "bypassPermissions"` and
  `!s.fullAutoConfirmed`, open a `ConfirmDialog`:
  - title: "Turn on Full auto?"
  - body: "Edits and commands both run without asking — nothing is confirmed.
    Every change still stays reviewable and undoable. This lasts for this
    session only — the next session asks first again."
  - cancelLabel: "Keep confirming"
  - confirmLabel: "Turn on Full auto"
  - onConfirm: apply the mode switch.
- In `setAgentMode`, set `s.fullAutoConfirmed = true` when
  `modeId === "bypassPermissions"` (mirrors the `acceptEdits` line).

### 2. Enter sends / Shift+Enter newline

- `textarea.onKeyDown`: if `e.key === "Enter"` and `!e.shiftKey` and
  `!e.nativeEvent.isComposing` → `e.preventDefault()` + `send()`.
- Shift+Enter falls through to the browser's default newline.
- ⌘Enter is kept as a harmless send alias (existing muscle memory).
- The `<Kbd>⌘↩</Kbd>` hint becomes `<Kbd>↩</Kbd>`.

### 3. Attachments in the composer (approach A)

- **New Rust seam** `agent_attach(dir, name, b64) -> String`. Same jail and
  dedup as `kanban_attach` but without the task-id prefix; returns the
  repo-relative path (`.chronicle/attachments/<safe_name>`, disambiguated on
  collision). Register it in the invoke handler list in `main.rs`.
- **New TS binding** in `ipc.ts`: `agentAttach(dir, name, b64)`.
- Composer local state: `attachments: { id: string; name: string; absPath:
  string; relPath: string; isImage: boolean }[]`. `absPath` is `dir + "/" +
  relPath`. `isImage` from the extension (reuse the MIME table in `ipc.ts`).
- Three add paths, all funnelling through one `addFiles(files: File[])` that
  base64-encodes each file, calls `agentAttach`, and pushes a chip:
  - **a)** A 📎 button in the button row triggers a hidden
    `<input type="file" multiple>`.
  - **b)** `onDragOver`/`onDrop` on the composer container accepts
    `e.dataTransfer.files` from Finder. (Guard: ignore drops that carry our own
    `application/x-chronicle-path` type so re-dropping a chip on the composer is
    a no-op.)
  - **c)** `onPaste` on the textarea: if `clipboardData` has image items,
    `preventDefault` and add them (synthesize a name like `pasted-<n>.png`).
- Chips render above the textarea, styled like the existing draft chip: name,
  a remove ✕ (removes from state only — the file stays on disk), and
  `draggable` (see §5). Image chips may show a small thumbnail; optional for v1.
- **Send behaviour**: `send()` enabled when `text.trim()` **or**
  `attachments.length > 0`. The body sent to `sendAgentMessage` is the typed
  text with references appended when attachments exist:

  ```
  <user text>

  Attached files:
  - .chronicle/attachments/foo.png
  - .chronicle/attachments/bar.pdf
  ```

  (If there is no typed text, the body is just the "Attached files:" block.)
  On success, clear both `text` and `attachments`.

### 4. Auto-growing input height

- Remove `rows={2}`; keep a min-height of ~2 rows and add `max-h-[200px]`
  + `overflow-y-auto`.
- A `useLayoutEffect` keyed on `text` resets `taRef.height = "auto"` then sets
  it to `scrollHeight` (clamped by the CSS max-height, past which it scrolls).
- Also recompute after a draft preload sets the text and after send clears it.

### 5. Shift-drag an attachment path into a terminal

- Chip `onDragStart(e)`: set `e.dataTransfer` `application/x-chronicle-path` =
  the **absolute** path, and `text/plain` = the same, `effectAllowed = "copy"`.
- `TerminalColumn` `onDragOver(e)`: if `e.shiftKey` and the drag types include
  `application/x-chronicle-path`, `e.preventDefault()` and set
  `dropEffect = "copy"` (this is what Shift-gates the drop — without Shift the
  browser rejects it). Otherwise do nothing.
- `TerminalColumn` `onDrop(e)`: read the path, `preventDefault`, and
  `ptyWrite(termId, shellQuote(path) + " ")` — quote only if the path contains
  spaces/shell metacharacters; a trailing space, never a newline (never runs
  anything on its own).

## Files touched

- `src/screens/agent/Composer.tsx` — modes confirm, keydown, attachments UI,
  auto-grow, chip drag source.
- `src/lib/agent-session.ts` — `fullAutoConfirmed` state + `setAgentMode` set.
- `src/lib/ipc.ts` — `agentAttach` binding.
- `src/components/chrome/TerminalColumn.tsx` — Shift-gated path drop target.
- `src-tauri/src/main.rs` — `agent_attach` command + handler registration.

## Testing / verification

- Full auto: first switch this session warns; accepting flips the mode; a second
  switch (after returning to another mode) does not warn again; a new session
  warns again.
- Enter sends a non-empty message; Shift+Enter adds a newline and does not send;
  Enter with only whitespace/no attachments does nothing.
- Attachments: picker, Finder drag, and paste each produce a chip and a file in
  `.chronicle/attachments/`; sending appends the correct references and clears
  the chips; removing a chip drops the reference.
- Height grows line-by-line up to the cap then scrolls; collapses back after
  send.
- Shift-dragging a chip onto a terminal types the absolute path with a trailing
  space and no newline; dragging without Shift does nothing; dropping onto the
  composer itself is a no-op.

## Risks / open questions

- Finder drag-drop path: in the Tauri webview, HTML5 `dataTransfer.files` should
  carry the dropped files for base64 read; if the platform delivers drops only
  via a Tauri file-drop event instead, the plan's drag-drop step adapts to that
  event but the rest of the design is unchanged.
- Large files: attachments are expected to be small (screenshots, logs). No size
  cap in v1; note it if it becomes a problem.
