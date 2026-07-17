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

**Commit** — recorded in the following docs commit
