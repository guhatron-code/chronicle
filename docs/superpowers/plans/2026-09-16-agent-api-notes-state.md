# Agent API, plan 1 of 3: notes and state over MCP and CLI, and the vault follows the project

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An agent (or a person at a shell) can list, read, create and update a project's notes and read its derived state through `chronicle --mcp <dir>` or `chronicle <group> <verb>`, with no app running, and a linked git worktree reads and writes the main checkout's vault.

**Architecture:** One new Rust module `src-tauri/src/agent_api.rs` holds a catalog of capabilities (name, description, JSON input schema, handler). Handlers take a project directory and a JSON args object and return `Outcome { summary, data }`. Two fronts in `main()`: a hand-rolled MCP stdio server (newline-delimited JSON-RPC 2.0) and a CLI whose flags are converted to the same JSON args. Vault resolution moves into `notes::index::vault_dir`, which now follows a linked worktree to its main checkout with a per-process cache.

**Tech Stack:** Rust (serde_json, regex, std only; no new crates), the existing `notes` module, the existing `derive_project`/`state_for_project`; TypeScript only for one sidebar line.

**Spec:** `docs/superpowers/specs/2026-09-16-agent-access-and-visible-rounds-design.md` (§1, §2 notes and state, §6, §7 first bullet, §8 Rust tests)

## Global Constraints

- No new Cargo dependencies. JSON-RPC and JSON Schema are written by hand with `serde_json`.
- Tool names are `chronicle.<group>.<verb>`; the CLI form is `chronicle <group> <verb>`. The same handler serves both; a capability exists in exactly one place, the catalog.
- Every path argument is jailed: note paths through `notes::note_file_in`, other paths through `Ctx::resolve_jailed`. Absolute paths and `..` are refused with the existing messages.
- Notes and state capabilities never need the app and never latch the ledger (`derive_project(.., write = false)`).
- Errors are one plain sentence (`Err(String)`); CLI exit codes: 0 success, 1 refused/failed, 2 usage. MCP errors are returned as a tool result with `isError: true` and the sentence as its text, never as a JSON-RPC error, except for malformed JSON-RPC itself.
- Status vocabulary for `notes.set_status`/`notes.create`: the union of `queued`, `in_progress`, `done` and every status present in the vault; anything else is refused with the known list in the sentence.
- `notes.create` allocates ids `T-<n>` where `n` = 1 + the highest numeric `T-` id in the vault (migrated notes carry ids; app-created notes do not); the file name is `<folder>/<sanitize_title(title)>.md` with ` 2`, ` 3` … on collision, matching the app's `newNotePath`.
- Copy: sentence case, no em dashes in any user-facing string, ` · ` as a separator.
- Shared-tree rules: never `git add -A`, `git stash`, `git reset`, `git checkout -- <file>`, `git clean`; stage by explicit path; the installed Chronicle writes `.chronicle/` live.
- Rust tests: `cd src-tauri && cargo test <name>`; run the full `cargo test` before each commit. Frontend: `npm test`, `npm run typecheck`.
- Commit messages end with:
  `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` and
  `Claude-Session: https://claude.ai/code/session_016TqoaAozoZzEomhGSMc6Yr`

---

### Task 1: The vault follows a linked worktree

**Files:**
- Modify: `src-tauri/src/notes/index.rs:62` (`vault_dir`)
- Modify: `src-tauri/src/notes/index.rs` (`NotesIndex` gains `vault: String`, `borrowed: bool`; `snapshot` fills them)
- Modify: `src/lib/ipc.ts` (`NotesIndex` type), `src/screens/notes/Sidebar.tsx` (one line under the vault name)
- Test: `src-tauri/src/notes/index.rs` (mod tests) and `src/lib/notes-model.test.ts`

**Interfaces:**
- Produces: `pub fn vault_root(dir: &Path) -> PathBuf` — the directory whose `.chronicle/notes` this project uses: `dir` itself, or the main checkout when `dir` is a linked git worktree. `pub fn vault_dir(dir: &Path) -> PathBuf` = `vault_root(dir).join(".chronicle/notes")` (signature unchanged, so all 81 call sites follow). `pub fn vault_is_borrowed(dir: &Path) -> bool`.
- `NotesIndex { …, vault: String /* absolute vault dir */, borrowed: bool }`.

- [ ] **Step 1: Write the failing Rust test**

In `src-tauri/src/notes/index.rs`, inside the existing `#[cfg(test)] mod tests` (create one at the bottom if absent, with `use super::*;`):

```rust
    fn git(d: &std::path::Path, args: &[&str]) {
        let o = std::process::Command::new("git").arg("-C").arg(d).args(args).output().unwrap();
        assert!(o.status.success(), "git {:?}: {}", args, String::from_utf8_lossy(&o.stderr));
    }

    #[test]
    fn a_linked_worktree_uses_the_main_checkouts_vault() {
        let base = std::env::temp_dir().join(format!("chronicle-vault-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let main = base.join("main");
        std::fs::create_dir_all(&main).unwrap();
        git(&main, &["init", "-q", "-b", "main"]);
        git(&main, &["-c", "user.email=t@t", "-c", "user.name=t", "commit", "--allow-empty", "-m", "first"]);
        std::fs::create_dir_all(main.join(".chronicle/notes")).unwrap();
        let wt = base.join("wt");
        git(&main, &["worktree", "add", "-q", "-b", "feature", wt.to_str().unwrap()]);
        let main = main.canonicalize().unwrap();
        let wt = wt.canonicalize().unwrap();

        assert_eq!(vault_root(&main), main, "the main checkout is its own root");
        assert_eq!(vault_root(&wt), main, "a linked worktree borrows the main checkout's vault");
        assert_eq!(vault_dir(&wt), main.join(".chronicle/notes"));
        assert!(vault_is_borrowed(&wt));
        assert!(!vault_is_borrowed(&main));
        // not a repo at all: the folder is its own root
        let plain = base.join("plain");
        std::fs::create_dir_all(&plain).unwrap();
        let plain = plain.canonicalize().unwrap();
        assert_eq!(vault_root(&plain), plain);
        // the answer is cached: a second call spawns no git (cheap enough to call 81 times a poll)
        let (_, spawns) = crate::git_spawns(|| vault_root(&wt));
        assert_eq!(spawns, 0, "cached after the first resolution");
    }
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd src-tauri && cargo test a_linked_worktree_uses_the_main_checkouts_vault`
Expected: compile error, `vault_root`/`vault_is_borrowed` not found.

- [ ] **Step 3: Implement the resolver with a per-process cache**

Replace `vault_dir` in `src-tauri/src/notes/index.rs`:

```rust
use std::sync::{Mutex, OnceLock};

/// dir → the checkout whose `.chronicle/notes` it uses. Resolved once per process
/// per dir: worktree-ness does not change while the app runs, and `vault_dir` is
/// called on every poll from dozens of places.
fn roots() -> &'static Mutex<HashMap<PathBuf, PathBuf>> {
    static ROOTS: OnceLock<Mutex<HashMap<PathBuf, PathBuf>>> = OnceLock::new();
    ROOTS.get_or_init(|| Mutex::new(HashMap::new()))
}

/// The folder whose `.chronicle/notes` this project reads and writes. A linked git
/// worktree (its `--git-dir` differs from `--git-common-dir`) borrows the main
/// checkout's vault, so a round run from a worktree edits the notes the app shows.
pub fn vault_root(dir: &Path) -> PathBuf {
    if let Some(r) = roots().lock().ok().and_then(|m| m.get(dir).cloned()) { return r; }
    let resolved = resolve_root(dir);
    if let Ok(mut m) = roots().lock() { m.insert(dir.to_path_buf(), resolved.clone()); }
    resolved
}

fn resolve_root(dir: &Path) -> PathBuf {
    let git_dir = crate::git_in(dir, &["rev-parse", "--path-format=absolute", "--git-dir"]);
    let common = crate::git_in(dir, &["rev-parse", "--path-format=absolute", "--git-common-dir"]);
    if git_dir.is_empty() || common.is_empty() || git_dir == common { return dir.to_path_buf(); }
    // the main checkout is the parent of its .git directory
    match Path::new(common.trim()).parent() {
        Some(p) => p.canonicalize().unwrap_or_else(|_| p.to_path_buf()),
        None => dir.to_path_buf(),
    }
}

pub fn vault_is_borrowed(dir: &Path) -> bool { vault_root(dir) != dir }

pub fn vault_dir(dir: &Path) -> PathBuf { vault_root(dir).join(".chronicle/notes") }
```

`crate::git_in` is the existing helper in main.rs (`fn git_in(repo: &Path, args: &[&str]) -> String`); make it `pub(crate)` if it is not already. `crate::git_spawns` is the existing `#[cfg(test)]` counter. Note `git_in` on a non-repo returns an empty string (it already swallows errors), which the code above treats as "own root".

Add to `NotesIndex` (`index.rs:34`) the fields `pub vault: String, pub borrowed: bool` and fill them in `snapshot`: `vault: vault_dir(dir).to_string_lossy().into_owned(), borrowed: vault_is_borrowed(dir)`.

- [ ] **Step 4: Run the Rust tests**

Run: `cd src-tauri && cargo test notes::`
Expected: all pass including the new one. Also run `cargo test` fully once: `main.rs` tests that construct a `NotesIndex` literal (search `NotesIndex {`) need the two new fields.

- [ ] **Step 5: The sidebar line**

