/*
 * The Web pane's state, outside React so tabs survive pane and project
 * switches. One module-scope listener per event, routed by tab label. The
 * show/hide policy lives here: exactly one native page is visible, and only
 * while App says the pane is on screen and the window is visible. Tabs are
 * persisted per project in app data; hidden tabs lose their native view after
 * 30 minutes and get it back from their URL on the next activation.
 */
import { every, subscribeActivity, getActivity } from "./scheduler";
import { toAddress } from "./web-url";
import {
  onWebBlocklistsChanged, onWebDownload, onWebOpenTab, onWebTabChanged,
  webBlocklistsInfo, webBlocklistsPrepare, webHideAll, webOpenFile, webSetBounds,
  webTabBack, webTabClose, webTabForward, webTabNavigate, webTabOpen, webTabReload, webTabShow,
  webTabsLoad, webTabsSave, type BlockInfo,
} from "./ipc";
import { toastError, toastSuccess } from "@/overlays/toasts";

export interface WebTab {
  /** stable identity for React keys — indexes shift when a tab closes */
  id: number;
  label: string | null;       // null = evicted or not yet restored; recreated on activation
  url: string; title: string; loading: boolean; canBack: boolean; canForward: boolean;
  hiddenSince: number | null;
  /** in-flight web_tab_open, so two overlapping callers share one native view */
  opening?: Promise<string | null>;
}
export interface WebProject { tabs: WebTab[]; active: number; restored: boolean }

/** Tab identity, monotonic for the life of the process. */
let nextTabId = 1;

const projects = new Map<string, WebProject>();
const subs = new Set<() => void>();
const notify = () => { for (const cb of subs) cb(); };
export function subscribeWeb(cb: () => void): () => void { subs.add(cb); return () => { subs.delete(cb); }; }
export function webFor(dir: string): WebProject {
  let p = projects.get(dir);
  if (!p) { p = { tabs: [], active: -1, restored: false }; projects.set(dir, p); }
  return p;
}

let block: BlockInfo = { status: "idle", lists: 0, total: 0, fetched_at: "", failed: [], sources: [] };
const blockSubs = new Set<() => void>();
export function blockInfo(): BlockInfo { return block; }
export function subscribeBlock(cb: () => void): () => void { blockSubs.add(cb); return () => { blockSubs.delete(cb); }; }

/* what App decides: the pane is on screen (rail=web, content shown, no overlay) */
let visibleDir: string | null = null;
let ready = false;
const EVICT_MS = 30 * 60_000;
/** Single-flight guard: a stale applyVisibility() call bails once a newer one has started. */
let visGen = 0;

function findTab(label: string): { dir: string; p: WebProject; t: WebTab; i: number } | null {
  for (const [dir, p] of projects) {
    const i = p.tabs.findIndex((t) => t.label === label);
    if (i >= 0) return { dir, p, t: p.tabs[i], i };
  }
  return null;
}

function ensure() {
  if (ready) return;
  ready = true;
  void onWebTabChanged((s) => {
    const f = findTab(s.label); if (!f) return;
    Object.assign(f.t, { url: s.url || f.t.url, title: s.title || f.t.title, loading: s.loading, canBack: s.can_back, canForward: s.can_forward });
    schedulePersist(f.dir); notify();
  });
  void onWebOpenTab((p) => { const f = findTab(p.from_label); if (f) void newTab(f.dir, p.url); });
  void onWebDownload((p) => { p.ok ? toastSuccess("Saved to Downloads") : toastError("The download didn't finish"); });
  void onWebBlocklistsChanged((i) => {
    block = i;
    for (const cb of blockSubs) cb();
    // a tab that couldn't materialise while compiling gets another shot now
    void applyVisibility();
  });
  void webBlocklistsInfo().then((i) => { block = i; for (const cb of blockSubs) cb(); }).catch(() => {});
  subscribeActivity(() => void applyVisibility());
  // hidden tabs lose their native view after 30 minutes (checked every 5)
  every(5 * 60_000, () => {
    const now = Date.now();
    const activeProject = visibleDir ? projects.get(visibleDir) : null;
    for (const [, p] of projects) for (const t of p.tabs) {
      if (p === activeProject && p.tabs[p.active] === t) continue; // never evict what's on screen
      if (t.label && t.hiddenSince && now - t.hiddenSince > EVICT_MS) { void webTabClose(t.label).catch(() => {}); t.label = null; }
    }
  });
}

async function persist(dir: string) {
  const p = projects.get(dir); if (!p) return;
  await webTabsSave(dir, p.tabs.map((t) => ({ url: t.url, title: t.title }))).catch(() => {});
}

/** Trailing debounce: bursts of tab-changed events (loading, title, URL) collapse to one write. */
const persistTimers = new Map<string, ReturnType<typeof setTimeout>>();
function schedulePersist(dir: string): void {
  const existing = persistTimers.get(dir);
  if (existing) clearTimeout(existing);
  persistTimers.set(dir, setTimeout(() => { persistTimers.delete(dir); void persist(dir); }, 500));
}

/** Called by the pane on first show for a project: restore saved tabs (lazily — only the active one gets a view). */
export async function prepare(dir: string): Promise<void> {
  ensure();
  await webBlocklistsPrepare().catch(() => {});
  const p = webFor(dir);
  if (p.restored) return;
  p.restored = true;
  const saved = await webTabsLoad(dir).catch(() => [] as { url: string; title: string }[]);
  const restored: WebTab[] = saved.map((s) => ({ id: nextTabId++, label: null, url: s.url, title: s.title, loading: false, canBack: false, canForward: false, hiddenSince: null }));
  // a tab opened before the restore finished (e.g. via openInWeb) must survive the merge
  const existing = p.tabs;
  p.tabs = [...restored, ...existing];
  p.active = existing.length ? restored.length + Math.max(p.active, 0) : (restored.length ? 0 : -1);
  notify();
  await applyVisibility();
}

