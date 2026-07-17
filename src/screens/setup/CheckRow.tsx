/*
 * G1/G2/G3/G4 — one row of the setup checklist. Kind-aware icon + plain name +
 * blurb, a StateWord (checking · ready · needs you · installing % · couldn't
 * finish · fixed), and at most one action button. The sign-in rows show the
 * agent-pane needs-login waiting treatment 1:1 while their terminal runs.
 */
import type { SetupCheck } from "@/lib/ipc";
import { CHECK_META, waitingSignin } from "@/lib/setup-store";
import { cn } from "@/lib/utils";
import { ClaudeStar } from "@/components/chrome/icons";

function KindIcon({ kind }: { kind: string }) {
  if (kind === "claude" || kind === "signin") return <ClaudeStar size={15} />;
  const common = { width: 14, height: 14, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor" as const };
  if (kind === "node")
    return (
      <svg {...common} strokeWidth="1.3" className="text-text-subtle">
        <path d="M8 1.6 13.4 4.6v6.8L8 14.4 2.6 11.4V4.6z" />
        <circle cx="8" cy="8" r="2.1" />
      </svg>
    );
  if (kind === "path")
    return (
      <svg {...common} strokeWidth="1.4" className="text-text-subtle">
        <rect x="2" y="3" width="12" height="10" rx="1.6" />
        <path d="m4.6 6.4 2 1.6-2 1.6M8.4 9.8h3" />
      </svg>
    );
  if (kind === "github")
    return (
      <svg {...common} strokeWidth="1.4" className="text-text-subtle">
        <path d="M4.4 12.2a3 3 0 0 1-.4-5.97A3.4 3.4 0 0 1 10.6 5.4a2.8 2.8 0 0 1 1.2 5.4" />
        <path d="M8 8v4.8M6.2 10.4 8 12.4l1.8-2" />
      </svg>
    );
  return (
    <svg {...common} strokeWidth="1.3" className="text-text-subtle">
      <path d="M4.6 2.5h4.2l3.6 3.6v7.4H4.6z" />
      <path d="M8.6 2.5v3.8h3.6" />
      <path d="M6.3 9.3 7.4 10.4 9.7 8.1" />
    </svg>
  );
}

const Check = ({ size = 12 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.7">
    <path d="M2 6.5 5 9.5 10 3" />
  </svg>
);

function StateWord({ check }: { check: SetupCheck }) {
  const s = check.state;
  if (s === "ready")
    return (
      <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-[12.5px] text-state-success">
        <Check />{check.detail?.startsWith("Fixed") ? "fixed" : "ready"}
      </span>
    );
  if (s === "installing")
    return (
      <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-[12.5px] text-state-neutral">
        <span className="size-1.5 shrink-0 rounded-full bg-state-neutral" style={{ animation: "wv-pulse 1.4s ease-in-out infinite" }} />
        installing{check.pct != null ? ` · ${check.pct}%` : ""}
      </span>
    );
  if (s === "couldnt_finish")
    return (
      <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-[12.5px] text-state-error">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="6" cy="6" r="5" /><path d="M6 3.4v3M6 8.4v.1" /></svg>
        couldn't finish
      </span>
    );
  if (s === "needs_you" || s === "missing")
    return (
      <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-[12.5px] text-state-error">
        <span className="size-1.5 shrink-0 rounded-full bg-state-error" />needs you
      </span>
    );
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-[12.5px] text-text-muted">
      <span className="size-1.5 shrink-0 rounded-full bg-state-neutral" style={{ animation: "wv-pulse 1.4s ease-in-out infinite" }} />checking
    </span>
  );
}

const fmtMB = (b?: number) => (b != null ? `${(b / 1_000_000).toFixed(1)}` : "0");

export function CheckRow({
  check,
  onInstall,
  onFix,
  onSignin,
  onCancel,
}: {
  check: SetupCheck;
  onInstall: () => void;
  onFix: () => void;
  onSignin: () => void;
  onCancel: () => void;
}) {
  const meta = CHECK_META.find((m) => m.id === check.id)!;
  const installing = check.state === "installing";
  const failed = check.state === "couldnt_finish";
  const waiting = waitingSignin(check.id);
  const detail = check.detail || meta.blurb;

  return (
    <div className="flex items-start gap-[15px] border-t border-divider py-[15px] first:border-t-0" data-check-row={check.id} data-check-state={check.state}>
      <span className="flex size-[30px] shrink-0 items-center justify-center rounded-lg border border-border-hairline bg-fill-subtle">
        <KindIcon kind={meta.kind} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="text-[13px] font-medium text-text-primary">{meta.name}</div>
        <div className={cn("text-[12px] leading-snug", failed ? "text-text-secondary" : "text-text-dim")}>{detail}</div>
        {installing && (
          <div className="mt-0.5 flex items-center gap-2.5">
            <span className="block h-[3px] flex-1 overflow-hidden rounded-[2px] bg-fill-hover">
              <span className="block h-full rounded-[2px] bg-state-neutral" style={{ width: `${check.pct ?? 8}%` }} />
            </span>
            {check.totalBytes ? (
              <span className="font-mono text-[11px] text-text-subtle tabular-nums">
                {fmtMB(check.gotBytes)} of {fmtMB(check.totalBytes)} MB
              </span>
            ) : null}
          </div>
        )}
        {failed && check.tech && <span className="font-mono text-[10.5px] text-text-dim">{check.tech}</span>}
        {waiting && (
          <div className="mt-0.5 flex items-center gap-2">
            <span aria-hidden className="inline-block size-[11px] shrink-0 rounded-full border-[1.5px] border-state-neutral" style={{ borderTopColor: "transparent", animation: "wv-spin 0.7s linear infinite" }} />
            <span className="text-[11.5px] text-text-muted">Waiting for you to finish signing in…</span>
            <span className="rounded-[5px] bg-fill-subtle px-1.5 font-mono text-[10.5px] text-text-subtle">
              {check.id === "github" ? "github · sign-in" : "claude · sign-in"}
            </span>
          </div>
        )}
      </div>
      {!waiting && <StateWord check={check} />}
      {/* the one action */}
      {!waiting && installing ? (
        <button data-check-action="cancel" onClick={onCancel} className="h-[33px] shrink-0 whitespace-nowrap rounded-lg border border-border-hairline px-[13px] text-[12.5px] font-medium text-text-muted hover:bg-fill-hover hover:text-text-primary">
          Cancel
        </button>
      ) : failed ? (
        <button data-check-action="retry" onClick={onInstall} className="h-[33px] shrink-0 whitespace-nowrap rounded-lg border border-border-strong px-[14px] text-[12.5px] font-medium text-text-primary hover:bg-fill-hover">
          Try again
        </button>
      ) : check.action === "install" ? (
        <button data-check-action="install" onClick={onInstall} className="h-[33px] shrink-0 whitespace-nowrap rounded-lg border border-border-strong px-[14px] text-[12.5px] font-medium text-text-primary hover:bg-fill-hover">
          Install
        </button>
      ) : check.action === "fix_path" ? (
        <button data-check-action="fix" onClick={onFix} className="h-[33px] shrink-0 whitespace-nowrap rounded-lg border border-border-strong px-[14px] text-[12.5px] font-medium text-text-primary hover:bg-fill-hover">
          Fix it
        </button>
      ) : check.action === "signin" && !waiting ? (
        <button data-check-action="signin" onClick={onSignin} className="h-[33px] shrink-0 whitespace-nowrap rounded-lg border border-border-strong px-[14px] text-[12.5px] font-medium text-text-primary hover:bg-fill-hover">
          Sign in
        </button>
      ) : null}
    </div>
  );
}