`src/lib/ipc.ts`: add `vault: string; borrowed: boolean;` to the `NotesIndex` interface (search `export interface NotesIndex`). In `src/screens/notes/Sidebar.tsx`, under the vault header row, render when `index.borrowed`:

```tsx
{index.borrowed && (
  <div className="px-2 pb-1 text-[11px] text-text-subtle" title={index.vault}>
    Notes live in the main checkout · {index.vault.replace(/\/\.chronicle\/notes$/, "").split("/").pop()}
  </div>
)}
```

(Use the sidebar's existing prop name for the index; if the component receives only `notes` and `rounds`, thread `borrowed` and `vault` through from `notes-store.ts` the same way `generation` travels.) Add a pure test in `src/lib/notes-model.test.ts` only if you extract a helper for the label; otherwise typecheck is the check.

- [ ] **Step 6: Verify and commit**

Run: `npm run typecheck && npm test 2>&1 | tail -3 && cd src-tauri && cargo test 2>&1 | tail -3`
Expected: all green.

```bash
git add src-tauri/src/notes/index.rs src-tauri/src/main.rs src/lib/ipc.ts src/screens/notes/Sidebar.tsx
git commit -m "feat(notes): a linked worktree reads and writes the main checkout's vault"
```

---

### Task 2: The capability catalog, `notes.list` and `notes.read`

**Files:**
- Create: `src-tauri/src/agent_api.rs`
- Modify: `src-tauri/src/main.rs` (`mod agent_api;`; `load_project` → `pub(crate) fn`; `Project` fields `repo`, `extras`, `manifest`, `manifest_error` → `pub(crate)`)
- Test: `src-tauri/src/agent_api.rs` (mod tests)

**Interfaces:**
- Produces (all `pub(crate)` in `agent_api`):
  - `struct Outcome { pub summary: String, pub data: Value }`
  - `struct ToolSpec { pub name: &'static str, pub description: &'static str, pub input_schema: Value }`
  - `fn catalog() -> Vec<ToolSpec>` — every capability, in a stable order.
  - `fn call(dir: &Path, name: &str, args: &Value) -> Result<Outcome, String>` — dispatch by name; unknown name → `Err("No capability named X. Known: …")`.
  - `fn resolve_project_dir(start: &Path) -> Option<PathBuf>` — walk up from `start` to the first folder containing `chronicle.json` or `.chronicle/`.
  - `fn note_row(vault: &Path, rel: &str) -> Value` — one list row: `{ path, id?, title, status?, round?, tags, created?, updated? }`.

- [ ] **Step 1: Write the failing tests**

Create `src-tauri/src/agent_api.rs` with the tests first:

```rust
//! One implementation of every capability an agent (or a shell) can ask Chronicle for.
//! `main()` fronts it twice: `chronicle --mcp <dir>` (stdio MCP) and `chronicle <group>
//! <verb>` (CLI). Notes and state need no running app.

use serde_json::{json, Value};
use std::path::{Path, PathBuf};

#[cfg(test)]
mod tests {
    use super::*;

    pub(super) fn vault(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("chronicle-api-{}-{}", name, std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(d.join(".chronicle/notes/Tasks")).unwrap();
        d.canonicalize().unwrap()
    }
    pub(super) fn put(root: &Path, rel: &str, text: &str) {
        let p = root.join(".chronicle/notes").join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, text).unwrap();
    }

    #[test]
    fn the_catalog_names_every_capability_once() {
        let names: Vec<&str> = catalog().iter().map(|t| t.name).collect();
        for n in ["chronicle.notes.list", "chronicle.notes.read"] {
            assert!(names.contains(&n), "{n} missing from {names:?}");
        }
        let mut dedup = names.clone(); dedup.sort(); dedup.dedup();
        assert_eq!(dedup.len(), names.len(), "no duplicate names");
        for t in catalog() {
            assert_eq!(t.input_schema["type"], "object", "{}: schema is an object", t.name);
            assert!(!t.description.is_empty());
        }
    }

    #[test]
    fn list_filters_and_reads() {
        let d = vault("list");
        put(&d, "Tasks/T-001 Login.md", "---\nid: T-001\nstatus: done\nround: 1\ntags: [ui]\ncreated: 2026-07-14T18:36:56Z\nupdated: 2026-07-14T20:24:40Z\n---\n\n# Login\n\nBody one.\n");
        put(&d, "Tasks/T-002 Crash.md", "---\nid: T-002\nstatus: queued\ntags: [bug, ui]\n---\n\n# Crash\n\nBody two mentions kanban.\n");
        put(&d, "Ideas/Someday.md", "# Someday\n\nNo front matter at all.\n");

        let all = call(&d, "chronicle.notes.list", &json!({})).unwrap();
        assert_eq!(all.data["notes"].as_array().unwrap().len(), 3);
        assert_eq!(all.summary, "3 notes.");
        let queued = call(&d, "chronicle.notes.list", &json!({"status": "queued"})).unwrap();
        let rows = queued.data["notes"].as_array().unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0]["path"], "Tasks/T-002 Crash.md");
        assert_eq!(rows[0]["id"], "T-002");
        assert_eq!(rows[0]["tags"], json!(["bug", "ui"]));
        assert_eq!(rows[0]["created"], Value::Null, "absent keys are null, not invented");
        assert_eq!(call(&d, "chronicle.notes.list", &json!({"round": 1})).unwrap().data["notes"][0]["id"], "T-001");
        assert_eq!(call(&d, "chronicle.notes.list", &json!({"tag": "ui"})).unwrap().data["notes"].as_array().unwrap().len(), 2);
        assert_eq!(call(&d, "chronicle.notes.list", &json!({"text": "kanban"})).unwrap().data["notes"][0]["id"], "T-002");
        assert_eq!(call(&d, "chronicle.notes.list", &json!({"limit": 1})).unwrap().data["notes"].as_array().unwrap().len(), 1);
        assert_eq!(call(&d, "chronicle.notes.list", &json!({"status": 7})).unwrap_err(),
                   "status must be a string.");

        let one = call(&d, "chronicle.notes.read", &json!({"path": "Tasks/T-001 Login.md"})).unwrap();
        assert_eq!(one.data["front"]["status"], "done");
        assert_eq!(one.data["front"]["tags"], "[ui]", "front matter values are the raw strings the file holds");
        assert!(one.data["body"].as_str().unwrap().starts_with("# Login"));
        assert_eq!(one.summary, "Tasks/T-001 Login.md · done · round 1.");
        assert_eq!(call(&d, "chronicle.notes.read", &json!({"path": "../../etc/passwd.md"})).unwrap_err(),
                   "that path isn't inside the notes vault");
        assert_eq!(call(&d, "chronicle.notes.read", &json!({})).unwrap_err(), "path is required.");
        assert!(call(&d, "chronicle.nope.x", &json!({})).unwrap_err().starts_with("No capability named chronicle.nope.x."));
    }

    #[test]
    fn the_project_dir_is_found_by_walking_up() {
        let d = vault("walk");
        let deep = d.join("src/deep/er");
        std::fs::create_dir_all(&deep).unwrap();
        assert_eq!(resolve_project_dir(&deep), Some(d.clone()));
        let nowhere = std::env::temp_dir().join(format!("chronicle-api-nowhere-{}", std::process::id()));
        std::fs::create_dir_all(&nowhere).unwrap();
        assert_eq!(resolve_project_dir(&nowhere), None);
    }
}
```

- [ ] **Step 2: Run to see them fail**

Add `mod agent_api;` to `src-tauri/src/main.rs` after `mod ledger;`. Run: `cd src-tauri && cargo test agent_api::`
Expected: compile errors, `catalog`, `call`, `resolve_project_dir` missing.

- [ ] **Step 3: Implement the catalog, list and read**

In `agent_api.rs` above the tests:

```rust
use crate::notes::{index, parse};

pub(crate) struct Outcome { pub summary: String, pub data: Value }

pub(crate) struct ToolSpec {
    pub name: &'static str,
    pub description: &'static str,
    pub input_schema: Value,
}

type Handler = fn(&Path, &Value) -> Result<Outcome, String>;

struct Capability { spec: ToolSpec, run: Handler }

fn caps() -> Vec<Capability> {
    vec![
        Capability {
            spec: ToolSpec {
                name: "chronicle.notes.list",
                description: "List the project's notes, newest first. Filter by status, round, tag, or a text search over titles and bodies.",
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "status": { "type": "string", "description": "queued, in_progress, done, or any status the vault uses" },
                        "round": { "type": "integer", "description": "only notes in this round" },
                        "tag": { "type": "string" },
                        "text": { "type": "string", "description": "case-insensitive substring over title and body" },
                        "limit": { "type": "integer", "default": 200 }
                    }
                }),
            },
            run: notes_list,
        },
        Capability {
            spec: ToolSpec {
                name: "chronicle.notes.read",
                description: "Read one note: its front matter as a map of raw strings, and its body.",
                input_schema: json!({
                    "type": "object",
                    "required": ["path"],
                    "properties": { "path": { "type": "string", "description": "vault-relative path, e.g. Tasks/T-012 Login.md" } }
                }),
            },
            run: notes_read,
        },
    ]
}

pub(crate) fn catalog() -> Vec<ToolSpec> { caps().into_iter().map(|c| c.spec).collect() }

pub(crate) fn call(dir: &Path, name: &str, args: &Value) -> Result<Outcome, String> {
    match caps().into_iter().find(|c| c.spec.name == name) {
        Some(c) => (c.run)(dir, args),
        None => Err(format!("No capability named {name}. Known: {}.",
            caps().iter().map(|c| c.spec.name).collect::<Vec<_>>().join(", "))),
    }
}

