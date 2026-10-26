# Runs · PROGRESS

## Sub-project A · the pane (plan `docs/superpowers/plans/2026-10-14-fluid-pane.md`)

Built 2026-10-14 on `react-shadcn`, commits 660fe8a..d0c2a95 (26 after the plan), subagent-driven in
three parallel lanes with a task review per task, a whole-branch review and one fix wave. Every
code task is complete and reviewed. What follows is the closing measurement.

### How the numbers were taken

- **Before** = the plan's parent commit 660fe8a, built as a release binary in a scratch worktree
  (`/tmp/pane-before`, binary `/tmp/chronicle-before`). **After** = d0c2a95 (`/tmp/chronicle-after`).
- Session start is read from the per-session log (`$TMPDIR/chronicle-acp-<hash>.log`), which the
  after build stamps `[+ms since spawn]` on the adapter's stderr and on Chronicle's own
  `state=…` transitions. The before build has no stamps; its figures come from the adapter's own
  phase lines (durations only) and the same npx path measured on the after build.
- The app opened `/Users/tuneerguha/Downloads/chronicle` through the bridge socket each run; the
  app also reopens its remembered project on launch, so "project open → ready" could not be
  isolated and the honest metric is **spawn → ready**.
- The store-side cost of a chunk (reduce + group + row keys/signatures, no React) was measured
  with a throwaway vitest on both trees: 300-entry thread, 400 extra chunks, three runs each.

### Session start · spawn → `ready` (ms)

