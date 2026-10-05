/* Board 4's bottom-centre pill: what the review loop is doing right now, how long the
   attempt has run, and Stop. Shown only while the loop is checking, fixing or out for
   critique; the clock ticks through the scheduler only while it shows. */
import { useEffect, useState } from "react";
import { agentSessionFor, groupEntries, laneKey, subscribeAgent } from "@/lib/agent-session";
import { MAX_LINT_PASSES } from "@/lib/design-loop";
import { designProjectFor, reviewElapsed, stopReview, type DesignProject } from "@/lib/design-store";
import { REVIEWERS, reviewerForTitle, type ReviewerId } from "@/lib/design-review-model";
import { every } from "@/lib/scheduler";
import { toastError } from "@/overlays/toasts";

const SHOWN = new Set(["gate", "fixing", "critique"]);

/** Reviewers whose subagent card has completed in the current turn (after the last message sent). */
function reviewersIn(dir: string): number {
  const entries = agentSessionFor(laneKey(dir, "design")).entries;
  let from = 0;
  for (let i = entries.length - 1; i >= 0; i--) if (entries[i].kind === "user") { from = i + 1; break; }
  const done = new Set<ReviewerId>();
  for (const x of groupEntries(entries.slice(from))) {
    if (x.kind !== "subagent" || x.tool.status !== "completed") continue;
    const id = reviewerForTitle(x.tool.title);
    if (id) done.add(id);
  }
  return done.size;
}

function words(dir: string, p: DesignProject): string {
  const { phase, round, fixPass } = p.review;
  if (phase === "gate") return "Checking…";
  if (phase === "fixing") {
    const severe = p.lint?.severe.length ?? 0;
    return `Fixing${severe ? ` ${severe} severe` : ""} · pass ${fixPass} of ${MAX_LINT_PASSES}`;
  }
  return `Critique round ${round} · ${reviewersIn(dir)} of ${REVIEWERS.length} reviewers in`;
}

export function ReviewPill({ dir }: { dir: string }) {
  const p = designProjectFor(dir);
  // a critique that never came back leaves the phase on "critique" with nothing running
  const running = SHOWN.has(p.review.phase) && !p.critiqueMissing;
  const [now, setNow] = useState(() => Date.now());
  const [, bump] = useState(0);
  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const stopClock = every(1000, () => setNow(Date.now()));
    const unAgent = subscribeAgent(() => bump((n) => n + 1));
    return () => { stopClock(); unAgent(); };
  }, [running]);
  if (!running) return null;

  const stop = () => void stopReview(dir).catch((e) => toastError("Couldn't stop the review", String(e?.message ?? e).slice(0, 90)));
  return (
    <div
      aria-label="Review"
      className="absolute bottom-[14px] left-1/2 z-10 flex h-8 -translate-x-1/2 items-center gap-2.5 whitespace-nowrap rounded-2xl border border-border-hairline bg-surface-overlay px-3 shadow-[var(--shadow-overlay)]"
    >
      <span aria-hidden className="size-[5px] shrink-0 rounded-full bg-state-neutral" style={{ animation: "wv-pulse 1.6s ease-in-out infinite" }} />
      <span className="text-[12px] text-text-secondary">{words(dir, p)}</span>
      <span className="font-mono text-[10.5px] text-text-faint">{reviewElapsed(p, now)}</span>
      <button type="button" onClick={stop} className="text-[11.5px] text-text-muted hover:text-text-primary focus-visible:text-text-primary focus-visible:outline-none">
        Stop
      </button>
    </div>
  );
}
