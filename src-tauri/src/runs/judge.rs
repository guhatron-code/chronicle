//! The judge (spec §6): four bounded decisions on the provider layer's
//! `decide`, acted on by confidence band — high acts, middle asks one second
//! opinion (`complete_json`), low takes the stricter option — and a lane's
//! question (`ask`). Never delegated: ownership, git by path, push and release,
//! exit codes, the review verdict. The judge sees command text, plan excerpts,
//! titles and failing output — never whole files. Every call is logged.
use super::oracle::Fallback;
use std::sync::Arc;
use super::record::{iso_now, DecisionLog};
use crate::providers::{Answer, Criterion, Decision, DecisionRequest};
use serde_json::json;
use std::collections::BTreeMap;

pub const ACT: f32 = 0.75;
pub const SECOND: f32 = 0.45;
const STATE_CAP: usize = 24_000;

pub const NO_JUDGE: &str = "Chronicle couldn't check this command, so it wasn't run.";
pub const NO_ANSWER: &str = "Chronicle couldn't answer that right now. Make the most reasonable choice within your lane's files and say which you made in your report.";
const PUSHBACK: &str = "Chronicle read your reason and thinks the item can be done as written. Try it again; if it truly can't be, say exactly what stops it.";
const SHELL_INSTRUCTIONS: &str = "A coding agent working on one lane of a plan wants to run a shell command. The lane may change only the files it owns. Choose allow if the command only reads, builds or tests, or writes only inside the owned files; confirm if you are unsure; refuse if it could change files outside them, the network, or the machine. Also answer whether the command writes outside the owned files.";
const BLOCK_INSTRUCTIONS: &str = "A coding agent says an item of a plan cannot be done as written. Decide whether the item truly cannot be done as written (yes), or whether the agent should try again (no).";
const TRIAGE_INSTRUCTIONS: &str = "Every lane passed its own checks, but the whole project's check failed after all were saved. Choose the lane whose changes most likely broke it, or none if no lane's changes explain the failure.";
const SIZING_INSTRUCTIONS: &str = "Items of a plan and the files each names are listed, with the pairs that share files. Score how many parallel lanes the work splits into without two lanes touching the same file (1 to 6).";
const SECOND_SYSTEM: &str = "You give a short second opinion for a coding orchestrator. You may read the repository. Answer only in the JSON shape asked for.";
const ASK_SYSTEM: &str = "You answer a coding agent's question about its lane of a plan in one or two sentences, using the plan and the repository. Answer only in the JSON shape asked for.";

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Band { Act, SecondOpinion, Strict }

impl Band {
    pub fn as_str(self) -> &'static str { match self { Band::Act => "act", Band::SecondOpinion => "second-opinion", Band::Strict => "strict" } }
}

/// REFLEX's three bands. A self-reported confidence (an emulated `decide`,
/// agents spec §9) counts one band stricter.
pub fn band(confidence: f32, self_reported: bool) -> Band {
    let b = if confidence >= ACT { Band::Act } else if confidence >= SECOND { Band::SecondOpinion } else { Band::Strict };
    if !self_reported { return b; }
    if b == Band::Act { Band::SecondOpinion } else { Band::Strict }
}

pub struct ShellAsk<'a> { pub lane: &'a str, pub command: &'a str, pub owns: &'a [String], pub item: &'a str, pub last_calls: &'a [String] }

#[derive(Debug, PartialEq)]
pub enum BlockOutcome { Park { reading: Option<f32> }, Retry { pushback: String } }

pub struct TriageLane { pub id: String, pub title: String, pub items: Vec<String>, pub files: Vec<String> }

fn cap(s: String) -> String {
    if s.len() <= STATE_CAP { return s; }
    let mut end = STATE_CAP;
    while !s.is_char_boundary(end) { end -= 1; }
    format!("{}\n[…cut]", &s[..end])
}
fn choice_of(d: &Decision, name: &str) -> Option<(String, BTreeMap<String, f32>, f32)> {
    match d.answers.get(name)? {
        Answer::Choice { choice, probabilities, confidence } => Some((choice.clone(), probabilities.iter().map(|(k, v)| (k.clone(), *v)).collect(), *confidence)),
        _ => None,
    }
}
fn noul_of(d: &Decision, name: &str) -> Option<f32> { match d.answers.get(name)? { Answer::Noul { yes } => Some(*yes), _ => None } }
fn score_of(d: &Decision, name: &str) -> Option<(i32, f32)> { match d.answers.get(name)? { Answer::Score { value, confidence } => Some((*value, *confidence)), _ => None } }
fn half(s: &str) -> String { s.trim().trim_end_matches('.').to_string() }

