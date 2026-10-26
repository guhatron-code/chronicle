/*
 * The run record as the frontend reads it (src-tauri/src/runs/record.rs is the
 * only writer), and every word the run card, the lane view and the notes card
 * say — copied from the approved boards (design/comps/runs/gen.py). Strings
 * the boards don't draw are marked (new copy). Pure: the components render
 * what these return.
 */
export type RunState = "planning" | "running" | "gating" | "closing" | "done" | "needs-you" | "failed" | "stopped" | "interrupted";
export type LaneState =
  | "waiting" | "preparing" | "building_prompt" | "launching" | "initialising" | "streaming" | "finishing" | "gating" | "fixing"
  | "closed" | "failed" | "timed_out" | "stalled" | "cancelled" | "parked";
export interface Item { id: string; title: string; note?: string; rewrite?: string }
export interface LaneSpec { id: string; title: string; items: string[]; owns: string[]; depends_on: string[]; checks: string[]; isolation?: string }
export interface CheckResult { name: string; exit: number | null; ms: number; timed_out: boolean; tail: string }
export interface Finding { file: string; line: number; what: string }
export interface Review { model: string; pass: boolean; findings: Finding[] }
export interface Gate { commit: string; checks: CheckResult[]; review: Review | null; notice: string | null; fix: number }
export interface Leak { path: string; owner: string | null; by: string | null }
export interface LaneRecord {
  id: string; state: LaneState; attempt: number; started: string | null; ended: string | null; cost_usd: number;
  tokens: { in: number; out: number }; commit: string | null; leak: Leak[]; gates: Gate[]; parked: string | null;
  retry_at_ms: number | null; session: string | null; fixes: number;
}
export interface HeadCheck { commit: string; checks: CheckResult[]; reopened: string | null }
export interface DecisionLog {
  at: string; kind: string; model: string; choice: string; probabilities: Record<string, number>; confidence: number;
  band: string; action: string; self_reported: boolean; lane: string | null; subject: string; reason: string;
}
export interface NeedsYou { kind: "parked" | "exhausted" | "head" | "refused"; lane: string | null; item: string | null; reason: string; reading: number | null }
export interface RunRecord {
  n: number; round: number | null; kind: "notes" | "plan" | "prompt"; state: RunState; created: string; updated: string;
  plan_path: string; prompt_path: string; source: string; lane_map: { items: Item[]; lanes: LaneSpec[] } | null;
  lanes: LaneRecord[]; head_check: HeadCheck | null; decisions: DecisionLog[]; needs_you: NeedsYou[];
  cost: { usd: number; in: number; out: number }; planner_tries: number; planner_error: string | null; planner_cost_usd: number;
  notices: string[]; target_lanes: number | null; interrupted_from: RunState | null; skipped: string[]; head_pending: string[];
}

export type Tone = "neutral" | "success" | "warn" | "error" | "dim";
export interface Word { word: string; tone: Tone; pulse: boolean }

const ID = (id: string | null | undefined) => (id ?? "").toUpperCase();
const NUM = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
export const countWord = (n: number) => (n >= 0 && n < NUM.length ? NUM[n] : String(n));
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const BUSY: LaneState[] = ["preparing", "building_prompt", "launching", "initialising", "streaming", "finishing", "gating", "fixing"];
export const laneBusy = (l: LaneRecord) => BUSY.includes(l.state);
export const runOver = (r: RunRecord) => r.state === "done" || r.state === "failed" || r.state === "stopped";
const blocking = (r: RunRecord) => r.needs_you.filter((x) => x.kind !== "refused");
const laneNeedsYou = (r: RunRecord, id: string) => r.needs_you.some((x) => x.lane === id && x.kind !== "refused");
const itemCount = (r: RunRecord | null, fallback = 0) => r?.lane_map?.items.length ?? fallback;
const spec = (r: RunRecord, id: string) => r.lane_map?.lanes.find((l) => l.id === id);

export function laneWord(r: RunRecord, l: LaneRecord): Word {
  if (l.state === "parked" || laneNeedsYou(r, l.id)) return { word: "needs you", tone: "warn", pulse: false };
  switch (l.state) {
    case "waiting": return { word: "waiting", tone: "dim", pulse: false };
    case "finishing": case "gating": return { word: "being checked", tone: "neutral", pulse: true };
    case "fixing": return { word: "fixing", tone: "warn", pulse: false };
    case "closed": return { word: "finished", tone: "success", pulse: false };
    case "cancelled": return { word: "stopped", tone: "error", pulse: false };
    default: return { word: "working", tone: "neutral", pulse: true };
  }
}

export const tryLabel = (l: LaneRecord) => (l.attempt > 1 ? `try ${l.attempt} of 3` : null);

