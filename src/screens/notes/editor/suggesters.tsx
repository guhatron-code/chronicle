/*
 * `[[` and `#` inside a note. Multi-character `char` is supported —
 * @tiptap/suggestion slices the query by `char.length` (node_modules/@tiptap/
 * suggestion/dist/index.js:48) — so `[[` needs no special handling.
 */
import { Extension, type Editor, type Range } from "@tiptap/core";
import { defaultSlashSuggestions, type SuggestionItem } from "@/components/kibo-ui/editor";
import Suggestion, { type SuggestionKeyDownProps, type SuggestionProps } from "@tiptap/suggestion";
import { ReactRenderer } from "@tiptap/react";
import { PluginKey } from "@tiptap/pm/state";
import tippy, { type Instance as TippyInstance } from "tippy.js";
import Fuse from "fuse.js";
import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import type { NoteEntry } from "@/lib/ipc";

export interface NoteSuggestion { path: string; title: string; folder: string; create?: boolean }
export interface TagSuggestion { tag: string; count: number }

/** Fuzzy over titles and folders; "Create …" is always the last row. */
export function wikiLinkItems(notes: NoteEntry[], query: string): NoteSuggestion[] {
  const rows: NoteSuggestion[] = notes.map((n) => ({ path: n.path, title: n.title, folder: n.folder }));
  const q = query.trim();
  if (!q) return rows.slice(0, 8);
  const fuse = new Fuse(rows, { keys: ["title", "folder"], threshold: 0.35, minMatchCharLength: 1 });
  const hits = fuse.search(q).map((r) => r.item).slice(0, 8);
  if (!hits.some((h) => h.title.toLowerCase() === q.toLowerCase())) {
    hits.push({ path: "", title: q, folder: "new note", create: true });
  }
  return hits;
}

export function tagItems(tags: TagSuggestion[], query: string): TagSuggestion[] {
  const q = query.trim().toLowerCase();
  return tags.filter((t) => !q || t.tag.toLowerCase().includes(q)).slice(0, 10);
}

/* ---------- the shared popup ---------- */

interface MenuProps<T> {
  items: T[];
  command: (item: T) => void;
  label: (item: T) => string;
  hint: (item: T) => string;
  heading: string;
}
interface MenuHandle { onKeyDown: (p: { event: KeyboardEvent }) => boolean }

const Menu = forwardRef<MenuHandle, MenuProps<unknown>>((p, ref) => {
  const [i, setI] = useState(0);
  useEffect(() => setI(0), [p.items]);
  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (p.items.length === 0) return false;
      if (event.key === "ArrowUp") { setI((n) => (n + p.items.length - 1) % p.items.length); return true; }
      if (event.key === "ArrowDown") { setI((n) => (n + 1) % p.items.length); return true; }
      if (event.key === "Enter") { const it = p.items[i]; if (it) p.command(it); return true; }
      return false;
    },
  }), [p, i]);
  if (p.items.length === 0) return null;
  return (
    <div className="w-[340px] rounded-lg border border-border-strong bg-surface-overlay p-1.5 [box-shadow:var(--shadow-overlay)]">
      <div className="px-2 pb-1 pt-0.5 text-[10px] uppercase tracking-[0.09em] text-text-dimmer">{p.heading}</div>
      {p.items.map((item, n) => (
        <button
          type="button"
          key={n}
          onMouseEnter={() => setI(n)}
          onClick={() => p.command(item)}
          className={`flex h-[26px] w-full items-center gap-2 rounded-md px-2 text-left text-[12px] ${n === i ? "bg-fill-hover text-text-primary" : "text-text-secondary"}`}
        >
          <span className="min-w-0 flex-1 truncate">{p.label(item)}</span>
          <span className="shrink-0 font-mono text-[10.5px] text-text-dim">{p.hint(item)}</span>
        </button>
      ))}
    </div>
  );
});
Menu.displayName = "SuggestMenu";

/** The render() half every suggester shares — identical to the vendored slash menu's. */
function popup<T>(cfg: Omit<MenuProps<T>, "items" | "command">) {
  return () => {
    let component: ReactRenderer<MenuHandle> | null = null;
    let instance: TippyInstance | null = null;
    return {
      onStart: (props: SuggestionProps<T, T>) => {
        component = new ReactRenderer(Menu as never, {
          props: { items: props.items, command: props.command, ...cfg },
          editor: props.editor,
        });
        instance = tippy(document.body, {
          getReferenceClientRect: () => props.clientRect?.() || new DOMRect(),
          appendTo: () => document.body,
          content: component.element,
          showOnCreate: true,
          interactive: true,
          trigger: "manual",
          placement: "bottom-start",
        });
      },
      onUpdate: (props: SuggestionProps<T, T>) => {
        component?.updateProps({ items: props.items, command: props.command, ...cfg });
        instance?.setProps({ getReferenceClientRect: () => props.clientRect?.() || new DOMRect() });
      },
      onKeyDown: (props: SuggestionKeyDownProps) => {
        if (props.event.key === "Escape") { instance?.hide(); return true; }
        return component?.ref?.onKeyDown(props) ?? false;
      },
      onExit: () => { instance?.destroy(); component?.destroy(); instance = null; component = null; },
    };
  };
}

