# Fixes & ideas — the kanban becomes a list

**Date:** 2026-09-02
**Status:** draft, awaiting review
**Scope:** the third sidebar surface (today "Kanban") and every place that names it

## Why

The kanban is load-bearing: Chronicle itself was built through it (139 tasks across 7
rounds, every round a phase on the roadmap). But the *board* is not. Live data from this
project's own `.chronicle/kanban.json` says what the four human-facing lanes are worth:

| Lane | Tasks that ever sat in it |
|---|---|
| Later | 0 |
| Blocked | 0 |
| Archived (the composer's Archive button) | 0 |
| Design links (the composer's link field) | 0 |

Every task went Queued → In progress → Completed, moved by the round, never by hand. The
drag-and-drop, five columns, and a segmented column control in the composer are a generic
project-tool shape that sits against three of the product principles: *one glance, one next
step*, *no dashboard density*, and *consistency over surprise*. What actually earns the
surface its place is two things: **writing something down fast (with a screenshot)** and
**turning the pile into a round**.

This design keeps those two things and removes the board.

## What stays exactly as it is

- **The data file.** `.chronicle/kanban.json`, its task shape, `column`, `round`, `archived`,
  `rounds[]`, `next_id`. The `column` field is a protocol with the executing agent (the fix
  prompt tells it to set `"column": "completed"` per task), and `settle_round` /
  `inject_rounds` derive round truth from it. Nothing here changes.
- **The backend.** `kanban_get/save/attach/detach`, `fixes_generate/status/cancel`,
  `round_execute/exec_status/exec_cancel`, `round_retro`, the fix prompt. Only two
  user-facing strings in `inject_rounds` change (see Naming).
- **The round flow.** Pre-flight → generating (streamed log, Cancel) → done card with the
  three ways to run it. `ExecuteFlow.tsx` is untouched apart from copy.
- **The roadmap overlay.** Rounds are phases; each task is a step that ticks live.
- **Search.** ⌘K search still lists tasks and opens one in the composer.
- **⌘N** writes one down from anywhere the surface is up.
- **The eligibility rule.** A task joins the next round iff `column === "queued"`,
  `round == null`, and not archived. `queuedCountFor` is unchanged and still feeds the rail
  badge.

## Naming

The surface is called **Fixes & ideas** everywhere a person sees it. That is already the
board's own title, so the vocabulary is not new. The unit stays a **task** (the roadmap,
the agent's round card, and the fix prompt already say "6 tasks").

Internal names do not change: the `kanban` pane id, `src/screens/kanban/`, the store, the
IPC commands, and the on-disk file. Renaming them buys nothing a user can see and the file
name is part of the agent protocol.

User-facing strings that change:

| Where | Today | After |
|---|---|---|
| Rail label / tooltip | Kanban · "Kanban — 3 tasks queued" | Fixes & ideas · "Fixes & ideas — 3 noted" |
| Rail glyph | `KanbanGlyph` (three columns) | a new list glyph (three short rules, all-SVG like the rest of `icons.tsx`) |
| Roadmap phase badge | "From the Kanban · 6 tasks" | "Fixes & ideas · 6 tasks" |
| Synthetic stage note (`inject_rounds`) | "from the kanban" | "from Fixes & ideas" |
| Synthetic phase desc (`inject_rounds`) | "6 tasks from the kanban, frozen into…" | "6 tasks from Fixes & ideas, frozen into…" |
| Roadmap all-done CTA | "Add what's next in the Kanban" | "Write down what's next" |
| Agent round card | "Open the board ›" | "Open Fixes & ideas ›" |
| Roadmap toasts | "Check the board — …", "…stay on the board" | "…are ticked in Fixes & ideas", "…are still in Fixes & ideas" |
| Help shortcuts | "Cycle Roadmap · Repo · Kanban" | "Cycle Roadmap · Repo · Fixes & ideas" |
| README | the "kanban" bullet | rewritten for the list |

## The surface

One column, full width of the content pane. Top to bottom:

### Header row

`Fixes & ideas` · mono `4 noted` · `Start a round — 4 noted` (secondary, disabled at 0) ·
`+ Write one down ⌘N` (primary). Same measures as the current header row.

### The open round (only while one exists)

Shown when `executingRound(store)` is non-null, i.e. a round is generating, or is `ready`
with at least one task not completed. A card, not a lane:

- Title: `Round 8 · 5 tasks` and a state word from the same rule the board uses today
  (`generating` → "being planned", `ready` + exec live → "running", `ready` + not live →
  "waiting to run"). A mono `3 of 5 done` line and the 3px neutral progress bar the agent's
  round card already draws.
- Under it, the round's tasks as rows: completed rows struck with a check, the rest with
  the lock glyph and "locked until the round finishes". No drag. A hover action on every
  unfinished row while the round is not live: **Take it out of the round** — sets
  `column = "queued"`, `round = null` (the human override that drag-out provides today, as
  a button). Today an unfinished task sits in "In progress" forever until dragged; this
  gives it a way home.
- When the round is `ready`, not live, and `roundExecStatus` reports it *did* run in this
  app session (`started: true`, `running: false`): the state word is "stopped early · 2
  left". After an app restart that knowledge is gone and the word falls back to "waiting to
  run"; the row action is the same either way, so nothing is lost but the adjective.
- The explainer line stays: "— new tasks start round 9."

### The list

Tasks with `column === "queued"` and `round == null`, newest first. Each row: id chip,
title, one-line content preview, up to two 34×24 thumbs (+n), the mono ago stamp. Click
opens the composer. Rows are buttons, so Tab/Enter work without extra keyboard code.

Hover action: **Hold for later** — sets `column = "later"`. This is the one lane worth
keeping, because "freeze everything queued" needs a way to say *not this one* without
deleting it. It is a per-row state, not a column.

Empty state (no tasks, no round): the existing dashed well, "Write down a bug or an idea —
⌘N", centered in the pane.

### Held for later

A collapsed group at the bottom, `Held for later · 2`, only when non-empty. Expanding shows
the same rows with the action **Back to the list** (`column = "queued"`). A legacy task in
`blocked` is displayed in this group too (there are none in the wild, but the file format
allows it); its row says "was marked blocked". No migration is written to disk.

### Footer

One muted line when there is any completed task: `139 done across 7 rounds · on the
roadmap ›`. Completed tasks do not appear in the list. Their home is the roadmap, where
each round is a phase and each task a step, and search still opens any of them read-only.

## The composer

Same dialog, three subtractions and one addition:

- **Remove** the column segmented control. Replace with one checkbox under the content
  field: `Hold for later — won't join the next round` (maps to `later` / `queued`). Hidden
  for a task that is in a round or completed.
- **Remove** the Design link field and chips input. Existing `links` on a task still render
  as read-only chips so nothing already written is hidden. The data field stays.
- **Remove** the Archive button. Delete (with its confirm) is the only removal. The
  `archived` flag stays honoured in every filter for files that already carry it.
- **Remove** the decorative B/I/</>/list toolbar; it has never done anything.
- Title `Write one down` / `Edit task`; save button `Add` / `Save`.

Screenshot attach (picker, Finder drag, paste) is unchanged.

## Starting a round

`Start a round — 4 noted` opens the existing pre-flight card. Copy: "Turn 4 noted tasks
into a fix plan?" and the rest as today. Held-for-later tasks are not counted and do not
freeze, which is the current `queued`-only rule, just now visible.

## What is deleted

- `Board.tsx`, the five-lane grid, `COLUMN_ORDER`, `COLUMN_LABELS`, the HTML5 drag wiring
  in `KanbanPane.tsx` (`draggingId`, `dropColumn`, `moveTask` via drop, the lane handlers),
  and every `draggable`/`dragging`/`dimmed` state on the card.
- `TaskCard.tsx` becomes `TaskRow.tsx`: default, locked, completed variants only.

## Files

| File | Change |
|---|---|
| `src/screens/kanban/List.tsx` | new — header, open-round card, list, held group, footer |
| `src/screens/kanban/TaskRow.tsx` | new — replaces `TaskCard.tsx` |
| `src/screens/kanban/Board.tsx` | deleted |
| `src/screens/kanban/Composer.tsx` | subtractions above, the hold checkbox |
| `src/screens/kanban/KanbanPane.tsx` | drag wiring out; `hold` / `release` / `takeOut` mutations in; polls `roundExecStatus` for the stopped-early word (it already does for the strip) |
| `src/screens/kanban/types.ts` | drop `COLUMN_ORDER`/`COLUMN_LABELS`; keep `TaskColumn` |
| `src/components/chrome/Rail.tsx`, `icons.tsx` | label, tooltip, new glyph |
| `src/screens/roadmap/CurrentStateBanner.tsx`, `RoadmapPane.tsx`, `src/lib/roadmap-data.ts` | copy |
| `src/screens/agent/AgentPane.tsx` | "Open Fixes & ideas ›" |
| `src/lib/help-content.ts` | shortcut label; the glossary gains "Fixes & ideas" |
| `src-tauri/src/main.rs` | two strings in `inject_rounds` (the overlay unit test asserts ids, names and paths, not these strings) |
| `README.md` | the bullet |

## Testing

There are no frontend tests in this repo; verification is:

- `npm run typecheck` clean.
- `cargo test` in `src-tauri` clean. The overlay test checks the synthetic stage's shape,
  not the two strings that change, so it should pass without edits.
- `test/golden.sh` still passes. Neither bundled example has a `.chronicle/kanban.json`,
  so the overlay never runs for them.
- Manual, in the dev app (`npm run tauri:dev`) on this repo, which has 7 settled rounds
  and one blank queued task:
  1. The rail shows Fixes & ideas with a badge of 1; the list shows T-140; the footer says
     139 done across 7 rounds and lands on the roadmap.
  2. ⌘N → write one down with a pasted screenshot → it appears at the top of the list.
  3. Hold for later → it moves to the held group and the badge drops; Back to the list
     restores it.
  4. Start a round → pre-flight counts only listed tasks → generating → done card → the
     round card appears at the top with locked rows; Take it out of the round returns one.
  5. Run the round for me → rows tick as the agent completes them; the roadmap phase
     shows the same ticks.
  6. Cancel the round mid-way → the state word reads stopped early, unfinished rows offer
     Put it back in the list.
  7. ⌘K search a completed task → its composer opens read-only.

## Not in this change

- Any change to the fix prompt, the executor contract, or the file format.
- Keyboard arrow navigation within the list (rows are focusable buttons already).
- A roadmap summary of the list ("4 things noted") — placement decision was the rail entry
  only.
- Bulk actions, tags, priorities, or ordering by hand.
