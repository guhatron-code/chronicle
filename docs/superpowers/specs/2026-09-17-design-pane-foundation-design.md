# The Design pane, foundation (sub-project 1) · design

Date: 2026-09-17. Status: approved in conversation section by section, awaiting spec review.
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
- **Designs live in the project**, under `.chronicle/designs/`, committed with the repo.
- **The surface is an artboard canvas**: many live frames side by side, zoomable.
- **Runtime A:** the director is a second Claude Code session in the project, over the same
  ACP adapter the agent pane uses, shaped by its own system prompt, skills and MCP servers.
  It runs on the user's Claude plan, not an API key.
- **Proof:** a built-in benchmark (about fifteen fixed briefs across the five kinds, automatic
  scores plus a blind side-by-side against exported Claude Design output), rerun each release.
- **Imagery:** optional generation with the user's own key; without one, drawn shapes, icons
  and labelled spaces. No video.
- **Dark theme only.** Chronicle is used dark; no light-theme work.
- **Settings:** Chronicle has no settings screen and gets none. Connections (review browser,
  design skills, image key, Figma, Mobbin) become a "For the Design pane" group on Setup &
  health; review settings open from the composer's critique chip.

Sub-projects, each with its own spec, plan and release:

| # | Sub-project | Comps boards |
|---|---|---|
| 0 | Comps (done) | all |
| 1 | **Foundation** (this spec): pane, canvas, second session, files, versions | 1, 2, 5, 7, part of 9 |
| 2 | The director: persona, vendored skills, MCP servers, lint gate, critique panel, benchmark | 3, 4, 6, 10, 11, rest of 9 |
| 3 | Design systems: read from the repo, a site or Figma; kept in sync with code | 8, sidebar footer |
| 4 | Refinement: click-to-comment, direct edits written to source, tweaks, variations, sketch marks | later comps |
| 5 | Decks: 1920×1080 framework, speaker notes, presenter view | later comps |
| 6 | Export and handoff: HTML, ZIP, PDF, PPTX, PNG; handoff to Chronigirl; design QA | later comps |
| 7 | Imagery with the user's key | later comps |

Deferred by the user, not designed here: how "Build this" hands a design to Chronigirl, and
whether design QA (the director checking the built page against the frames) ships with it.

## The problem this sub-project solves

Nothing in Chronicle can hold a design. There is no place for design files, no surface that
shows several rendered pages at once, and the agent pane allows exactly one agent session per
project (`acp::start` is single-flight on the project key). Every later sub-project needs the
same four things first: a pane, a canvas that renders untrusted generated HTML safely, a
second session that writes into a known file layout, and a version history.

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
  row, and the frame menu. Menu actions that need the director's judgment ("Blend", "More
  like this") arrive in sub-project 2.
- **Board 7, history:** a snapshot per turn, side-by-side compare, restore, branch.
- **Board 9, two of four states:** "a frame didn't render" and "usage limit reached".

Not built here: the clarifying form, lint gate, critique panel, scorecard, Setup & health
group, review popover, design-system view, and the director persona. The session in this
sub-project carries only a basic prompt (§6), so sub-project 2 layers the persona, skills and
review loop on without changing the plumbing.

### 2 · Two sessions per project: lanes

- `acp::start` takes a **lane**, `chat` or `design`. The chat lane keeps today's key (the
  project's canonical path), so the agent pane and its stored sessions need no migration.
  The design lane's key is `<canonical path>#design`. Each key stays single-flight.
- Every `acp-update` event carries `lane`. The `agent_session_*` and `agent_*` Tauri commands
  take an optional `lane`, defaulting to `chat`, so every existing caller is unchanged.
- `src/lib/agent-session.ts` keys its store by project **and** lane. The thread, composer,
  tool cards, subagent cards and permission cards take a lane prop, so the Design pane reuses
  them rather than copying them.
- Per-lane storage. The chat lane stays in `.chronicle/agent/` (transcripts, ledger,
  `current`). The design lane keeps its transcripts and its own `current` pointer under
  `.chronicle/designs/.threads/<session>/`. The session log file under app data is named from
  the key, so the two lanes never share one.

