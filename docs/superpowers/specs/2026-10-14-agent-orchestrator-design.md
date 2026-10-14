# Runs: the agent orchestrator, and the pane it lives in · design

Date: 2026-10-14. Status: **draft, awaiting the user's review** (then `writing-plans`).
Written from the brainstorm of 2026-10-14. Every decision the user made there is recorded in §1
and not re-asked. The choices this spec had to make on its own are collected in §15 for the user
to confirm or overturn.

Comps: none yet. §14 lists the boards the comps brief asks for (`c-runs/DESIGN_PROMPT.md`);
nothing in §2–§9 is built until those boards are approved.

## What this program is for

Today a round is one Claude Code session in the chat pane working through a whole fixes plan,
item after item, with the user answering every permission prompt. The user's words: *"the most
efficient agent orchestrator"*, efficient on all four axes (wall-clock, tokens and cost, the
user's attention, correctness per token), and *"gated but hands off. it needs to make these
decisions by itself."* The second half of the program is the user's follow-on requirement: *"we
also need to make the agent quicker and visually fluid."* A run that fans out into lanes is only
legible in a pane that keeps up with it.

So this spec has two sub-projects, built in this order:

- **Sub-project A · the pane**: faster session start, streaming that stays at 60 frames per
  second, scrolling that does not fight the stream, and one motion vocabulary. Small, measurable,
  and the run card is built on it. §9.
- **Sub-project B · runs**: a plan split into lanes of disjoint files, run in parallel inside the
  one working tree, each lane gated by checks and a review, closed by Chronicle, with a small
  typed decision model making the judgment calls the user no longer wants to make. §2–§8.

## 1 · Decisions inherited from the brainstorm (not re-asked)

