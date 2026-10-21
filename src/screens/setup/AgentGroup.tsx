/*
 * Setup's Your agent group (board 1): one radio row per agent, its state and
 * at most one action; the chosen agent's connector nested under it. The rows
 * come from `agentRows` (setup-store), which is where their logic is tested.
 */
import { useEffect } from "react";
import {
  agentRows,
  agentsState,
  checkFor,
  chooseDefaultAgent,
  connectorName,
  installAgent,
  installCheck,
  refreshAgentsStatus,
  signInAgent,
  waitingSignin,
  type AgentRowView,
} from "@/lib/setup-store";
import { toastError } from "@/overlays/toasts";
import { AgentMark } from "@/components/chrome/AgentMark";
import { ClaudeStar } from "@/components/chrome/icons";
import { cn } from "@/lib/utils";

const WORD_TONE: Record<AgentRowView["state"], string> = {
  ready: "text-state-success",
  needs_you: "text-state-warn",
  blocked: "text-state-warn",
  missing: "text-text-dim",
  unsupported: "text-text-dim",
  installing: "text-state-neutral",
};

function Radio({ on, disabled, onPick, label }: { on: boolean; disabled: boolean; onPick: () => void; label: string }) {
  return (
    <button
      role="radio"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={onPick}
      className={cn(
        "mt-[7px] flex size-4 shrink-0 items-center justify-center rounded-full border disabled:opacity-50",
        on ? "border-primary bg-primary" : "border-border-strong hover:border-text-muted",
      )}
    >
      {on && <span className="size-1.5 rounded-full bg-primary-foreground" />}
    </button>
  );
}

function ConnectorLine({ agentName }: { agentName: string }) {
  const c = checkFor("connector");
  return (
    <div data-check-row="connector" data-check-state={c.state} className="mb-3 ml-[61px] flex items-center gap-2.5 rounded-lg border border-border-hairline bg-surface-card px-3 py-[9px]">
      <span className="text-[12.5px] font-medium text-text-primary">{connectorName(agentName)}</span>
      {c.state === "ready" && <span className="font-mono text-[11px] text-text-subtle">{c.detail}</span>}
      <span className="flex-1 text-[11.5px] text-text-faint">
        {c.state === "ready" ? "installed by Chronicle, so sessions start fast" : c.state === "installing" ? `installing${c.pct != null ? ` · ${c.pct}%` : ""}` : c.detail || "not installed yet — sessions start slower until it is"}
      </span>
      {c.state === "missing" && c.action === "install" && (
        <button data-check-action="install" onClick={() => void installCheck("connector").catch((e) => toastError("Couldn't install it", String(e).slice(0, 90)))} className="h-[28px] shrink-0 rounded-lg border border-border-strong px-3 text-[12px] font-medium text-text-primary hover:bg-fill-hover">
          Install
        </button>
      )}
    </div>
  );
}

export function AgentGroup({ dir }: { dir: string | null }) {
  useEffect(() => { void refreshAgentsStatus(dir); }, [dir]);
  const rows = agentRows(agentsState(), (id) => checkFor(id));
  if (rows.length === 0) return null;
  const err = (what: string) => (e: unknown) => toastError(what, String(e).slice(0, 90));
  return (
    <div className="flex flex-col gap-0.5" data-setup-group="agent">
      <div className="flex items-baseline gap-2.5 pb-1.5">
        <span className="text-[10px] uppercase tracking-[0.09em] text-text-subtle">Your agent</span>
        <span className="text-[11.5px] text-text-muted">the one that works in your projects</span>
      </div>
      <div className="flex flex-col" role="radiogroup" aria-label="Your agent">
        {rows.map((r, i) => (
          <div key={r.id}>
            <div data-agent-row={r.id} data-agent-state={r.state} className={cn("flex items-start gap-[15px] py-[15px]", i > 0 && "border-t border-divider", r.state === "unsupported" && "opacity-55")}>
              <Radio on={r.chosen} disabled={!r.selectable} label={r.name} onPick={() => void chooseDefaultAgent(r.id, dir).catch(err("Couldn't choose that agent"))} />
              <span className="flex size-[30px] shrink-0 items-center justify-center rounded-lg border border-border-hairline bg-fill-subtle">
                {r.id === "claude-acp" ? <ClaudeStar size={15} /> : <AgentMark agent={r.id} size={13} />}
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <span className="text-[13px] font-medium text-text-primary">{r.name}</span>
                <span className="text-[12px] leading-snug text-text-dim">{r.detail}</span>
                {r.state === "installing" && (
                  <span className="mt-0.5 block h-[3px] overflow-hidden rounded-[2px] bg-fill-hover">
                    <span className="block h-full rounded-[2px] bg-state-neutral" style={{ width: `${r.pct ?? 8}%` }} />
                  </span>
                )}
                {waitingSignin(`agent:${r.id}`) && <span className="text-[11.5px] text-text-muted">Waiting for you to finish signing in…</span>}
              </div>
              <span className={cn("inline-flex shrink-0 items-center whitespace-nowrap text-[12.5px]", WORD_TONE[r.state])}>{r.word}</span>
              {r.action === "install" && (
                <button data-check-action="install" onClick={() => void installAgent(r.id, dir).catch(err("Couldn't install it"))} className="h-[33px] shrink-0 whitespace-nowrap rounded-lg border border-border-strong px-[14px] text-[12.5px] font-medium text-text-primary hover:bg-fill-hover">
                  Install
                </button>
              )}
              {r.action === "signin" && !waitingSignin(`agent:${r.id}`) && (
                <button data-check-action="signin" onClick={() => void signInAgent(r.id, dir).catch(err("Couldn't open the sign-in"))} className="h-[33px] shrink-0 whitespace-nowrap rounded-lg border border-border-strong px-[14px] text-[12.5px] font-medium text-text-primary hover:bg-fill-hover">
                  Sign in
                </button>
              )}
            </div>
            {r.chosen && <ConnectorLine agentName={r.name} />}
          </div>
        ))}
      </div>
    </div>
  );
}
