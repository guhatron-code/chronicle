/*
 * The two things markdown does not have and a note vault needs: `[[wikilinks]]`
 * and inline `#tags`. Both are inline atoms with a custom marked tokenizer and a
 * renderer, so they survive a full markdown → editor → markdown round trip.
 *
 * This module deliberately imports no React and no browser API: the round-trip
 * tests run in vitest's node environment against MarkdownManager, which is the
 * same code path the live editor uses.
 */
import { Markdown, MarkdownManager } from "@tiptap/markdown";
import { Node, mergeAttributes, resolveExtensions, type AnyExtension, type JSONContent, type MarkdownToken, Extension } from "@tiptap/core";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import Image from "@tiptap/extension-image";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import Typography from "@tiptap/extension-typography";
import StarterKit from "@tiptap/starter-kit";
import { all, createLowlight } from "lowlight";

/** `[[Target]]`, `[[folder/Target]]`, `[[Target|shown text]]`. */
export const WikiLink = Node.create({
  name: "wikiLink",
  group: "inline",
  inline: true,
  atom: true,
  addAttributes() {
    return { target: { default: "" }, label: { default: null as string | null } };
  },
  parseHTML() {
    return [{ tag: "span[data-wikilink]" }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-wikilink": node.attrs.target as string,
        class: "wikilink",
      }),
      (node.attrs.label as string | null) ?? (node.attrs.target as string),
    ];
  },
  markdownTokenName: "wikiLink",
  markdownTokenizer: {
    name: "wikiLink",
    level: "inline",
    start: (src: string) => src.indexOf("[["),
    tokenize(src: string) {
      const m = /^\[\[([^\]|\n]+)(?:\|([^\]\n]+))?\]\]/.exec(src);
      if (!m) return;
      return { type: "wikiLink", raw: m[0], target: m[1].trim(), label: m[2]?.trim() ?? null };
    },
  },
  parseMarkdown(token: MarkdownToken) {
    return {
      type: "wikiLink",
      attrs: {
        target: String(token.target ?? ""),
        label: (token.label as string | null | undefined) ?? null,
      },
    };
  },
  renderMarkdown(node: JSONContent) {
    const target = String(node.attrs?.target ?? "");
    const label = node.attrs?.label as string | null | undefined;
    return label ? `[[${target}|${label}]]` : `[[${target}]]`;
  },
});

/** `#tag` — letters, digits, `_`, `/`, `-`. Never inside code; `# ` is a heading. */
export const Tag = Node.create({
  name: "tag",
  group: "inline",
  inline: true,
  atom: true,
  addAttributes() {
    return { name: { default: "" } };
  },
  parseHTML() {
    return [{ tag: "span[data-tag]" }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-tag": node.attrs.name as string,
        class: "note-tag",
      }),
      `#${node.attrs.name as string}`,
    ];
  },
  markdownTokenName: "tag",
  markdownTokenizer: {
    name: "tag",
    level: "inline",
    start: (src: string) => src.indexOf("#"),
    tokenize(src: string) {
      const m = /^#([A-Za-z0-9_/-]+)/.exec(src);
      if (!m) return;
      return { type: "tag", raw: m[0], name: m[1] };
    },
  },
  parseMarkdown(token: MarkdownToken) {
    return { type: "tag", attrs: { name: String(token.name ?? "") } };
  },
  renderMarkdown(node: JSONContent) {
    return `#${String(node.attrs?.name ?? "")}`;
  },
});

const lowlight = createLowlight(all);

/** The length, in UTF-16 code units, of the last grapheme of `text` — so a
 *  delete never splits an emoji or a combining mark. */
export function lastGraphemeLength(text: string): number {
  if (!text) return 0;
  const Seg = (globalThis as { Intl?: { Segmenter?: new (l?: string, o?: { granularity: string }) => { segment(s: string): Iterable<{ segment: string }> } } }).Intl?.Segmenter;
  if (Seg) {
    let last = "";
    for (const g of new Seg(undefined, { granularity: "grapheme" }).segment(text)) last = g.segment;
    return last.length;
  }
  const cps = Array.from(text);
  return cps[cps.length - 1]?.length ?? 1;
}

