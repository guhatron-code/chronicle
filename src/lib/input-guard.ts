/*
 * macOS hands every function key a private-use character — the arrows are
 * U+F700–U+F703, Home and End sit beside them. When the caret is already at
 * the end of a field and → cannot move it, the webview stack (tao 0.35 /
 * wry 0.55 on WKWebView) lets the key fall through to the text-input fallback,
 * which inserts that character as text: a hollow square in the composer, and
 * in every other field. Measured live: the insertion does NOT announce itself
 * as a cancelable beforeinput, so the only place to stop it is the keydown —
 * swallow the key when the move it asks for is a no-op. A move that can go
 * somewhere is never touched.
 */

const PUA_FUNCTION_KEYS_START = 0xf700;
const PUA_FUNCTION_KEYS_END = 0xf8ff;

/** True when `data` is non-empty and every code point is a function-key
 *  private-use character. Nothing a person types is in that range. */
export function isFunctionKeyText(data: string | null | undefined): boolean {
  if (!data) return false;
  for (const ch of data) {
    const c = ch.codePointAt(0) ?? 0;
    if (c < PUA_FUNCTION_KEYS_START || c > PUA_FUNCTION_KEYS_END) return false;
  }
  return true;
}

/** What a text field says about its caret: the selection's two ends, which of
 *  them moves (`direction`), and how long the text is. */
export interface CaretState {
  start: number;
  end: number;
  length: number;
  direction: "forward" | "backward" | "none";
}

const TO_END = new Set(["ArrowRight", "End"]);
const TO_START = new Set(["ArrowLeft", "Home"]);

/** Would this key move nothing? Then the browser must not see it at all. The
 *  focus end of a selection is what moves: a backward selection's focus is
 *  `start`, a forward one's is `end`, a collapsed caret is both. */
export function swallowsMove(key: string, c: CaretState): boolean {
  const collapsed = c.start === c.end;
  if (TO_END.has(key)) return c.end >= c.length && (collapsed || c.direction !== "backward");
  if (TO_START.has(key)) return c.start <= 0 && (collapsed || c.direction !== "forward");
  return false;
}

function caretOfField(el: HTMLInputElement | HTMLTextAreaElement): CaretState | null {
  const { selectionStart, selectionEnd, selectionDirection, value } = el;
  if (selectionStart == null || selectionEnd == null) return null; // a field kind without a caret
  return { start: selectionStart, end: selectionEnd, length: value.length, direction: selectionDirection ?? "none" };
}

/** A contenteditable (the notes editor): is the focus at the very start or the
 *  very end of it? Measured on the text between the focus and the edge, which
 *  is what the arrow would have to cross. */
function caretOfEditable(el: HTMLElement): CaretState | null {
  const sel = el.ownerDocument.getSelection();
  if (!sel || sel.rangeCount === 0 || !sel.focusNode || !el.contains(sel.focusNode)) return null;
  const before = el.ownerDocument.createRange();
  before.setStart(el, 0);
  before.setEnd(sel.focusNode, sel.focusOffset);
  const after = el.ownerDocument.createRange();
  after.setStart(sel.focusNode, sel.focusOffset);
  after.setEnd(el, el.childNodes.length);
  const b = before.toString().length;
  const a = after.toString().length;
  // a collapsed selection is both ends; an extended one reports where its focus is
  const collapsed = sel.isCollapsed;
  return { start: b === 0 ? 0 : 1, end: a === 0 ? 1 : 0, length: 1, direction: collapsed ? "none" : "forward" };
}

/** Swallow an arrow/Home/End whose move is a no-op, in inputs, textareas and
 *  contenteditables. Capture phase, so it runs before any editor sees the key.
 *  Returns the uninstaller. */
export function installFunctionKeyGuard(target: EventTarget): () => void {
  const ac = new AbortController();
  target.addEventListener(
    "keydown",
    (e: Event) => {
      const ke = e as KeyboardEvent;
      if (!TO_END.has(ke.key) && !TO_START.has(ke.key)) return;
      const el = ke.target as HTMLElement | null;
      if (!el || typeof el !== "object") return;
      let caret: CaretState | null = null;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) caret = caretOfField(el);
      else if (el.isContentEditable) caret = caretOfEditable(el);
      if (caret && swallowsMove(ke.key, caret)) ke.preventDefault();
    },
    { capture: true, signal: ac.signal },
  );
  // belt and braces: should an insertion of the junk ever announce itself, cancel it
  target.addEventListener(
    "beforeinput",
    (e: Event) => {
      const ie = e as InputEvent;
      if (ie.inputType === "insertText" && isFunctionKeyText(ie.data)) e.preventDefault();
    },
    { capture: true, signal: ac.signal },
  );
  return () => ac.abort();
}
