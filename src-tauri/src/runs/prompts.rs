//! What the planner and the lanes are told (spec §3, §5 amended). The planner
//! is today's FIXES_PROMPT_HEAD plus the lane-map instructions; lanes carry
//! their rules in the prompt (no plugin — agents spec §8). Neither is asked to
//! flip notes or write the trailer commit: Chronicle does both when it closes.
use super::checks::Check;
use super::record::{CheckResult, Gate, Item, LaneSpec};

pub const LANE_MAP_INSTRUCTIONS: &str = "Then split the plan into lanes and declare them with the chronicle_run_declare tool. Do not start the work yourself: Chronicle runs each lane as its own agent once the map is accepted.\n\n- items: every item of the plan, once, as {id, title, note}. id is the note's id from its front matter if it has one (like T-141), otherwise a short id you choose (I-1, I-2, …); note is the note's path from the notes file when the item came from a note.\n- lanes: aim for {LANES} lanes, fewer if the work does not split. Each lane is {id, title, items, owns, depends_on, checks}: id is one lowercase letter (a, b, c, …); title is a few words; items are item ids; owns are the files the lane may change, as paths or globs relative to the project root (src/lib/x.ts, src/screens/agent/**); depends_on are lane ids that must finish first; checks are names from {CHECKS}.\n- Owned paths must not overlap between lanes. A file two items both need belongs to one lane; the other lane depends on it.\n- No lane may own anything under .chronicle/, fixes/, or chronicle.json.\n- If the tool says the map is invalid, fix what it names and call it again.\n\nEnd your turn once the map is accepted, with one sentence saying how many items went into how many lanes.";

fn lane_map(lanes: u32, checks: &[Check]) -> String {
    let list = if checks.is_empty() { "this project's check list, which is empty — leave checks empty".to_string() }
        else { format!("this project's check list: {}", checks.iter().map(|c| c.name.as_str()).collect::<Vec<_>>().join(", ")) };
    LANE_MAP_INSTRUCTIONS.replace("{LANES}", &lanes.to_string()).replace("{CHECKS}", &list)
}

pub fn planner_notes(fixes_head: &str, lanes: u32, checks: &[Check]) -> String {
    format!("{}\n{}", strip_closing_duties(fixes_head), lane_map(lanes, checks))
}

pub fn planner_plan(n: u64, plan_path: &str, prompt_path: &str, lanes: u32, checks: &[Check]) -> String {
    format!("The plan for round {n} is already written at {plan_path}, with its instructions at {prompt_path}. Read both. Do not change either file.\n\n{}", lane_map(lanes, checks))
}

pub fn planner_prompt(n: u64, text: &str, lanes: u32, checks: &[Check]) -> String {
    format!("You are turning the user's request below into an executable plan for this project. Write exactly two files, creating the fixes/ folder if needed:\n\n1. fixes/phase_{n}_fixes_plan.md — the request expanded into precise, unambiguous, actionable items a coding agent can execute without questions, referencing concrete files where inferable from the repo. THE FIRST LINE of this file must be exactly `Round kind: bug fixes` or `Round kind: feature additions`.\n\n2. fixes/phase_{n}_fixes_prompt.md — the execution instructions to paste into Claude Code or Codex: read the plan, execute every item, verify each like a shipping change, report per-item outcomes honestly.\n\nDo not change any other file. The request:\n\n{text}\n\n{}", lane_map(lanes, checks))
}

pub fn planner_retry(reasons: &str) -> String {
    format!("Chronicle couldn't accept the lane map yet:\n{reasons}\n\nFix exactly these and call chronicle_run_declare again with the whole map. Do not start the work yourself.")
}

pub fn lane_prompt(n: u64, lane: &LaneSpec, items: &[Item], plan_path: &str) -> String {
    let id = lane.id.to_uppercase();
    let list = lane.items.iter().map(|i| match items.iter().find(|x| &x.id == i) {
        Some(Item { rewrite: Some(r), .. }) => format!("- {i}: {r} (rewritten by the user)"),
        Some(x) => format!("- {i}: {}", x.title),
        None => format!("- {i}"),
    }).collect::<Vec<_>>().join("\n");
    let checks = if lane.checks.is_empty() { "there are no automated checks for this lane, but a reviewer reads your diff".to_string() } else { lane.checks.join(", ") };
    format!("You are lane {id} of round {n}: {}.\n\nRead {plan_path} for the whole plan. Your items:\n{list}\n\nYou may change only these files: {}. Chronicle refuses any other write, and anything a shell command changes elsewhere is reported to the user and left unsaved.\n\nRules:\n- When your turn ends Chronicle saves your work and checks it: {checks}. Do not run git commands that change anything; git status, diff, log and show are fine.\n- Never push, tag, publish or release anything.\n- Do not change notes, .chronicle/, fixes/ or chronicle.json. Chronicle marks the items done itself.\n- If an item cannot be done as written, call chronicle_run_block with the item id and the exact reason, then carry on with your other items.\n- If you need a decision the plan doesn't settle, call chronicle_run_ask.\n\nWhen every item is done and verified, end your turn with a short report, one line per item.", lane.title, lane.owns.join(", "))
}