/// The judge holds two oracles. `decisions` answers the bounded `decide` calls only.
/// `second` is the run's review oracle (a chat-capable provider or the agent): every
/// second opinion and every lane question goes through it, never through `decisions`,
/// so a decisions-only provider (TypeSafe) is never asked for chat and never degraded for it.
pub struct Judge { decisions: Fallback, second: Arc<Fallback> }

impl Judge {
    pub fn new(decisions: Fallback, second: Arc<Fallback>) -> Self { Judge { decisions, second } }

    /// Every pending fallback notice, the decisions role's first, then the second-opinion
    /// (review) role's. The review notice is shared with `review::review`: whichever side
    /// takes it first shows it, once.
    pub fn take_notice(&self) -> Vec<String> {
        self.decisions.take_notice().into_iter().chain(self.second.take_notice()).collect()
    }

    /// One second opinion, logged whatever happens. `row` turns the answer into its log row
    /// (choice and action); a failed call logs `model: "none"` with `strict_action`.
    fn second_opinion(&self, prompt: &str, schema: &serde_json::Value, base: &DecisionLog, strict_action: &str,
                      row: &dyn Fn(&serde_json::Value) -> (String, String)) -> (Option<serde_json::Value>, DecisionLog) {
        match self.second.complete_json(SECOND_SYSTEM, prompt, schema) {
            Ok((v, model)) => {
                let (choice, action) = row(&v);
                (Some(v), DecisionLog { model, choice, confidence: 1.0, band: "second-opinion".into(), action, ..base.clone() })
            }
            Err(_) => (None, DecisionLog { model: "none".into(), choice: "none".into(), band: "second-opinion".into(),
                action: strict_action.into(), reason: "the second opinion couldn’t be reached".into(), ..base.clone() }),
        }
    }

    /// Decision 1: a shell command no rule decides.
    pub fn shell(&self, a: &ShellAsk) -> (bool, String, Vec<DecisionLog>) {
        let state = cap(format!("Command: {}\nThe lane owns: {}\nIts item: {}\nIts last two tool calls:\n{}", a.command, a.owns.join(", "), a.item, a.last_calls.join("\n")));
        let mk = || DecisionRequest { state: state.clone(), instructions: SHELL_INSTRUCTIONS.into(), criteria: vec![
            Criterion::Choice { name: "action".into(), options: vec!["allow".into(), "confirm".into(), "refuse".into()] },
            Criterion::Noul { name: "writes_outside".into() },
        ] };
        let base = DecisionLog { at: iso_now(), kind: "shell".into(), lane: Some(a.lane.into()), subject: a.command.into(), ..Default::default() };
        let d = match self.decisions.decide(&mk) {
            Ok(d) => d,
            Err(_) => return (false, NO_JUDGE.into(), vec![DecisionLog { model: "none".into(), choice: "refuse".into(), band: "strict".into(), action: "refuse".into(), reason: "no decision model could be reached".into(), ..base }]),
        };
        let (mut choice, probabilities, confidence) = choice_of(&d, "action").unwrap_or(("refuse".into(), BTreeMap::new(), 0.0));
        let writes = noul_of(&d, "writes_outside").unwrap_or(1.0);
        if choice == "allow" && writes >= 0.5 { choice = "confirm".into(); }
        let b = band(confidence, d.self_reported);
        let first = DecisionLog { model: d.model.clone(), choice: choice.clone(), probabilities, confidence, band: b.as_str().into(), self_reported: d.self_reported, ..base.clone() };
        let (allow, reason, extra) = match (b, choice.as_str()) {
            (Band::Strict, _) => (false, "it wasn’t clear the command stays inside the lane’s files".to_string(), vec![]),
            (Band::Act, "allow") => (true, if writes < 0.2 { "it reads only".to_string() } else { "it stays inside the lane’s files".to_string() }, vec![]),
            (Band::Act, "refuse") => (false, "it could change files the lane doesn’t own".to_string(), vec![]),
            _ => self.second_shell(&state, &base),
        };
        let mut out = vec![DecisionLog { action: if allow { "allow".into() } else { "refuse".into() }, reason: reason.clone(), ..first }];
        out.extend(extra);
        (allow, reason, out)
    }

