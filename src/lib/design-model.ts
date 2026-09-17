/* A design as the canvas sees it: design.json (the session's) + canvas.json (the app's). */
import type { Viewport } from "./canvas-math";

export type DesignKind = "app" | "marketing" | "deck" | "brand" | "ecommerce";
export const KINDS: DesignKind[] = ["ecommerce", "app", "marketing", "brand", "deck"];
export const KIND_LABEL: Record<DesignKind, string> = { app: "App UI", marketing: "Marketing", deck: "Deck", brand: "Brand", ecommerce: "E-commerce" };

export interface Frame { id: string; file: string; label: string; width: number; height: number; group: string }
export interface Group { id: string; label: string; kind: "breakpoints" | "variations" }
export interface Design { v: 1; title: string; kind: DesignKind; brief: string; created: string; frames: Frame[]; groups: Group[]; chosen: string | null }
export interface CanvasFile { positions: Record<string, { x: number; y: number }>; viewport: Viewport | null }
export interface DesignRow { slug: string; title: string; kind: DesignKind; frames: number; created: string; latestVersion: number | null; updatedMs: number; bad: boolean }

const isKind = (k: unknown): k is DesignKind => typeof k === "string" && (KINDS as string[]).includes(k);
const num = (n: unknown) => (typeof n === "number" && Number.isFinite(n) && n > 0 ? n : null);

export function parseDesign(raw: unknown): Design | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!isKind(r.kind)) return null;
  const frames: Frame[] = (Array.isArray(r.frames) ? r.frames : []).flatMap((f) => {
    const o = f as Record<string, unknown>;
    const width = num(o.width), height = num(o.height);
    if (typeof o.id !== "string" || typeof o.file !== "string" || !width) return [];
    return [{ id: o.id, file: o.file, label: typeof o.label === "string" ? o.label : o.id, width, height: height ?? 900, group: typeof o.group === "string" ? o.group : "" }];
  });
  const groups: Group[] = (Array.isArray(r.groups) ? r.groups : []).flatMap((g) => {
    const o = g as Record<string, unknown>;
    if (typeof o.id !== "string") return [];
    return [{ id: o.id, label: typeof o.label === "string" ? o.label : o.id, kind: o.kind === "variations" ? "variations" : "breakpoints" }];
  });
  return { v: 1, title: typeof r.title === "string" ? r.title : "Untitled", kind: r.kind, brief: typeof r.brief === "string" ? r.brief : "", created: typeof r.created === "string" ? r.created : "", frames, groups, chosen: typeof r.chosen === "string" ? r.chosen : null };
}

const COL_GAP = 80, ROW_GAP = 120;

export function placeFrames(d: Design, positions: CanvasFile["positions"], heights: Record<string, number>) {
  const out: Record<string, { x: number; y: number; w: number; h: number }> = {};
  const groupIds = [...d.groups.map((g) => g.id), ...new Set(d.frames.map((f) => f.group).filter((g) => !d.groups.some((x) => x.id === g)))];
  let rowY = 0;
  for (const gid of groupIds) {
    const frames = d.frames.filter((f) => f.group === gid);
    if (!frames.length) continue;
    let x = 0, rowH = 0;
    for (const f of frames) {
      const h = heights[f.id] ?? f.height;
      const p = positions[f.id] ?? { x, y: rowY };
      out[f.id] = { x: p.x, y: p.y, w: f.width, h };
      x += f.width + COL_GAP;
      rowH = Math.max(rowH, h);
    }
    rowY += rowH + ROW_GAP;
  }
  return out;
}

export function readingOrder(rects: Record<string, { x: number; y: number }>): string[] {
  return Object.entries(rects).sort(([, a], [, b]) => (a.y === b.y ? a.x - b.x : a.y - b.y)).map(([id]) => id);
}

export function orderRows(rows: DesignRow[], order: Record<string, string[]>): Record<DesignKind, DesignRow[]> {
  const out = Object.fromEntries(KINDS.map((k) => [k, [] as DesignRow[]])) as Record<DesignKind, DesignRow[]>;
  for (const k of KINDS) {
    const mine = rows.filter((r) => r.kind === k);
    const pinned = (order[k] ?? []).map((s) => mine.find((r) => r.slug === s)).filter((r): r is DesignRow => !!r);
    const rest = mine.filter((r) => !pinned.includes(r)).sort((a, b) => b.updatedMs - a.updatedMs);
    out[k] = [...pinned, ...rest];
  }
  return out;
}
