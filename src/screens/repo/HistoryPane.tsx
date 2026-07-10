/*
 * F25 (Deck 4) — the git pane under the vocabulary law: save / publish / bring down
 * in headlines, raw git only as small mono detail. Composed per L4 (Deck 6): it
 * replaces the content column — header row, then the 340px control column (save box ·
 * ready-to-save · changes · publish footer) beside the commit graph. Lane colours are
 * data (the mark palette); agent saves get the star mark. Presentational only.
 */
import { Input } from "@/components/ui/input";
import { BtnPrimary, Eyebrow } from "@/components/chrome/atoms";
import {
  AgentStarGlyph,
  CheckGlyph,
  ChevronDownGlyph,
  ChevronLeftGlyph,
  ChevronRightGlyph,
  ErrorGlyph,
  XGlyph,
} from "@/components/chrome/icons";
import { cn, sentence } from "@/lib/utils";
import { AccBody } from "@/screens/roadmap/bits";
import { GitBadge, type GitLetter } from "./FileTree";

/* ---- data types ---- */

export type SaveFile = { name: string; dir: string; path?: string }; // dir is the small mono detail; path = full repo path for callbacks
export type ChangeFile = { name: string; git?: GitLetter; path?: string };
export type ChangeGroup = { dir: string; open: boolean; files: ChangeFile[] };

export type PublishState =
  | { kind: "waiting"; label: string; behindLabel?: string } // "2 saves waiting to publish" · "Bring down 3 newer"
  | { kind: "published" } // "Everything is published"
  | { kind: "no-remote" } // "Not on GitHub yet" → copy the setup command
  | { kind: "never-published"; label: string }; // "Never published · 12 saves waiting"

export type CommitAuthor = { kind: "agent" } | { kind: "you"; initials: string };
export type CommitRef = { label: string; current?: boolean };
export type Commit = {
  subject: string;
  refs?: CommitRef[];
  author: CommitAuthor;
  hash: string;
  ago: string;
  /** Graph lane 0–4 — lane colour is data (mark palette). */
  lane: number;
  /** Older rows dim (deck: .68 / .55). */
  dim?: number;
};
/** A branch-out/merge-back arc: departs below fromRow's node, rejoins above toRow's. */
export type BranchArc = { lane: number; fromRow: number; toRow: number };

export type HistoryReady = {
  kind: "ready";
  /** Quiet error banner, e.g. the unfinished-publish line. */
  banner?: string;
  message: string;
  readyToSave: SaveFile[];
  changes: ChangeGroup[];
  publish: PublishState;
  commits: Commit[];
  branches?: BranchArc[];
  hasMore?: boolean;
};

export type HistoryPaneProps = {
  branch?: string;
  /** Where the back link returns to — "Repo" (Explorer entry) or "Roadmap". */
  backLabel?: string;
  state: { kind: "loading" } | { kind: "no-history" } | HistoryReady;
  onBack?: () => void;
  onCloseHistory?: () => void;
  onMessageChange?: (message: string) => void;
  onSave?: () => void;
  onSkip?: (path: string) => void;
  onToggleGroup?: (dir: string) => void;
  onInclude?: (path: string) => void;
  onDiscard?: (path: string) => void;
  onPush?: () => void;
  onPull?: () => void;
  onCopySetup?: () => void;
  onCommit?: (hash: string) => void;
  onShowMore?: () => void;
  onStartHistory?: () => void;
  className?: string;
};

/* ---- pieces ---- */

/* Deck F25/L4: trunk = mark-1, first branch = mark-3 (mark-2 is a near-trunk grey
 * and never used for a lane). */
const LANE_COLOR = [
  "var(--mark-1)",
  "var(--mark-3)",
  "var(--mark-4)",
  "var(--mark-5)",
  "var(--mark-6)",
] as const;

const ROW_H = 44;
const nodeY = (row: number) => 18 + ROW_H * row;

/** The lane SVG — geometry transcribed from the F25 specimen (trunk ±4px overhang,
 *  arcs depart 2px above a node and land 14px before the merge node). */
function GraphLanes({ commits, branches }: { commits: Commit[]; branches: BranchArc[] }) {
  const height = commits.length * ROW_H + 20;
  return (
    <svg width={46} height={height} viewBox={`0 0 46 ${height}`} className="shrink-0" aria-hidden>
      <path d={`M18 14v${height - 28}`} stroke={LANE_COLOR[0]} strokeWidth={1.4} />
      {branches.map((arc, i) => {
        const dx = 14 * arc.lane;
        const startY = nodeY(arc.fromRow) - 2;
        const landY = nodeY(arc.toRow) - 14;
        const v = landY - 24 - (startY + 24);
        return (
          <path
            key={i}
            d={`M18 ${startY}c0 14 ${dx} 10 ${dx} 24v${v}c0 14 ${-dx} 10 ${-dx} 24`}
            stroke={LANE_COLOR[Math.min(arc.lane, 4)]}
            strokeWidth={1.4}
            fill="none"
          />
        );
      })}
      {commits.map((c, i) => (
        <circle
          key={i}
          cx={18 + 14 * c.lane}
          cy={nodeY(i)}
          r={4}
          fill="var(--surface-app)"
          stroke={LANE_COLOR[Math.min(c.lane, 4)]}
          strokeWidth={1.6}
        />
      ))}
    </svg>
  );
}

