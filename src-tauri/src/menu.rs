//! The native macOS menu — and the reason it exists.
//!
//! The Web pane's page is a native child WKWebView. While it is first responder,
//! ⌘-chords go to WebKit and never reach the main webview's `keydown` handlers, so
//! the app's shortcuts died the moment the user clicked into a page. The macOS fix
//! is the one browsers use: when a page does not `preventDefault` a ⌘-chord, WebKit
//! hands it to `[[NSApp mainMenu] performKeyEquivalent:]`. So we carry every app
//! shortcut as a menu key equivalent; the matching item fires, and we emit the chord
//! back to the main webview as a `menu-key` event, which the frontend replays as a
//! synthetic keydown. Every existing handler runs unchanged.
//!
//! The whole menu is built here on purpose. `Menu::default` ships File and Window
//! submenus that both carry `close_window` on ⌘W — that would win over ours and
//! close the Chronicle window out from under a focused page.

use serde::Serialize;
use tauri::menu::{IsMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, EventTarget, Runtime};

/// The chord a menu item stands for, as the frontend needs it to rebuild a
/// `KeyboardEvent`. `meta` is always true today — it is carried explicitly so the
/// payload stays a complete description of the chord.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MenuKey {
    pub key: String,
    pub code: String,
    pub meta: bool,
    pub alt: bool,
    pub shift: bool,
}

/// One Go item: what the menu shows, what macOS listens for, and what the frontend
/// replays. Both `build` and `key_for` read this table, so an id cannot exist in the
/// menu without a chord or the other way round.
struct Go {
    id: &'static str,
    text: &'static str,
    /// muda accelerator syntax; pinned by `accelerators_all_parse`.
    accel: &'static str,
    /// `KeyboardEvent.key` — App.tsx's ⌘1-9 and ⌘O branches test this.
    key: &'static str,
    /// `KeyboardEvent.code` — App.tsx's ⌥⌘1/2/3 branch tests this, because ⌥
    /// rewrites `key` on macOS.
    code: &'static str,
    alt: bool,
    shift: bool,
    /// Items with the same group sit together; a separator goes between groups.
    group: u8,
}

