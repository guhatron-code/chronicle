//! The write fence and the git guard (spec §4), generalised from the design
//! lane's `design_write_decision`. A permission ask is answered by rule:
//! writes inside the lane's owned paths are allowed; outside them refused with
//! the owner named; git reads allowed; git writes refused ("Chronicle saves your
//! work for you"); push, tag, publish and release refused everywhere and shown to the
//! user; Chronicle's own run tools and read tools allowed; every other shell
//! command goes to the judge. Shell redirects are not parsed — the gate's
//! turn-end snapshot reports what they changed (the shell hole).
use super::lane_map::{forbidden_path, Glob};
use serde_json::Value;
use std::path::{Path, PathBuf};

pub(crate) const WRITE_TOOLS: [&str; 4] = ["Write", "Edit", "MultiEdit", "NotebookEdit"];
pub const GIT_REFUSAL: &str = "Chronicle saves your work for you";
pub const FORBIDDEN_REFUSAL: &str = "Lanes never change .chronicle/, fixes/ or chronicle.json.";
pub const PUBLISH_REFUSAL: &str = "Chronicle doesn’t publish for you.";
/// The MCP server name lanes and the planner reach Chronicle's run tools through.
pub const RUN_SERVER: &str = "chronicle-run";

/// The tool a permission ask is for: the one normaliser every agent's ask goes through.
pub(crate) fn tool_name(params: &Value) -> Option<&str> {
    crate::agents::normalize::tool_name(params.get("toolCall")?)
}

/// The path a file-writing permission ask targets ("" when it names none).
pub(crate) fn write_target(call: &Value) -> &str {
    call.pointer("/rawInput/file_path").and_then(|v| v.as_str())
        .or_else(|| call.pointer("/rawInput/notebook_path").and_then(|v| v.as_str()))
        .or_else(|| call.pointer("/locations/0/path").and_then(|v| v.as_str()))
        .unwrap_or("")
}

pub enum Fence {
    /// The design lane: writes strictly inside `.chronicle/designs/<slug>/`.
    Design(PathBuf),
    /// A run's lane: writes inside `owns`; `others` name who owns the rest.
    Lane { repo: PathBuf, lane: String, owns: Vec<Glob>, others: Vec<(String, Vec<Glob>)> },
}

#[derive(Debug, PartialEq)]
pub enum Verdict {
    Allow { what: String },
    Refuse { path: String, reason: String },
    /// refused, and shown to the user as a needs-you row
    Publish { command: String },
    /// a shell command no rule decides: the judge does (spec §6, decision 1)
    Judge { command: String },
    /// not this fence's to answer (the design lane's other asks)
    NotMine,
}

impl Fence {
    pub fn may_write(&self, abs: &Path) -> Result<(), String> {
        match self {
            Fence::Design(root) => {
                // acp keeps `strictly_inside` private, so the design rule is asked through its public decision
                let ask = serde_json::json!({
                    "toolCall": { "name": "Write", "rawInput": { "file_path": abs.to_string_lossy() } },
                    "options": [{ "optionId": "allow", "kind": "allow_once" }],
                });
                match crate::acp::design_write_decision(&ask, root) {
                    Some(crate::acp::WriteDecision::Allow { .. }) => Ok(()),
                    _ => Err("The design session can only change files in .chronicle/designs/.".into()),
                }
            }
            Fence::Lane { repo, lane, owns, others } => {
                let rel = repo_rel(repo, abs).ok_or_else(|| format!("{} is outside the project.", abs.display()))?;
                if forbidden_path(&rel) { return Err(FORBIDDEN_REFUSAL.into()); }
                if owns.iter().any(|g| g.matches(&rel)) { return Ok(()); }
                match others.iter().find(|(_, gs)| gs.iter().any(|g| g.matches(&rel))) {
                    Some((id, _)) => Err(format!("{rel} belongs to lane {} — lane {} can't change it.", id.to_uppercase(), lane.to_uppercase())),
                    None => Err(format!("{rel} isn't one of lane {}'s files.", lane.to_uppercase())),
                }
            }
        }
    }

