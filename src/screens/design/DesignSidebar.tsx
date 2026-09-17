/* The Design pane's left rail (comps board 1, `sidebar(...)`): the design list
 * grouped by kind in KINDS order, each row showing its kind glyph, the title
 * (marquee on overflow) and a trailing state — working, draft, or v<n>.
 *
 * Rename / Duplicate / Move to / Delete live in one row menu, opened by a
 * right-click or the hover ⋯ — the RowMenus/MenuNodes pattern WebSidebar.tsx
 * draws its tab menu with. Reordering within a kind is the same pointer-driven
 * drag WebSidebar uses for tabs: a press that travels past a few pixels
 * becomes a drag, a ghost label follows the pointer, and the drop is
 * hit-tested against `data-design-drop` under the pointer on release — HTML5
 * drag and drop does not work in this webview.
 */
import { useCallback, useEffect, useRef, useState, type ComponentProps, type ComponentType, type ReactNode } from "react";
import {
  ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator,
  ContextMenuSub, ContextMenuSubContent, ContextMenuSubTrigger, ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
  DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TreeHeader, TreeIconButton, TreeRow } from "@/components/chrome/Tree";
import { PlusGlyph } from "@/components/chrome/icons";
import {
  designProjectFor, loadDesigns, openDesign, renameDesign, reorderDesigns, setDesignKind, subscribeDesigns,
  trashDesign, undoDesign,
} from "@/lib/design-store";
import { designBranch } from "@/lib/ipc";
import { KIND_LABEL, KINDS, orderRows, type DesignKind, type DesignRow } from "@/lib/design-model";
import { agentSessionFor, laneKey, subscribeAgent } from "@/lib/agent-session";
import { dropOrder } from "@/lib/design-sidebar-model";
import { cn } from "@/lib/utils";
import { toastAction } from "@/overlays/toasts";

/* ---------- kind glyphs (transcribed from design/comps/design-pane/gen.py's G dict) ---------- */

const KIND_GLYPH_PATH: Record<DesignKind, ReactNode> = {
  ecommerce: (
    <>
      <path d="M3 5.5h10l-.8 8H3.8z" />
      <path d="M5.8 5.5V4.3a2.2 2.2 0 0 1 4.4 0v1.2" />
    </>
  ),
  app: (
    <>
      <rect x="1.8" y="2.5" width="12.4" height="9" rx="1.2" />
      <path d="M5.5 14h5" />
    </>
  ),
  marketing: <path d="M2.5 6.5v3h2l5 3v-9l-5 3zM12 5.5a3.5 3.5 0 0 1 0 5" />,
  brand: (
    <>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 2.5v11M2.5 8h11" />
    </>
  ),
  deck: (
    <>
      <rect x="2" y="3" width="12" height="8" rx="1" />
      <path d="M8 11v2.5M5.5 13.5h5" />
    </>
  ),
};

function KindGlyph({ kind, className }: { kind: DesignKind; className?: string }) {
  return (
    <svg
      width={14} height={14} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.3}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}
    >
      {KIND_GLYPH_PATH[kind]}
    </svg>
  );
}

/* ---------- the row menu (Rename / Duplicate / Move to / Delete) ---------- */

type MenuNode =
  | { kind: "item"; label: string; danger?: boolean; onSelect: () => void }
  | { kind: "sub"; label: string; items: { label: string; onSelect: () => void }[] }
  | { kind: "sep" };

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
function RowMenus({ nodes, children }: { nodes: MenuNode[]; children: ReactNode }) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-[190px]"><MenuNodes nodes={nodes} parts={CTX} /></ContextMenuContent>
    </ContextMenu>
  );
}

/** A tappable span, not a button: the row itself is a <button>, and a button
 *  inside a button is invalid markup that swallows its own clicks. Also what
 *  a menu trigger renders through (`asChild`), so the trigger's own keys get
 *  first refusal. */
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
        "flex size-4 shrink-0 cursor-default items-center justify-center rounded-xs text-text-dim hover:bg-fill-hover hover:text-text-secondary",
        "outline-none focus-visible:[box-shadow:var(--focus-ring)]",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** The hover ⋯ on a row, with the same nodes behind it. */
function RowDots({ label, nodes }: { label: string; nodes: MenuNode[] }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {/* opacity, not `invisible`: a hidden-by-visibility element cannot take
            focus, and this is the keyboard's way into "Move to ▸" */}
        <RowAction label={label} tabIndex={0} className="opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100">⋯</RowAction>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[190px]"><MenuNodes nodes={nodes} parts={DROP} /></DropdownMenuContent>
    </DropdownMenu>
  );
}

