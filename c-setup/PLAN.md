# The setup update — getting a non-developer ready, and a help screen that speaks plainly

*Chronicle v0.4. Chronicle stops assuming the toolchain exists. A **doctor**
subsystem detects, installs, and REPAIRS everything the app needs, and two calm
non-developer surfaces sit on top: a **Setup screen** (guided one-click
getting-ready) and a **Help screen** (task recipes + a plain glossary). Nothing
here turns Chronicle into a package manager — it installs exactly the five
things the app depends on, without admin, and never touches anything else.*

---

## 0 · The one idea

Today Chronicle assumes Claude Code, Node, GitHub's tool, and the skills are all
already installed and reachable. For the non-developer this is the wall they
hit first — and the most-reported failure is the cruelest kind: a tool that IS
installed but "doesn't work when I type it in the terminal." Chronicle already
knows how to find tools by absolute path (`find_tool`, `agent_paths`); v0.4
turns that knowledge into a **doctor** that also *installs the missing pieces*
and *repairs the broken PATH* — and wraps it in a screen a vibe coder can
follow without ever opening a terminal, plus a help screen that finally
explains the app in their language.

**Reliability backbone, stated once:** Chronicle NEVER depends on the user's
shell PATH. It resolves every tool by absolute path and, crucially, gives every
spawned child a PATH that can find `node` (the v0.3.1 adapter-launch fix
generalized — see §2.0). The user's *interactive terminal* PATH is a separate,
repairable concern — which is exactly the "I typed `claude` and nothing
happened" bug.

## 1 · Scope

### In

| # | Feature | Why it earns its place |
|---|---------|------------------------|
| A | **The doctor** — a Rust subsystem that detects, installs (no admin, direct downloads), verifies, and repairs each prerequisite, streaming honest progress | The engine everything else stands on; makes "handle all common errors" real instead of a slogan |
| B | **The Setup screen** — a calm checklist with a one-click "Set everything up for me", per-step progress/failure/retry, and terminal hand-offs for the two sign-ins | The wall a non-developer hits first, removed |
| C | **Smart gate + always-reachable "Setup & health"** — shows on first launch or whenever a prerequisite is missing; stays reachable as a re-check/repair console | Setup isn't a one-time wizard you can never get back to when something breaks later (login expires, gh logs out) |
| D | **The Help screen** — searchable task recipes ("How do I…") + a plain-language glossary that translates every UI term | The app finally explains itself to the person it's built for |
| E | **The terminal-PATH repair** — the exact "claude is installed but the terminal can't find it" fix, one button, honest about needing a fresh terminal | The single most-reported non-developer failure |

### Out — and why

- **A general package manager / arbitrary installs.** The doctor installs
  exactly the five things Chronicle depends on. No "install anything" surface.
- **Homebrew / Xcode Command Line Tools bootstrap.** Direct installers only
  (§2.1) — the Homebrew→CLT chain is the heaviest, most failure-prone thing for
  a beginner and the thing we're sparing them. If Homebrew already exists we do
  not use it (one code path, not two).
- **Admin/sudo installs.** Everything lands in a Chronicle-managed dir under the
  user's home. No password prompts, no system modification.
- **Windows/Linux setup.** macOS only, like the rest of Chronicle.
- **Auto-updating the installed tools.** The doctor installs and repairs; it
  does not become an update daemon for node/gh/claude. A "re-check" re-runs
  detection; a stale tool that still works is left alone.
- **Teaching git/terminal.** The help screen is task-and-glossary, not a
  tutorial on the underlying tools. Vocabulary law holds: save/publish/undo.

## 2 · Architecture

### 2.0 The child-PATH law (already shipped in v0.3.1 — generalized here)

