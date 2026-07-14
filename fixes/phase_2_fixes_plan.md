Round kind: bug fixes

# Round 2 — the twelve P1s from the production-readiness audit

Every item carries its task id, the defect, the precise fix, and how it is verified.
Executable without questions; each item is independent unless noted.

## Terminals & kanban

1. **T-002 · Hidden terminal tabs get resized to ~10×6, corrupting live sessions**
   Fix: `src/lib/term-sessions.ts` `fitTerm` — bail when the host box is zero-sized
   (`host.clientWidth/clientHeight === 0`), so a `display:none` tab never fits nor
   sends `pty_resize`. Verify: probe — hide a tab, assert no resize call with cols < 20.

2. **T-003 · Screenshot thumbnails never render (dead `thumbFor` pipeline)**
   Fix: `src/screens/kanban/KanbanPane.tsx` — map task/composer image paths through
   `thumbFor(dir, path)` (data-URI cache, already notifies on load); fall back to the
   glyph while loading. Verify: probe — after `kanban_attach`, an `<img src="data:` renders.

3. **T-004 · Cancelling a generating round strands tasks locked in In progress**
   Fix: `src-tauri/src/main.rs` `fixes_cancel` — when popping the round, restore each
   claimed task to `column: "queued"` and clear `round`. Verify: rust test + probe.

4. **T-005 · A failed generation strands tasks while the toast says they're untouched**
   Fix: `src-tauri/src/main.rs` `settle_round` failed branch — release the round's
   tasks (`column: "queued"`, `round: null`); the round record keeps `state: "failed"`
   for history. Verify: rust test + probe (failed status → tasks back in Queued).

5. **T-006 · Round completion only detected while the right pane is watching**
   Fix (two seams): `src/App.tsx` `pollOne` — when the kanban store has a generating
   round, fire `fixesStatus(dir)` (its handler runs `settle_round` server-side);
   `src/screens/kanban/KanbanPane.tsx` — on mount/store change, if a round is
   generating and the flow is idle, resume the generating overlay. Verify: probe —
   switch panes mid-generation, return, overlay resumed; settle happens via App poll.

6. **T-007 · "Ready to execute" counts one set and executes another**
   Fix: `src/screens/kanban/Board.tsx` — the header count uses the same eligibility
   as execution (`column === "queued" && round == null`); disabled at 0 eligible.
   Verify: probe — a stale rounded task in Queued doesn't count.

## Roadmap

7. **T-008 · Phase detail page cannot scroll**
   Fix: `src/screens/roadmap/PhaseDetail.tsx` — the detail body becomes
   `overflow-y-auto`. Verify: probe — tall content scrolls; last section reachable.

8. **T-009 · Misplaced-manifest "Leave it" is a permanent dead end**
   Fix: `src/lib/roadmap-data.ts` — the `consent === "basic"` branch moves ABOVE the
   misplaced and scan-failed branches, so choosing the basic view always wins.
   Verify: probe — misplaced state + Leave it → the basic-view card renders.

## Repo

9. **T-010 · Reload in Diff mode loads Contents under a Diff label**
   Fix: `src/screens/repo/RepoPane.tsx` `onReload` — branch on `active.mode` exactly
   like `onRetry`. Verify: probe — diff + mtime bump + Reload → diff body, fresh stat.

10. **T-011 · Behind-only repo claims "Everything is published" and hides Bring down**
    Fix: `src/lib/repo-data.ts` `publishStateFrom` — `ahead === 0 && behind > 0` maps
    to a new `behind` footer state ("The online copy is N saves ahead" + Bring down);
    `src/screens/repo/HistoryPane.tsx` renders it (no Publish button — there is
    nothing to publish). Verify: probe — ahead 0 / behind 3 shows Bring down.

## Shell

11. **T-012 · Global shortcuts fire inside text fields**
    Fix: `src/App.tsx` keyboard map — when the event target is an input/textarea,
    ignore ctrl-only chords (they are native editing keys); ⌘ chords keep working
    (macOS convention — ⌘K must still toggle the palette from its own input).
    Verify: probe — Ctrl+W in the palette input edits text, project stays open.

12. **T-013 · With 5+ projects the active project can have no tab**
    Fix: `src/components/chrome/TitleBar.tsx` — the visible window always contains
    the active tab (swap it in over the last visible slot when it falls outside).
    Verify: probe — 5 projects, 5th active → its tab visible, "+1 more" intact.

## Tracking contract
As each item is completed AND verified, set that task's `column` to `"completed"`
in `.chronicle/kanban.json` (match by id, touch `updated_at`, change nothing else).
