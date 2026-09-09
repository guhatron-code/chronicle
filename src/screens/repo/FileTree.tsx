/*
 * F23 (Deck 4) — the file tree: "EXPLORER · N ROOTS" head with the history button,
 * 28px rows (chevron · icon · name · git letter badge), nested divider-faint guide
 * lines, the selected inset bar, dir-with-changes tint + dot, loading / error /
 * empty-dir rows, workspace-root label. Presentational only; values transcribed 1:1.
 *
 * The row/folder/guide/head parts themselves live in components/chrome/Tree —
 * this tree and the Notes sidebar draw with the same ones.
 */
import { useState, type ReactNode } from "react";
import { Spinner } from "@/components/chrome/atoms";
import {
  TreeFolderRow,
  TreeGuide,
  TreeHeader,
  TreeIconButton,
  TreeRow,
} from "@/components/chrome/Tree";
import { DocGlyph, ErrorGlyph, FolderPlusGlyph, HistoryClockGlyph, PlusGlyph } from "@/components/chrome/icons";
import {
  ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { cn, sentence } from "@/lib/utils";
import { isHtmlPath } from "@/lib/web-url";
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
  | { kind: "error"; id: string; message: string } // "Couldn't read this folder" + Retry
  | { kind: "input"; id: string; placeholder: string; initial: string; error?: string };

export type FileTreeProps = {
  /** 1 + workspace roots — the Explorer head count (top-level entries are the
   *  project root's CHILDREN, not roots). */
  rootsCount?: number;
  roots: TreeNode[];
  selectedId?: string | null;
  /** The id of the "input" row, or the row being renamed. */
  pendingId?: string | null;
  renamingId?: string | null;
  nameError?: string | null;
  onSelect?: (id: string) => void;
  onToggleDir?: (id: string) => void;
  onRetry?: (id: string) => void;
  onOpenHistory?: () => void;
  onNewFile?: () => void;
  onNewFolder?: () => void;
  onCommitName?: (value: string) => void;
  onCancelName?: () => void;
  onRename?: (id: string) => void;
  onReveal?: (id: string) => void;
  onDelete?: (id: string) => void;
  onOpenInWeb?: (id: string) => void;
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

/** Enter commits, Escape cancels, blur commits (the notes sidebar's rule).
 *  Names go through the same sanitiser a note title does, so nothing typed
 *  here can carry a separator or a leading dot into a path. */
function NameField({
  depth, initial, placeholder, error, onCommit, onCancel,
}: {
  depth: number;
  initial: string;
  placeholder: string;
  error?: string | null;
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <div className={cn("flex flex-col gap-[3px] py-[3px]", depth === 0 && "ml-[13px]")}>
      <input
        autoFocus
        value={value}
        placeholder={placeholder}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => onCommit(value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); onCommit(value); }
          else if (e.key === "Escape") { e.preventDefault(); onCancel(); }
        }}
        className={cn(
          "h-[24px] w-full rounded-[5px] border bg-surface-input px-1.5 text-[12px] text-text-primary outline-none",
          error ? "border-state-error" : "border-border-strong",
        )}
      />
      {error && <span className="px-1 text-[10.5px] text-state-error">{sentence(error)}</span>}
    </div>
  );
}

type RowHandlers = {
  selectedId?: string | null;
  renamingId?: string | null;
  nameError?: string | null;
  onSelect?: (id: string) => void;
  onToggleDir?: (id: string) => void;
  onRetry?: (id: string) => void;
  onCommitName?: (value: string) => void;
  onCancelName?: () => void;
  onRename?: (id: string) => void;
  onReveal?: (id: string) => void;
  onDelete?: (id: string) => void;
  onOpenInWeb?: (id: string) => void;
};

/** The row's operations. Right-click anywhere on the row opens it; so does the
 *  ⋯ that appears on hover and stays put on the selected row, for anyone who
 *  does not think to right-click. */
function RowMenu({ node, selected, children, ...h }: RowHandlers & {
  node: Extract<TreeNode, { kind: "file" | "dir" }>;
  selected: boolean;
  children: ReactNode;
}) {
  const items = (
    <>
      <ContextMenuItem onSelect={() => h.onRename?.(node.id)}>Rename…</ContextMenuItem>
      <ContextMenuItem onSelect={() => h.onReveal?.(node.id)}>Reveal in Finder</ContextMenuItem>
      {node.kind === "file" && isHtmlPath(node.name) && (
        <ContextMenuItem onSelect={() => h.onOpenInWeb?.(node.id)}>Open in Web</ContextMenuItem>
      )}
      <ContextMenuSeparator />
      <ContextMenuItem variant="destructive" onSelect={() => h.onDelete?.(node.id)}>Delete…</ContextMenuItem>
    </>
  );
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-[190px]">{items}</ContextMenuContent>
    </ContextMenu>
  );
}

/** The ⋯ itself, for the row's `trailing` slot. It reserves no width when
 *  hidden because it sits beside the git badge, which already occupies the
 *  slot — `invisible` keeps the row from reflowing on hover. */
