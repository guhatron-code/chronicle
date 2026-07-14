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
- **Terminals** live in the right column on Roadmap/Repo: ⌘T or the Claude Code / Codex
  buttons start real shells; sessions survive switching panes and projects; a finished
  session keeps its scrollback until you close its tab. "Start this phase" on a phase page
  opens a terminal, starts your agent, and copies the paste file in one click.
- **The kanban** (per project): write down bugs and ideas as tasks (⌘N), attach screenshots,
  drag them between Queued / In progress / Blocked / Completed. **Ready to execute** freezes
  the queued tasks into a round — a background session writes `fixes/phase_N_fixes_plan.md`
  and `phase_N_fixes_prompt.md`, and the round appears as a phase on your roadmap. Tasks
  added while a round executes start the next round. The board lives at
  `.chronicle/kanban.json` inside the project, so it travels with the repo.
- Click any file chip to copy its whole contents; paste into the built-in terminal or
  Claude Design, as the chip says.

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
panes · ⌃Tab cycle panes · ⌘T new terminal · ⌘N new kanban task · ⌘/ all shortcuts.

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
access, multi-session PTY, consent-gated background sessions, the kanban store).
