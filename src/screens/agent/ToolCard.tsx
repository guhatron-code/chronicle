/*
 * F34 — tool cards: one compact anatomy, kind-aware. Title lines never wrap;
 * long paths truncate in the middle; run output is capped with the global 2px
 * scrollbar. Read (and other look-only calls) get the quietest treatment —
 * no card chrome at all.
 */
import { useState } from "react";
import type { AgentEntry } from "@/lib/agent-session";
import { Spinner } from "@/components/chrome/atoms";
import { ChevronDownGlyph, ChevronRightGlyph, ErrorGlyph } from "@/components/chrome/icons";
import { agentEditDiff } from "@/lib/ipc";
import { parseDiff, sideBySide, type DiffPair } from "@/lib/repo-data";
import { cn } from "@/lib/utils";

type Tool = Extract<AgentEntry, { kind: "tool" }>;

const PencilGlyph = ({ size = 12 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" className="shrink-0">
    <path d="M9.7 1.8 12.2 4.3 5 11.5l-3 .5.5-3z" />
  </svg>
);
const RunGlyph = ({ size = 12 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" className="shrink-0">
    <path d="m2.5 3.5 3 3.5-3 3.5M7.5 10.5h4" />
  </svg>
);
const BookGlyph = ({ size = 12 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" className="shrink-0">
    <path d="M7 3.2C5.8 2.2 4 2 2.5 2v9c1.5 0 3.3.2 4.5 1.2 1.2-1 3-1.2 4.5-1.2V2C10 2 8.2 2.2 7 3.2zM7 3.2v9" />
  </svg>
);

/** kind + status → the verb the card leads with */
function verb(t: Tool): string {
  const table: Record<string, [string, string, string]> = {
    // [in-progress, done, failed-lead]
    edit: ["Editing", "Edited", "Couldn't edit"],
    delete: ["Deleting", "Deleted", "Couldn't delete"],
    move: ["Moving", "Moved", "Couldn't move"],
    execute: ["Running", "Ran", "Ran"],
    read: ["Reading", "Read", "Couldn't read"],
    search: ["Searching", "Searched", "Couldn't search"],
    fetch: ["Fetching", "Fetched", "Couldn't fetch"],
    think: ["Thinking", "Thought", "Thought"],
  };
  const [doing, did, failed] = table[t.toolKind] ?? ["Working on", "Finished", "Couldn't finish"];
  if (t.rejected) return t.toolKind === "execute" ? "Run" : t.toolKind === "edit" ? "Edit" : did;
  if (t.status === "failed") return failed;
  if (t.status === "completed") return did;
  return doing;
}

/** middle truncation so the filename survives — the title line never wraps */
function midTruncate(s: string, max = 46): string {
  if (s.length <= max) return s;
  const keep = Math.floor((max - 1) / 2);
  return `${s.slice(0, keep)}…${s.slice(-keep)}`;
}

export function ToolCard({ tool, dir, onViewChanges }: { tool: Tool; dir: string; onViewChanges?: () => void }) {
  const [open, setOpen] = useState(false);
  const quiet = ["read", "search", "fetch", "think"].includes(tool.toolKind) && tool.status !== "failed" && !tool.rejected;
  const running = tool.status === "pending" || tool.status === "in_progress";
  const failed = tool.status === "failed" && !tool.rejected;
  const detail = midTruncate(tool.detail || tool.title);
  const hasOutput = !!tool.output?.trim();

  const [diffOpen, setDiffOpen] = useState(false);
  const [diffRows, setDiffRows] = useState<DiffPair[] | null>(null);
  const [diffState, setDiffState] = useState<"idle" | "loading" | "empty" | "error">("idle");
  const isEdit = ["edit", "delete", "move"].includes(tool.toolKind);

  const toggleDiff = () => {
    const next = !diffOpen;
    setDiffOpen(next);
    if (next && diffRows == null && diffState === "idle") {
      setDiffState("loading");
      agentEditDiff(dir, `${dir}/${tool.detail}`)
        .then((raw) => {
          const pairs = sideBySide(parseDiff(raw).rows);
          setDiffRows(pairs);
          setDiffState(pairs.length ? "idle" : "empty");
        })
        .catch(() => setDiffState("error"));
    }
  };

  if (quiet) {
    return (
      <div className="flex items-center gap-2 whitespace-nowrap px-[11px] py-[5px]">
        {running ? <Spinner size={11} /> : <span className="text-text-dim"><BookGlyph /></span>}
        <span className="text-[12.5px] text-text-dim">{verb(tool)}</span>
        <span className="overflow-hidden text-ellipsis font-mono text-[11.5px] text-text-muted">{detail}</span>
      </div>
    );
  }

  if (tool.rejected) {
    return (
      <div className="flex items-center gap-2 whitespace-nowrap rounded-md border border-border-hairline bg-surface-card px-[11px] py-2 opacity-75">
        <span className="text-text-dim">{tool.toolKind === "execute" ? <RunGlyph /> : <PencilGlyph />}</span>
        <span className="text-[12.5px] text-text-muted">{verb(tool)}</span>
        <span className="overflow-hidden text-ellipsis font-mono text-[11.5px] text-text-secondary">{detail}</span>
        <span className="shrink-0 text-[11.5px] text-text-dim">You said no — skipped</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col rounded-md border border-border-hairline bg-surface-card">
      <div className="flex items-center gap-2 whitespace-nowrap px-[11px] py-2">
        {running ? (
          <Spinner size={11} />
        ) : failed ? (
          <span className="text-state-error"><ErrorGlyph size={12} /></span>
        ) : (
          <span className="text-text-subtle">{tool.toolKind === "execute" ? <RunGlyph /> : <PencilGlyph />}</span>
        )}
        <span className="text-[12.5px] text-text-secondary">{verb(tool)}</span>
        <span className="overflow-hidden text-ellipsis font-mono text-[11.5px] text-text-primary">{detail}</span>
        {tool.diff && (
          <span className="shrink-0 rounded-[5px] bg-fill-subtle px-1.5 font-mono text-[10.5px] tabular-nums">
            <span className="text-state-success">+{tool.diff.plus}</span>{" "}
            <span className="text-state-error">−{tool.diff.minus}</span>
          </span>
        )}
        {tool.status === "completed" && tool.toolKind === "execute" && (
          <span className="inline-flex shrink-0 items-center gap-[5px] text-[11.5px] text-state-success">
            <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M2 6.5 5 9.5 10 3" /></svg>
            finished
          </span>
        )}
        {running && tool.toolKind === "execute" && (
          <span className="inline-flex shrink-0 items-center gap-[5px] text-[11.5px] text-state-neutral">
            <span className="size-1 shrink-0 rounded-full bg-state-neutral" />
            running
          </span>
        )}
        {failed && (
          <span className="inline-flex shrink-0 items-center gap-[5px] text-[11.5px] text-state-error">
            <span className="size-1 shrink-0 rounded-full bg-state-error" />
            failed
          </span>
        )}
        <span className="flex-1" />
        {tool.diff && onViewChanges && (
          <button onClick={onViewChanges} className="shrink-0 text-[11.5px] text-text-secondary hover:text-text-primary">
            View the changes ›
          </button>
        )}
        {isEdit && tool.diff && !running && (
          <button
            onClick={toggleDiff}
            className="inline-flex shrink-0 items-center gap-1 text-[11.5px] text-text-dim hover:text-text-secondary"
          >
            {diffOpen ? "Hide the diff" : "Show the diff"}
            {diffOpen ? <ChevronDownGlyph size={10} /> : <ChevronRightGlyph size={10} />}
          </button>
        )}
        {hasOutput && !running && (
          <button
            onClick={() => setOpen((o) => !o)}
            className="inline-flex shrink-0 items-center gap-1 text-[11.5px] text-text-dim hover:text-text-secondary"
          >
            {open ? "Hide the output" : "Show the output"}
            {open ? <ChevronDownGlyph size={10} /> : <ChevronRightGlyph size={10} />}
          </button>
        )}
      </div>
      {failed && tool.output?.trim() && !open && (
        <div className="px-[11px] pb-2 pl-8 text-[11.5px] text-text-muted">
          {tool.output.trim().split("\n").slice(-1)[0]}
        </div>
      )}
      {hasOutput && (running || open) && (
        <div className="max-h-24 overflow-y-auto rounded-b-md bg-surface-input px-3 py-2 font-mono text-[11px] leading-[1.7] text-text-muted">
          <pre className="whitespace-pre-wrap">{tool.output}</pre>
        </div>
      )}
      {diffOpen && (
        <div className="max-h-64 overflow-auto rounded-b-md border-t border-border-hairline bg-surface-input font-mono text-[11px] leading-[1.7]">
          {diffState === "loading" && <div className="px-3 py-2 text-text-dim">Loading the diff…</div>}
          {diffState === "empty" && <div className="px-3 py-2 text-text-dim">No diff to show.</div>}
          {diffState === "error" && <div className="px-3 py-2 text-text-dim">Couldn't load the diff.</div>}
          {diffRows && diffState !== "error" && <DiffSideBySide pairs={diffRows} />}
        </div>
      )}
    </div>
  );
}

/** #3 — two mono columns (old | new); del tinted red, add tinted green. */
function DiffSideBySide({ pairs }: { pairs: DiffPair[] }) {
  const cell = (c: { n?: number; text: string; kind: string }) => (
    <div
      className={cn(
        "flex min-w-0 flex-1 basis-1/2",
        c.kind === "add" && "bg-[color-mix(in_srgb,var(--state-success)_9%,transparent)]",
        c.kind === "del" && "bg-[color-mix(in_srgb,var(--state-error)_10%,transparent)]",
      )}
    >
      <span aria-hidden className="w-[34px] shrink-0 select-none px-2 text-right text-text-dimmer tabular-nums">
        {c.n ?? ""}
      </span>
      <span className="min-w-0 flex-1 whitespace-pre pr-2 text-text-secondary">{c.text}</span>
    </div>
  );
  return (
    <div className="min-w-max">
      {pairs.map((p, i) =>
        p.hunk != null ? (
          <div key={i} className="border-y border-divider-faint bg-surface-card-raised px-3 py-[3px] text-[10.5px] text-text-dim">
            {p.hunk}
          </div>
        ) : (
          <div key={i} className="flex">
            {cell(p.left)}
            <span className="w-px shrink-0 bg-border-hairline" />
            {cell(p.right)}
          </div>
        ),
      )}
    </div>
  );
}
