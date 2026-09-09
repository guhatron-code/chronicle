/*
 * The trailing chip on a note row: a dot and a word, never colour alone. Lives
 * on its own because both the tree and the round card draw it.
 */
import { cn } from "@/lib/utils";

const TONE: Record<string, string> = {
  none: "text-text-dim", queued: "text-state-warn", progress: "text-state-neutral",
  done: "text-state-success", unknown: "text-text-dim",
};

export function StatusChip({ label, tone }: { label: string; tone: string }) {
  return (
    <span className={cn("flex shrink-0 items-center gap-[5px] font-mono text-[10.5px]", TONE[tone] ?? "text-text-dim")}>
      <i className="size-[5px] shrink-0 rounded-full bg-current" />
      {label}
    </span>
  );
}
