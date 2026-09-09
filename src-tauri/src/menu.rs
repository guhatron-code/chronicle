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
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, EventTarget, Runtime};

/// The chord a menu item stands for, as the frontend needs it to rebuild a
/// `KeyboardEvent`. `meta` is always true and `shift` always false today — they are
/// carried explicitly so the payload stays a complete description of the chord.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MenuKey {
    pub key: String,
    pub code: String,
    pub meta: bool,
    pub alt: bool,
    pub shift: bool,
}

impl MenuKey {
    fn cmd(key: &str, code: &str) -> Self {
        Self { key: key.into(), code: code.into(), meta: true, alt: false, shift: false }
    }
    fn alt_cmd(key: &str, code: &str) -> Self {
        Self { key: key.into(), code: code.into(), meta: true, alt: true, shift: false }
    }
}

/// Menu id → the chord it replays. Predefined items (copy, quit, …) are not in here:
/// they do their own native thing and must never be routed to the webview.
pub fn key_for(id: &str) -> Option<MenuKey> {
    Some(match id {
        "go-palette" => MenuKey::cmd("k", "KeyK"),
        "go-cycle" => MenuKey::cmd("j", "KeyJ"),
        "go-new-tab" => MenuKey::cmd("t", "KeyT"),
        "go-address" => MenuKey::cmd("l", "KeyL"),
        "go-close-tab" => MenuKey::cmd("w", "KeyW"),
        "go-reload" => MenuKey::cmd("r", "KeyR"),
        "go-back" => MenuKey::cmd("[", "BracketLeft"),
        "go-forward" => MenuKey::cmd("]", "BracketRight"),
        "go-help" => MenuKey::cmd("/", "Slash"),
        "go-content" => MenuKey::alt_cmd("1", "Digit1"),
        "go-agent" => MenuKey::alt_cmd("2", "Digit2"),
        "go-terminal" => MenuKey::alt_cmd("3", "Digit3"),
        _ => return None,
    })
}

/// Build the whole menu bar: Chronicle · Edit · View · Window · Go.
pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
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
            &PredefinedMenuItem::quit(app, None)?,
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

    let go = |id: &str, text: &str, accel: &str| MenuItem::with_id(app, id, text, true, Some(accel));
    let go_menu = Submenu::with_items(
        app,
        "Go",
        true,
        &[
            &go("go-palette", "Command Palette", "Cmd+KeyK")?,
            &go("go-cycle", "Next Pane", "Cmd+KeyJ")?,
            &go("go-new-tab", "New Tab or Terminal", "Cmd+KeyT")?,
            &go("go-address", "Address Bar", "Cmd+KeyL")?,
            &go("go-close-tab", "Close Tab", "Cmd+KeyW")?,
            &PredefinedMenuItem::separator(app)?,
            &go("go-reload", "Reload Page", "Cmd+KeyR")?,
            &go("go-back", "Back", "Cmd+BracketLeft")?,
            &go("go-forward", "Forward", "Cmd+BracketRight")?,
            &PredefinedMenuItem::separator(app)?,
            &go("go-content", "Toggle Content", "Alt+Cmd+Digit1")?,
            &go("go-agent", "Toggle Agent", "Alt+Cmd+Digit2")?,
            &go("go-terminal", "Toggle Terminal", "Alt+Cmd+Digit3")?,
            &PredefinedMenuItem::separator(app)?,
            &go("go-help", "Keyboard Shortcuts", "Cmd+Slash")?,
        ],
    )?;

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

    #[test]
    fn every_go_id_maps_to_a_chord() {
        let ids = [
            "go-palette", "go-cycle", "go-new-tab", "go-address", "go-close-tab", "go-reload",
            "go-back", "go-forward", "go-help", "go-content", "go-agent", "go-terminal",
        ];
        for id in ids {
            let k = key_for(id).unwrap_or_else(|| panic!("{id} has no key"));
            assert!(k.meta, "{id} must carry Cmd");
            assert!(!k.shift, "{id} must not carry Shift");
            assert!(!k.key.is_empty() && !k.code.is_empty(), "{id} must name a key and a code");
        }
    }

    #[test]
    fn the_pane_toggles_are_the_only_alt_chords() {
        for id in ["go-content", "go-agent", "go-terminal"] {
            assert!(key_for(id).unwrap().alt, "{id} is ⌥⌘");
        }
        for id in ["go-palette", "go-cycle", "go-new-tab", "go-address", "go-close-tab", "go-reload", "go-back", "go-forward", "go-help"] {
            assert!(!key_for(id).unwrap().alt, "{id} is plain ⌘");
        }
    }

    #[test]
    fn codes_match_the_frontend_keyboard_map() {
        assert_eq!(key_for("go-content").unwrap().code, "Digit1"); // App.tsx tests e.code
        assert_eq!(key_for("go-back").unwrap(), MenuKey::cmd("[", "BracketLeft"));
        assert_eq!(key_for("go-help").unwrap(), MenuKey::cmd("/", "Slash"));
    }

    #[test]
    fn predefined_and_unknown_ids_are_not_routed() {
        assert!(key_for("copy").is_none());
        assert!(key_for("quit").is_none());
        assert!(key_for("").is_none());
        assert!(key_for("go-nope").is_none());
    }
}