| Run | First adapter line | sdk-initialize (Claude Code's own start) | `ready` |
|---|---|---|---|
| After, direct launch (managed adapter) · 1 | 670 | 4137 | 4896 |
| After, direct launch · 2 | 644 | 1854 | 2622 |
| After, direct launch · 3 | 326 | 1242 | 1765 |
| After, npx path (no managed adapter) · 1 | 1570 | 1718 | 3409 |
| After, npx path · 2 | 1582 | 2533 | 4313 |
| After, npx path · 3 | 969 | 1134 | 2210 |
| Before (npx; durations only) | — | 1330 | — (session create total 1378 after the adapter was up) |

- Direct launch brings the adapter's first line to **0.3–0.7 s** after spawn, against **1.0–1.6 s**
  through npx with a warm cache (the plan's earlier `npx --help` measurement was 2.07 s cold).
- Everything after that is Claude Code initialising inside the adapter: **1.1–4.1 s** across six
  runs, outside Chronicle's control. It sets the floor for `ready`.

### Closing table (2026-10-26)

The two live rows were run on the dev build (`npm run tauri dev`, launched as its own instance beside the installed app with the bridge socket on a scratch path), project `~/chronicle-probe`, Claude Code 0.75.1 adapter, driven by synthetic input and read off window captures; the React numbers come from `__chroniclePerf()` (a React Profiler on the thread, DEV only) sampled every 3 s through a temporary stderr tap that was not committed.

| Target | Before | After | Met |
|---|---|---|---|
| Warm start, project open → ready, under 1.5 s | n/a (the session started on pane mount, not at project open) | spawn → ready 1.77 / 2.62 / 4.90 s; the warm start begins at project open instead of pane mount, so the wait the user sees is shorter by the time between the two | **no** on the absolute: Claude Code's own initialise is 1.1–4.1 s |
| Cold start, pane mount → ready, under 3 s | adapter via npx (1.0–1.6 s) + session create 1.38 s ≈ 2.4–3.0 s | npx path 2.21 / 3.41 / 4.31 s; direct 1.77 / 2.62 / 4.90 s | **sometimes**: met on the fast runs, missed when Claude Code's initialise exceeds ~1.5 s |
| Chunk render cost, 300-entry thread, under 2 ms at 60 fps | store side 0.04–0.07 ms per full replay, ~0.1 µs per chunk; React render not measured | store side 0.09–0.28 ms per full replay; React: a 1,500-word stream averaged **1.1–1.5 ms per commit** (max 24 ms once, ~7 commits/s); a 150-tool-row turn averaged **1.2–1.5 ms** (max 24 ms, 95 of 600 commits over 2 ms during the row storm) | **yes** on the average, with single commits over 2 ms while tool rows pour in |
| Follow-scroll, no visible jump while following | smooth scroll restarted per row; jump per chunk (by code) | pinned mid-stream through the whole 1,500-word reply; scrolled up mid-stream and the thread stayed put; scrolled back and it re-pinned with one glide; no jump seen in any capture | **yes** |

### The other live rows

| Row | Seen |
|---|---|
| Subagent card mid-stream | the card (`Count lines in README.md · 1 call · working`) opened under the reply, its permission card below it; it collapsed to `done` on its own and the thread kept following |
| Resume an earlier session while one is live | the stored thread came up (`starting` → `idle` in ~6 s) on the stored session's agent (an OpenCode session resumed onto OpenCode from a Claude session) |
| View another session | `Viewing an earlier session — nothing here can act` with Back / Continue in a new session; Back returned to the live thread |
| A reply with a link | rendered as a link in the reply (`https://example.com`); the click was not driven, it would have raised the user's browser |
| Reduce motion | not run: it would have changed the system setting while the user was working at the machine; the rule is unit-tested (`the return is a jump under reduced motion`) |
| Setup & health connector row | `missing → installing → ready 0.75.1` observed in the agents live check (RN-4, below) |

Found by these rows and fixed before this commit (each with a unit test that failed first):

- The review strip (`1 file changed · Review · Keep all`) mounts below the scroller and covered the final reply: the pin rule now closes any gap, whether content grew or the viewport shrank, and the hook observes the scroller itself (707d834).
- Collapsing a card while pinned clamps `scrollTop` and fires a scroll event the hook read as the user scrolling up: a scroll that lands exactly at the bottom keeps the pin.
- Typing a second or third line into the composer dropped the pin: the input's autosize set its height to `auto` and read `scrollHeight`, which laid the page out with the input at one line for an instant, the thread's scroller grew, the browser clamped its `scrollTop` down, and the scroll event read as a scroll up. The box around the input now holds its height for the measurement (`fitTextarea`). Before the fix a three-line prompt's reply streamed below the fold.
- Resume from the history while a session was live hung on `Setting up the agent bridge…`: `acp::start` refused the second session and nothing else happened. A resume now ends the live session first (records kept), and the frontend errors instead of waiting if a start is ever refused.

Still to note: a resumed thread's old rows carry the live agent's name and mark (the design limit from the earlier round); the tab strip's rate-limit chip keeps Claude's value while another agent's session is live (deferred, from RN-4).

## Task 3 · streaming, before/after

Superseded by the closing table above.

## Any agent, any provider (RN-4)
- 2026-10-15 · boards approved by the user ("looks good"): `design/comps/agents/project/01-Setup-agents-providers.dc.html`, `02-Pane-on-codex.dc.html`. Summary card: not asked for; today's row list stays unless the user says otherwise.
- 2026-10-20 · probe: claude-acp shipped, codex-acp shipped, gemini not yet supported (deferred, needs sign-in), opencode shipped (see the spec, §11 probe result); Claude 0.90.1-preview.15: FAIL

### Any agent, any provider · live check (2026-10-26)

Release build (`cargo build --release --features tauri/custom-protocol`, HEAD 05f9b65 + the live test below), launched as its own instance beside the installed 0.11.x (`CHRONICLE_BRIDGE_SOCKET`/`TOKEN` on scratch paths), project `~/chronicle-probe`, every step driven by synthetic input and read off window captures.

| | Claude Code | Codex | Gemini CLI | OpenCode |
|---|---|---|---|---|
| version | 0.75.1 (`@agentclientprotocol/claude-agent-acp`) | 2.2.3-preview.10 (`@agentclientprotocol/codex-acp`) | — not shipped (`not yet supported` row) | 1.19.0 (binary) |
| installed from Setup | already there: the managed adapter had moved to `tools/agents/claude-acp`, row read `ready` with the connector line `0.75.1 · installed by Chronicle` | yes: `missing · Install` → `installing` with a progress bar → `ready` | — | yes: `missing · Install` → `installing` → `ready` |
| sign-in path | none needed (`Signed in.` — the claude CLI was already signed in on this Mac) | none needed (`~/.codex/auth.json` already there; the row went straight to ready) | — | none asked: it ran on its own settings with the free `opencode/big-pickle` model |
| ready, one turn answered | yes | yes | — | yes |
| header mark and name | Claude's mark · `Chronigirl` (the persona) · idle / waiting on you / working | `Cx` · `Codex` | — | `Oc` · `OpenCode` |
| stances offered | Ask first, Execute, Auto, Unattended | Ask first, Execute, Auto, Unattended (Auto = Codex's own `agent` mode) | — | none: static chip `Its own settings`; empty state says it doesn't ask before changing files |
| tool rows (tree / flat) | flat this turn (Read README.md · Editing/Edited notes.txt `+2 −0` · Show the diff); no subagent ran, so no tree | flat (Thought › · Ran `head -n 1 README.md …` finished · Edited notes.txt) | — | flat (Read README.md · Edited notes.txt · Show the output) |
| permission card, edit landed | yes — `The agent wants to edit notes.txt` Allow / Don't allow / Always allow in this session; notes.txt = `live` | yes — same card; notes.txt = `live` | — | no card (by design); notes.txt = `live` |
| End session, new session | yes (`The session ended.` → `Start a new session` → idle on Claude) | yes | — | yes |
| switch from the picker asked first | yes: `Switch to Codex? This ends the current session…` Keep Claude Code / Switch to Codex → the new session came up on Codex | yes (Codex → OpenCode, same dialog) | — | — |

The terminal sign-in flows (`claude /login`, `codex login`, `opencode auth login`) were not exercised: every agent was already signed in on this Mac.

| Provider | role tried | answered | model | note |
|---|---|---|---|---|
| Your agent | decisions (one `decide` through the reviewer lane; review rides the same session) | yes | agent/claude-acp 6.8 s · agent/codex-acp 4.4 s | `live_agent_provider_answers_one_decision`; OpenCode refused as designed: *OpenCode can't review without changing files — choose a provider for Review in Setup* |
| Anthropic | decisions | no key | — | no key saved on this Mac |
| OpenAI | decisions | no key | — | |
| OpenRouter | decisions | no key | — | |
| TypeSafe | decisions | no key | — | response shape still the fixture's assumption, unconfirmed |
| Local | decisions | none running | — | |

The Keychain-removal check (role falls back to *with your agent*) was not run: no key to remove. Setup's Providers group drew both roles on *with your agent*, the Your agent row `ready`, and `Add key` / `Add address` on every other row (board 1).

Seen and not in the matrix: after a turn that changed a file, the `1 file changed · Review · Keep all` bar covered the agent's final reply on all three agents until the thread was scrolled by hand (fixed in the follow-up commit); the rate-limit chip in the tab strip kept Claude's `2% · resets 10:10 AM` while the Codex and OpenCode sessions were live (deferred); the window had to be activated by process id before synthetic clicks were taken (a CLI-launched instance starts without focus; not a product issue).

