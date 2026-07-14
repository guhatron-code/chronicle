/*
 * C7 kanban — the R4 backend data contract, exported for the wiring layer.
 * Tasks live in four columns; executing a round moves its queued tasks to
 * in_progress and freezes them (read-only until the round lands).
 */

export type TaskColumn = "later" | "queued" | "in_progress" | "blocked" | "completed";

/** The R4 task shape — `images`/`links` are plain strings (paths / URLs / labels). */
export type Task = {
  id: string; // auto id — "T-001" style
  title: string;
  content: string;
  images: string[];
  links: string[];
  column: TaskColumn;
  /** Set once the task joins an execute round; rounds freeze on execute. */
  round?: number;
};

/** Board display row — the relative stamp is presentation-time data, not contract. */
export type BoardTask = Task & { ago?: string };

/** Lane order and header labels (F27). */
export const COLUMN_ORDER: readonly TaskColumn[] = [
  "later",
  "queued",
  "in_progress",
  "blocked",
  "completed",
] as const;

export const COLUMN_LABELS: Record<TaskColumn, string> = {
  later: "Later",
  queued: "Queued",
  in_progress: "In progress",
  blocked: "Blocked",
  completed: "Completed",
};
