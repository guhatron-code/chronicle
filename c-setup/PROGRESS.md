# The setup update — progress

One entry per phase, appended when the phase's verification is green.

## S-0 · Comps

**What landed** — Deck 8 (`Chronicle 8 · Setup and Help.dc.html`) returned from
Claude Design and is accepted. Coverage is 1:1 with `DESIGN_PROMPT.md`: G1 the
setup checklist (every StateWord state — checking · ready · needs you ·
installing % · couldn't finish — plus the "3 of 6 ready" header, the all-green
celebration, and the "Set everything up for me" running state), G2 mid-install +
honest failure, G3 the terminal-access repair (the star fix, with the honest
"open a new terminal" after-state), G4 the two sign-in hand-offs (matched 1:1 to
the agent pane's needs-login waiting treatment), G5 the smart gate vs. the
always-reachable health console (shared body), G6 the rail gaining Help + Setup
& health, G7 the "How do I…" recipes with the "Show me" landing, G8 the plain
glossary + folded-in shortcuts + cross-search. Register is clean throughout — no
PATH/CLI/npm/git in any headline. Copied into `design/comps/`.

**Reconcile during S-3** — the comp's shortcuts section lists `⌘J` as "show or
hide the terminal" and a `⌘R`; the shipped bindings are `⌘J` = cycle panes and
there is no `⌘R`. The help screen will show the ACTUAL shipped shortcuts, not
the comp's placeholders.

**Verified** — visual read against DESIGN_PROMPT.md; all eight frames + the
light-theme proof present.

**Commit** — 88b0477

## S-1 · The doctor (Rust backend)

**Install methods VERIFIED against the vendors on 2026-07-17** (per the
standing law — not trusted from the plan): Node = latest LTS from
`nodejs.org/dist/index.json` (currently v24.18.0), official darwin tarball for
the arch, verified against the vendor's `SHASUMS256.txt`. Claude Code =
`curl -fsSL https://claude.ai/install.sh | bash` (302→ok), npm-via-managed-node
fallback. GitHub = latest `cli/cli` release's `gh_*_macOS_<arch>.zip` asset
(the `.pkg` needs admin — avoided). Superpowers = `claude plugin marketplace
add anthropics/claude-plugins-official` + `claude plugin install
superpowers@claude-plugins-official`.

**What landed** — `src-tauri/src/setup.rs`: the six checks
(claude · claude sign-in · node · terminal-path · github · superpowers) each
with detect + install/repair. Everything installs WITHOUT admin into
`~/.chronicle/tools/` from direct, arch-picked, HTTPS downloads (checksum-
verified for Node); binaries symlinked into a managed `bin/`. Downloads stream
progress (`setup-update` events with pct + bytes) and honor a cancel flag. The
terminal-path repair writes ONE marker-fenced, idempotent block into
`~/.zshrc` + `~/.zprofile` (never clobbers a hand-edit — the skill-install
safety model). Detection uses the extended tool ladder (managed dir + well-
known dirs + a login-interactive probe); the "installed but the terminal can't
find it" split is the star fix's trigger. Every subprocess gets a PATH that can
find node (`tool_env_path`). Commands (main.rs): `setup_status`,
`setup_install` (blocking work on `spawn_blocking`), `setup_fix_terminal_path`,
`setup_cancel`, `setup_run_all`, `setup_signin_command` (hands the frontend the
managed-terminal sign-in for claude/gh).

**How it was verified** — `cargo test`: 41 passed (6 new: the PATH-writer's
idempotency + marker-safety + never-clobber-outside-markers, arch tokens,
nested-binary location, tar extraction round-trip, sha256, the status shape).
Plus the gated `CHRONICLE_SETUP_TEST=1` test exercising the REAL install
pipeline against the live Node vendor — download → vendor-checksum verify →
extract → the extracted `node --version` runs — passed in ~10s. `cargo build`
clean (only the pre-existing `log` warning).

**Commit** — 88b0477
