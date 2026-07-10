# Chronicle v2 — the full redesign batch (paste into Claude Design)

You are designing **Chronicle v2**: every surface of a macOS desktop app, redesigned from scratch
on the **Weave design system**. The old app exists and works; you are NOT copying it — you are
designing the calm, honest version of it. This document is self-contained: product register,
design system, component vocabulary, and the complete deck/frame inventory with acceptance rules.

---

## 0 · What Chronicle is (the product register)

Chronicle is a **companion app for a solo builder** running multi-phase, prompt-driven builds with
Claude Code / Codex. They live in a terminal and a design tool; Chronicle sits alongside as the calm
"where does the build stand" app. **Many users are not git-fluent** — the app deliberately translates
git into plain language (save / publish / bring down).

**Purpose:** show — in plain language — where a multi-phase build stands: which phases are done, the
exact file to paste into which tool next, and what needs the user (unpublished saves, leftover
workspaces, decisions waiting). Everything is derived deterministically from disk/git ground truth;
the app never mutates a project without an explicit, confirmed action. Success = the user always
trusts the roadmap and never reconstructs project state in their head.

**Brand personality:** calm, honest, plain-spoken. Quiet dark UI, no ceremony. The tool disappears
into the task.

**Anti-references:** not a git GUI (no Sourcetree/GitKraken density, no jargon walls); not a
dashboard of vanity metrics; no AI-product glow/gradient aesthetics; never fake certainty — statuses
come from deterministic rules or are shown as unknown.

**Design principles (binding):**
1. Plain language over git vocabulary — save/publish, never jargon in headlines.
2. Ground truth only — stale or unknown is shown honestly.
3. One glance, one next step — the current phase and the exact paste-this file are the loudest thing.
4. Never touch the project — reading is safe; actions are explicit and confirmed.
5. Consistency over surprise — same component vocabulary everywhere; delight only in status
   micro-moments.

**The vocabulary law (applies to every frame):**
- "Ready to save" — never "Staged changes". **include / skip** — never Stage/Unstage.
- save / publish / bring down — never commit/push/pull in headlines (raw commands may appear as
  small secondary detail only).
- Buttons say what actually happens: "Copies a command — paste it in the terminal" style honesty;
  a button must never pretend ("Put this project on GitHub" must not silently copy a command).
- "Show more" — never "Show all". An action keeps its name through the flow (Publish → "Published").
- Errors explain what went wrong and how to fix it; no apologies, no vagueness. Empty states invite
  the next action.

