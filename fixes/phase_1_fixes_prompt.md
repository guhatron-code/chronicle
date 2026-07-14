# Phase 1 Fixes — Execution Prompt

You are executing a fix round for the Chronicle app (Tauri 2 + React/TS, repo root = this directory).

## Instructions

1. Read `fixes/phase_1_fixes_plan.md` in full before touching any code. It contains the complete, ordered list of fix items with file paths, line references, and root-cause analysis. Treat it as the source of truth for scope.

2. Execute **every** item in the plan, in the order given (T-001.1 → T-001.4). Do not skip items, do not add unrequested refactors, and do not touch files outside the scope each item names. If a line number in the plan has drifted, locate the referenced code by the symbol/content described, not by guessing.

3. Verify each fix like a shipping change, not a code review:
   - Compile both sides: `cargo check` inside `src-tauri/`, and `npx tsc --noEmit` (or `npm run build`) at the repo root. Both must pass cleanly.
   - Run the real app (`npm run tauri dev`) and exercise the actual user flow the bug describes: double-click the title bar and the picker drag strip, watch the maximize/restore transition, click the zoom buttons, double-click interactive children to confirm the opt-outs, and drag the window to confirm the drag region survived.
   - Take screenshots of the restored and zoomed window states where a screenshot can capture the outcome. The animation itself can't be screenshotted — for that, state plainly what you observed while the app was running (animated vs. snap).
   - If you cannot run the app in your environment, say so explicitly in the report — do **not** claim visual verification you didn't perform.

4. If an item's prescribed approach fails in practice (e.g. `zoom:` is a no-op), use the fallback the plan specifies for that item, and record in the report that the fallback path was taken and why.

5. Report per-item outcomes honestly when done. For each item (T-001.1, T-001.2, T-001.3, T-001.4) state:
   - **Status:** done / partially done / blocked (with the exact blocker).
   - **What changed:** files touched and a one-line summary of the change.
   - **Verification evidence:** the actual command outputs (pass/fail), what you observed at runtime, and paths to any screenshots.
   - Never mark an item done on the strength of "the code looks right" — only on observed behavior or passing checks. Failed verification is a valid, reportable outcome; a false "fixed" is not.

6. Do not modify `fixes/phase_1_fixes_plan.md` or this file. Do not commit unless separately asked; leave the changes in the working tree with the report.
