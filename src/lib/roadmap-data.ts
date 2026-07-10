/*
 * get_state → RoadmapProps. Pure mapping: ground truth in, frame anatomy out.
 * Handlers and app-local flags (init run, consent, copied flash, expansion)
 * arrive through the context — this module never touches IPC.
 */
import { createElement } from "react";
import type { StateData, ManifestPhase, PhaseStatus } from "./ipc";
import type { RoadmapProps } from "@/screens/roadmap/Roadmap";
import type { NeedsYouRow } from "@/screens/roadmap/NeedsYou";
import type { RailPhase, RailStage, RailChip } from "@/screens/roadmap/PhaseRail";
import type { DocChipProps } from "@/screens/roadmap/DocumentsPanel";
import type { CurrentStateBannerProps } from "@/screens/roadmap/CurrentStateBanner";
import type { HistoryPanelProps, PipelineNode } from "@/screens/roadmap/HistoryPanel";
import type { ProblemCardProps } from "@/screens/roadmap/ProblemCard";
import type { BuildingCardProps } from "@/screens/roadmap/BuildingCard";
import { CodeGlyph, FolderSimpleGlyph, UploadGlyph } from "@/components/chrome/icons";

/* ---------- the app-local slice the mapper needs ---------- */

export interface InitRun {
  running: boolean;
  startedAt: number; // ms
  logLines: string[];
  activeLine: string;
  progress: number; // 0..1
  code: number | null;
  elapsedS: number;
}

export interface RoadmapCtx {
  agent: "claude" | "codex";
  partOf: { name: string; path: string } | null;
  initRun: InitRun | null;
  /** the persisted per-project consent — null means never asked */
  consent: "auto" | "manual" | "basic" | null;
  copiedPath: string | null;
  expandedId: string | null; // null → the now phase
  justSwitched: boolean;
  publishing: boolean; // a publish/pull one-click is in flight
  handlers: {
    onAgentChange: (a: "claude" | "codex") => void;
    onBuild: () => void;
    onRunMyself: () => void;
    onBasicView: () => void;
    onCancelInit: () => void;
    onViewFullLog: () => void;
    onScan: () => void;
    onRebuild: () => void;
    onDismissWarning: () => void;
    onOpenPartOf: (path: string) => void;
    onOpenFile: (path: string) => void;
    onMoveManifest: (sub: string) => void;
    onAction: (id: string, cmd: string) => void;
    onCopyCommand: (cmd: string) => void;
    onCopyDoc: (path: string) => void;
    onTogglePhase: (id: string) => void;
    onViewDetails: (id: string) => void;
    onHistoryDetails: () => void;
    onStartHistory: () => void;
    onAddNext: () => void;
    onReadDecision: (id: string) => void;
  };
  warningDismissed: boolean;
}

/* ---------- helpers ---------- */

export function flatPhases(s: StateData): ManifestPhase[] {
  const out: ManifestPhase[] = [];
  for (const st of s.manifest?.stages ?? []) for (const ph of st.phases ?? []) out.push(ph);
  return out;
}

const realStates = new Set(["done", "now", "later"]);

function nowIndex(statuses: PhaseStatus[]): number {
  return statuses.findIndex((x) => x.state === "now");
}

/** Parse the last useful lines out of an init session's log tail. */
export function logLinesFrom(tail: string, max = 5): string[] {
  const lines: string[] = [];
  for (const raw of tail.split("\n")) {
    const t = raw.trim();
    if (!t) continue;
    if (t.startsWith("{")) {
      try {
        const j = JSON.parse(t) as {
          type?: string;
          message?: { content?: { type?: string; text?: string }[] };
          item?: { text?: string; command?: string };
        };
        if (j.type === "assistant") {
          for (const c of j.message?.content ?? []) {
            if (c.type === "text" && c.text) lines.push(c.text.split("\n")[0].slice(0, 90));
          }
        } else if (j.item?.text) lines.push(j.item.text.split("\n")[0].slice(0, 90));
        else if (j.item?.command) lines.push("$ " + j.item.command.slice(0, 88));
        continue;
      } catch { /* not json — fall through */ }
    }
    lines.push(t.slice(0, 90));
  }
  return lines.slice(-max);
}

/** Deterministic stage progress from what the session has visibly done. */
export function initProgress(tail: string): number {
  if (/chronicle\.json/.test(tail) && /verif/i.test(tail)) return 0.92;
  if (/chronicle\.json/.test(tail)) return 0.82;
  if (/shasum|sha256/.test(tail)) return 0.72;
  if (/git (log|tag|status)/.test(tail)) return 0.5;
  if (/\.md|plan|read/i.test(tail)) return 0.32;
  return tail.length > 200 ? 0.14 : 0.06;
}

