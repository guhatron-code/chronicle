# The Design pane, foundation (sub-project 1) · design

Date: 2026-09-17. Status: approved in conversation section by section, amended after a gap
review (sixteen items, each decided by the user), awaiting spec review.
Comps: approved 2026-09-17, in `design/comps/design-pane/` (generator `gen.py`), published at
https://claude.ai/artifact/2uQSZxXkNChoS8Ns22bC24.

## The program this belongs to

The user wants a fifth rail pane, **Design**, driven by an agent that works as a senior art
director and UX director, and that is measurably better than Claude Design. Decisions taken
in the brainstorm, which every sub-project inherits:

- **Scope: core parity, beat on quality.** Match the design loop that Claude Design and Open
  Design (nexu-io/open-design) share: brief → generate → refine → design systems → export →
  handoff. Skip Open Design's long tail (27 agent adapters, plugin marketplace, cloud team
  collaboration, video and audio).
- **Kinds, all first class:** app/product UI, marketing and web, decks and docs, brand and
  identity, and e-commerce that follows Nielsen Norman and Baymard guidance. Baymard's
  guidelines are paid and copyrighted, so the e-commerce rules are written by us from their
  public articles, cited, never copied.
- **Designs live in the project**, under `.chronicle/designs/`, and are **not committed**:
  the folder ignores itself (§4). Designs stay on this Mac unless exported.
- **The surface is an artboard canvas**: many live frames side by side, zoomable.
- **Runtime A:** the director is a second Claude Code session in the project, over the same
  ACP adapter the agent pane uses, shaped by its own system prompt, skills and MCP servers.
  It runs on the user's Claude plan, not an API key.
- **Proof:** a built-in benchmark (about fifteen fixed briefs across the five kinds, automatic
  scores plus a blind side-by-side against exported Claude Design output), rerun each release.
- **Imagery:** optional generation with the user's own key; without one, drawn shapes, icons
  and labelled spaces. No video.
- **Fonts are bundled** into each design's `assets/`, never loaded from a font service, so a
  design looks the same offline and in every snapshot.
- **Dark theme only.** Chronicle is used dark; no light-theme work.
- **Settings:** Chronicle has no settings screen and gets none. Connections (review browser,
  design skills, image key, Figma, Mobbin) become a "For the Design pane" group on Setup &
  health; review settings open from the composer's critique chip.

Sub-projects, each with its own spec, plan and release, and each a phase on Chronicle's own
roadmap (§11):

| # | Sub-project | Comps boards |
|---|---|---|
| 0 | Comps (done) | all |
| 1 | **Foundation** (this spec): pane, canvas, a second session, files, versions, design management, read-only agent API | 1, 2, 5, 7, part of 9 |
| 2 | The director: persona, vendored skills, MCP servers, lint gate, critique panel, benchmark | 3, 4, 6, 10, 11, rest of 9 |
| 3 | Design systems: read from the repo, a site or Figma; kept in sync with code | 8, sidebar footer |
| 4 | Refinement: click-to-comment, direct edits written to source, tweaks, variations, sketch marks | later comps |
| 5 | Prototypes: links between frames, walking a flow, transitions, a flow map | later comps |
| 6 | Decks: 1920×1080 framework, speaker notes, presenter view | later comps |
| 7 | Export and handoff: HTML, ZIP, PDF, PPTX, PNG; handoff to Chronigirl; design QA | later comps |
| 8 | Imagery with the user's key | later comps |

Deferred by the user, not designed here: how "Build this" hands a design to Chronigirl, and
whether design QA (the director checking the built page against the frames) ships with it.

## The problem this sub-project solves

Nothing in Chronicle can hold a design. There is no place for design files, no surface that
shows several rendered pages at once, and the agent pane allows exactly one agent session per
project (`acp::start` is single-flight on the project key). Every later sub-project needs the
same things first: a pane, a canvas that renders untrusted generated HTML safely, a second
session that writes only into a known file layout, and a version history.

## Design

### 1 · Scope

Built here:

- **Rail and pane.** A Design button (the artboard glyph in the comps) after Web; Design joins
  the ⌘J cycle and gets a Go-menu row. The pane component lives in `src/screens/design/`.
