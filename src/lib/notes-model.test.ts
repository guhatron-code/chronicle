import { describe, expect, it } from "vitest";
import type { NoteEntry } from "./ipc";
import {
  backlinksFor, buildTree, joinFrontMatter, nestTree, newNotePath,
  outlinksFor, pillFor, roundLogHeader, roundPhaseOf, roundSubline, setStatusInFront, slugFor,
  splitFrontMatter, statusInFront, stickToBottom, tagCounts, tailLines, LOG_MAX_LINES, STICK_SLOP,
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

describe("nestTree", () => {
  it("hangs each node off the last one a level above it", () => {
    const tree = nestTree(buildTree(
      [note("a/b/deep.md"), note("a/top.md"), note("root.md")],
      new Set(),
    ));
    expect(tree.map((n) => [n.kind, n.name])).toEqual([["folder", "a"], ["note", "root"]]);
    expect(tree[0].children.map((n) => [n.kind, n.name])).toEqual([["note", "top"], ["folder", "b"]]);
    expect(tree[0].children[1].children.map((n) => n.name)).toEqual(["deep"]);
    expect(tree[1].children).toEqual([]);
  });
  it("gives a collapsed folder no children, because buildTree emitted none", () => {
    const tree = nestTree(buildTree([note("a/b/deep.md")], new Set(["a"])));
    expect(tree.map((n) => n.name)).toEqual(["a"]);
    expect(tree[0].children).toEqual([]);
  });
  it("keeps a flat list flat", () => {
    expect(nestTree(buildTree([note("one.md"), note("two.md")], new Set())).map((n) => n.name))
      .toEqual(["one", "two"]);
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
    expect(roundLogHeader("plan-ready", 8, 0, 2)).toBe("Round 8 · plan ready · not started");
    expect(roundLogHeader("executing", 4, 2, 6)).toBe("Round 4 · executing · 2 of 6 done");
    expect(roundLogHeader("executing", 1, 0, 1)).toBe("Round 1 · executing · 0 of 1 done");
  });

  it("says the same thing on the card, with the route", () => {
    expect(roundSubline("generating", null, 0, 2)).toBe("2 notes · writing the plan…");
    expect(roundSubline("plan-ready", null, 0, 2)).toBe("2 notes · plan ready · not started");
    expect(roundSubline("executing", "headless", 1, 2)).toBe("2 notes · executing · 1 of 2 done · headless");
    expect(roundSubline("executing", "agent", 0, 1)).toBe("1 note · executing · 0 of 1 done · in the agent pane");
  });
});

describe("which phase a round is in", () => {
  const gen = { n: 3, state: "generating" };
  const ready = { n: 8, state: "ready" };

  it("has no phase without a live record", () => {
    expect(roundPhaseOf([], false, null)).toBeNull();
    expect(roundPhaseOf([{ n: 1, state: "done" }, { n: 2, state: "failed" }], false, null)).toBeNull();
  });

  it("is generating while the plan is being written", () => {
    expect(roundPhaseOf([{ n: 1, state: "done" }, gen], false, null)).toEqual({ phase: "generating", n: 3 });
    // a plan being written wins over an older ready round
    expect(roundPhaseOf([ready, gen], true, null)).toEqual({ phase: "generating", n: 3 });
  });

  it("separates a written plan from a running one by the session, not the record", () => {
    // the bug: `ready` with a 22 KB plan on disk and nothing ever run read as
    // "executing · 0 of 2 done" and pointed at an executor log that never existed
    expect(roundPhaseOf([ready], false, null)).toEqual({ phase: "plan-ready", n: 8 });
    expect(roundPhaseOf([ready], true, null)).toEqual({ phase: "executing", n: 8 });
  });

  it("counts the agent-pane route as executing, for that round only", () => {
    expect(roundPhaseOf([ready], false, 8)).toEqual({ phase: "executing", n: 8 });
    expect(roundPhaseOf([ready], false, 7)).toEqual({ phase: "plan-ready", n: 8 });
  });

  it("takes the newest round of its kind", () => {
    expect(roundPhaseOf([{ n: 2, state: "ready" }, { n: 9, state: "ready" }], false, null))
      .toEqual({ phase: "plan-ready", n: 9 });
  });
});
