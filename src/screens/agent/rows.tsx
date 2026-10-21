import type { ReactNode } from "react";
import { AgentMark } from "@/components/chrome/AgentMark";

/** Speaker marks — the single biggest "this is a conversation" signal. */
export function AssistantAvatar({ agent = "claude-acp" }: { agent?: string }) {
  return (
    <span className="flex size-[26px] shrink-0 items-center justify-center rounded-full border border-border-hairline bg-surface-card-raised">
      <AgentMark agent={agent} size={agent === "claude-acp" ? 17 : 14} />
    </span>
  );
}
export function UserAvatar() {
  return (
    <span className="flex size-[26px] shrink-0 items-center justify-center rounded-full border border-border-hairline bg-fill-subtle text-text-subtle">
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
        <circle cx="8" cy="5.5" r="2.6" />
        <path d="M3.4 13a4.6 4.6 0 0 1 9.2 0" />
      </svg>
    </span>
  );
}

/** The "agent is thinking" indicator — three staggered dots, a classic chat
 *  signal (and DS-clean: no gradient-clipped text). */
export function TypingDots() {
  return (
    <span className="inline-flex items-center gap-1" aria-label="The agent is working">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="size-1.5 rounded-full bg-text-dim"
          style={{ animation: "wv-pulse 1.1s ease-in-out infinite", animationDelay: `${i * 0.18}s` }}
        />
      ))}
    </span>
  );
}

export function MessageRow({ who, avatar, children }: { who: string; avatar: ReactNode; children: ReactNode }) {
  return (
    <div className="flex gap-2.5 px-3.5 py-2">
      {avatar}
      <div className="min-w-0 flex-1">
        <div className="mb-0.5 text-[12.5px] font-semibold text-text-primary">{who}</div>
        {/* the message body is content — the "You"/agent name above it is chrome */}
        <div data-selectable className="text-[13px] leading-[1.65] text-text-primary [text-wrap:pretty]">{children}</div>
      </div>
    </div>
  );
}

export function UserMessage({ text }: { text: string }) {
  return <MessageRow who="You" avatar={<UserAvatar />}>{text}</MessageRow>;
}
