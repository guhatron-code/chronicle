//! The design session's bundled tools: where the Claude Code plugin Chronicle
//! ships lives, whether it is whole, and which MCP servers a session gets.
//! Versions are pinned here and nowhere else.
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

pub const PLAYWRIGHT_MCP: &str = "0.0.83";
pub const PLAYWRIGHT: &str = "1.63.0";
pub const SHADCN: &str = "4.21.0";
pub const SKILLS: [&str; 7] = ["impeccable", "frontend-design", "canvas-design", "algorithmic-art", "chronicle-ecommerce", "chronicle-icons", "chronicle-fonts"];
/// At least this many bundled font families must hold a woff2 for the plugin to count as whole.
pub const MIN_FONT_FAMILIES: usize = 8;
pub const REVIEWERS: [&str; 4] = ["art-director", "ux-director", "accessibility", "copy"];

pub fn plugin_dir(resource_dir: &Path) -> PathBuf { resource_dir.join("design-plugin") }

pub fn intact(dir: &Path) -> Result<String, String> {
    if !dir.join(".claude-plugin/plugin.json").is_file() { return Err("the design skills' plugin.json is missing".into()); }
    for s in SKILLS {
        if !dir.join("skills").join(s).join("SKILL.md").is_file() { return Err(format!("the {s} skill is missing")); }
    }
    for r in REVIEWERS {
        if !dir.join("agents").join(format!("{r}.md")).is_file() { return Err(format!("the {r} reviewer is missing")); }
    }
    let icons = std::fs::read_dir(dir.join("skills/chronicle-icons/icons"))
        .map(|d| d.filter_map(|e| e.ok()).filter(|e| e.path().extension().map(|x| x == "svg").unwrap_or(false)).count())
        .unwrap_or(0);
    if icons < 100 { return Err("the icons are missing".into()); }
    if font_families(dir) < MIN_FONT_FAMILIES { return Err("the fonts are missing".into()); }
    Ok("impeccable 3.5.0 · 4 reviewers".into())
}

/// How many family folders under the fonts skill hold at least one woff2.
fn font_families(dir: &Path) -> usize {
    let has_woff2 = |d: &Path| std::fs::read_dir(d).map(|r| r.filter_map(|e| e.ok())
        .any(|e| e.path().extension().map(|x| x == "woff2").unwrap_or(false))).unwrap_or(false);
    std::fs::read_dir(dir.join("skills/chronicle-fonts/fonts"))
        .map(|d| d.filter_map(|e| e.ok()).filter(|e| e.path().is_dir() && has_woff2(&e.path())).count())
        .unwrap_or(0)
}

fn env(pairs: &[(&str, String)]) -> Value {
    Value::Array(pairs.iter().map(|(k, v)| json!({ "name": k, "value": v })).collect())
}

