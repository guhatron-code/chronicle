/* Boards 4 and 6: the lint gate on the newest version — passed with its counts,
   checking while the gate runs, the fix pass while the director fixes, off, or
   why it couldn't run. Each row reads its findings by rule prefix. */
import type { DesignKind } from "@/lib/design-model";
import type { Finding, LintReport, ReviewSettings, ReviewState } from "@/lib/design-review-model";
import { MAX_LINT_PASSES } from "@/lib/design-loop";
import { Card, CardHead, StateWord, ToolRow, type RowState } from "./card";

type Row = { label: string; detail: string; match: (f: Finding) => boolean };
const isShop = (f: Finding) => f.rule.startsWith("audit:ecom-");
const ROWS: Row[] = [
  { label: "Anti-pattern detector", detail: "impeccable", match: (f) => f.rule.startsWith("impeccable:") },
  { label: "Contrast + touch targets", detail: "all ≥ 4.5:1 · ≥ 44 px", match: (f) => f.rule.startsWith("audit") && !isShop(f) },
];
const SHOP: Row = { label: "Shopping rules", detail: "price, delivery, returns above the fold", match: isShop };

export function LintCard({ lint, review, settings, kind }: {
  lint: LintReport | null; review: ReviewState; settings: ReviewSettings; kind: DesignKind | null;
}) {
  const rows = kind === "ecommerce" ? [...ROWS, SHOP] : ROWS;
  const severe = lint?.severe ?? [];
  const minor = lint?.minor ?? [];

  let head;
  let body: { label: string; detail: string; state: RowState }[] = [];
  if (!settings.lint) {
    head = <span className="text-[11.5px] text-text-faint">Lint gate off</span>;
  } else if (review.phase === "gate") {
    head = <StateWord word="checking" tone="neutral" />;
    body = rows.map((r) => ({ label: r.label, detail: r.detail, state: "run" }));
  } else if (lint && !lint.ran) {
    head = <StateWord word={`couldn't run · ${lint.problem ?? "unknown problem"}`} tone="error" />;
  } else if (review.phase === "fixing") {
    head = <StateWord word={`fixing ${severe.length} severe`} tone="warn" />;
    body = rows.flatMap((r) => {
      const f = severe.find(r.match);
      return f ? [{ label: r.label, detail: f.text, state: "fail" as const }] : [];
    });
    body.push({ label: `Fix pass ${Math.max(1, review.fixPass)} of ${MAX_LINT_PASSES}`, detail: severe[0]?.file ?? "", state: "run" });
  } else if (lint) {
    head = (
      <>
        {severe.length === 0
          ? <StateWord word="passed" tone="success" />
          : <StateWord word={`${severe.length} severe left`} tone="warn" />}
        <span className="whitespace-nowrap font-mono text-[10.5px] text-text-faint">{`${severe.length} severe · ${minor.length} minor`}</span>
      </>
    );
    body = rows.map((r) => {
      const s = severe.find(r.match);
      const m = minor.filter(r.match).length;
      if (s) return { label: r.label, detail: s.text, state: "fail" };
      return { label: r.label, detail: m > 0 ? `${m} minor` : r.detail, state: "done" };
    });
  } else {
    head = <span className="text-[11.5px] text-text-faint">no report yet</span>;
  }

  return (
    <Card label="Lint gate">
      <CardHead title="Lint gate" divider={body.length > 0}>{head}</CardHead>
      {body.length > 0 && (
        <div className="py-1">
          {body.map((r, i) => <ToolRow key={`${r.label}-${i}`} label={r.label} detail={r.detail} state={r.state} />)}
        </div>
      )}
    </Card>
  );
}
