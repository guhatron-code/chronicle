/*
 * The tree, the tags, the open round card, and "Start a round ▸" — the left
 * column of the pane (mock frames 1 and 2). Collapse state and the tag
 * filter are the sidebar's own; everything else is the index NotesPane hands
 * down. Every line of text is a chrome/Tree row — the same folder, note, guide
 * and head parts the Repo pane's explorer draws with — so nothing here wraps
 * and nothing here drifts from the explorer.
 */
import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Eyebrow } from "@/components/chrome/atoms";
import { AccBody } from "@/screens/roadmap/bits";
import { TreeFolderRow, TreeGuide, TreeHeader, TreeIconButton, TreeRow } from "@/components/chrome/Tree";
import { ChevronRightGlyph, DocGlyph, PlusGlyph, SearchGlyph } from "@/components/chrome/icons";
import { buildTree, folderOf, nestTree, orderNotes, placeInOrder, sanitizeTitle, tagCounts, type NoteOrder, type TreeBranch } from "@/lib/notes-model";
import type { NoteEntry } from "@/lib/ipc";
import { toastError } from "@/overlays/toasts";
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

/* Drag and drop: a note row is picked up and dropped on a folder (goes in, last),
   on another note (goes in that note's folder, before it), or on the empty space
   under the tree (goes to the vault root). Moving between folders is a real file
   move through the link-rewriting rename; the order inside a folder is the
   sidebar's own, kept per project in localStorage like the collapse state.
   Pointer events drive it, not the browser's drag session: the webview starts
   that session but never reports where the pointer is over the page. */
const ORDER_KEY = (dir: string) => `chronicle.notes.order.${dir}`;
/** how far a press travels before it is a drag, not a click */
const DRAG_SLOP = 5;

function loadOrder(dir: string): NoteOrder {
  try {
    const raw = localStorage.getItem(ORDER_KEY(dir));
    return raw ? (JSON.parse(raw) as NoteOrder) : {};
  } catch { return {}; }
}

