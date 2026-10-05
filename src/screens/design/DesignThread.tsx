/* The design session's thread (board 1, right column): the agent pane's parts in
   the design lane, plus the two cards only this lane has — changes found outside
   the designs folder, and the usage limit. */
import { useEffect, useState } from "react";
import type { ConfirmSpec } from "@/overlays/ConfirmDialog";
import { AgentPane } from "@/screens/agent/AgentPane";
import { agentSessionFor, laneKey, refreshDesignOutside, subscribeAgent } from "@/lib/agent-session";
import { designOutsideUndo } from "@/lib/ipc";
import { limitsReading, subscribeLimits, fmtResetTime } from "@/lib/limits-store";
import { designProjectFor, subscribeDesigns } from "@/lib/design-store";
import { toastError } from "@/overlays/toasts";
import { addReminder, remindersFor, subscribeReminders } from "@/lib/reminders";
import { newTab } from "@/lib/web-store";
import { checkFor, subscribeDoctor } from "@/lib/setup-store";
import { TokenPlanCard } from "./cards/TokenPlanCard";
import { QuestionsCard } from "./cards/QuestionsCard";
import { LintCard } from "./cards/LintCard";
import { CritiqueCard } from "./cards/CritiqueCard";
import { BelowBarCard } from "./cards/BelowBarCard";
import { ReviewToolsCard } from "./cards/ReviewToolsCard";

export function DesignThread({ dir, onConfirm, onRevealTerminal }: {
  dir: string;
  onConfirm: (spec: ConfirmSpec) => void;
  /** AgentPane's sign-in terminal must be on screen */
  onRevealTerminal: () => void;
}) {
  const [, bump] = useState(0);
  useEffect(() => subscribeAgent(() => bump((n) => n + 1)), []);
  useEffect(() => subscribeLimits(() => bump((n) => n + 1)), []);
  useEffect(() => subscribeDesigns(() => bump((n) => n + 1)), []);
  const key = laneKey(dir, "design");
  // the outside list survives an app restart in the ledger, not in memory
  useEffect(() => { void refreshDesignOutside(key); }, [key]);
  const s = agentSessionFor(key);
  // the ledger keys its undo by absolute path; the list shows the relative one.
  // Re-read after every undo: one file put back leaves the others listed.
  // One file at a time, never all at once: the list can include the user's own
  // edits, and each Undo moves the file's current content to the Trash first.
  const undo = (f: string) =>
    designOutsideUndo(dir, s.outsideAbs[f] ?? f)
      .catch((e) => toastError("Couldn't undo it", String(e).slice(0, 90)))
      .finally(() => void refreshDesignOutside(key));
  const limits = limitsReading();
  const p = designProjectFor(dir);
  const latest = p.versions[0]?.n;
  useEffect(() => subscribeReminders(() => bump((n) => n + 1)), []);
  const reminded = !!p.active && remindersFor(dir).some((r) => r.slug === p.active);
  useEffect(() => subscribeDoctor(() => bump((n) => n + 1)), []);
  // the director's cards, after the thread's entries (boards 3, 4, 6, 9)
  const phase = p.review.phase;
  const cards = p.active ? [
    p.tokens && <TokenPlanCard key="tokens" tokens={p.tokens} />,
    p.questions && p.questions.questions.length > 0 && <QuestionsCard key={`questions-${p.active}`} dir={dir} />,
    (p.lint || phase === "gate" || phase === "fixing") && (
      <LintCard key="lint" lint={p.lint} review={p.review} settings={p.settings} kind={p.design?.kind ?? null} />
    ),
    (p.critiques.length > 0 || phase === "critique" || p.critiqueMissing) && <CritiqueCard key="critique" dir={dir} />,
    phase === "below-bar" && <BelowBarCard key="below" dir={dir} />,
    checkFor("design_browser").state === "installing" && <ReviewToolsCard key="tools" />,
  ].filter(Boolean) : [];
  return (
    <div className="flex w-[392px] min-w-[320px] shrink flex-col border-l border-border-hairline bg-surface-panel">
      {s.outside.length > 0 && (
        <div className="mx-3 mt-3 flex flex-col gap-2 rounded-md border border-border-hairline bg-surface-card px-3 py-2.5">
          <span className="text-[12.5px] text-text-primary">Changed while the design session worked</span>
          <span className="text-[11.5px] leading-relaxed text-text-muted">This can include your own edits. Undo moves the current file to the Trash first.</span>
          <ul className="flex flex-col gap-0.5">
            {s.outside.map((f) => (
              <li key={f} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-text-muted">{f}</span>
                <button className="text-[11.5px] text-text-secondary hover:text-text-primary"
                  onClick={() => void undo(f)}>Undo</button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {limits?.status === "rejected" && (
        <div className="mx-3 mt-3 flex flex-col gap-1.5 rounded-md border border-border-hairline bg-surface-card px-3 py-2.5">
          <span className="text-[12.5px] text-text-primary">Your Claude plan’s limit is used up.</span>
          <span className="text-[11.5px] leading-relaxed text-text-muted">
            {limits.resetsAt != null ? `It resets at ${fmtResetTime(limits.resetsAt)}.` : "It resets soon."}
            {latest ? ` Everything up to v${latest} is saved.` : ""} Send your next message then.
          </span>
          <div className="flex items-center gap-3">
            <button className="text-[11.5px] text-text-secondary hover:text-text-primary disabled:opacity-40"
              disabled={limits.resetsAt == null || !p.active || reminded}
              onClick={() => {
                if (limits.resetsAt == null || !p.active) return;
                const title = p.rows.find((r) => r.slug === p.active)?.title ?? p.design?.title ?? p.active;
                void addReminder({ dir, slug: p.active, title, version: latest ?? null, at: limits.resetsAt })
                  .catch((e) => toastError("Couldn't set the reminder", String(e).slice(0, 90)));
              }}>
              {reminded ? "Reminder set" : limits.resetsAt != null ? `Remind me at ${fmtResetTime(limits.resetsAt)}` : "Remind me"}
            </button>
            <button className="text-[11.5px] text-text-secondary hover:text-text-primary"
              onClick={() => {
                void newTab(dir, "https://claude.ai/settings/usage");
                window.dispatchEvent(new CustomEvent("chronicle:show-pane", { detail: "web" }));
              }}>Open plan settings</button>
          </div>
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col">
        <AgentPane dir={key} variant="design" onConfirm={onConfirm} onRevealTerminal={onRevealTerminal} onOpenReview={() => {}}
          trailing={cards.length > 0 ? cards : undefined} />
      </div>
    </div>
  );
}