### 3 · What the design session may touch

- **Read:** the whole project (it needs the code's colors, type and components).
- **Write:** only `.chronicle/designs/`. The design lane's jail for `fs/write_text_file`
  is that folder; a write outside it is refused with a one-sentence error the thread shows.
- Shell commands ask permission as in the agent pane.
- The design lane shows **no keep/undo review strip**; versions (§5) replace it. The edit
  ledger is not written for the design lane.

### 4 · A design on disk

```
.chronicle/designs/
  .threads/<session>/            design-lane transcripts and `current`
  <slug>/
    design.json                  owned by the session
    canvas.json                  owned by the app
    frames/*.html                one self-contained page per frame
    assets/                      images, fonts, css the frames link relatively
    .versions/v<N>/              design.json, frames/, assets/, meta.json, thumbs/<frame>.png
```

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

`kind` is one of `app`, `marketing`, `deck`, `brand`, `ecommerce`. `canvas.json` holds frame
positions (`{ "<frame id>": { "x", "y" } }`) and the last viewport; the app writes it, the
session never does, so a user dragging a frame never races the session rewriting
`design.json`. A frame with no stored position is placed by group: breakpoints left to right
in one row, each variations group in its own row beneath. The slug is made from the title
(lower case, hyphens, a numeric suffix on collision).

Unreadable `design.json` or `canvas.json` is renamed to `.json.bad` and the design shows an
honest "couldn't read this design" row, the same rule as web-tabs.

The app watches `<slug>/` and re-renders only the frames whose files changed.

### 5 · Versions

- At each design-lane turn end, the app snapshots the active design into `.versions/v<N+1>/`
  **only if** the content hash of `design.json` + `frames/` + `assets/` differs from v<N>.
- `meta.json`: `{ "n", "at", "session", "prompt", "summary" }`. `summary` is the first
  sentence of the session's last message in the turn.
- **Thumbnails.** For every frame in the new version, a hidden native web view renders the
  frame at its declared size and saves `takeSnapshot` output to `thumbs/<frame id>.png`
  (via the `with_wk` access in `web.rs`). The design list, history compare, and off-screen
  canvas frames use these.
- **Restore vN** copies vN's content back and records a new version whose summary is
  "Restored vN". Nothing is deleted.
- **Branch from vN** creates a new design `<slug>-2` whose v1 is vN's content, with the
  brief copied and the title suffixed.

### 6 · Starting a design, and the basic prompt

1. The user picks a kind, writes a brief, presses Start designing (board 2).
2. The app creates `<slug>/` with `design.json` (title from the brief's first clause, kind,
   brief, no frames), starts the design lane if it is not live, and sends the brief.
3. The design appears in the list as "working"; the canvas shows placeholder frames until the
   first `ready` report (§7).
4. One design session serves all designs in the project. Every prompt the app sends is
   prefixed with the active design's slug and folder; switching designs in the list changes
   what the canvas shows and which design the next message is about.

The basic prompt, sent in `session/new` `_meta.systemPrompt` (append):

- The file contract: one self-contained HTML file per frame under `frames/`; list every
  frame with its size and group in `design.json`; breakpoints and variations as groups;
  assets under `assets/`, linked relatively; never write outside the active design's folder.
- How to read the prefix that names the active design.
- End every turn with one sentence saying what changed.

Sub-project 2 replaces the persona portion and adds skills and MCP servers; the file contract
stays.

### 7 · The canvas

**Rendering.** Each frame is an `<iframe>` in the app's own webview, loading
`chronicle-file://<hash>/.chronicle/designs/<slug>/frames/<file>`, inside a canvas layer moved
and scaled with a CSS transform. The app CSP in `tauri.conf.json` gains
`frame-src chronicle-file:` (today `default-src 'none'` blocks frames).

**Isolation.** Generated HTML is untrusted.

- Every frame iframe is `sandbox="allow-scripts"` **without** `allow-same-origin`: an opaque
  origin, no access to Chronicle's IPC, storage or DOM.
- For paths under `.chronicle/designs/`, `serve_project_file` adds a response CSP:
  fonts from `https://fonts.googleapis.com` and `https://fonts.gstatic.com`, images from
  `data:`, `https:` and the design's own path, scripts and styles inline and from the design's
  path; `connect-src 'none'`, no `frame-src`, no `form-action`.
- A test proves a frame cannot reach `invoke`.

**Frame state.** For HTML under `.chronicle/designs/`, the protocol handler injects a small
reporter before `</head>`: it posts `{ type: "ready", height }`, `{ type: "error", message,
line }` (from `window.onerror`) and `{ type: "blank" }` (empty body after load) to the parent.
The canvas accepts messages only from its own frame windows. States: placeholder →
rendering → rendered / didn't render (with the message and line). "Didn't render" offers one
button that sends the error to the design session (board 9).

**Interaction.**

- Frames are pictures by default (`pointer-events: none`), so the canvas owns every gesture:
  two-finger scroll pans, pinch or ⌘-scroll zooms, space-drag pans, click selects, dragging a
  selected frame moves it (written to `canvas.json`).
- Double-click makes one frame live (it takes pointer events; you scroll it and click its
  buttons). Esc returns it to a picture.
- ⌘0 fits all frames, ⌘1 is 100%, ⌘= and ⌘− zoom. Zoom range 5–200%.
- The minimap shows frame rectangles and the viewport; dragging it pans.

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
- **Session couldn't start:** the agent pane's existing handshake-failure card, in the
  Design pane's thread.
- **Write refused outside designs:** the thread shows the refusal sentence from §3.

### 9 · Keyboard and menu

- Design joins `PANES` (⌘J cycle) after Web, and gets a `GO` row in `src-tauri/src/menu.rs`.
- In the Design pane: ⌘N starts a new design (board 2's flow); ⌘0, ⌘1, ⌘=, ⌘− as §7; Esc
  leaves live mode.
- All new shortcuts are `GO` rows so they fire while focus is inside a frame or the native
  Web view, and the existing menu tests (parseable, unique, ⌥ only on pane toggles) cover
  them.

### 10 · Testing

Rust:
- Lanes: a chat and a design session live at once for one project; updates carry the right
  lane; stopping one leaves the other.
- The design lane refuses `fs/write_text_file` outside `.chronicle/designs/`.
- Versions: snapshot on change, skip when unchanged, restore records a new version, branch
  creates `<slug>-2` with v1.
- The protocol handler adds the design CSP and reporter only under `.chronicle/designs/`,
  and serves every other path exactly as before.

Frontend (vitest):
- The session reducer keyed by project and lane.
- `design.json` / `canvas.json` models: parse, defaults, default placement by group, `.bad`.
- Canvas maths: zoom about a point, fit, pan, which frames are live vs thumbnail.
- Frame state from reporter messages, and messages from foreign windows ignored.
- A replay fixture of one real design-lane session (brief → frames written → turn end),
  replayed through the reducer, as FX-9 did for the agent pane.

Live check before merge, on a release build (`--features tauri/custom-protocol`) against a
throwaway project:
- A brief produces frames and the canvas renders them.
- A frame with a script error shows "didn't render" with the line; one click sends it.
- Restore and branch work; thumbnails appear in history.
- From inside a frame, `window.__TAURI_INTERNALS__` is undefined and a postMessage to the app
  with a forged type is ignored.
- Idle energy with the pane open is within 1 ms/s of today.
- The agent pane's chat session still works while the design session runs.

## Delivery

One plan, subagent-driven, branch in place on `react-shadcn`. Release as a minor version once
the live check passes. Comps are the source of truth for layout and copy; where the build
must differ, the plan says why.

## Out of scope

Everything listed for sub-projects 2–7; handoff to Chronigirl and design QA (deferred by the
user); light theme; a Chronicle-wide settings screen; multiple design sessions at once.

## Known issue found while making the comps

The app's `--text-dimmer` (2.9:1 on the app ground) and `--text-dim` (3.9:1) fail WCAG AA for
readable text, and the shipped `Eyebrow` and `Kbd` atoms use `--text-dimmer`. The comps use
`--text-faint` (4.9:1) for meaningful text. The Design pane follows the comps; fixing the
shared atoms is a separate change.
