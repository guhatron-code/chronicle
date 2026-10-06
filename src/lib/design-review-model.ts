/* The director's files as one typed model: questions, tokens, lint, critique, settings, state.
 * Parsers coerce like design-model.ts: nothing trusted, junk dropped, the score always recomputed. */

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
/** A string, or a number written out ("700", "1.1"). */
const text = (v: unknown): string | null => (typeof v === "string" ? v : typeof v === "number" && Number.isFinite(v) ? String(v) : null);

/* ---------- reviewers ---------- */
export const REVIEWERS = [
  { id: "ux", name: "UX director", focus: "heuristics, task flow, the kind's rules", weight: 0.35 },
  { id: "art", name: "Art director", focus: "craft, type, brand fit", weight: 0.3 },
  { id: "a11y", name: "Accessibility", focus: "WCAG 2.2 AA, focus, targets", weight: 0.2 },
  { id: "copy", name: "Copy", focus: "clarity, voice, no filler", weight: 0.15 },
] as const;
export type ReviewerId = "ux" | "art" | "a11y" | "copy";
const isReviewer = (v: unknown): v is ReviewerId => REVIEWERS.some((r) => r.id === v);
/** the bundled agents return their own names as the id; each maps to its reviewer */
const ID_ALIASES: Record<string, ReviewerId> = { "ux-director": "ux", "art-director": "art", accessibility: "a11y" };
/** A reviewer id as a critique file writes it — canonical or an agent's name — or null. */
export function reviewerId(v: unknown): ReviewerId | null {
  if (typeof v !== "string") return null;
  const k = v.trim().toLowerCase();
  return isReviewer(k) ? k : ID_ALIASES[k] ?? null;
}

/** the bundled reviewers' subagent names, spaced the way `reviewerForTitle` normalises them */
const AGENT_NAMES: [ReviewerId, string][] = [["art", "art director"], ["ux", "ux director"], ["a11y", "accessibility"], ["copy", "copy"]];

/** what may follow a reviewer's name: nothing, a separator, or a word that says
 *  it's a review — so "Copy: review v6" is the copy reviewer and "Copy frames" isn't */
const NAME_END = /^($|\s*[:\])·—–|,.]|\s(review|reviewer|reviewing|critique|check|audit|evaluation|pass|round|agent|subagent|v\d)\b)/;

/** The reviewer a subagent's title names: its name as a whole word at the start
 *  (after an optional `[` or `(`), hyphens and underscores read as spaces, and
 *  followed by `NAME_END`. The
 *  longest name wins when two could match; anything else is no reviewer. */
