import { describe, expect, it } from "vitest";
import type { NoteEntry } from "./ipc";
import {
  backlinksFor, buildTree, joinFrontMatter, marqueeDistance, needsMarquee, newNotePath,
  outlinksFor, pillFor, roundLogHeader, rowNameStyle, setStatusInFront, slugFor, splitFrontMatter,
  statusInFront, stickToBottom, tagCounts, tailLines, LOG_MAX_LINES, STICK_SLOP,
} from "./notes-model";

const note = (path: string, p: Partial<NoteEntry> = {}): NoteEntry => ({
  path, title: (path.split("/").pop() ?? path).replace(/\.md$/, ""),
  folder: path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "",
  status: null, round: null, tags: [], links: [], resolved: [], ambiguous: [],
  mtime: 0, size: 0, snippet: "", unreadable: false, ...p,
});

describe("front matter", () => {
  const file = "---\nstatus: queued\ntags: [ui]\n---\n\n# Title\n\nbody\n";
  it("splits and rejoins byte-for-byte", () => {
    const { front, body } = splitFrontMatter(file);
    expect(front).toBe("---\nstatus: queued\ntags: [ui]\n---\n\n");
    expect(body).toBe("# Title\n\nbody\n");
    expect(joinFrontMatter(front, body)).toBe(file);
  });
  it("treats a file with no block as all body", () => {
    const { front, body } = splitFrontMatter("just text\n");
    expect(front).toBe("");
    expect(body).toBe("just text\n");
    expect(joinFrontMatter("", "just text\n")).toBe("just text\n");
  });
  it("reads and rewrites only the status line", () => {
    expect(statusInFront(file)).toBe("queued");
    expect(statusInFront("")).toBeNull();
    const done = setStatusInFront(splitFrontMatter(file).front, "done");
    expect(done).toBe("---\nstatus: done\ntags: [ui]\n---\n\n");
    expect(setStatusInFront(done, null)).toBe("---\ntags: [ui]\n---\n\n");
    expect(setStatusInFront("", "queued")).toBe("---\nstatus: queued\n---\n\n");
  });
});

describe("buildTree", () => {
  const notes = [note("Design/A.md"), note("Design/Deep/B.md"), note("Root.md"), note("Tasks/C.md")];
  it("puts folders before notes, sorted, with depth", () => {
    const rows = buildTree(notes, new Set());
    expect(rows.map((r) => `${r.depth}:${r.kind}:${r.name}`)).toEqual([
      "0:folder:Design", "1:note:A", "1:folder:Deep", "2:note:B",
      "0:folder:Tasks", "1:note:C", "0:note:Root",
    ]);
  });
  it("hides everything under a collapsed folder", () => {
    const rows = buildTree(notes, new Set(["Design"]));
    expect(rows.map((r) => r.path)).toEqual(["Design", "Tasks", "Tasks/C.md", "Root.md"]);
  });
});

describe("links", () => {
  const notes = [
    note("Design/Retro.md", {
      links: [{ target: "Energy budget", label: null }, { target: "Nowhere", label: null }],
      resolved: ["Design/Energy budget.md", null], ambiguous: [false, false],
      snippet: "the 40 s compile from [[Energy budget]] surprised me",
    }),
    note("Design/Energy budget.md"),
  ];
  it("finds who links here, with context", () => {
    const back = backlinksFor(notes, "Design/Energy budget.md");
    expect(back).toEqual([{ path: "Design/Retro.md", title: "Retro", context: "the 40 s compile from [[Energy budget]] surprised me" }]);
    expect(backlinksFor(notes, "Design/Retro.md")).toEqual([]);
  });
  it("lists what this note points at, missing ones included", () => {
    expect(outlinksFor(notes, "Design/Retro.md")).toEqual([
      { target: "Energy budget", label: null, path: "Design/Energy budget.md", ambiguous: false },
      { target: "Nowhere", label: null, path: null, ambiguous: false },
    ]);
  });
});

describe("tagCounts", () => {
  it("counts and sorts by count then name", () => {
    const notes = [note("a.md", { tags: ["ui", "bug"] }), note("b.md", { tags: ["ui"] }), note("c.md", { tags: ["ui", "energy"] })];
    expect(tagCounts(notes)).toEqual([
      { tag: "ui", count: 3 }, { tag: "bug", count: 1 }, { tag: "energy", count: 1 },
    ]);
  });
});

