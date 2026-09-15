/*
 * The pure half of terminal link detection: joining a wrapped logical line
 * back together, and mapping a match's offsets in that joined string back to
 * on-screen (x, y) cell coordinates. Kept apart from term-sessions.ts (which
 * needs a real xterm Terminal) so it runs in plain node, no DOM.
 *
 * xterm wraps a logical line across buffer rows when it overflows `cols`; the
 * continuation row is marked `isWrapped`. A link that lands on the wrap
 * boundary must resolve against the whole logical line, not just the row the
 * mouse happens to be hovering. `logicalLine` reads rows lazily through an
 * accessor (mirroring term.buffer.active.getLine) rather than a pre-built
 * array, so the common unwrapped case doesn't have to touch the buffer more
 * than once or twice, and it pads every non-final row of a wrapped line back
 * out to `cols` before joining, since a trimmed read of a wrapped row can
 * come up short of `cols` (a wide CJK/emoji character that didn't fit the
 * last column leaves xterm-cleared cells there, not real content).
 */
import { describe, expect, it, vi } from "vitest";
import { logicalLine, spanToRange, type LinkRow } from "./term-links";

function row(text: string, isWrapped = false): LinkRow {
  return { text, isWrapped };
}

/** Wrap a fixed array as a `logicalLine` accessor, `undefined` past either
 *  end — exactly how `readLinkRow(term, i)` behaves against a real buffer. */
function arrayAccessor(rows: LinkRow[]) {
  return (i: number): LinkRow | undefined => rows[i];
}

describe("logicalLine", () => {
  it("returns just the one row when it isn't wrapped on either side", () => {
    const rows = [row("$ echo hi"), row("https://example.com/a"), row("$ ")];
    expect(logicalLine(arrayAccessor(rows), 1, 80)).toEqual({
      text: "https://example.com/a",
      firstRow: 1,
    });
  });

  it("joins a URL split across two rows, y pointing at the first row", () => {
    // cols = 20; the URL is 38 chars, so it wraps once
    const rows = [
      row("https://claude.ai/co"), // full width, no trailing space to trim
      row("de/artifact/abc123", true),
    ];
    expect(logicalLine(arrayAccessor(rows), 0, 20)).toEqual({
      text: "https://claude.ai/code/artifact/abc123",
      firstRow: 0,
    });
  });

  it("joins the same URL when y points at the continuation row instead", () => {
    const rows = [
      row("https://claude.ai/co"),
      row("de/artifact/abc123", true),
    ];
    expect(logicalLine(arrayAccessor(rows), 1, 20)).toEqual({
      text: "https://claude.ai/code/artifact/abc123",
      firstRow: 0,
    });
  });

  it("walks through three wrapped rows", () => {
    const rows = [
      row("$ prompt "),
      row("https://claude.ai/co"), // starts a new logical line, not wrapped itself
      row("de/artifact/very-lon", true),
      row("g-id-that-keeps-goin", true),
      row("g/more", true),
      row("$ "),
    ];
    // y = 3 (the third row of the wrapped URL, 0-based index into rows)
    expect(logicalLine(arrayAccessor(rows), 3, 20)).toEqual({
      text: "https://claude.ai/code/artifact/very-long-id-that-keeps-going/more",
      firstRow: 1,
    });
  });

  it("does not reach past an unwrapped neighbor", () => {
    const rows = [row("$ one"), row("$ two"), row("$ three")];
    expect(logicalLine(arrayAccessor(rows), 1, 80)).toEqual({ text: "$ two", firstRow: 1 });
  });

  it("stays within bounds at the very first or last row", () => {
    const rows = [row("only row")];
    expect(logicalLine(arrayAccessor(rows), 0, 80)).toEqual({ text: "only row", firstRow: 0 });
  });

  it("stops walking at maxSteps even if isWrapped keeps going", () => {
    // five one-char rows (cols = 1, so no padding kicks in) all wrapped onto
    // each other; cap the walk to 2 steps in each direction so a
    // pathological line can't drag the whole buffer in
    const rows = [row("a", true), row("b", true), row("c", true), row("d", true), row("e", true)];
    // y = 2 (the middle row); backward can reach row 0, forward can reach row 4
    expect(logicalLine(arrayAccessor(rows), 2, 1, 2)).toEqual({ text: "abcde", firstRow: 0 });
    // a tighter cap of 1 step per direction can only reach rows 1..3
    expect(logicalLine(arrayAccessor(rows), 2, 1, 1)).toEqual({ text: "bcd", firstRow: 1 });
  });

  it("pads every non-final row to cols before joining, so a wide-char-trimmed row still lines up", () => {
    // cols = 5; row 0 is really 5 cells wide on screen, but a wide character
    // that didn't fit the last column left xterm's cleared cell there, and a
    // trimmed read of that row comes back as only 4 characters — "abcd"
    // instead of "abcd " (the cleared cell renders as a space).
    const rows = [row("abcd"), row("efg", true)];
    expect(logicalLine(arrayAccessor(rows), 0, 5)).toEqual({
      text: "abcd efg", // "abcd" padded to 5 (a trailing space) + "efg"
      firstRow: 0,
    });
  });

  it("pads a row shortened by an actual wide character the same way", () => {
    // "wid\u{1F600}" is 4 code points wide in JS string length terms but
    // occupies 5 terminal cells (the emoji is double-width); simulate the
    // trimmed 5-char read xterm would produce for a row that's really 6
    // cells wide, wrapping mid-emoji so the emoji doesn't appear at all and
    // the last cell is cleared.
    const rows = [row("wid\u{1F600}"), row("e", true)]; // "wid\u{1F600}".length === 5
    expect(logicalLine(arrayAccessor(rows), 0, 6)).toEqual({
      text: "wid\u{1F600} e", // padded to 6 (one trailing space) + "e"
      firstRow: 0,
    });
  });

  it("does not pad the true last row of the line — trailing content is real", () => {
    const rows = [row("https://claude.ai/co"), row("de", true)];
    const { text } = logicalLine(arrayAccessor(rows), 0, 20);
    expect(text).toBe("https://claude.ai/code"); // no trailing space after "de"
    expect(text.endsWith(" ")).toBe(false);
  });

  it("reads at most two rows for the common unwrapped case — the hovered row and its neighbor", () => {
    const rows = [row("$ one"), row("$ two"), row("$ three")];
    const getRow = vi.fn(arrayAccessor(rows));
    logicalLine(getRow, 1, 80, 60);
    // row 1 (isWrapped check), row 2 (the forward peek) — never row 0
    expect(getRow.mock.calls.map((c) => c[0]).sort((a, b) => a - b)).toEqual([1, 2]);
    expect(getRow).toHaveBeenCalledTimes(2);
  });

  it("reads each row touched by a wrapped line only once, thanks to caching", () => {
    const rows = [
      row("https://claude.ai/co"),
      row("de/artifact/abc123", true),
      row("$ "),
    ];
    const getRow = vi.fn(arrayAccessor(rows));
    logicalLine(getRow, 1, 20, 60); // y points at the continuation row
    // row 1 (backward check), row 0 (backward continues, then becomes the
    // forward-loop's first checked row — cached, not re-read), row 2 (the
    // forward peek that stops the walk)
    expect(getRow).toHaveBeenCalledTimes(3);
    expect(new Set(getRow.mock.calls.map((c) => c[0]))).toEqual(new Set([0, 1, 2]));
  });
});

