/*
 * Breadcrumb rename, the status pill, save state, the conflict bar, and the
 * ⋯ menu (mock frame 1 and 2's header row).
 */
import { useState } from "react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
  DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { BtnPrimary, BtnSecondary } from "@/components/chrome/atoms";
import { pillFor, statusInFront } from "@/lib/notes-model";
import { deleteNote, keepMine, openRoundFor, reloadOpen, renameNote, roundGenerating, setStatus, type OpenNote } from "@/lib/notes-store";
import { copyText, runCommand, type NoteEntry, type NoteStatus } from "@/lib/ipc";
import { toastError, toastSuccess } from "@/overlays/toasts";
import type { ConfirmSpec } from "@/overlays/ConfirmDialog";
import { cn } from "@/lib/utils";

/** What the header says on the right. `now` is passed in so the function stays pure. */
export function saveLabel(open: OpenNote, now: number): string {
  if (open.state === "locked") return "locked by the round";
  if (open.state === "saving") return "saving";
  if (open.state === "error") return open.error ?? "couldn't save";
  if (open.state === "dirty") return "unsaved";
  if (open.savedAt === null) return "";
  // no timer just to age a label: the heartbeat is the only thing that
  // re-renders on its own, so the wording never claims more precision than
  // the next render can honour
  const mins = Math.floor(Math.max(0, now - open.savedAt) / 60_000);
  if (mins < 1) return "saved";
  if (mins < 60) return `saved · ${mins}m ago`;
  return `saved · ${Math.round(mins / 60)}h ago`;
}

const STATUS_ROWS: { value: NoteStatus | null; label: string }[] = [
  { value: null, label: "no status" },
  { value: "queued", label: "queued" },
  { value: "in_progress", label: "in progress" },
  { value: "done", label: "done" },
];

const PILL_TONE: Record<string, string> = {
  none: "border-border-hairline text-text-dim",
  queued: "border-state-warn text-state-warn",
  progress: "border-border-strong text-text-primary",
  done: "border-border-strong text-text-secondary",
  unknown: "border-border-hairline text-text-dim",
};

function sanitizeTitle(raw: string): string {
  return raw.replace(/[/\\:*?"<>|]/g, "-").replace(/-{2,}/g, "-").trim().replace(/^-+|-+$/g, "").slice(0, 80).trim();
}

export function NoteHeader({
  dir, path, entry, open, notes, onConfirm,
}: {
  dir: string;
  path: string;
  entry: NoteEntry | undefined;
  open: OpenNote;
  notes: NoteEntry[];
  onConfirm: (spec: ConfirmSpec) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);

  const folder = entry?.folder ?? (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");
  const title = entry?.title ?? (path.split("/").pop() ?? path).replace(/\.md$/, "");
  const filename = path.split("/").pop() ?? path;

  const roundState = entry?.round == null
    ? null
    : roundGenerating(dir)
      ? "generating"
      : openRoundFor(dir)?.n === entry.round
        ? "ready"
        : null;
  const pill = pillFor(statusInFront(open.front), entry?.round ?? null, roundState);

  const folders = [...new Set(notes.map((n) => n.folder))].sort();
  if (!folders.includes("")) folders.unshift("");

  const commitRename = () => {
    const clean = editing === null ? "" : sanitizeTitle(editing);
    setEditing(null);
    if (!clean || clean === title) return;
    const to = folder ? `${folder}/${clean}.md` : `${clean}.md`;
    renameNote(dir, path, to).catch((e) => toastError("Couldn't rename it", String(e).slice(0, 90)));
  };

  return (
    <div className="flex flex-none flex-col">
      {open.conflict && (
        <div className="flex items-center gap-3 border-b border-border-hairline bg-fill-subtle px-4 py-2">
          <span className="text-[12px] text-text-primary">This note changed on disk.</span>
          <span className="flex-1" />
          <BtnSecondary size="sm" onClick={() => reloadOpen(dir)}>Reload</BtnSecondary>
          <BtnPrimary size="sm" onClick={() => keepMine(dir)}>Keep mine</BtnPrimary>
        </div>
      )}
      <div className="flex h-10 flex-none items-center gap-2.5 border-b border-border-hairline pl-4 pr-3">
        <div className="min-w-0 flex-1 font-mono text-[11px] text-text-dim">
          {folder && <span>{folder} / </span>}
          {editing !== null ? (
            <input
              autoFocus
              value={editing}
              onChange={(e) => setEditing(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); commitRename(); }
                else if (e.key === "Escape") { e.preventDefault(); setEditing(null); }
              }}
              className="w-[70%] rounded-[4px] border border-border-strong bg-surface-input px-1 py-px font-sans text-[12.5px] text-text-primary outline-none"
            />
          ) : (
            <button
              type="button"
              onClick={() => setEditing(title)}
              className="max-w-full truncate align-bottom font-sans text-[12.5px] font-medium text-text-primary hover:underline"
              title="Rename"
            >
              {title}
            </button>
          )}
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              disabled={pill.locked}
              className={cn(
                "inline-flex h-[22px] shrink-0 items-center gap-1.5 rounded-full border px-[9px] font-mono text-[10px] uppercase tracking-[0.05em] disabled:opacity-70",
                PILL_TONE[pill.tone],
              )}
            >
              <i className="size-[5px] shrink-0 rounded-full bg-current" />
              {pill.label}
            </button>
          </DropdownMenuTrigger>
          {!pill.locked && (
            <DropdownMenuContent align="end" className="w-[160px]">
              {STATUS_ROWS.map((r) => (
                <DropdownMenuItem key={r.label} onSelect={() => void setStatus(dir, r.value)}>
                  {r.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          )}
        </DropdownMenu>

        <span className="shrink-0 whitespace-nowrap font-mono text-[10px] text-text-dim">
          {saveLabel(open, Date.now())}
        </span>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="More"
              className="flex size-[22px] shrink-0 items-center justify-center rounded-[5px] text-text-dim hover:bg-fill-hover hover:text-text-primary"
            >
              ⋯
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-[190px]">
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Move…</DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="max-h-[240px] overflow-y-auto">
                {folders.map((f) => (
                  <DropdownMenuItem
                    key={f || "/"}
                    disabled={f === folder}
                    onSelect={() => {
                      const to = f ? `${f}/${filename}` : filename;
                      renameNote(dir, path, to).catch((e) => toastError("Couldn't move it", String(e).slice(0, 90)));
                    }}
                  >
                    {f || "(vault root)"}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => onConfirm({
                title: "Move this note to the trash?",
                body: "It goes to .chronicle/trash/, nothing is deleted.",
                cancelLabel: "Keep it",
                confirmLabel: "Move to trash",
                danger: true,
                onConfirm: () => {
                  deleteNote(dir, path).catch((e) => toastError("Couldn't delete it", String(e).slice(0, 90)));
                },
              })}
            >
              Delete…
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => {
                runCommand(dir, `open -R ".chronicle/notes/${path}"`)
                  .catch((e) => toastError("Couldn't reveal it", String(e).slice(0, 90)));
              }}
            >
              Reveal in Finder
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                void copyText(`.chronicle/notes/${path}`).then(() => toastSuccess("Copied the path"));
              }}
            >
              Copy path
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
