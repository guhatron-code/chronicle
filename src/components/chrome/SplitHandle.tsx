/*
 * The drag handle between two columns — the hairline-with-a-grip-pill anatomy
 * the Repo pane's tree splitter first drew. Presentational only: the
 * pointer-down is the host's to drive, since the drag math and the
 * persistence key are per-pane (the tree width and the notes sidebar width
 * live under their own localStorage keys).
 */
import type { PointerEvent as ReactPointerEvent } from "react";
import { cn } from "@/lib/utils";

export function SplitHandle({
  orientation = "vertical",
  onPointerDown,
  "aria-label": ariaLabel,
  className,
}: {
  orientation?: "vertical" | "horizontal";
  onPointerDown?: (e: ReactPointerEvent<HTMLDivElement>) => void;
  "aria-label": string;
  className?: string;
}) {
  const vertical = orientation === "vertical";
  return (
    <div
      data-chrome
      role="separator"
      aria-orientation={orientation}
      aria-label={ariaLabel}
      onPointerDown={onPointerDown}
      className={cn(
        "flex shrink-0 items-center justify-center hover:bg-fill-subtle",
        vertical ? "w-[7px] cursor-col-resize" : "h-[7px] cursor-row-resize",
        className,
      )}
    >
      <span className={cn("rounded-[1px] bg-border-strong", vertical ? "h-[34px] w-0.5" : "h-0.5 w-[34px]")} />
    </div>
  );
}
