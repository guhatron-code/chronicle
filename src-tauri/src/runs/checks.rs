//! The checks a lane may name (spec §7): `chronicle.json` `checks` when present,
//! else detected — package.json scripts `test`, `typecheck`, `lint`, `build`, and
//! `cargo test` where a Cargo.toml is found. Each is a name mapped to a command
//! Chronicle owns. Nothing else ever runs.
use serde::Serialize;
use serde_json::Value;
use std::path::{Path, PathBuf};

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Check { pub name: String, pub command: String }

pub fn repo_checks(repo: &Path, manifest: Option<&Value>) -> Vec<Check> {
    match manifest.and_then(|m| m.get("checks")) {
        Some(list) => from_manifest(list),
        None => detect(repo),
    }
}

fn from_manifest(v: &Value) -> Vec<Check> {
    let pairs: Vec<(String, String)> = match v {
        Value::Array(a) => a.iter().filter_map(|c| Some((c.get("name")?.as_str()?.to_string(), c.get("command")?.as_str()?.to_string()))).collect(),
        Value::Object(o) => o.iter().filter_map(|(k, c)| Some((k.clone(), c.as_str()?.to_string()))).collect(),
        _ => vec![],
    };
    pairs.into_iter()
        .map(|(n, c)| Check { name: n.trim().to_string(), command: c.trim().to_string() })
        .filter(|c| !c.name.is_empty() && !c.command.is_empty())
        .collect()
}

pub fn detect(repo: &Path) -> Vec<Check> {
    let mut out = vec![];
    if let Some(pkg) = std::fs::read_to_string(repo.join("package.json")).ok().and_then(|t| serde_json::from_str::<Value>(&t).ok()) {
        for name in ["test", "typecheck", "lint", "build"] {
            if pkg.pointer(&format!("/scripts/{name}")).and_then(|v| v.as_str()).is_some() {
                out.push(Check { name: name.into(), command: format!("npm run {name}") });
            }
        }
    }
    if let Some(dir) = cargo_dir(repo) {
        let command = match dir.strip_prefix(repo).ok().filter(|r| !r.as_os_str().is_empty()) {
            Some(rel) => format!("cd '{}' && cargo test", rel.to_string_lossy().replace('\'', "'\\''")),
            None => "cargo test".to_string(),
        };
        out.push(Check { name: "cargo test".into(), command });
    }
    out
}

/// The repo root when it holds a Cargo.toml, else the first child folder that does.
pub fn cargo_dir(repo: &Path) -> Option<PathBuf> {
    if repo.join("Cargo.toml").is_file() { return Some(repo.to_path_buf()); }
    let mut kids: Vec<PathBuf> = std::fs::read_dir(repo).ok()?.filter_map(|e| e.ok()).map(|e| e.path())
        .filter(|p| p.is_dir())
        .filter(|p| p.file_name().map(|n| { let n = n.to_string_lossy(); !n.starts_with('.') && n != "node_modules" && n != "target" }).unwrap_or(false))
        .collect();
    kids.sort();
    kids.into_iter().find(|k| k.join("Cargo.toml").is_file())
}

/// How many lanes run at once (spec §3, §15.4): `maxLanes`, default 3, kept within 1–8.
pub fn max_lanes(manifest: Option<&Value>) -> usize {
    manifest.and_then(|m| m.get("maxLanes")).and_then(|v| v.as_u64()).map(|n| n.clamp(1, 8) as usize).unwrap_or(3)
}


#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("chronicle-checks-{}-{}", name, std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn checks_are_detected_from_package_scripts_and_a_cargo_crate() {
        let d = tmp("detect");
        std::fs::write(d.join("package.json"), r#"{"scripts":{"test":"vitest run","typecheck":"tsc -b","dev":"vite","build":"vite build"}}"#).unwrap();
        std::fs::create_dir_all(d.join("src-tauri")).unwrap();
        std::fs::write(d.join("src-tauri/Cargo.toml"), "[package]\nname='x'\n").unwrap();
        let names: Vec<String> = detect(&d).into_iter().map(|c| c.name).collect();
        assert_eq!(names, vec!["test", "typecheck", "build", "cargo test"], "dev is not a check; lint is absent");
        let cargo = detect(&d).into_iter().find(|c| c.name == "cargo test").unwrap();
        assert_eq!(cargo.command, "cd 'src-tauri' && cargo test");
        assert_eq!(detect(&d)[0].command, "npm run test");
    }

    #[test]
    fn the_manifest_list_wins_and_nothing_else_runs() {
        let d = tmp("manifest");
        std::fs::write(d.join("package.json"), r#"{"scripts":{"test":"vitest run"}}"#).unwrap();
        let m = json!({ "checks": [{ "name": "unit", "command": "make unit" }, { "name": "", "command": "x" }] });
        assert_eq!(repo_checks(&d, Some(&m)), vec![Check { name: "unit".into(), command: "make unit".into() }]);
        let m2 = json!({ "checks": { "lint": "npm run lint" } });
        assert_eq!(repo_checks(&d, Some(&m2))[0].name, "lint");
        assert_eq!(repo_checks(&d, None)[0].name, "test", "detected when the manifest has no list");
    }

    #[test]
    fn max_lanes_defaults_to_three_and_stays_sane() {
        assert_eq!(max_lanes(None), 3);
        assert_eq!(max_lanes(Some(&json!({ "maxLanes": 5 }))), 5);
        assert_eq!(max_lanes(Some(&json!({ "maxLanes": 0 }))), 1);
        assert_eq!(max_lanes(Some(&json!({ "maxLanes": 99 }))), 8);
    }
}
