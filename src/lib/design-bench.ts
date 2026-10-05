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
  judge: (dir: string, brief: Brief, a: string[], b: string[]) => Promise<Verdict>;
  referenceCaptures: (repo: string, briefId: string) => Promise<string[] | null>;
  write: (repo: string, name: string, json: unknown, md: string) => Promise<void>;
  version: string;
  now: () => number;
  /** Pictures of the finished design, for the judge. Without it the judge gets none of ours. */
  capture?: (dir: string, slug: string) => Promise<string[]>;
  /** The design lane's running cost, so each brief records what it spent. */
  cost?: (dir: string) => number | null;
}

export interface BenchBrief {
  id: string; kind: string; title: string;
  phase: ReviewState["phase"]; rounds: number; score: number | null; passed: boolean;
  lint: { severe: number; minor: number } | null;
  seconds: number; cost: number | null;
  /** The blind comparison: which side ours was shown as, and who won. */
  compared: { winner: "chronicle" | "claude-design"; reasons: string[]; chronicleWas: "A" | "B" } | null;
  error?: string;
}
export interface BenchResults {
  version: string; at: string; args: BenchArgs; project: string; bar: number;
  briefs: BenchBrief[];
  summary: { total: number; passed: number; mean: number | null; compared: number; beat: number };
}

export const BENCH_SETTINGS: ReviewSettings = { critique: true, bar: 8, rounds: 3, lint: true };
/** Questions asked again and again past this are left for the loop to stop on. */
const MAX_ANSWERS = 5;

/** The brief's answers for the questions asked: by question id, then by label, else the
 *  first option (a `multi` gets one answer; a text question with nothing to say gets "—"). */
export function answersFor(brief: Brief, q: Questions): Record<string, string | string[]> {
  const given = new Map(brief.answers.map(([k, v]) => [k.trim().toLowerCase(), v]));
  const out: Record<string, string | string[]> = {};
  for (const x of q.questions) {
    const a = given.get(x.id.toLowerCase()) ?? given.get(x.label.trim().toLowerCase()) ?? x.options[0] ?? "—";
    out[x.id] = x.type === "multi" ? [a] : a;
  }
  return out;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const fmt = (n: number | null) => (n == null ? "—" : round1(n).toFixed(1));

function summarise(briefs: BenchBrief[]): BenchResults["summary"] {
  const scores = briefs.flatMap((b) => (b.score == null ? [] : [b.score]));
  const compared = briefs.filter((b) => b.compared);
  return {
    total: briefs.length,
    passed: briefs.filter((b) => b.passed).length,
    mean: scores.length ? round1(scores.reduce((s, x) => s + x, 0) / scores.length) : null,
    compared: compared.length,
    beat: compared.filter((b) => b.compared!.winner === "chronicle").length,
  };
}

export function summaryLine(r: BenchResults): string {
  const s = r.summary;
  return `beat Claude Design on ${s.beat} of ${s.compared} compared briefs; mean score ${fmt(s.mean)}; ${s.passed} of ${s.total} passed the bar`;
}

export function renderMarkdown(r: BenchResults): string {
  const rows = r.briefs.map((b) => {
    const vs = b.compared ? (b.compared.winner === "chronicle" ? "won" : "lost") : "—";
    const lint = b.lint ? `${b.lint.severe} / ${b.lint.minor}` : "—";
    const cost = b.cost == null ? "—" : `$${b.cost.toFixed(2)}`;
    return `| ${b.id} | ${b.kind} | ${fmt(b.score)} | ${b.passed ? "yes" : "no"} | ${b.rounds} | ${lint} | ${Math.round(b.seconds)} s | ${cost} | ${vs} |`;
  });
  const reasons = r.briefs.filter((b) => b.compared).map((b) => `- **${b.id}** (${b.compared!.winner === "chronicle" ? "Chronicle" : "Claude Design"} won): ${b.compared!.reasons.join("; ")}`);
  const errors = r.briefs.filter((b) => b.error).map((b) => `- **${b.id}**: ${b.error}`);
  return [
    `# Design benchmark · ${r.version} · ${r.at}`, "",
    `Chronicle ${summaryLine(r)} (bar ${r.bar.toFixed(1)}).`, "",
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
  const ref = await deps.referenceCaptures(repo, b.id);
  if (ref && ref.length) {
    const ours = deps.capture ? await deps.capture(dir, slug) : [];
    const chronicleWas: "A" | "B" = Math.random() < 0.5 ? "A" : "B";
    const v = chronicleWas === "A" ? await deps.judge(dir, b, ours, ref) : await deps.judge(dir, b, ref, ours);
    out.compared = { winner: v.winner === chronicleWas ? "chronicle" : "claude-design", reasons: v.reasons, chronicleWas };
  }
  return out;
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
