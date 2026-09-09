# Repo Editing and an Honest History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Repo pane a place you can actually work — CodeMirror editing with explicit ⌘S, a conflict bar when the agent writes under you, and create/rename/delete on the explorer — and replace the roadmap's lying "Project history" panel with four literal facts read from a fixed git layer.

**Architecture:** Two lanes on disjoint files. **Lane A (Rust)** fixes the git plumbing in `src-tauri/src/main.rs` and adds two new modules: `src-tauri/src/history.rs` (the four history facts + the only `git fetch` in the app) and `src-tauri/src/files.rs` (write / create / rename / trash / reveal, all jailed, atomic, Trash-never-rm). **Lane B (frontend)** adds a module-scope buffer store `src/lib/repo-editor.ts` modelled on `notes-store.ts`, a `CodeEditor.tsx` wrapping CodeMirror 6 themed from the app's CSS tokens, and wires both into the Viewer and the explorer. A **join** phase rewrites `HistoryPanel.tsx` to the four lines, adds ⌘S and the pane-aware ⌘N to the Go menu and the App keymap, and moves the publish notification onto the push command's own result.

**Tech Stack:** Rust (tauri 2.11.5, serde_json, `trash` 5.2.8 — one new crate), React 19 + strict TS, Tailwind v4, CodeMirror 6 (exact pins in Global Constraints), vitest (node environment), cargo tests.

**Spec:** `docs/superpowers/specs/2026-09-10-repo-editing-and-history-design.md`

## Deviations from the spec (ruled before planning)

1. **Two new Rust modules instead of more `main.rs`.** The spec says the file commands live in "`src-tauri/src/main.rs`, the existing file commands' module" and that the Part 2 fixes are "all in `src-tauri/src/main.rs`". `main.rs` is already 3503 lines. The five plumbing fixes (Task 1) genuinely belong there — they are edits to `git_in_checked` (`main.rs:332-336`) and `state_for_project` (`main.rs:1121-1223`). But the *new* surface goes into `src-tauri/src/history.rs` and `src-tauri/src/files.rs`, following the precedent `notes/`, `web.rs`, `acp.rs`, `setup.rs`, `power.rs` and `blocklists.rs` already set. `main.rs` gains two `mod` lines and the new command names in `generate_handler!` (`main.rs:2952-2981`), which is also what keeps the ACL automatic — `build.rs` regexes the command list out of that macro.

2. **`read_file` stops returning a bare `String`.** The spec extends it to `{ text, mtime_ms, size, binary }` (plus `too_large`). Four existing call sites want the string and nothing else — `src/App.tsx:476`, `src/screens/roadmap/PhaseDetailHost.tsx:102`, `src/screens/notes/RoundCard.tsx:84`, `src/lib/composer-mentions.ts:81`. They move to a new one-line wrapper `readFileText(dir, path)` rather than each learning the payload. `src/screens/repo/RepoPane.tsx:376` is the one call site that wants the whole payload.

3. **The buffer store is not literally pure.** The spec heads the section "`src/lib/repo-editor.ts`, pure". Its own rules ("⌘S … `write_file(...)`", "fetch the disk text") require IPC. It is built exactly like `src/lib/notes-store.ts` — module scope, outside React, `vi.mock("./ipc")` in the test — and the genuinely pure parts (`editorConfigTabSize`, `languageIdFor`, `bufferKey`, `saveLabelFor`) are exported separately and tested as functions.

4. **The CodeMirror `EditorState` cache lives in `CodeEditor.tsx`, not in the store.** The spec requires undo history to survive tab switches, which means keeping the `EditorState`. Putting a `@codemirror/state` import inside `repo-editor.ts` would make the store unimportable in the node test environment (`vitest.config.ts:6-8` pins `environment: "node"`). The store instead exposes `onBufferDisposed(cb)`; `CodeEditor.tsx` registers one module-scope disposer that drops the cached state when a buffer closes.

5. **`@codemirror/lang-html` is pinned at 6.4.12, not the 6.4.11 already on disk.** `node_modules/@codemirror/` already carries nine packages, hoisted transitively from `@codesandbox/sandpack-react` — `state 6.7.1`, `view 6.43.6`, `language 6.12.4`, `commands 6.10.4`, `autocomplete 6.20.3`, `lint 6.9.7`, `lang-javascript 6.2.5`, `lang-css 6.3.1`, `lang-html 6.4.11`. Every consumer's range is a caret (`sandpack` asks `@codemirror/state ^6.2.0`, `@codemirror/view ^6.7.1`, …; `@codemirror/view` itself asks `state ^6.7.0`), so pinning the newest exact version of each at the top level dedupes to **one** `state` and **one** `view` in the lock. Task 5 proves it with `npm ls` rather than assuming it — a second `@codemirror/state` breaks CodeMirror silently, with no error in the console.

6. **The Viewer's `{ kind: "code" }` body is deleted, not kept beside the editor.** The spec's rule is "Read-only mode is the same component with `EditorState.readOnly` … so the Contents view has one code path". `CodeView`, `CodeSeg`, `CodeLine` (`src/screens/repo/Viewer.tsx:17-19, 77-103`) and `codeLines` (`src/lib/repo-data.ts:102-110`) go with it; a new `{ kind: "text" }` body renders `CodeEditor` in both modes. The Changes view keeps `DiffView` untouched.

7. **The quit guard goes through `src/lib/ipc.ts`.** `getCurrentWindow().onCloseRequested` is the only way to hold a Tauri window close open, and the codebase's law is that components never import `@tauri-apps/*` (only `ipc.ts` does — `src/lib/ipc.ts:17`). Task 8 adds `onWindowClose(cb)` there beside `windowControls()` (`src/lib/ipc.ts:521-529`).

8. **`git_fetch` returns the recomputed facts, not `()`.** "Check now" is then one round trip instead of two, and a failed fetch can hand back the *old* numbers with the *old* checked time plus an `error` sentence in the same payload — which is exactly what the spec asks the line to show.

9. **`git_in_checked` trims only trailing `\r`/`\n`, not `.trim()`.** The spec says "returns stdout with only the trailing newline trimmed". All 19 call sites were read (`main.rs:350, 353, 439, 712, 719, 1129, 1130, 1135, 1140, 1144, 1215, 1783, 1788, 1908, 2112, 2114, 2120, 2135, 2352`, plus the assertion at `3138`) — they either `.lines()`, `.split_whitespace()`, `.split("\n\n")`, `.parse()`, or compare a single-token `rev-parse` result, and not one of them depends on leading whitespace being stripped, so every one survives trailing-only trimming. Task 1's test pins the one that was broken.

10. **⌘S is a new Go row; ⌘N's row is renamed.** `src-tauri/src/menu.rs:72` ships `go-new-note` / "New Note" on `Cmd+KeyN`. The spec wants the row to read "New Note or File" and the App keymap to branch on the pane. A new row `go-save` / "Save" / `Cmd+KeyS` joins group 5. `menu.rs:205-211`'s `accelerators_are_unique` test guards the collision; `Cmd+KeyS` is unclaimed today.

11. **The buffer is created when a file OPENS, not on the first edit.** The spec says "a buffer is created only when the user first edits, so read-only browsing costs nothing new". CodeMirror cannot render without a document, and the spec also requires the read-only Contents view to be *the same component* — so there is no state in which a viewed text file has no buffer to draw from. Task 6 therefore calls `openBuffer` at the end of `loadContents`. The cost the spec was protecting is still avoided: an untouched buffer is `clean`, it is one `Map` entry holding the text the viewer was going to hold anyway, it never writes, and it is disposed with the tab. The spec's real guarantee — that nothing is written unless the user asks — is enforced by `saveBuffer` returning early on a `clean` buffer.

## Global Constraints

Copied from the spec; every task's requirements implicitly include this section.

- **Saving is explicit.** "⌘S writes the file. No autosave for code. Unsaved buffers survive tab and pane switches and are flagged on close."
- **What is editable.** "Any text file under the project root up to the size cap; binaries and oversize files stay view-only. Same jail as every other file command."
- **The size cap is 4 MiB.** "Files over 4 MiB return `{ text: "", size, too_large: true }`."
- **The binary sniff is a NUL in the first 8 KiB.** "Binary = a NUL byte in the first 8 KiB."
- **The jail plus two refusals.** "All refuse paths inside `.git/` and `node_modules/` for create/rename/trash; editing a file under `.git/` is refused too."
- **Trash, never `rm`.** "Moves to the user's Trash via the `trash` crate (Finder's Trash, restorable). Never `rm`." And: "Trash unavailable (network volumes): refuse with a sentence; never fall back to `rm`."
- **The conflict rule, verbatim.** "The project watcher already emits a change for the path. Clean buffer: reload silently. Dirty buffer: fetch the disk text; if it equals `savedText` (our own write echo) do nothing, else `conflict` with the bar. Reload replaces the buffer; Keep mine leaves the buffer and updates `mtime` so the next ⌘S wins." And: "Closing a dirty tab, switching projects, or quitting with dirty buffers asks once: Save, Discard, Cancel. Pane switches never ask."
- **`changed on disk` is never a toast.** "`changed on disk`: the conflict bar, never a toast." Write failures (permissions, disk) are a toast with the OS sentence and the buffer stays dirty.
- **Fetch only on Check now.** "**Check now** runs `git fetch --prune origin` once, then recomputes. Nothing fetches on a timer, on a heartbeat, or on pane open." (`git_pull` keeps its own pre-pull fetch — `main.rs:2134` — because a pull is an explicit click too.)
- **No new timers.** "No new timers. The editor's CodeMirror instance is created on first edit and disposed when the tab closes." Any cadence goes through `every()` in `src/lib/scheduler.ts`.
- **ACL scoping stays `"webviews": ["main"]`** in `src-tauri/capabilities/default.json`. New commands are picked up automatically: `src-tauri/build.rs` generates the permission manifest from `tauri::generate_handler![…]` in `main.rs`, so a command only has to be added to that list.
- **Exact package pins.** `@codemirror/state` **6.7.4**, `@codemirror/view` **6.43.11**, `@codemirror/commands` **6.11.0**, `@codemirror/language` **6.12.4**, `@codemirror/search` **6.7.2**, `@codemirror/autocomplete` **6.20.3**, `@codemirror/lint` **6.9.7**, `@codemirror/lang-javascript` **6.2.5**, `@codemirror/lang-json` **6.0.2**, `@codemirror/lang-css` **6.3.1**, `@codemirror/lang-html` **6.4.12**, `@codemirror/lang-markdown` **6.5.2**, `@codemirror/lang-rust` **6.0.2**, `@codemirror/lang-python` **6.2.1**, `@codemirror/legacy-modes` **6.5.4**. No carets, no ranges. The Rust `trash` crate is **5.2.8**.
- **One `@codemirror/state` and one `@codemirror/view` in the lock.** A duplicated state package breaks CodeMirror with no error.
- **The sanitiser is the notes'.** "names go through the same sanitiser the notes use, refusing `/` and leading dots" — `sanitizeTitle` in `src/lib/notes-model.ts:132-137`: `/ \ : * ? " < > |` become `-`, runs of `-` collapse, leading `-`/`.` and trailing `-` are stripped, max 80 chars.
- **Line numbers on, wrap off**, "horizontal scroll inside the editor, never the page", tab size from `.editorconfig` when present else 2, and "leave the file as the user typed it; no automatic formatting."
- **Components never import `@tauri-apps/*` directly**; every command and event goes through `src/lib/ipc.ts`.
- **Copy stays plain-spoken, no jargon.** Conventional commits — the executor adds the trailer lines, the commands below do not.
- **Agents never run `git stash`, `git reset`, or `git checkout -- <file>` in this tree.** The user's live app writes into it while the work runs. Commit or leave alone; never discard.

## File Structure

| File | Lane | Responsibility |
|---|---|---|
| `src-tauri/src/main.rs` | A | `git_in_checked` trim; `remote_ref`/`publish_kind`/`parse_porcelain`/`badge_for`/`is_runtime_path`; `state_for_project`'s new fields; `mod history; mod files;` and the handler list. |
| `src-tauri/src/history.rs` (new) | A | `HistoryFacts`, `facts()`, the `history_facts` and `git_fetch` commands, the per-project checked-time file. |
| `src-tauri/src/files.rs` (new) | A | `jailed_target`, `refused`, and the `read_file` / `write_file` / `create_path` / `rename_path` / `trash_path` / `reveal_path` commands. |
| `src-tauri/Cargo.toml` | A | `trash = "5.2.8"`. |
| `src/lib/ipc.ts` | B | Wrappers and types for every new command; `readFileText`; `onWindowClose`. |
| `src/lib/repo-editor.ts` (new) + `.test.ts` | B | The buffer state machine, the `.editorconfig` tab size, the language id map, dirty bookkeeping. |
| `src/screens/repo/CodeEditor.tsx` (new) | B | CodeMirror 6: the token theme, the `HighlightStyle`, language loading by extension, read-only mode, the per-buffer `EditorState` cache. |
| `src/screens/repo/Viewer.tsx` | B | The `{ kind: "text" }` body, the header save states, the conflict bar, the dirty dot on tabs. |
| `src/screens/repo/RepoPane.tsx` | B | Opening into a buffer, ⌘S plumbing, the watcher → `onFileChanged` route, close/switch prompts, the explorer's operation callbacks. |
| `src/screens/repo/FileTree.tsx` | B | New file / New folder head buttons, the row context menu, inline name editing. |
| `src/lib/repo-data.ts` + `.test.ts` (new) | B | `codeLines`/`CodeLine`/`CodeSeg` removed; `buildTree` takes the pending-name node; `newPathIn`/`nextFreeName`. |
| `src/screens/repo/preview-fixtures.ts` | B | The `CodeLine` import, `pricingLines` and the `{kind:"code"}` fixture go with the Viewer's old body. |
| `src/components/chrome/TabStrip.tsx` | B | The `"dirty"` `TabDot`. |
| `src/overlays/ConfirmDialog.tsx` | B (Task 6) | `ConfirmSpec` gains the optional third answer (`altLabel`/`onAlt` — "Discard"). |
| `src/App.tsx` | B (Task 4, one line) then join (Task 8) | Task 4 renames the `readFile` call at `:476` and its import at `:85`; Task 8 does the keymap, the quit guard and the roadmap ctx. |
| `src/screens/roadmap/PhaseDetailHost.tsx`, `src/screens/notes/RoundCard.tsx`, `src/lib/composer-mentions.ts` | B (Task 4, one line each) | `readFile` → `readFileText`. |
| `src/screens/roadmap/HistoryPanel.tsx` | join | The four lines, Check now, the degraded state. Pipeline, milestones and "saves" deleted. |
| `src/screens/roadmap/preview-fixtures.ts` | join | `historyPanel`/`historyNoHistory` retyped to the new shape; `HistoryStatus` and its two fixtures deleted. |
| `src/screens/roadmap/Roadmap.tsx` | join | Follows `HistoryPanelProps` if its import list names a deleted type. |
| `src/lib/roadmap-data.ts` + `.test.ts` (new) | join | `historyPanelFrom(facts, now, ctx)` and `ago()`. |
| `src/lib/menu-keys.test.ts` | join | The ⌘S / ⌘N / ⌘P assertions in `reclaimsFocus`. |
| `src-tauri/src/menu.rs` | join | `go-save`; `go-new-note` renamed "New Note or File". |

**Lane A owns `src-tauri/**` and nothing else** — `main.rs`, `history.rs`, `files.rs`, `Cargo.toml` (and `Cargo.lock`).
**Lane B owns** `src/lib/{ipc,repo-editor,repo-data}.ts` (+ their tests), `src/screens/repo/*` (including `preview-fixtures.ts`), `src/components/chrome/TabStrip.tsx`, `src/overlays/ConfirmDialog.tsx`, `package.json`, `package-lock.json`, and the four one-line `readFileText` renames listed above (one of which is in `src/App.tsx`).
**The join (Tasks 8–9) owns** `src/App.tsx`, `src-tauri/src/menu.rs`, `src/lib/menu-keys.test.ts`, `src/lib/roadmap-data.ts`, and `src/screens/roadmap/{HistoryPanel,Roadmap,preview-fixtures}.tsx|.ts`.

Nothing in Lane B's list appears in Lane A's, so the two can run concurrently from the start. The one overlap between Lane B and the join is `src/App.tsx`: Lane B's Task 4 changes exactly two lines there (`:85` and `:476`) and the join's Task 8 runs after both lanes have landed, so the two never edit it at the same time. Lane B codes against the command shapes in Lane A's **Produces** blocks; those shapes are contracts, not sketches.

