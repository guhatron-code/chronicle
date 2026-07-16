# Execution prompt — the Zed update (Chronicle Agent, v0.3)

You are building the Zed update in this repository (Chronicle: Tauri v2 + React 19 +
TS strict + Tailwind v4 on the Weave DS). The authority is `c-zed/PLAN.md` — read it
fully first, then execute phases Z-1 → Z-6 in order. `c-zed/DESIGN_PROMPT.md` describes
the comps; **no pane UI is built before its comps exist and are accepted** (backend
phases Z-1 and the refinements' backend halves may proceed comp-free).

## Standing laws (all inherited from this repo — do not re-derive)

1. **Phase discipline.** One phase at a time. Each ends with its verification green and
   a short entry appended to `c-zed/PROGRESS.md` (create it: phase, what landed, how it
   was verified, commit hash). Small commits on `react-shadcn`, synced to main via
   `git push . react-shadcn:main && git push origin main react-shadcn`.
2. **Verify, don't assert.** Rust: `cargo test` (all existing tests stay green; new
   seams get tests — the checkpoint restore MUST have a byte-identical round-trip
   test). Frontend: `npx tsc --noEmit` + `npx vite build` + the Playwright probe
   harness. Probes live in the session scratchpad, run their own vite on port 4321+
   with the `PORT` env, stub `__TAURI_INTERNALS__`, and **any stub that overrides a
   command must also log it**. Never `pkill -f vite`. Delete nothing in the scratchpad
   you didn't create.
3. **Design system.** shadcn/Kibo components via the established registries only;
   tokens from `src/index.css` only — never raw hex, never a default grey. Sentence
   case everywhere. Flat sections, dividers not cards, the button size scale
   (sm/md/lg), chips never wrap (name + destination inside, prose outside).
4. **The product register.** Plain language for a non-developer: save/publish/undo,
   never commit/push/revert in UI copy. Every error says what happened and what to do.
   Nothing irreversible without an explicit confirm. The agent NEVER acts without the
   permission handshake in ask mode.
5. **Security seams.** Every path-taking command resolves through `project_for` +
   `jailed`. The ACP `fs/write_text_file` handler is jailed and ledgered BEFORE the
   write lands. Spawns use `process_group(0)`; kills use `term_then_kill`. The adapter
   version is a pinned const. `ANTHROPIC_API_KEY` is blanked on the adapter env.
6. **Models.** The agent pane inherits the adapter's model (the user's Claude Code
   session). Headless work keeps its existing pins (`opus` for rounds/scans, `haiku`
   for drafts).

## Phase specifics

- **Z-1 (ACP client)**: add `agent-client-protocol = "=1.1.0"` (types only) and build
  the stdio JSON-RPC loop as plain threads + channels (mirror the pty reader pattern).
  Commands: `agent_session_start/prompt/cancel/set_mode/respond_permission/session_stop`
  + `acp-update` events. Include an integration test behind `#[ignore]` +
  a `CHRONICLE_ACP_TEST=1` env gate that runs against the real adapter when npx exists.
  The adapter spawn: `npx --yes @zed-industries/claude-code-acp@<PIN>` — verify the
  package name against the npm registry before pinning; if it differs, document the
  correction in PROGRESS.md.
- **Z-2 (pane)**: build the comps 100%, then wire. The probe suite must drive every
  card state from stubbed `acp-update` events: streaming chunks, all tool-card kinds
  and statuses, a permission card answered both ways, cancel, session end, error card.
- **Z-3 (edits + checkpoints)**: the ledger lives in Rust (source of truth), the
  ReviewStrip reads it via a `agent_edits(dir)` command. Checkpoints use a temp
  `GIT_INDEX_FILE` (never the user's index) and `refs/chronicle/checkpoints/*`.
  Rust tests: ledger diff correctness, undo restores bytes, checkpoint round-trip,
  jail refusals. Probe: review flow end-to-end on stubbed events.
- **Z-4 (integrations)**: phase-detail primary becomes "Start with the agent"
  (preloads, never auto-sends); "Run the round for me" gains the in-pane path with the
  headless path still available; journal + native notify on session end.
- **Z-5 (refinements E–I)**: each lands as its own commit with its own verification.
  E: pure-fn unit tests mapping real git stderr fixtures → sentences. F: probe with a
  fake pty feed containing paths; cmd-click routes to the viewer. G: `pty_info` rust
  test + probe for the tab dot. H: prompt swap only. I: probe driving updater states.
- **Z-6 (ship)**: full sweep (all existing suites + the new ones), README section,
  bump + `./release.sh 0.3.0 "<honest notes>"`, update memory per its instructions.

## Tracking contract

After each phase lands verified, append to `c-zed/PROGRESS.md` AND update
`.chronicle/kanban.json` if a round tracks this work (match by task id; touch
`updated_at`; change nothing else). Report per-phase outcomes honestly — a failed or
partial phase is written down as failed or partial, never rounded up.
