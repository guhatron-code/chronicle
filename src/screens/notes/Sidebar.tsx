/*
 * The tree, the tags, the open round card, and "Start a round ▸" — the left
 * column of the pane (mock frames 1 and 2). Collapse state and the tag
 * filter are the sidebar's own; everything else is the index NotesPane hands
 * down. `Row` is the only thing that draws a line of text, so nothing here
 * wraps either.
 */
import { useEffect, useMemo, useState } from "react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Eyebrow } from "@/components/chrome/atoms";
import { DocGlyph, PlusGlyph, SearchGlyph } from "@/components/chrome/icons";
import { buildTree, tagCounts } from "@/lib/notes-model";
import type { OpenRound } from "@/lib/notes-store";
import type { NoteEntry } from "@/lib/ipc";
import { cn } from "@/lib/utils";
import { Row } from "./Row";

const COLLAPSE_KEY = (dir: string) => `chronicle.notes.tree.${dir}`;

function loadCollapsed(dir: string): Set<string> {
  try {
    const raw = localStorage.getItem(COLLAPSE_KEY(dir));
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
  } catch { return new Set(); }
}

function rowStatus(entry: NoteEntry): { label: string; tone: string } | null {
  if (entry.unreadable) return { label: "unreadable", tone: "unknown" };
  if (entry.status === "queued") return { label: "queued", tone: "queued" };
  if (entry.status === "in_progress") return { label: entry.round != null ? `round ${entry.round}` : "in progress", tone: "progress" };
  if (entry.status === "done") return { label: "done", tone: "done" };
  if (entry.status) return { label: "unknown", tone: "unknown" };
  return null;
}

