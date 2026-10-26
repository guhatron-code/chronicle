//! The planner's lane map, checked before anything runs (spec §3): owned paths
//! pairwise disjoint (after following symlinks), every item in exactly one lane,
//! every round note covered, dependencies known and acyclic, checks from the
//! repo's list. An invalid map goes back to the planner with every reason at once.
use super::checks::Check;
use super::record::{Item, LaneMap, LaneSpec};
use std::collections::{HashMap, HashSet};
use std::path::Path;
#[cfg(test)]
use std::path::PathBuf;

#[derive(Clone, Debug)]
pub struct Glob { pub text: String, re: regex::Regex }

impl Glob {
    /// Repo-relative only. A trailing `/` owns the folder (`src/lib/` → `src/lib/**`).
    pub fn parse(s: &str) -> Result<Glob, String> {
        let mut t = s.trim().trim_start_matches("./").to_string();
        if t.is_empty() { return Err("an owned path is empty".into()); }
        if t.starts_with('/') { return Err(format!("{t} is absolute; owned paths are relative to the project")); }
        if t.split('/').any(|p| p == "..") { return Err(format!("{t} climbs out with ..")); }
        if t.ends_with('/') { t.push_str("**"); }
        let re = regex::Regex::new(&to_regex(&t)).map_err(|e| format!("{t} isn't a path pattern ({e})"))?;
        Ok(Glob { text: t, re })
    }
    pub fn matches(&self, rel: &str) -> bool { self.re.is_match(rel) }
    pub fn has_wildcard(&self) -> bool { self.text.contains('*') || self.text.contains('?') }
    /// Up to the last `/` before the first wildcard; the whole text when literal.
    pub fn static_prefix(&self) -> &str {
        match self.text.find(|c| c == '*' || c == '?') {
            None => &self.text,
            Some(i) => match self.text[..i].rfind('/') { Some(j) => &self.text[..=j], None => "" },
        }
    }
}

fn to_regex(g: &str) -> String {
    let cs: Vec<char> = g.chars().collect();
    let mut re = String::from("^");
    let mut i = 0;
    while i < cs.len() {
        match cs[i] {
            '*' if cs.get(i + 1) == Some(&'*') => {
                if cs.get(i + 2) == Some(&'/') { re.push_str("(?:.*/)?"); i += 3; } else { re.push_str(".*"); i += 2; }
                continue;
            }
            '*' => re.push_str("[^/]*"),
            '?' => re.push_str("[^/]"),
            c => re.push_str(&regex::escape(&c.to_string())),
        }
        i += 1;
    }
    re.push('$');
    re
}

fn literal_suffix(t: &str) -> &str {
    match t.rfind(|c| c == '*' || c == '?') { Some(i) => &t[i + 1..], None => t }
}

/// Could one path be owned by both? Exact for literals; for two patterns,
/// "yes" unless their folders diverge or their fixed endings can't both match.
pub fn overlap(a: &Glob, b: &Glob) -> bool {
    match (a.has_wildcard(), b.has_wildcard()) {
        (false, false) => a.text == b.text,
        (false, true) => b.matches(&a.text),
        (true, false) => a.matches(&b.text),
        (true, true) => {
            let (pa, pb) = (a.static_prefix(), b.static_prefix());
            if !(pa.starts_with(pb) || pb.starts_with(pa)) { return false; }
            let (sa, sb) = (literal_suffix(&a.text), literal_suffix(&b.text));
            !( !sa.is_empty() && !sb.is_empty() && !sa.ends_with(sb) && !sb.ends_with(sa) )
        }
    }
}

/// Rewrite the fixed part of a pattern to where it really is: symlinks
/// followed, relative to the project's canonical root. Refuses a pattern
/// whose fixed part resolves outside the project.
pub fn normalise(repo: &Path, g: &Glob) -> Result<Glob, String> {
    let prefix = g.static_prefix().to_string();
    let rest = g.text[prefix.len()..].to_string();
    let croot = repo.canonicalize().map_err(|e| e.to_string())?;
    let mut existing = repo.join(prefix.trim_end_matches('/'));
    let mut tail: Vec<String> = vec![];
    while !existing.exists() {
        match existing.file_name() { Some(n) => tail.push(n.to_string_lossy().into_owned()), None => break }
        if !existing.pop() { break; }
    }
    let canon = existing.canonicalize().map_err(|e| e.to_string())?;
    let rel = canon.strip_prefix(&croot).map_err(|_| format!("{} reaches outside the project", g.text))?;
    let mut parts: Vec<String> = rel.components().map(|c| c.as_os_str().to_string_lossy().into_owned()).collect();
    parts.extend(tail.into_iter().rev());
    let mut text = parts.join("/");
    if prefix.ends_with('/') && !text.is_empty() { text.push('/'); }
    text.push_str(&rest);
    Glob::parse(&text)
}

