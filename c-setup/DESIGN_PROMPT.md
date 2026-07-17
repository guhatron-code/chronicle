# Claude Design prompt — Chronicle Setup & Help (the setup update, Deck 8)

You are designing two app-level surfaces for Chronicle — a **Setup screen**
(getting a non-developer ready) and a **Help screen** (task recipes + a plain
glossary) — plus the small shell affordances that reach them. Everything renders
inside the shipped Chronicle app (v0.3) — match it exactly.

## Context you must honor

- **The product**: Chronicle is a calm, local-first macOS studio for a
  NON-developer tracking AI-driven builds. Register: plain-spoken, honest, one
  glance = one next step. Vocabulary law: save/publish/undo — never
  commit/push/revert, and on THESE screens especially never PATH/CLI/npm/git/
  terminal-jargon in a headline. Sentence case for every statement. Errors say
  what happened and the one thing to do next, no apologies.
- **The design system**: the Weave DS bridge already in the app — dark default,
  `[data-theme="light"]` first-class, tokens only (no raw hex anywhere), radius
  scale sm 6 / md 8 / lg 10, button scale sm 28 / md 33 / lg 36, mono for
  paths/ids/numeric metadata, 2px scrollbars, FLAT sections separated by
  dividers (cards only for alerts + status rows), chips are one-line pills.
  Reuse the existing atoms, do not reinvent: `StateWord` (dot + word, never
  color-only), `BtnPrimary`/`BtnSecondary`, `Eyebrow`, `Kbd`, `Spinner`, the
  Claude starburst + Codex gradient marks, the traffic lights, the full-window
  picker chrome (the setup gate composes over the same title-bar row).
- **What the setup is**: Chronicle installing, for a person who has never used a
  terminal, the five things it needs — the AI (Claude Code) + signing in, its
  engine (Node), their online home (GitHub) + signing in, and extra skills — all
  without admin and without them typing a command. Plus the one repair that
  fixes "I typed the AI's name in the terminal and nothing happened."

## Deck 8 — frames (design every state listed; cuts must be explicit)

