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
    // two projects asked for in the same second (the run's and its judge's) get two folders
    let base = config_dir.join("bench");
    let mut p = base.join(stamp);
    let mut n = 2;
    while p.exists() { p = base.join(format!("{stamp}-{n}")); n += 1; }
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

/// The reference export `from` names, if it is a folder directly inside `repo`'s
/// `bench/design/reference/` once every link is resolved — anything else is refused.
pub fn reference_dir(repo: &Path, from: &Path) -> Result<PathBuf, String> {
    let refused = || "That isn't a benchmark reference.".to_string();
    let root = repo.join("bench/design/reference").canonicalize().map_err(|_| refused())?;
    let src = from.canonicalize().map_err(|_| refused())?;
    if src.parent() != Some(root.as_path()) || !src.is_dir() { return Err(refused()) }
    Ok(src)
}

/// Copy a Claude Design export (`src`, a folder) into a design's `frames/` exactly as it is —
/// the whole tree, nothing rewritten, so its HTML finds its own CSS and images — and make
/// `design.json`'s frames one 1440 × 900 frame per top-level `.html` file. `frames/` is
/// emptied first; links, dot-files and anything that isn't a regular file are skipped.
/// → the frame count.
pub fn stage_reference(src: &Path, design: &Path) -> Result<u32, String> {
    if !src.is_dir() { return Err("That reference isn't a folder.".into()) }
    let frames = design.join("frames");
    let _ = std::fs::remove_dir_all(&frames);
    std::fs::create_dir_all(&frames).map_err(|e| e.to_string())?;
    let mut html: Vec<String> = Vec::new();
    let mut stack = vec![PathBuf::new()];
    while let Some(rel) = stack.pop() {
        for e in std::fs::read_dir(src.join(&rel)).map_err(|e| e.to_string())?.flatten() {
            let md = match e.path().symlink_metadata() { Ok(m) => m, Err(_) => continue };
            let name = e.file_name().to_string_lossy().into_owned();
            if md.file_type().is_symlink() || name.starts_with('.') { continue }
            let r = rel.join(&name);
            if md.is_dir() { stack.push(r); continue }
            if !md.is_file() { continue }
            let to = frames.join(&r);
            if let Some(parent) = to.parent() { std::fs::create_dir_all(parent).map_err(|e| e.to_string())?; }
            std::fs::copy(e.path(), &to).map_err(|e| format!("{name} couldn't be copied: {e}."))?;
            if rel.as_os_str().is_empty() && name.to_ascii_lowercase().ends_with(".html") { html.push(name); }
        }
    }
    html.sort();
    let mut ids: Vec<String> = Vec::new();
    let frames_json: Vec<Value> = html.iter().map(|name| {
        let stem = &name[..name.len() - ".html".len()];
        let mut id: String = stem.chars().map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '-' }).take(72).collect();
        if id.is_empty() { id = "frame".into(); }
        let (base, mut n) = (id.clone(), 2);
        while ids.contains(&id) { id = format!("{base}-{n}"); n += 1; }
        ids.push(id.clone());
        serde_json::json!({ "id": id, "file": format!("frames/{name}"), "label": stem, "width": 1440, "height": 900, "group": "breakpoints" })
    }).collect();
    let path = design.join("design.json");
    let mut v: Value = std::fs::read_to_string(&path).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_else(|| serde_json::json!({ "v": 1 }));
    if !v.is_object() { v = serde_json::json!({ "v": 1 }); }
    v["frames"] = Value::Array(frames_json);
    std::fs::write(&path, serde_json::to_string_pretty(&v).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    Ok(html.len() as u32)
}

const PICTURES: [&str; 4] = ["png", "jpg", "jpeg", "webp"];

