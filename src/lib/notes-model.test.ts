import { describe, expect, it } from "vitest";
import type { NoteEntry } from "./ipc";
import {
  backlinksFor, buildTree, endNewestRoundPlan, joinFrontMatter, nestTree, newNotePath,
  outlinksFor, pillFor, roundPhaseOf, roundPlanOutcome, roundSubline, sanitizeTitle,
  setStatusInFront, slugFor,
  splitFrontMatter, statusInFront, tagCounts, terminalRoundCommand,
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
  it("reads a block written with CRLF line endings", () => {
    const crlf = "---\r\nstatus: queued\r\n---\r\n\r\n# Title\r\n\r\nbody\r\n";
    const { front, body } = splitFrontMatter(crlf);
    expect(front).toBe("---\r\nstatus: queued\r\n---\r\n\r\n");
    expect(body).toBe("# Title\r\n\r\nbody\r\n");
    expect(statusInFront(front)).toBe("queued");
    expect(setStatusInFront(front, "done")).toBe("---\r\nstatus: done\r\n---\r\n\r\n");
    expect(setStatusInFront(front, null)).toBe("");
    expect(setStatusInFront("---\r\ntags: [ui]\r\n---\r\n\r\n", "queued"))
      .toBe("---\r\nstatus: queued\r\ntags: [ui]\r\n---\r\n\r\n");
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
  it("reduces free text to one safe path segment", () => {
    // the same sanitiser guards a note title AND a new folder's name
    expect(sanitizeTitle("Web pane retro")).toBe("Web pane retro");
    expect(sanitizeTitle("../../etc")).toBe("etc");
    expect(sanitizeTitle(".hidden")).toBe("hidden");
    expect(sanitizeTitle("a/b:c*d?")).toBe("a-b-c-d");
    expect(sanitizeTitle("   ")).toBe("");
  });
});

describe("the round card", () => {
  it("says the same thing on the card, with the route", () => {
    expect(roundSubline("generating", null, 0, 2)).toBe("2 notes · writing the plan…");
    expect(roundSubline("plan-ready", null, 0, 2)).toBe("2 notes · plan ready · not started");
    expect(roundSubline("executing", "pane", 1, 2)).toBe("2 notes · executing · 1 of 2 done · in the agent pane");
    expect(roundSubline("executing", "terminal", 0, 1)).toBe("1 note · executing · 0 of 1 done · in a terminal");
    expect(roundSubline("finished", null, 2, 2)).toBe("2 notes · done · 2 of 2");
    expect(roundSubline("failed", null, 0, 2)).toBe("2 notes · didn't finish · 0 of 2 done");
  });

  it("the terminal route quotes the run message for the shell", () => {
    const msg = "Read fixes/phase_3_fixes_prompt.md and run `git commit -m \"Close FX-3\"` when it's done";
    const cmd = terminalRoundCommand("claude", msg);
    expect(cmd.startsWith("claude '")).toBe(true);
    expect(cmd.endsWith("'\n")).toBe(true);
    expect(cmd).toContain("when it'\\''s done");
    expect(cmd).toContain('`git commit -m "Close FX-3"`');
    expect(terminalRoundCommand("codex", "x").startsWith("codex '")).toBe(true);
  });
});

describe("which phase a round is in", () => {
  const gen = { n: 3, state: "generating" };
  const ready = { n: 8, state: "ready" };

  it("has no phase without a record at all", () => {
    expect(roundPhaseOf([], null)).toBeNull();
  });

  it("keeps the last round readable until it is dismissed", () => {
    // the card and its log used to vanish the instant the final note ticked,
    // taking the run you had just watched with them
    const over = [{ n: 1, state: "done" }, { n: 2, state: "failed" }];
    expect(roundPhaseOf(over, null)).toEqual({ phase: "failed", n: 2 });
    expect(roundPhaseOf(over, null, 2)).toBeNull();
    expect(roundPhaseOf([{ n: 5, state: "done" }], null, 4)).toEqual({ phase: "finished", n: 5 });
    // a newer round always outranks a dismissed one
    expect(roundPhaseOf([{ n: 5, state: "done" }, { n: 6, state: "ready" }], null, 5))
      .toEqual({ phase: "plan-ready", n: 6 });
  });

  it("is generating while the plan is being written", () => {
    expect(roundPhaseOf([{ n: 1, state: "done" }, gen], null)).toEqual({ phase: "generating", n: 3 });
    // a plan being written wins over an older ready round
    expect(roundPhaseOf([ready, gen], { n: 8 })).toEqual({ phase: "generating", n: 3 });
  });

  it("separates a written plan from a running one by the mark, not the record", () => {
    // the bug: `ready` with a 22 KB plan on disk and nothing ever run read as
    // "executing · 0 of 2 done" and pointed at an executor log that never existed
    expect(roundPhaseOf([ready], null)).toEqual({ phase: "plan-ready", n: 8 });
    expect(roundPhaseOf([ready], { n: 8 })).toEqual({ phase: "executing", n: 8 });
  });

  it("counts the running mark as executing, for the round it names", () => {
    expect(roundPhaseOf([ready], { n: 8 })).toEqual({ phase: "executing", n: 8 });
    expect(roundPhaseOf([ready], { n: 7 })).toEqual({ phase: "plan-ready", n: 8 });
  });

  it("takes the newest round of its kind", () => {
    expect(roundPhaseOf([{ n: 2, state: "ready" }, { n: 9, state: "ready" }], null))
      .toEqual({ phase: "plan-ready", n: 9 });
  });
});

describe("how a planning turn settles", () => {
  it("a planning turn's outcome comes from the stop reason and the record", () => {
    expect(roundPlanOutcome("cancelled", "none")).toBe("cancelled");
    expect(roundPlanOutcome(null, "ready")).toBe("ready");
    expect(roundPlanOutcome("end_turn", "failed")).toBe("failed");
    expect(roundPlanOutcome("error", "none")).toBe("failed");
  });

  it("ends the newest un-ended plan card and leaves settled ones alone", () => {
    const entries = [
      { kind: "round-plan", ended: true, outcome: "ready" as const },
      { kind: "assistant" },
      { kind: "round-plan" },
    ];
    expect(endNewestRoundPlan(entries, "cancelled")).toBe(true);
    expect(entries[2]).toEqual({ kind: "round-plan", ended: true, outcome: "cancelled" });
    expect(entries[0]).toEqual({ kind: "round-plan", ended: true, outcome: "ready" });
    // nothing left open — a second pass must not touch the settled cards
    expect(endNewestRoundPlan(entries, "cancelled")).toBe(false);
    expect(endNewestRoundPlan([{ kind: "round" }], "cancelled")).toBe(false);
  });
});