function RowDots({ shown }: { shown: boolean }) {
  return (
    <TreeIconButton
      aria-label="More"
      onClick={(e) => {
        e.stopPropagation();
        const row = e.currentTarget.closest(".group\\/row") as HTMLElement | null;
        const box = (row ?? e.currentTarget).getBoundingClientRect();
        (row ?? e.currentTarget).dispatchEvent(new MouseEvent("contextmenu", {
          bubbles: true, clientX: box.right - 8, clientY: box.bottom,
        }));
      }}
      className={cn("size-[18px] rounded-[4px] text-[11px]", !shown && "invisible group-hover/row:visible")}
    >
      ⋯
    </TreeIconButton>
  );
}

function Row({
  node,
  depth,
  notFirstRoot,
  ...h
}: RowHandlers & {
  node: TreeNode;
  depth: number;
  /** Second+ roots get a 4px separation margin (deck F23). */
  notFirstRoot?: boolean;
}) {
  if (node.kind === "input") {
    return (
      <NameField
        depth={depth}
        initial={node.initial}
        placeholder={node.placeholder}
        error={h.nameError}
        onCommit={(v) => h.onCommitName?.(v)}
        onCancel={() => h.onCancelName?.()}
      />
    );
  }

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
          onClick={() => h.onRetry?.(node.id)}
          className="h-5 shrink-0 rounded-[5px] border border-border-strong px-[7px] text-[10.5px] text-text-secondary hover:bg-fill-hover"
        >
          Retry
        </button>
      </div>
    );
  }

  if (node.kind === "file") {
    const selected = node.id === h.selectedId;
    const deleted = node.git === "D";
    if (node.id === h.renamingId) {
      return (
        <NameField
          depth={depth}
          initial={node.name}
          placeholder="New name"
          error={h.nameError}
          onCommit={(v) => h.onCommitName?.(v)}
          onCancel={() => h.onCancelName?.()}
        />
      );
    }
    return (
      <RowMenu node={node} selected={selected} {...h}>
        <div className="group/row">
          <TreeRow
            depth={depth}
            name={node.name}
            selected={selected}
            dimmed={deleted}
            struck={deleted}
            className="w-full"
            icon={
              <DocGlyph
                size={13}
                strokeWidth={1.2}
                className={cn("shrink-0", deleted && !selected ? "text-current" : "text-text-subtle")}
              />
            }
            after={<></>}
            trailing={
              <span className="flex shrink-0 items-center gap-1">
                {node.git && <GitBadge letter={node.git} />}
                <RowDots shown={selected} />
              </span>
            }
            onClick={() => h.onSelect?.(node.id)}
          />
        </div>
      </RowMenu>
    );
  }

  // dir
  if (node.id === h.renamingId) {
    return (
      <NameField
        depth={depth}
        initial={node.name}
        placeholder="New name"
        error={h.nameError}
        onCommit={(v) => h.onCommitName?.(v)}
        onCancel={() => h.onCancelName?.()}
      />
    );
  }
  const selected = node.id === h.selectedId;
  return (
    <div>
      <RowMenu node={node} selected={selected} {...h}>
        <div className="group/row">
          <TreeFolderRow
            depth={depth}
            name={node.name}
            open={node.open}
            dimmed={node.empty}
            tint={node.hasChanges}
            className={cn("w-full", notFirstRoot && "mt-1")}
            after={
              <>
                {node.workspace && <span className="shrink-0 text-[10.5px] text-text-dimmer">workspace</span>}
                {node.empty && <span className="ml-1 text-[11px] italic text-text-dimmer">Empty</span>}
              </>
            }
            trailing={
              <span className="flex shrink-0 items-center gap-1">
                {node.hasChanges && (
                  <span title="Contains changes" className="size-[5px] rounded-full bg-text-subtle" />
                )}
                <RowDots shown={selected} />
              </span>
            }
            onClick={() => h.onToggleDir?.(node.id)}
          />
        </div>
      </RowMenu>
      {(node.children.length > 0 || node.open) && (
        <AccBody open={node.open}>
          <TreeGuide>
            {node.children.map((child) => (
              <Row key={child.id} node={child} depth={depth + 1} {...h} />
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
    <div data-chrome className={cn("flex h-full min-h-0 flex-col", p.className)}>
      <TreeHeader label={`Explorer · ${n} ${n === 1 ? "root" : "roots"}`}>
        <TreeIconButton aria-label="New file" title="New file" onClick={p.onNewFile}>
          <PlusGlyph size={13} />
        </TreeIconButton>
        <TreeIconButton aria-label="New folder" title="New folder" onClick={p.onNewFolder}>
          <FolderPlusGlyph size={13} />
        </TreeIconButton>
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
            renamingId={p.renamingId}
            nameError={p.nameError}
            onSelect={p.onSelect}
            onToggleDir={p.onToggleDir}
            onRetry={p.onRetry}
            onCommitName={p.onCommitName}
            onCancelName={p.onCancelName}
            onRename={p.onRename}
            onReveal={p.onReveal}
            onDelete={p.onDelete}
            onOpenInWeb={p.onOpenInWeb}
          />
        ))}
      </div>
    </div>
  );
}