describe("spanToRange", () => {
  it("matches the old single-row math for an unwrapped line", () => {
    // old code: range.start = {x: m.index + 1, y}; range.end = {x: m.index + len, y}
    const cols = 80;
    const firstRow = 5; // the xterm-provided `y`, 1-based
    const start = 10; // m.index
    const url = "https://example.com/a"; // 21 chars
    const end = start + url.length; // exclusive
    expect(spanToRange(start, end, cols, firstRow)).toEqual({
      start: { x: 11, y: 5 },
      end: { x: 31, y: 5 },
    });
  });

  it("spans two rows when the match crosses the wrap boundary", () => {
    const cols = 20;
    const firstRow = 3; // 1-based row of the logical line's first row
    // "https://claude.ai/co" (20 chars) then "de/artifact/abc123" (18 chars)
    // joined text: "https://claude.ai/code/artifact/abc123" (38 chars)
    const start = 0;
    const end = "https://claude.ai/code/artifact/abc123".length; // 38
    expect(spanToRange(start, end, cols, firstRow)).toEqual({
      start: { x: 1, y: 3 },
      // last char offset = 37; row = 3 + floor(37/20) = 3 + 1 = 4; x = 37%20+1 = 18
      end: { x: 18, y: 4 },
    });
  });

  it("spans three rows for a longer match", () => {
    const cols = 20;
    const firstRow = 1;
    const text = "https://claude.ai/code/artifact/very-long-id-that-keeps-going/more";
    const start = 0;
    const end = text.length; // 66
    // last char offset = 65; row = 1 + floor(65/20) = 1 + 3 = 4; x = 65%20+1 = 6
    expect(spanToRange(start, end, cols, firstRow)).toEqual({
      start: { x: 1, y: 1 },
      end: { x: 6, y: 4 },
    });
  });

  it("puts a match that starts mid-row on the right row and column", () => {
    const cols = 20;
    const firstRow = 1;
    const start = 25; // row 1 + floor(25/20)=1 -> row 2, x = 25%20+1 = 6
    const end = 30; // last char offset 29; row 1+floor(29/20)=1+1=2, x=29%20+1=10
    expect(spanToRange(start, end, cols, firstRow)).toEqual({
      start: { x: 6, y: 2 },
      end: { x: 10, y: 2 },
    });
  });
});

describe("logicalLine + spanToRange together: punctuation stripping on a joined URL", () => {
  it("still strips trailing punctuation once the URL is joined across rows", () => {
    const cols = 20;
    const rows = [
      row("https://claude.ai/co"),
      row("de/artifact/abc123.", true), // trailing period is punctuation, not part of the URL
    ];
    const { text, firstRow } = logicalLine(arrayAccessor(rows), 0, cols);
    const URL_RE = /https?:\/\/[^\s'"<>()\[\]]+/g;
    const m = URL_RE.exec(text)!;
    const url = m[0].replace(/[.,;:!?]+$/, "");
    expect(url).toBe("https://claude.ai/code/artifact/abc123");
    const range = spanToRange(m.index, m.index + url.length, cols, firstRow + 1);
    // stripped url is 38 chars (0..37); last char offset 37 ->
    // row 1+floor(37/20)=2, x=37%20+1=18
    expect(range).toEqual({ start: { x: 1, y: 1 }, end: { x: 18, y: 2 } });
  });
});
