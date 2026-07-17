# Agent chat enhancements — design

Date: 2026-07-18
Branch: `react-shadcn`
Status: approved

Four independent enhancements to the Chronigirl agent chat, sharing the agent
surface (`src/screens/agent/*`, `src/lib/agent-session.ts`).

## Goals

1. **Live plan/todo card** — render the ACP `plan` sessionUpdate as a checklist
   that updates in place in the thread.
2. **Effort selector** — a picker for the agent's advertised `effort` config
   option, beside the model picker.
3. **Inline side-by-side diffs** — edit tool cards expand to show the actual diff
   in the chat, like execute output already expands.
4. **Message queuing** — while the agent works, messages queue and auto-send one
   at a time when the turn ends (Claude Code behaviour).

## Non-goals

- Sub-agent (Task-tool) fan-out visualization — the adapter surfaces sub-agents
  as ordinary `kind:"other"` tool calls; no fan-out structure exists in the
  stream. Out of scope (the user chose the plan-list approach).
- Attachments in queued messages — queue is text-only in v1. (Attachments in the
  composer shipped in the prior branch; queuing them is a later extension.)
- New pickers for the other advertised selects (`fast`, `agent`) — only `effort`
  is requested.

## Grounding (verified against local transcripts in `.chronicle/agent/`)

- The adapter advertises config options `mode`, `model`, **`effort`**
  (`category: "thought_level"`), `fast`, `agent`. The existing `ModelPicker`
  (`Composer.tsx:31`) reads the `model` option via the generic
  `configOptions` array; `effort` is present and read the same way.
- No `plan` sessionUpdate appears in the captured transcripts (the agent never
  used its todo tool in them). The `plan` update is the documented ACP mechanism
  for Claude Code's TodoWrite list; #1 must be verified against a live session
  that writes todos.
- Observed sessionUpdate kinds: `agent_message_chunk`, `tool_call`,
  `tool_call_update`, `usage_update`, `config_option_update`,
  `available_commands_update`, `session_info_update`.
- `parseDiff(raw): { rows: DiffRow[]; added; removed }` exists in
  `src/lib/repo-data.ts:112`. `DiffRow` = `{ kind:"hunk"; header; context? }` or
  `{ kind:"ctx"|"add"|"del"; old?; new?; text }`. The repo pane renders these
  *unified*; #3 needs a new side-by-side renderer over the same rows.
- `agentEditDiff(dir, abs): Promise<string>` (`ipc.ts:439`) returns the agent
  ledger's unified diff for a file, keyed by absolute path.
- Tool entries carry `detail` (project-relative path for edits). Absolute path =
  `` `${dir}/${detail}` `` (the same construction used elsewhere).

## Design

### #1 — Live plan/todo card

- **Reducer** (`agent-session.ts`, `reduceInto`, `session/update` branch): add a
  case for `kind === "plan"`. The ACP plan update carries `entries: { content,
  priority, status }[]` where `status ∈ {pending, in_progress, completed}`.
- **New entry kind**: `{ kind: "plan"; items: { text: string; status:
  "pending"|"in_progress"|"completed" }[] }`.