**G1 · The setup screen — the checklist (design this first).** A calm,
full-window screen titled in plain words ("Let's get Chronicle ready"). A short
reassuring line ("This sets up the tools Chronicle needs. It won't touch
anything else, and you won't need to type any commands."). Then a vertical
checklist — one row per prerequisite, in order:
- "The AI that does the work" (Claude Code) · "Sign in to Claude" · "The engine
  the AI runs on" (Node) · "Make the AI work in the terminal" (the PATH repair)
  · "Your projects' online home" (GitHub) + "Sign in to GitHub" · "Extra skills
  for the AI" (superpowers).
Each row: the plain name, a one-line "what this is for" in `--text-dim`, a
`StateWord` (design all: **checking** · **ready** · **needs you** ·
**installing** with a % and a thin progress bar · **couldn't finish**), and ONE
action button on the right (Install · Fix this · Sign in · Try again · nothing
when ready). Design the header summary in both states: "3 of 6 ready" and the
all-green **"You're all set"** celebration (quiet — a check, a sentence, and a
primary "Open a project"). Design the top **"Set everything up for me"** primary
that runs the whole chain — and its running state (the row it's on pulses, the
rest wait).

**G2 · A row mid-install + the honest failure.** The installing row: `StateWord`
"installing", a thin progress bar, a mono secondary "3.1 of 42 MB", and a quiet
Cancel. The failure variant: "couldn't finish", a plain sentence ("Couldn't
download it — check your internet connection and try again."), and a "Try again"
button. NO raw error codes in the headline; if a technical detail shows at all
it's small mono secondary.

**G3 · The terminal-PATH repair (the star fix).** The row for "Make the AI work
in the terminal." Its need state explains the problem in the user's words: "The
AI is installed, but the terminal can't find it yet. Chronicle can fix that."
The action is one button ("Fix it"). Design the AFTER state: honest that it
takes effect in a new terminal — "Fixed. Open a new terminal and it'll work.
Want me to open one that's ready?" with a secondary "Open a terminal."

**G4 · The two sign-in hand-offs.** The "Sign in to Claude" and "Sign in to
GitHub" rows open a terminal for the sign-in. Design: the row's action ("Sign
in"), and the waiting treatment while the sign-in runs in a terminal tab (a
spinner + "Waiting for you to finish signing in…" + the mono tab name, exactly
like the agent pane's needs-login waiting state — match it). Then the row flips
to "ready" on its own when the sign-in finishes.

**G5 · The smart gate vs. the health console.** Two entries into the SAME
screen: (a) the first-launch / missing-prerequisite **gate** — full-window,
warm, "Let's get you set up" framing, appears over the picker; (b) the
always-reachable **"Setup & health"** console — the same checklist, now framed
as a re-check/repair tool a user opens when something broke later (all rows
likely green, with a quiet "Re-check" affordance). Design both headers; the body
checklist is shared.

**G6 · Reaching setup + help from the shell.** Design the rail's bottom cluster
gaining a **Help** destination and a **Setup & health** entry beside the
existing refresh/shortcuts affordances (rail icons on the radius-8 scale, the
one selected signal). Show where they sit relative to Roadmap/Repo/Kanban and
the refresh/help glyphs.

**G7 · The help screen — task recipes.** A searchable, full-window (or large
centered overlay) Help surface. The top is a search field ("Search help…").
Below, **"How do I…" recipe cards** in plain words, each a short titled
walkthrough that ends by pointing at the real UI. Design the card (title, 2–4
numbered plain-language steps, a "Show me" link that opens the relevant surface)
and the grid of them. Recipes to draw: "Publish my project online" · "Undo what
the agent changed" · "Start a phase with the agent" · "Understand a red mark in
'what needs you'" · "Bring down changes from another computer" · "Start a fresh
project" · "Sign back in when the agent says it needs a login."

**G8 · The help screen — the plain glossary + shortcuts.** The other half: a
**glossary** that translates every term the app uses — design the term row (the
word, its plain meaning in one line, optionally the technical name in small
mono). Terms: save · publish · bring down · the agent · a phase · a round · a
checkpoint · "works freely" · "what needs you" · a workspace. And a **shortcuts**
section (the current ⌘/ overlay content, folded in here — ⌘K, ⌘J, ⌥⌘1/2/3, etc.)
so Help is the one place to go when stuck. Design search matching across recipes
+ glossary (a result list with both kinds).

## Addendum — sync law: match the shipped app (v0.3)

Bake in the shipped conventions wherever a frame touches them; flag any
deliberate divergence in a note rather than diverging silently.
- Buttons ride ONE size scale (sm 28 · md 33 · lg 36); primary AND secondary
  default to md; paired rows share one baseline; disabled primary is the quiet
  filled state, never a ghosted enabled button.
- `StateWord` keeps its dot pinned and truncates its label; the "working/waiting"
  dot pulses; spinners are the 1.5px ring. Under reduced motion the WORDS carry
  the state — every spinner/pulse/progress freezes.
- The needs-login waiting treatment already exists in the agent pane (spinner +
  "Waiting…" + mono tab chip) — the two sign-in hand-offs (G4) must match it 1:1.
- All popups/overlays center to the app window; the full-window setup gate sits
  under the same 44px title-bar row as the picker (traffic lights left).
- Scrollbars are literally 2px. Mono for the download-size/technical secondary.
- The only chroma remains the state palette + the two agent marks. No new colors.

## Deliverable

One deck (`.dc.html`, same format as Decks 1–7) with every frame + state above,
1:1 buildable: real paddings, tokens by name, exact type sizes on the app's
scale (11.5/12.5/13/15), light AND dark. If any frame conflicts with the shipped
app's conventions, the app's conventions win — flag the conflict in a note
rather than diverging silently. Above all: read every word on these two screens
as the non-developer will — if a line needs a technical dictionary, it's wrong.