/// The folder Chronicle would open for `start`: the first ancestor (inclusive) that
/// holds chronicle.json or .chronicle/.
pub(crate) fn resolve_project_dir(start: &Path) -> Option<PathBuf> {
    let mut p = start.canonicalize().ok()?;
    loop {
        if p.join("chronicle.json").is_file() || p.join(".chronicle").is_dir() { return Some(p); }
        p = p.parent()?.to_path_buf();
    }
}

/* ---------- argument helpers: one sentence per refusal ---------- */

fn arg_str<'a>(args: &'a Value, key: &str) -> Result<Option<&'a str>, String> {
    match args.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(s)) => Ok(Some(s.as_str())),
        Some(_) => Err(format!("{key} must be a string.")),
    }
}
fn arg_u64(args: &Value, key: &str) -> Result<Option<u64>, String> {
    match args.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(v) => v.as_u64().map(Some).ok_or_else(|| format!("{key} must be a whole number.")),
    }
}
fn required_str<'a>(args: &'a Value, key: &str) -> Result<&'a str, String> {
    arg_str(args, key)?.filter(|s| !s.trim().is_empty()).ok_or_else(|| format!("{key} is required."))
}

/* ---------- notes ---------- */

fn read_note_file(dir: &Path, rel: &str) -> Result<(parse::FrontMatter, String), String> {
    let full = crate::notes::note_file_in(dir, rel)?;
    let text = std::fs::read_to_string(&full).map_err(|_| format!("There is no note at {rel}."))?;
    Ok(parse::split_front_matter(&text))
}

/// One list row. Front-matter keys the file lacks are null; nothing is invented.
pub(crate) fn note_row(vault: &Path, rel: &str) -> Value {
    let text = std::fs::read_to_string(vault.join(rel)).unwrap_or_default();
    let (fm, body) = parse::split_front_matter(&text);
    let title = rel.rsplit_once('/').map(|(_, f)| f).unwrap_or(rel).trim_end_matches(".md");
    json!({
        "path": rel,
        "id": fm.get("id"),
        "title": title,
        "status": parse::status_of(&fm),
        "round": parse::round_of(&fm),
        "tags": parse::tags_of(&fm, &body),
        "created": fm.get("created"),
        "updated": fm.get("updated"),
    })
}

fn notes_list(dir: &Path, args: &Value) -> Result<Outcome, String> {
    let status = arg_str(args, "status")?;
    let round = arg_u64(args, "round")?;
    let tag = arg_str(args, "tag")?;
    let text = arg_str(args, "text")?.map(|t| t.to_lowercase());
    let limit = arg_u64(args, "limit")?.unwrap_or(200) as usize;
    let vault = index::vault_dir(dir);
    let mut entries = index::walk(&vault);
    entries.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0))); // newest first, then path
    let mut rows = Vec::new();
    for (rel, _, _) in entries {
        let row = note_row(&vault, &rel);
        if let Some(s) = status { if row["status"].as_str() != Some(s) { continue } }
        if let Some(r) = round { if row["round"].as_u64() != Some(r) { continue } }
        if let Some(t) = tag { if !row["tags"].as_array().map(|a| a.iter().any(|x| x == t)).unwrap_or(false) { continue } }
        if let Some(q) = &text {
            let body = std::fs::read_to_string(vault.join(&rel)).unwrap_or_default().to_lowercase();
            if !body.contains(q) && !rel.to_lowercase().contains(q) { continue }
        }
        rows.push(row);
        if rows.len() >= limit { break }
    }
    let n = rows.len();
    Ok(Outcome { summary: format!("{n} note{}.", if n == 1 { "" } else { "s" }), data: json!({ "notes": rows }) })
}

fn notes_read(dir: &Path, args: &Value) -> Result<Outcome, String> {
    let rel = required_str(args, "path")?;
    let (fm, body) = read_note_file(dir, rel)?;
    let front: serde_json::Map<String, Value> = fm.entries.iter()
        .map(|(k, v)| (k.clone(), Value::String(v.clone()))).collect();
    let mut summary = rel.to_string();
    if let Some(s) = parse::status_of(&fm) { summary.push_str(&format!(" · {s}")); }
    if let Some(r) = parse::round_of(&fm) { summary.push_str(&format!(" · round {r}")); }
    summary.push('.');
    Ok(Outcome { summary, data: json!({ "path": rel, "front": front, "body": body }) })
}
```

In `main.rs`: make `fn load_project` → `pub(crate) fn load_project`, and the `Project` fields `repo`, `extras`, `manifest`, `manifest_error` → `pub(crate)` (Task 4 reads them). `notes::note_file_in`, `index::walk`, `index::vault_dir`, `parse::*` are already `pub`.

- [ ] **Step 4: Run the tests**

Run: `cd src-tauri && cargo test agent_api::`
Expected: 3 pass. Then `cargo test` fully.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/agent_api.rs src-tauri/src/main.rs
git commit -m "feat(agent): a capability catalog with notes.list and notes.read, served from disk"
```

---

### Task 3: `notes.create`, `notes.update`, `notes.set_status`, `notes.attach`

**Files:**
- Modify: `src-tauri/src/agent_api.rs`
- Test: `src-tauri/src/agent_api.rs` (mod tests)

