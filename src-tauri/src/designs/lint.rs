//! The lint gate's model: what the detector and the audit found for one
//! version, split into what blocks (severe) and what doesn't (minor), written
//! under the design's app-owned `.review/lint/`. Deterministic; the model never
//! sees this code.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::{Path, PathBuf};

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Finding {
    pub rule: String,
    pub severity: String,
    pub text: String,
    pub frame: String,
    pub file: String,
    #[serde(default, skip_serializing_if = "Option::is_none")] pub line: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")] pub selector: Option<String>,
}
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct LintCounts { pub severe: u32, pub minor: u32 }
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct LintReport {
    pub v: u32, pub version: Option<u32>, pub at: String, pub ran: bool,
    #[serde(default)] pub problem: Option<String>,
    pub severe: Vec<Finding>, pub minor: Vec<Finding>,
}
impl LintReport {
    pub fn counts(&self) -> LintCounts { LintCounts { severe: self.severe.len() as u32, minor: self.minor.len() as u32 } }
}

pub fn detector_script(plugin_dir: &Path) -> PathBuf { plugin_dir.join("skills/impeccable/scripts/detect.mjs") }

fn stem(file: &str) -> String { Path::new(file).file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default() }

pub fn run_detector(node: &Path, script: &Path, frames_dir: &Path) -> Result<Vec<Finding>, String> {
    let out = std::process::Command::new(node).arg(script).arg("--json").arg(frames_dir)
        .env("PATH", crate::setup::tool_env_path()).stdin(std::process::Stdio::null()).output()
        .map_err(|e| format!("The anti-pattern check couldn't start: {e}"))?;
    let code = out.status.code().unwrap_or(-1);
    if code != 0 && code != 2 { return Err(format!("The anti-pattern check stopped (exit {code}): {}", String::from_utf8_lossy(&out.stderr).lines().last().unwrap_or("").chars().take(160).collect::<String>())); }
    let text = String::from_utf8_lossy(&out.stdout);
    let arr: Vec<Value> = serde_json::from_str(text.trim()).map_err(|_| "The anti-pattern check answered with something that isn't a list".to_string())?;
    Ok(arr.iter().filter_map(|f| {
        let file = f["file"].as_str()?;
        let base = Path::new(file).file_name()?.to_string_lossy().to_string();
        let sev = match f["severity"].as_str().unwrap_or("warning") { "error" | "critical" => "severe", _ => "minor" };
        Some(Finding { rule: format!("impeccable:{}", f["antipattern"].as_str().unwrap_or("rule")), severity: sev.into(),
            text: format!("{} — {}", f["name"].as_str().unwrap_or(""), f["description"].as_str().unwrap_or("")).trim_matches([' ', '—']).to_string(),
            frame: stem(&base), file: format!("frames/{base}"), line: f["line"].as_u64().map(|l| l as u32), selector: None })
    }).collect())
}

pub fn from_audit(frame_id: &str, file: &str, json: &str) -> Vec<Finding> {
    let Ok(arr) = serde_json::from_str::<Vec<Value>>(json) else { return vec![] };
    arr.iter().filter_map(|f| Some(Finding { rule: format!("audit:{}", f["rule"].as_str()?), severity: if f["severity"] == "severe" { "severe" } else { "minor" }.into(),
        text: f["text"].as_str()?.to_string(), frame: frame_id.into(), file: file.into(), line: None, selector: f["selector"].as_str().map(String::from) })).collect()
}

pub fn report(version: Option<u32>, at: &str, detector: Result<Vec<Finding>, String>, audits: Vec<Finding>) -> LintReport {
    let (ran, problem, mut all) = match detector { Ok(v) => (true, None, v), Err(e) => (false, Some(e), vec![]) };
    all.extend(audits);
    all.sort_by(|a, b| (a.frame.as_str(), a.rule.as_str()).cmp(&(b.frame.as_str(), b.rule.as_str())));
    let (severe, minor): (Vec<_>, Vec<_>) = all.into_iter().partition(|f| f.severity == "severe");
    LintReport { v: 1, version, at: at.into(), ran, problem, severe, minor }
}

/// What the report says when the user turned the gate off.
pub const GATE_OFF: &str = "Lint gate off";

/// A version's report with the gate off: it did not run, and says why. Never a clean pass.
pub fn gate_off(version: Option<u32>, at: &str) -> LintReport {
    LintReport { v: 1, version, at: at.into(), ran: false, problem: Some(GATE_OFF.into()), severe: vec![], minor: vec![] }
}

