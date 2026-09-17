/* The History panel (comps board 7, `b_history`): a timeline of one snapshot per
   design turn, newest first, replacing the thread while open (Task 19). Clicking a
   row compares it against the newest version — DesignCanvas draws the split view
   (DesignCompare). The footer restores or branches from whatever is compared. */
import { useEffect, useState, type MouseEvent as ReactMouseEvent } from "react";
import { ago } from "@/lib/roadmap-data";
import { BtnPrimary, BtnSecondary } from "@/components/chrome/atoms";
import { XGlyph } from "@/components/chrome/icons";
import { branchVersion, designProjectFor, restoreVersion, setCompare, subscribeDesigns, type DesignProject } from "@/lib/design-store";
import type { VersionMeta } from "@/lib/ipc";
import { toastError, toastSuccess } from "@/overlays/toasts";
import { cn } from "@/lib/utils";

/** A plain-language relative time from an ISO timestamp; blank for a bad one
 *  (older/local snapshots) rather than a nonsense "NaN months ago". */
function relTime(at: string): string {
  const ms = Date.parse(at);
  return Number.isFinite(ms) ? ago(Date.now(), Math.floor(ms / 1000)) : "";
}

function HistoryRow({ v, first, last, current, compared, onClick, onHoverStart, onHoverEnd }: {
  v: VersionMeta; first: boolean; last: boolean; current: boolean; compared: boolean;
  onClick: () => void;
  /** the row's own bounding rect, for the floating thumbnail HistoryPanel positions */
  onHoverStart: (e: ReactMouseEvent<HTMLDivElement>) => void;
  onHoverEnd: () => void;
}) {
  return (
    <div className={cn("flex gap-2.5 px-4", compared && "bg-fill-hover")} onMouseEnter={onHoverStart} onMouseLeave={onHoverEnd}>
      <div className="flex w-2.5 shrink-0 flex-col items-center" aria-hidden="true">
        <span className="w-px" style={{ height: 12, background: first ? "transparent" : "var(--border-strong)" }} />
        <span
          className="size-[9px] shrink-0 rounded-full"
          style={current ? { background: "var(--text-primary)" } : { border: "1.5px solid var(--text-muted)", boxSizing: "border-box" }}
        />
        <span className="w-px flex-1" style={{ background: last ? "transparent" : "var(--border-strong)" }} />
      </div>
      <button
        type="button"
        onClick={onClick}
        aria-pressed={compared}
        className="flex min-w-0 flex-1 flex-col gap-[3px] py-2 text-left outline-none focus-visible:[box-shadow:var(--focus-ring)]"
      >
        <span className="flex items-center gap-2">
          <span className="font-mono text-[11px] text-text-secondary">v{v.n}</span>
          <span className="text-[11px] text-text-faint">{relTime(v.at)}</span>
          <span className="flex-1" />
          {compared && (
            <span className="inline-flex h-5 shrink-0 items-center rounded-md bg-fill-subtle px-[7px] text-[11px] text-text-subtle">comparing</span>
          )}
        </span>
        <span className="truncate text-[12.5px] text-text-primary">{v.summary || `Restored v${v.n}`}</span>
      </button>
    </div>
  );
}

function thumbFor(p: DesignProject, slug: string, n: number): string | null {
  const firstFrameId = p.design?.frames[0]?.id;
  return p.base && firstFrameId ? `${p.base}${slug}/.versions/v${n}/thumbs/${firstFrameId}.png` : null;
}

