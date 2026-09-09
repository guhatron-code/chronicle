import { describe, expect, it } from "vitest";
import { jsonToMarkdown, markdownToJSON } from "./nodes";

const roundTrip = (md: string) => jsonToMarkdown(markdownToJSON(md));

describe("markdown round trip", () => {
  it("keeps every block the pane supports", () => {
    const md = [
      "# Heading one",
      "",
      "## Heading two",
      "",
      "A paragraph with **bold**, *italic*, `code` and a [repo link](../../src/App.tsx).",
      "",
      "- bullet one",
      "- bullet two",
      "",
      "1. ordered one",
      "2. ordered two",
      "",
      "- [ ] a task",
      "- [x] a done task",
      "",
      "> a quote",
      "",
      "```ts",
      "const a = 1;",
      "```",
      "",
      "![](../attachments/shot-1.png)",
      "",
      "---",
      "",
    ].join("\n");
    const out = roundTrip(md);
    for (const line of ["# Heading one", "## Heading two", "- bullet one", "1. ordered one",
                        "- [ ] a task", "- [x] a done task", "> a quote", "```ts", "const a = 1;",
                        "![](../attachments/shot-1.png)", "---",
                        "**bold**", "*italic*", "`code`", "[repo link](../../src/App.tsx)"]) {
      expect(out).toContain(line);
    }
  });

  it("is a fixed point — a second pass changes nothing", () => {
    const md = "# T\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n- [ ] x\n";
    const once = roundTrip(md);
    expect(roundTrip(once)).toBe(once);
  });

  it("keeps all three wikilink forms", () => {
    const md = "See [[Energy budget]], [[Design/Web pane retro|the retro]] and [[Tasks/Dark toasts]].\n";
    expect(roundTrip(md)).toBe(md);
    const json = markdownToJSON(md);
    const para = json.content?.[0]?.content ?? [];
    const links = para.filter((n) => n.type === "wikiLink");
    expect(links).toHaveLength(3);
    expect(links[0].attrs).toEqual({ target: "Energy budget", label: null });
    expect(links[1].attrs).toEqual({ target: "Design/Web pane retro", label: "the retro" });
  });

  it("keeps inline tags, and does not eat headings or code", () => {
    const md = "# Heading is not a tag\n\nA #bug and a #ui/dark one, `#nope` in code.\n\n```\n#alsonope\n```\n";
    expect(roundTrip(md)).toBe(md);
    const json = markdownToJSON(md);
    const tags = (json.content?.[1]?.content ?? []).filter((n) => n.type === "tag");
    expect(tags.map((t) => t.attrs?.name)).toEqual(["bug", "ui/dark"]);
  });

  it("survives a note with nothing in it", () => {
    expect(roundTrip("")).toBe("");
  });

  /* Ticking the box in the editor sets the taskItem's `checked` attribute —
     which is what TipTap renders as `data-checked="true"` and what index.css
     strikes through. The buffer that reaches the file has to say `[x]`, or the
     tick would vanish on the next open. */
  it("serialises a checked task item as [x] and an unchecked one as [ ]", () => {
    expect(markdownToJSON("- [x] a done task\n").content?.[0]?.content?.[0]?.attrs?.checked).toBe(true);
    const md = jsonToMarkdown({
      type: "doc",
      content: [{
        type: "taskList",
        content: [
          { type: "taskItem", attrs: { checked: true }, content: [{ type: "paragraph", content: [{ type: "text", text: "ticked" }] }] },
          { type: "taskItem", attrs: { checked: false }, content: [{ type: "paragraph", content: [{ type: "text", text: "open" }] }] },
        ],
      }],
    });
    expect(md).toContain("- [x] ticked");
    expect(md).toContain("- [ ] open");
  });
});
