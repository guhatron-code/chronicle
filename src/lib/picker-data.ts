/*
 * get_picker → the F2/F5 view models. Pure mapping — ground truth in, frame
 * anatomy out. Marks are stable per path (brand data, hashed into --mark-1…6).
 */
import type { PickerRecent } from "./ipc";
import type { RecentProject } from "@/screens/RecentCard";
import type { PaletteProject } from "@/overlays/CommandPalette";
import type { MarkIndex, StateKind } from "@/components/chrome/atoms";
import { sentence } from "./utils";

export function markFor(path: string): MarkIndex {
  let h = 0;
  for (const c of path) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return ((h % 6) + 1) as MarkIndex;
}

export function markLabel(name: string): string {
  const clean = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  return (clean.slice(0, 2) || "pr").padEnd(2, clean[0] ?? "p");
}

export function tildify(path: string, home?: string): string {
  // The webview has no env access — on macOS the home prefix is recognizable.
  const h = home ?? (path.match(/^\/Users\/[^/]+/)?.[0] ?? "");
  return h && path.startsWith(h) ? `~${path.slice(h.length)}` : path;
}

export function agoFrom(openedAtEpoch: string, nowMs = Date.now()): string {
  const t = Number(openedAtEpoch) * 1000;
  if (!Number.isFinite(t) || t <= 0) return "";
  const mins = Math.max(1, Math.round((nowMs - t) / 60_000));
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return `${Math.round(days / 7)}w ago`;
}

/** A running init for this path (app state) forces the "writing" card. */
export function toRecentProject(
  r: PickerRecent,
  opts: { home?: string; agent?: string; writing?: boolean; openNow?: boolean; liveSessions?: number } = {},
): RecentProject {
  const base = {
    path: r.path,
    name: r.name,
    tildePath: tildify(r.path, opts.home),
    description: r.description || undefined,
    mark: markFor(r.path),
    markLabel: markLabel(r.name),
    ago: agoFrom(r.opened_at),
    openNow: opts.openNow,
    liveSessions: opts.liveSessions,
  };
  if (r.missing) return { ...base, variant: { kind: "missing" } };
  if (opts.writing) return { ...base, variant: { kind: "writing" } };
  const total = r.total ?? 0;
  const done = r.done ?? 0;
  if (r.current?.id) {
    const label = r.current.label ?? "";
    return {
      ...base,
      variant: {
        kind: "phase",
        phaseId: r.current.id,
        phaseName: r.current.name ?? "",
        statusWord: sentence(label) || "Up next",
        running: /running|scanning|building/i.test(label),
        progress: total > 0 ? done / total : 0,
        waiting: r.needs ?? 0,
      },
    };
  }
  if (total > 0 && done === total) return { ...base, variant: { kind: "all-done" } };
  return { ...base, variant: { kind: "no-roadmap", agent: opts.agent ?? "Claude" } };
}

export function toPaletteProject(r: PickerRecent, home?: string): PaletteProject {
  let statusWord = "No roadmap yet";
  let statusKind: StateKind = "neutral";
  if (r.missing) {
    statusWord = "Folder missing";
    statusKind = "error";
  } else if (r.current?.id) {
    statusWord = sentence(r.current.label || "Up next");
    statusKind = /running|scanning|building/i.test(statusWord) ? "running" : "neutral";
  } else if ((r.total ?? 0) > 0 && r.done === r.total) {
    statusWord = "Done";
    statusKind = "success";
  }
  return {
    path: r.path,
    name: r.name,
    tildePath: tildify(r.path, home),
    mark: markFor(r.path),
    markLabel: markLabel(r.name),
    statusWord,
    statusKind,
  };
}
