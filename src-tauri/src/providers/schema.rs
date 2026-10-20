//! JSON out of a model's reply, checked against the request's schema — a
//! reply that breaks the schema is an error, never a guess.
use super::{Answer, Criterion};
use serde_json::{json, Map, Value};
use std::collections::HashMap;

pub fn extract_json(text: &str) -> Result<Value, String> {
    let t = text.trim();
    let unfenced = t.strip_prefix("```json").or_else(|| t.strip_prefix("```")).map(|s| s.trim_end().trim_end_matches("```").trim()).unwrap_or(t);
    if let Ok(v) = serde_json::from_str::<Value>(unfenced) { return Ok(v); }
    let (Some(a), Some(b)) = (t.find('{'), t.rfind('}')) else { return Err("the reply had no JSON in it".into()) };
    if b < a { return Err("the reply had no JSON in it".into()); }
    serde_json::from_str(&t[a..=b]).map_err(|e| format!("the reply's JSON didn't parse: {e}"))
}

pub fn check_schema(v: &Value, schema: &Value) -> Result<(), String> { check_at(v, schema, "$") }

fn check_at(v: &Value, s: &Value, at: &str) -> Result<(), String> {
    if let Some(allowed) = s.get("enum").and_then(Value::as_array) {
        if !allowed.contains(v) { return Err(format!("{at} is not one of the allowed values")); }
    }
    let ok = |b: bool, what: &str| if b { Ok(()) } else { Err(format!("{at} should be {what}")) };
    match s.get("type").and_then(Value::as_str) {
        Some("object") => {
            let o = v.as_object().ok_or(format!("{at} should be an object"))?;
            for k in s.get("required").and_then(Value::as_array).into_iter().flatten().filter_map(Value::as_str) {
                if !o.contains_key(k) { return Err(format!("{at}.{k} is missing")); }
            }
            if let Some(props) = s.get("properties").and_then(Value::as_object) {
                for (k, ps) in props {
                    if let Some(x) = o.get(k) { check_at(x, ps, &format!("{at}.{k}"))?; }
                }
            }
            Ok(())
        }
        Some("array") => {
            let a = v.as_array().ok_or(format!("{at} should be an array"))?;
            if let Some(items) = s.get("items") {
                for (i, x) in a.iter().enumerate() { check_at(x, items, &format!("{at}[{i}]"))?; }
            }
            Ok(())
        }
        Some("string") => ok(v.is_string(), "a string"),
        Some("integer") => ok(v.is_i64() || v.is_u64(), "a whole number"),
        Some("number") => ok(v.is_number(), "a number"),
        Some("boolean") => ok(v.is_boolean(), "true or false"),
        _ => Ok(()),
    }
}

/// The schema an emulated decision must match (strict-mode friendly: every
/// object closed, every property required).
pub fn decision_schema(criteria: &[Criterion]) -> Value {
    let mut props = Map::new();
    let mut required = Vec::new();
    for c in criteria {
        required.push(json!(c.name()));
        let s = match c {
            Criterion::Choice { options, .. } => {
                let probs: Map<String, Value> = options.iter().map(|o| (o.clone(), json!({ "type": "number" }))).collect();
                json!({ "type": "object", "additionalProperties": false, "required": ["choice", "probabilities", "confidence"], "properties": {
                    "choice": { "type": "string", "enum": options },
                    "probabilities": { "type": "object", "additionalProperties": false, "required": options, "properties": probs },
                    "confidence": { "type": "number" } } })
            }
            Criterion::Score { .. } => json!({ "type": "object", "additionalProperties": false, "required": ["value", "confidence"], "properties": {
                "value": { "type": "integer" }, "confidence": { "type": "number" } } }),
            Criterion::Noul { .. } => json!({ "type": "object", "additionalProperties": false, "required": ["yes"], "properties": { "yes": { "type": "number" } } }),
        };
        props.insert(c.name().to_string(), s);
    }
    json!({ "type": "object", "additionalProperties": false, "required": required, "properties": props })
}

fn unit(x: &Value, what: &str) -> Result<f32, String> {
    let f = x.as_f64().ok_or(format!("{what} isn't a number"))?;
    if !(0.0..=1.0).contains(&f) { return Err(format!("{what} is outside 0–1")); }
    Ok(f as f32)
}