A Finder-launched app has a minimal PATH (`/usr/bin:/bin:/usr/sbin:/sbin`).
Resolving a tool by absolute path is NOT enough: `npx`, `claude`, and `gh` are
Node scripts whose `#!/usr/bin/env node` shebang needs `node` **on the child's
PATH**. v0.3.1 fixed this for the ACP adapter (`adapter_command` prepends
`node`'s dir + the well-known tool dirs). v0.4 lifts that into a shared helper
(`child_env_path`) and applies it to EVERY tool Chronicle spawns that is (or
launches) a Node program — the headless claude runs, the drafting run, the
doctor's own installer subprocesses. This is the reliability backbone; the
Setup screen's terminal-PATH repair (§2.3, check 3) is the *user-facing* twin
of the same idea, for their interactive shell.

### 2.1 The doctor (Rust, new `src-tauri/src/setup.rs`)

An isolated module (mirrors `acp.rs`). Each prerequisite is a **check** — a unit
with four moves and one honest status:

- `detect() -> CheckState` where `CheckState = ok | missing | broken{reason} | needs_you{action}`
- `install()` — direct download → verify → place in the managed dir (streamed)
- `verify()` — re-detect; an install that didn't take reports honestly
- `repair()` — the check-specific fix (e.g. rewrite the PATH block)

**The managed tools dir:** `~/.chronicle/tools/` (bin/, node/, gh/). Nothing is
installed with admin; everything is a self-contained download for the machine's
arch (`uname -m` → `arm64` | `x64`), each verified (vendor checksum where
published; at minimum HTTPS + an expected-type/size sanity check), and jailed to
the managed dir. Installs run as streamed background sessions reusing the
existing run-session machinery (the init/fixes pattern): progress events,
cancel, honest failure, never a hang.

**The checks, in dependency order:**

1. **Node** — "The engine the AI runs on." Detect via the tool ladder +
   `node --version`. Install: the official Node **tarball** (`node-vXX-darwin-<arch>.tar.gz`)
   extracted into `~/.chronicle/tools/node`, its `bin` linked into
   `~/.chronicle/tools/bin`. Tarball, not the `.pkg` — the pkg needs admin; the
   tarball needs none. Node is first because the ACP adapter and everything
   else depend on it.
2. **Claude Code** — "The AI that does the work." Detect via the ladder.
   Install: the official install script; fall back to `npm i -g` via the
   managed node if the script path fails. VERIFY the current official install
   method on the day (do not trust a URL written here). Lands in
   `~/.local/bin/claude` (or `~/.claude/local`) — already in Chronicle's ladder.
3. **Terminal PATH** — "Make `claude` work in the terminal." This is the E
   fix. Detect the split: the tool ladder finds `claude` (installed) BUT a
   `zsh -lic 'command -v claude'` interactive-login probe returns nothing (the
   terminal can't) → `broken`. Repair: write ONE marker-fenced, idempotent
   block into `~/.zshrc` (and `~/.zprofile` for login shells) prepending
   `~/.local/bin` and `~/.chronicle/tools/bin`. Never clobbers a hand-edited
   block — the exact safety model as today's skill self-install marker
   (`install_init_skill`). Takes effect in NEW terminals; the screen says so
   and offers to open one.
4. **Sign-in** — "Sign in to Claude." Reuses the v0.3 needs-login flow exactly:
   `claude /login` in a managed terminal tab; auto-advances when the tab's
   session exits. Detect logged-in via a cheap auth probe (the same
   auth-required signal the adapter surfaces); when it can't be cheaply
   verified, present it as a do-it step the login terminal completes.
5. **GitHub** — "Your projects' online home." Install `gh` from GitHub's
   official **tarball** (`gh_X_macOS_<arch>.tar.gz`) → managed dir (no admin),
   then `gh auth login` in a managed terminal. Detect: ladder + `gh auth status`.
6. **Superpowers + skills** — "Extra skills for the AI." `claude plugin
   marketplace add <official-source>` then `claude plugin install
   superpowers@claude-plugins-official` (VERIFY the marketplace source string on
   the day). Detect: `~/.claude/plugins/installed_plugins.json` contains
   `superpowers@claude-plugins-official`. Chronicle's own `chronicle-init` skill
   already self-installs (`ensure_init_skill`) — this check just reports it
   green and re-runs the installer if the marker is gone.

**Commands (frontend → Rust):** `setup_status()` (all checks, current state),
`setup_install(check)`, `setup_repair(check)`, `setup_run_all()` (the chain in
dependency order, stopping honestly on a hard failure), `setup_fix_terminal_path()`,
`setup_open_login(kind)` (claude | gh, opens the managed terminal). Streamed
`setup-update` events (per-check state + install progress), mirroring
`acp-update`'s one-stream design so the frontend has a single subscription and
probes can stub it wholesale.

### 2.2 Error self-healing (baked into each check)

Every check is **idempotent and re-runnable**: a re-run keeps the good parts and
only does what's missing. The catalogued repairs (each surfaced as *what
happened + the one button that fixes it*, never a hang):

- Install-script succeeded but the binary isn't found → re-scan the ladder,
  retry via managed-node `npm i -g`.
- Download failed (offline / rate-limited) → "Couldn't download — check your
  connection and try again," retry button.
- Wrong architecture → arch-picked download (`uname -m`).
- gh-auth or sign-in didn't finish → the terminal stays; "Check again"
  re-probes `gh auth status` / the auth signal.
- Superpowers marketplace already added → skip (not an error).
- Partial/interrupted install → the next run detects the good parts and
  resumes.
- `claude` present but terminal-blind → the PATH-block repair (check 3).

### 2.3 The Setup screen (React, `src/screens/setup/`)

Presentational, built to comps (DESIGN_PROMPT.md), wired to the doctor:

- `SetupScreen` (container: subscribes `setup-update`, orders the checklist) →
  `CheckRow` (plain name, a `StateWord` — *checking · ready · needs you ·
  installing 42% · couldn't finish* — and one action button).
- A top **"Set everything up for me"** runs `setup_run_all` in dependency order
  — this is the single confirm; nothing runs before it. Per-step progress,
  per-step honest failure with retry, and it pauses at the two sign-in steps
  (which open a managed terminal) and auto-advances when they complete.
- The all-green **"You're all set"** state (a quiet celebration + "Open a
  project"); a "3 of 6 ready" header otherwise.
- Appears as a **smart gate** on first launch or whenever a prerequisite the
  active action needs is missing (never blocks a user whose tools already
  work). Reachable afterward as a **"Setup & health"** entry (rail, bottom,
  near Help) — the same screen, now a re-check/repair console.
- The terminal-PATH repair row's copy is honest about the fresh-terminal
  requirement and offers "Open a terminal that's ready."

### 2.4 The Help screen (React, `src/screens/help/`)

Searchable, two halves, built to comps:

- **Task recipes** — "How do I…" cards, each a short plain-words walkthrough
  that links to the real UI it describes: publish my project · undo what the
  agent changed · start a phase with the agent · what a red X in "what needs
  you" means · bring down changes from another computer · start a fresh
  project · run a round of fixes · sign back in when the agent says "needs
  login."
- **Plain glossary** — every UI term translated: save (a snapshot in your
  history) · publish (put it online) · bring down (get the latest) · the agent ·
  a phase · a round · a checkpoint · "works freely" · "what needs you." The
  vocabulary law made browsable.
- **Search** across both, centered to the app window like the other overlays.
  The existing ⌘/ shortcuts overlay becomes a section inside Help (or links to
  it) — one place to go when stuck.

### 2.5 Where these live in the shell

The rail gains a **Help** destination (the current bottom help affordance opens
the full Help screen instead of only the shortcuts overlay) and a **Setup &
health** entry beside it. The first-launch/missing-prereq gate renders as a
full-window screen over the picker (the picker is already a full screen, so this
composes cleanly). Neither is a fourth content-pane rail destination in the
three-unit sense — they're app-level surfaces like the picker.

## 3 · Build order (each phase: build → verify → STOP-worthy checkpoint)

- **S-0 · Comps.** DESIGN_PROMPT.md → Claude Design; comps for the Setup and
  Help screens return and are accepted before any screen UI is built. The
  doctor backend (S-1) may proceed comp-free.
- **S-1 · The doctor.** `setup.rs` end-to-end: the managed tools dir, per-check
  detect/install/verify/repair, the generalized `child_env_path`, download+
  verify helpers, the marker-fenced PATH-block writer, the commands + streamed
  `setup-update`. Rust tests: detect logic against fixture HOMEs (installed /
  missing / broken-PATH); the PATH-writer's idempotency + marker-safety + never-
  clobber (reuse the skill-install test pattern); arch selection; download-
  failure-is-an-error-not-a-hang. A gated (`CHRONICLE_SETUP_TEST=1`) test that
  actually installs Node into a temp HOME when the network flag is set.
- **S-2 · The Setup screen.** Build comps 100%, then wire to S-1. Probes:
  stubbed `setup-update` events drive every `CheckRow` state (checking · ready ·
  needs-you · installing % · couldn't-finish + retry), the run-all sequence
  stopping honestly on failure, the terminal-PATH repair, the sign-in/gh-auth
  terminal hand-off + auto-advance, the all-green celebration, the smart gate +
  always-reachable re-entry, persistence of "done."
- **S-3 · The Help screen.** Build comps 100%. Probes: search across recipes +
  glossary, recipe navigation into the real UI, glossary lookup, the shortcuts
  section.
- **S-4 · Ship.** Full sweep (all suites + the new ones), README section, bump +
  `./release.sh 0.4.0 "<honest notes>"`, memory update. (If a 0.3.1 with the
  v0.3 agent-launch + notify fixes hasn't already shipped, ship THAT first — see
  §4.)

## 4 · Risks & mitigations

- **Vendor install methods drift** (Node tarball URL, Claude install script, gh
  release layout, the marketplace source string): each is VERIFIED on the day by
  the executor, not trusted from this doc; a failed download surfaces as an
  honest card with retry, never a hang.
- **The 0.3.1 debt.** The v0.3 agent-launch fix (child PATH) and the notify fix
  are in the repo but not in any shipped build. Setup work assumes a working
  agent, so **0.3.1 ships first** (or S-4 bundles both). Do not build the setup
  screens on top of an agent the user still can't start.
- **Admin creep.** If any install path is tempted toward a `.pkg`/sudo, stop —
  the no-admin, managed-dir law is load-bearing for the non-developer promise.
- **Detection false-negatives** (a tool present via nvm/an unusual dir): the
  ladder + the interactive-login probe already handle the common cases; a check
  that can't confidently detect reports `needs_you` (offer to install) rather
  than silently claiming missing-and-reinstalling over a good copy.
- **Scope creep into a package manager:** the five checks are the whole surface.
  Anything else is out (§1-Out) so "no" has a memory.
