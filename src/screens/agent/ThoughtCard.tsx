/*
 * Round 9 — the agent's thinking, kept and folded. One quiet row that says
 * "Thinking…" while chunks stream and "Thought" after; the text opens on a
 * click and never opens on its own. Only the main agent's thoughts arrive —
 * the adapter strips a subagent's — so a thought never sits inside a tree.
 */
import { Reasoning, ReasoningContent, ReasoningTrigger } from "@/components/ai-elements/reasoning";
import { Spinner } from "@/components/chrome/atoms";
import { ChevronRightGlyph } from "@/components/chrome/icons";
import { cn } from "@/lib/utils";

const ThoughtGlyph = ({ size = 12 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" className="shrink-0">
    <path d="M4.5 9.5A3.5 3.5 0 0 1 3 6.5a4 4 0 0 1 8 0 3.5 3.5 0 0 1-1.5 3v1.5h-5z" />
    <path d="M6 12.5h2" />
  </svg>
);

export function ThoughtCard({ text, streaming }: { text: string; streaming: boolean }) {
  return (
    <Reasoning isStreaming={streaming} defaultOpen={false} data-thought className="mb-0">
      <ReasoningTrigger className="group w-auto gap-2 whitespace-nowrap px-[11px] py-[5px] text-text-dim hover:text-text-secondary">
        {streaming ? <Spinner size={11} /> : <span className="wv-pop text-text-dim"><ThoughtGlyph /></span>}
        <span className="text-[12.5px]">{streaming ? "Thinking…" : "Thought"}</span>
        <ThoughtChevron />
      </ReasoningTrigger>
      <ReasoningContent
        data-selectable
        className={cn(
          "mt-0 ml-[26px] max-h-48 overflow-y-auto rounded-md bg-surface-input px-3 py-2 font-mono text-[11px] leading-[1.7] text-text-muted",
          "[&_p]:my-0 [&_p+p]:mt-2",
        )}
      >
        {text}
      </ReasoningContent>
    </Reasoning>
  );
}

/** the chevron reads the collapsible's own state, so it turns with a click */
function ThoughtChevron() {
  return (
    <span className="text-text-dim transition-transform group-data-[state=open]:rotate-90">
      <ChevronRightGlyph size={10} />
    </span>
  );
}
