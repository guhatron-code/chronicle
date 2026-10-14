# Claude Design prompt — Chronicle Runs and the fluid agent pane (Deck 10)

You are designing one feature for Chronicle's chat pane, **Runs** (a plan split into lanes of
work that run at once, each checked before it counts), and the motion and speed vocabulary of
the pane it lives in. Everything renders inside the shipped Chronicle app — match it exactly.
Spec: `docs/superpowers/specs/2026-10-14-agent-orchestrator-design.md`.

## Context you must honor

- **The product**: Chronicle is a calm, local-first macOS studio for a NON-developer tracking
  AI-driven builds. Register: plain-spoken, honest, one glance = one next step. Vocabulary law:
  save/publish/undo — never commit/push/revert; a lane "finished", "is being checked", "needs
  you"; never worktree/merge/rebase/CI in a headline. Sentence case. Errors say what happened
  and the one thing to do next.
- **The design system**: the Weave DS bridge already in the app — dark default,
  `[data-theme="light"]` first-class, tokens only, radius sm 6 / md 8 / lg 10, buttons sm 28 /
  md 33 / lg 36, mono for paths, ids and numbers, 2px scrollbars, FLAT sections with dividers
  (cards only for alerts and status rows). Reuse the atoms: `StateWord` (dot + word, never
  color-only), `BtnPrimary`/`BtnSecondary`, `Eyebrow`, `Kbd`, `Spinner`, the existing chat
  thread rows, the subagent tree card (`SubagentCard`), the guard entry, the usage-limit card,
  the notes pane's `RoundCard`.
- **What a run is**: the user asks for a round (from queued notes, from a plan, or from a
  prompt). Chronicle plans it, splits it into up to three **lanes** that each own their own
  files, runs them at the same time in the project, checks each lane's work (the project's own
  tests, then a review), saves it, and closes the round itself. The user is only asked when an
  item cannot be done as written, or when the agent tried to publish (which Chronicle refuses).
  Cost is shown, never gated. The whole point is **hands off**: the card must make "nothing
  needs you" feel safe, and "one thing needs you" impossible to miss.
- **Small decisions**: a tiny decision model answers the agent's small questions (may this
  command run, is this item really impossible, which lane broke the build). Each answer shows as
  a quiet guard-style line with the option taken and its confidence. Design it as evidence the
  user can audit later, not as a thing to react to.

## Deck 10 — frames (design every state listed; cuts must be explicit)

**R1 · The run card, working (design this first).** In the chat thread, one card. Header: the
run's name ("Round 10 · 7 items"), a `StateWord` ("running"), lanes count, cost in mono
("$1.84"), elapsed. Body: one row per lane — a short title, its items as chips, a `StateWord`
(design all: **waiting** · **working** · **being checked** · **fixing** · **finished** ·
**needs you** · **stopped**), attempt as quiet mono ("try 2 of 3") only when > 1, the lane's
cost, and a chevron to open it. Show three lanes working and one being checked. Footer: a quiet
"Stop" and the plain sentence that says nothing needs you ("Nothing needs you. Chronicle will
save each lane as it passes."). Design dark and light.

**R2 · A lane opened.** The lane's own thread: its title, the items, the files it owns (mono,
collapsible), then the familiar transcript rows and the subagent tree card, then a **gate row**:
the project's checks as a short list with pass marks and durations in mono, the review as one
line ("Reviewed: looks right" or "Reviewed: 2 things to fix", expandable to the findings with
file and line in mono). A "Back to the run" affordance. Match the design pane's critique card
where it already solved this.

**R3 · A gate failing, then fixing, then the close — one sequence.** Four stacked states of the
same lane row and gate row: (1) checks fail — the failing check named, the first lines of its
output in a small mono block, state **fixing**; (2) the fix pass passing; (3) the run-level
**final check** row that appears once every lane finished ("Checking everything together");
(4) the closed run: header `StateWord` **done**, the sentence ("Saved as round 10. 7 items
done."), final cost and time, the card quietly settled. Also design the **leak** notice: a lane
changed a file it does not own — a one-line amber notice on its row ("Also changed
`src/x.ts`, which lane B owns — left unsaved for you"), never a modal.

**R4 · Needs you.** Two needs-you rows inside the card: (a) a parked item — the item's title,
the lane's one-sentence reason, the decision model's quiet line ("likely impossible as written
· 0.86"), and two buttons ("Rewrite the item", "Skip it"); (b) a refused publish — "The agent
tried to publish. Chronicle doesn't publish for you." with one secondary ("Open the lane").
The card header's `StateWord` is **needs you** and the footer sentence changes to the one thing
to do. Plus the notes pane's `RoundCard` mirroring the run: its state word, "3 lanes", cost.

**R5 · The pane in motion.** A board that is a motion spec: one easing curve and two durations
(fast for state words and chips, slow for height and layout), named in the DS tokens. Show
frames of: a card growing when output lands (height eases, content fades in), a subagent tree
expanding (children slide and fade, parent chevron rotates), a `StateWord` changing (cross-fade,
dot colour eases), a new thread row appearing (the existing `.wv-enter` kept). And the
**reduced-motion** variant: everything instant, nothing lost.

**R6 · Starting a session.** The pane's status word through a start: **warming** (the session
starts when the project opens, before the pane is shown), **ready**, and the cold path
**starting** when nothing was warm. Plus two new rows in Setup & health: "The agent's
connector" (installing · ready · couldn't finish) and "Decisions" — a key row that says in plain
words what leaves the Mac ("Only the agent's small questions: a command's text, a line from the
plan, a failing check's output. Never your files."), with a paste field, "Saved in your
Keychain", and the honest no-key state ("Without a key Chronicle answers these with Claude.
Runs still work.").

## Output

Boards as `design/comps/runs/<NN>-<Name>.dc.html`, one board per frame above, dark and light
where stated, built from the `_ds` bridge like `design/comps/design-pane/`. Cuts, and anything
the spec says that a board could not honour, listed in a `NOTES.md` beside them.
