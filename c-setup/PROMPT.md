# Execution prompt — the setup update (Chronicle, v0.4)

You are building the setup update in this repository (Chronicle: Tauri v2 +
React 19 + TS strict + Tailwind v4 on the Weave DS). The authority is
`c-setup/PLAN.md` — read it fully first, then execute phases S-0 → S-4 in order.
`c-setup/DESIGN_PROMPT.md` describes the comps; **no screen UI is built before
its comps exist and are accepted** (the doctor backend, S-1, may proceed
comp-free).

## Standing laws (all inherited from this repo — do not re-derive)

1. **Phase discipline.** One phase at a time. Each ends with its verification
   green and a short entry appended to `c-setup/PROGRESS.md` (create it: phase,
   what landed, how it was verified, commit hash). Small commits on
   `react-shadcn`, synced to main via
   `git push . react-shadcn:main && git push origin main react-shadcn`. Record a
   phase's commit hash in a FOLLOW-UP docs commit — amending to inject the hash
   changes the hash.
2. **Verify, don't assert.** Rust: `cargo test` (all existing tests stay green;
   new seams get tests). The PATH-block writer MUST be idempotent, marker-safe,
   and never clobber a hand-edited block — test it like `install_init_skill` is
   tested. A gated `CHRONICLE_SETUP_TEST=1` test installs Node into a temp HOME
   when the network flag is set (skipped otherwise), the way
   `CHRONICLE_ACP_TEST=1` gates the real-adapter test. Frontend:
   `npx tsc --noEmit` + `npx vite build` + the Playwright probe harness. Probes
   live in the session scratchpad, run their own vite on port 4321+ with the
   `PORT` env (4321 is often taken — use 4322), stub `__TAURI_INTERNALS__`, and
   **any stub that overrides a command must also log it**. Never `pkill -f vite`.
   Delete nothing in the scratchpad you didn't create.
3. **Design system.** shadcn/Kibo components via the established registries only;
   tokens from `src/index.css` only — never raw hex, never a default grey.
   Sentence case everywhere. Flat sections, dividers not cards, the button size
   scale (sm/md/lg), chips never wrap (name + destination inside, prose outside),
   `StateWord` keeps its dot pinned and truncates its label, 2px scrollbars, all
   dialogs/overlays center to the app window.
4. **The product register.** Plain language for a non-developer:
   save/publish/undo, never commit/push/revert/PATH/CLI/npm/git in UI copy. The
   setup and help screens NEVER show a raw tool name or a shell concept as the
   headline — "the terminal can't find Claude yet — Chronicle can fix that," not
   "claude not on PATH." Every error says what happened and the one button that
   fixes it. Nothing irreversible without an explicit confirm; the whole
   install chain runs only after the user clicks "Set everything up for me."
5. **Security & isolation seams.** No admin, ever — every install lands in the
   Chronicle-managed dir under the user's home (no `.pkg`/sudo). Downloads are
   HTTPS, arch-picked (`uname -m`), and verified (vendor checksum where
   published; at minimum an expected-type/size sanity check); writes are jailed
   to the managed dir. Installer subprocesses spawn with `process_group(0)`,
   are killed via `term_then_kill`, and get a child PATH that can find `node`
   (the shared `child_env_path` helper — §2.0). Every path-taking command still
   resolves through `project_for` where a project is involved.
6. **The child-PATH law.** Generalize the v0.3.1 adapter fix: a shared
   `child_env_path` helper prepends the resolved tool's own dir + the well-known
   tool dirs to the inherited PATH, applied to EVERY Node-launching spawn
   (adapter, headless claude, drafting, the doctor's installers). This is why a
   Finder-launched app works at all — do not regress it.

## Phase specifics

- **S-1 (the doctor)**: build `src-tauri/src/setup.rs` as an isolated module
  (mirror `acp.rs`). Each check implements detect/install/verify/repair with the
  honest `CheckState` (ok | missing | broken{reason} | needs_you{action}). The
  managed tools dir is `~/.chronicle/tools/`. INSTALL METHODS — verify each on
  the day against the vendor, do NOT trust any URL/string written in the plan:
  Node via the official darwin tarball for the arch → extracted to the managed
  dir; Claude Code via the official install script (managed-node `npm i -g`
  fallback); gh via GitHub's official tarball → managed dir; superpowers via
  `claude plugin marketplace add <verified-source>` + `claude plugin install
  superpowers@claude-plugins-official`. The terminal-PATH repair writes ONE
  marker-fenced idempotent block into `~/.zshrc`/`~/.zprofile` (never clobbers a
  hand-edit). Sign-in and gh-auth reuse the existing managed-terminal flow (the
  v0.3 needs-login pattern) — do not invent a new terminal path. Commands:
  `setup_status/install/repair/run_all/fix_terminal_path/open_login` +
  streamed `setup-update` events (one stream, like `acp-update`). Record what
  you verified (install methods, the marketplace source) in PROGRESS.md.
- **S-2 (setup screen)**: build the comps 100%, then wire. The probe suite must
  drive every `CheckRow` state from stubbed `setup-update` events (checking ·
  ready · needs-you · installing % · couldn't-finish + retry), the run-all
  sequence stopping honestly on a hard failure, the terminal-PATH repair, the
  sign-in/gh-auth terminal hand-off + auto-advance, the all-green celebration,
  the smart gate (shows when a prerequisite is missing, never blocks a
  ready user), the always-reachable "Setup & health" re-entry, and persistence
  of the done state.
- **S-3 (help screen)**: build the comps 100%. Probes: search across recipes +
  glossary, a recipe navigating into the real UI, a glossary lookup, the
  shortcuts section. Copy is non-technical throughout — a non-developer reads it
  without a dictionary.
- **S-4 (ship)**: full sweep (all existing suites + the new ones), README
  section (a "Getting set up" + "Help" pass), bump + `./release.sh 0.4.0
  "<honest notes>"`, update memory. If a 0.3.1 carrying the v0.3 agent-launch
  (child-PATH) + notify fixes has not already shipped, ship that FIRST — the
  setup screens assume a working agent.

## Tracking contract

After each phase lands verified, append to `c-setup/PROGRESS.md`. Report
per-phase outcomes honestly — a failed or partial phase is written down as
failed or partial, never rounded up. The install-method verifications (what the
vendor's current install path actually is, on the day you built it) are recorded
in PROGRESS.md so a future reader knows what was true when it shipped.
