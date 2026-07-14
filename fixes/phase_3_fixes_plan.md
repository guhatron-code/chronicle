Round kind: bug fixes

# Round 3 — the P2/P3 sweep from the production-readiness audit

The full item list with repro/expected/file:line lives on each task card
(T-014..T-064) — this round executes all of them, grouped:

1. Backend seams: session start times in init/fixes status (honest elapsed);
   kanban_detach for attachment cleanup.
2. Honesty cluster: FX now-status, no fabricated "Being worked on", all-done
   copy, agent-aware copy everywhere, round strip names the right round and
   can close, board refresh around execute/cancel.
3. Dialog behavior: composer/execute overlays close on Escape and scrim,
   carry role=dialog, and stop blocking the rail.
4. Shell reconciliation: window title, Updated badge, pane preservation,
   palette ⌘1-9, home screen marks open projects, writing card, ⌘L,
   just-switched decay, Enter/create guard, badge-tab close.
5. Repo: roots count + top-level tint, huge-card copy, status-failure banner,
   auto-include save, tab/tree selection sync, root group label, empty log,
   tab truncation, inset bar, dup keys, animated tree.
6. Cleanups: dead code (FxCard, wv-dash, dead props), key indexes, celebrate
   moment, custom_actions.level, View-full-log dedupe, terminal re-theme.

Tracking contract: as each item is completed AND verified, its task's column
flips to "completed" in .chronicle/kanban.json.
