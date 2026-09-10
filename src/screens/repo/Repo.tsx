/*
 * The repo pane composition (Deck 6 · L3/L4): tree · splitter · viewer, full-bleed in
 * the content column — flush, no outer chrome (operator rule). The history route
 * REPLACES the whole content column (L4). Presentational; the splitter emits a
 * pointer-down for the host to drive.
 */
import type { PointerEvent as ReactPointerEvent } from "react";
import { cn } from "@/lib/utils";
import { SplitHandle } from "@/components/chrome/SplitHandle";
import { FileTree, type FileTreeProps } from "./FileTree";
import { HistoryPane, type HistoryPaneProps } from "./HistoryPane";
import { Viewer, type ViewerProps } from "./Viewer";

export type RepoView =
  | { kind: "files"; tree: FileTreeProps; viewer: ViewerProps }
  | { kind: "history"; history: HistoryPaneProps };

export type RepoProps = {
  view: RepoView;
  /** Tree column width (L3: 230px). */
  treeWidth?: number;
  onTreeSplitterDown?: (e: ReactPointerEvent<HTMLDivElement>) => void;
  className?: string;
};

export function Repo({ view, treeWidth = 230, onTreeSplitterDown, className }: RepoProps) {
  if (view.kind === "history") {
    return (
      <div className={cn("h-full min-h-0", className)}>
        <HistoryPane {...view.history} />
      </div>
    );
  }

  return (
    <div className={cn("flex h-full min-h-0", className)}>
      <div className="shrink-0 border-r border-divider" style={{ width: treeWidth }}>
        <FileTree {...view.tree} />
      </div>
      <SplitHandle aria-label="Resize the file tree" onPointerDown={onTreeSplitterDown} />
      <Viewer {...view.viewer} className={cn("min-w-0 flex-1", view.viewer.className)} />
    </div>
  );
}
