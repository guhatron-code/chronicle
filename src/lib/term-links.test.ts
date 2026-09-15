/*
 * The pure half of terminal link detection: joining a wrapped logical line
 * back together, and mapping a match's offsets in that joined string back to
 * on-screen (x, y) cell coordinates. Kept apart from term-sessions.ts (which
 * needs a real xterm Terminal) so it runs in plain node, no DOM.
 *
 * xterm wraps a logical line across buffer rows when it overflows `cols`; the
 * continuation row is marked `isWrapped`. A link that lands on the wrap
 * boundary must resolve against the whole logical line, not just the row the
 * mouse happens to be hovering.
 */
import { describe, expect, it } from "vitest";
import { logicalLine, spanToRange } from "./term-links";

function row(text: string, isWrapped = false) {
  return { text, isWrapped };
}

describe("logicalLine", () => {
  it("returns just the one row when it isn't wrapped on either side", () => {
    const rows = [row("$ echo hi"), row("https://example.com/a"), row("$ ")];
    expect(logicalLine(rows, 1)).toEqual({ text: "https://example.com/a", firstRow: 1 });
  });

  it("joins a URL split across two rows, y pointing at the first row", () => {
    // cols = 20; the URL is 33 chars, so it wraps once
    const rows = [
      row("https://claude.ai/co"), // full width, no trailing space to trim
      row("de/artifact/abc123", true),
    ];
    expect(logicalLine(rows, 0)).toEqual({
      text: "https://claude.ai/code/artifact/abc123",
      firstRow: 0,
    });
  });

  it("joins the same URL when y points at the continuation row instead", () => {
    const rows = [
      row("https://claude.ai/co"),
      row("de/artifact/abc123", true),
    ];
    expect(logicalLine(rows, 1)).toEqual({
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
    expect(logicalLine(rows, 3)).toEqual({
      text: "https://claude.ai/code/artifact/very-long-id-that-keeps-going/more",
      firstRow: 1,
    });
  });

  it("does not reach past an unwrapped neighbor", () => {
    const rows = [row("$ one"), row("$ two"), row("$ three")];
    expect(logicalLine(rows, 1)).toEqual({ text: "$ two", firstRow: 1 });
  });

  it("stays within the array bounds at the very first or last row", () => {
    const rows = [row("only row")];
    expect(logicalLine(rows, 0)).toEqual({ text: "only row", firstRow: 0 });
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
    const { text, firstRow } = logicalLine(rows, 0);
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
