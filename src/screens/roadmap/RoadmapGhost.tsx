/*
 * The roadmap's own shape, ghosted in before (and while) it is written: three placeholder
 * phases and one placeholder "needs you" row. Pure presentational; no data. Spacing and
 * type scale mirror PhaseRail / NeedsYou so the real thing lands where the ghost sat.
 */
import { cn } from "@/lib/utils";

function Bar({ w, h = 14, className }: { w: string; h?: number; className?: string }) {
  return <span className={cn("block rounded-[4px] bg-fill-subtle", className)} style={{ width: w, height: h }} />;
}

function PhaseGhost({ n, name, note, current }: { n: string; name: string; note: string; current?: boolean }) {
  return (
    <div
      className={cn(
        "flex flex-1 flex-col gap-2 rounded-[10px] px-3.5 py-3",
        current
          ? "border border-border-strong bg-surface-card"
          : "border border-dashed border-border-hairline opacity-60",
      )}
    >
      <span className="font-mono text-[10.5px] text-text-faint">{n}</span>
      <span className={cn("text-[13px] font-medium", current ? "text-text-secondary" : "text-text-dim")}>{name}</span>
      <span className="text-[11.5px] text-text-dim">{note}</span>
    </div>
  );
}

export function RoadmapGhost({ writing = false, className }: { writing?: boolean; className?: string }) {
  return (
    <div aria-hidden className={cn("flex flex-col gap-[34px] pt-2", className)}>
      <div className="flex flex-col gap-2.5">
        <div className="flex items-baseline gap-2.5">
          <span className="text-[15px] font-semibold text-text-primary">Phases</span>
          <span className="text-[11.5px] text-text-faint">{writing ? "being written" : "as the roadmap finds them"}</span>
        </div>
        <div className="flex gap-2.5">
          <PhaseGhost n="1" name="First phase" note="up next, once the roadmap is written" current />
          <PhaseGhost n="2" name="Second phase" note="later" />
          <PhaseGhost n="3" name="Third phase" note="later" />
        </div>
      </div>
      <div className="flex flex-col gap-2.5">
        <div className="flex items-baseline gap-2.5">
          <span className="text-[15px] font-semibold text-text-primary">What needs you</span>
          <span className="text-[11.5px] text-text-faint">fills in as the roadmap is written</span>
        </div>
        <div className="flex h-[72px] items-center gap-3.5 rounded-[10px] border border-dashed border-border-hairline px-4 opacity-60">
          <Bar w="36px" h={36} className="rounded-lg" />
          <div className="flex flex-1 flex-col gap-2">
            <Bar w="38%" />
            <Bar w="62%" h={10} />
          </div>
        </div>
      </div>
    </div>
  );
}