    fn second_shell(&self, state: &str, base: &DecisionLog) -> (bool, String, Vec<DecisionLog>) {
        let schema = json!({ "type": "object", "required": ["choice", "reason"], "properties": { "choice": { "enum": ["allow", "refuse"] }, "reason": { "type": "string" } } });
        let prompt = format!("{state}\n\nMay this lane run the command? Answer allow or refuse, with a half-sentence reason.");
        let allowed = |v: &serde_json::Value| v["choice"] == "allow";
        let (v, mut log) = self.second_opinion(&prompt, &schema, base, "refuse", &|v| {
            (v["choice"].as_str().unwrap_or("refuse").into(), if allowed(v) { "allow".into() } else { "refuse".into() })
        });
        let Some(v) = v else { return (false, "the second opinion couldn’t be reached".into(), vec![log]) };
        let allow = allowed(&v);
        let mut reason = half(v["reason"].as_str().unwrap_or(""));
        if reason.is_empty() { reason = if allow { "a second opinion allowed it".into() } else { "a second opinion refused it".into() }; }
        log.reason = reason.clone();
        (allow, reason, vec![log])
    }

    /// Decision 2: a lane's `block` claim on an item.
    pub fn block(&self, lane: &str, item: &str, reason: &str, plan_excerpt: &str, owns: &[String]) -> (BlockOutcome, Vec<DecisionLog>) {
        let state = cap(format!("The item as written:\n{item}\n\nThe lane's reason it can't be done:\n{reason}\n\nFrom the plan:\n{plan_excerpt}\n\nFiles the lane owns: {}", owns.join(", ")));
        let mk = || DecisionRequest { state: state.clone(), instructions: BLOCK_INSTRUCTIONS.into(), criteria: vec![Criterion::Noul { name: "impossible_as_written".into() }] };
        let base = DecisionLog { at: iso_now(), kind: "block".into(), lane: Some(lane.into()), subject: item.into(), ..Default::default() };
        let d = match self.decisions.decide(&mk) {
            Ok(d) => d,
            Err(_) => return (BlockOutcome::Park { reading: None }, vec![DecisionLog { model: "none".into(), choice: "park".into(), band: "strict".into(), action: "park".into(), ..base }]),
        };
        // A missing answer takes the strict path, like every other decision: park.
        let Some(yes) = noul_of(&d, "impossible_as_written") else {
            return (BlockOutcome::Park { reading: None }, vec![DecisionLog { model: d.model, choice: "none".into(), band: "strict".into(), action: "park".into(),
                self_reported: d.self_reported, reason: "the decision had no answer".into(), ..base }]);
        };
        let conf = yes.max(1.0 - yes);
        let b = band(conf, d.self_reported);
        let first = DecisionLog { model: d.model.clone(), choice: if yes >= 0.5 { "impossible".into() } else { "possible".into() },
            probabilities: BTreeMap::from([("yes".to_string(), yes), ("no".to_string(), 1.0 - yes)]), confidence: conf, band: b.as_str().into(),
            self_reported: d.self_reported, ..base.clone() };
        let (outcome, extra) = match b {
            Band::Act if yes >= 0.5 => (BlockOutcome::Park { reading: Some(yes) }, vec![]),
            Band::Act => (BlockOutcome::Retry { pushback: PUSHBACK.into() }, vec![]),
            Band::Strict => (BlockOutcome::Park { reading: Some(yes) }, vec![]),
            Band::SecondOpinion => {
                let schema = json!({ "type": "object", "required": ["impossible", "reason"], "properties": { "impossible": { "type": "boolean" }, "reason": { "type": "string" } } });
                let impossible = |v: &serde_json::Value| v["impossible"].as_bool().unwrap_or(true);
                let (v, log) = self.second_opinion(&format!("{state}\n\nCan the item truly not be done as written? If it can, say in one sentence how."), &schema, &base, "park", &|v| {
                    if impossible(v) { ("impossible".into(), "park".into()) } else { ("possible".into(), "retry".into()) }
                });
                match v {
                    Some(v) if !impossible(&v) => (BlockOutcome::Retry { pushback: v["reason"].as_str().filter(|s| !s.trim().is_empty()).unwrap_or(PUSHBACK).to_string() }, vec![log]),
                    _ => (BlockOutcome::Park { reading: Some(yes) }, vec![log]),
                }
            }
        };
        let action = match &outcome { BlockOutcome::Park { .. } => "park", BlockOutcome::Retry { .. } => "retry" };
        let mut out = vec![DecisionLog { action: action.into(), ..first }];
        out.extend(extra);
        (outcome, out)
    }

