/*
 * The Web pane's chrome. The page itself is a native WebKit view that Rust
 * positions over the empty content region below; this component only draws
 * the tab sidebar, the address bar and the nav, measures the region, and tells
 * the store whether the pane is actually on screen.
 *
 * The region is measured inside the content column, to the right of the
 * sidebar and its splitter — so the native page never sits under the tabs.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { cn } from "@/lib/utils";
import { displayAddress } from "@/lib/web-url";
import {
  back, blockInfo, closeTab, forward, navigate, newTab, prepare, pushBounds, reload,
  setWebVisible, subscribeBlock, subscribeWeb, webFor,
} from "@/lib/web-store";
import { SplitHandle } from "@/components/chrome/SplitHandle";
import { WebSidebar } from "./WebSidebar";
import type { ConfirmSpec } from "@/overlays/ConfirmDialog";

function fmtDate(iso: string): string {
  const d = new Date(iso); return isNaN(d.getTime()) ? "unknown" : d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/* the sidebar width — global, not per-project, exactly like the explorer's
   `chronicle.treew` and the notes sidebar's own key */
const SIDEBARW_KEY = "chronicle.web.sidebarw";
const SIDEBARW_MIN = 170;
const SIDEBARW_MAX = 480;
function loadSidebarWidth(): number {
  try {
    const v = Number(localStorage.getItem(SIDEBARW_KEY));
    return Number.isFinite(v) && v >= SIDEBARW_MIN && v <= SIDEBARW_MAX ? v : 232;
  } catch { return 232; }
}