const GO: &[Go] = &[
    // the app itself
    Go { id: "go-palette", text: "Command Palette",     accel: "Cmd+KeyK",        key: "k", code: "KeyK", alt: false, shift: false, group: 0 },
    Go { id: "go-cycle",   text: "Next Pane",           accel: "Cmd+KeyJ",        key: "j", code: "KeyJ", alt: false, shift: false, group: 0 },
    Go { id: "go-open",    text: "Open Project…",       accel: "Cmd+KeyO",        key: "o", code: "KeyO", alt: false, shift: false, group: 0 },
    Go { id: "go-search",  text: "Search Repo",         accel: "Shift+Cmd+KeyF",  key: "F", code: "KeyF", alt: false, shift: true,  group: 0 },
    // tabs — the Web pane's, or the terminal's
    Go { id: "go-new-tab",   text: "New Tab or Terminal", accel: "Cmd+KeyT", key: "t", code: "KeyT", alt: false, shift: false, group: 1 },
    Go { id: "go-address",   text: "Address Bar",         accel: "Cmd+KeyL", key: "l", code: "KeyL", alt: false, shift: false, group: 1 },
    Go { id: "go-close-tab", text: "Close Tab",           accel: "Cmd+KeyW", key: "w", code: "KeyW", alt: false, shift: false, group: 1 },
    // the page under the pointer
    Go { id: "go-reload",  text: "Reload Page", accel: "Cmd+KeyR",         key: "r", code: "KeyR",         alt: false, shift: false, group: 2 },
    Go { id: "go-back",    text: "Back",        accel: "Cmd+BracketLeft",  key: "[", code: "BracketLeft",  alt: false, shift: false, group: 2 },
    Go { id: "go-forward", text: "Forward",     accel: "Cmd+BracketRight", key: "]", code: "BracketRight", alt: false, shift: false, group: 2 },
    // the three pane units — ⌥⌘, so they must not collide with ⌘1-9 below
    Go { id: "go-content",  text: "Toggle Content",  accel: "Alt+Cmd+Digit1", key: "1", code: "Digit1", alt: true, shift: false, group: 3 },
    Go { id: "go-agent",    text: "Toggle Agent",    accel: "Alt+Cmd+Digit2", key: "2", code: "Digit2", alt: true, shift: false, group: 3 },
    Go { id: "go-terminal", text: "Toggle Terminal", accel: "Alt+Cmd+Digit3", key: "3", code: "Digit3", alt: true, shift: false, group: 3 },
    Go { id: "go-help", text: "Keyboard Shortcuts", accel: "Cmd+Slash", key: "/", code: "Slash", alt: false, shift: false, group: 4 },
    // the Notes and Repo panes — ⌘N means "new note" on Notes and "new file" on
    // Repo, and App.tsx branches on the active pane; ⌘S saves the open file
    Go { id: "go-new-note",  text: "New Note or File", accel: "Cmd+KeyN", key: "n", code: "KeyN", alt: false, shift: false, group: 5 },
    Go { id: "go-jump-note", text: "Jump to Note",     accel: "Cmd+KeyP", key: "p", code: "KeyP", alt: false, shift: false, group: 5 },
    Go { id: "go-save",      text: "Save",             accel: "Cmd+KeyS", key: "s", code: "KeyS", alt: false, shift: false, group: 5 },
    // jump to an open project by position — plain ⌘, no ⌥
    Go { id: "go-project-1", text: "Project 1", accel: "Cmd+Digit1", key: "1", code: "Digit1", alt: false, shift: false, group: 6 },
    Go { id: "go-project-2", text: "Project 2", accel: "Cmd+Digit2", key: "2", code: "Digit2", alt: false, shift: false, group: 6 },
    Go { id: "go-project-3", text: "Project 3", accel: "Cmd+Digit3", key: "3", code: "Digit3", alt: false, shift: false, group: 6 },
    Go { id: "go-project-4", text: "Project 4", accel: "Cmd+Digit4", key: "4", code: "Digit4", alt: false, shift: false, group: 6 },
    Go { id: "go-project-5", text: "Project 5", accel: "Cmd+Digit5", key: "5", code: "Digit5", alt: false, shift: false, group: 6 },
    Go { id: "go-project-6", text: "Project 6", accel: "Cmd+Digit6", key: "6", code: "Digit6", alt: false, shift: false, group: 6 },
    Go { id: "go-project-7", text: "Project 7", accel: "Cmd+Digit7", key: "7", code: "Digit7", alt: false, shift: false, group: 6 },
    Go { id: "go-project-8", text: "Project 8", accel: "Cmd+Digit8", key: "8", code: "Digit8", alt: false, shift: false, group: 6 },
    Go { id: "go-project-9", text: "Project 9", accel: "Cmd+Digit9", key: "9", code: "Digit9", alt: false, shift: false, group: 6 },
];

/// The Chronicle submenu's own rows — same table shape, rendered up there instead
/// of under Go.
///
/// ⌘Q cannot be `PredefinedMenuItem::quit`: that calls `app.exit()` on the spot,
/// so no window ever sees a close request and the unsaved-file guard never runs —
/// an edited buffer died silently. As a table row the chord goes out as a
/// `menu-key` like every other one, the frontend asks about unsaved work, and only
/// then does `quit_app` (main.rs) let the process go. Every other route out — the
/// Dock's Quit, `osascript quit` — is turned back at `RunEvent::ExitRequested` and
/// replayed through this same chord.
const APP: &[Go] = &[
    Go { id: "go-quit", text: "Quit Chronicle", accel: "Cmd+KeyQ", key: "q", code: "KeyQ", alt: false, shift: false, group: 0 },
];