    /// Decision 3: the head check failed with every lane green.
    pub fn triage(&self, failing: &str, lanes: &[TriageLane]) -> (Option<String>, Vec<DecisionLog>) {
        let table = lanes.iter().map(|l| format!("Lane {}: {} — items {} — changed {}", l.id, l.title, l.items.join(", "), l.files.join(", "))).collect::<Vec<_>>().join("\n");
        let state = cap(format!("Failing output:\n{failing}\n\nLanes:\n{table}"));
        let mut options: Vec<String> = lanes.iter().map(|l| l.id.clone()).collect();
        options.push("none".into());
        let mk = || DecisionRequest { state: state.clone(), instructions: TRIAGE_INSTRUCTIONS.into(), criteria: vec![Criterion::Choice { name: "lane".into(), options: options.clone() }] };
        let base = DecisionLog { at: iso_now(), kind: "triage".into(), subject: "the whole-project check".into(), ..Default::default() };
        let d = match self.decisions.decide(&mk) {
            Ok(d) => d,
            Err(_) => return (None, vec![DecisionLog { model: "none".into(), choice: "none".into(), band: "strict".into(), action: "none".into(), ..base }]),
        };
        let (choice, probabilities, confidence) = choice_of(&d, "lane").unwrap_or(("none".into(), BTreeMap::new(), 0.0));
        let valid = |c: &str| c != "none" && lanes.iter().any(|l| l.id == c);
        let action_of = |p: &Option<String>| p.as_ref().map(|p| format!("reopen {p}")).unwrap_or_else(|| "none".into());
        let b = band(confidence, d.self_reported);
        let mut extra = vec![];
        let pick = match b {
            Band::Act => Some(choice.clone()).filter(|c| valid(c)),
            Band::Strict => None,
            Band::SecondOpinion => {
                let schema = json!({ "type": "object", "required": ["lane"], "properties": { "lane": { "enum": options.clone() } } });
                let pick_of = |v: &serde_json::Value| v["lane"].as_str().map(String::from).filter(|c| valid(c));
                let (v, log) = self.second_opinion(&format!("{state}\n\nWhich lane should get one fix pass, or none?"), &schema, &base, "none", &|v| {
                    (v["lane"].as_str().unwrap_or("none").to_string(), action_of(&pick_of(v)))
                });
                extra.push(log);
                v.as_ref().and_then(pick_of)
            }
        };
        let mut out = vec![DecisionLog { model: d.model, choice, probabilities, confidence, band: b.as_str().into(), self_reported: d.self_reported, action: action_of(&pick), ..base }];
        out.extend(extra);
        (pick, out)
    }

    /// Decision 4: how many lanes to aim for, before the planner is prompted.
    pub fn sizing(&self, table: &str, max_lanes: u32) -> (u32, Vec<DecisionLog>) {
        let max = max_lanes.max(1);
        let state = cap(table.to_string());
        let mk = || DecisionRequest { state: state.clone(), instructions: SIZING_INSTRUCTIONS.into(), criteria: vec![Criterion::Score { name: "lanes".into(), min: 1, max: 6 }] };
        let base = DecisionLog { at: iso_now(), kind: "sizing".into(), subject: "lane count".into(), ..Default::default() };
        let d = match self.decisions.decide(&mk) {
            Ok(d) => d,
            Err(_) => return (1, vec![DecisionLog { model: "none".into(), choice: "1".into(), band: "strict".into(), action: "aim for 1 lane".into(), ..base }]),
        };
        let (value, confidence) = score_of(&d, "lanes").unwrap_or((1, 0.0));
        let value = value.clamp(1, 6) as u32;
        let fewer = value.saturating_sub(1).max(1);
        let aim = |n: u32| format!("aim for {n} lanes");
        let b = band(confidence, d.self_reported);
        let mut extra = vec![];
        let n = match b {
            Band::Act => value,
            Band::Strict => fewer,
            Band::SecondOpinion => {
                let schema = json!({ "type": "object", "required": ["lanes"], "properties": { "lanes": { "type": "integer", "minimum": 1, "maximum": 6 } } });
                let lanes_of = |v: &serde_json::Value| v["lanes"].as_u64().map(|x| (x as u32).clamp(1, 6));
                let (v, log) = self.second_opinion(&format!("{state}\n\nHow many lanes?"), &schema, &base, &aim(fewer.min(max)), &|v| match lanes_of(v) {
                    Some(n) => (n.to_string(), aim(n.min(max))),
                    None => ("none".into(), aim(fewer.min(max))),
                });
                extra.push(log);
                v.as_ref().and_then(lanes_of).unwrap_or(fewer)
            }
        }.min(max).max(1);
        let mut out = vec![DecisionLog { model: d.model, choice: value.to_string(), confidence, band: b.as_str().into(), self_reported: d.self_reported, action: aim(n), ..base }];
        out.extend(extra);
        (n, out)
    }

