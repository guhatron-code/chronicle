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
import {
  Node,
  mergeAttributes,
  resolveExtensions,
  type AnyExtension,
  type JSONContent,
  type MarkdownToken,
} from "@tiptap/core";
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
