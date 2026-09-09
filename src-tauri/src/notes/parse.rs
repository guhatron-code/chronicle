//! Everything about a note that is pure text work: the front-matter block, the
//! tags and `[[wikilinks]]` in the body, how a link target resolves to a file,
//! and how links are rewritten when a note moves. No filesystem, no Tauri —
//! the index and the commands are thin layers over this.

use serde::Serialize;

#[derive(Debug, Clone, Default, PartialEq)]
pub struct FrontMatter { pub entries: Vec<(String, String)> }

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct RawLink { pub target: String, pub label: Option<String> }

/// A `---` block, but only when it opens the very first line. Values are kept as
/// raw text: the app only ever reads a handful of keys, and anything it does not
/// understand has to survive a round trip untouched.
pub fn split_front_matter(text: &str) -> (FrontMatter, String) {
    // CRLF parses exactly like LF. Without this a `---\r\n` opener misses the
    // prefix, the whole file reads as body, and the next `write_note` prepends a
    // SECOND front-matter block. Line endings are normalised to `\n` here, so a
    // note that arrives with CRLF leaves the app with LF on its first write.
    let normalised;
    let text = if text.contains("\r\n") {
        normalised = text.replace("\r\n", "\n");
        normalised.as_str()
    } else { text };
    let rest = match text.strip_prefix("---\n") {
        Some(r) => r,
        None => return (FrontMatter::default(), text.to_string()),
    };
    let Some(end) = find_close(rest) else { return (FrontMatter::default(), text.to_string()) };
    let (block, after) = rest.split_at(end);
    let body = after.strip_prefix("---\n").unwrap_or(after);
    let body = body.strip_prefix('\n').unwrap_or(body);
    let mut fm = FrontMatter::default();
    for line in block.lines() {
        if line.trim().is_empty() { continue; }
        match line.split_once(':') {
            Some((k, v)) if !k.trim().is_empty() && !k.starts_with(' ') =>
                fm.entries.push((k.trim().to_string(), v.trim().to_string())),
            _ => fm.entries.push((line.trim().to_string(), String::new())),
        }
    }
    (fm, body.to_string())
}

/// Byte offset of the closing `---` line inside the block that follows the opener.
fn find_close(rest: &str) -> Option<usize> {
    let mut at = 0usize;
    for line in rest.split_inclusive('\n') {
        if line == "---\n" || line == "---" { return Some(at); }
        at += line.len();
    }
    None
}

pub fn join_front_matter(fm: &FrontMatter, body: &str) -> String {
    if fm.entries.is_empty() { return body.to_string(); }
    let mut out = String::from("---\n");
    for (k, v) in &fm.entries {
        if v.is_empty() { out.push_str(k); out.push('\n'); }
        else { out.push_str(&format!("{k}: {v}\n")); }
    }
    out.push_str("---\n\n");
    out.push_str(body);
    out
}

impl FrontMatter {
    pub fn get(&self, key: &str) -> Option<&str> {
        self.entries.iter().find(|(k, _)| k == key).map(|(_, v)| v.as_str())
    }
    /// In place when the key exists (order is part of the file), appended otherwise.
    pub fn set(&mut self, key: &str, value: &str) {
        match self.entries.iter_mut().find(|(k, _)| k == key) {
            Some(e) => e.1 = value.to_string(),
            None => self.entries.push((key.to_string(), value.to_string())),
        }
    }
    pub fn remove(&mut self, key: &str) { self.entries.retain(|(k, _)| k != key); }
    /// `[a, b]` → `["a", "b"]`. Anything else (a block list, a scalar) reads as empty.
    pub fn list(&self, key: &str) -> Vec<String> {
        let Some(v) = self.get(key) else { return vec![] };
        let Some(inner) = v.strip_prefix('[').and_then(|s| s.strip_suffix(']')) else { return vec![] };
        inner.split(',').map(|s| s.trim().trim_matches('"').trim_matches('\'').to_string())
            .filter(|s| !s.is_empty()).collect()
    }
    pub fn set_list(&mut self, key: &str, items: &[String]) {
        self.set(key, &format!("[{}]", items.join(", ")));
    }
}

pub fn status_of(fm: &FrontMatter) -> Option<String> {
    fm.get("status").filter(|s| !s.is_empty()).map(str::to_string)
}
pub fn round_of(fm: &FrontMatter) -> Option<u64> { fm.get("round")?.parse().ok() }