pub fn parse_answers(v: &Value, criteria: &[Criterion]) -> Result<HashMap<String, Answer>, String> {
    check_schema(v, &decision_schema(criteria))?;
    let mut out = HashMap::new();
    for c in criteria {
        let a = &v[c.name()];
        let answer = match c {
            Criterion::Choice { name, options } => {
                let mut probabilities = HashMap::new();
                for o in options { probabilities.insert(o.clone(), unit(&a["probabilities"][o], &format!("{name}.probabilities.{o}"))?); }
                Answer::Choice { choice: a["choice"].as_str().unwrap_or_default().to_string(), probabilities, confidence: unit(&a["confidence"], &format!("{name}.confidence"))? }
            }
            Criterion::Score { name, min, max } => {
                let value = a["value"].as_i64().unwrap_or(i64::MIN);
                if value < *min as i64 || value > *max as i64 { return Err(format!("{name} must be between {min} and {max}")); }
                Answer::Score { value: value as i32, confidence: unit(&a["confidence"], &format!("{name}.confidence"))? }
            }
            Criterion::Noul { name } => Answer::Noul { yes: unit(&a["yes"], &format!("{name}.yes"))? },
        };
        out.insert(c.name().to_string(), answer);
    }
    Ok(out)
}

#[cfg(test)]
mod schema_tests {
    use super::*;
    use crate::providers::Criterion;
    use serde_json::json;

    fn crit() -> Vec<Criterion> {
        vec![
            Criterion::Choice { name: "action".into(), options: vec!["allow".into(), "confirm".into(), "refuse".into()] },
            Criterion::Score { name: "lanes".into(), min: 1, max: 6 },
            Criterion::Noul { name: "writes_outside".into() },
        ]
    }

    #[test]
    fn json_is_found_in_a_fenced_or_chatty_reply() {
        assert_eq!(extract_json("```json\n{\"a\":1}\n```").unwrap(), json!({ "a": 1 }));
        assert_eq!(extract_json("Sure — here it is: {\"a\": {\"b\": 2}} hope that helps").unwrap(), json!({ "a": { "b": 2 } }));
        assert!(extract_json("no json here").is_err());
    }

    #[test]
    fn the_schema_check_names_what_is_wrong() {
        let s = json!({ "type": "object", "required": ["verdict"], "properties": { "verdict": { "type": "string", "enum": ["pass", "fail"] }, "notes": { "type": "array", "items": { "type": "string" } } } });
        assert!(check_schema(&json!({ "verdict": "pass", "notes": ["ok"] }), &s).is_ok());
        assert_eq!(check_schema(&json!({}), &s).unwrap_err(), "$.verdict is missing");
        assert!(check_schema(&json!({ "verdict": "maybe" }), &s).unwrap_err().contains("allowed"));
        assert!(check_schema(&json!({ "verdict": "pass", "notes": [3] }), &s).unwrap_err().contains("$.notes[0]"));
    }

    #[test]
    fn a_decision_parses_every_criterion() {
        let v = json!({
            "action": { "choice": "confirm", "probabilities": { "allow": 0.2, "confirm": 0.7, "refuse": 0.1 }, "confidence": 0.6 },
            "lanes": { "value": 3, "confidence": 0.8 },
            "writes_outside": { "yes": 0.05 },
        });
        let a = parse_answers(&v, &crit()).unwrap();
        assert_eq!(a["lanes"], crate::providers::Answer::Score { value: 3, confidence: 0.8 });
        assert_eq!(a["writes_outside"], crate::providers::Answer::Noul { yes: 0.05 });
        let crate::providers::Answer::Choice { choice, probabilities, .. } = &a["action"] else { panic!() };
        assert_eq!(choice, "confirm");
        assert_eq!(probabilities["confirm"], 0.7);
    }

    #[test]
    fn an_answer_outside_its_bounds_is_refused() {
        let base = json!({
            "action": { "choice": "allow", "probabilities": { "allow": 1.0, "confirm": 0.0, "refuse": 0.0 }, "confidence": 0.9 },
            "lanes": { "value": 9, "confidence": 0.8 },
            "writes_outside": { "yes": 0.0 },
        });
        assert!(parse_answers(&base, &crit()).unwrap_err().contains("between 1 and 6"));
        let mut p = base.clone();
        p["lanes"]["value"] = json!(2);
        p["writes_outside"]["yes"] = json!(1.4);
        assert!(parse_answers(&p, &crit()).unwrap_err().contains("0–1"));
        let mut c = base.clone();
        c["lanes"]["value"] = json!(2);
        c["action"]["choice"] = json!("maybe");
        assert!(parse_answers(&c, &crit()).is_err());
    }
}