- **Board 2, no designs yet:** the five kind cards and the brief box. "Capture a site" and
  "References" are drawn disabled until sub-project 2.
- **Board 1, at rest:** design list (grouped by kind), canvas, thread, composer. Score chips
  and the design-system footer are hidden until sub-projects 2 and 3.
- **Board 5, the canvas:** zoom, pan, fit, minimap, selection, frame dragging, a variations
  row, the frame menu, full keyboard operation, and undo for canvas actions. Menu actions that
  need the director's judgment ("Blend", "More like this") arrive in sub-project 2.
- **Board 7, history:** a snapshot per turn, side-by-side compare, restore, branch.
- **Board 9, two of four states:** "a frame didn't render" and "usage limit reached".
- **Design management:** rename, delete to trash, duplicate, reorder, change kind (§4).
- **Read-only agent API** for designs (§10) and the program's roadmap phases (§11).

Not built here: the clarifying form, lint gate, critique panel, scorecard, Setup & health
group, review popover, design-system view, prototypes, and the director persona. The session
in this sub-project carries only a basic prompt (§6), so sub-project 2 layers the persona,
skills and review loop on without changing the plumbing.

### 2 · A second session per project: lanes

- `acp::start` takes a **lane**, `chat` or `design`. The chat lane keeps today's key (the
  project's canonical path), so the agent pane and its stored sessions need no migration.
  The design lane's key is `<canonical path>#design`. Each key stays single-flight.
- **One design session per project**, serving every design in it. Each prompt the app sends
  names the active design (§6).
- Every `acp-update` event carries `lane`. The `agent_session_*` and `agent_*` Tauri commands
  take an optional `lane`, defaulting to `chat`, so every existing caller is unchanged.
- `src/lib/agent-session.ts` keys its store by project **and** lane. The thread, composer,
  tool cards, subagent cards and permission cards take a lane prop, so the Design pane reuses
  them rather than copying them.
- Per-lane storage. The chat lane stays in `.chronicle/agent/` (transcripts, ledger,
  `current`). The design lane keeps its transcripts and its own `current` pointer under
  `.chronicle/designs/.threads/<session>/`. The session log under app data is named from the
  key, so the two lanes never share one.
- **Lifetime.** The design session stops by itself after **15 minutes with no turn running**
  and resumes the same conversation (`session/load`) when the user next sends a message or
  starts a design. Hiding the pane does not stop it, so a running turn finishes. The idle
  watchdog lives in Rust, on the session (last activity stamped on every prompt and turn end,
  checked every 30 seconds); it emits `ended` with `reason: "idle"`.
- **Modes.** The design lane runs only in the adapter's ask-first mode (`default`). Plan, Auto,
  Execute and Unattended are never offered: leaving plan mode offers modes that write without
  asking, which would defeat §3. The app refuses any other mode for this lane, switches the
  session back if it reports another mode, and answers ExitPlanMode asks itself with a refusal.
  (Amended during the build, final review I2.)

### 3 · What the design session may touch: three layers

