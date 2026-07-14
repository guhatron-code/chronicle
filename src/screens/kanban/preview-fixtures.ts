/*
 * C7 dev-preview fixtures — one export per Deck-5 frame state (F27–F30) plus
 * the L5 composition, specimen copy transcribed verbatim. The tasks the deck
 * names are exact; the lanes are padded to the deck's counts (6·2·1·5 = the
 * "14 tasks" header) with neutral filler rows. Wired into a preview harness by
 * the maintainer later; nothing imports this yet.
 */
import type { BoardProps } from "./Board";
import type { ComposerProps } from "./Composer";
import type { ExecuteFlowProps } from "./ExecuteFlow";
import type { TaskCardProps } from "./TaskCard";
import type { BoardTask, Task } from "./types";

/* ============ the deck's specimen tasks ============ */

const t014: Task = {
  id: "T-014",
  title: "Pricing toggle jumps on click",
  content:
    "The annual/monthly switch shifts the whole column by 2px. Feels broken on slow machines especially.",
  images: [
    "shots/pricing-before.png",
    "shots/pricing-after.png",
    "shots/pricing-safari.png",
    "shots/pricing-firefox.png",
  ],
  links: [],
  column: "queued",
};

const tasks: BoardTask[] = [
  /* Queued — 6 */
  { ...t014, ago: "40m ago" },
  {
    id: "T-015",
    title: "Empty search uses old copy",
    content: "",
    images: [],
    links: ["figma · empty states"],
    column: "queued",
    ago: "2h ago",
  },
  { id: "T-016", title: "Mobile nav overlaps the logo", content: "Below 380px the hamburger sits on the wordmark.", images: [], links: [], column: "queued", ago: "3h ago" },
  { id: "T-017", title: "Add a changelog RSS feed", content: "", images: [], links: [], column: "queued", ago: "5h ago" },
  { id: "T-018", title: "Testimonials feel cramped", content: "", images: ["shots/testimonials.png"], links: [], column: "queued", ago: "1d ago" },
  { id: "T-019", title: "404 page has no way home", content: "", images: [], links: [], column: "queued", ago: "2d ago" },
  /* In progress — 2, frozen in round 1 */
  { id: "T-009", title: "Footer links 404 on /docs", content: "", images: [], links: [], column: "in_progress", round: 1 },
  { id: "T-011", title: "Hero image loads late", content: "", images: [], links: [], column: "in_progress", round: 1 },
  /* Blocked — 1 */
  {
    id: "T-007",
    title: "Changelog needs real entries",
    content: "Waiting on you: the first three releases have no written notes to pull from.",
    images: [],
    links: [],
    column: "blocked",
    ago: "1d ago",
  },
  /* Completed — 5, verified in round 1 */
  { id: "T-003", title: "Nav collapses at 900px", content: "", images: [], links: [], column: "completed", round: 1 },
  { id: "T-001", title: "Favicon is the Vite default", content: "", images: [], links: [], column: "completed", round: 1 },
  { id: "T-002", title: "Buttons use two different blues", content: "", images: [], links: [], column: "completed", round: 1 },
  { id: "T-004", title: "Contact form loses the message", content: "", images: [], links: [], column: "completed", round: 1 },
  { id: "T-005", title: "Footer year is hard-coded", content: "", images: [], links: [], column: "completed", round: 1 },
];

/* ============ F27 / L5 · the board ============ */

export const boardDefault: BoardProps = {
  title: "Fixes & ideas",
  tasks,
};

/** T-014 dims in its lane; Completed shows the drop well (the lifted copy is
 *  `cardDragging`, rendered by the wiring's pointer overlay). */
export const boardDragging: BoardProps = {
  title: "Fixes & ideas",
  tasks,
  draggingId: "T-014",
  dropColumn: "completed",
};

/** Round 1 executing — the explainer strip renders; in-progress cards freeze. */
export const boardExecuting: BoardProps = {
  title: "Fixes & ideas",
  tasks,
  executingRound: 1,
};

/** T-014 open in the composer — the selected ring in its lane. */
export const boardSelected: BoardProps = {
  title: "Fixes & ideas",
  tasks,
  selectedId: "T-014",
};

/** Nothing yet — every lane an open lane; Queued keeps the add affordance;
 *  Ready to execute disables at 0 queued. */
export const boardEmpty: BoardProps = {
  title: "Fixes & ideas",
  tasks: [],
};

/* ============ F28 · task card states ============ */

const cardTask: Task = {
  ...t014,
  title: "Pricing toggle jumps",
  content: "The switch shifts the column by 2px on click.",
  images: [],
};

export const cardDefault: TaskCardProps = { task: cardTask, ago: "40m ago" };
export const cardDragging: TaskCardProps = { task: cardTask, dragging: true };
export const cardDimmed: TaskCardProps = { task: cardTask, dimmed: true };
export const cardSelected: TaskCardProps = { task: cardTask, selected: true };
export const cardFrozen: TaskCardProps = {
  task: { ...cardTask, column: "in_progress", round: 2 },
  frozen: true,
};
export const cardCompleted: TaskCardProps = {
  task: { ...cardTask, column: "completed", round: 1 },
};
/** Thumbs + overflow + link chip + stamp in one footer. */
export const cardFull: TaskCardProps = {
  task: { ...t014, links: ["figma · pricing v3"] },
  ago: "40m ago",
};

/* ============ F29 · composer / detail ============ */

export const composerEdit: ComposerProps = {
  mode: "edit",
  id: "T-014",
  meta: "created 40m ago · updated 5m ago",
  title: "Pricing toggle jumps on click",
  content:
    "The annual/monthly switch shifts the whole column by 2px on click. Reproduces every time in Safari.",
  images: ["shots/pricing-before.png", "shots/pricing-after.png"],
  links: ["figma · pricing v3"],
  column: "queued",
};

export const composerCreate: ComposerProps = {
  mode: "create",
  title: "",
  content: "",
  images: [],
  links: [],
  column: "queued",
};

/* ============ F30 · ready to execute ============ */

export const executePreflight: ExecuteFlowProps = {
  kind: "preflight",
  queued: 6,
  planFile: "phase_2_fixes_plan.md",
  promptFile: "phase_2_fixes_prompt.md",
};

export const executeGenerating: ExecuteFlowProps = {
  kind: "generating",
  elapsed: "32s",
  progress: 0.4,
  logLines: ["reading 6 tasks · 4 screenshots", "grouping by screen · 3 groups"],
  activeLine: "writing phase_2_fixes_plan.md",
};

export const executeDone: ExecuteFlowProps = {
  kind: "done",
  round: 2,
  taskCount: 6,
  outcome: "bug fixes",
  planFile: "phase_2_fixes_plan.md",
  promptFile: "phase_2_fixes_prompt.md",
};

/** The explainer strip while round 1 runs (RoundExecutingNote props). */
export const roundExecutingNote = { round: 1 };