**Accessibility (binding):** WCAG 2.1 AA. Every interactive element is a real button/focusable with
a visible focus state (the DS double-ring). Text ≥ 4.5:1 on its surface (the DS text ramp already
guarantees this — don't go below `--text-dimmer`). Status is never color-only — always a word or
glyph alongside. Every animation has a reduced-motion equivalent (freeze, don't remove meaning).

---

## 1 · The design system (Weave DS — binding, no exceptions)

Dark is DEFAULT; light is first-class via `[data-theme="light"]`. All values are CSS custom
properties; **never a raw hex, never a default-library grey.**

**Surfaces (dark → light):** `--surface-app` #0a0a0a→#e9e9ec (app bg) · `--surface-panel`
#0d0d0d→#fff (main panel) · `--surface-sidebar` #131313→#f4f4f6 (the floating rail) ·
`--surface-card` #101010→#fff · `--surface-card-raised` #111111→#fff (clickable rows) ·
`--surface-input` #0b0b0b→#f5f5f7 (inputs, the terminal, code/diff panes) · `--surface-overlay`
#161616→#fff (menus, palette, dialogs).

**Text ramp (dark):** primary #ededed · secondary #cfcfcf · muted #9a9a9a · subtle #8a8a8a ·
faint #7e7e7e · dim #6e6e6e · dimmer #5a5a5a (eyebrows/timestamps/disabled only).

**Borders:** hairline rgba(255,255,255,.08) (default) · strong .12 (secondary buttons, emphasized
edges) · field .09 / field-focus .28 (inputs) · divider .055 / divider-faint .04.

**Fills:** hover rgba(255,255,255,.06) · subtle .03. **Primary button:** #ededed bg / #0a0a0a text,
hover #fff. **Selected nav:** inverted — white fill, #0a0a0a text (the one loud-yet-calm signal).
**Focus:** double ring `0 0 0 2px #0d0d0d, 0 0 0 3px rgba(255,255,255,.22)`.

**State — the ONLY chromatic colour (desaturated):** success #7fae8a · error #cf8a86 · neutral
#9a9a9a ("checking…", running, queued). A running task is NEUTRAL, never success-green. The one
other place hue may appear: project mark tiles (brand data, muted palette #71717a #6b7280 #7c8a6b
#8a7c6b #6b7c8a #8a6b7c) and the two agent brand logos (Claude terracotta #D97757; Codex blue
gradient) on their start buttons.

**Type:** Geist Sans for all UI text; **Geist Mono** for keys, file paths, commit hashes, commands,
code/diff, and ALL numeric metadata (counts, timestamps — `tabular-nums`). Roles: view title 15/600 ·
dashboard title 21/600 · section heading 15/600 · item title 13.5–14.5/500 · body 13/400 · field
label 12.5/400 · helper 11.5–12/400 · eyebrow 10/400 uppercase +0.09em (dimmer) · mono meta
11.5–12.5/400.

**Radius:** 6 (tiny) · 8 (default — buttons, inputs, nav) · 10 (cards) · 12–13 (floating panels,
mark tiles). Never pill except intentional chips.

**Spacing/heights:** inputs 34–38px · nav item 38px · secondary button 32–34px · primary 36–38px ·
small/inline 26–30px. Card padding 15px 18px header / 14–16px 18px rows. Gaps: 8 tight · 10–14 card
grids · 18–30 section stacks.

**Motion:** 0.15s bg/color/border on hover/focus. Spinner 0.7s linear. No decorative animation —
motion confirms state or navigation only. Dark elevates with surface steps + hairlines (shadows only
on floating overlays: `0 16px 40px rgba(0,0,0,.5)`); light elevates with shadow.

**Window:** frameless, transparent, rounded (~11px). The app draws its own window controls
(close · minimize · zoom) in the title bar, which is the drag region.

---

## 2 · Component vocabulary (HARD name-parity)

The repo has the FULL shadcn/ui (new-york), FULL Kibo UI, and FULL AI Elements registries installed
and themed from the tokens above. **Compose from these named components wherever one fits — name
them in your comps** (a comp that says "Kanban [k]" or "Command dialog" is directly implementable;
an invented lookalike is not). Most relevant:

- **shadcn:** button, card, tabs, dialog, alert-dialog, sheet, command (⌘K palette), tooltip, badge,
  separator, scroll-area, resizable, input, textarea, dropdown-menu, context-menu, sonner (toasts),
  skeleton, kbd, progress, collapsible, sidebar, empty, spinner, table.
- **Kibo [k]:** **kanban** (the QA board), **tree** (file explorer), **code-block** (syntax
  highlighted), snippet, dropzone (image attach), editor (rich task composer), pill, tags, status,
  relative-time, banner, avatar-stack, contribution-graph, dialog-stack, mini-calendar.
- **AI Elements [ae]:** task, plan, loader, shimmer, code-block, conversation/message (if a stream
  view needs them), confirmation, queue.

Custom surfaces (the phase timeline, the sync pipeline, the commit lane-graph) are yours to design —
on the tokens, matching the component vocabulary's density and radius language.

---

## 3 · Layout notes (what changed from v1 — design intent, not a copy spec)

1. **NEW: an icon-only permanent sidebar** (the floating rail, `--surface-sidebar`) replaces the old
   Roadmap/Repo header toggle. Destinations: **Roadmap · Repo · Kanban** (the new QA board), plus
   wherever you place refresh/help/settings affordances. Icon-only with tooltips; selected =
   inverted (white fill/dark icon); optional small badge (e.g. queued-task count on Kanban).
2. The right column remains the **terminal area** (tabs + xterm) on `--surface-input`, resizable
   splitter against the left content column.
3. The **title bar** carries: window controls, brand, the open-project tabs, degraded/checked
   status, and is the drag region.
4. Full-bleed surfaces: the Kanban board, the diff/code viewer. Reading surfaces (roadmap) get a
   comfortable measure, not edge-to-edge text.

---

## 4 · The decks (design ALL frames; cutting a frame requires saying so explicitly)

Global rule: every interactive element shows hover/focus/disabled; every list shows its empty,
loading, and error state where listed; all copy follows the vocabulary law. Use the REAL copy given
below (edit for clarity, never into jargon).

### Deck 1 — Picker & overlays

**F1 · Picker view.** The launch screen. Drag title bar + window controls. Hero: app mark,
"Chronicle", one-line sub ("Open a folder and see where its build stands."), two buttons: primary
"Open a project…" (⌘O) · secondary "New blank project". Below: "Recents" eyebrow + right-aligned
count ("4 projects").

**F2 · Recent project card — ALL states.** Card anatomy: mark tile · name · tilde path (mono) ·
2-line description · current-phase row (id chip `R-1` · phase name · status word) · progress bar +
"3 waiting" / "Clear" · "2h ago" · delete affordance on hover. States: default · hover (lift) ·
**missing folder** ("Folder missing" + a "Locate…" action — not a dead card) · **writing roadmap**
(neutral spinner + "Writing your roadmap…") · **all done** ("Everything on the plan is done", quiet
success) · **no roadmap yet** ("No roadmap yet · runs with Claude" pill) · delete-hover.

**F3 · Recents empty state.** Dashed-hairline card: "Nothing yet. Your first project will appear
here."

**F4 · Backdrop treatment.** The picker sits on `--surface-app`; if you give it atmosphere, keep it
monochrome, near-invisible, reduced-motion-safe (the old app used a faint animated water shader —
your call to keep, calm, or drop; say which).

**F5 · Command palette / switcher (⌘K).** shadcn Command in an overlay. Two groups: **"Open —
switch instantly"** (the already-open projects, with ⌘1–⌘9 kbd hints per row) and **"Recent —
open"**. Rows: mark tile · name · path (mono) · status **word** + state dot (never color-only).
Search field, highlighted row, **"No matches"** row, footer: "↵ open · esc close" as kbd chips +
"Open a project… ⌘O" / "New blank project…" rows.

**F6 · Confirm dialog.** Neutral variant + danger variant (red-tinted confirm button for
remove/discard). PLUS the two **live-process variants**: closing a project tab / a terminal whose
session is alive — honest copy: "This terminal is still running. Close it and stop the session?"
Buttons: "Keep it running" (secondary) / "Close and stop the session" (danger).

**F7 · New blank project dialog.** Icon tile, "New blank project", one-line explanation ("A folder
with history started, ready to build in."), "Project name" field, inline error state ("A folder with
this name already exists."), Cancel / Create.

**F8 · Toast.** Bottom-center pill on `--surface-overlay`: success (check glyph + "Copied
PROMPT.md · 4,120 characters") and error ("Couldn't publish · the online copy is newer") variants.

**F9 · Help / shortcuts overlay (⌘/).** Same anatomy as the palette. Groups: Projects (⌘1–9, ⌘K,
⌘O, ⌘W) · Panes (⌘J, ctrl-tab) · Terminal. kbd chips + plain labels.

### Deck 2 — Shell chrome & the sidebar

**F10 · The icon sidebar.** The permanent floating rail: Roadmap, Repo, **Kanban** icons (+ your
placement of refresh/help). States: selected (inverted), hover, focus; tooltip ("Roadmap ⌘J to
cycle"); a small numeric badge on Kanban when tasks are queued. Show collapsed width only — it never
expands.

**F11 · Shell title bar.** Window controls · brand mark · **project tabs**: name + close-on-hover;
active = clear selected treatment; a background tab with updates = a quiet attention treatment
(NOT a colored dot alone — pair with a tooltip/word); overflow: "+2 more" affordance when tabs
don't fit; max-width per tab. Right side: "Checked 20:14:32" (mono, tabular) OR the degraded state
("No roadmap yet") — plus anything you move here. The whole bar is the drag region.

**F12 · Roadmap consent card.** Replaces silent auto-start when a folder has no roadmap. One
sentence: "A Claude session will read this folder and write the roadmap — nothing else is changed."
Primary "Build it for me" · secondary "I'll run it myself" · tertiary "Use the basic view". Inline
agent picker: the two brand-logo buttons (Claude / Codex) with a "runs with" label.

**F13 · Roadmap building state.** Neutral spinner + "Writing your roadmap…" + progress track +
streaming log lines (mono, dim, the last 4–6) + a visible **Cancel** button that actually stops the
session. Variant: **">5 minutes"** — "Still running · view full log" link + Cancel stays.

**F14 · Roadmap warning banner.** Non-alarming hairline banner: "3 rules in this roadmap can't be
checked — statuses may be incomplete." + a "Rebuild the roadmap" chip. (kibo banner [k].)

### Deck 3 — Roadmap

**F15 · Current-state banner.** The hero of the roadmap: eyebrow "CURRENT STATE" · "R-1 · Missing
screens get drawn" (title) · one-line desc · status word ("in design") · "up next: EL-1 · The beauty
pass". States: normal · just-switched (a quiet emphasis moment) · waiting-on-human · **all-done**
("Everything on the plan is done" + success tone + A NEXT ACTION — e.g. "Add what's next in the
Kanban").

**F16 · Stale-roadmap alert.** "The plan documents changed since this roadmap was written." +
primary "Scan" button; scanning state ("Scanning…" disabled + neutral spinner).

**F17 · Manifest-problem cards.** One card anatomy, six variants: **part of another project**
("This folder is part of weave" + "Open weave") · **can't read the roadmap** (error tone,
the error line in mono, "Open the file" + "Run the scan again", + Retry) · **blank project** ("No
roadmap yet. This project is a blank page." + "Build roadmap") · **misplaced roadmap** ("Found a
roadmap inside docs/" + "Move it here") · **scan failed** (error line + "Try again" + "Use the basic
view") · **basic view** (an eyebrow marking "Basic view · files and history only").

**F18 · Project-history panel.** Section heading + right-aligned status ("2 saves waiting to
publish" / "everything published online" / "not tracked yet"). Inside: **the sync pipeline** — three
nodes "Edits on disk → Saved to history → Published online" with counts, states (active/blue-less —
use neutral/success/error treatments per DS), animated save/publish arrows; "Milestones reached"
tag chips (`phase-0` `phase-1`); changed-files list (mono, "new"/"edited" badges, "…and 3 more");
full-width "View details ›" button; **no-history variant** ("No history yet" + "Start keeping
history →").

**F19 · "What needs you" panel.** Rows: icon tile · title ("Publish 2 saves") · sub ("Saved to
history, not online yet.") · **a one-click primary action** ("Publish now") with the full command as
wrapped mono secondary detail (never truncated). Variants: highlighted (hi) row · roadmap-authored
custom actions = **copy-only** with a "review before running" treatment · empty state (success
check + "Nothing needs you right now.").

**F20 · Documents panel + doc chips.** "Always-on documents" heading; file chips (icon + name):
default (click = copy) · flash-on-copy · missing ("Not written yet", dashed) · paste chip ("→ Claude
Code" with a when-note) · ghost (future file, dashed, non-clickable).

**F21 · The phase rail.** Stage header (name + note + rule) then the timeline: connector line,
per-phase dot (done=success · **now=neutral pulse** · later=hairline), phase cards: id chip · name ·
status word · expand twisty. Expanded: description · step list · "You paste" chips · reference docs ·
full-width "View details ›". States: done · now · later · **window phase** (a dashed grouping) ·
just-completed (one quiet celebrate moment) · **fix-round phases** — the Kanban-generated "Bug fixes
· round 2" phase appears in this same rail with its docs attached and must read as belonging.

**F22 · Phase detail view.** Slides over the roadmap (breadcrumb "‹ Roadmap / R-1 · Missing screens
get drawn" + status + close). Sections: description · "5 steps" checklist rows · "You paste" chips ·
**Documents accordion** (row: twisty · human title · mono path · copy; open = rendered markdown on
the panel surface; loading + error states) · "Saves during this phase" (timeline rail: dot · hash
chip (mono) · avatar glyph · relative time · message; empty "No saves mention R-1 yet." + loading
"Looking…"). PLUS the audit's headline addition: **a "Start this phase" primary button** — copy
explains it opens a terminal, starts the agent, and copies the paste file.

### Deck 4 — Repo & history

**F23 · File tree (kibo tree [k]).** "EXPLORER · 2 roots" eyebrow head. Rows: chevron (dirs) ·
icon · name · git letter badge (M blue-less/neutral? — use the DS: modified/added/deleted must be a
letter + treatment, not color alone) · selected row (inset bar) · dir-with-changes tint · nested
guide lines · loading row · error row · empty-folder row ("empty"). Splitter handle against the
viewer.

**F24 · Code/diff viewer.** Open-file tabs (name + close, active bar). Empty state ("Select a file
to read it"). Code view: line-number gutter (mono, tabular, aria-hidden) + wrapped code on
`--surface-input` (kibo code-block [k] if it fits). Actions bar: path (mono) · **Contents / Diff**
toggle · "markdown · 214 lines" or "+12 −4" · "Copy contents". Diff view: sticky hunk headers,
add/del line treatments with old/new line numbers. **Freshness states (all):** "File changed on
disk — Reload" bar · read-error with Retry (error never cached as content) · image preview · "Binary
file" card · huge-file guard ("2.4 MB — open anyway").

**F25 · History pane (the git pane, vocabulary law applied).** Header: "‹ Roadmap / Project
history" + branch pill (mono) + close. Error banner (quiet, red text on hairline card). **Save
box:** message input + "Save to history" primary (disabled when empty; empty state "Nothing to
save · everything is recorded."). **"Ready to save"** section (rows: name · dir (mono) · skip
action on hover) + **"Changes"** section (folder-grouped rows, collapsible, include/skip/discard
hover actions, deleted files struck through). **Publish box:** status ("2 saves waiting to publish" /
"Everything is published" / "Not on GitHub yet" / "Never pushed") + "Bring down 3 newer" +
"Publish online" (honest: if it runs gh it shows progress; if it copies a command it says so).
**The commit graph:** SVG lanes (≤5, muted lane colours allowed as data), rows: subject · ref chips
(current branch emphasized; phase-id chips) · avatar glyph (agent = a star mark; human = initials) ·
hash (mono) · relative time; dim older rows; "Show more" link. **Skeleton loading state.**
**No-history full state:** "No history yet" + explanation + "Start keeping history".

### Deck 5 — Terminal & Kanban

**F26 · Terminal area.** Tab strip: tabs (name, dblclick-rename inline input state, dead tab =
"· ended" italic + quiet) · "+" new · right side: "START" eyebrow + the two agent brand-logo
buttons (bare logos, no containers). The xterm host sits on `--surface-input` (its ANSI palette is
already tokenized — design the frame/padding/scrollbar). Splitter against the left column.

**F27 · Kanban board (kibo kanban [k]) — NEW.** Full-bleed. Four columns: **Queued · In progress ·
Blocked · Completed** with counts. Column empty states ("Drop a task here" / for Queued: "Write down
a bug or an idea — ⌘N"). Drag affordance. A header row: board title ("Fixes & ideas"), "New task"
primary, and **"Ready to execute"** (see F30).

**F28 · Kanban task card.** Auto id chip (mono, `T-014`) · title · 2-line content preview · image
thumbnails (1–3 + "+2") · design-link chips · created relative-time. States: default · hover ·
dragging · selected · in a frozen (executing) round = quietly locked.

**F29 · Task composer / detail.** A sheet or dialog-stack [k]: title field · rich content (kibo
editor [k]) · image dropzone [k] ("Drop screenshots here") · design-link field (+ chip list) ·
column picker · Delete/Archive. Editing an existing task shows its id chip + created/updated meta.

**F30 · "Ready to execute" flow.** Three states: (a) the button + a pre-flight summary ("6 queued
tasks become a fix plan for Claude Code — two files are written into the project"); (b) generating —
background-session progress like F13 (neutral spinner + streamed lines + Cancel); (c) done — the
round is frozen: "Round 2 · 6 tasks → bug fixes" + two doc chips (`phase_2_fixes_plan.md`,
`phase_2_fixes_prompt.md`) + "It's on the roadmap ›" link. PLUS the explainer when a round is
already executing: "Round 1 is executing — new tasks start round 2."

---

## 5 · Acceptance (how this batch is judged)

- Every frame F1–F30 present (or explicitly cut with a reason); every listed state per frame.
- Tokens only — no raw hex outside the DS, no default-library greys, chromatic colour only for
  state/marks/brand-logos as specified.
- Named components from §2 wherever one fits (name-parity with the repo).
- The vocabulary law holds on every string. AA contrast on every text/surface pair. Status never
  color-only. Focus visible everywhere. Reduced-motion stated for every animation.
- Both themes: dark default; light via the same tokens (design dark first; show light for at least
  F1, F11+F15, F25, F27 to prove the ramp).
