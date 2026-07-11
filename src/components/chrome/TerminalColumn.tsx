/*
 * The terminal column shell — the strip (tab · "+" · START + the two brand logos)
 * + the host surface. Persistent across Roadmap/Repo; absent on Kanban and Picker.
 * The live xterm host and the full F26 states (rename, dead tabs) arrive with C6 —
 * this is the C2 layout contract, anatomy per the Deck-2 composite.
 */
import { ClaudeStar, CodexTile, PlusGlyph } from "./icons";
import { Eyebrow } from "./atoms";

export function TerminalColumn({
  tabs,
  activeId,
  onNewTerminal,
  onStartAgent,
}: {
  tabs: { id: number; title: string }[];
  activeId: number | null;
  onNewTerminal: () => void;
  onStartAgent: (agent: "claude" | "codex") => void;
}) {
  return (
    <div className="flex min-w-[240px] flex-1 flex-col overflow-hidden border-l border-divider">
      <div className="flex h-10 shrink-0 items-center gap-0.5 border-b border-divider px-3">
        {tabs.map((t) => (
          <div
            key={t.id}
            className={
              t.id === activeId
                ? "flex h-7 items-center gap-2 rounded-md border border-border-strong bg-fill-hover px-[11px]"
                : "flex h-7 items-center gap-2 rounded-md px-[11px]"
            }
          >
            <span
              className={
                t.id === activeId
                  ? "text-xs font-medium text-text-primary"
                  : "text-xs text-text-muted"
              }
            >
              {t.title}
            </span>
          </div>
        ))}
        <button
          aria-label="New terminal"
          title="New terminal — ⌘T"
          onClick={onNewTerminal}
          className="flex size-[26px] items-center justify-center rounded-[7px] text-text-dim hover:bg-fill-hover hover:text-text-secondary"
        >
          <PlusGlyph size={11} />
        </button>
        <span className="flex-1" />
        <Eyebrow>Start</Eyebrow>
        <button
          aria-label="Start Claude Code"
          title="Start Claude Code"
          onClick={() => onStartAgent("claude")}
          className="flex size-[30px] items-center justify-center rounded-md hover:bg-fill-hover"
        >
          <ClaudeStar />
        </button>
        <button
          aria-label="Start Codex"
          title="Start Codex"
          onClick={() => onStartAgent("codex")}
          className="flex size-[30px] items-center justify-center rounded-md hover:bg-fill-hover"
        >
          <CodexTile />
        </button>
      </div>
      {/* the xterm host mounts here in C6; the surface is the layout contract */}
      <div className="min-w-0 flex-1 overflow-hidden px-4 py-3.5 font-mono text-xs leading-[1.7] text-text-secondary" />
    </div>
  );
}
