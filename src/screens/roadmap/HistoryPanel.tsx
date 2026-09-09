/*
 * The project-history section: four literal lines, each one a fact with its own
 * time. The pipeline, the milestone pills and the "N saves" number are gone —
 * every one of them was computed by subtraction and every one of them was wrong
 * on this repo (2026-09-10 audit). Nothing here fetches; "Check now" is the only
 * thing in the app that does, and it is a click.
 */
import { ArrowRightGlyph, CheckGlyph, ClockGlyph, RefreshGlyph, UploadGlyph } from "@/components/chrome/icons";
import type { DirtyBadge } from "@/lib/ipc";
import { cn } from "@/lib/utils";
import { TinyBadge } from "./bits";

export type HistoryLineFile = { path: string; badge: DirtyBadge };

export type RemoteLine =
  | { kind: "no-remote" }
  | { kind: "never-published" }
  | { kind: "counts"; ahead: number; behind: number; refName: string; checked: string; error?: string };

export type HistoryPanelProps =
  | { kind: "no-history"; onStartHistory?: () => void; className?: string }
  | { kind: "degraded"; className?: string }
  | {
      kind: "panel";
      lastSave: { ago: string; subject: string } | null;
      uncommitted: { files: HistoryLineFile[]; open: boolean };
      remote: RemoteLine;
      lastPublish: { ago: string; tag: string | null } | null;
      checking?: boolean;
      onCheckNow?: () => void;
      onToggleUncommitted?: () => void;
      onViewDetails?: () => void;
      className?: string;
    };

/** One row: a glyph, a label, and the fact. The label column is fixed so the
 *  four facts line up down the panel. */
function Line({ icon, label, children, onClick }: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
  onClick?: () => void;
}) {
  const body = (
    <>
      <span className="flex w-[13px] shrink-0 justify-center text-text-dim">{icon}</span>
      <span className="w-[86px] shrink-0 text-[12.5px] text-text-muted">{label}</span>
      <span className="flex min-w-0 flex-1 items-center gap-2 text-[12.5px] text-text-secondary">{children}</span>
    </>
  );
  if (!onClick) return <div className="flex items-center gap-2.5 py-[7px]">{body}</div>;
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2.5 rounded-md py-[7px] text-left hover:bg-fill-subtle"
    >
      {body}
    </button>
  );
}

export function HistoryPanel(p: HistoryPanelProps) {
  if (p.kind === "no-history") {
    return (
      <div className={cn("flex flex-col gap-2.5 py-[26px]", p.className)}>
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

  if (p.kind === "degraded") {
    return (
      <div className={cn("flex flex-col gap-2.5 py-[26px]", p.className)}>
        <div className="text-sm font-medium text-text-primary">Can't read git</div>
        <div className="text-[12.5px] leading-[1.5] text-text-muted">
          Chronicle couldn't run git here, so it has nothing true to tell you about this project's
          history. Open a terminal and check that <span className="font-mono text-[11.5px]">git</span> works.
        </div>
      </div>
    );
  }

  const files = p.uncommitted.files;

  return (
    <div className={cn("py-[26px]", p.className)}>
      <div className="pb-1.5 text-[15px] font-semibold text-text-primary">Project history</div>

      <div className="flex flex-col divide-y divide-divider-faint">
        {/* 1 — last save */}
        <Line icon={<ClockGlyph size={12} />} label="Last save">
          {p.lastSave ? (
            <>
              <span className="shrink-0 tabular-nums">{p.lastSave.ago}</span>
              <span className="min-w-0 truncate font-mono text-[11.5px] text-text-dim" title={p.lastSave.subject}>
                {p.lastSave.subject}
              </span>
            </>
          ) : (
            <span className="text-text-dim">nothing saved yet</span>
          )}
        </Line>

        {/* 2 — uncommitted */}
        <div>
          <Line
            icon={<CheckGlyph size={11} className={files.length === 0 ? "text-state-success" : undefined} />}
            label="Uncommitted"
            onClick={files.length > 0 ? p.onToggleUncommitted : undefined}
          >
            {files.length === 0 ? (
              <span className="text-text-dim">Everything saved</span>
            ) : (
              <span className="tabular-nums">
                {files.length} file{files.length === 1 ? "" : "s"}
              </span>
            )}
          </Line>
          {p.uncommitted.open && files.length > 0 && (
            <div className="mb-2 ml-[110px] flex flex-col overflow-hidden rounded-md bg-fill-subtle">
              {files.map((f, i) => (
                <div
                  key={f.path}
                  className={cn(
                    "flex items-center gap-[9px] px-3 py-1.5",
                    i < files.length - 1 && "border-b border-divider-faint",
                  )}
                >
                  <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-text-secondary" title={f.path}>
                    {f.path}
                  </span>
                  <TinyBadge>{f.badge}</TinyBadge>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 3 — the remote, as of the last fetch */}
        <Line icon={<UploadGlyph size={12} />} label="Remote">
          {p.remote.kind === "no-remote" && <span className="text-text-dim">not on GitHub</span>}
          {p.remote.kind === "never-published" && <span className="text-text-dim">never published</span>}
          {p.remote.kind === "counts" && (
            <>
              <span className="shrink-0 tabular-nums">
                {p.remote.ahead} ahead · {p.remote.behind} behind
              </span>
              <span className="min-w-0 truncate font-mono text-[11.5px] text-text-dim">{p.remote.refName}</span>
              <span className="shrink-0 text-[11.5px] text-text-dimmer">· checked {p.remote.checked}</span>
              {p.remote.error && (
                <span className="min-w-0 truncate text-[11.5px] text-state-error" title={p.remote.error}>
                  {p.remote.error}
                </span>
              )}
            </>
          )}
          <span className="flex-1" />
          {p.remote.kind !== "no-remote" && (
            <button
              onClick={p.onCheckNow}
              disabled={p.checking}
              className="inline-flex h-[23px] shrink-0 items-center gap-1.5 rounded-sm border border-border-strong px-[9px] text-[11px] font-medium text-text-primary hover:bg-fill-hover disabled:text-text-dim"
            >
              <RefreshGlyph size={10} className={cn("shrink-0", p.checking && "animate-spin")} />
              {p.checking ? "Checking" : "Check now"}
            </button>
          )}
        </Line>

        {/* 4 — last publish */}
        <Line icon={<UploadGlyph size={12} />} label="Last publish">
          {p.lastPublish ? (
            <>
              <span className="shrink-0 tabular-nums">{p.lastPublish.ago}</span>
              {p.lastPublish.tag && (
                <span className="rounded-full bg-fill-subtle px-[9px] py-0.5 font-mono text-[10.5px] text-text-subtle">
                  {p.lastPublish.tag}
                </span>
              )}
            </>
          ) : (
            <span className="text-text-dim">never published</span>
          )}
        </Line>
      </div>

      <button
        onClick={p.onViewDetails}
        className="mt-3 h-[34px] w-full rounded-md border border-border-hairline text-[12.5px] font-medium text-text-secondary hover:bg-fill-hover hover:text-text-primary"
      >
        View details ›
      </button>
    </div>
  );
}
