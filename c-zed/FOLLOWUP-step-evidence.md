# Queued follow-up — per-step evidence (live step ticking)

*Approved by the operator 2026-07-16. Builds AFTER Z-1 lands (it touches the manifest
contract the agent work leans on — one contract migration in flight at a time).*

## What

Steps inside a phase currently render binary (all-todo until the phase's own
`done_when` fires) because `items` are prose strings with no evidence attached.
This change gives steps the same discipline phases have:

1. **Schema (additive, stays `chronicleVersion: 1`)**: an `items` entry may be a
   string (unchanged) OR `{ "label": string, "done_when": [rules] }` using the
   existing rule vocabulary. Unknown never satisfies; validation warns on typos.
2. **Derive**: per-item rules evaluate exactly like phase rules (same jail, same
   caps); `statuses[]` gains per-step states; the phase card shows "3 of 5 steps",
   the detail shows mixed done/todo.
3. **Skill**: chronicle-init authors per-step rules ONLY where the plan actually
   records per-step evidence (checkbox lines in a progress file, per-step report
   markers). No evidence trail → the item stays a plain string. The verify step
   hand-evaluates every step rule like it already does phase rules.

## The agreed risk plan (non-negotiable parts)

- **Reader first, writer second.** Ship the app that tolerates BOTH item shapes and
  let it reach every machine (OTA) BEFORE the self-installing skill starts authoring
  object items. A 0.2.x app must never meet an object item.
- **Per-derive file cache.** Each rule file is read once per derive pass and shared
  across all rules (phase + step) — cancels the poll-cost growth; do it in the same
  change.
- **Force-display law.** A phase whose own `done_when` fired renders ALL its steps
  done regardless of step-rule results — "2 of 5 steps but Done" must be impossible.
- **Anchoring law applies with extra force**: step markers must match literal
  punctuation / line starts; the validator's exactly-one-key + regex checks cover
  step rules identically.

## Sequencing

Z-1 (ACP client) → this → resumes the Zed update phases. Estimated as one
contained release: schema tolerance + derive + cache + UI in one cut, the skill
update in the NEXT cut after the reader has propagated.
