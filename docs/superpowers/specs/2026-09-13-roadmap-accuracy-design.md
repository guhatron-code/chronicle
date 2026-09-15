# Roadmap accuracy · design

Date: 2026-09-13. Status: approved in conversation, awaiting spec review.

## The problem

Chronicle's promise is "the user always trusts the roadmap". Today the roadmap for this
repo says the current phase is "M-1 · The slash menu · being built now", with M-2, AA and
SE still to come. In reality 0.6, 0.7, 0.8.0 and 0.8.1 shipped after all of those, and the
per-step-evidence phase (SE) was recorded as done in the journal on 2026-07-29 and now
derives as "later" again.

Three mechanisms produce the wrong picture. They apply to every project, not only this one.

1. **Evidence decays.** The `commit_subject` rule searches only the newest 200 commits
   across all branches. Once a project passes 200 commits after the proving commit, the
   phase silently un-finishes. This repo has 385 commits; the window now starts on
   2026-07-17.
2. **Rules are proxies guessed once.** The chronicle-init agent writes a regex for a commit
   subject or a progress-file heading it expects to appear. If the executing agent words
   things differently the rule never fires (M-1's "slash menu" pattern matches no commit in
   the whole history), and a `file_exists` label stays true forever once the file lands.
3. **The manifest goes stale.** It is hand-written and nothing prompts a refresh. Four
   specs and three releases have happened since the last stage in it was written.

Decisions taken in the brainstorm: fix both "never regress" and "never stale"; a phase is
proven done by a marker the executing agent leaves (A) and, independently, latched by the
app once it derives done (B); the manifest is kept current by detection plus a one-click
agent refresh with the user reviewing the diff, never by the app or a mid-task agent editing
it on its own.

## Design

### 1 · Evidence that cannot decay

`Ctx::build` collects commit subjects with `git log --all --format=%s` and no `-n` bound.
One line per commit; a fifty-thousand-commit repo is a few megabytes read once per scan,
and the scan already spawns git several times. `SCHEMA.md` drops the "last 200" promise
and says "any commit on any branch".

### 2 · The phase marker

A new source of truth that needs no rule in the manifest. A phase with id `X` is done
when any commit on any branch carries the git trailer

```
Chronicle-Phase: X done
```

Collection: one extra git call per scan,
`git log --all --format=%H%x00%(trailers:key=Chronicle-Phase,valueonly,separator=%x1f)`,
parsed into a map of phase id → proving commit hash. A commit may carry several
trailers (several phases). The value is `<id> done`; anything else is ignored. Ids are
matched exactly, case-sensitively, against manifest phase ids.

`derive_statuses` treats a marker as satisfying the phase's `done_when` (OR-ed in before
the rules), for pool and window phases too, since a marker is a stronger statement than
any rule. A phase with `"status": null` (pool) that gains a marker becomes done.

Who writes the marker. Every prompt Chronicle generates or the init skill writes ends
with one instruction, verbatim:

> When the work above is complete and verified, make the final commit with this trailer
> line at the end of the message: `Chronicle-Phase: <id> done`. If the work is already
> committed, add an empty commit (`git commit --allow-empty`) carrying the trailer.

- `skill/chronicle-init/SKILL.md`: the paste prompt files the skill writes carry the
  instruction with the phase's id filled in. The skill also stops inventing
  `commit_subject` rules for future phases: for a phase whose prompt Chronicle owns, the
  marker is the rule, and `done_when` may be omitted.
- `FIXES_PROMPT_HEAD` (round prompts written from the notes pane): the executor is told
  to add `Chronicle-Phase: round-<n> done` on its final commit. Round overlay phases keep
  their note-status truth as the live signal; the marker additionally latches them (§3).

Closing an old phase whose rule never matched is one empty commit by the user or their
agent; the phase detail page shows the exact command for the current phase in its
existing "paste" area ("Mark done with a commit").

### 3 · The ledger, so done never regresses

File: `.chronicle/roadmap-ledger.json`, written by the app only.

```json
{
  "version": 1,
  "done": {
    "SE": { "by": "commit_subject", "proof": "1d75d57", "at": "2026-07-29T10:22:32Z" },
    "M-1": { "by": "marker", "proof": "f8a0e01", "at": "2026-09-13T09:01:00Z" }
  }
}
```