describe("pillFor", () => {
  it("names every state the header can show", () => {
    expect(pillFor(null, null, null)).toEqual({ label: "no status", tone: "none", locked: false });
    expect(pillFor("queued", null, null)).toEqual({ label: "queued", tone: "queued", locked: false });
    expect(pillFor("in_progress", 4, "ready")).toEqual({ label: "in progress · round 4", tone: "progress", locked: true });
    expect(pillFor("in_progress", 4, "generating")).toEqual({ label: "in progress · round 4", tone: "progress", locked: true });
    expect(pillFor("done", 4, "done")).toEqual({ label: "done", tone: "done", locked: false });
    expect(pillFor("done", 4, "failed")).toEqual({ label: "done", tone: "done", locked: false });
    expect(pillFor("shipped", null, null)).toEqual({ label: "unknown", tone: "unknown", locked: false });
  });
});

describe("rows never wrap", () => {
  it("marquees only when the name really overflows", () => {
    expect(needsMarquee(200, 120)).toBe(true);
    expect(needsMarquee(120, 120)).toBe(false);
    expect(needsMarquee(122, 120)).toBe(false); // a 2px rounding wobble is not an overflow
    expect(marqueeDistance(200, 120)).toBe(80);
    expect(marqueeDistance(100, 120)).toBe(0);
  });
});

describe("rowNameStyle", () => {
  it("always truncates and never wraps", () => {
    for (const [sw, cw, hov] of [[100, 120, false], [200, 120, true], [200, 120, false]] as const) {
      expect(rowNameStyle(sw, cw, hov).className).toContain("whitespace-nowrap");
      expect(rowNameStyle(sw, cw, hov).className).toContain("text-ellipsis");
    }
  });
  it("marquees only on hover, only when it overflows, and carries the distance", () => {
    expect(rowNameStyle(200, 120, true)).toEqual({
      className: "min-w-0 flex-1 overflow-hidden whitespace-nowrap text-ellipsis note-marquee",
      style: { "--marquee": "80px" },
    });
    expect(rowNameStyle(200, 120, false).className).not.toContain("note-marquee");
    expect(rowNameStyle(122, 120, true).className).not.toContain("note-marquee");
    expect(rowNameStyle(100, 120, true).style).toEqual({});
  });
});

describe("paths", () => {
  it("slugs a note path for its attachments", () => {
    expect(slugFor("Design/Web pane retro.md")).toBe("web-pane-retro");
    expect(slugFor("T-012 Login card: 13\" screens.md")).toBe("t-012-login-card-13-screens");
  });
  it("picks a free file name for a new note", () => {
    const taken = new Set(["Tasks/Untitled.md", "Tasks/Untitled 2.md"]);
    expect(newNotePath("Tasks", "", taken)).toBe("Tasks/Untitled 3.md");
    expect(newNotePath("", "Web pane retro", new Set())).toBe("Web pane retro.md");
    expect(newNotePath("Design", "a/b", new Set())).toBe("Design/a-b.md");
  });
});

describe("the round log panel", () => {
  it("keeps the last lines and drops blank ones", () => {
    expect(tailLines("")).toEqual([]);
    expect(tailLines("\n\n   \n")).toEqual([]);
    expect(tailLines("one\n\ntwo  \nthree")).toEqual(["one", "two", "three"]);
    // the session re-sends the whole tail on every event, so the cap is what
    // keeps a long round from putting thousands of rows in the DOM
    const many = Array.from({ length: LOG_MAX_LINES + 50 }, (_, i) => `line ${i}`).join("\n");
    const kept = tailLines(many);
    expect(kept).toHaveLength(LOG_MAX_LINES);
    expect(kept[0]).toBe("line 50");
    expect(kept[kept.length - 1]).toBe(`line ${LOG_MAX_LINES + 49}`);
    expect(tailLines("a\nb\nc", 2)).toEqual(["b", "c"]);
  });

  it("sticks to the tail unless the reader has scrolled up", () => {
    //            scrollTop, scrollHeight, clientHeight
    expect(stickToBottom(760, 1000, 240)).toBe(true);          // pinned to the bottom
    expect(stickToBottom(760 - STICK_SLOP, 1000, 240)).toBe(true);  // rounding is not scrolling
    expect(stickToBottom(400, 1000, 240)).toBe(false);         // reading something further up
    expect(stickToBottom(0, 200, 240)).toBe(true);             // shorter than the box
  });

  it("names the phase in the header line", () => {
    expect(roundLogHeader("generating", 4, 0, 0)).toBe("Round 4 · writing the plan");
    expect(roundLogHeader("executing", 4, 2, 6)).toBe("Round 4 · executing · 2 of 6 done");
    expect(roundLogHeader("executing", 1, 0, 1)).toBe("Round 1 · executing · 0 of 1 done");
  });
});