| Decision | The user's choice |
|---|---|
| Where it lives | A Chronicle feature, in the chat pane. Not a session process, not a standalone tool. |
| Efficiency | All four axes. Lead: hands off. Chronicle decides; the user is told. |
| Entry points | All three: from queued notes (replaces "Plan a round"), from an existing `fixes/phase_N_fixes_plan.md`, from any prompt in the chat composer. |
| What still reaches the user | Only: git push, publish, tag or release (refused outright, never done for them), and scope changes (an item that cannot be done as written). No budget stop; cost is shown, never gated. |
| Engine | Workflow-native: Claude Code's Dynamic Workflows, shipped as a Chronicle plugin. The Chronicle-native scheduler (one ACP session per lane) is the fallback if the spike in §5 fails. |
| Judge | Jev (TypeSafe AI's typed decision model), for bounded decisions only. Review verdicts stay on a Claude model. |
| Research | GitHub and the public specs were searched; nothing embeddable exists (§16). Patterns are borrowed, not code. |
| Pane problems to fix | All four: starting a session, text streaming, cards and motion, scrolling and layout. |
| Process | Comps first, approved by the user, before any code. Branch in place, never a worktree for development. |

## 2 · Ground truth this spec rests on (verified 2026-10-14)

- **Rounds today.** `src-tauri/src/notes/rounds.rs` keeps `Round { n, state: generating | ready |
  failed | done, kind, task_ids, note_paths, plan_path, prompt_path }` in `.chronicle/rounds.json`.
  The planning prompt `FIXES_PROMPT_HEAD` (main.rs) has the agent write
  `fixes/phase_{N}_fixes_plan.md` and `_prompt.md`, flip each note to `status: done` as it lands,
  and end with a commit carrying the trailer `Chronicle-Phase: FX-{N} done`. Chronicle decides
  ready or failed from disk in `round_plan_settle`. The notes pane shows it as `RoundCard.tsx`.
- **Lanes today.** `enum Lane { Chat, Design }` (`acp.rs`); key `<canon>` or `<canon>#design`;
  one `AcpSession` per key, single-flight start, `designs_root` is the write fence. Permission
  requests arrive as `session/request_permission` with the tool name in `toolCall.name` or
  `_meta.claudeCode.toolName`; the design lane answers them itself through
  `design_write_decision` (Allow / Refuse / Cancel), `design_mcp_decision` with an auto-allow
  prefix list, and a mode lock on exit-plan. Refusals are shown in the thread as `guard` entries.
  Checkpoints: `snapshot_tree_as(repo, lane)`.
- **Adapter.** `@agentclientprotocol/claude-agent-acp@0.75.1`, bundling
  `@anthropic-ai/claude-agent-sdk` 0.3.257. The SDK has had the `Workflow` tool since 0.3.149.
  The adapter is spawned as `npx --yes -- <pkg>@<ver>` with `ANTHROPIC_API_KEY` blanked (the
  user's own Claude Code login does the work; **Chronicle holds no Anthropic key**) and
  `CLAUDECODE` removed. Measured on this Mac: `npx … --help` 2.07 s; the cached binary in
  `~/.npm/_npx/<hash>/node_modules/.bin/claude-agent-acp --help` 0.17 s.
- **Managed tools.** `setup.rs` installs Node into `~/.chronicle/tools` and links `node`, `npx`,
  `npm` into its `bin/`. The design plugin ships under `src-tauri/resources/design-plugin/`
  (`agents/`, `skills/`); Claude Code plugins may also ship `workflows/`.
- **Frontend.** `src/lib/agent-session.ts` is the store: `notify()` calls every subscriber
  synchronously on every update. `AgentPane.tsx` re-renders the whole pane on each notify
  (`useState` bump), re-parses the full streaming reply through `src/lib/mini-md.tsx` on each
  chunk, and follows the bottom with a smooth `scrollTo` on a new row and a jump on a chunk
  (`nearBottom` under 60 px). Rows are wrapped in `<Appear>`. No memoisation, no virtualisation.
  Dependencies already present and unused in the pane: `motion` 12.42.2 (only in kibo-ui
  shimmer) and `streamdown` 2.5.0 (unused). `shiki` is present. React 19.2.7.
- **Checks in this repo.** `npm test` (vitest), `npm run typecheck` (tsc -b), `npm run build`,
  `cargo test` in `src-tauri`. `chronicle.json` has `workBranch` and no `checks` list.
- **Agent teams** (Claude Code's other multi-agent primitive) are experimental and not available
  through the SDK or non-interactive use. Ruled out.
- **Dynamic Workflows**: a JavaScript script with `agent()`, `parallel()`, `pipeline()`,
  `phase()`; schema-typed agent outputs; up to 16 concurrent agents and 1,000 per run; stalled
  agents restarted up to 5 times; `resumeFromRunId` within one session; one shared prompt cache;
  a model per agent. Permission to run it is an allow rule for `Workflow` or the host's
  `canUseTool`. A plugin ships saved workflows in `workflows/`.
- **Jev** (`jev-1.13.0`, early access): typed decisions, Choice (option, per-option
  probabilities, confidence), Score (position on a scale, distribution, confidence), Noul
  (yes-probability, no confidence). Text or JSON state only, 64k tokens a request, state plus the
  longest question at most 32k. Priced at $0.042 per million input tokens, output free. Hosted
  only. Reached at `POST https://api.typesafe.ai/v1/systemone` with `model`, `state`,
  `instructions`, `criteria`, or through OpenRouter `POST /api/alpha/decisions` as
  `typesafe/jev-1.13` with an OpenRouter key. Independent timing: median 243 ms against 1.5 s for
  a chat model on the same decisions. The REFLEX paper (arXiv 2609.26532): Jev first, escalate to
  a strong model when confidence is low, 95% task success with 72.7% fewer strong-model calls.
  The vendor's guidance: three confidence bands, thresholds set from labelled data, confidence
  measures concentration, not correctness.

## 3 · Lifecycle of a run

A **run** is one plan executed as a set of **lanes**. A lane owns a disjoint set of files and a
subset of the plan's items. The run record is `.chronicle/runs/<n>.json`; Rust is its only
writer. Rounds (`rounds.json`) stay as the notes pane's record of which notes went into which
round; a run links to its round by number.

### Phases

**Planning.** A planner turn (the session's current model) reads the queued notes, the plan
file, or the prompt, and writes two things: the plan (`fixes/phase_{N}_fixes_plan.md` and
`_prompt.md`, exactly as today) and a **lane map**, declared through a Chronicle MCP tool, not
written to disk by the agent. The lane map lists lanes; for each, its items, the paths it owns
(globs), the lanes it depends on, and which of the repo's checks apply to it. Chronicle
validates the map before accepting it: owned paths are pairwise disjoint; every item is in
exactly one lane; dependencies are acyclic; checks come from the repo's check list and nowhere
else (§7). An invalid map is returned to the planner with the reason, up to two times, then the
run fails before anything is written. There is no user approval of the plan. Hands off.

**Running.** A lane starts when every lane it depends on has closed and a slot is free (default
3 lanes at once, `maxLanes` in `chronicle.json`). Each lane is an implementer agent working in
the shared tree under the fence of §4. Its attempt states are Symphony's: preparing, building
prompt, launching, initialising, streaming, finishing, then succeeded, failed, timed out,
stalled or cancelled. Stall is five minutes without a wire message. Retries back off at
`min(10 s × 2^(attempt−1), 300 s)`; three attempts, then the lane is parked and reaches the user
(needs-you). A lane that cannot do an item as written calls the `block` tool with a reason; §6
decides whether that claim is accepted.

**Gating.** When a lane's turn ends, Chronicle checks the tree snapshot: files changed outside
the lane's owned paths are listed as the lane's **leak** (the shell hole, §4) and shown, never
reverted. Chronicle then stages the lane's owned paths by explicit path and commits them. The
lane itself never runs a git write command. Git writes are serialised across lanes by one mutex
in Rust. Chronicle verifies that commit in a **scratch worktree** outside the repo
(`~/Library/Application Support/Chronicle/scratch/<repo-hash>/`), detached at the commit, with
`CARGO_TARGET_DIR` pointed at the main tree's target directory and `node_modules` linked, and
runs the lane's checks there. Exit codes are law. A reviewer agent on Sonnet reads the diff and
the check output and returns a schema-checked verdict: pass, or findings with file, line and
what is wrong. On a fail the lane gets a fix prompt with the findings and the failing output,
at most two fix passes, each gated the same way. When every lane has closed, Chronicle runs the
full check list once at head. If head fails with every lane green, §6 decides which lane to
reopen for one fix pass; if that fails too, the run is parked with the failing output.

**Closing.** Chronicle, not the agent, flips the notes to `status: done`, writes the
`Chronicle-Phase: FX-{N} done` trailer commit, and marks the run done. The agent's instructions
drop those two duties.

**Needs-you.** The only states that wait for the user: an item parked as impossible as written
(with the lane's reason and the judge's reading of it); a lane that exhausted three attempts; a
head failure that survived triage; and a refused push, tag, publish or release, which is shown
so the user knows the agent tried. Each row offers the one or two actions that make sense:
rewrite the item, skip it, retry the lane, open the lane thread.

**Stop.** Stop on the run card cancels the workflow (`session/cancel`). Nothing is reverted.
The pane's outside-changes list shows what each lane left uncommitted, with "discard" per lane
that runs `git checkout -- <owned paths>` only on the user's click.

**Resume.** The workflow's own resume works only inside one session. If Chronicle or the
adapter restarts mid-run, the run record says which lanes closed; the run card shows
"interrupted" with Resume, which starts the workflow again with the run number, and the script
skips lanes already closed.

### The run record

```json
{
  "n": 10, "round": 10, "kind": "notes | plan | prompt",
  "state": "planning | running | gating | closing | done | needs-you | failed | stopped | interrupted",
  "created": "…", "updated": "…",
  "plan_path": "fixes/phase_10_fixes_plan.md", "prompt_path": "fixes/phase_10_fixes_prompt.md",
  "lane_map": { "lanes": [ { "id": "a", "title": "…", "items": ["T-141"], "owns": ["src/lib/agent-session.ts"],
                             "depends_on": [], "checks": ["test", "typecheck"] } ] },
  "lanes": [ { "id": "a", "state": "…", "attempt": 1, "started": "…", "ended": "…",
               "cost_usd": 0.42, "tokens": { "in": 0, "out": 0 }, "commit": "…", "leak": [],
               "gates": [ { "commit": "…", "checks": [ { "name": "test", "exit": 0, "ms": 0 } ],
                            "review": { "model": "sonnet", "pass": true, "findings": [] } } ],
               "parked": null } ],
  "head_check": { "commit": "…", "checks": [] },
  "decisions": [ { "at": "…", "kind": "shell | block | triage | sizing", "model": "jev-1.13.0 | haiku",
                   "choice": "…", "probabilities": {}, "confidence": 0.0, "band": "act | second-opinion | strict",
                   "action": "…" } ],
  "needs_you": [ { "kind": "parked | exhausted | head | refused", "lane": "a", "item": "T-141", "reason": "…" } ],
  "cost": { "usd": 0.0, "in": 0, "out": 0 }
}
```

## 4 · Isolation in one working tree

The user's rule, now the agent's rule: no worktrees for development (the 1.2 GB target
directory), and parallel agents in one tree never touch each other's files or the index.

- **Write fence.** `design_write_decision(params, designs_root)` is generalised to a `Fence`
  the session carries: `Fence::Design(root)` or `Fence::Lane { owns: Vec<Glob> }`. Write, Edit,
  MultiEdit and NotebookEdit inside the owned paths are allowed without asking; outside them
  they are refused with a guard entry naming the path and the lane that owns it, if any. Nothing
  writes under `.chronicle/`, `fixes/`, or `chronicle.json` from a lane; the planner writes
  `fixes/` before lanes exist.
- **Git guard.** A lane's shell command whose first word is `git` is parsed. Read-only verbs
  (status, diff, log, show, blame, ls-files, grep, rev-parse, branch with no arguments) are
  allowed. Every other git verb is refused with the reason "Chronicle commits for you". Push,
  tag, publish and release verbs (`git push`, `git tag`, `gh release`, `npm publish`,
  `cargo publish`, `release.sh`) are refused from every lane including the planner and the chat
  session during a run, and the refusal is a needs-you row so the user sees it was attempted.
- **The shell hole.** `sed -i`, redirects and scripts can write outside the fence. They are not
  parsed. Instead the turn-end snapshot diff reports any changed path outside the lane's owned
  set as a leak on the lane's gate row. Chronicle commits only the owned paths; a leak sits
  uncommitted and visible until the user or a later lane that owns it deals with it. A leak
  into another active lane's owned paths is also reported on that lane's row.
- **Shared files.** A file two items both need is owned by one lane, and the other lane depends
  on it. The planner is told this rule; validation enforces disjointness. No leases in v1.
- **Index.** Only Rust runs git write commands, under one mutex. Lanes read freely.

## 5 · Engine: workflow-native, as a Chronicle plugin

Chronicle ships an **orchestration plugin** beside the design plugin
(`src-tauri/resources/run-plugin/`): three saved workflows in `workflows/` (one per entry
point, all calling one shared body), agent definitions in `agents/` (planner, implementer,
reviewer on Sonnet), and a skill with the lane rules. The chat lane session loads the plugin
when a run starts, exactly as the design lane loads its plugin through `_meta.claudeCode.options`.

- **Starting a run.** Chronicle sends one prompt to the chat session that invokes the saved
  workflow by name with arguments (run number, entry kind, note paths or plan path or prompt
  text). Chronicle auto-allows the `Workflow` tool for that session while a run is active.
- **Inside the script.** Planner agent → `chronicle_run_declare` (the MCP tool; the Rust side
  validates and stores the lane map) → a `pipeline` per lane gated on its dependencies:
  implementer agent → `chronicle_run_gate(lane)` (Rust commits owned paths, runs checks in the
  scratch worktree, returns results) → reviewer agent with the diff and check output, schema
  output → fix loop at most twice → `chronicle_run_lane_close(lane)`. Then
  `chronicle_run_head_check()`, triage if needed, `chronicle_run_close()`. Every state change
  passes through a Chronicle tool so Rust stays the only writer of the run record. The script
  carries no policy; policy is in Rust.
- **Chronicle MCP tools added**: `chronicle_run_declare`, `chronicle_run_gate`,
  `chronicle_run_lane_close`, `chronicle_run_head_check`, `chronicle_run_close`,
  `chronicle_run_state` (for resume), `chronicle_run_block` (the impossible-item claim),
  `chronicle_run_ask` (a lane's question that the judge, not the user, answers; §6).
- **Permissions.** The chat session stays in ask-first. During a run Chronicle answers each
  `session/request_permission` by policy: fence for writes, git guard for git, Chronicle's own
  MCP tools allowed, read tools allowed, any other shell command goes to the judge (§6). Outside
  a run the chat lane behaves as today.
- **Observability.** The pane already builds a subagent tree from tool entries carrying
  `parentId`. The run card (§8) is built on the same entries plus run-record events pushed from
  Rust.

### The prerequisite spike (one day, before any plan)

Two questions, answered against adapter 0.75.1 with a throwaway plugin on a toy repo:

1. Does the pane receive the workflow's agents as subagent tool entries, with their text and
   tool calls, in real time? (Expected yes: subagents already appear this way.)
2. Can a `session/request_permission` be attributed to the lane that raised it (agent id or
   parent tool call id in the request's `_meta`)? Without this the fence cannot be per lane.

If 1 fails, the run card falls back to run-record events only, and the lane thread shows the
lane's commit and gate output rather than a live transcript. If 2 fails, the fallback engine is
**one ACP session per lane**: `Lane::Worker { run, k }`, key `<canon>#w/<run>-<k>`, thread store
under the run's folder, Rust scheduling the lanes and running the reviewer as a turn in each
lane's session. The lifecycle, record, fence, judge and card are identical either way; only §5
changes. The spike's output is a recommendation and nothing it builds is kept.

## 6 · The judge, on Jev

Four decisions are bounded, frequent and deadline-sensitive enough to hand to a typed decision
model instead of a chat model. Everything else is a rule in Rust or a Claude reviewer.

| # | When | State sent | Decision | Act on |
|---|---|---|---|---|
| 1 | A lane's shell command is not a read tool, not git, not a Chronicle tool | The command text, the lane's owned paths, the item's title, the last two tool calls | Choice `allow / confirm / refuse`, plus Noul "this writes outside the owned files" | allow → run; confirm → ask Sonnet once with repo access, act on its answer; refuse → guard entry, lane told why |
| 2 | A lane calls `block` on an item | The item as written, the lane's reason, the plan excerpt, files it owns | Noul "the item cannot be done as written" | yes-probability high → park, needs-you; low → one more attempt with the pushback; middle → Sonnet second opinion |
| 3 | Head check fails with every lane green | The failing output, each lane's title, items, changed files | Choice over lanes (plus "none") | the chosen lane gets one fix pass with the output |
| 4 | Planning, before the planner is prompted | A computed table: items, the files each item names, pairwise overlaps | Score 1–6, how many lanes | passed to the planner as the lane count to aim for, capped by `maxLanes` |

**Confidence bands** (REFLEX): high → act; middle → one Sonnet second opinion with repo access,
act on it; low → the stricter option (refuse, park, "none", fewer lanes). Thresholds start at
0.75 and 0.45 and are tuned from the decision log once there are runs to label.

**Never delegated**: ownership (the fence), git by path, push and release, check exit codes,
the review verdict. The judge never sees whole files; it sees command text, plan excerpts,
titles and failing output. Every call and its answer is appended to `decisions` in the run
record and shown in the thread as a guard entry with the option taken and the probabilities.

**The key.** A new Setup & health row, **Decisions**, takes a TypeSafe key or an OpenRouter
key, stored in the macOS Keychain, never in a repo file. The row says in plain words what leaves
the machine: command text, plan excerpts, failing output, never whole files. The row is not in
the required count. Without a key the judge runs the same four decisions on Haiku through the
session's Claude login with a one-line notice on the run card; see §15.

## 7 · Entry points and the repo's check list

- **From queued notes.** The notes pane's "Plan a round" becomes "Run a round": same picker,
  same round record, then a run. The round's `state` follows the run.
- **From a plan file.** A `fixes/phase_N_fixes_plan.md` with items left opens a "Run this plan"
  action on the plan's row in the notes pane and as a composer slash entry.
- **From a prompt.** The chat composer gains a run toggle (comps decide its shape). The planner
  turns the prompt into a plan and lane map; a prompt that yields one item runs as one lane,
  still gated, still closed by Chronicle.

**Checks.** The list a lane may name comes from `chronicle.json` `checks` if present, else
detected: `package.json` scripts named `test`, `typecheck`, `lint`, `build`, and `cargo test`
where a `Cargo.toml` is found. Nothing else runs. Each check is a name mapped to a command
Chronicle owns.

## 8 · What the user sees

One **run card** in the chat thread, one row per lane, with the run's cost and elapsed time in
the header. Opening a lane shows its thread: the subagent tree, its gate rows (checks with pass
or fail, the review's findings), its leak if any. Needs-you rows carry their one or two buttons.
The notes pane's `RoundCard` mirrors the run's state word and lane count. The journal gets one
line per transition. Vocabulary follows the house law: saved, not committed; published, not
pushed; a lane "finished", "is being checked", "needs you". Comps decide the rest (§14).

## 9 · Sub-project A · the pane: speed and motion

**Starting a session.** About 1.9 s of every start is npx resolving the adapter. Chronicle
resolves the adapter once: the doctor installs the pinned adapter into the managed tools
directory (`~/.chronicle/tools`) as a new Setup row, "The agent's connector", and
`adapter_command` spawns its binary directly, falling back to npx only when nothing is installed.
Second: **warm start**. The chat session's initialise and `session/new` begin when the project
opens, not when the pane mounts, for the chat lane only and only when Claude is installed. The
pane attaches to the warm session. The status word stays honest while it warms.

**Streaming.** `notify()` coalesces to one call per animation frame; the pane subscribes with
`useSyncExternalStore` to a versioned snapshot. Rows are memoised by entry id and content
version so one chunk re-renders one row. The streaming reply renders through `streamdown`
(already a dependency), which parses completed blocks once and re-parses only the open block;
`mini-md` stays for non-streaming text until parity is shown, then goes. Code blocks keep
`shiki`.

**Scrolling and layout.** Following the bottom uses CSS scroll anchoring on a bottom sentinel:
no `scrollTo` while the user is at the bottom; one smooth glide when they return to it; the
"jump on chunk" path goes. Rows get `content-visibility: auto` with an intrinsic size so
off-screen entries cost nothing to lay out. No virtualisation.

**Cards and motion.** `motion`'s layout animations on cards, trees and the run card's rows; one
easing and two durations defined once in `index.css` and used everywhere in the pane; state
words cross-fade. All of it off under `prefers-reduced-motion`, as the existing `.wv-enter`
rules already are.

**Targets, measured in the app.**

| What | Target |
|---|---|
| Warm start, project open to session ready | under 1.5 s |
| Cold start, pane mount to session ready | under 3 s (today's figure is measured first, in sub-project A) |
| Streaming on a 300-entry thread | 60 fps; one chunk costs under 2 ms of render |
| Follow-scroll | no visible jump while following |

Measured with performance marks around reduce and render in a dev trace, and the window probe
harness for live checks. Sub-project A ships with a before/after table in its PROGRESS file.

## 10 · Data and files

- `.chronicle/runs/<n>.json` (§3), `.chronicle/rounds.json` unchanged in shape.
- `src-tauri/src/runs/` (new): `record.rs`, `lane_map.rs` (validation), `fence.rs` (the
  generalised fence and git guard, moved out of `acp.rs`), `gate.rs` (scratch worktree, checks,
  commit by path), `judge.rs` (Jev and Haiku clients, bands, log), `tools.rs` (the MCP tools).
- `src-tauri/resources/run-plugin/{workflows,agents,skills,NOTICE.md}`.
- `src/screens/agent/RunCard.tsx`, `LaneThread.tsx`; `src/lib/runs-store.ts`.
- Setup rows: "The agent's connector" (A), "Decisions" (B). The key is read and written with the
  macOS `security` command (no new crate), under a Chronicle-owned service name.

## 11 · Error handling

- Planner never declares a map → two retries with the validation reason, then run failed with
  the planner's last text shown.
- Adapter dies mid-run → run `interrupted`; lanes' uncommitted files listed; Resume offered.
- Scratch worktree cannot be created (disk, permissions) → the gate runs checks in the main
  tree with lanes paused; a notice on the gate row says so.
- Jev unreachable or over quota → that decision falls to Haiku for the rest of the run, one
  notice on the card; the log records which model answered.
- A check hangs → killed at 10 minutes, counted as failed with the partial output.
- Two lanes' leaks collide → both rows show it; the gate still commits only owned paths.

## 12 · Testing

- Rust unit tests: lane-map validation (disjointness, cycles, unknown checks), fence decisions,
  git guard parsing (every verb in the lists, quoting, `&&` chains, `gh`/`npm`/`cargo` publish
  verbs), run record transitions, backoff arithmetic, judge band selection from recorded
  responses.
- Gated integration test (like the ACP gated test): a toy repo fixture with two lanes, a
  deliberate leak, and one `block` claim, run end to end against the real adapter when the gate
  environment variable is set.
- Vitest: store coalescing (N updates in one frame → one notify), memoised rows (one chunk →
  one row render, counted), streamdown parity against the mini-md fixtures, run-store reducer.
- Replay fixture for the run card and lane thread, as round 9 did for subagents.
- Live checks through the window probe harness, with the §9 table filled in.

## 13 · Program order

1. Comps brief and boards for both sub-projects (§14); the user approves.
2. The one-day spike of §5; result recorded in this spec's §5.
3. Sub-project A, the pane: its own plan and PROGRESS, measured before and after.
4. Sub-project B, runs: Rust foundations (record, fence, gate, tools), the plugin, the judge,
   then the run card on the new pane.

## 14 · Boards the comps brief asks for

1. The run card with three lanes working and one being checked, in the chat thread.
2. A lane opened: its thread, the subagent tree, a gate row passing.
3. A gate failing → the fix pass → the head check → the close, as one sequence.
4. Needs-you: a parked item and a refused publish, and the notes pane's RoundCard mirroring.
5. The pane in motion: the vocabulary (easing, two durations), a card resizing, a tree
   expanding, a state word changing, and the reduced-motion variant.
6. Session start: the warm and cold states of the status word, and the two new Setup rows.

## 15 · Choices this spec made on its own (confirm or overturn)

1. **Key-less fallback is Haiku with a notice**, not a refusal to run. A refusal would make the
   feature unusable until the user signs up for an early-access API.
2. **Lanes never run any git write command.** The brainstorm listed forbidden verbs; this spec
   makes Chronicle the only committer, which is simpler to guard and matches the user's own rule
   of staging by explicit path.
3. **No plan approval step.** The lane map is validated by rules, not read by the user. The
   plan file is still written and visible.
4. **Default `maxLanes` 3.** The machine runs cargo and vite; more lanes mostly wait on checks.
5. **Reviewer on Sonnet**, as the design lane's four reviewers already are.
6. **Stop reverts nothing.** Discard is per lane, by owned path, on the user's click.
7. **Confidence thresholds 0.75 / 0.45** to start, tuned from the log.
8. **The scratch worktree lives under Application Support**, not in the repo, so the repo's
   status never shows it.

## 16 · Sources and what was taken from each

- OpenAI **Symphony** (Apache-2.0, `SPEC.md`): the claim and attempt state machine, stall
  timeout, backoff formula, reconciliation each tick. No code.
- **Gas Town** (MIT): the idea of a merge queue that bisects a failing batch, which §3's head
  triage replaces with one judged choice. No code.
- **Baton**, **vibe-kanban**, **Open Orchestrator**: worktree-per-issue designs, rejected here
  by the user's no-worktree rule; Conflict Guard's warn-only stance informed "report leaks,
  never revert".
- The **ACP subagents RFD** (draft): child sessions announced via `subagent_update`; the client
  can only cancel. Why §5 keeps policy in Chronicle's permission handler.
- **Claude Code Dynamic Workflows** documentation: the script API, limits, resume, plugin
  `workflows/`.
- **TypeSafe AI Jev** documentation, OpenRouter decisions endpoint, the REFLEX paper
  (arXiv 2609.26532), and one independent timing comparison: the decision types, limits, price,
  endpoints, and the escalation pattern of §6.
