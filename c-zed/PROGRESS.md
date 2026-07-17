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

**Commit** — 9f1fa8e
