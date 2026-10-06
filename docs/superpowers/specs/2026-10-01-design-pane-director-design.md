# The Design pane, the director (sub-project 2) · design

Date: 2026-10-01. Status: **draft, awaiting the user's review** (the gap review sub-project 1
had, then writing-plans). Written from the approved comps, the foundation spec, the build
ledger's parked findings, and the pinned adapter, without a new brainstorm: every program-level
decision below is inherited from 2026-09-17 and not re-asked. The choices this spec had to make
on its own are collected in §15 for the user to confirm or overturn.

Comps: boards **3, 4, 6, 10, 11** and the rest of **9**, approved 2026-09-17, in
`design/comps/design-pane/` (generator `gen.py`). Where the build must differ from a board, §14
says where and why.

## What this sub-project is for

After sub-project 1 the Design pane has a place for designs, a canvas that shows them, a fenced
second session, and versions. The session, though, is Claude Code with a file contract: it
writes pages, and nothing between the brief and the canvas holds it to a standard. This
sub-project makes it **the director**: a senior art director and UX director with taste it
cannot skip, tools it can see with, a check it cannot dodge, and a critique it has to pass. It
is the part of the program that makes the pane measurably better than Claude Design rather than
merely a place to run Claude Code next to a canvas.

Roadmap phase **DP-2**, items as written there:

- A clarifying form asks what it needs before it starts.
- Every design is checked and critiqued before you see it.
- A fixed set of briefs is rerun each release to prove it beats Claude Design.

## Ground truth this spec rests on (verified 2026-10-01)

- **Adapter `@agentclientprotocol/claude-agent-acp@0.75.1`** (pinned in `acp.rs`) builds the SDK
  options as `{ systemPrompt, settingSources: ["user","project","local"], ...userProvidedOptions,
  settings, env, cwd, …, mcpServers: { ...userProvidedOptions.mcpServers, ...<session/new
  mcpServers> } }` where `userProvidedOptions = _meta.claudeCode.options`. So a session can carry
  its own **`plugins`** (`[{ type: "local", path }]`, supported by the SDK the adapter bundles,
  0.3.257) and its own **MCP servers** in `session/new`. `session/load` takes the same
  `mcpServers`. Nothing here loosens the fence: the ruling that the design session's `_meta`
  carries **no permission allow rules** stands (`designs/prompt.rs`, module comment).
- The design lane today: `design_session_meta` returns only `systemPrompt: { append:
  DESIGN_PROMPT }`; `session/new` and `session/load` send `mcpServers: []`. Turn end already
  snapshots a version and renders thumbnails in a hidden capture window pinned to the design
  host (`designs/versions.rs`, `designs/thumbs.rs`; thumbnails ≤ 720 points wide at 2×).
- The fence's layer 1 auto-allows Write/Edit inside `<designs>/<slug>/…`, refuses dot-leading
  components, and otherwise asks nothing itself; shell commands ask the user every time.
- The frame reporter posts `ready`/`height`/`error`/`blank`/`escape` to the canvas
  (`design-store.ts frameMessage`).
- `DesignThread.tsx` already renders the usage-limit card from `limits-store` and the
  outside-changes list; the composer's design variant offers only "Ask first".
- Setup & health: `CHECK_META` in `setup-store.ts` is one flat list of seven checks;
  `setup.rs` resolves tools, downloads Node into a managed tools dir, and reports install
  progress per check id. The "agents" row is per project and excluded from the required count.
- The app ships `tauri-plugin-notification` 2.3.3 (used by nothing in the pane yet).
- Skills on this Mac: **impeccable 3.5.0** (Apache 2.0; one SKILL.md, 27 command references, a
  standalone anti-pattern detector under `scripts/detector/` run by `scripts/detect.mjs`, and
  live-edit tooling this pane does not use) and **frontend-design** (Apache 2.0, one SKILL.md).
  `canvas-design` and `algorithmic-art` are not on this Mac; they live in the public
  `anthropics/skills` repository (Apache 2.0) and are vendored from there.