**Verification commands** (every task's last-but-one step):
- Frontend: `npx vitest run` — 127 tests pass today; each Lane B task says its new count.
- Types: `npm run build` (runs `tsc -b` then vite).
- Rust: `cd src-tauri && cargo test` — 125 tests pass today; each Lane A task says its new count.
- `cd src-tauri && cargo check` — only the pre-existing `unused variable: log` warning is allowed.

---

### Task 1 (Lane A): The git plumbing — trim, publish resolution, the dirty set, badges, degraded

**Files:**
- Modify: `src-tauri/src/main.rs:332-336` (`git_in_checked`), `src-tauri/src/main.rs:1121-1223` (`state_for_project`), `src-tauri/src/main.rs:76-90ish` (the `DirtyEntry` struct — find it with `grep -n "struct DirtyEntry" src-tauri/src/main.rs`)
- Test: `src-tauri/src/main.rs` — a new `#[cfg(test)] mod history_tests` at the end of the file, beside `r4_tests` (`main.rs:3369`)

**Interfaces:**
- Consumes: nothing.
- Produces (Rust, all `pub(crate)` in `crate`, so `history.rs` in Task 2 can use them):
  - `pub(crate) fn git_in_checked(repo: &Path, args: &[&str]) -> Result<String, String>` — unchanged signature, trailing-only trimming.
  - `pub(crate) fn remote_ref(repo: &Path, branch: &str) -> Option<String>` — `@{u}` → `origin/<branch>` → `origin/HEAD`, in that order; `None` when none resolves.
  - `pub(crate) fn publish_kind(repo: &Path, remote_url: &str) -> &'static str` — `"no-remote"` | `"never-published"` | `"ok"`.
  - `pub(crate) fn ahead_behind(repo: &Path, remote_ref: &str) -> (u32, u32)` — `(ahead, behind)`, in that order.
  - `pub(crate) fn badge_for(x: char, y: char) -> &'static str` — `"new"` | `"edited"` | `"deleted"` | `"renamed"`.
  - `pub(crate) fn is_runtime_path(rel: &str) -> bool` — true for the `.chronicle/` runtime paths.
  - `pub(crate) fn parse_porcelain(raw: &str) -> Vec<DirtyEntry>`
  - `pub(crate) struct DirtyEntry { pub code: String, pub path: String, pub badge: String }` — `Serialize`, `Debug`, `PartialEq`.
  - `pub(crate) fn dirty_set(repo: &Path) -> Vec<DirtyEntry>` — runs the porcelain command and parses it.
  - `get_state` gains `"published": "no-remote"|"never-published"|"ok"` and `"remote_ref": "<name>"|""`; `"dirty"` entries gain `"badge"`; `"upstream"` now means "a remote ref resolved", `"ahead"`/`"behind"` are measured against that ref.

- [ ] **Step 1: Write the failing tests**

Append this module at the very end of `src-tauri/src/main.rs`:

```rust
/* ================= the history plumbing (2026-09-10 audit) ================= */

#[cfg(test)]
mod history_tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("chronicle-hist-{}-{}", name, std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d.canonicalize().unwrap()
    }

    fn git(d: &Path, args: &[&str]) {
        let o = std::process::Command::new("git").arg("-C").arg(d).args(args).output().unwrap();
        assert!(o.status.success(), "git {:?}: {}", args, String::from_utf8_lossy(&o.stderr));
    }

    /// A repo with one commit, committer identity forced so CI has one too.
    fn repo(name: &str) -> PathBuf {
        let d = tmp(name);
        git(&d, &["init", "-q", "-b", "main"]);
        git(&d, &["config", "user.email", "t@t"]);
        git(&d, &["config", "user.name", "t"]);
        std::fs::write(d.join("a.txt"), "one\n").unwrap();
        git(&d, &["add", "-A"]);
        git(&d, &["commit", "-q", "-m", "feat: first save"]);
        d
    }

    /// THE BUG: `.trim()` ate the leading space of the first porcelain line, so
    /// " M a.txt" parsed as code "M" over path "xt". Only the trailing newline goes.
    #[test]
    fn git_in_keeps_the_first_lines_leading_space() {
        let d = repo("trim");
        std::fs::write(d.join("a.txt"), "two\n").unwrap();
        let raw = git_in(&d, &["status", "--porcelain"]);
        assert!(raw.starts_with(" M "), "leading space lost: {raw:?}");
        assert!(!raw.ends_with('\n'), "trailing newline kept: {raw:?}");
    }

    #[test]
    fn the_dirty_set_survives_the_first_line() {
        let d = repo("dirty");
        std::fs::write(d.join("a.txt"), "two\n").unwrap();
        let set = dirty_set(&d);
        assert_eq!(set.len(), 1);
        assert_eq!(set[0].path, "a.txt");
        assert_eq!(set[0].badge, "edited");
    }

    #[test]
    fn parse_porcelain_splits_renames_and_maps_every_badge() {
        let raw = concat!(
            " M src/edited.rs\n",
            "?? src/new.rs\n",
            "A  src/added.rs\n",
            " D src/gone.rs\n",
            "R  old/name.rs -> new/name.rs\n",
        );
        let got = parse_porcelain(raw);
        let pairs: Vec<(&str, &str)> = got.iter().map(|d| (d.path.as_str(), d.badge.as_str())).collect();
        assert_eq!(pairs, vec![
            ("src/edited.rs", "edited"),
            ("src/new.rs", "new"),
            ("src/added.rs", "new"),
            ("src/gone.rs", "deleted"),
            ("new/name.rs", "renamed"),
        ]);
    }

    #[test]
    fn the_chronicle_runtime_paths_are_not_edits_of_yours() {
        for p in [
            ".chronicle/agent/session.json",
            ".chronicle/attachments/shot-1.png",
            ".chronicle/journal.jsonl",
            ".chronicle/rounds.json",
            ".chronicle/notes/Tasks/A.md",
            ".chronicle/trash/1-A.md",
            ".chronicle/kanban.json.migrated",
            "sub/project/.chronicle/journal.jsonl",
        ] {
            assert!(is_runtime_path(p), "{p} should be excluded");
        }
        for p in [".chronicle/kanban.json", "chronicle.json", "src/.chronicled.rs", "notes/A.md"] {
            assert!(!is_runtime_path(p), "{p} must stay visible");
        }
        let raw = " M .chronicle/journal.jsonl\n M src/keep.rs\n";
        assert_eq!(parse_porcelain(raw).len(), 1);
    }

    #[test]
    fn publish_state_resolves_without_an_upstream() {
        let origin = tmp("pub-origin");
        git(&origin, &["init", "-q", "--bare", "-b", "main"]);
        let d = repo("pub");
        git(&d, &["remote", "add", "origin", origin.to_string_lossy().as_ref()]);

        // a remote is configured but nothing was ever pushed
        assert_eq!(publish_kind(&d, "url"), "never-published");
        assert_eq!(remote_ref(&d, "main"), None);

        // pushed WITHOUT -u: no @{u}, but refs/remotes/origin/main exists
        git(&d, &["push", "-q", "origin", "main"]);
        assert_eq!(remote_ref(&d, "main").as_deref(), Some("origin/main"));
        assert_eq!(publish_kind(&d, "url"), "ok");
        assert_eq!(ahead_behind(&d, "origin/main"), (0, 0));

        // one local save on top
        std::fs::write(d.join("a.txt"), "two\n").unwrap();
        git(&d, &["commit", "-qam", "fix: second save"]);
        assert_eq!(ahead_behind(&d, "origin/main"), (1, 0));
    }

    #[test]
    fn publish_state_prefers_the_upstream_when_there_is_one() {
        let origin = tmp("up-origin");
        git(&origin, &["init", "-q", "--bare", "-b", "main"]);
        let d = repo("up");
        git(&d, &["remote", "add", "origin", origin.to_string_lossy().as_ref()]);
        git(&d, &["push", "-qu", "origin", "main"]);
        assert_eq!(remote_ref(&d, "main").as_deref(), Some("origin/main"));
        assert_eq!(publish_kind(&d, "url"), "ok");
    }

    #[test]
    fn no_remote_is_not_never_published() {
        let d = repo("solo");
        assert_eq!(publish_kind(&d, ""), "no-remote");
        assert_eq!(remote_ref(&d, "main"), None);
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /Users/tuneerguha/Downloads/chronicle/src-tauri && cargo test history_tests 2>&1 | tail -30`
Expected: compile errors — `cannot find function 'dirty_set'`, `'parse_porcelain'`, `'is_runtime_path'`, `'publish_kind'`, `'remote_ref'`, `'ahead_behind'` in this scope.

- [ ] **Step 3: Fix the trim**

Replace `src-tauri/src/main.rs:332-336`:

```rust
/// Err ONLY when git itself couldn't run (missing binary / spawn failure). A broken
/// environment must surface as DEGRADED — never silently derive "0 commits / not a
/// repo" from it. (A normal non-zero git exit, e.g. not-a-repo, is still empty output.)
///
/// Only the TRAILING newline goes. `--porcelain`'s first line starts with a
/// significant space (" M path") and `.trim()` used to eat it, shifting every
/// field of that one line by one character. Callers trim per line.
pub(crate) fn git_in_checked(repo: &Path, args: &[&str]) -> Result<String, String> {
    Command::new("git").arg("-C").arg(repo).args(args).output()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim_end_matches(['\n', '\r']).to_string())
        .map_err(|e| e.to_string())
}
```

- [ ] **Step 4: Add the resolution, badge and dirty-set helpers**

Insert directly below `git_in_checked` (before `struct Ctx` at `main.rs:338`):

```rust
/// Which remote ref this branch is measured against, in the spec's order:
/// the configured upstream, then `origin/<branch>`, then `origin/HEAD`.
/// Reading `branch.<name>.merge` alone (what this used to do) called a branch
/// that had been pushed without `-u` "never published".
pub(crate) fn remote_ref(repo: &Path, branch: &str) -> Option<String> {
    let ok = |args: &[&str]| {
        Command::new("git").arg("-C").arg(repo).args(args).output()
            .map(|o| o.status.success()).unwrap_or(false)
    };
    if ok(&["rev-parse", "--verify", "--quiet", "@{u}"]) {
        let name = git_in(repo, &["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
        if !name.is_empty() { return Some(name); }
    }
    if !branch.is_empty() {
        let full = format!("refs/remotes/origin/{branch}");
        if ok(&["rev-parse", "--verify", "--quiet", &full]) { return Some(format!("origin/{branch}")); }
    }
    if ok(&["rev-parse", "--verify", "--quiet", "refs/remotes/origin/HEAD"]) {
        return Some("origin/HEAD".into());
    }
    None
}

/// `no-remote` when nothing is configured, `never-published` only when no remote
/// ref anywhere contains HEAD, `ok` otherwise.
pub(crate) fn publish_kind(repo: &Path, remote_url: &str) -> &'static str {
    if remote_url.is_empty() { return "no-remote"; }
    let contains = git_in(repo, &["branch", "-r", "--contains", "HEAD"]);
    if contains.lines().any(|l| !l.trim().is_empty()) { "ok" } else { "never-published" }
}

/// `(ahead, behind)` — how many saves are here that the remote ref lacks, and
/// the other way round. `--left-right --count <ref>...HEAD` prints "behind ahead".
pub(crate) fn ahead_behind(repo: &Path, remote_ref: &str) -> (u32, u32) {
    if remote_ref.is_empty() { return (0, 0); }
    let lr = git_in(repo, &["rev-list", "--left-right", "--count", &format!("{remote_ref}...HEAD")]);
    let mut it = lr.split_whitespace();
    let behind = it.next().and_then(|s| s.parse::<u32>().ok()).unwrap_or(0);
    let ahead = it.next().and_then(|s| s.parse::<u32>().ok()).unwrap_or(0);
    (ahead, behind)
}

/// The porcelain XY pair as a word a non-developer reads. The staged column wins
/// when it says something, because that is what the next save will record.
pub(crate) fn badge_for(x: char, y: char) -> &'static str {
    let c = if x != ' ' && x != '?' { x } else { y };
    match c {
        '?' => "new",
        'A' => "new",
        'D' => "deleted",
        'R' => "renamed",
        _ => "edited", // M, C, T, U — "edited" is the honest word for all of them
    }
}

/// Chronicle's own runtime scribbles are not the user's edits. Matched on the
/// `.chronicle/` segment wherever it sits, because the manifest folder is not
/// always the repo root (a sub-project keeps its own `.chronicle/`).
pub(crate) fn is_runtime_path(rel: &str) -> bool {
    const RUNTIME: &[&str] = &[
        "agent/", "attachments/", "notes/", "trash/",
        "journal.jsonl", "rounds.json", "kanban.json.migrated",
    ];
    let Some(i) = rel.find(".chronicle/") else { return false };
    // ".chronicle/" must be a whole segment, not the tail of "src/my.chronicle/"
    if i > 0 && rel.as_bytes()[i - 1] != b'/' { return false; }
    let tail = &rel[i + ".chronicle/".len()..];
    RUNTIME.iter().any(|r| if r.ends_with('/') { tail.starts_with(r) } else { tail == *r })
}

#[derive(Serialize, Debug, Clone, PartialEq)]
pub(crate) struct DirtyEntry {
    pub code: String,
    pub path: String,
    pub badge: String,
}

/// One porcelain line → one entry. `R  old -> new` reports the NEW path (that is
/// the file on disk now); quoting is off at the command, so paths arrive raw.
pub(crate) fn parse_porcelain(raw: &str) -> Vec<DirtyEntry> {
    let mut out = Vec::new();
    for l in raw.lines() {
        if l.len() < 4 { continue; }
        let b = l.as_bytes();
        let (x, y) = (b[0] as char, b[1] as char);
        let rest = &l[3..];
        let path = rest.split(" -> ").next_back().unwrap_or(rest).trim_matches('"').to_string();
        if is_runtime_path(&path) { continue; }
        let code = if x != ' ' && x != '?' { x } else { y };
        out.push(DirtyEntry { code: code.to_string(), path, badge: badge_for(x, y).into() });
    }
    out
}

/// `-uall` so a new folder lists its files instead of one "dir/" row, and
/// `core.quotePath=false` so a non-ASCII name is not returned as `"\303\251..."`.
pub(crate) fn dirty_set(repo: &Path) -> Vec<DirtyEntry> {
    parse_porcelain(&git_in(repo, &["-c", "core.quotePath=false", "status", "--porcelain", "-uall"]))
}
```

If `struct DirtyEntry` already exists elsewhere in `main.rs` (grep it), delete that declaration — this is now the only one — and leave every `DirtyEntry { .. }` construction pointing at it.

- [ ] **Step 5: Run the new tests**

Run: `cd /Users/tuneerguha/Downloads/chronicle/src-tauri && cargo test history_tests 2>&1 | tail -20`
Expected: `test result: ok. 7 passed`.

- [ ] **Step 6: Rewrite `state_for_project`'s git block**

Replace `src-tauri/src/main.rs:1128-1143` (from the `// does this project have an online home` comment through the `dirty` binding) with:

```rust
    // does this project have an online home at all? (no network — just the configured remote)
    let remote_url = git_in(&p.repo, &["remote", "get-url", "origin"]);
    let commits: u32 = git_in(&p.repo, &["rev-list", "--count", "HEAD"]).parse().unwrap_or(0);
    let rref = remote_ref(&p.repo, &branch);
    let upstream = rref.is_some();
    let (ahead, behind) = rref.as_deref().map(|r| ahead_behind(&p.repo, r)).unwrap_or((0, 0));
    let published = publish_kind(&p.repo, &remote_url);
    let dirty = dirty_set(&p.repo);
```

and in the `json!` at `main.rs:1209-1222` change the branch/publish line and add the two new keys:

```rust
        "branch": branch, "upstream": upstream, "ahead": ahead, "behind": behind,
        "remote_url": remote_url, "commits": commits,
        "published": published, "remote_ref": rref.clone().unwrap_or_default(),
```

- [ ] **Step 7: Run the whole Rust suite**

Run: `cd /Users/tuneerguha/Downloads/chronicle/src-tauri && cargo test 2>&1 | tail -20`
Expected: `132 passed` (125 + 7), 0 failed.

Run: `cd /Users/tuneerguha/Downloads/chronicle/src-tauri && cargo check 2>&1 | grep -c warning`
Expected: `1` — the pre-existing `unused variable: log`.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/main.rs
git commit -m "fix(git): keep the porcelain leading space, resolve the remote ref, badge the dirty set"
```

---

### Task 2 (Lane A): The history facts and the only `git fetch` in the app

**Files:**
- Create: `src-tauri/src/history.rs`
- Modify: `src-tauri/src/main.rs` (add `mod history;` beside `mod menu;` — find it with `grep -n "^mod menu;" src-tauri/src/main.rs` — and add `history::history_facts, history::git_fetch,` to `generate_handler!` at `main.rs:2952-2981`)
- Test: `src-tauri/src/history.rs` (`#[cfg(test)] mod tests`)

**Interfaces:**
- Consumes (from Task 1): `git_in`, `git_in_checked`, `remote_ref`, `publish_kind`, `ahead_behind`, `dirty_set`, `DirtyEntry`, and `crate::project_for` / `crate::config_dir` / `crate::web::project_hash` (all already `pub(crate)`).
- Produces (Rust, in `crate::history`):
  - `#[derive(Serialize)] pub struct LastSave { pub ts: u64, pub subject: String }` — `ts` is a unix **second**.
  - `#[derive(Serialize)] pub struct LastPublish { pub ts: u64, pub tag: Option<String> }`
  - `#[derive(Serialize)] pub struct RemoteFacts { pub kind: String, pub ref_name: String, pub ahead: u32, pub behind: u32, pub checked_ms: Option<u64>, pub error: Option<String> }` — `kind` is `"no-remote"` | `"never-published"` | `"ok"`.
  - `#[derive(Serialize)] pub struct HistoryFacts { pub degraded: bool, pub is_git: bool, pub last_save: Option<LastSave>, pub dirty: Vec<crate::DirtyEntry>, pub remote: RemoteFacts, pub last_publish: Option<LastPublish> }`
  - `pub fn facts(repo: &Path, project_dir: &Path) -> HistoryFacts`
  - `pub fn checked_ms(project_dir: &Path) -> Option<u64>` / `pub fn store_checked(project_dir: &Path, ms: u64)`
  - `#[tauri::command] pub async fn history_facts(roots: State<'_, OpenRoots>, dir: String) -> Result<HistoryFacts, String>`
  - `#[tauri::command] pub async fn git_fetch(roots: State<'_, OpenRoots>, dir: String) -> Result<HistoryFacts, String>` — runs `git fetch --prune origin` once, stamps the checked time **only on success**, then returns `facts()`; on failure returns `facts()` with `remote.error = Some(<git's last line>)` and the previous `checked_ms` untouched.
  - Note for Lane B: **`saves` is gone.** No commit count appears anywhere in this payload.

- [ ] **Step 1: Write the failing tests**

Create `src-tauri/src/history.rs` with the module doc, the types, `unimplemented!()` bodies, and this test module:

```rust
//! The four facts the history section states, and the one place in the app that
//! runs `git fetch`. Every line is read straight out of git — nothing is derived
//! by subtracting one number from another, which is how the old panel came to
//! claim "2 saves waiting" on a branch that had never been published at all.

use crate::{ahead_behind, dirty_set, git_in, git_in_checked, publish_kind, remote_ref, DirtyEntry, OpenRoots};
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::State;

#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct LastSave { pub ts: u64, pub subject: String }

#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct LastPublish { pub ts: u64, pub tag: Option<String> }

#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct RemoteFacts {
    pub kind: String,
    pub ref_name: String,
    pub ahead: u32,
    pub behind: u32,
    pub checked_ms: Option<u64>,
    pub error: Option<String>,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct HistoryFacts {
    pub degraded: bool,
    pub is_git: bool,
    pub last_save: Option<LastSave>,
    pub dirty: Vec<DirtyEntry>,
    pub remote: RemoteFacts,
    pub last_publish: Option<LastPublish>,
}

pub fn facts(_repo: &Path, _project_dir: &Path) -> HistoryFacts { unimplemented!() }
pub fn checked_ms(_project_dir: &Path) -> Option<u64> { unimplemented!() }
pub fn store_checked(_project_dir: &Path, _ms: u64) { unimplemented!() }

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("chronicle-facts-{}-{}", name, std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d.canonicalize().unwrap()
    }

    fn git(d: &Path, args: &[&str]) {
        let o = std::process::Command::new("git").arg("-C").arg(d).args(args).output().unwrap();
        assert!(o.status.success(), "git {:?}: {}", args, String::from_utf8_lossy(&o.stderr));
    }

    fn repo(name: &str) -> PathBuf {
        let d = tmp(name);
        git(&d, &["init", "-q", "-b", "main"]);
        git(&d, &["config", "user.email", "t@t"]);
        git(&d, &["config", "user.name", "t"]);
        std::fs::write(d.join("a.txt"), "one\n").unwrap();
        git(&d, &["add", "-A"]);
        git(&d, &["commit", "-q", "-m", "feat: first save"]);
        d
    }

    #[test]
    fn a_plain_repo_reports_its_last_save_and_no_remote() {
        let d = repo("plain");
        let f = facts(&d, &d);
        assert!(!f.degraded);
        assert!(f.is_git);
        let ls = f.last_save.expect("a last save");
        assert_eq!(ls.subject, "feat: first save");
        assert!(ls.ts > 1_600_000_000, "a real unix second: {}", ls.ts);
        assert_eq!(f.remote.kind, "no-remote");
        assert_eq!(f.remote.ref_name, "");
        assert_eq!(f.remote.checked_ms, None);
        assert!(f.last_publish.is_none());
        assert!(f.dirty.is_empty());
    }

    #[test]
    fn the_dirty_list_carries_badge_words() {
        let d = repo("dirty");
        std::fs::write(d.join("a.txt"), "two\n").unwrap();
        std::fs::write(d.join("b.txt"), "new\n").unwrap();
        let f = facts(&d, &d);
        let mut got: Vec<(String, String)> =
            f.dirty.iter().map(|e| (e.path.clone(), e.badge.clone())).collect();
        got.sort();
        assert_eq!(got, vec![
            ("a.txt".to_string(), "edited".to_string()),
            ("b.txt".to_string(), "new".to_string()),
        ]);
    }

    #[test]
    fn a_published_repo_names_the_ref_the_counts_and_the_tag() {
        let origin = tmp("pub-origin");
        git(&origin, &["init", "-q", "--bare", "-b", "main"]);
        let d = repo("pub");
        git(&d, &["remote", "add", "origin", origin.to_string_lossy().as_ref()]);
        git(&d, &["tag", "v0.7.0"]);
        git(&d, &["push", "-q", "origin", "main", "--tags"]);

        let f = facts(&d, &d);
        assert_eq!(f.remote.kind, "ok");
        assert_eq!(f.remote.ref_name, "origin/main");
        assert_eq!((f.remote.ahead, f.remote.behind), (0, 0));
        let lp = f.last_publish.expect("a last publish");
        assert_eq!(lp.tag.as_deref(), Some("v0.7.0"));

        // one save on top: ahead moves, the publish line does NOT
        std::fs::write(d.join("a.txt"), "two\n").unwrap();
        git(&d, &["commit", "-qam", "fix: second save"]);
        let f2 = facts(&d, &d);
        assert_eq!((f2.remote.ahead, f2.remote.behind), (1, 0));
        assert_eq!(f2.last_publish.unwrap().ts, lp.ts, "publishing is not saving");
        assert_eq!(f2.last_save.unwrap().subject, "fix: second save");
    }

    #[test]
    fn a_never_published_repo_says_so_without_lying_about_counts() {
        let d = repo("never");
        git(&d, &["remote", "add", "origin", "https://example.invalid/x.git"]);
        let f = facts(&d, &d);
        assert_eq!(f.remote.kind, "never-published");
        assert_eq!(f.remote.ref_name, "");
        assert_eq!((f.remote.ahead, f.remote.behind), (0, 0));
        assert!(f.last_publish.is_none());
    }

    #[test]
    fn a_folder_that_is_not_a_repo_is_not_degraded() {
        let d = tmp("nogit");
        let f = facts(&d, &d);
        assert!(!f.degraded, "git ran fine — the folder just isn't a repo");
        assert!(!f.is_git);
        assert!(f.last_save.is_none());
    }

    #[test]
    fn the_checked_time_round_trips_per_project() {
        let a = tmp("checked-a");
        let b = tmp("checked-b");
        assert_eq!(checked_ms(&a), None);
        store_checked(&a, 1_757_000_000_000);
        assert_eq!(checked_ms(&a), Some(1_757_000_000_000));
        assert_eq!(checked_ms(&b), None, "the file is keyed by project");
        store_checked(&a, 1_757_000_050_000);
        assert_eq!(checked_ms(&a), Some(1_757_000_050_000), "a second check overwrites");
    }
}
```

- [ ] **Step 2: Wire the module in and run the tests to verify they fail**

Add `mod history;` beside `mod menu;` in `src-tauri/src/main.rs`.

Run: `cd /Users/tuneerguha/Downloads/chronicle/src-tauri && cargo test history:: 2>&1 | tail -20`
Expected: 6 failures, each `panicked at 'not implemented'`.

- [ ] **Step 3: Implement the facts**

Replace the three `unimplemented!()` bodies in `src-tauri/src/history.rs`:

```rust
fn fetch_dir() -> PathBuf { crate::config_dir().join("fetch") }
fn fetch_file(project_dir: &Path) -> PathBuf {
    fetch_dir().join(format!("{}.json", crate::web::project_hash(project_dir)))
}

/// When Chronicle last ran a fetch for this project. `None` = never checked.
pub fn checked_ms(project_dir: &Path) -> Option<u64> {
    let text = std::fs::read_to_string(fetch_file(project_dir)).ok()?;
    serde_json::from_str::<serde_json::Value>(&text).ok()?
        .get("checked_ms")?.as_u64()
}

pub fn store_checked(project_dir: &Path, ms: u64) {
    let _ = std::fs::create_dir_all(fetch_dir());
    let file = fetch_file(project_dir);
    let tmp = file.with_extension("json.tmp");
    if std::fs::write(&tmp, format!("{{\"checked_ms\":{ms}}}")).is_ok() {
        let _ = std::fs::rename(&tmp, &file);
    }
}

/// The newest commit any `origin/*` ref can reach, and the release tag pointing
/// at it if there is one. Committer date, not author date: what the user calls
/// "published" is when the commit landed, not when it was first written.
fn last_publish_of(repo: &Path) -> Option<LastPublish> {
    let raw = git_in(repo, &["log", "-1", "--format=%ct\x1f%H", "--remotes=origin"]);
    let (ts, hash) = raw.split_once('\x1f')?;
    let ts: u64 = ts.trim().parse().ok()?;
    let tag = git_in(repo, &["tag", "--points-at", hash.trim()])
        .lines().map(str::trim).find(|l| !l.is_empty()).map(str::to_string);
    Some(LastPublish { ts, tag })
}

fn last_save_of(repo: &Path) -> Option<LastSave> {
    let raw = git_in(repo, &["log", "-1", "--format=%ct\x1f%s", "HEAD"]);
    let (ts, subject) = raw.split_once('\x1f')?;
    Some(LastSave { ts: ts.trim().parse().ok()?, subject: subject.trim().to_string() })
}

pub fn facts(repo: &Path, project_dir: &Path) -> HistoryFacts {
    // the same probe get_state uses: an Err means git itself could not run,
    // which is DEGRADED — quite different from "this folder isn't a repo"
    let branch_probe = git_in_checked(repo, &["rev-parse", "--abbrev-ref", "HEAD"]);
    let degraded = branch_probe.is_err();
    let branch = branch_probe.unwrap_or_default();
    let is_git = !branch.is_empty();
    if !is_git {
        return HistoryFacts {
            degraded, is_git: false, last_save: None, dirty: vec![],
            remote: RemoteFacts {
                kind: "no-remote".into(), ref_name: String::new(),
                ahead: 0, behind: 0, checked_ms: None, error: None,
            },
            last_publish: None,
        };
    }
    let remote_url = git_in(repo, &["remote", "get-url", "origin"]);
    let rref = remote_ref(repo, &branch);
    let (ahead, behind) = rref.as_deref().map(|r| ahead_behind(repo, r)).unwrap_or((0, 0));
    HistoryFacts {
        degraded,
        is_git: true,
        last_save: last_save_of(repo),
        dirty: dirty_set(repo),
        remote: RemoteFacts {
            kind: publish_kind(repo, &remote_url).into(),
            ref_name: rref.unwrap_or_default(),
            ahead,
            behind,
            checked_ms: checked_ms(project_dir),
            error: None,
        },
        last_publish: last_publish_of(repo),
    }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd /Users/tuneerguha/Downloads/chronicle/src-tauri && cargo test history:: 2>&1 | tail -20`
Expected: `test result: ok. 6 passed`.

- [ ] **Step 5: Add the two commands**

Append to `src-tauri/src/history.rs`, above the `#[cfg(test)]` module:

```rust
#[tauri::command]
pub async fn history_facts(roots: State<'_, OpenRoots>, dir: String) -> Result<HistoryFacts, String> {
    let p = crate::project_for(&roots, &dir)?;
    Ok(facts(&p.repo, &p.dir))
}

/// The ONLY fetch in the app, and it only happens when the user clicks
/// "Check now". Nothing fetches on a timer, on the heartbeat, or on pane open.
/// A failure keeps the old numbers and the old checked time and hands the
/// sentence back on the line — the panel never blanks because the wifi dropped.
#[tauri::command]
pub async fn git_fetch(roots: State<'_, OpenRoots>, dir: String) -> Result<HistoryFacts, String> {
    let p = crate::project_for(&roots, &dir)?;
    let out = std::process::Command::new("git").arg("-C").arg(&p.repo)
        .args(["fetch", "--prune", "origin"]).output().map_err(|e| e.to_string())?;
    if out.status.success() {
        store_checked(&p.dir, crate::epoch_ms());
        return Ok(facts(&p.repo, &p.dir));
    }
    let stderr = String::from_utf8_lossy(&out.stderr);
    let sentence = stderr.lines().map(str::trim).filter(|l| !l.is_empty())
        .next_back().unwrap_or("couldn't reach the online copy").to_string();
    let mut f = facts(&p.repo, &p.dir);
    f.remote.error = Some(sentence.chars().take(140).collect());
    Ok(f)
}
```

- [ ] **Step 6: Register the commands**

In `src-tauri/src/main.rs:2952-2981`, add a line inside `generate_handler![…]` next to the git ones:

```rust
            history::history_facts, history::git_fetch,
```

- [ ] **Step 7: Run the whole Rust suite and check**

Run: `cd /Users/tuneerguha/Downloads/chronicle/src-tauri && cargo test 2>&1 | tail -20`
Expected: `138 passed` (132 + 6), 0 failed.

Run: `cd /Users/tuneerguha/Downloads/chronicle/src-tauri && cargo check 2>&1 | grep -c warning`
Expected: `1`.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/history.rs src-tauri/src/main.rs
git commit -m "feat(history): four facts from git, and the only fetch in the app"
```

---

### Task 3 (Lane A): The file commands — read, write, create, rename, trash, reveal

**Files:**
- Create: `src-tauri/src/files.rs`
- Modify: `src-tauri/Cargo.toml` (add `trash = "5.2.8"`), `src-tauri/src/main.rs` (add `mod files;`; **delete** `read_file` at `main.rs:2384-2395`; swap `read_file` for `files::read_file` and add the five new commands in `generate_handler!`)
- Test: `src-tauri/src/files.rs` (`#[cfg(test)] mod tests`)

**Interfaces:**
- Consumes (from `main.rs`): `crate::project_for`, `crate::OpenRoots`, `crate::Project`, `crate::sniff_kind` (make it `pub(crate)` — it is at `main.rs:2185`).
- Produces (Rust, in `crate::files`):
  - `#[derive(Serialize)] pub struct ReadFile { pub text: String, pub mtime_ms: u64, pub size: u64, pub binary: bool, pub too_large: bool }`
  - `pub const MAX_EDIT_BYTES: u64 = 4 * 1024 * 1024;`
  - `pub fn refused(rel: &str) -> Option<String>` — `Some(sentence)` when any path segment is `.git` or `node_modules`.
  - `pub fn jailed_target(p: &Project, rel: &str) -> Result<PathBuf, String>` — like `crate::jailed` but resolves a path that does **not** exist yet, by canonicalising the deepest existing ancestor.
  - `#[tauri::command] pub async fn read_file(roots, dir: String, path: String) -> Result<ReadFile, String>`
  - `#[tauri::command] pub async fn write_file(roots, dir: String, path: String, text: String, expected_mtime_ms: Option<u64>) -> Result<u64, String>` — returns the new mtime in ms. Refuses with the exact string `"changed on disk"` when `expected_mtime_ms` is given and the file's mtime differs.
  - `#[tauri::command] pub async fn create_path(roots, dir: String, path: String, kind: String) -> Result<(), String>` — `kind` is `"file"` or `"dir"`.
  - `#[tauri::command] pub async fn rename_path(roots, dir: String, from: String, to: String) -> Result<(), String>`
  - `#[tauri::command] pub async fn trash_path(roots, dir: String, path: String) -> Result<(), String>`
  - `#[tauri::command] pub async fn reveal_path(roots, dir: String, path: String) -> Result<(), String>`

- [ ] **Step 1: Add the crate**

In `src-tauri/Cargo.toml`, under `[dependencies]`, after `url = "2"`:

```toml
trash = "5.2.8" # Finder's Trash, restorable — the app never unlinks a user's file
```

Run: `cd /Users/tuneerguha/Downloads/chronicle/src-tauri && cargo fetch 2>&1 | tail -3`
Expected: it resolves `trash v5.2.8` with no error.

- [ ] **Step 2: Write the failing tests**

Create `src-tauri/src/files.rs` with the doc comment, `use` lines, types, `unimplemented!()` bodies for `refused` / `jailed_target`, and this test module:

```rust
//! Reading and CHANGING files inside a project. Everything here goes through the
//! same jail as `list_dir`, refuses `.git/` and `node_modules/` outright, writes
//! atomically (temp file beside the target, then rename), and deletes to the
//! user's Trash — never `rm`, never an unlink the user cannot undo from Finder.

use crate::{OpenRoots, Project};
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::State;

#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct ReadFile {
    pub text: String,
    pub mtime_ms: u64,
    pub size: u64,
    pub binary: bool,
    pub too_large: bool,
}

/// Past this the viewer shows the "too large" body and offers no edit affordance.
pub const MAX_EDIT_BYTES: u64 = 4 * 1024 * 1024;

pub fn refused(_rel: &str) -> Option<String> { unimplemented!() }
pub fn jailed_target(_p: &Project, _rel: &str) -> Result<PathBuf, String> { unimplemented!() }

// The tests below drive these five helpers plus `mtime_ms_of`, not the Tauri
// commands — a command takes `State<'_, OpenRoots>`, which no unit test can
// build. Step 4 makes the commands two-line wrappers over exactly these, which
// is the shape `notes/mod.rs` already uses (`write_note` / `move_note` /
// `delete_note` behind `notes_write` / `notes_move` / `notes_delete`).
pub(crate) fn mtime_ms_of(_full: &Path) -> Result<u64, String> { unimplemented!() }
pub(crate) fn read_at(_p: &Project, _rel: &str) -> Result<ReadFile, String> { unimplemented!() }
pub(crate) fn write_at(_p: &Project, _rel: &str, _text: &str, _expected_mtime_ms: Option<u64>) -> Result<u64, String> { unimplemented!() }
pub(crate) fn create_at(_p: &Project, _rel: &str, _kind: &str) -> Result<(), String> { unimplemented!() }
pub(crate) fn rename_at(_p: &Project, _from: &str, _to: &str) -> Result<(), String> { unimplemented!() }
pub(crate) fn trash_at(_p: &Project, _rel: &str) -> Result<(), String> { unimplemented!() }

#[cfg(test)]
mod tests {
    use super::*;

    fn proj(name: &str) -> (PathBuf, Project) {
        let d = std::env::temp_dir().join(format!("chronicle-files-{}-{}", name, std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        let d = d.canonicalize().unwrap();
        let p = Project {
            dir: d.clone(), repo: d.clone(), extras: vec![],
            manifest: None, manifest_error: None,
        };
        (d, p)
    }

    #[test]
    fn the_two_refusals_are_absolute() {
        for bad in [".git/config", ".git", "a/.git/HEAD", "node_modules/x/index.js", "node_modules"] {
            assert!(refused(bad).is_some(), "{bad} must be refused");
        }
        for ok in ["src/main.rs", ".gitignore", "my.git.notes", "node_modules_helper/x.ts"] {
            assert!(refused(ok).is_none(), "{ok} must be allowed");
        }
    }

    #[test]
    fn the_jail_refuses_absolute_dotdot_and_symlinked_escapes() {
        let (root, p) = proj("jail");
        let outside = root.parent().unwrap().join(format!("chronicle-files-outside-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&outside);
        std::fs::create_dir_all(&outside).unwrap();

        assert!(jailed_target(&p, "/etc/passwd").is_err());
        assert!(jailed_target(&p, "../escape.txt").is_err());
        assert!(jailed_target(&p, "a/../../escape.txt").is_err());
        // a symlinked PARENT must be refused even though the leaf is new
        std::os::unix::fs::symlink(&outside, root.join("link")).unwrap();
        assert!(jailed_target(&p, "link/new.txt").is_err());
        // a path that does not exist yet, inside the root, resolves
        assert!(jailed_target(&p, "fresh/deep/new.txt").is_ok());
        let _ = std::fs::remove_dir_all(&outside);
    }

    #[test]
    fn write_is_atomic_keeps_the_mode_and_honours_the_precondition() {
        use std::os::unix::fs::PermissionsExt;
        let (root, p) = proj("write");
        let f = root.join("a.sh");
        std::fs::write(&f, "one\n").unwrap();
        std::fs::set_permissions(&f, std::fs::Permissions::from_mode(0o755)).unwrap();
        let before = mtime_ms_of(&f).unwrap();

        // no precondition: writes, returns a new mtime, leaves 0755
        let m1 = write_at(&p, "a.sh", "two\n", None).unwrap();
        assert_eq!(std::fs::read_to_string(&f).unwrap(), "two\n");
        assert_eq!(std::fs::metadata(&f).unwrap().permissions().mode() & 0o777, 0o755);
        assert!(m1 >= before);
        // no .tmp survives
        let leftovers: Vec<_> = std::fs::read_dir(&root).unwrap().flatten()
            .filter(|e| e.file_name().to_string_lossy().contains(".tmp")).collect();
        assert!(leftovers.is_empty(), "a temp file survived the write");

        // the right precondition: accepted
        let m2 = write_at(&p, "a.sh", "three\n", Some(m1)).unwrap();
        assert_eq!(std::fs::read_to_string(&f).unwrap(), "three\n");

        // a stale precondition: refused with the exact sentence, file untouched
        let err = write_at(&p, "a.sh", "four\n", Some(m2.saturating_sub(5_000))).unwrap_err();
        assert_eq!(err, "changed on disk");
        assert_eq!(std::fs::read_to_string(&f).unwrap(), "three\n");
    }

    #[test]
    fn read_sniffs_binary_and_caps_the_size() {
        let (root, p) = proj("read");
        std::fs::write(root.join("t.txt"), "hello\n").unwrap();
        let r = read_at(&p, "t.txt").unwrap();
        assert_eq!(r.text, "hello\n");
        assert!(!r.binary && !r.too_large);
        assert_eq!(r.size, 6);
        assert!(r.mtime_ms > 1_600_000_000_000);

        // a NUL inside the first 8 KiB
        let mut bytes = vec![b'a'; 100];
        bytes[50] = 0;
        std::fs::write(root.join("b.bin"), &bytes).unwrap();
        let r = read_at(&p, "b.bin").unwrap();
        assert!(r.binary);
        assert_eq!(r.text, "");

        // a NUL AFTER the first 8 KiB is not sniffed — it is still read as text
        let mut late = vec![b'a'; 9000];
        late[8500] = 0;
        std::fs::write(root.join("c.bin"), &late).unwrap();
        assert!(!read_at(&p, "c.bin").unwrap().binary);

        // over the cap
        std::fs::write(root.join("big.txt"), vec![b'x'; (MAX_EDIT_BYTES + 1) as usize]).unwrap();
        let r = read_at(&p, "big.txt").unwrap();
        assert!(r.too_large);
        assert_eq!(r.text, "");
        assert_eq!(r.size, MAX_EDIT_BYTES + 1);
    }

    #[test]
    fn create_refuses_a_collision_and_makes_parents() {
        let (root, p) = proj("create");
        create_at(&p, "docs/deep/new.md", "file").unwrap();
        assert!(root.join("docs/deep/new.md").is_file());
        assert_eq!(std::fs::read_to_string(root.join("docs/deep/new.md")).unwrap(), "");
        assert!(create_at(&p, "docs/deep/new.md", "file").is_err(), "a collision must refuse");
        create_at(&p, "docs/empty", "dir").unwrap();
        assert!(root.join("docs/empty").is_dir());
        assert!(create_at(&p, ".git/hook", "file").is_err());
        assert!(create_at(&p, "node_modules/x", "dir").is_err());
    }

    #[test]
    fn rename_refuses_an_existing_target_and_both_refusals() {
        let (root, p) = proj("rename");
        std::fs::write(root.join("a.txt"), "a\n").unwrap();
        std::fs::write(root.join("b.txt"), "b\n").unwrap();
        assert!(rename_at(&p, "a.txt", "b.txt").is_err(), "must not clobber");
        rename_at(&p, "a.txt", "sub/c.txt").unwrap();
        assert!(root.join("sub/c.txt").is_file());
        assert!(!root.join("a.txt").exists());
        std::fs::create_dir_all(root.join("node_modules")).unwrap();
        assert!(rename_at(&p, "b.txt", "node_modules/b.txt").is_err());
    }

    #[test]
    fn trash_moves_the_file_out_and_never_unlinks_on_failure() {
        let (root, p) = proj("trash");
        std::fs::write(root.join("bye.txt"), "bye\n").unwrap();
        trash_at(&p, "bye.txt").unwrap();
        assert!(!root.join("bye.txt").exists(), "the file left the project");
        // the refusals apply here too
        std::fs::create_dir_all(root.join(".git")).unwrap();
        std::fs::write(root.join(".git/HEAD"), "ref\n").unwrap();
        assert!(trash_at(&p, ".git/HEAD").is_err());
        assert!(root.join(".git/HEAD").exists(), "a refusal never deletes");
    }
}
```

Add `mod files;` beside `mod history;` in `src-tauri/src/main.rs` so the module compiles.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd /Users/tuneerguha/Downloads/chronicle/src-tauri && cargo test files:: 2>&1 | tail -20`
Expected: it **compiles** (every helper the tests call is stubbed) and reports `test result: FAILED. 0 passed; 7 failed`, each one `panicked at 'not implemented'`. A compile error here means a stub is missing — add it rather than skipping ahead.

- [ ] **Step 4: Write the helpers**

Replace all eight `unimplemented!()` bodies in `src-tauri/src/files.rs`:

```rust
/// `.git/` and `node_modules/` are off limits to every write, and `.git/` to
/// reads-for-editing as well. Segment-exact: `.gitignore` and a folder called
/// `node_modules_helper` are ordinary files.
pub fn refused(rel: &str) -> Option<String> {
    for seg in rel.split('/') {
        if seg == ".git" { return Some("that's git's own folder — Chronicle won't touch it".into()); }
        if seg == "node_modules" { return Some("node_modules is installed, not written — leave it to npm".into()); }
    }
    None
}

/// The jail for a path that may not exist yet: canonicalise the deepest existing
/// ancestor, then require it to sit under one of the project's roots. A symlinked
/// parent that leaves the project is refused even when the leaf is new.
pub fn jailed_target(p: &Project, rel: &str) -> Result<PathBuf, String> {
    if rel.is_empty() || rel.starts_with('/') || rel.contains('\0') || rel.split('/').any(|s| s == "..") {
        return Err("that path isn't inside this project".into());
    }
    let full = p.repo.join(rel);
    let mut probe = full.clone();
    while !probe.exists() {
        match probe.parent() { Some(par) => probe = par.to_path_buf(), None => break }
    }
    let real = probe.canonicalize().map_err(|_| "that path isn't inside this project".to_string())?;
    let mut roots: Vec<PathBuf> = vec![p.repo.clone(), p.dir.clone()];
    roots.extend(p.extras.iter().map(|(_, b)| b.clone()));
    let inside = roots.iter().filter_map(|r| r.canonicalize().ok()).any(|r| real.starts_with(&r));
    if !inside { return Err("that path isn't inside this project".into()); }
    if full.symlink_metadata().map(|m| m.file_type().is_symlink()).unwrap_or(false) {
        return Err("that path isn't inside this project".into());
    }
    Ok(full)
}

pub(crate) fn mtime_ms_of(full: &Path) -> Result<u64, String> {
    let md = std::fs::metadata(full).map_err(|e| e.to_string())?;
    let t = md.modified().map_err(|e| e.to_string())?;
    Ok(t.duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0))
}

pub(crate) fn read_at(p: &Project, rel: &str) -> Result<ReadFile, String> {
    if let Some(seg) = rel.split('/').find(|s| *s == ".git") {
        let _ = seg;
        return Err("that's git's own folder — Chronicle won't touch it".into());
    }
    let full = jailed_target(p, rel)?;
    let md = std::fs::metadata(&full).map_err(|e| e.to_string())?;
    let size = md.len();
    let mtime_ms = mtime_ms_of(&full)?;
    if size > MAX_EDIT_BYTES {
        return Ok(ReadFile { text: String::new(), mtime_ms, size, binary: false, too_large: true });
    }
    // the sniff is the viewer's existing one: a NUL in the first 8 KiB
    let mut head = [0u8; 8192];
    let n = std::fs::File::open(&full)
        .and_then(|mut f| std::io::Read::read(&mut f, &mut head)).unwrap_or(0);
    if head[..n].contains(&0) {
        return Ok(ReadFile { text: String::new(), mtime_ms, size, binary: true, too_large: false });
    }
    let bytes = std::fs::read(&full).map_err(|e| e.to_string())?;
    match String::from_utf8(bytes) {
        Ok(text) => Ok(ReadFile { text, mtime_ms, size, binary: false, too_large: false }),
        // valid-UTF-8 is the editable contract; anything else is "binary" here
        Err(_) => Ok(ReadFile { text: String::new(), mtime_ms, size, binary: true, too_large: false }),
    }
}

/// Temp file beside the target, then rename — a crash mid-write can never leave
/// a truncated source file. The mode bits are copied onto the temp file BEFORE
/// the rename, so an executable script stays executable.
pub(crate) fn write_at(p: &Project, rel: &str, text: &str, expected_mtime_ms: Option<u64>) -> Result<u64, String> {
    if let Some(why) = refused(rel) { return Err(why); }
    let full = jailed_target(p, rel)?;
    let existed = full.exists();
    if let Some(expected) = expected_mtime_ms {
        if !existed { return Err("changed on disk".into()); }
        if mtime_ms_of(&full)? != expected { return Err("changed on disk".into()); }
    }
    let parent = full.parent().ok_or("that path has no folder")?;
    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let name = full.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    let tmp = parent.join(format!(".{name}.chronicle-tmp"));
    std::fs::write(&tmp, text).map_err(|e| e.to_string())?;
    if existed {
        if let Ok(md) = std::fs::metadata(&full) {
            let _ = std::fs::set_permissions(&tmp, md.permissions());
        }
    }
    if let Err(e) = std::fs::rename(&tmp, &full) {
        let _ = std::fs::remove_file(&tmp); // never leave a stray temp behind
        return Err(e.to_string());
    }
    mtime_ms_of(&full)
}

pub(crate) fn create_at(p: &Project, rel: &str, kind: &str) -> Result<(), String> {
    if let Some(why) = refused(rel) { return Err(why); }
    let full = jailed_target(p, rel)?;
    if full.exists() { return Err("something with that name is already there".into()); }
    match kind {
        "dir" => std::fs::create_dir_all(&full).map_err(|e| e.to_string()),
        "file" => {
            if let Some(parent) = full.parent() { std::fs::create_dir_all(parent).map_err(|e| e.to_string())?; }
            std::fs::write(&full, "").map_err(|e| e.to_string())
        }
        _ => Err("a new thing is either a file or a folder".into()),
    }
}

pub(crate) fn rename_at(p: &Project, from: &str, to: &str) -> Result<(), String> {
    if let Some(why) = refused(from) { return Err(why); }
    if let Some(why) = refused(to) { return Err(why); }
    let src = jailed_target(p, from)?;
    let dst = jailed_target(p, to)?;
    if !src.exists() { return Err("that file isn't there anymore".into()); }
    if dst.exists() { return Err("something with that name is already there".into()); }
    if let Some(parent) = dst.parent() { std::fs::create_dir_all(parent).map_err(|e| e.to_string())?; }
    std::fs::rename(&src, &dst).map_err(|e| e.to_string())
}

/// Finder's Trash, restorable with ⌘Z in Finder. If the Trash is unavailable
/// (a network volume, a sandboxed path) this REFUSES — it never falls back to
/// deleting the file, because that is the one mistake nobody can undo.
pub(crate) fn trash_at(p: &Project, rel: &str) -> Result<(), String> {
    if let Some(why) = refused(rel) { return Err(why); }
    let full = jailed_target(p, rel)?;
    if !full.exists() { return Err("that file isn't there anymore".into()); }
    trash::delete(&full).map_err(|e| format!("couldn't move it to the Trash — {e}"))
}
```

- [ ] **Step 5: Add the commands**

Append to `src-tauri/src/files.rs`, above the test module:

```rust
#[tauri::command]
pub async fn read_file(roots: State<'_, OpenRoots>, dir: String, path: String) -> Result<ReadFile, String> {
    let p = crate::project_for(&roots, &dir)?;
    read_at(&p, &path)
}

#[tauri::command]
pub async fn write_file(roots: State<'_, OpenRoots>, dir: String, path: String, text: String,
                        expected_mtime_ms: Option<u64>) -> Result<u64, String> {
    let p = crate::project_for(&roots, &dir)?;
    write_at(&p, &path, &text, expected_mtime_ms)
}

#[tauri::command]
pub async fn create_path(roots: State<'_, OpenRoots>, dir: String, path: String, kind: String) -> Result<(), String> {
    let p = crate::project_for(&roots, &dir)?;
    create_at(&p, &path, &kind)
}

#[tauri::command]
pub async fn rename_path(roots: State<'_, OpenRoots>, dir: String, from: String, to: String) -> Result<(), String> {
    let p = crate::project_for(&roots, &dir)?;
    rename_at(&p, &from, &to)
}

#[tauri::command]
pub async fn trash_path(roots: State<'_, OpenRoots>, dir: String, path: String) -> Result<(), String> {
    let p = crate::project_for(&roots, &dir)?;
    trash_at(&p, &path)
}

/// Finder, at the file. Argument vector only — never a shell line.
#[tauri::command]
pub async fn reveal_path(roots: State<'_, OpenRoots>, dir: String, path: String) -> Result<(), String> {
    let p = crate::project_for(&roots, &dir)?;
    let full = jailed_target(&p, &path)?;
    if !full.exists() { return Err("that file isn't there anymore".into()); }
    std::process::Command::new("open").arg("-R").arg(&full).output().map_err(|e| e.to_string())?;
    Ok(())
}
```

- [ ] **Step 6: Retire the old `read_file` and register everything**

- Delete `async fn read_file` at `src-tauri/src/main.rs:2384-2395` entirely.
- Make `sniff_kind` (`main.rs:2185`) `pub(crate) fn sniff_kind` — `files.rs` does its own sniff, but `stat_file` still needs it and the visibility keeps the two honest about the same 8 KiB rule.
- In `generate_handler!` (`main.rs:2952-2981`), replace the bare `read_file` in the `list_dir, file_index, read_file, copy_file, copy_text,` line with:

```rust
            list_dir, file_index, copy_file, copy_text,
            files::read_file, files::write_file, files::create_path,
            files::rename_path, files::trash_path, files::reveal_path,
```

- [ ] **Step 7: Run the tests**

Run: `cd /Users/tuneerguha/Downloads/chronicle/src-tauri && cargo test files:: 2>&1 | tail -20`
Expected: `test result: ok. 7 passed`.

Run: `cd /Users/tuneerguha/Downloads/chronicle/src-tauri && cargo test 2>&1 | tail -20`
Expected: `145 passed` (138 + 7), 0 failed.

Run: `cd /Users/tuneerguha/Downloads/chronicle/src-tauri && cargo check 2>&1 | grep -c warning`
Expected: `1`.

- [ ] **Step 8: Prove the ACL picked the commands up**

Run: `cargo build --manifest-path src-tauri/Cargo.toml 2>&1 | tail -3 && grep -c "write-file\|trash-path" src-tauri/gen/schemas/*.json`
Expected: a non-zero count — `build.rs` regenerated the permission manifest from `generate_handler!`. `src-tauri/capabilities/default.json` is **not** edited; its `"webviews": ["main"]` scoping still applies.

- [ ] **Step 9: Commit**

```bash
git add src-tauri/src/files.rs src-tauri/src/main.rs src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "feat(files): jailed write, create, rename, reveal, and delete to the Trash"
```

---

### Task 4 (Lane B): The typed IPC layer and the buffer store

**Files:**
- Modify: `src/lib/ipc.ts` (`readFile` at `:235-236`; the new wrappers go beside it and beside `gitPull` at `:198`; `StateData` at `:79-109`)
- Modify: `src/App.tsx:476`, `src/screens/roadmap/PhaseDetailHost.tsx:102`, `src/screens/notes/RoundCard.tsx:84`, `src/lib/composer-mentions.ts:81` — each swaps `readFile` for `readFileText`
- Create: `src/lib/repo-editor.ts`, `src/lib/repo-editor.test.ts`

**Interfaces:**
- Consumes (Task 1–3's command shapes; Lane B codes against these before they exist):
  `read_file → { text, mtime_ms, size, binary, too_large }`, `write_file(dir, path, text, expected_mtime_ms?) → number`, `create_path(dir, path, kind)`, `rename_path(dir, from, to)`, `trash_path(dir, path)`, `reveal_path(dir, path)`, `history_facts(dir) → HistoryFacts`, `git_fetch(dir) → HistoryFacts`.
- Produces (TS):
  - In `src/lib/ipc.ts`:
    ```ts
    export interface ReadFileResult { text: string; mtime_ms: number; size: number; binary: boolean; too_large: boolean }
    export type DirtyBadge = "new" | "edited" | "deleted" | "renamed";
    export type PublishKind = "no-remote" | "never-published" | "ok";
    export interface HistoryFacts {
      degraded: boolean; is_git: boolean;
      last_save: { ts: number; subject: string } | null;
      dirty: { code: string; path: string; badge: DirtyBadge }[];
      remote: { kind: PublishKind; ref_name: string; ahead: number; behind: number; checked_ms: number | null; error: string | null };
      last_publish: { ts: number; tag: string | null } | null;
    }
    export const readFile: (dir: string, path: string) => Promise<ReadFileResult>;
    export const readFileText: (dir: string, path: string) => Promise<string>;
    export const writeFile: (dir: string, path: string, text: string, expectedMtimeMs?: number) => Promise<number>;
    export const createPath: (dir: string, path: string, kind: "file" | "dir") => Promise<void>;
    export const renamePath: (dir: string, from: string, to: string) => Promise<void>;
    export const trashPath: (dir: string, path: string) => Promise<void>;
    export const revealPath: (dir: string, path: string) => Promise<void>;
    export const historyFacts: (dir: string) => Promise<HistoryFacts>;
    export const gitFetch: (dir: string) => Promise<HistoryFacts>;
    ```
    and `StateData.dirty` becomes `{ code: string; path: string; badge: DirtyBadge }[]`, plus `published: PublishKind` and `remote_ref: string`.
  - In `src/lib/repo-editor.ts`:
    ```ts
    export type BufferState = "clean" | "dirty" | "saving" | "conflict" | "error";
    export interface Buffer {
      dir: string; path: string; text: string; savedText: string; mtime: number;
      state: BufferState; incoming: { text: string; mtime: number } | null;
      error: string | null; savedAt: number | null;
    }
    export type LangId = "javascript" | "typescript" | "jsx" | "tsx" | "json" | "css" | "html"
      | "markdown" | "rust" | "python" | "shell" | "toml" | "yaml" | "plain";
    export function bufferKey(dir: string, path: string): string;                      // pure
    export function languageIdFor(path: string): LangId;                               // pure
    export function editorConfigTabSize(text: string, relPath: string): number | null;  // pure
    export function saveLabelFor(b: Buffer | null, now: number): string;                // pure
    export function subscribeBuffers(cb: () => void): () => void;
    export function bufferFor(dir: string, path: string): Buffer | null;
    export function openBuffer(dir: string, path: string, text: string, mtime: number): Buffer;
    export function editBuffer(dir: string, path: string, text: string): void;
    export function saveBuffer(dir: string, path: string): Promise<void>;
    export function onFileChanged(dir: string, path: string): Promise<void>;
    export function reloadBuffer(dir: string, path: string): void;
    export function keepMine(dir: string, path: string): void;
    export function closeBuffer(dir: string, path: string): void;
    export function renameBuffer(dir: string, from: string, to: string): void;
    export function dirtyPathsFor(dir: string): string[];
    export function anyDirty(): boolean;
    export function evictBuffers(dir: string): void;
    export function onBufferDisposed(cb: (key: string) => void): () => void;
    export function loadEditorConfig(dir: string): Promise<void>;
    export function tabSizeFor(dir: string, path: string): number;
    ```

- [ ] **Step 1: Write the ipc wrappers**

In `src/lib/ipc.ts`, replace lines 235-236 (`export const readFile = …`) with:

```ts
/** The editable payload: the text, the mtime the next write must match, and the
 *  two reasons a file is view-only (a NUL in the first 8 KiB, or past 4 MiB). */
export interface ReadFileResult {
  text: string;
  mtime_ms: number;
  size: number;
  binary: boolean;
  too_large: boolean;
}
export const readFile = (dir: string, path: string) =>
  invoke<ReadFileResult>("read_file", { dir, path });
/** Just the text — for the callers that only ever wanted a string. */
export const readFileText = (dir: string, path: string) =>
  readFile(dir, path).then((r) => r.text);
/** Atomic write. `expectedMtimeMs` makes it refuse with "changed on disk"
 *  when the file moved under the buffer. Returns the new mtime in ms. */
export const writeFile = (dir: string, path: string, text: string, expectedMtimeMs?: number) =>
  invoke<number>("write_file", { dir, path, text, expectedMtimeMs }); // Rust: expected_mtime_ms
export const createPath = (dir: string, path: string, kind: "file" | "dir") =>
  invoke<void>("create_path", { dir, path, kind });
export const renamePath = (dir: string, from: string, to: string) =>
  invoke<void>("rename_path", { dir, from, to });
/** The user's Trash, restorable from Finder — never an unlink. */
export const trashPath = (dir: string, path: string) =>
  invoke<void>("trash_path", { dir, path });
export const revealPath = (dir: string, path: string) =>
  invoke<void>("reveal_path", { dir, path });
```

Beside `gitPull` (`src/lib/ipc.ts:198`) add:

```ts
/* ---------- the history section (src-tauri/src/history.rs) ---------- */
export type DirtyBadge = "new" | "edited" | "deleted" | "renamed";
export type PublishKind = "no-remote" | "never-published" | "ok";
export interface HistoryFacts {
  degraded: boolean;
  is_git: boolean;
  last_save: { ts: number; subject: string } | null; // ts = unix SECONDS
  dirty: { code: string; path: string; badge: DirtyBadge }[];
  remote: {
    kind: PublishKind;
    ref_name: string; // "origin/react-shadcn" — "" when nothing resolved
    ahead: number;
    behind: number;
    checked_ms: number | null; // null = never checked
    error: string | null; // set only by a failed gitFetch
  };
  last_publish: { ts: number; tag: string | null } | null;
}
export const historyFacts = (dir: string) => invoke<HistoryFacts>("history_facts", { dir });
/** The ONLY fetch in the app — "Check now" and nothing else. */
export const gitFetch = (dir: string) => invoke<HistoryFacts>("git_fetch", { dir });
```

In `StateData` (`src/lib/ipc.ts:97`) change `dirty` and add the two keys:

```ts
  dirty: { code: string; path: string; badge: DirtyBadge }[];
  published: PublishKind;
  remote_ref: string;
```

- [ ] **Step 2: Move the four string-only callers**

In each of `src/App.tsx:476` (its import is at `src/App.tsx:85`), `src/screens/roadmap/PhaseDetailHost.tsx:102`, `src/screens/notes/RoundCard.tsx:84`, `src/lib/composer-mentions.ts:81`, change the call from `readFile(` to `readFileText(` and fix that file's `@/lib/ipc` import list.

Run: `npm run build 2>&1 | tail -20`
Expected: one remaining error, in `src/screens/repo/RepoPane.tsx:376` — `Type 'ReadFileResult' is not assignable to type 'string'`. Task 6 fixes it; leave it.

- [ ] **Step 3: Write the failing store test**

Create `src/lib/repo-editor.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

let diskText = "one\n";
let diskMtime = 1000;
let writeError: string | null = null;
const writes: { path: string; text: string; expected?: number }[] = [];

vi.mock("./ipc", () => ({
  readFile: vi.fn(async () => ({
    text: diskText, mtime_ms: diskMtime, size: diskText.length, binary: false, too_large: false,
  })),
  readFileText: vi.fn(async () => diskText),
  writeFile: vi.fn(async (_d: string, path: string, text: string, expected?: number) => {
    if (writeError) throw writeError;
    writes.push({ path, text, expected });
    diskText = text;
    diskMtime += 100;
    return diskMtime;
  }),
}));

const ed = await import("./repo-editor");

const DIR = "/p";
const F = "src/a.ts";

describe("the repo buffer store", () => {
  beforeEach(() => {
    ed.evictBuffers(DIR);
    diskText = "one\n";
    diskMtime = 1000;
    writeError = null;
    writes.length = 0;
  });

  it("edit then save leaves a clean buffer, and the save carries the expected mtime", async () => {
    ed.openBuffer(DIR, F, "one\n", 1000);
    expect(ed.bufferFor(DIR, F)!.state).toBe("clean");
    ed.editBuffer(DIR, F, "two\n");
    expect(ed.bufferFor(DIR, F)!.state).toBe("dirty");
    expect(ed.dirtyPathsFor(DIR)).toEqual([F]);
    await ed.saveBuffer(DIR, F);
    const b = ed.bufferFor(DIR, F)!;
    expect(b.state).toBe("clean");
    expect(b.savedText).toBe("two\n");
    expect(b.mtime).toBe(1100);
    expect(writes).toEqual([{ path: F, text: "two\n", expected: 1000 }]);
    expect(ed.dirtyPathsFor(DIR)).toEqual([]);
  });

  it("typing the saved text back makes the buffer clean again", () => {
    ed.openBuffer(DIR, F, "one\n", 1000);
    ed.editBuffer(DIR, F, "two\n");
    ed.editBuffer(DIR, F, "one\n");
    expect(ed.bufferFor(DIR, F)!.state).toBe("clean");
  });

  it("a disk change under a CLEAN buffer reloads silently", async () => {
    ed.openBuffer(DIR, F, "one\n", 1000);
    diskText = "from the agent\n";
    diskMtime = 2000;
    await ed.onFileChanged(DIR, F);
    const b = ed.bufferFor(DIR, F)!;
    expect(b.state).toBe("clean");
    expect(b.text).toBe("from the agent\n");
    expect(b.savedText).toBe("from the agent\n");
    expect(b.mtime).toBe(2000);
  });

  it("a disk change under a DIRTY buffer raises the conflict, and Reload takes disk", async () => {
    ed.openBuffer(DIR, F, "one\n", 1000);
    ed.editBuffer(DIR, F, "mine\n");
    diskText = "theirs\n";
    diskMtime = 2000;
    await ed.onFileChanged(DIR, F);
    const b = ed.bufferFor(DIR, F)!;
    expect(b.state).toBe("conflict");
    expect(b.text).toBe("mine\n");
    expect(b.incoming).toEqual({ text: "theirs\n", mtime: 2000 });

    ed.reloadBuffer(DIR, F);
    const after = ed.bufferFor(DIR, F)!;
    expect(after.state).toBe("clean");
    expect(after.text).toBe("theirs\n");
    expect(after.mtime).toBe(2000);
    expect(after.incoming).toBeNull();
  });

  it("Keep mine leaves the buffer and takes the disk mtime so the next save wins", async () => {
    ed.openBuffer(DIR, F, "one\n", 1000);
    ed.editBuffer(DIR, F, "mine\n");
    diskText = "theirs\n";
    diskMtime = 2000;
    await ed.onFileChanged(DIR, F);
    ed.keepMine(DIR, F);
    const b = ed.bufferFor(DIR, F)!;
    expect(b.state).toBe("dirty");
    expect(b.text).toBe("mine\n");
    expect(b.mtime).toBe(2000);
    expect(b.incoming).toBeNull();
    await ed.saveBuffer(DIR, F);
    expect(writes.at(-1)).toEqual({ path: F, text: "mine\n", expected: 2000 });
    expect(ed.bufferFor(DIR, F)!.state).toBe("clean");
  });

  it("our own write echo is ignored — no conflict bar after a save", async () => {
    ed.openBuffer(DIR, F, "one\n", 1000);
    ed.editBuffer(DIR, F, "two\n");
    await ed.saveBuffer(DIR, F);
    await ed.onFileChanged(DIR, F); // the watcher fires for OUR write
    const b = ed.bufferFor(DIR, F)!;
    expect(b.state).toBe("clean");
    expect(b.incoming).toBeNull();
  });

  it("a refused save becomes the conflict, never an error", async () => {
    ed.openBuffer(DIR, F, "one\n", 1000);
    ed.editBuffer(DIR, F, "mine\n");
    diskText = "theirs\n";
    diskMtime = 2000;
    writeError = "changed on disk";
    await ed.saveBuffer(DIR, F);
    const b = ed.bufferFor(DIR, F)!;
    expect(b.state).toBe("conflict");
    expect(b.incoming).toEqual({ text: "theirs\n", mtime: 2000 });
    expect(b.error).toBeNull();
  });

  it("any other write failure is an error that keeps the buffer dirty", async () => {
    ed.openBuffer(DIR, F, "one\n", 1000);
    ed.editBuffer(DIR, F, "mine\n");
    writeError = "Permission denied (os error 13)";
    await ed.saveBuffer(DIR, F);
    const b = ed.bufferFor(DIR, F)!;
    expect(b.state).toBe("error");
    expect(b.text).toBe("mine\n");
    expect(b.error).toContain("Permission denied");
    expect(ed.dirtyPathsFor(DIR)).toEqual([F]);
  });

  it("a rename carries the buffer, its dirt and a fresh undo key", () => {
    const disposed: string[] = [];
    const off = ed.onBufferDisposed((k) => disposed.push(k));
    ed.openBuffer(DIR, F, "one\n", 1000);
    ed.editBuffer(DIR, F, "mine\n");
    ed.renameBuffer(DIR, F, "src/b.ts");
    expect(ed.bufferFor(DIR, F)).toBeNull();
    const b = ed.bufferFor(DIR, "src/b.ts")!;
    expect(b.state).toBe("dirty");
    expect(b.text).toBe("mine\n");
    expect(disposed).toEqual([ed.bufferKey(DIR, F)]);
    off();
  });

  it("closing disposes the buffer and tells the editor to drop its undo history", () => {
    const disposed: string[] = [];
    const off = ed.onBufferDisposed((k) => disposed.push(k));
    ed.openBuffer(DIR, F, "one\n", 1000);
    ed.closeBuffer(DIR, F);
    expect(ed.bufferFor(DIR, F)).toBeNull();
    expect(disposed).toEqual([ed.bufferKey(DIR, F)]);
    expect(ed.anyDirty()).toBe(false);
    off();
  });

  it("subscribers hear a state change but not every keystroke", () => {
    let n = 0;
    const off = ed.subscribeBuffers(() => { n++; });
    ed.openBuffer(DIR, F, "one\n", 1000);
    const afterOpen = n;
    ed.editBuffer(DIR, F, "a\n");   // clean to dirty: one notify
    ed.editBuffer(DIR, F, "ab\n");  // dirty to dirty: silent
    ed.editBuffer(DIR, F, "abc\n"); // dirty to dirty: silent
    expect(n).toBe(afterOpen + 1);
    off();
  });
});

describe("the pure helpers", () => {
  it("names a language for every extension the viewer shows", () => {
    expect(ed.languageIdFor("a/b.ts")).toBe("typescript");
    expect(ed.languageIdFor("a/b.tsx")).toBe("tsx");
    expect(ed.languageIdFor("a/b.mjs")).toBe("javascript");
    expect(ed.languageIdFor("a/b.jsx")).toBe("jsx");
    expect(ed.languageIdFor("a/b.json")).toBe("json");
    expect(ed.languageIdFor("a/b.css")).toBe("css");
    expect(ed.languageIdFor("a/b.html")).toBe("html");
    expect(ed.languageIdFor("a/b.md")).toBe("markdown");
    expect(ed.languageIdFor("a/b.rs")).toBe("rust");
    expect(ed.languageIdFor("a/b.py")).toBe("python");
    expect(ed.languageIdFor("a/b.sh")).toBe("shell");
    expect(ed.languageIdFor("a/b.toml")).toBe("toml");
    expect(ed.languageIdFor("Cargo.lock")).toBe("toml");
    expect(ed.languageIdFor("a/b.yml")).toBe("yaml");
    expect(ed.languageIdFor(".zshrc")).toBe("shell");
    expect(ed.languageIdFor("LICENSE")).toBe("plain");
  });

  it("reads the tab size out of .editorconfig for the matching section", () => {
    const cfg = [
      "root = true",
      "",
      "[*]",
      "indent_style = space",
      "indent_size = 2",
      "",
      "[*.{py,rs}]",
      "indent_size = 4",
      "",
      "[Makefile]",
      "indent_style = tab",
      "tab_width = 8",
    ].join("\n");
    expect(ed.editorConfigTabSize(cfg, "src/a.ts")).toBe(2);
    expect(ed.editorConfigTabSize(cfg, "src/a.py")).toBe(4);
    expect(ed.editorConfigTabSize(cfg, "deep/nest/a.rs")).toBe(4);
    expect(ed.editorConfigTabSize(cfg, "Makefile")).toBe(8);
    expect(ed.editorConfigTabSize("", "a.ts")).toBeNull();
    expect(ed.editorConfigTabSize("[*]\nindent_size = tab\ntab_width = 4", "a.ts")).toBe(4);
    // a later matching section wins over an earlier one
    expect(ed.editorConfigTabSize("[*]\nindent_size=2\n[*.ts]\nindent_size=8", "a.ts")).toBe(8);
  });

  it("says what the header says", () => {
    const base = { dir: DIR, path: F, text: "", savedText: "", mtime: 0, incoming: null, error: null };
    expect(ed.saveLabelFor(null, 0)).toBe("");
    expect(ed.saveLabelFor({ ...base, state: "dirty", savedAt: null }, 0)).toBe("unsaved");
    expect(ed.saveLabelFor({ ...base, state: "saving", savedAt: null }, 0)).toBe("saving");
    expect(ed.saveLabelFor({ ...base, state: "error", error: "Disk full", savedAt: null }, 0)).toBe("Disk full");
    expect(ed.saveLabelFor({ ...base, state: "clean", savedAt: null }, 0)).toBe("");
    expect(ed.saveLabelFor({ ...base, state: "clean", savedAt: 1000 }, 4000)).toBe("saved · 3s ago");
    expect(ed.saveLabelFor({ ...base, state: "clean", savedAt: 0 }, 125_000)).toBe("saved · 2m ago");
    expect(ed.saveLabelFor({ ...base, state: "clean", savedAt: 0 }, 7_200_000)).toBe("saved · 2h ago");
  });

  it("keys a buffer by project and path", () => {
    expect(ed.bufferKey("/p", "a.ts")).not.toBe(ed.bufferKey("/q", "a.ts"));
    expect(ed.bufferKey("/p", "a.ts")).toBe(ed.bufferKey("/p", "a.ts"));
  });
});
```

- [ ] **Step 4: Run it to verify it fails**

Run: `npx vitest run src/lib/repo-editor.test.ts 2>&1 | tail -10`
Expected: `Failed to load ./repo-editor` — the module does not exist.

- [ ] **Step 5: Write the store**

Create `src/lib/repo-editor.ts`:

```ts
/*
 * The Repo pane's unsaved work, outside React so a buffer survives a tab, pane
 * or project switch. There is NO autosave here: code is saved when the user
 * says ⌘S and at no other moment, which is the whole reason this is a separate
 * store from the notes' 600 ms debounce.
 *
 * No timers of any kind live in this file — the watcher's `project-fs-changed`
 * is the only thing that wakes it, and the pane routes that in.
 */
import { readFile, readFileText, writeFile } from "./ipc";

export type BufferState = "clean" | "dirty" | "saving" | "conflict" | "error";

export interface Buffer {
  dir: string;
  path: string;
  /** what the editor holds right now */
  text: string;
  /** what is on disk as far as we know */
  savedText: string;
  /** the mtime the next write must match */
  mtime: number;
  state: BufferState;
  /** the disk version waiting behind the conflict bar */
  incoming: { text: string; mtime: number } | null;
  error: string | null;
  savedAt: number | null;
}

export function bufferKey(dir: string, path: string): string { return `${dir} ${path}`; }

const buffers = new Map<string, Buffer>();
const subs = new Set<() => void>();
const disposers = new Set<(key: string) => void>();
const notify = () => { for (const cb of subs) cb(); };

export function subscribeBuffers(cb: () => void): () => void { subs.add(cb); return () => { subs.delete(cb); }; }
/** CodeMirror's per-buffer EditorState cache hangs off this — the undo history
 *  must die exactly when the buffer does, and not one tab switch earlier. */
export function onBufferDisposed(cb: (key: string) => void): () => void {
  disposers.add(cb);
  return () => { disposers.delete(cb); };
}
const dispose = (key: string) => { for (const cb of disposers) cb(key); };

export function bufferFor(dir: string, path: string): Buffer | null {
  return buffers.get(bufferKey(dir, path)) ?? null;
}

/** Called on the first EDIT, not on open — read-only browsing costs nothing. */
export function openBuffer(dir: string, path: string, text: string, mtime: number): Buffer {
  const existing = buffers.get(bufferKey(dir, path));
  if (existing) return existing;
  const b: Buffer = {
    dir, path, text, savedText: text, mtime,
    state: "clean", incoming: null, error: null, savedAt: null,
  };
  buffers.set(bufferKey(dir, path), b);
  notify();
  return b;
}

export function editBuffer(dir: string, path: string, text: string): void {
  const b = buffers.get(bufferKey(dir, path));
  if (!b) return;
  const was = b.state;
  b.text = text;
  if (b.state !== "conflict") b.state = text === b.savedText ? "clean" : "dirty";
  // A keystroke changes nothing React draws except the save word, and that
  // moves once per cycle — notifying per character re-rendered the whole pane.
  if (b.state !== was) notify();
}

export async function saveBuffer(dir: string, path: string): Promise<void> {
  const b = buffers.get(bufferKey(dir, path));
  if (!b || b.state === "saving" || b.state === "clean") return;
  const text = b.text;
  const expected = b.mtime;
  b.state = "saving";
  b.error = null;
  notify();
  try {
    const mtime = await writeFile(dir, path, text, expected);
    const now = buffers.get(bufferKey(dir, path));
    if (!now) return;
    now.savedText = text;
    now.mtime = mtime;
    now.savedAt = Date.now();
    now.state = now.text === text ? "clean" : "dirty"; // typed on while saving
    now.incoming = null;
  } catch (e) {
    const now = buffers.get(bufferKey(dir, path));
    if (!now) return;
    const msg = String(e);
    if (msg.includes("changed on disk")) {
      // never a toast: the bar is the only place this is said
      await raiseConflict(now);
    } else {
      now.state = "error";
      now.error = msg.slice(0, 140);
    }
  }
  notify();
}

async function raiseConflict(b: Buffer): Promise<void> {
  try {
    const disk = await readFile(b.dir, b.path);
    b.incoming = { text: disk.text, mtime: disk.mtime_ms };
  } catch {
    b.incoming = { text: b.savedText, mtime: b.mtime };
  }
  b.state = "conflict";
  b.error = null;
}

/** The watcher said this path moved — ours or the agent's. */
export async function onFileChanged(dir: string, path: string): Promise<void> {
  const b = buffers.get(bufferKey(dir, path));
  if (!b || b.state === "saving" || b.state === "conflict") return;
  let disk: { text: string; mtime_ms: number };
  try { disk = await readFile(dir, path); } catch { return; }
  const now = buffers.get(bufferKey(dir, path));
  if (!now || now.state === "saving" || now.state === "conflict") return;
  // our own write coming back round: the disk already says what we saved
  if (disk.text === now.savedText) { now.mtime = disk.mtime_ms; notify(); return; }
  if (now.state === "clean") {
    now.text = disk.text;
    now.savedText = disk.text;
    now.mtime = disk.mtime_ms;
    notify();
    return;
  }
  // dirty or error: the bar, never a silent overwrite
  now.incoming = { text: disk.text, mtime: disk.mtime_ms };
  now.state = "conflict";
  now.error = null;
  notify();
}

export function reloadBuffer(dir: string, path: string): void {
  const b = buffers.get(bufferKey(dir, path));
  if (!b?.incoming) return;
  b.text = b.incoming.text;
  b.savedText = b.incoming.text;
  b.mtime = b.incoming.mtime;
  b.state = "clean";
  b.incoming = null;
  b.error = null;
  notify();
}

/** Your text stays; the DISK's mtime comes along, so the next save is accepted. */
export function keepMine(dir: string, path: string): void {
  const b = buffers.get(bufferKey(dir, path));
  if (!b) return;
  if (b.incoming) b.mtime = b.incoming.mtime;
  b.incoming = null;
  b.state = b.text === b.savedText ? "clean" : "dirty";
  b.error = null;
  notify();
}

export function closeBuffer(dir: string, path: string): void {
  const key = bufferKey(dir, path);
  if (!buffers.delete(key)) return;
  dispose(key);
  notify();
}

export function renameBuffer(dir: string, from: string, to: string): void {
  const key = bufferKey(dir, from);
  const b = buffers.get(key);
  if (!b) return;
  buffers.delete(key);
  dispose(key); // the CodeMirror state is keyed by path; a rename starts a new one
  b.path = to;
  buffers.set(bufferKey(dir, to), b);
  notify();
}

export function dirtyPathsFor(dir: string): string[] {
  const out: string[] = [];
  for (const b of buffers.values()) {
    if (b.dir === dir && (b.state === "dirty" || b.state === "conflict" || b.state === "error")) out.push(b.path);
  }
  return out.sort();
}

export function anyDirty(): boolean {
  for (const b of buffers.values()) {
    if (b.state === "dirty" || b.state === "conflict" || b.state === "error") return true;
  }
  return false;
}

export function evictBuffers(dir: string): void {
  for (const [key, b] of [...buffers]) {
    if (b.dir !== dir) continue;
    buffers.delete(key);
    dispose(key);
  }
  editorConfigs.delete(dir);
  notify();
}

/* ---------- the header's word ---------- */

/** `now` is passed in so the function stays pure and the label never claims
 *  more precision than the next render can honour. */
export function saveLabelFor(b: Buffer | null, now: number): string {
  if (!b) return "";
  if (b.state === "saving") return "saving";
  if (b.state === "error") return b.error ?? "couldn't save";
  if (b.state === "conflict") return "";
  if (b.state === "dirty") return "unsaved";
  if (b.savedAt === null) return "";
  const s = Math.floor(Math.max(0, now - b.savedAt) / 1000);
  if (s < 60) return `saved · ${s}s ago`;
  if (s < 3600) return `saved · ${Math.floor(s / 60)}m ago`;
  return `saved · ${Math.round(s / 3600)}h ago`;
}

/* ---------- languages ---------- */

export type LangId =
  | "javascript" | "typescript" | "jsx" | "tsx" | "json" | "css" | "html"
  | "markdown" | "rust" | "python" | "shell" | "toml" | "yaml" | "plain";

const BY_EXT: Record<string, LangId> = {
  js: "javascript", mjs: "javascript", cjs: "javascript",
  ts: "typescript", mts: "typescript", cts: "typescript",
  jsx: "jsx", tsx: "tsx",
  json: "json", jsonc: "json",
  css: "css", scss: "css", less: "css",
  html: "html", htm: "html", svg: "html", vue: "html",
  md: "markdown", markdown: "markdown", mdx: "markdown",
  rs: "rust", py: "python", pyi: "python",
  sh: "shell", bash: "shell", zsh: "shell", fish: "shell",
  toml: "toml", lock: "toml",
  yml: "yaml", yaml: "yaml",
};

const BY_NAME: Record<string, LangId> = {
  ".zshrc": "shell", ".bashrc": "shell", ".bash_profile": "shell", ".profile": "shell",
  dockerfile: "shell", makefile: "plain", ".editorconfig": "toml", ".gitignore": "plain",
};

export function languageIdFor(path: string): LangId {
  const name = (path.split("/").pop() ?? path).toLowerCase();
  const byName = BY_NAME[name];
  if (byName) return byName;
  const i = name.lastIndexOf(".");
  if (i <= 0) return "plain"; // no dot, or a dotfile with no extension
  return BY_EXT[name.slice(i + 1)] ?? "plain";
}

/* ---------- .editorconfig ---------- */

const editorConfigs = new Map<string, string>();

/** Read once per project; a missing file is remembered as "none". */
export async function loadEditorConfig(dir: string): Promise<void> {
  if (editorConfigs.has(dir)) return;
  try { editorConfigs.set(dir, await readFileText(dir, ".editorconfig")); }
  catch { editorConfigs.set(dir, ""); }
}

export function tabSizeFor(dir: string, path: string): number {
  return editorConfigTabSize(editorConfigs.get(dir) ?? "", path) ?? 2;
}

function globToRe(glob: string): RegExp {
  let out = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === "*") {
      if (glob[i + 1] === "*") { out += ".*"; i++; }
      else out += "[^/]*";
    } else if (c === "?") out += "[^/]";
    else if (c === "{") out += "(";
    else if (c === "}") out += ")";
    else if (c === ",") out += "|";
    else out += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${out}$`);
}

function sectionMatches(pattern: string, relPath: string): boolean {
  const re = globToRe(pattern);
  if (re.test(relPath)) return true;
  // a pattern with no slash matches the file name at any depth
  if (!pattern.includes("/")) return re.test(relPath.split("/").pop() ?? relPath);
  return false;
}

/** The last matching section wins, as .editorconfig specifies. `indent_size`
 *  first, and `tab_width` when indent_size is absent or the literal "tab". */
export function editorConfigTabSize(text: string, relPath: string): number | null {
  let matched = false;
  let indentSize: string | null = null;
  let tabWidth: string | null = null;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;
    if (line.startsWith("[") && line.endsWith("]")) {
      matched = sectionMatches(line.slice(1, -1), relPath);
      continue;
    }
    if (!matched) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim().toLowerCase();
    const value = line.slice(eq + 1).trim().toLowerCase();
    if (key === "indent_size") indentSize = value;
    else if (key === "tab_width") tabWidth = value;
  }
  const pick = indentSize && indentSize !== "tab" ? indentSize : tabWidth;
  const n = Number(pick);
  return Number.isFinite(n) && n > 0 && n <= 16 ? n : null;
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run src/lib/repo-editor.test.ts 2>&1 | tail -10`
Expected: `Test Files 1 passed`, `Tests 15 passed`.

Run: `npx vitest run 2>&1 | tail -6`
Expected: `Tests 142 passed` (127 + 15).

- [ ] **Step 7: Commit**

```bash
git add src/lib/ipc.ts src/lib/repo-editor.ts src/lib/repo-editor.test.ts src/App.tsx src/screens/roadmap/PhaseDetailHost.tsx src/screens/notes/RoundCard.tsx src/lib/composer-mentions.ts
git commit -m "feat(repo): the buffer store and the typed file and history commands"
```

`npm run build` still fails on `RepoPane.tsx:376` at this point; Task 6 closes it. Note that in the commit body.

---

### Task 5 (Lane B): CodeMirror 6, themed from the app's tokens

**Files:**
- Modify: `package.json` (fifteen exact pins), `package-lock.json` (regenerated)
- Create: `src/screens/repo/CodeEditor.tsx`

**Interfaces:**
- Consumes (Task 4): `languageIdFor`, `LangId`, `onBufferDisposed`, `bufferKey` from `@/lib/repo-editor`.
- Produces:
  ```tsx
  export type CodeEditorProps = {
    /** identity of the document — `bufferKey(dir, path)`. A change swaps the
     *  EditorState, which is how undo history survives a tab switch. */
    docKey: string;
    text: string;
    language: LangId;
    readOnly: boolean;
    tabSize: number;
    onChange?: (text: string) => void;
    /** Cmd-S inside the editor. The App keymap also fires it from outside. */
    onSave?: () => void;
    className?: string;
  };
  export function CodeEditor(p: CodeEditorProps): JSX.Element;
  ```

- [ ] **Step 1: Pin the packages**

Run exactly this — `--save-exact` is what keeps a caret out of `package.json`:

```bash
npm install --save-exact \
  @codemirror/state@6.7.4 \
  @codemirror/view@6.43.11 \
  @codemirror/commands@6.11.0 \
  @codemirror/language@6.12.4 \
  @codemirror/search@6.7.2 \
  @codemirror/autocomplete@6.20.3 \
  @codemirror/lint@6.9.7 \
  @codemirror/lang-javascript@6.2.5 \
  @codemirror/lang-json@6.0.2 \
  @codemirror/lang-css@6.3.1 \
  @codemirror/lang-html@6.4.12 \
  @codemirror/lang-markdown@6.5.2 \
  @codemirror/lang-rust@6.0.2 \
  @codemirror/lang-python@6.2.1 \
  @codemirror/legacy-modes@6.5.4
```

- [ ] **Step 2: Prove the lock has ONE state and ONE view**

This is the whole risk of the task: a second `@codemirror/state` in the tree makes CodeMirror fail silently — no error, no console warning, just an editor that does not respond. Nine CodeMirror packages were already hoisted here transitively from `@codesandbox/sandpack-react`, so this must be checked, not assumed.

```bash
npm ls @codemirror/state @codemirror/view 2>&1
find node_modules -type d -name state -path "*@codemirror*" | sort
find node_modules -type d -name view -path "*@codemirror*" | sort
```

Expected: `npm ls` shows each package once, at the top level, `deduped` under `@codesandbox/sandpack-react`; and each `find` prints exactly **one** line — `node_modules/@codemirror/state` and `node_modules/@codemirror/view`. If a nested copy appears under `node_modules/@codesandbox/sandpack-react/node_modules/@codemirror/`, stop: `npm dedupe` first, and if that does not clear it, pin the version sandpack's range demands instead and record it as a deviation.

Also confirm the versions actually installed:

```bash
for p in state view commands language search autocomplete lint lang-javascript lang-json lang-css lang-html lang-markdown lang-rust lang-python legacy-modes; do
  echo "$p $(node -p "require('./node_modules/@codemirror/$p/package.json').version")"
done
```
Expected: exactly the fifteen versions from Global Constraints.

- [ ] **Step 3: Write the editor**

Create `src/screens/repo/CodeEditor.tsx`:

```tsx
/*
 * CodeMirror 6, wearing the app's tokens. One component for both the read-only
 * Contents view and the editable one — `EditorState.readOnly` is the only
 * difference, so a file never looks different for being editable.
 *
 * The EditorState is cached per buffer, not per mount: switching tabs and
 * coming back must keep the undo history, and re-creating the state would
 * silently throw it away. `onBufferDisposed` from the store is what drops a
 * cached state, so the cache lives exactly as long as the buffer does.
 *
 * The instance is created on mount and destroyed on unmount — no timers, no
 * observers left behind (the energy rule).
 */
import { useEffect, useRef } from "react";
import { EditorState, Compartment, type Extension } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, highlightSpecialChars, drawSelection, rectangularSelection, crosshairCursor } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { bracketMatching, indentUnit, syntaxHighlighting, HighlightStyle, StreamLanguage } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { markdown } from "@codemirror/lang-markdown";
import { rust } from "@codemirror/lang-rust";
import { python } from "@codemirror/lang-python";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { toml } from "@codemirror/legacy-modes/mode/toml";
import { yaml } from "@codemirror/legacy-modes/mode/yaml";
import { onBufferDisposed, type LangId } from "@/lib/repo-editor";
import { cn } from "@/lib/utils";

/* ---- the theme: every colour is a token, so light and dark both follow ---- */

const chronicleTheme = EditorView.theme({
  "&": {
    height: "100%",
    fontSize: "12px",
    backgroundColor: "var(--surface-input)",
    color: "var(--text-secondary)",
  },
  ".cm-scroller": {
    fontFamily: "var(--font-mono, ui-monospace, monospace)",
    lineHeight: "1.75",
    // wrap off: the editor scrolls sideways, the PAGE never does
    overflowX: "auto",
  },
  ".cm-content": { padding: "12px 0", caretColor: "var(--text-primary)" },
  ".cm-gutters": {
    backgroundColor: "var(--surface-input)",
    color: "var(--text-dimmer)",
    border: "none",
    borderRight: "1px solid var(--divider-faint)",
  },
  ".cm-lineNumbers .cm-gutterElement": {
    padding: "0 12px 0 8px",
    minWidth: "44px",
    fontVariantNumeric: "tabular-nums",
  },
  ".cm-activeLine": { backgroundColor: "var(--fill-subtle)" },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--text-dim)" },
  "&.cm-focused": { outline: "none" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--text-primary)" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
    backgroundColor: "color-mix(in srgb, var(--text-primary) 16%, transparent)",
  },
  ".cm-selectionMatch": { backgroundColor: "color-mix(in srgb, var(--text-primary) 10%, transparent)" },
  ".cm-matchingBracket, &.cm-focused .cm-matchingBracket": {
    backgroundColor: "var(--fill-hover)",
    outline: "1px solid var(--border-hairline)",
  },
  ".cm-panels": {
    backgroundColor: "var(--surface-card-raised)",
    color: "var(--text-secondary)",
    borderTop: "1px solid var(--divider)",
  },
  ".cm-panel input, .cm-panel button": {
    backgroundColor: "var(--surface-input)",
    color: "var(--text-primary)",
    border: "1px solid var(--border-hairline)",
    borderRadius: "4px",
    padding: "1px 5px",
  },
  ".cm-searchMatch": { backgroundColor: "color-mix(in srgb, var(--state-warn) 28%, transparent)" },
  ".cm-searchMatch-selected": { backgroundColor: "color-mix(in srgb, var(--state-warn) 45%, transparent)" },
});

/* The viewer's existing vocabulary: comments dim, everything else on the two
   text tones, with the accent colours only where the deck already uses them. */
const chronicleHighlight = HighlightStyle.define([
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: "var(--text-dim)", fontStyle: "italic" },
  { tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword], color: "var(--text-primary)", fontWeight: "500" },
  { tag: [t.string, t.special(t.string), t.regexp], color: "var(--state-success)" },
  { tag: [t.number, t.bool, t.null, t.atom], color: "var(--state-warn)" },
  { tag: [t.propertyName, t.attributeName], color: "var(--text-secondary)" },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: "var(--text-primary)" },
  { tag: [t.typeName, t.className, t.namespace, t.tagName], color: "var(--text-primary)" },
  { tag: [t.definition(t.variableName), t.definition(t.propertyName)], color: "var(--text-primary)" },
  { tag: [t.variableName], color: "var(--text-secondary)" },
  { tag: [t.operator, t.punctuation, t.separator, t.bracket], color: "var(--text-dim)" },
  { tag: [t.meta, t.processingInstruction], color: "var(--text-dim)" },
  { tag: [t.invalid], color: "var(--state-error)" },
  { tag: [t.heading], color: "var(--text-primary)", fontWeight: "600" },
  { tag: [t.link, t.url], color: "var(--state-success)", textDecoration: "underline" },
  { tag: [t.emphasis], fontStyle: "italic" },
  { tag: [t.strong], fontWeight: "600" },
  { tag: [t.strikethrough], textDecoration: "line-through" },
]);

function languageExtension(id: LangId): Extension[] {
  switch (id) {
    case "javascript": return [javascript()];
    case "jsx": return [javascript({ jsx: true })];
    case "typescript": return [javascript({ typescript: true })];
    case "tsx": return [javascript({ typescript: true, jsx: true })];
    case "json": return [json()];
    case "css": return [css()];
    case "html": return [html()];
    case "markdown": return [markdown()];
    case "rust": return [rust()];
    case "python": return [python()];
    case "shell": return [StreamLanguage.define(shell)];
    case "toml": return [StreamLanguage.define(toml)];
    case "yaml": return [StreamLanguage.define(yaml)];
    case "plain": return [];
  }
}

/* ---- the per-buffer state cache ---- */

const states = new Map<string, EditorState>();
onBufferDisposed((key) => { states.delete(key); });

const langComp = new Compartment();
const roComp = new Compartment();
const tabComp = new Compartment();

export type CodeEditorProps = {
  /** identity of the document — `bufferKey(dir, path)`. */
  docKey: string;
  text: string;
  language: LangId;
  readOnly: boolean;
  tabSize: number;
  onChange?: (text: string) => void;
  onSave?: () => void;
  className?: string;
};

export function CodeEditor({ docKey, text, language, readOnly, tabSize, onChange, onSave, className }: CodeEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  // the callbacks live in refs so a re-render never rebuilds the EditorState
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  onChangeRef.current = onChange;
  onSaveRef.current = onSave;

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const cached = states.get(docKey);
    const state = cached ?? EditorState.create({
      doc: text,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightSpecialChars(),
        history(),
        drawSelection(),
        rectangularSelection(),
        crosshairCursor(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        bracketMatching(),
        syntaxHighlighting(chronicleHighlight),
        chronicleTheme,
        // wrapping is OFF by omission: `EditorView.lineWrapping` is deliberately
        // NOT in this list, and `.cm-scroller { overflow-x: auto }` in the theme
        // gives the editor its own sideways scroll so the page never gets one
        keymap.of([
          // Cmd-S must beat the browser's Save dialog and reach the store
          { key: "Mod-s", preventDefault: true, run: () => { onSaveRef.current?.(); return true; } },
          ...searchKeymap,   // Cmd-F inside the editor
          ...historyKeymap,
          ...defaultKeymap,
          indentWithTab,
        ]),
        langComp.of(languageExtension(language)),
        roComp.of(EditorState.readOnly.of(readOnly)),
        tabComp.of([EditorState.tabSize.of(tabSize), indentUnit.of(" ".repeat(tabSize))]),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) onChangeRef.current?.(u.state.doc.toString());
        }),
      ],
    });
    const v = new EditorView({ state, parent: el });
    view.current = v;
    return () => {
      // keep the state (undo history included) for when this buffer comes back
      states.set(docKey, v.state);
      v.destroy();
      view.current = null;
    };
    // docKey ONLY: text/language/readOnly/tabSize are reconfigured below, and
    // listing them here would tear the undo history down on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docKey]);

  // language, read-only and tab size swap through compartments, in place
  useEffect(() => {
    view.current?.dispatch({ effects: langComp.reconfigure(languageExtension(language)) });
  }, [language]);
  useEffect(() => {
    view.current?.dispatch({ effects: roComp.reconfigure(EditorState.readOnly.of(readOnly)) });
  }, [readOnly]);
  useEffect(() => {
    view.current?.dispatch({ effects: tabComp.reconfigure([
      EditorState.tabSize.of(tabSize), indentUnit.of(" ".repeat(tabSize)),
    ]) });
  }, [tabSize]);

  /* An outside write (Reload, or a silent reload of a clean buffer) replaces
     the document. Guarded on inequality so a keystroke echo is a no-op — the
     store is the source of truth for what is on disk, the view for what is
     being typed. */
  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const current = v.state.doc.toString();
    if (current === text) return;
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: text } });
  }, [text]);

  return <div ref={host} data-selectable className={cn("min-h-0 flex-1 overflow-hidden", className)} />;
}
```

- [ ] **Step 4: Typecheck**

Run: `npm run build 2>&1 | tail -20`
Expected: the same single pre-existing error at `src/screens/repo/RepoPane.tsx:376` and **no** error inside `CodeEditor.tsx`. If `@lezer/highlight` is reported missing, add it with `npm install --save-exact @lezer/highlight@1.2.1` — it is a transitive dependency of `@codemirror/language` and importing it directly needs it declared.

- [ ] **Step 5: Confirm the bundle actually builds the editor in**

```bash
npx vite build 2>&1 | tail -20
```
Expected: the build succeeds (it does not typecheck) and the chunk report lists a bundle a few hundred KB larger than before. If vite reports `Could not resolve "@codemirror/legacy-modes/mode/shell"`, the import path is wrong — the files are `@codemirror/legacy-modes/mode/<name>.js`; check `ls node_modules/@codemirror/legacy-modes/mode/ | head`.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/screens/repo/CodeEditor.tsx
git commit -m "feat(repo): a CodeMirror editor themed from the app tokens"
```

---

### Task 6 (Lane B): The Viewer edits — the text body, the header states, the conflict bar, the dirty dot

**Files:**
- Modify: `src/screens/repo/Viewer.tsx` (delete `CodeSeg`/`CodeLine` at `:17-19` and `CodeView` at `:77-103`; add the `text` body, the save-state header, the conflict bar; `ViewerTab` at `:33`)
- Modify: `src/components/chrome/TabStrip.tsx:30-36` (the `TabDot` union)
- Modify: `src/lib/repo-data.ts:102-110` (delete `codeLines`) and `:8` (drop the `CodeLine` import)
- Modify: `src/screens/repo/preview-fixtures.ts:8, 56-96, 109` (the `CodeLine` import, `pricingLines`, and the `{kind:"code"}` body) — **this file breaks the typecheck if it is missed**
- Modify: `src/overlays/ConfirmDialog.tsx:15-30` (`ConfirmSpec`) and its footer at `:40-52`
- Modify: `src/screens/repo/RepoPane.tsx` (`loadContents` `:339-399`, `openFile` `:431-440`, the watcher effect `:326-335`, `checkFreshness` `:278-293`, the viewer assembly `:662-752`, `evictRepo` `:115-117`)

**Interfaces:**
- Consumes (Task 4 and 5): `readFile`/`ReadFileResult` from `@/lib/ipc`; `bufferFor`, `bufferKey`, `openBuffer`, `editBuffer`, `saveBuffer`, `onFileChanged`, `reloadBuffer`, `keepMine`, `closeBuffer`, `dirtyPathsFor`, `evictBuffers`, `subscribeBuffers`, `saveLabelFor`, `languageIdFor`, `loadEditorConfig`, `tabSizeFor` from `@/lib/repo-editor`; `CodeEditor` from `./CodeEditor`.
- Produces (used by Task 7 and Task 8):
  - `ViewerTab` gains `dirty?: boolean`.
  - `ViewerBody` gains `{ kind: "text"; docKey: string; text: string; language: LangId; readOnly: boolean; tabSize: number }` and loses `{ kind: "code" }`.
  - `ViewerProps` (the `file` arm) gains `saveLabel?: string`, `conflict?: boolean`, `onSave?: () => void`, `onEdit?: (text: string) => void`, `onKeepMine?: () => void`, `onReloadFromDisk?: () => void`.
  - `src/screens/repo/RepoPane.tsx` exports `saveActiveFile(dir: string): void` — what the App keymap's ⌘S calls.
  - `src/screens/repo/RepoPane.tsx` exports `confirmDirty(dir: string, onConfirm: (spec: ConfirmSpec) => void, proceed: () => void): void` — the shared Save / Discard / Cancel prompt, reused by Task 8's project-close and quit paths.
  - `TabDot` gains `"dirty"`.

- [ ] **Step 1: Add the dirty dot to the shared tab strip**

In `src/components/chrome/TabStrip.tsx:30-36`:

```tsx
/** what the tab's leading dot is saying — each has its own colour */
export type TabDot = "loading" | "live" | "local" | "dirty";

const DOT: Record<TabDot, string> = {
  loading: "bg-state-neutral",
  live: "bg-state-success",
  local: "bg-text-subtle",
  dirty: "bg-state-warn",
};
```

- [ ] **Step 2: Rework the Viewer**

In `src/screens/repo/Viewer.tsx`:

Delete `CodeSeg`, `CodeLine` (`:17-19`), the `TONE` map (`:71-75`) and the whole `CodeView` function (`:77-103`). Change the imports at the top to add the editor and drop nothing else:

```tsx
import { CodeEditor } from "./CodeEditor";
import type { LangId } from "@/lib/repo-editor";
```

Replace the first arm of `ViewerBody` (`:25-26`) with:

```tsx
export type ViewerBody =
  | { kind: "text"; docKey: string; text: string; language: LangId; readOnly: boolean; tabSize: number }
  | { kind: "diff"; rows: DiffRow[] }
```

Change `ViewerTab` (`:33`) to:

```tsx
export type ViewerTab = { id: string; name: string; dirty?: boolean };
```

Add to the `file` arm of `ViewerProps`, after `changedOnDisk` (`:50`):

```tsx
      /** "unsaved" | "saving" | "saved · 3s ago" | the OS error sentence. */
      saveLabel?: string;
      /** The file moved on disk while the buffer was dirty — the bar, never a toast. */
      conflict?: boolean;
      onSave?: () => void;
      onEdit?: (text: string) => void;
      onKeepMine?: () => void;
      onReloadFromDisk?: () => void;
```

In the actions bar, change `showActions` (`:170`) and the meta slot (`:219-223`):

```tsx
  const showActions = p.body.kind === "text" || p.body.kind === "diff";
```

```tsx
          {p.mode === "contents" && p.meta && (
            <span className="shrink-0 font-mono text-[11px] text-text-dim tabular-nums">
              {p.meta}
            </span>
          )}
          {p.mode === "contents" && p.saveLabel && (
            <span
              className={cn(
                "shrink-0 text-[11.5px]",
                p.saveLabel === "unsaved" ? "text-state-warn" : "text-text-dim",
              )}
            >
              {p.saveLabel}
            </span>
          )}
```

Pass the dot through to the strip (`:175-181`):

```tsx
      <TabStrip
        label="Open files"
        tabs={p.tabs.map((tab) => ({ id: tab.id, label: tab.name, dot: tab.dirty ? ("dirty" as const) : undefined }))}
        activeId={p.activeTabId}
        onSelect={p.onSelectTab}
        onClose={p.onCloseTab}
      />
```

Replace the "file changed on disk" block (`:263-277`) with the conflict bar — same shape as the notes header's (`src/screens/notes/NoteHeader.tsx:81-88`), same two words:

```tsx
      {/* the file moved on disk under an unsaved buffer — never a silent overwrite */}
      {p.conflict && (
        <div data-chrome className="flex items-center gap-2.5 border-b border-divider bg-fill-subtle px-3.5 py-[7px]">
          <ClockGlyph size={12} className="shrink-0 text-text-subtle" />
          <span className="text-[11.5px] text-text-secondary">
            This file changed on disk while you were editing it.
          </span>
          <span className="flex-1" />
          <button
            onClick={p.onReloadFromDisk}
            className="h-[23px] rounded-sm border border-border-strong px-[9px] text-[11px] font-medium text-text-primary hover:bg-fill-hover"
          >
            Reload
          </button>
          <button
            onClick={p.onKeepMine}
            className="h-[23px] rounded-sm bg-primary px-[9px] text-[11px] font-medium text-primary-foreground hover:bg-(--primary-hover)"
          >
            Keep mine
          </button>
        </div>
      )}

      {/* a clean file that moved on disk reloads itself — this bar is only for
          the Changes view, where there is no buffer to reconcile */}
      {p.changedOnDisk && !p.conflict && (
        <div data-chrome className="flex items-center gap-2.5 border-b border-divider bg-fill-subtle px-3.5 py-[7px]">
          <ClockGlyph size={12} className="shrink-0 text-text-subtle" />
          <span className="text-[11.5px] text-text-secondary">
            File changed on disk while you were reading.
          </span>
          <button
            onClick={p.onReload}
            className="h-[23px] rounded-sm border border-border-strong px-[9px] text-[11px] font-medium text-text-primary hover:bg-fill-hover"
          >
            Reload
          </button>
        </div>
      )}
```

Replace the body render (`:280`) and the bottom copy bar's guard (`:343`):

```tsx
      {p.body.kind === "text" && (
        <CodeEditor
          docKey={p.body.docKey}
          text={p.body.text}
          language={p.body.language}
          readOnly={p.body.readOnly}
          tabSize={p.body.tabSize}
          onChange={p.onEdit}
          onSave={p.onSave}
        />
      )}
```

```tsx
      {p.mode === "contents" && p.body.kind === "text" && (
```

and inside that bottom bar the Copy handler stays `p.onCopy` — RepoPane now copies from the body's `text` instead of joining lines.

- [ ] **Step 3: Delete `codeLines` and the fixture that used it**

In `src/lib/repo-data.ts`, delete the `codeLines` function (`:99-110`) and its section comment, and remove `CodeLine` from the type import at `:8` (leave `DiffRow`).

`src/screens/repo/preview-fixtures.ts` is the other holder of the old body, and the typecheck will not pass until it moves. Change its import at `:8`:

```ts
import type { DiffRow, ViewerProps } from "./Viewer";
```

delete `const pricingLines: CodeLine[] = [ … ];` entirely (`:56-96`), and retype the fixture at `:98-110` to the new body — same frame, same copy, an editable specimen instead of a pre-toned one:

```ts
export const viewerCode: ViewerProps = {
  kind: "file",
  tabs: [
    { id: "pricing", name: "Pricing.tsx", dirty: true },
    { id: "plan", name: "PLAN.md" },
  ],
  activeTabId: "pricing",
  path: "src/screens/Pricing.tsx",
  mode: "contents",
  meta: "tsx · 96 lines",
  saveLabel: "unsaved",
  body: {
    kind: "text",
    docKey: "/preview src/screens/Pricing.tsx",
    text: [
      'import { Tier } from "../components/Tier";',
      "",
      "export function Pricing() {",
      "  return <Tier name=\"Studio\" price={24} />;",
      "}",
    ].join("\n"),
    language: "tsx",
    readOnly: false,
    tabSize: 2,
  },
};
```

Add a second fixture beside it for the conflict state, since that bar is new and the preview harness is where it is looked at:

```ts
export const viewerConflict: ViewerProps = { ...viewerCode, conflict: true, saveLabel: "unsaved" };
```

(`changedOnDisk: true` was on `viewerCode`; it moves to `conflict: true` here, because a contents tab with a buffer never shows the read-only bar any more.)

- [ ] **Step 4: Rework the pane**

In `src/screens/repo/RepoPane.tsx`:

Imports — replace `readFile` and `codeLines` with the editor pieces:

```tsx
import {
  bufferFor, bufferKey, closeBuffer, dirtyPathsFor, editBuffer, evictBuffers,
  keepMine, languageIdFor, loadEditorConfig, onFileChanged, openBuffer,
  reloadBuffer, saveBuffer, saveLabelFor, subscribeBuffers, tabSizeFor,
} from "@/lib/repo-editor";
```

`evictRepo` (`:115-117`) also drops the project's buffers:

```tsx
/** Drop a closed project's cached tree/tab state (memory hygiene). */
export function evictRepo(dir: string): void {
  CACHE.delete(dir);
  evictBuffers(dir);
}
```

`loadContents` (`:339-399`) — the text branch now reads the editable payload and hands the pane a `text` body. Replace the `else { … }` branch at `:375-386` and the `readFile` call:

```tsx
        } else {
          const r = await readFile(d, path);
          if (dirRef.current !== d) return;
          const cur = tab();
          if (!cur || cur.mode !== "contents") return; // switched to diff mid-load
          if (r.too_large) {
            t.sizeBytes = r.size;
            t.body = {
              kind: "huge",
              message: `This file is ${fmtBytes(r.size)}`,
              note: "Too large to open for editing — copying still works.",
            };
            t.meta = undefined;
            t.mtime = st.mtime;
            t.changedOnDisk = false;
            rerender();
            return;
          }
          if (r.binary) {
            t.body = {
              kind: "binary",
              message: "This is a binary file — there's nothing readable to show.",
              note: "Size",
              detail: fmtBytes(r.size),
            };
            t.meta = undefined;
            t.mtime = st.mtime;
            rerender();
            return;
          }
          // the buffer is created on OPEN here rather than on the first
          // keystroke: the editor needs a doc to render, and an untouched
          // buffer is "clean", costs one Map entry, and never writes anything
          openBuffer(d, path, r.text, r.mtime_ms);
          const lines = r.text.split("\n").length;
          t.body = null; // the body is derived from the buffer at render time
          t.editable = !path.split("/").some((s) => s === ".git");
          t.meta = `${extOf(path) || "file"} · ${lines} line${lines === 1 ? "" : "s"}`;
        }
```

Add `editable?: boolean` to `interface TabState` (`:62-74`) and delete `CODE_ROW_CAP` (`:161`) plus every use of it — the editor virtualises its own document, so the 5000-row cap that existed to stop the DOM exploding is gone.

`openFile` (`:431-440`) loads the `.editorconfig` once per project:

```tsx
  const openFile = useCallback((path: string) => {
    const s = stateFor(dir);
    s.selectedId = path;
    if (!s.tabs.find((t) => t.path === path)) {
      s.tabs.push({ path, mode: "contents", body: null });
      void loadEditorConfig(dir);
      loadContents(path);
    }
    s.activeTab = path;
    rerender();
  }, [dir, loadContents, rerender]);
```

The buffer store drives re-renders — add this effect next to the watcher one (after `:335`):

```tsx
  /* the buffer store lives outside React: its save-state changes are what move
     the header word and the tab's dot */
  useEffect(() => subscribeBuffers(rerender), [rerender]);
```

The watcher effect (`:326-335`) also routes the change into the buffers:

```tsx
  useEffect(() => {
    let un: (() => void) | undefined;
    let t: ReturnType<typeof setTimeout> | undefined;
    void listen<string>("project-fs-changed", (ev) => {
      if (ev.payload !== dir) return;
      if (t) clearTimeout(t);
      t = setTimeout(() => {
        refreshTree();
        checkFreshness();
        // every open buffer reconciles: clean reloads silently, dirty raises
        // the bar, and our own write echo is recognised and ignored
        for (const tab of stateFor(dir).tabs) {
          if (bufferFor(dir, tab.path)) void onFileChanged(dir, tab.path);
        }
      }, 450);
    }).then((u) => { un = u; });
    return () => { if (t) clearTimeout(t); un?.(); };
  }, [dir, refreshTree, checkFreshness]);
```

(The 450 ms `setTimeout` is the debounce that already ships here — it is a coalescer for a burst of watcher events, not a recurring timer, so the no-new-timers rule is untouched.)

`checkFreshness` (`:278-293`) must not raise the stale "changed on disk" bar for a path that has a buffer — the buffer owns that story now:

```tsx
      if (tab.mtime == null) continue;
      if (bufferFor(d, tab.path)) continue; // the buffer reconciles this one
```

The viewer assembly (`:662-752`) — the `tabs`, `body`, `saveLabel`, `conflict`, `onEdit`, `onSave`, `onCloseTab` and `onCopy` slots:

```tsx
    const buf = active ? bufferFor(dir, active.path) : null;
    const viewer: ViewerProps = !active
      ? { kind: "empty" }
      : {
          kind: "file",
          tabs: rs.tabs.map((t) => ({
            id: t.path,
            name: splitName(t.path).name,
            dirty: dirtyPathsFor(dir).includes(t.path),
          })),
          activeTabId: active.path,
          path: active.path,
          mode: active.mode,
          meta: active.mode === "contents" ? active.meta : undefined,
          saveLabel: active.mode === "contents" ? saveLabelFor(buf, Date.now()) : undefined,
          conflict: active.mode === "contents" && buf?.state === "conflict",
          diffStat: active.mode === "diff" ? active.diffStat : undefined,
          readyToSave:
            active.mode === "diff" &&
            !!gitStatus?.staged.some((f) => f.path === active.path) &&
            !gitStatus?.unstaged.some((f) => f.path === active.path),
          changedOnDisk: active.changedOnDisk,
          // the F36 agent-review block from RepoPane.tsx:677-706 moves here
          // unchanged, character for character — it is untouched by this task
          review: active.agentReview && rs.review ? { /* lines 679-705, verbatim */ } : undefined,
          body:
            active.mode === "contents" && buf
              ? {
                  kind: "text",
                  docKey: bufferKey(dir, active.path),
                  text: buf.text,
                  language: languageIdFor(active.path),
                  readOnly: active.editable === false,
                  tabSize: tabSizeFor(dir, active.path),
                }
              : active.body ?? (active.mode === "contents"
                  // a contents tab still loading: an empty read-only editor, not
                  // an empty DiffView (which draws a blank Changes surface under
                  // a header that says Contents)
                  ? {
                      kind: "text" as const,
                      docKey: bufferKey(dir, active.path),
                      text: "",
                      language: "plain" as const,
                      readOnly: true,
                      tabSize: 2,
                    }
                  : { kind: "diff" as const, rows: [] }),
          onEdit: (text) => editBuffer(dir, active.path, text),
          onSave: () => { void saveBuffer(dir, active.path); },
          onKeepMine: () => keepMine(dir, active.path),
          onReloadFromDisk: () => reloadBuffer(dir, active.path),
          onSelectTab: (id) => { rs.activeTab = id; rs.selectedId = id; rerender(); },
          onCloseTab: (id) => {
            const closeIt = () => {
              const i = rs.tabs.findIndex((t) => t.path === id);
              if (i >= 0) rs.tabs.splice(i, 1);
              closeBuffer(dir, id);
              if (rs.activeTab === id) rs.activeTab = rs.tabs[Math.max(0, i - 1)]?.path ?? null;
              rs.selectedId = rs.activeTab; // the tree follows the viewer
              rerender();
            };
            if (dirtyPathsFor(dir).includes(id)) confirmDirtyOne(dir, id, onConfirm, closeIt);
            else closeIt();
          },
          onCopy: () => {
            if (active.mode === "contents" && buf) {
              copyText(buf.text)
                .then(() => toastSuccess("Contents copied"))
                .catch((e) => toastError("Couldn't copy", String(e).slice(0, 90)));
            } else if (active.body?.kind === "huge" && (active.sizeBytes ?? 0) <= 5_000_000) {
              copyFileIpc(dir, active.path)
                .then((n) => toastSuccess("Contents copied", `${Number(n).toLocaleString()} characters`))
                .catch((e) => toastError("Couldn't copy", String(e).slice(0, 90)));
            }
          },
          // onModeChange / onReload / onRetry / onOpenAnyway / onOpenInWeb:
          // keep the existing blocks verbatim
        };
```

Keep the existing `review`, `onModeChange`, `onReload`, `onRetry`, `onOpenAnyway` and `onOpenInWeb` blocks exactly as they are today (`:677-752`) — this listing shows only the slots that change.

- [ ] **Step 5: Add the two exported helpers**

At the end of `src/screens/repo/RepoPane.tsx`, outside the component:

```tsx
/** ⌘S from anywhere: save whatever the repo pane has open for this project. */
export function saveActiveFile(dir: string): void {
  const s = CACHE.get(dir);
  if (!s?.activeTab) return;
  void saveBuffer(dir, s.activeTab);
}

/** One file with unsaved work is about to go away. */
function confirmDirtyOne(
  dir: string,
  path: string,
  onConfirm: (spec: ConfirmSpec) => void,
  proceed: () => void,
): void {
  onConfirm({
    title: `Save ${splitName(path).name}?`,
    body: "It has changes you haven't saved yet.",
    cancelLabel: "Cancel",
    confirmLabel: "Save",
    onConfirm: () => { void saveBuffer(dir, path).then(proceed); },
    altLabel: "Discard",
    onAlt: () => { proceed(); },
  });
}

/** Every file with unsaved work in this project is about to go away — closing
 *  the project, or quitting. One prompt, three answers. */
export function confirmDirty(
  dir: string,
  onConfirm: (spec: ConfirmSpec) => void,
  proceed: () => void,
): void {
  const paths = dirtyPathsFor(dir);
  if (paths.length === 0) { proceed(); return; }
  if (paths.length === 1) { confirmDirtyOne(dir, paths[0]!, onConfirm, proceed); return; }
  onConfirm({
    title: `Save ${paths.length} files?`,
    body: `${paths.map((p) => splitName(p).name).join(", ")} have changes you haven't saved yet.`,
    cancelLabel: "Cancel",
    confirmLabel: "Save them",
    onConfirm: () => { void Promise.all(paths.map((p) => saveBuffer(dir, p))).then(proceed); },
    altLabel: "Discard",
    onAlt: () => { proceed(); },
  });
}
```

- [ ] **Step 6: Give `ConfirmSpec` a third button**

`src/overlays/ConfirmDialog.tsx` today offers Cancel and Confirm only. Add the optional middle answer:

```tsx
  /** A third answer between Cancel and Confirm — "Discard" on the save prompt.
   *  Absent on every other confirm, which stays a two-button dialog. */
  altLabel?: string;
  onAlt?: () => void;
```

and render it in the footer, before the confirm button, with the secondary button styling the cancel button already uses. Read the file first (`src/overlays/ConfirmDialog.tsx`) and match its existing markup; do not restyle the dialog.

- [ ] **Step 7: Typecheck and run the suite**

Run: `npm run build 2>&1 | tail -20`
Expected: no errors — the `RepoPane.tsx:376` error from Task 4 is now closed. If `src/screens/repo/preview-fixtures.ts` is still named here, Step 3's second half was skipped: that file imports `CodeLine` and builds a `{kind:"code"}` body, and both are gone.

Run: `grep -rn "kind: \"code\"\|CodeLine\|codeLines" src/`
Expected: no output at all.

Run: `npx vitest run 2>&1 | tail -6`
Expected: `Tests 142 passed`, unchanged (this task adds no unit tests; it is verified by the type checker and by Task 9's live test — `vitest.config.ts:6-8` keeps components out of jsdom on purpose).

- [ ] **Step 8: Commit**

```bash
git add src/screens/repo/Viewer.tsx src/screens/repo/RepoPane.tsx src/screens/repo/preview-fixtures.ts src/lib/repo-data.ts src/components/chrome/TabStrip.tsx src/overlays/ConfirmDialog.tsx
git commit -m "feat(repo): edit in the Contents view, with the conflict bar and a dirty dot"
```

---

### Task 7 (Lane B): New file, new folder, rename, reveal, delete to the Trash

**Files:**
- Modify: `src/screens/repo/FileTree.tsx` (`TreeNode` `:24-40`, `FileTreeProps` `:42-53`, `Row` `:78-185`, the header `:191-199`)
- Modify: `src/lib/repo-data.ts` (`buildTree` `:53-88` takes the pending row)
- Modify: `src/screens/repo/RepoPane.tsx` (the tree assembly `:623-641`, `RepoState` `:76-91`)
- Create: `src/lib/repo-data.test.ts`

**Interfaces:**
- Consumes (Task 3 / Task 4): `createPath`, `renamePath`, `trashPath`, `revealPath` from `@/lib/ipc`; `renameBuffer`, `closeBuffer`, `dirtyPathsFor` from `@/lib/repo-editor`; `sanitizeTitle` from `@/lib/notes-model`; `isHtmlPath` from `@/lib/web-url` (already imported in RepoPane at `:54`).
- Produces:
  - `TreeNode` gains `| { kind: "input"; id: string; placeholder: string; initial: string; error?: string }`.
  - `FileTreeProps` gains:
    ```ts
    pendingId?: string | null;          // the id of the "input" row, or the row being renamed
    renamingId?: string | null;
    nameError?: string | null;
    onNewFile?: () => void;
    onNewFolder?: () => void;
    onCommitName?: (value: string) => void;
    onCancelName?: () => void;
    onRename?: (id: string) => void;
    onReveal?: (id: string) => void;
    onDelete?: (id: string) => void;
    onOpenInWeb?: (id: string) => void;
    ```
  - `buildTree(loads, expanded, changed, gitByPath, workspaces, parent?, pending?)` where `pending` is `{ parent: string; kind: "file" | "dir" } | null`.
  - `src/lib/repo-data.ts` exports `nextFreeName(taken: Set<string>, base: string): string` and `newPathIn(folder: string, name: string): string` — both pure, both tested.

- [ ] **Step 1: Write the failing pure test**

Create `src/lib/repo-data.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildTree, newPathIn, nextFreeName, type DirLoad } from "./repo-data";
import type { GitLetter } from "@/screens/repo/FileTree";

const ready = (names: [string, boolean][]): DirLoad => ({
  kind: "ready",
  entries: names.map(([name, is_dir]) => ({ name, is_dir, size: 0 })),
});

describe("new-name helpers", () => {
  it("joins a name into a folder, and the root has no leading slash", () => {
    expect(newPathIn("", "a.ts")).toBe("a.ts");
    expect(newPathIn("src", "a.ts")).toBe("src/a.ts");
    expect(newPathIn("src/lib", "a.ts")).toBe("src/lib/a.ts");
  });

  it("finds the next free name rather than clobbering", () => {
    const taken = new Set(["src/a.ts", "src/a 2.ts"]);
    expect(nextFreeName(taken, "src/b.ts")).toBe("src/b.ts");
    expect(nextFreeName(taken, "src/a.ts")).toBe("src/a 3.ts");
    expect(nextFreeName(new Set(["src/x"]), "src/x")).toBe("src/x 2");
  });
});

describe("the tree's pending row", () => {
  const loads = new Map<string, DirLoad>([
    ["", ready([["src", true], ["README.md", false]])],
    ["src", ready([["a.ts", false]])],
  ]);
  const noChange = new Set<string>();
  const noGit = new Map<string, GitLetter>();
  const noWs = new Set<string>();

  it("puts the input row first inside the folder being added to", () => {
    const roots = buildTree(loads, new Set(["src"]), noChange, noGit, noWs, "", { parent: "src", kind: "file" });
    const src = roots.find((n) => n.id === "src");
    expect(src?.kind).toBe("dir");
    if (src?.kind !== "dir") throw new Error("src is a folder");
    expect(src.children[0]?.kind).toBe("input");
    expect(src.children[1]?.id).toBe("src/a.ts");
  });

  it("puts it at the top level when the root is the target", () => {
    const roots = buildTree(loads, new Set(), noChange, noGit, noWs, "", { parent: "", kind: "dir" });
    expect(roots[0]?.kind).toBe("input");
    expect(roots[1]?.id).toBe("src");
  });

  it("adds nothing when nothing is pending", () => {
    const roots = buildTree(loads, new Set(), noChange, noGit, noWs, "", null);
    expect(roots.some((n) => n.kind === "input")).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/repo-data.test.ts 2>&1 | tail -10`
Expected: `nextFreeName is not exported` / `newPathIn is not exported`, and a type error on `buildTree`'s seventh argument.

- [ ] **Step 3: Add the pure helpers and the pending row**

In `src/lib/repo-data.ts`, add beside `splitName` (`:197`):

```ts
/** A folder plus a name, with no leading slash at the root. */
export function newPathIn(folder: string, name: string): string {
  return folder ? `${folder}/${name}` : name;
}

/** `a.ts` taken becomes `a 2.ts`, then `a 3.ts` — the notes' rule, applied to
 *  a repo path so nothing is ever silently overwritten by a create. */
export function nextFreeName(taken: Set<string>, base: string): string {
  if (!taken.has(base)) return base;
  const { name, dir } = splitName(base);
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  for (let n = 2; ; n++) {
    const cand = newPathIn(dir, `${stem} ${n}${ext}`);
    if (!taken.has(cand)) return cand;
  }
}
```

and extend `buildTree` (`:53-88`):

```ts
export function buildTree(
  loads: Map<string, DirLoad>,
  expanded: Set<string>,
  changed: Set<string>,
  gitByPath: Map<string, GitLetter>,
  workspaces: Set<string>,
  parent = "",
  /** The row being typed into: an empty name field inside `parent`. */
  pending: { parent: string; kind: "file" | "dir" } | null = null,
): TreeNode[] {
  const load = loads.get(parent);
  if (!load) return [];
  if (load.kind === "loading")
    return [{ kind: "loading", id: `${parent}#loading`, label: `Reading ${parent.split("/").pop() || "the project"}…` }];
  if (load.kind === "error")
    return [{ kind: "error", id: parent || "#root", message: "Couldn't read this folder" }];
  const rows = load.entries.map((e): TreeNode => {
    const id = parent ? `${parent}/${e.name}` : e.name;
    if (e.is_dir) {
      const open = expanded.has(id);
      const childLoad = loads.get(id);
      const empty = childLoad?.kind === "ready" && childLoad.entries.length === 0 && !(pending?.parent === id);
      return {
        kind: "dir",
        id,
        name: e.name,
        open,
        children: childLoad ? buildTree(loads, expanded, changed, gitByPath, workspaces, id, pending) : [],
        hasChanges: changed.has(id),
        empty,
        workspace: workspaces.has(id),
      };
    }
    return { kind: "file", id, name: e.name, git: gitByPath.get(id) };
  });
  if (pending && pending.parent === parent) {
    rows.unshift({
      kind: "input",
      id: `${parent}#new`,
      placeholder: pending.kind === "dir" ? "Folder name" : "File name",
      initial: "",
    });
  }
  return rows;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/repo-data.test.ts 2>&1 | tail -10`
Expected: `Tests 5 passed`.

- [ ] **Step 5: Draw the new tree parts**

In `src/screens/repo/FileTree.tsx`:

Add the node kind (`:24-40`):

```tsx
  | { kind: "input"; id: string; placeholder: string; initial: string; error?: string };
```

Add the props (`:42-53`) exactly as listed in Interfaces above.

Add the imports (`isHtmlPath` is used by the row menu below; `FileTree.tsx` does not import it today):

```tsx
import { useState, type ReactNode } from "react";
import {
  ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { FolderPlusGlyph, PlusGlyph } from "@/components/chrome/icons";
import { isHtmlPath } from "@/lib/web-url";
```

The name field — one component used for both a new entry and a rename:

```tsx
/** Enter commits, Escape cancels, blur commits (the notes sidebar's rule).
 *  Names go through the same sanitiser a note title does, so nothing typed
 *  here can carry a separator or a leading dot into a path. */
function NameField({
  depth, initial, placeholder, error, onCommit, onCancel,
}: {
  depth: number;
  initial: string;
  placeholder: string;
  error?: string | null;
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <div className={cn("flex flex-col gap-[3px] py-[3px]", depth === 0 && "ml-[13px]")}>
      <input
        autoFocus
        value={value}
        placeholder={placeholder}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => onCommit(value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); onCommit(value); }
          else if (e.key === "Escape") { e.preventDefault(); onCancel(); }
        }}
        className={cn(
          "h-[24px] w-full rounded-[5px] border bg-surface-input px-1.5 text-[12px] text-text-primary outline-none",
          error ? "border-state-error" : "border-border-strong",
        )}
      />
      {error && <span className="px-1 text-[10.5px] text-state-error">{sentence(error)}</span>}
    </div>
  );
}
```

`Row` (`FileTree.tsx:78-185`) is a closed local component that recurses through `TreeGuide`, so every new callback has to be threaded through its signature **and** through the recursive call at `:169-178`. Replace its parameter list and its type (`:78-95`) with this — the six new entries are `renamingId`, `nameError`, `onCommitName`, `onCancelName`, `onRename`, `onReveal`, `onDelete`, `onOpenInWeb`:

```tsx
type RowHandlers = {
  selectedId?: string | null;
  renamingId?: string | null;
  nameError?: string | null;
  onSelect?: (id: string) => void;
  onToggleDir?: (id: string) => void;
  onRetry?: (id: string) => void;
  onCommitName?: (value: string) => void;
  onCancelName?: () => void;
  onRename?: (id: string) => void;
  onReveal?: (id: string) => void;
  onDelete?: (id: string) => void;
  onOpenInWeb?: (id: string) => void;
};

function Row({
  node,
  depth,
  notFirstRoot,
  ...h
}: RowHandlers & {
  node: TreeNode;
  depth: number;
  /** Second+ roots get a 4px separation margin (deck F23). */
  notFirstRoot?: boolean;
}) {
```

Everything inside `Row` then reads `h.selectedId`, `h.onSelect`, `h.onToggleDir`, `h.onRetry` where it used to read the bare names — and the recursive call at `:169-178` becomes one spread instead of five props:

```tsx
            {node.children.map((child) => (
              <Row key={child.id} node={child} depth={depth + 1} {...h} />
            ))}
```

`FileTree`'s own map at `:201-212` does the same:

```tsx
        {p.roots.map((node, i) => (
          <Row
            key={node.id}
            node={node}
            depth={0}
            notFirstRoot={i > 0}
            selectedId={p.selectedId}
            renamingId={p.renamingId}
            nameError={p.nameError}
            onSelect={p.onSelect}
            onToggleDir={p.onToggleDir}
            onRetry={p.onRetry}
            onCommitName={p.onCommitName}
            onCancelName={p.onCancelName}
            onRename={p.onRename}
            onReveal={p.onReveal}
            onDelete={p.onDelete}
            onOpenInWeb={p.onOpenInWeb}
          />
        ))}
```

Then handle the new kind first, before the `loading` branch:

```tsx
  if (node.kind === "input") {
    return (
      <NameField
        depth={depth}
        initial={node.initial}
        placeholder={node.placeholder}
        error={h.nameError}
        onCommit={(v) => h.onCommitName?.(v)}
        onCancel={() => h.onCancelName?.()}
      />
    );
  }
```

and for a file (`:120-141`) and a folder (`:144-165`), when `node.id === renamingId` render the `NameField` seeded with the current name instead of the row:

```tsx
    if (node.id === h.renamingId) {
      return (
        <NameField
          depth={depth}
          initial={node.name}
          placeholder="New name"
          error={h.nameError}
          onCommit={(v) => h.onCommitName?.(v)}
          onCancel={() => h.onCancelName?.()}
        />
      );
    }
```

The menu itself is one local component, so the right-click target and the hover ⋯ open exactly the same list (the spec asks for both: "right-click, and a ⋯ on hover for the selected row"). `ContextMenuItem` already takes `variant="destructive"` (`src/components/ui/context-menu.tsx:114-122`).

```tsx
/** The row's operations. Right-click anywhere on the row opens it; so does the
 *  ⋯ that appears on hover and stays put on the selected row, for anyone who
 *  does not think to right-click. */
function RowMenu({ node, selected, children, ...h }: RowHandlers & {
  node: Extract<TreeNode, { kind: "file" | "dir" }>;
  selected: boolean;
  children: ReactNode;
}) {
  const items = (
    <>
      <ContextMenuItem onSelect={() => h.onRename?.(node.id)}>Rename…</ContextMenuItem>
      <ContextMenuItem onSelect={() => h.onReveal?.(node.id)}>Reveal in Finder</ContextMenuItem>
      {node.kind === "file" && isHtmlPath(node.name) && (
        <ContextMenuItem onSelect={() => h.onOpenInWeb?.(node.id)}>Open in Web</ContextMenuItem>
      )}
      <ContextMenuSeparator />
      <ContextMenuItem variant="destructive" onSelect={() => h.onDelete?.(node.id)}>Delete…</ContextMenuItem>
    </>
  );
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-[190px]">{items}</ContextMenuContent>
    </ContextMenu>
  );
}

/** The ⋯ itself, for the row's `trailing` slot. It reserves no width when
 *  hidden because it sits beside the git badge, which already occupies the
 *  slot — `invisible` keeps the row from reflowing on hover. */
function RowDots({ onOpen, shown }: { onOpen: () => void; shown: boolean }) {
  return (
    <TreeIconButton
      aria-label="More"
      onClick={(e) => { e.stopPropagation(); onOpen(); }}
      className={cn("size-[18px] rounded-[4px] text-[11px]", !shown && "invisible group-hover/row:visible")}
    >
      ⋯
    </TreeIconButton>
  );
}
```

Wrap the returned `TreeRow` (`:124-139`) and `TreeFolderRow` (`:146-165`) in `RowMenu`, give the row `className="group/row"`, and put the ⋯ in its `trailing` slot beside the existing badge or dot. For a file:

```tsx
    return (
      <RowMenu node={node} selected={selected} {...h}>
        <div className="group/row">
          <TreeRow
            depth={depth}
            name={node.name}
            selected={selected}
            dimmed={deleted}
            struck={deleted}
            className="w-full"
            icon={
              <DocGlyph
                size={13}
                strokeWidth={1.2}
                className={cn("shrink-0", deleted && !selected ? "text-current" : "text-text-subtle")}
              />
            }
            after={<></>}
            trailing={
              <span className="flex shrink-0 items-center gap-1">
                {node.git && <GitBadge letter={node.git} />}
                <RowDots shown={selected} onOpen={() => h.onRename?.(node.id)} />
              </span>
            }
            onClick={() => h.onSelect?.(node.id)}
          />
        </div>
      </RowMenu>
    );
```

The folder row takes the same treatment, with `node.hasChanges`'s dot in place of the git badge.

**One note on the ⋯'s click.** `ContextMenuTrigger` opens on right-click only, so the ⋯ cannot "click to open the same menu" without a second trigger. Give `RowDots` an `onOpen` that dispatches a synthetic contextmenu event on the row — the smallest thing that keeps ONE menu definition:

```tsx
      onClick={(e) => {
        e.stopPropagation();
        const row = e.currentTarget.closest(".group\\/row") as HTMLElement | null;
        const box = (row ?? e.currentTarget).getBoundingClientRect();
        (row ?? e.currentTarget).dispatchEvent(new MouseEvent("contextmenu", {
          bubbles: true, clientX: box.right - 8, clientY: box.bottom,
        }));
      }}
```

(Replace `onOpen` with this handler inside `RowDots` and drop the prop; `shown` stays.)

The head (`:191-199`) gains the two buttons, left of the history clock:

```tsx
      <TreeHeader label={`Explorer · ${n} ${n === 1 ? "root" : "roots"}`}>
        <TreeIconButton aria-label="New file" title="New file" onClick={p.onNewFile}>
          <PlusGlyph size={13} />
        </TreeIconButton>
        <TreeIconButton aria-label="New folder" title="New folder" onClick={p.onNewFolder}>
          <FolderPlusGlyph size={13} />
        </TreeIconButton>
        <TreeIconButton
          aria-label="Project history"
          title="Project history — saves, publish, bring down"
          onClick={p.onOpenHistory}
        >
          <HistoryClockGlyph size={13} />
        </TreeIconButton>
      </TreeHeader>
```

- [ ] **Step 6: Wire the operations in the pane**

In `src/screens/repo/RepoPane.tsx`, add to `RepoState` (`:76-91`):

```tsx
  /** A name being typed: a new entry in `parent`, or a rename of `renaming`. */
  pending: { parent: string; kind: "file" | "dir" } | null;
  renaming: string | null;
  nameError: string | null;
```

(and `pending: null, renaming: null, nameError: null` in `stateFor`'s initialiser at `:97-108`.)

The folder an operation acts on — the selected row's folder, or the root:

```tsx
  /** "the selected folder, or the root" — a file's own folder counts. */
  const targetFolder = useCallback((): string => {
    const id = rs.selectedId;
    if (!id) return "";
    const load = rs.loads.get(id);
    if (load) return id;              // the selection is a folder we have listed
    return splitName(id).dir;         // a file: its folder
  }, [rs]);
```

Then the callbacks, added next to `onToggleDir` (`:444-452`):

```tsx
  const startNew = useCallback((kind: "file" | "dir") => {
    const parent = targetFolder();
    const s = stateFor(dir);
    s.pending = { parent, kind };
    s.renaming = null;
    s.nameError = null;
    if (parent && !s.expanded.has(parent)) {
      s.expanded.add(parent);
      if (!s.loads.has(parent)) loadDir(parent);
    }
    rerender();
  }, [dir, targetFolder, loadDir, rerender]);

  const cancelName = useCallback(() => {
    const s = stateFor(dir);
    s.pending = null;
    s.renaming = null;
    s.nameError = null;
    rerender();
  }, [dir, rerender]);

  const commitName = useCallback((raw: string) => {
    const s = stateFor(dir);
    // the notes' sanitiser: separators become dashes, a leading dot goes, so
    // nothing typed into the tree can walk out of the folder it was typed in
    const name = sanitizeTitle(raw);
    if (!name) { cancelName(); return; }
    const done = () => { cancelName(); refreshTree(); };
    const fail = (e: unknown) => {
      stateFor(dir).nameError = String(e).slice(0, 90);
      rerender();
    };
    if (s.renaming) {
      const from = s.renaming;
      const to = newPathIn(splitName(from).dir, name);
      if (to === from) { cancelName(); return; }
      renamePath(dir, from, to)
        .then(() => {
          // the open tab, its buffer and its dirt follow the file
          const t = stateFor(dir).tabs.find((x) => x.path === from);
          if (t) t.path = to;
          renameBuffer(dir, from, to);
          if (stateFor(dir).activeTab === from) stateFor(dir).activeTab = to;
          if (stateFor(dir).selectedId === from) stateFor(dir).selectedId = to;
          done();
        })
        .catch(fail);
      return;
    }
    if (!s.pending) { cancelName(); return; }
    const { parent, kind } = s.pending;
    const path = newPathIn(parent, name);
    createPath(dir, path, kind === "dir" ? "dir" : "file")
      .then(() => {
        done();
        if (kind === "file") openFile(path);
        else if (!stateFor(dir).expanded.has(path)) { stateFor(dir).expanded.add(path); loadDir(path); }
      })
      .catch(fail);
  }, [dir, cancelName, refreshTree, rerender, openFile, loadDir]);

  const deletePath = useCallback((id: string) => {
    const name = splitName(id).name;
    onConfirm({
      title: `Delete ${name}?`,
      body: "It moves to the Trash, so you can put it back from Finder.",
      cancelLabel: "Keep it",
      confirmLabel: "Move to Trash",
      danger: true,
      onConfirm: () => {
        trashPath(dir, id)
          .then(() => {
            const s = stateFor(dir);
            const i = s.tabs.findIndex((t) => t.path === id);
            if (i >= 0) s.tabs.splice(i, 1);
            closeBuffer(dir, id);
            if (s.activeTab === id) s.activeTab = s.tabs[Math.max(0, i - 1)]?.path ?? null;
            s.selectedId = s.activeTab;
            refreshTree();
            rerender();
            toastSuccess("Moved to the Trash", name);
          })
          .catch((e) => toastError("Couldn't delete it", humanError(e)));
      },
    });
  }, [dir, onConfirm, refreshTree, rerender]);
```

and hand them to the tree (`:623-641`):

```tsx
    const tree: FileTreeProps = {
      rootsCount: 1 + workspaceRoots,
      roots: buildTree(
        rs.loads,
        rs.expanded,
        changedPaths(gitStatus),
        gitLetterMap(gitStatus),
        new Set(
          (state?.worktrees ?? [])
            .filter((w) => w.path.startsWith(dir + "/"))
            .map((w) => w.path.slice(dir.length + 1).split("/")[0]!),
        ),
        "",
        rs.pending,
      ),
      selectedId: rs.selectedId,
      renamingId: rs.renaming,
      nameError: rs.nameError,
      onSelect: openFile,
      onToggleDir,
      onRetry: (id) => loadDir(id === "#root" ? "" : id),
      onOpenHistory: () => { rs.historyView = true; rs.historyFrom = "repo"; rerender(); },
      onNewFile: () => startNew("file"),
      onNewFolder: () => startNew("dir"),
      onCommitName: commitName,
      onCancelName: cancelName,
      onRename: (id) => { rs.renaming = id; rs.pending = null; rs.nameError = null; rerender(); },
      onReveal: (id) => { revealPath(dir, id).catch((e) => toastError("Couldn't show it", humanError(e))); },
      onDelete: deletePath,
      onOpenInWeb: (id) => onOpenInWeb?.(id),
    };
```

Import the new names at the top of the file: `createPath`, `renamePath`, `trashPath`, `revealPath` from `@/lib/ipc`; `newPathIn` (and `nextFreeName` if a collision path wants it) from `@/lib/repo-data`; `sanitizeTitle` from `@/lib/notes-model`; `renameBuffer` from `@/lib/repo-editor`.

**No optimistic insert.** Every one of these calls `refreshTree()` and lets the watcher and the re-list put the row on screen, exactly as the spec says.

- [ ] **Step 7: Typecheck and run the suite**

Run: `npm run build 2>&1 | tail -20`
Expected: no errors.

Run: `npx vitest run 2>&1 | tail -6`
Expected: `Tests 147 passed` (142 + 5).

- [ ] **Step 8: Commit**

```bash
git add src/screens/repo/FileTree.tsx src/screens/repo/RepoPane.tsx src/lib/repo-data.ts src/lib/repo-data.test.ts
git commit -m "feat(repo): new file, new folder, rename, reveal, and delete to the Trash"
```

---

### Task 8 (join, after both lanes land): The four history lines, the shortcuts, the honest notification

**Files:**
- Rewrite: `src/screens/roadmap/HistoryPanel.tsx`
- Modify: `src/screens/roadmap/preview-fixtures.ts:12, 124-145` (the `HistoryStatus` import, `historyPanel`, `historyStatusPublished`, `historyStatusUntracked`) — **this file breaks the typecheck if it is missed**
- Modify: `src/screens/roadmap/Roadmap.tsx:14` (only if its import list names a deleted type — today it names `HistoryPanelProps` alone, so it may need no edit; the compiler decides)
- Modify: `src/lib/menu-keys.test.ts:34-42`
- Modify: `src/lib/roadmap-data.ts:400-438` (the history block) and `:31-100` (the ctx); create `src/lib/roadmap-data.test.ts`
- Modify: `src-tauri/src/menu.rs:52-84` (the `GO` table) and `:248-256` (the notes-chords test)
- Modify: `src/App.tsx:215-217` (the publish notification), `:684-747` (the keymap), the roadmap ctx wiring, `closeProject` at `:558`
- Modify: `src/lib/ipc.ts` (`onWindowClose`)

**Interfaces:**
- Consumes: `HistoryFacts` / `historyFacts` / `gitFetch` / `DirtyBadge` (Task 2 + Task 4); `saveActiveFile` and `confirmDirty` from `@/screens/repo/RepoPane` (Task 6); `anyDirty` from `@/lib/repo-editor` (Task 4); `flushSave` and `createNote` from `@/lib/notes-store` (`notes-store.ts:257, 273`, both already exported).
- Produces:
  ```ts
  // src/screens/roadmap/HistoryPanel.tsx
  export type HistoryLineFile = { path: string; badge: DirtyBadge };
  export type RemoteLine =
    | { kind: "no-remote" }
    | { kind: "never-published" }
    | { kind: "counts"; ahead: number; behind: number; refName: string; checked: string; error?: string };
  export type HistoryPanelProps =
    | { kind: "no-history"; onStartHistory?: () => void; className?: string }
    | { kind: "degraded"; className?: string }
    | {
        kind: "panel";
        lastSave: { ago: string; subject: string } | null;
        uncommitted: { files: HistoryLineFile[]; open: boolean };
        remote: RemoteLine;
        lastPublish: { ago: string; tag: string | null } | null;
        checking?: boolean;
        onCheckNow?: () => void;
        onToggleUncommitted?: () => void;
        onViewDetails?: () => void;
        className?: string;
      };
  export function HistoryPanel(p: HistoryPanelProps): JSX.Element;

  // src/lib/roadmap-data.ts
  export function ago(nowMs: number, tsSeconds: number): string;
  export function historyPanelFrom(f: HistoryFacts | null, nowMs: number, ctx: {
    uncommittedOpen: boolean; checking: boolean;
    onCheckNow: () => void; onToggleUncommitted: () => void;
    onViewDetails: () => void; onStartHistory: () => void;
  }): HistoryPanelProps;

  // src/lib/ipc.ts
  export function onWindowClose(cb: () => Promise<boolean> | boolean): Promise<UnlistenFn>;
  ```
  `RoadmapCtx` gains `historyFacts: HistoryFacts | null`, `historyChecking: boolean`, `uncommittedOpen: boolean`, and two handlers `onCheckNow: () => void`, `onToggleUncommitted: () => void`.

- [ ] **Step 1: Write the failing mapper test**

Create `src/lib/roadmap-data.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ago, historyPanelFrom } from "./roadmap-data";
import type { HistoryFacts } from "./ipc";

const NOW = 1_757_500_000_000; // ms
const S = NOW / 1000;

const CTX = {
  uncommittedOpen: false, checking: false,
  onCheckNow: () => {}, onToggleUncommitted: () => {},
  onViewDetails: () => {}, onStartHistory: () => {},
};

function facts(over: Partial<HistoryFacts> = {}): HistoryFacts {
  return {
    degraded: false,
    is_git: true,
    last_save: { ts: S - 3 * 3600, subject: "fix(notes): keep the caret in place" },
    dirty: [],
    remote: { kind: "ok", ref_name: "origin/react-shadcn", ahead: 2, behind: 0, checked_ms: NOW - 20 * 60_000, error: null },
    last_publish: { ts: S - 21 * 86_400, tag: "v0.7.0" },
    ...over,
  };
}

describe("ago", () => {
  it("says the plainest true thing", () => {
    expect(ago(NOW, S)).toBe("just now");
    expect(ago(NOW, S - 45)).toBe("just now");
    expect(ago(NOW, S - 60)).toBe("1 minute ago");
    expect(ago(NOW, S - 20 * 60)).toBe("20 minutes ago");
    expect(ago(NOW, S - 3600)).toBe("1 hour ago");
    expect(ago(NOW, S - 3 * 3600)).toBe("3 hours ago");
    expect(ago(NOW, S - 86_400)).toBe("yesterday");
    expect(ago(NOW, S - 3 * 86_400)).toBe("3 days ago");
    expect(ago(NOW, S - 21 * 86_400)).toBe("3 weeks ago");
    expect(ago(NOW, S - 200 * 86_400)).toBe("6 months ago");
    expect(ago(NOW, S + 500)).toBe("just now"); // a clock skew never says "in 8 minutes"
  });
});

describe("the four history lines", () => {
  it("states each fact with its own time", () => {
    const p = historyPanelFrom(facts(), NOW, CTX);
    if (p.kind !== "panel") throw new Error("expected the panel");
    expect(p.lastSave).toEqual({ ago: "3 hours ago", subject: "fix(notes): keep the caret in place" });
    expect(p.remote).toEqual({
      kind: "counts", ahead: 2, behind: 0,
      refName: "origin/react-shadcn", checked: "20 minutes ago", error: undefined,
    });
    expect(p.lastPublish).toEqual({ ago: "3 weeks ago", tag: "v0.7.0" });
    expect(p.uncommitted.files).toEqual([]);
  });

  it("carries the dirty files with their badge words", () => {
    const p = historyPanelFrom(facts({
      dirty: [
        { code: "M", path: "src/a.ts", badge: "edited" },
        { code: "?", path: "src/b.ts", badge: "new" },
        { code: "D", path: "src/c.ts", badge: "deleted" },
        { code: "R", path: "src/d.ts", badge: "renamed" },
      ],
    }), NOW, { ...CTX, uncommittedOpen: true });
    if (p.kind !== "panel") throw new Error("expected the panel");
    expect(p.uncommitted.open).toBe(true);
    expect(p.uncommitted.files.map((f) => f.badge)).toEqual(["edited", "new", "deleted", "renamed"]);
  });

  it("never checked reads as never checked", () => {
    const p = historyPanelFrom(facts({
      remote: { kind: "ok", ref_name: "origin/main", ahead: 0, behind: 0, checked_ms: null, error: null },
    }), NOW, CTX);
    if (p.kind !== "panel") throw new Error("expected the panel");
    expect(p.remote).toMatchObject({ kind: "counts", checked: "never checked" });
  });

  it("a failed check keeps the old numbers and the old time, and says why", () => {
    const p = historyPanelFrom(facts({
      remote: {
        kind: "ok", ref_name: "origin/main", ahead: 2, behind: 1,
        checked_ms: NOW - 20 * 60_000, error: "Could not resolve host: github.com",
      },
    }), NOW, CTX);
    if (p.kind !== "panel") throw new Error("expected the panel");
    expect(p.remote).toEqual({
      kind: "counts", ahead: 2, behind: 1, refName: "origin/main",
      checked: "20 minutes ago", error: "Could not resolve host: github.com",
    });
  });

  it("no remote and never published are two different lines", () => {
    const noRemote = historyPanelFrom(facts({
      remote: { kind: "no-remote", ref_name: "", ahead: 0, behind: 0, checked_ms: null, error: null },
      last_publish: null,
    }), NOW, CTX);
    if (noRemote.kind !== "panel") throw new Error("expected the panel");
    expect(noRemote.remote).toEqual({ kind: "no-remote" });
    expect(noRemote.lastPublish).toBeNull();

    const never = historyPanelFrom(facts({
      remote: { kind: "never-published", ref_name: "", ahead: 0, behind: 0, checked_ms: null, error: null },
      last_publish: null,
    }), NOW, CTX);
    if (never.kind !== "panel") throw new Error("expected the panel");
    expect(never.remote).toEqual({ kind: "never-published" });
  });

  it("a publish with no tag names no tag", () => {
    const p = historyPanelFrom(facts({ last_publish: { ts: S - 86_400, tag: null } }), NOW, CTX);
    if (p.kind !== "panel") throw new Error("expected the panel");
    expect(p.lastPublish).toEqual({ ago: "yesterday", tag: null });
  });

  it("broken git says so instead of pretending there is no history", () => {
    const p = historyPanelFrom(facts({ degraded: true, is_git: false, last_save: null }), NOW, CTX);
    expect(p.kind).toBe("degraded");
  });

  it("a folder with no repo offers to start one", () => {
    const p = historyPanelFrom(facts({ degraded: false, is_git: false, last_save: null }), NOW, CTX);
    expect(p.kind).toBe("no-history");
  });

  it("nothing loaded yet is not a claim about anything", () => {
    const p = historyPanelFrom(null, NOW, CTX);
    if (p.kind !== "panel") throw new Error("expected the panel");
    expect(p.lastSave).toBeNull();
    expect(p.lastPublish).toBeNull();
    expect(p.uncommitted.files).toEqual([]);
  });

  it("no number in this panel is a save count", () => {
    const p = historyPanelFrom(facts(), NOW, CTX);
    expect(JSON.stringify(p)).not.toMatch(/save[s]? /i);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/roadmap-data.test.ts 2>&1 | tail -10`
Expected: `ago is not exported` / `historyPanelFrom is not exported`.

- [ ] **Step 3: Write the mapper**

In `src/lib/roadmap-data.ts`, add near the top (after the imports) and import `HistoryFacts`, `DirtyBadge` from `./ipc` and the new `HistoryPanelProps`, `RemoteLine`, `HistoryLineFile` types from `@/screens/roadmap/HistoryPanel`:

```ts
/** The plainest true wording for a moment in the past. `nowMs` is passed in so
 *  the function is pure and the panel never claims more precision than the
 *  next render can honour. Never says a time in the future — a clock skew
 *  reads as "just now" rather than "in 8 minutes". */
export function ago(nowMs: number, tsSeconds: number): string {
  const s = Math.max(0, Math.floor(nowMs / 1000) - tsSeconds);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"} ago`;
  const h = Math.floor(s / 3600);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.floor(s / 86_400);
  if (d === 1) return "yesterday";
  if (d < 7) return `${d} days ago`;
  const w = Math.floor(d / 7);
  if (d < 60) return `${w} week${w === 1 ? "" : "s"} ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo} month${mo === 1 ? "" : "s"} ago`;
  const y = Math.floor(d / 365);
  return `${y} year${y === 1 ? "" : "s"} ago`;
}

/** get_state told us whether there is a repo; history_facts tells us what it
 *  says. Everything here is a fact with its own timestamp — nothing is
 *  computed by subtracting one count from another. */
export function historyPanelFrom(
  f: HistoryFacts | null,
  nowMs: number,
  ctx: {
    uncommittedOpen: boolean;
    checking: boolean;
    onCheckNow: () => void;
    onToggleUncommitted: () => void;
    onViewDetails: () => void;
    onStartHistory: () => void;
  },
): HistoryPanelProps {
  if (f?.degraded) return { kind: "degraded" };
  if (f && !f.is_git) return { kind: "no-history", onStartHistory: ctx.onStartHistory };
  const remote: RemoteLine = !f || f.remote.kind === "no-remote"
    ? { kind: "no-remote" }
    : f.remote.kind === "never-published"
      ? { kind: "never-published" }
      : {
          kind: "counts",
          ahead: f.remote.ahead,
          behind: f.remote.behind,
          refName: f.remote.ref_name,
          checked: f.remote.checked_ms === null ? "never checked" : ago(nowMs, Math.floor(f.remote.checked_ms / 1000)),
          error: f.remote.error ?? undefined,
        };
  return {
    kind: "panel",
    lastSave: f?.last_save ? { ago: ago(nowMs, f.last_save.ts), subject: f.last_save.subject } : null,
    uncommitted: {
      files: (f?.dirty ?? []).map((d): HistoryLineFile => ({ path: d.path, badge: d.badge })),
      open: ctx.uncommittedOpen,
    },
    remote,
    lastPublish: f?.last_publish ? { ago: ago(nowMs, f.last_publish.ts), tag: f.last_publish.tag } : null,
    checking: ctx.checking,
    onCheckNow: ctx.onCheckNow,
    onToggleUncommitted: ctx.onToggleUncommitted,
    onViewDetails: ctx.onViewDetails,
  };
}
```

Then replace the whole history block at `src/lib/roadmap-data.ts:400-438` with:

```ts
  /* -- history panel: four facts, no pipeline, no milestones, no save count -- */
  props.history = historyPanelFrom(ctx.historyFacts, Date.now(), {
    uncommittedOpen: ctx.uncommittedOpen,
    checking: ctx.historyChecking,
    onCheckNow: H.onCheckNow,
    onToggleUncommitted: H.onToggleUncommitted,
    onViewDetails: H.onHistoryDetails,
    onStartHistory: H.onStartHistory,
  });
```

Add to `RoadmapCtx` (`:31-51`):

```ts
  /** The history section's facts — null until the first history_facts lands. */
  historyFacts: HistoryFacts | null;
  historyChecking: boolean;
  uncommittedOpen: boolean;
```

and to its `handlers` block (`:52-100`):

```ts
    onCheckNow: () => void;
    onToggleUncommitted: () => void;
```

Delete the now-unused `PipelineNode` import at `:15`.

- [ ] **Step 4: Run the mapper test to verify it passes**

Run: `npx vitest run src/lib/roadmap-data.test.ts 2>&1 | tail -10`
Expected: `Tests 11 passed`.

- [ ] **Step 5: Rewrite the panel**

Replace `src/screens/roadmap/HistoryPanel.tsx` entirely:

```tsx
/*
 * The project-history section: four literal lines, each one a fact with its own
 * time. The pipeline, the milestone pills and the "N saves" number are gone —
 * every one of them was computed by subtraction and every one of them was wrong
 * on this repo (2026-09-10 audit). Nothing here fetches; "Check now" is the only
 * thing in the app that does, and it is a click.
 */
import { ArrowRightGlyph, CheckGlyph, ClockGlyph, RefreshGlyph, UploadGlyph } from "@/components/chrome/icons";
import type { DirtyBadge } from "@/lib/ipc";
import { cn } from "@/lib/utils";
import { TinyBadge } from "./bits";

export type HistoryLineFile = { path: string; badge: DirtyBadge };

export type RemoteLine =
  | { kind: "no-remote" }
  | { kind: "never-published" }
  | { kind: "counts"; ahead: number; behind: number; refName: string; checked: string; error?: string };

export type HistoryPanelProps =
  | { kind: "no-history"; onStartHistory?: () => void; className?: string }
  | { kind: "degraded"; className?: string }
  | {
      kind: "panel";
      lastSave: { ago: string; subject: string } | null;
      uncommitted: { files: HistoryLineFile[]; open: boolean };
      remote: RemoteLine;
      lastPublish: { ago: string; tag: string | null } | null;
      checking?: boolean;
      onCheckNow?: () => void;
      onToggleUncommitted?: () => void;
      onViewDetails?: () => void;
      className?: string;
    };

/** One row: a glyph, a label, and the fact. The label column is fixed so the
 *  four facts line up down the panel. */
function Line({ icon, label, children, onClick }: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
  onClick?: () => void;
}) {
  const body = (
    <>
      <span className="flex w-[13px] shrink-0 justify-center text-text-dim">{icon}</span>
      <span className="w-[86px] shrink-0 text-[12.5px] text-text-muted">{label}</span>
      <span className="flex min-w-0 flex-1 items-center gap-2 text-[12.5px] text-text-secondary">{children}</span>
    </>
  );
  if (!onClick) return <div className="flex items-center gap-2.5 py-[7px]">{body}</div>;
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2.5 rounded-md py-[7px] text-left hover:bg-fill-subtle"
    >
      {body}
    </button>
  );
}

export function HistoryPanel(p: HistoryPanelProps) {
  if (p.kind === "no-history") {
    return (
      <div className={cn("flex flex-col gap-2.5 py-[26px]", p.className)}>
        <div className="text-sm font-medium text-text-primary">No history yet</div>
        <div className="text-[12.5px] leading-[1.5] text-text-muted">
          This folder isn't keeping a record of its changes. Starting one is safe — it only adds a
          hidden folder.
        </div>
        <button
          onClick={p.onStartHistory}
          className="inline-flex items-center gap-1.5 self-start text-[12.5px] font-medium text-text-primary"
        >
          <span className="underline underline-offset-2">Start keeping history</span>
          <ArrowRightGlyph size={11} className="shrink-0" />
        </button>
      </div>
    );
  }

  if (p.kind === "degraded") {
    return (
      <div className={cn("flex flex-col gap-2.5 py-[26px]", p.className)}>
        <div className="text-sm font-medium text-text-primary">Can't read git</div>
        <div className="text-[12.5px] leading-[1.5] text-text-muted">
          Chronicle couldn't run git here, so it has nothing true to tell you about this project's
          history. Open a terminal and check that <span className="font-mono text-[11.5px]">git</span> works.
        </div>
      </div>
    );
  }

  const files = p.uncommitted.files;

  return (
    <div className={cn("py-[26px]", p.className)}>
      <div className="pb-1.5 text-[15px] font-semibold text-text-primary">Project history</div>

      <div className="flex flex-col divide-y divide-divider-faint">
        {/* 1 — last save */}
        <Line icon={<ClockGlyph size={12} />} label="Last save">
          {p.lastSave ? (
            <>
              <span className="shrink-0 tabular-nums">{p.lastSave.ago}</span>
              <span className="min-w-0 truncate font-mono text-[11.5px] text-text-dim" title={p.lastSave.subject}>
                {p.lastSave.subject}
              </span>
            </>
          ) : (
            <span className="text-text-dim">nothing saved yet</span>
          )}
        </Line>

        {/* 2 — uncommitted */}
        <div>
          <Line
            icon={<CheckGlyph size={11} className={files.length === 0 ? "text-state-success" : undefined} />}
            label="Uncommitted"
            onClick={files.length > 0 ? p.onToggleUncommitted : undefined}
          >
            {files.length === 0 ? (
              <span className="text-text-dim">Everything saved</span>
            ) : (
              <span className="tabular-nums">
                {files.length} file{files.length === 1 ? "" : "s"}
              </span>
            )}
          </Line>
          {p.uncommitted.open && files.length > 0 && (
            <div className="mb-2 ml-[110px] flex flex-col overflow-hidden rounded-md bg-fill-subtle">
              {files.map((f, i) => (
                <div
                  key={f.path}
                  className={cn(
                    "flex items-center gap-[9px] px-3 py-1.5",
                    i < files.length - 1 && "border-b border-divider-faint",
                  )}
                >
                  <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-text-secondary" title={f.path}>
                    {f.path}
                  </span>
                  <TinyBadge>{f.badge}</TinyBadge>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 3 — the remote, as of the last fetch */}
        <Line icon={<UploadGlyph size={12} />} label="Remote">
          {p.remote.kind === "no-remote" && <span className="text-text-dim">not on GitHub</span>}
          {p.remote.kind === "never-published" && <span className="text-text-dim">never published</span>}
          {p.remote.kind === "counts" && (
            <>
              <span className="shrink-0 tabular-nums">
                {p.remote.ahead} ahead · {p.remote.behind} behind
              </span>
              <span className="min-w-0 truncate font-mono text-[11.5px] text-text-dim">{p.remote.refName}</span>
              <span className="shrink-0 text-[11.5px] text-text-dimmer">· checked {p.remote.checked}</span>
              {p.remote.error && (
                <span className="min-w-0 truncate text-[11.5px] text-state-error" title={p.remote.error}>
                  {p.remote.error}
                </span>
              )}
            </>
          )}
          <span className="flex-1" />
          {p.remote.kind !== "no-remote" && (
            <button
              onClick={p.onCheckNow}
              disabled={p.checking}
              className="inline-flex h-[23px] shrink-0 items-center gap-1.5 rounded-sm border border-border-strong px-[9px] text-[11px] font-medium text-text-primary hover:bg-fill-hover disabled:text-text-dim"
            >
              <RefreshGlyph size={10} className={cn("shrink-0", p.checking && "animate-spin")} />
              {p.checking ? "Checking" : "Check now"}
            </button>
          )}
        </Line>

        {/* 4 — last publish */}
        <Line icon={<UploadGlyph size={12} />} label="Last publish">
          {p.lastPublish ? (
            <>
              <span className="shrink-0 tabular-nums">{p.lastPublish.ago}</span>
              {p.lastPublish.tag && (
                <span className="rounded-full bg-fill-subtle px-[9px] py-0.5 font-mono text-[10.5px] text-text-subtle">
                  {p.lastPublish.tag}
                </span>
              )}
            </>
          ) : (
            <span className="text-text-dim">never published</span>
          )}
        </Line>
      </div>

      <button
        onClick={p.onViewDetails}
        className="mt-3 h-[34px] w-full rounded-md border border-border-hairline text-[12.5px] font-medium text-text-secondary hover:bg-fill-hover hover:text-text-primary"
      >
        View details ›
      </button>
    </div>
  );
}
```

`HistoryStatus`, `PipelineNode` and `ChangedFile` are gone. Three files import from here; the compiler will name them, and this is what each needs:

- `src/lib/roadmap-data.ts:15` — drop `PipelineNode`, add `RemoteLine` and `HistoryLineFile` (Step 3 already does this).
- `src/screens/roadmap/Roadmap.tsx:14` — today it imports `HistoryPanelProps` only, so it needs no edit; if it has grown a second name since, drop whatever is deleted.
- `src/screens/roadmap/preview-fixtures.ts` — this one **does** need editing, and it is what stops `npm run build` if it is skipped. Change the import at `:12`:

```ts
import type { HistoryPanelProps } from "./HistoryPanel";
```

replace `historyPanel` (`:124-140`) with a fixture of the new shape — the same specimen copy, now four facts:

```ts
export const historyPanel: HistoryPanelProps = {
  kind: "panel",
  lastSave: { ago: "3 hours ago", subject: "fix(pricing): the tier card wraps at 320px" },
  uncommitted: {
    open: true,
    files: [
      { path: "src/screens/Pricing.tsx", badge: "new" },
      { path: "src/screens/Home.tsx", badge: "edited" },
      { path: "docs/PLAN.md", badge: "edited" },
      { path: "src/old/Legacy.tsx", badge: "deleted" },
    ],
  },
  remote: { kind: "counts", ahead: 2, behind: 0, refName: "origin/main", checked: "20 minutes ago" },
  lastPublish: { ago: "3 weeks ago", tag: "v0.7.0" },
};
```

delete `historyStatusPublished` and `historyStatusUntracked` (`:142-143`) — the type they named no longer exists — and add the two new panel states beside `historyNoHistory` (`:145`), which keeps its shape:

```ts
export const historyEverythingSaved: HistoryPanelProps = {
  ...historyPanel,
  uncommitted: { open: false, files: [] },
  remote: { kind: "counts", ahead: 0, behind: 0, refName: "origin/main", checked: "just now" },
};

export const historyOffline: HistoryPanelProps = {
  ...historyPanel,
  remote: {
    kind: "counts", ahead: 2, behind: 0, refName: "origin/main",
    checked: "20 minutes ago", error: "Could not resolve host: github.com",
  },
};

export const historyNeverChecked: HistoryPanelProps = {
  ...historyPanel,
  remote: { kind: "never-published" },
  lastPublish: null,
};

export const historyDegraded: HistoryPanelProps = { kind: "degraded" };
```

- [ ] **Step 6: Add the menu rows**

In `src-tauri/src/menu.rs:71-73`:

```rust
    // the Notes and Repo panes — ⌘N means "new note" on Notes and "new file" on
    // Repo, and App.tsx branches on the active pane; ⌘S saves the open file
    Go { id: "go-new-note",  text: "New Note or File", accel: "Cmd+KeyN", key: "n", code: "KeyN", alt: false, shift: false, group: 5 },
    Go { id: "go-jump-note", text: "Jump to Note",     accel: "Cmd+KeyP", key: "p", code: "KeyP", alt: false, shift: false, group: 5 },
    Go { id: "go-save",      text: "Save",             accel: "Cmd+KeyS", key: "s", code: "KeyS", alt: false, shift: false, group: 5 },
```

and extend the existing test at `menu.rs:248-256`:

```rust
    #[test]
    fn the_notes_chords_are_new_and_plain() {
        for id in ["go-new-note", "go-jump-note", "go-save"] {
            let k = key_for(id).unwrap();
            assert!(k.meta && !k.alt && !k.shift, "{id} is a plain Cmd chord");
        }
        assert_eq!(key_for("go-new-note").unwrap().key, "n");
        assert_eq!(key_for("go-jump-note").unwrap().key, "p");
        assert_eq!(key_for("go-save").unwrap().key, "s");
    }
```

Run: `cd /Users/tuneerguha/Downloads/chronicle/src-tauri && cargo test menu 2>&1 | tail -12`
Expected: `8 passed` — `accelerators_are_unique` in particular, which is what proves `Cmd+KeyS` collides with nothing.

Then pin the frontend half. `reclaimsFocus` (`src/lib/menu-keys.ts:32-34`) already returns `true` for any key that is not `r`/`[`/`]`, so ⌘S and ⌘N both pull first responder back out of a focused web page — which is right, since both act on Chronicle's own panes. Add the assertion to `src/lib/menu-keys.test.ts:34-42`, inside the existing `for` list:

```ts
      cmd("s", "KeyS"), cmd("n", "KeyN"), cmd("p", "KeyP"),
```

- [ ] **Step 7: The App keymap, the notification, and the quit guard**

In `src/lib/ipc.ts`, beside `windowControls()` (`:521-529`):

```ts
/** The window is closing. Return false to hold it open (an unsaved buffer);
 *  return true to let it go. Register ONCE at app scope and return the
 *  UnlistenFn from the effect's cleanup. */
export const onWindowClose = (cb: () => Promise<boolean> | boolean): Promise<UnlistenFn> =>
  getCurrentWindow().onCloseRequested(async (e) => {
    if (!(await cb())) e.preventDefault();
  });
```

In `src/App.tsx`, add the ⌘S branch and make ⌘N pane-aware (`:706-709`):

```tsx
      else if (mod && e.key === "n" && activeRef.current) {
        e.preventDefault();
        // one chord, two meanings — the Go menu row says "New Note or File"
        if (pane === "notes") void createNote(activeRef.current, "", "");
        else if (pane === "repo") newFileInRepo(activeRef.current);
      }
      else if (mod && e.key === "s" && activeRef.current) {
        e.preventDefault();
        if (pane === "repo") saveActiveFile(activeRef.current);
        else if (pane === "notes") void flushSave(activeRef.current);
      }
```

(`flushSave` is already exported from `src/lib/notes-store.ts`; `saveActiveFile` comes from Task 6. `newFileInRepo(dir)` is a two-line export to add beside it in `src/screens/repo/RepoPane.tsx`:

```tsx
/** ⌘N on the Repo pane: start a new file in the selected folder. */
export function newFileInRepo(dir: string): void {
  const s = CACHE.get(dir);
  if (!s) return;
  const id = s.selectedId;
  const parent = id ? (s.loads.has(id) ? id : splitName(id).dir) : "";
  s.pending = { parent, kind: "file" };
  s.renaming = null;
  s.nameError = null;
  bumpRepo();
}
```
where `bumpRepo` is a module-scope notifier the pane subscribes to — add `const repoSubs = new Set<() => void>(); function bumpRepo() { for (const cb of repoSubs) cb(); } export function subscribeRepo(cb: () => void) { repoSubs.add(cb); return () => { repoSubs.delete(cb); }; }` and `useEffect(() => subscribeRepo(rerender), [rerender])` inside `RepoPane`.)

Replace the publish notification (`src/App.tsx:215-217`) — **delete it**. A counter going from 2 to 0 is not evidence of a publish; the branch could have been rebased, the remote ref could have moved, the count could have been wrong (it was). Instead, announce from the push command's own success, in `src/screens/repo/RepoPane.tsx`'s `onPush` (`:588-592`):

```tsx
        onPush: () => {
          gitPush(dir)
            .then((r) => {
              toastRemoteOutcome(r);
              // the ONLY thing that announces a publish is a push that returned
              announce(dir, "published", r.headline, slug);
              refreshGit();
              onPollNow();
            })
            .catch(opError("Couldn't publish"));
        },
```

(import `announce` from `@/lib/journal`.) The same goes for `onCreateOnline` (`:598-611`) — its `afterGitOp(\`Published online — ${name}\`)` already fires only on success, so add `announce(dir, "published", \`Published online — ${name}\`, slug);` beside it.

The project-close guard, at `src/App.tsx:558` (`closeProject`) — route it through Task 6's prompt:

```tsx
  const closeProject = useCallback((dir: string) => {
    confirmDirty(dir, setConfirm, () => { /* the existing body, unchanged */ });
  }, [/* the existing deps */, setConfirm]);
```

and the quit guard, in the same effect that registers `onMenuKey`:

```tsx
  useEffect(() => {
    let un: UnlistenFn | undefined;
    void onWindowClose(async () => {
      if (!anyDirty()) return true;
      const dir = activeRef.current;
      if (!dir) return true;
      // hold the window open and ask, once
      return await new Promise<boolean>((resolve) => {
        confirmDirty(dir, setConfirm, () => resolve(true));
        armQuitCancel(() => resolve(false));
      });
    }).then((u) => { un = u; });
    return () => { un?.(); };
  }, [setConfirm]);
```

**The invariant this rests on: the promise MUST resolve `false` when the dialog is dismissed without a choice, or the window stays stuck open forever.** `App.tsx` holds the dialog as `const [confirm, setConfirm] = useState<ConfirmSpec | null>(null)` (`src/App.tsx:161`) and renders `<ConfirmDialog spec={confirm} onClose={() => setConfirm(null)} />` (`src/App.tsx:877`); `onClose` is the single dismiss path — `ConfirmDialog.tsx:32` (Escape / click-away), `:42` (Cancel) and `:49` (after a confirm) all call it. So `onClose` is where the resolve goes. The smallest wiring that does it: a ref holding a one-shot callback, armed before the prompt and drained by `onClose`.

```tsx
  // a pending window-close waiting on the dialog; drained by onClose, so an
  // Escape, a click-away and Cancel all mean "don't quit"
  const quitCancel = useRef<(() => void) | null>(null);
  const armQuitCancel = useCallback((fn: () => void) => { quitCancel.current = fn; }, []);
```

```tsx
      <ConfirmDialog
        spec={confirm}
        onClose={() => {
          setConfirm(null);
          const fn = quitCancel.current;
          quitCancel.current = null;
          fn?.();
        }}
      />
```

`confirmDirty`'s Save and Discard both call `proceed()`, which resolves `true` **and** then triggers `onClose` — so clear the ref before resolving `false`, exactly as written above; a resolved promise ignores the second settle either way. The implementer may pick a different shape (a second state slot, a small `usePromiseDialog` hook) as long as the invariant holds and `ConfirmDialog` itself is not restructured.

Finally, the roadmap ctx: `App.tsx` fetches the facts inside `pollOne` (`src/App.tsx:195`), which is already the app's only cadence for ground truth — **no new timer and no new listener**. That also satisfies the spec's "the section refreshes with the existing heartbeat and watcher" in full: the 60 s `every()` at `src/App.tsx:244-247` is the heartbeat, and the `project-fs-changed` listener at `src/App.tsx:249-262` already debounces an fs burst into an immediate `pollOne`, so saving a file makes the Uncommitted line follow within that debounce with nothing added here. `history_facts` reads git and touches no network, so putting it on that path costs one `git status` per poll and never fetches.

```tsx
      const hf = await historyFacts(dir).catch(() => null);
      setHistoryFactsFor(dir, hf);
```

with `onCheckNow` calling `gitFetch(dir)` and storing what comes back:

```tsx
    onCheckNow: () => {
      const dir = activeRef.current;
      if (!dir) return;
      setHistoryChecking(true);
      gitFetch(dir)
        .then((f) => setHistoryFactsFor(dir, f))
        .catch((e) => toastError("Couldn't check", humanError(e)))
        .finally(() => setHistoryChecking(false));
    },
    onToggleUncommitted: () => setUncommittedOpen((o) => !o),
```

- [ ] **Step 8: Typecheck, run both suites**

Run: `npm run build 2>&1 | tail -20`
Expected: no errors. If `src/screens/roadmap/preview-fixtures.ts` is named, Step 5's third bullet was skipped — it still imports `HistoryStatus` and still builds the pipeline-shaped panel.

Run: `grep -rn "HistoryStatus\|PipelineNode\|arrowsActive\|milestones" src/`
Expected: no output at all.

Run: `npx vitest run 2>&1 | tail -6`
Expected: `Tests 158 passed` (147 + 11).

Run: `cd /Users/tuneerguha/Downloads/chronicle/src-tauri && cargo test 2>&1 | tail -6`
Expected: `145 passed` — unchanged from Task 3. This step only adds assertions inside `the_notes_chords_are_new_and_plain`, which is an existing test, so the count does not move.

Run: `cd /Users/tuneerguha/Downloads/chronicle/src-tauri && cargo check 2>&1 | grep -c warning`
Expected: `1`.

- [ ] **Step 9: Grep for the words that are gone**

```bash
grep -rn "milestones\|Milestones reached\|saves waiting\|Saved to history\|Edits on disk\|Published online" src/ --include=*.ts --include=*.tsx
```
Expected: no hit inside `HistoryPanel.tsx` or `roadmap-data.ts`'s history block. Hits inside `src/screens/repo/HistoryPane.tsx` are fine — that is the L4 detail pane, which the spec explicitly leaves alone ("the detail pane's graph keeps its own count").

- [ ] **Step 10: Commit**

```bash
git add src/screens/roadmap/HistoryPanel.tsx src/screens/roadmap/preview-fixtures.ts src/screens/roadmap/Roadmap.tsx \
        src/lib/roadmap-data.ts src/lib/roadmap-data.test.ts src/lib/menu-keys.test.ts \
        src/App.tsx src/lib/ipc.ts src/screens/repo/RepoPane.tsx src-tauri/src/menu.rs
git commit -m "feat(history): four facts, Check now, and a publish notice that means it"
```

---

### Task 9 (join): Live test on a signed build, and the spec's record

**Files:** none in `src/` or `src-tauri/` unless the live test finds a bug (fix commits are part of this task); `docs/superpowers/specs/2026-09-10-repo-editing-and-history-design.md` gains a `## Live test` section.

The controller runs this with the automation it already has (`--open`, window-id screenshots, System Events keystrokes). **This repo is the test subject** — every one of the four history lines was wrong here before the fix, which makes it the sharpest possible check. Nothing in this task runs `git stash`, `git reset` or `git checkout -- <file>`; the working tree stays as it is.

- [ ] **Step 1: Build and launch**

```bash
npm run tauri:build && npm run sign-local
open -a src-tauri/target/release/bundle/macos/Chronicle.app --args --open /Users/tuneerguha/Downloads/chronicle
```
(The updater signing step fails without the key; the `.app` is produced first, and `sign-local` is what stops macOS re-prompting on every rebuild.)

- [ ] **Step 2: The four history lines, on this repo**

Open the Roadmap pane and read the section against ground truth from a terminal:

```bash
git log -1 --format='%ct %s' HEAD
git -c core.quotePath=false status --porcelain -uall | wc -l
git rev-list --left-right --count origin/react-shadcn...HEAD
git log -1 --format='%ct %H' --remotes=origin
git tag --points-at "$(git log -1 --format=%H --remotes=origin)"
```

Expect, line by line:
- **Last save** — the same subject and the same "N hours ago" as `git log -1`.
- **Uncommitted** — the porcelain count **minus** the `.chronicle/agent/`, `.chronicle/attachments/`, `.chronicle/journal.jsonl` rows. Expand it: `chronicle.json` and `.chronicle/kanban.json` show as **edited**, `PRODUCT.md`, `artifacts/`, `skills-lock.json`, `test-results/` as **new**. No row's path is missing its first character (the old bug), and no `.chronicle/journal.jsonl` row appears at all.
- **Remote** — the ahead/behind pair matching `rev-list --left-right`, the ref name `origin/react-shadcn`, and `never checked` on the first launch.
- **Last publish** — the `--remotes=origin` date, with `v0.7.0` beside it if the tag points at that commit.

Screenshot it. If any line disagrees with the terminal, that is a bug and this task fixes it before going on.

- [ ] **Step 3: Check now, online and off**

Click **Check now** — it spins, the numbers refresh, and the line reads `checked just now`. Then turn wifi off and click it again: the numbers and the time **stay** and the error sentence appears on the line. No toast, no blank panel. Turn wifi back on and click once more.

Then confirm nothing fetches on its own:
```bash
git log -1 --format=%ct .git/FETCH_HEAD 2>/dev/null; ls -l .git/FETCH_HEAD
```
Leave the app open on the Roadmap pane for three minutes without touching it, then re-run `ls -l .git/FETCH_HEAD`: the mtime has **not** moved.

- [ ] **Step 4: Edit and save**

Repo pane. Open `src/lib/repo-editor.ts` — it renders with line numbers, syntax colour and no wrapping (a long line scrolls the editor sideways; the pane itself does not move). Type a character:
- the header reads **unsaved**, the tab grows a dot,
- ⌘S → **saving** → **saved · 0s ago**, the dot goes,
- `git status` in a terminal now shows the file as modified.

Undo it with ⌘Z, ⌘S again. Switch to another tab and back — ⌘Z still undoes the *previous* edit, which is the proof that the EditorState survived the switch.

Open a `.rs`, a `.md`, a `.json`, a `.toml`, a `.sh` and a `.yml` file: each is coloured. Open `src-tauri/target/release/chronicle` (a binary): the binary card, no editor. Open a `.png` from `.chronicle/attachments/`: the image card.

- [ ] **Step 5: The tab size follows `.editorconfig`**

This repo has no `.editorconfig`, so `tabSizeFor` falls back to 2 and the code path that reads the file is never exercised by simply opening files. Write one, check it, remove it:

```bash
printf 'root = true\n\n[*]\nindent_style = space\nindent_size = 4\n' > .editorconfig
```

Close every open tab and reopen `src/lib/repo-editor.ts` (the config is read once per project, on the first open). Press Tab on a blank line: the caret moves **four** columns, not two. Then:

```bash
rm .editorconfig
```

Close and reopen the tab again: Tab moves two columns. `git status` must show no `.editorconfig` row afterwards.

- [ ] **Step 6: The conflict bar**

With `src/lib/repo-editor.ts` open and **clean**, from a terminal:
```bash
printf '\n// touched from the terminal\n' >> src/lib/repo-editor.ts
```
The editor reloads silently and the line appears. Undo that with an editor edit + ⌘S (never `git checkout`).

Now type in the editor (dirty), then from the terminal:
```bash
printf '\n// touched again\n' >> src/lib/repo-editor.ts
```
Within half a second the bar reads **"This file changed on disk while you were editing it."** with Reload and Keep mine.
- **Keep mine** → the bar goes, the buffer stays dirty, ⌘S succeeds (this is the mtime hand-off working).
- Repeat, and this time **Reload** → the terminal's text replaces the buffer and the header goes clean.

Then the ⌘S race: make the buffer dirty, append from the terminal, and hit ⌘S *without* the watcher having fired yet. The write is refused and the same bar appears — **never** a toast.

Finally tidy the file back with an edit + ⌘S so the tree is left the way it was found.

- [ ] **Step 7: The explorer**

- **New file** in the head → an input row appears inside the selected folder → type `scratch pad.ts` → ⏎ → the file exists on disk (`ls src/`), the row appears from the watcher (not optimistically), and it opens in the editor.
- Try a name with a slash — `a/b.ts` → it lands as `a-b.ts` (the notes sanitiser), not a nested path.
- Try the same name twice → the inline error under the field reads "something with that name is already there" and nothing is created.
- **New folder** → same flow.
- Right-click a file → **Rename…** → change it while it is open **and dirty** → the tab, the buffer and the unsaved text all follow, and ⌘S writes to the new name.
- Right-click → **Reveal in Finder** → Finder opens with the file selected.
- Right-click → **Delete…** → confirm → the file is in `~/.Trash` (`ls -t ~/.Trash | head -3`), its tab is gone, and **Put Back** in Finder restores it.
- Right-click a file inside `node_modules/` → Delete… → the refusal sentence, and the file is still there.

- [ ] **Step 8: The shortcuts and the prompts**

- ⌘N on the Repo pane starts a new file; ⌘N on the Notes pane still makes a note. The Go menu row reads **New Note or File**.
- ⌘S from a focused editor saves. ⌘S with the Web pane's page focused still reaches the app (that is what the menu row is for) — click into a web page, then ⌘J back to Repo and ⌘S.
- ⌘F inside the editor opens CodeMirror's own search panel; Escape closes it. ⌘⇧F still opens the project search overlay.
- Make a buffer dirty, then close its tab → Save / Discard / Cancel. Try all three.
- Make a buffer dirty, then ⌘W the project → the same prompt. Cancel keeps the project open.
- Make a buffer dirty, then ⌘Q → the window is held, the prompt appears, Cancel keeps the app running.
- Switch panes with a dirty buffer (⌘J round trip) → **no** prompt, and the buffer is still dirty on return.

- [ ] **Step 9: The publish notice**

With something to publish, click Publish in the L4 history pane. The notification fires once, with the push's own headline. Then confirm the old false positive is gone: with `ahead` already 0, run `git fetch` from a terminal so the counters move on their own — **no** notification appears.

- [ ] **Step 10: Energy**

```bash
top -pid "$(pgrep -f Chronicle.app | head -1)" -l 3 -stats cpu
```
with the window hidden (⌘H): the app is idle. Close every editor tab and check again — no timer is running for the editor, and `Activity Monitor`'s Energy tab shows the same figure as before this feature.

- [ ] **Step 11: Record and commit**

Append a `## Live test` section to `docs/superpowers/specs/2026-09-10-repo-editing-and-history-design.md`: what passed, what did not, screenshots of the history section before and after, and any follow-up.

```bash
git add docs/superpowers/specs/2026-09-10-repo-editing-and-history-design.md
git commit -m "docs(repo): live test results for editing and the history section"
```

---

## Self-review

Run after Task 9; the boxes below were checked while writing the plan and are kept for the executor to re-run.

- [ ] **Spec coverage.** Every section of the spec maps to a task.
  - *Part 1 — the editor:* the CodeMirror packages, the token theme, the `HighlightStyle`, line numbers, wrap off, tab size, no auto-formatting, read-only as the same component → **Task 5**; `.editorconfig` parsing → **Task 4**.
  - *Part 1 — the buffer model:* the five states, open-reads-once, ⌘S with the mtime precondition, the watcher rules, own-write echo, Reload / Keep mine, the close/switch/quit prompt, the tab dot, the header words, undo across tab switches → **Task 4** (the machine, tested) + **Task 6** (the wiring, the dot, the bar, the prompts) + **Task 5** (the state cache).
  - *Part 1 — Rust:* `read_file` extended, `write_file`, `create_path`, `rename_path`, `trash_path` (+ `reveal_path`), the `.git/` and `node_modules/` refusals, the ACL → **Task 3**.
  - *Part 1 — explorer:* head buttons, the row context menu **and the ⋯ that appears on hover and stays on the selected row**, inline naming, the sanitiser, no optimistic insert → **Task 7**.
  - *Part 1 — shortcuts:* ⌘S, pane-aware ⌘N, the Go rows, ⌘F vs ⌘⇧F → **Task 8** (menu + keymap), **Task 5** (`searchKeymap` inside the editor).
  - *Part 2 — the seven plumbing fixes:* (1) the trim → **Task 1**; (2) publish resolution → **Task 1**; (3) the dirty set → **Task 1**; (4) badge codes → **Task 1**; (5) the notification from the push result → **Task 8**; (6) `git_degraded` → **Task 1** (exposed) + **Task 8** (the "Can't read git" state); (7) "saves" dropped → **Task 8**.
  - *Part 2 — the panel:* the four lines and their sources, Check now, the fetch rule, "View details", the heartbeat refresh → **Task 2** (the facts + `git_fetch`) + **Task 8** (the panel + the mapper).
  - *Energy:* no new timers, the instance created on mount and destroyed on unmount, buffers on the watcher, fetch on click only → **Task 5**, **Task 6**, **Task 2**, verified in **Task 9 Step 3 and Step 10**.
  - *Error handling:* write failure → toast, buffer dirty (**Task 4**'s error test, **Task 6**'s wiring); `changed on disk` → the bar only (**Task 4** + **Task 6**); binary/oversize → the existing bodies, no edit affordance (**Task 6**); create/rename collisions → the inline error (**Task 7**); Trash unavailable → refuse, never `rm` (**Task 3**).
  - *Testing:* the spec's Rust list → Tasks 1–3's test modules; the vitest list → Tasks 4, 7, 8's test files; the live list → Task 9.
- [ ] **No placeholders.** Every code step carries real code; every run step carries its exact command and expected output; every "keep the existing block" instruction names the file and line range of the block it means. The one place a shape is deliberately left open — the quit guard's cancel path in Task 8 Step 7 — states the invariant it must satisfy ("the promise MUST resolve `false` when the dialog is dismissed without a choice") and shows a working wiring, rather than saying "handle it".
- [ ] **The preview fixtures are not forgotten.** `src/screens/repo/preview-fixtures.ts` (`:8, 56-96, 109`) and `src/screens/roadmap/preview-fixtures.ts` (`:12, 124-145`) are the two files that hold the old `{kind:"code"}` body and the old pipeline-shaped `HistoryPanelProps`. Both are in a Files block (Tasks 6 and 8), both get an explicit edit, both are in their task's `git add`, and both tasks end with a `grep` that fails loudly if the edit was skipped.
- [ ] **Type consistency.** `HistoryFacts` has the same six fields in Rust (Task 2) and TS (Task 4), and `remote` the same six inside it. `DirtyEntry`'s three fields (`code`, `path`, `badge`) match between `main.rs` (Task 1), the `dirty` array in both `get_state` and `history_facts`, and `StateData.dirty` / `HistoryFacts.dirty` (Task 4). `BufferState`'s five values are declared once in `repo-editor.ts` and read by `Viewer.tsx` only through `saveLabelFor` and the `conflict` boolean, so no component re-lists them. `LangId` is declared once in `repo-editor.ts` and imported by `Viewer.tsx` and `CodeEditor.tsx`. `bufferKey(dir, path)` is the `docKey` the editor caches on — the same function in Task 4's store, Task 5's cache and Task 6's body. `TabDot` gains exactly `"dirty"`, used by `Viewer.tsx` and nothing else. `HistoryPanelProps`'s three arms are declared in `HistoryPanel.tsx` (Task 8) and produced only by `historyPanelFrom` in the same task. `ConfirmSpec`'s new `altLabel`/`onAlt` are added in Task 6 and used by Tasks 6 and 8. `confirmDirty` / `saveActiveFile` / `newFileInRepo` / `subscribeRepo` are all exported from `RepoPane.tsx` and imported by `App.tsx` under those exact names. `RowHandlers` is declared once in `FileTree.tsx` (Task 7) and is the parameter type of `Row`, `RowMenu` and `RowDots`, so a new callback is added in exactly one place. The six stubs Task 3 Step 2 declares (`mtime_ms_of`, `read_at`, `write_at`, `create_at`, `rename_at`, `trash_at`) have the same signatures as the implementations in Step 4 and the wrappers in Step 5.
- [ ] **Deviations are declared.** Eleven, each with the spec line it departs from and the reason. Deviation 11 (the buffer is created on open, not on first edit) is the one a reviewer reading the spec side by side will notice first, and it is argued rather than left silent.
- [ ] **Ordering.** Nothing references a symbol from a later task. Lane B's Task 4 declares every ipc wrapper Lane A's Tasks 1–3 implement, so the two lanes never edit the same file; Task 6 is the first task that can typecheck end to end, and Task 4's step 2 says so out loud rather than leaving a mystery failure. Task 8 is the only task that touches `App.tsx`, `menu.rs`, `HistoryPanel.tsx` and `roadmap-data.ts`, so neither lane can collide there.
- [ ] **The three rules a reviewer will look for are stated where the implementer hits them.** `changed on disk` is a bar and never a toast (Global Constraints, Task 4's `saveBuffer` catch, Task 4's test, Task 6's Viewer markup, Task 9 Step 6). Nothing fetches except a Check now click (Global Constraints, Task 2's `git_fetch` doc comment, Task 8's `onCheckNow`, Task 9 Step 3's FETCH_HEAD mtime check). The Trash is never a fallback to `rm` (Global Constraints, Task 3's `trash_at`, Task 3's refusal test, Task 9 Step 7).
