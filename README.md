# Chronicle — a build companion for any project

Chronicle is a macOS app that shows you — in plain language — where a multi-phase,
prompt-driven build stands: which phases are done, what the **current state** is, the exact
file you paste into which tool at each step, and what needs you (unpublished saves, leftover
workspaces, decisions waiting). It reads your project folders live and derives everything
deterministically; nothing you do in the app changes a project without an explicit,
confirmed action.

## Using it

- **Open a project…** (⌘O) — any folder. If it has a `chronicle.json`, the roadmap appears.
  If it doesn't, Chronicle **asks first**: "Build it for me" starts a background Claude/Codex
  session that reads the plan and git history and writes the roadmap (with live progress and
  a visible Cancel); "I'll run it myself" copies the prompt instead; "Use the basic view"
  skips roadmaps entirely. Your choice is remembered per project.
- **New blank project** — a fresh folder in `~/Documents` (git-initialized).
- **Multiple projects** are tabs in the title bar; ⌘K opens the switcher palette, ⌘1–9 jump
  by position, ⌘W closes (asking first if terminal sessions are still running).
- **The sidebar** hosts the three surfaces: **Roadmap** (current state, what needs you,
  always-on documents, the phase timeline), **Repo** (file tree · reader with live disk
  freshness · Project history: save / publish / bring down in plain words), and the
  **Kanban** (see below). ⌘J cycles them.
- **The agent** (v0.3) sits above the terminal in the right column — a chat thread that
  DRIVES Claude Code instead of watching it. See "The agent" below.
- **Terminals** live below the agent in the right column: ⌘T or the Claude Code / Codex
  buttons start real shells; sessions survive switching panes and projects; a finished
  session keeps its scrollback until you close its tab. Tab words tell the truth — the
  "working" dot appears only when an agent is actually in the pty's foreground — and
  ⌘-clicking a printed path opens it in the repo viewer. Each unit of the window
  (content · agent · terminal) shows or hides from the title-bar cluster (⌥⌘1/2/3);
  hiding never stops a session.
- **The kanban** (per project): write down bugs and ideas as tasks (⌘N), attach screenshots,
  drag them between Queued / In progress / Blocked / Completed. **Ready to execute** freezes
  the queued tasks into a round — a background session writes `fixes/phase_N_fixes_plan.md`
  and `phase_N_fixes_prompt.md`, and the round appears as a phase on your roadmap. Tasks
  added while a round executes start the next round. The board lives at
  `.chronicle/kanban.json` inside the project, so it travels with the repo.
- Click any file chip to copy its whole contents; paste into the built-in terminal or
  Claude Design, as the chip says.

## Getting set up

The first time you open Chronicle — or any time something stops working — the
**Setup screen** gets the machine ready without you typing a single command. It
installs and repairs the five things Chronicle needs, each without admin, into a
managed folder in your home directory: Claude Code (and its sign-in), the engine
it runs on (Node), your online home (GitHub, and its sign-in), and the extra
skills. One button — **Set everything up for me** — runs the whole chain with
honest per-step progress; or fix any one row on its own. It also repairs the
classic "the AI is installed but the terminal can't find it" problem in one
click. Reach it again any time from the rail's **Setup & health** entry.

## Help

The rail's **Help** destination (or ⌘/) opens plain-language help built for a
non-developer: "How do I…" task recipes (publish, undo the agent, start a
phase, bring down changes…), each with a **Show me** that takes you to the real
control; a glossary that translates every term the app uses; and the keyboard
shortcuts. Search matches across recipes and the glossary at once.

## The agent

The agent pane speaks the Agent Client Protocol to a pinned Claude Code adapter
(`@agentclientprotocol/claude-agent-acp`, spawned via npx with your Claude Code login —
Chronicle never holds a key). Everything meaningful arrives as typed events and renders as
plain-language cards: streamed answers, "Edited `file` +12 −4 · View the changes",
"Ran `npm test` — finished", inline permission asks with the agent's own options.

