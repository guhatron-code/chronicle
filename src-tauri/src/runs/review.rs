//! The review verdict (spec §3): the saved diff and the check output, read by
//! the Review role (agents spec §9), answered as schema-checked JSON. A
//! verdict that can't be read is never guessed: the save counts as not
//! reviewed, and the lane gets a fix pass that says so.
use super::oracle::Fallback;
use super::record::{CheckResult, Finding, Review};
use serde_json::{json, Value};

pub const UNREVIEWED: &str = "The review's answer couldn't be read, so this save counts as not reviewed. Re-check the work against the items.";
const REVIEW_SYSTEM: &str = "You review one lane of a coding plan: its items, its saved diff and its check output. Pass it only if the diff does what the items ask, correctly and completely. Otherwise list findings with file, line and what is wrong. Answer only in the JSON shape asked for.";

pub fn review_schema() -> Value {
    json!({ "type": "object", "required": ["pass", "findings"], "properties": {
        "pass": { "type": "boolean" },
        "findings": { "type": "array", "items": { "type": "object", "required": ["file", "line", "what"],
            "properties": { "file": { "type": "string" }, "line": { "type": "integer" }, "what": { "type": "string" } } } } } })
}

pub fn parse_review(v: &Value, model: &str) -> Option<Review> {
    let pass = v.get("pass")?.as_bool()?;
    let findings = v.get("findings")?.as_array()?.iter().filter_map(|f| Some(Finding {
        file: f.get("file")?.as_str()?.to_string(),
        line: f.get("line").and_then(|l| l.as_u64()).unwrap_or(0) as u32,
        what: f.get("what")?.as_str()?.to_string(),
    })).collect();
    Some(Review { model: model.to_string(), pass, findings })
}

pub fn review(oracle: &Fallback, items: &[String], diff: &str, checks: &[CheckResult]) -> Review {
    let checks_text = if checks.is_empty() { "No automated checks for this lane.".to_string() } else {
        checks.iter().map(|c| format!("{}: exit {}", c.name, c.exit.map(|e| e.to_string()).unwrap_or_else(|| "none".into()))).collect::<Vec<_>>().join("\n")
    };
    let prompt = format!("The lane's items:\n{}\n\nThe checks:\n{checks_text}\n\nThe saved diff:\n{diff}", items.join("\n"));
    for _ in 0..2 {
        match oracle.complete_json(REVIEW_SYSTEM, &prompt, &review_schema()) {
            Ok((v, model)) => if let Some(mut r) = parse_review(&v, &model) {
                if !r.pass && r.findings.is_empty() {
                    r.findings.push(Finding { file: String::new(), line: 0, what: "The review didn't pass this save but named nothing specific; re-check the work against the items.".into() });
                }
                return r;
            },
            Err(_) => break,
        }
    }
    Review { model: "none".into(), pass: false, findings: vec![Finding { file: String::new(), line: 0, what: UNREVIEWED.into() }] }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::runs::oracle::fake::*;
    use serde_json::json;

    #[test]
    fn a_clean_review_passes_and_findings_are_kept() {
        let p = FakeOracle::named("review");
        p.complete_with(json!({ "pass": true, "findings": [] }));
        p.complete_with(json!({ "pass": false, "findings": [{ "file": "src/a.ts", "line": 12, "what": "the anchor is never released" }] }));
        let f = fallback(&p, &FakeOracle::named("agent"));
        let r = review(&f, &["T-144: Scroll anchoring".into()], "diff", &[]);
        assert!(r.pass);
        assert_eq!(r.model, "review");
        let r2 = review(&f, &[], "diff", &[]);
        assert!(!r2.pass);
        assert_eq!(r2.findings, vec![Finding { file: "src/a.ts".into(), line: 12, what: "the anchor is never released".into() }]);
    }

    #[test]
    fn an_unreadable_review_counts_as_not_reviewed() {
        let p = FakeOracle::named("review");
        p.complete_with(json!({ "verdict": "looks fine" }));
        p.complete_with(json!({ "verdict": "really" }));
        let r = review(&fallback(&p, &FakeOracle::named("agent")), &[], "diff", &[]);
        assert!(!r.pass, "the verdict is never delegated to a guess");
        assert_eq!(r.findings[0].what, UNREVIEWED);
    }

    #[test]
    fn a_fail_with_nothing_named_still_says_what_to_do() {
        let p = FakeOracle::named("review");
        p.complete_with(json!({ "pass": false, "findings": [] }));
        let r = review(&fallback(&p, &FakeOracle::named("agent")), &[], "diff", &[]);
        assert_eq!(r.findings.len(), 1);
        assert!(r.findings[0].what.contains("named nothing specific"));
    }
}
