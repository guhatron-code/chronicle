/*
 * The terminal takes the keyboard back — but never out of a field someone is
 * typing in. `shouldReclaimTerminalFocus` is the whole judgement, kept pure so
 * it can be argued with here rather than in a running window.
 *
 * No jsdom: vitest.config runs this suite in the `node` environment and the
 * repo has no DOM package (adding one was out of scope for this change), so the
 * predicate reads a narrow `FocusTarget` slice of Element — `tagName`,
 * `getAttribute`, `isContentEditable`, `parentElement` — that a real
 * `document.activeElement` satisfies structurally and the chains below model
 * exactly. TypeScript checks the fakes against that interface, so a fake that
 * drifts from an Element fails `npm run typecheck`.
 */
import { describe, expect, it } from "vitest";
import { shouldReclaimTerminalFocus, type FocusTarget } from "./term-sessions";

function el(
  tag: string,
  opts: {
    class?: string;
    attrs?: Record<string, string>;
    contentEditable?: boolean;
    parent?: FocusTarget | null;
  } = {},
): FocusTarget {
  const attrs: Record<string, string> = { ...(opts.attrs ?? {}) };
  if (opts.class) attrs.class = opts.class;
  return {
    tagName: tag.toUpperCase(),
    getAttribute: (name: string) => (name in attrs ? attrs[name] : null),
    isContentEditable: opts.contentEditable ?? false,
    parentElement: opts.parent ?? null,
  };
}

/** The ordinary chrome an app has focused most of the time. */
const body = el("body");
const open = { collapsed: false };

describe("shouldReclaimTerminalFocus", () => {
  it("never reclaims while the column is collapsed", () => {
    for (const active of [null, body, el("button", { parent: body })]) {
      expect(shouldReclaimTerminalFocus(active, { collapsed: true })).toBe(false);
    }
  });

  it("reclaims when nothing, or nothing typeable, has the keyboard", () => {
    expect(shouldReclaimTerminalFocus(null, open)).toBe(true);
    expect(shouldReclaimTerminalFocus(body, open)).toBe(true);
    expect(shouldReclaimTerminalFocus(el("button", { parent: body }), open)).toBe(true);
    expect(shouldReclaimTerminalFocus(el("div", { parent: body }), open)).toBe(true);
    expect(shouldReclaimTerminalFocus(el("a", { attrs: { href: "#" }, parent: body }), open)).toBe(true);
  });

  it("leaves a text input alone", () => {
    expect(shouldReclaimTerminalFocus(el("input", { parent: body }), open)).toBe(false);
    for (const type of ["text", "search", "email", "password", "number", "url"]) {
      expect(shouldReclaimTerminalFocus(el("input", { attrs: { type }, parent: body }), open)).toBe(false);
    }
  });

  it("treats a clicky input as chrome, not as a field", () => {
    for (const type of ["button", "submit", "checkbox", "radio"]) {
      expect(shouldReclaimTerminalFocus(el("input", { attrs: { type }, parent: body }), open)).toBe(true);
    }
    // the type attribute is case-insensitive in HTML
    expect(shouldReclaimTerminalFocus(el("input", { attrs: { type: "CHECKBOX" }, parent: body }), open)).toBe(true);
  });

  it("leaves a textarea or a select alone", () => {
    expect(shouldReclaimTerminalFocus(el("textarea", { parent: body }), open)).toBe(false);
    expect(shouldReclaimTerminalFocus(el("select", { parent: body }), open)).toBe(false);
  });

  it("leaves a contenteditable alone, by the flag or by the attribute", () => {
    expect(shouldReclaimTerminalFocus(el("div", { contentEditable: true, parent: body }), open)).toBe(false);
    expect(
      shouldReclaimTerminalFocus(el("div", { attrs: { contenteditable: "" }, parent: body }), open),
    ).toBe(false);
    expect(
      shouldReclaimTerminalFocus(el("div", { attrs: { contenteditable: "true" }, parent: body }), open),
    ).toBe(false);
    // contenteditable="false" is an opt-out, not an editor
    expect(
      shouldReclaimTerminalFocus(el("div", { attrs: { contenteditable: "false" }, parent: body }), open),
    ).toBe(true);
  });

  it("looks up the ancestor chain, not just at the focused node", () => {
    const editor = el("div", { attrs: { contenteditable: "true" }, parent: body });
    const para = el("p", { parent: editor });
    const span = el("span", { parent: para });
    expect(shouldReclaimTerminalFocus(span, open)).toBe(false);
  });

  it("leaves the editors that own their own keyboard alone", () => {
    for (const cls of ["cm-editor", "ProseMirror", "tiptap"]) {
      const host = el("div", { class: `relative ${cls} flex`, parent: body });
      const inner = el("div", { parent: host });
      expect(shouldReclaimTerminalFocus(inner, open)).toBe(false);
      expect(shouldReclaimTerminalFocus(host, open)).toBe(false);
    }
    // a class that merely contains the name is not that editor
    const decoy = el("div", { class: "cm-editor-shell", parent: body });
    expect(shouldReclaimTerminalFocus(decoy, open)).toBe(true);
  });

  it("leaves a dialog alone — it traps focus on purpose", () => {
    const dialog = el("div", { attrs: { role: "dialog" }, parent: body });
    const button = el("button", { parent: dialog });
    expect(shouldReclaimTerminalFocus(dialog, open)).toBe(false);
    expect(shouldReclaimTerminalFocus(button, open)).toBe(false);
  });

  it("leaves a terminal that already has the keyboard alone", () => {
    const screen = el("div", { class: "xterm", parent: body });
    const helper = el("textarea", { class: "xterm-helper-textarea", parent: screen });
    expect(shouldReclaimTerminalFocus(helper, open)).toBe(false);
  });

  it("walks the whole chain — a deep tree must not truncate the search", () => {
    // the notes editor nests lists; a focused leaf can sit dozens of levels
    // under .ProseMirror, and a depth cap there would steal the keyboard mid-word
    let plain = el("div", { parent: body });
    for (let i = 0; i < 500; i += 1) plain = el("div", { parent: plain });
    expect(shouldReclaimTerminalFocus(plain, open)).toBe(true);

    let deep: FocusTarget = el("div", { class: "ProseMirror", parent: body });
    for (let i = 0; i < 500; i += 1) deep = el("li", { parent: deep });
    expect(shouldReclaimTerminalFocus(deep, open)).toBe(false);
  });
});