function AuthorTile({ author }: { author: CommitAuthor }) {
  return (
    <span
      title={author.kind === "agent" ? "Agent save" : "You"}
      className="flex size-3.5 items-center justify-center rounded-[4px] bg-surface-card-raised text-[7.5px] font-semibold text-text-subtle"
    >
      {author.kind === "agent" ? <AgentStarGlyph size={8} /> : author.initials}
    </span>
  );
}

function CommitRow({ commit, onCommit }: { commit: Commit; onCommit?: (hash: string) => void }) {
  const current = commit.refs?.some((r) => r.current) ?? false;
  return (
    <button
      onClick={() => onCommit?.(commit.hash)}
      className="flex h-11 flex-col justify-center gap-0.5 pr-[18px] text-left"
      style={commit.dim != null ? { opacity: commit.dim } : undefined}
    >
      <div className="flex min-w-0 items-center gap-[7px]">
        <span
          className={cn(
            "overflow-hidden text-ellipsis whitespace-nowrap text-[12.5px]",
            current ? "text-text-primary" : "text-text-secondary",
          )}
        >
          {commit.subject}
        </span>
        {commit.refs?.map((ref) =>
          ref.current ? (
            <span
              key={ref.label}
              className="shrink-0 rounded-[4px] bg-selected-bg px-[5px] py-px font-mono text-[9.5px] text-selected-fg"
            >
              {ref.label}
            </span>
          ) : (
            <span
              key={ref.label}
              className="shrink-0 rounded-[4px] bg-fill-subtle px-[5px] font-mono text-[9.5px] text-text-subtle"
            >
              {ref.label}
            </span>
          ),
        )}
      </div>
      <div className="flex items-center gap-[7px]">
        <AuthorTile author={commit.author} />
        <span className="font-mono text-[10.5px] text-text-dim tabular-nums">
          {commit.hash} · {commit.ago}
        </span>
      </div>
    </button>
  );
}

/** Small bordered hover action (Skip / Include). */
function RowAction({ label, onClick }: { label: string; onClick?: () => void }) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
      className="h-[21px] shrink-0 rounded-[5px] border border-border-strong px-2 text-[10.5px] text-text-secondary opacity-0 hover:bg-fill-hover focus-visible:opacity-100 group-hover:opacity-100"
    >
      {label}
    </button>
  );
}

