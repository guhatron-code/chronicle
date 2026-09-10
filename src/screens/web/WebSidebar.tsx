/*
 * The Web pane's tabs, as a sidebar. Same rows the Repo explorer and the Notes
 * sidebar draw with (chrome/Tree), so a browser tab, a note and a file line up
 * to the pixel: a folder is chevron · folder glyph · name, a tab is a globe ·
 * title · the strip's dot, and the active tab is the selected row.
 *
 * The hide rule from the Web pane's design carries in here unchanged: the page
 * is a native child webview and DOM never paints over it, so a row menu — and
 * a drag, whose insertion line would otherwise be under the page — counts as
 * an overlay. `onOverlay` tells the pane to hide the page while one is up.
 *
 * Reorder is HTML5 drag and drop rather than a library: the whole integration
 * is a dragstart, a dragover and a drop, against @dnd-kit's sensors, contexts
 * and collision detection for the same three. The keyboard route is
 * "Move to ▸" in the row menu, which every tab row has.
 */
import { useCallback, useEffect, useRef, useState, type ComponentProps, type ComponentType, type DragEvent, type ReactNode } from "react";
import {
  ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator,
  ContextMenuSub, ContextMenuSubContent, ContextMenuSubTrigger, ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
  DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TreeFolderRow, TreeGuide, TreeHeader, TreeIconButton, TreeRow } from "@/components/chrome/Tree";
import { FolderPlusGlyph, PlusGlyph, WebGlyph, XGlyph } from "@/components/chrome/icons";
import { buildWebTree, tabDot, tabLabel, tabsIn, type WebFolder } from "@/lib/web-model";
import {
  activateId, addWebFolder, closeTabId, deleteWebFolder, moveWebTab, reload,
  renameWebFolder, toggleWebFolder, type WebProject, type WebTab,
} from "@/lib/web-store";
import { displayAddress } from "@/lib/web-url";
import { cn } from "@/lib/utils";
import { toastError, toastSuccess } from "@/overlays/toasts";

const DOT_CLASS = { loading: "bg-state-neutral", live: "bg-state-success", local: "bg-text-subtle" } as const;

/* ---------- the row menu, defined once and rendered by both menus ---------- */

type MenuNode =
  | { kind: "item"; label: string; danger?: boolean; onSelect: () => void }
  | { kind: "sub"; label: string; items: { label: string; onSelect: () => void }[] }
  | { kind: "sep" };

/** Only the shape both menu families share — the context menu and the ⋯ menu
 *  are the same list twice, so the items are described once and drawn by
 *  whichever set of parts is handed in. */
interface MenuParts {
  Item: ComponentType<{ variant?: "default" | "destructive"; onSelect?: () => void; children?: ReactNode }>;
  Sep: ComponentType<{ className?: string }>;
  Sub: ComponentType<{ children?: ReactNode }>;
  SubTrigger: ComponentType<{ children?: ReactNode }>;
  SubContent: ComponentType<{ className?: string; children?: ReactNode }>;
}
const CTX: MenuParts = { Item: ContextMenuItem, Sep: ContextMenuSeparator, Sub: ContextMenuSub, SubTrigger: ContextMenuSubTrigger, SubContent: ContextMenuSubContent };
const DROP: MenuParts = { Item: DropdownMenuItem, Sep: DropdownMenuSeparator, Sub: DropdownMenuSub, SubTrigger: DropdownMenuSubTrigger, SubContent: DropdownMenuSubContent };

function MenuNodes({ nodes, parts }: { nodes: MenuNode[]; parts: MenuParts }) {
  const { Item, Sep, Sub, SubTrigger, SubContent } = parts;
  return (
    <>
      {nodes.map((n, i) => {
        if (n.kind === "sep") return <Sep key={i} />;
        if (n.kind === "sub") {
          return (
            <Sub key={i}>
              <SubTrigger>{n.label}</SubTrigger>
              <SubContent className="w-[190px]">
                {n.items.map((it) => <Item key={it.label} onSelect={it.onSelect}>{it.label}</Item>)}
              </SubContent>
            </Sub>
          );
        }
        return <Item key={i} variant={n.danger ? "destructive" : "default"} onSelect={n.onSelect}>{n.label}</Item>;
      })}
    </>
  );
}

