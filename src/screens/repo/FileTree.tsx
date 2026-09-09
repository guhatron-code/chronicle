/*
 * F23 (Deck 4) — the file tree: "EXPLORER · N ROOTS" head with the history button,
 * 28px rows (chevron · icon · name · git letter badge), nested divider-faint guide
 * lines, the selected inset bar, dir-with-changes tint + dot, loading / error /
 * empty-dir rows, workspace-root label. Presentational only; values transcribed 1:1.
 *
 * The row/folder/guide/head parts themselves live in components/chrome/Tree —
 * this tree and the Notes sidebar draw with the same ones.
 */
import { Spinner } from "@/components/chrome/atoms";
import {
  TreeFolderRow,
  TreeGuide,
  TreeHeader,
  TreeIconButton,
  TreeRow,
} from "@/components/chrome/Tree";
import { DocGlyph, ErrorGlyph, HistoryClockGlyph } from "@/components/chrome/icons";
import { cn, sentence } from "@/lib/utils";
import { AccBody } from "@/screens/roadmap/bits";

export type GitLetter = "A" | "M" | "D";

export type TreeNode =
  | {
      kind: "dir";
      id: string;
      name: string;
      open: boolean;
      children: TreeNode[];
      /** Subtle tint (non-root) + trailing dot. */
      hasChanges?: boolean;
      /** Whole row dims; italic "Empty" hint. */
      empty?: boolean;
      /** Trailing dimmer "workspace" label (leftover-worktree roots). */
      workspace?: boolean;
    }
  | { kind: "file"; id: string; name: string; git?: GitLetter }
  | { kind: "loading"; id: string; label: string } // e.g. "Reading node_modules…"
  | { kind: "error"; id: string; message: string }; // "Couldn't read this folder" + Retry

export type FileTreeProps = {
  /** 1 + workspace roots — the Explorer head count (top-level entries are the
   *  project root's CHILDREN, not roots). */
  rootsCount?: number;
  roots: TreeNode[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  onToggleDir?: (id: string) => void;
  onRetry?: (id: string) => void;
  onOpenHistory?: () => void;
  className?: string;
};

const GIT_TITLE: Record<GitLetter, string> = {
  A: "Added — new file",
  M: "Modified",
  D: "Deleted",
};

/** The A/M/D letter badge — letters with distinct treatments, never colour alone. */
export function GitBadge({ letter }: { letter: GitLetter }) {
  return (
    <span
      title={GIT_TITLE[letter]}
      className={cn(
        "flex size-[15px] items-center justify-center rounded-[4px] border font-mono text-[10px]",
        letter === "A" && "border-border-strong bg-fill-hover text-text-primary",
        letter === "M" && "border-border-strong text-text-secondary",
        letter === "D" && "border-dashed border-border-strong text-text-dim",
      )}
    >
      {letter}
    </span>
  );
}

function Row({
  node,
  depth,
  notFirstRoot,
  selectedId,
  onSelect,
  onToggleDir,
  onRetry,
}: {
  node: TreeNode;
  depth: number;
  /** Second+ roots get a 4px separation margin (deck F23). */
  notFirstRoot?: boolean;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  onToggleDir?: (id: string) => void;
  onRetry?: (id: string) => void;
}) {
  if (node.kind === "loading") {
    return (
      <div className="flex h-7 items-center gap-1.5 px-1.5 text-text-dim">
        <Spinner size={10} className="shrink-0 border-[1.3px]" />
        <span className="min-w-0 truncate text-xs text-state-neutral">{sentence(node.label)}</span>
      </div>
    );
  }

  if (node.kind === "error") {
    return (
      <div className={cn("flex h-7 items-center gap-1.5 px-1.5", depth === 0 && "ml-[13px]")}>
        <ErrorGlyph size={11} strokeWidth={1.4} className="shrink-0 text-state-error" />
        <span className="min-w-0 flex-1 truncate text-[11.5px] text-state-error">{sentence(node.message)}</span>
        <button
          onClick={() => onRetry?.(node.id)}
          className="h-5 shrink-0 rounded-[5px] border border-border-strong px-[7px] text-[10.5px] text-text-secondary hover:bg-fill-hover"
        >
          Retry
        </button>
      </div>
    );
  }

  if (node.kind === "file") {
    const selected = node.id === selectedId;
    const deleted = node.git === "D";
    return (
      <TreeRow
        depth={depth}
        name={node.name}
        selected={selected}
        dimmed={deleted}
        struck={deleted}
        icon={
          <DocGlyph
            size={13}
            strokeWidth={1.2}
            className={cn("shrink-0", deleted && !selected ? "text-current" : "text-text-subtle")}
          />
        }
        trailing={node.git ? <GitBadge letter={node.git} /> : undefined}
        onClick={() => onSelect?.(node.id)}
      />
    );
  }

  // dir
  return (
    <div>
      <TreeFolderRow
        depth={depth}
        name={node.name}
        open={node.open}
        dimmed={node.empty}
        tint={node.hasChanges}
        className={cn(notFirstRoot && "mt-1")}
        after={
          <>
            {node.workspace && <span className="shrink-0 text-[10.5px] text-text-dimmer">workspace</span>}
            {node.empty && <span className="ml-1 text-[11px] italic text-text-dimmer">Empty</span>}
          </>
        }
        trailing={
          node.hasChanges ? (
            <span title="Contains changes" className="size-[5px] rounded-full bg-text-subtle" />
          ) : undefined
        }
        onClick={() => onToggleDir?.(node.id)}
      />
      {(node.children.length > 0 || node.open) && (
        <AccBody open={node.open}>
          <TreeGuide>
            {node.children.map((child) => (
              <Row
                key={child.id}
                node={child}
                depth={depth + 1}
                selectedId={selectedId}
                onSelect={onSelect}
                onToggleDir={onToggleDir}
                onRetry={onRetry}
              />
            ))}
          </TreeGuide>
        </AccBody>
      )}
    </div>
  );
}

export function FileTree(p: FileTreeProps) {
  const n = p.rootsCount ?? 1;
  return (
    <div className={cn("flex h-full min-h-0 flex-col", p.className)}>
      <TreeHeader label={`Explorer · ${n} ${n === 1 ? "root" : "roots"}`}>
        <TreeIconButton
          aria-label="Project history"
          title="Project history — saves, publish, bring down"
          onClick={p.onOpenHistory}
        >
          <HistoryClockGlyph size={13} />
        </TreeIconButton>
      </TreeHeader>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3 text-[12.5px] text-text-secondary">
        {p.roots.map((node, i) => (
          <Row
            key={node.id}
            node={node}
            depth={0}
            notFirstRoot={i > 0}
            selectedId={p.selectedId}
            onSelect={p.onSelect}
            onToggleDir={p.onToggleDir}
            onRetry={p.onRetry}
          />
        ))}
      </div>
    </div>
  );
}
