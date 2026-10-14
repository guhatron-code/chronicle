/*
 * The thread's rows as the pane memoises them. The reducer mutates entries in
 * place, so identity cannot say "this row changed"; a per-entry revision can.
 * `touch` bumps it; `rowSignature` folds everything a row draws into one
 * string; `rowKeys` gives rows keys that follow them, not their position.
 */
import type { ThreadItem } from "./agent-session";

export function touch<E extends { rev: number }>(e: E): E {
  e.rev++;
  return e;
}

/** Keys that follow a row, not its position: a subagent's calls fold under
 *  their card when it arrives, which shifts every later index — and an
 *  index key would remount (and re-animate) rows that did not move. Identity
 *  where the wire gives one; the n-th of its kind otherwise. */
export function rowKeys(items: ThreadItem[]): string[] {
  const seen = new Map<string, number>();
  return items.map((it) => {
    if (it.kind === "tool") return `tool:${it.toolCallId}`;
    if (it.kind === "subagent") return `sub:${it.tool.toolCallId}`;
    if (it.kind === "perm") return `perm:${it.requestId}`;
    const n = (seen.get(it.kind) ?? 0) + 1;
    seen.set(it.kind, n);
    return `${it.kind}:${n}`;
  });
}

/** Changes exactly when the row must re-render. A subagent group folds in its children. */
export function rowSignature(item: ThreadItem): string {
  if (item.kind === "subagent") {
    let s = `sub:${item.tool.rev}:${item.children.length}`;
    for (const c of item.children) s += `,${c.rev}`;
    return s;
  }
  return `${item.kind}:${item.rev}`;
}

/** The memo rule. A signature says "unchanged" only for the SAME entry: resume
 *  and view replace the whole entries array, and a new entry at the same
 *  position starts at rev 0 with the same signature as the old one. Subagent
 *  groups are rebuilt every render, so their identity is their tool. */
export function sameRow(a: { sig: string; entry: ThreadItem }, b: { sig: string; entry: ThreadItem }): boolean {
  if (a.sig !== b.sig) return false;
  if (a.entry.kind === "subagent" && b.entry.kind === "subagent") return a.entry.tool === b.entry.tool;
  return a.entry === b.entry;
}
