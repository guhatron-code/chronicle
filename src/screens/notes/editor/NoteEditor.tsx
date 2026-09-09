/*
 * The note editor. The vendored Tiptap kit supplies the chrome (slash menu,
 * bubble menu, code highlighting); this adds the four things a vault needs:
 * markdown in and out, the `[[` and `#` suggesters, images that land in
 * .chronicle/attachments through notes_attach, and click routing for the three
 * kinds of link a note can hold.
 *
 * Images: markdown carries `../attachments/x.png`, which no webview can load.
 * The body is rewritten to data: URIs on the way in and back to the relative
 * form on the way out, so what reaches notes_write is always the file's text.
 */
import { EditorContent, useEditor } from "@tiptap/react";
import type { Editor } from "@tiptap/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { notesAttach, type NoteEntry } from "@/lib/ipc";
import { cachedImageSrc, noteImageSrc, setCaretLinkResolver } from "@/lib/notes-store";
import { slugFor, tagCounts } from "@/lib/notes-model";
import { NOTE_EXTENSIONS, finishMarkdown } from "./nodes";
import { slashSuggest, tagSuggest, wikiLinkSuggest } from "./suggesters";

const REF = /!\[([^\]]*)\]\((\.\.\/attachments\/[^)\s]+)\)/g;

/** `![](../attachments/x.png)` → `![](data:…)` for everything already cached. */
function toDisplay(md: string, dir: string): string {
  return md.replace(REF, (whole, alt: string, ref: string) => {
    const src = cachedImageSrc(dir, ref);
    return src ? `![${alt}](${src})` : whole;
  });
}
/** …and back, so the file never holds a data: URI. */
function toFile(md: string, srcToRef: Map<string, string>): string {
  return md.replace(/!\[([^\]]*)\]\((data:[^)\s]+)\)/g, (whole, alt: string, src: string) => {
    const ref = srcToRef.get(src);
    return ref ? `![${alt}](${ref})` : whole;
  });
}

