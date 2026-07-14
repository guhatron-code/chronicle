Round kind: bug fixes

# Phase 1 Fix Plan — Round 1

Source: task queue (1 task, no duplicates). Target app: Chronicle — Tauri 2 desktop app, React/TS frontend (`src/`), Rust backend (`src-tauri/src/main.rs`). The window is frameless (`decorations: false`), `transparent: true`, `shadow: true`, with `macOSPrivateApi: true` (see `src-tauri/tauri.conf.json:12-30`). Primary platform: macOS.

---

## T-001 — Window maximize on title-bar double-click is not smooth

**User report:** "When the status bar is double clicked, the window doesn't maximize smoothly." ("Status bar" = the draggable title bar at the top of the window; there are two such drag bars — the shell `TitleBar` and the picker-screen strip.)

**Current behavior / root cause:**
Commit `13ce860` added `onDoubleClick` handlers to both drag bars because macOS swallows Tauri's built-in detail-2 zoom on frameless windows. Those handlers (and the zoom button) all call `windowControls().toggleMaximize()`:

- `src/lib/ipc.ts:281-289` — `windowControls()` wraps `getCurrentWindow()`; `toggleMaximize: () => w.toggleMaximize()` (line 286). **Single choke point — every caller goes through this.**
- `src/components/chrome/TitleBar.tsx:49-56` — title-bar double-click handler.
- `src/components/chrome/TitleBar.tsx:64` — zoom button.
- `src/App.tsx:409-412` — picker-screen drag strip double-click handler.
- `src/App.tsx:419` — picker-screen zoom button.

Tauri's JS `toggleMaximize()` resizes the NSWindow with an instant frame set — no animation — so the window "snaps" to full size instead of the native macOS animated zoom. This is the entire smoothness problem; the fix is to route the toggle through a native macOS `zoom:` call, which animates and also natively remembers/restores the pre-zoom frame.

**Fix items (execute all, in order):**

### T-001.1 — Add a native `window_toggle_zoom` Tauri command (Rust)

In `src-tauri/src/main.rs`, add a new command alongside the existing `#[tauri::command]` fns:

```rust
#[tauri::command]
fn window_toggle_zoom(window: tauri::WebviewWindow) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let w = window.clone();
        window
            .run_on_main_thread(move || unsafe {
                use objc2::{msg_send, runtime::AnyObject};
                if let Ok(ns) = w.ns_window() {
                    let ns = ns as *mut AnyObject;
                    // Native zoom: animated frame change + macOS remembers the
                    // pre-zoom frame for the reverse toggle.
                    let _: () = msg_send![ns, zoom: std::ptr::null_mut::<AnyObject>()];
                }
            })
            .map_err(|e| e.to_string())?;
        return Ok(());
    }
    #[cfg(not(target_os = "macos"))]
    {
        if window.is_maximized().map_err(|e| e.to_string())? {
            window.unmaximize().map_err(|e| e.to_string())
        } else {
            window.maximize().map_err(|e| e.to_string())
        }
    }
}
```

- Register `window_toggle_zoom` in the `invoke_handler` list at `src-tauri/src/main.rs:1676-1685`.
- Add the macOS-only dependency to `src-tauri/Cargo.toml`:
  ```toml
  [target.'cfg(target_os = "macos")'.dependencies]
  objc2 = "0.6"
  ```
  (If a compatible `objc2` is already in the tree via Tauri, still declare it explicitly — transitive deps are not importable.)
- Notes for the implementer: `run_on_main_thread` requires `Send`, which is why the `WebviewWindow` clone (which is `Send`) is moved in and `ns_window()` is called *inside* the closure — do not move the raw pointer across threads. `zoom:` requires the resizable style-mask bit, which Tauri frameless windows have by default (`resizable` defaults to true and is not overridden in `tauri.conf.json`). If during verification `zoom:` turns out to be a no-op, the fallback is `setFrame:display:animate:` toward `[[ns screen] visibleFrame]` with the previous frame stashed for restore — but try `zoom:` first; it should just work.

### T-001.2 — Route the frontend through the new command

In `src/lib/ipc.ts`, change `windowControls().toggleMaximize` (line 286) from `() => w.toggleMaximize()` to `() => invoke("window_toggle_zoom")` (the file already imports/uses `invoke` from `@tauri-apps/api/core` for other commands — match the existing call style in this file). Because `windowControls()` is the single wrapper, this fixes all four call sites (both double-click handlers and both zoom buttons) with no changes to `TitleBar.tsx` or `App.tsx`.

### T-001.3 — Guard against re-entrant toggles during the animation

The native zoom animation takes ~200ms; a triple/quadruple click (or double-clicking the zoom button region twice) can queue overlapping `zoom:` calls mid-animation and produce visible stutter — the same "not smooth" symptom. Add a cheap in-flight guard in `src/lib/ipc.ts` inside `windowControls()`'s `toggleMaximize`: a module-level `let zoomInFlight = false;` flag set before the `invoke` and cleared in `.finally()` after a ~250ms `setTimeout` (or simply cleared in `.finally()` if the invoke is awaited until the command returns — the Rust command returns after dispatching, so keep the small timeout). Skip the invoke while the flag is set. Keep this minimal — do not introduce state libraries or hooks for it.

### T-001.4 — Verify end-to-end (macOS)

1. `cargo check` in `src-tauri/` (or let `tauri dev` compile) — must compile with no warnings introduced by the new command.
2. `npx tsc --noEmit` (or `npm run build`) — frontend must typecheck.
3. Launch the app (`npm run tauri dev` from the repo root, or the project's usual run path).
4. Double-click the shell title bar: the window must **animate** to the zoomed frame (native macOS zoom easing), not snap. Double-click again: it must animate back to the exact pre-zoom frame.
5. Repeat on the picker screen's drag strip (close all tabs / fresh launch shows the picker) and on both green-dot zoom buttons.
6. Confirm the opt-outs still hold: double-clicking a tab, button, or input inside the title bar (`[data-no-zoom]`, `button`, `input` — see `TitleBar.tsx:53`) must NOT zoom.
7. Confirm dragging the window by the title bar still works (the drag region must be unaffected).
8. Capture a screenshot of the app in each state (restored + zoomed) as evidence.

**Traceability:** all items above ← task `T-001` (round 1, column `queued`).

---

## Deduplication note

Only one task in this round; nothing to merge. The earlier commit `13ce860` fixed *whether* double-click zooms; T-001 fixes *how* it zooms (animation smoothness). They do not conflict — T-001.2 deliberately preserves the double-click handlers that commit added.