/** Right-click anywhere on the row; the hover ⋯ draws the same list. */
function RowMenus({ nodes, onOpen, children }: { nodes: MenuNode[]; onOpen: (open: boolean) => void; children: ReactNode }) {
  return (
    <ContextMenu onOpenChange={onOpen}>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-[190px]"><MenuNodes nodes={nodes} parts={CTX} /></ContextMenuContent>
    </ContextMenu>
  );
}

/** The hover ⋯ on a row, with the same nodes behind it. */
function RowDots({ label, nodes, onOpen }: { label: string; nodes: MenuNode[]; onOpen: (open: boolean) => void }) {
  return (
    <DropdownMenu onOpenChange={onOpen}>
      <DropdownMenuTrigger asChild>
        {/* opacity, not `invisible`: a hidden-by-visibility element cannot take
            focus, and this is the keyboard's way into "Move to ▸" */}
        <RowAction label={label} tabIndex={0} className="opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100">⋯</RowAction>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[190px]"><MenuNodes nodes={nodes} parts={DROP} /></DropdownMenuContent>
    </DropdownMenu>
  );
}

/** A tappable span, not a button: the row itself is a <button>, and a button
 *  inside a button is invalid markup that swallows its own clicks.
 *
 *  It is also what a menu trigger renders through (`asChild`), so the props the
 *  menu injects — its keydown, its pointerdown, its ref — are chained rather
 *  than overwritten, and the trigger's own keys get first refusal. */
function RowAction({ label, onClick, className, children, onKeyDown, ...rest }: {
  label: string; onClick?: () => void;
} & Omit<ComponentProps<"span">, "onClick" | "ref">) {
  return (
    <span
      {...rest}
      role="button"
      aria-label={label}
      title={label}
      onClick={(e) => { e.stopPropagation(); onClick?.(); }}
      onKeyDown={(e) => {
        onKeyDown?.(e);
        if (e.defaultPrevented) return;
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); onClick?.(); }
      }}
      className={cn(
        "flex size-4 shrink-0 cursor-default items-center justify-center rounded-[4px] text-text-dim hover:bg-fill-hover hover:text-text-secondary",
        "outline-none focus-visible:[box-shadow:var(--focus-ring)]",
        className,
      )}
    >
      {children}
    </span>
  );
}

/* ---------- inline naming ---------- */

/** New folder and rename share one input. Enter commits, Escape and a click
 *  away drop it — the same contract the notes sidebar's folder field has. */
