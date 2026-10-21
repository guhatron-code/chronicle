/*
 * An agent's mark: Chronigirl for Claude Code, a lettered round tile for the
 * others (letters from agents.ts). Design tokens only.
 */
import { Chronigirl } from "@/components/chrome/icons";
import { agentMeta } from "@/lib/agents";

export function AgentMark({ agent, size = 14 }: { agent: string; size?: number }) {
  const m = agentMeta(agent);
  if (!m.short) return <Chronigirl size={size} />;
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-fill-subtle font-semibold leading-none text-text-secondary"
      style={{ width: size, height: size, fontSize: Math.max(6, Math.round(size * 0.42)) }}
    >
      {m.short}
    </span>
  );
}
