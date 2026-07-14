# Execute round 2 — the twelve P1 audit fixes

Read `fixes/phase_2_fixes_plan.md` and execute every item, in order. For each:
work on branch react-shadcn of this repo, keep the fix local to the files the
plan names, run `npm run build` (and `cargo test` in src-tauri for backend
items) until clean, and verify with the Playwright harness the way the plan
describes before moving on.

After each item is completed AND verified, edit `.chronicle/kanban.json` and
set that task's "column" to "completed" (match by task id; touch "updated_at"
with epoch ms; change nothing else in the file) — this is how the board and
the roadmap track the round live.

Report per-item outcomes honestly: fixed-and-verified, or what blocked you.
Do not change any other file.
