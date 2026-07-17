/*
 * F35 — the permission card: the thread's consent moment, inline (never a
 * modal). The button set is supplied BY THE AGENT per request (ACP
 * PermissionOptions) — the canonical labels map onto the offered options and
 * options not offered are simply absent. "Always allow in this session"
 * appears only when the agent offers an allow_always option (edit-kind asks).
 * Answered (or cancelled) collapses to a one-line record.
 */
import { useState } from "react";
import { answerPermission, type AgentEntry } from "@/lib/agent-session";
import { BtnPrimary, BtnSecondary } from "@/components/chrome/atoms";
import { CheckGlyph, XGlyph } from "@/components/chrome/icons";
import { toastError } from "@/overlays/toasts";

type Perm = Extract<AgentEntry, { kind: "perm" }>;

export function PermissionCard({ dir, perm }: { dir: string; perm: Perm }) {
  const [busy, setBusy] = useState(false);

  const answer = (optionId: string) => {
    if (busy) return;
    setBusy(true);
    answerPermission(dir, perm.requestId, optionId)
      .catch((e) => toastError("Couldn't send your answer", String(e).slice(0, 90)))
      .finally(() => setBusy(false));
  };

  if (perm.outcome) {
    const cancelled = perm.outcome.type === "cancelled";
    const allowed =
      perm.outcome.type === "selected" &&
      perm.options.some((o) => o.optionId === (perm.outcome as { optionId: string }).optionId && o.kind.startsWith("allow"));
    return (
      <div className="flex items-center gap-2 whitespace-nowrap px-3.5 py-2">
        <span className="shrink-0 text-text-subtle">
          {cancelled || !allowed ? <XGlyph size={9} /> : <CheckGlyph size={11} />}
        </span>
        <span className="text-xs text-text-muted">
          {cancelled ? "Cancelled — the turn was stopped" : allowed ? "You allowed this" : "You said no"}
        </span>
        <span className="overflow-hidden text-ellipsis font-mono text-[11px] text-text-dim">{perm.detail}</span>
      </div>
    );
  }

  const primary = perm.options.find((o) => o.kind === "allow_once");
  const reject = perm.options.find((o) => o.kind === "reject_once");
  const always = perm.options.find((o) => o.kind === "allow_always");
  const rest = perm.options.filter((o) => o !== primary && o !== reject && o !== always);

  return (
    <div
      data-permission-card
      className="flex flex-col gap-[9px] rounded-[10px] border border-border-strong bg-surface-card-raised px-3.5 py-3"
    >
      <div className="flex items-center gap-2 whitespace-nowrap">
        <span
          className="size-[7px] shrink-0 rounded-full bg-state-neutral"
          style={{ animation: "wv-pulse 1.6s ease-in-out infinite" }}
        />
        <span className="text-[13px] font-medium text-text-primary">{perm.title}</span>
        <span className="overflow-hidden text-ellipsis rounded-[5px] bg-fill-subtle px-1.5 py-px font-mono text-[11.5px] text-text-primary">
          {perm.detail}
        </span>
      </div>
      <div className="flex items-center gap-2">
        {primary && (
          <BtnPrimary size="sm" disabled={busy} onClick={() => answer(primary.optionId)}>
            Allow
          </BtnPrimary>
        )}
        {reject && (
          <BtnSecondary size="sm" disabled={busy} onClick={() => answer(reject.optionId)}>
            Don't allow
          </BtnSecondary>
        )}
        {rest.map((o) => (
          <BtnSecondary key={o.optionId} size="sm" disabled={busy} onClick={() => answer(o.optionId)}>
            {o.name}
          </BtnSecondary>
        ))}
        {always && (
          <>
            <span className="flex-1" />
            <button
              disabled={busy}
              onClick={() => answer(always.optionId)}
              className="text-[11.5px] text-text-dim underline-offset-2 hover:text-text-secondary hover:underline"
            >
              Always allow in this session
            </button>
          </>
        )}
      </div>
    </div>
  );
}
