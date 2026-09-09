/*
 * CodeMirror 6, wearing the app's tokens. One component for both the read-only
 * Contents view and the editable one — `EditorState.readOnly` is the only
 * difference, so a file never looks different for being editable.
 *
 * The EditorState is cached per buffer, not per mount: switching tabs and
 * coming back must keep the undo history, and re-creating the state would
 * silently throw it away. `onBufferDisposed` from the store is what drops a
 * cached state, so the cache lives exactly as long as the buffer does.
 *
 * The instance is created on mount and destroyed on unmount — no timers, no
 * observers left behind (the energy rule).
 */
import { useEffect, useRef } from "react";
import { EditorState, Compartment, Annotation, Transaction, type Extension } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, highlightSpecialChars, drawSelection, rectangularSelection, crosshairCursor } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { bracketMatching, indentUnit, syntaxHighlighting, HighlightStyle, StreamLanguage } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { markdown } from "@codemirror/lang-markdown";
import { rust } from "@codemirror/lang-rust";
import { python } from "@codemirror/lang-python";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { toml } from "@codemirror/legacy-modes/mode/toml";
import { yaml } from "@codemirror/legacy-modes/mode/yaml";
import { onBufferDisposed, type LangId } from "@/lib/repo-editor";
import { cn } from "@/lib/utils";

/* ---- the theme: every colour is a token, so light and dark both follow ---- */

const chronicleTheme = EditorView.theme({
  "&": {
    height: "100%",
    fontSize: "12px",
    backgroundColor: "var(--surface-input)",
    color: "var(--text-secondary)",
  },
  ".cm-scroller": {
    fontFamily: "var(--font-mono, ui-monospace, monospace)",
    lineHeight: "1.75",
    // wrap off: the editor scrolls sideways, the PAGE never does
    overflowX: "auto",
  },
  ".cm-content": { padding: "12px 0", caretColor: "var(--text-primary)" },
  ".cm-gutters": {
    backgroundColor: "var(--surface-input)",
    color: "var(--text-dimmer)",
    border: "none",
    borderRight: "1px solid var(--divider-faint)",
  },
  ".cm-lineNumbers .cm-gutterElement": {
    padding: "0 12px 0 8px",
    minWidth: "44px",
    fontVariantNumeric: "tabular-nums",
  },
  ".cm-activeLine": { backgroundColor: "var(--fill-subtle)" },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--text-dim)" },
  "&.cm-focused": { outline: "none" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--text-primary)" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
    backgroundColor: "color-mix(in srgb, var(--text-primary) 16%, transparent)",
  },
  ".cm-selectionMatch": { backgroundColor: "color-mix(in srgb, var(--text-primary) 10%, transparent)" },
  ".cm-matchingBracket, &.cm-focused .cm-matchingBracket": {
    backgroundColor: "var(--fill-hover)",
    outline: "1px solid var(--border-hairline)",
  },
  ".cm-panels": {
    backgroundColor: "var(--surface-card-raised)",
    color: "var(--text-secondary)",
    borderTop: "1px solid var(--divider)",
  },
  ".cm-panel input, .cm-panel button": {
    backgroundColor: "var(--surface-input)",
    color: "var(--text-primary)",
    border: "1px solid var(--border-hairline)",
    borderRadius: "4px",
    padding: "1px 5px",
  },
  ".cm-searchMatch": { backgroundColor: "color-mix(in srgb, var(--state-warn) 28%, transparent)" },
  ".cm-searchMatch-selected": { backgroundColor: "color-mix(in srgb, var(--state-warn) 45%, transparent)" },
});

/* The viewer's existing vocabulary: comments dim, everything else on the two
   text tones, with the accent colours only where the deck already uses them. */
