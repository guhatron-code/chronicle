/* Board 9's "Critique didn't pass": the best round and why, instead of looping —
   keep it at its score, let the director resolve the blocker, or lower the bar
   for this design (the settings popover listens for the event). */
import { acceptBelowBar, designProjectFor, resolveBlocker } from "@/lib/design-store";
import { blockerOf, fmtScore, type CritiqueRound, type ReviewerId } from "@/lib/design-review-model";
import { BtnPrimary, BtnSecondary } from "@/components/chrome/atoms";
import { toastError } from "@/overlays/toasts";
import { BtnGhost, Card, StateWord } from "./card";

const WHO: Record<ReviewerId, string> = { ux: "The UX director", art: "The art director", a11y: "The accessibility reviewer", copy: "The copy reviewer" };

/** The same blocker the resolve prompt sends (`blockerOf`), phrased for the card. */
function why(critiques: CritiqueRound[]): string | null {
  const b = blockerOf(critiques);
  if (!b) return null;
  const who = b.reviewer ? WHO[b.reviewer] : "The critique";
  if (b.why === "blocker") return b.text;
  return b.why === "repeated" ? `${who} keeps flagging the same thing: ${b.text}` : `${who}’s top finding: ${b.text}`;
}

const run = (p: Promise<unknown>, what: string) => void p.catch((e) => toastError(what, String(e).slice(0, 90)));

export function BelowBarCard({ dir }: { dir: string }) {
  const p = designProjectFor(dir);
  const { review, settings, critiques } = p;
  const best = review.best ?? (critiques.length ? critiques.reduce((a, c) => (c.weighted > a.weighted ? c : a), critiques[0]) : null);
  const bestScore = best ? ("score" in best ? best.score : best.weighted) : null;
  const sentence = why(critiques);
  const n = critiques.length;
  return (
    <Card label="Critique didn’t pass">
      <div className="flex flex-col gap-2.5 px-4 py-3.5">
        <span className="text-[13px] font-semibold text-text-primary">{`Critique didn’t pass after ${n} round${n === 1 ? "" : "s"}`}</span>
        <div className="flex items-center gap-2.5">
          {bestScore != null && <span className="font-mono text-[28px] leading-none text-state-warn">{fmtScore(bestScore)}</span>}
          <div className="flex min-w-0 flex-col gap-0.5">
            <StateWord word={`below the bar of ${fmtScore(settings.bar)}`} tone="warn" />
            <span className="text-[11px] text-text-faint">
              {`best of ${n} round${n === 1 ? "" : "s"}${best ? ` · round ${best.round}` : ""}${n > 0 ? ` · ${critiques.map((c) => fmtScore(c.weighted)).join(" → ")}` : ""}`}
            </span>
          </div>
        </div>
        {sentence && <div className="text-[12px] leading-[1.55] text-text-secondary">{sentence}</div>}
        <div className="flex flex-wrap gap-2">
          <BtnSecondary size="sm" onClick={() => run(acceptBelowBar(dir), "Couldn't keep it")}>
            {bestScore != null ? `Keep it, accept ${fmtScore(bestScore)}` : "Keep it"}
          </BtnSecondary>
          <BtnPrimary size="sm" onClick={() => run(resolveBlocker(dir), "Couldn't send it to the director")}>Let the director resolve it</BtnPrimary>
          <BtnGhost size="sm" onClick={() => window.dispatchEvent(new CustomEvent("chronicle:review-settings", { detail: { scope: "design" } }))}>
            Lower the bar for this design
          </BtnGhost>
        </div>
      </div>
    </Card>
  );
}