/// `.chronicle/`, `fixes/`, `chronicle.json`: the app's and the planner's, never a lane's.
pub fn forbidden_path(rel: &str) -> bool {
    rel == "chronicle.json" || rel.starts_with(".chronicle/") || rel == ".chronicle" || rel.starts_with("fixes/") || rel == "fixes"
}

fn reaches_forbidden(g: &Glob) -> bool {
    ["chronicle.json", ".chronicle/**", "fixes/**"].iter().any(|f| overlap(g, &Glob::parse(f).expect("fixed pattern")))
}

pub fn compile(owns: &[String]) -> Vec<Glob> { owns.iter().filter_map(|o| Glob::parse(o).ok()).collect() }

pub fn owner_of(map: &LaneMap, rel: &str) -> Option<String> {
    map.lanes.iter().find(|l| compile(&l.owns).iter().any(|g| g.matches(rel))).map(|l| l.id.clone())
}

fn find_cycle(lanes: &[LaneSpec]) -> Option<Vec<String>> {
    let deps: HashMap<&str, Vec<&str>> = lanes.iter().map(|l| (l.id.as_str(), l.depends_on.iter().map(|d| d.as_str()).collect())).collect();
    fn visit<'a>(n: &'a str, deps: &HashMap<&'a str, Vec<&'a str>>, color: &mut HashMap<&'a str, u8>, stack: &mut Vec<&'a str>) -> Option<Vec<String>> {
        color.insert(n, 1);
        stack.push(n);
        for &d in deps.get(n).map(|v| v.as_slice()).unwrap_or(&[]) {
            if !deps.contains_key(d) { continue; }
            match color.get(d).copied().unwrap_or(0) {
                1 => {
                    let from = stack.iter().position(|&s| s == d).unwrap_or(0);
                    let mut cyc: Vec<String> = stack[from..].iter().map(|s| s.to_string()).collect();
                    cyc.push(d.to_string());
                    return Some(cyc);
                }
                0 => if let Some(c) = visit(d, deps, color, stack) { return Some(c); },
                _ => {}
            }
        }
        stack.pop();
        color.insert(n, 2);
        None
    }
    let mut color = HashMap::new();
    for l in lanes {
        if color.get(l.id.as_str()).copied().unwrap_or(0) == 0 {
            if let Some(c) = visit(&l.id, &deps, &mut color, &mut vec![]) { return Some(c); }
        }
    }
    None
}