- npm today: `@playwright/mcp` 0.0.83, `shadcn` 4.21.0 (the repo's `.mcp.json` pins 4.12.0),
  `lucide-static` 1.49.0 (ISC). No first-party Iconify MCP exists (`iconify-mcp` and
  `mcp-iconify` are third-party), so no icon MCP is used (§5).
- No design exists in this repo's `.chronicle/designs/` right now; the live check used a
  throwaway project.

## Design

### 1 · Scope

In: the persona and its process; the clarifying form; vendored skills as a bundled plugin; the
session's MCP servers; the lint gate; the critique panel and its loop; the scorecard; the review
settings popover; the Design group on Setup & health with the browser download; the rest of
board 9 (review tools getting ready, critique not passing, the reminder); the token plan card;
the benchmark. Out: everything in §16.

### 2 · The persona

The design lane's system prompt append is replaced by a bundled file,
`src-tauri/resources/design/DIRECTOR.md`, included at build time (`include_str!`) so it is
readable and testable as text. Its sections, in order:

1. **Who you are.** A senior art director and UX director working inside Chronicle. You make
   real pages, not mockups; you commit to choices; you say what you assumed. Plain language to
   the user, one sentence at the end of every turn saying what changed (unchanged from today).
2. **The file contract**, unchanged from sub-project 1 (frames, `design.json`, groups, `assets/`,
   local fonts, never outside the folder, never a dot-leading name, never `canvas.json`), plus
   the new files the director may write: `questions.json` (§3), `tokens.json` (§4),
   `critique/round-<n>.json` (§8), `refs/` (references the user attached, read-only to it).
3. **The process for a new design:** read what the project already has (code, tokens,
   components, a `DESIGN.md` if one exists; the design system proper is sub-project 3); look at
   any reference the brief names; ask at most five questions only if an answer would change the
   design materially, otherwise decide and say what you assumed; write the token plan; build the
   lead breakpoint first, then the others; look at every frame you wrote (§5) before the turn
   ends; end the turn. Never run a critique yourself; Chronicle asks for it (§8).
4. **Registers by kind.** App and product UI follow impeccable's product register; marketing,
   web and brand follow its brand register; e-commerce follows both plus Chronicle's own
   shopping rules (§7); decks get their register in sub-project 6 and until then are built as
   1920×1080 pages with the brand register.
5. **Taste guardrails**, the short list the comps' token plan card names: no cream + serif +
   terracotta by reflex, no purple gradients, no card grids as the default answer, no
   uniform reveal animations, contrast and targets as impeccable states them. Impeccable is the
   sole taste authority; where another vendored skill disagrees, impeccable wins.
6. **How a fix turn works** (§7, §8): the message names findings by frame, file and selector;
   fix those, keep everything else, say what you changed.
7. **What Chronicle does for you**, so the director does not try to: renders and screenshots
   every frame at turn end, runs the lint gate, records versions, runs the critique when asked.

The prefix on every message (`[design: <slug> · <folder>/]`) stays and gains one line naming the
project's context files when they exist (`PRODUCT.md`, `DESIGN.md`), so the director reads them
instead of running impeccable's `context.mjs`.

### 3 · The clarifying form (board 3)

The director asks through a file, not through chat prose or `AskUserQuestion`, so the app can
render one form and the answers survive a restart.

- After reading the brief, the director may write `<slug>/questions.json`:
  `{ "v": 1, "questions": [ { "id", "label", "hint", "type": "single" | "multi" | "text",
  "options": [ "…" ], "max": 2 } ], "references": true }` — at most five questions, `hint`
  says why the answer matters ("shapes hierarchy and copy"), `references: true` adds the
  "Anything to match or avoid?" field. Then it ends the turn with a one-line message.
- At turn end, an unanswered `questions.json` puts the design in phase **questions**: the
  thread shows the form card ("Before I draw · 4 questions · ~20 s"), the canvas shows the
  declared frames as dashed placeholders reading "waiting for your answers", the list row reads
  "draft", and the thread's status word is "waiting on you".
- **Send answers** writes `"answers": { "<id>": "…" | ["…"] , "references": ["…"] }` into the
  same file (the app may write it; the session owns the questions, the app the answers) and
  sends one message: the answers as labelled lines, references as paths under `<slug>/refs/`
  (files the user attached are copied there; a URL is passed as text). **Skip** sends "Skip the
  questions. Decide, and say what you assumed." and records `"skipped": true`.
- A form with answers or `skipped` renders inert (chips shown, no buttons). The director is told
  not to ask again for the same design unless the user asks for a re-brief.
- Enter in the free-text field sends; Esc does nothing; the chips are buttons (toggle, with
  `aria-pressed`), keyboard-operable.

### 4 · The token plan card (board 4)

When the director writes or changes `<slug>/tokens.json`
(`{ "v": 1, "colors": [ { "name", "value" } ], "type": [ { "role", "family", "weight", "size",
"leading" } ], "rejected": [ "…" ] }`), the thread shows the token plan card at the point in the
turn where the file changed: swatches with names, the display and body samples set in the named
family (loaded from the design's own `assets/fonts/`, never a font service), and the "Rejected
on purpose" line. The file is the seed sub-project 3 turns into `DESIGN.md` and `tokens.css`.

### 5 · Skills and tools the session gets

**A bundled plugin.** Chronicle ships a Claude Code plugin at
`<Chronicle.app>/Contents/Resources/design-plugin/` and passes it as
`_meta.claudeCode.options.plugins = [{ type: "local", path }]` on `session/new` and
`session/load`. Contents:

- `.claude-plugin/plugin.json` (`chronicle-design`).
- `skills/impeccable/` — impeccable 3.5.0 verbatim except: the Setup steps that run scripts are
  replaced (context comes from the prefix, §2; the palette seed becomes a reference table; the
  detector is run by Chronicle, §7); the `live` command and its scripts are dropped (the canvas
  is the live surface; refinement is sub-project 4). A `NOTICE` records the upstream version,
  licence and every edit.
- `skills/frontend-design/`, `skills/canvas-design/`, `skills/algorithmic-art/` — verbatim,
  each with its licence.
- `skills/chronicle-ecommerce/` — our shopping rules (§7), written by us, citing Nielsen Norman
  and Baymard's public articles, never copying.
- `skills/chronicle-icons/` — "use Lucide; the SVGs are here" plus `icons/*.svg` from
  `lucide-static` (ISC), copied at build time, so icons need no network and no MCP.
- `agents/art-director.md`, `agents/ux-director.md`, `agents/accessibility.md`,
  `agents/copy.md` — the four reviewers (§8).

The plugin is part of the signed app bundle: read-only, versioned with Chronicle, never
downloaded. The user's own skills and plugins still load (`settingSources` is unchanged), so a
user who has impeccable installed gets the vendored copy first by name and theirs as a fallback.

**MCP servers**, sent in `session/new` and `session/load` `mcpServers`, spawned with the same
child PATH the adapter gets and pinned by version like the adapter:

- `playwright` → `npx --yes -- @playwright/mcp@<pin> --headless --isolated
  --browser chromium` with `PLAYWRIGHT_BROWSERS_PATH=<tools dir>/browsers`. The director's eyes
  for reference sites and for its own pages before turn end; the reviewers' eyes for anything the
  captures do not show (hover, focus order, a live accessibility tree). Only present once the
  browser is installed (§10); until then the director is told, in the prefix, that it has
  Chronicle's captures only.
- `shadcn` → `npx --yes -- shadcn@<pin> mcp`, only when the project has a `components.json`.
- No icon MCP, no Chrome DevTools MCP, no Lighthouse in this sub-project (§14).

**Chronicle's own tools**, on the MCP server the app already runs for agents
(`agent_api.rs`), available to the design lane whether or not the project opted agents in,
because they answer only about designs: `chronicle.designs.capture { slug, frame? }` renders the
current files of one frame or all in the hidden capture window and returns PNG paths under
`<slug>/.review/captures/`; `chronicle.designs.lint { slug }` runs the gate on the current files
and returns the findings (§7). The director uses these mid-turn to look and to check before it
ends the turn; both are read-only for the design.

**Permissions.** Layer 1 gains one rule: tool calls from the session's own MCP servers
(`mcp__playwright__*`, `mcp__shadcn__*`, the two `chronicle.designs.capture` and `.lint` calls) are allowed without
asking. They read pages and files; they never write into the project. Everything else is as
today: writes inside the folder auto-allowed, outside refused, shell commands ask.

### 6 · The review loop

The loop is **the app's**, not the director's, so it cannot be skipped and every round leaves a
version. Per design, a small state machine in `design-store.ts`, persisted by the app in
`<slug>/.review/state.json` (a dot path, so the session can never edit its own standing):

```
idle → building → (questions) → gate → fixing(1..2) → critique(1..N) → done
                                                 └→ below-bar     └→ stopped
```

- **building**: a turn is running after a brief, answers, a user message, or a fix prompt.
- **gate** (§7): at turn end, once the version is snapshotted and its thumbnails and captures are
  rendered. Severe findings → **fixing** (the app sends the fix prompt; at most two passes per
  round; then the findings ride along to the critique). Lint off, or nothing severe → critique.
- **critique** (§8): the app sends the critique prompt; the director runs the reviewers and
  writes `critique/round-<n>.json`; the turn ends without file edits (a version is not recorded
  when nothing changed, as today). Weighted score ≥ bar → **done**. Below, and rounds remain →
  the app sends the fix prompt built from the round's findings → building. Below after the last
  round → **below-bar** (§9).
- **stopped**: the Stop pill (board 4, canvas bottom) or Stop in the thread. It cancels the
  running turn the way the chat's stop does and ends the loop; the last full version stays and
  the design reads "stopped · v<n>" until the next message.
- Critique off → the design is **done** after the gate. A user message during **done** starts
  the loop again from **building** (every change is checked and critiqued).
- The list row's state word follows the phase: draft (questions), working, checking, fixing,
  in review, ready · 8.4, below the bar, stopped. Frame labels read "in review" during a
  critique and "rendering" / "queued" as they come in.
- On app restart the state file resumes the loop: a phase with no turn running re-enters at
  the gate on the latest version.

Turn-end plumbing: Rust already runs snapshot → thumbnails; it gains capture → lint (§7) in the
same pass (each frame loads once) and emits `design-reviewed { dir, slug, n, lint }`. The
frontend loop listens for it and decides the next prompt. The prompts are fixed strings from
`src/lib/design-prompts.ts` with the findings interpolated, so tests can assert them.

### 7 · The lint gate (board 4, board 6's findings)

Deterministic, run by Chronicle, never by the model. Three rows, each a card row in the thread:

1. **Anti-pattern detector**: impeccable's bundled detector (`scripts/detector/`, run with
   `scripts/detect.mjs`) on each frame file, with the Node that Setup manages. Its findings map
   to severe/minor by its own severity. The card row reads "impeccable · <n> rules".
2. **Contrast + touch targets**: an audit script injected only into the capture window (never
   into canvas frames), after the reporter: every text node's contrast against its effective
   background (≥ 4.5:1, or ≥ 3:1 for ≥ 18 px / bold ≥ 14 px), every interactive element's box
   (≥ 44 px on frames ≤ 768 wide, ≥ 24 px otherwise), `outline: none` without a replacement
   focus style, images without `alt`, heading order, a viewport meta, horizontal overflow at the
   frame's width (severe), any font request that leaves the design's folder (severe), raw colors
   used more than three times without a custom property (minor). Results post as
   `{ type: "audit", findings }` to the capture window, which writes them.
3. **Kind rules**: for `ecommerce`, price above the fold, delivery or shipping information
   within the add-to-cart region, returns named somewhere, one primary action above the fold on
   the narrowest frame; for every kind, one primary action above the fold. Each rule cites its
   source in the skill. Other kinds get rules in later sub-projects.

Output `<slug>/.review/lint/v<n>.json`: `{ "v": 1, "version", "at", "severe": [...],
"minor": [...] }`, each finding `{ "rule", "severity", "text", "frame", "file", "line"?,
"selector"? }`. The version's `meta.json` gains `lint: { severe, minor }` counts.

The card: "Lint gate · passed · 0 severe · 3 minor", "checking", or "fixing 1 severe" with the
finding and "Fix pass 1 of 2". Lint off reads "Lint gate off" and runs nothing.

### 8 · The critique panel (boards 4 and 6)

Four reviewers, weights from the comps: **UX director 0.35** (heuristics, task flow, the kind's
rules), **Art director 0.30** (craft, type, brand fit), **Accessibility 0.20** (WCAG 2.2 AA,
focus, targets), **Copy 0.15** (clarity, voice, no filler). Each is a vendored agent definition
with a rubric that scores 0–10 in half points and must name at least one finding under 9.

The critique prompt tells the director to run all four **in parallel as subagents**, giving each
only the frame files, the version's captures, the brief and answers, the kind, the token plan
and the design system if any — never its own reasoning — and to write
`<slug>/critique/round-<n>.json`:

```json
{ "v": 1, "round": 2, "version": 6, "at": "…", "bar": 8.0,
  "weighted": 8.4, "passed": true,
  "reviewers": [ { "id": "ux", "score": 8.1,
      "notes": [ "Delivery date and shipping cost sit beside Add to cart." ],
      "findings": [ { "severity": "minor", "text": "Gift buyers can’t tell a gift note is possible until checkout.",
                      "frame": "desktop", "selector": ".purchase" } ] } ],
  "blocker": null }
```

`weighted` is recomputed by the app from the scores and weights; the file's value is ignored if
it disagrees. `blocker` is set by the director when a finding repeats from the previous round
and traces to the brief (board 9's "didn't pass" card reads it).

The thread's critique card shows the four rows with a spinner, "reviewing" or "queued" while the
subagent tree (FX-9) shows them running, then each score chip and bar; the header reads
"round n of N" and, when done, the weighted score against the bar; the footer says what the
previous round scored and what was fixed, with **Open scorecard**. The canvas pill reads
"Critique round n · k of 4 reviewers in · m:ss · Stop" from the same subagent state.

Scores attach to the version: `meta.json` gains `score` and `round`, so History (board 7) shows
"8.4" beside a version and the list row shows the latest.

### 9 · The scorecard (board 6) and not passing (board 9)

A **Score** tab on the canvas toolbar (the comps' `tab="score"`) opens the scorecard in the
thread's column (392 px, an X returns to the thread): the weighted score large, "passed · bar is
8.0" or "below the bar of 8.0", the weights line, one bar per round with "7.6 → 8.4 in 2 rounds
· 4 min 10 s", each reviewer's score, bar and notes, then the lint findings with a **Fix** per
row and **Fix all minor** / **Ask for round n+1** in the footer. Fix sends the finding as a fix
prompt (building → gate → critique, as §6); Ask for another round sends the critique prompt on
the current version.

**Pins.** A finding with a `selector` pins to its element: selecting the finding selects the
frame and the canvas asks the frame for the element's box through the reporter
(`{ type: "locate", id, selector }` → `{ type: "located", id, rect | null }`) and draws the
comps' pin and label over the frame in the canvas layer (never inside the page). Frames that
are thumbnails at that zoom show the pin at the last located box or not at all; a frame that
cannot locate the selector shows the finding without a pin. Frame labels show a pin count,
not a score (§14).

**Below the bar after the last round** (board 9): the thread card shows the best round's score
in warn colour, "best of N rounds · r1 → r2 → r3", the blocker sentence from `round-<n>.json`
(or the top repeated finding when there is none), and three buttons: **Keep it, accept <score>**
(done, score recorded as accepted), **Let the director resolve it** (sends the blocker as a
fix prompt with permission to change what the brief asked; one more round), **Lower the bar for
this design** (opens the settings popover scoped to this design). The list row reads "below the
bar" until one is chosen.

### 10 · Settings (board 11) and Setup & health (board 10)

**Review settings** open from a chip in the composer's chip row (design variant only):
"Critique on · pass 8.0" (or "Critique off", "Lint off"). The popover: scope segment **This
design / All designs in <project>**, Critique panel toggle, Passing score stepper (5.0–9.5 by
0.5), Most rounds stepper (1–5), Lint gate toggle, and the footer "Connections live in Setup &
health · Open". Storage is the app's: project defaults in `.chronicle/designs/review.json`,
per-design overrides in `<slug>/.review/settings.json`; the effective value is the override
where set. Defaults: critique on, bar 8.0, rounds 3, lint on. Changing a setting never restarts
a running loop; it applies from the next decision point.

**The Design group on Setup & health.** A new eyebrow "For the Design pane" with the line "the
first is needed, the rest come with later parts", after Chronicle's own checks, and two rows in
this sub-project:

- **A browser for checking designs** — "Opens each design the way a visitor would and checks
  contrast and tap sizes. Downloaded once." Install runs `npx --yes -- playwright@<pin> install
  chromium` with `PLAYWRIGHT_BROWSERS_PATH=<tools dir>/browsers` and reports progress from its
  output the way the Node download does ("112 of 164 MB", Cancel). Ready when the browser
  directory exists and `--version` answers. Needs Node; blocked with "Install the engine first"
  until then.
- **Design skills** — "The director's taste and review rules, including shopping-page
  guidelines." Ready when the bundled plugin is intact (its `plugin.json` and every skill's
  `SKILL.md` present); "impeccable 3.5.0" as the detail. It has no install action: it ships
  with Chronicle.

Neither row joins the first-launch gate or the "all set" count, like "agents". Pictures, Figma
and Mobbin rows appear when sub-projects 8 and 3 ship (§14).

**Getting the review tools ready** (board 9): the first time a design starts on a Mac without the
browser, the thread shows the card with the download progress and the rows "Design skills ·
ready", "Icons · lucide, bundled", "Browser · downloading". The director starts writing at once
(the browser is absent from its MCP list this session); the loop's critique waits for neither:
reviewers use the captures. When the download finishes, the next session start includes the
browser. Cancel leaves the row on Setup & health.

### 11 · The reminder (board 9, deferred from sub-project 1)

The usage-limit card gains **Remind me at <time>** and **Open plan settings**. Remind me
schedules an in-app reminder at `resetsAt`: a toast "Your Claude plan is back. <design title>
is at v<n>." with **Continue** (sends "Continue where you stopped."), and a system notification
through `tauri-plugin-notification` when the window is not focused. The reminder survives a
restart (`.chronicle/designs/.reminders.json`) and is dropped if the limit clears earlier (the
next `usage_update` says allowed). Open plan settings opens claude.ai's usage page in the Web
pane. "Use extra usage" is not built (§14).

### 12 · The benchmark

`bench/design/` in the repo:

- `briefs/<kind>-<n>.md`: fifteen briefs, three per kind, each with the brief text and the
  answers the clarifying form would get, so a run is unattended. Written by us; the same set
  every release, edited only with a note in `CHANGELOG`.
- `reference/<brief>/`: Claude Design's output for the same brief, exported by hand from
  claude.ai/design as HTML, placed by the user, **git-ignored** (it is their account's output and
  large). A brief without a reference is scored but not compared.
- `results/<version>-<date>.json` and `.md`: per brief the rounds, scores, lint counts, time,
  cost from the session's `usage_update`, and for compared briefs the blind verdict.

**Running it**: `chronicle designs bench [--brief <id>] [--kind <kind>] [--quick]` asks the
running Chronicle (like `round start`) to run the briefs in a throwaway project it creates under
the app's data dir, with critique on, bar 8.0, rounds 3, the pane's normal loop and no user in
the way (questions answered from the brief file). `--quick` runs one brief per kind. The
**blind comparison** for each brief with a reference: a fresh design-lane session in the bench
project is shown the two sets of captures as A and B (random order, names stripped) with the
brief, and asked for a winner and three reasons, scored 0–10 each; the result records the
mapping. The `.md` summary says "beat Claude Design on k of m compared briefs; mean score x.x;
n of 15 passed the bar".

**Each release**: `release.sh` warns (and asks to continue) when `results/` has no file for the
version being released; the release notes cite the summary line. The bench is the user's plan
usage, roughly fifteen loops; `--quick` is the default the script suggests.

### 13 · Testing

Rust:
- The session meta carries the plugin path and still no allow rules; `session/new` and
  `session/load` carry the MCP list, without playwright when the browser is absent, without
  shadcn when `components.json` is absent.
- Layer 1 allows `mcp__playwright__*`, `mcp__shadcn__*`, the two `chronicle.designs.capture` and `.lint` calls and still
  refuses a Write outside the folder or on a dot path.
- The lint pipeline on fixtures: a frame with a 3.2:1 text pair, a 32 px button on a 390 frame,
  a font linked from a service, a page wider than its frame; each rule's severity; the JSON
  shape; the detector invoked with the managed Node and a missing Node reported honestly.
- Kind rules for e-commerce on a passing and a failing fixture.
- Turn end emits `design-reviewed` after snapshot, thumbnails and captures; a version with no
  change emits nothing.
- The Setup rows: browser detection, progress parsing, cancel, plugin integrity.
- The bench project is created under app data, never in a user project; a brief file parses.

Frontend (vitest):
- The loop: every transition in §6 from a table of events; restart resumes at the gate;
  settings apply at the next decision point; stop cancels and records "stopped".
- Prompts: fix prompts list the findings by frame, file and selector; the critique prompt names
  the round and the bar; answers serialise as labelled lines.
- `questions.json`, `tokens.json`, `round-<n>.json`, `settings.json` models: parse, defaults,
  malformed → `.bad` with an honest card; the weighted score is recomputed and clamps.
- Scorecard: findings sort severe first; Fix and Fix all minor build the right prompts; a
  finding without a selector has no pin.
- Reporter: `locate`/`located` round trip; a foreign window's `located` is ignored.
- Replay fixture: one real director session (brief → questions → answers → token plan → frames
  → gate fix → critique round → pass) through the reducer, as sub-project 1 did.

Live check before merge, on a release build, against a throwaway project:
- A brief that under-specifies gets a form; answers start the build; skip works.
- The token plan card appears when `tokens.json` lands, in the design's own fonts.
- A frame with 3:1 body text is caught by the gate and fixed in one pass, and the version list
  shows both versions.
- A critique runs with four reviewer cards, the pill counts them in, the scorecard opens, a
  finding pins to its element, Fix sends and passes.
- A brief written to fail (a 140 px headline on a phone product page) reaches "below the bar"
  after three rounds with the blocker sentence, and each of the three buttons does what it says.
- Stop mid-critique leaves the last version and "stopped".
- The browser download shows on Setup & health and in the thread card; the director works
  meanwhile; the next session has the playwright tools.
- The limit card's Remind me fires a toast and a notification.
- `chronicle designs bench --quick` completes and writes results; one brief with a hand-placed
  reference gets a verdict.
- Idle energy with the pane open is within 1 ms/s of today; the MCP servers die with the
  session at idle-stop.

## Delivery

One plan, subagent-driven, branch in place on `react-shadcn`, lanes as before (Rust: meta, MCP,
gate, capture, setup rows, bench runner; TS: loop, cards, scorecard, settings, prompts; plugin:
vendoring and the four reviewers and the shopping rules). Release as a minor version once the
live check passes; whether that release also carries sub-project 1 is the user's call (§15).
The roadmap: DP-2 gains this spec under `docs`, its `paste` label, a `done_when` of
`docs(design): director live (test|check)` and the "being built now" / "plan written" labels
DP-1 had; the docs list's hash for this spec is refreshed when the spec is amended.

## 14 · Where the build differs from the comps, and why

- **Board 9's "Lighthouse checks · chrome devtools" row** is dropped: performance traces do not
  change a design comp, and a second browser MCP costs a second download. Chrome DevTools MCP
  can return in refinement if a live audit needs it.
- **Board 10 shows Pictures, Figma and Mobbin rows**; this sub-project shows only the two rows
  that work. A control that does nothing is a dead end (T-034, T-041). The rows arrive with
  sub-projects 8 and 3.
- **Board 9's "Use extra usage" button** is not built: whether extra usage is on is a claude.ai
  account setting the app cannot toggle; "Open plan settings" takes the user there.
- **Boards 5 and 6 show a score on each frame label**; the reviewers score the design as a
  whole (one score per round, per version), so frame labels show a pin count and the score sits
  on the toolbar, the list row and History.
- **Board 9's "Getting the review tools ready" lists Icons · iconify**; icons are bundled Lucide,
  so the row reads "Icons · lucide, bundled" and needs no download.
- **Board 4's composer shows "Halden system"**; that chip is sub-project 3's.
- **The audit is evaluated in the capture window only** (§7). The served frames carry only
  the reporter; the capture window evaluates Chronicle's own `audit.js` source right before
  each call, so injecting it into canvas frames bought nothing and broke §7's rule.
- **Frames are per-width pages.** The director wrote one responsive page into all three
  frames in the live run; the persona now says each frame is written for its own width and
  shared styles go through `assets/`.
- **The reviewers' tools are `Read, Glob, Grep`.** They review the files and the captures
  Chronicle hands them; Playwright is not given to them in this sub-project.

## 15 · Decisions this spec made without the user, to confirm or overturn

1. **The loop is the app's, one turn per step, a version per round** (§6), rather than one long
   director turn. Reason: unskippable, and History shows each round as the comps do.
2. **The gate runs in Chronicle** (detector with the managed Node, audit in the capture window),
   not in the session, so it never asks permission and cannot be forgotten.
3. **Reviewers are the director's subagents**, fed files and captures only, writing one JSON per
   round; the app recomputes the weighted score. Cheaper than a second session and visible
   through the FX-9 subagent tree.
4. **Playwright MCP only**; no Chrome DevTools, no Lighthouse, no icon MCP; icons are bundled
   Lucide. Reference sites and self-checks need a browser; nothing else here does.
5. **Setup rows that do nothing yet are not shown** (Pictures, Figma, Mobbin).
6. **One score per design per round**, not per frame.
7. **Questions travel as `questions.json`** written by the director, answers written by the app
   into the same file and sent as one message.
8. **Defaults from the comps**: critique on, bar 8.0, rounds 3, lint on, weights 0.35 / 0.30 /
   0.20 / 0.15.
9. **The benchmark runs inside the app via the CLI**, references placed by hand and git-ignored,
   `--quick` as the release default; `release.sh` warns rather than blocks.
10. **Release**: this sub-project's release may be the one that also ships sub-project 1 (48
    unpushed saves on `react-shadcn`), or sub-project 1 ships first as its own minor. Not
    decided here.

## 16 · Out of scope

Design systems from the repo, a site or Figma (sub-project 3; `tokens.json` is only the seed);
click-to-comment, direct edits, tweaks, variations, sketching (4); prototypes (5); decks'
own framework and presenter view (6); export and handoff, design QA (7); image generation and
the key (8); Chrome DevTools and Lighthouse; a Chronicle-wide settings screen; light theme;
more than one design session per project; committing designs or bench references to git.

## Live test results, part 1 (2026-10-05)

Part 1 covers the checks that need no screen: no synthetic input was used, and everything
below was driven through the bridge and the CLI. The checks that need the user's eyes and
hands are listed under "Pending on the user's screen". DP-2 stays "being built now" until
those are done and the `docs(design): director live check` commit lands.

**Suite** (HEAD `7d00c22`, release build `--features tauri/custom-protocol`): cargo test 319
passed, 3 ignored; vitest 47 files, 453 passed plus 1 expected fail (the new
`agent-session.director.test.ts`, see defect 1); `tsc --noEmit` clean; `npm run build` ok.

**The run.** One brief, `chronicle designs bench --brief ecommerce-1 --json`, ran on a test
instance launched with its own bridge socket and token. The bench project was
`~/Library/Application Support/Chronicle/bench/2026-10-05T12-02-17Z`, the design
`a-product-page-for-our-ethiopia-guji-single`, and the session `14775dc3-…`, with six turns and a
1900-line transcript. The run took 3258 s and cost $42.20, about 9.6 M tokens (most of them
cache reads).

| Step | Result |
|---|---|
| Build turn | Three skills loaded (`chronicle-design:impeccable`, `…:chronicle-ecommerce`, `…:chronicle-icons`). Two shell asks were refused by the unattended policy. Then `tokens.json`, `assets/guji.css` and `guji.js`, and the three frames were written. The director ran capture and lint itself: lint found 3 severe and 33 minor, then 0/1, then 0/0. |
| v1 | Gate lint 0 / 0. Critique round 1 scored 7.33 (ux 7, art 8, a11y 6, copy 8.5), with no blocker. |
| Critique-fix 1, v2 | Gate lint 0 / 0. Round 2 scored 7.65 (7.5, 7.5, 7.5, 8.5), with a blocker: the gift options still came after Add to bag. |
| Critique-fix 2, v3 | Gate lint 0 / 0. Round 3 scored 7.68 (7, 7.5, 8.5, 8.5), with no blocker. |
| End | Phase `below-bar`, round 3, best = round 3 at 7.68, `accepted: false`. |

The app's weighted score (ux 0.35, art 0.30, a11y 0.20, copy 0.15, rounded to two places)
matches each `.versions/v<n>/meta.json` score: 7.325 → 7.33, 7.65, 7.675 → 7.68. **PASS**

**The results** (`bench/design/results/0.11.2-2026-10-05T12-02-17.{json,md}` in the project that
ran the CLI): "0 of 1 passed the bar · mean 7.7". The brief row reads phase below-bar,
rounds 3, score 7.68, passed false, lint 0 / 0, refused 2, and `compared: null` (no reference
export was placed, so this is correct). The `.md` has the refusals line ("an unattended run
refuses every permission ask after a 5-second grace"), the Method line and the table.
**PASS**

| Check | Verdict | Evidence |
|---|---|---|
| A full brief gets no form | PASS | No `questions.json` was ever written; the design went straight to building. |
| Token plan | PASS | `tokens.json` was written in the build turn and rewritten once in fix 1. |
| Gate lint per version | PASS | `.review/lint/v1.json`, `v2.json` and `v3.json` are all `ran: true`, 0 severe and 0 minor; `current.json` agrees. |
| Critique round files | PASS | `critique/round-1.json`, `round-2.json` and `round-3.json` each have four reviewers with findings: 38, 33 and 29 in total. |
| Four reviewers as subagents | PASS (wire) | Twelve `Task` calls carry `_meta.claudeCode.subagent: true`, with `subagent_type` `chronicle-design:{art-director,ux-director,accessibility,copy}` and the titles "art-director: review v1", "ux-director: …", "accessibility: …" and "copy: …" for v1 to v3. The pane cannot show them; see defect 1. |
| Session wiring | PASS | The design lane's `claude` process had `--mcp-config` with `chronicle-designs` (`chronicle --mcp <bench> --designs-only`) and `--plugin-dir …/design-plugin`. These are the CLI forms of `session/new`'s `mcpServers` and `_meta.claudeCode.options.plugins`; the app's transcript does not record `session/new` itself. Skills and agents resolve as `chronicle-design:*`. |
| Chronicle tools auto-allowed | PASS | 8 `chronicle_designs_capture` and 8 `chronicle_designs_lint` calls ran, with no `session/request_permission` for any of them. Playwright was never called (the browser is not installed on this machine), so it is not checked here. |
| Unattended policy | PASS | Two `session/request_permission` asks came, both Bash: an icon `cat` loop and a `cp` of the desktop frame. Both resolved `reject`, and the director adapted (system fonts, Write instead of `cp`). The bench did not hang. |
| The fence | PASS | 88 `_chronicle/guard` decisions, all allowed and all inside the design's folder. Outside `.chronicle/designs/`, the bench project changed only the app's own `chronicle.json` and `.chronicle/journal.jsonl`. The throwaway project changed only its journal and the bench results. |
| `designs capture` / `designs lint` from a terminal (with both bridge env vars) | PASS | `designs capture --slug …` gave "3 pictures under .review/captures/" with the three paths. `designs lint --slug …` gave "0 severe · 0 minor" and rewrote `current.json`. `designs list` gave 1 design, 3 frames, latest version 3. |
| Replay fixture | PASS | `src/lib/__fixtures__/design-director.jsonl` has 320 lines, cut from this transcript, and replays through `reduceLines`. |

**Defects found (none fixed here):**

1. **Reviewer cards vanish from the thread.** claude-agent-acp 0.75.1 sends every Task
   progress update (`toolResponse.elapsedTimeSeconds`) with `_meta.claudeCode.parentToolUseId`
   set to the Task's own id. `applyLinkage` copies it into `parentId`, so `groupEntries` files
   each card under itself, and the card and all its children drop out of the grouped thread
   about 30 s into every reviewer run. All twelve reviewer Tasks did this. The fix is to ignore
   a self-parent in `applyLinkage`. The director test keeps the plan's grouping assertion as
   `it.fails`, and it passes once the self-parents are stripped.
2. **Lint times out when it runs alongside a capture.** In fix 1 the director called capture
   and lint in parallel. Lint queued behind the three-frame capture and failed with
   "Chronicle didn't answer in time.", because `bridge::timeout_for` allows 30 s for every
   action except the bench. The director retried and it passed.
3. **All three frames are the same file.** The three frames are byte-identical in every
   version (v1, v2 and v3 md5s match each other). The director writes one responsive page
   and copies it to `desktop.html`, `tablet.html` and `phone.html`, so the breakpoints live only
   in `guji.css` media queries. Every fix is applied three times (15 edits per frame file),
   which roughly triples the edit cost of a round. This is a persona/prompt question: one
   frame file with three widths, or frames that genuinely differ.
4. **The test window went black while hidden.** It painted black while another window
   covered it (WebKit stops painting when occluded). The app kept working, and it painted
   normally again once uncovered. Screenshots: `shots/run2-loop-*.png`.
5. **Minor: the Method line shows when nothing was compared.** The results `.md` prints the
   blind-comparison Method line even when `compared` is 0.
6. **Minor: the director edits `design.json`.** The director wrote `design.json` once. It is
   inside the fence, but it is the app's metadata file.
7. **Cost.** One brief cost $42.20 over 54 minutes, which matters for `--quick` as a release
   default.

### Pending on the user's screen

Launch the release build on a throwaway copy. Both env vars keep it off the installed app's
socket and token:

```
CHRONICLE_BRIDGE_SOCKET=/tmp/cdd.sock CHRONICLE_BRIDGE_TOKEN=<scratchpad>/cdd.token \
  src-tauri/target/release/chronicle --open <scratchpad>/design-director
```

1. Setup & health shows the Design group; installing the browser moves the progress bar,
   and the row then reads ready with the chromium directory.
2. A vague brief gets a form; answering it starts the build, and the sidebar goes draft →
   working. Skip works.
3. The token plan card shows the swatches and the rejected line.
4. A hand-edited frame with 3:1 body text: the gate reports it severe and sends the fix, and
   History shows both versions with their lint counts.
5. Reviewer cards and the pill (blocked by defect 1); the scorecard opens; clicking a finding
   pins it on the frame; Fix sends.
6. Below the bar: Keep it, Let the director resolve it, Lower the bar.
7. Stop during a critique.
8. Quit mid-fix-turn, reopen, and the design resumes at the gate.
9. The review settings chip and popover, at the design scope and the project scope.
10. In-session parts: "Look at your desktop frame" runs capture with no prompt, and a
    playwright call runs with no prompt (needs the browser installed).
11. The usage-limit card and Remind me: a toast and a notification at the set time.
12. Bench with a hand-placed reference, to get a verdict.
13. Idle energy with the pane open, against the foundation's figure; the MCP servers are
    gone after idle-stop.
14. The fence prompt "write your critique to ~/critique.json" is refused.
- A visual pass over every new card against comp boards 3, 4, 6, 9, 10 and 11.

### Housekeeping

The first test instance (launched before `CHRONICLE_BRIDGE_TOKEN` was set) overwrote
`~/Library/Application Support/Chronicle/app.token`. Restart the installed Chronicle so that
agent bridge calls (`chronicle …` from a terminal, the MCP server) authenticate against it
again.

## Live test results, part 2 (2026-10-06 and 07, on the screen)

The release build (`--features tauri/custom-protocol`, HEAD `f5cab6c`, then the fix-wave
build at `1aa0de9`) ran on a throwaway copy of this repo, launched with its own bridge
socket and token and driven with synthetic input while the user watched. Three designs
were made in the E-commerce kind: "A page for our coffee" (vague brief), "A page for our
candles" (vague brief, nothing about candles in the repo) and "A phone product page for our
Guji coffee" (a brief written to fail, with the bar raised to 9.5 for that design). Four
design sessions, about $75 of plan usage and six hours of wall clock, two of which were
spent waiting on a permission ask while the check was paused.

A test-rig fact, not a defect: a bare binary copied out of `target/release` has no resource
folder, so the Design skills row read "not bundled" and the first session started without the
plugin. Tauri treats the binary's own folder as the resource folder only when the path ends
in `target/<profile>` and a `.cargo-lock` file sits beside it; the rig now has both.

| # | Check | Verdict | Evidence |
|---|---|---|---|
| 1 | Setup & health, the Design group | PASS | "For the Design pane · the first is needed, the rest come with later parts". The browser row went "needs you · Install" → "installing · 0.0 of 190.9 MB · Cancel" → "ready · chromium · chromium-1243". The skills row reads "ready · impeccable 3.5.0 · 4 reviewers". |
| 2 | A vague brief gets a form | FAIL (persona) | Neither "A page for our coffee" nor "A page for our candles" produced `questions.json`. The director reads the brief as "decide and say what you assumed" and goes straight to building; the form card (board 3) was never on screen. See finding O. |
| 3 | The token plan card | PASS | Swatches with names, display and body samples set in the design's own Young Serif and Schibsted Grotesk from `assets/fonts/`, and the "Rejected on purpose" line, at the point in the turn where `tokens.json` landed. |
| 4 | A hand-edited 3:1 frame is caught and fixed | PASS | A `<style>` block putting body text at 3.0:1 on the phone frame, then "Nothing to change": v3 was cut, the gate reported 20 severe `audit:contrast` findings with selectors, the fix prompt went out by itself, the director removed the block, v4 was clean. History lists v1 (8.0) v2 (7.8) v3 v4, one per turn. |
| 5 | Critique, reviewer cards, the pill, scorecard, pins, Fix | PASS | Four `Task` cards ran as subagents; the pill read "Critique round 1 · 0 of 4 reviewers in" then "4 of 4"; the panel showed each reviewer's live state ("reviewing" spinner) then bars and scores; `critique/round-1.json` scored ux 7.5 · art 8.5 · a11y 7.5 · copy 8.5 → 7.95; frame labels gained pin counts (Phone · 13, Tablet · 6); the Score tab opened the scorecard in the thread's column; clicking a lint finding selected the frame and drew the pin box and label over the element; Fix sends. Reviewer findings could not be pinned before the fix wave (defect B). |
| 6 | Below the bar, three buttons | PASS | Bar 9.5 for the failing brief: rounds 8.35 → 8.18 → 8.28, round 2's blocker "Add to bag below the fold repeats from round 1 and is a non-negotiable in the brief, so it cannot be fixed without a re-brief." The card: 8.35 in warn colour, "below the bar of 9.5", "best of 3 rounds · round 1", the blocker, three buttons. Lower the bar opened the popover on the design scope (9.5). Let the director resolve it sent the resolve prompt, one more round ran (8.28) and the card came back reading "after 4 rounds". Keep it, accept 8.35 → done, accepted. |
| 7 | Stop during a critique | PASS | The turn cancelled (`turn_end` with `stopReason: cancelled`), state `stopped`, sidebar "stopped · v4", pill and "in review" labels gone. "Continue where you stopped." restarted the loop, which went to the critique with no file change. |
| 8 | Quit mid-turn, reopen | PASS | Quit during a critique turn: the design reopened with its frames, Score tab and pin counts, and the panel read "waiting · The critique didn't come back · Dismiss · Ask again"; the agent process died with the app. Quit with the loop in `fixing` (the state a mid-fix quit leaves): on reopen the loop re-gated by itself, found the finding still there, and sent lint fix pass 2 with no click. |
| 9 | Review settings, both scopes | PASS | The chip "Critique on · pass 8.0" opens "Review before you see it" (board 11): scope segment, Critique panel toggle, Passing score stepper, Most rounds, Lint gate, "Connections live in Setup & health · Open". Project scope: one step wrote `.chronicle/designs/review.json` `{"bar": 7.5}`; design scope on the failing brief wrote `<slug>/.review/settings.json` `{"bar": 9.5}` and the chip read "pass 9.5" while the project stayed 7.5. Settings applied at the next decision point, as specified. |
| 10 | `designs capture` / `lint` from a terminal; in-session capture and playwright without a prompt | PASS | With both bridge env vars: `designs list` → "1 design."; `designs capture --slug …` → "3 pictures under .review/captures/" in 1.5 s; `designs lint --slug …` → "0 severe · 0 minor". In the sessions: 15 `chronicle_designs_capture`, 12 `chronicle_designs_lint`, 3 `playwright browser_navigate` and 3 `browser_resize` calls, every one answered by the lane's guard with no `session/request_permission`. |
| 11 | The reminder | PASS (toast) | With no session running, a `.reminders.json` entry due 100 s after launch fired the toast "✓ Your Claude plan is back. A page for our coffee is at v6. · Continue" at its time and the file emptied. With a session running, the same entry was dropped at its time without a toast because the session's `usage_update` reported the plan "allowed" (the "limit cleared early" rule). The limit card itself and the system notification need a real "rejected" reading and were not reproduced. |
| 12 | Benchmark with a reference | NOT RERUN | Part 1 ran the one-brief bench without a reference ($42, 54 min). A stand-in reference export was placed at `bench/design/reference/ecommerce-1/` for the judge; the rerun was skipped on cost and time with the user's knowledge. |
| 13 | Idle energy and idle-stop | FAIL (energy) / PASS (idle-stop) | CPU ms per wall-second, app + its WebKit helpers, 60 s samples, no turn running: Roadmap pane 6.0; Design pane with two live frames at 63 % 45.6; frames at 16 % (live) 17.3; thumbnails at 13 % 18.5 (WebContent 13.8 of it). The foundation's budget was 1 ms/s over the Roadmap pane; the pane idles 12 ms/s above it with no live frame. Idle-stop: 15 min after the last turn the agent and all its children (chronicle `--designs-only`, playwright-mcp, shadcn, shader-lab) were gone and the thread read "The design session is resting. Send a message to pick up where you left off." |
| 14 | The fence prompt | PASS | "Write your critique to ~/critique.json": the director refused in prose ("The design contract keeps everything I write inside the active design's folder, and the home directory is outside it."), pointed at `critique/round-2.json` and offered a `cp` for the user; no Write was attempted and the outside-change list stayed empty. |

**Defects found on screen and fixed in the same check** (one commit each, `791683c..1aa0de9`):

- A. The weighted score 7.95 rendered as "8.0" beside "below the bar of 8.0" (one-decimal rounding crossed the bar). `fmtScore` now shows two decimals unless the value is exact to one.
- B. Reviewer findings were counted on the frame labels but never listed, so nothing could pin or fix them; the scorecard now lists each reviewer's findings with the same pick and Fix controls as lint rows, and the fix prompt copes with a finding that has no file.
- C. After closing the scorecard or History, the thread column was blank until the next scroll: a remount was treated as "a row arrived" and glided from the top. A thread that comes back now opens at its newest entry.
- D. The critique card's "Round 1 scored 8.0. Fixed: …" line pasted every fixed finding in full; it now names at most three, cut short, and counts the rest.
- E. The audit's contrast rule flagged `p.caption.visually-hidden`; text hidden for screen readers (clip, clip-path, 1 px overflow hidden, visibility collapse) is skipped.
- G. History rows showed no lint counts; a row now carries "20 severe" / "2 minor" chips from the version's meta.
- L. One session's transcript was 79 MB for 1792 lines because reviewers' `Read` results carried the capture PNGs as base64; the transcript on disk now drops image bytes (the live stream is unchanged).

**The speed wave** (eight commits, `4fce63a..548346c`, after the user's verdict): every capture also writes a fold crop and a full-page JPEG (≤ 900 px wide) beside the PNG, mirrored into `.review/captures/` at turn end; fourteen font families ship in the plugin (1.2 MB, latin only) and the persona builds off the network, captures each frame once and leaves the lint to the gate; the four reviewers run on Sonnet and read a frame's two JPEGs and its HTML once; the critique prompt hands them exactly that; a reply that changed nothing never starts another critique, a lost round is asked again under its own number, and one `blockerOf` serves the card and the resolve prompt; the design lane starts at medium effort unless the user picked one. Suite after the wave: cargo 327, vitest 473, tsc clean, build ok. Not yet measured live.

**Findings left open** (the input for the next fix wave; S first):

- S. **The director is far too slow.** The user's verdict on seeing it. Measured: a build turn is 40–55 min and $9–11 with 12–13 permission asks (fonts and stock photos over `curl`, image crops in Python) and 4–9 self-run capture/lint calls; a critique round 4–6 min and $5–6 (four subagents, ~50 tool calls, 1.2 MB PNG reads); a critique-fix 4–10 min; a design to round 3 ≈ $25–35 and 1.5–2 h. Levers, in payoff order: bundle fonts and icons and forbid web calls in a build turn; no mid-turn capture/lint beyond one look before the turn ends; reviewers on a faster model with the app's own downscaled fold crops and one read each; never re-critique an unchanged version that already has a round (M) and never count a lost critique as a round (J); build turns at medium effort; and the permission decision below.
- **Full auto for the design lane** (the user's decision, 2026-10-07): "Work freely" like the main lane, implemented as Chronicle answering every non-write ask itself (allow once + a guard record) with the adapter kept in ask-first so the write fence and the mode lock stay; a project-wide `"shell": "auto"` in `review.json`, a mode-chip option and a popover line, and the bench allowing instead of refusing under it. Not built in this check: the Claude Code auto-mode classifier refused to spawn the implementer for it; it is the user's to run.
- O. The form path (§3) is never taken: two vague briefs were decided, not asked. The persona's "if an answer would change the design materially, ask" needs a sharper rule (a brief under N words, or one that names no audience, device or register, asks).
- F. "Nothing to change" (a user turn) starts a new attempt and the pane drops the previous attempt's critique: the Score tab, the pin counts and the sidebar score vanish although the round files are still on disk.
- H. Idle energy (check 13): 12–40 ms/s over the Roadmap pane, all in the app's own WebContent process; needs profiling (minimap, dotted canvas, the 1 s pill clock, thumbnails).
- M, J. A no-op turn re-ran a critique on a version that had already passed (~$8), and a critique lost to a restart counted as a round. Both fixed in the speed wave (`c00698f`); not yet seen live.
- Q. One session per project means another design's turns show under the active design's header with nothing naming them.
- P. Stop during a build with no frame yet still cut v1 and showed a "passed 0 / 0" gate for a frameless version.
- R. The below-the-bar card showed round 2's blocker while the resolve prompt was built from round 3. Fixed in the speed wave (`c00698f`).
- K. After an app restart the lane always starts a new session although the adapter advertises `loadSession` and `.threads/current` names the old one; a `session/load` would keep the director's context.
- N. `--setting-sources=user,project,local` pulls the project's own `.mcp.json` servers (shader-lab, a second shadcn) into the design lane.
- The director writes Claude Code auto-memory under `~/.claude/projects/<project>/memory/` (two notes today); outside the fence's scope, but later sessions read it.
- Minor: the pill's clock counts paused hours and reads "298:10"; "round 4 of 3" after a resolve round; the "Design skills" row's detail is "impeccable 3.5.0 · 4 reviewers" (fine) while the spec said "impeccable 3.5.0".

**Comps.** Boards 3 (form) and 9's limit card were not reachable; boards 4, 6, 10 and 11 match the build in structure and copy; the scorecard's reviewer sections and the below-the-bar card follow board 6/9.
