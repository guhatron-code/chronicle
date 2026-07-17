# The Zed update — progress

One entry per phase, appended when the phase's verification is green.

## Z-1 · The ACP client (Rust seam)

**What landed** — `src-tauri/src/acp.rs`: the stdio JSON-RPC loop as plain
threads + channels (mirrors the pty reader pattern — a reader thread owns
stdout, a mutex-guarded writer, u64 request ids with a pending-response map).
Types from `agent-client-protocol-schema` 1.4.0 (`unstable` umbrella feature;
usage updates consumed only when present). Commands: `agent_session_start`,
`agent_session_state`, `agent_prompt`, `agent_cancel`, `agent_set_mode`,
`agent_respond_permission`, `agent_session_stop`; every agent→client message
forwards to the webview as `acp-update` (raw JSON + session key), with
Chronicle lifecycle events on the same channel under `_chronicle/*`.
Security seams: fs/read + fs/write jailed to the project roots (absolute-only,
no `..`, nearest-existing-ancestor canonicalized — new nested files allowed,
symlink escapes refused); fs/write ledgered (base bytes, created-marker)
BEFORE the write lands; spawn uses `process_group(0)` + blanked
`ANTHROPIC_API_KEY` (+ `CLAUDECODE` removed — the inner claude refuses
"nested" launches); kills via `term_then_kill`; app exit drains adapter
children. Session modes are read from the session response (never assumed);
`set_mode` refuses anything not advertised and always refuses
`bypassPermissions`. Cancel/stop/turn-end resolve every outstanding
permission oneshot as cancelled — a pending ask can never hang the adapter.
Single-flight: one live session per project; a second prompt mid-turn is
refused.

**Adapter pin, verified on npm 2026-07-17** — the name written in older docs
(`@zed-industries/claude-code-acp`, latest 0.16.2) is DEPRECATED on the
registry: "renamed to @agentclientprotocol/claude-agent-acp". Pinned const:
`@agentclientprotocol/claude-agent-acp@0.59.0` (exact pin; installs fine —
no range fallback needed). The deprecation was caught because the gated test
ran against the real registry, not the docs.