**Interfaces:**
- Consumes: `notes::write_note(&Project, rel, text)`, `notes::attach(&Project, slug, ext, bytes) -> Result<String>` (returns the attachment's vault path), `parse::sanitize_title`, `rounds::is_locked`, `Project::bare` / `load_project`.
- Produces: capabilities `chronicle.notes.create`, `chronicle.notes.update`, `chronicle.notes.set_status`, `chronicle.notes.attach`; helpers `fn known_statuses(dir) -> Vec<String>`, `fn next_id(dir) -> String`, `fn new_note_path(dir, folder, title) -> String`.

- [ ] **Step 1: Write the failing tests**

```rust
    #[test]
    fn create_allocates_the_next_id_and_a_safe_file_name() {
        let d = vault("create");
        put(&d, "Tasks/T-007 Old.md", "---\nid: T-007\nstatus: done\n---\n\n# Old\n");
        put(&d, "Tasks/T-012 Older.md", "---\nid: T-012\nstatus: done\n---\n\n# Older\n");
        let r = call(&d, "chronicle.notes.create", &json!({"title": "Login: card overlaps / 13\" screens", "tags": ["bug"], "body": "It overlaps."})).unwrap();
        assert_eq!(r.data["id"], "T-013");
        let expect = format!("Tasks/{}.md", parse::sanitize_title("Login: card overlaps / 13\" screens"));
        assert_eq!(r.data["path"], expect, "the app's sanitize_title names the file");
        assert!(!expect.contains(':') && !expect.contains('/') || expect.matches('/').count() == 1, "{expect}");
        assert_eq!(r.summary, format!("Created {expect} as T-013 · queued."));
        let text = std::fs::read_to_string(d.join(".chronicle/notes").join(r.data["path"].as_str().unwrap())).unwrap();
        assert!(text.starts_with("---\n"), "{text}");
        for line in ["id: T-013", "status: queued", "tags: [bug]"] { assert!(text.contains(&format!("\n{line}\n")), "{line} in {text}"); }
        assert!(text.contains("created: "), "write_note stamps created/updated");
        assert!(text.ends_with("# Login: card overlaps / 13\" screens\n\nIt overlaps.\n"), "{text}");
        // a second note with the same title gets ` 2`
        let r2 = call(&d, "chronicle.notes.create", &json!({"title": "Login: card overlaps / 13\" screens"})).unwrap();
        assert_eq!(r2.data["path"], expect.replace(".md", " 2.md"));
        assert_eq!(r2.data["id"], "T-014");
        // folder and status are honoured; an unknown status is refused with the list
        let r3 = call(&d, "chronicle.notes.create", &json!({"title": "Idea", "folder": "Ideas", "status": "done"})).unwrap();
        assert_eq!(r3.data["path"], "Ideas/Idea.md");
        let e = call(&d, "chronicle.notes.create", &json!({"title": "X", "status": "shipped"})).unwrap_err();
        assert_eq!(e, "shipped isn't a status this vault uses. Known: done, in_progress, queued.");
        assert_eq!(call(&d, "chronicle.notes.create", &json!({})).unwrap_err(), "title is required.");
        assert_eq!(call(&d, "chronicle.notes.create", &json!({"title": "X", "folder": "../out"})).unwrap_err(),
                   "that path isn't inside the notes vault");
    }

    #[test]
    fn update_and_set_status_edit_front_matter_and_body_in_place() {
        let d = vault("update");
        put(&d, "Tasks/T-001 A.md", "---\nid: T-001\nstatus: queued\nweird: kept\n---\n\n# A\n\nold body\n");
        let r = call(&d, "chronicle.notes.update", &json!({"path": "Tasks/T-001 A.md", "set": {"status": "in_progress", "owner": "me"}, "unset": ["weird"], "body": "# A\n\nnew body\n"})).unwrap();
        assert_eq!(r.data["front"]["status"], "in_progress");
        assert_eq!(r.data["front"]["owner"], "me");
        assert_eq!(r.data["front"].get("weird"), None);
        let text = std::fs::read_to_string(d.join(".chronicle/notes/Tasks/T-001 A.md")).unwrap();
        assert!(text.contains("owner: me"));
        assert!(!text.contains("weird"));
        assert!(text.ends_with("# A\n\nnew body\n"));
        assert_eq!(r.summary, "Updated Tasks/T-001 A.md · in_progress.");
        let e = call(&d, "chronicle.notes.update", &json!({"path": "Tasks/T-001 A.md", "set": {"status": "nope"}})).unwrap_err();
        assert!(e.starts_with("nope isn't a status this vault uses."));
        let s = call(&d, "chronicle.notes.set_status", &json!({"path": "Tasks/T-001 A.md", "status": "done"})).unwrap();
        assert_eq!(s.data["status"], "done");
        assert_eq!(s.summary, "Tasks/T-001 A.md is now done.");
        assert_eq!(call(&d, "chronicle.notes.set_status", &json!({"path": "Tasks/Missing.md", "status": "done"})).unwrap_err(),
                   "There is no note at Tasks/Missing.md.");
        // a note locked by a live round is refused the way the app refuses it
        std::fs::write(d.join(".chronicle/rounds.json"), r#"{"version":1,"rounds":[{"n":1,"state":"ready","note_paths":["Tasks/T-001 A.md"]}]}"#).unwrap();
        assert_eq!(call(&d, "chronicle.notes.update", &json!({"path": "Tasks/T-001 A.md", "body": "x"})).unwrap_err(),
                   "Tasks/T-001 A.md is locked by round 1 while it runs.");
    }

    #[test]
    fn attach_copies_a_file_into_the_vault_and_links_it() {
        let d = vault("attach");
        put(&d, "Tasks/T-001 A.md", "---\nid: T-001\nstatus: queued\n---\n\n# A\n");
        std::fs::write(d.join("shot.png"), b"\x89PNGfake").unwrap();
        let r = call(&d, "chronicle.notes.attach", &json!({"path": "Tasks/T-001 A.md", "file": "shot.png"})).unwrap();
        let att = r.data["attachment"].as_str().unwrap().to_string();
        assert!(att.starts_with(".chronicle/attachments/") && att.ends_with(".png"), "{att}");
        assert!(d.join(&att).exists());
        let text = std::fs::read_to_string(d.join(".chronicle/notes/Tasks/T-001 A.md")).unwrap();
        assert!(text.trim_end().ends_with(&format!("![shot]({att})")), "the note ends with the embed: {text}");
        assert_eq!(call(&d, "chronicle.notes.attach", &json!({"path": "Tasks/T-001 A.md", "file": "/etc/passwd"})).unwrap_err(),
                   "file must be inside the project.");
        assert_eq!(call(&d, "chronicle.notes.attach", &json!({"path": "Tasks/T-001 A.md", "file": "missing.png"})).unwrap_err(),
                   "There is no file at missing.png.");
    }
```

- [ ] **Step 2: Run to see them fail**

Run: `cd src-tauri && cargo test agent_api::`
Expected: the three new tests fail with "No capability named chronicle.notes.create…".

- [ ] **Step 3: Implement**

Add four `Capability` entries to `caps()` (after `notes.read`):

```rust
        Capability {
            spec: ToolSpec {
                name: "chronicle.notes.create",
                description: "Create a note in the vault. Allocates the next T-id, writes the front matter, and returns the path.",
                input_schema: json!({
                    "type": "object", "required": ["title"],
                    "properties": {
                        "title": { "type": "string" },
                        "body": { "type": "string", "description": "markdown below the title" },
                        "folder": { "type": "string", "default": "Tasks" },
                        "tags": { "type": "array", "items": { "type": "string" } },
                        "status": { "type": "string", "default": "queued" }
                    }
                }),
            },
            run: notes_create,
        },
        Capability {
            spec: ToolSpec {
                name: "chronicle.notes.update",
                description: "Edit a note in place: set or unset front-matter keys, replace the body, or both. Unknown keys are kept.",
                input_schema: json!({
                    "type": "object", "required": ["path"],
                    "properties": {
                        "path": { "type": "string" },
                        "set": { "type": "object", "additionalProperties": { "type": "string" } },
                        "unset": { "type": "array", "items": { "type": "string" } },
                        "body": { "type": "string" }
                    }
                }),
            },
            run: notes_update,
        },
        Capability {
            spec: ToolSpec {
                name: "chronicle.notes.set_status",
                description: "Set a note's status (queued, in_progress, done, or any status the vault uses).",
                input_schema: json!({ "type": "object", "required": ["path", "status"],
                    "properties": { "path": { "type": "string" }, "status": { "type": "string" } } }),
            },
            run: notes_set_status,
        },
        Capability {
            spec: ToolSpec {
                name: "chronicle.notes.attach",
                description: "Copy a file from the project into the vault's attachments and embed it at the end of the note.",
                input_schema: json!({ "type": "object", "required": ["path", "file"],
                    "properties": { "path": { "type": "string" }, "file": { "type": "string", "description": "project-relative or absolute path inside the project" } } }),
            },
            run: notes_attach,
        },
```

And the handlers plus helpers:

```rust
const BASE_STATUSES: [&str; 3] = ["queued", "in_progress", "done"];

/// queued, in_progress, done, plus every status the vault already uses. Sorted.
fn known_statuses(dir: &Path) -> Vec<String> {
    let vault = index::vault_dir(dir);
    let mut out: Vec<String> = BASE_STATUSES.iter().map(|s| s.to_string()).collect();
    for (rel, _, _) in index::walk(&vault) {
        if let Some(s) = note_row(&vault, &rel)["status"].as_str() { out.push(s.to_string()); }
    }
    out.sort(); out.dedup(); out
}

fn check_status(dir: &Path, status: &str) -> Result<(), String> {
    let known = known_statuses(dir);
    if known.iter().any(|k| k == status) { return Ok(()) }
    Err(format!("{status} isn't a status this vault uses. Known: {}.", known.join(", ")))
}

/// T-<n>: one past the highest numeric T-id in the vault. Migrated notes carry ids; the
/// app's own new notes do not, so the first agent-created note after a migration of
/// T-001..T-140 is T-141.
fn next_id(dir: &Path) -> String {
    let vault = index::vault_dir(dir);
    let max = index::walk(&vault).into_iter()
        .filter_map(|(rel, _, _)| note_row(&vault, &rel)["id"].as_str().map(str::to_string))
        .filter_map(|id| id.strip_prefix("T-").and_then(|n| n.parse::<u64>().ok()))
        .max().unwrap_or(0);
    format!("T-{:03}", max + 1)
}

/// `<folder>/<sanitized title>.md`, then ` 2`, ` 3` … on collision (the app's newNotePath).
fn new_note_path(dir: &Path, folder: &str, title: &str) -> Result<String, String> {
    let base = { let s = parse::sanitize_title(title); if s.is_empty() { "Untitled".to_string() } else { s } };
    let at = |name: &str| if folder.is_empty() { format!("{name}.md") } else { format!("{folder}/{name}.md") };
    let full = crate::notes::note_file_in(dir, &at(&base))?; // jails the folder too
    if !full.exists() { return Ok(at(&base)) }
    for n in 2.. {
        let rel = at(&format!("{base} {n}"));
        if !crate::notes::note_file_in(dir, &rel)?.exists() { return Ok(rel) }
    }
    unreachable!()
}

fn write_locked_aware(dir: &Path, rel: &str, text: &str) -> Result<(), String> {
    if let Some(n) = crate::notes::rounds::locking_round(dir, rel) {
        return Err(format!("{rel} is locked by round {n} while it runs."));
    }
    crate::notes::write_note(&crate::Project::bare(dir), rel, text)
}

fn notes_create(dir: &Path, args: &Value) -> Result<Outcome, String> {
    let title = required_str(args, "title")?;
    let folder = arg_str(args, "folder")?.unwrap_or("Tasks").trim_matches('/');
    let status = arg_str(args, "status")?.unwrap_or("queued");
    check_status(dir, status)?;
    let tags: Vec<String> = match args.get("tags") {
        None | Some(Value::Null) => vec![],
        Some(Value::Array(a)) => a.iter().filter_map(|v| v.as_str().map(str::to_string)).collect(),
        Some(_) => return Err("tags must be a list of strings.".into()),
    };
    let body = arg_str(args, "body")?.unwrap_or("").trim_end();
    let rel = new_note_path(dir, folder, title)?;
    let id = next_id(dir);
    let mut fm = parse::FrontMatter { entries: vec![] };
    fm.set("id", &id);
    fm.set("status", status);
    if !tags.is_empty() { fm.set_list("tags", &tags); }
    let text = parse::join_front_matter(&fm, &format!("# {title}\n\n{}{}", body, if body.is_empty() { "" } else { "\n" }));
    write_locked_aware(dir, &rel, &text)?;
    Ok(Outcome { summary: format!("Created {rel} as {id} · {status}."), data: json!({ "path": rel, "id": id, "status": status }) })
}

fn notes_update(dir: &Path, args: &Value) -> Result<Outcome, String> {
    let rel = required_str(args, "path")?;
    let (mut fm, old_body) = read_note_file(dir, rel)?;
    if let Some(set) = args.get("set") {
        let obj = set.as_object().ok_or("set must be an object of strings.")?;
        for (k, v) in obj {
            let v = v.as_str().ok_or_else(|| format!("set.{k} must be a string."))?;
            if k == "status" { check_status(dir, v)?; }
            fm.set(k, v);
        }
    }
    if let Some(unset) = args.get("unset") {
        for k in unset.as_array().ok_or("unset must be a list of keys.")? {
            fm.remove(k.as_str().ok_or("unset must be a list of keys.")?);
        }
    }
    let body = arg_str(args, "body")?.map(str::to_string).unwrap_or(old_body);
    write_locked_aware(dir, rel, &parse::join_front_matter(&fm, &body))?;
    let (fm, _) = read_note_file(dir, rel)?;
    let front: serde_json::Map<String, Value> = fm.entries.iter().map(|(k, v)| (k.clone(), Value::String(v.clone()))).collect();
    let status = parse::status_of(&fm).unwrap_or_else(|| "no status".into());
    Ok(Outcome { summary: format!("Updated {rel} · {status}."), data: json!({ "path": rel, "front": front }) })
}

fn notes_set_status(dir: &Path, args: &Value) -> Result<Outcome, String> {
    let rel = required_str(args, "path")?;
    let status = required_str(args, "status")?;
    check_status(dir, status)?;
    let (mut fm, body) = read_note_file(dir, rel)?;
    fm.set("status", status);
    write_locked_aware(dir, rel, &parse::join_front_matter(&fm, &body))?;
    Ok(Outcome { summary: format!("{rel} is now {status}."), data: json!({ "path": rel, "status": status }) })
}

fn notes_attach(dir: &Path, args: &Value) -> Result<Outcome, String> {
    let rel = required_str(args, "path")?;
    let file = required_str(args, "file")?;
    let p = crate::load_project(dir);
    let ctx = crate::Ctx::build(&p);
    let src = if Path::new(file).is_absolute() {
        let canon = Path::new(file).canonicalize().map_err(|_| format!("There is no file at {file}."))?;
        let root = p.dir.canonicalize().map_err(|e| e.to_string())?;
        if !canon.starts_with(&root) { return Err("file must be inside the project.".into()) }
        canon
    } else {
        ctx.resolve_jailed(file).ok_or_else(|| if file.contains("..") || file.starts_with('/') {
            "file must be inside the project.".to_string() } else { format!("There is no file at {file}.") })?
    };
    let bytes = std::fs::read(&src).map_err(|_| format!("There is no file at {file}."))?;
    let stem = src.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| "file".into());
    let ext = src.extension().map(|e| e.to_string_lossy().into_owned()).unwrap_or_default();
    let att = crate::notes::attach(&p, &parse::sanitize_title(&stem), &ext, &bytes)?;
    let (fm, body) = read_note_file(dir, rel)?;
    let body = format!("{}\n\n![{stem}]({att})\n", body.trim_end());
    write_locked_aware(dir, rel, &parse::join_front_matter(&fm, &body))?;
    Ok(Outcome { summary: format!("Attached {file} to {rel}."), data: json!({ "path": rel, "attachment": att }) })
}
```

Add to `src-tauri/src/notes/rounds.rs`, next to `is_locked`:

```rust
/// Which live round holds this note, if any (the number `is_locked` hides).
pub fn locking_round(dir: &Path, rel: &str) -> Option<u64> {
    load_or_none(dir).into_iter()
        .find(|r| (r.state == "generating" || r.state == "ready") && r.note_paths.iter().any(|p| p == rel))
        .map(|r| r.n)
}
```

(Read `is_locked` first and mirror exactly which states it treats as live; use the same predicate.) Check `notes::attach`'s signature and adapt the `stem`/`ext` split if it expects them differently; `Ctx::build` and `Ctx::resolve_jailed` are in main.rs and need `pub(crate)` (`struct Ctx`, `fn build`, `fn resolve_jailed`).

- [ ] **Step 4: Run the tests and commit**

Run: `cd src-tauri && cargo test agent_api:: && cargo test 2>&1 | tail -3`
Expected: all pass.

```bash
git add src-tauri/src/agent_api.rs src-tauri/src/notes/rounds.rs src-tauri/src/main.rs
git commit -m "feat(agent): notes.create, update, set_status and attach, with ids, safe names and round locks"
```

---

### Task 4: `state.phases`, `state.needs_you`, `state.rounds`

**Files:**
- Modify: `src-tauri/src/agent_api.rs`
- Modify: `src-tauri/src/main.rs` (`derive_project` → `pub(crate)`; a new `pub(crate) fn needs_you_sentences(p: &Project) -> Vec<Value>`)
- Test: `src-tauri/src/agent_api.rs` (mod tests) and `mod r3_tests` in main.rs

**Interfaces:**
- Consumes: `derive_project(&Project, &Ctx, write: false) -> Value` (`{ name, statuses: [{id, state, label, proof?, live}], warnings, new_plans, newer_release, ledger_set_aside }`), `state_for_project(&Project) -> Value` (branch, upstream, ahead, behind, remote_url, worktrees, stale, new_plans, newer_release, work_branch), `notes::rounds::load`, `notes::rounds::statuses_for`.
- Produces: `chronicle.state.phases` (data = the derive JSON plus `manifest_present`), `chronicle.state.needs_you` (data = `{ rows: [{ id, title, sub, command }] }`), `chronicle.state.rounds` (data = `{ rounds: [{ n, kind, state, notes: {path: status} }] }`).

- [ ] **Step 1: Write the failing tests**

In `agent_api.rs` tests:

```rust
    fn git(d: &Path, args: &[&str]) {
        let o = std::process::Command::new("git").arg("-C").arg(d).args(args).output().unwrap();
        assert!(o.status.success(), "git {:?}: {}", args, String::from_utf8_lossy(&o.stderr));
    }

    #[test]
    fn state_answers_from_the_roadmap_and_git_without_latching() {
        let d = vault("state");
        git(&d, &["init", "-q", "-b", "main"]);
        git(&d, &["-c", "user.email=t@t", "-c", "user.name=t", "commit", "--allow-empty", "-m", "feat: first save"]);
        git(&d, &["tag", "v0.1.0"]);
        std::fs::write(d.join("chronicle.json"), r#"{"chronicleVersion":1,"name":"t","workBranch":"main","stages":[{"title":"S","phases":[
            {"id":"A","name":"Done one","status":{"done_when":[{"tag":"v0.1.0"}]}},
            {"id":"B","name":"Next one","status":{"done_when":[{"tag":"v0.2.0"}]}}]}]}"#).unwrap();
        let ph = call(&d, "chronicle.state.phases", &json!({})).unwrap();
        let st = ph.data["statuses"].as_array().unwrap();
        assert_eq!((st[0]["id"].as_str(), st[0]["state"].as_str(), st[0]["live"].as_bool()), (Some("A"), Some("done"), Some(true)));
        assert_eq!((st[1]["id"].as_str(), st[1]["state"].as_str()), (Some("B"), Some("now")));
        assert_eq!(ph.summary, "A done · B now (up next) · 1 of 2 done.");
        assert!(!d.join(".chronicle/roadmap-ledger.json").exists(), "reading state never latches");

        let ny = call(&d, "chronicle.state.needs_you", &json!({})).unwrap();
        let rows = ny.data["rows"].as_array().unwrap();
        assert!(rows.iter().any(|r| r["id"] == "github"), "no remote: the GitHub row, {rows:?}");
        assert!(rows.iter().all(|r| r["title"].is_string() && r["sub"].is_string()));
        assert!(ny.summary.ends_with("thing needs you.") || ny.summary.ends_with("things need you."), "{}", ny.summary);

        put(&d, "Tasks/T-001 A.md", "---\nid: T-001\nstatus: done\nround: 1\n---\n\n# A\n");
        put(&d, "Tasks/T-002 B.md", "---\nid: T-002\nstatus: in_progress\nround: 1\n---\n\n# B\n");
        std::fs::write(d.join(".chronicle/rounds.json"), r#"{"version":1,"rounds":[{"n":1,"state":"ready","kind":"bug fixes","note_paths":["Tasks/T-001 A.md","Tasks/T-002 B.md"]}]}"#).unwrap();
        let rd = call(&d, "chronicle.state.rounds", &json!({})).unwrap();
        let r = &rd.data["rounds"][0];
        assert_eq!(r["n"], 1);
        assert_eq!(r["kind"], "bug fixes");
        assert_eq!(r["notes"]["Tasks/T-001 A.md"], "done");
        assert_eq!(r["notes"]["Tasks/T-002 B.md"], "in_progress");
        assert_eq!(rd.summary, "1 round · round 1 bug fixes ready, 1 of 2 notes done.");
    }

    #[test]
    fn state_without_a_roadmap_says_so() {
        let d = vault("noroadmap");
        let ph = call(&d, "chronicle.state.phases", &json!({})).unwrap();
        assert_eq!(ph.data["manifest_present"], false);
        assert_eq!(ph.summary, "This project has no roadmap yet (no chronicle.json).");
    }
```

- [ ] **Step 2: Run to see them fail**

Run: `cd src-tauri && cargo test agent_api::state`
Expected: "No capability named chronicle.state.phases…".

- [ ] **Step 3: Implement**

In main.rs, make `derive_project` and `state_for_project` `pub(crate)`, and add after `state_for_project`:

```rust
/// The built-in "what needs you" rows as the app phrases them, computed from the same
/// facts `state_for_project` reports. The frontend's `needsYouRows` is the wording
/// reference; keep the two in step.
pub(crate) fn needs_you_sentences(p: &Project) -> Vec<Value> {
    let s = state_for_project(p);
    let str_of = |k: &str| s.get(k).and_then(|v| v.as_str()).unwrap_or("").to_string();
    let num = |k: &str| s.get(k).and_then(|v| v.as_u64()).unwrap_or(0);
    let flag = |k: &str| s.get(k).and_then(|v| v.as_bool()).unwrap_or(false);
    let mut rows = Vec::new();
    let mut row = |id: &str, title: String, sub: &str, command: String| {
        rows.push(json!({ "id": id, "title": title, "sub": sub, "command": command }));
    };
    if flag("is_git") {
        let branch = str_of("branch");
        let work = str_of("work_branch");
        if !work.is_empty() && !branch.is_empty() && branch != work {
            row("branch", format!("You're on {branch}"), &format!("This project works on its own branch ({work})."), format!("git checkout {work}"));
        }
        if !flag("upstream") && !branch.is_empty() {
            if str_of("remote_url").is_empty() {
                let slug = p.repo.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| "project".into());
                row("github", "Put this project on GitHub".into(), "It has no online home yet.", format!("gh repo create {slug} --private --source=. --push"));
            } else {
                row("publish-first", "Publish the work online".into(), "Everything here exists only on this Mac right now.", format!("git push -u origin {branch}"));
            }
        }
        if flag("upstream") && num("ahead") > 0 {
            let n = num("ahead");
            row("publish", format!("Publish {n} save{}", if n > 1 { "s" } else { "" }), "Saved to history, not online yet.", format!("git push origin {branch}"));
        }
        if flag("upstream") && num("behind") > 0 {
            row("pull", "The online copy is newer".into(), "Bring it down before working.", "git pull --ff-only".into());
        }
        let prunable = s.get("worktrees").and_then(|v| v.as_array()).map(|a| a.iter().filter(|w| w["prunable"].as_bool() == Some(true)).count()).unwrap_or(0);
        if prunable > 0 {
            row("prune", format!("Clean up {prunable} leftover workspace{}", if prunable > 1 { "s" } else { "" }), "A finished agent session left a working copy behind.", "git worktree prune".into());
        }
    }
    if s.get("manifest_present").and_then(|v| v.as_bool()) == Some(true) {
        for d in s.get("stale").and_then(|v| v.as_array()).cloned().unwrap_or_default() {
            let d = d.as_str().unwrap_or("").to_string();
            row(&format!("behind-doc:{d}"), format!("{d} changed since the roadmap was written"), "A refresh reads it again and updates only what changed.", String::new());
        }
        for pth in s.get("new_plans").and_then(|v| v.as_array()).cloned().unwrap_or_default() {
            let pth = pth.as_str().unwrap_or("").to_string();
            let name = pth.rsplit('/').next().unwrap_or(&pth).to_string();
            row(&format!("behind-plan:{pth}"), format!("{name} is not on the roadmap"), "A plan file newer than the roadmap that it never mentions.", String::new());
        }
        if let Some(pair) = s.get("newer_release").and_then(|v| v.as_array()) {
            if pair.len() == 2 {
                row("behind-release", format!("{} shipped, the roadmap ends at {}", pair[0].as_str().unwrap_or(""), pair[1].as_str().unwrap_or("")), "Releases after the last phase the roadmap knows about.", String::new());
            }
        }
    }
    rows
}
```

In `agent_api.rs`, three more `Capability` entries (`chronicle.state.phases`, `chronicle.state.needs_you`, `chronicle.state.rounds`, each with `input_schema: json!({"type": "object", "properties": {}})` and one-sentence descriptions: "Every roadmap phase with its state, label, what proved it, and whether the repo still proves it now. Never writes anything." / "What needs the user right now: git housekeeping and a roadmap that fell behind, as the app phrases them." / "Every round with its kind, state, and each note's status.") and handlers:

```rust
fn state_phases(dir: &Path, _args: &Value) -> Result<Outcome, String> {
    let p = crate::load_project(dir);
    if p.manifest.is_none() {
        let why = p.manifest_error.clone().map(|e| format!(" (chronicle.json can't be read: {e})")).unwrap_or_else(|| " (no chronicle.json)".into());
        return Ok(Outcome { summary: format!("This project has no roadmap yet{why}."), data: json!({ "manifest_present": false, "statuses": [] }) });
    }
    let ctx = crate::Ctx::build(&p);
    let mut data = crate::derive_project(&p, &ctx, false);
    data["manifest_present"] = json!(true);
    let statuses = data["statuses"].as_array().cloned().unwrap_or_default();
    let real: Vec<&Value> = statuses.iter().filter(|s| matches!(s["state"].as_str(), Some("done" | "now" | "later"))).collect();
    let done = real.iter().filter(|s| s["state"] == "done").count();
    let mut parts: Vec<String> = statuses.iter().filter(|s| s["state"] != "later" && s["state"] != "pool").map(|s| {
        let id = s["id"].as_str().unwrap_or("?");
        match s["state"].as_str() {
            Some("now") => format!("{id} now ({})", s["label"].as_str().unwrap_or("up next")),
            Some(st) => format!("{id} {st}"),
            None => id.to_string(),
        }
    }).collect();
    parts.push(format!("{done} of {} done", real.len()));
    Ok(Outcome { summary: format!("{}.", parts.join(" · ")), data })
}

fn state_needs_you(dir: &Path, _args: &Value) -> Result<Outcome, String> {
    let p = crate::load_project(dir);
    let rows = crate::needs_you_sentences(&p);
    let n = rows.len();
    let summary = match n { 0 => "Nothing needs you.".to_string(), 1 => "1 thing needs you.".to_string(), n => format!("{n} things need you.") };
    Ok(Outcome { summary, data: json!({ "rows": rows }) })
}

fn state_rounds(dir: &Path, _args: &Value) -> Result<Outcome, String> {
    let rounds = crate::notes::rounds::load(dir)?;
    let mut out = Vec::new();
    let mut lines = Vec::new();
    for r in &rounds {
        let st = crate::notes::rounds::statuses_for(dir, &r.note_paths);
        let notes: serde_json::Map<String, Value> = r.note_paths.iter()
            .map(|p| (p.clone(), st.get(p).cloned().flatten().map(Value::String).unwrap_or(Value::Null))).collect();
        let done = notes.values().filter(|v| v.as_str() == Some("done")).count();
        lines.push(format!("round {} {} {}, {} of {} notes done", r.n, r.kind.clone().unwrap_or_else(|| "round".into()), r.state, done, r.note_paths.len()));
        out.push(json!({ "n": r.n, "kind": r.kind, "state": r.state, "notes": notes }));
    }
    let n = out.len();
    let summary = if n == 0 { "No rounds yet.".to_string() } else { format!("{n} round{} · {}.", if n == 1 { "" } else { "s" }, lines.join(" · ")) };
    Ok(Outcome { summary, data: json!({ "rounds": out }) })
}
```

Add one test to `mod r3_tests` in main.rs pinning the sentences against the frontend's wording for two cases (no remote → "Put this project on GitHub"; ahead 2 → "Publish 2 saves"), built on a scratch repo like the existing tests.

- [ ] **Step 4: Run and commit**

Run: `cd src-tauri && cargo test agent_api:: && cargo test r3_tests && cargo test 2>&1 | tail -3`
Expected: green.

```bash
git add src-tauri/src/agent_api.rs src-tauri/src/main.rs
git commit -m "feat(agent): state.phases, needs_you and rounds answer from the same derivation the app uses, never latching"
```

---

### Task 5: The CLI front

**Files:**
- Create: `src-tauri/src/cli.rs`
- Modify: `src-tauri/src/main.rs` (`mod cli;` and the dispatch at the top of `main()`)
- Test: `src-tauri/src/cli.rs` (mod tests)

**Interfaces:**
- Consumes: `agent_api::{catalog, call, resolve_project_dir, Outcome}`.
- Produces: `pub(crate) fn run(args: &[String]) -> Option<i32>` — `None` when the args are not a CLI invocation (the app should launch), else the exit code after printing. `pub(crate) fn parse(args: &[String]) -> Result<Invocation, Usage>` with `Invocation { name: String, args: Value, dir: Option<PathBuf>, json: bool }` and `Usage(String)`. `pub(crate) fn render_table(name: &str, out: &Outcome) -> String`.

- [ ] **Step 1: Write the failing tests**

```rust
//! `chronicle <group> <verb> [--flag value …] [--json] [<project-dir>]`: the shell front
//! of the capability catalog. Flags become the same JSON args MCP sends.

use crate::agent_api::{self, Outcome};
use serde_json::{json, Value};
use std::path::PathBuf;

#[cfg(test)]
mod tests {
    use super::*;
    fn a(s: &str) -> Vec<String> { s.split_whitespace().map(String::from).collect() }

    #[test]
    fn flags_become_the_same_json_args_mcp_sends() {
        let i = parse(&a("notes list --status queued --round 3 --tag ui --tag bug --limit 5 --json /tmp/p")).unwrap();
        assert_eq!(i.name, "chronicle.notes.list");
        assert_eq!(i.args, json!({"status": "queued", "round": 3, "tag": ["ui", "bug"], "limit": 5}));
        assert!(i.json);
        assert_eq!(i.dir, Some(PathBuf::from("/tmp/p")));
        let i = parse(&a("notes update --path Tasks/A.md --set status=done --set owner=me --unset weird")).unwrap();
        assert_eq!(i.args, json!({"path": "Tasks/A.md", "set": {"status": "done", "owner": "me"}, "unset": ["weird"]}));
        assert_eq!(i.dir, None);
        let i = parse(&a("notes create --title Hello --tags bug,ui")).unwrap();
        assert_eq!(i.args["tags"], json!(["bug", "ui"]));
        let i = parse(&a("state phases")).unwrap();
        assert_eq!(i.name, "chronicle.state.phases");
    }

    #[test]
    fn usage_errors_are_one_sentence_and_not_an_app_launch() {
        assert_eq!(parse(&a("notes")).unwrap_err().0, "Usage: chronicle notes <list|read|create|update|set_status|attach> [--flag value] [--json] [dir].");
        assert!(parse(&a("notes frobnicate")).unwrap_err().0.starts_with("No capability named chronicle.notes.frobnicate."));
        assert_eq!(parse(&a("notes list --status")).unwrap_err().0, "--status needs a value.");
        assert!(parse(&a("")).is_err());
        // not a CLI call at all: the app launches
        assert_eq!(run(&a("--open /tmp/x")), None);
        assert_eq!(run(&[]), None);
    }

    #[test]
    fn the_table_reads_like_the_app() {
        let out = Outcome { summary: "2 notes.".into(), data: json!({"notes": [
            {"path": "Tasks/T-001 A.md", "id": "T-001", "status": "done", "round": 1, "tags": ["ui"]},
            {"path": "Ideas/B.md", "id": null, "status": null, "round": null, "tags": []}]}) };
        let t = render_table("chronicle.notes.list", &out);
        assert_eq!(t, "T-001  done         1  ui   Tasks/T-001 A.md\n·      ·            ·  ·    Ideas/B.md\n2 notes.\n");
        let out = Outcome { summary: "A done.".into(), data: json!({"x": 1}) };
        assert_eq!(render_table("chronicle.other", &out), "A done.\n");
    }
}
```

- [ ] **Step 2: Run to see them fail**

Add `mod cli;` to main.rs. Run: `cd src-tauri && cargo test cli::`
Expected: compile errors.

- [ ] **Step 3: Implement**

```rust
pub(crate) struct Invocation { pub name: String, pub args: Value, pub dir: Option<PathBuf>, pub json: bool }
pub(crate) struct Usage(pub String);

const GROUPS: [(&str, &[&str]); 2] = [
    ("notes", &["list", "read", "create", "update", "set_status", "attach"]),
    ("state", &["phases", "needs_you", "rounds"]),
];
/// Flags that repeat into a list, and flags whose value is `key=value` into an object.
const LIST_FLAGS: [&str; 2] = ["tag", "unset"];
const MAP_FLAGS: [&str; 1] = ["set"];
const CSV_FLAGS: [&str; 1] = ["tags"];
const INT_FLAGS: [&str; 2] = ["round", "limit"];

fn usage(group: &str) -> Usage {
    match GROUPS.iter().find(|(g, _)| *g == group) {
        Some((g, verbs)) => Usage(format!("Usage: chronicle {g} <{}> [--flag value] [--json] [dir].", verbs.join("|"))),
        None => Usage(format!("Usage: chronicle <{}> <verb> [--flag value] [--json] [dir].", GROUPS.iter().map(|(g, _)| *g).collect::<Vec<_>>().join("|"))),
    }
}

pub(crate) fn parse(args: &[String]) -> Result<Invocation, Usage> {
    let group = args.first().filter(|g| GROUPS.iter().any(|(k, _)| k == g)).ok_or_else(|| usage(""))?;
    let verb = args.get(1).ok_or_else(|| usage(group))?;
    if verb.starts_with("--") { return Err(usage(group)) }
    let name = format!("chronicle.{group}.{verb}");
    if !agent_api::catalog().iter().any(|t| t.name == name) {
        return Err(Usage(format!("No capability named {name}. Known verbs for {group}: {}.",
            GROUPS.iter().find(|(g, _)| g == group).map(|(_, v)| v.join(", ")).unwrap_or_default())));
    }
    let mut obj = serde_json::Map::new();
    let mut json = false;
    let mut dir = None;
    let mut i = 2;
    while i < args.len() {
        let a = &args[i];
        if a == "--json" { json = true; i += 1; continue }
        if let Some(flag) = a.strip_prefix("--") {
            let val = args.get(i + 1).filter(|v| !v.starts_with("--")).ok_or_else(|| Usage(format!("--{flag} needs a value.")))?;
            if LIST_FLAGS.contains(&flag) {
                obj.entry(flag).or_insert_with(|| json!([])).as_array_mut().unwrap().push(json!(val));
            } else if MAP_FLAGS.contains(&flag) {
                let (k, v) = val.split_once('=').ok_or_else(|| Usage(format!("--{flag} takes key=value.")))?;
                obj.entry(flag).or_insert_with(|| json!({})).as_object_mut().unwrap().insert(k.into(), json!(v));
            } else if CSV_FLAGS.contains(&flag) {
                obj.insert(flag.into(), json!(val.split(',').map(str::trim).filter(|s| !s.is_empty()).collect::<Vec<_>>()));
            } else if INT_FLAGS.contains(&flag) {
                obj.insert(flag.into(), json!(val.parse::<u64>().map_err(|_| Usage(format!("--{flag} must be a whole number.")))?));
            } else {
                obj.insert(flag.into(), json!(val));
            }
            i += 2;
        } else {
            dir = Some(PathBuf::from(a));
            i += 1;
        }
    }
    Ok(Invocation { name, args: Value::Object(obj), dir, json })
}

/// The list table: id, status, round, tags, path; other capabilities print the summary.
pub(crate) fn render_table(name: &str, out: &Outcome) -> String {
    if name != "chronicle.notes.list" { return format!("{}\n", out.summary) }
    let mut s = String::new();
    let cell = |v: &Value| v.as_str().map(str::to_string).or_else(|| v.as_u64().map(|n| n.to_string())).unwrap_or_else(|| "·".into());
    for n in out.data["notes"].as_array().cloned().unwrap_or_default() {
        let tags = n["tags"].as_array().map(|a| a.iter().filter_map(|t| t.as_str()).collect::<Vec<_>>().join(",")).unwrap_or_default();
        s.push_str(&format!("{:<5}  {:<11}  {:>1}  {:<4} {}\n", cell(&n["id"]), cell(&n["status"]), cell(&n["round"]), if tags.is_empty() { "·".to_string() } else { tags }, n["path"].as_str().unwrap_or("")));
    }
    s.push_str(&format!("{}\n", out.summary));
    s
}

/// `Some(code)` when this was a CLI call (already printed); `None` to launch the app.
pub(crate) fn run(args: &[String]) -> Option<i32> {
    let first = args.first()?;
    if !GROUPS.iter().any(|(g, _)| g == first) { return None }
    let inv = match parse(args) {
        Ok(i) => i,
        Err(Usage(u)) => { eprintln!("{u}"); return Some(2) }
    };
    let start = inv.dir.clone().unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));
    let Some(dir) = agent_api::resolve_project_dir(&start) else {
        eprintln!("No Chronicle project here: nothing above {} holds chronicle.json or .chronicle/.", start.display());
        return Some(1);
    };
    match agent_api::call(&dir, &inv.name, &inv.args) {
        Ok(out) => {
            if inv.json { println!("{}", serde_json::to_string_pretty(&json!({ "summary": out.summary, "data": out.data })).unwrap()); }
            else { print!("{}", render_table(&inv.name, &out)); }
            Some(0)
        }
        Err(e) => { eprintln!("{e}"); Some(1) }
    }
}
```

The table format string: pad id to 5, status to 11, round right-aligned width 1 (a single digit in the test; wider rounds just widen), tags padded to 4. Match the test string exactly; adjust the widths in the test if the format proves ambiguous, but keep columns aligned for the common case.

In `main()`, before the `--open` line:

```rust
    if let Some(code) = cli::run(&args[1..]) { std::process::exit(code); }
```

- [ ] **Step 4: Run and commit**

Run: `cd src-tauri && cargo test cli:: && cargo test 2>&1 | tail -3`, then a smoke run on this repo: `./target/debug/chronicle notes list --status queued --limit 3 ..` (build with `cargo build` first) and `./target/debug/chronicle state phases --json .. | head -20`.
Expected: tests green; the smoke run prints a table and JSON with exit 0.

```bash
git add src-tauri/src/cli.rs src-tauri/src/main.rs
git commit -m "feat(agent): chronicle <group> <verb> at the shell, same handlers as MCP"
```

---

### Task 6: The MCP stdio server

**Files:**
- Create: `src-tauri/src/mcp.rs`
- Modify: `src-tauri/src/main.rs` (`mod mcp;`, `--mcp` dispatch)
- Test: `src-tauri/src/mcp.rs` (mod tests)

**Interfaces:**
- Consumes: `agent_api::{catalog, call, resolve_project_dir}`.
- Produces: `pub(crate) struct Session { dir: PathBuf, initialized: bool }`, `pub(crate) fn handle_line(s: &mut Session, line: &str) -> Option<String>` (one JSON-RPC message in, zero or one out; notifications produce `None`), `pub(crate) fn serve(dir: PathBuf) -> i32` (reads stdin line by line, writes replies to stdout, flushes each; returns 0 on EOF).

Protocol facts (MCP, stdio transport): newline-delimited JSON-RPC 2.0. `initialize` → result `{ protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "chronicle", version: env!("CARGO_PKG_VERSION") }, instructions: <one paragraph> }`. Client then sends notification `notifications/initialized` (no reply). `tools/list` → `{ tools: [{ name, description, inputSchema }] }`. `tools/call` params `{ name, arguments }` → `{ content: [{ type: "text", text }], isError?: true }`. `ping` → `{}`. Unknown method → error `{ code: -32601, message: "Method not found" }`. Parse error → `{ code: -32700 }` with `id: null`.

- [ ] **Step 1: Write the failing tests**

```rust
//! `chronicle --mcp <dir>`: the Model Context Protocol front of the capability catalog,
//! newline-delimited JSON-RPC 2.0 over stdio. Tools answer from disk; nothing here
//! needs the app.

use serde_json::{json, Value};
use std::path::PathBuf;

#[cfg(test)]
mod tests {
    use super::*;

    fn session() -> (PathBuf, Session) {
        let d = std::env::temp_dir().join(format!("chronicle-mcp-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(d.join(".chronicle/notes/Tasks")).unwrap();
        std::fs::write(d.join(".chronicle/notes/Tasks/T-001 A.md"), "---\nid: T-001\nstatus: queued\n---\n\n# A\n").unwrap();
        let d = d.canonicalize().unwrap();
        (d.clone(), Session::new(d))
    }
    fn rpc(s: &mut Session, line: &str) -> Value {
        serde_json::from_str(&handle_line(s, line).expect("a reply")).unwrap()
    }

    #[test]
    fn the_handshake_then_list_then_call() {
        let (_, mut s) = session();
        let init = rpc(&mut s, r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"t","version":"0"}}}"#);
        assert_eq!(init["id"], 1);
        assert_eq!(init["result"]["protocolVersion"], "2025-06-18");
        assert_eq!(init["result"]["serverInfo"]["name"], "chronicle");
        assert!(init["result"]["capabilities"]["tools"].is_object());
        assert!(init["result"]["instructions"].as_str().unwrap().contains("notes"));
        assert!(handle_line(&mut s, r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#).is_none(), "notifications get no reply");
        let list = rpc(&mut s, r#"{"jsonrpc":"2.0","id":2,"method":"tools/list"}"#);
        let tools = list["result"]["tools"].as_array().unwrap();
        assert!(tools.iter().any(|t| t["name"] == "chronicle.notes.list" && t["inputSchema"]["type"] == "object"));
        let call = rpc(&mut s, r#"{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"chronicle.notes.list","arguments":{"status":"queued"}}}"#);
        let text = call["result"]["content"][0]["text"].as_str().unwrap();
        assert!(text.starts_with("1 note.\n"), "summary first, then JSON: {text}");
        assert!(text.contains("\"T-001\""));
        assert!(call["result"].get("isError").is_none());
        let bad = rpc(&mut s, r#"{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"chronicle.notes.read","arguments":{"path":"../x.md"}}}"#);
        assert_eq!(bad["result"]["isError"], true);
        assert_eq!(bad["result"]["content"][0]["text"], "that path isn't inside the notes vault");
        let ping = rpc(&mut s, r#"{"jsonrpc":"2.0","id":5,"method":"ping"}"#);
        assert_eq!(ping["result"], json!({}));
    }

    #[test]
    fn protocol_errors_are_jsonrpc_errors() {
        let (_, mut s) = session();
        let e = rpc(&mut s, r#"{"jsonrpc":"2.0","id":9,"method":"tools/nope"}"#);
        assert_eq!(e["error"]["code"], -32601);
        let e = rpc(&mut s, "{not json");
        assert_eq!(e["error"]["code"], -32700);
        assert_eq!(e["id"], Value::Null);
        let e = rpc(&mut s, r#"{"jsonrpc":"2.0","id":10,"method":"tools/call","params":{"name":"chronicle.nope.x","arguments":{}}}"#);
        assert_eq!(e["result"]["isError"], true, "an unknown tool is a tool error, not a protocol error");
        assert_eq!(handle_line(&mut s, ""), None, "blank lines are ignored");
    }
}
```

- [ ] **Step 2: Run to see them fail**

Add `mod mcp;` to main.rs. Run: `cd src-tauri && cargo test mcp::`
Expected: compile errors.

- [ ] **Step 3: Implement**

```rust
use crate::agent_api;

pub(crate) struct Session { dir: PathBuf, initialized: bool }
impl Session { pub(crate) fn new(dir: PathBuf) -> Self { Self { dir, initialized: false } } }

const INSTRUCTIONS: &str = "Chronicle keeps this project's notes (tasks, bugs, ideas) and its build roadmap. Use chronicle.notes.* to list, read, create and update notes instead of grepping .chronicle/notes; use chronicle.state.* before saying what is done or what is next, because it answers from git and the roadmap rules, not from memory.";

fn reply(id: Value, result: Value) -> String {
    json!({ "jsonrpc": "2.0", "id": id, "result": result }).to_string()
}
fn error(id: Value, code: i64, message: &str) -> String {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } }).to_string()
}
fn tool_text(text: String, is_error: bool) -> Value {
    let mut r = json!({ "content": [{ "type": "text", "text": text }] });
    if is_error { r["isError"] = json!(true); }
    r
}

pub(crate) fn handle_line(s: &mut Session, line: &str) -> Option<String> {
    let line = line.trim();
    if line.is_empty() { return None }
    let msg: Value = match serde_json::from_str(line) {
        Ok(v) => v,
        Err(_) => return Some(error(Value::Null, -32700, "Parse error")),
    };
    let id = msg.get("id").cloned();
    let method = msg.get("method").and_then(|m| m.as_str()).unwrap_or("");
    let params = msg.get("params").cloned().unwrap_or(json!({}));
    let Some(id) = id else { // a notification: never answered
        if method == "notifications/initialized" { s.initialized = true; }
        return None;
    };
    Some(match method {
        "initialize" => reply(id, json!({
            "protocolVersion": "2025-06-18",
            "capabilities": { "tools": {} },
            "serverInfo": { "name": "chronicle", "version": env!("CARGO_PKG_VERSION") },
            "instructions": INSTRUCTIONS,
        })),
        "ping" => reply(id, json!({})),
        "tools/list" => reply(id, json!({ "tools": agent_api::catalog().iter().map(|t| json!({
            "name": t.name, "description": t.description, "inputSchema": t.input_schema })).collect::<Vec<_>>() })),
        "tools/call" => {
            let name = params.get("name").and_then(|n| n.as_str()).unwrap_or("");
            let args = params.get("arguments").cloned().unwrap_or(json!({}));
            match agent_api::call(&s.dir, name, &args) {
                Ok(out) => reply(id, tool_text(format!("{}\n{}", out.summary, serde_json::to_string_pretty(&out.data).unwrap_or_default()), false)),
                Err(e) => reply(id, tool_text(e, true)),
            }
        }
        _ => error(id, -32601, "Method not found"),
    })
}

/// Serve until stdin closes. Every reply is one line, flushed at once.
pub(crate) fn serve(dir: PathBuf) -> i32 {
    use std::io::{BufRead, Write};
    let mut s = Session::new(dir);
    let stdin = std::io::stdin();
    let mut out = std::io::stdout().lock();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        if let Some(r) = handle_line(&mut s, &line) {
            if writeln!(out, "{r}").is_err() || out.flush().is_err() { break }
        }
    }
    0
}
```

In `main()`, next to `--derive`:

```rust
    if let Some(i) = args.iter().position(|a| a == "--mcp") {
        let start = args.get(i + 1).map(PathBuf::from).unwrap_or_else(|| PathBuf::from("."));
        match agent_api::resolve_project_dir(&start) {
            Some(dir) => std::process::exit(mcp::serve(dir)),
            None => { eprintln!("No Chronicle project at {}.", start.display()); std::process::exit(1) }
        }
    }
```

- [ ] **Step 4: Run, smoke, commit**

Run: `cd src-tauri && cargo test mcp:: && cargo test 2>&1 | tail -3`. Smoke: `printf '%s\n%s\n%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' '{"jsonrpc":"2.0","method":"notifications/initialized"}' '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"chronicle.state.phases","arguments":{}}}' | ./target/debug/chronicle --mcp .. | head -c 600`.
Expected: two JSON lines, the second carrying the phase summary for this repo.

```bash
git add src-tauri/src/mcp.rs src-tauri/src/main.rs
git commit -m "feat(agent): chronicle --mcp <dir> serves the catalog over stdio MCP"
```

---

### Task 7: Live check and a short reference

**Files:**
- Create: `docs/agent-api.md` (one page: the two fronts, the capability table copied from the spec with the CLI spelling beside each, exit codes, the MCP registration snippet for plan 3)
- Modify: `docs/superpowers/specs/2026-09-16-agent-access-and-visible-rounds-design.md` (implementation notes: the id allocator, the borrowed-vault line, the table format)

- [ ] **Step 1: Live check on this repository** (the binary from Task 6)

```bash
cd /Users/tuneerguha/Downloads/chronicle
./src-tauri/target/debug/chronicle notes list --status queued
./src-tauri/target/debug/chronicle notes read --path "$(./src-tauri/target/debug/chronicle notes list --limit 1 --json | python3 -c 'import json,sys; print(json.load(sys.stdin)["data"]["notes"][0]["path"])')"
./src-tauri/target/debug/chronicle state phases
./src-tauri/target/debug/chronicle state needs_you
./src-tauri/target/debug/chronicle state rounds
echo $?
```

Expected: a table of queued notes; one note's front matter and body; "M-1 done · M-2 now (up next) · … done." with no ledger write (`git status --short .chronicle/roadmap-ledger.json` unchanged); the behind rows; the round list; exit 0. Record the outputs in the task report.

- [ ] **Step 2: Write `docs/agent-api.md` and the spec notes; commit**

```bash
git add docs/agent-api.md docs/superpowers/specs/2026-09-16-agent-access-and-visible-rounds-design.md
git commit -m "docs(agent): the agent API reference, and the spec's implementation notes for plan 1"
```