export function HistoryPanel({ dir, onClose }: { dir: string; onClose: () => void }) {
  const [, bump] = useState(0);
  useEffect(() => subscribeDesigns(() => bump((n) => n + 1)), []);
  const [busy, setBusy] = useState(false);
  // A row's thumbnail preview floats over the canvas, to the panel's left — as a
  // `fixed` overlay owned here rather than drawn inside each row, since the
  // scrollable list below clips anything absolute that crosses its own edge.
  const [hover, setHover] = useState<{ top: number; left: number; src: string } | null>(null);
  // Keyed by URL, not a DOM mutation — see DesignCompare's `failed` state for why.
  const [thumbFailed, setThumbFailed] = useState<Set<string>>(() => new Set());
  const p = designProjectFor(dir);
  const slug = p.active;
  const versions = p.versions;
  const newest = versions[0]?.n ?? null;
  const compare = p.compare;

  const doRestore = async (n: number) => {
    setBusy(true);
    try { await restoreVersion(dir, n); }
    catch (e) { toastError("Couldn't restore that version", String((e as Error)?.message ?? e).slice(0, 90)); }
    finally { setBusy(false); }
  };
  const doBranch = async (n: number) => {
    setBusy(true);
    try {
      const copySlug = await branchVersion(dir, n);
      const title = designProjectFor(dir).rows.find((r) => r.slug === copySlug)?.title ?? copySlug;
      toastSuccess(`Opened ${title}`);
    } catch (e) { toastError("Couldn't branch from that version", String((e as Error)?.message ?? e).slice(0, 90)); }
    finally { setBusy(false); }
  };

  return (
    <div className="flex w-[392px] shrink-0 flex-col border-l border-border-hairline bg-surface-panel">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border-hairline py-0 pr-3 pl-4">
        <span className="text-[12.5px] font-semibold text-text-primary">History</span>
        <span className="text-[11.5px] text-text-faint">one snapshot per turn</span>
        <span className="flex-1" />
        <button
          type="button"
          aria-label="Close history"
          onClick={onClose}
          className="flex size-6 items-center justify-center rounded-md text-text-faint outline-none hover:bg-fill-hover hover:text-text-primary focus-visible:[box-shadow:var(--focus-ring)]"
        >
          <XGlyph size={9} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto py-1.5">
        {versions.length === 0 ? (
          <p className="px-4 py-3.5 text-[11.5px] leading-relaxed text-text-faint">
            No versions yet. The first one is saved when the design session finishes a turn.
          </p>
        ) : (
          versions.map((v, i) => {
            const thumb = slug ? thumbFor(p, slug, v.n) : null;
            return (
              <HistoryRow
                key={v.n}
                v={v}
                first={i === 0}
                last={i === versions.length - 1}
                current={v.n === newest}
                compared={compare === v.n}
                onClick={() => setCompare(dir, v.n)}
                onHoverStart={(e) => {
                  if (!thumb) return;
                  const r = e.currentTarget.getBoundingClientRect();
                  setHover({ top: r.top + r.height / 2, left: r.left, src: thumb });
                }}
                onHoverEnd={() => setHover(null)}
              />
            );
          })
        )}
      </div>
      {compare != null && compare !== newest && (
        <div className="flex flex-col gap-2 border-t border-border-hairline p-4">
          <span className="text-[11.5px] leading-relaxed text-text-muted">
            Restoring makes v{compare} the newest version. Nothing is deleted, and the files stay in this project.
          </span>
          <div className="flex gap-2">
            <BtnPrimary size="md" disabled={busy} onClick={() => void doRestore(compare)}>Restore v{compare}</BtnPrimary>
            <BtnSecondary size="md" disabled={busy} onClick={() => void doBranch(compare)}>Branch from v{compare}</BtnSecondary>
          </div>
        </div>
      )}
      {hover && (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed z-50 w-[150px] -translate-x-full -translate-y-1/2 overflow-hidden rounded-md border border-border-strong bg-surface-overlay p-1 [box-shadow:var(--shadow-overlay)]"
          style={{ top: hover.top, left: hover.left - 8 }}
        >
          {thumbFailed.has(hover.src) ? (
            <div className="flex h-[96px] w-full items-center justify-center rounded-[2px] bg-fill-subtle text-center text-[11px] text-text-faint">
              Not in this version
            </div>
          ) : (
            <img
              src={hover.src}
              alt=""
              className="block h-[96px] w-full rounded-[2px] object-cover object-top"
              onError={() => setThumbFailed((s) => (s.has(hover.src) ? s : new Set(s).add(hover.src)))}
            />
          )}
        </div>
      )}
    </div>
  );
}
