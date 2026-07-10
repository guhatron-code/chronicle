/*
 * A deliberately tiny markdown renderer for the F22 documents accordion —
 * headings, paragraphs, lists, bold, inline code. No links-following, no HTML
 * passthrough (captured content is data, never instructions).
 */
import { Fragment, type ReactNode } from "react";

function inline(text: string, key: number): ReactNode {
  const parts: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("**")) {
      parts.push(<strong key={`${key}-${i++}`} className="font-semibold text-text-primary">{tok.slice(2, -2)}</strong>);
    } else {
      parts.push(
        <code key={`${key}-${i++}`} className="rounded-[4px] bg-fill-subtle px-1 font-mono text-[11px]">
          {tok.slice(1, -1)}
        </code>,
      );
    }
    last = m.index + tok.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

export function MiniMd({ source }: { source: string }) {
  const blocks: ReactNode[] = [];
  let listItems: string[] = [];
  let k = 0;
  const flushList = () => {
    if (listItems.length === 0) return;
    blocks.push(
      <ul key={k++} className="flex list-disc flex-col gap-1 pl-4">
        {listItems.map((li, i) => <li key={i}>{inline(li, k * 100 + i)}</li>)}
      </ul>,
    );
    listItems = [];
  };
  for (const raw of source.split("\n")) {
    const line = raw.trimEnd();
    const h = line.match(/^(#{1,3})\s+(.*)/);
    if (h) {
      flushList();
      blocks.push(
        <div key={k++} className="pb-1 pt-1.5 font-semibold text-text-primary first:pt-0">
          {inline(h[2], k)}
        </div>,
      );
      continue;
    }
    const li = line.match(/^[-*]\s+(.*)/);
    if (li) { listItems.push(li[1]); continue; }
    flushList();
    if (line.trim() === "") continue;
    blocks.push(<p key={k++} className="pb-1.5 last:pb-0">{inline(line, k)}</p>);
  }
  flushList();
  return <Fragment>{blocks}</Fragment>;
}