/* ---------- inline rename ---------- */

/** Enter commits, Escape and a click away drop it — the same contract
 *  WebSidebar's NameInput has. */
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
        placeholder="Design name"
        // the pane's ⌘-shortcuts listen on window in capture; a name being
        // typed here is not a shortcut
        onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Escape") finish(null); }}
        onBlur={() => finish(ref.current?.value ?? null)}
        className="h-[26px] w-full rounded-sm border border-border-hairline bg-surface-input px-2 text-[11.5px] text-text-primary outline-none focus-visible:[box-shadow:var(--focus-ring)]"
      />
    </form>
  );
}

/* ---------- drag state ---------- */

/** how far a press travels before it is a drag, not a click */
const DRAG_SLOP = 5;

const KIND_SET = new Set<string>(KINDS);

/** Where a drop lands: a specific row (insert before its slug) or a bare kind
 *  (the group's own drop zone below its last row — insert at the end). */
type DropTarget = { kind: DesignKind; slug: string | null };

/** The innermost `data-design-drop` under the point: `"<kind>:<slug>"` on a
 *  row, or `"<kind>"` on the group wrapper for the space below the last row. */
function dropAtPoint(x: number, y: number): DropTarget | null {
  const el = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-design-drop]");
  const v = el?.dataset.designDrop;
  if (!v) return null;
  const i = v.indexOf(":");
  const kindStr = i < 0 ? v : v.slice(0, i);
  if (!KIND_SET.has(kindStr)) return null;
  return { kind: kindStr as DesignKind, slug: i < 0 ? null : v.slice(i + 1) };
}

/* ---------- the sidebar ---------- */

