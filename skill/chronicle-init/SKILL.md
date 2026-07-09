---
name: chronicle-init
description: Write (or refresh) a chronicle.json build-roadmap manifest for the current project so the Chronicle desktop app can show live phase status, exact paste-this-file steps, and what-needs-you actions. Use when the user asks to set up Chronicle, run /chronicle-init, or says the Chronicle roadmap is stale/missing/wrong.
---

# chronicle-init — write the roadmap file Chronicle reads

Chronicle is a desktop app that shows a non-developer where a multi-phase, prompt-driven
build stands: which phases are done, which one is *now*, the exact file to paste into which
tool at each step, and what needs the human. It reads **one file — `chronicle.json` at the
project root** — plus live git/filesystem facts. Your job is to write that file so the derived
state is **as accurate as a hand-built app for this specific project**.

This is an evidence task, not a formatting task. The manifest encodes *rules* that the app
re-evaluates every few seconds; a wrong rule silently shows the user a wrong roadmap forever.
Work in this order and do not skip the verification step.

## 1 · Read the plan the way the build agent would

Find the project's authoritative plan: a PLAN.md, a canon/ folder, a phases doc, a report
file that logs phase closures. Read it fully. Also read:

- `git log --oneline -30`, `git tag`, `git status`, `git worktree list` — what has actually happened.
- Any per-phase report/progress files (these are usually the best status source).
- Any "you run this prompt" files — these become `paste` rows.

If the plan lives in a *different folder* than the repo (a prompt-set directory), that folder
becomes an extra root with an alias (see `roots.extra`). **Never** read files the project's own
laws forbid reading (e.g. a design prompt marked "the build agent never reads this") — you may
still *list* such a file as a paste row for the human; listing is not reading.

## 2 · Author the manifest

Full schema: [SCHEMA.md](SCHEMA.md). Two worked, production-verified examples:
[examples/weave.chronicle.json](examples/weave.chronicle.json) (single root, report-file
status, dispatch windows, custom actions) and
[examples/loupe.chronicle.json](examples/loupe.chronicle.json) (dual root with `@canon`
alias, progress-file + commit-subject status, a gate label).

Principles that make the difference between accurate and decorative:

- **Status rules must point at ground truth**, in order of preference: git tags → per-phase
  report/progress files → commit subjects (regex, `(?i)` for case). Give each phase multiple
  `done_when` alternatives when the project records closure in more than one way.
- **Anchor `file_matches` patterns tightly.** A loose pattern will match the plan *talking
  about* the marker (e.g. prose saying "gains `Status: RUN` when spent" matching a
  `Status: RUN` rule). Require the literal punctuation of the real marker
  (`Status: \\*\\*RUN`), or anchor to line starts with `(?m)^`.
- **`current_labels`** turn the bare "now" into what the user should actually do
  ("with the designer", "run it now", "waiting on the handoff bundle"). Add one whenever the
  plan distinguishes dispatched/blocked/ready sub-states.
- **`paste` rows are the product.** For every phase name the exact file the human pastes and
  the destination tool (`"Claude Code"`, `"Claude Design"`, …), with a plain-English `when`.
  A file that doesn't exist yet gets `label` instead of `path` (a ghost chip).
- **Write every `desc` and `items` entry for a non-developer.** Plain sentences, no jargon,
  no internal codenames without a gloss. `<b>` is the only markup that renders.
- **`generatedFrom`**: list the plan documents this manifest was derived from, each with its
  current sha256 (`shasum -a 256`). Chronicle uses these to show a "plan changed — re-run
  /chronicle-init" notice. Always recompute at write time.
- **`actions`**: encode project-specific "needs the human" rules (leftover worktree, a
  decision due, a batch ready to run). Generic git nags (unpushed, behind, wrong branch) are
  built in — don't duplicate them; do set `workBranch` if the project must stay on one branch.

## 3 · Verify before you save (mandatory)

An unverified manifest is worse than none. Check all of these:

1. **Paths exist**: every `paste.path`, `docs.path`, `spine.path`, and rule path resolves
   from its root (`@alias/…` from that extra root). A deliberately-future file must use
   `label`, or be acknowledged as intentionally missing ("not written yet" chip).
2. **Rules fire correctly *today***: for each phase, evaluate every `done_when` /
   `current_labels.when` by hand against the real repo (grep the file, check the tag, read
   the log) and compare with what the plan says the true state is. Every done phase must
   derive done; the current phase must derive now with the right label; nothing later may
   derive done. If the Chronicle binary is available, run
   `chronicle --derive <project-dir>` and check the JSON instead of hand-evaluating.
3. **Ordering**: phases appear in true execution order — "now" is computed as the first
   non-done phase, so a misplaced phase corrupts the banner.
4. **JSON is valid** (`python3 -m json.tool chronicle.json`).

Report the derived state to the user in one line per stage ("R-0 done · R-1 now (with the
designer) · rest later") so they can sanity-check it against reality.

## 4 · Refresh mode

If a `chronicle.json` already exists (stale hashes, or the user says the roadmap is wrong):
diff the plan documents against the manifest, update only what changed (phases added/renamed,
new status markers, new paste files), recompute all `generatedFrom` hashes, and re-verify
(step 3). Never drop existing phases the plan still contains.

## Copy rules

- Sentence case everywhere: every `desc`, `items` entry, `when`, `note`, `text`, and
  `description` starts with a capital letter.
- **Never use an em dash (—).** Use a middot (` · `) for label-style separators or split
  into two sentences.
- Status `label`s stay short and lowercase in the file (the app renders them uppercase).

## Where the file goes (hard rule)

Write `chronicle.json` into the **current working directory** of the session: the folder the
user opened in Chronicle. Never into a sub-folder, even when the git repo is a sub-folder
(declare it via `roots.repo` instead). The app reads only `<opened folder>/chronicle.json`;
a manifest saved anywhere else is invisible.
