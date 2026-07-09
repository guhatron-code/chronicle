# Chronicle — a build companion for any project

Chronicle is a macOS app that shows you — in plain language — where a multi-phase,
prompt-driven build stands: which phases are done, what the **current state** is, the exact
file you paste into which tool at each step, and what needs you (unpublished saves, leftover
workspaces, decisions waiting). It reads your project folders live and derives everything
deterministically; nothing you do in the app changes a project.

## Using it

- **Open a project…** (⌘O) — any folder. If it has a `chronicle.json`, the roadmap appears.
  If it doesn't, Chronicle **automatically starts a background Claude session** that reads the
  plan and git history and writes the roadmap for you (full auto mode — no prompts); the
  roadmap appears on its own. You can opt out ("I'll run it myself" / basic view).
- **New blank project** — a fresh folder in `~/Documents` (git-initialized). You land in the
  Repo tab; ideate in the terminal, create files. The roadmap column waits with a
  **Build roadmap** button until you're ready.
- **Multiple projects** are tabs in the one-row header — each carries a live status dot
  (blue in-progress · green done); the active tab drives everything below. `+` / ⌘T / ⌘K opens
  the switcher palette. Each project keeps its own shells, file tabs, and tree.
- Click any file chip to copy its whole contents; paste into the built-in terminal
  (`claude` ⏎ then ⌘V) or Claude Design, as the chip says.
- Recents are tiles with each project's one-line description; the red trash icon removes a
  project from Chronicle (with confirmation) — the folder on disk is never touched.

## The manifest

`chronicle.json` at the project root declares name, description, roots (multi-folder projects
use `roots.extra` with aliases), stages/phases, paste-this files, and **status rules** the app
re-evaluates every few seconds against ground truth (git tags, report files, commit subjects).
The manifest is re-read from disk on every poll, so a roadmap written or fixed while the
project is open appears without reopening. Schema: `skill/chronicle-init/SCHEMA.md`; worked
examples in `skill/chronicle-init/examples/`. The `/chronicle-init` skill (install to
`~/.claude/skills/`) writes and verifies the manifest.

## Accuracy contract

- `chronicle --derive <dir>` / `chronicle --state <dir>` — the derived state as JSON.
- `test/golden.sh` — the golden-equivalence test: both bundled examples must derive exactly
  the states the original hand-built apps showed.
- `generatedFrom` sha256 hashes surface "the plan changed — rebuild the roadmap" honestly.
- Status derivation is deterministic code; no model output ever gates what the app shows.

## Building & distribution

```
cd src-tauri && cargo build                       # dev binary (also the CLI)
npx tauri build --target universal-apple-darwin   # universal .app + DMG (Intel + Apple Silicon)
```

The DMG is ad-hoc signed by default. For distribution to other Macs, sign with a Developer ID:
set `APPLE_SIGNING_IDENTITY="Developer ID Application: …"` (and optionally
`APPLE_ID`/`APPLE_PASSWORD`/`APPLE_TEAM_ID` for notarization) before `npx tauri build`.

UI: `ui/index.html` (static, vendored xterm.js — no framework, no network).
Backend: `src-tauri/src/main.rs` (manifest model, condition engine, jailed file access,
multi-session PTY, background init runner). Design comps: `design/comps/`.