/// Byte ranges the tag and link scanners must not look inside: fenced code
/// blocks and inline code spans.
fn code_ranges(body: &str) -> Vec<(usize, usize)> {
    let mut out = Vec::new();
    let bytes = body.as_bytes();
    let mut i = 0usize;
    let mut fence: Option<usize> = None;
    let mut line_start = 0usize;
    while i < bytes.len() {
        if i == line_start && body[i..].starts_with("```") {
            let end = body[i..].find('\n').map(|n| i + n + 1).unwrap_or(bytes.len());
            match fence.take() {
                Some(start) => out.push((start, end)),
                None => fence = Some(i),
            }
            line_start = end;
            i = end;
            continue;
        }
        if fence.is_none() && bytes[i] == b'`' {
            if let Some(rel) = body[i + 1..].find('`') {
                out.push((i, i + 1 + rel + 1));
                i = i + 1 + rel + 1;
                continue;
            }
        }
        if bytes[i] == b'\n' { line_start = i + 1; }
        i += 1;
    }
    if let Some(start) = fence { out.push((start, bytes.len())); }
    out
}
fn in_code(ranges: &[(usize, usize)], at: usize) -> bool {
    ranges.iter().any(|(a, b)| at >= *a && at < *b)
}

const TAG_CHARS: fn(char) -> bool = |c: char| c.is_ascii_alphanumeric() || matches!(c, '_' | '/' | '-');

/// Front-matter tags first, then the body's, deduped, no leading `#`.
pub fn tags_of(fm: &FrontMatter, body: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut push = |t: String| { if !t.is_empty() && !out.contains(&t) { out.push(t); } };
    for t in fm.list("tags") { push(t.trim_start_matches('#').to_string()); }
    let ranges = code_ranges(body);
    let bytes = body.as_bytes();
    for (i, _) in body.char_indices().filter(|(_, c)| *c == '#') {
        if in_code(&ranges, i) { continue; }
        // `a#b` is not a tag; `##x` is not a tag; `# x` is a heading (no tag char follows)
        let prev = body[..i].chars().next_back();
        if prev.is_some_and(|c| !c.is_whitespace() && c != '(' && c != '[') { continue; }
        if bytes.get(i + 1) == Some(&b'#') { continue; }
        let name: String = body[i + 1..].chars().take_while(|c| TAG_CHARS(*c)).collect();
        if name.is_empty() { continue; }
        push(name);
    }
    out
}

pub fn links_of(body: &str) -> Vec<RawLink> {
    let ranges = code_ranges(body);
    let mut out = Vec::new();
    let mut at = 0usize;
    while let Some(rel) = body[at..].find("[[") {
        let start = at + rel;
        let Some(close) = body[start + 2..].find("]]") else { break };
        let inner = &body[start + 2..start + 2 + close];
        at = start + 2 + close + 2;
        if in_code(&ranges, start) || inner.contains('\n') { continue; }
        let (target, label) = match inner.split_once('|') {
            Some((t, l)) => (t.trim().to_string(), Some(l.trim().to_string())),
            None => (inner.trim().to_string(), None),
        };
        if target.is_empty() { continue; }
        out.push(RawLink { target, label });
    }
    out
}

fn folder_of(path: &str) -> &str { path.rsplit_once('/').map(|(d, _)| d).unwrap_or("") }
fn title_of(path: &str) -> &str {
    path.rsplit_once('/').map(|(_, f)| f).unwrap_or(path).trim_end_matches(".md")
}

/// Same folder, then each ancestor folder outwards, then the whole vault. Within
/// one round the candidates are compared in path order, so a tie is deterministic.
pub fn resolve_link(target: &str, from: &str, paths: &[String]) -> (Option<String>, bool) {
    if target.contains('/') {
        let exact = format!("{target}.md");
        return (paths.iter().find(|p| **p == exact).cloned(), false);
    }
    let mut sorted: Vec<&String> = paths.iter().collect();
    sorted.sort();
    let hits: Vec<&String> = sorted.into_iter().filter(|p| title_of(p) == target).collect();
    if hits.is_empty() { return (None, false); }
    // the note's own folder, then each ancestor outwards, then the vault root
    let mut scopes: Vec<String> = Vec::new();
    let mut scope = folder_of(from).to_string();
    loop {
        scopes.push(scope.clone());
        if scope.is_empty() { break; }          // "" is the root and always terminates
        scope = folder_of(&scope).to_string();  // "Meetings/Q3" -> "Meetings" -> ""
    }
    for s in &scopes {
        let here: Vec<&&String> = hits.iter().filter(|p| folder_of(p) == s).collect();
        if let Some(first) = here.first() { return (Some((**first).clone()), here.len() > 1); }
    }
    (Some(hits[0].clone()), hits.len() > 1)
}