export function runWord(r: RunRecord): Word {
  switch (r.state) {
    case "planning": return { word: "planning", tone: "neutral", pulse: true };
    case "running": return { word: "running", tone: "neutral", pulse: true };
    case "gating": case "closing": return { word: "final check", tone: "neutral", pulse: true };
    case "done": return { word: "done", tone: "success", pulse: false };
    case "needs-you": return { word: "needs you", tone: "warn", pulse: false };
    case "interrupted": return { word: "interrupted", tone: "warn", pulse: false }; // (new copy)
    case "stopped": return { word: "stopped", tone: "error", pulse: false };
    case "failed": return { word: "didn’t start", tone: "error", pulse: false }; // (new copy)
  }
}

export const runTitle = (r: RunRecord, fallback = 0) => `Round ${r.round ?? r.n} · ${plural(itemCount(r, fallback), "item")}`;
export const lanesSummary = (r: RunRecord) => `${r.lanes.filter((l) => l.state !== "waiting").length} of ${r.lanes.length} lanes`;
export const fmtCost = (usd: number) => `$${usd.toFixed(2)}`;

export function fmtElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}
export const elapsedMs = (r: RunRecord, now: number) => Math.max(0, (runOver(r) ? Date.parse(r.updated) : now) - Date.parse(r.created));
export const laneElapsed = (l: LaneRecord, now: number) =>
  l.started ? Math.max(0, (l.ended ? Date.parse(l.ended) : now) - Date.parse(l.started)) : 0;

function needsFooter(r: RunRecord, rows: NeedsYou[]): string {
  const parked = rows.filter((x) => x.kind === "parked").length;
  const others = Math.max(0, itemCount(r) - parked);
  const saved = others === 1 ? "The other one is saved." : `The other ${countWord(others)} are saved.`;
  if (rows.length === 1) {
    const x = rows[0];
    const what = x.kind === "parked" ? `an item in lane ${ID(x.lane)} can’t be done as written`
      : x.kind === "exhausted" ? x.reason.replace(/\.$/, "").replace(/^Lane/, "lane")
      : "the whole-project check failed after every lane passed";
    return `One thing needs you: ${what}.${x.kind === "parked" ? ` ${saved}` : ""}`;
  }
  return `${cap(countWord(rows.length))} things need you.${parked > 0 ? ` ${saved}` : ""}`;
}

/** The one sentence at the foot of the card: the most important thing happening. */
export function runFooter(r: RunRecord): string {
  const round = r.round ?? r.n;
  if (r.state === "done") return `Saved as round ${round}. ${plural(itemCount(r), "item")} done.`;
  if (r.state === "stopped") return "Stopped. Nothing was undone; each lane’s unsaved changes are listed in its thread."; // (new copy)
  // validation reasons, or the planner's last words when it never declared a lane map (new copy)
  if (r.state === "failed") return r.planner_error ? `The plan couldn’t be split into lanes: ${r.planner_error}` : "The plan couldn’t be split into lanes.";
  if (r.state === "interrupted") return "Chronicle stopped while this round was running. Resume picks up the lanes that hadn’t finished."; // (new copy)
  const rows = blocking(r);
  if (rows.length > 0) return needsFooter(r, rows);
  if (r.state === "gating" || r.state === "closing") return "Every lane passed on its own. One last check of the whole project, then it’s saved.";
  const fixing = r.lanes.find((l) => l.state === "fixing");
  if (fixing) {
    const failed = fixing.gates.at(-1)?.checks.find((c) => c.exit !== 0)?.name;
    return `Lane ${ID(fixing.id)}’s ${failed ? `${failed} failed` : "review found problems"}. It is fixing that now — fix ${Math.max(1, fixing.fixes)} of 2.`;
  }
  const leaker = r.lanes.find((l) => l.leak.some((k) => k.by == null && k.owner != null));
  if (leaker) {
    const k = leaker.leak.find((x) => x.by == null && x.owner != null)!;
    return `Lane ${ID(leaker.id)} also touched a file lane ${ID(k.owner)} owns. That change is left unsaved and listed above; nothing is undone for you.`;
  }
  const fixed = r.lanes.filter((l) => l.state === "closed" && (l.gates.at(-1)?.fix ?? 0) > 0).sort((a, b) => (b.ended ?? "").localeCompare(a.ended ?? ""))[0];
  const working = r.lanes.filter((l) => l.state !== "closed" && l.state !== "waiting").length;
  if (fixed && working > 0) return `Lane ${ID(fixed.id)} passed on its fix. ${cap(countWord(working))} ${working === 1 ? "lane" : "lanes"} still working.`;
  return "Nothing needs you. Chronicle saves each lane as it passes.";
}

export interface NeedsRow {
  index: number; kind: NeedsYou["kind"]; lane: string | null; item: string | null;
  title: string; body: string; mono?: string; reading: string | null;
  actions: { label: string; act: "rewrite" | "skip" | "retry" | "recheck" | "open" | "dismiss"; primary?: boolean }[];
}

