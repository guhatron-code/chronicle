//! The director's review loop on disk: settings, loop state, answers, critique
//! rounds and reminders. App-owned files live under dot paths the design
//! session can never write; director-owned files are only read (and the
//! questions file gets the user's answers merged in).
use std::path::{Path, PathBuf};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

pub const WEIGHTS: [(&str, f64); 4] = [("ux", 0.35), ("art", 0.30), ("a11y", 0.20), ("copy", 0.15)];
const STATE_CAP: usize = 64 * 1024;
const FILE_CAP: u64 = 512 * 1024;
const REF_CAP: usize = 10_000_000;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct ReviewSettings { pub critique: bool, pub bar: f64, pub rounds: u32, pub lint: bool }

impl Default for ReviewSettings {
    fn default() -> Self { ReviewSettings { critique: true, bar: 8.0, rounds: 3, lint: true } }
}

impl ReviewSettings {
    pub fn clamp(self) -> Self {
        let bar = if self.bar.is_finite() { ((self.bar * 2.0).floor() / 2.0).clamp(5.0, 9.5) } else { 8.0 };
        ReviewSettings { bar, rounds: self.rounds.clamp(1, 5), ..self }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct SettingsPatch { pub critique: Option<bool>, pub bar: Option<f64>, pub rounds: Option<u32>, pub lint: Option<bool> }

impl SettingsPatch {
    fn apply(&self, mut s: ReviewSettings) -> ReviewSettings {
        if let Some(v) = self.critique { s.critique = v; }
        if let Some(v) = self.bar { s.bar = v; }
        if let Some(v) = self.rounds { s.rounds = v; }
        if let Some(v) = self.lint { s.lint = v; }
        s
    }
    fn merge(&self, o: &SettingsPatch) -> SettingsPatch {
        SettingsPatch { critique: o.critique.or(self.critique), bar: o.bar.or(self.bar), rounds: o.rounds.or(self.rounds), lint: o.lint.or(self.lint) }
    }
}

fn read_json(path: &Path) -> Option<Value> {
    serde_json::from_str(&std::fs::read_to_string(path).ok()?).ok()
}

fn write_json_atomic(path: &Path, v: &Value) -> Result<(), String> {
    write_text_atomic(path, &serde_json::to_string_pretty(v).map_err(|e| e.to_string())?)
}

fn write_text_atomic(path: &Path, text: &str) -> Result<(), String> {
    if let Some(p) = path.parent() { std::fs::create_dir_all(p).map_err(|e| e.to_string())?; }
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, text).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, path).map_err(|e| e.to_string())
}

fn review_dir(design_dir: &Path) -> PathBuf { design_dir.join(".review") }

pub fn project_settings(root: &Path) -> ReviewSettings {
    std::fs::read_to_string(root.join("review.json")).ok()
        .and_then(|t| serde_json::from_str::<SettingsPatch>(&t).ok())
        .map(|p| p.apply(ReviewSettings::default()).clamp())
        .unwrap_or_default()
}