**How it was verified** — `cargo test`: 23 passed (all pre-existing suites
green + 3 new: a full round against a mock ACP agent covering streamed chunks,
in-jail write landing + ledgered, out-of-jail write refused, permission
answered + double-answer refused, mode guard; a cancel-while-pending test
where the mock waits forever unless its permission oneshot resolves; pure
jail-refusal tests incl. symlink escape). Plus the `#[ignore]`
`CHRONICLE_ACP_TEST=1` integration test run against the REAL adapter:
initialize → session/new (agent's own modes asserted) → prompt → streamed
chunks → turn_end → stop, passed in 32s.

**Commit** — 343e5ad

## Z-2a · The shell rework (F31)

**What landed** — the right column now stacks **Agent above Terminal** with a
persisted horizontal splitter (`Shell.tsx` restructured; new
`components/chrome/PaneCluster.tsx`, `screens/agent/AgentSection.tsx`;
`TerminalColumn` gained collapse-to-strip). The three-unit visibility system:
a title-bar toggle cluster (content · agent · terminal) leftmost of the
update line, all three visible at max, exactly one at min — the last visible
unit's toggle disables with "The last pane stays open". ⌥⌘1/2/3 keyboard
twins (via `e.code`, alt-safe on macOS), listed in the shortcuts overlay.
Per-section collapse leaves a slim re-open strip (agent strip at the top,
terminal strip at the bottom; both collapsed pin apart). Visibility, collapse,
and both splitters persist per project (`chronicle.panes.<dir>`).
**Retired**: the "terminal column is absent on Kanban (full-bleed)" rule —
the old `showTerminal = pane !== "kanban"` logic is gone; full-bleed now
happens via the toggles. Rail clicks (and every content navigation, including
the ⌘J cycle) auto-reveal a hidden content unit. Hiding units never touches
sessions (xterm sessions live outside React). The agent section body is the
F31 empty-state hero for now — Z-2b replaces it with the real pane.

**How it was verified** — `npx tsc --noEmit` + `npx vite build` green;
`cargo test` still 23 passed. New Playwright probe harness (scratchpad,
own vite on PORT=4322, logged `__TAURI_INTERNALS__` stub): 6 probes passed —
stacked column + kanban keeps the right column; the visibility floor
(disabled toggle + ⌥⌘ respects it); visibility/collapse persistence across
reload; hidden terminal keeps its session (no `pty_kill` in the stub log);
rail auto-reveal; horizontal splitter drag + persistence.

**Commit** — 9fb1e96

## Z-2b · The agent pane (F32–F35 + F37 header)

**What landed** — the pane built to the Deck 7 comps and wired to the Z-1
seam. `src/lib/agent-session.ts`: a framework-free per-project store (the
term-sessions pattern) that reduces the ONE `acp-update` stream into a
renderable thread — chunks, tool calls/updates (with an honest multiset-line
± stat from ACP diff content), permission asks keyed by the wire request id,
mode/usage updates, `_chronicle/*` lifecycle. Components under
`src/screens/agent/`: `AgentPane` (state banners: disconnected · installing
the bridge · needs login with the sign-in-in-a-terminal flow + retry-on-exit ·
honest bridge error + Try again · session ended), `Composer` (⌘Enter sends,
Stop replaces Send while working, the Asks-first/Works-freely control built
from the AGENT'S advertised modes with the once-per-session confirm, usage
meter hidden without data), `ToolCard` (edit/run/read anatomies, all four
statuses, rejected "You said no — skipped", middle truncation, capped
output), `PermissionCard` (agent-supplied options mapped to the canonical
labels — options not offered are absent; answered/cancelled collapse to
one-line records). `AgentSection` header is store-aware: colored Claude mark,
live state word (working / waiting on you / idle / ended / needs login),
End session (confirm only mid-turn). ipc.ts gained the agent command
wrappers + `onAcpUpdate`.

**How it was verified** — `npx tsc --noEmit` + `npx vite build` green. Probe
suite (stubbed `acp-update` events end-to-end): 6 new probes covering the
full card taxonomy — lifecycle + streaming-then-settle + usage meter
appearing only with data; every tool-card kind/status; permission answered
both ways incl. the denied-call skip treatment; cancelled-while-pending
resolving (never hanging); needs-login with the terminal sign-in + retry
after exit; bridge error + turn error + session end + the works-freely
confirm. Full suite: 12/12 passed (Z-2a probes stay green).

**Commit** — 53698a1

## Z-3 · Edits + checkpoints (F33 checkpoint row + F36 review flow)

**What landed** — **Rust (source of truth)**: the disk-backed ledger in
`acp.rs` — bases under `.chronicle/agent/<session>/bases/` (raw pre-change
bytes; no base file = created, undo DELETES it) with `index.json` and a
`current` session pointer, so undo survives an app restart. fs/write is
jailed AND ledgered before the write lands. Checkpoints: temp
`GIT_INDEX_FILE` → `add -A` → `write-tree` → `commit-tree` onto
`refs/chronicle/checkpoints/<session>` before every prompt; restore is the
two-tree `read-tree --reset -u` (re-snapshot current first) so files created
after the snapshot are DELETED; restores only honored for commits on the
session's own ref, refused mid-turn. Turn-end reconciliation diffs the
checkpoint tree against a fresh snapshot: shell-changed files enter the
ledger as via_command with bases pulled from the checkpoint (reviewable
diffs, per-file undo refused — "Undo to here covers it"). Clean session end
auto-keeps + deletes the ref; orphaned refs >14 days pruned at session start.
Commands: `agent_edits`, `agent_edit_diff`, `agent_edit_keep`,
`agent_edit_undo`, `agent_restore_checkpoint` — all jailed, all usable with
no live session. **Frontend**: the ReviewStrip ("N files changed · Review ·
Keep all · Undo all…" with honest scope copy in the Undo-all confirm, and the
resolution states incl. the session-ended auto-keep message); Review opens
the existing repo viewer on the ledger diff with the F36 action bar (progress
count, Keep / Undo-this-file with confirm, the command-changed variant with
Keep only); the F33 checkpoint row above every user message (hover-revealed
"Undo to here", the exact honest confirm copy, hidden mid-turn).

**How it was verified** — `cargo test`: 29 passed — new: the checkpoint
round-trip covering CREATED + DELETED + MODIFIED files, tracked AND
untracked (created files must be deleted by restore — the known failure
mode; the user's real index asserted untouched); ledger diff correctness +
created-file undo = deletion + original-base-wins; base persistence across a
simulated restart; turn-end reconciliation (direct vs via_command, checkpoint
bases, refusals, undo-all scope); jail refusals; ref pruning (old pruned,
fresh survives). Frontend: `npx tsc --noEmit` + `npx vite build` green;
5 new probes (strip counts + Keep all; Undo all honest scope with
command-changed files remaining; the full review pass incl. the
command-changed bar; checkpoint restore through the confirm; mid-turn undo
hidden). Full probe suite: 17/17.

**Commit** — d5778bc

## Z-4 · Integrations + history (F37 · F38 · F39)

**What landed** — **Rust**: the transcript store — every thread-relevant wire
message appends to `.chronicle/agent/<session>/thread.jsonl` AS IT STREAMS
(user messages, session updates, permission asks + outcomes, checkpoints,
turn ends, session end); `agent_sessions_list` (newest first, first-message
excerpt, user-message count, active flag), `agent_history_read` (capped
replay lines), `agent_session_resume` — TRUE resume via `session/load`, only
when the initialize response advertised `loadSession` (persisted to
`caps.json` so history gates Resume honestly with no live session); the
adapter's load-replay is suppressed (the UI rebuilds from OUR transcript —
no double-append, no double-render). `agent_session_stop` gained `clean`:
project close stops the child WITHOUT auto-keeping, so the ledger stays
reviewable on reopen. **Frontend**: the reducer is now shared between live
events and transcript replay (`reduceInto`); F37 history popover in the
agent header (Resume where allowed; View · Continue in a new session
elsewhere, with the honest read-only footer) + the read-only viewing mode
("nothing here can act"); F38 — the phase detail's primary is "Start with
the agent" (reveals the pane, preloads the prompt as an UNSENT draft with
the chip + "review and send" note; a held draft asks "Replace what you've
written?" first; "Run in a terminal" is the secondary); F39 — "Run the round
for me" now lands in the pane (round prompt = first message, sent only when
the session is ready), with the round card deriving done/stopped-early from
the BOARD's columns + the stop reason only — never the agent's claim;
headless stays as "Run it in the background instead". Close-project confirm
covers a live agent session; agent-session endings journal + native-notify
exactly like today's session endings.

