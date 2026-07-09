# chronicle.json — schema reference

One JSON object at the project root. Chronicle re-reads it (and re-evaluates every rule)
every few seconds while the project is open.

```jsonc
{
  "chronicleVersion": 1,
  "name": "weave",                    // shown in the project tab and recents
  "description": "One plain sentence on what the project is — shown on its recents tile.",
  "roots": {
    "repo": ".",                      // the git repo, relative to this file's folder (usually ".")
    "extra": [                        // optional additional roots (e.g. a prompt-set folder)
      { "alias": "canon", "path": "/Users/me/Downloads/loupe-redo" }
    ]
  },
  "workBranch": "main",               // optional; being on any other branch raises a built-in action
  "generatedFrom": [                  // staleness check — recompute sha256 at every write
    { "path": "canon/PLAN.md", "sha256": "<hex>" }
  ],
  "spine": [ { "path": "canon/PLAN.md" } ],   // always-on documents shown above the stages
  "stages": [ /* Stage */ ],
  "actions": [ /* Action */ ]
}
```

## Paths

Every `path` in the file is **root-relative**: plain paths resolve from `roots.repo`;
`@alias/sub/file.md` resolves from that extra root; `@alias` alone is the root itself.
All file access is jailed to the declared roots.

## Stage

```jsonc
{ "title": "Part 1 — Finish the foundation", "note": "one item at a time", "phases": [ /* Phase */ ] }
```

## Phase

```jsonc
{
  "id": "R-1",                    // short id shown on the card and in --derive output
  "name": "Missing screens get drawn",
  "desc": "One plain-English sentence. <b> allowed.",
  "items": [ "Step descriptions, plain English, <b> allowed." ],
  "paste": [                      // the exact files the human pastes, in order
    { "path": "canon/PROMPT.md", "into": "Claude Code", "when": "a fresh terminal session" },
    { "label": "the design batch", "into": "Claude Design", "when": "doesn't exist yet" }  // ghost chip
  ],
  "docs": [ { "path": "W2R_REPORT.md" } ],   // reference chips (click = copy contents)
  "pool": false,                  // true = idea shelf; never counted for now/next
  "window": false,                // true = a parallel window (dashed card); never becomes "now"
  "status": { /* Status */ }      // omit entirely for pool phases
}
```

## Status derivation

- A phase is **done** when ANY `done_when` condition holds.
- The **first** phase (document order) that is not done, not `pool`, not `window` is **now**.
- Everything after is **later**; `window` phases show as their own dashed state.
- The now/window label = the first `current_labels` entry whose `when` conditions ALL hold,
  else `default_label`, else a built-in ("in progress" / "waiting").

```jsonc
"status": {
  "done_when": [ /* Condition — OR */ ],
  "current_labels": [ { "when": [ /* Condition — AND */ ], "label": "with the designer" } ],
  "default_label": "when R-1 returns"
}
```

## Condition

Exactly one key per object, plus optional `"not": true` to invert:

| key | value | true when |
|---|---|---|
| `tag` | `"phase-2"` | a git tag with that exact name exists |
| `file_exists` | `"progress/p3.md"` | the path exists (any root via `@alias/…`) |
| `file_matches` | `{ "path": "REPORT.md", "pattern": "\\*\\*R-1\\*\\*.*CLOSED" }` | the file exists AND the regex (multiline: `(?m)` supported) matches its contents |
| `commit_subject` | `"(?i)phase[- ]3 sign-off"` | any of the last 200 commit subjects on the repo matches |
| `file_glob` | `{ "dir": "@canon", "contains": "handoff" }` | some filename directly in `dir` contains the substring (case-insensitive) |
| `worktree_branch` | `"medan"` | a git worktree is checked out on that branch |

**Pattern discipline:** regexes are matched against the whole file. Anchor tightly — require
the marker's literal punctuation, or use `(?m)^` — so prose *describing* the marker can't
satisfy the rule.

## Action

Project-specific "what needs you" rows, shown when ALL `when` conditions hold:

```jsonc
{
  "when": [ { "worktree_branch": "medan" } ],
  "level": "hi",                          // optional; "hi" = accented dot
  "text": "<b>Remove the leftover workspace</b> — the last clean-up loose end.",
  "cmd": "git worktree remove --force …"  // optional; rendered as a copy-command link
}
```

Built-in actions (do not duplicate): unpublished branch, unpushed/behind commits, wrong
branch vs `workBranch`, prunable worktrees, and a "next build step" pointer derived from the
current phase's first paste row.

## CLI

`chronicle --derive <project-dir>` prints `{ "name", "statuses": [{id, state, label}] }` —
use it to verify a manifest without opening the app.

## Waiting phases

If a phase's active label starts with "waiting", the app shows a **"The build is waiting"**
banner instead of "here". Add an optional `status.blocked_note` (plain English, one sentence
naming the gate and what unblocks it) — it renders inside that banner.
