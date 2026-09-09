import { describe, expect, it } from "vitest";
import type { NoteEntry } from "./ipc";
import {
  backlinksFor, buildTree, joinFrontMatter, marqueeDistance, needsMarquee, newNotePath,
  outlinksFor, pillFor, rowNameStyle, setStatusInFront, slugFor, splitFrontMatter, statusInFront, tagCounts,
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
