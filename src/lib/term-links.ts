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

/** Reconstruct the logical line row `y` belongs to, reading rows lazily
 *  through `getRow` (an absolute-index accessor — `undefined` past either
 *  end) rather than a pre-built array: walk backward only while the current
 *  row is itself a continuation, then forward only while the NEXT row is,
 *  each step one `getRow` call, capped at `maxSteps` per direction so a
 *  pathological unbroken line can't walk the whole buffer. Every row is
 *  read at most once — a cache absorbs the one-row lookahead each direction
 *  needs to know where to stop, so the common unwrapped-row case costs two
 *  calls: the hovered row, and the peek at the row after it. `firstRow` is
 *  the absolute index (`getRow`'s own numbering, same as `y`) of the first
 *  row of the line.
 *
 *  xterm pads a wrapped row to the full `cols` width with real characters
 *  before wrapping — except when a wide (CJK/emoji) character doesn't fit
 *  the last column, in which case it clears the leftover cell(s), which
 *  render as spaces but can make a *trimmed* read of that row (`getRow`'s
 *  `text`, however the caller produced it) come up short. Every row but the
 *  true last one of the line is therefore padded to `cols` with spaces
 *  before joining — the same content a full, untrimmed read of that row
 *  would have produced — so `spanToRange`'s "every constituent row is
 *  `cols` wide" assumption holds regardless of how the caller read it. If a
 *  URL or path genuinely spans a cleared wide-char cell, the pad space
 *  breaks the match there — that's xterm's own rendering of the boundary,
 *  not a join bug. */
export function logicalLine(
  getRow: (index: number) => LinkRow | undefined,
  y: number,
  cols: number,
  maxSteps: number = Infinity,
): { text: string; firstRow: number } {
  const cache = new Map<number, LinkRow | undefined>();
  const read = (i: number): LinkRow | undefined => {
    if (!cache.has(i)) cache.set(i, getRow(i));
    return cache.get(i);
  };

  let start = y;
  for (let steps = 0; steps < maxSteps; steps += 1) {
    const cur = read(start);
    if (!cur?.isWrapped) break;
    if (!read(start - 1)) break; // continuation claimed, but nothing precedes it
    start -= 1;
  }

  // Each direction gets its own budget measured from `y`, not from `start` —
  // a backward walk that spends its steps reaching `start` must not eat into
  // how far the forward walk may still reach past `y`.
  let end = y;
  for (let steps = 0; steps < maxSteps; steps += 1) {
    const next = read(end + 1);
    if (!next?.isWrapped) break;
    end += 1;
  }

  let text = "";
  for (let i = start; i <= end; i += 1) {
    const row = read(i) ?? { text: "", isWrapped: false };
    text += i < end ? row.text.padEnd(cols) : row.text;
  }
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