export function WebPane({ dir, onScreen, onConfirm }: { dir: string; onScreen: boolean; onConfirm?: (spec: ConfirmSpec) => void }) {
  const [, bump] = useState(0);
  const [menu, setMenu] = useState(false);
  /* a row menu or a drag in the sidebar — same overlay rule as the ⋯ menu */
  const [sidebarOverlay, setSidebarOverlay] = useState(false);
  useEffect(() => subscribeWeb(() => bump((n) => n + 1)), []);
  useEffect(() => subscribeBlock(() => bump((n) => n + 1)), []);
  useEffect(() => { void prepare(dir); }, [dir]);
  // DOM never paints over a native child webview — so any open menu counts as
  // an overlay: the page hides while one is up, here and in the sidebar
  const covered = menu || sidebarOverlay;
  useEffect(() => { setWebVisible(onScreen && !covered ? dir : null); return () => setWebVisible(null); }, [dir, onScreen, covered]);

  const p = webFor(dir);
  const t = p.active >= 0 ? p.tabs[p.active] : null;
  const block = blockInfo();

  /* the region the native page sits over — inside the content column, so the
     sidebar and its splitter are outside the bounds Rust is given */
  const region = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = region.current; if (!el) return;
    const push = () => pushBounds(el.getBoundingClientRect());
    push();
    const ro = new ResizeObserver(push); ro.observe(el);
    window.addEventListener("resize", push);
    return () => { ro.disconnect(); window.removeEventListener("resize", push); };
  }, []);

  const [draft, setDraft] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const shown = draft ?? (t ? displayAddress(t.url) : "");

  const submit = useCallback(() => {
    if (draft == null) return;
    if (!t) void newTab(dir).then(() => void navigate(dir, webFor(dir).active, draft));
    else void navigate(dir, p.active, draft);
    setDraft(null); input.current?.blur();
  }, [draft, t, dir, p.active]);

  /** The pane's one "new tab": it opens and hands the address bar the caret.
   *  `folder` undefined means the active tab's folder (the store's rule). */
  const openTab = useCallback((folder?: string | null) => {
    void newTab(dir, "about:blank", folder);
    requestAnimationFrame(() => { input.current?.focus(); input.current?.select(); });
  }, [dir]);

  /* the sidebar splitter — the notes sidebar's drag math and bounds, its own
     global width key. The region's ResizeObserver re-pushes bounds as it moves. */
  const [sidebarWidth, setSidebarWidth] = useState(loadSidebarWidth);
  const onSidebarSplitterDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = sidebarWidth;
    const move = (ev: PointerEvent) => {
      setSidebarWidth(Math.min(SIDEBARW_MAX, Math.max(SIDEBARW_MIN, startW + ev.clientX - startX)));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      setSidebarWidth((w) => {
        try { localStorage.setItem(SIDEBARW_KEY, String(w)); } catch { /* private mode */ }
        return w;
      });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }, [sidebarWidth]);

  /* shortcuts while the chrome has focus. the terminal/agent column keeps its
     own ⌘T/⌘L while it has focus */
  useEffect(() => {
    if (!onScreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      // the terminal/agent column keeps its own ⌘T/⌘L while it has focus
      if ((document.activeElement as HTMLElement | null)?.closest?.("[data-right-column]")) return;
      if (e.key === "l") { e.preventDefault(); e.stopPropagation(); input.current?.focus(); input.current?.select(); }
      else if (e.key === "t") { e.preventDefault(); e.stopPropagation(); openTab(); }
      else if (e.key === "w" && t) { e.preventDefault(); e.stopPropagation(); void closeTab(dir, p.active); }
      else if (e.key === "r" && t) { e.preventDefault(); reload(t); }
      else if (e.key === "[" && t) { e.preventDefault(); back(t); }
      else if (e.key === "]" && t) { e.preventDefault(); forward(t); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onScreen, dir, t, p.active, openTab]);

  // the ⋯ menu closes on Escape or a click outside its wrapper — it does not
  // otherwise have a way to close, so left open it would stay open forever
  const menuWrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMenu(false); };
    const onClick = (e: MouseEvent) => { if (menuWrap.current && !menuWrap.current.contains(e.target as Node)) setMenu(false); };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onClick);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("mousedown", onClick); };
  }, [menu]);

  const pill = block.status === "ready" ? `Blocking · ${block.lists} list${block.lists === 1 ? "" : "s"}`
    : block.status === "partial" ? "Blocking · partial"
    : block.status === "missing" ? "Blocking off — no lists shipped"
    : "Preparing blocking…";

  return (
    <div className="flex h-full min-h-0">
      {/* tabs — a sidebar of the explorer's rows, folders and all */}
      <WebSidebar
        dir={dir}
        p={p}
        width={sidebarWidth}
        onNewTab={openTab}
        onOverlay={setSidebarOverlay}
        onConfirm={onConfirm}
      />
      <SplitHandle aria-label="Resize the tab sidebar" onPointerDown={onSidebarSplitterDown} />

      <div className="flex min-w-0 flex-1 flex-col">
        {/* address bar */}
        <div data-chrome className="flex items-center gap-1.5 border-b border-divider bg-surface-sidebar px-2 py-1.5">
          <button aria-label="Back" disabled={!t?.canBack} onClick={() => t && back(t)} className="size-6 rounded-md text-text-subtle disabled:text-text-dimmer hover:bg-fill-hover">‹</button>
          <button aria-label="Forward" disabled={!t?.canForward} onClick={() => t && forward(t)} className="size-6 rounded-md text-text-subtle disabled:text-text-dimmer hover:bg-fill-hover">›</button>
          <button aria-label="Reload" disabled={!t} onClick={() => t && reload(t)} className="size-6 rounded-md text-text-subtle disabled:text-text-dimmer hover:bg-fill-hover">↻</button>
          <input ref={input} value={shown} placeholder="Search or enter an address"
            onChange={(e) => setDraft(e.target.value)} onFocus={(e) => { setDraft(t ? (t.url === "about:blank" || t.url.startsWith("chronicle-file://") ? "" : t.url) : ""); e.target.select(); }}
            onBlur={() => setDraft(null)} onKeyDown={(e) => { if (e.key === "Enter") submit(); if (e.key === "Escape") { setDraft(null); input.current?.blur(); } }}
            className="h-7 min-w-0 flex-1 rounded-md border border-border-field bg-surface-input px-2.5 font-mono text-[11.5px] text-text-secondary outline-none focus:border-border-field-focus" />
          <span className="flex h-6 items-center gap-1.5 whitespace-nowrap rounded-md border border-border-hairline px-2 text-[11px] text-text-subtle">
            <span className={cn("size-1.5 rounded-full", block.status === "ready" ? "bg-state-success" : block.status === "partial" ? "bg-state-error" : "bg-state-neutral")} />{pill}
          </span>
          <div className="relative" ref={menuWrap}>
            <button aria-label="More" onClick={() => setMenu((m) => !m)} className="h-6 rounded-md border border-border-hairline px-2 text-[11px] text-text-subtle hover:text-text-primary">⋯</button>
            {menu && (
              <div className="absolute right-0 top-7 z-10 w-72 rounded-md border border-border-strong bg-surface-overlay p-3 text-[11.5px] text-text-secondary [box-shadow:var(--shadow-overlay)]">
                <div>Lists fetched {block.fetched_at ? fmtDate(block.fetched_at) : "—"}; they refresh with each release.</div>
                {block.sources && block.sources.length > 0 && (
                  <div className="mt-2 text-text-dim">From {block.sources.join(", ")}.</div>
                )}
                {block.failed.length > 0 && <div className="mt-2 text-state-error">Couldn't load: {block.failed.join("; ")}</div>}
                <div className="mt-2 text-text-dim">Ads and trackers are blocked at the network level, the way uBlock's lists do it. Scriptlet tricks aren't possible in this engine.</div>
                <div className="mt-2 text-text-dim">EasyList and EasyPrivacy are © the EasyList authors (CC BY-SA 3.0 / GPL-3.0); the uBlock Origin lists are GPL-3.0; Peter Lowe's list is free for personal use; converted with eyeo's abp2blocklist (GPL-3.0).</div>
              </div>
            )}
          </div>
        </div>
        {/* the region the page covers; the cover shows while the page is hidden */}
        <div ref={region} className="relative min-h-0 flex-1 bg-surface-app">
          {(!onScreen || !t || covered) && (
            <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-[12px] text-text-dim" onClick={menu ? () => setMenu(false) : undefined}>
              {!t ? "Type an address above, or open an HTML file from the Repo view."
                : covered && onScreen ? `${t.title || displayAddress(t.url)} — hidden while a menu is open`
                : `${t.title || displayAddress(t.url)} — resumes when this comes back on screen`}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
