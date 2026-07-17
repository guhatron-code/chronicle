# The setup update — progress

One entry per phase, appended when the phase's verification is green.

## S-0 · Comps

**What landed** — Deck 8 (`Chronicle 8 · Setup and Help.dc.html`) returned from
Claude Design and is accepted. Coverage is 1:1 with `DESIGN_PROMPT.md`: G1 the
setup checklist (every StateWord state — checking · ready · needs you ·
installing % · couldn't finish — plus the "3 of 6 ready" header, the all-green
celebration, and the "Set everything up for me" running state), G2 mid-install +
honest failure, G3 the terminal-access repair (the star fix, with the honest
"open a new terminal" after-state), G4 the two sign-in hand-offs (matched 1:1 to
the agent pane's needs-login waiting treatment), G5 the smart gate vs. the
always-reachable health console (shared body), G6 the rail gaining Help + Setup
& health, G7 the "How do I…" recipes with the "Show me" landing, G8 the plain
glossary + folded-in shortcuts + cross-search. Register is clean throughout — no
PATH/CLI/npm/git in any headline. Copied into `design/comps/`.

**Reconcile during S-3** — the comp's shortcuts section lists `⌘J` as "show or
hide the terminal" and a `⌘R`; the shipped bindings are `⌘J` = cycle panes and
there is no `⌘R`. The help screen will show the ACTUAL shipped shortcuts, not
the comp's placeholders.

**Verified** — visual read against DESIGN_PROMPT.md; all eight frames + the
light-theme proof present.

**Commit** — (next docs commit)