    /// A lane's question (`chronicle_run_ask`): answered here, never by the user,
    /// through the second-opinion (review) oracle.
    pub fn ask(&self, lane: &str, question: &str, context: &str) -> (String, Vec<DecisionLog>) {
        let schema = json!({ "type": "object", "required": ["answer"], "properties": { "answer": { "type": "string" } } });
        let base = DecisionLog { at: iso_now(), kind: "ask".into(), lane: Some(lane.into()), subject: question.into(), band: "act".into(), ..Default::default() };
        match self.second.complete_json(ASK_SYSTEM, &cap(format!("{context}\n\nThe lane asks:\n{question}")), &schema) {
            Ok((v, model)) => {
                let a = v["answer"].as_str().unwrap_or("").trim().to_string();
                let a = if a.is_empty() { NO_ANSWER.to_string() } else { a };
                (a, vec![DecisionLog { model, choice: "answered".into(), confidence: 1.0, action: "answered".into(), ..base }])
            }
            Err(_) => (NO_ANSWER.into(), vec![DecisionLog { model: "none".into(), choice: "none".into(), action: "default answer".into(), ..base }]),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::runs::oracle::fake::*;
    use crate::runs::oracle::DECISIONS_FALLBACK;
    use serde_json::json;
    use std::sync::atomic::Ordering;

    fn owns() -> Vec<String> { vec!["src/lib/**".into()] }
    fn shell_ask<'a>(owns: &'a [String], last: &'a [String]) -> ShellAsk<'a> {
        ShellAsk { lane: "b", command: "npx vitest run src/lib", owns, item: "T-143: Stream the reply through streamdown", last_calls: last }
    }
    /// A judge over a decisions fake and a second-opinion (review) fake, each with an agent that never answers.
    fn judge(decisions: &Arc<FakeOracle>, second_: &Arc<FakeOracle>) -> Judge {
        Judge::new(fallback(decisions, &FakeOracle::named("agent")), second(second_, &FakeOracle::named("agent")))
    }

    #[test]
    fn the_bands_start_at_point_75_and_point_45() {
        assert_eq!(band(0.75, false), Band::Act);
        assert_eq!(band(0.7499, false), Band::SecondOpinion);
        assert_eq!(band(0.45, false), Band::SecondOpinion);
        assert_eq!(band(0.4499, false), Band::Strict);
        assert_eq!(band(0.95, true), Band::SecondOpinion, "a self-reported confidence is one band stricter");
        assert_eq!(band(0.5, true), Band::Strict);
    }

    #[test]
    fn a_confident_allow_for_a_reading_command_runs() {
        let p = FakeOracle::named("jev-1.13.0");
        p.decide_with(decision(vec![choice("action", "allow", &[("allow", 0.93), ("confirm", 0.05), ("refuse", 0.02)], 0.93), noul("writes_outside", 0.04)], "jev-1.13.0", false));
        let j = judge(&p, &FakeOracle::named("review"));
        let (o, l) = (owns(), vec![]);
        let (allow, reason, logs) = j.shell(&shell_ask(&o, &l));
        assert!(allow);
        assert_eq!(reason, "it reads only");
        assert_eq!(logs.len(), 1);
        assert_eq!((logs[0].kind.as_str(), logs[0].band.as_str(), logs[0].action.as_str()), ("shell", "act", "allow"));
        assert_eq!(logs[0].model, "jev-1.13.0");
        assert_eq!(logs[0].subject, "npx vitest run src/lib");
        assert_eq!(logs[0].lane.as_deref(), Some("b"));
        assert!((logs[0].confidence - 0.93).abs() < 1e-6);
    }

    #[test]
    fn an_allow_that_writes_outside_asks_one_second_opinion() {
        let p = FakeOracle::named("jev-1.13.0");
        p.decide_with(decision(vec![choice("action", "allow", &[("allow", 0.9)], 0.9), noul("writes_outside", 0.8)], "jev-1.13.0", false));
        let s = FakeOracle::named("anthropic/claude-opus-5-5");
        s.complete_with(json!({ "choice": "refuse", "reason": "it rewrites package.json." }));
        let j = judge(&p, &s);
        let (o, l) = (owns(), vec![]);
        let (allow, reason, logs) = j.shell(&shell_ask(&o, &l));
        assert!(!allow);
        assert_eq!(reason, "it rewrites package.json");
        assert_eq!(logs[0].choice, "confirm");
        assert_eq!(logs[1].band, "second-opinion");
        assert_eq!(logs[1].model, "anthropic/claude-opus-5-5", "the second opinion came from the review oracle");
        assert_eq!(p.complete_calls.load(Ordering::SeqCst), 0, "never from the decisions oracle");
    }

    #[test]
    fn a_low_confidence_takes_the_stricter_option_without_asking_again() {
        let p = FakeOracle::named("jev-1.13.0");
        p.decide_with(decision(vec![choice("action", "allow", &[("allow", 0.4)], 0.4), noul("writes_outside", 0.1)], "jev-1.13.0", false));
        let s = FakeOracle::named("review");
        let j = judge(&p, &s);
        let (o, l) = (owns(), vec![]);
        let (allow, _, logs) = j.shell(&shell_ask(&o, &l));
        assert!(!allow);
        assert_eq!(logs[0].band, "strict");
        assert_eq!(p.complete_calls.load(Ordering::SeqCst) + s.complete_calls.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn a_failed_second_opinion_is_logged_and_takes_the_stricter_action() {
        let p = FakeOracle::named("jev-1.13.0");
        p.decide_with(decision(vec![choice("action", "confirm", &[("confirm", 0.6)], 0.6), noul("writes_outside", 0.1)], "jev-1.13.0", false));
        let j = judge(&p, &FakeOracle::named("review"));
        let (o, l) = (owns(), vec![]);
        let (allow, _, logs) = j.shell(&shell_ask(&o, &l));
        assert!(!allow);
        assert_eq!(logs.len(), 2, "the failed second opinion has its own row");
        assert_eq!((logs[1].model.as_str(), logs[1].band.as_str(), logs[1].action.as_str()), ("none", "second-opinion", "refuse"));
    }

    #[test]
    fn a_block_claim_is_parked_retried_or_given_a_second_opinion() {
        let p = FakeOracle::named("jev-1.13.0");
        p.decide_with(decision(vec![noul("impossible_as_written", 0.86)], "jev-1.13.0", false));
        p.decide_with(decision(vec![noul("impossible_as_written", 0.1)], "jev-1.13.0", false));
        p.decide_with(decision(vec![noul("impossible_as_written", 0.6)], "jev-1.13.0", false));
        let s = FakeOracle::named("review");
        s.complete_with(json!({ "impossible": false, "reason": "Rename the file the item names instead." }));
        let j = judge(&p, &s);
        let o = owns();
        assert_eq!(j.block("d", "T-147: Pre-warm the session", "needs src/App.tsx", "", &o).0, BlockOutcome::Park { reading: Some(0.86) });
        assert!(matches!(j.block("d", "T-147", "hard", "", &o).0, BlockOutcome::Retry { .. }));
        let (outcome, logs) = j.block("d", "T-147", "missing file", "", &o);
        match outcome {
            BlockOutcome::Retry { pushback } => assert!(pushback.contains("Rename the file")),
            other => panic!("{other:?}"),
        }
        assert_eq!((logs[1].model.as_str(), logs[1].choice.as_str(), logs[1].action.as_str()), ("review", "possible", "retry"));
    }

    #[test]
    fn a_block_decision_with_no_answer_parks_without_a_second_opinion() {
        let p = FakeOracle::named("jev-1.13.0");
        p.decide_with(decision(vec![], "jev-1.13.0", false));
        let s = FakeOracle::named("review");
        let j = judge(&p, &s);
        let (outcome, logs) = j.block("d", "T-147", "why", "", &owns());
        assert_eq!(outcome, BlockOutcome::Park { reading: None });
        assert_eq!((logs[0].band.as_str(), logs[0].action.as_str()), ("strict", "park"));
        assert_eq!(s.complete_calls.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn a_decisions_provider_that_cant_chat_is_never_degraded_by_a_second_opinion() {
        // TypeSafe answers `decide` only: its `complete_json` always fails (here, an empty queue).
        let p = FakeOracle::named("typesafe/jev-1.13.0");
        p.decide_with(decision(vec![noul("impossible_as_written", 0.6)], "typesafe/jev-1.13.0", false));
        p.decide_with(decision(vec![noul("impossible_as_written", 0.9)], "typesafe/jev-1.13.0", false));
        let s = FakeOracle::named("agent/claude-acp");
        s.complete_with(json!({ "impossible": true, "reason": "the file is gone" }));
        let j = judge(&p, &s);
        let o = owns();
        let (_, l1) = j.block("d", "T-1", "why", "", &o);
        assert_eq!(l1[0].band, "second-opinion");
        assert_eq!(p.complete_calls.load(Ordering::SeqCst), 0);
        assert!(j.take_notice().is_empty(), "no fallback notice: nothing failed");
        let (_, l2) = j.block("d", "T-1", "why", "", &o);
        assert_eq!(p.decide_calls.load(Ordering::SeqCst), 2, "the decisions role is still its provider");
        assert_eq!(l2[0].model, "typesafe/jev-1.13.0");
    }

    #[test]
    fn triage_picks_a_lane_or_none() {
        let lanes = vec![
            TriageLane { id: "a".into(), title: "Pane store batching".into(), items: vec!["T-141".into()], files: vec!["src/lib/agent-session.ts".into()] },
            TriageLane { id: "b".into(), title: "Streaming reply renderer".into(), items: vec!["T-143".into()], files: vec!["src/lib/mini-md.tsx".into()] },
        ];
        let p = FakeOracle::named("jev-1.13.0");
        p.decide_with(decision(vec![choice("lane", "b", &[("a", 0.1), ("b", 0.85), ("none", 0.05)], 0.85)], "jev-1.13.0", false));
        p.decide_with(decision(vec![choice("lane", "none", &[("none", 0.9)], 0.9)], "jev-1.13.0", false));
        p.decide_with(decision(vec![choice("lane", "zz", &[("zz", 0.9)], 0.9)], "jev-1.13.0", false));
        let j = judge(&p, &FakeOracle::named("review"));
        assert_eq!(j.triage("TS2339", &lanes).0.as_deref(), Some("b"));
        assert_eq!(j.triage("TS2339", &lanes).0, None);
        assert_eq!(j.triage("TS2339", &lanes).0, None, "a lane that isn't in the run is never reopened");
    }

    #[test]
    fn triage_logs_its_second_opinion() {
        let lanes = vec![TriageLane { id: "a".into(), title: "A".into(), items: vec![], files: vec![] }];
        let p = FakeOracle::named("jev-1.13.0");
        p.decide_with(decision(vec![choice("lane", "a", &[("a", 0.6)], 0.6)], "jev-1.13.0", false));
        p.decide_with(decision(vec![choice("lane", "a", &[("a", 0.6)], 0.6)], "jev-1.13.0", false));
        let s = FakeOracle::named("review");
        s.complete_with(json!({ "lane": "a" }));
        let j = judge(&p, &s);
        let (pick, logs) = j.triage("out", &lanes);
        assert_eq!(pick.as_deref(), Some("a"));
        assert_eq!(logs.len(), 2);
        assert_eq!((logs[1].model.as_str(), logs[1].choice.as_str(), logs[1].action.as_str()), ("review", "a", "reopen a"));
        let (pick, logs) = j.triage("out", &lanes);
        assert_eq!(pick, None, "a failed second opinion reopens nothing");
        assert_eq!((logs[1].model.as_str(), logs[1].action.as_str()), ("none", "none"));
    }

    #[test]
    fn sizing_aims_for_a_lane_count_capped_by_max_lanes() {
        let p = FakeOracle::named("jev-1.13.0");
        p.decide_with(decision(vec![score("lanes", 5, 0.9)], "jev-1.13.0", false));
        p.decide_with(decision(vec![score("lanes", 5, 0.2)], "jev-1.13.0", false));
        let j = judge(&p, &FakeOracle::named("review"));
        assert_eq!(j.sizing("items and files", 3).0, 3);
        assert_eq!(j.sizing("items and files", 6).0, 4, "low confidence: fewer lanes");
    }

    #[test]
    fn sizing_logs_its_second_opinion() {
        let p = FakeOracle::named("jev-1.13.0");
        p.decide_with(decision(vec![score("lanes", 5, 0.6)], "jev-1.13.0", false));
        p.decide_with(decision(vec![score("lanes", 5, 0.6)], "jev-1.13.0", false));
        let s = FakeOracle::named("review");
        s.complete_with(json!({ "lanes": 2 }));
        let j = judge(&p, &s);
        let (n, logs) = j.sizing("table", 6);
        assert_eq!(n, 2);
        assert_eq!((logs[1].model.as_str(), logs[1].choice.as_str(), logs[1].action.as_str()), ("review", "2", "aim for 2 lanes"));
        let (n, logs) = j.sizing("table", 6);
        assert_eq!(n, 4, "a failed second opinion aims for fewer lanes");
        assert_eq!((logs[1].model.as_str(), logs[1].action.as_str()), ("none", "aim for 4 lanes"));
    }

    #[test]
    fn an_unreachable_provider_falls_back_once_and_then_fails_strict() {
        let primary = FakeOracle::named("jev-1.13.0");
        primary.decide_with(decision(vec![choice("action", "allow", &[("allow", 0.95)], 0.95), noul("writes_outside", 0.05)], "jev-1.13.0", false));
        primary.fail_next_decide();
        let agent = FakeOracle::named("agent");
        agent.decide_with(decision(vec![choice("action", "allow", &[("allow", 0.9)], 0.9), noul("writes_outside", 0.1)], "agent", true));
        let s = FakeOracle::named("review");
        s.complete_with(json!({ "choice": "allow", "reason": "it only runs the tests" }));
        let j = Judge::new(fallback(&primary, &agent), second(&s, &FakeOracle::named("agent")));
        let (o, l) = (owns(), vec![]);
        let (a1, _, l1) = j.shell(&shell_ask(&o, &l));
        assert!(a1);
        assert_eq!(l1[0].model, "jev-1.13.0");
        assert!(j.take_notice().is_empty());
        let (a2, _, l2) = j.shell(&shell_ask(&o, &l));
        assert!(a2, "the agent answered in its place");
        assert_eq!(l2[0].model, "agent", "the log says which model answered");
        assert!(l2[0].self_reported);
        assert_eq!(l2[0].band, "second-opinion", "and its self-reported confidence counts one band stricter");
        assert_eq!(j.take_notice(), vec![DECISIONS_FALLBACK.to_string()]);
        assert!(j.take_notice().is_empty(), "one notice for the run");
        let (a3, _, l3) = j.shell(&shell_ask(&o, &l));
        assert_eq!(primary.decide_calls.load(Ordering::SeqCst), 2, "never asked again once it failed");
        assert!(!a3, "both unreachable: refuse");
        assert_eq!(l3[0].model, "none");
        assert_eq!(j.block("a", "T-1", "why", "", &o).0, BlockOutcome::Park { reading: None }, "both unreachable: park");
        assert_eq!(j.triage("out", &[]).0, None, "both unreachable: none");
        assert_eq!(j.sizing("table", 3).0, 1, "both unreachable: one lane");
    }

    #[test]
    fn a_lanes_question_gets_an_answer_or_an_honest_default() {
        let p = FakeOracle::named("jev-1.13.0");
        let s = FakeOracle::named("review");
        s.complete_with(json!({ "answer": "Use the existing token, --dur-fast." }));
        let j = judge(&p, &s);
        let (a, logs) = j.ask("c", "Which duration for the chevron?", "Lane C: Scroll anchoring");
        assert_eq!(a, "Use the existing token, --dur-fast.");
        assert_eq!(logs[0].kind, "ask");
        assert_eq!(logs[0].model, "review", "a lane's question goes to the review oracle");
        assert_eq!(p.complete_calls.load(Ordering::SeqCst), 0);
        let (a2, _) = j.ask("c", "again?", "");
        assert_eq!(a2, NO_ANSWER);
    }
}