    pub fn verdict(&self, params: &Value) -> Verdict {
        let name = tool_name(params).unwrap_or("");
        let call = params.get("toolCall").cloned().unwrap_or(Value::Null);
        let kind = call.get("kind").and_then(|v| v.as_str()).unwrap_or("");
        let is_write = WRITE_TOOLS.contains(&name) || matches!(kind, "edit" | "delete" | "move");
        if let Fence::Design(_) = self {
            if !WRITE_TOOLS.contains(&name) { return Verdict::NotMine; }
        }
        if is_write {
            let target = write_target(&call).to_string();
            return match self.may_write(Path::new(&target)) {
                Ok(()) => Verdict::Allow { what: target },
                Err(reason) => Verdict::Refuse { path: target, reason },
            };
        }
        if name.starts_with("mcp__") {
            if name.starts_with(&format!("mcp__{RUN_SERVER}__")) { return Verdict::Allow { what: name.into() }; }
            return Verdict::Refuse { path: name.into(), reason: "A lane uses its own files, git reads and Chronicle's run tools — not other tools.".into() };
        }
        if name == "Bash" || kind == "execute" {
            let cmd = call.pointer("/rawInput/command").and_then(|v| v.as_str()).unwrap_or("").to_string();
            return match classify(&cmd) {
                Shell::ReadOnlyGit => Verdict::Allow { what: cmd },
                Shell::GitWrite => Verdict::Refuse { path: cmd, reason: GIT_REFUSAL.into() },
                Shell::Publish => Verdict::Publish { command: cmd },
                Shell::Other => Verdict::Judge { command: cmd },
            };
        }
        if matches!(name, "Read" | "Grep" | "Glob" | "LS" | "TodoWrite" | "Task" | "Agent" | "WebFetch" | "WebSearch")
            || matches!(kind, "read" | "search" | "think" | "fetch")
        {
            return Verdict::Allow { what: if name.is_empty() { kind.to_string() } else { name.to_string() } };
        }
        Verdict::Refuse { path: name.into(), reason: "Chronicle answers for lanes and has no rule for that tool, so it wasn't used.".into() }
    }
}

/// Canonical, repo-relative; `None` for anything relative, climbing, or outside.
fn repo_rel(repo: &Path, abs: &Path) -> Option<String> {
    if !abs.is_absolute() || abs.components().any(|c| matches!(c, std::path::Component::ParentDir)) { return None; }
    let canon = crate::acp::canonical_deep(abs)?;
    let croot = repo.canonicalize().ok()?;
    let rel = canon.strip_prefix(&croot).ok()?;
    let s = rel.to_string_lossy().into_owned();
    if s.is_empty() { None } else { Some(s) }
}

#[derive(Debug, PartialEq, Eq, PartialOrd, Ord, Clone, Copy)]
pub enum Shell { ReadOnlyGit, Other, GitWrite, Publish }

/// The most severe class of any command in the line, substitutions included.
pub fn classify(cmd: &str) -> Shell {
    let segs = segments(cmd);
    if segs.is_empty() { return Shell::Other; }
    segs.iter().map(|s| classify_segment(s)).max().unwrap_or(Shell::Other)
}

/// Split on `;` `&&` `||` `|` `&` and newlines outside quotes; `$( … )` and
/// backtick bodies become commands of their own.
fn segments(cmd: &str) -> Vec<String> {
    let cs: Vec<char> = cmd.chars().collect();
    let mut out: Vec<String> = vec![];
    let mut cur = String::new();
    let mut q: Option<char> = None;
    let mut i = 0;
    while i < cs.len() {
        let c = cs[i];
        if q == Some('\'') { if c == '\'' { q = None; } cur.push(c); i += 1; continue; }
        if c == '\\' && i + 1 < cs.len() { cur.push(c); cur.push(cs[i + 1]); i += 2; continue; }
        if c == '$' && cs.get(i + 1) == Some(&'(') {
            let (inner, end) = balanced(&cs, i + 2);
            out.extend(segments(&inner));
            cur.push_str("SUBST");
            i = end + 1;
            continue;
        }
        if c == '`' {
            let end = cs[i + 1..].iter().position(|&x| x == '`').map(|p| i + 1 + p).unwrap_or(cs.len());
            let inner: String = cs[i + 1..end.min(cs.len())].iter().collect();
            out.extend(segments(&inner));
            cur.push_str("SUBST");
            i = end + 1;
            continue;
        }
        if q == Some('"') { if c == '"' { q = None; } cur.push(c); i += 1; continue; }
        if c == '\'' || c == '"' { q = Some(c); cur.push(c); i += 1; continue; }
        let redirect = c == '&' && (i > 0 && cs[i - 1] == '>' || cs.get(i + 1) == Some(&'>'));
        if !redirect && matches!(c, ';' | '\n' | '|' | '&') {
            if !cur.trim().is_empty() { out.push(cur.trim().to_string()); }
            cur.clear();
            if (c == '&' || c == '|') && cs.get(i + 1) == Some(&c) { i += 1; }
            i += 1;
            continue;
        }
        cur.push(c);
        i += 1;
    }
    if !cur.trim().is_empty() { out.push(cur.trim().to_string()); }
    out
}