fn lint_dir(design_dir: &Path) -> PathBuf { design_dir.join(".review/lint") }
pub fn write_report(design_dir: &Path, name: &str, r: &LintReport) -> Result<PathBuf, String> {
    let dir = lint_dir(design_dir); std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(format!("{name}.json")); let tmp = dir.join(format!("{name}.json.tmp"));
    std::fs::write(&tmp, serde_json::to_string_pretty(r).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
    Ok(path)
}
pub fn read_report(design_dir: &Path, name: &str) -> Option<LintReport> {
    serde_json::from_str(&std::fs::read_to_string(lint_dir(design_dir).join(format!("{name}.json"))).ok()?).ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    fn tmp(name: &str) -> PathBuf { let d = std::env::temp_dir().join(format!("chronicle-lint-{name}-{}", std::process::id())); let _ = std::fs::remove_dir_all(&d); std::fs::create_dir_all(&d).unwrap(); d }

    #[test]
    fn audit_json_becomes_findings_and_bad_json_becomes_none() {
        let f = from_audit("desktop", "frames/desktop.html", r#"[{"rule":"contrast","severity":"severe","text":"Text at 3.2:1 needs 4.5:1","selector":"p.lede"},{"rule":"alt","severity":"minor","text":"An image has no alt text"}]"#);
        assert_eq!(f.len(), 2);
        assert_eq!(f[0], Finding { rule: "audit:contrast".into(), severity: "severe".into(), text: "Text at 3.2:1 needs 4.5:1".into(), frame: "desktop".into(), file: "frames/desktop.html".into(), line: None, selector: Some("p.lede".into()) });
        assert!(f[1].selector.is_none());
        assert!(from_audit("d", "f", "not json").is_empty());
    }

    #[test]
    fn a_report_splits_and_sorts_and_records_a_detector_that_could_not_run() {
        let a = vec![Finding { rule: "audit:overflow".into(), severity: "severe".into(), text: "wide".into(), frame: "mobile".into(), file: "frames/mobile.html".into(), line: None, selector: None },
                     Finding { rule: "audit:alt".into(), severity: "minor".into(), text: "alt".into(), frame: "desktop".into(), file: "frames/desktop.html".into(), line: None, selector: None }];
        let r = report(Some(3), "2026-10-01T10:00:00Z", Err("Node isn't installed".into()), a.clone());
        assert!(!r.ran); assert_eq!(r.problem.as_deref(), Some("Node isn't installed"));
        assert_eq!(r.counts(), LintCounts { severe: 1, minor: 1 });
        let ok = report(Some(3), "t", Ok(vec![Finding { rule: "impeccable:gradient-text".into(), severity: "minor".into(), text: "g".into(), frame: "desktop".into(), file: "frames/desktop.html".into(), line: Some(12), selector: None }]), a);
        assert!(ok.ran && ok.problem.is_none());
        assert_eq!(ok.minor.iter().map(|f| f.rule.as_str()).collect::<Vec<_>>(), vec!["audit:alt", "impeccable:gradient-text"]);
        let d = tmp("report");
        let p = write_report(&d, "v3", &ok).unwrap();
        assert!(p.ends_with(".review/lint/v3.json"));
        assert_eq!(read_report(&d, "v3").unwrap().counts(), ok.counts());
        assert!(read_report(&d, "v9").is_none());
    }

    #[test]
    fn a_gate_that_is_off_says_so_and_never_reads_as_a_clean_pass() {
        let r = gate_off(Some(4), "t");
        assert!(!r.ran); assert_eq!(r.problem.as_deref(), Some("Lint gate off"));
        assert!(r.severe.is_empty() && r.minor.is_empty()); assert_eq!(r.version, Some(4));
        let v = serde_json::to_value(&r).unwrap();
        assert_eq!(v["ran"], false); assert_eq!(v["problem"], "Lint gate off");
    }

    #[test]
    fn the_detector_runs_on_a_frame_and_reports_its_own_rules() {
        let Some(node) = crate::setup::resolve("node") else { eprintln!("no node on this Mac; skipped"); return };
        let script = Path::new(env!("CARGO_MANIFEST_DIR")).join("resources/design-plugin/skills/impeccable/scripts/detect.mjs");
        if !script.is_file() { eprintln!("plugin not vendored yet; skipped"); return }
        let d = tmp("detector"); let frames = d.join("frames"); std::fs::create_dir_all(&frames).unwrap();
        std::fs::write(frames.join("desktop.html"), r#"<!doctype html><html><head><style>h1{background:linear-gradient(90deg,#8b5cf6,#ec4899);-webkit-background-clip:text;color:transparent}</style></head><body><h1>Hello</h1><div class="card"><div class="card">nested</div></div></body></html>"#).unwrap();
        let f = run_detector(Path::new(&node), &script, &frames).unwrap();
        assert!(f.iter().any(|x| x.rule.starts_with("impeccable:")), "{f:?}");
        assert!(f.iter().all(|x| x.frame == "desktop" && x.file == "frames/desktop.html"));
        let clean = d.join("clean"); std::fs::create_dir_all(&clean).unwrap();
        std::fs::write(clean.join("a.html"), "<!doctype html><html><head><meta name=viewport content='width=device-width'></head><body><main><h1>Plain</h1><p>Words.</p></main></body></html>").unwrap();
        assert!(run_detector(Path::new(&node), &script, &clean).unwrap().len() <= 2);
        assert!(run_detector(Path::new("/nonexistent/node"), &script, &frames).is_err());
    }
}
