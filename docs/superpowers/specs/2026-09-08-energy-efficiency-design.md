# Energy efficiency — design

**Date:** 2026-09-08
**Status:** approved in brainstorm, awaiting implementation plan
**Companion specs:** `2026-09-08-web-pane-design.md` (depends on the scheduler defined here)

## Goal

Chronicle should cost almost nothing while it sits beside a terminal and a design tool.
An open project with no activity must not wake the CPU on a schedule, spawn processes,
or repaint. Hidden or occluded, it should be indistinguishable from a closed app.
On battery, everything that still runs slows down further.

Success is a number, not a feeling: the baseline script below is run before the first
change and after each phase, and the results go in this file's **Results** section.

## Non-goals

- Changing the rendering engine (Tauri on WKWebView is already the efficient choice).
- Reworking how screens get data beyond what the pollers need (no global store rewrite).
- Touching the ACP protocol or the terminal's PTY plumbing beyond the two points named.

## Where the energy goes today

| Source | Cadence | Cost while idle |
|---|---|---|
| `App.tsx` state poll (`pollOne`) per open project | every 8s | 5+ `git` subprocesses per project, JSON diff, React render |
| Roadmap init / fixes / round-exec pollers (`RoadmapPane.tsx`) | every 3s each, while a run is live | IPC round trip + `try_wait` per tick |
| Kanban generating / exec-live pollers (`KanbanPane.tsx`) | every 3s each | same |
| Terminal foreground poll (`term-sessions.ts`) | every 2s per live session | `sysinfo` process refresh per session |
| Setup sign-in poll (`setup-store.ts`) | every 3.5s for up to 5 min | doctor probes |
| ACP agent session auto-start on project open | once, then persistent | a node bridge and an agent process that never exit |
| xterm cursor blink | 2 repaints/s per visible terminal | compositor pass on a transparent window |
| Looping keyframes (`wv-spin`, `wv-pulse`, `wv-arrow`, `ch-indeterminate`) | continuous while mounted | repaint per frame |
| Transparent window (`transparent: true`) | per repaint | non-opaque compositing of the whole surface |

Nothing above knows whether the window is visible, focused, or on battery.

## Design

### 1. Measurement

`scripts/energy-baseline.sh` samples Chronicle with `powermetrics` for 60 seconds in three
states and prints one row per state:

| State | How it's staged |
|---|---|
| idle-focused | one project open, no terminal, window frontmost |
| idle-hidden | same, window hidden with ⌘H |
| terminal-live | one terminal running `claude` mid-turn |

Reported per row: average CPU ms/s for the Chronicle process tree (including any
`git` children), idle wakeups/s, and the "Energy Impact" figure. The script needs
`sudo` for `powermetrics` and says so up front.

Targets:

| State | CPU | Wakeups/s | Child processes spawned in 60s |
|---|---|---|---|
| idle-focused | < 0.5% | < 10 | 0 unless a file changed |
| idle-hidden | ≈ 0 | < 2 | 0 |

### 2. One activity signal

Two of the three inputs are already known to the webview, so Rust only supplies the third.

- `visible`: from `document.visibilityState`. WKWebView flips it to `hidden` when the window is occluded, minimized or hidden with ⌘H, which is exactly "nobody can see this". No AppKit observer needed.
- `focused`: from the window's `focus` / `blur` events.
- `onBattery`: **Rust `power.rs`** reads IOKit power sources (`IOPSCopyPowerSourcesInfo`), exposes `get_power_source`, and installs an IOKit run-loop notification so a plug or unplug emits `power-source-changed`.

`src/lib/activity.ts` wires those into the scheduler, stamps `<html data-idle>` for CSS, and tells Rust whether the UI is visible (`set_ui_visible`) so the session waiter below can go quiet.

**Frontend: `src/lib/scheduler.ts`.** A pure module, no React, no Tauri imports:

```ts
type Activity = { visible: boolean; focused: boolean; onBattery: boolean };
type Cadence = "normal" | "slow" | "paused";
cadenceFor(a: Activity): Cadence          // hidden → paused; unfocused → slow; else normal
intervalFor(base: number, a: Activity): number | null
  // paused → null; slow → base*4; battery doubles; normal → base
every(base: number, fn: () => void): () => void
  // a timer that re-arms itself from intervalFor on every app-activity change,
  // fires once immediately when leaving "paused", never overlaps (single-flight)
```

Every timer that survives this spec goes through `every()`. There are no bare
`setInterval` calls left outside `components/ui`.

### 3. Replacing the pollers

- **Project state (8s).** Base becomes 60s. The file watcher already emits `project-fs-changed` with a 450ms debounce, so the heartbeat exists only to catch things the watcher can't see (a remote branch moving). Paused while hidden; a poll fires immediately on show.
- **Child-session pollers (4 × 3s).** Rust already holds every init, fixes and round-exec child in `InitState`, and the screens show the session's live log tail, so a plain blocking `wait()` isn't enough. Each spawn gets a waiter thread that, once a second, does one `try_wait` and one `stat` of the log file (no subprocess, no IPC) and emits `session-status` `{dir, kind, running, started_at, code, log_tail}` **only on change**: the log grew, or the child exited or was cancelled. Log-growth events are skipped while the UI is not visible; the exit event always goes out. The four `setInterval` loops in `RoadmapPane.tsx` and `KanbanPane.tsx` become one `useSessionStatus(dir, kind)` hook that subscribes and does one seed read through `initStatus` and friends on activation. The `try_wait` status commands stay for that seed read. `elapsedS` is not rendered anywhere today, so it is computed at event time and never ticks on its own.
- **Terminal foreground (2s).** The interval goes. `pollForeground(id)` runs 300ms after the last `pty-out` chunk for that session (trailing debounce) and once on `pty-exit`. A quiet terminal never polls. `process_info` already narrows to one pid.
- **Setup sign-in (3.5s).** Runs through `every()` so it pauses while hidden, and is cleared when the setup screen unmounts.
- **Kanban refresh inside the state poll.** `refreshKanban` runs only when `kanban.json`'s mtime changed since the last read (Rust returns the mtime alongside the state).