**How it was verified** — `cargo test`: 30 passed (new: transcript store
lists newest-first with excerpts/counts, skips empty sessions, gates
resumable on the persisted capability and never on the live session, replay
reads in order). `npx tsc --noEmit` + `npx vite build` green. 4 new probes:
phase-start preload (never auto-sends, keep/replace confirm both ways);
round-in-pane (card from board ground truth: running → stopped early with
stop reason → done only when the board completes); history resume vs
read-only fallback (session/load call gated, viewing mode inert); close
confirm + un-clean stop (`clean: false` asserted). Full suite: 21/21 probes.

**Commit** — 1cf68b4

## Z-5 · The five refinements (E–I) — one commit each

**E — plain-language remote output** (`161ce60`). A pure fixture-tested Rust
mapping (`remote_sentences`) turns push/pull output into sentences —
"Published 3 saves", "Brought down 2 saves", "Already in sync — nothing new" —
with the raw git line as small mono secondary and GitHub's
create-a-pull-request hint detected into a toast ACTION (https-only
`open_url`). `git_push`/`git_pull` now return the outcome; both toast sites
use it. Verified: 2 rust tests over real git stderr fixtures (new-branch push
with the hint, existing push, up-to-date both ways; remote: chatter never
leads).

**F — clickable terminal paths** (`a33a4a2`). A bounded xterm link provider
(per-hovered-line scan, 20-link cap): paths incl. `:line` underline with the
"Open in the repo view ⌘-click" tooltip; ⌘-click routes to the repo viewer
(line suffix stripped), plain clicks stay the terminal's. Verified: probe
with a fake pty feed — hover tooltip, plain-click inertness, ⌘-click landing
in the viewer (stat_file for the path asserted).

