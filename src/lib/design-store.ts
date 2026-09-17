/* The Design pane's state per project: the design list, the open design, how each
   frame rendered, the user's undo stack, and the glue that turns a finished design
   turn into a version. Mirrors notes-store: module Maps, one subscribe, no React. */
import {
  designsList, designRead, designFrameBase, designVersions, designCanvasSave, designRename, designSetKind,
  designTrash, designUntrash, designsOrderSave, designCreate, designSnapshot, designThumbnails, onDesignsChanged,
  type VersionMeta,
} from "./ipc";
import { parseDesign, type CanvasFile, type Design, type DesignKind, type DesignRow } from "./design-model";
import {
  laneKey, agentSessionFor, subscribeAgent, sendAgentMessage, startAgentSession, resumeAgentSession, type AgentEntry,
} from "./agent-session";
import { every } from "@/lib/scheduler";

export type FrameState = { kind: "placeholder" } | { kind: "rendering" } | { kind: "rendered"; height: number } | { kind: "failed"; message: string; line: number };
export type UndoEntry = { label: string; undo: () => Promise<void>; redo: () => Promise<void> };
export interface DesignProject {
  rows: DesignRow[]; order: Record<string, string[]>; active: string | null; design: Design | null; canvas: CanvasFile;
  bad: boolean; frameStates: Record<string, FrameState>; base: string | null; versions: VersionMeta[]; reloadTick: number;
  undo: UndoEntry[]; redo: UndoEntry[]; seenTurnEnds: number;
  /** the slug a `sendDesignMessage` turn was sent for — the turn-end snapshot
   *  targets this, not whatever the user has since clicked over to */
  turnSlug: string | null;
  /** bumped on every non-reload `openDesign`; a slower, older call that lands
   *  after a newer one started is dropped instead of clobbering it */
  openToken: number;
}

const projects = new Map<string, DesignProject>();
const subs = new Set<() => void>();
let ready = false;
const notify = () => { for (const cb of subs) cb(); };
const emptyCanvas = (): CanvasFile => ({ positions: {}, viewport: null });

export function designProjectFor(dir: string): DesignProject {
  ensure();
  let p = projects.get(dir);
  if (!p) {
    // Seed the counter from the design lane's OWN turnEnds — an already-running
    // session's past turns are not new turns this store needs to version.
    const seenTurnEnds = agentSessionFor(laneKey(dir, "design")).turnEnds;
    p = { rows: [], order: {}, active: null, design: null, canvas: emptyCanvas(), bad: false, frameStates: {}, base: null, versions: [], reloadTick: 0, undo: [], redo: [], seenTurnEnds, turnSlug: null, openToken: 0 };
    projects.set(dir, p);
  }
  return p;
}

export function subscribeDesigns(cb: () => void): () => void { ensure(); subs.add(cb); return () => subs.delete(cb); }

function ensure() {
  if (ready) return;
  ready = true;
  void onDesignsChanged((e) => {
    const p = projects.get(e.dir);
    if (!p) return;
    void loadDesigns(e.dir);
    if (p.active === e.slug && e.paths.some((x) => x !== "canvas.json")) void openDesign(e.dir, e.slug, true);
  });
  subscribeAgent(() => {
    for (const [dir, p] of projects) {
      const s = agentSessionFor(laneKey(dir, "design"));
      // An idle-stop or a restart resets the session's own counter (blank());
      // follow it down so the NEXT real turn still reads as new, instead of
      // sitting forever above a seenTurnEnds that can no longer be reached.
      if (s.turnEnds < p.seenTurnEnds) p.seenTurnEnds = s.turnEnds;
      if (s.turnEnds > p.seenTurnEnds) {
        p.seenTurnEnds = s.turnEnds;
        // The turn belongs to whichever design it was sent for; fall back to
        // the open design only when no send recorded one (e.g. a turn kicked
        // off outside sendDesignMessage).
        const slug = p.turnSlug ?? p.active;
        p.turnSlug = null;
        if (slug) void snapshotTurn(dir, slug);
      }
    }
  });
}