pub fn validate(map: &LaneMap, repo: &Path, checks: &[Check], round_notes: &[String]) -> Result<LaneMap, Vec<String>> {
    let mut errs: Vec<String> = vec![];
    let mut out = map.clone();
    if map.lanes.is_empty() { errs.push("The map has no lanes.".into()); }
    if map.lanes.len() > 26 { errs.push("A map can have at most 26 lanes.".into()); }
    let mut ids: HashSet<String> = HashSet::new();
    for l in &map.lanes {
        if !(l.id.len() == 1 && l.id.chars().all(|c| c.is_ascii_lowercase())) { errs.push(format!("Lane id \"{}\" must be one lowercase letter.", l.id)); }
        if !ids.insert(l.id.clone()) { errs.push(format!("Lane id \"{}\" is used twice.", l.id)); }
        if l.title.trim().is_empty() { errs.push(format!("Lane {} has no title.", l.id)); }
        if l.items.is_empty() { errs.push(format!("Lane {} has no items.", l.id)); }
        if l.owns.is_empty() { errs.push(format!("Lane {} owns no files.", l.id)); }
        match l.isolation.as_deref() {
            None => {}
            Some("worktree") => errs.push(format!("lane {} asks for its own worktree; that comes in a later release", l.id)),
            Some(other) => errs.push(format!("lane {}: unknown isolation \"{other}\"", l.id)),
        }
    }
    let declared: Vec<&str> = map.items.iter().map(|i: &Item| i.id.as_str()).collect();
    if declared.is_empty() { errs.push("The map lists no items.".into()); }
    let mut dup = HashSet::new();
    for d in &declared { if !dup.insert(*d) { errs.push(format!("Item {d} is listed twice.")); } }
    let mut seen: HashMap<&str, &str> = HashMap::new();
    for l in &map.lanes {
        for it in &l.items {
            if !declared.contains(&it.as_str()) { errs.push(format!("Lane {} names item {it}, which isn't in the items list.", l.id)); }
            if let Some(prev) = seen.insert(it.as_str(), l.id.as_str()) {
                errs.push(format!("Item {it} is in lane {prev} and lane {}; every item goes in exactly one lane.", l.id));
            }
        }
    }
    for d in &declared { if !seen.contains_key(d) { errs.push(format!("Item {d} isn't in any lane.")); } }
    for note in round_notes {
        if !map.items.iter().any(|i| i.note.as_deref() == Some(note.as_str())) { errs.push(format!("The note {note} isn't covered by any item.")); }
    }
    let mut compiled: Vec<(String, Vec<Glob>)> = vec![];
    for (li, l) in map.lanes.iter().enumerate() {
        let mut gs = vec![];
        for o in &l.owns {
            let g = Glob::parse(o).and_then(|g| normalise(repo, &g)).and_then(|g| {
                // a folder named without its slash is owned whole
                if !g.has_wildcard() && repo.join(&g.text).is_dir() { Glob::parse(&format!("{}/**", g.text)) } else { Ok(g) }
            });
            match g {
                Ok(g) if reaches_forbidden(&g) => errs.push(format!("Lane {} owns {}, which reaches .chronicle/, fixes/ or chronicle.json; lanes never write those.", l.id, g.text)),
                Ok(g) => gs.push(g),
                Err(e) => errs.push(format!("Lane {}: {e}.", l.id)),
            }
        }
        out.lanes[li].owns = gs.iter().map(|g| g.text.clone()).collect();
        compiled.push((l.id.clone(), gs));
    }
    for i in 0..compiled.len() {
        for j in i + 1..compiled.len() {
            for a in &compiled[i].1 {
                for b in &compiled[j].1 {
                    if overlap(a, b) {
                        errs.push(format!("Lanes {} and {} both own {} / {}: owned paths must not overlap. Give the shared file to one lane and make the other depend on it.", compiled[i].0, compiled[j].0, a.text, b.text));
                    }
                }
            }
        }
    }
    for l in &map.lanes {
        for d in &l.depends_on {
            if d == &l.id { errs.push(format!("Lane {} depends on itself.", l.id)); }
            else if !ids.contains(d) { errs.push(format!("Lane {} depends on lane {d}, which isn't in the map.", l.id)); }
        }
    }
    if let Some(c) = find_cycle(&map.lanes) { errs.push(format!("Lanes depend on each other in a circle: {}.", c.join(" → "))); }
    let known: Vec<&str> = checks.iter().map(|c| c.name.as_str()).collect();
    for l in &map.lanes {
        for c in &l.checks {
            if !known.contains(&c.as_str()) {
                errs.push(format!("Lane {} names the check \"{c}\"; this project's checks are: {}.", l.id, if known.is_empty() { "none".to_string() } else { known.join(", ") }));
            }
        }
    }
    if errs.is_empty() { Ok(out) } else { Err(errs) }
}


#[cfg(test)]
mod tests {
    use super::*;
    use crate::runs::checks::Check;