fn project_patch(root: &Path) -> SettingsPatch {
    std::fs::read_to_string(root.join("review.json")).ok()
        .and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

pub fn design_patch(design_dir: &Path) -> SettingsPatch {
    std::fs::read_to_string(review_dir(design_dir).join("settings.json")).ok()
        .and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

pub fn effective(root: &Path, design_dir: &Path) -> ReviewSettings {
    design_patch(design_dir).apply(project_settings(root)).clamp()
}

fn patch_value(p: &SettingsPatch) -> Result<Value, String> {
    let mut v = serde_json::to_value(p).map_err(|e| e.to_string())?;
    if let Some(o) = v.as_object_mut() { o.retain(|_, x| !x.is_null()); }
    Ok(v)
}

pub fn set_project(root: &Path, patch: SettingsPatch) -> Result<ReviewSettings, String> {
    let merged = project_patch(root).merge(&patch);
    std::fs::create_dir_all(root).map_err(|e| e.to_string())?;
    write_json_atomic(&root.join("review.json"), &patch_value(&merged)?)?;
    Ok(project_settings(root))
}

pub fn set_design(design_dir: &Path, patch: SettingsPatch) -> Result<SettingsPatch, String> {
    let merged = design_patch(design_dir).merge(&patch);
    write_json_atomic(&review_dir(design_dir).join("settings.json"), &patch_value(&merged)?)?;
    Ok(merged)
}

pub fn read_state(design_dir: &Path) -> Option<Value> { read_json(&review_dir(design_dir).join("state.json")) }

pub fn write_state(design_dir: &Path, state: &Value) -> Result<(), String> {
    let text = serde_json::to_string_pretty(state).map_err(|e| e.to_string())?;
    if text.len() > STATE_CAP { return Err("that review state is too big to keep".into()); }
    write_text_atomic(&review_dir(design_dir).join("state.json"), &text)
}

pub fn answer_questions(design_dir: &Path, answers: &Value, skipped: bool) -> Result<Value, String> {
    let path = design_dir.join("questions.json");
    let mut f = read_json(&path).filter(|v| v.is_object()).ok_or("there are no questions to answer for this design")?;
    if skipped { f["skipped"] = json!(true); }
    else {
        if !answers.is_object() { return Err("those answers weren't in a shape Chronicle understands".into()); }
        f["answers"] = answers.clone();
        if let Some(o) = f.as_object_mut() { o.remove("skipped"); }
    }
    write_json_atomic(&path, &f)?;
    Ok(f)
}

pub fn weighted(scores: &[(String, f64)]) -> (f64, Vec<String>) {
    let mut total = 0.0; let mut missing = vec![];
    for (id, w) in WEIGHTS {
        match scores.iter().find(|(i, _)| i == id) {
            Some((_, s)) => total += s.clamp(0.0, 10.0) * w,
            None => missing.push(id.to_string()),
        }
    }
    ((total * 100.0 + 1e-6).round() / 100.0, missing)
}

pub fn read_critique(design_dir: &Path, round: u32, bar: f64) -> Result<Value, String> {
    let path = design_dir.join("critique").join(format!("round-{round}.json"));
    let mut c = read_json(&path).filter(|v| v.is_object()).ok_or_else(|| format!("there's no critique for round {round} yet"))?;
    let reviewers = c["reviewers"].as_array().ok_or("that critique has no reviewers in it")?;
    let scores: Vec<(String, f64)> = reviewers.iter()
        .filter_map(|r| Some((r["id"].as_str()?.to_string(), r["score"].as_f64()?))).collect();
    let (w, missing) = weighted(&scores);
    c["weighted"] = json!(w); c["passed"] = json!(w >= bar); c["bar"] = json!(bar);
    c["missing"] = json!(missing); c["round"] = json!(round);
    Ok(c)
}

fn reminders_path(root: &Path) -> PathBuf { root.join(".reminders.json") }

pub fn reminders(root: &Path) -> Vec<Value> {
    read_json(&reminders_path(root)).and_then(|v| v.as_array().cloned()).unwrap_or_default()
}

pub fn set_reminders(root: &Path, list: &[Value]) -> Result<(), String> {
    std::fs::create_dir_all(root).map_err(|e| e.to_string())?;
    write_json_atomic(&reminders_path(root), &Value::Array(list.to_vec()))
}

/// A relative path inside the design with no `..`, no dot-leading component,
/// no absolute or empty parts.
fn clean_rel(rel: &str) -> Result<PathBuf, String> {
    let mut out = PathBuf::new();
    for part in rel.split('/') {
        if part.is_empty() || part.starts_with('.') || part.contains('\\') || part.contains('\0') {
            return Err("that path isn't one Chronicle will open".into());
        }
        out.push(part);
    }
    if out.as_os_str().is_empty() { return Err("that path isn't one Chronicle will open".into()); }
    Ok(out)
}

pub fn read_design_file(design_dir: &Path, rel: &str) -> Result<Option<String>, String> {
    let path = design_dir.join(clean_rel(rel)?);
    let Ok(real) = path.canonicalize() else { return Ok(None) };
    let base = design_dir.canonicalize().map_err(|e| e.to_string())?;
    if !real.starts_with(&base) { return Err("that path isn't one Chronicle will open".into()); }
    let md = std::fs::metadata(&real).map_err(|e| e.to_string())?;
    if !md.is_file() { return Ok(None); }
    if md.len() > FILE_CAP { return Err("that file is too big to read here".into()); }
    std::fs::read_to_string(&real).map(Some).map_err(|e| e.to_string())
}

/// Save a reference image under `<design>/refs/`; returns `refs/<name>`.
pub fn attach_ref(design_dir: &Path, name: &str, bytes: &[u8]) -> Result<String, String> {
    let last = name.rsplit(['/', '\\']).next().unwrap_or("").trim();
    if last.is_empty() || last.starts_with('.') || last.contains('\0') {
        return Err("that file name can't be used for a reference".into());
    }
    if last.len() > 200 { return Err("That file's name is too long.".into()); }
    if bytes.len() > REF_CAP { return Err("a reference can be at most 10 MB".into()); }
    let refs = design_dir.join("refs");
    std::fs::create_dir_all(&refs).map_err(|e| e.to_string())?;
    let (stem, ext) = match last.rfind('.') { Some(i) if i > 0 => (&last[..i], &last[i..]), _ => (last, "") };
    let mut file = last.to_string(); let mut n = 2;
    while refs.join(&file).exists() { file = format!("{stem} {n}{ext}"); n += 1; }
    let tmp = refs.join(format!(".{file}.tmp"));
    std::fs::write(&tmp, bytes).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, refs.join(&file)).map_err(|e| e.to_string())?;
    Ok(format!("refs/{file}"))
}

#[cfg(test)]
mod tests {
    use super::*; use serde_json::json;
    fn tmp(n: &str) -> PathBuf { let d = std::env::temp_dir().join(format!("chronicle-review-{n}-{}", std::process::id())); let _ = std::fs::remove_dir_all(&d); std::fs::create_dir_all(&d).unwrap(); d }
    #[test]
    fn settings_layer_project_defaults_under_design_overrides_and_clamp() {
        let root = tmp("settings"); let d = root.join("home"); std::fs::create_dir_all(&d).unwrap();
        assert_eq!(effective(&root, &d), ReviewSettings::default());
        set_project(&root, SettingsPatch { bar: Some(9.75), rounds: Some(9), ..Default::default() }).unwrap();
        assert_eq!(effective(&root, &d), ReviewSettings { critique: true, bar: 9.5, rounds: 5, lint: true });
        set_design(&d, SettingsPatch { critique: Some(false), ..Default::default() }).unwrap();
        assert_eq!(effective(&root, &d).critique, false);
        assert_eq!(effective(&root, &d).bar, 9.5, "unset keys fall through to the project");
        set_design(&d, SettingsPatch { bar: Some(7.25), ..Default::default() }).unwrap();
        assert_eq!(effective(&root, &d).bar, 7.0, "bars land on the half");
        set_design(&d, SettingsPatch { bar: Some(7.3), ..Default::default() }).unwrap();
        assert_eq!(effective(&root, &d).bar, 7.0);
        set_design(&d, SettingsPatch { bar: Some(7.75), ..Default::default() }).unwrap();
        assert_eq!(effective(&root, &d).bar, 7.5);
        set_design(&d, SettingsPatch { bar: Some(7.25), ..Default::default() }).unwrap();
        assert_eq!(design_patch(&d).critique, Some(false), "earlier keys survive a later patch");
        std::fs::write(root.join("review.json"), "{nope").unwrap();
        assert_eq!(project_settings(&root), ReviewSettings::default(), "a bad file reads as defaults");
    }
    #[test]
    fn answers_land_in_the_directors_file_and_the_critique_is_recomputed() {
        let d = tmp("answers");
        assert!(answer_questions(&d, &json!({}), false).is_err());
        std::fs::write(d.join("questions.json"), r#"{"v":1,"questions":[{"id":"who","label":"Who?","type":"single","options":["a","b"]}],"references":true}"#).unwrap();
        let f = answer_questions(&d, &json!({ "who": "a", "references": ["refs/site.png"] }), false).unwrap();
        assert_eq!(f["answers"]["who"], "a"); assert_eq!(f["questions"][0]["id"], "who");
        let f2 = answer_questions(&d, &json!({}), true).unwrap(); assert_eq!(f2["skipped"], true);
        std::fs::create_dir_all(d.join("critique")).unwrap();
        std::fs::write(d.join("critique/round-1.json"), r#"{"v":1,"round":1,"version":4,"weighted":9.9,"passed":true,"reviewers":[{"id":"ux","score":6,"notes":[],"findings":[]},{"id":"art","score":8},{"id":"a11y","score":9},{"id":"copy","score":7}]}"#).unwrap();
        let c = read_critique(&d, 1, 8.0).unwrap();
        assert!((c["weighted"].as_f64().unwrap() - 7.35).abs() < 1e-9); assert_eq!(c["passed"], false); assert_eq!(c["bar"], 8.0);
        std::fs::write(d.join("critique/round-2.json"), r#"{"v":1,"round":2,"reviewers":[{"id":"ux","score":9},{"id":"art","score":9}]}"#).unwrap();
        let c2 = read_critique(&d, 2, 8.0).unwrap();
        assert_eq!(c2["missing"], json!(["a11y", "copy"])); assert!((c2["weighted"].as_f64().unwrap() - 5.85).abs() < 1e-9);
        assert!(read_critique(&d, 3, 8.0).is_err());
    }
    #[test]
    fn the_gate_rounds_its_score_and_trusts_only_the_effective_bar() {
        let d = tmp("gate"); std::fs::create_dir_all(d.join("critique")).unwrap();
        let w = |r: &str| std::fs::write(d.join("critique/round-1.json"), r).unwrap();
        w(r#"{"reviewers":[{"id":"ux","score":8},{"id":"art","score":8},{"id":"a11y","score":8},{"id":"copy","score":8}]}"#);
        assert_eq!(read_critique(&d, 1, 8.0).unwrap()["passed"], true);
        w(r#"{"reviewers":[{"id":"ux","score":6},{"id":"art","score":7},{"id":"a11y","score":9},{"id":"copy","score":10}]}"#);
        assert_eq!(read_critique(&d, 1, 7.5).unwrap()["passed"], true);
        w(r#"{"bar":0,"reviewers":[{"id":"ux","score":6},{"id":"art","score":6},{"id":"a11y","score":6},{"id":"copy","score":6}]}"#);
        let c = read_critique(&d, 1, 8.0).unwrap();
        assert_eq!(c["passed"], false); assert_eq!(c["bar"], 8.0);
    }
    #[test]
    fn state_reminders_and_design_files_are_jailed_and_bounded() {
        let root = tmp("state"); let d = root.join("home"); std::fs::create_dir_all(d.join("critique")).unwrap();
        assert!(read_state(&d).is_none());
        write_state(&d, &json!({ "phase": "gate", "round": 1 })).unwrap();
        assert_eq!(read_state(&d).unwrap()["phase"], "gate");
        assert!(write_state(&d, &json!({ "big": "x".repeat(70_000) })).is_err());
        set_reminders(&root, &[json!({ "slug": "home", "at": 1 })]).unwrap();
        assert_eq!(reminders(&root).len(), 1);
        std::fs::write(d.join("tokens.json"), "{}").unwrap();
        assert_eq!(read_design_file(&d, "tokens.json").unwrap().as_deref(), Some("{}"));
        assert_eq!(read_design_file(&d, "critique/round-9.json").unwrap(), None);
        assert!(read_design_file(&d, ".review/state.json").is_err());
        assert!(read_design_file(&d, "../other/tokens.json").is_err());
    }
    #[test]
    fn reference_attachments_are_named_safely_and_never_clobber() {
        let d = tmp("refs");
        assert!(attach_ref(&d, "..", b"x").is_err());
        assert!(attach_ref(&d, "a/..", b"x").is_err());
        assert!(attach_ref(&d, ".hidden", b"x").is_err());
        assert!(attach_ref(&d, "", b"x").is_err());
        assert_eq!(attach_ref(&d, &"a".repeat(300), b"x").unwrap_err(), "That file's name is too long.");
        assert_eq!(attach_ref(&d, "shelf.png", b"1").unwrap(), "refs/shelf.png");
        assert_eq!(attach_ref(&d, "shelf.png", b"2").unwrap(), "refs/shelf 2.png");
        assert_eq!(attach_ref(&d, "../../etc/shelf.png", b"3").unwrap(), "refs/shelf 3.png");
        assert_eq!(std::fs::read(d.join("refs/shelf 2.png")).unwrap(), b"2");
    }
}
