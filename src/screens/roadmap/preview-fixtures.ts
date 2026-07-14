/*
 * C3 dev-preview fixtures — one export per deck frame state, specimen copy
 * transcribed verbatim from Deck 2 (F12–F14), Deck 3 (F15–F22) and Deck 6 (L1).
 * Wired into a preview harness by the maintainer later; nothing imports this yet.
 */
import { createElement, type ReactNode } from "react";
import { CodeGlyph, FolderSimpleGlyph, UploadGlyph } from "@/components/chrome/icons";
import type { BuildingCardProps } from "./BuildingCard";
import type { ConsentCardProps } from "./ConsentCard";
import type { CurrentStateBannerProps } from "./CurrentStateBanner";
import type { DocumentsPanelProps } from "./DocumentsPanel";
import type { HistoryPanelProps, HistoryStatus } from "./HistoryPanel";
import type { NeedsYouProps } from "./NeedsYou";
import type { PhaseDetailProps, DetailSaves } from "./PhaseDetail";
import type { PhaseRailProps } from "./PhaseRail";
import type { ProblemCardProps } from "./ProblemCard";
import type { RoadmapProps } from "./Roadmap";
import type { StaleAlertProps } from "./StaleAlert";
import type { WarningBannerProps } from "./WarningBanner";

/* ============ F12 · consent card ============ */

export const consentCard: ConsentCardProps = { agent: "claude" };
export const consentCardCodex: ConsentCardProps = { agent: "codex" };

/* ============ F13 · building state ============ */

export const buildingRunning: BuildingCardProps = {
  kind: "running",
  elapsed: "1m 40s",
  progress: 0.58,
  logLines: [
    "reading docs/PLAN.md · 312 lines",
    "reading src/ · 41 files",
    "drafting phases · 6 so far",
    "checking rules against disk…",
  ],
  activeLine: "writing ROADMAP.md",
};

export const buildingStillRunning: BuildingCardProps = {
  kind: "still-running",
  elapsed: "6m 12s",
  logLines: ["checking rules against disk · 34 of 51"],
  activeLine: "verifying phase EL-2",
};

/* ============ F14 · warning banner ============ */

export const warningBanner: WarningBannerProps = { count: 3 };

/* ============ F15 · current-state banner ============ */

export const bannerNormal: CurrentStateBannerProps = {
  kind: "normal",
  phaseId: "R-1",
  phaseName: "Missing screens get drawn",
  statusWord: "in design",
  body: "Six screens exist as skeletons; four still need real layouts before the beauty pass can start.",
  upNext: { id: "EL-1", name: "The beauty pass" },
};

export const bannerJustSwitched: CurrentStateBannerProps = {
  kind: "just-switched",
  phaseId: "EL-1",
  phaseName: "The beauty pass",
  statusWord: "in progress",
  body: "R-1 finished a minute ago. The agent is now polishing type, spacing, and states across all screens.",
  upNext: { id: "EL-2", name: "Copy review" },
};

const waitingBody: ReactNode = createElement(
  "span",
  null,
  "The plan needs a decision: keep the pricing page in this round, or move it to the next one. It's written up in ",
  createElement("span", { className: "font-mono text-xs text-text-subtle" }, "docs/DECISIONS.md"),
  ".",
);

export const bannerWaiting: CurrentStateBannerProps = {
  kind: "waiting",
  phaseId: "R-1",
  phaseName: "Missing screens get drawn",
  body: waitingBody,
  actionLabel: "Read the decision",
};

export const bannerAllDone: CurrentStateBannerProps = {
  kind: "all-done",
  body: "All 9 phases finished and published. The roadmap has nothing left to track.",
};

/* ============ F16 · stale alert ============ */

export const staleAlert: StaleAlertProps = {};
export const staleAlertScanning: StaleAlertProps = { scanning: true };

/* ============ F17 · manifest-problem cards ============ */

export const problemPartOf: ProblemCardProps = {
  kind: "part-of",
  projectName: "weave",
  path: "~/dev/weave",
};