pub fn failing_text(checks: &[CheckResult]) -> String {
    checks.iter().filter(|c| c.exit != Some(0)).map(|c| {
        let head = if c.timed_out { format!("`{}` didn't finish in {} minutes", c.name, c.ms / 60_000) }
            else { format!("`{}` failed (exit {})", c.name, c.exit.map(|e| e.to_string()).unwrap_or_else(|| "none".into())) };
        format!("{head}:\n```\n{}\n```", c.tail)
    }).collect::<Vec<_>>().join("\n\n")
}

pub fn fix_prompt(fix: u32, gate: &Gate) -> String {
    let mut parts = vec![format!("Chronicle saved your work and checked it, and it did not pass yet. This is fix {fix} of 2.")];
    let failing = failing_text(&gate.checks);
    if !failing.is_empty() { parts.push(failing); }
    if let Some(r) = gate.review.as_ref().filter(|r| !r.pass) {
        let f = r.findings.iter().map(|f| if f.file.is_empty() { format!("- {}", f.what) } else { format!("- {}:{} — {}", f.file, f.line, f.what) }).collect::<Vec<_>>().join("\n");
        parts.push(format!("The review found:\n{f}"));
    }
    parts.push("Fix exactly this, within your files, then end your turn. Same rules as before.".into());
    parts.join("\n\n")
}

pub fn head_fix_prompt(failing: &str) -> String {
    format!("Every lane passed on its own, but the whole project's check failed once all lanes were saved. Chronicle picked your lane to fix it — one pass.\n\n{failing}\n\nFix it within your files, then end your turn. Same rules as before.")
}

pub fn nudge_prompt(texts: &[String]) -> String {
    format!("The user added this while you worked:\n\n{}\n\nTake it into account, finish your items, then end your turn.", texts.join("\n\n"))
}

const CLOSING_NOTE: &str = "Chronicle marks the notes done and writes the phase commit itself when the run closes; the plan and prompt must not ask the agent to do either.";

