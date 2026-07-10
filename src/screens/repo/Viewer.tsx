/*
 * F24 (Deck 4) — the code/diff viewer: open-file tabs (2px underline bar), the
 * actions bar (mono path · Contents/Diff toggle · meta or ±stat · Copy contents),
 * the code view on surface-input with the tabular right-aligned gutter, the diff
 * view with its sticky hunk header and dual gutters, and the five freshness states
 * (changed-on-disk · read error · image · binary · huge-file guard). Errors are
 * never cached as content. Presentational only; values transcribed 1:1.
 */
import { StateWord } from "@/components/chrome/atoms";
import { ClockGlyph, CopyGlyph, ImageGlyph, XGlyph } from "@/components/chrome/icons";
import { cn } from "@/lib/utils";

/* ---- body content types ---- */

export type CodeSeg = { t: string; tone?: "dim" | "subtle" | "primary" };
/** One rendered line — an array of toned segments (empty array = blank line). */
export type CodeLine = CodeSeg[];

export type DiffRow =
  | { kind: "hunk"; header: string; context?: string } // "@@ -18,7 +18,15 @@" · "function Hero()"
  | { kind: "ctx" | "add" | "del"; old?: number; new?: number; text: string };

export type ViewerBody =
  | { kind: "code"; lines: CodeLine[] }
  | { kind: "diff"; rows: DiffRow[] }
  | { kind: "read-error"; message: string; detail: string } // "This file couldn't be read" · "EACCES · permission denied"
  | { kind: "image"; caption: string; src?: string } // "hero.png · 1440×960 · 212 KB" · src = data: URI when wired
  | { kind: "binary"; message: string; note: string; detail: string }
  | { kind: "huge"; message: string; note: string }; // "This file is 2.4 MB" · "Reading it may be slow."

export type ViewerTab = { id: string; name: string };

export type ViewerProps =
  | { kind: "empty"; className?: string } // "Select a file to read it"
  | {
      kind: "file";
      tabs: ViewerTab[];
      activeTabId: string;
      path: string;
      mode: "contents" | "diff";
      /** Contents-mode meta, e.g. "tsx · 96 lines". */
      meta?: string;
      /** Diff-mode stat, e.g. +12 −4. */
      diffStat?: { added: number; removed: number };
      /** "File changed on disk — Reload" bar. */
      changedOnDisk?: boolean;
      body: ViewerBody;
      onSelectTab?: (id: string) => void;
      onCloseTab?: (id: string) => void;
      onModeChange?: (mode: "contents" | "diff") => void;
      onCopy?: () => void;
      onReload?: () => void;
      onRetry?: () => void;
      onOpenAnyway?: () => void;
      className?: string;
    };

const TONE: Record<NonNullable<CodeSeg["tone"]>, string> = {
  dim: "text-text-dim",
  subtle: "text-text-subtle",
  primary: "text-text-primary",
};

