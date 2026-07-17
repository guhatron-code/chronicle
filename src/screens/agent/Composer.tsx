/*
 * F32 — the composer: multiline input (⌘Enter sends), Stop replaces Send
 * while the agent works (input stays editable), the two-state mode control
 * (Asks first / Works freely — modes are the AGENT'S OWN ids read from the
 * session; bypassPermissions is never offered), and the quiet usage meter
 * that is hidden entirely when the agent sends no usage data. Switching to
 * Works freely is confirmed once per session, with copy that states exactly
 * what it covers.
 */
import { useEffect, useRef, useState } from "react";
import {
  agentSessionFor,
  cancelAgentTurn,
  mirrorComposerText,
  sendAgentMessage,
  setAgentDraft,
  setAgentMode,
} from "@/lib/agent-session";
import { XGlyph } from "@/components/chrome/icons";
import type { ConfirmSpec } from "@/overlays/ConfirmDialog";
import { Kbd } from "@/components/chrome/atoms";
import { toastError } from "@/overlays/toasts";
import { cn } from "@/lib/utils";

const fmtTokens = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));

export function Composer({
  dir,
  disabled,
  onConfirm,
}: {
  dir: string;
  /** true while the session isn't ready — the input dims and nothing sends */
  disabled: boolean;
  onConfirm: (spec: ConfirmSpec) => void;
}) {
  const s = agentSessionFor(dir);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);

  /* F38 — a preloaded draft lands in the input, unsent */
  const lastDraft = useRef<string | null>(null);
  useEffect(() => {
    if (s.draft != null && s.draft.text !== lastDraft.current) {
      lastDraft.current = s.draft.text;
      setText(s.draft.text);
      mirrorComposerText(dir, s.draft.text);
      taRef.current?.focus();
    }
    if (s.draft == null) lastDraft.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.draft, dir]);

  const send = () => {
    const body = text.trim();
    if (!body || disabled || sending || s.turnActive) return;
    setSending(true);
    sendAgentMessage(dir, body)
      .then(() => { setText(""); mirrorComposerText(dir, ""); })
      .catch((e) => toastError("Couldn't send it", String(e).slice(0, 90)))
      .finally(() => setSending(false));
  };

  const stop = () => {
    void cancelAgentTurn(dir).catch((e) => toastError("Couldn't stop it", String(e).slice(0, 90)));
  };

  const switchMode = (modeId: string) => {
    if (!s.modes || s.modes.currentModeId === modeId) return;
    const apply = () =>
      void setAgentMode(dir, modeId).catch((e) => toastError("Couldn't switch the mode", String(e).slice(0, 90)));
    if (modeId === "acceptEdits" && !s.worksFreelyConfirmed) {
      onConfirm({
        title: "Let the agent work freely?",
        body:
          "File edits happen without asking, for the rest of this session. Commands still ask every time. Every change stays reviewable and undoable. This lasts for this session only — the next session asks first again.",
        cancelLabel: "Keep asking first",
        confirmLabel: "Work freely this session",
        onConfirm: apply,
      });
    } else apply();
  };

  const asksFirst = s.modes?.availableModes.find((m) => m.id === "default");
  const worksFreely = s.modes?.availableModes.find((m) => m.id === "acceptEdits");
  const current = s.modes?.currentModeId;

  return (
    <div className="flex shrink-0 flex-col gap-2 border-t border-divider px-3 py-2.5">
      {s.draft && text === s.draft.text && (
        <div className="flex flex-wrap items-center gap-2">
          <span data-draft-chip className="inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-full bg-fill-subtle px-2.5 text-[11px] text-text-subtle">
            {s.draft.label}
            <span className="text-text-dim">→ composer</span>
            <button
              aria-label="Clear the loaded prompt"
              onClick={() => { setAgentDraft(dir, null); setText(""); mirrorComposerText(dir, ""); }}
              className="flex text-text-dim hover:text-text-secondary"
            >
              <XGlyph size={8} />
            </button>
          </span>
          <span className="text-[11px] text-text-dim">review and send — nothing goes until you do</span>
        </div>
      )}
      <textarea
        ref={taRef}
        data-agent-input
        value={text}
        disabled={disabled}
        placeholder="Ask for anything…"
        onChange={(e) => {
          setText(e.target.value);
          mirrorComposerText(dir, e.target.value);
          // hand-editing the preload keeps the text but drops the chip's claim
          if (s.draft && e.target.value !== s.draft.text) setAgentDraft(dir, null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && e.metaKey) {
            e.preventDefault();
            send();
          }
        }}
        className={cn(
          "min-h-14 resize-none rounded-md border border-border-field bg-surface-input px-[11px] py-[9px] text-[13px] leading-normal text-text-primary outline-none placeholder:text-text-dimmer",
          "focus:border-border-field-focus focus:[box-shadow:var(--focus-ring)]",
          disabled && "opacity-60",
        )}
        rows={2}
      />
      <div className="flex items-center gap-[9px]">
        {asksFirst && worksFreely && (
          <div className="flex overflow-hidden rounded-md border border-border-hairline" data-mode-control>
            <button
              title="The agent asks before editing files or running commands."
              disabled={disabled}
              onClick={() => switchMode("default")}
              className={cn(
                "h-[26px] px-2.5 text-[11.5px]",
                current === "default" ? "bg-fill-hover font-medium text-text-primary" : "text-text-muted hover:text-text-primary",
              )}
            >
              Asks first
            </button>
            <button
              title="File edits happen without asking. Commands still ask."
              disabled={disabled}
              onClick={() => switchMode("acceptEdits")}
              className={cn(
                "h-[26px] border-l border-border-hairline px-2.5 text-[11.5px]",
                current === "acceptEdits" ? "bg-fill-hover font-medium text-text-primary" : "text-text-muted hover:text-text-primary",
              )}
            >
              Works freely
            </button>
          </div>
        )}
        {s.turnActive && (
          <span className="inline-flex items-center gap-1.5 text-[11.5px] text-state-neutral">
            <span
              aria-hidden
              className="inline-block size-[11px] shrink-0 rounded-full border-[1.5px] border-state-neutral"
              style={{ borderTopColor: "transparent", animation: "wv-spin 0.7s linear infinite" }}
            />
            working
          </span>
        )}
        {s.usage && (
          <span data-usage-meter className="font-mono text-[10.5px] text-text-dim tabular-nums">
            {fmtTokens(s.usage.used)} of {fmtTokens(s.usage.size)}
          </span>
        )}
        <span className="flex-1" />
        {s.turnActive ? (
          <button
            data-agent-stop
            onClick={stop}
            className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border-strong px-3 text-xs font-medium text-text-primary hover:bg-fill-hover"
          >
            <span className="size-2 shrink-0 rounded-[1.5px] bg-current" />
            Stop
          </button>
        ) : (
          <>
            <Kbd>⌘↩</Kbd>
            <button
              data-agent-send
              disabled={disabled || sending || !text.trim()}
              onClick={send}
              className={cn(
                "h-7 rounded-md px-3 text-xs font-medium",
                disabled || sending || !text.trim()
                  ? "cursor-default bg-fill-subtle text-text-dimmer"
                  : "bg-primary text-primary-fg hover:bg-primary-hover",
              )}
            >
              Send
            </button>
          </>
        )}
      </div>
    </div>
  );
}