pub fn shortest_link_form(to: &str, from: &str, paths: &[String]) -> String {
    let title = title_of(to).to_string();
    if resolve_link(&title, from, paths) == (Some(to.to_string()), false) { return title; }
    to.trim_end_matches(".md").to_string()
}

pub fn rewrite_links(
    body: &str, note_path: &str, from: &str, to: &str,
    before: &[String], after: &[String],
) -> (String, usize) {
    let mut out = String::with_capacity(body.len());
    let mut n = 0usize;
    let mut at = 0usize;
    let ranges = code_ranges(body);
    while let Some(rel) = body[at..].find("[[") {
        let start = at + rel;
        let Some(close) = body[start + 2..].find("]]") else { break };
        let end = start + 2 + close + 2;
        let inner = &body[start + 2..start + 2 + close];
        out.push_str(&body[at..start]);
        let (target, label) = match inner.split_once('|') {
            Some((t, l)) => (t.trim(), Some(l.trim())),
            None => (inner.trim(), None),
        };
        let resolved = resolve_link(target, note_path, before).0;
        if !in_code(&ranges, start) && !inner.contains('\n') && resolved.as_deref() == Some(from) {
            let new_target = shortest_link_form(to, note_path, after);
            match label {
                Some(l) => out.push_str(&format!("[[{new_target}|{l}]]")),
                None => out.push_str(&format!("[[{new_target}]]")),
            }
            n += 1;
        } else {
            out.push_str(&body[start..end]);
        }
        at = end;
    }
    out.push_str(&body[at..]);
    (out, n)
}

