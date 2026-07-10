/*
 * F12 (Deck 2) — the roadmap consent card. Replaces silent auto-start: the user picks
 * the agent and explicitly starts the build. The agent logos are the only brand colour
 * on the page. Presentational only — no IPC.
 */
import { BtnPrimary, BtnSecondary } from "@/components/chrome/atoms";
import { ClaudeStar, CodexTile } from "@/components/chrome/icons";
import { cn } from "@/lib/utils";

export type ConsentAgent = "claude" | "codex";

export type ConsentCardProps = {
  agent: ConsentAgent;
  onAgentChange?: (agent: ConsentAgent) => void;
  onBuild?: () => void;
  onRunMyself?: () => void;
  onBasicView?: () => void;
  className?: string;
};

function AgentButton({
  selected,
  ariaLabel,
  label,
  onClick,
  children,
}: {
  selected: boolean;
  ariaLabel: string;
  label: string;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      aria-label={ariaLabel}
      onClick={onClick}
      className={cn(
        "inline-flex h-[30px] items-center gap-[7px] rounded-md border px-[11px] font-sans",
        selected
          ? "border-border-strong bg-fill-hover"
          : "border-border-hairline bg-transparent hover:bg-fill-hover",
      )}
    >
      {children}
      <span
        className={cn(
          "text-[12.5px]",
          selected ? "font-medium text-text-primary" : "text-text-secondary",
        )}
      >
        {label}
      </span>
    </button>
  );
}

export function ConsentCard({
  agent,
  onAgentChange,
  onBuild,
  onRunMyself,
  onBasicView,
  className,
}: ConsentCardProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3.5 rounded-lg border border-border-hairline bg-surface-card p-[22px]",
        className,
      )}
    >
      <div className="text-[15px] font-semibold text-text-primary">
        This folder has no roadmap yet.
      </div>
      <div className="text-[13px] leading-[1.55] text-text-muted">
        A Claude session will read this folder and write the roadmap — nothing else is changed.
      </div>
      <div className="flex items-center gap-2.5">
        <span className="text-[11.5px] text-text-dim">runs with</span>
        <AgentButton
          selected={agent === "claude"}
          ariaLabel={agent === "claude" ? "Run with Claude — selected" : "Run with Claude"}
          label="Claude"
          onClick={() => onAgentChange?.("claude")}
        >
          <ClaudeStar size={13} />
        </AgentButton>
        <AgentButton
          selected={agent === "codex"}
          ariaLabel={agent === "codex" ? "Run with Codex — selected" : "Run with Codex"}
          label="Codex"
          onClick={() => onAgentChange?.("codex")}
        >
          <CodexTile size={13} />
        </AgentButton>
      </div>
      <div className="flex items-center gap-2.5">
        <BtnPrimary onClick={onBuild}>Build it for me</BtnPrimary>
        <BtnSecondary onClick={onRunMyself}>I'll run it myself</BtnSecondary>
        <button
          onClick={onBasicView}
          className="h-[34px] rounded-md px-2.5 text-[13px] text-text-dim hover:bg-fill-hover hover:text-text-secondary"
        >
          Use the basic view
        </button>
      </div>
      <div className="text-[11.5px] text-text-dim">
        "I'll run it myself" copies the roadmap prompt — paste it in your own terminal.
      </div>
    </div>
  );
}