export const problemCantRead: ProblemCardProps = {
  kind: "cant-read",
  detail: 'ROADMAP.md:41 — unclosed phase block "EL-1"',
};

export const problemBlank: ProblemCardProps = { kind: "blank" };

export const problemMisplaced: ProblemCardProps = { kind: "misplaced", foundIn: "docs/" };

export const problemScanFailed: ProblemCardProps = {
  kind: "scan-failed",
  detail: "session exited with code 1 after 42s",
};

export const problemBasicView: ProblemCardProps = { kind: "basic-view" };

/* ============ F18 · project-history panel ============ */

export const historyPanel: HistoryPanelProps = {
  kind: "panel",
  status: { kind: "waiting", label: "2 saves waiting to publish" },
  nodes: [
    { label: "Edits on disk", count: "4 files", marker: "dot" },
    { label: "Saved to history", count: "2 waiting", marker: "done" },
    { label: "Published online", count: "behind by 2", marker: "pending" },
  ],
  arrowsActive: [true, false],
  milestones: ["phase-0", "phase-1"],
  files: [
    { path: "src/screens/Pricing.tsx", badge: "new" },
    { path: "src/screens/Home.tsx", badge: "edited" },
    { path: "docs/PLAN.md", badge: "edited" },
  ],
  moreCount: 3,
};

export const historyStatusPublished: HistoryStatus = { kind: "published" };
export const historyStatusUntracked: HistoryStatus = { kind: "untracked" };

export const historyNoHistory: HistoryPanelProps = { kind: "no-history" };

/* ============ F19 · what needs you ============ */

export const needsYou: NeedsYouProps = {
  kind: "list",
  rows: [
    {
      id: "publish",
      kind: "one-click",
      hi: true,
      primary: true,
      icon: createElement(UploadGlyph, { size: 14 }),
      title: "Publish 2 saves",
      sub: "Saved to history, not online yet.",
      command: "git push origin main",
      actionLabel: "Publish now",
    },
    {
      id: "workspace",
      kind: "one-click",
      icon: createElement(FolderSimpleGlyph, { size: 14 }),
      title: "Clean up 1 leftover workspace",
      sub: "A finished agent session left a working copy behind. Removing it frees 220 MB; your project isn't touched.",
      command: "git worktree remove ../lumen-site-el1 --force",
      actionLabel: "Remove it",
    },
    {
      id: "tokens",
      kind: "copy-only",
      icon: createElement(CodeGlyph, { size: 14 }),
      title: "Regenerate the design tokens",
      sub: "The roadmap suggests this after every EL phase. Chronicle won't run it for you — copy it, read it, then paste it in the terminal.",
      command: "npm run tokens:build && npm run tokens:verify --strict",
    },
  ],
};

export const needsYouEmpty: NeedsYouProps = { kind: "empty" };

/* ============ F20 · documents panel ============ */

export const documentsPanel: DocumentsPanelProps = {
  chips: [
    { kind: "default", name: "PLAN.md" },
    { kind: "copied", name: "PROMPT.md" },
    { kind: "missing", name: "DECISIONS.md", note: "not written yet" },
    { kind: "paste", name: "phase_r1_prompt.md", hint: "→ Claude Code, when R-1 starts" },
    { kind: "ghost", name: "phase_el1_prompt.md", note: "written when EL-1 begins" },
  ],
};

/* ============ F21 · the phase rail ============ */