const fmtElapsed = (s: number) =>
  s >= 60 ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s` : `${s}s`;

/* ---------- needs-you synthesis (the buildActs port, R2 one-clicks) ---------- */

export function needsYouRows(s: StateData, ctx: RoadmapCtx): NeedsYouRow[] {
  const rows: NeedsYouRow[] = [];
  const H = ctx.handlers;
  if (s.is_git) {
    if (s.work_branch && s.branch && s.branch !== s.work_branch) {
      rows.push({
        id: "branch", icon: createElement(CodeGlyph, { size: 14 }),
        title: `You're on ${s.branch}`,
        sub: `This project works on its own branch (${s.work_branch}).`,
        command: `git checkout ${s.work_branch}`,
        kind: "one-click", hi: true, primary: true, actionLabel: "Switch branch",
        onAction: () => H.onAction("branch", s.work_branch ?? ""),
      });
    }
    if (!s.upstream && s.branch) {
      if (!s.remote_url) {
        const slug = (s.repo.split("/").filter(Boolean).pop() ?? "project").replace(/[^a-zA-Z0-9._-]/g, "-");
        const cmd = `gh repo create ${slug} --private --source=. --push`;
        rows.push({
          id: "github", icon: createElement(UploadGlyph, { size: 14 }),
          title: "Put this project on GitHub",
          sub: "It has no online home yet. Copies a command — paste it in the terminal.",
          command: cmd,
          kind: "one-click", hi: rows.length === 0, actionLabel: "Copy the setup command",
          onAction: () => H.onCopyCommand(cmd),
        });
      } else {
        rows.push({
          id: "publish-first", icon: createElement(UploadGlyph, { size: 14 }),
          title: "Publish the work online",
          sub: "Everything here exists only on this Mac right now.",
          command: `git push -u origin ${s.branch}`,
          kind: "one-click", hi: rows.length === 0, primary: true, actionLabel: "Publish now",
          onAction: () => H.onAction("push", ""),
        });
      }
    }
    if (s.upstream && s.ahead > 0) {
      rows.push({
        id: "publish", icon: createElement(UploadGlyph, { size: 14 }),
        title: `Publish ${s.ahead} save${s.ahead > 1 ? "s" : ""}`,
        sub: "Saved to history, not online yet.",
        command: "git push",
        kind: "one-click", hi: rows.length === 0, primary: true, actionLabel: "Publish now",
        onAction: () => H.onAction("push", ""),
      });
    }
    if (s.upstream && s.behind > 0) {
      rows.push({
        id: "pull", icon: createElement(UploadGlyph, { size: 14, className: "rotate-180" }),
        title: "The online copy is newer",
        sub: "Bring it down before working.",
        command: "git pull --ff-only",
        kind: "one-click", hi: rows.length === 0, actionLabel: "Bring it down",
        onAction: () => H.onAction("pull", ""),
      });
    }
    const prunable = s.worktrees.filter((w) => w.prunable);
    if (prunable.length > 0) {
      rows.push({
        id: "prune", icon: createElement(FolderSimpleGlyph, { size: 14 }),
        title: `Clean up ${prunable.length} stale workspace${prunable.length > 1 ? "s" : ""}`,
        sub: "Leftovers from parallel sessions.",
        command: "git worktree prune",
        kind: "one-click", actionLabel: "Clean up",
        onAction: () => H.onAction("prune", ""),
      });
    }
  }
  for (const a of s.custom_actions) {
    const text = (a.text ?? "").replace(/<[^>]+>/g, "");
    const sep = text.match(/ — | · /);
    const title = sep ? text.slice(0, sep.index) : text;
    const sub = sep ? text.slice((sep.index ?? 0) + sep[0].length) : "";
    rows.push({
      id: `custom-${title.slice(0, 24)}`,
      icon: createElement(CodeGlyph, { size: 14 }),
      title, sub,
      command: a.cmd ?? "",
      kind: "copy-only",
      onCopy: a.cmd ? () => H.onCopyCommand(a.cmd ?? "") : undefined,
    });
  }
  return rows;
}

/* ---------- the full mapping ---------- */

