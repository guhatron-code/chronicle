// The Notes editor's task list (`- [ ] …`) renders TipTap's default DOM:
// <ul data-type="taskList"><li data-type="taskItem"><label><input/></label><div><p/></div></li></ul>.
// The pane styles every ul as a disc list and stacks the label over the div
// unless the stylesheet lays the item out as a row — the bug in the 2026-09-10
// screenshot (bullet + checkbox on its own line, text underneath). The rules
// live in index.css; this pins that they exist and say the right thing
// (component rendering is verified in the running window, per vitest.config).
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const css = readFileSync(path.resolve(__dirname, "../../../index.css"), "utf8");
const rule = (selector: string): string => {
  const i = css.indexOf(selector);
  if (i < 0) return "";
  return css.slice(i, css.indexOf("}", i));
};

describe("task list layout rules (index.css)", () => {
  it("a task list carries no bullet and no list indent", () => {
    const r = rule('.note-doc ul[data-type="taskList"]');
    expect(r).toContain("list-style: none");
    expect(r).toMatch(/margin-left: 0|padding-left: 0/);
  });
  it("a task item is a row: checkbox beside the text, text fills the rest", () => {
    const r = rule('.note-doc li[data-type="taskItem"]');
    expect(r).toContain("display: flex");
    expect(r).toContain("align-items: flex-start");
    expect(rule('.note-doc li[data-type="taskItem"] > div')).toContain("flex: 1");
  });
  it("the paragraph inside a task item keeps no paragraph margin", () => {
    expect(rule('.note-doc li[data-type="taskItem"] p')).toContain("margin-bottom: 0");
  });
});