function NameInput({ initial, onDone }: { initial: string; onDone: (name: string | null) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  const finish = (name: string | null) => { if (done.current) return; done.current = true; onDone(name); };
  return (
    <form className="py-0.5" onSubmit={(e) => { e.preventDefault(); finish(ref.current?.value ?? null); }}>
      <input
        ref={ref}
        autoFocus
        defaultValue={initial}
        placeholder="Folder name"
        // the pane's ⌘-shortcuts listen on window in capture; a name being
        // typed here is not a shortcut
        onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Escape") finish(null); }}
        onBlur={() => finish(ref.current?.value ?? null)}
        className="h-[26px] w-full rounded-[6px] border border-border-hairline bg-surface-input px-2 text-[11.5px] text-text-primary outline-none focus-visible:[box-shadow:var(--focus-ring)]"
      />
    </form>
  );
}

/* ---------- drag state ---------- */

/** Where the pointer is while a tab is in flight: onto a folder, between two
 *  rows (an insertion line above or below the row it is over), or past the
 *  last row, which means the end of the root. */
type DropAt =
  | { kind: "folder"; id: string }
  | { kind: "tab"; id: number; before: boolean }
  | { kind: "root-end" };

function sameDrop(a: DropAt | null, b: DropAt): boolean {
  if (!a || a.kind !== b.kind) return false;
  if (a.kind === "folder" && b.kind === "folder") return a.id === b.id;
  if (a.kind === "tab" && b.kind === "tab") return a.id === b.id && a.before === b.before;
  return true;
}

/** WebKit refuses to start a drag with an empty dataTransfer. */
const DRAG_MIME = "application/x-chronicle-web-tab";
/** Past the end of any container — moveTab clamps it. */
const END = Number.MAX_SAFE_INTEGER;

/* ---------- one tab row ---------- */

function TabRow({ tab, depth, selected, dragging, dropAt, nodes, dir, onMenuOpen, onDragStart, onDragEnd, onOver, onDrop }: {
  tab: WebTab;
  depth: number;
  selected: boolean;
  dragging: number | null;
  dropAt: DropAt | null;
  nodes: MenuNode[];
  dir: string;
  onMenuOpen: (open: boolean) => void;
  onDragStart: (id: number) => void;
  onDragEnd: () => void;
  onOver: (at: DropAt, e: DragEvent) => void;
  onDrop: (at: DropAt, e: DragEvent) => void;
}) {
  const dot = tabDot(tab);
  const label = tabLabel(tab);
  const line = dropAt?.kind === "tab" && dropAt.id === tab.id ? (dropAt.before ? "top" : "bottom") : null;
  const half = (e: DragEvent): DropAt => {
    const r = e.currentTarget.getBoundingClientRect();
    return { kind: "tab", id: tab.id, before: e.clientY < r.top + r.height / 2 };
  };
  return (
    <div
      className="relative"
      draggable
      onDragStart={(e) => {
        onDragStart(tab.id);
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData(DRAG_MIME, String(tab.id));
      }}
      onDragEnd={onDragEnd}
      onDragOver={(e) => onOver(half(e), e)}
      onDrop={(e) => onDrop(half(e), e)}
    >
      {line && (
        <span aria-hidden className={cn("pointer-events-none absolute inset-x-1 z-10 h-0.5 rounded-[1px] bg-text-primary", line === "top" ? "-top-px" : "-bottom-px")} />
      )}
      <RowMenus nodes={nodes} onOpen={onMenuOpen}>
        <div className={cn("group/row", dragging === tab.id && "opacity-40")}>
          <TreeRow
            depth={depth}
            name={label}
            title={displayAddress(tab.url) || label}
            marquee
            selected={selected}
            icon={<WebGlyph size={13} className="shrink-0 text-text-subtle" />}
            onClick={() => activateId(dir, tab.id)}
            // WebKit will not begin a drag on an ancestor of a <button>; making
            // the row itself the drag source is what gets dragstart to fire
            className="[-webkit-user-drag:element]"
            trailing={
              <span className="flex flex-none items-center gap-1">
                {dot && <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", DOT_CLASS[dot])} />}
                <RowDots label={`More actions for ${label}`} nodes={nodes} onOpen={onMenuOpen} />
                <RowAction label={`Close ${label}`} tabIndex={-1} onClick={() => void closeTabId(dir, tab.id)} className="opacity-0 group-hover/row:opacity-100">
                  <XGlyph size={8} />
                </RowAction>
              </span>
            }
          />
        </div>
      </RowMenus>
    </div>
  );
}

/* ---------- the sidebar ---------- */

export function WebSidebar({ dir, p, width, onNewTab, onOverlay, onConfirm }: {
  dir: string;
  p: WebProject;
  width: number;
  /** the pane's own "new tab" — it also focuses the address bar */
  onNewTab: (folder?: string | null) => void;
  /** a menu is open, or a drag is in flight: the native page must hide */
  onOverlay: (open: boolean) => void;
  onConfirm?: (spec: {
    title: string; body: string; cancelLabel: string; confirmLabel: string; danger?: boolean; onConfirm: () => void;
  }) => void;
}) {
  const active = p.active >= 0 ? p.tabs[p.active] : null;
  // not memoised: newTab and closeTab mutate p.tabs in place, so the array
  // reference is no signal at all — and this is a handful of rows either way
  const tree = buildWebTree(p.tabs, p.folders);

  /* a count, not a boolean: one menu closing as the next opens must not
     flicker the native page back on between the two */
  const [menus, setMenus] = useState(0);
  const [dragging, setDragging] = useState<number | null>(null);
  const [dropAt, setDropAt] = useState<DropAt | null>(null);
  useEffect(() => { onOverlay(menus > 0 || dragging !== null); }, [menus, dragging, onOverlay]);
  const onMenuOpen = useCallback((open: boolean) => setMenus((n) => Math.max(0, n + (open ? 1 : -1))), []);

  const [naming, setNaming] = useState<{ kind: "new" } | { kind: "rename"; id: string } | null>(null);

  const endDrag = useCallback(() => { setDragging(null); setDropAt(null); }, []);

  /** Every dragover stops here rather than bubbling: the scroller behind the
   *  rows is itself a drop target (the end of the root), and a bubbled event
   *  would overwrite the row the pointer is actually on. */
  const onOver = (at: DropAt, e: DragEvent) => {
    if (dragging === null) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    setDropAt((cur) => (sameDrop(cur, at) ? cur : at));
  };

  /** Turn a hover into a (folder, index) the model can take. The index counts
   *  the destination's tabs with the dragged one already lifted out, which is
   *  what moveTab expects. */
  const onDrop = (at: DropAt, e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const id = dragging;
    endDrag();
    if (id === null) return;
    if (at.kind === "folder") { moveWebTab(dir, id, at.id, END); return; }
    if (at.kind === "root-end") { moveWebTab(dir, id, null, END); return; }
    const target = p.tabs.find((t) => t.id === at.id);
    if (!target || target.id === id) return;
    const dest = target.folder ?? null;
    const siblings = tabsIn(p.tabs.filter((t) => t.id !== id), p.folders, dest);
    const i = siblings.findIndex((t) => t.id === target.id);
    moveWebTab(dir, id, dest, (i < 0 ? siblings.length : i) + (at.before ? 0 : 1));
  };

  /** "Move to ▸" — the keyboard route to everything the drag does. */
  const tabMenu = (tab: WebTab): MenuNode[] => {
    const targets = [
      ...p.folders.filter((f) => f.id !== tab.folder).map((f) => ({ label: f.name, onSelect: () => moveWebTab(dir, tab.id, f.id, END) })),
      ...(tab.folder ? [{ label: "Root", onSelect: () => moveWebTab(dir, tab.id, null, END) }] : []),
    ];
    return [
      { kind: "item", label: "Reload", onSelect: () => reload(tab) },
      {
        kind: "item", label: "Copy address", onSelect: () => {
          const url = tab.url && tab.url !== "about:blank" ? tab.url : "";
          if (!url) { toastError("That tab has no address yet"); return; }
          navigator.clipboard.writeText(url)
            .then(() => toastSuccess("Address copied"))
            .catch(() => toastError("Couldn't copy the address"));
        },
      },
      ...(targets.length ? [{ kind: "sub" as const, label: "Move to", items: targets }] : []),
      { kind: "sep" },
      { kind: "item", label: "Close", danger: true, onSelect: () => void closeTabId(dir, tab.id) },
    ];
  };

  const folderMenu = (f: WebFolder): MenuNode[] => [
    { kind: "item", label: "New tab here", onSelect: () => onNewTab(f.id) },
    { kind: "item", label: "Rename folder", onSelect: () => setNaming({ kind: "rename", id: f.id }) },
    { kind: "sep" },
    {
      kind: "item", label: "Delete folder…", danger: true, onSelect: () => {
        const n = p.tabs.filter((t) => t.folder === f.id).length;
        const go = () => {
          deleteWebFolder(dir, f.id);
          toastSuccess(`Deleted “${f.name}”`, n ? `${n} tab${n === 1 ? "" : "s"} moved out` : undefined);
        };
        if (!onConfirm) { go(); return; }
        onConfirm({
          title: `Delete “${f.name}”?`,
          body: n
            ? `Its ${n} tab${n === 1 ? " stays" : "s stay"} open — ${n === 1 ? "it moves" : "they move"} out to the top of the list.`
            : "The folder is empty.",
          cancelLabel: "Keep it",
          confirmLabel: "Delete folder",
          danger: true,
          onConfirm: go,
        });
      },
    },
  ];

  const rowProps = { dragging, dropAt, dir, onMenuOpen, onDragStart: setDragging, onDragEnd: endDrag, onOver, onDrop };

  return (
    <div data-chrome style={{ width }} className="flex h-full flex-none flex-col border-r border-border-hairline">
      <TreeHeader label={`Tabs · ${p.tabs.length}`} className="h-10 flex-none border-b border-border-hairline">
        <TreeIconButton aria-label="New tab" onClick={() => onNewTab()}>
          <PlusGlyph size={13} />
        </TreeIconButton>
        <TreeIconButton aria-label="New folder" onClick={() => setNaming({ kind: "new" })}>
          <FolderPlusGlyph size={14} />
        </TreeIconButton>
      </TreeHeader>

      <div
        className="min-h-0 flex-1 overflow-y-auto px-2 py-1 text-[12.5px] text-text-secondary"
        onDragOver={(e) => onOver({ kind: "root-end" }, e)}
        onDrop={(e) => onDrop({ kind: "root-end" }, e)}
      >
        {naming?.kind === "new" && (
          <NameInput initial="" onDone={(name) => { setNaming(null); if (name?.trim()) addWebFolder(dir, name); }} />
        )}

        {tree.map((node) => {
          if (node.kind === "tab") {
            return <TabRow key={node.tab.id} tab={node.tab} depth={0} selected={node.tab === active} nodes={tabMenu(node.tab)} {...rowProps} />;
          }
          const f = node.folder;
          const hot = dropAt?.kind === "folder" && dropAt.id === f.id;
          const nodes = folderMenu(f);
          // renaming swaps the row for the field and leaves the folder's tabs
          // where they are — the list must not jump under the caret
          const renaming = naming?.kind === "rename" && naming.id === f.id;
          return (
            <div
              key={f.id}
              onDragOver={(e) => onOver({ kind: "folder", id: f.id }, e)}
              onDrop={(e) => onDrop({ kind: "folder", id: f.id }, e)}
            >
              {renaming ? (
                <NameInput
                  initial={f.name}
                  onDone={(name) => { setNaming(null); if (name?.trim()) renameWebFolder(dir, f.id, name); }}
                />
              ) : (
              <RowMenus nodes={nodes} onOpen={onMenuOpen}>
                <div className={cn("group/row rounded-sm", hot && "bg-fill-hover ring-1 ring-border-strong")}>
                  <TreeFolderRow
                    depth={0}
                    name={f.name}
                    open={node.open}
                    marquee
                    onClick={() => toggleWebFolder(dir, f.id)}
                    trailing={
                      <span className="flex flex-none items-center gap-1">
                        <span className="font-mono text-[10px] text-text-dimmer">{node.tabs.length}</span>
                        <RowDots label={`More actions for ${f.name}`} nodes={nodes} onOpen={onMenuOpen} />
                      </span>
                    }
                  />
                </div>
              </RowMenus>
              )}
              {node.open && (
                <TreeGuide>
                  {node.tabs.length === 0
                    ? <div className="px-1.5 py-1 text-[11.5px] text-text-dimmer">Empty — drop a tab here</div>
                    : node.tabs.map((t) => (
                        <TabRow key={t.id} tab={t} depth={1} selected={t === active} nodes={tabMenu(t)} {...rowProps} />
                      ))}
                </TreeGuide>
              )}
            </div>
          );
        })}

        {p.tabs.length === 0 && p.folders.length === 0 && naming === null && (
          <div className="px-1.5 py-2 text-[11.5px] text-text-dimmer">No tabs yet — “+” opens one.</div>
        )}
      </div>
    </div>
  );
}
