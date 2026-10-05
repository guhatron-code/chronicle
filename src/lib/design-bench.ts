/* The design benchmark: a fixed set of briefs (bench/design/briefs/*.md) runs through the
 * director in a throwaway project, each result is scored by the review loop, and the briefs
 * that have a Claude Design reference are judged blind against it. Pure over `BenchDeps` —
 * App.tsx supplies the real ones, the test supplies fakes. */
import type { DesignProject } from "./design-store";
import type { DesignKind } from "./design-model";
import { questionsPending, type Questions, type ReviewSettings, type ReviewState } from "./design-review-model";

/** One brief as `design_bench_briefs` returns it (`answers` are `[question id or label, answer]`). */
export interface Brief { id: string; kind: string; title: string; brief: string; answers: [string, string][]; quick: boolean }
export type Verdict = { winner: "A" | "B"; reasons: string[] };
export interface BenchArgs { brief?: string; kind?: string; quick?: boolean }

export interface BenchDeps {
  briefs: (repo: string) => Promise<Brief[]>;
  project: () => Promise<string>;
  open: (dir: string) => Promise<void>;
  startDesign: (dir: string, kind: DesignKind, brief: string) => Promise<string>;
  answer: (dir: string, answers: Record<string, string | string[]>, refs: string[]) => Promise<void>;
  /** Resolves on done / below-bar / stopped — and on pending questions, which the runner answers. */
  waitSettled: (dir: string, slug: string) => Promise<ReviewState>;
  state: (dir: string) => DesignProject;
  setSettings: (dir: string, patch: Partial<ReviewSettings>) => Promise<void>;
  /** Judges two picture sets of one brief, blind: A and B are all it is told. */
  judge: (dir: string, brief: Brief, a: string[], b: string[]) => Promise<Verdict>;
  /** Pictures of the brief's Claude Design reference, rendered by the same capture window as
   *  ours: null when the brief has no reference, [] when it didn't render. */
  referenceCaptures: (repo: string, briefId: string) => Promise<string[] | null>;
  write: (repo: string, name: string, json: unknown, md: string) => Promise<void>;
  version: string;
  now: () => number;
  /** Pictures of the finished design, for the judge. Without it the judge gets none of ours. */
  capture?: (dir: string, slug: string) => Promise<string[]>;
  /** The design lane's running cost, so each brief records what it spent. */
  cost?: (dir: string) => number | null;
  /** Which side ours is shown as (< 0.5 → A). Defaults to Math.random. */
  random?: () => number;
}

/** The blind comparison: which side ours was shown as and who won — or why it couldn't run. */
export type Comparison = { winner: "chronicle" | "claude-design"; reasons: string[]; chronicleWas: "A" | "B" } | { error: string };

export interface BenchBrief {
  id: string; kind: string; title: string;
  phase: ReviewState["phase"]; rounds: number; score: number | null; passed: boolean;
  lint: { severe: number; minor: number } | null;
  seconds: number; cost: number | null;
  compared: Comparison | null;
  error?: string;
}
export interface BenchResults {
  version: string; at: string; args: BenchArgs; project: string; bar: number;
  briefs: BenchBrief[];
  summary: { total: number; passed: number; mean: number | null; compared: number; beat: number };
}

export const BENCH_SETTINGS: ReviewSettings = { critique: true, bar: 8, rounds: 3, lint: true };
/** Questions asked again and again past this are left for the loop to stop on. */
export const MAX_ANSWERS = 5;
const NO_PREFERENCE = "No preference, decide for me.";

const words = (s: string) => s.toLowerCase().replace(/[-_]/g, " ");
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The brief's answers for the questions asked: by question id, then by label, then by an
 *  answer key that is a whole word of the id or the label (case-insensitive); else the first
 *  option, or "No preference, decide for me." for a text question. A `multi` gets one answer. */
