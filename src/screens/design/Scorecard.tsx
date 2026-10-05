/* The scorecard (comps board 6, `b_scorecard`): the newest critique round's weighted
   score, the rounds so far, each reviewer's verdict, and the lint findings, in the
   right column in place of the thread. A finding row pins that finding on the canvas
   (and selects its frame); Fix sends it to the design session. */
import { useEffect, useState } from "react";
import { BtnSecondary } from "@/components/chrome/atoms";
import { XGlyph } from "@/components/chrome/icons";
import { askAnotherRound, designProjectFor, fixAllMinor, fixFinding, setPin, subscribeDesigns } from "@/lib/design-store";
import { fmtScore, REVIEWERS, type Finding } from "@/lib/design-review-model";
import { toastError } from "@/overlays/toasts";
import { cn } from "@/lib/utils";
import { BtnGhost, Dot, Eyebrow, StateWord } from "./cards/card";

const WEIGHTS = "weighted: art 0.3 · UX 0.35 · a11y 0.2 · copy 0.15";

/** "4 min 10 s", "38 s"; null when either end is unknown. */
function span(startMs: number | null, endIso: string | undefined): string | null {
  const end = endIso ? Date.parse(endIso) : NaN;
  if (startMs == null || !Number.isFinite(end)) return null;
  const secs = Math.max(0, Math.round((end - startMs) / 1000));
  return secs < 60 ? `${secs} s` : `${Math.floor(secs / 60)} min ${secs % 60} s`;
}

const sameFinding = (a: { frame: string; selector: string; text: string } | null, f: Finding) =>
  !!a && a.text === f.text && a.frame === f.frame && a.selector === (f.selector ?? "");

