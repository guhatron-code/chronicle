# Runs · PROGRESS

## Sub-project A · the pane (plan `docs/superpowers/plans/2026-10-14-fluid-pane.md`)

Built 2026-10-14 on `react-shadcn`, commits 660fe8a..d0c2a95 (26 after the plan), subagent-driven in
three parallel lanes with a task review per task, a whole-branch review and one fix wave. Every
code task is complete and reviewed. What follows is the closing measurement.

### How the numbers were taken

- **Before** = the plan's parent commit 660fe8a, built as a release binary in a scratch worktree
  (`/tmp/pane-before`, binary `/tmp/chronicle-before`). **After** = d0c2a95 (`/tmp/chronicle-after`).
- Session start is read from the per-session log (`$TMPDIR/chronicle-acp-<hash>.log`), which the
  after build stamps `[+ms since spawn]` on the adapter's stderr and on Chronicle's own
  `state=…` transitions. The before build has no stamps; its figures come from the adapter's own
  phase lines (durations only) and the same npx path measured on the after build.
- The app opened `/Users/tuneerguha/Downloads/chronicle` through the bridge socket each run; the
  app also reopens its remembered project on launch, so "project open → ready" could not be
  isolated and the honest metric is **spawn → ready**.
- The store-side cost of a chunk (reduce + group + row keys/signatures, no React) was measured
  with a throwaway vitest on both trees: 300-entry thread, 400 extra chunks, three runs each.

### Session start · spawn → `ready` (ms)

| Run | First adapter line | sdk-initialize (Claude Code's own start) | `ready` |
|---|---|---|---|
| After, direct launch (managed adapter) · 1 | 670 | 4137 | 4896 |
| After, direct launch · 2 | 644 | 1854 | 2622 |
| After, direct launch · 3 | 326 | 1242 | 1765 |
| After, npx path (no managed adapter) · 1 | 1570 | 1718 | 3409 |
| After, npx path · 2 | 1582 | 2533 | 4313 |
| After, npx path · 3 | 969 | 1134 | 2210 |
| Before (npx; durations only) | — | 1330 | — (session create total 1378 after the adapter was up) |

- Direct launch brings the adapter's first line to **0.3–0.7 s** after spawn, against **1.0–1.6 s**
  through npx with a warm cache (the plan's earlier `npx --help` measurement was 2.07 s cold).
- Everything after that is Claude Code initialising inside the adapter: **1.1–4.1 s** across six
  runs, outside Chronicle's control. It sets the floor for `ready`.

### Closing table (partial — the two live rows wait for a session with the user at the machine)

| Target | Before | After | Met |
|---|---|---|---|
| Warm start, project open → ready, under 1.5 s | n/a (the session started on pane mount, not at project open) | spawn → ready 1.77 / 2.62 / 4.90 s; the warm start begins at project open instead of pane mount, so the wait the user sees is shorter by the time between the two | **no** on the absolute: Claude Code's own initialise is 1.1–4.1 s |
| Cold start, pane mount → ready, under 3 s | adapter via npx (1.0–1.6 s) + session create 1.38 s ≈ 2.4–3.0 s | npx path 2.21 / 3.41 / 4.31 s; direct 1.77 / 2.62 / 4.90 s | **sometimes**: met on the fast runs, missed when Claude Code's initialise exceeds ~1.5 s |
| Chunk render cost, 300-entry thread, under 2 ms at 60 fps | store side 0.04–0.07 ms per full replay, ~0.1 µs per chunk; React render not measured | store side 0.09–0.28 ms per full replay, ~0.1–0.3 µs per chunk (signatures included); React render **pending the live session** (`__chroniclePerf()` in a dev build) | pending |
| Follow-scroll, no visible jump while following | smooth scroll restarted per row; jump per chunk (by code) | pinned in a layout effect; one glide on return (by code and 8 unit tests) | pending the live session |

### Live session still to run (with the user present)

1. `npm run tauri dev`, open a project, ask for a 1,500-word reply; `__chroniclePerf()` in the Web
   Inspector while it streams (after). The same in `/tmp/pane-before` (its profiler is patched in).
2. Scroll up mid-stream, come back; open a subagent card mid-stream; resume an earlier session
   then view another (the C1 fix); a reply with a link (opens through the app, no modal).
3. Reduce motion on: every moment instant, nothing hidden.
4. Setup & health: the connector row `missing → installing → ready 0.75.1`.
5. Then commit `docs(runs): pane live check …` — the roadmap's proof for RN-2.

## Task 3 · streaming, before/after

Superseded by the closing table above.

## Any agent, any provider (RN-4)
- 2026-10-15 · boards approved by the user ("looks good"): `design/comps/agents/project/01-Setup-agents-providers.dc.html`, `02-Pane-on-codex.dc.html`. Summary card: not asked for; today's row list stays unless the user says otherwise.