export const phaseRail: PhaseRailProps = {
  stages: [
    {
      name: "Design",
      sub: "screens exist and look right before any wiring",
      phases: [
        { kind: "phase", id: "R-0", name: "Skeleton pages exist", open: false, status: "done", statusWord: "done", description: "", steps: [], paste: [] },
        {
          kind: "phase",
          open: true,
          status: "now",
          id: "R-1",
          name: "Missing screens get drawn",
          statusWord: "in design",
          description:
            "Four screens still need real layouts: pricing, changelog, and the two empty states. Each is drawn against the section spec in the plan.",
          steps: [
            { label: "Pricing page layout", done: true },
            { label: "Changelog layout" },
            { label: "Empty states — search, 404" },
          ],
          paste: [{ name: "phase_r1_prompt.md", into: "Claude Code", note: "when R-1 starts" }],
          reference: [{ name: "docs/SCREENS.md" }],
        },
        { kind: "phase", id: "R-2", name: "Navigation holds together", open: false, status: "just-done", statusWord: "done", description: "", steps: [], paste: [] },
        {
          kind: "window",
          id: "W-1",
          name: "Copy review window",
          eyebrow: "Window · runs alongside R-phases",
          note: "open until EL-1 starts",
        },
        {
      kind: "phase",
      id: "FX-1",
      name: "Bug fixes",
      badge: "From the Kanban · 6 tasks",
      open: false,
      status: "later",
      statusWord: "Ready to run",
      description: "6 tasks from the kanban, frozen into an executable plan.",
      steps: [],
      paste: [{ name: "phase_1_fixes_prompt.md", into: "Claude Code" }],
      reference: [{ name: "phase_1_fixes_plan.md" }],
    },
        { kind: "phase", id: "EL-1", name: "The beauty pass", open: false, status: "later", statusWord: "later", description: "", steps: [], paste: [] },
      ],
    },
  ],
};

/* ============ F22 · phase detail ============ */

export const phaseDetail: PhaseDetailProps = {
  phaseId: "R-1",
  phaseName: "Missing screens get drawn",
  statusWord: "in design",
  startHelper:
    "Start this phase opens a terminal, starts Claude Code, and copies phase_r1_prompt.md — you paste it as the first message.",
  description:
    "Four screens still need real layouts: pricing, changelog, and the two empty states. Each one is drawn against the section spec in the plan, using the components that already exist — no new primitives in this phase.",
  stepsLabel: "5 steps",
  steps: [
    { label: "Audit which screens are still skeletons", state: "done" },
    { label: "Pricing page layout", state: "done" },
    { label: "Changelog layout", state: "active", note: "· being worked on" },
    { label: "Empty state — search", state: "todo" },
    { label: "Empty state — 404", state: "todo" },
  ],
  paste: [{ name: "phase_r1_prompt.md", into: "Claude Code" }],
  docs: [
    {
      title: "The screen spec",
      path: "docs/SCREENS.md",
      state: "open",
      heading: "Pricing",
      body: "Three tiers, annual toggle, one highlighted column. No testimonial band — that moved to Home in the last plan revision.",
    },
    { title: "The plan", path: "docs/PLAN.md", state: "loading" },
    { title: "Decisions", path: "docs/DECISIONS.md", state: "error" },
  ],
  saves: {
    kind: "list",
    entries: [
      {
        hash: "a41f2c9",
        author: { kind: "agent" },
        ago: "18m ago",
        message: "R-1: pricing layout drawn, three tiers",
      },
      {
        hash: "9c07b1e",
        author: { kind: "you", initials: "JD" },
        ago: "2h ago",
        message: "R-1: skeleton audit notes",
      },
    ],
  },
};

export const phaseDetailSavesEmpty: DetailSaves = {
  kind: "empty",
  message: "No saves mention R-1 yet.",
};
export const phaseDetailSavesLoading: DetailSaves = { kind: "loading" };

/* ============ L1 · the full roadmap pane ============ */

export const roadmapL1: RoadmapProps = {
  warning: warningBanner,
  banner: bannerNormal,
  needsYou,
  documents: documentsPanel,
  phaseRail,
};

/** Every non-L1 slice in place — the kitchen-sink preview. */
export const roadmapEverything: RoadmapProps = {
  warning: warningBanner,
  banner: bannerNormal,
  stale: staleAlert,
  history: historyPanel,
  needsYou,
  documents: documentsPanel,
  phaseRail,
};