/// Today's head orders the agent to flip each note to done and to end with the trailer commit.
/// Chronicle does both at close (spec §3), so those sentences go and one sentence says why.
pub fn strip_closing_duties(fixes_head: &str) -> String {
    let start_marker = "The prompt MUST also instruct the executor";
    let end_marker = "Do not change any other file";
    let mut out = match (fixes_head.find(start_marker), fixes_head.find(end_marker)) {
        (Some(s), Some(e)) if s < e => format!("{}{}", fixes_head[..s].trim_end_matches(' ').trim_end_matches('\n'), format!("\n\n{}", &fixes_head[e..])),
        _ => fixes_head.to_string(),
    };
    out = out.replace(" (and the note status updates the executor makes later)", "");
    format!("{}\n{CLOSING_NOTE}\n", out.trim_end())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::runs::record::{Finding, Review};

    fn checks() -> Vec<Check> { vec![Check { name: "test".into(), command: "npm run test".into() }, Check { name: "cargo test".into(), command: "cargo test".into() }] }

    #[test]
    fn the_planner_writes_the_plan_as_today_and_declares_lanes() {
        let p = planner_notes("You are turning a queue of user-written notes … fixes/phase_10_fixes_plan.md …", 3, &checks());
        assert!(p.starts_with("You are turning a queue"), "today's head comes first, unchanged");
        assert!(p.contains("chronicle_run_declare"));
        assert!(p.contains("aim for 3 lanes"));
        assert!(p.contains("this project's check list: test, cargo test"));
        assert!(p.contains("No lane may own anything under .chronicle/, fixes/, or chronicle.json."));
        assert!(p.contains("Do not start the work yourself"));
        assert!(planner_notes("h", 2, &[]).contains("which is empty — leave checks empty"));
    }

    #[test]
    fn a_plan_run_never_rewrites_the_plan_and_a_prompt_run_writes_one() {
        let p = planner_plan(9, "fixes/phase_9_fixes_plan.md", "fixes/phase_9_fixes_prompt.md", 2, &checks());
        assert!(p.contains("Do not change either file"));
        assert!(p.contains("fixes/phase_9_fixes_plan.md"));
        let q = planner_prompt(11, "Make the pane faster", 2, &checks());
        assert!(q.contains("fixes/phase_11_fixes_plan.md") && q.contains("fixes/phase_11_fixes_prompt.md"));
        assert!(q.contains("Make the pane faster"));
        assert!(q.contains("Round kind: bug fixes"));
    }

    #[test]
    fn a_lane_is_told_its_files_its_items_and_the_rules_but_not_to_commit_or_flip_notes() {
        let lane = LaneSpec { id: "c".into(), title: "Scroll anchoring".into(), items: vec!["T-144".into()],
            owns: vec!["src/screens/agent/thread-scroll.ts".into(), "src/index.css".into()], depends_on: vec![], checks: vec!["test".into(), "typecheck".into()], isolation: None };
        let items = vec![Item { id: "T-144".into(), title: "Scroll anchoring on a bottom sentinel".into(), note: None, rewrite: None }];
        let p = lane_prompt(10, &lane, &items, "fixes/phase_10_fixes_plan.md");
        assert!(p.starts_with("You are lane C of round 10: Scroll anchoring."));
        assert!(p.contains("- T-144: Scroll anchoring on a bottom sentinel"));
        assert!(p.contains("src/screens/agent/thread-scroll.ts, src/index.css"));
        assert!(p.contains("checks it: test, typecheck"));
        assert!(p.contains("chronicle_run_block") && p.contains("chronicle_run_ask"));
        assert!(!p.contains("status: done") && !p.contains("Chronicle-Phase"), "Chronicle flips the notes and writes the trailer (spec §3, Closing)");
        let rewritten = vec![Item { rewrite: Some("Warm the session from the pane instead".into()), ..items[0].clone() }];
        assert!(lane_prompt(10, &lane, &rewritten, "p").contains("- T-144: Warm the session from the pane instead (rewritten by the user)"));
    }

    #[test]
    fn a_fix_pass_carries_the_failing_output_and_the_findings() {
        let gate = Gate { commit: "abc".into(), fix: 0, notice: None,
            checks: vec![CheckResult { name: "typecheck".into(), exit: Some(2), ms: 2100, timed_out: false, tail: "error TS2339: Property 'anchor' does not exist".into() },
                         CheckResult { name: "test".into(), exit: Some(0), ms: 4200, timed_out: false, tail: String::new() }],
            review: Some(Review { model: "review".into(), pass: false, findings: vec![Finding { file: "src/a.ts".into(), line: 12, what: "the anchor is never released".into() }] }) };
        let p = fix_prompt(1, &gate);
        assert!(p.contains("fix 1 of 2"));
        assert!(p.contains("`typecheck` failed (exit 2)") && p.contains("TS2339"));
        assert!(!p.contains("`test` failed"));
        assert!(p.contains("- src/a.ts:12 — the anchor is never released"));
        assert!(head_fix_prompt("boom").contains("one pass"));
        assert_eq!(failing_text(&gate.checks), "`typecheck` failed (exit 2):\n```\nerror TS2339: Property 'anchor' does not exist\n```");
        let timed = vec![CheckResult { name: "build".into(), exit: None, ms: 600_000, timed_out: true, tail: "…".into() }];
        assert!(failing_text(&timed).contains("`build` didn't finish in 10 minutes"));
        assert!(nudge_prompt(&["Use --dur-fast".into()]).contains("Use --dur-fast"));
    }

    #[test]
    fn a_retry_names_every_reason() {
        let p = planner_retry("- Item T-3 isn't in any lane.\n- Lanes a and b both own src/a.ts");
        assert!(p.contains("Item T-3 isn't in any lane.") && p.contains("both own"));
        assert!(p.contains("chronicle_run_declare"));
    }

    #[test]
    fn closing_duties_are_stripped_from_todays_head() {
        let head = crate::FIXES_PROMPT_HEAD.replace("{N}", "10").replace("{TASKS}", ".chronicle/tasks.json");
        assert!(head.contains("status: done") && head.contains("Chronicle-Phase"), "the real head still orders both");
        let s = strip_closing_duties(&head);
        assert!(!s.contains("status: done"), "{s}");
        assert!(!s.contains("Chronicle-Phase"), "{s}");
        assert!(!s.contains("Close FX-"), "{s}");
        assert!(s.contains("fixes/phase_10_fixes_plan.md") && s.contains("Do not change any other file"));
        assert!(s.contains("Chronicle marks the notes done and writes the phase commit itself when the run closes; the plan and prompt must not ask the agent to do either."));
        assert!(planner_notes(&head, 2, &[]).contains("Chronicle marks the notes done"));
    }
}