### 4. The agent pane

- `DEFAULT_LAYOUT.agent` becomes `false`. Saved layouts are honored, so existing users keep what they had; the ⌥⌘2 toggle and the pane cluster show it.
- The ACP session starts only when the agent pane is visible. The project-open auto-start in `App.tsx` becomes "start when the pane first becomes visible for this project". `AgentSection` collapsed and hidden states never start a session.
- Ending a session on pane hide is **not** done: a half-finished turn must not be killed by a layout toggle. Sessions end as they do today.

### 5. Rendering

- **Cursor blink.** `term.options.cursorBlink` is `true` only while `focused && visible`; the scheduler's activity subscription flips it for every live terminal.
- **Looping animations.** The root gets `data-idle="true"` when cadence is not `normal`. `index.css` adds `[data-idle="true"]` rules that set `animation-play-state: paused` on the elements using the four looping keyframes (the spinner, pulse, arrow and indeterminate bar). Transition-driven UI is untouched.
- **Transparency experiment.** `transparent: true` exists only for the 11px rounded corners. The experiment: a titled window with `titleBarStyle: Overlay`, `hiddenTitle: true`, `transparent: false`, which gives native rounded corners and shadow on an opaque backing; the three native buttons are hidden in `setup` so the React traffic lights stay the only ones. Acceptance: corners, shadow and the title-bar drag region look identical in screenshots against today's build at 1x and 2x, and double-click-to-zoom still works. If they don't, the change is reverted and the outcome recorded below.

### 6. What stays

- The ACP reader thread and the PTY reader thread are blocking reads. They cost nothing idle and stay.
- The `notify` file watcher stays; it is the reason the heartbeat can be slow.
- Toast auto-dismiss, copy-confirmation and animation-settle `setTimeout`s are one-shot and stay.

## Error handling

- If `power.rs` cannot read power sources, `on_battery` is `false` and a single log line says so. Nothing else degrades.
- If a `session-status` event is missed (webview reload mid-run), the initial `initStatus` read on mount recovers the truth. That is why the `try_wait` commands stay.
- Callbacks own their errors. `every()` catches whatever escapes a callback (a sync throw or a rejection) so the timer survives; the existing per-screen `catch` blocks keep last-known state.

## Testing

- **Rust:** unit tests for `power::battery_from_type`, and for the waiter's pure `probe_step` (growth only while visible, exit always, hidden growth surfaces on the next visible tick).
- **TypeScript:** `vitest` is added as a dev dependency for pure modules only. `scheduler.test.ts` covers `cadenceFor`, `intervalFor` (including the battery doubling and the paused null), and `every()`'s re-arm and single-flight behaviour with fake timers.
- **Energy:** `scripts/energy-baseline.sh` output before and after, recorded below.
- **Manual:** hide the window with a project open and confirm in Activity Monitor that no `git` process appears for 60s; open a project and confirm no agent bridge process exists until the pane is shown; drag a panel and confirm nothing looks different with the transparency change.

## Results

Measured 2026-09-08 with `scripts/energy-baseline.sh` in `top` mode (no sudo in the
session, so no `powermetrics`: CPU comes from `top`'s %CPU over the 60s window at
0.1% resolution, and the wakeups column is `top`'s idle-wakeup counter, which stayed
at ~0 for every run on this machine and is not informative here). Both builds are
`tauri build` bundles launched with `--open` on this repo, one project open, no
terminal, agent pane hidden, staged and sampled by script (window focused, then
hidden with the app's hide). "Before" is d6f9575 plus only the `--open` commit.
`git children` counts git processes spawned by the measured instance in 60s
(a floor: each lives a few ms).

| State | Before CPU / git children | After CPU / git children |
|---|---|---|
| idle-focused | 3 ms/s (0.3%) / 20 | 1 ms/s (0.1%) / 1 (one 60s heartbeat landed) |
| idle-hidden | 5 ms/s (0.5%) / 18 | 0 ms/s / 0 |
| terminal-live | 20 ms/s (installed v0.7.0 with Claude mid-turn, sampled read-only) | not staged (needs a live agent turn inside the test instance) |

Against the targets: idle-focused CPU < 0.5% ✓ (0.1%), children 0 unless a file
changed ✓ (the single heartbeat is by design); idle-hidden ≈ 0 ✓ with 0 children ✓.
Wakeups/s stays unverified until someone runs the script with sudo (`powermetrics`
reports interrupt wakeups; `top` does not on this machine). The before build kept
polling while hidden (18 git spawns in 60s), which is exactly what the scheduler
removed.

Transparency experiment outcome: reverted. A titled window with an overlay title bar (commit 362278f) renders the OS corner radius and a wider native shadow, visibly different from the 11px rounded container (corner-arc span roughly 1.8× in the 2x screenshots; before/after crops were compared side by side). The radius of a titled window is not configurable, so the transparent window stays. To adopt the native look on purpose, cherry-pick 362278f.