export function needsYouRows(r: RunRecord): NeedsRow[] {
  return r.needs_you.map((x, index): NeedsRow => {
    const head = { index, kind: x.kind, lane: x.lane, item: x.item, reading: null };
    switch (x.kind) {
      case "parked": {
        const it = r.lane_map?.items.find((i) => i.id === x.item);
        return { ...head, title: it?.title ?? x.item ?? "", body: `Lane ${ID(x.lane)}: “${x.reason}”`, reading: x.reading == null ? null : x.reading.toFixed(2),
          actions: [{ label: "Rewrite the item", act: "rewrite", primary: true }, { label: "Skip it", act: "skip" }] };
      }
      case "refused": {
        const saved = x.lane ? r.lanes.find((l) => l.id === x.lane)?.commit : null;
        return x.lane
          ? { ...head, title: "The agent tried to publish. Chronicle doesn’t publish for you.", body: `Lane ${ID(x.lane)}${saved ? ", after its last save" : ""}. Nothing left your Mac.`, actions: [{ label: "Open the lane", act: "open" }] }
          : { ...head, title: "The agent tried to publish. Chronicle doesn’t publish for you.", body: "The chat session, during the round. Nothing left your Mac.", actions: [{ label: "Dismiss", act: "dismiss" }] }; // (new copy)
      }
      case "exhausted":
        return { ...head, title: x.reason, body: "Its work so far is left as it is.", actions: [{ label: "Try the lane again", act: "retry", primary: true }, { label: "Open the lane", act: "open" }] }; // (new copy)
      case "head":
        return { ...head, title: "The whole-project check failed after every lane passed.", body: "", mono: x.reason, actions: [{ label: "Check again", act: "recheck", primary: true }] }; // (new copy)
    }
  });
}

export function decisionLine(r: RunRecord): { lead: string; command: string; tail: string; prob: string } | null {
  const d = [...r.decisions].reverse().find((x) => x.kind === "shell" && x.lane);
  if (!d) return null;
  return { lead: `Lane ${ID(d.lane)} asked to run`, command: d.subject, tail: `— ${d.action === "allow" ? "allowed" : "refused"}${d.reason ? `, ${d.reason}` : ""}.`, prob: d.confidence.toFixed(2) };
}

export function planRowText(r: RunRecord | null, n: number, total: number): string {
  if (!r?.lane_map) return `Planning round ${n}${total > 0 ? ` · ${plural(total, r?.kind === "plan" || r?.kind === "prompt" ? "item" : "note")}` : ""}`;
  return `Planned round ${r.round ?? r.n} · ${plural(itemCount(r), "item")} into ${plural(r.lane_map.lanes.length, "lane")}`;
}

export function runSubline(r: RunRecord, done: number, total: number): string {
  const tail = `${done} of ${total} done · ${fmtCost(r.cost.usd)}`;
  if (r.state === "needs-you") return `needs you · ${r.lanes.filter((l) => l.state === "closed" && !laneNeedsYou(r, l.id)).length} lanes saved · ${tail}`;
  if (r.state === "planning") return `${plural(total, "note")} · planning the lanes…`; // (new copy)
  if (r.state === "gating" || r.state === "closing") return `final check · ${tail}`;
  if (runOver(r) || r.state === "interrupted") return `${runWord(r).word} · ${tail}`;
  return `${r.lanes.filter(laneBusy).length} lanes working · ${tail}`;
}

/** A note row's chip on the notes card while its round runs (board R1/R4). */
export function noteChip(r: RunRecord, notePath: string, status: string | null): { label: string; tone: string } | null {
  const item = r.lane_map?.items.find((i) => i.note === notePath);
  if (!item) return null;
  if (r.needs_you.some((x) => x.kind === "parked" && x.item === item.id)) return { label: "needs you", tone: "queued" };
  const ln = r.lane_map?.lanes.find((l) => l.items.includes(item.id));
  const rec = ln ? r.lanes.find((l) => l.id === ln.id) : undefined;
  if (status === "done" || rec?.state === "closed") return { label: "done", tone: "done" };
  if (rec && (rec.state === "finishing" || rec.state === "gating")) return { label: "checking", tone: "progress" };
  if (rec && laneBusy(rec)) return { label: "working", tone: "progress" };
  return { label: "in round", tone: "unknown" };
}

export interface CheckRowView { name: string; state: "pass" | "fail" | "run" | "queued"; word: string; dur: string }
const dur = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const WORD = { pass: "passed", fail: "failed", run: "running", queued: "queued" } as const;

export const checkRows = (g: Gate): CheckRowView[] =>
  g.checks.map((c) => { const state = c.exit === 0 ? "pass" : "fail"; return { name: c.name, state, word: WORD[state], dur: dur(c.ms) }; });