/** Where a drag is, as the rows need it. */
type DropTarget = { kind: "folder" | "note" | "root"; path: string };
interface Dnd {
  dragging: string | null;
  over: DropTarget | null;
  /** a press on a note row: it may become a drag, or stay a click */
  press: (path: string, e: React.PointerEvent) => void;
  /** the click a drag just swallowed must not open the note */
  swallowedClick: () => boolean;
}
const sameTarget = (a: DropTarget | null, b: DropTarget) => !!a && a.kind === b.kind && a.path === b.path;
const targetId = (t: DropTarget) => (t.kind === "root" ? "root" : `${t.kind}:${t.path}`);
function targetAt(x: number, y: number): DropTarget | null {
  const el = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-drop-target]");
  const id = el?.dataset.dropTarget;
  if (!id) return null;
  if (id === "root") return { kind: "root", path: "" };
  const i = id.indexOf(":");
  const kind = id.slice(0, i);
  return kind === "folder" || kind === "note" ? { kind, path: id.slice(i + 1) } : null;
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
function Branch({ node, depth, collapsed, openPath, onOpenFolder, onOpenNote, notFirstRoot, dnd }: {
  node: TreeBranch;
  depth: number;
  /** the explorer's 4 px breath above every root folder after the first */
  notFirstRoot?: boolean;
  collapsed: Set<string>;
  openPath: string | null;
  onOpenFolder: (path: string) => void;
  onOpenNote: (node: TreeBranch) => void;
  dnd: Dnd;
}) {
  if (node.kind === "note") {
    const status = node.entry ? rowStatus(node.entry) : null;
    const target: DropTarget = { kind: "note", path: node.path };
    return (
      <TreeRow
        depth={depth}
        name={node.name}
        marquee
        icon={<DocGlyph size={13} strokeWidth={1.2} className="shrink-0 text-text-subtle" />}
        selected={node.path === openPath}
        trailing={status ? <StatusChip {...status} /> : undefined}
        onClick={() => { if (!dnd.swallowedClick()) onOpenNote(node); }}
        onPointerDown={(e) => dnd.press(node.path, e)}
        dropTarget={targetId(target)}
        dropping={sameTarget(dnd.over, target)}
        className={cn(dnd.dragging === node.path && "opacity-50")}
      />
    );
  }
  const open = !collapsed.has(node.path);
  const target: DropTarget = { kind: "folder", path: node.path };
  return (
    <div>
      <TreeFolderRow
        className={cn(notFirstRoot && "mt-1")}
        depth={depth}
        name={node.name}
        open={open}
        marquee
        onClick={() => onOpenFolder(node.path)}
        dropTarget={targetId(target)}
        dropping={sameTarget(dnd.over, target)}
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
                dnd={dnd}
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
  dir, notes, openPath, onOpenNote, onNewNote, onMoveNote, onOpenSearch, onRevealVault,
  queued, round, onStartRound, onRunRoundInPane, onRunRoundInTerminal,
  onRevealPane, onRevealTerminal, vault, borrowed,
  width = 232,
}: {
  dir: string;
  notes: NoteEntry[];
  openPath: string | null;
  onOpenNote: (path: string) => void;
  /** Both the "+" button and "New folder" fold into this — a folder with no
   *  note in it does not exist, so "New folder" seeds an Untitled note. */
  onNewNote: (folder: string) => void;
  /** A dropped note goes into `folder` ("" is the root); resolves to the path it lives at now. */
  onMoveNote: (from: string, folder: string) => Promise<string>;
  onOpenSearch: () => void;
  onRevealVault: () => void;
  queued: number;
  /** Absolute path of the vault this index reflects. */
  vault: string;
  /** True when this project is a linked worktree borrowing the main checkout's vault. */
  borrowed: boolean;
  /** the pinned round, in whatever phase it is in — null when there is none */
  round: RoundCardData | null;
  /** "Start a round" — the plan is written as a turn in the agent pane */
  onStartRound: () => void;
  onRunRoundInPane?: (n: number, total: number) => void;
  onRunRoundInTerminal?: (n: number, total: number) => void;
  /** the card's "Open the pane" / "Open the terminal" — go and watch the run */
  onRevealPane?: () => void;
  onRevealTerminal?: (termId: number) => void;
  /** column width in px (L3: 232px) — the splitter next door in NotesPane drives it */
  width?: number;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => loadCollapsed(dir));
  useEffect(() => setCollapsed(loadCollapsed(dir)), [dir]);
  useEffect(() => {
    try { localStorage.setItem(COLLAPSE_KEY(dir), JSON.stringify([...collapsed])); } catch { /* private mode etc. */ }
  }, [dir, collapsed]);

  const [activeFolder, setActiveFolder] = useState("");
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [newFolder, setNewFolder] = useState<string | null>(null);

  /* ---- drag and drop ---- */
  const [order, setOrder] = useState<NoteOrder>(() => loadOrder(dir));
  useEffect(() => setOrder(loadOrder(dir)), [dir]);
  useEffect(() => {
    try { localStorage.setItem(ORDER_KEY(dir), JSON.stringify(order)); } catch { /* private mode etc. */ }
  }, [dir, order]);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<DropTarget | null>(null);
  const [ghost, setGhost] = useState<{ x: number; y: number; name: string } | null>(null);
  /** the press being watched; a drag begins once it travels DRAG_SLOP */
  const press = useRef<{ path: string; x: number; y: number; live: boolean } | null>(null);
  const swallowed = useRef(false);
  const notesRef = useRef(notes); notesRef.current = notes;
  const orderRef = useRef(order); orderRef.current = order;

  const finishDrop = (from: string, t: DropTarget | null) => {
    if (!t || (t.kind === "note" && t.path === from)) return;
    const toFolder = t.kind === "folder" ? t.path : t.kind === "note" ? folderOf(t.path) : "";
    const before = t.kind === "note" ? t.path : null;
    const fromFolder = folderOf(from);
    void onMoveNote(from, toFolder)
      .then((to) => {
        setOrder((o) => {
          const siblings = orderNotes(notesRef.current.filter((n) => n.folder === toFolder && n.path !== from), o[toFolder]).map((n) => n.path);
          const next: NoteOrder = { ...o, [toFolder]: placeInOrder(siblings, to, before) };
          if (fromFolder !== toFolder) next[fromFolder] = (o[fromFolder] ?? []).filter((p) => p !== from);
          return next;
        });
      })
      .catch((err) => toastError("Couldn't move the note", String(err).slice(0, 110)));
  };

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const p = press.current;
      if (!p) return;
      if (!p.live) {
        if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < DRAG_SLOP) return;
        p.live = true;
        setDragging(p.path);
      }
      const t = targetAt(e.clientX, e.clientY);
      setOver((cur) => (t && cur && sameTarget(cur, t) ? cur : t));
      setGhost({ x: e.clientX, y: e.clientY, name: p.path.split("/").pop()!.replace(/\.md$/, "") });
    };
    const up = (e: PointerEvent) => {
      const p = press.current;
      press.current = null;
      if (!p) return;
      if (p.live) {
        swallowed.current = true; // the click that follows this release is the drag's, not a pick
        finishDrop(p.path, targetAt(e.clientX, e.clientY));
      }
      setDragging(null); setOver(null); setGhost(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onMoveNote]);

  const dnd: Dnd = {
    dragging,
    over,
    press: (path, e) => {
      if (e.button !== 0) return;
      swallowed.current = false; // a drag released over empty space fires no click to consume the flag
      press.current = { path, x: e.clientX, y: e.clientY, live: false };
    },
    swallowedClick: () => { const s = swallowed.current; swallowed.current = false; return s; },
  };
  const rootTarget: DropTarget = { kind: "root", path: "" };

  const toggle = (folder: string) =>
    setCollapsed((c) => { const n = new Set(c); if (n.has(folder)) n.delete(folder); else n.add(folder); return n; });

  const filtered = useMemo(
    () => (tagFilter ? notes.filter((n) => n.tags.includes(tagFilter)) : notes),
    [notes, tagFilter],
  );
  // the tree is built with NOTHING pruned — a closed folder keeps its children
  // so AccBody has a body to collapse, exactly as the explorer's does. Which
  // folders are closed is `collapsed`, read per row by Branch.
  const tree = useMemo(() => nestTree(buildTree(filtered, NOTHING_COLLAPSED, order)), [filtered, order]);
  const tags = useMemo(() => tagCounts(notes), [notes]);

  /* A round that has ENDED still holds the card until it is dismissed, so
     "still running" is the wrong answer for two of the five phases — the way
     out of those is Dismiss, and the tooltip has to say so. */
  const disabledReason = round
    ? round.phase === "generating"
      ? "A round is being planned"
      : round.phase === "plan-ready"
        ? `Round ${round.n} hasn't been run yet`
        : round.phase === "finished"
          ? `Round ${round.n} is finished · dismiss it to start another`
          : round.phase === "failed"
            ? `Round ${round.n} didn't finish · dismiss it to start another`
            : `Round ${round.n} is still running`
    : queued === 0
      ? "Nothing is queued yet"
      : null;

  return (
    <div data-chrome style={{ width }} className="flex h-full flex-none flex-col border-r border-border-hairline">
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

      {borrowed && (
        <div className="px-2 pb-1 pt-1.5 text-[11px] text-text-subtle" title={vault}>
          Notes live in the main checkout · {vault.replace(/\/\.chronicle\/notes$/, "").split("/").pop()}
        </div>
      )}

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
            className="h-[26px] w-full rounded-sm border border-border-hairline bg-surface-input px-2 text-[11.5px] text-text-primary outline-none focus-visible:[box-shadow:var(--focus-ring)]"
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
          round={round}
          openPath={openPath}
          onOpenNote={onOpenNote}
          onRunInPane={onRunRoundInPane}
          onRunInTerminal={onRunRoundInTerminal}
          onRevealPane={onRevealPane}
          onRevealTerminal={onRevealTerminal}
        />
      )}

      <div
        data-notes-tree
        data-drop-target="root"
        data-dropping={sameTarget(over, rootTarget) || undefined}
        className={cn(
          "min-h-0 flex-1 overflow-y-auto px-2 pb-3 text-[12.5px] text-text-secondary",
          sameTarget(over, rootTarget) && "[box-shadow:inset_0_0_0_1px_var(--border-strong)]",
        )}
      >
        {tree.map((node, i) => (
          <Branch
            key={node.path}
            node={node}
            depth={0}
            notFirstRoot={i > 0}
            collapsed={collapsed}
            openPath={openPath}
            onOpenFolder={(path) => { toggle(path); setActiveFolder(path); }}
            onOpenNote={(n) => { setActiveFolder(n.entry?.folder ?? ""); onOpenNote(n.path); }}
            dnd={dnd}
          />
        ))}
        {dragging && <div className="h-7 text-center text-[11px] leading-7 text-text-dim">Drop here to move it to the top level</div>}
      </div>
      {ghost && (
        <div
          aria-hidden
          className="pointer-events-none fixed z-50 rounded-sm border border-border-strong bg-surface-card px-2 py-0.5 text-[11.5px] text-text-primary shadow-md"
          style={{ left: ghost.x + 12, top: ghost.y + 8 }}
        >
          {ghost.name}
        </div>
      )}

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
                  "inline-flex items-center gap-1 rounded-xs border border-border-hairline bg-surface-input px-[7px] py-[2px] font-mono text-[10.5px] text-text-subtle",
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
          className="inline-flex items-center gap-[4px] rounded-sm bg-primary px-[11px] py-[5px] text-[11.5px] font-semibold text-primary-foreground hover:bg-(--primary-hover) disabled:bg-fill-subtle disabled:text-text-dimmer disabled:opacity-100"
        >
          Start a round
          <ChevronRightGlyph size={11} className="shrink-0" />
        </button>
      </div>
    </div>
  );
});