pub fn sanitize_title(title: &str) -> String {
    let mut s: String = title.chars()
        .map(|c| if matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') { '-' } else { c })
        .collect();
    while s.contains("--") { s = s.replace("--", "-"); }
    // leading dots go too: the index skips hidden files, so a name that starts
    // with '.' would be a note nobody can see (matches the pane's sanitizeTitle)
    let s = s.trim().trim_matches('-').trim_start_matches(|c| c == '.' || c == '-').trim().to_string();
    let s: String = s.chars().take(80).collect();
    let s = s.trim().to_string();
    if s.is_empty() { "Untitled".to_string() } else { s }
}

pub fn snippet_of(body: &str) -> String {
    let flat = body.split_whitespace().collect::<Vec<_>>().join(" ");
    flat.chars().take(160).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn paths(v: &[&str]) -> Vec<String> { v.iter().map(|s| s.to_string()).collect() }

    const SAMPLE: &str = "---\nstatus: queued\ntags: [bug, ui]\nround: 3\ncreated: 2026-09-09T10:12:00Z\nid: T-014\nweird_key: {a: 1}\n---\n\nBody line one.\nBody line two.\n";

    #[test]
    fn front_matter_round_trips_with_unknown_keys_and_order_preserved() {
        let (fm, body) = split_front_matter(SAMPLE);
        assert_eq!(fm.get("status"), Some("queued"));
        assert_eq!(fm.get("id"), Some("T-014"));
        assert_eq!(fm.get("weird_key"), Some("{a: 1}"), "an unparsed value is kept verbatim");
        assert_eq!(fm.entries.iter().map(|(k, _)| k.as_str()).collect::<Vec<_>>(),
                   vec!["status", "tags", "round", "created", "id", "weird_key"]);
        assert_eq!(body, "Body line one.\nBody line two.\n");
        assert_eq!(join_front_matter(&fm, &body), SAMPLE, "byte-identical round trip");
    }

    #[test]
    fn a_file_without_front_matter_is_all_body() {
        let (fm, body) = split_front_matter("# Just a note\n\ntext\n");
        assert!(fm.entries.is_empty());
        assert_eq!(body, "# Just a note\n\ntext\n");
        assert_eq!(join_front_matter(&fm, &body), "# Just a note\n\ntext\n");
        // a --- rule that is not the FIRST line is not front matter
        let (fm2, body2) = split_front_matter("text\n\n---\n\nmore\n");
        assert!(fm2.entries.is_empty());
        assert_eq!(body2, "text\n\n---\n\nmore\n");
    }

    #[test]
    fn a_crlf_file_has_front_matter_and_never_grows_a_second_block() {
        let (fm, body) = split_front_matter("---\r\nstatus: queued\r\nround: 2\r\n---\r\n\r\nBody one.\r\nBody two.\r\n");
        assert_eq!(fm.get("status"), Some("queued"), "a \\r\\n file is not one big body");
        assert_eq!(round_of(&fm), Some(2), "and no value carries a stray \\r");
        assert_eq!(body, "Body one.\nBody two.\n", "endings are normalised, once");
        // the round trip a write does: split, then join — exactly one --- block
        let joined = join_front_matter(&fm, &body);
        assert_eq!(joined, "---\nstatus: queued\nround: 2\n---\n\nBody one.\nBody two.\n");
        assert_eq!(split_front_matter(&joined), (fm, body), "and it is stable from there on");
        // a lone \r (classic Mac) is left alone rather than mangled
        let (fm3, body3) = split_front_matter("---\nstatus: queued\n---\n\na\rb\n");
        assert_eq!(fm3.get("status"), Some("queued"));
        assert_eq!(body3, "a\rb\n");
    }

    #[test]
    fn set_edits_in_place_and_appends_new_keys_at_the_end() {
        let (mut fm, _) = split_front_matter(SAMPLE);
        fm.set("status", "done");
        fm.set("updated", "2026-09-09T11:40:00Z");
        assert_eq!(fm.get("status"), Some("done"));
        assert_eq!(fm.entries[0].0, "status", "an edited key keeps its position");
        assert_eq!(fm.entries.last().unwrap().0, "updated");
        fm.remove("id");
        assert_eq!(fm.get("id"), None);
    }

    #[test]
    fn flow_lists_read_and_write() {
        let (mut fm, _) = split_front_matter(SAMPLE);
        assert_eq!(fm.list("tags"), vec!["bug", "ui"]);
        assert_eq!(fm.list("nope"), Vec::<String>::new());
        fm.set_list("tags", &["ui".into(), "energy".into()]);
        assert_eq!(fm.get("tags"), Some("[ui, energy]"));
        fm.set_list("tags", &[]);
        assert_eq!(fm.get("tags"), Some("[]"));
    }

    #[test]
    fn status_and_round_read_what_is_there() {
        let (fm, _) = split_front_matter(SAMPLE);
        assert_eq!(status_of(&fm).as_deref(), Some("queued"));
        assert_eq!(round_of(&fm), Some(3));
        let (plain, _) = split_front_matter("body\n");
        assert_eq!(status_of(&plain), None);
        assert_eq!(round_of(&plain), None);
        let (odd, _) = split_front_matter("---\nstatus: shipped\nround: soon\n---\nb\n");
        assert_eq!(status_of(&odd).as_deref(), Some("shipped"), "an unknown status is reported as-is");
        assert_eq!(round_of(&odd), None, "a non-numeric round is no round");
    }

    #[test]
    fn tags_come_from_the_front_matter_and_the_body_and_skip_code() {
        let (fm, _) = split_front_matter(SAMPLE);
        let body = "# Heading is not a tag\n\nA #bug and a #ui/dark one, `#nope` in code.\n\n```\n#alsonope\n```\n\nEnd #energy-2 and a#notatag and ## not either.\n";
        assert_eq!(tags_of(&fm, body), vec!["bug", "ui", "ui/dark", "energy-2"]);
    }

    #[test]
    fn links_read_all_three_forms() {
        let body = "See [[Energy budget]], [[Design/Web pane retro|the retro]] and [[Tasks/Dark toasts]].\nNot `[[in code]]` though.\n";
        assert_eq!(links_of(body), vec![
            RawLink { target: "Energy budget".into(), label: None },
            RawLink { target: "Design/Web pane retro".into(), label: Some("the retro".into()) },
            RawLink { target: "Tasks/Dark toasts".into(), label: None },
        ]);
    }

    #[test]
    fn resolution_prefers_same_folder_then_ancestor_then_vault() {
        let p = paths(&["Design/Energy budget.md", "Tasks/Energy budget.md", "Energy budget.md", "Meetings/Scratch.md"]);
        assert_eq!(resolve_link("Energy budget", "Design/Web pane retro.md", &p),
                   (Some("Design/Energy budget.md".into()), false), "same folder wins");
        assert_eq!(resolve_link("Energy budget", "Meetings/Q3/Notes.md", &p),
                   (Some("Energy budget.md".into()), false), "nearest ancestor with a match — the vault root");
        assert_eq!(resolve_link("Scratch", "Design/Web pane retro.md", &p),
                   (Some("Meetings/Scratch.md".into()), false), "nowhere near — the whole vault");
        assert_eq!(resolve_link("Nothing here", "Design/Web pane retro.md", &p), (None, false));
    }

    #[test]
    fn a_tie_takes_the_first_in_path_order_and_reports_the_ambiguity() {
        let p = paths(&["B/Dup.md", "A/Dup.md"]);
        assert_eq!(resolve_link("Dup", "Root.md", &p), (Some("A/Dup.md".into()), true));
    }

    #[test]
    fn a_target_with_a_slash_is_an_exact_path_from_the_vault_root() {
        let p = paths(&["Design/Energy budget.md", "Energy budget.md"]);
        assert_eq!(resolve_link("Design/Energy budget", "Tasks/x.md", &p),
                   (Some("Design/Energy budget.md".into()), false));
        assert_eq!(resolve_link("Design/Missing", "Tasks/x.md", &p), (None, false),
                   "an exact path never falls back to a title search");
    }

    #[test]
    fn the_shortest_form_is_the_title_unless_it_would_be_ambiguous() {
        let unique = paths(&["Design/Energy budget.md", "Tasks/Dark toasts.md"]);
        assert_eq!(shortest_link_form("Design/Energy budget.md", "Tasks/Dark toasts.md", &unique), "Energy budget");
        let dup = paths(&["A/Dup.md", "B/Dup.md"]);
        assert_eq!(shortest_link_form("B/Dup.md", "Root.md", &dup), "B/Dup");
    }

    #[test]
    fn moving_a_note_rewrites_every_form_that_pointed_at_it() {
        let before = paths(&["Design/Energy budget.md", "Design/Web pane retro.md", "Tasks/Dup.md", "Archive/Dup.md"]);
        let after = paths(&["Archive/Energy budget.md", "Design/Web pane retro.md", "Tasks/Dup.md", "Archive/Dup.md"]);
        let body = "Bare [[Energy budget]], pathed [[Design/Energy budget]], labelled [[Energy budget|the budget]], unrelated [[Dup]].\n";
        let (out, n) = rewrite_links(body, "Design/Web pane retro.md", "Design/Energy budget.md", "Archive/Energy budget.md", &before, &after);
        assert_eq!(n, 3);
        assert_eq!(out, "Bare [[Energy budget]], pathed [[Energy budget]], labelled [[Energy budget|the budget]], unrelated [[Dup]].\n",
                   "the target is unique after the move, so the bare title is the shortest form");
        // and when the new location makes the title ambiguous, the path is kept
        let after2 = paths(&["Tasks/Energy budget.md", "Design/Energy budget.md", "Design/Web pane retro.md"]);
        let before2 = paths(&["Design/Energy budget.md", "Design/Web pane retro.md"]);
        let (out2, n2) = rewrite_links("[[Energy budget]]\n", "Design/Web pane retro.md", "Design/Energy budget.md", "Tasks/Energy budget.md", &before2, &after2);
        assert_eq!(n2, 1);
        assert_eq!(out2, "[[Tasks/Energy budget]]\n");
    }

    #[test]
    fn titles_are_sanitised_for_the_file_system() {
        assert_eq!(sanitize_title("Login card overlaps: 13\" screens"), "Login card overlaps- 13- screens");
        assert_eq!(sanitize_title("a/b\\c*d?e<f>g|h"), "a-b-c-d-e-f-g-h");
        assert_eq!(sanitize_title("   spaced   "), "spaced");
        assert_eq!(sanitize_title(&"x".repeat(120)).len(), 80);
        assert_eq!(sanitize_title(""), "Untitled");
        assert_eq!(sanitize_title("///"), "Untitled", "a title that sanitises to nothing still needs a name");
        assert_eq!(sanitize_title(".hidden idea"), "hidden idea", "a leading dot would make the note invisible to the index");
        assert_eq!(sanitize_title("..."), "Untitled");
    }

    #[test]
    fn the_snippet_is_one_line_of_at_most_160_chars() {
        let s = snippet_of("# Title\n\nFirst line.\nSecond line.\n");
        assert_eq!(s, "# Title First line. Second line.");
        assert!(snippet_of(&"y".repeat(400)).chars().count() <= 160);
    }
}