/** In-flight guard: applyVisibility and navigate can both reach a tab that has
 *  no native view yet, and two web_tab_open calls would strand one of the two
 *  webviews. Overlapping callers await the same promise. */
async function materialise(dir: string, t: WebTab): Promise<string | null> {
  if (t.label) return t.label;
  if (t.opening) return t.opening;
  t.opening = (async () => {
    try { t.label = await webTabOpen(dir, t.url === "about:blank" ? undefined : t.url); return t.label; }
    catch (e) { toastError("Couldn't open the page", String(e).slice(0, 90)); return null; }
    finally { t.opening = undefined; }
  })();
  return t.opening;
}

export async function applyVisibility(): Promise<void> {
  const gen = ++visGen;
  const a = getActivity();
  const p = visibleDir ? projects.get(visibleDir) : null;
  const t = p && p.active >= 0 ? p.tabs[p.active] : null;
  if (!visibleDir || !a.visible || !t || block.status === "idle" || block.status === "compiling") {
    await webHideAll().catch(() => {});
    if (gen !== visGen) return; // a newer call already decided what's visible
    for (const [, pp] of projects) for (const tt of pp.tabs) if (tt.label && !tt.hiddenSince) tt.hiddenSince = Date.now();
    return;
  }
  const label = await materialise(visibleDir, t);
  if (gen !== visGen) return;
  if (!label) return;
  await webTabShow(label).catch(() => {});
  if (gen !== visGen) return;
  for (const [, pp] of projects) for (const tt of pp.tabs) if (tt.label && tt !== t && !tt.hiddenSince) tt.hiddenSince = Date.now();
  t.hiddenSince = null;
}

export function setWebVisible(dir: string | null): void { visibleDir = dir; void applyVisibility(); }

let lastBounds = "";
export function pushBounds(r: DOMRect): void {
  const dpr = window.devicePixelRatio || 1;
  const x = Math.round(r.left * dpr), y = Math.round(r.top * dpr), w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
  const key = `${x},${y},${w},${h}`;
  if (key === lastBounds) return;
  lastBounds = key;
  void webSetBounds(x, y, w, h).catch(() => {});
}

export async function newTab(dir: string, url = "about:blank"): Promise<void> {
  ensure();
  const p = webFor(dir);
  p.tabs.push({ id: nextTabId++, label: null, url, title: "", loading: false, canBack: false, canForward: false, hiddenSince: null });
  p.active = p.tabs.length - 1;
  notify(); schedulePersist(dir);
  await applyVisibility();
}

export function activate(dir: string, index: number): void {
  const p = webFor(dir); if (index < 0 || index >= p.tabs.length) return;
  p.active = index; notify(); void applyVisibility();
}

export async function closeTab(dir: string, index: number): Promise<void> {
  const p = webFor(dir); const t = p.tabs[index]; if (!t) return;
  const wasActive = p.tabs[p.active]; // identity, not index — the index below is about to shift
  if (t.opening) await t.opening; // don't strand a native view whose open was still in flight
  if (t.label) await webTabClose(t.label).catch(() => {});
  p.tabs.splice(index, 1);
  p.active = wasActive && wasActive !== t ? p.tabs.indexOf(wasActive) : Math.min(index, p.tabs.length - 1);
  notify(); schedulePersist(dir);
  await applyVisibility();
}

/** Address-bar submit: URL or search per web-url rules; javascript: is refused here. */
export async function navigate(dir: string, index: number, input: string): Promise<void> {
  const url = toAddress(input);
  if (!url) { toastError("That address can't be opened here"); return; }
  const p = webFor(dir); const t = p.tabs[index]; if (!t) return;
  t.url = url; notify();
  schedulePersist(dir);
  if (block.status === "idle" || block.status === "compiling") {
    // parked on the tab — applyVisibility materialises it at this url once blocking is ready
    return;
  }
  const label = await materialise(dir, t); if (!label) return;
  await webTabNavigate(label, url).catch((e) => toastError("Couldn't open the page", String(e).slice(0, 90)));
}

export const back = (t: WebTab) => { if (t.label) void webTabBack(t.label).catch(() => {}); };
export const forward = (t: WebTab) => { if (t.label) void webTabForward(t.label).catch(() => {}); };
export const reload = (t: WebTab) => { if (t.label) void webTabReload(t.label).catch(() => {}); };

/** Other panes land here: focus an existing tab on that URL, or open one. */
export async function openInWeb(dir: string, target: { url: string } | { file: string }): Promise<void> {
  ensure();
  const url = "url" in target ? target.url : await webOpenFile(dir, target.file);
  const p = webFor(dir);
  const i = p.tabs.findIndex((t) => t.url === url);
  if (i >= 0) activate(dir, i); else await newTab(dir, url);
}

/** A project file changed: reload any tab showing a file from that project.
 *  Trailing debounce per project — an agent rewriting a report every 450ms would
 *  otherwise reload the page under the reader on every write; one reload a
 *  second after the writes stop is what someone watching a build actually wants. */
const RELOAD_DEBOUNCE_MS = 1000;
const reloadTimers = new Map<string, ReturnType<typeof setTimeout>>();
export function reloadProjectFiles(dir: string): void {
  const existing = reloadTimers.get(dir);
  if (existing) clearTimeout(existing);
  reloadTimers.set(dir, setTimeout(() => {
    reloadTimers.delete(dir);
    const p = projects.get(dir); if (!p) return;
    for (const t of p.tabs) if (t.label && t.url.startsWith("chronicle-file://")) void webTabReload(t.label).catch(() => {});
  }, RELOAD_DEBOUNCE_MS));
}
