/* Board 9's "Getting the review tools ready": the one-time browser download,
   drawn the way Setup & health's row draws it, while the director keeps writing. */
import { checkFor } from "@/lib/setup-store";
import { Card, ToolRow } from "./card";

const fmtMB = (b?: number) => (b != null ? (b / 1_000_000).toFixed(1) : "0");

export function ReviewToolsCard() {
  const c = checkFor("design_browser");
  if (c.state !== "installing") return null;
  return (
    <Card label="Getting the review tools ready">
      <div className="flex flex-col gap-2.5 px-4 py-3.5">
        <div className="flex flex-col gap-[3px]">
          <span className="text-[13px] font-semibold text-text-primary">Getting the review tools ready</span>
          <span className="text-[11.5px] text-text-faint">first design on this Mac: one-time download</span>
        </div>
        <div className="flex items-center gap-2.5">
          <span className="flex-1 text-[12.5px] text-text-primary">Browser for rendering and screenshots</span>
          {c.totalBytes ? (
            <span className="whitespace-nowrap font-mono text-[11px] tabular-nums text-text-faint">{`${fmtMB(c.gotBytes)} of ${fmtMB(c.totalBytes)} MB`}</span>
          ) : c.pct != null ? (
            <span className="font-mono text-[11px] tabular-nums text-text-faint">{`${c.pct}%`}</span>
          ) : null}
        </div>
        <div className="h-[3px] overflow-hidden rounded-[2px] bg-fill-hover" role="progressbar" aria-label="Browser download"
          aria-valuemin={0} aria-valuemax={100} aria-valuenow={c.pct ?? undefined}>
          <span className="block h-full rounded-[2px] bg-state-neutral" style={{ width: `${c.pct ?? 8}%` }} />
        </div>
        <div className="flex flex-col gap-0.5">
          <ToolRow label="Design skills" detail="ready" state="done" />
          <ToolRow label="Icons" detail="lucide, bundled" state="done" />
          <ToolRow label="Browser" detail="downloading" state="run" />
        </div>
        <span className="text-[11.5px] text-text-muted">The director can start writing now. Review scores use Chronicle’s own pictures until the browser is ready.</span>
      </div>
    </Card>
  );
}