- **Read:** the whole project (it needs the code's colors, type and components).
- **Write:** only `.chronicle/designs/`. Claude Code's own Write and Edit tools write to disk
  directly, not through `fs/write_text_file`, so one check is not enough:
  1. **Permission answers.** A permission request for Write, Edit or MultiEdit whose path
     resolves (canonicalised, symlinks followed) inside `.chronicle/designs/` is allowed
     without asking; any other path is refused with a one-sentence reason the thread shows.
     `fs/write_text_file` applies the same rule.
  2. **A locked mode, and no allow rules.** Every write ask must reach layer 1, so the session
     is held in ask-first mode (see Modes) and the session `_meta` carries **no** Claude Code
     allow rules. An allow rule for `<designs>/**` would also cover the lane's own records in
     `.chronicle/designs/.threads/`, letting the session forge its undo ledger without asking
     Chronicle. Layer 1 refuses any dot-leading path component under the designs root (the
     records, `.gitignore`, `<slug>/.versions/`), so only `<slug>/…` design content is writable.
     `fs/write_text_file` gets the same rule as defence in depth; adapter 0.75.1 writes files
     itself and never calls it. (Amended during the build.)
  3. **Turn-end check** (it also catches writes a user's own Claude settings auto-allow). At
     turn end, anything outside `.chronicle/` that changed since the turn's checkpoint, and that
     the chat lane's ledger doesn't already account for, is listed in the thread as "Changed
     while the design session worked" (it can include the user's own edits). Each file has
     Undo, refused while a turn runs; Undo first moves the current file to the Trash, then puts
     the pre-turn bytes back. There is no "Undo all". `.chronicle/` itself is excluded because
     the app writes notes, ledgers and the journal there during a turn. (Amended during the
     build.)
- Shell commands ask permission every time, as in the agent pane's ask-first mode.
- The design lane shows **no keep/undo review strip for design files**; versions (§5) cover
  them.

### 4 · Designs on disk

```
.chronicle/designs/
  .gitignore                     contains "*": the folder ignores itself
  order.json                     the list order the user dragged, per kind
  .threads/<session>/            design-lane transcripts and `current`
  <slug>/
    design.json                  owned by the session
    canvas.json                  owned by the app
    frames/*.html                one self-contained page per frame
    assets/                      fonts, images, css the frames link relatively
    .versions/v<N>/              design.json, frames/, assets/, meta.json, thumbs/<frame>.png
```

- **Not committed.** Chronicle writes `.chronicle/designs/.gitignore` containing `*` when it
  creates the folder, so nothing is committed and the project's own `.gitignore` is never
  touched. Git-derived surfaces (the Repo pane's changed files, unpublished saves) therefore
  never show design files.
- **Worktrees.** A linked git worktree resolves `.chronicle/designs/` to the main checkout's
  folder, with the same resolver notes use (`notes::index::vault_root`), so a session in a
  worktree sees the approved designs.
- **Watching.** The app watches `.chronicle/designs/` separately from the project watchers.
  Events are debounced (a trailing 250 ms per design), re-render only the frames whose files
  changed, and never trigger a roadmap rescan or a notes refresh.

`design.json`:

```json
{ "v": 1, "title": "Product page · Ethiopia Guji", "kind": "ecommerce",
  "brief": "…", "created": "2026-09-17T10:00:00Z",
  "frames": [ { "id": "desktop", "file": "frames/desktop.html", "label": "Desktop",
                "width": 1440, "height": 1180, "group": "breakpoints" } ],
  "groups": [ { "id": "breakpoints", "label": "Breakpoints", "kind": "breakpoints" },
              { "id": "hero", "label": "Hero · 3 directions", "kind": "variations" } ],
  "chosen": null }
```

`kind` is one of `app`, `marketing`, `deck`, `brand`, `ecommerce`. A frame's `width` is its
viewport width; its `height` is the first screen, the fold (§7).

`canvas.json` holds frame positions (`{ "<frame id>": { "x", "y" } }`) and the last viewport;
the app writes it, the session never does, so a user dragging a frame never races the session
rewriting `design.json`. A frame with no stored position is placed by group: breakpoints left
to right in one row, each variations group in its own row beneath.

Unreadable `design.json`, `canvas.json` or `order.json` is renamed to `.json.bad` and shown
honestly ("couldn't read this design"), the same rule as web-tabs.

**Design management** (list row menu, and the canvas toolbar title):

- **Rename** changes `title`; the slug and folder stay, so no path breaks.
- **Delete** moves the folder to `.chronicle/trash/designs/<slug>-<timestamp>/`, with an undo
  toast, like notes.
- **Duplicate** creates `<slug>-2` whose v1 is the latest version (the same code path as
  Branch, §5).
- **Reorder** by dragging rows within a kind (pointer events, as the notes and Web sidebars
  do; HTML5 drag and drop does not work in this webview), stored in `order.json`.
- **Change kind** moves the design to another group.

The slug is made from the title at creation (lower case, hyphens, numeric suffix on collision).

### 5 · Versions

- At each design-lane turn end, the app snapshots the active design into `.versions/v<N+1>/`
  **only if** the content hash of `design.json` + `frames/` + `assets/` differs from v<N>.
- `meta.json`: `{ "n", "at", "session", "prompt", "summary" }`. `summary` is the first
  sentence of the session's last message in the turn.
- **Thumbnails.** For every frame in the new version, a hidden native web view loads the frame
  at its width, waits for the reporter's `ready` **and** `document.fonts.ready` (at most five
  seconds), and saves `takeSnapshot` output of the full page height to `thumbs/<frame id>.png`
  (via the `with_wk` access in `web.rs`). The design list, history compare and off-screen
  canvas frames use these.
- **Restore vN** copies vN's content back and records a new version whose summary is
  "Restored vN". Nothing is deleted.
- **Branch from vN** creates a new design `<slug>-2` whose v1 is vN's content, with the brief
  copied and the title suffixed.

### 6 · Starting a design, and the basic prompt

1. The user picks a kind, writes a brief, presses Start designing (board 2).
2. The app creates `<slug>/` with `design.json` (title from the brief's first clause, kind,
   brief, no frames), starts or resumes the design lane, and sends the brief.
3. The design appears in the list as "working"; the canvas shows placeholder frames until the
   first `ready` report (§7).
4. Every prompt the app sends is prefixed with the active design's slug and its folder as an absolute path; switching
   designs in the list changes what the canvas shows and which design the next message is
   about.

The basic prompt goes in `session/new` as **`_meta.systemPrompt = { "append": "…" }`**. The
object form adds to Claude Code's own system prompt; a plain string would replace it and strip
the tool guidance (adapter source, `acp-agent.js`, `params._meta?.systemPrompt`). It says:

- The file contract: one self-contained HTML file per frame under `frames/`; list every frame
  with its viewport width, fold height and group in `design.json`; breakpoints and variations
  as groups; assets under `assets/`, linked relatively; never write outside the active
  design's folder.
- **Fonts are local:** download any web font once into `assets/fonts/` and load it with
  `@font-face` from there; never link a font service. (The download is a shell command, so it
  asks permission.)
- How to read the prefix that names the active design.
- End every turn with one sentence saying what changed.

Sub-project 2 replaces the persona portion and adds skills and MCP servers; the file contract
stays.

### 7 · The canvas

**Rendering.** Each frame is an `<iframe>` in the app's own webview, loading
`chronicle-file://<designs-hash>/<slug>/frames/<file>` (designs are served from their own host,
whose root is the canonical `.chronicle/designs` directory and nothing else), inside a canvas layer moved
and scaled with a CSS transform. The app CSP in `tauri.conf.json` gains
`frame-src chronicle-file:` (today `default-src 'none'` blocks frames).

**Isolation.** Generated HTML is untrusted.

- Every frame iframe is `sandbox="allow-scripts"` **without** `allow-same-origin`: an opaque
  origin, no access to Chronicle's IPC, storage or DOM.
- On the design host, the file is resolved canonically; only `<slug>/…` paths with a valid
  slug and no dot-leading first component are served, and each gets:
  - a response CSP built per response with the source `chronicle-file://<designs-hash>/<slug>/`
    for scripts, styles, fonts, images and media (plus inline scripts/styles, and `data:` and
    `https:` images); `default-src`, `connect-src`, `frame-src`, `form-action` and `base-uri`
    are `'none'`;
  - `Access-Control-Allow-Origin: *` only for fonts and `.mjs`, which an opaque-origin page
    loads in CORS mode. Ordinary project hosts never get design treatment.
  (Amended during the build after a security review found URL-spelling and folder-name
  injection bypasses.)
- A test proves a frame cannot reach `invoke`.

**Frame state.** For HTML under `.chronicle/designs/`, the protocol handler injects a small
reporter before `</head>`: it posts `{ type: "ready", height }` (the document's full scroll
height), `{ type: "error", message, line }` (from `window.onerror`) and `{ type: "blank" }`
(empty body after load) to the parent. The canvas accepts messages only from its own frame
windows. States: placeholder → rendering → rendered / didn't render (with message and line).
"Didn't render" offers one button that sends the error to the design session (board 9).

**Height.** A frame is drawn at its **full page height** as reported, like an artboard, so the
whole page is visible on the canvas. The declared `height` is drawn as a faint fold line
across the frame. Before the first report the frame uses its declared height.

**Pointer interaction.**

- Frames are pictures by default (`pointer-events: none`), so the canvas owns every gesture:
  two-finger scroll pans, pinch or ⌘-scroll zooms, space-drag pans, click selects, dragging a
  selected frame moves it (written to `canvas.json`).
- Double-click makes one frame live (it takes pointer events; you scroll it and click its
  buttons). Esc returns it to a picture.
- With the canvas focused, plain keys zoom, as in Figma: `0` fits all frames, `1` is 100%,
  `=` and `-` zoom in and out. (⌘1–⌘9 already switch projects and ⌘=/⌘− are the app's own
  zoom, so the canvas does not take them.) Zoom range 5–200%. The zoom readout is also a
  button that cycles fit → 100%.
- The minimap shows frame rectangles and the viewport; dragging it pans.

**Keyboard.** The canvas is fully operable without a pointer:

- Tab and Shift-Tab move selection between frames in reading order (rows top to bottom, left
  to right), and on to the canvas toolbar.
- Arrow keys nudge the selected frame by 1 px, Shift-arrow by 10 px.
- Enter makes the selected frame live; Esc returns it.
- The selected frame scrolls into view; the focus ring is the app's `--focus-ring`.
- Each frame is announced as "<label>, <width> wide, <state>" (for example "Desktop, 1440
  wide, rendered"); state changes are announced politely.

**Undo.** ⌘Z and ⇧⌘Z undo and redo the user's own canvas and list actions within the app
session: frame moves, renames, reorders, kind changes, deletes and restores. The director's
changes are not on this stack; History (§5) undoes those.

**Energy.** Only frames that are on screen **and** drawn at 15% or more are live iframes, at
most six at once (nearest the viewport centre win). Every other frame shows its latest
thumbnail. When the pane is hidden or the window is not visible, all iframes unmount. Idle
cost with the pane open must stay within 1 ms/s of today's measured idle.

### 8 · Errors

- **Frame didn't render:** §7.
- **Usage limit:** the design lane reads the same rate-limit `usage_update` meta and typed
  session failures the limits chip already reads, and shows board 9's thread card: what
  happened, when it resets, that the work so far is saved (the last version number), and
  "Remind me at <time>".
- **Session couldn't start or resume:** the agent pane's existing handshake-failure card, in
  the Design pane's thread.
- **Write refused outside designs:** the refusal sentence from §3; changes found at turn end
  are listed with Undo.

### 9 · Keyboard shortcuts and menu

- Design joins `PANES` (⌘J cycle) after Web, and gets a `GO` row in `src-tauri/src/menu.rs`.
- In the Design pane: ⌘N starts a new design (board 2's flow), by widening the existing
  `go-new-note` row's pane check; the canvas keys in §7 (`0`, `1`, `=`, `-`, arrows, Enter,
  Esc) and ⌘Z / ⇧⌘Z apply only while the canvas has focus, and no frame ever holds focus
  unless it is live, so none of them needs a new `GO` row. The menu tests are unchanged.

### 10 · Designs in Chronicle's agent API (read-only)

Two capabilities in `src-tauri/src/agent_api.rs`, exposed as MCP tools and CLI subcommands
like the rest, documented in `docs/agent-api.md`:

- `chronicle.designs.list` → each design's slug, title, kind, frame count, latest version
  number and time.
- `chronicle.designs.read { slug, version? }` → the brief, `design.json`, absolute paths of
  the frame files and thumbnails for that version (latest by default).

No write capability. Both resolve the designs folder through the worktree rule in §4. The
chronicle skill's reference gains the two tools.

### 11 · The program on Chronicle's roadmap

`chronicle.json` gains a Part, "The Design pane", with phases DP-0 (comps, done by the comps
commit) through DP-8 (imagery), plain-language descriptions and steps in the manifest's usual
register. DP-1 is done when its live-test commit lands; each later phase gets its rule when its
spec is approved.

### 12 · The adapter, verified

Checked against the pinned `@agentclientprotocol/claude-agent-acp@0.75.1` source on
2026-09-17: `_meta.systemPrompt` as an object is spread into the `claude_code` preset (so
`append` appends; a string replaces); `_meta.claudeCode.options` is spread into the SDK
options, including `settings`; a permission request's `toolCall` carries `rawInput` (with
`file_path`) and `locations`; `loadSession` is advertised and `session/load` is implemented.

### 13 · Testing

Rust:
- Lanes: a chat and a design session live at once for one project; updates carry the right
  lane; stopping one leaves the other.
- The fence: a Write/Edit permission request inside `.chronicle/designs/` is allowed, outside
  is refused (including through a symlink and `..`); `fs/write_text_file` follows the same
  rule; a change outside at turn end is listed and undoable.
- Idle stop: the pure `idle_due` rule (15 minutes, never during a turn), and resume on the next
  message.
- Versions: snapshot on change, skip when unchanged, restore records a new version, branch and
  duplicate create `<slug>-2` with v1.
- Management: rename keeps the slug; delete moves to trash and undo brings it back.
- The designs folder writes its own `.gitignore`; a worktree resolves to the main checkout's
  designs.
- The protocol handler adds the design CSP, the CORS header and the reporter only under
  `.chronicle/designs/`, and serves every other path exactly as before.
- `chronicle.designs.list` and `.read` return the right shape and refuse unknown slugs.

Frontend (vitest):
- The session reducer keyed by project and lane.
- `design.json`, `canvas.json`, `order.json` models: parse, defaults, placement by group,
  `.bad`.
- Canvas maths: zoom about a point, fit, pan, full-height frames, live vs thumbnail choice.
- Keyboard: tab order, nudges, Enter and Esc, announcements.
- Undo stack: each user action undoes and redoes; director changes are not on it.
- Frame state from reporter messages; messages from foreign windows ignored.
- A replay fixture of one real design-lane session (brief → fonts downloaded → frames written
  → turn end), replayed through the reducer, as FX-9 did for the agent pane.

Live check before merge, on a release build (`--features tauri/custom-protocol`) against a
throwaway project:
- A brief produces frames with local fonts, and the canvas renders them at full height.
- A frame with a script error shows "didn't render" with the line; one click sends it.
- Restore, branch, duplicate, rename, delete and undo work; thumbnails appear in history and
  match the frames offline.
- From inside a frame, `window.__TAURI_INTERNALS__` is undefined and a forged postMessage is
  ignored.
- The design session asking to write outside `.chronicle/designs/` is refused; a shell write
  outside is caught at turn end.
- The session stops after 15 idle minutes and resumes on the next message.
- `git status` in the project shows nothing from `.chronicle/designs/`.
- The whole canvas can be driven from the keyboard.
- Idle energy with the pane open is within 1 ms/s of today.
- The agent pane's chat session still works while the design session runs.

## Delivery

One plan, subagent-driven, branch in place on `react-shadcn`. Release as a minor version once
the live check passes. Comps are the source of truth for layout and copy; where the build must
differ, the plan says why.

## Out of scope

Everything listed for sub-projects 2–8; handoff to Chronigirl and design QA (deferred by the
user); light theme; a Chronicle-wide settings screen; more than one design session per
project; committing designs to git.

## Known issue found while making the comps

The app's `--text-dimmer` (2.9:1 on the app ground) and `--text-dim` (3.9:1) fail WCAG AA for
readable text, and the shipped `Eyebrow` and `Kbd` atoms use `--text-dimmer`. The comps use
`--text-faint` (4.9:1) for meaningful text. The Design pane follows the comps; fixing the
shared atoms is a separate change.


## Changes made during the build (2026-09-17)

Every change below came from a task or final review and is recorded as a ruling in the build
ledger; the sections above are already amended.

- §2 Modes: ask-first only (plan mode removed).
- §3 Layer 2: no Claude Code allow rules; dot-leading paths under the designs root refused.
- §3 Layer 3: excludes paths the chat ledger records; Undo trashes the current file first; no
  "Undo all"; refused mid-turn.
- §6 The prompt prefix names the design folder by absolute path (worktrees resolve to the main
  checkout).
- §7 Designs served from their own host; per-slug CSP; CORS only for fonts.
- §5 Restored and branched versions inherit the source version's thumbnails; thumbnails are at
  most 720 points wide, rendered one version at a time in a window pinned to the design host.
- History compare uses the current frame list; a frame missing from an older version shows a
  placeholder (reading a version's own frame list is a follow-up).
- The design thread never offers the chat's checkpoint restore or edit diffs.