export const designPrefix = (slug: string) => `[design: ${slug} · .chronicle/designs/${slug}/]`;

export function summaryOf(entries: AgentEntry[]): string {
  const last = [...entries].reverse().find((e) => e.kind === "assistant") as { text?: string } | undefined;
  const text = (last?.text ?? "").trim();
  const m = text.match(/^[\s\S]*?[.!?](\s|$)/);
  return (m ? m[0] : text).trim().slice(0, 200);
}

async function snapshotTurn(dir: string, slug: string) {
  const s = agentSessionFor(laneKey(dir, "design"));
  const n = await designSnapshot(dir, slug, s.lastPrompt, summaryOf(s.entries), s.sessionId ?? "").catch(() => null);
  const p = designProjectFor(dir);
  if (n != null) await designThumbnails(dir, slug, n).catch(() => []);
  p.versions = await designVersions(dir, slug).catch(() => p.versions);
  await loadDesigns(dir);
  notify();
}

export async function loadDesigns(dir: string): Promise<void> {
  const p = designProjectFor(dir);
  const r = await designsList(dir);
  p.rows = r.rows; p.order = r.order ?? {};
  notify();
}

export async function openDesign(dir: string, slug: string, reload = false): Promise<void> {
  const p = designProjectFor(dir);
  if (!p.base) p.base = await designFrameBase(dir);
  const token = ++p.openToken;
  const r = await designRead(dir, slug);
  // A watcher-driven reload for a design the user has since clicked away
  // from would otherwise switch the pane back to it.
  if (reload && p.active !== slug) return;
  // A slower, older plain open() landing after a newer one started would
  // otherwise clobber the newer design with stale data.
  if (!reload && token !== p.openToken) return;
  p.active = slug;
  p.design = parseDesign(r.design);
  p.bad = r.bad || (!!r.design && !p.design);
  p.canvas = (r.canvas as CanvasFile) ?? emptyCanvas();
  if (!reload) p.frameStates = {};
  for (const f of p.design?.frames ?? []) if (!p.frameStates[f.id] || reload) p.frameStates[f.id] = { kind: "rendering" };
  if (reload) p.reloadTick += 1;
  p.versions = await designVersions(dir, slug).catch(() => []);
  notify();
}

export function frameMessage(dir: string, frameId: string, data: unknown): void {
  if (!data || typeof data !== "object" || (data as Record<string, unknown>).__chronicleFrame !== 1) return;
  const d = data as Record<string, unknown>;
  const p = designProjectFor(dir);
  if (d.type === "ready" || d.type === "height") {
    const h = Number(d.height);
    if (Number.isFinite(h) && h > 0) p.frameStates[frameId] = { kind: "rendered", height: h };
  } else if (d.type === "error") {
    p.frameStates[frameId] = { kind: "failed", message: String(d.message ?? "The page hit an error"), line: Number(d.line) || 0 };
  } else if (d.type === "blank") {
    p.frameStates[frameId] = { kind: "failed", message: "The page came out empty", line: 0 };
  } else return;
  notify();
}

export async function runUndoable(dir: string, e: UndoEntry): Promise<void> {
  const p = designProjectFor(dir);
  await e.redo();
  p.undo.push(e); p.redo = [];
  notify();
}
export async function undoDesign(dir: string) {
  const p = designProjectFor(dir); const e = p.undo.pop(); if (!e) return;
  await e.undo(); p.redo.push(e); notify();
}
export async function redoDesign(dir: string) {
  const p = designProjectFor(dir); const e = p.redo.pop(); if (!e) return;
  await e.redo(); p.undo.push(e); notify();
}

export function moveFrame(dir: string, frameId: string, x: number, y: number): Promise<void> {
  const p = designProjectFor(dir); const slug = p.active; if (!slug) return Promise.resolve();
  const before = structuredClone(p.canvas);
  const after: CanvasFile = { ...before, positions: { ...before.positions, [frameId]: { x, y } } };
  const apply = (c: CanvasFile) => async () => { p.canvas = structuredClone(c); await designCanvasSave(dir, slug, p.canvas); notify(); };
  return runUndoable(dir, { label: "Move frame", undo: apply(before), redo: apply(after) });
}

