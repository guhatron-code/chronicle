/*
 * L1 (Deck 6) — the roadmap pane composition. A reading surface: comfortable measure
 * (max-w 700px, centred), never edge-to-edge; 14px section gaps; padding 22px 28px.
 * Order per L1 with the non-L1 slices slotted per the C3 brief: warning → current-state
 * banner → (stale / problem / consent / building, as applicable) → history →
 * what-needs-you → documents → phase rail. Presentational only.
 */
import { cn } from "@/lib/utils";
import { BuildingCard, type BuildingCardProps } from "./BuildingCard";
import { ConsentCard, type ConsentCardProps } from "./ConsentCard";
import { CurrentStateBanner, type CurrentStateBannerProps } from "./CurrentStateBanner";
import { DocumentsPanel, type DocumentsPanelProps } from "./DocumentsPanel";
import { HistoryPanel, type HistoryPanelProps } from "./HistoryPanel";
import { NeedsYou, type NeedsYouProps } from "./NeedsYou";
import { PhaseRail, type PhaseRailProps } from "./PhaseRail";
import { ProblemCard, type ProblemCardProps } from "./ProblemCard";
import { StaleAlert, type StaleAlertProps } from "./StaleAlert";
import { WarningBanner, type WarningBannerProps } from "./WarningBanner";

export type RoadmapProps = {
  warning?: WarningBannerProps;
  banner?: CurrentStateBannerProps;
  stale?: StaleAlertProps;
  problem?: ProblemCardProps;
  consent?: ConsentCardProps;
  building?: BuildingCardProps;
  history?: HistoryPanelProps;
  needsYou?: NeedsYouProps;
  documents?: DocumentsPanelProps;
  phaseRail?: PhaseRailProps;
  /** The always-available "read the plans again" action (bottom of the column). */
  onRebuildRoadmap?: () => void;
  className?: string;
};

export function Roadmap(p: RoadmapProps) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div
        className={cn(
          "mx-auto flex max-w-[900px] flex-col divide-y divide-divider px-7 py-1.5",
          p.className,
        )}
      >
        {/* the building card sits in the warning banner's slot — clicking Rebuild
            swaps banner → card in place instead of shifting the page */}
        {p.building && <BuildingCard {...p.building} />}
        {p.warning && <WarningBanner {...p.warning} />}
        {p.banner && <CurrentStateBanner {...p.banner} />}
        {p.stale && <StaleAlert {...p.stale} />}
        {p.problem && <ProblemCard {...p.problem} />}
        {p.consent && <ConsentCard {...p.consent} />}
        {p.history && <HistoryPanel {...p.history} />}
        {p.needsYou && <NeedsYou {...p.needsYou} />}
        {p.documents && <DocumentsPanel {...p.documents} />}
        {p.phaseRail && <PhaseRail {...p.phaseRail} />}
        {p.onRebuildRoadmap && (
          <div className="flex flex-col items-center gap-2 py-7">
            <button
              onClick={p.onRebuildRoadmap}
              className="h-8 rounded-md border border-border-strong px-3.5 text-[12.5px] font-medium text-text-secondary hover:bg-fill-hover hover:text-text-primary"
            >
              Rescan and rebuild the roadmap
            </button>
            <span className="text-[11.5px] text-text-dim">
              A session reads the plan documents and git history again and rewrites chronicle.json.
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