export function DesignSidebar({ dir, onNew }: { dir: string; onNew: () => void }) {
  const [, bump] = useState(0);
  useEffect(() => subscribeDesigns(() => bump((n) => n + 1)), []);
  // the design lane's turnActive flips outside a designs-store notify — the
  // "working" dot needs its own subscription to appear/disappear promptly
  useEffect(() => subscribeAgent(() => bump((n) => n + 1)), []);

  const p = designProjectFor(dir);
  const grouped = orderRows(p.rows, p.order);
  const total = p.rows.length;
  const designTurnActive = agentSessionFor(laneKey(dir, "design")).turnActive;

  const [renaming, setRenaming] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<DropTarget | null>(null);
  const [ghost, setGhost] = useState<{ x: number; y: number; name: string } | null>(null);

  const rowsRef = useRef(p.rows); rowsRef.current = p.rows;
  const press = useRef<{ slug: string; kind: DesignKind; x: number; y: number; live: boolean } | null>(null);
  const swallowed = useRef(false);

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const pr = press.current;
      if (!pr) return;
      if (!pr.live) {
        if (Math.hypot(e.clientX - pr.x, e.clientY - pr.y) < DRAG_SLOP) return;
        pr.live = true;
        setDragging(pr.slug);
      }
      setDropAt(dropAtPoint(e.clientX, e.clientY));
      const row = rowsRef.current.find((r) => r.slug === pr.slug);
      setGhost({ x: e.clientX, y: e.clientY, name: row?.title ?? "" });
    };
    const up = (e: PointerEvent) => {
      const pr = press.current;
      press.current = null;
      if (!pr) return;
      if (pr.live) {
        swallowed.current = true; // the click that follows this release is the drag's
        const at = dropAtPoint(e.clientX, e.clientY);
        if (at && at.kind === pr.kind) {
          const currentSlugs = orderRows(rowsRef.current, designProjectFor(dir).order)[pr.kind].map((r) => r.slug);
          void reorderDesigns(dir, pr.kind, dropOrder(currentSlugs, pr.slug, at.slug));
        }
      }
      setDragging(null); setDropAt(null); setGhost(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [dir]);

  const onPress = useCallback((slug: string, kind: DesignKind, e: React.PointerEvent) => {
    if (e.button !== 0) return;
    swallowed.current = false; // a drag released over empty space fires no click to consume the flag
    press.current = { slug, kind, x: e.clientX, y: e.clientY, live: false };
  }, []);
  const swallowedClick = useCallback(() => { const s = swallowed.current; swallowed.current = false; return s; }, []);

  const menuFor = (row: DesignRow): MenuNode[] => {
    const targets = KINDS.filter((k) => k !== row.kind).map((k) => ({
      label: KIND_LABEL[k],
      onSelect: () => void setDesignKind(dir, row.slug, k),
    }));
    return [
      { kind: "item", label: "Rename", onSelect: () => setRenaming(row.slug) },
      { kind: "item", label: "Duplicate", onSelect: () => { void designBranch(dir, row.slug, null).then(() => loadDesigns(dir)); } },
      { kind: "sub", label: "Move to", items: targets },
      { kind: "sep" },
      {
        kind: "item", label: "Delete", danger: true, onSelect: () => {
          void trashDesign(dir, row.slug).then(() => {
            toastAction("Moved to trash", "Undo", () => void undoDesign(dir));
          });
        },
      },
    ];
  };

  const trailingFor = (row: DesignRow) => {
    if (row.bad) return <span className="text-[11px] text-state-error">couldn't read this design</span>;
    if (designTurnActive && p.active === row.slug) {
      return (
        <span className="inline-flex items-center gap-[5px] text-[11px] text-state-neutral">
          <span aria-hidden className="size-[5px] shrink-0 rounded-full bg-state-neutral" style={{ animation: "wv-pulse 1.6s ease-in-out infinite" }} />
          working
        </span>
      );
    }
    if (row.latestVersion == null) return <span className="text-[11px] text-text-faint">draft</span>;
    return <span className="font-mono text-[10.5px] text-text-faint">{`v${row.latestVersion}`}</span>;
  };

  const visibleKinds = KINDS.filter((k) => grouped[k].length > 0);

  return (
    <aside data-chrome className="flex w-[248px] shrink-0 flex-col border-r border-border-hairline">
      <TreeHeader label={total > 0 ? `Designs · ${total}` : "Designs"} className="h-10 flex-none border-b border-border-hairline">
        <TreeIconButton aria-label="New design" onClick={onNew}>
          <PlusGlyph size={13} />
        </TreeIconButton>
      </TreeHeader>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-1 text-[12.5px] text-text-secondary">
        {total === 0 ? (
          <p className="px-1.5 py-3.5 text-[11.5px] leading-relaxed text-text-faint">
            No designs yet. Anything you make lands here, saved in <span className="font-mono text-[10.5px]">.chronicle/designs/</span>.
          </p>
        ) : (
          visibleKinds.map((kind) => (
            <div key={kind} data-design-drop={kind}>
              <div className="mt-2.5 flex h-6 items-center gap-1.5 px-1.5 first:mt-0.5">
                <span className="text-[10px] uppercase tracking-[0.09em] text-text-faint">{KIND_LABEL[kind]}</span>
                <span className="flex-1" />
                <span className="font-mono text-[10px] text-text-faint">{grouped[kind].length}</span>
              </div>
              {grouped[kind].map((row) => {
                const nodes = menuFor(row);
                const isRenaming = renaming === row.slug;
                const hot = dropAt?.kind === kind && dropAt.slug === row.slug;
                return (
                  <div key={row.slug} data-design-drop={`${kind}:${row.slug}`}>
                    {isRenaming ? (
                      <NameInput
                        initial={row.title}
                        onDone={(name) => {
                          setRenaming(null);
                          if (name?.trim() && name.trim() !== row.title) void renameDesign(dir, row.slug, name.trim());
                        }}
                      />
                    ) : (
                      <RowMenus nodes={nodes}>
                        <div className={cn("group/row", dragging === row.slug && "opacity-40")}>
                          <TreeRow
                            name={row.title}
                            marquee
                            selected={p.active === row.slug}
                            dropping={hot}
                            icon={<KindGlyph kind={row.kind} className="shrink-0 text-text-subtle" />}
                            onClick={() => { if (!swallowedClick()) void openDesign(dir, row.slug); }}
                            onPointerDown={(e) => {
                              // the ⋯ is its own button; a press there is never a drag
                              if ((e.target as Element).closest("[role=button]")) return;
                              onPress(row.slug, row.kind, e);
                            }}
                            trailing={
                              <span className="flex flex-none items-center gap-1.5">
                                {trailingFor(row)}
                                <RowDots label={`More actions for ${row.title}`} nodes={nodes} />
                              </span>
                            }
                          />
                        </div>
                      </RowMenus>
                    )}
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>

      {ghost && (
        <div
          aria-hidden
          style={{ left: ghost.x + 12, top: ghost.y + 8 }}
          className="pointer-events-none fixed z-50 max-w-[220px] truncate rounded-sm border border-border-strong bg-surface-card px-2 py-0.5 text-[11.5px] text-text-primary shadow-md"
        >
          {ghost.name}
        </div>
      )}
    </aside>
  );
}
