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
  className?: string;
};

export function Roadmap(p: RoadmapProps) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div
        className={cn(
          "mx-auto flex max-w-[900px] flex-col gap-3.5 px-7 py-[22px]",
          p.className,
        )}
      >
        {p.warning && <WarningBanner {...p.warning} />}
        {p.banner && <CurrentStateBanner {...p.banner} />}
        {p.stale && <StaleAlert {...p.stale} />}
        {p.problem && <ProblemCard {...p.problem} />}
        {p.consent && <ConsentCard {...p.consent} />}
        {p.building && <BuildingCard {...p.building} />}
        {p.history && <HistoryPanel {...p.history} />}
        {p.needsYou && <NeedsYou {...p.needsYou} />}
        {p.documents && <DocumentsPanel {...p.documents} />}
        {p.phaseRail && <PhaseRail {...p.phaseRail} />}
      </div>
    </div>
  );
}