export function renameDesign(dir: string, slug: string, title: string): Promise<void> {
  const p = designProjectFor(dir);
  const old = p.rows.find((r) => r.slug === slug)?.title ?? p.design?.title ?? slug;
  const apply = (t: string) => async () => { await designRename(dir, slug, t); await loadDesigns(dir); if (p.active === slug && p.design) p.design.title = t; };
  return runUndoable(dir, { label: "Rename", undo: apply(old), redo: apply(title) });
}

export function setDesignKind(dir: string, slug: string, kind: DesignKind): Promise<void> {
  const p = designProjectFor(dir);
  const old = p.rows.find((r) => r.slug === slug)?.kind ?? "app";
  const apply = (k: DesignKind) => async () => { await designSetKind(dir, slug, k); await loadDesigns(dir); };
  return runUndoable(dir, { label: "Change kind", undo: apply(old), redo: apply(kind) });
}

export function trashDesign(dir: string, slug: string): Promise<void> {
  const p = designProjectFor(dir);
  let trashRel = ""; let current = slug;
  return runUndoable(dir, {
    label: "Delete design",
    redo: async () => { trashRel = await designTrash(dir, current); if (p.active === current) { p.active = null; p.design = null; } await loadDesigns(dir); },
    undo: async () => { current = await designUntrash(dir, trashRel); await loadDesigns(dir); },
  });
}

export function reorderDesigns(dir: string, kind: DesignKind, slugs: string[]): Promise<void> {
  const p = designProjectFor(dir);
  const before = structuredClone(p.order);
  const after = { ...before, [kind]: slugs };
  const apply = (o: Record<string, string[]>) => async () => { p.order = structuredClone(o); await designsOrderSave(dir, p.order); notify(); };
  return runUndoable(dir, { label: "Reorder", undo: apply(before), redo: apply(after) });
}

export async function startDesign(dir: string, kind: DesignKind, brief: string): Promise<string> {
  const title = brief.split(/[.,;\n]/)[0].trim().slice(0, 60) || "Untitled design";
  const slug = await designCreate(dir, kind, title, brief);
  await loadDesigns(dir);
  await openDesign(dir, slug);
  await sendDesignMessage(dir, brief);
  return slug;
}

/** Waits for the lane to reach "ready", with a real deadline: a store change
 *  usually settles this immediately, but nothing else here guarantees the
 *  store ever changes again, so `every()` (src/lib/scheduler.ts) re-checks
 *  on its own cadence and both watchers are torn down together on settle —
 *  no bare setTimeout, per the no-bare-timers rule. */
function waitForReady(key: string, ms: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    let un: () => void = () => {};
    let stopTicker: () => void = () => {};
    const settle = (fn: () => void) => { un(); stopTicker(); fn(); };
    const check = () => {
      const s = agentSessionFor(key);
      if (s.phase === "ready") settle(resolve);
      else if (s.phase === "error" || s.phase === "needs-login") settle(() => reject(new Error(s.errorMessage ?? "The design session couldn't start.")));
      else if (Date.now() - started > ms) settle(() => reject(new Error("The design session took too long to start.")));
    };
    un = subscribeAgent(check);
    stopTicker = every(1_000, check);
    check();
  });
}

export async function sendDesignMessage(dir: string, text: string): Promise<void> {
  const p = designProjectFor(dir); const slug = p.active;
  if (!slug) throw new Error("Pick a design first.");
  const key = laneKey(dir, "design");
  const s = agentSessionFor(key);
  if (s.phase !== "ready") {
    // Read these before anything (a start/resume) resets the session object.
    const canResume = s.phase === "ended" && !!s.sessionId && s.loadSession;
    const resumeId = s.sessionId;
    if (canResume) await resumeAgentSession(key, resumeId!);
    else if (s.phase === "none" || s.phase === "ended" || s.phase === "error") await startAgentSession(key);
    await waitForReady(key, 90_000);
  }
  p.turnSlug = slug;
  await sendAgentMessage(key, text, undefined, { prefix: designPrefix(slug) });
}