function PublishFooter({
  publish,
  onPush,
  onPull,
  onCopySetup,
}: {
  publish: PublishState;
  onPush?: () => void;
  onPull?: () => void;
  onCopySetup?: () => void;
}) {
  if (publish.kind === "published") {
    return (
      <div className="flex items-center gap-2 border-t border-divider px-[18px] py-3.5">
        <CheckGlyph size={12} className="shrink-0 text-state-success" />
        <span className="text-[12.5px] text-text-secondary">Everything is published</span>
      </div>
    );
  }
  if (publish.kind === "no-remote") {
    return (
      <div className="flex flex-col gap-2 border-t border-divider px-[18px] py-3.5">
        <div className="flex items-center gap-2">
          <span className="flex-1 text-[12.5px] text-text-secondary">Not on GitHub yet</span>
          <button
            onClick={onCopySetup}
            className="h-7 shrink-0 rounded-md border border-border-strong px-[11px] text-[11.5px] font-medium text-text-primary hover:bg-fill-hover"
          >
            Copy the setup command
          </button>
        </div>
        <div className="text-[11px] text-text-dim">
          Copies a command — paste it in the terminal. Chronicle doesn't create the online copy
          itself.
        </div>
      </div>
    );
  }
  if (publish.kind === "never-published") {
    return (
      <div className="flex items-center gap-2 border-t border-divider px-[18px] py-3.5">
        <span className="flex-1 text-[12.5px] text-text-secondary">{sentence(publish.label)}</span>
        <BtnPrimary onClick={onPush} className="h-7 shrink-0 px-[11px] text-[11.5px]">
          Publish online
        </BtnPrimary>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2 border-t border-divider px-[18px] py-3.5">
      <div className="flex items-center gap-2">
        <span className="flex-1 text-[12px] text-text-secondary">{sentence(publish.label)}</span>
        {publish.behindLabel && (
          <button
            onClick={onPull}
            className="h-[29px] shrink-0 rounded-md border border-border-strong px-[10px] text-[11.5px] font-medium text-text-primary hover:bg-fill-hover"
          >
            {sentence(publish.behindLabel)}
          </button>
        )}
        <BtnPrimary onClick={onPush} className="h-[29px] shrink-0 px-[10px] text-[11.5px]">
          Publish online
        </BtnPrimary>
      </div>
      <div className="text-[11px] text-text-dim">
        Publish runs <span className="font-mono">gh</span> for you and shows its progress here — it
        doesn't just copy a command.
      </div>
    </div>
  );
}

/* ---- the pane ---- */

export function HistoryPane(p: HistoryPaneProps) {
  const header = (
    <div className="flex items-center gap-[9px] border-b border-divider px-6 py-3">
      <button
        onClick={p.onBack}
        className="inline-flex items-center gap-[5px] text-[12.5px] text-text-muted hover:text-text-primary"
      >
        <ChevronLeftGlyph size={10} />
        {p.backLabel ?? "Repo"}
      </button>
      <span className="text-text-dimmer">/</span>
      <span className="text-sm font-semibold text-text-primary">Project history</span>
      {p.branch && (
        <span className="rounded-full bg-fill-subtle px-[9px] py-0.5 font-mono text-[10.5px] text-text-subtle">
          {p.branch}
        </span>
      )}
      <span className="flex-1" />
      <button
        aria-label="Close"
        onClick={p.onCloseHistory}
        className="flex size-[26px] items-center justify-center rounded-sm text-text-dim hover:bg-fill-hover hover:text-text-secondary"
      >
        <XGlyph size={10} />
      </button>
    </div>
  );

  if (p.state.kind === "loading") {
    return (
      <div className={cn("flex h-full flex-col", p.className)}>
        {header}
        <div className="flex flex-col gap-2.5 px-[18px] py-3.5">
          {(["60%", "82%", "47%"] as const).map((w, i) => (
            <div
              key={w}
              className="h-3 rounded-[4px] bg-fill-hover"
              style={{ width: w, animation: `wv-pulse 1.4s ease-in-out ${i * 0.15}s infinite` }}
            />
          ))}
        </div>
      </div>
    );
  }

  if (p.state.kind === "no-history") {
    return (
      <div className={cn("flex h-full flex-col", p.className)}>
        {header}
        <div className="flex flex-col gap-2.5 px-[18px] py-5">
          <div className="text-sm font-medium text-text-primary">No history yet</div>
          <div className="max-w-[44ch] text-[12.5px] leading-[1.55] text-text-muted">
            This folder isn't keeping a record of its changes. Starting one is safe and instant —
            it adds a hidden folder and touches nothing else.
          </div>
          <div>
            <BtnPrimary onClick={p.onStartHistory} className="h-8 px-[13px] text-[12.5px]">
              Start keeping history
            </BtnPrimary>
          </div>
        </div>
      </div>
    );
  }

  const s = p.state;
  const nothingToSave = s.readyToSave.length === 0 && s.changes.every((g) => g.files.length === 0);

  return (
    <div className={cn("flex h-full min-h-0 flex-col", p.className)}>
      {header}
      <div className="flex min-h-0 flex-1">
        {/* control column */}
        <div className="flex w-[340px] shrink-0 flex-col overflow-y-auto border-r border-divider">
          {s.banner && (
            <div className="mx-[18px] mt-3 flex items-center gap-[9px] rounded-md border border-border-hairline px-3 py-[9px]">
              <ErrorGlyph size={12} className="shrink-0 text-state-error" />
              <span className="text-[11.5px] text-state-error">{sentence(s.banner)}</span>
            </div>
          )}

          {/* save box */}
          <div className="flex flex-col gap-[9px] border-b border-divider px-[18px] py-3.5">
            <Input
              value={s.message}
              placeholder="What changed?"
              aria-label="Save message"
              onChange={(e) => p.onMessageChange?.(e.target.value)}
              className={cn(
                "h-9 rounded-md border-border-field bg-surface-input px-3 text-[12.5px] text-text-primary shadow-none placeholder:text-text-dimmer dark:bg-surface-input md:text-[12.5px]",
                "focus-visible:border-border-field-focus focus-visible:ring-0 focus-visible:[box-shadow:var(--focus-ring)]!",
              )}
            />
            <BtnPrimary
              onClick={p.onSave}
              disabled={s.message.trim() === "" || nothingToSave}
              className="h-[34px] w-full text-[12.5px]"
            >
              Save to history
            </BtnPrimary>
            {nothingToSave && (
              <div className="text-center text-[11.5px] text-text-subtle">
                Nothing to save · everything is recorded.
              </div>
            )}
          </div>

          {/* ready to save */}
          {s.readyToSave.length > 0 && (
            <div className="flex flex-col gap-1.5 border-b border-divider px-[18px] py-3">
              <div className="flex items-baseline justify-between">
                <Eyebrow>Ready to save</Eyebrow>
                <span className="font-mono text-[11px] text-text-dim tabular-nums">
                  {s.readyToSave.length} {s.readyToSave.length === 1 ? "file" : "files"}
                </span>
              </div>
              {s.readyToSave.map((f) => (
                <div
                  key={f.name}
                  className="group flex h-7 items-center gap-2 rounded-sm px-2 hover:bg-fill-subtle"
                >
                  <span className="text-[12.5px] text-text-primary">{f.name}</span>
                  <span className="font-mono text-[10.5px] text-text-dim">{f.dir}</span>
                  <span className="flex-1" />
                  <RowAction label="Skip" onClick={() => p.onSkip?.(f.path ?? f.name)} />
                </div>
              ))}
            </div>
          )}

          {/* changes */}
          {s.changes.length > 0 && (
            <div className="flex flex-col gap-1.5 border-b border-divider px-[18px] py-3">
              <div className="flex items-baseline justify-between">
                <Eyebrow>Changes</Eyebrow>
                <span className="font-mono text-[11px] text-text-dim tabular-nums">
                  {(() => {
                    const n = s.changes.reduce((sum, g) => sum + g.files.length, 0);
                    return `${n} ${n === 1 ? "file" : "files"}`;
                  })()}
                </span>
              </div>
              {s.changes.map((group) => (
                <div key={group.dir}>
                  <button
                    onClick={() => p.onToggleGroup?.(group.dir)}
                    className="flex h-[26px] w-full items-center gap-[7px] text-left text-text-muted"
                  >
                    {group.open ? (
                      <ChevronDownGlyph size={9} className="shrink-0 text-text-dim" />
                    ) : (
                      <ChevronRightGlyph size={9} className="shrink-0 text-text-dim" />
                    )}
                    <span className="font-mono text-[11.5px]">{group.dir}</span>
                    <span className="font-mono text-[10.5px] text-text-dimmer">
                      {group.files.length}
                    </span>
                  </button>
                  <AccBody open={group.open}>
                    <div className="flex flex-col gap-1.5 pt-1.5">
                    {group.files.map((f) => {
                      const deleted = f.git === "D";
                      return (
                        <div
                          key={f.name}
                          className="group flex h-7 items-center gap-2 rounded-sm pl-[22px] pr-2 hover:bg-fill-subtle"
                        >
                          <span
                            className={cn(
                              "text-[12.5px]",
                              deleted
                                ? "text-text-dim line-through"
                                : "text-text-secondary group-hover:text-text-primary",
                            )}
                          >
                            {f.name}
                          </span>
                          {f.git && <GitBadge letter={f.git} />}
                          <span className="flex-1" />
                          <RowAction label="Include" onClick={() => p.onInclude?.(f.path ?? f.name)} />
                          <button
                            aria-label={`Discard changes to ${f.name}`}
                            onClick={() => p.onDiscard?.(f.path ?? f.name)}
                            className="h-[21px] shrink-0 rounded-[5px] border border-border-hairline px-2 text-[10.5px] text-text-dim opacity-0 hover:border-border-strong hover:text-state-error focus-visible:opacity-100 group-hover:opacity-100"
                          >
                            Discard…
                          </button>
                        </div>
                      );
                    })}
                    </div>
                  </AccBody>
                </div>
              ))}
            </div>
          )}

          <span className="flex-1" />
          <PublishFooter
            publish={s.publish}
            onPush={p.onPush}
            onPull={p.onPull}
            onCopySetup={p.onCopySetup}
          />
        </div>

        {/* commit graph */}
        <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
          <div className="px-[18px] pb-1.5 pt-3.5">
            <Eyebrow>Saves</Eyebrow>
          </div>
          <div className="flex">
            <GraphLanes commits={s.commits} branches={s.branches ?? []} />
            <div className="flex min-w-0 flex-1 flex-col">
              {s.commits.map((commit) => (
                <CommitRow key={commit.hash} commit={commit} onCommit={p.onCommit} />
              ))}
            </div>
          </div>
          {s.hasMore && (
            <button
              onClick={p.onShowMore}
              className="mx-[18px] my-1.5 h-[30px] self-start rounded-md border border-border-hairline px-3.5 text-xs font-medium text-text-secondary hover:bg-fill-hover hover:text-text-primary"
            >
              Show more
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