/// Every row in both tables — what `key_for` searches and what the tests pin.
fn rows() -> impl Iterator<Item = &'static Go> {
    GO.iter().chain(APP.iter())
}

/// Menu id → the chord it replays. Predefined items (copy, paste, …) are not in a
/// table: they do their own native thing and must never be routed to the webview.
pub fn key_for(id: &str) -> Option<MenuKey> {
    let g = rows().find(|g| g.id == id)?;
    Some(MenuKey {
        key: g.key.into(),
        code: g.code.into(),
        meta: true,
        alt: g.alt,
        shift: g.shift,
    })
}

/// Build the whole menu bar: Chronicle · Edit · View · Window · Go.
pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let app_rows: Vec<MenuItem<R>> = APP.iter()
        .map(|g| MenuItem::with_id(app, g.id, g.text, true, Some(g.accel)))
        .collect::<tauri::Result<_>>()?;
    let app_menu = Submenu::with_items(
        app,
        "Chronicle",
        true,
        &[
            &PredefinedMenuItem::about(app, None, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::services(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::show_all(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            // the custom Quit sits exactly where the predefined one did
            &app_rows[0],
        ],
    )?;

    // Edit is what makes ⌘C/⌘V/⌘Z work in both webviews — WebKit only gets them
    // through the responder chain these items drive.
    let edit_menu = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;

    let view_menu = Submenu::with_items(app, "View", true, &[&PredefinedMenuItem::fullscreen(app, None)?])?;

    // No close_window: ⌘W belongs to the Go menu's Close Tab.
    let window_menu = Submenu::with_items(
        app,
        "Window",
        true,
        &[&PredefinedMenuItem::minimize(app, None)?, &PredefinedMenuItem::maximize(app, None)?],
    )?;

    // one item per table row, a separator wherever the group changes
    let mut owned: Vec<Box<dyn IsMenuItem<R>>> = Vec::with_capacity(GO.len() + 8);
    let mut group = GO.first().map(|g| g.group);
    for g in GO {
        if Some(g.group) != group {
            owned.push(Box::new(PredefinedMenuItem::separator(app)?));
            group = Some(g.group);
        }
        owned.push(Box::new(MenuItem::with_id(app, g.id, g.text, true, Some(g.accel))?));
    }
    let go_items: Vec<&dyn IsMenuItem<R>> = owned.iter().map(|i| i.as_ref()).collect();
    let go_menu = Submenu::with_items(app, "Go", true, &go_items)?;

    Menu::with_items(app, &[&app_menu, &edit_menu, &view_menu, &window_menu, &go_menu])
}

/// The `on_menu_event` handler: route our own ids back to the main webview, ignore
/// everything else (the predefined items handle themselves natively).
pub fn handle<R: Runtime>(app: &AppHandle<R>, event: tauri::menu::MenuEvent) {
    if let Some(k) = key_for(event.id().as_ref()) {
        let _ = app.emit_to(EventTarget::webview("main"), "menu-key", k);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use muda::accelerator::Accelerator;

    /// The one thing a unit test can check that the running app cannot tell us
    /// quietly: `MenuItem::with_id` does `.parse().ok()`, so a typo'd accelerator is
    /// silently dropped and the item just never fires.
    #[test]
    fn accelerators_all_parse() {
        for g in rows() {
            g.accel
                .parse::<Accelerator>()
                .unwrap_or_else(|e| panic!("{}: {:?} does not parse ({e})", g.id, g.accel));
        }
    }

    #[test]
    fn every_menu_id_maps_to_a_chord() {
        for g in rows() {
            let k = key_for(g.id).unwrap_or_else(|| panic!("{} has no key", g.id));
            assert!(k.meta, "{} must carry Cmd", g.id);
            assert!(!k.key.is_empty() && !k.code.is_empty(), "{} must name a key and a code", g.id);
        }
    }

    #[test]
    fn ids_are_unique() {
        let mut ids: Vec<_> = rows().map(|g| g.id).collect();
        ids.sort_unstable();
        let n = ids.len();
        ids.dedup();
        assert_eq!(ids.len(), n, "duplicate Go id");
    }

    #[test]
    fn accelerators_are_unique() {
        let mut a: Vec<_> = rows().map(|g| g.accel).collect();
        a.sort_unstable();
        let n = a.len();
        a.dedup();
        assert_eq!(a.len(), n, "two Go items claim the same chord");
    }

    #[test]
    fn the_pane_toggles_are_the_only_alt_chords() {
        for g in rows() {
            let alt = key_for(g.id).unwrap().alt;
            let expected = matches!(g.id, "go-content" | "go-agent" | "go-terminal");
            assert_eq!(alt, expected, "{} alt", g.id);
        }
    }

    /// ⌥⌘1 and ⌘1 share a digit; App.tsx tells them apart by altKey, so the payloads
    /// must too — the pane toggles keep alt, the project jumps must not have it.
    #[test]
    fn the_digit_chords_do_not_collide() {
        assert!(key_for("go-content").unwrap().alt);
        assert!(!key_for("go-project-1").unwrap().alt);
        assert_eq!(key_for("go-project-1").unwrap().code, key_for("go-content").unwrap().code);
    }

    #[test]
    fn search_is_the_only_shift_chord() {
        for g in rows() {
            assert_eq!(key_for(g.id).unwrap().shift, g.id == "go-search", "{} shift", g.id);
        }
        // App.tsx accepts "f" or "F"; macOS reports the shifted form
        assert_eq!(key_for("go-search").unwrap().key, "F");
    }

    #[test]
    fn codes_match_the_frontend_keyboard_map() {
        assert_eq!(key_for("go-content").unwrap().code, "Digit1"); // App.tsx tests e.code
        assert_eq!(key_for("go-back").unwrap().code, "BracketLeft");
        assert_eq!(key_for("go-help").unwrap().key, "/");
        assert_eq!(key_for("go-project-9").unwrap().key, "9"); // App.tsx tests e.key
    }

    #[test]
    fn the_notes_chords_are_new_and_plain() {
        for id in ["go-new-note", "go-jump-note", "go-save"] {
            let k = key_for(id).unwrap();
            assert!(k.meta && !k.alt && !k.shift, "{id} is a plain Cmd chord");
        }
        assert_eq!(key_for("go-new-note").unwrap().key, "n");
        assert_eq!(key_for("go-jump-note").unwrap().key, "p");
        assert_eq!(key_for("go-save").unwrap().key, "s");
    }

    /// ⌘Q is OURS now: a table row, not `PredefinedMenuItem::quit`. The frontend
    /// gets the chord, asks about unsaved files, and calls `quit_app` — the
    /// predefined item exited before any of that could happen.
    #[test]
    fn quit_is_a_table_row_with_a_replayable_chord() {
        let q = APP.iter().find(|g| g.id == "go-quit").expect("the app menu carries Quit");
        assert_eq!(q.text, "Quit Chronicle");
        assert_eq!(q.accel, "Cmd+KeyQ");
        let k = key_for("go-quit").expect("go-quit replays a chord");
        assert_eq!(k.key, "q");
        assert_eq!(k.code, "KeyQ");
        assert!(k.meta && !k.alt && !k.shift, "⌘Q is a plain Cmd chord");
        // and it is NOT in the Go submenu — it renders in Chronicle, where macOS
        // users look for it
        assert!(!GO.iter().any(|g| g.id == "go-quit"), "Quit belongs to the App submenu");
    }

    #[test]
    fn predefined_and_unknown_ids_are_not_routed() {
        assert!(key_for("copy").is_none());
        assert!(key_for("quit").is_none());
        assert!(key_for("").is_none());
        assert!(key_for("go-nope").is_none());
    }
}