fn balanced(cs: &[char], start: usize) -> (String, usize) {
    let mut depth = 1;
    let mut i = start;
    while i < cs.len() {
        match cs[i] { '(' => depth += 1, ')' => { depth -= 1; if depth == 0 { break; } } _ => {} }
        i += 1;
    }
    (cs[start..i.min(cs.len())].iter().collect(), i)
}

/// Shell-like words: quotes group and are removed, a backslash escapes.
pub fn split_words(s: &str) -> Vec<String> {
    let mut out = vec![];
    let mut cur = String::new();
    let mut has = false;
    let mut q: Option<char> = None;
    let mut it = s.chars();
    while let Some(c) = it.next() {
        match q {
            Some(qc) if c == qc => q = None,
            Some('"') if c == '\\' => { if let Some(n) = it.next() { cur.push(n); } }
            Some(_) => cur.push(c),
            None => match c {
                '\'' | '"' => { q = Some(c); has = true; }
                '\\' => { if let Some(n) = it.next() { cur.push(n); has = true; } }
                c if c.is_whitespace() => { if has || !cur.is_empty() { out.push(std::mem::take(&mut cur)); has = false; } }
                c => cur.push(c),
            },
        }
    }
    if has || !cur.is_empty() { out.push(cur); }
    out
}

fn is_assignment(w: &str) -> bool {
    match w.split_once('=') { Some((k, _)) => !k.is_empty() && k.chars().all(|c| c.is_ascii_alphanumeric() || c == '_'), None => false }
}

fn first_verb<'a>(xs: &[&'a str]) -> Option<&'a str> {
    xs.iter().find(|a| !a.starts_with('-') && !a.starts_with('+')).copied()
}

fn classify_segment(seg: &str) -> Shell {
    let words = split_words(seg);
    let mut w: &[String] = &words;
    loop {
        match w.first().map(|s| s.as_str()) {
            Some(x) if is_assignment(x) => w = &w[1..],
            Some("sudo" | "env" | "command" | "exec" | "nohup" | "time" | "xargs" | "builtin") => {
                w = &w[1..];
                while w.first().map(|s| s.starts_with('-') || is_assignment(s)).unwrap_or(false) { w = &w[1..]; }
            }
            _ => break,
        }
    }
    let Some(first) = w.first() else { return Shell::Other };
    let prog = first.rsplit('/').next().unwrap_or(first).to_string();
    let rest: Vec<&str> = w[1..].iter().map(|s| s.as_str()).collect();
    if matches!(prog.as_str(), "bash" | "sh" | "zsh" | "dash") {
        if let Some(i) = rest.iter().position(|a| matches!(*a, "-c" | "-lc" | "-ic")) {
            if let Some(script) = rest.get(i + 1) { return classify(script); }
        }
        let script = rest.iter().find(|a| !a.starts_with('-')).map(|s| s.rsplit('/').next().unwrap_or(s));
        return if script == Some("release.sh") { Shell::Publish } else { Shell::Other };
    }
    match prog.as_str() {
        "release.sh" => Shell::Publish,
        "git" => git_verb(&rest),
        "gh" if first_verb(&rest) == Some("release") => Shell::Publish,
        "npm" | "pnpm" if first_verb(&rest) == Some("publish") => Shell::Publish,
        "yarn" if rest.contains(&"publish") => Shell::Publish,
        "cargo" if first_verb(&rest) == Some("publish") => Shell::Publish,
        _ => Shell::Other,
    }
}

