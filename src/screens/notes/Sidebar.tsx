/*
 * The tree, the tags, the open round card, and "Start a round ▸" — the left
 * column of the pane (mock frames 1 and 2). Collapse state and the tag
 * filter are the sidebar's own; everything else is the index NotesPane hands
 * down. Every line of text is a chrome/Tree row — the same folder, note, guide
 * and head parts the Repo pane's explorer draws with — so nothing here wraps
 * and nothing here drifts from the explorer.
 */
import { memo, useEffect, useMemo, useState } from "react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Eyebrow } from "@/components/chrome/atoms";
import { AccBody } from "@/screens/roadmap/bits";
import { TreeFolderRow, TreeGuide, TreeHeader, TreeIconButton, TreeRow } from "@/components/chrome/Tree";
import { ChevronRightGlyph, DocGlyph, PlusGlyph, SearchGlyph } from "@/components/chrome/icons";
import { buildTree, nestTree, sanitizeTitle, tagCounts, type TreeBranch } from "@/lib/notes-model";
import type { NoteEntry } from "@/lib/ipc";
import { cn } from "@/lib/utils";
import { RoundCard, type RoundCardData } from "./RoundCard";
import { StatusChip } from "./StatusChip";

const COLLAPSE_KEY = (dir: string) => `chronicle.notes.tree.${dir}`;

/** buildTree prunes what it is told is collapsed; the sidebar tells it nothing. */
const NOTHING_COLLAPSED = new Set<string>();

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

/** One node of the notes tree, drawn with the explorer's parts: a folder is a
 *  chevron + folder glyph with its children inside one guide line, a note is a
 *  file row with the status chip in the trailing slot. */
function Branch({ node, depth, collapsed, openPath, onOpenFolder, onOpenNote }: {
  node: TreeBranch;
  depth: number;
  collapsed: Set<string>;
  openPath: string | null;
  onOpenFolder: (path: string) => void;
  onOpenNote: (node: TreeBranch) => void;
}) {
  if (node.kind === "note") {
    const status = node.entry ? rowStatus(node.entry) : null;
    return (
      <TreeRow
        depth={depth}
        name={node.name}
        marquee
        icon={<DocGlyph size={13} strokeWidth={1.2} className="shrink-0 text-text-subtle" />}
        selected={node.path === openPath}
        trailing={status ? <StatusChip {...status} /> : undefined}
        onClick={() => onOpenNote(node)}
      />
    );
  }
  const open = !collapsed.has(node.path);
  return (
    <div>
      <TreeFolderRow
        depth={depth}
        name={node.name}
        open={open}
        marquee
        onClick={() => onOpenFolder(node.path)}
      />
      {(node.children.length > 0 || open) && (
        <AccBody open={open}>
          <TreeGuide>
            {node.children.map((child) => (
              <Branch
                key={child.path}
                node={child}
                depth={depth + 1}
                collapsed={collapsed}
                openPath={openPath}
                onOpenFolder={onOpenFolder}
                onOpenNote={onOpenNote}
              />
            ))}
          </TreeGuide>
        </AccBody>
      )}
    </div>
  );
}

/*
 * Memoised: `NotesPane` re-renders on every keystroke (the store notifies on
 * every editBody), and this tree can be 100+ rows deep on a real vault. Every
 * prop below is either a primitive or a reference NotesPane only replaces
 * when the underlying data actually changes (notes/round track the
 * index's cache object, not the open note's mutated body; the callbacks are
 * useCallback'd) — so the default shallow-equal comparator is exactly right,
 * and typing in the editor no longer re-reconciles the whole tree.
 */
export const Sidebar = memo(function Sidebar({
  dir, notes, openPath, onOpenNote, onNewNote, onOpenSearch, onRevealVault,
  queued, round, agent, onStartRound, onRunRoundInPane, logOpen, onToggleLog,
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
  /** the pinned round, in whatever phase it is in — null when there is none */
  round: RoundCardData | null;
  agent: "claude" | "codex";
  onStartRound: () => void;
  onRunRoundInPane?: (n: number, total: number) => void;
  logOpen: boolean;
  onToggleLog: () => void;
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
  // the tree is built with NOTHING pruned — a closed folder keeps its children
  // so AccBody has a body to collapse, exactly as the explorer's does. Which
  // folders are closed is `collapsed`, read per row by Branch.
  const tree = useMemo(() => nestTree(buildTree(filtered, NOTHING_COLLAPSED)), [filtered]);
  const tags = useMemo(() => tagCounts(notes), [notes]);

  const disabledReason = round
    ? round.phase === "generating"
      ? "A round is being planned"
      : round.phase === "plan-ready"
        ? `Round ${round.n} hasn't been run yet`
        : `Round ${round.n} is still running`
    : queued === 0
      ? "Nothing is queued yet"
      : null;

  return (
    <div data-chrome className="flex h-full w-[232px] flex-none flex-col border-r border-border-hairline">
      <TreeHeader label={`Notes · ${notes.length}`} className="h-10 flex-none border-b border-border-hairline">
        <TreeIconButton aria-label="New note" onClick={() => onNewNote(activeFolder)}>
          <PlusGlyph size={13} />
        </TreeIconButton>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <TreeIconButton aria-label="More">⋯</TreeIconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-[210px]">
            <DropdownMenuItem onSelect={onRevealVault}>Reveal the vault in Finder</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setNewFolder("")}>New folder</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </TreeHeader>

      {newFolder !== null && (
        <form
          className="mx-2 mb-1 mt-2"
          onSubmit={(e) => {
            e.preventDefault();
            // the name becomes a path segment, so it goes through the same
            // sanitiser a note title does — no separators, no leading dot
            const name = sanitizeTitle(newFolder);
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
        className="mx-2 mb-1 mt-2 flex h-[26px] items-center gap-1.5 rounded-md border border-border-hairline bg-surface-input px-2 text-[11.5px] text-text-dim hover:text-text-secondary"
      >
        <SearchGlyph size={12} className="shrink-0 text-text-dim" />
        <span className="flex-1 text-left">Search notes</span>
        <span className="font-mono text-[10px] text-text-dimmer">⌘P</span>
      </button>

      {round && (
        <RoundCard
          dir={dir}
          agent={agent}
          round={round}
          openPath={openPath}
          onOpenNote={onOpenNote}
          logOpen={logOpen}
          onToggleLog={onToggleLog}
          onRunInPane={onRunRoundInPane}
        />
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-1 text-[12.5px] text-text-secondary">
        {tree.map((node) => (
          <Branch
            key={node.path}
            node={node}
            depth={0}
            collapsed={collapsed}
            openPath={openPath}
            onOpenFolder={(path) => { toggle(path); setActiveFolder(path); }}
            onOpenNote={(n) => { setActiveFolder(n.entry?.folder ?? ""); onOpenNote(n.path); }}
          />
        ))}
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
          className="inline-flex items-center gap-[4px] rounded-[6px] bg-primary px-[11px] py-[5px] text-[11.5px] font-semibold text-primary-foreground hover:bg-(--primary-hover) disabled:bg-fill-subtle disabled:text-text-dimmer disabled:opacity-100"
        >
          Start a round
          <ChevronRightGlyph size={11} className="shrink-0" />
        </button>
      </div>
    </div>
  );
});