export function mapRoadmap(s: StateData, ctx: RoadmapCtx): RoadmapProps {
  const H = ctx.handlers;
  const props: RoadmapProps = {};
  const phases = flatPhases(s);
  const statuses = s.statuses;

  /* -- problem / consent / building precedence (no manifest present) -- */
  if (!s.manifest_present) {
    let problem: ProblemCardProps | null = null;
    let building: BuildingCardProps | null = null;
    let consent = false;
    if (ctx.partOf) {
      problem = { kind: "part-of", projectName: ctx.partOf.name, path: ctx.partOf.path, onOpen: () => H.onOpenPartOf(ctx.partOf?.path ?? "") };
    } else if (s.manifest_error) {
      problem = { kind: "cant-read", detail: `chronicle.json — ${s.manifest_error}`, onOpenFile: () => H.onOpenFile("chronicle.json"), onRescan: H.onScan };
    } else if (s.misplaced) {
      problem = { kind: "misplaced", foundIn: `${s.misplaced}/`, onMove: () => H.onMoveManifest(s.misplaced ?? ""), onLeave: H.onBasicView };
    } else if (ctx.initRun?.running) {
      const r = ctx.initRun;
      building = r.elapsedS > 300
        ? { kind: "still-running", elapsed: fmtElapsed(r.elapsedS), logLines: r.logLines, activeLine: r.activeLine, onCancel: H.onCancelInit, onViewFullLog: H.onViewFullLog }
        : { kind: "running", elapsed: fmtElapsed(r.elapsedS), progress: r.progress, logLines: r.logLines, activeLine: r.activeLine, onCancel: H.onCancelInit };
    } else if (ctx.initRun && !ctx.initRun.running && ctx.initRun.code !== 0) {
      problem = { kind: "scan-failed", detail: `session exited with code ${ctx.initRun.code ?? "?"} after ${fmtElapsed(ctx.initRun.elapsedS)}`, onRetry: H.onBuild, onBasicView: H.onBasicView };
    } else if (s.blank) {
      problem = { kind: "blank", onBuild: H.onBuild };
    } else if (ctx.consent === "basic" || ctx.consent === "manual") {
      problem = { kind: "basic-view", onBuild: H.onBuild };
    } else {
      consent = true;
    }
    if (problem) props.problem = problem;
    if (building) props.building = building;
    if (consent) {
      props.consent = { agent: ctx.agent, onAgentChange: H.onAgentChange, onBuild: H.onBuild, onRunMyself: H.onRunMyself, onBasicView: H.onBasicView };
    }
  }

  /* -- warning banner -- */
  if (s.manifest_present && s.manifest_warnings.length > 0 && !ctx.warningDismissed) {
    props.warning = { count: s.manifest_warnings.length, onRebuild: H.onRebuild, onDismiss: H.onDismissWarning };
  }

  /* -- current-state banner -- */
  if (s.manifest_present) {
    const real = statuses.filter((x) => realStates.has(x.state));
    const ni = nowIndex(statuses);
    if (ni === -1 && real.length > 0 && real.every((x) => x.state === "done")) {
      props.banner = {
        kind: "all-done",
        body: `${real.length} of ${real.length} phases signed off. Nothing needs a session right now.`,
        onAddNext: H.onAddNext, onRebuild: H.onRebuild,
      } satisfies CurrentStateBannerProps;
    } else if (ni >= 0) {
      const st = statuses[ni];
      const ph = phases[ni];
      const nextReal = statuses.slice(ni + 1).find((x) => x.state === "later");
      const nextPh = nextReal ? phases[statuses.indexOf(nextReal)] : undefined;
      const upNext = nextPh?.id ? { id: nextPh.id, name: nextPh.name ?? "" } : undefined;
      if (/^waiting/i.test(st.label)) {
        props.banner = {
          kind: "waiting", phaseId: st.id, phaseName: ph?.name ?? "",
          body: ph?.status?.blocked_note ?? ph?.desc ?? st.label,
          actionLabel: "Read the decision", onAction: () => H.onReadDecision(st.id),
        };
      } else {
        props.banner = {
          kind: ctx.justSwitched ? "just-switched" : "normal",
          phaseId: st.id, phaseName: ph?.name ?? "",
          statusWord: st.label,
          running: /running|scanning|building/i.test(st.label),
          body: (ph?.desc ?? "").replace(/<[^>]+>/g, ""),
          upNext,
        } as CurrentStateBannerProps;
      }
    }
    if (s.stale.length > 0) {
      props.stale = { scanning: ctx.initRun?.running ?? false, onScan: H.onScan };
    }
  }

  /* -- history panel -- */
  if (!s.is_git) {
    props.history = { kind: "no-history", onStartHistory: H.onStartHistory };
  } else {
    const published = Math.max(0, s.commits - s.ahead);
    const nodes: [PipelineNode, PipelineNode, PipelineNode] = [
      { label: "Edits on disk", count: `${s.dirty.length} file${s.dirty.length === 1 ? "" : "s"}`, marker: s.dirty.length > 0 ? "dot" : "done" },
      { label: "Saved to history", count: `${s.commits} save${s.commits === 1 ? "" : "s"}`, marker: s.ahead > 0 ? "dot" : "done" },
      !s.upstream
        ? { label: "Published online", count: s.remote_url ? "never published" : "not on GitHub", marker: "pending" }
        : s.behind > 0
          ? { label: "Published online", count: `behind by ${s.behind}`, marker: "pending" }
          : { label: "Published online", count: `${published} up`, marker: s.ahead > 0 ? "pending" : "done" },
    ];
    const status =
      !s.upstream ? ({ kind: "untracked" } as const)
      : s.ahead > 0 ? ({ kind: "waiting", label: `${s.ahead} save${s.ahead > 1 ? "s" : ""} waiting to publish` } as const)
      : ({ kind: "published" } as const);
    const files = s.dirty.slice(0, 4).map((d) => ({
      path: d.path,
      badge: d.code === "?" || d.code === "A" ? "new" : "edited",
    }));
    props.history = {
      kind: "panel",
      status,
      nodes,
      arrowsActive: [false, ctx.publishing],
      milestones: s.tags.slice(-3),
      files,
      moreCount: Math.max(0, s.dirty.length - 4) || undefined,
      onViewDetails: H.onHistoryDetails,
    } satisfies HistoryPanelProps;
  }

  /* -- what needs you -- */
  if (s.manifest_present || s.is_git) {
    const rows = needsYouRows(s, ctx);
    props.needsYou = rows.length > 0 ? { kind: "list", rows } : { kind: "empty" };
  }

  /* -- always-on documents -- */
  const spine = s.manifest?.spine ?? [];
  if (spine.length > 0) {
    const chips: DocChipProps[] = spine.map((d) => {
      const name = d.path.split("/").pop() ?? d.path;
      if (!s.docs[d.path]) return { kind: "missing", name, note: "not written yet" };
      if (ctx.copiedPath === d.path) return { kind: "copied", name };
      return { kind: "default", name, onCopy: () => H.onCopyDoc(d.path) };
    });
    props.documents = { chips };
  }

  /* -- the phase rail -- */
  if (s.manifest_present && (s.manifest?.stages?.length ?? 0) > 0) {
    let flatIdx = -1;
    const stages: RailStage[] = [];
    for (const st of s.manifest?.stages ?? []) {
      const railPhases: RailPhase[] = [];
      for (const ph of st.phases ?? []) {
        flatIdx += 1;
        const status = statuses[flatIdx];
        if (!status || status.state === "pool") continue;
        const id = ph.id ?? "?";
        if (ph.fixRound !== undefined) {
          railPhases.push({
            kind: "fx", id, name: ph.name ?? "",
            badge: `from the Kanban · ${(ph.desc?.match(/^(\d+)/)?.[1]) ?? "?"} tasks`,
            statusWord: status.state === "done" ? "done" : status.label,
            chips: [...(ph.paste ?? []), ...(ph.docs ?? [])].map((c) => (c.path ?? "").split("/").pop() ?? "").filter(Boolean),
            onChip: (n) => {
              const hit = [...(ph.paste ?? []), ...(ph.docs ?? [])].find((c) => (c.path ?? "").endsWith(n));
              if (hit?.path) H.onCopyDoc(hit.path);
            },
          });
          continue;
        }
        if (status.state === "window" || ph.window) {
          railPhases.push({ kind: "window", id, name: ph.name ?? "", eyebrow: `WINDOW · RUNS ALONGSIDE`, note: status.label });
          continue;
        }
        const expanded = ctx.expandedId ? ctx.expandedId === id : status.state === "now";
        if (expanded) {
          const paste: RailChip[] = (ph.paste ?? []).map((c) => ({
            name: c.path ? (c.path.split("/").pop() ?? "") : (c.label ?? ""),
            hint: c.into ? `→ ${c.into}${c.when ? `, ${c.when}` : ""}` : c.when,
          }));
          const reference: RailChip[] = (ph.docs ?? []).map((c) => ({ name: c.path.split("/").pop() ?? "" }));
          railPhases.push({
            kind: "expanded", id, name: ph.name ?? "",
            statusWord: status.state === "done" ? "done" : status.label,
            description: (ph.desc ?? "").replace(/<[^>]+>/g, ""),
            steps: (ph.items ?? []).map((t) => ({ label: t.replace(/<[^>]+>/g, ""), done: status.state === "done" })),
            paste,
            reference: reference.length > 0 ? reference : undefined,
            onToggle: () => H.onTogglePhase(id),
            onViewDetails: () => H.onViewDetails(id),
            onChip: (n) => {
              const all = [...(ph.paste ?? []), ...(ph.docs ?? [])];
              const hit = all.find((c) => (c.path ?? "").endsWith(n));
              if (hit?.path) H.onCopyDoc(hit.path);
            },
          });
        } else {
          railPhases.push({
            kind: "collapsed", id, name: ph.name ?? "",
            status: status.state === "done" ? "done" : "later",
            onToggle: () => H.onTogglePhase(id),
          });
        }
      }
      if (railPhases.length > 0) {
        stages.push({ name: st.title ?? "", sub: st.note ?? "", phases: railPhases });
      }
    }
    if (stages.length > 0) props.phaseRail = { stages };
  }

  return props;
}