const wikiKey = new PluginKey("wikiLinkSuggest");
const tagKey = new PluginKey("tagSuggest");
const slashKey = new PluginKey("noteSlash");

/* ---------- `/` — the vendored kit's rows plus the two a vault adds ---------- */

interface SlashRow {
  title: string;
  hint: string;
  terms: string[];
  command: (p: { editor: Editor; range: Range }) => void;
}

/** The kit's rows carry an icon and a sentence; a note row carries a short hint. */
const fromKit = (i: SuggestionItem): SlashRow =>
  ({ title: i.title, hint: "", terms: [i.description, ...i.searchTerms], command: i.command });

export function slashSuggest(opts: { onPickImage: () => void }): Extension {
  return Extension.create({
    name: "noteSlash",
    addProseMirrorPlugins() {
      return [Suggestion<SlashRow, SlashRow>({
        editor: this.editor,
        char: "/",
        pluginKey: slashKey,
        items: async ({ editor, query }) => {
          const kit = (await defaultSlashSuggestions?.({ editor, query, signal: new AbortController().signal })) ?? [];
          const rows: SlashRow[] = [
            ...kit.map(fromKit),
            {
              title: "Image",
              hint: "paste / drop",
              terms: ["image", "picture", "screenshot", "attachment", "paste", "drop"],
              command: ({ editor: ed, range }) => {
                ed.chain().focus().deleteRange(range).run();
                opts.onPickImage();
              },
            },
            {
              title: "Link to note",
              hint: "[[",
              terms: ["link", "wikilink", "note", "backlink"],
              // hand the caret to the `[[` suggester rather than duplicating it
              command: ({ editor: ed, range }) =>
                ed.chain().focus().deleteRange(range).insertContent("[[").run(),
            },
          ];
          if (!query) return rows;
          const fuse = new Fuse(rows, { keys: ["title", "terms"], threshold: 0.2, minMatchCharLength: 1 });
          return fuse.search(query).map((r) => r.item);
        },
        command: ({ editor, range, props }) => props.command({ editor, range }),
        render: popup<SlashRow>({
          heading: "Insert · ↑↓ then ⏎",
          label: (i) => i.title,
          hint: (i) => i.hint,
        }),
      })];
    },
  });
}

export function wikiLinkSuggest(opts: {
  notes: () => NoteEntry[];
  onCreate: (title: string, folder: string) => Promise<string>;
  folder: () => string;
}): Extension {
  return Extension.create({
    name: "wikiLinkSuggest",
    addProseMirrorPlugins() {
      return [Suggestion<NoteSuggestion, NoteSuggestion>({
        editor: this.editor,
        char: "[[",
        pluginKey: wikiKey,
        allowSpaces: true,
        items: ({ query }) => wikiLinkItems(opts.notes(), query),
        command: ({ editor, range, props }) => {
          const insert = (target: string) =>
            editor.chain().focus().deleteRange(range)
              .insertContent({ type: "wikiLink", attrs: { target, label: null } })
              .run();
          if (!props.create) { insert(props.title); return; }
          // a missing link creates the note in THIS note's folder (spec)
          void opts.onCreate(props.title, opts.folder()).then(() => insert(props.title));
        },
        render: popup<NoteSuggestion>({
          heading: "Link to a note · ↑↓ then ⏎",
          label: (i) => (i.create ? `Create "${i.title}"` : i.title),
          hint: (i) => (i.create ? "new note" : i.folder || "vault"),
        }),
      })];
    },
  });
}

export function tagSuggest(tags: () => TagSuggestion[]): Extension {
  return Extension.create({
    name: "tagSuggest",
    addProseMirrorPlugins() {
      return [Suggestion<TagSuggestion, TagSuggestion>({
        editor: this.editor,
        char: "#",
        pluginKey: tagKey,
        // `# ` at the start of a line is a heading, never a tag: a bare `#`
        // opening its block stays silent, but `#b` there is already a tag.
        allow: ({ state, range }) =>
          state.doc.resolve(range.from).parentOffset > 0
          || state.doc.textBetween(range.from, range.to).length > 1,
        items: ({ query }) => tagItems(tags(), query),
        command: ({ editor, range, props }) =>
          editor.chain().focus().deleteRange(range)
            .insertContent({ type: "tag", attrs: { name: props.tag } }).run(),
        render: popup<TagSuggestion>({
          heading: "Tag · ↑↓ then ⏎",
          label: (i) => `#${i.tag}`,
          hint: (i) => String(i.count),
        }),
      })];
    },
  });
}
