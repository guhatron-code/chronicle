/*
 * The pure half of terminal link detection — no xterm Terminal, no DOM, so it
 * runs in plain node under vitest. term-sessions.ts owns the impure half
 * (reading term.buffer.active, building the ILink objects, the handlers).
 *
 * xterm wraps a logical line across buffer rows when it overflows `cols`; the
 * continuation row is marked `isWrapped`. A regex match near a wrap boundary
 * has to be found and positioned against the WHOLE logical line, not just
 * the one row xterm happens to be asking about.
 */

/** One buffer row, reduced to what the join needs. */
export interface LinkRow {
  text: string;
  isWrapped: boolean;
}

/** Reconstruct the logical line row `y` (an index into `rows`) belongs to:
 *  walk backward while the current row is itself a continuation, then
 *  forward while the next row is, and concatenate. `firstRow` is the index
 *  (into `rows`, same numbering as `y`) of the first row of that line. */
export function logicalLine(rows: LinkRow[], y: number): { text: string; firstRow: number } {
  let start = y;
  while (start > 0 && rows[start].isWrapped) start -= 1;
  let end = start;
  while (end + 1 < rows.length && rows[end + 1].isWrapped) end += 1;

  let text = "";
  for (let i = start; i <= end; i += 1) text += rows[i].text;
  return { text, firstRow: start };
}

/** Map a `[start, end)` character span in a joined logical-line string back
 *  to an xterm cell range. `firstRow` is the 1-based row number (xterm's own
 *  `y` convention — the value passed into `provideLinks`) of the first row
 *  of the logical line; `cols` is the terminal width every constituent row
 *  was padded/wrapped to. Both ends are inclusive columns, matching
 *  `ILinkRange` and the single-row math this replaces. */
export function spanToRange(
  start: number,
  end: number,
  cols: number,
  firstRow: number,
): { start: { x: number; y: number }; end: { x: number; y: number } } {
  const lastCharOffset = end - 1;
  return {
    start: { x: (start % cols) + 1, y: firstRow + Math.floor(start / cols) },
    end: { x: (lastCharOffset % cols) + 1, y: firstRow + Math.floor(lastCharOffset / cols) },
  };
}
