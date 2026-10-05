/* Boards 4 and 6: the critique panel. While a round is out, each reviewer's row
   follows its subagent in the thread; once the round file is in, each shows its
   score and a 3 px bar. The footer says what the previous round scored and what
   it fixed, and opens the scorecard. */
import { agentSessionFor, groupEntries, laneKey } from "@/lib/agent-session";
import { askAnotherRound, designProjectFor, dismissCritiqueMissing, setScoreOpen } from "@/lib/design-store";
import { fmtScore, REVIEWERS, type CritiqueRound, type ReviewerId } from "@/lib/design-review-model";
import { toastError } from "@/overlays/toasts";
import { cn } from "@/lib/utils";
import { BtnGhost, Card, CardHead, Dot, RingSpinner, ScoreChip, StateWord } from "./card";
import { BtnSecondary } from "@/components/chrome/atoms";
import { CheckGlyph } from "@/components/chrome/icons";

/** the bundled reviewers' subagent names (design-prompts' critique prompt) */
const AGENT: Record<ReviewerId, string> = { ux: "ux-director", art: "art-director", a11y: "accessibility", copy: "copy" };
type Live = "queued" | "reviewing" | "done" | "failed";

/** Each reviewer's subagent in the current turn (after the last message sent). */
function liveStates(dir: string): Record<ReviewerId, Live> {
  const entries = agentSessionFor(laneKey(dir, "design")).entries;
  let from = 0;
  for (let i = entries.length - 1; i >= 0; i--) if (entries[i].kind === "user") { from = i + 1; break; }
  const subs = groupEntries(entries.slice(from)).flatMap((x) => (x.kind === "subagent" ? [x.tool] : []));
  const out = {} as Record<ReviewerId, Live>;
  for (const r of REVIEWERS) {
    const t = [...subs].reverse().find((s) => s.title.toLowerCase().includes(AGENT[r.id]));
    out[r.id] = !t ? "queued" : t.status === "completed" ? "done" : t.status === "failed" ? "failed" : "reviewing";
  }
  return out;
}

/** "Round 1 scored 7.6. Fixed: a, b." — the previous round's top findings. */
function previousLine(prev: CritiqueRound): string {
  const all = prev.reviewers.flatMap((r) => r.findings);
  const top = [...all.filter((f) => f.severity === "severe"), ...all.filter((f) => f.severity === "minor")]
    .slice(0, 2).map((f) => f.text.trim().replace(/[.!]$/, ""));
  return `Round ${prev.round} scored ${fmtScore(prev.weighted)}.${top.length ? ` Fixed: ${top.join(", ")}.` : ""}`;
}

const run = (p: Promise<unknown>, what: string) => void p.catch((e) => toastError(what, String(e).slice(0, 90)));

export function CritiqueCard({ dir }: { dir: string }) {
  const p = designProjectFor(dir);
  const { review, settings, critiques } = p;
  const pending = review.phase === "critique" && !critiques.some((c) => c.round === review.round);
  const shown = pending ? null : critiques.at(-1) ?? null;
  const roundNo = pending ? review.round : shown?.round ?? review.round;
  const prev = critiques.filter((c) => c.round < roundNo).at(-1) ?? null;
  const live = pending ? liveStates(dir) : null;

  const head = p.critiqueMissing ? (
    <StateWord word="waiting" tone="warn" />
  ) : (
    <>
      {roundNo > 0 && <span className="whitespace-nowrap font-mono text-[11px] text-text-faint">{`round ${roundNo} of ${settings.rounds}`}</span>}
      {shown && <ScoreChip value={`${fmtScore(shown.weighted)} / pass ${fmtScore(shown.bar)}`} passed={shown.passed} />}
    </>
  );

  return (
    <Card label="Critique panel">
      <CardHead title="Critique panel">{head}</CardHead>
      {p.critiqueMissing ? (
        <div className="flex items-center gap-2 px-3 py-2.5">
          <span className="flex-1 text-[12px] text-text-secondary">The critique didn’t come back.</span>
          <BtnGhost size="sm" onClick={() => dismissCritiqueMissing(dir)}>Dismiss</BtnGhost>
          <BtnSecondary size="sm" onClick={() => run(askAnotherRound(dir), "Couldn't ask again")}>Ask again</BtnSecondary>
        </div>
      ) : (
        <div className="py-[3px]">
          {REVIEWERS.map((r) => {
            const res = shown?.reviewers.find((x) => x.id === r.id);
            return (
              <div key={r.id} className="px-3 py-[7px]">
                <div className="flex items-center gap-2">
                  <span aria-hidden className="-mt-1.5 size-3 shrink-0 border-b border-l border-border-strong" />
                  <span className="whitespace-nowrap text-[12px] text-text-primary">{r.name}</span>
                  <span className="min-w-0 flex-1 truncate text-[11px] text-text-faint">{r.focus}</span>
                  {live ? <LiveWord state={live[r.id]} />
                    : res ? <ScoreChip value={fmtScore(res.score)} passed={res.score >= (shown?.bar ?? settings.bar)} />
                    : shown ? <span className="text-[11px] text-text-faint">no score</span> : null}
                </div>
                {res && (
                  <div className="ml-5 mt-1 h-[3px] rounded-[2px] bg-fill-hover">
                    <span className={cn("block h-full rounded-[2px]", res.score >= (shown?.bar ?? settings.bar) ? "bg-state-success" : "bg-state-warn")}
                      style={{ width: `${Math.round(res.score * 10)}%` }} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {!p.critiqueMissing && shown && (
        <div className="flex items-center gap-2 border-t border-divider px-3 py-[9px]">
          <span className="flex-1 text-[11.5px] text-text-muted">{prev ? previousLine(prev) : ""}</span>
          <button type="button" onClick={() => setScoreOpen(dir, true)}
            className="whitespace-nowrap rounded-sm text-[11.5px] text-text-secondary outline-none hover:text-text-primary focus-visible:[box-shadow:var(--focus-ring)]">
            Open scorecard
          </button>
        </div>
      )}
    </Card>
  );
}

function LiveWord({ state }: { state: Live }) {
  if (state === "done") return <span className="flex text-state-success" aria-label="reviewed"><CheckGlyph size={11} /></span>;
  if (state === "reviewing") return <span className="inline-flex items-center gap-[5px] text-[11px] text-state-neutral"><RingSpinner />reviewing</span>;
  if (state === "failed") return <span className="text-[11px] text-state-error">didn’t finish</span>;
  return <span className="inline-flex items-center gap-[5px] text-[11px] text-text-faint"><Dot tone="neutral" />queued</span>;
}