export function Scorecard({ dir, onClose }: { dir: string; onClose: () => void }) {
  const [, bump] = useState(0);
  useEffect(() => subscribeDesigns(() => bump((n) => n + 1)), []);
  const p = designProjectFor(dir);
  const last = p.critiques.at(-1);
  const send = (job: Promise<void>, what: string) => job.catch((e) => toastError(what, String((e as Error)?.message ?? e).slice(0, 90)));

  const findings = [...(p.lint?.severe ?? []), ...(p.lint?.minor ?? [])];
  const minorCount = p.lint?.minor.length ?? 0;
  const first = p.critiques[0];
  const took = span(p.review.startedAt, last?.at);
  const roundsLine = last && p.critiques.length > 1 && first
    ? `${fmtScore(first.weighted)} → ${fmtScore(last.weighted)} in ${p.critiques.length} rounds${took ? ` · ${took}` : ""}`
    : took;

  const pick = (f: Finding) => {
    setPin(dir, f.selector ? { frame: f.frame, selector: f.selector, text: f.text } : null);
    if (f.frame) window.dispatchEvent(new CustomEvent("chronicle:select-frame", { detail: f.frame }));
  };

  return (
    <section aria-label="Scorecard" className="flex w-[392px] shrink-0 flex-col border-l border-border-hairline bg-surface-panel">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border-hairline py-0 pr-3 pl-4">
        <h2 className="text-[12.5px] font-semibold text-text-primary">Scorecard</h2>
        <span className="text-[11.5px] text-text-faint">all frames{last ? ` · round ${last.round}` : ""}</span>
        <span className="flex-1" />
        <button
          type="button"
          aria-label="Close scorecard"
          onClick={onClose}
          className="flex size-6 items-center justify-center rounded-md text-text-faint outline-none hover:bg-fill-hover hover:text-text-primary focus-visible:[box-shadow:var(--focus-ring)]"
        >
          <XGlyph size={9} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {!last ? (
          <p className="px-4 py-3.5 text-[11.5px] leading-relaxed text-text-faint">No critique yet. The scorecard fills in when the reviewers finish a round.</p>
        ) : (
          <>
            <div className="flex items-end gap-3.5 p-4">
              <span className="font-mono text-[44px] leading-none tracking-[-0.02em] text-text-primary">{fmtScore(last.weighted)}</span>
              <div className="flex flex-col gap-1 pb-1">
                <StateWord tone={last.passed ? "success" : "warn"} word={last.passed ? `passed · bar is ${fmtScore(last.bar)}` : `below the bar of ${fmtScore(last.bar)}`} />
                <span className="text-[11px] text-text-faint">{WEIGHTS}</span>
              </div>
            </div>
            <div className="flex items-end gap-1.5 px-4 pb-3">
              {p.critiques.map((c) => (
                <div key={c.round} className="flex flex-col items-center gap-[3px]" title={`round ${c.round}: ${fmtScore(c.weighted)}`}>
                  <span className={cn("w-[18px] rounded-[2px]", c.passed ? "bg-state-success" : "bg-fill-hover")} style={{ height: Math.max(2, Math.round((c.weighted - 6) * 14)) }} />
                  <span className="font-mono text-[9px] text-text-faint">r{c.round}</span>
                </div>
              ))}
              {roundsLine && <span className="mb-3 ml-1.5 text-[11px] text-text-faint">{roundsLine}</span>}
            </div>
            {REVIEWERS.map((r) => {
              const res = last.reviewers.find((x) => x.id === r.id);
              if (!res) return null;
              const tone = res.score >= last.bar ? "success" : "warn";
              return (
                <div key={r.id} className="border-t border-divider px-4 py-3">
                  <div className="flex items-center gap-2">
                    <h3 className="text-[13px] font-semibold text-text-primary">{r.name}</h3>
                    <span className="flex-1 truncate text-[11px] text-text-faint">{r.focus}</span>
                    <span className={cn("font-mono text-[15px]", tone === "success" ? "text-state-success" : "text-state-warn")}>{fmtScore(res.score)}</span>
                  </div>
                  <div className="my-2 h-[3px] rounded-[2px] bg-fill-hover" aria-hidden="true">
                    <span className={cn("block h-full rounded-[2px]", tone === "success" ? "bg-state-success" : "bg-state-warn")} style={{ width: `${Math.round(res.score * 10)}%` }} />
                  </div>
                  {res.notes.length > 0 && (
                    <ul className="m-0 list-disc pl-4">
                      {res.notes.map((n, i) => <li key={i} className="mb-1 text-[12px] leading-normal text-text-secondary">{n}</li>)}
                    </ul>
                  )}
                </div>
              );
            })}
          </>
        )}
        <div className="flex items-center gap-2 border-t border-divider px-4 pt-3 pb-1.5">
          <Eyebrow>Lint findings</Eyebrow>
          <span className="flex-1" />
          <span className="font-mono text-[10.5px] text-text-faint">{p.lint?.severe.length ?? 0} severe · {minorCount} minor</span>
        </div>
        {findings.length === 0 && <p className="px-4 pb-3 text-[11.5px] text-text-faint">{p.lint ? "Nothing to fix." : "No lint report yet."}</p>}
        {findings.map((f, i) => (
          <div key={i} className={cn("flex items-start gap-2 py-2 pr-4 pl-4", sameFinding(p.pin, f) && "bg-fill-hover")}>
            <button type="button" onClick={() => pick(f)} aria-pressed={sameFinding(p.pin, f)} className="flex min-w-0 flex-1 items-start gap-2 text-left outline-none focus-visible:[box-shadow:var(--focus-ring)]">
              <span className="mt-1"><Dot tone={f.severity === "severe" ? "error" : "warn"} /></span>
              <span className="min-w-0 flex-1">
                <span className="block text-[12px] text-text-primary">{f.text}</span>
                <span className="block truncate font-mono text-[10.5px] text-text-faint">{f.severity} · {f.file || f.frame}{f.line != null ? `:${f.line}` : ""}</span>
              </span>
            </button>
            <button type="button" aria-label={`Fix: ${f.text}`} onClick={() => void send(fixFinding(dir, f), "Couldn't send that fix")} className="shrink-0 rounded-md px-1.5 py-0.5 text-[11px] text-text-secondary outline-none hover:bg-fill-hover hover:text-text-primary focus-visible:[box-shadow:var(--focus-ring)]">Fix</button>
          </div>
        ))}
      </div>
      <div className="flex gap-2 border-t border-border-hairline px-4 py-3">
        <BtnSecondary size="md" disabled={minorCount === 0} onClick={() => void send(fixAllMinor(dir), "Couldn't send those fixes")}>Fix all minor</BtnSecondary>
        <BtnGhost size="md" onClick={() => void send(askAnotherRound(dir), "Couldn't ask for another round")}>Ask for round {(last?.round ?? p.review.round) + 1}</BtnGhost>
      </div>
    </section>
  );
}