export function Sidebar({
  dir, notes, openPath, onOpenNote, onNewNote, onOpenSearch, onRevealVault,
  queued, roundOpen, generating, onStartRound,
}: {
  dir: string;
  notes: NoteEntry[];
  openPath: string | null;
  onOpenNote: (path: string) => void;
  /** Both the "+" button and "New folder" fold into this — a folder with no
   *  note in it does not exist, so "New folder" seeds an Untitled note. */
  onNewNote: (folder: string) => void;
  onOpenSearch: () => void;
  onRevealVault: () => void;
  queued: number;
  roundOpen: OpenRound | null;
  generating: boolean;
  onStartRound: () => void;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => loadCollapsed(dir));
  useEffect(() => setCollapsed(loadCollapsed(dir)), [dir]);
  useEffect(() => {
    try { localStorage.setItem(COLLAPSE_KEY(dir), JSON.stringify([...collapsed])); } catch { /* private mode etc. */ }
  }, [dir, collapsed]);

  const [activeFolder, setActiveFolder] = useState("");
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [newFolder, setNewFolder] = useState<string | null>(null);

  const toggle = (folder: string) =>
    setCollapsed((c) => { const n = new Set(c); if (n.has(folder)) n.delete(folder); else n.add(folder); return n; });

  const filtered = useMemo(
    () => (tagFilter ? notes.filter((n) => n.tags.includes(tagFilter)) : notes),
    [notes, tagFilter],
  );
  const tree = useMemo(() => buildTree(filtered, collapsed), [filtered, collapsed]);
  const tags = useMemo(() => tagCounts(notes), [notes]);

  const disabledReason = roundOpen
    ? `Round ${roundOpen.n} is still running`
    : generating
      ? "A round is being planned"
      : queued === 0
        ? "Nothing is queued yet"
        : null;

  return (
    <div className="flex h-full w-[232px] flex-none flex-col border-r border-border-hairline">
      <div className="flex h-10 flex-none items-center gap-2 border-b border-border-hairline pl-3.5 pr-2">
        <Eyebrow className="flex-1">Notes · {notes.length}</Eyebrow>
        <button
          type="button"
          aria-label="New note"
          onClick={() => onNewNote(activeFolder)}
          className="flex size-[22px] items-center justify-center rounded-[5px] text-text-dim hover:bg-fill-hover hover:text-text-primary"
        >
          <PlusGlyph size={13} />
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="More"
              className="flex size-[22px] items-center justify-center rounded-[5px] text-text-dim hover:bg-fill-hover hover:text-text-primary"
            >
              ⋯
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-[210px]">
            <DropdownMenuItem onSelect={onRevealVault}>Reveal the vault in Finder</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setNewFolder("")}>New folder</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {newFolder !== null && (
        <form
          className="mx-2.5 mb-1 mt-2"
          onSubmit={(e) => {
            e.preventDefault();
            const name = newFolder.trim();
            if (name) onNewNote(name);
            setNewFolder(null);
          }}
        >
          <input
            autoFocus
            value={newFolder}
            onChange={(e) => setNewFolder(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") setNewFolder(null); }}
            onBlur={() => setNewFolder(null)}
            placeholder="Folder name"
            className="h-[26px] w-full rounded-[6px] border border-border-hairline bg-surface-input px-2 text-[11.5px] text-text-primary outline-none focus-visible:[box-shadow:var(--focus-ring)]"
          />
        </form>
      )}

      <button
        type="button"
        onClick={onOpenSearch}
        className="mx-2.5 mb-1 mt-2 flex h-[26px] items-center gap-1.5 rounded-md border border-border-hairline bg-surface-input px-2 text-[11.5px] text-text-dim hover:text-text-secondary"
      >
        <SearchGlyph size={12} className="shrink-0 text-text-dim" />
        <span className="flex-1 text-left">Search notes</span>
        <span className="font-mono text-[10px] text-text-dimmer">⌘⇧F</span>
      </button>

      {roundOpen && (
        <div className="mx-2.5 mb-2 mt-1 rounded-lg border border-border-strong bg-surface-card px-3 py-2.5">
          <div className="text-[12.5px] font-semibold text-text-primary">Round {roundOpen.n} · fixes</div>
          <div className="mt-0.5 text-[11px] text-text-muted">
            {roundOpen.total} {roundOpen.total === 1 ? "note" : "notes"} · {roundOpen.done} done · headless session
          </div>
          <div className="my-2.5 h-[2px] overflow-hidden rounded-[1px] bg-fill-subtle">
            <div
              className="h-full rounded-[1px] bg-state-neutral"
              style={{ width: `${roundOpen.total ? Math.round((roundOpen.done / roundOpen.total) * 100) : 0}%` }}
            />
          </div>
          <div className="flex flex-col gap-1">
            {roundOpen.notes.map((n) => (
              <Row
                key={n.path}
                name={n.title}
                icon={<DocGlyph size={12} className="shrink-0 text-text-dim" />}
                selected={n.path === openPath}
                status={n.status === "done" ? { label: "done", tone: "done" } : { label: "working", tone: "progress" }}
                onClick={() => onOpenNote(n.path)}
              />
            ))}
          </div>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 py-1">
        {tree.map((node) =>
          node.kind === "folder" ? (
            <Row
              key={node.path}
              name={node.name}
              indent={node.depth}
              icon={
                <span className="w-2.5 shrink-0 text-center text-[9px] text-text-dimmer">
                  {collapsed.has(node.path) ? "▸" : "▾"}
                </span>
              }
              onClick={() => { toggle(node.path); setActiveFolder(node.path); }}
            />
          ) : (
            <Row
              key={node.path}
              name={node.name}
              indent={node.depth}
              icon={<DocGlyph size={12} className="shrink-0 text-text-dim" />}
              selected={node.path === openPath}
              status={node.entry ? rowStatus(node.entry) : null}
              onClick={() => {
                setActiveFolder(node.entry?.folder ?? "");
                onOpenNote(node.path);
              }}
            />
          ),
        )}
      </div>

      {tags.length > 0 && (
        <div className="flex-none border-t border-border-hairline px-3.5 py-2.5">
          <Eyebrow className="mb-2 block">Tags</Eyebrow>
          <div className="flex flex-wrap gap-[5px]">
            {tags.map((t) => (
              <button
                key={t.tag}
                type="button"
                onClick={() => setTagFilter((cur) => (cur === t.tag ? null : t.tag))}
                className={cn(
                  "inline-flex items-center gap-1 rounded-[4px] border border-border-hairline bg-surface-input px-[7px] py-[2px] font-mono text-[10.5px] text-text-subtle",
                  tagFilter === t.tag && "border-border-strong text-text-primary",
                )}
              >
                #{t.tag} <b className="font-normal text-text-dimmer">{t.count}</b>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-none items-center gap-2.5 border-t border-border-hairline px-3.5 py-2.5">
        <Eyebrow>Queued · {queued}</Eyebrow>
        <span className="flex-1" />
        <button
          type="button"
          title={disabledReason ?? undefined}
          disabled={disabledReason !== null}
          onClick={onStartRound}
          className="inline-flex items-center gap-[6px] rounded-[6px] bg-primary px-[11px] py-[5px] text-[11.5px] font-semibold text-primary-foreground hover:bg-(--primary-hover) disabled:bg-fill-subtle disabled:text-text-dimmer disabled:opacity-100"
        >
          Start a round ▸
        </button>
      </div>
    </div>
  );
}
