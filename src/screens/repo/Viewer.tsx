import * as React from "react";
/*
 * F24 (Deck 4) — the code/diff viewer: open-file tabs (2px underline bar), the
 * actions bar (mono path · Contents/Diff toggle · meta or ±stat · Copy contents),
 * the editable text body on surface-input, the diff view with its sticky hunk
 * header and dual gutters, and the freshness states (the conflict bar ·
 * changed-on-disk · read error · image · binary · huge-file guard). Errors are
 * never cached as content. Presentational only; values transcribed 1:1.
 *
 * The editor itself is loaded lazily: CodeMirror is the biggest thing the app
 * ships, and a session that never opens a file should never pay for it.
 */
import { StateWord } from "@/components/chrome/atoms";
import { TabStrip } from "@/components/chrome/TabStrip";
import { ClockGlyph, CopyGlyph, ImageGlyph } from "@/components/chrome/icons";
import type { LangId } from "@/lib/repo-editor";
import { cn } from "@/lib/utils";

const CodeEditor = React.lazy(() => import("./CodeEditor"));

/* ---- body content types ---- */

export type DiffRow =
  | { kind: "hunk"; header: string; context?: string } // "@@ -18,7 +18,15 @@" · "function Hero()"
  | { kind: "ctx" | "add" | "del"; old?: number; new?: number; text: string };

export type ViewerBody =
  | { kind: "text"; docKey: string; text: string; language: LangId; readOnly: boolean; tabSize: number }
  | { kind: "diff"; rows: DiffRow[] }
  | { kind: "read-error"; message: string; detail: string } // "This file couldn't be read" · "EACCES · permission denied"
  | { kind: "image"; caption: string; src?: string } // "hero.png · 1440×960 · 212 KB" · src = data: URI when wired
  | { kind: "binary"; message: string; note: string; detail: string }
  | { kind: "huge"; message: string; note: string }; // "This file is 2.4 MB" · "Reading it may be slow."

export type ViewerTab = { id: string; name: string; dirty?: boolean };

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
      /** These changes are already included for the next save. */
      readyToSave?: boolean;
      /** Diff-mode stat, e.g. +12 −4. */
      diffStat?: { added: number; removed: number };
      /** "File changed on disk — Reload" bar. */
      changedOnDisk?: boolean;
      /** "unsaved" | "saving" | "saved · 3s ago" | the OS error sentence. */
      saveLabel?: string;
      /** The file moved on disk while the buffer was dirty — the bar, never a toast. */
      conflict?: boolean;
      onSave?: () => void;
      onEdit?: (text: string) => void;
      onKeepMine?: () => void;
      onReloadFromDisk?: () => void;
      /** F36 — reviewing the agent's changes: the per-file action bar. */
      review?: {
        progress: string; // "2 of 4 reviewed"
        /** changed by the agent's commands — no per-file undo, only Keep */
        viaCommand: boolean;
        onKeep: () => void;
        onUndo?: () => void;
      };
      body: ViewerBody;
      onSelectTab?: (id: string) => void;
      onCloseTab?: (id: string) => void;
      onModeChange?: (mode: "contents" | "diff") => void;
      onCopy?: () => void;
      onReload?: () => void;
      onRetry?: () => void;
      onOpenAnyway?: () => void;
      onOpenInWeb?: () => void;
      className?: string;
    };

