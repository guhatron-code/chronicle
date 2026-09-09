import { describe, expect, it } from "vitest";
import { tagAllowed, tagItems, wikiLinkItems } from "./items";
import type { NoteEntry } from "@/lib/ipc";

const note = (path: string, title: string, folder: string): NoteEntry => ({
  path, title, folder, status: null, round: null,
  tags: [], links: [], resolved: [], ambiguous: [],
  mtime: 0, size: 0, snippet: "", unreadable: false,
});

const NOTES = [
  note("Energy budget.md", "Energy budget", ""),
  note("Design/Web pane retro.md", "Web pane retro", "Design"),
];
const TAGS = [{ tag: "ui", count: 4 }, { tag: "ui/dark", count: 2 }, { tag: "bug", count: 1 }];

describe("tagItems", () => {
  it("shows the whole vault's tags for an empty query", () => {
    expect(tagItems(TAGS, "").map((t) => t.tag)).toEqual(["ui", "ui/dark", "bug"]);
  });

  it("filters by substring", () => {
    expect(tagItems(TAGS, "ui").map((t) => t.tag)).toEqual(["ui", "ui/dark"]);
  });

  it("offers a tag the vault has never seen — the menu is never empty while typing", () => {
    const rows = tagItems(TAGS, "idea");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ tag: "idea", count: 0, create: true });
  });

  it("keeps the new-tag row last, after the tags that do match", () => {
    const rows = tagItems(TAGS, "ui/");
    expect(rows.map((t) => t.tag)).toEqual(["ui/dark", "ui/"]);
    expect(rows[rows.length - 1].create).toBe(true);
  });

  it("does not offer a duplicate row for a tag that already exists", () => {
    expect(tagItems(TAGS, "bug")).toEqual([{ tag: "bug", count: 1 }]);
    expect(tagItems(TAGS, "BUG").some((t) => t.create)).toBe(false);
  });

  it("refuses a query that is not a legal tag", () => {
    expect(tagItems(TAGS, "no!")).toEqual([]);
  });
});

describe("tagAllowed", () => {
  it("stays silent for a bare # opening a block — that is a heading being typed", () => {
    expect(tagAllowed(0, "#")).toBe(false);
  });

  it("opens as soon as one character follows the # at the start of a line", () => {
    expect(tagAllowed(0, "#i")).toBe(true);
    expect(tagAllowed(0, "#idea")).toBe(true);
  });

  it("opens on the bare # anywhere else in the line", () => {
    expect(tagAllowed(2, "#")).toBe(true);
    expect(tagAllowed(2, "#idea")).toBe(true);
  });
});

describe("wikiLinkItems", () => {
  it("lists the vault for an empty query", () => {
    expect(wikiLinkItems(NOTES, "").map((n) => n.title)).toEqual(["Energy budget", "Web pane retro"]);
  });

  it("appends a create row for a title the vault does not hold", () => {
    const rows = wikiLinkItems(NOTES, "Dark toasts");
    expect(rows[rows.length - 1]).toEqual({ path: "", title: "Dark toasts", folder: "new note", create: true });
  });

  it("does not append a create row when the title already exists", () => {
    expect(wikiLinkItems(NOTES, "Energy budget").some((n) => n.create)).toBe(false);
  });
});
