/*
 * The agent pane body (F32/F33/F34/F35 wired to the ACP seam): the thread of
 * user/assistant messages, tool cards and inline permission asks, the state
 * banners (disconnected · installing the bridge · needs login · error ·
 * ended), and the composer. Session state lives in lib/agent-session.ts —
 * this component only renders and dispatches.
 */
import { useEffect, useRef, useState } from "react";
import {
  agentSessionFor,
  startAgentSession,
  adoptAgentSession,
  subscribeAgent,
  type AgentEntry,
} from "@/lib/agent-session";
import { getTerm, setActiveTermFor, spawnTerm, subscribeTerms } from "@/lib/term-sessions";
import type { ConfirmSpec } from "@/overlays/ConfirmDialog";
import { toastError } from "@/overlays/toasts";
import { MiniMd } from "@/lib/mini-md";
import { ClaudeStar, ErrorGlyph } from "@/components/chrome/icons";
import { BtnPrimary, BtnSecondary, Spinner } from "@/components/chrome/atoms";
import { Composer } from "./Composer";
import { ToolCard } from "./ToolCard";
import { PermissionCard } from "./PermissionCard";

function UserMessage({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-end gap-1 border-t border-divider px-3.5 py-2.5 first:border-t-0">
      <div className="max-w-[86%] text-right text-[13px] leading-relaxed text-text-primary [text-wrap:pretty]">
        {text}
      </div>
    </div>
  );
}

function AssistantMessage({ text, streaming }: { text: string; streaming: boolean }) {
  if (streaming) {
    // the shimmer runs ONLY while streaming; settled text renders as mini-md
    return (
      <div className="px-3.5 py-1">
        <div
          data-streaming
          className="whitespace-pre-wrap text-[13px] leading-[1.65]"
          style={{
            background: "linear-gradient(90deg, var(--text-muted) 0%, var(--text-primary) 45%, var(--text-muted) 90%)",
            backgroundSize: "200% 100%",
            WebkitBackgroundClip: "text",
            backgroundClip: "text",
            color: "transparent",
            animation: "wv-shimmer 2s linear infinite",
          }}
        >
          {text}
        </div>
      </div>
    );
  }
  return (
    <div className="px-3.5 py-1 text-[13px] leading-[1.65] text-text-secondary">
      <MiniMd source={text} />
    </div>
  );
}

function TurnError({ message }: { message: string }) {
  return (
    <div className="mx-3.5 my-1 flex items-start gap-2 rounded-md border border-border-hairline bg-surface-card px-[11px] py-2">
      <span className="mt-0.5 shrink-0 text-state-error"><ErrorGlyph size={12} /></span>
      <span className="min-w-0 text-xs leading-[1.55] text-text-muted">
        The agent stopped with an error — <span className="font-mono text-[11px]">{message}</span>. Send the message
        again, or end the session and start fresh.
      </span>
    </div>
  );
}

function Entry({ dir, entry }: { dir: string; entry: AgentEntry }) {
  if (entry.kind === "user") return <UserMessage text={entry.text} />;
  if (entry.kind === "assistant") return <AssistantMessage text={entry.text} streaming={entry.streaming} />;
  if (entry.kind === "turn-error") return <TurnError message={entry.message} />;
  if (entry.kind === "perm")
    return (
      <div className="px-3.5 py-1">
        <PermissionCard dir={dir} perm={entry} />
      </div>
    );
  return (
    <div className="px-3.5 py-1">
      <ToolCard tool={entry} />
    </div>
  );
}

