# Chronicle v2 — the accepted design handoff (implementation contract)

> The comp set lives at `/Users/tuneerguha/Downloads/chronicle-v2-redesign/project/` —
> six `Chronicle N · *.dc.html` decks + `_ds/` tokens/fonts. The decks are the visual
> source of truth; this document (authored by the operator with the batch) is the binding
> behavioral/product contract. Gap-checked against frames F1–F30 + L1–L6 on 2026-07-10:
> complete, zero gaps. Requirement: **1:1 visual and behavioral match**.

## Reading the decks
- Decks 1–5 = component-level specs (every frame with EVERY listed state as separate
  specimens; a "Hover" specimen is the real `:hover` in the app). Deck 6 = page-level
  (L1–L6, full screens in the shell at 1400px). Component frames win for anatomy/states;
  Deck 6 wins for placement/column structure/chrome.
- Inline styles ARE the spec — read exact values from the source. `_ds/` holds the token
  stylesheet. Do not ship or copy the comp markup; recreate it in React.

## Binding rules (condensed — the full pasted handoff is authoritative; see git history)
1. **Vocabulary law** on every string: Ready to save / include / skip / save / publish /
   bring down; raw git only as small mono secondary detail; buttons say what actually
   happens; "Show more" never "Show all"; errors say what+how-to-fix; exact copy from the
   frames.
2. **Tokens only** (§3 table = `_ds_bundle.css`); monochrome law — chroma only in
   `--state-*`, `--mark-*`, and the two agent logos (Claude starburst #D97757, Codex tile
   `linear-gradient(135deg,#6ba6ff,#2563eb)`). Numbers never state-coloured. Dark default,
   light first-class via `data-theme`.
3. **De-boxing (post-review, overrides older instinct):** one flat surface — shell panes
   separated by hairline `--divider` lines, NO pane backgrounds/islands/gaps, flush rail;
   borders only on interactive controls; passive chips/badges = `--fill-subtle` + radius,
   never bordered; list groups = `--fill-subtle` + `--divider-faint` separators, no outer
   border; kanban columns are open lanes (drop-well only during drag); log panes on
   `--surface-input`, radius 8, no border.
4. **Shell:** frameless ~11px window, own mono window controls (12px circles); 44px title
   bar = drag region (controls · brand · project tabs · "+" · Checked HH:MM:SS mono /
   degraded status). Tabs: active = fill-hover+strong border+mark dot; updates = "updated"
   word badge; overflow "+2 more"; 180px max. Rail 52px flush, divider right edge:
   Roadmap/Repo/Kanban top, refresh+help bottom; 30×30 secondary buttons, selected =
   inverted; kanban queue-count badge; tooltips; NO settings gear (⌘, app menu). Terminal
   column right of a 7px splitter (2×34 handle), persists across Roadmap/Repo (never
   unmounts), absent on Kanban (full-bleed) and Picker; splitter remembered per project.
   Keys: ⌘J cycle panes · ctrl-tab jump · ⌘1–9 projects · ⌘K palette · ⌘O open · ⌘W close
   (live-session F6 confirm) · ⌘T new terminal · ⌘L focus terminal · ⌘/ shortcuts · ⌘N new
   task (Kanban).
5. **A11y (AA):** real buttons + double focus ring everywhere; ≥4.5:1 (never below
   --text-dimmer; dimmer only eyebrows/timestamps/disabled); status never colour-only;
   reduced-motion freezes (not removes) all motion; gutters aria-hidden; icon buttons carry
   the aria-labels written in the frames.
6. **State:** derived from disk/git on interval + FS events; "Checked HH:MM:SS" = last
   successful check; running = neutral grey never success-green; frozen rounds lock tasks;
   fix rounds surface as **FX-N** phases in the roadmap rail; splitter/tabs/recents persist
   per project.

## Frame index
- Deck 1 (Picker): F1 (+light) picker/L6 · F2 recent card ×7 · F3 empty · F4 static radial
  vignette backdrop (v1 water shader deliberately dropped) · F5 ⌘K palette (+no-matches) ·
  F6 confirms ×4 (incl. live-process pair) · F7 new-project (+error) · F8 toasts · F9 ⌘/.
- Deck 2 (Shell): composite · F10 rail states · F11 title bar (+degraded) · F12 consent ·
  F13 building (+>5min "View full log" → terminal tab) · F14 warning banner.
- Deck 3 (Roadmap): F15 banner ×4 · F16 stale (+scanning) · F17 problems ×6 · F18 history
  panel+pipeline · F19 needs-you · F20 doc chips · F21 phase rail (incl. FX rounds) · F22
  phase detail (2-col, saves timeline) · F11+F15 light.
- Deck 4 (Repo): F23 tree (+history button → L4) · F24 viewer + 5 freshness states ·
  F25 history pane + variants + skeleton + no-history (+light).
- Deck 5: F26 terminal · F27 kanban (+light) · F28 task card ×5 · F29 composer · F30
  ready-to-execute ×4.
- Deck 6: L1 Roadmap · L2 Phase detail · L3 Repo · L4 History · L5 Kanban · L6 Picker.

## Known open items (do not invent)
- No settings surface designed (menu-only, ⌘,) — flag if needed.
- Picker "Writing your roadmap…" card has no cancel; cancel lives in F13.
- Deck 6 title bars are simplified; F11 is canonical tab anatomy.

## Acceptance (before any slice is called done)
Visual diff against the deck at the same size; all frames+states reachable; zero hard-coded
colours; both themes (light proofs: F1, F11+F15, F25, F27); vocabulary grep (commit, push,
pull, stage, "Show all" absent from headlines/buttons); de-boxing rules hold; terminal
persistence rules hold; every navigation edge works; reduced-motion frozen-not-removed;
running=neutral.
