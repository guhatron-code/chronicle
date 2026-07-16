# Claude Design prompt — Chronicle Agent (the Zed update, Deck 7)

You are designing the **Agent experience** for Chronicle — an agent section stacked above the terminal in the right column, plus SIX shipped-surface
amendments (F36 viewer bar, F38 phase row, F39 kanban flow, and F40's four). Everything renders inside the shipped Chronicle app — match it exactly.

## Context you must honor

- **The product**: Chronicle is a calm, local-first macOS studio for a NON-developer
  tracking AI-driven builds. Register: plain-spoken, honest, one glance = one next
  step. Vocabulary law: save/publish/undo — never commit/push/revert. Sentence case
  for every statement. Errors say what happened and what to do next, no apologies.
- **The design system**: the Weave DS bridge already in the app — dark default,
  `[data-theme="light"]` first-class, tokens only (no raw hex anywhere), radius scale
  sm 6 / md 8 / lg 10, button scale sm 28 / md 33 / lg 36, mono for paths/ids/numeric
  metadata, 2px scrollbars, FLAT sections separated by dividers (cards only for
  alerts + phase cards), chips are one-line pills — name + destination inside,
  explanatory prose OUTSIDE the pill. Existing atoms to reuse, not reinvent:
  IdChip, StateWord (dot+word, never color-only), PasteChip, BtnPrimary/BtnSecondary,
  Eyebrow, Kbd, Spinner, the Claude starburst + Codex gradient marks.
- **What the pane is**: a chat thread driving Claude Code through a structured
  protocol. The agent streams text, runs tools (edit files, run commands, read
  files), and ASKS PERMISSION before acting in ask mode. Every file edit is
  reviewable and undoable; every user message is preceded by a snapshot the user can
  restore ("undo everything since this message").

## Deck 7 — frames (design every state listed; cuts must be explicit)

**F31 · The shell layout + pane visibility (design this first — everything else
lives inside it).** The agent is NOT a fourth rail destination. NOTE, superseding a
shipped convention: the old "terminal column is absent on Kanban (full-bleed)" rule
is retired — the right column may sit beside ANY content pane; the visibility
toggles are how full-bleed happens now. The toggle cluster sits leftmost of the
title bar's existing right-side items (update line · Checked HH:MM:SS) — design
their coexistence. Keyboard: ⌥⌘1/2/3 (show as tooltips). Clicking a rail
destination while the content unit is hidden auto-reveals it. The window is three
units: the content pane (roadmap/repo/kanban, switched by the existing rail) on the
left, and a right column stacking **Agent on top, Terminal below** with a horizontal
splitter. Design:
- the stacked right column (both sections' headers, the splitter's grab treatment);
- the **pane-visibility cluster**: three toggles (content · agent · terminal) on the
  title bar's right side — states: all visible · any two · exactly one (the last
  visible unit's toggle disables); include hover/tooltip copy;
- each section header's own collapse affordance and where a collapsed section's
  strip lives (a slim re-open handle, not a vanished pane);
- the agent section's empty state: quiet hero — the Claude mark, "Ask for anything."
  and one sentence: "Chronicle asks before the agent touches your project." Composer
  docked at the bottom of the agent section.

**F32 · The composer.** Multiline input (⌘Enter sends, stated as a Kbd hint), a
Stop button that replaces Send while the agent is working, the mode control —
two-state: **Asks first** (default) / **Works freely** (= edits happen without
asking; commands still ask — the control's tooltip says exactly that) — and a quiet
one-line usage meter (e.g. "31k of 200k") that is HIDDEN entirely when the agent
sends no usage data. States: idle · agent-working (Stop visible, input still
editable) · disconnected ("The agent bridge isn't running — Start it") ·
**installing the bridge** (first run downloads the adapter: "Setting up the agent
bridge…", progress feel, honest failure variant) · **needs login** ("Claude Code
isn't signed in" + a button that opens a terminal tab running the login, and the
waiting treatment while it runs). ALSO design the per-session **Works freely
confirm dialog**: title, body copy stating precisely what stops being asked, and
that it lasts for this session only.

**F33 · Thread entries.**
- User message: right-weighted block, no bubble chrome wars — flat, divider-separated.
- Assistant message: streaming markdown (headings, lists, fenced code, quotes — the
  app's mini-md styles), with a subtle in-progress shimmer ONLY while streaming.
- The checkpoint row: a thin divider above each user message with a small
  "↺ Undo to here" affordance (hover-revealed). Its confirm dialog: title
  "Undo everything since this message?", body — honest about scope —
  "Puts every file back the way it was before this message — including changes you
  made yourself since. Your conversation stays."

**F34 · Tool cards (the heart of the pane).** One compact card anatomy, kind-aware:
- Edit: "Edited `src/App.tsx`" + a ±stat chip + "View the changes" affordance.
- Run: "Ran `npm test`" + a state word (running/finished/failed) + expandable output
  (mono, capped height, 2px scrollbar).
- Read: "Read `PLAN.md`" — quietest treatment, collapses to one line.
- States for every kind: in-progress (spinner) · done · failed (honest error line) ·
  rejected ("You said no — skipped").
- Long paths truncate middle; cards never wrap their title line.

**F35 · The permission card.** The thread's consent moment, inline (not a modal).
NOTE: the button set is supplied BY THE AGENT per request (ACP PermissionOptions) —
design the anatomy for one/two/three offered options; the labels below are the
canonical mapping, and options not offered are simply absent:
"The agent wants to run `rm -rf node_modules`" + plain-language framing when the
command is risky, two buttons — Allow (primary) / Don't allow — and a third quiet
option "Always allow in this session" ONLY for edit-kind requests. Waiting state
pulses the state dot; answered state collapses to a one-line record ("You allowed
this" / "You said no").

**F36 · The review strip + review flow.** When the agent has changed files, a
persistent strip above the composer: "4 files changed · Review · Keep all · Undo all".
Review opens the existing repo diff viewer with a per-file action bar (Keep / Undo
this file) and a running count. Two file classes render distinctly: edits the agent
wrote directly (per-file Undo available) and files changed by the agent's COMMANDS
(reviewable diff, but the row says "changed by a command — covered by Undo to here"
instead of a per-file Undo). Design the strip, the viewer's action bar amendment,
both row treatments, and the resolution states ("All changes kept" · auto-kept at
session end).

**F37 · Session header + history.** Top bar of the pane: the Claude mark (colored),
session state word (working / waiting on you / idle / ended / needs login), End
session, and a lightweight history affordance (previous sessions by date). Design
the list row (first-message excerpt + relative time) in BOTH variants: resumable
("Resume") and read-only ("View · Continue in a new session") — resume depends on
an adapter capability and must not be promised universally.

**F38 · Phase-start integration.** The phase detail's action row amended: primary
"Start with the agent", secondary "Run in a terminal". The agent section revealing
(shown + focused if hidden) with a preloaded draft (the phase prompt as an unsent
composer draft with a small chip: "R-2 prompt loaded — review and send"). If the
composer already holds a non-empty draft, a small confirm asks before replacing it —
design that state too. Preload NEVER auto-sends.

**F39 · Round-in-pane.** The kanban's "Run the round for me" now lands in the agent
pane: a session whose first card is the round's plan ("Round 5 · 12 tasks"), tool
cards streaming beneath, and the board's tasks ticking (already built) — design the
round header card + its done/failed terminal states. Done/failed derive from
ground truth only (every round task completed on the board · the session's stop
reason) — the card must visually attribute its state to the board ("12 of 12 tasks
done"), never to the agent's own claim.

**F40 · Amendments (small, four of them).**
1. Terminal tabs: a live foreground-status treatment — the existing tab + a state
   word when a known agent runs ("claude · working") vs idle.
2. Terminal path links: the hover treatment for a detected path (`src/App.tsx:42`) —
   underline-on-hover + ⌘-click hint tooltip.
3. The title-bar update line's new states: "Checking…", "Downloading 42%",
   "Installing…", "Restart to finish".
4. Publish/bring-down toasts with the new plain-language results — vocabulary law
   applies: "Published 3 saves", "Brought down 2 saves", "Already in sync — nothing
   new" (the raw git detail may appear as small mono secondary text, never in the
   headline) — and the PR-hint variant with a "Create a pull request" action.

## Addendum — sync law: the shipped app has moved past Decks 1–6

The app (v0.2.12) carries many operator-directed changes made AFTER the original
decks. **Comps must match the shipped app, not Decks 1–6**, wherever a frame touches
these. Bake every one of these into any frame that includes the element; if a frame
deliberately diverges, flag it in a note instead of diverging silently.

**Controls & primitives**
- Buttons ride ONE size scale — sm 28 · md 33 · lg 36; primary AND secondary default
  to md; rows of paired buttons share one height on one baseline. Disabled primary is
  a quiet filled state (fill-subtle + text-dimmer), never a ghosted enabled button.
- Chips are one-line pills, always: name + destination INSIDE, explanatory prose
  OUTSIDE on the row (paste chips, ghost "not written yet" chips, doc chips). Chips
  never wrap mid-name; IdChip and status words never wrap or shed their dot.
- StateWord: dot pinned, label truncates — one line everywhere.
- Micro-chips are 10.5px on radius 5; author tiles size-4 with 8px initials; rail
  icons sit on the radius scale (8). Focus rings SNAP (no fade).
- The agent brand marks (the original Claude starburst, the Codex gradient badge)
  are COLORED at rest — no monochrome treatment.
- Scrollbars are literally 2px — gutter and thumb.
- All popups center to the APP window (palette, search, dialogs, the kanban composer
  and execute flow). Toasts are bottom-center pills, truly centered.
- Traffic lights: quiet monochrome dots at rest; hovering the cluster shows real
  macOS colours + glyphs (× − zoom triangles).

**Shell & picker**
- Title bar right side: the update notice ("Chronicle X.Y.Z is ready · Update" +
  quiet dismiss) sits before "Checked HH:MM:SS".
- Picker cards pin their progress bar to the card bottom (uniform across the grid);
  the phase row truncates the phase NAME first, the status word last; open projects
  show an "Open" badge and a "Session running" badge when a terminal is live.
- The ⌘K palette has a "GitHub — clone and open" group (repos, Private badges,
  Cloning… state) and a "Check for updates" action row. The shortcuts overlay lists
  ⌘⇧F search, "⌘J or ⌃tab" as ONE row, and double-click terminal rename.

**Roadmap**
- Section rhythm: panels py-26, slim alert banners py-18, the phase rail py-28.
- The current-state banner headline is 15px and carries "Open the phase ›".
- Rebuild has ONE name everywhere (no "Scan"); the building card says "Rebuilding
  your roadmap…" when a roadmap is already on screen; confirms share "Not yet".
- The phase detail has a pre-flight readiness row beside the start helper (green
  checks / one honest red one) and its primary action row is being amended by F38.
- A returning user sees the "While you were away" digest section (dismissable).
- The documents panel renders paste/ghost targets as ROWS: one-line chip + prose
  note beside it.
- The needs-you GitHub row is a one-click primary "Put it on GitHub"; the publish
  footer says "Chronicle publishes for you and shows its progress here".
- Round overlay phases show a retrospective line ("This round made N saves touching
  M files") in their detail.

**Repo & viewer**
- The viewer's mode segment says "Changes" (never "Diff") and marks a staged file
  "Ready to save"; save box sits BELOW the changes list with the "Draft it" button
  beside the input.
- The explorer follows the disk live (no refresh affordances needed in comps).

**Kanban**
- The round strip is honest: "being planned" / "waiting to run" / "running"; frozen
  cards say "locked until the round finishes"; the done card leads with "Run the
  round for me" (primary) + "Run it in a terminal" (secondary).

**Type & theme details**
- mini-md renders fenced code blocks and blockquotes; light theme --text-dimmer is
  the darkened step (#6e6e6e-equivalent token); accordions size to content (design
  nothing that assumes a fixed open height).
- Ended terminal tabs: no italics, "· ended" word, no cursor in the surface.

## Deliverable

One deck (`.dc.html`, same format as Decks 1–6) with every frame + state above,
1:1 buildable: real paddings, tokens by name, exact type sizes on the app's scale
(11.5/12.5/13/15), light AND dark. No new colors: the only chroma remains the two
agent marks and the state palette. If any frame conflicts with the shipped app's
conventions, the app's conventions win — flag the conflict in a note rather than
diverging silently.