export function finalCheckRows(r: RunRecord): CheckRowView[] {
  if (r.head_pending.length > 0) return r.head_pending.map((name, i) => ({ name, state: i === 0 ? "run" : "queued", word: WORD[i === 0 ? "run" : "queued"], dur: "" }));
  return r.head_check ? checkRows({ commit: r.head_check.commit, checks: r.head_check.checks, review: null, notice: null, fix: 0 }) : [];
}

export function gateLabel(laneId: string, g: Gate, inLane: boolean): string {
  const fix = g.fix > 0 ? `fix ${g.fix} · ` : "";
  return inLane ? cap(`${fix}checked after save`) : `Lane ${ID(laneId)} · ${fix}checked after save`;
}

export const reviewLine = (rv: Review) => (rv.pass ? "Reviewed: looks right" : `Reviewed: ${plural(rv.findings.length, "finding")}`);

export function leakParts(k: Leak): { lead: string; path: string; tail: string } {
  if (k.by) return { lead: `Lane ${ID(k.by)} also changed `, path: k.path, tail: ", which this lane owns — left unsaved for you." }; // (new copy)
  return { lead: "Also changed ", path: k.path, tail: k.owner ? `, which lane ${ID(k.owner)} owns — left unsaved for you.` : ", which no lane owns — left unsaved for you." };
}

export const laneItemTitles = (r: RunRecord, l: LaneRecord) =>
  (spec(r, l.id)?.items ?? []).map((i) => { const it = r.lane_map?.items.find((x) => x.id === i); return it?.rewrite ?? it?.title ?? i; }).join(" · ");
export const ownsLabel = (r: RunRecord, l: LaneRecord) => `Owns ${plural(spec(r, l.id)?.owns.length ?? 0, "file")}`;
export const laneDivider = (r: RunRecord, l: LaneRecord) => `lane ${ID(l.id)} · ${laneWord(r, l).word}`;

/** What a native notification says when a round needs the user or is saved, and they're away. */
export function transitionNotice(prev: RunRecord | null, next: RunRecord): string | null {
  if (prev?.state === next.state) return null;
  if (next.state === "needs-you") return `Round ${next.round ?? next.n} needs you.`;
  if (next.state === "done") return `Round ${next.round ?? next.n} is saved.`;
  return null;
}

/** What the run card's plan row knows from its thread entry. */
export interface PlanEntry { n: number; total: number; queued?: boolean; outcome?: "running" | "failed" | "cancelled" }

/** Where the plan row stands: the lanes are planned, the planning failed or was stopped, or it is still planning. */
export function planRowState(r: RunRecord | null, e: PlanEntry): "planned" | "failed" | "planning" {
  if (r?.lane_map != null) return "planned";
  return r?.state === "failed" || e.outcome === "failed" || e.outcome === "cancelled" ? "failed" : "planning";
}

/** The plan row's one sentence, including why a round never got its lanes. */
export function planRowLine(r: RunRecord | null, e: PlanEntry): string {
  const text = planRowState(r, e) !== "failed"
    ? planRowText(r, e.n, e.total)
    : e.outcome === "cancelled" ? `Round ${e.n} · stopped before the lanes were planned` // (new copy)
    : r ? runFooter(r) : `Round ${e.n} didn’t start`; // (new copy)
  return e.queued ? `${text} · waiting for the pane` : text;
}

/** The state word a needs-you row shows: its lane's, or the run's when it belongs to no lane. */
export function needsWord(r: RunRecord, laneId: string | null): Word {
  const l = laneId ? r.lanes.find((x) => x.id === laneId) : undefined;
  return l ? laneWord(r, l) : runWord(r);
}

/** A stopped lane's line in its view, above Discard (new copy). */
export const stoppedLaneLine = (l: LaneRecord): string | null =>
  l.state === "cancelled" ? "Stopped. This lane’s unsaved changes are still in your project." : null;

/** A lane's ask the judge decided, as its thread's decision line: what ran or
 *  didn't, why, and the option taken, the model and the band. */
export function guardLine(g: {
  allowed: boolean; path: string; reason: string;
  decision?: { choice: string; confidence: number; model: string; band: string } | null;
}): { lead: string; path: string; tail: string; meta: string; prob: string } | null {
  const d = g.decision;
  if (!d) return null;
  const why = g.reason.trim().replace(/\.$/, "");
  return {
    lead: g.allowed ? "Ran" : "Didn’t run",
    path: g.path,
    tail: why ? ` — ${g.allowed ? "allowed" : "refused"}, ${why}.` : ".",
    meta: [d.choice, d.model, d.band].filter(Boolean).join(" · "),
    prob: d.confidence.toFixed(2),
  };
}