- **Update in place**: find the last `plan` entry; if one exists, replace its
  `items`; otherwise push a new `plan` entry. (One evolving list per plan; a
  brand-new plan after a prior one still updates the last plan entry — matches
  Claude Code's single-list behaviour.)
- **Render** (`AgentPane.tsx` entry switch + a small `PlanCard`): a card using
  the round-card chrome (`rounded-[10px] border bg-surface-card-raised`), one row
  per item: completed → success check, in_progress → spinner, pending → hollow
  dot; item text in `text-[12.5px]`. Completed items dim.
- **Transcript replay**: because the reducer is the single reduce path, stored
  `plan` updates replay into the same card automatically (F37 history).

### #2 — Effort selector

- **`EffortPicker`** in `Composer.tsx`: a near-copy of `ModelPicker`, reading
  `s.configOptions.find(o => o.id === "effort")`. Returns `null` when absent or
  empty (same guard as the model picker). Selecting calls
  `setAgentConfigOption(dir, "effort", value)`.
- Render it immediately to the right of `<ModelPicker>` in the composer button
  row (both hidden while `disabled`).
- To avoid duplicating the dropdown shell, extract the shared menu-button markup
  into one small `ConfigSelect({ dir, optionId, title })` used by both the model
  and effort pickers. `ModelPicker` becomes `ConfigSelect` with `optionId="model"`;
  the effort picker is `optionId="effort"`. (Keeps behaviour identical, removes
  copy-paste.)

### #3 — Inline side-by-side diffs

- **`ToolCard`** (`ToolCard.tsx`): for edit/delete/move kinds with a `diff`,
  render the existing `+N −M` badge collapsed, plus a **"Show the diff" / "Hide
  the diff"** toggle (mirroring the existing "Show the output" control). The old
  external `onViewChanges` button is not used in the thread (already unwired).
- **Lazy fetch on expand**: on first expand, call `agentEditDiff(dir,
  \`${dir}/${tool.detail}\`)`, `parseDiff(raw)`, then transform rows → side-by-side
  and cache in component state. Loading and empty/failed states render a one-line
  note ("No diff to show" / "Couldn't load the diff"). `dir` is passed into
  `ToolCard` (new prop) from `AgentPane`.
- **Rows → side-by-side transform** (new pure helper, `repo-data.ts`,
  `sideBySide(rows: DiffRow[]): { left: Cell; right: Cell }[]` where `Cell =
  { n?: number; text: string; kind: "ctx"|"add"|"del"|"empty" }`): context rows
  fill both columns; a run of `del` rows pairs against the following run of `add`
  rows (index-aligned, padding the shorter side with `empty` cells); hunk headers
  become a full-width separator row.
- **Renderer** (`ToolCard`-local `DiffSideBySide`): two mono columns (old | new),
  del cells tinted red, add cells tinted green, per-column line-number gutters,
  same `max-h`/scroll treatment as the output block, with horizontal scroll for
  long lines. Reuses the tint/gutter classes from `Viewer.tsx`'s diff rows.

### #4 — Message queuing

- **Session state**: add `queue: string[]` to `AgentSessionState` (default `[]`
  in `blank()`).
- **Enqueue** (`agent-session.ts`): `enqueueAgentMessage(dir, text)` pushes a
  trimmed message and notifies. `dequeueAgentMessage(dir, index)` removes one.
- **Composer**: during an active turn the button row currently shows **Stop**
  (not Send), and the textarea stays editable. Keep Stop. Add queuing two ways
  that both call `enqueueAgentMessage(dir, text)` then clear the input:
  - Pressing **Enter** while `s.turnActive` enqueues (the `onKeyDown` handler
    branches on `s.turnActive`).
  - A small **"Queue"** button appears next to Stop while `s.turnActive && text.trim()`.
  When no turn is active, behaviour is unchanged (Enter/Send send immediately).
- **Render queued messages** (`AgentPane`): below the thread / above the composer,
  a stack of pending user bubbles (dim, "queued" tag) each with a cancel ✕ that
  calls `dequeueAgentMessage`.
- **Auto-flush** (`agent-session.ts`, in the `_chronicle/turn_end` handler after
  `turnActive` is cleared): if `queue.length`, shift the first message and
  `void sendAgentMessage(dir, next)`. FIFO, one per turn — each flushed message
  starts its own turn, so the next flush happens on the following `turn_end`.
- Cancelling a turn (`Stop`) does **not** auto-flush beyond the normal turn_end
  path; the queue persists so the user can still cancel individual items.

## Files touched

- `src/lib/agent-session.ts` — `plan` entry kind + reducer case (#1); `queue`
  state, `enqueueAgentMessage`/`dequeueAgentMessage`, turn_end auto-flush (#4).
- `src/screens/agent/AgentPane.tsx` — `PlanCard` render (#1); pass `dir` to
  `ToolCard` (#3); queued-bubbles stack (#4).
- `src/screens/agent/ToolCard.tsx` — "Show the diff" toggle + lazy fetch +
  `DiffSideBySide` renderer (#3).
- `src/screens/agent/Composer.tsx` — `ConfigSelect` extraction + `EffortPicker`
  (#2); queue-aware send/Enter + "Queue" label (#4).
- `src/lib/repo-data.ts` — `sideBySide` transform helper (#3).

## Testing / verification

- **#1**: replay a transcript that contains a `plan` update (or drive a live
  session that writes todos) → a checklist card appears and updates in place;
  item statuses map to check/spinner/hollow; completed items dim.
- **#2**: with an adapter advertising `effort`, the picker shows the levels,
  selecting one calls config set and the current value ticks; hidden when the
  option is absent.
- **#3**: an edit tool card shows `+N −M`; "Show the diff" expands a side-by-side
  view (old left / new right, red/green), collapses again; a path with no ledger
  diff shows the empty note; typecheck clean.
- **#4**: while the agent works, typing + Enter queues (bubble appears, input
  clears, Send read "Queue"); cancel ✕ removes a queued item; when the turn ends,
  the first queued message sends automatically and the rest remain queued;
  queuing while idle is unchanged (immediate send).

## Risks / open questions

- **#1**: the `plan` update was not observed locally; if the adapter does not
  emit it, the card simply never appears (no regression). Confirm against a live
  todo-writing session before claiming it works.
- **#3**: `agentEditDiff` returns the file's cumulative ledger diff, which for a
  file edited multiple times shows all changes to that file, not just this one
  tool call. Acceptable and honest for v1 ("the changes to this file"); note it
  if per-call granularity is later wanted.
- **#4**: a queued message that becomes invalid mid-wait (e.g. session ends) is
  dropped on flush by the normal `sendAgentMessage` guard; queued items are not
  persisted across app restart (in-memory only), matching the composer draft.