export function NoteEditor({
  dir, path, body, readOnly, notes, onChange, onBlur, onOpenNote, onCreateNote, onOpenFile, onOpenUrl,
}: {
  dir: string; path: string; body: string; readOnly: boolean; notes: NoteEntry[];
  onChange: (body: string) => void; onBlur: () => void;
  onOpenNote: (p: string) => void;
  onCreateNote: (title: string, folder: string) => Promise<string>;
  onOpenFile: (p: string) => void; onOpenUrl: (url: string) => void;
}) {
  /* useEditor only re-reads its options when the deps change, so every callback
   * the editor holds has to reach the caller through a ref — otherwise the
   * editor created for note A keeps calling note A's onChange forever. */
  const notesRef = useRef(notes); notesRef.current = notes;
  const pathRef = useRef(path); pathRef.current = path;
  const cb = useRef({ onChange, onBlur, onOpenNote, onCreateNote, onOpenFile, onOpenUrl });
  cb.current = { onChange, onBlur, onOpenNote, onCreateNote, onOpenFile, onOpenUrl };

  const [srcToRef] = useState(() => new Map<string, string>());
  const folder = useMemo(() => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : ""), [path]);
  const folderRef = useRef(folder); folderRef.current = folder;
  const editorRef = useRef<Editor | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);

  /* every attachment the body names is fetched once, then the body is re-set */
  const [imagesReady, setImagesReady] = useState(0);
  useEffect(() => {
    const refs = [...body.matchAll(REF)].map((m) => m[2]);
    const missing = refs.filter((r) => !cachedImageSrc(dir, r));
    if (missing.length === 0) return;
    let live = true;
    void Promise.all(missing.map((r) => noteImageSrc(dir, r).then((src) => { if (src) srcToRef.set(src, r); })))
      .then(() => { if (live) setImagesReady((n) => n + 1); });
    return () => { live = false; };
  }, [body, dir, srcToRef]);

  /** Images land in .chronicle/attachments and come straight back as a data URI. */
  const handleFiles = useCallback((files: FileList | null | undefined): boolean => {
    const images = [...(files ?? [])].filter((f) => f.type.startsWith("image/"));
    const editor = editorRef.current;
    if (images.length === 0 || !editor) return false;
    void (async () => {
      for (const file of images) {
        const buf = new Uint8Array(await file.arrayBuffer());
        let bin = ""; for (const b of buf) bin += String.fromCharCode(b);
        const ref = await notesAttach(dir, slugFor(pathRef.current), file.name, btoa(bin));
        const src = await noteImageSrc(dir, ref);
        if (src) { srcToRef.set(src, ref); editor.chain().focus().setImage({ src }).run(); }
      }
    })();
    return true; // handled: never let ProseMirror paste the raw file
  }, [dir, srcToRef]);
  const filesRef = useRef(handleFiles); filesRef.current = handleFiles;

  /* Rebuilt only when the folder changes — the memo feeds useEditor's deps, so
   * anything less stable would tear the editor down on every render. */
  const suggesters = useMemo(() => [
    wikiLinkSuggest({
      notes: () => notesRef.current,
      onCreate: (title, f) => cb.current.onCreateNote(title, f),
      folder: () => folderRef.current,
    }),
    tagSuggest(() => tagCounts(notesRef.current)),
    slashSuggest({ onPickImage: () => fileInput.current?.click() }),
  ], []);

  const editor = useEditor({
    extensions: [...NOTE_EXTENSIONS, ...suggesters],
    content: toDisplay(body, dir),
    contentType: "markdown",
    editable: !readOnly,
    immediatelyRender: false,
    onUpdate: ({ editor: ed }) => cb.current.onChange(finishMarkdown(toFile(ed.getMarkdown(), srcToRef))),
    onBlur: () => cb.current.onBlur(),
    editorProps: {
      handlePaste: (_view, event) => filesRef.current(event.clipboardData?.files),
      handleDrop: (_view, event) => filesRef.current((event as DragEvent).dataTransfer?.files),
      handleClickOn: (_view, _pos, node, _np, event) => {
        if (node.type.name === "wikiLink") {
          const target = String(node.attrs.target);
          const entry = notesRef.current.find((n) => n.path === pathRef.current);
          const i = entry?.links.findIndex((l) => l.target === target) ?? -1;
          const resolved = i >= 0 ? entry?.resolved[i] ?? null : null;
          if (resolved) cb.current.onOpenNote(resolved);
          else void cb.current.onCreateNote(target.split("/").pop() ?? target, folderRef.current);
          return true;
        }
        const href = (event.target as HTMLElement).closest("a")?.getAttribute("href");
        if (!href) return false;
        if (/^https?:\/\//i.test(href)) { cb.current.onOpenUrl(href); return true; }
        // relative repo paths open in the Repo pane; a scheme or an absolute
        // path is inert, exactly as the spec says
        if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("/")) return true;
        cb.current.onOpenFile(href);
        return true;
      },
    },
  }, [path, readOnly, suggesters]);
  editorRef.current = editor;

  /* the note changed under us (open, reload, or an image just arrived) */
  const lastSet = useRef("");
  const lastImages = useRef(0);
  useEffect(() => {
    if (!editor) return;
    const wanted = toDisplay(body, dir);
    const fresh = imagesReady !== lastImages.current;
    if (wanted === lastSet.current && !fresh) return;
    // the editor is where this body came from: record it, never re-set it —
    // setContent on every keystroke would throw the caret to the top
    if (!fresh && finishMarkdown(toFile(editor.getMarkdown(), srcToRef)) === body) {
      lastSet.current = wanted;
      return;
    }
    lastSet.current = wanted;
    lastImages.current = imagesReady;
    editor.commands.setContent(wanted, { contentType: "markdown" });
  }, [editor, body, dir, imagesReady, srcToRef]);

  /* ⌘] needs to know what the caret is on */
  useEffect(() => {
    if (!editor) return;
    setCaretLinkResolver(() => {
      const node = editor.state.doc.nodeAt(editor.state.selection.from);
      if (node?.type.name !== "wikiLink") return null;
      const entry = notesRef.current.find((n) => n.path === pathRef.current);
      const i = entry?.links.findIndex((l) => l.target === String(node.attrs.target)) ?? -1;
      return i >= 0 ? entry?.resolved[i] ?? null : null;
    });
    return () => setCaretLinkResolver(null);
  }, [editor]);

  return (
    <>
      <EditorContent editor={editor} className="note-doc" />
      {/* the slash menu's "Image" row — paste and drop go straight to handleFiles */}
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => { handleFiles(e.target.files); e.target.value = ""; }}
      />
    </>
  );
}