- `by` is `marker`, the condition key that fired (`tag`, `commit_subject`, `file_exists`,
  `file_matches`, `file_glob`, `worktree_branch`), or `user` (the "mark done" override,
  §5). `proof` is the commit hash for `marker` and `commit_subject`, the tag name for
  `tag`, the path for the file rules, the branch for `worktree_branch`, empty for `user`.
- Order of truth per phase: marker → ledger → rules. The first that says done wins; the
  derive output reports which (`proof` field on each status), and the CLI prints it.
- Write: on any scan where a phase derives done and the ledger lacks it, append the entry
  and write the file atomically (temp + rename). Nothing else in the file is touched.
- Remove: a "Mark not done" action on the phase detail page deletes the entry. The rules
  and marker are still evaluated next scan, so a phase with a live proof comes straight
  back; the action is for rules that fired wrongly, and its confirmation copy says so.
- Corrupt file: set aside as `roadmap-ledger.json.bad` and start empty, the same as the
  Web tabs file. Surfaced as a needs-you row ("The done ledger was unreadable and set
  aside").
- Not gitignored by the app; whether it is committed is the user's call. The marker in git
  history is the cross-machine truth; the ledger is the per-checkout guarantee.

### 4 · The roadmap-is-behind detector

Each scan compares the manifest with the repo on three counts and yields one needs-you
row per finding, grouped under one action:

1. **Source docs changed.** A `generatedFrom` entry whose current sha256 differs. Row:
   "*PRODUCT.md changed since the roadmap was written*".
2. **Newer plans exist.** Files under `docs/superpowers/specs` and `docs/superpowers/plans`
   (and any directory listed in a new optional manifest key `planDirs`) whose mtime is
   newer than the manifest's mtime and whose path appears nowhere in the manifest. Row:
   "*2026-09-09-notes-design.md is not on the roadmap*". Capped at five rows, then
   "*and N more*".
3. **Newer releases exist.** The highest semver git tag is greater than the highest semver
   tag mentioned anywhere in the manifest. Row: "*v0.8.1 shipped, the roadmap ends at
   v0.5.1*".

Action, shared by all rows: **Bring the roadmap up to date**. It calls
`startRoadmapRefreshInPane(dir, findings)` (a sibling of `startRoundInPane`), which
opens the agent pane and sends one prompt: invoke the chronicle-init skill in refresh
mode, here is what changed (the file list and tag), update only what changed, never drop
phases, then stop. The agent edits `chronicle.json`; the file watcher re-derives on save;
the user reviews the diff in the Repo pane. If the skill is not installed the row says
so and points at Setup, which already installs it.

Suppression: a "Not now" on the row records the manifest mtime plus the finding set hash
in `localStorage`; the rows return when a new finding appears.

### 5 · User override

Phase detail gains two quiet actions at the bottom: "Mark done" (writes a `user` ledger
entry) and "Mark not done" (removes the ledger entry; disabled with an explanation when a
marker or rule still proves it, since removing would change nothing). Both confirm once.

### 6 · Testing and the CLI

Rust unit tests, each on a scratch git repo built in a temp dir:

- trailer parse: one trailer, several per commit, malformed value ignored, id case.
- subject search finds a subject older than 200 commits.
- ledger: latch on first done, no rewrite when unchanged, removal, corrupt → `.bad`.
- order of truth: marker beats a false rule; ledger beats a rule that stopped matching.
- detector: each of the three checks positive and negative; `planDirs` honoured; cap.
- manifest validation still warns on unknown rule keys (unchanged).

`chronicle --derive <dir>` prints each status with `proof` and lists the detector
findings, so a manifest can be verified without opening the app.

Frontend tests (vitest): needs-you rows render the three finding kinds and the shared
action; phase detail shows the marker command for the current phase.

Live check on this repo after the change: SE and M-1 derive done (SE by the commit
subject now inside the search, M-1 by an empty marker commit made during the live test),
the detector lists the four September specs and v0.8.1, and "Bring the roadmap up to
date" produces a manifest diff that adds the energy, web, notes and repo-editing phases.

## Out of scope

- Automatic manifest edits without a person reviewing.
- Rewriting existing manifests' rules to markers (the ledger covers them).
- Per-item (`items`) evidence; that remains the separate SE feature.

## Implementation notes (2026-09-13)

- Round ids are `FX-<n>` (fix-round phases), not the `R<n>` shape implied earlier in
  this doc; the marker instruction and the fix-round prompt both use `Chronicle-Phase:
  FX-{n} done`.
- A ledger entry's `at` is an epoch-millisecond timestamp (`epoch_ms()`), not an ISO
  string.
- "Bring it up to date" does not open a fresh agent pane. It reuses the same
  background init session as first-run setup, seeded with a "REFRESH MODE. Since this
  roadmap was written the repo moved on. Update only what changed, never drop a phase
  the plan still contains, and recompute every generatedFrom hash. What changed:
  {note}" instruction instead of the normal first-run prompt.
- `StaleAlert` does not exist as a separate banner component; its job is done by the
  needs-you rows (new plans/specs, a newer release, behind-upstream) rendered directly
  in the roadmap list.
- The marker command shown in phase detail and written into every generated prompt is
  the two-message form: `git commit --allow-empty -m "Close <id>" -m "Chronicle-Phase:
  <id> done"` (or the trailer appended as the commit's own last paragraph when the
  commit already carries a body) — never a single `-m` string with an embedded
  newline.
- None of the behind rows has a "Not now" suppression: no `localStorage` key, no
  finding-set hash, nothing dismissible. The new-plans row, the newer-release row and
  the behind-upstream row all keep showing until the thing they name is no longer
  true — the roadmap is brought up to date, or the branch catches up. The confirm
  dialog's cancel ("Not now") only declines that one refresh run; the row stays.
- A `pool` phase is only ever lifted to `done` by an explicit marker commit or a
  ledger entry (including a manual "Mark done"); no rule alone can resolve a pool
  phase, since pool phases by definition have no ordering rule to evaluate.
- The release detector only reports a `newer_release` finding for a tag that both (a)
  is mentioned by the manifest/detector logic as newer than the manifest's known
  release, and (b) actually exists as a git tag in this repo — it never fabricates or
  guesses a version.
- The ledger is written (`latch`) only on a scan of the currently opened project, or
  on an explicit developer-CLI call: `chronicle --derive <dir>` (which always runs
  with `write=true`) and `chronicle --state <dir>` (which goes through
  `state_for_project`, and so latches too). A background picker-preview derive
  (`derive_project(.., false)`) never writes it.
- `latch` (the scan-driven ledger write) and `ledger_mark` (the manual "Mark
  done"/"Mark not done" action) both go through `ledger::record`, which takes the same
  lock, so a concurrent scan and a manual toggle cannot race and corrupt the ledger.

### Live check on this repo (2026-09-13)

Ran `chronicle --derive` against this repo before and after a marker commit:

- Before the marker: SE derived `done` with proof `commit_subject 1d75d57`; M-1
  derived `now` (its rule never matched in this repo's history); M-2 and AA derived
  `later`. `new_plans` listed six docs newer than the manifest — two plans
  (`2026-09-10-repo-editing.md`, `2026-09-13-roadmap-accuracy.md`) and four specs
  (`2026-09-08-energy-efficiency-design.md`, `2026-09-09-notes-design.md`,
  `2026-09-10-repo-editing-and-history-design.md`,
  `2026-09-13-roadmap-accuracy-design.md`). `newer_release` was `["v0.8.1",
  "v0.5.1"]`.
- After `git commit --allow-empty -m "Close M-1" -m "Chronicle-Phase: M-1 done"`: M-1
  derived `done` with proof `marker <short-hash>` and latched into
  `.chronicle/roadmap-ledger.json`; M-2 advanced to `now`. On this second derive SE's
  proof read as `ledger commit_subject 1d75d57` (ledger precedence over re-running the
  subject-search rule), not the bare `commit_subject 1d75d57` from the first run —
  both are the same underlying evidence, just reported from the ledger on the second
  pass.