**G — honest terminal-tab status** (`3b72ca8`). `pty_info(id)` reads the
pty's FOREGROUND process group (portable-pty `process_group_leader` +
sysinfo name/cmdline); a known agent shows the pulsing "working" word, its
exit shows "idle" (sessions remember an agent ever ran — no word before one
does), and the picker badge says "Claude running"/"Codex running". Verified:
rust test drives a REAL pty (`/bin/sleep` foreground resolves; agent
detection incl. node-wrapped claude) + probe walks idle → working → idle
through stubbed `pty_info`.

**H — Draft-it prompt** (`335f445`). The save-message prompt adopts Zed's
commit-message discipline in Chronicle's register: imperative mood,
50-character target (72 hard), what-and-why in plain words, no diff
restating. Model stays haiku; no surface change. Verified: compile (prompt
const only).

**I — update download progress** (`1b0ec72`). `lib/updates.ts` is a state
machine (available · checking · downloading pct · installing · restart) fed
by the updater plugin's own progress events; the title-bar line renders
Checking… / Downloading 42% (mono tabular) / Installing… / "Restart to
finish · Restart" — restart offered, never forced; failed auto-checks stay
silent, manual checks stay loud. Picker's line follows. Verified: probe
drives every state through stubbed updater channel events, ending on the
real relaunch call.

Full probe suite after Z-5: **24/24**; `cargo test`: **33 passed**.

## Z-6 · Ship

**What landed** — the README gained "The agent" section (register-true: what
the pane is, the two modes, review/undo honesty, Undo to here, history,
integrations) plus the ⌥⌘1/2/3 shortcut row and the acp.rs backend note
(`5bc45d3`). Chronicle **v0.3.0** released via `./release.sh 0.3.0` —
signed, notarized (Accepted), Gatekeeper-verified, tagged `v0.3.0` on main,
GitHub release with DMG + updater tarball + signature + OTA `latest.json`
(now serving 0.3.0 for darwin-aarch64). One hiccup, resolved: the first
release run died at DMG bundling because a stale `/Volumes/Chronicle` image
from the aborted pass was still mounted — detached it and the rerun went
clean end to end.

**How it was verified** — the full Z-6 sweep before shipping: `cargo test`
33 passed + the `CHRONICLE_ACP_TEST=1` real-adapter round-trip re-run green
AFTER all ledger/checkpoint changes (7.4s); `npx tsc --noEmit` +
`npx vite build` green; the full probe suite 24/24 (Z-2a shell · Z-2b pane ·
Z-3 review/checkpoints · Z-4 integrations/history · Z-5 F/G/I). Post-release:
`gh release view v0.3.0` shows all four assets, `spctl -a` accepts the
shipped .app, and the OTA manifest at releases/latest resolves to 0.3.0.
Memory updated (adapter-rename warning, gated-test recipe, probe-harness
shape, ledger semantics, release flow).

**Commit** — `884272e` (chore: v0.3.0) · README `5bc45d3`

---

The Zed update is shipped: Z-1 → Z-6 all green, honestly verified at every
phase. Deferred per plan §1-Out: OS sandboxing for auto-mode, queued
messages, thread archive/import, Codex-over-ACP.