/// The ACP stdio server list for a design session. The Chronicle server is the
/// design-only one (`chronicle-designs`), never the full agent MCP.
pub fn servers(project: &Path, npx: &str, browsers_dir: Option<&Path>, exe: &Path) -> Vec<Value> {
    let path = crate::setup::tool_env_path();
    let mut out = vec![json!({ "name": "chronicle-designs", "command": exe.to_string_lossy(),
        "args": ["--mcp", project.to_string_lossy(), "--designs-only"], "env": env(&[("PATH", path.clone())]) })];
    if let Some(b) = browsers_dir {
        out.push(json!({ "name": "playwright", "command": npx,
            "args": ["--yes", "--", format!("@playwright/mcp@{PLAYWRIGHT_MCP}"), "--headless", "--isolated", "--browser", "chromium"],
            "env": env(&[("PATH", path.clone()), ("PLAYWRIGHT_BROWSERS_PATH", b.to_string_lossy().to_string())]) }));
    }
    if project.join("components.json").is_file() {
        out.push(json!({ "name": "shadcn", "command": npx, "args": ["--yes", "--", format!("shadcn@{SHADCN}"), "mcp"], "env": env(&[("PATH", path)]) }));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;
    use std::path::{Path, PathBuf};
    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("chronicle-plugin-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d); std::fs::create_dir_all(&d).unwrap(); d
    }
    #[test]
    fn the_server_list_follows_what_is_installed_and_present() {
        let p = tmp("servers");
        let exe = Path::new("/Applications/Chronicle.app/Contents/MacOS/chronicle");
        let none = servers(&p, "/usr/local/bin/npx", None, exe);
        assert_eq!(none.iter().map(|s| s["name"].as_str().unwrap()).collect::<Vec<_>>(), vec!["chronicle-designs"]);
        assert_eq!(none[0]["args"], serde_json::json!(["--mcp", p.to_string_lossy(), "--designs-only"]));
        std::fs::write(p.join("components.json"), "{}").unwrap();
        let all = servers(&p, "/usr/local/bin/npx", Some(Path::new("/Users/u/.chronicle/tools/browsers")), exe);
        let names: Vec<&str> = all.iter().map(|s| s["name"].as_str().unwrap()).collect();
        assert_eq!(names, vec!["chronicle-designs", "playwright", "shadcn"]);
        let pw = &all[1];
        assert_eq!(pw["command"], "/usr/local/bin/npx");
        assert_eq!(pw["args"][2], format!("@playwright/mcp@{PLAYWRIGHT_MCP}"));
        assert!(pw["args"].as_array().unwrap().iter().any(|a| a == "--isolated"));
        let env: Vec<(String, String)> = pw["env"].as_array().unwrap().iter().map(|e| (e["name"].as_str().unwrap().into(), e["value"].as_str().unwrap().into())).collect();
        assert!(env.iter().any(|(k, v)| k == "PLAYWRIGHT_BROWSERS_PATH" && v == "/Users/u/.chronicle/tools/browsers"));
        assert!(env.iter().any(|(k, _)| k == "PATH"));
        assert_eq!(all[2]["args"][2], format!("shadcn@{SHADCN}"));
    }
    #[test]
    fn integrity_names_what_is_missing() {
        let d = tmp("intact");
        assert!(intact(&d).unwrap_err().contains("plugin.json"));
        std::fs::create_dir_all(d.join(".claude-plugin")).unwrap();
        std::fs::write(d.join(".claude-plugin/plugin.json"), r#"{"name":"chronicle-design"}"#).unwrap();
        for s in SKILLS { std::fs::create_dir_all(d.join("skills").join(s)).unwrap(); std::fs::write(d.join("skills").join(s).join("SKILL.md"), "# x").unwrap(); }
        assert!(intact(&d).unwrap_err().contains("reviewer"));
        std::fs::create_dir_all(d.join("agents")).unwrap();
        for r in REVIEWERS { std::fs::write(d.join("agents").join(format!("{r}.md")), "---\nname: x\n---").unwrap(); }
        assert!(intact(&d).unwrap_err().contains("icons"));
        let icons = d.join("skills/chronicle-icons/icons"); std::fs::create_dir_all(&icons).unwrap();
        for i in 0..120 { std::fs::write(icons.join(format!("i{i}.svg")), "<svg/>").unwrap(); }
        assert!(intact(&d).unwrap_err().contains("fonts"));
        let fonts = d.join("skills/chronicle-fonts/fonts");
        // seven families with a font, one folder without, one stray file: not enough
        for i in 0..7 { let f = fonts.join(format!("family-{i}")); std::fs::create_dir_all(&f).unwrap(); std::fs::write(f.join("family-latin-400-normal.woff2"), "wOF2").unwrap(); }
        std::fs::create_dir_all(fonts.join("empty")).unwrap();
        std::fs::write(fonts.join("stray.woff2"), "wOF2").unwrap();
        assert!(intact(&d).unwrap_err().contains("fonts"));
        let f = fonts.join("family-7"); std::fs::create_dir_all(&f).unwrap(); std::fs::write(f.join("family-latin-400-italic.woff2"), "wOF2").unwrap();
        assert_eq!(intact(&d).unwrap(), "impeccable 3.5.0 · 4 reviewers");
    }
    #[test]
    fn the_shipped_plugin_is_intact() {
        let d = Path::new(env!("CARGO_MANIFEST_DIR")).join("resources");
        if !plugin_dir(&d).join("skills/chronicle-icons/icons").is_dir() { eprintln!("run `npm run design-plugin` first"); return; }
        assert!(intact(&plugin_dir(&d)).is_ok(), "{:?}", intact(&plugin_dir(&d)));
        let v: Value = serde_json::from_str(&std::fs::read_to_string(plugin_dir(&d).join(".claude-plugin/plugin.json")).unwrap()).unwrap();
        assert_eq!(v["name"], "chronicle-design");
    }
}
