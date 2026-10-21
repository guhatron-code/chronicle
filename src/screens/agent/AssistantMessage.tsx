/*
 * The agent's reply, formatted as it streams. streamdown parses completed
 * blocks once and re-parses only the open one, so a chunk costs the open
 * paragraph, not the whole reply. A caret trails the live text.
 */
import { Streamdown } from "streamdown";
import { assistantMarkdownProps } from "@/lib/assistant-markdown";
import { agentMeta } from "@/lib/agents";
import { AssistantAvatar, MessageRow, TypingDots } from "./rows";

const props = assistantMarkdownProps();

export function AssistantMessage({ text, streaming, agent }: { text: string; streaming: boolean; agent: string }) {
  return (
    <MessageRow who={agentMeta(agent).headerName} avatar={<AssistantAvatar agent={agent} />}>
      <span data-streaming={streaming || undefined}>
        {streaming && !text.trim() ? (
          <TypingDots />
        ) : (
          <span data-selectable className="assistant-md [&>*:last-child]:inline">
            <Streamdown {...props} className="space-y-1.5">{text}</Streamdown>
            {streaming && (
              <span className="ml-0.5 inline-block h-[15px] w-px translate-y-[2px] bg-text-secondary" style={{ animation: "wv-pulse 1.1s step-end infinite" }} />
            )}
          </span>
        )}
      </span>
    </MessageRow>
  );
}
