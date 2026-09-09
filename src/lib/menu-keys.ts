/*
 * The menu half of the keyboard map (see src-tauri/src/menu.rs).
 *
 * While the Web pane's native page is first responder, ⌘-chords never reach this
 * document — WebKit hands them to the app menu instead. The Go menu carries every
 * shortcut as a key equivalent and emits a `menu-key` event; App.tsx replays it as a
 * synthetic keydown so the existing handlers run unchanged. These two functions are
 * the pure part of that: the event shape, and whether the chord ends with the user in
 * Chronicle's own chrome.
 */

/** The chord a menu item stood for (Rust: menu::MenuKey, camelCase over the wire). */
export type MenuKey = { key: string; code: string; meta: boolean; alt: boolean; shift: boolean };

/** The replay event — `code` matters as much as `key`: ⌥ rewrites `key` on macOS,
 *  so App.tsx's ⌥⌘1/2/3 branch tests `e.code`. */
export function keydownInit(k: MenuKey): KeyboardEventInit {
  return {
    key: k.key,
    code: k.code,
    metaKey: k.meta,
    altKey: k.alt,
    shiftKey: k.shift,
    bubbles: true,
    cancelable: true,
  };
}

/** Keys that move the user into Chronicle's chrome — after them the main webview
 *  should own focus. The page-navigation chords (reload, back, forward) act on the
 *  page and leave the user reading it, so they must not steal first responder. */
export function reclaimsFocus(k: MenuKey): boolean {
  return k.key !== "r" && k.key !== "[" && k.key !== "]";
}
