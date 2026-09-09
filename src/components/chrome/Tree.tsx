/*
 * One tree, two panes. The Repo pane's explorer (F23) is the source of truth
 * for every value in here — 28px rows, chevron · icon · name · trailing slot,
 * the divider-faint guide line under an open folder, the selected inset bar —
 * and the Notes sidebar draws its folders and notes with the same parts rather
 * than a second set that drifts. The only things the explorer did not need are
 * optional: a trailing status chip (any node), and the hover marquee that
 * scrolls a name too long to fit (`marquee`).
 */
import { useCallback, useRef, useState, type CSSProperties, type ComponentProps, type ReactNode } from "react";
import { Eyebrow } from "@/components/chrome/atoms";
import { ChevronDownGlyph, ChevronRightGlyph, FolderSimpleGlyph } from "@/components/chrome/icons";
import { rowNameStyle, treeBarOffset } from "@/lib/tree-row";
import { cn } from "@/lib/utils";

/* ---------- the head: eyebrow left, 26px icon buttons right ---------- */

/** The 26px square icon button of a tree head (explorer's history clock, the
 *  notes head's "+" and "⋯"). */
export function TreeIconButton({ className, ...p }: ComponentProps<"button">) {
  return (
    <button
      type="button"
      {...p}
      className={cn(
        "flex size-[26px] items-center justify-center rounded-sm text-text-dim hover:bg-fill-hover hover:text-text-secondary",
        "outline-none focus-visible:[box-shadow:var(--focus-ring)]",
        className,
      )}
    />
  );
}

export function TreeHeader({ label, className, children }: {
  label: ReactNode;
  className?: string;
  /** TreeIconButtons (or a menu wrapping one), right-aligned. */
  children?: ReactNode;
}) {
  return (
    <div className={cn("flex items-center justify-between pb-1.5 pl-3.5 pr-2 pt-2", className)}>
      <Eyebrow className="min-w-0 flex-1 truncate">{label}</Eyebrow>
      <div className="flex flex-none items-center">{children}</div>
    </div>
  );
}

/* ---------- the rows ---------- */

export type TreeRowProps = {
  /** Nesting level — only the selected bar's overhang depends on it. */
  depth?: number;
  /** Before the icon; the folder row's chevron. */
  leading?: ReactNode;
  icon?: ReactNode;
  name: string;
  /** Title attribute on the name span; the name itself by default. */
  title?: string;
  /** Inline, immediately after the name ("workspace", "Empty"). Passing it —
   *  even an empty fragment — stops the name from taking the free space, and
   *  puts a spacer between it and `trailing`, so the row reads name · note ·
   *  … · badge. Without it the name grows and `trailing` sits hard right. */
  after?: ReactNode;
  /** Hard right: a git badge, a status chip, a "contains changes" dot. */
  trailing?: ReactNode;
  selected?: boolean;
  /** Whole row goes text-dim (a deleted file, an empty folder). */
  dimmed?: boolean;
  /** Strike the name through (a deleted file). */
  struck?: boolean;
  /** A quiet fill under the row (a folder that contains changes). */
  tint?: boolean;
  /** Empty folders do not light up under the pointer. */
  hover?: boolean;
  /** Scroll an over-long name once on hover instead of only truncating it. */
  marquee?: boolean;
  className?: string;
  onClick?: () => void;
  onDoubleClick?: () => void;
};

export function TreeRow({
  depth = 0, leading, icon, name, title, after, trailing,
  selected, dimmed, struck, tint, hover = true, marquee,
  className, onClick, onDoubleClick,
}: TreeRowProps) {
  const nameRef = useRef<HTMLSpanElement | null>(null);
  const [box, setBox] = useState({ scrollWidth: 0, clientWidth: 0, hovered: false });
  const onEnter = useCallback(() => {
    const el = nameRef.current;
    if (!el) return;
    setBox({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, hovered: true });
  }, []);
  const onLeave = useCallback(() => setBox((b) => (b.hovered ? { ...b, hovered: false } : b)), []);
  const nameStyle = rowNameStyle(box.scrollWidth, box.clientWidth, box.hovered);
  const grows = after === undefined;

  return (
    <button
      type="button"
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onMouseEnter={marquee ? onEnter : undefined}
      onMouseLeave={marquee ? onLeave : undefined}
      style={marquee ? (nameStyle.style as CSSProperties) : undefined}
      className={cn(
        "relative flex h-7 w-full items-center gap-1.5 rounded-sm px-1.5 text-left",
        "outline-none focus-visible:[box-shadow:var(--focus-ring)]",
        selected ? "bg-fill-hover text-text-primary" : hover && "hover:bg-fill-hover",
        dimmed && !selected && "text-text-dim",
        tint && "bg-fill-subtle",
        className,
      )}
    >
      {selected && (
        <span
          className={cn("absolute bottom-[5px] top-[5px] w-0.5 rounded-[1px] bg-text-primary", treeBarOffset(depth))}
        />
      )}
      {leading}
      {icon}
      <span
        ref={nameRef}
        className={cn(nameStyle.className, !grows && "flex-initial", selected && "font-medium", struck && "line-through")}
        title={title ?? name}
      >
        <span>{name}</span>
      </span>
      {after}
      {!grows && <span className="flex-1" />}
      {trailing}
    </button>
  );
}

/** A folder: chevron · folder glyph · name. Same shell as TreeRow, so an open
 *  folder and the file under it line up to the pixel. */
export function TreeFolderRow({ open, dimmed, ...p }: Omit<TreeRowProps, "leading" | "icon" | "hover" | "struck"> & {
  open: boolean;
}) {
  const Chevron = open ? ChevronDownGlyph : ChevronRightGlyph;
  return (
    <TreeRow
      {...p}
      dimmed={dimmed}
      hover={!dimmed}
      after={p.after ?? <></>}
      leading={<Chevron size={10} className={cn("shrink-0", dimmed ? "text-current" : "text-text-dim")} />}
      icon={<FolderSimpleGlyph size={13} strokeWidth={1.3} className={cn("shrink-0", dimmed ? "text-current" : "text-text-subtle")} />}
    />
  );
}

/** The indented children of an open folder, with the guide line down the left.
 *  Wrap it in AccBody where the open/close should animate. */
export function TreeGuide({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("relative ml-[13px] border-l border-divider-faint pl-2.5", className)}>{children}</div>
  );
}