function DiffView({ rows }: { rows: DiffRow[] }) {
  return (
    <div data-selectable className="min-h-0 flex-1 overflow-auto bg-surface-input font-mono text-xs leading-[1.75]">
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
            <span className="min-w-0 flex-1 whitespace-pre-wrap text-text-secondary [overflow-wrap:anywhere]">{row.text}</span>
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

  const showActions = p.body.kind === "text" || p.body.kind === "diff";

  return (
    <div className={cn("flex h-full min-w-0 flex-col", p.className)}>
      {/* open-file tabs */}
      <TabStrip
        label="Open files"
        tabs={p.tabs.map((tab) => ({ id: tab.id, label: tab.name, dot: tab.dirty ? ("dirty" as const) : undefined }))}
        activeId={p.activeTabId}
        onSelect={p.onSelectTab}
        onClose={p.onCloseTab}
      />

      {/* actions bar */}
      {showActions && (
        <div data-chrome className="flex items-center gap-3 border-b border-divider px-3.5 py-[9px]">
          <span className="overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[11.5px] text-text-dim">
            {p.path}
          </span>
          <span className="flex-1" />
          <div className="flex shrink-0 overflow-hidden rounded-md border border-border-hairline">
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
              Changes
            </button>
          </div>
          {p.onOpenInWeb && (
            <button onClick={p.onOpenInWeb} className="h-[26px] rounded-md border border-border-hairline px-[11px] text-[11.5px] text-text-muted hover:text-text-primary">
              Open in Web
            </button>
          )}
          {p.mode === "contents" && p.meta && (
            <span className="shrink-0 font-mono text-[11px] text-text-dim tabular-nums">
              {p.meta}
            </span>
          )}
          {p.mode === "contents" && p.saveLabel && (
            <span
              className={cn(
                "shrink-0 text-[11.5px]",
                p.saveLabel === "unsaved" ? "text-state-warn" : "text-text-dim",
              )}
            >
              {p.saveLabel}
            </span>
          )}
          {p.mode === "diff" && p.diffStat && (
            <span className="shrink-0 font-mono text-[11px] tabular-nums">
              {p.readyToSave && <span className="pr-2 font-sans text-text-dim">Ready to save ·</span>}
              <span className="text-state-success">+{p.diffStat.added}</span>{" "}
              <span className="text-state-error">{"−"}{p.diffStat.removed}</span>
            </span>
          )}
        </div>
      )}

      {/* F36 — the review action bar (amends the shipped viewer) */}
      {p.review && (
        <div data-review-bar className="flex items-center gap-[9px] border-b border-divider bg-fill-subtle px-3.5 py-2">
          {p.review.viaCommand ? (
            <span className="text-[11.5px] text-text-dim">
              changed by a command — covered by Undo to here
            </span>
          ) : (
            <span className="text-[11.5px] text-text-muted">Reviewing the agent's changes</span>
          )}
          <span className="shrink-0 font-mono text-[10.5px] text-text-dim tabular-nums">{p.review.progress}</span>
          <span className="flex-1" />
          {p.review.onUndo && (
            <button
              onClick={p.review.onUndo}
              className="h-[26px] shrink-0 rounded-md border border-border-strong px-[11px] text-[11.5px] font-medium text-text-primary hover:bg-fill-hover"
            >
              Undo this file
            </button>
          )}
          <button
            onClick={p.review.onKeep}
            className="h-[26px] shrink-0 rounded-md bg-primary px-3 text-[11.5px] font-medium text-primary-foreground hover:bg-[--primary-hover]"
          >
            Keep
          </button>
        </div>
      )}

      {/* the file moved on disk under an unsaved buffer — never a silent overwrite */}
      {p.conflict && (
        <div data-chrome className="flex items-center gap-2.5 border-b border-divider bg-fill-subtle px-3.5 py-[7px]">
          <ClockGlyph size={12} className="shrink-0 text-text-subtle" />
          <span className="text-[11.5px] text-text-secondary">
            This file changed on disk while you were editing it.
          </span>
          <span className="flex-1" />
          <button
            onClick={p.onReloadFromDisk}
            className="h-[23px] rounded-sm border border-border-strong px-[9px] text-[11px] font-medium text-text-primary hover:bg-fill-hover"
          >
            Reload
          </button>
          <button
            onClick={p.onKeepMine}
            className="h-[23px] rounded-sm bg-primary px-[9px] text-[11px] font-medium text-primary-foreground hover:bg-(--primary-hover)"
          >
            Keep mine
          </button>
        </div>
      )}

      {/* a clean file that moved on disk reloads itself — this bar is only for
          the Changes view, where there is no buffer to reconcile */}
      {p.changedOnDisk && !p.conflict && (
        <div data-chrome className="flex items-center gap-2.5 border-b border-divider bg-fill-subtle px-3.5 py-[7px]">
          <ClockGlyph size={12} className="shrink-0 text-text-subtle" />
          <span className="text-[11.5px] text-text-secondary">
            File changed on disk while you were reading.
          </span>
          <button
            onClick={p.onReload}
            className="h-[23px] rounded-sm border border-border-strong px-[9px] text-[11px] font-medium text-text-primary hover:bg-fill-hover"
          >
            Reload
          </button>
        </div>
      )}

      {/* body */}
      {p.body.kind === "text" && (
        <React.Suspense
          fallback={
            <Stage>
              <span className="text-[12.5px] text-text-dim">Loading editor…</span>
            </Stage>
          }
        >
          <CodeEditor
            docKey={p.body.docKey}
            text={p.body.text}
            language={p.body.language}
            readOnly={p.body.readOnly}
            tabSize={p.body.tabSize}
            onChange={p.onEdit}
            onSave={p.onSave}
          />
        </React.Suspense>
      )}
      {p.body.kind === "diff" && <DiffView rows={p.body.rows} />}
      {p.body.kind === "read-error" && (
        <Stage className="gap-[9px] p-4 text-center">
          <StateWord kind="error" glyphSize={12} className="text-[12.5px]">
            {p.body.message}
          </StateWord>
          <span className="font-mono text-[11px] text-text-dim">{p.body.detail}</span>
          <button
            onClick={p.onRetry}
            className="h-7 rounded-md border border-border-strong px-3 text-xs font-medium text-text-primary hover:bg-fill-hover"
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
              className="max-h-[60vh] max-w-[80%] rounded-md border border-border-strong object-contain"
            />
          ) : (
            <div className="flex h-[74px] w-[110px] items-center justify-center rounded-md border border-border-strong bg-surface-card-raised">
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
          {p.onCopy && !p.body.note.includes("or copy") && (
            <button
              onClick={p.onCopy}
              className="h-7 rounded-md border border-border-strong px-3 text-xs font-medium text-text-secondary hover:bg-fill-hover hover:text-text-primary"
            >
              Copy the contents
            </button>
          )}
          {p.onOpenAnyway && (
          <button
            onClick={p.onOpenAnyway}
            className="h-7 rounded-md border border-border-strong px-3 text-xs font-medium text-text-primary hover:bg-fill-hover"
          >
            Open anyway
          </button>
          )}
        </Stage>
      )}
      {/* bottom bar (operator: copy lives down here, out of the reading path) */}
      {p.mode === "contents" && p.body.kind === "text" && (
        <div className="flex items-center justify-end border-t border-divider px-3.5 py-[7px]">
          <button
            onClick={p.onCopy}
            className="inline-flex h-[26px] shrink-0 items-center gap-1.5 rounded-md border border-border-strong px-2.5 text-[11.5px] font-medium text-text-secondary hover:bg-fill-hover"
          >
            <CopyGlyph size={11} />
            Copy contents
          </button>
        </div>
      )}
    </div>
  );
}
