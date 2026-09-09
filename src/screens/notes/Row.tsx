/*
 * One row shape for the tree, the round card and the backlink footer. Nothing
 * ever wraps: the name truncates with an ellipsis and, when it is really too
 * long, scrolls once on hover; the secondary text takes what is left. The two
 * predicates live in notes-model so they are tested without a DOM.
 */
import { useCallback, useRef, useState, type ReactNode } from "react";
import { rowNameStyle } from "@/lib/notes-model";
import { cn } from "@/lib/utils";

export function Row({ name: label, secondary, icon, indent = 0, selected, status, onClick, onDoubleClick }: {
  name: string; secondary?: string; icon?: ReactNode; indent?: number;
  selected?: boolean; status?: { label: string; tone: string } | null;
  onClick?: () => void; onDoubleClick?: () => void;
}) {
  const nameRef = useRef<HTMLSpanElement | null>(null);
  const [box, setBox] = useState({ scrollWidth: 0, clientWidth: 0, hovered: false });
  const onEnter = useCallback(() => {
    const el = nameRef.current;
    if (!el) return;
    setBox({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, hovered: true });
  }, []);
  const name = rowNameStyle(box.scrollWidth, box.clientWidth, box.hovered);
  return (
    <div
      onMouseEnter={onEnter}
      onMouseLeave={() => setBox((b) => ({ ...b, hovered: false }))}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      style={{ paddingLeft: 6 + indent * 13, ...name.style } as React.CSSProperties}
      className={cn(
        "flex h-[24px] cursor-default items-center gap-[7px] rounded-[5px] pr-1.5 text-[12px]",
        selected ? "bg-selected-bg text-selected-fg" : "text-text-secondary hover:bg-fill-hover",
      )}
    >
      {icon}
      <span ref={nameRef} className={name.className}>
        <span>{label}</span>
      </span>
      {status && (
        <span className={cn("flex shrink-0 items-center gap-[5px] font-mono text-[10.5px]", TONE[status.tone] ?? "text-text-dim")}>
          <i className="size-[5px] shrink-0 rounded-full bg-current" />
          {status.label}
        </span>
      )}
      {secondary && <span className="min-w-0 shrink truncate text-[11px] text-text-dim">{secondary}</span>}
    </div>
  );
}

const TONE: Record<string, string> = {
  none: "text-text-dim", queued: "text-state-warn", progress: "text-state-neutral",
  done: "text-state-success", unknown: "text-text-dim",
};
