/*
 * The F22 container: owns the accordion content fetches (read_file) and the
 * saves-during-this-phase query (git_log_graph, subject-mention match) for one
 * phase, and feeds the presentational PhaseDetail.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { executingRound, kanbanFor } from "@/lib/kanban-store";
import { PhaseDetail, type DetailDoc, type DetailSaves } from "./PhaseDetail";
import type { ManifestPhase, PhaseStatus } from "@/lib/ipc";
import { statFile, gitLogGraph, readFile, roundRetro } from "@/lib/ipc";
import { sentence } from "@/lib/utils";

interface LogRow { hash?: string; subject?: string; author?: string; ago?: string }

export function PhaseDetailHost({
  dir,
  phase,
  status,
  projectState,
  onBack,
  onCopyDoc,
  onStart,
}: {
  dir: string;
  phase: ManifestPhase;
  status: PhaseStatus | null;
  /** Ground truth for the readiness checks (F3). */
  projectState?: { branch?: string | null; work_branch?: string | null; dirty?: unknown[] } | null;
  onBack: () => void;
  onCopyDoc: (path: string) => void;
  onStart: () => void;
}) {
  const [saves, setSaves] = useState<DetailSaves>({ kind: "loading" });
  const [openDoc, setOpenDoc] = useState<string | null>(null);
  const [docContent, setDocContent] = useState<Record<string, { content?: string; error?: boolean }>>({});
  const id = phase.id ?? "?";

  const fixRound = (phase as { fixRound?: number }).fixRound ?? null;
  const [retroLine, setRetroLine] = useState<string | null>(null);
  useEffect(() => {
    if (fixRound == null) { setRetroLine(null); return; }
    let dead = false;
    roundRetro(dir, fixRound)
      .then((r) => {
        if (dead) return;
        setRetroLine(
          r.save_count === 0
            ? "No saves recorded for this round yet."
            : `This round made ${r.save_count} save${r.save_count === 1 ? "" : "s"} touching ${r.file_count} file${r.file_count === 1 ? "" : "s"}.`,
        );
        setSaves(
          r.saves.length === 0
            ? { kind: "empty", message: "No saves recorded for this round yet." }
            : {
                kind: "list",
                entries: r.saves.slice(0, 8).map((sv) => ({
                  hash: sv.hash,
                  author: { kind: "agent" as const },
                  ago: "",
                  message: sv.subject,
                })),
              },
        );
      })
      .catch(() => { if (!dead) setSaves({ kind: "empty", message: "No saves recorded for this round yet." }); });
    return () => { dead = true; };
  }, [dir, fixRound]);

  useEffect(() => {
    if (fixRound != null) return; // the round's rail comes from roundRetro above
    let dead = false;
    setSaves({ kind: "loading" });
    gitLogGraph(dir, 60)
      .then((rows) => {
        if (dead) return;
        const re = new RegExp(`\\b${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
        const hits = ((rows as LogRow[]) ?? []).filter((r) => re.test(r.subject ?? "")).slice(0, 8);
        setSaves(
          hits.length === 0
            ? { kind: "empty", message: `No saves mention ${id} yet.` }
            : {
                kind: "list",
                entries: hits.map((r) => ({
                  hash: r.hash ?? "",
                  author: /claude|codex|gpt|agent|\[bot\]/i.test(r.author ?? "")
                    ? { kind: "agent" as const }
                    : { kind: "you" as const, initials: (r.author ?? "??").split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase() },
                  ago: r.ago ?? "",
                  message: r.subject ?? "",
                })),
              },
        );
      })
      .catch(() => { if (!dead) setSaves({ kind: "empty", message: "History unavailable." }); });
    return () => { dead = true; };
  }, [dir, id]);

  const fetchDoc = useCallback((path: string) => {
    readFile(dir, path)
      .then((content) => setDocContent((m) => ({ ...m, [path]: { content } })))
      .catch(() => setDocContent((m) => ({ ...m, [path]: { error: true } })));
  }, [dir]);

  const docs: DetailDoc[] = useMemo(() => {
    const rows = [...(phase.docs ?? []), ...(phase.paste ?? []).filter((x) => x.path)];
    return rows.map((d) => {
      const path = d.path ?? "";
      const name = path.split("/").pop() ?? path;
      const title = name.replace(/[-_]/g, " ").replace(/\.md$/i, "");
      const state = docContent[path];
      if (openDoc !== path) {
        return { title, path, state: "closed" as const, cachedBody: state?.content, onOpen: () => { setOpenDoc(path); if (!docContent[path]) fetchDoc(path); } };
      }
      if (state?.error) return { title, path, state: "error" as const, onRetry: () => fetchDoc(path) };
      if (state?.content === undefined) return { title, path, state: "loading" as const };
      return { title, path, state: "open" as const, body: state.content, onCopy: () => onCopyDoc(path) };
    });
  }, [phase, openDoc, docContent, fetchDoc, onCopyDoc]);

  const label = status?.label ?? "Up next";
  /* readiness (F3): paste file on disk · right branch · no round hogging the repo */
  const [pasteOk, setPasteOk] = useState<boolean | null>(null);
  const pastePath = (phase.paste ?? []).find((x) => x.path)?.path ?? null;
  useEffect(() => {
    if (!pastePath) { setPasteOk(null); return; }
    let dead = false;
    statFile(dir, pastePath)
      .then(() => { if (!dead) setPasteOk(true); })
      .catch(() => { if (!dead) setPasteOk(false); });
    return () => { dead = true; };
  }, [dir, pastePath]);
  const preflight: { label: string; ok: boolean }[] = [];
  if (pastePath && pasteOk !== null) {
    preflight.push({ label: pasteOk ? "prompt file is there" : "the prompt file is missing", ok: pasteOk });
  }
  const wb = projectState?.work_branch;
  if (wb && projectState?.branch) {
    const ok = projectState.branch === wb;
    preflight.push({ label: ok ? `on ${wb}` : `on ${projectState.branch}, not ${wb}`, ok });
  }
  if (projectState?.dirty) {
    const n = projectState.dirty.length;
    preflight.push({ label: n === 0 ? "no unsaved edits" : `${n} unsaved edit${n === 1 ? "" : "s"}`, ok: n === 0 });
  }
  const busyRound = executingRound(kanbanFor(dir));
  if (busyRound != null) preflight.push({ label: `round ${busyRound} is active here`, ok: false });

  return (
    <PhaseDetail
      phaseId={id}
      phaseName={phase.name ?? ""}
      statusWord={status?.state === "done" ? "Done" : sentence(label)}
      startHelper={(() => {
        const pf = (phase.paste ?? []).find((x) => x.path)?.path?.split("/").pop();
        return pf
          ? `Opens a terminal, starts the agent, and copies ${pf} — you paste it as the first message.`
          : "Opens a terminal and starts the agent in this project.";
      })()}
      description={
        retroLine
          ? `${(phase.desc ?? "").replace(/<[^>]+>/g, "")} ${retroLine}`
          : (phase.desc ?? "").replace(/<[^>]+>/g, "")
      }
      stepsLabel={`${(phase.items ?? []).length} ${(phase.items ?? []).length === 1 ? "step" : "steps"}`}
      steps={(phase.items ?? []).map((t) => ({
        label: t.replace(/<[^>]+>/g, ""),
        // no fabricated activity: steps are done when the phase is, todo otherwise —
        // Chronicle has no per-step evidence to claim more
        state: status?.state === "done" ? ("done" as const) : ("todo" as const),
      }))}
      paste={(phase.paste ?? []).map((c) => ({
        name: c.path ? (c.path.split("/").pop() ?? "") : (c.label ?? ""),
        into: c.into,
        note: c.when,
      }))}
      docs={docs}
      saves={saves}
      onBack={onBack}
      onClose={onBack}
      preflight={preflight}
      onStart={onStart}
      onChip={(n) => {
        const hit = (phase.paste ?? []).find((c) => (c.path ?? "").endsWith(n));
        if (hit?.path) onCopyDoc(hit.path);
      }}
    />
  );
}