function CodeView({ lines }: { lines: CodeLine[] }) {
  return (
    <div className="min-h-0 flex-1 overflow-auto bg-surface-input font-mono text-xs leading-[1.75]">
      <div className="flex min-h-full">
        <div
          aria-hidden
          className="w-11 select-none border-r border-divider-faint py-3 text-right text-text-dimmer tabular-nums"
        >
          {lines.map((_, i) => (
            <div key={i} className="pr-3">
              {i + 1}
            </div>
          ))}
        </div>
        <div className="min-w-0 px-4 py-3 text-text-secondary [overflow-wrap:anywhere]">
          {lines.map((line, i) => (
            <div key={i} className="whitespace-pre">
              {line.length === 0
                ? " "
                : line.map((seg, j) => (
                    <span key={j} className={seg.tone ? TONE[seg.tone] : undefined}>
                      {seg.t}
                    </span>
                  ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function DiffView({ rows }: { rows: DiffRow[] }) {
  return (
    <div className="min-h-0 flex-1 overflow-auto bg-surface-input font-mono text-xs leading-[1.75]">
      {rows.map((row, i) => {
        if (row.kind === "hunk") {
          return (
            <div
              key={i}
              className="sticky top-0 flex items-center gap-2 border-y border-divider-faint bg-surface-card-raised px-3.5 py-[5px] text-[11px] text-text-dim"
            >
              {row.header}
              {row.context && <span className="text-text-dimmer">{row.context}</span>}
            </div>
          );
        }
        return (
          <div
            key={i}
            className={cn(
              "flex",
              row.kind === "add" && "bg-[color-mix(in_srgb,var(--state-success)_9%,transparent)]",
              row.kind === "del" && "bg-[color-mix(in_srgb,var(--state-error)_10%,transparent)]",
            )}
          >
            <span
              aria-hidden
              className="flex w-[70px] shrink-0 select-none text-text-dimmer tabular-nums"
            >
              <span className="w-[35px] pr-2 text-right">{row.old ?? ""}</span>
              <span className="w-[35px] pr-2 text-right">{row.new ?? ""}</span>
            </span>
            {row.kind === "add" && <span className="text-state-success">{"+ "}</span>}
            {row.kind === "del" && <span className="text-state-error">{"− "}</span>}
            <span className="whitespace-pre text-text-secondary">{row.text}</span>
          </div>
        );
      })}
      <div className="h-2.5" />
    </div>
  );
}

/** The centred freshness states share the surface-input stage. */
function Stage({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "flex min-h-0 flex-1 flex-col items-center justify-center bg-surface-input",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function Viewer(p: ViewerProps) {
  if (p.kind === "empty") {
    return (
      <Stage className={p.className}>
        <span className="text-[12.5px] text-text-dim">Select a file to read it</span>
      </Stage>
    );
  }

  const showActions = p.body.kind === "code" || p.body.kind === "diff";

  return (
    <div className={cn("flex h-full min-w-0 flex-col", p.className)}>
      {/* open-file tabs */}
      <div className="flex items-center gap-0.5 border-b border-divider px-2.5 pt-2">
        {p.tabs.map((tab) =>
          tab.id === p.activeTabId ? (
            <div
              key={tab.id}
              className="relative flex h-8 items-center gap-2 px-3 text-[12.5px] font-medium text-text-primary"
            >
              {tab.name}
              <button
                aria-label={`Close ${tab.name}`}
                onClick={() => p.onCloseTab?.(tab.id)}
                className="flex size-4 items-center justify-center rounded-[4px] text-text-dim hover:bg-fill-hover"
              >
                <XGlyph size={8} />
              </button>
              <span className="absolute -bottom-px left-2 right-2 h-0.5 rounded-[1px] bg-text-primary" />
            </div>
          ) : (
            <button
              key={tab.id}
              onClick={() => p.onSelectTab?.(tab.id)}
              className="flex h-8 items-center gap-2 px-3 text-[12.5px] text-text-muted hover:text-text-secondary"
            >
              {tab.name}
            </button>
          ),
        )}
      </div>

      {/* actions bar */}
      {showActions && (
        <div className="flex items-center gap-3 border-b border-divider px-3.5 py-[9px]">
          <span className="overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[11.5px] text-text-dim">
            {p.path}
          </span>
          <span className="flex-1" />
          <div className="flex shrink-0 overflow-hidden rounded-lg border border-border-hairline">
            <button
              onClick={() => p.onModeChange?.("contents")}
              className={cn(
                "h-[26px] px-[11px] text-[11.5px]",
                p.mode === "contents"
                  ? "bg-fill-hover font-medium text-text-primary"
                  : "text-text-muted hover:text-text-primary",
              )}
            >
              Contents
            </button>
            <button
              onClick={() => p.onModeChange?.("diff")}
              className={cn(
                "h-[26px] border-l border-border-hairline px-[11px] text-[11.5px]",
                p.mode === "diff"
                  ? "bg-fill-hover font-medium text-text-primary"
                  : "text-text-muted hover:text-text-primary",
              )}
            >
              Diff
            </button>
          </div>
          {p.mode === "contents" && p.meta && (
            <span className="shrink-0 font-mono text-[11px] text-text-dim tabular-nums">
              {p.meta}
            </span>
          )}
          {p.mode === "diff" && p.diffStat && (
            <span className="shrink-0 font-mono text-[11px] tabular-nums">
              <span className="text-state-success">+{p.diffStat.added}</span>{" "}
              <span className="text-state-error">{"−"}{p.diffStat.removed}</span>
            </span>
          )}
          {p.mode === "contents" && (
            <button
              onClick={p.onCopy}
              className="inline-flex h-[26px] shrink-0 items-center gap-1.5 rounded-lg border border-border-strong px-2.5 text-[11.5px] font-medium text-text-secondary hover:bg-fill-hover"
            >
              <CopyGlyph size={11} />
              Copy contents
            </button>
          )}
        </div>
      )}

      {/* file changed on disk */}
      {p.changedOnDisk && (
        <div className="flex items-center gap-2.5 border-b border-divider bg-fill-subtle px-3.5 py-[7px]">
          <ClockGlyph size={12} className="shrink-0 text-text-subtle" />
          <span className="text-[11.5px] text-text-secondary">
            File changed on disk while you were reading.
          </span>
          <button
            onClick={p.onReload}
            className="h-[23px] rounded-md border border-border-strong px-[9px] text-[11px] font-medium text-text-primary hover:bg-fill-hover"
          >
            Reload
          </button>
        </div>
      )}

      {/* body */}
      {p.body.kind === "code" && <CodeView lines={p.body.lines} />}
      {p.body.kind === "diff" && <DiffView rows={p.body.rows} />}
      {p.body.kind === "read-error" && (
        <Stage className="gap-[9px] p-4 text-center">
          <StateWord kind="error" glyphSize={12} className="text-[12.5px]">
            {p.body.message}
          </StateWord>
          <span className="font-mono text-[11px] text-text-dim">{p.body.detail}</span>
          <button
            onClick={p.onRetry}
            className="h-7 rounded-lg border border-border-strong px-3 text-xs font-medium text-text-primary hover:bg-fill-hover"
          >
            Retry
          </button>
        </Stage>
      )}
      {p.body.kind === "image" && (
        <Stage className="gap-[9px]">
          {p.body.src ? (
            <img
              src={p.body.src}
              alt={p.body.caption}
              className="max-h-[60vh] max-w-[80%] rounded-lg border border-border-strong object-contain"
            />
          ) : (
            <div className="flex h-[74px] w-[110px] items-center justify-center rounded-lg border border-border-strong bg-surface-card-raised">
              <ImageGlyph size={22} className="text-text-dim" />
            </div>
          )}
          <span className="font-mono text-[11px] text-text-dim tabular-nums">{p.body.caption}</span>
        </Stage>
      )}
      {p.body.kind === "binary" && (
        <Stage className="gap-2 p-4 text-center">
          <span className="text-[12.5px] text-text-secondary">{p.body.message}</span>
          <span className="text-[11.5px] text-text-dim">
            {p.body.note} <span className="font-mono text-[11px]">{p.body.detail}</span>
          </span>
        </Stage>
      )}
      {p.body.kind === "huge" && (
        <Stage className="gap-[9px] p-4 text-center">
          <span className="text-[12.5px] text-text-secondary">{p.body.message}</span>
          <span className="text-[11.5px] text-text-dim">{p.body.note}</span>
          {p.onOpenAnyway && (
          <button
            onClick={p.onOpenAnyway}
            className="h-7 rounded-lg border border-border-strong px-3 text-xs font-medium text-text-primary hover:bg-fill-hover"
          >
            Open anyway
          </button>
          )}
        </Stage>
      )}
    </div>
  );
}
