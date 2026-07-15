/*
 * A deliberately tiny markdown renderer for the F22 documents accordion —
 * headings, paragraphs, lists, bold, inline code, fenced code blocks, block
 * quotes. No links-following, no HTML passthrough (captured content is data,
 * never instructions).
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
  let quoteLines: string[] = [];
  let fence: string[] | null = null;
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
  const flushQuote = () => {
    if (quoteLines.length === 0) return;
    blocks.push(
      <blockquote key={k++} className="mb-1.5 border-l-2 border-border-strong pl-3 text-text-muted">
        {quoteLines.map((q, i) => (
          <p key={i} className="pb-1 last:pb-0">{inline(q, k * 100 + i)}</p>
        ))}
      </blockquote>,
    );
    quoteLines = [];
  };
  for (const raw of source.split("\n")) {
    const line = raw.trimEnd();
    if (fence !== null) {
      if (/^```/.test(line)) {
        blocks.push(
          <pre key={k++} className="mb-1.5 overflow-x-auto rounded-md bg-fill-subtle p-2.5 font-mono text-[11px] leading-[1.55]">
            {fence.join("\n")}
          </pre>,
        );
        fence = null;
      } else fence.push(raw);
      continue;
    }
    if (/^```/.test(line)) { flushList(); flushQuote(); fence = []; continue; }
    const q = line.match(/^>\s?(.*)/);
    if (q) { flushList(); quoteLines.push(q[1]); continue; }
    flushQuote();
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
  if (fence !== null) {
    // an unclosed fence still renders as code — never swallow content
    blocks.push(
      <pre key={k++} className="mb-1.5 overflow-x-auto rounded-md bg-fill-subtle p-2.5 font-mono text-[11px] leading-[1.55]">
        {fence.join("\n")}
      </pre>,
    );
  }
  flushList();
  flushQuote();
  return <Fragment>{blocks}</Fragment>;
}