const chronicleHighlight = HighlightStyle.define([
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: "var(--text-dim)", fontStyle: "italic" },
  { tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword], color: "var(--text-primary)", fontWeight: "500" },
  { tag: [t.string, t.special(t.string), t.regexp], color: "var(--state-success)" },
  { tag: [t.number, t.bool, t.null, t.atom], color: "var(--state-warn)" },
  { tag: [t.propertyName, t.attributeName], color: "var(--text-secondary)" },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: "var(--text-primary)" },
  { tag: [t.typeName, t.className, t.namespace, t.tagName], color: "var(--text-primary)" },
  { tag: [t.definition(t.variableName), t.definition(t.propertyName)], color: "var(--text-primary)" },
  { tag: [t.variableName], color: "var(--text-secondary)" },
  { tag: [t.operator, t.punctuation, t.separator, t.bracket], color: "var(--text-dim)" },
  { tag: [t.meta, t.processingInstruction], color: "var(--text-dim)" },
  { tag: [t.invalid], color: "var(--state-error)" },
  { tag: [t.heading], color: "var(--text-primary)", fontWeight: "600" },
  { tag: [t.link, t.url], color: "var(--state-success)", textDecoration: "underline" },
  { tag: [t.emphasis], fontStyle: "italic" },
  { tag: [t.strong], fontWeight: "600" },
  { tag: [t.strikethrough], textDecoration: "line-through" },
]);

function languageExtension(id: LangId): Extension[] {
  switch (id) {
    case "javascript": return [javascript()];
    case "jsx": return [javascript({ jsx: true })];
    case "typescript": return [javascript({ typescript: true })];
    case "tsx": return [javascript({ typescript: true, jsx: true })];
    case "json": return [json()];
    case "css": return [css()];
    case "html": return [html()];
    case "markdown": return [markdown()];
    case "rust": return [rust()];
    case "python": return [python()];
    case "shell": return [StreamLanguage.define(shell)];
    case "toml": return [StreamLanguage.define(toml)];
    case "yaml": return [StreamLanguage.define(yaml)];
    case "plain": return [];
  }
}

/* Marks a transaction as the store writing INTO the view (Reload, Keep mine, a
   silent reload of a clean buffer) rather than the user typing. Two things key
   off it: the change listener stays quiet, so the text does not echo straight
   back into the store, and `addToHistory.of(false)` keeps it out of the undo
   stack — otherwise ⌘Z after a Reload would restore the stale text and the next
   ⌘S would write it back to disk. */
const External = Annotation.define<boolean>();

/* ---- the per-buffer state cache ---- */

const states = new Map<string, EditorState>();
/* A buffer is disposed while its editor is still mounted: the store drops the
   key, React unmounts the view a beat later, and the unmount's cleanup would
   put the state straight back — so reopening the file would restore the undo
   history of a buffer that is gone, and one ⌘Z + ⌘S would write the pre-close
   text back to disk. The mark says "this key died; do not resurrect it". It is
   cleared by whichever comes first: the cleanup that skipped, or a fresh mount
   on the same key. */
const disposed = new Set<string>();
onBufferDisposed((key) => { states.delete(key); disposed.add(key); });

const langComp = new Compartment();
const roComp = new Compartment();
const tabComp = new Compartment();

export type CodeEditorProps = {
  /** identity of the document — `bufferKey(dir, path)`. */
  docKey: string;
  text: string;
  language: LangId;
  readOnly: boolean;
  tabSize: number;
  onChange?: (text: string) => void;
  onSave?: () => void;
  className?: string;
};