/** WKWebView refuses to perform a native character delete inside a
 *  <blockquote> in a contenteditable (typing works, Backspace/Delete do
 *  nothing), while every ProseMirror-handled case — lifting the quote at its
 *  start, undoing the `> ` input rule — works. ProseMirror only takes over at
 *  block boundaries and before non-text nodes, so the plain "one character
 *  before the caret" case reaches the browser and dies there. This keymap
 *  does that one case itself whenever the caret sits inside a blockquote and
 *  otherwise stays out of the way (returns false → the normal chain runs). */
export const QuoteDelete = Extension.create({
  name: "quoteDelete",
  priority: 1001, // before the core keymap
  addKeyboardShortcuts() {
    const inQuote = (state: { selection: { $from: { depth: number; node(d: number): { type: { name: string } } } } }) => {
      const { $from } = state.selection;
      for (let d = $from.depth; d > 0; d--) if ($from.node(d).type.name === "blockquote") return true;
      return false;
    };
    return {
      Backspace: ({ editor }) => {
        const { state } = editor;
        const { empty, $from } = state.selection;
        if (!empty || !$from.parent.isTextblock || $from.parentOffset === 0 || !inQuote(state)) return false;
        const before = $from.nodeBefore;
        if (!before || !before.isText) return false;
        const n = lastGraphemeLength(before.text ?? "");
        if (n === 0) return false;
        return editor.commands.command(({ tr }) => { tr.delete($from.pos - n, $from.pos); return true; });
      },
      Delete: ({ editor }) => {
        const { state } = editor;
        const { empty, $from } = state.selection;
        if (!empty || !$from.parent.isTextblock || $from.parentOffset >= $from.parent.content.size || !inQuote(state)) return false;
        const after = $from.nodeAfter;
        if (!after || !after.isText) return false;
        const text = after.text ?? "";
        const Seg = (globalThis as { Intl?: { Segmenter?: new (l?: string, o?: { granularity: string }) => { segment(s: string): Iterable<{ segment: string }> } } }).Intl?.Segmenter;
        let n = 1;
        if (Seg) { for (const g of new Seg(undefined, { granularity: "grapheme" }).segment(text)) { n = g.segment.length; break; } }
        else n = Array.from(text)[0]?.length ?? 1;
        return editor.commands.command(({ tr }) => { tr.delete($from.pos, $from.pos + n); return true; });
      },
    };
  },
});

/** The exact extension set the pane's editor runs — and the tests measure. */
export const NOTE_EXTENSIONS: AnyExtension[] = [
  StarterKit.configure({ codeBlock: false }),
  Typography,
  CodeBlockLowlight.configure({ lowlight }),
  Image,
  Table.configure({ resizable: false }),
  TableRow,
  TableCell,
  TableHeader,
  TaskList,
  // The live editor draws task items through a node view that sets only
  // data-checked plus these attributes — `data-type` exists only in static
  // HTML — so the row styles hang off this class, not the attribute.
  TaskItem.configure({ nested: true, HTMLAttributes: { class: "note-task" } }),
  WikiLink,
  Tag,
  QuoteDelete,
  Markdown,
];

/** One manager for the pure conversions — the live editor builds its own. */
const manager = new MarkdownManager({
  extensions: resolveExtensions(NOTE_EXTENSIONS),
  indentation: { style: "space", size: 2 },
});

/*
 * MarkdownManager.serialize() returns the document without a trailing newline.
 * A note on disk ends with one, so without this every open-and-save would
 * rewrite the file just to drop the last byte. Empty stays empty.
 */
export function finishMarkdown(md: string): string {
  const body = md.replace(/\n+$/, "");
  return body === "" ? "" : `${body}\n`;
}

export function markdownToJSON(md: string): JSONContent {
  return manager.parse(md);
}
export function jsonToMarkdown(json: JSONContent): string {
  return finishMarkdown(manager.serialize(json));
}