export function answersFor(brief: Brief, q: Questions): Record<string, string | string[]> {
  const given = brief.answers.map(([k, v]) => [k.trim().toLowerCase(), v] as const).filter(([k]) => k);
  const exact = new Map(given);
  const out: Record<string, string | string[]> = {};
  for (const x of q.questions) {
    const haystack = `${words(x.id)} ${words(x.label)}`;
    const a = exact.get(x.id.toLowerCase()) ?? exact.get(x.label.trim().toLowerCase())
      ?? given.find(([k]) => new RegExp(`\\b${escape(words(k))}\\b`).test(haystack))?.[1]
      ?? (x.type === "text" ? NO_PREFERENCE : x.options[0] ?? NO_PREFERENCE);
    out[x.id] = x.type === "multi" ? [a] : a;
  }
  return out;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const fmt = (n: number | null) => (n == null ? "—" : round1(n).toFixed(1));

function summarise(briefs: BenchBrief[]): BenchResults["summary"] {
  const scores = briefs.flatMap((b) => (b.score == null ? [] : [b.score]));
  const compared = briefs.flatMap((b) => (b.compared && "winner" in b.compared ? [b.compared] : []));
  return {
    total: briefs.length,
    passed: briefs.filter((b) => b.passed).length,
    mean: scores.length ? round1(scores.reduce((s, x) => s + x, 0) / scores.length) : null,
    compared: compared.length,
    beat: compared.filter((c) => c.winner === "chronicle").length,
  };
}

export function summaryLine(r: BenchResults): string {
  const s = r.summary;
  return `beat Claude Design on ${s.beat} of ${s.compared} compared briefs; mean score ${fmt(s.mean)}; ${s.passed} of ${s.total} passed the bar`;
}

export function renderMarkdown(r: BenchResults): string {
  const rows = r.briefs.map((b) => {
    const c = b.compared;
    const vs = !c ? "—" : "error" in c ? "couldn't compare" : c.winner === "chronicle" ? "won" : "lost";
    const lint = b.lint ? `${b.lint.severe} / ${b.lint.minor}` : "—";
    const cost = b.cost == null ? "—" : `$${b.cost.toFixed(2)}`;
    return `| ${b.id} | ${b.kind} | ${fmt(b.score)} | ${b.passed ? "yes" : "no"} | ${b.rounds} | ${lint} | ${Math.round(b.seconds)} s | ${cost} | ${vs} |`;
  });
  const reasons = r.briefs.flatMap((b) => (b.compared && "winner" in b.compared ? [`- **${b.id}** (${b.compared.winner === "chronicle" ? "Chronicle" : "Claude Design"} won): ${b.compared.reasons.join("; ")}`] : []));
  const errors = r.briefs.flatMap((b) => [
    ...(b.error ? [`- **${b.id}**: ${b.error}`] : []),
    ...(b.compared && "error" in b.compared ? [`- **${b.id}** (comparison): ${b.compared.error}`] : []),
  ]);
  return [
    `# Design benchmark · ${r.version} · ${r.at}`, "",
    `Chronicle ${summaryLine(r)} (bar ${r.bar.toFixed(1)}).`, "",
    "Method: both sides were rendered by Chronicle's capture window and compared blind under neutral names (A and B, assigned at random per brief); the judge never saw where a picture came from.", "",
    "| Brief | Kind | Score | Passed | Rounds | Lint severe / minor | Time | Cost | vs Claude Design |",
    "|---|---|---|---|---|---|---|---|---|",
    ...rows,
    ...(reasons.length ? ["", "## The judge's reasons", "", ...reasons] : []),
    ...(errors.length ? ["", "## Errors", "", ...errors] : []),
    "",
  ].join("\n");
}

async function runOne(deps: BenchDeps, repo: string, dir: string, b: Brief): Promise<BenchBrief> {
  const started = deps.now();
  const costBefore = deps.cost?.(dir) ?? null;
  const base = { id: b.id, kind: b.kind, title: b.title };
  const slug = await deps.startDesign(dir, b.kind as DesignKind, b.brief);
  let st = await deps.waitSettled(dir, slug);
  for (let n = 0; n < MAX_ANSWERS && st.phase === "questions"; n++) {
    const q = deps.state(dir).questions;
    if (!questionsPending(q)) break;
    await deps.answer(dir, answersFor(b, q!), []);
    st = await deps.waitSettled(dir, slug);
  }
  const p = deps.state(dir);
  const score = st.best?.score ?? null;
  const costAfter = deps.cost?.(dir) ?? null;
  const out: BenchBrief = {
    ...base, phase: st.phase, rounds: st.round, score,
    passed: st.phase === "done" && score != null && score >= BENCH_SETTINGS.bar,
    lint: p.lint ? { severe: p.lint.severe.length, minor: p.lint.minor.length } : null,
    seconds: (deps.now() - started) / 1000,
    // the lane's cost is a running total; a lane that restarted mid-brief starts again from zero
    cost: costAfter == null ? null : round2(costBefore != null && costAfter >= costBefore ? costAfter - costBefore : costAfter),
    compared: null,
  };
  out.compared = await compare(deps, repo, dir, slug, b);
  return out;
}

/** The blind comparison for one brief. A failure here is the comparison's, never the brief's:
 *  the scored result stands and the comparison records why it couldn't run. */
async function compare(deps: BenchDeps, repo: string, dir: string, slug: string, b: Brief): Promise<Comparison | null> {
  try {
    const ref = await deps.referenceCaptures(repo, b.id);
    if (ref == null) return null;
    if (ref.length === 0) return { error: "reference didn't render" };
    const ours = deps.capture ? await deps.capture(dir, slug) : [];
    if (deps.capture && ours.length === 0) return { error: "our design didn't render" };
    const chronicleWas: "A" | "B" = (deps.random ?? Math.random)() < 0.5 ? "A" : "B";
    const v = chronicleWas === "A" ? await deps.judge(dir, b, ours, ref) : await deps.judge(dir, b, ref, ours);
    return { winner: v.winner === chronicleWas ? "chronicle" : "claude-design", reasons: v.reasons, chronicleWas };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Runs the briefs `args` picks, one after another, in a fresh throwaway project; writes
 *  `bench/design/results/<version>-<time>.json` and `.md` into the repo. A brief that fails
 *  is recorded with its error and the run goes on. */
export async function runDesignBench(deps: BenchDeps, repoDir: string, args: BenchArgs): Promise<BenchResults> {
  const all = await deps.briefs(repoDir);
  const picked = all.filter((b) => (!args.brief || b.id === args.brief) && (!args.kind || b.kind === args.kind) && (!args.quick || b.quick));
  if (picked.length === 0) throw new Error("No benchmark brief matches that.");
  const at = new Date(deps.now()).toISOString();
  const dir = await deps.project();
  await deps.open(dir);
  await deps.setSettings(dir, BENCH_SETTINGS);
  const briefs: BenchBrief[] = [];
  for (const b of picked) {
    const started = deps.now();
    try {
      briefs.push(await runOne(deps, repoDir, dir, b));
    } catch (e) {
      briefs.push({
        id: b.id, kind: b.kind, title: b.title, phase: "stopped", rounds: 0, score: null, passed: false, lint: null,
        seconds: (deps.now() - started) / 1000, cost: null, compared: null, error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  const results: BenchResults = { version: deps.version, at, args, project: dir, bar: BENCH_SETTINGS.bar, briefs, summary: summarise(briefs) };
  const name = `${deps.version}-${at.slice(0, 19).replace(/:/g, "-")}`;
  await deps.write(repoDir, name, results, renderMarkdown(results));
  return results;
}
