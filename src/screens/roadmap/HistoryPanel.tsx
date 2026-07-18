/*
 * F18 (Deck 3) — the project-history panel: the sync pipeline (edits on disk → saved
 * to history → published online), milestone pills, the changed-files group. Custom
 * surface on the tokens. The arrow dash animates ONLY while saving/publishing is
 * active; frozen = the words carry the state. Presentational only.
 */
import { ArrowRightGlyph, CheckGlyph } from "@/components/chrome/icons";
import { cn } from "@/lib/utils";
import { TinyBadge } from "./bits";

export type HistoryStatus =
  | { kind: "waiting"; label: string } // e.g. "2 saves waiting to publish"
  | { kind: "published" } // "Everything published online" — the one success header
  | { kind: "untracked" }; // "not tracked yet"

export type PipelineNode = {
  label: string;
  count: string; // mono line under the label, e.g. "4 files" · "2 waiting" · "behind by 2"
  marker: "dot" | "done" | "pending";
  /** Clicking a stage opens the project-history pane. */
  onClick?: () => void;
};

export type ChangedFile = { path: string; badge: string };

export type HistoryPanelProps =
  | {
      kind: "panel";
      status: HistoryStatus;
      nodes: [PipelineNode, PipelineNode, PipelineNode];
      /** Dash animation per arrow — active only while that hop is in flight. */
      arrowsActive: [boolean, boolean];
      milestones: string[];
      files: ChangedFile[];
      /** "…and N more" footer row. */
      moreCount?: number;
      onViewDetails?: () => void;
      className?: string;
    }
  | { kind: "no-history"; onStartHistory?: () => void; className?: string };

function StatusWordmark({ status }: { status: HistoryStatus }) {
  if (status.kind === "published") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-state-success">
        <CheckGlyph size={11} />
        Everything published online
      </span>
    );
  }
  return (
    <span className="text-xs text-text-subtle">
      {status.kind === "waiting" ? status.label : "Not tracked yet"}
    </span>
  );
}

function NodeMarker({ marker }: { marker: PipelineNode["marker"] }) {
  if (marker === "done") return <CheckGlyph size={11} className="text-state-success" />;
  if (marker === "pending")
    return <span className="size-[9px] rounded-full border-[1.4px] border-border-strong" />;
  return <span className="size-[9px] rounded-full bg-state-neutral" />;
}

function PipelineArrow({ active }: { active: boolean }) {
  const stroke = active ? "var(--state-neutral)" : "var(--border-strong)";
  // stretches to fill the space between nodes — the dash is a repeating
  // gradient so it tiles at any width (an svg line would distort)
  return (
    <div className="flex min-w-[28px] flex-1 items-center px-1" aria-hidden>
      <span
        className="h-[1.4px] min-w-0 flex-1"
        style={{
          background: `repeating-linear-gradient(90deg, ${stroke} 0 5px, transparent 5px 12px)`,
          animation: active ? "wv-arrow 0.5s linear infinite" : undefined,
        }}
      />
      <svg width="9" height="14" viewBox="0 0 9 14" className="-ml-px shrink-0">
        <path d="m1.5 3.4 6 3.6-6 3.6" fill="none" stroke={stroke} strokeWidth="1.4" />
      </svg>
    </div>
  );
}

export function HistoryPanel(p: HistoryPanelProps) {
  if (p.kind === "no-history") {
    return (
      <div
        className={cn(
          "flex flex-col gap-2.5 py-[26px]",
          p.className,
        )}
      >
        <div className="text-sm font-medium text-text-primary">No history yet</div>
        <div className="text-[12.5px] leading-[1.5] text-text-muted">
          This folder isn't keeping a record of its changes. Starting one is safe — it only adds a
          hidden folder.
        </div>
        <button
          onClick={p.onStartHistory}
          className="inline-flex items-center gap-1.5 self-start text-[12.5px] font-medium text-text-primary"
        >
          <span className="underline underline-offset-2">Start keeping history</span>
          <ArrowRightGlyph size={11} className="shrink-0" />
        </button>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "py-[26px]",
        p.className,
      )}
    >
      <div className="flex items-center justify-between pb-[9px]">
        <span className="text-[15px] font-semibold text-text-primary">Project history</span>
        <StatusWordmark status={p.status} />
      </div>

      <div className="flex flex-col gap-3 pt-3">
        {/* pipeline — a quiet filled container, no outline */}
        <div className="flex items-center rounded-lg bg-surface-card px-3 py-3">
          {p.nodes.map((node, i) => (
            <div key={node.label} className="contents">
              {i > 0 && <PipelineArrow active={p.arrowsActive[(i - 1) as 0 | 1]} />}
              <button
                onClick={node.onClick}
                className="group flex min-w-0 flex-1 basis-0 flex-col items-center gap-1.5 rounded-md py-1 hover:bg-fill-subtle"
              >
                <div className="flex items-center gap-[7px]">
                  <NodeMarker marker={node.marker} />
                  <span
                    className={cn(
                      "text-[13px] group-hover:text-text-primary",
                      node.marker === "pending" ? "text-text-secondary" : "text-text-primary",
                    )}
                  >
                    {node.label}
                  </span>
                </div>
                <span className="font-mono text-[11.5px] text-text-dim tabular-nums">
                  {node.count}
                </span>
              </button>
            </div>
          ))}
        </div>

        {/* milestones — the row only exists when there are any */}
        {p.milestones.length > 0 && (
        <div className="flex items-center gap-2">
          <span className="text-[11.5px] text-text-dim">Milestones reached</span>
          {p.milestones.map((m) => (
            <span
              key={m}
              className="rounded-full bg-fill-subtle px-[9px] py-0.5 font-mono text-[10.5px] text-text-subtle"
            >
              {m}
            </span>
          ))}
        </div>
        )}

        {/* changed files — grouped list: fill-subtle block, divider-faint rows, no outer border */}
        <div className="flex flex-col overflow-hidden rounded-md bg-fill-subtle">
          {p.files.map((f, i) => (
            <div
              key={f.path}
              className={cn(
                "flex items-center gap-[9px] px-3 py-2",
                i < p.files.length - 1 && "border-b border-divider-faint",
              )}
            >
              <span className="flex-1 font-mono text-xs text-text-secondary">{f.path}</span>
              <TinyBadge>{f.badge}</TinyBadge>
            </div>
          ))}
          {p.moreCount != null && p.moreCount > 0 && (
            <div className="border-t border-divider-faint px-3 py-[7px] text-[11.5px] text-text-dim">
              …and {p.moreCount} more
            </div>
          )}
        </div>

        <button
          onClick={p.onViewDetails}
          className="h-[34px] w-full rounded-md border border-border-hairline text-[12.5px] font-medium text-text-secondary hover:bg-fill-hover hover:text-text-primary"
        >
          View details ›
        </button>
      </div>
    </div>
  );
}