export function CodeEditor({ docKey, text, language, readOnly, tabSize, onChange, onSave, className }: CodeEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  // the callbacks live in refs so a re-render never rebuilds the EditorState
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  onChangeRef.current = onChange;
  onSaveRef.current = onSave;

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    disposed.delete(docKey); // a live mount owns this key again
    const cached = states.get(docKey);
    const state = cached ?? EditorState.create({
      doc: text,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightSpecialChars(),
        history(),
        drawSelection(),
        rectangularSelection(),
        crosshairCursor(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        bracketMatching(),
        syntaxHighlighting(chronicleHighlight),
        chronicleTheme,
        // wrapping is OFF by omission: `EditorView.lineWrapping` is deliberately
        // NOT in this list, and `.cm-scroller { overflow-x: auto }` in the theme
        // gives the editor its own sideways scroll so the page never gets one
        keymap.of([
          // Cmd-S must beat the browser's Save dialog and reach the store.
          // `preventDefault` without `stopPropagation`: the keydown still
          // bubbles to the App keymap, so the App's ⌘S branch must guard on
          // `e.defaultPrevented` or the save fires twice.
          { key: "Mod-s", preventDefault: true, run: () => { onSaveRef.current?.(); return true; } },
          ...searchKeymap,   // Cmd-F inside the editor
          ...historyKeymap,
          ...defaultKeymap,
          indentWithTab,
        ]),
        langComp.of(languageExtension(language)),
        roComp.of(EditorState.readOnly.of(readOnly)),
        tabComp.of([EditorState.tabSize.of(tabSize), indentUnit.of(" ".repeat(tabSize))]),
        EditorView.updateListener.of((u) => {
          // one update can carry several transactions; nothing but a real doc
          // change from the user should reach the store, and the whole text is
          // stringified once per update, not once per transaction
          if (!u.docChanged) return;
          if (u.transactions.some((tr) => tr.annotation(External))) return;
          onChangeRef.current?.(u.state.doc.toString());
        }),
      ],
    });
    const v = new EditorView({ state, parent: el });
    /* A cached state still carries whatever language, read-only flag and tab
       size were baked into its compartments when it was last unmounted — the
       props may have moved since (a rename changes the language, a fresh
       .editorconfig the tab size). Reconfigure all three now so a remount always
       matches the props; the per-prop effects below keep it that way after. */
    v.dispatch({ effects: [
      langComp.reconfigure(languageExtension(language)),
      roComp.reconfigure(EditorState.readOnly.of(readOnly)),
      tabComp.reconfigure([EditorState.tabSize.of(tabSize), indentUnit.of(" ".repeat(tabSize))]),
    ] });
    view.current = v;
    return () => {
      // keep the state (undo history included) for when this buffer comes back —
      // unless the buffer was closed under us, in which case its history died
      // with it and writing the cache here would resurrect it
      if (disposed.has(docKey)) disposed.delete(docKey);
      else states.set(docKey, v.state);
      v.destroy();
      view.current = null;
    };
    // docKey ONLY: text/language/readOnly/tabSize are reconfigured below, and
    // listing them here would tear the undo history down on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docKey]);

  // language, read-only and tab size swap through compartments, in place
  useEffect(() => {
    view.current?.dispatch({ effects: langComp.reconfigure(languageExtension(language)) });
  }, [language]);
  useEffect(() => {
    view.current?.dispatch({ effects: roComp.reconfigure(EditorState.readOnly.of(readOnly)) });
  }, [readOnly]);
  useEffect(() => {
    view.current?.dispatch({ effects: tabComp.reconfigure([
      EditorState.tabSize.of(tabSize), indentUnit.of(" ".repeat(tabSize)),
    ]) });
  }, [tabSize]);

  /* An outside write (Reload, or a silent reload of a clean buffer) replaces
     the document. Guarded on inequality so a keystroke echo is a no-op — the
     store is the source of truth for what is on disk, the view for what is
     being typed. Annotated `External` so it neither echoes back through the
     change listener nor lands in the undo history. */
  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const current = v.state.doc.toString();
    if (current === text) return;
    v.dispatch({
      changes: { from: 0, to: v.state.doc.length, insert: text },
      annotations: [Transaction.addToHistory.of(false), External.of(true)],
    });
  }, [text]);

  return <div ref={host} data-selectable className={cn("min-h-0 flex-1 overflow-hidden", className)} />;
}

export default CodeEditor;