/// Copy pictures into `<design>/refs/<side>/` under neutral names `1.<ext>`, `2.<ext>`, …,
/// emptying that side first, so a judge never learns where a picture came from.
/// → the design-relative paths.
/// Every picture must sit (canonically) inside `jail`, the benchmark projects' folder:
/// the judge's design never takes a copy of anything else on the disk.
pub fn stage_side(design: &Path, side: &str, paths: &[PathBuf], jail: &Path) -> Result<Vec<String>, String> {
    if side != "A" && side != "B" { return Err("The side must be A or B.".into()) }
    let jail = jail.canonicalize().map_err(|_| "There are no benchmark projects to take pictures from.".to_string())?;
    let mut checked = Vec::new();
    for p in paths {
        let md = p.symlink_metadata().map_err(|_| format!("{} isn't there.", p.display()))?;
        let inside = p.canonicalize().map(|c| c.starts_with(&jail)).unwrap_or(false);
        if !inside { return Err(format!("{} isn't a benchmark picture.", p.display())) }
        let ext = p.extension().and_then(|x| x.to_str()).map(str::to_ascii_lowercase).unwrap_or_default();
        if !md.is_file() || !PICTURES.contains(&ext.as_str()) { return Err(format!("{} isn't a picture Chronicle stages.", p.display())) }
        checked.push((p, ext));
    }
    let dir = design.join("refs").join(side);
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for (i, (p, ext)) in checked.into_iter().enumerate() {
        let name = format!("{}.{ext}", i + 1);
        std::fs::copy(p, dir.join(&name)).map_err(|e| format!("A picture couldn't be copied: {e}."))?;
        out.push(format!("refs/{side}/{name}"));
    }
    Ok(out)
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
    #[test]
    fn a_bench_project_asked_for_twice_in_one_second_is_two_folders() {
        let cfg = std::env::temp_dir().join(format!("chronicle-benchtwice-{}", std::process::id())); let _ = std::fs::remove_dir_all(&cfg);
        let a = bench_project(&cfg, "2026-10-01T10-00-00").unwrap();
        let b = bench_project(&cfg, "2026-10-01T10-00-00").unwrap();
        assert_ne!(a, b); assert!(b.ends_with("2026-10-01T10-00-00-2"));
    }
    #[test]
    fn a_reference_export_is_staged_whole_under_frames_without_rewriting() {
        let t = std::env::temp_dir().join(format!("chronicle-stageref-{}", std::process::id())); let _ = std::fs::remove_dir_all(&t);
        let (src, design) = (t.join("ref"), t.join("design"));
        std::fs::create_dir_all(src.join("img")).unwrap(); std::fs::create_dir_all(design.join("frames")).unwrap();
        std::fs::write(src.join("Home Page.html"), "<img src=img/a.png>").unwrap();
        std::fs::write(src.join("checkout.html"), "x").unwrap();
        std::fs::write(src.join("style.css"), "body{}").unwrap();
        std::fs::write(src.join("img/a.png"), "png").unwrap();
        std::fs::write(src.join("img/deep.html"), "not a frame").unwrap();
        std::fs::write(src.join(".hidden"), "x").unwrap();
        std::os::unix::fs::symlink("/etc/hosts", src.join("link.css")).unwrap();
        std::fs::write(design.join("frames/old.html"), "old").unwrap();
        std::fs::write(design.join("design.json"), r#"{"v":1,"title":"Ref","kind":"app","frames":[{"id":"old"}]}"#).unwrap();
        assert_eq!(stage_reference(&src, &design).unwrap(), 2);
        assert_eq!(std::fs::read(design.join("frames/Home Page.html")).unwrap(), std::fs::read(src.join("Home Page.html")).unwrap());
        assert!(!design.join("frames/old.html").exists());
        assert!(design.join("frames/style.css").is_file() && design.join("frames/img/a.png").is_file() && design.join("frames/img/deep.html").is_file());
        assert!(!design.join("frames/.hidden").exists() && !design.join("frames/link.css").exists() && !design.join("assets/style.css").exists());
        let d: Value = serde_json::from_str(&std::fs::read_to_string(design.join("design.json")).unwrap()).unwrap();
        assert_eq!(d["title"], "Ref");
        assert_eq!(d["frames"], serde_json::json!([
            { "id": "Home-Page", "file": "frames/Home Page.html", "label": "Home Page", "width": 1440, "height": 900, "group": "breakpoints" },
            { "id": "checkout", "file": "frames/checkout.html", "label": "checkout", "width": 1440, "height": 900, "group": "breakpoints" },
        ]));
        assert!(stage_reference(&t.join("missing"), &design).is_err());
    }
    #[test]
    fn pictures_are_staged_under_neutral_names_one_side_at_a_time() {
        let t = std::env::temp_dir().join(format!("chronicle-stageside-{}", std::process::id())); let _ = std::fs::remove_dir_all(&t);
        let design = t.join("design"); std::fs::create_dir_all(&design).unwrap();
        std::fs::write(t.join("home.png"), "a").unwrap(); std::fs::write(t.join("cart.JPG"), "b").unwrap(); std::fs::write(t.join("x.html"), "c").unwrap();
        assert_eq!(stage_side(&design, "A", &[t.join("home.png"), t.join("cart.JPG")], &t).unwrap(), vec!["refs/A/1.png", "refs/A/2.jpg"]);
        assert_eq!(std::fs::read_to_string(design.join("refs/A/2.jpg")).unwrap(), "b");
        assert_eq!(stage_side(&design, "A", &[t.join("cart.JPG")], &t).unwrap(), vec!["refs/A/1.jpg"]);
        assert!(!design.join("refs/A/2.jpg").exists() && !design.join("refs/A/1.png").exists());
        assert!(stage_side(&design, "C", &[], &t).is_err());
        assert!(stage_side(&design, "B", &[t.join("x.html")], &t).is_err());
        assert!(stage_side(&design, "B", &[t.join("nope.png")], &t).is_err());
        assert!(stage_side(&design, "B", &[t.clone()], &t).is_err());
    }
    #[test]
    fn only_pictures_inside_the_bench_folder_are_staged() {
        let t = std::env::temp_dir().join(format!("chronicle-stagejail-{}", std::process::id())); let _ = std::fs::remove_dir_all(&t);
        let (jail, outside) = (t.join("bench"), t.join("elsewhere"));
        let design = jail.join("p/.chronicle/designs/judge"); std::fs::create_dir_all(&design).unwrap(); std::fs::create_dir_all(&outside).unwrap();
        std::fs::write(jail.join("p/ours.png"), "a").unwrap(); std::fs::write(outside.join("private.png"), "secret").unwrap();
        assert_eq!(stage_side(&design, "A", &[jail.join("p/ours.png")], &jail).unwrap(), vec!["refs/A/1.png"]);
        // outside, through a `..`, and through a symlink: all refused, nothing copied
        assert!(stage_side(&design, "B", &[outside.join("private.png")], &jail).is_err());
        assert!(stage_side(&design, "B", &[jail.join("../elsewhere/private.png")], &jail).is_err());
        std::os::unix::fs::symlink(outside.join("private.png"), jail.join("p/link.png")).unwrap();
        assert!(stage_side(&design, "B", &[jail.join("p/link.png")], &jail).is_err());
        assert!(!design.join("refs/B").exists());
        // no bench folder yet: nothing can be staged
        assert!(stage_side(&design, "A", &[jail.join("p/ours.png")], &t.join("missing")).is_err());
    }
    #[test]
    fn only_a_folder_directly_inside_the_repos_reference_folder_is_a_reference() {
        let t = std::env::temp_dir().join(format!("chronicle-refdir-{}", std::process::id())); let _ = std::fs::remove_dir_all(&t);
        let (repo, outside) = (t.join("repo"), t.join("outside"));
        std::fs::create_dir_all(repo.join("bench/design/reference/app-1/img")).unwrap(); std::fs::create_dir_all(&outside).unwrap();
        std::os::unix::fs::symlink(&outside, repo.join("bench/design/reference/sneaky")).unwrap();
        std::fs::write(repo.join("bench/design/reference/file.html"), "x").unwrap();
        let r = repo.join("bench/design/reference");
        assert_eq!(reference_dir(&repo, &r.join("app-1")).unwrap(), r.join("app-1").canonicalize().unwrap());
        assert!(reference_dir(&repo, &outside).is_err());
        assert!(reference_dir(&repo, &r.join("sneaky")).is_err());
        assert!(reference_dir(&repo, &r.join("app-1/img")).is_err());
        assert!(reference_dir(&repo, &r.join("app-1/../../reference/app-1/../..")).is_err());
        assert!(reference_dir(&repo, &r).is_err());
        assert!(reference_dir(&repo, &r.join("file.html")).is_err());
        assert!(reference_dir(&repo, &r.join("missing")).is_err());
    }
}