fn git_verb(args: &[&str]) -> Shell {
    let mut i = 0;
    while i < args.len() {
        let a = args[i];
        if matches!(a, "-C" | "-c" | "--git-dir" | "--work-tree" | "--namespace") { i += 2; continue; }
        if a.starts_with('-') { i += 1; continue; }
        break;
    }
    let Some(verb) = args.get(i) else { return Shell::ReadOnlyGit };
    let tail: Vec<&str> = args[i + 1..].iter().copied().filter(|a| !a.starts_with("2>") && *a != "2>&1").collect();
    match *verb {
        "push" | "tag" => Shell::Publish,
        "status" | "diff" | "log" | "show" | "blame" | "ls-files" | "grep" | "rev-parse" => Shell::ReadOnlyGit,
        "branch" if tail.is_empty() || tail == ["--show-current"] => Shell::ReadOnlyGit,
        _ => Shell::GitWrite,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::{Path, PathBuf};
    use super::super::lane_map::Glob;
    use serde_json::json;

    #[test]
    fn every_read_only_git_verb_is_allowed() {
        for c in ["git status", "git diff --stat", "git log --oneline -5", "git show HEAD", "git blame src/a.ts",
                  "git ls-files", "git grep foo", "git rev-parse HEAD", "git branch", "git branch --show-current",
                  "git -C src-tauri log --oneline", "git --no-pager diff", "git status 2>&1"] {
            assert_eq!(classify(c), Shell::ReadOnlyGit, "{c}");
        }
    }

    #[test]
    fn every_other_git_verb_is_refused() {
        for c in ["git commit -m x", "git add -A", "git add src/a.ts", "git checkout -- src", "git reset --hard", "git stash",
                  "git merge main", "git rebase main", "git cherry-pick abc", "git restore src", "git rm x", "git mv a b",
                  "git clean -fd", "git switch main", "git pull", "git fetch", "git branch -D x", "git init", "git apply p",
                  "git am p", "git revert HEAD", "git worktree add ../x"] {
            assert_eq!(classify(c), Shell::GitWrite, "{c}");
        }
    }

    #[test]
    fn push_tag_publish_and_release_are_publish_wherever_they_hide() {
        for c in ["git push", "git push origin main", "git tag v1", "gh release create v1", "npm publish", "pnpm publish --tag next",
                  "yarn npm publish", "cargo publish", "./release.sh 0.12.0", "bash scripts/release.sh", "sh -c \"git push\"",
                  "FOO=1 git push", "sudo git push", "env -i git tag x", "git status && git push", "echo $(git push)",
                  "echo `git tag v1`", "cd src; npm publish"] {
            assert_eq!(classify(c), Shell::Publish, "{c}");
        }
    }

    #[test]
    fn quoting_is_respected() {
        assert_eq!(classify("echo \"git push\""), Shell::Other, "a string that mentions git push is not git push");
        assert_eq!(classify("git commit -m \"a && git push\""), Shell::GitWrite, "the && is inside the message");
        assert_eq!(classify("echo 'npm publish'"), Shell::Other);
        assert_eq!(classify("cd src && git status"), Shell::Other, "a chain is as severe as its worst part");
        assert_eq!(classify("npm test 2>&1 | tail -5"), Shell::Other);
        assert_eq!(split_words("git commit -m \"two words\" 'x y' a\\ b"), vec!["git", "commit", "-m", "two words", "x y", "a b"]);
    }

    fn ask(tool: &str, kind: &str, input: serde_json::Value) -> serde_json::Value {
        json!({ "toolCall": { "toolCallId": "t1", "name": tool, "kind": kind, "rawInput": input },
                "options": [{ "optionId": "allow", "kind": "allow_once" }, { "optionId": "reject", "kind": "reject_once" }] })
    }

    fn lane_fence(repo: &Path) -> Fence {
        Fence::Lane {
            repo: repo.to_path_buf(), lane: "a".into(),
            owns: vec![Glob::parse("src/lib/**").unwrap()],
            others: vec![("c".into(), vec![Glob::parse("src/index.css").unwrap()])],
        }
    }
    fn repo(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("chronicle-fence-{}-{}", name, std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(d.join("src/lib")).unwrap();
        d.canonicalize().unwrap()
    }

    #[test]
    fn a_lane_writes_its_own_files_and_nothing_else() {
        let r = repo("writes");
        let f = lane_fence(&r);
        let p = |rel: &str| r.join(rel).to_string_lossy().into_owned();
        assert!(matches!(f.verdict(&ask("Write", "edit", json!({ "file_path": p("src/lib/a.ts") }))), Verdict::Allow { .. }));
        match f.verdict(&ask("Edit", "edit", json!({ "file_path": p("src/index.css") }))) {
            Verdict::Refuse { reason, .. } => assert_eq!(reason, "src/index.css belongs to lane C — lane A can't change it."),
            v => panic!("{v:?}"),
        }
        match f.verdict(&ask("Write", "edit", json!({ "file_path": p("README.md") }))) {
            Verdict::Refuse { reason, .. } => assert_eq!(reason, "README.md isn't one of lane A's files."),
            v => panic!("{v:?}"),
        }
        assert!(matches!(f.verdict(&ask("Write", "edit", json!({ "file_path": p(".chronicle/notes/x.md") }))), Verdict::Refuse { reason, .. } if reason == FORBIDDEN_REFUSAL));
        assert!(f.may_write(Path::new("/etc/hosts")).is_err());
        assert!(f.may_write(Path::new("src/lib/a.ts")).is_err(), "a relative path is never trusted");
        // an agent without Claude's tool names still says `kind: edit`
        assert!(matches!(f.verdict(&ask("", "edit", json!({ "file_path": p("src/lib/b.ts") }))), Verdict::Allow { .. }));
    }

    #[test]
    fn a_write_through_a_symlink_is_judged_where_it_lands() {
        let r = repo("symlink");
        std::fs::create_dir_all(r.join("src/styles")).unwrap();
        std::os::unix::fs::symlink("../index.css", r.join("src/lib/alias.css")).unwrap();
        std::fs::write(r.join("src/index.css"), "").unwrap();
        let f = lane_fence(&r);
        let v = f.verdict(&ask("Write", "edit", json!({ "file_path": r.join("src/lib/alias.css").to_string_lossy() })));
        assert!(matches!(v, Verdict::Refuse { reason, .. } if reason.contains("belongs to lane C")), "the link lands in lane C's file");
    }

    #[test]
    fn shells_go_to_the_guard_and_the_rest_to_the_judge() {
        let r = repo("shell");
        let f = lane_fence(&r);
        let sh = |c: &str| f.verdict(&ask("Bash", "execute", json!({ "command": c })));
        assert!(matches!(sh("git diff"), Verdict::Allow { .. }));
        assert_eq!(sh("git commit -am x"), Verdict::Refuse { path: "git commit -am x".into(), reason: GIT_REFUSAL.into() });
        assert_eq!(sh("npm publish"), Verdict::Publish { command: "npm publish".into() });
        assert_eq!(sh("npx vitest run src/lib"), Verdict::Judge { command: "npx vitest run src/lib".into() });
    }

    #[test]
    fn chronicles_run_tools_and_reads_are_allowed_other_tools_are_not() {
        let r = repo("tools");
        let f = lane_fence(&r);
        assert!(matches!(f.verdict(&ask("mcp__chronicle-run__chronicle_run_block", "other", json!({}))), Verdict::Allow { .. }));
        assert!(matches!(f.verdict(&ask("mcp__chronicle__chronicle_notes_update", "other", json!({}))), Verdict::Refuse { .. }));
        assert!(matches!(f.verdict(&ask("mcp__playwright__browser_navigate", "other", json!({}))), Verdict::Refuse { .. }));
        for (t, k) in [("Read", "read"), ("Grep", "search"), ("WebFetch", "fetch"), ("", "read")] {
            assert!(matches!(f.verdict(&ask(t, k, json!({}))), Verdict::Allow { .. }), "{t}/{k}");
        }
        assert!(matches!(f.verdict(&ask("ExitPlanMode", "switch_mode", json!({}))), Verdict::Refuse { .. }));
    }

    #[test]
    fn the_design_fence_is_the_same_rule_it_always_was() {
        let r = repo("design");
        let root = r.join(".chronicle/designs");
        std::fs::create_dir_all(root.join("home")).unwrap();
        let f = Fence::Design(root.clone());
        let w = |p: PathBuf| ask("Write", "edit", json!({ "file_path": p.to_string_lossy() }));
        assert!(matches!(f.verdict(&w(root.join("home/frames/a.html"))), Verdict::Allow { .. }));
        assert!(matches!(f.verdict(&w(r.join("src/escape.ts"))), Verdict::Refuse { .. }));
        assert_eq!(f.verdict(&ask("Bash", "execute", json!({ "command": "ls" }))), Verdict::NotMine, "the design lane's other asks keep their own handling");
    }
}