export function reviewerForTitle(title: string): ReviewerId | null {
  const t = title.toLowerCase().replace(/[-_]/g, " ").replace(/\s+/g, " ").trim().replace(/^[[(]\s*/, "");
  let best: [ReviewerId, string] | null = null;
  for (const [id, name] of AGENT_NAMES) {
    if (!t.startsWith(name) || !NAME_END.test(t.slice(name.length))) continue;
    if (!best || name.length > best[1].length) best = [id, name];
  }
  return best ? best[0] : null;
}

/* ---------- settings ---------- */
export interface ReviewSettings { critique: boolean; bar: number; rounds: number; lint: boolean }
export const DEFAULT_SETTINGS: ReviewSettings = { critique: true, bar: 8.0, rounds: 3, lint: true };
const BAR_MIN = 5, BAR_MAX = 9.5, ROUNDS_MIN = 1, ROUNDS_MAX = 5;

export function clampSettings(s: ReviewSettings): ReviewSettings {
  const bar = Math.floor(Math.min(BAR_MAX, Math.max(BAR_MIN, s.bar)) * 2) / 2;
  const rounds = Math.min(ROUNDS_MAX, Math.max(ROUNDS_MIN, Math.round(s.rounds)));
  return { critique: s.critique, bar, rounds, lint: s.lint };
}

export function parseSettings(raw: unknown): ReviewSettings {
  const r = obj(raw) ?? {};
  return clampSettings({
    critique: typeof r.critique === "boolean" ? r.critique : DEFAULT_SETTINGS.critique,
    bar: num(r.bar) ?? DEFAULT_SETTINGS.bar,
    rounds: num(r.rounds) ?? DEFAULT_SETTINGS.rounds,
    lint: typeof r.lint === "boolean" ? r.lint : DEFAULT_SETTINGS.lint,
  });
}

/* ---------- questions ---------- */
export interface Question { id: string; label: string; hint: string; type: "single" | "multi" | "text"; options: string[]; max: number | null }
export interface Questions { questions: Question[]; references: boolean; answers: Record<string, string | string[]> | null; skipped: boolean }

export function parseQuestions(raw: unknown): Questions | null {
  const r = obj(raw);
  if (!r || !Array.isArray(r.questions)) return null;
  const seen = new Set<string>();
  const questions: Question[] = [];
  for (const q of r.questions) {
    const o = obj(q);
    const id = o && str(o.id), label = o && str(o.label);
    if (!o || !id || !label || seen.has(id)) continue;
    seen.add(id);
    const type = o.type === "multi" || o.type === "text" ? o.type : "single";
    const max = type === "multi" && typeof o.max === "number" && Number.isInteger(o.max) && o.max > 0 ? o.max : null;
    questions.push({ id, label, hint: str(o.hint) ?? "", type, options: strs(o.options), max });
    if (questions.length === 5) break;
  }
  let answers: Questions["answers"] = null;
  const a = obj(r.answers);
  if (a) {
    answers = {};
    for (const [k, v] of Object.entries(a)) {
      if (k === "references") { if (Array.isArray(v)) answers[k] = v as unknown as string[]; continue; }
      if (typeof v === "string") answers[k] = v;
      else if (Array.isArray(v)) answers[k] = strs(v);
    }
  }
  return { questions, references: r.references === true, answers, skipped: r.skipped === true };
}

export const questionsPending = (q: Questions | null) => !!q && q.questions.length > 0 && q.answers == null && !q.skipped;

/* ---------- tokens ---------- */
export interface TokensPlan { colors: { name: string; value: string }[]; type: { role: string; family: string; weight: string; size: string; leading: string }[]; rejected: string[] }

export function parseTokens(raw: unknown): TokensPlan | null {
  const r = obj(raw);
  if (!r) return null;
  const colors = (Array.isArray(r.colors) ? r.colors : []).flatMap((c) => {
    const o = obj(c), name = o && str(o.name), value = o && str(o.value);
    return name && value ? [{ name, value }] : [];
  });
  const type = (Array.isArray(r.type) ? r.type : []).flatMap((t) => {
    const o = obj(t);
    const role = o && str(o.role), family = o && str(o.family);
    if (!o || !role || !family) return [];
    return [{ role, family, weight: text(o.weight) ?? "", size: text(o.size) ?? "", leading: text(o.leading) ?? "" }];
  });
  return { colors, type, rejected: strs(r.rejected) };
}

/* ---------- lint ---------- */
export type Severity = "severe" | "minor";
export interface Finding { rule: string; severity: Severity; text: string; frame: string; file: string; line?: number; selector?: string }
export interface LintReport { v: 1; version: number | null; at: string; ran: boolean; problem: string | null; severe: Finding[]; minor: Finding[] }

function parseFinding(raw: unknown, fallbackRule: string, fallbackSeverity: Severity): Finding | null {
  const o = obj(raw);
  const t = o && str(o.text);
  if (!o || t == null) return null;
  const f: Finding = {
    rule: str(o.rule) ?? fallbackRule,
    severity: o.severity === "severe" ? "severe" : o.severity === "minor" ? "minor" : fallbackSeverity,
    text: t, frame: str(o.frame) ?? "", file: str(o.file) ?? "",
  };
  const line = num(o.line), selector = str(o.selector);
  if (line != null) f.line = line;
  if (selector != null) f.selector = selector;
  return f;
}

export function parseLint(raw: unknown): LintReport | null {
  const r = obj(raw);
  if (!r || typeof r.ran !== "boolean") return null;
  const list = (v: unknown, sev: Severity) => (Array.isArray(v) ? v : []).flatMap((x) => { const f = parseFinding(x, "lint", sev); return f ? [f] : []; });
  return { v: 1, version: num(r.version), at: str(r.at) ?? "", ran: r.ran, problem: str(r.problem), severe: list(r.severe, "severe"), minor: list(r.minor, "minor") };
}

/* ---------- critique ---------- */
export interface ReviewerResult { id: ReviewerId; score: number; notes: string[]; findings: Finding[] }
export interface CritiqueRound { round: number; version: number | null; at: string; bar: number; weighted: number; passed: boolean; reviewers: ReviewerResult[]; missing: ReviewerId[]; blocker: string | null }

export function weightedScore(scores: Partial<Record<ReviewerId, number>>): { weighted: number; missing: ReviewerId[] } {
  let sum = 0;
  const missing: ReviewerId[] = [];
  for (const r of REVIEWERS) {
    const s = scores[r.id];
    if (typeof s !== "number" || !Number.isFinite(s)) { missing.push(r.id); continue; }
    sum += Math.min(10, Math.max(0, s)) * r.weight;
  }
  return { weighted: Math.round(sum * 100 + 1e-6) / 100, missing };
}

export function parseCritique(raw: unknown, bar: number, round: number): CritiqueRound | null {
  const r = obj(raw);
  if (!r || !Array.isArray(r.reviewers)) return null;
  const reviewers: ReviewerResult[] = [];
  for (const x of r.reviewers) {
    const o = obj(x);
    const score = o && num(o.score);
    const id = o && reviewerId(o.id);
    if (!o || !id || score == null || reviewers.some((v) => v.id === id)) continue;
    const findings = (Array.isArray(o.findings) ? o.findings : []).flatMap((f) => {
      const p = obj(f), t = p && str(p.text);
      if (!p || t == null) return [];
      const fi: Finding = { rule: `critique:${id}`, severity: p.severity === "severe" ? "severe" : "minor", text: t, frame: str(p.frame) ?? "", file: "" };
      const selector = str(p.selector);
      if (selector != null) fi.selector = selector;
      return [fi];
    });
    reviewers.push({ id, score: Math.min(10, Math.max(0, score)), notes: strs(o.notes), findings });
  }
  const { weighted, missing } = weightedScore(Object.fromEntries(reviewers.map((v) => [v.id, v.score])));
  return { round, version: num(r.version), at: str(r.at) ?? "", bar, weighted, passed: weighted >= bar && missing.length === 0, reviewers, missing, blocker: str(r.blocker) };
}

/* ---------- state ---------- */
export type ReviewPhase = "idle" | "building" | "questions" | "gate" | "fixing" | "critique" | "done" | "below-bar" | "stopped";
export type PromptKind = "brief" | "answers" | "user" | "lintFix" | "critique" | "critiqueFix" | "resolve" | "fixFinding" | "continue";
const PHASES: ReviewPhase[] = ["idle", "building", "questions", "gate", "fixing", "critique", "done", "below-bar", "stopped"];
const PROMPTS: PromptKind[] = ["brief", "answers", "user", "lintFix", "critique", "critiqueFix", "resolve", "fixFinding", "continue"];

export interface ReviewState { v: 1; phase: ReviewPhase; round: number; fixPass: number; version: number | null; best: { round: number; score: number } | null; startedAt: number | null; lastPrompt: PromptKind | null; accepted: boolean }
export const initialReviewState = (): ReviewState => ({ v: 1, phase: "idle", round: 0, fixPass: 0, version: null, best: null, startedAt: null, lastPrompt: null, accepted: false });

export function parseReviewState(raw: unknown): ReviewState {
  const r = obj(raw);
  const init = initialReviewState();
  if (!r) return init;
  const b = obj(r.best), br = b && num(b.round), bs = b && num(b.score);
  return {
    v: 1,
    phase: PHASES.find((p) => p === r.phase) ?? "idle",
    round: num(r.round) ?? 0,
    fixPass: num(r.fixPass) ?? 0,
    version: num(r.version),
    best: br != null && bs != null ? { round: br, score: bs } : null,
    startedAt: num(r.startedAt),
    lastPrompt: PROMPTS.find((p) => p === r.lastPrompt) ?? null,
    accepted: r.accepted === true,
  };
}

/** "Fixed: a, b, c and 2 more" — at most three findings, severe first, each
    cut to its first sentence or 80 characters. */
export function fixedSummary(findings: Finding[], max = 3): string {
  const ordered = [...findings.filter((f) => f.severity === "severe"), ...findings.filter((f) => f.severity !== "severe")];
  const cut = (text: string) => {
    const first = text.trim().split(/(?<=[.!?])\s+/)[0]?.replace(/[.!?]+$/, "").trim() ?? "";
    return first.length > 80 ? `${first.slice(0, 79).trimEnd()}…` : first;
  };
  const top = ordered.slice(0, max).map((f) => cut(f.text)).filter(Boolean);
  const more = ordered.length - top.length;
  if (!top.length) return "";
  return more > 0 ? `${top.join(", ")} and ${more} more` : top.join(", ");
}

// A score shows one decimal when it is exact to one (8.0, 7.5) and two otherwise
// (7.95), so a weighted score never rounds up onto the bar it sits below.
export const fmtScore = (n: number) => {
  const two = n.toFixed(2);
  return two.endsWith("0") ? two.slice(0, -1) : two;
};

export function stateWord(st: ReviewState, latestVersion: number | null, latestScore: number | null): { word: string; tone: "faint" | "neutral" | "success" | "warn" | "error" } {
  const v = latestVersion != null ? `v${latestVersion}` : "draft";
  switch (st.phase) {
    case "questions": return { word: "draft", tone: "faint" };
    case "building": return { word: "working", tone: "neutral" };
    case "gate": return { word: "checking", tone: "neutral" };
    case "fixing": return { word: "fixing", tone: "warn" };
    case "critique": return { word: "in review", tone: "neutral" };
    case "done": return latestScore != null ? { word: `ready · ${fmtScore(latestScore)}`, tone: "success" } : { word: v, tone: "faint" };
    case "below-bar": return { word: "below the bar", tone: "warn" };
    case "stopped": return { word: `stopped · ${v}`, tone: "faint" };
    default: return { word: v, tone: "faint" };
  }
}
