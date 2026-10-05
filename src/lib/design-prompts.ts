/* Every message the review loop sends, as fixed strings. Bodies only: the store adds the design prefix. */
import { REVIEWERS, fmtScore } from "./design-review-model";
import type { CritiqueRound, Finding, LintReport, Questions } from "./design-review-model";

const ONE_SENTENCE = "Say what you changed in one sentence.";
const where = (f: Finding) => (f.line != null ? `${f.file}:${f.line}` : f.file);

/** The shared line: `- <frame> · <file>[:<line>][ · <selector>] — <text>`. */
export function findingLine(f: Finding): string {
  return `- ${f.frame} · ${where(f)}${f.selector ? ` · ${f.selector}` : ""} — ${f.text}`;
}

export function answersMessage(q: Questions, answers: Record<string, string | string[]>, references: string[]): string {
  const lines = ["Answers to your questions:"];
  for (const question of q.questions) {
    const a = answers[question.id];
    const text = Array.isArray(a) ? a.join(", ") : a;
    lines.push(`- ${question.label}: ${text ? text : "(no answer)"}`);
  }
  if (references.length > 0) {
    lines.push("References, in this design's refs/ folder:", ...references.map((r) => `- ${r}`));
  }
  lines.push("Go ahead.");
  return lines.join("\n");
}

export const skipMessage = () => "Skip the questions. Decide, and say what you assumed.";

export function lintFixPrompt(report: LintReport, pass: number, maxPasses: number): string {
  return [`Lint fix pass ${pass} of ${maxPasses}. Fix these and change nothing else:`, ...report.severe.map(findingLine), ONE_SENTENCE].join("\n");
}

const CRITIQUE_SHAPE = '{"v":1,"round":<round>,"version":<version>,"reviewers":[{"id":"ux"|"art"|"a11y"|"copy","score":<0-10>,"notes":["…"],"findings":[{"severity":"severe"|"minor","text":"…","frame":"<frame id>","selector":"<css>"}]}],"blocker":null|"<one sentence>"}';

export function critiquePrompt(round: number, maxRounds: number, bar: number, version: number | null, captures: string[]): string {
  const v = version == null ? "null" : String(version);
  const shape = CRITIQUE_SHAPE.replace("<round>", String(round)).replace("<version>", v);
  return [
    `Critique round ${round} of ${maxRounds}. The bar is ${fmtScore(bar)}. ${version == null ? "No version is saved yet" : `Version v${version} is what to review`} (use "version": ${v}).`,
    `Run the four bundled reviewers in parallel as subagents: art-director, ux-director, accessibility, copy. Give each one ONLY: the frame files under frames/, these captures:\n${captures.join("\n")}\nthe brief and the answers in questions.json if any, the design's kind, tokens.json, and the design system if this project has one — never your own reasoning or plan. Start each subagent's description with its reviewer name, for example \`ux-director: review v6\`.`,
    `Then write critique/round-${round}.json exactly in this shape: ${shape}`,
    `Set "blocker" only when a finding repeats from the previous round and traces to what the brief asked for; otherwise null. Change no other file in this turn. End with one sentence.`,
  ].join("\n");
}

export function critiqueFixPrompt(c: CritiqueRound, maxFindings = 8): string {
  const all = c.reviewers.flatMap((r) => {
    const name = REVIEWERS.find((x) => x.id === r.id)?.name ?? r.id;
    return r.findings.map((f) => ({ f, name }));
  });
  const ordered = [...all.filter((x) => x.f.severity === "severe"), ...all.filter((x) => x.f.severity !== "severe")].slice(0, maxFindings);
  const lines = ordered.map(({ f, name }) => `- ${name} · ${f.frame}${f.selector ? ` · ${f.selector}` : ""} — ${f.text}`);
  return [`Round ${c.round} scored ${fmtScore(c.weighted)} against ${fmtScore(c.bar)}. Fix these, most important first, and change nothing else:`, ...lines, ONE_SENTENCE].join("\n");
}

export const resolveBlockerPrompt = (blocker: string) =>
  `The critique keeps stalling on this: ${blocker}. Resolve it — you may change what the brief asked for to do so — and say in one sentence what you decided.`;

export const fixFindingPrompt = (f: Finding) => ["Fix this and change nothing else:", findingLine(f), ONE_SENTENCE].join("\n");

export const fixAllMinorPrompt = (findings: Finding[]) => ["Fix these minor findings and change nothing else:", ...findings.map(findingLine), ONE_SENTENCE].join("\n");

export const continuePrompt = () => "Continue where you stopped.";
