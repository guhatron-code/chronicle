/*
 * F12 (Deck 2) — the roadmap consent card. Replaces silent auto-start: the user picks
 * the agent and explicitly starts the build. The agent logos are the only brand colour
 * on the page. Presentational only — no IPC.
 */
import type { ReactNode } from "react";
import { BtnPrimary, Eyebrow } from "@/components/chrome/atoms";
import { ChevronDownGlyph, ClaudeStar, CodexTile } from "@/components/chrome/icons";
import { cn } from "@/lib/utils";

export type ConsentAgent = "claude" | "codex";

export type ConsentCardProps = {
  agent: ConsentAgent;
  onAgentChange?: (agent: ConsentAgent) => void;
  onBuild?: () => void;
  onRunMyself?: () => void;
  onBasicView?: () => void;
  /** True only when both Claude and Codex are installed — otherwise no agent chip. */
  bothAgents?: boolean;
  /** Rendered below the card, in the same block (the ghosted roadmap). */
  children?: ReactNode;
  className?: string;
};

function LinkButton({ dim, onClick, children }: { dim?: boolean; onClick?: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "text-[12px] underline decoration-border-strong underline-offset-[3px] hover:text-text-primary",
        dim ? "text-text-dim" : "text-text-secondary",
      )}
    >
      {children}
    </button>
  );
}

export function ConsentCard({
  agent,
  onAgentChange,
  onBuild,
  onRunMyself,
  onBasicView,
  bothAgents,
  children,
  className,
}: ConsentCardProps) {
  const other = agent === "codex" ? "claude" : "codex";
  return (
    <div className={cn("flex flex-col gap-[34px] py-[26px]", className)}>
      <div className="flex flex-col gap-3.5">
        <Eyebrow>Current state</Eyebrow>
        <div className="flex flex-col gap-3">
          <div className="text-[20px] font-semibold leading-[1.25] tracking-[-0.01em] text-text-primary">
            Your current phase will sit here.
          </div>
          <div className="max-w-[54ch] text-[13.5px] leading-[1.65] text-text-muted">
            I read the files in this folder and write the roadmap: the phases, where you are now,
            and what needs you. Nothing else changes.
          </div>
          <div className="flex flex-wrap items-center gap-3 pt-0.5">
            <BtnPrimary onClick={onBuild}>Write the roadmap</BtnPrimary>
            {bothAgents && (
              <button
                aria-label={`Run with ${agent === "codex" ? "Codex" : "Claude"}. Switch to ${other === "codex" ? "Codex" : "Claude"}`}
                onClick={() => onAgentChange?.(other)}
                className="inline-flex h-[26px] items-center gap-1.5 rounded-lg border border-border-hairline pl-[7px] pr-[9px] text-[11.5px] text-text-muted hover:bg-fill-hover hover:text-text-secondary"
              >
                {agent === "codex" ? <CodexTile size={12} /> : <ClaudeStar size={12} />}
                with {agent === "codex" ? "Codex" : "Claude"}
                <ChevronDownGlyph size={10} />
              </button>
            )}
            <span className="flex-1" />
            <LinkButton onClick={onRunMyself}>Copy the instructions instead</LinkButton>
            <LinkButton dim onClick={onBasicView}>Use the basic view</LinkButton>
          </div>
        </div>
      </div>
      {children}
    </div>
  );
}