    fn repo(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("chronicle-map-{}-{}", name, std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        for p in ["src/lib", "src/screens/agent", "src-tauri/src"] { std::fs::create_dir_all(d.join(p)).unwrap(); }
        std::fs::write(d.join("src/lib/a.ts"), "").unwrap();
        d.canonicalize().unwrap()
    }
    fn lane(id: &str, items: &[&str], owns: &[&str], deps: &[&str], checks: &[&str]) -> LaneSpec {
        let v = |xs: &[&str]| xs.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        LaneSpec { id: id.into(), title: format!("Lane {id}"), items: v(items), owns: v(owns), depends_on: v(deps), checks: v(checks), isolation: None }
    }
    fn map(items: &[&str], lanes: Vec<LaneSpec>) -> LaneMap {
        LaneMap { items: items.iter().map(|i| Item { id: i.to_string(), title: format!("item {i}"), note: None, rewrite: None }).collect(), lanes }
    }
    fn checks() -> Vec<Check> {
        vec![Check { name: "test".into(), command: "npm run test".into() }, Check { name: "typecheck".into(), command: "npm run typecheck".into() }]
    }
    fn errs(r: Result<LaneMap, Vec<String>>) -> String { r.expect_err("the map must be refused").join("\n") }

    #[test]
    fn globs_match_the_way_a_planner_writes_them() {
        let g = |s: &str| Glob::parse(s).unwrap();
        assert!(g("src/lib/*.ts").matches("src/lib/a.ts"));
        assert!(!g("src/lib/*.ts").matches("src/lib/x/a.ts"));
        assert!(g("src/**").matches("src/a/b/c.ts"));
        assert!(g("src/**/*.ts").matches("src/a.ts") && g("src/**/*.ts").matches("src/a/b.ts"));
        assert_eq!(g("src/lib/").text, "src/lib/**");
        assert_eq!(g("./src/a.ts").text, "src/a.ts");
        assert_eq!(g("src/lib/*.ts").static_prefix(), "src/lib/");
        assert_eq!(g("src/a.ts").static_prefix(), "src/a.ts");
        assert_eq!(g("**/*.css").static_prefix(), "");
        for bad in ["", "/etc/passwd", "../x", "src/../../x"] { assert!(Glob::parse(bad).is_err(), "{bad}"); }
    }

    #[test]
    fn overlap_is_conservative_but_not_silly() {
        let o = |a: &str, b: &str| overlap(&Glob::parse(a).unwrap(), &Glob::parse(b).unwrap());
        assert!(o("src/a.ts", "src/a.ts"));
        assert!(!o("src/a.ts", "src/b.ts"));
        assert!(o("src/lib/a.ts", "src/lib/*.ts"));
        assert!(o("src/**", "src/lib/*.ts"));
        assert!(!o("src/**", "src-tauri/**"), "a shared spelling is not a shared folder");
        assert!(!o("src/*.ts", "src/*.css"));
        assert!(o("src/*.test.ts", "src/*.ts"));
        assert!(o("**", "src/a.ts"));
    }

    #[test]
    fn a_valid_map_passes_and_its_globs_come_back_normalised() {
        let r = repo("valid");
        let m = map(&["T-1", "T-2", "T-3"], vec![
            lane("a", &["T-1", "T-2"], &["src/lib/", "src/screens/agent/AgentPane.tsx"], &[], &["test", "typecheck"]),
            lane("b", &["T-3"], &["src-tauri/src/**"], &["a"], &[]),
        ]);
        let ok = validate(&m, &r, &checks(), &[]).unwrap();
        assert_eq!(ok.lanes[0].owns, vec!["src/lib/**", "src/screens/agent/AgentPane.tsx"]);
        assert_eq!(owner_of(&ok, "src/lib/x.ts").as_deref(), Some("a"));
        assert_eq!(owner_of(&ok, "src-tauri/src/acp.rs").as_deref(), Some("b"));
        assert_eq!(owner_of(&ok, "README.md"), None);
    }

    #[test]
    fn a_directory_named_without_a_slash_is_owned_whole() {
        let r = repo("dir");
        let m = map(&["T-1"], vec![lane("a", &["T-1"], &["src/lib"], &[], &[])]);
        assert_eq!(validate(&m, &r, &checks(), &[]).unwrap().lanes[0].owns, vec!["src/lib/**"]);
    }

    #[test]
    fn overlapping_owned_paths_are_refused_with_the_rule() {
        let r = repo("overlap");
        let m = map(&["T-1", "T-2"], vec![lane("a", &["T-1"], &["src/lib/**"], &[], &[]), lane("b", &["T-2"], &["src/lib/a.ts"], &[], &[])]);
        let e = errs(validate(&m, &r, &checks(), &[]));
        assert!(e.contains("Lanes a and b both own"), "{e}");
        assert!(e.contains("make the other depend on it"), "{e}");
    }

    #[test]
    fn owned_globs_that_meet_through_a_symlink_overlap() {
        let r = repo("symlink");
        std::fs::create_dir_all(r.join("lib/shared")).unwrap();
        std::fs::write(r.join("lib/shared/x.ts"), "").unwrap();
        std::os::unix::fs::symlink("../lib/shared", r.join("src/shared")).unwrap();
        let m = map(&["T-1", "T-2"], vec![lane("a", &["T-1"], &["src/shared/**"], &[], &[]), lane("b", &["T-2"], &["lib/shared/x.ts"], &[], &[])]);
        let e = errs(validate(&m, &r, &checks(), &[]));
        assert!(e.contains("Lanes a and b both own"), "the symlink is followed before comparing: {e}");
        // and a link that leaves the project is refused outright
        std::os::unix::fs::symlink("/tmp", r.join("src/out")).unwrap();
        let m2 = map(&["T-1"], vec![lane("a", &["T-1"], &["src/out/**"], &[], &[])]);
        assert!(errs(validate(&m2, &r, &checks(), &[])).contains("outside the project"));
    }

    #[test]
    fn every_item_goes_in_exactly_one_lane_and_every_note_is_covered() {
        let r = repo("items");
        let m = map(&["T-1", "T-2", "T-3"], vec![lane("a", &["T-1", "T-2"], &["src/lib/**"], &[], &[]), lane("b", &["T-2", "T-9"], &["src-tauri/**"], &[], &[])]);
        let e = errs(validate(&m, &r, &checks(), &["Tasks/A.md".into()]));
        assert!(e.contains("Item T-2 is in lane a and lane b"), "{e}");
        assert!(e.contains("Item T-3 isn't in any lane"), "{e}");
        assert!(e.contains("names item T-9, which isn't in the items list"), "{e}");
        assert!(e.contains("The note Tasks/A.md isn't covered by any item"), "{e}");
    }

    #[test]
    fn dependencies_must_exist_and_never_loop() {
        let r = repo("deps");
        let m = map(&["T-1", "T-2", "T-3"], vec![
            lane("a", &["T-1"], &["src/lib/**"], &["c"], &[]),
            lane("b", &["T-2"], &["src/screens/**"], &["a", "z"], &[]),
            lane("c", &["T-3"], &["src-tauri/**"], &["b"], &[]),
        ]);
        let e = errs(validate(&m, &r, &checks(), &[]));
        assert!(e.contains("depends on lane z, which isn't in the map"), "{e}");
        assert!(e.contains("in a circle: a → c → b → a"), "{e}");
    }

    #[test]
    fn checks_come_from_the_repos_list_and_nowhere_else() {
        let r = repo("checks");
        let m = map(&["T-1"], vec![lane("a", &["T-1"], &["src/lib/**"], &[], &["test", "rm -rf /"])]);
        let e = errs(validate(&m, &r, &checks(), &[]));
        assert!(e.contains("names the check \"rm -rf /\"; this project's checks are: test, typecheck"), "{e}");
    }

    #[test]
    fn no_lane_owns_chronicles_own_files() {
        let r = repo("forbidden");
        for owns in [".chronicle/notes/**", "fixes/phase_1_fixes_plan.md", "chronicle.json", "**"] {
            let m = map(&["T-1"], vec![lane("a", &["T-1"], &[owns], &[], &[])]);
            assert!(errs(validate(&m, &r, &checks(), &[])).contains("lanes never write those"), "{owns}");
        }
    }

    #[test]
    fn ids_titles_and_shapes_are_checked() {
        let r = repo("shape");
        let mut bad = lane("AB", &[], &[], &[], &[]);
        bad.title = " ".into();
        let e = errs(validate(&map(&[], vec![bad]), &r, &checks(), &[]));
        for s in ["must be one lowercase letter", "has no title", "has no items", "owns no files", "lists no items"] { assert!(e.contains(s), "{s}: {e}"); }
        assert!(errs(validate(&map(&["T-1"], vec![]), &r, &checks(), &[])).contains("The map has no lanes."));
    }

    #[test]
    fn a_lane_that_asks_for_its_own_worktree_is_refused_for_now() {
        let r = repo("iso");
        let mut l = lane("a", &["T-1"], &["src/lib/**"], &[], &[]);
        l.isolation = Some("worktree".into());
        let e = errs(validate(&map(&["T-1"], vec![l.clone()]), &r, &checks(), &[]));
        assert!(e.contains("lane a asks for its own worktree; that comes in a later release"), "{e}");
        l.isolation = Some("vm".into());
        let e = errs(validate(&map(&["T-1"], vec![l]), &r, &checks(), &[]));
        assert!(e.contains("lane a: unknown isolation \"vm\""), "{e}");
    }
}
