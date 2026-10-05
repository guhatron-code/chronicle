//! The design benchmark's plumbing: the briefs on disk, a throwaway project to design
//! in, and where the results land. The run itself is driven by the app's frontend.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::{Path, PathBuf};

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Brief { pub id: String, pub kind: String, pub title: String, pub brief: String, pub answers: Vec<(String, String)>, pub quick: bool }

fn parse_brief(name: &str, text: &str) -> Result<Brief, String> {
    let bad = |why: &str| format!("{name} isn't a benchmark brief: {why}");
    let mut lines = text.lines();
    if lines.next().map(str::trim) != Some("---") { return Err(bad("it has no front matter (--- id, kind, title, quick ---).")) }
    let mut front = std::collections::HashMap::new();
    let mut closed = false;
    for l in lines.by_ref() {
        if l.trim() == "---" { closed = true; break }
        if let Some((k, v)) = l.split_once(':') { front.insert(k.trim().to_string(), v.trim().to_string()); }
    }
    if !closed { return Err(bad("the front matter never closes.")) }
    let field = |k: &str| front.get(k).filter(|v| !v.is_empty()).cloned().ok_or_else(|| bad(&format!("front matter has no {k}.")));
    let (id, kind, title) = (field("id")?, field("kind")?, field("title")?);
    let quick = match front.get("quick").map(String::as_str) {
        None | Some("false") => false,
        Some("true") => true,
        Some(_) => return Err(bad("quick must be true or false.")),
    };
    let (mut brief, mut answers, mut section) = (Vec::new(), Vec::new(), "");
    for l in lines {
        if let Some(h) = l.strip_prefix("## ") { section = match h.trim() { "Brief" => "brief", "Answers" => "answers", _ => "" }; continue }
        match section {
            "brief" => brief.push(l),
            "answers" => if let Some((q, a)) = l.strip_prefix("- ").and_then(|r| r.split_once(": ")) { answers.push((q.trim().to_string(), a.trim().to_string())); },
            _ => {}
        }
    }
    let brief = brief.join("\n").trim().to_string();
    if brief.is_empty() { return Err(bad("it has no ## Brief section.")) }
    Ok(Brief { id, kind, title, brief, answers, quick })
}

/// Every `bench/design/briefs/*.md`, sorted by id.
pub fn read_briefs(repo: &Path) -> Result<Vec<Brief>, String> {
    let dir = repo.join("bench/design/briefs");
    let rd = std::fs::read_dir(&dir).map_err(|_| format!("There are no benchmark briefs at {}.", dir.display()))?;
    let mut out = Vec::new();
    for e in rd.flatten() {
        let p = e.path();
        if p.extension().and_then(|x| x.to_str()) != Some("md") { continue }
        let name = p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        let text = std::fs::read_to_string(&p).map_err(|e| format!("{name} couldn't be read: {e}."))?;
        out.push(parse_brief(&name, &text)?);
    }
    out.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(out)
}

/// A throwaway Chronicle project under the config dir, so a benchmark never designs in
/// the user's own project.
pub fn bench_project(config_dir: &Path, stamp: &str) -> Result<PathBuf, String> {
    let p = config_dir.join("bench").join(stamp);
    std::fs::create_dir_all(p.join(".chronicle")).map_err(|e| format!("Chronicle couldn't make the benchmark project: {e}."))?;
    std::fs::write(p.join("chronicle.json"), "{ \"name\": \"design-bench\", \"phases\": [] }\n").map_err(|e| format!("Chronicle couldn't make the benchmark project: {e}."))?;
    p.canonicalize().map_err(|e| format!("Chronicle couldn't make the benchmark project: {e}."))
}

/// `bench/design/results/<name>.json` and `.md`.
pub fn write_results(repo: &Path, name: &str, json: &Value, md: &str) -> Result<(PathBuf, PathBuf), String> {
    if name.is_empty() || name.contains('/') || name.contains("..") { return Err("That isn't a name for a results file.".into()) }
    let dir = repo.join("bench/design/results");
    std::fs::create_dir_all(&dir).map_err(|e| format!("Chronicle couldn't make the results folder: {e}."))?;
    let (j, m) = (dir.join(format!("{name}.json")), dir.join(format!("{name}.md")));
    std::fs::write(&j, serde_json::to_string_pretty(json).map_err(|e| e.to_string())?).map_err(|e| format!("Chronicle couldn't save the results: {e}."))?;
    std::fs::write(&m, md).map_err(|e| format!("Chronicle couldn't save the results: {e}."))?;
    Ok((j, m))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn briefs_parse_front_matter_brief_and_answers() {
        let d = std::env::temp_dir().join(format!("chronicle-bench-{}", std::process::id())); let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(d.join("bench/design/briefs")).unwrap();
        std::fs::write(d.join("bench/design/briefs/ecommerce-1.md"), "---\nid: ecommerce-1\nkind: ecommerce\ntitle: Coffee product page\nquick: true\n---\n\n## Brief\n\nA product page for a coffee roaster.\nMostly phone.\n\n## Answers\n\n- who: Gift buyers\n- feel: Quiet and exact\n").unwrap();
        std::fs::write(d.join("bench/design/briefs/app-1.md"), "---\nid: app-1\nkind: app\ntitle: Settings\nquick: false\n---\n\n## Brief\n\nA settings screen.\n").unwrap();
        let b = read_briefs(&d).unwrap();
        assert_eq!(b.len(), 2); assert_eq!(b[0].id, "app-1"); assert_eq!(b[1].kind, "ecommerce");
        assert_eq!(b[1].brief, "A product page for a coffee roaster.\nMostly phone.");
        assert_eq!(b[1].answers, vec![("who".to_string(), "Gift buyers".to_string()), ("feel".to_string(), "Quiet and exact".to_string())]);
        assert!(b[1].quick && !b[0].quick);
        std::fs::write(d.join("bench/design/briefs/bad.md"), "no front matter").unwrap();
        assert!(read_briefs(&d).unwrap_err().contains("bad.md"));
        std::fs::remove_file(d.join("bench/design/briefs/bad.md")).unwrap();
        std::fs::write(d.join("bench/design/briefs/odd.md"), "---\nid: odd\nkind: app\ntitle: T\nquick: yes\n---\n\n## Brief\n\nx\n").unwrap();
        let e = read_briefs(&d).unwrap_err(); assert!(e.contains("odd.md") && e.contains("quick"));
    }
    #[test]
    fn a_bench_project_is_a_chronicle_project_under_the_config_dir_and_results_land_in_the_repo() {
        let cfg = std::env::temp_dir().join(format!("chronicle-benchcfg-{}", std::process::id()));
        let p = bench_project(&cfg, "2026-10-01T10-00-00").unwrap();
        assert!(p.starts_with(cfg.canonicalize().unwrap())); assert!(p.join(".chronicle").is_dir() && p.join("chronicle.json").is_file());
        let repo = std::env::temp_dir().join(format!("chronicle-benchrepo-{}", std::process::id()));
        let (j, m) = write_results(&repo, "0.12.0-2026-10-01", &serde_json::json!({ "briefs": [] }), "# Results\n").unwrap();
        assert!(j.ends_with("bench/design/results/0.12.0-2026-10-01.json") && m.exists());
    }
}
