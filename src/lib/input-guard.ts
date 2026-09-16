/*
 * macOS hands every function key a private-use character — the arrows are
 * U+F700–U+F703, Home/End/PageUp/PageDown and F1–F35 sit beside them. When
 * the caret is already at the end of a field and → cannot move it, the webview
 * stack (tao 0.35 / wry 0.55 on WKWebView) lets the key fall through to the
 * text-input fallback, which inserts that character as text: a hollow square
 * in the composer. Nothing a person types is in that range, so cancelling an
 * insertion made only of such characters blocks the junk and nothing else —
 * in the composer, every input, and the notes editor alike.
 */

const PUA_FUNCTION_KEYS_START = 0xf700;
const PUA_FUNCTION_KEYS_END = 0xf8ff;

/** True when `data` is non-empty and every code point is a function-key
 *  private-use character. */
export function isFunctionKeyText(data: string | null | undefined): boolean {
  if (!data) return false;
  for (const ch of data) {
    const c = ch.codePointAt(0) ?? 0;
    if (c < PUA_FUNCTION_KEYS_START || c > PUA_FUNCTION_KEYS_END) return false;
  }
  return true;
}

/** Cancel any text insertion that is only function-key junk. Capture phase, so
 *  it runs before any editor sees the event. Returns the uninstaller. */
export function installFunctionKeyGuard(target: EventTarget): () => void {
  const ac = new AbortController();
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