export function AgentPane({
  dir,
  onConfirm,
  onRevealTerminal,
}: {
  dir: string;
  onConfirm: (spec: ConfirmSpec) => void;
  /** the sign-in flow runs in a terminal tab — the unit must be on screen */
  onRevealTerminal: () => void;
}) {
  const [, bump] = useState(0);
  useEffect(() => subscribeAgent(() => bump((n) => n + 1)), []);
  useEffect(() => {
    void adoptAgentSession(dir); // a live backend session survives a reload
  }, [dir]);
  const s = agentSessionFor(dir);

  /* stick to the bottom while the thread grows, unless the user scrolled up */
  const scrollRef = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  useEffect(() => {
    const el = scrollRef.current;
    if (el && nearBottom.current) el.scrollTop = el.scrollHeight;
  });

  /* needs-login: run `claude /login` in a terminal tab; when that tab's
     session exits, retry the agent session (the plan's retry contract) */
  const [loginTermId, setLoginTermId] = useState<number | null>(null);
  useEffect(() => {
    if (loginTermId == null) return;
    return subscribeTerms(() => {
      const t = getTerm(loginTermId);
      if (!t || t.dead) {
        setLoginTermId(null);
        void startAgentSession(dir).catch(() => {});
      }
    });
  }, [loginTermId, dir]);

  const start = () => void startAgentSession(dir).catch((e) => toastError("Couldn't start the agent", String(e).slice(0, 110)));
  const signIn = () => {
    onRevealTerminal();
    spawnTerm(dir, { title: "sign-in", agent: "claude", autoType: "claude /login" })
      .then((sess) => {
        setActiveTermFor(dir, sess.id);
        setLoginTermId(sess.id);
      })
      .catch((e) => toastError("Couldn't open the sign-in terminal", String(e).slice(0, 90)));
  };

  const banner = (() => {
    if (s.phase === "none")
      return (
        <div data-agent-banner="disconnected" className="mx-3 mb-2 flex items-center gap-[9px] rounded-md bg-fill-subtle px-[11px] py-[9px]">
          <span className="inline-flex items-center gap-1.5 text-[12.5px] text-state-error">
            <ErrorGlyph size={12} />
            The agent bridge isn't running
          </span>
          <span className="flex-1" />
          <BtnPrimary size="sm" onClick={start}>Start it</BtnPrimary>
        </div>
      );
    if (s.phase === "installing" || s.phase === "starting")
      return (
        <div data-agent-banner="installing" className="mx-3 mb-2 flex flex-col gap-2 rounded-md bg-fill-subtle p-[11px]">
          <div className="flex items-center gap-2">
            <Spinner size={11} />
            <span className="text-[12.5px] text-text-secondary">
              {s.phase === "installing" ? "Setting up the agent bridge…" : "Starting the session…"}
            </span>
          </div>
          {s.phase === "installing" && (
            <span className="text-[11.5px] text-text-dim">
              First run downloads the adapter once. Nothing in your project is touched.
            </span>
          )}
        </div>
      );
    if (s.phase === "needs-login")
      return (
        <div data-agent-banner="needs-login" className="mx-3 mb-2 flex flex-col gap-2 rounded-md bg-fill-subtle px-[11px] py-[9px]">
          <div className="flex items-center gap-[9px]">
            <span className="inline-flex items-center gap-1.5 text-[12.5px] text-text-secondary">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" className="shrink-0 text-text-subtle">
                <rect x="2.5" y="5" width="7" height="5.5" rx="1" />
                <path d="M4 5V3.6a2 2 0 0 1 4 0V5" />
              </svg>
              Claude Code isn't signed in
            </span>
            <span className="flex-1" />
            {loginTermId == null && (
              <BtnPrimary size="sm" onClick={signIn} className="whitespace-nowrap">
                Sign in — opens a terminal
              </BtnPrimary>
            )}
          </div>
          {loginTermId != null && (
            <div className="flex items-center gap-2">
              <Spinner size={11} />
              <span className="text-[11.5px] text-text-muted">Waiting for the sign-in to finish in</span>
              <span className="rounded-[5px] bg-fill-subtle px-1.5 font-mono text-[10.5px] text-text-subtle">claude · sign-in</span>
            </div>
          )}
        </div>
      );
    if (s.phase === "error")
      return (
        <div data-agent-banner="error" className="mx-3 mb-2 flex items-start gap-[9px] rounded-md bg-fill-subtle p-[11px]">
          <span className="mt-0.5 shrink-0 text-state-error"><ErrorGlyph size={12} /></span>
          <div className="flex min-w-0 flex-col gap-[7px]">
            <span className="text-[12.5px] leading-[1.5] text-text-secondary">
              The agent bridge stopped and couldn't start a session. It may need an update or a working connection.
            </span>
            {s.errorMessage && (
              <span className="truncate font-mono text-[10.5px] text-text-dim" title={s.errorMessage}>{s.errorMessage}</span>
            )}
            <BtnSecondary size="sm" className="w-max" onClick={start}>Try again</BtnSecondary>
          </div>
        </div>
      );
    if (s.phase === "ended")
      return (
        <div data-agent-banner="ended" className="mx-3 mb-2 flex items-center gap-[9px] rounded-md bg-fill-subtle px-[11px] py-[9px]">
          <span className="text-[12.5px] text-text-muted">The session ended.</span>
          <span className="flex-1" />
          <BtnPrimary size="sm" onClick={start}>Start a new session</BtnPrimary>
        </div>
      );
    return null;
  })();

  const empty = s.entries.length === 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {empty ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-[9px] p-5 text-center">
          <ClaudeStar size={20} />
          <span className="text-[15px] font-semibold text-text-primary">Ask for anything.</span>
          <span className="max-w-[34ch] text-[12.5px] leading-[1.55] text-text-muted [text-wrap:pretty]">
            Chronicle asks before the agent touches your project.
          </span>
        </div>
      ) : (
        <div
          ref={scrollRef}
          data-agent-thread
          onScroll={(e) => {
            const el = e.currentTarget;
            nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
          }}
          className="flex min-h-0 flex-1 flex-col overflow-y-auto py-2"
        >
          {s.entries.map((entry, i) => (
            <Entry key={i} dir={dir} entry={entry} />
          ))}
        </div>
      )}
      {banner}
      <Composer dir={dir} disabled={s.phase !== "ready"} onConfirm={onConfirm} />
    </div>
  );
}