- **Asks first / Works freely** — two modes, read from the agent itself. Works freely
  (edits stop asking; commands still ask) is confirmed once per session and never
  outlives it. The bypass-everything mode is deliberately not offered.
- **Every edit is reviewable and undoable.** The review strip ("4 files changed · Review ·
  Keep all · Undo all…") opens the repo viewer on each diff with Keep / Undo per file.
  Files the agent changed through shell commands are listed honestly as "changed by a
  command — covered by Undo to here", reviewable but not per-file undoable.
- **Undo to here.** Every message is preceded by a git-plumbing snapshot (never your
  index, never a branch). Restoring puts every file back — including files created after
  the snapshot, which are deleted — and says exactly that before doing it.
- **History.** Sessions persist to `.chronicle/agent/` as they stream; previous sessions
  list by date and resume when the adapter supports it (read-only view + "Continue in a
  new session" when it doesn't). Undo survives an app restart.
- **Integrations.** "Start with the agent" on a phase preloads the phase prompt as an
  unsent draft; "Run the round for me" on the kanban runs the round in the pane, with
  done/failed derived from the board's columns and the stop reason — never the agent's
  own claim.

## Trust boundary

- The backend only reads folders you explicitly opened (a canonicalized allowlist); every
  path a command touches is jailed to those roots — symlinks that escape are rejected.
- Roadmap/fix sessions run only after consent, can always be cancelled, and nothing outlives
  the window: every child process is stopped and reaped on close.
- Destructive actions (discard changes, delete a task, close a live session) always confirm
  first, and the button says what actually happens.

## The manifest

`chronicle.json` at the project root declares name, description, roots (multi-folder projects
use `roots.extra` with aliases), stages/phases, paste-this files, and **status rules** the app
re-evaluates every few seconds against ground truth (git tags, report files, commit subjects).
The manifest is re-read from disk on every poll; a rule that can't be checked says so in a
banner instead of failing silently. Kanban fix-rounds are overlaid at derive time — the
manifest file itself is never rewritten by the app. Schema: `skill/chronicle-init/SCHEMA.md`;
worked examples in `skill/chronicle-init/examples/`. The `/chronicle-init` skill (install to
`~/.claude/skills/`) writes and verifies the manifest.

## Shortcuts

⌘O open · ⌘K palette · ⌘1–9 switch project · ⌘W close (confirms live sessions) · ⌘J cycle
panes · ⌃Tab cycle panes · ⌥⌘1/2/3 show/hide content · agent · terminal · ⌘T new terminal ·
⌘N new kanban task · ⌘/ all shortcuts.

## Accuracy contract

- `chronicle --derive <dir>` / `chronicle --state <dir>` — the derived state as JSON.
- `test/golden.sh` — the golden-equivalence test: both bundled examples must derive exactly
  the states the original hand-built apps showed.
- `generatedFrom` sha256 hashes surface "the plan changed — rebuild the roadmap" honestly.
- Status derivation is deterministic code; no model output ever gates what the app shows.

## Building & distribution

```
npm install && npm run tauri:dev                  # dev app (Vite + cargo)
cd src-tauri && cargo build                       # dev binary (also the CLI)
npx tauri build --target universal-apple-darwin   # universal .app + DMG (Intel + Apple Silicon)
```

The DMG is ad-hoc signed by default. For distribution to other Macs, sign with a Developer ID:
set `APPLE_SIGNING_IDENTITY="Developer ID Application: …"` (and optionally
`APPLE_ID`/`APPLE_PASSWORD`/`APPLE_TEAM_ID` for notarization) before `npx tauri build`.

UI: React + Vite + Tailwind v4 + shadcn/ui on the Weave design system (`src/`).
Backend: `src-tauri/src/main.rs` (manifest model, 3-valued condition engine, jailed file
access, multi-session PTY, consent-gated background sessions, the kanban store) and
`src-tauri/src/acp.rs` (the ACP seam: stdio JSON-RPC loop, the jailed+ledgered fs
handlers, checkpoints, the transcript store).
