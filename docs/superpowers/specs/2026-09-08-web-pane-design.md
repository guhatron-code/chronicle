# The Web pane — design

**Date:** 2026-09-08
**Status:** approved in brainstorm (mockup accepted), awaiting implementation plan
**Depends on:** `2026-09-08-energy-efficiency-design.md` (the `app-activity` signal and `every()` scheduler)
**Mockup:** `.superpowers/brainstorm/40332-1788860782/content/web-pane.html`

## Goal

A browser inside Chronicle for two jobs: reading HTML artifacts an agent produced in
the project, and browsing the web, with ads and trackers blocked the way uBlock Origin
would block them. It must not cost energy when it isn't being looked at.

## The constraint that shapes it

Chronicle renders in WKWebView. WKWebView cannot load browser extensions, so the uBlock
Origin extension itself cannot run here. What can run is uBlock's **filter lists**,
compiled into WebKit content-blocker rules and attached to the webview natively.
That gives network-level blocking of ads and trackers and generic element hiding, with
no extension runtime and no second engine. Embedding Chromium was rejected: hundreds of
megabytes, a second renderer, and constant background CPU, against the energy goal.

## Non-goals

- Blocked-request counters (WebKit doesn't report rule-list matches).
- Bookmarks, history, reader mode, extensions of any kind, multiple profiles.
- Any Chromium or Gecko embedding.

## Placement

A fourth rail entry, **Web**, after Roadmap, Repo and Board. The content pane shows the
Web pane the way it shows the other three. `Pane` in `Rail.tsx` and `PANES` in `App.tsx`
gain `"web"`. ⌘J cycles through it.

## Architecture

### Two kinds of view

- **Chrome (React, main webview):** the tab strip, address bar, nav buttons, the blocking pill, and an empty *content region* `div` that reserves the page's space.
- **Pages (native child webviews, Rust):** one Tauri child webview per tab, created with `Window::add_child` (needs the `unstable` cargo feature on `tauri`) and positioned over the content region. Exactly one is shown; the rest are hidden, which lets WebKit throttle their timers.

A native child paints above the DOM. Rules that follow from that:

- A `ResizeObserver` on the content region plus a window-resize listener push `web_set_bounds` (physical pixels, from `getBoundingClientRect` × `devicePixelRatio`) on every change, including splitter drags.
- **Hide rules.** The active page is hidden (`web_hide_all`) when: the rail leaves Web, the content pane is toggled off, or any overlay opens (`CommandPalette`, `SearchOverlay`, `ConfirmDialog`, `NewProjectDialog`, `ShortcutsOverlay`). It is shown again when the last of those conditions clears. While hidden by an overlay, the content region shows a quiet cover with the page's title, so it never looks like a hole.
- Toasts render in the title-bar strip and the right column, both outside the content region, so they never fight the page.
- Tooltips and menus inside the Web chrome (tab close, the ⋯ menu) are positioned above the content region, never over it.

### Tab lifecycle

- `web_tab_open(dir, url?)` creates the child webview with: the rule lists attached (below), `data_directory` = `<app data>/web-profile` so cookies and logins persist across tabs and launches, `on_new_window` → open as a new tab and return `Deny` for the popup, `on_download` → save to `~/Downloads`, toast the filename, `on_navigation` → allow only `http`, `https`, `chronicle-file` and `about:blank`, `on_page_load` → emit `web-tab-changed`.
- `web_tab_close(id)` destroys the webview. Closing the last tab leaves the pane on an empty state with an address bar, not a blank child.
- Tabs and their URLs are persisted per project in `<app data>/web-tabs/<project-hash>.json`, never inside the project. On pane first-show for a project, tabs are recreated **lazily**: only the active tab's webview is built; the others get a webview on first activation.
- Title, url, loading, can-go-back and can-go-forward arrive on `web-tab-changed`; the React store mirrors them.

### Energy

- The Web pane subscribes to `app-activity`. When the window is hidden, `web_hide_all` runs; when it shows and the pane is still Web, the active tab returns.
- A tab hidden for more than 30 minutes has its webview destroyed and is recreated from its URL on next activation (session state inside the page is lost; the URL is not). This is the same trade Safari makes.

## Block lists

### Build time: `scripts/blocklists.mjs`

1. Downloads: EasyList, EasyPrivacy, uBlock filters (`filters`, `privacy`, `badware`, `unbreak`, `quick-fixes`), Peter Lowe's list.
2. Converts with `abp2blocklist` (eyeo's converter, npm) to WebKit content-blocker JSON.
3. Drops rules the converter marks unsupported and counts them.
4. Splits into chunks of at most 150,000 rules (WebKit's per-list cap) and writes `src-tauri/resources/blocklists/<n>.json`.
5. Writes `manifest.json`: source URLs, fetch date, per-chunk rule count and sha256, converter version, dropped-rule count.

`tauri.conf.json` gains `bundle.resources` for the folder. The script is run by hand before a
release; the manifest's fetch date is shown in the ⋯ menu so staleness is visible.

### Runtime: `blocklists.rs`

- On first Web pane show, Rust reads the manifest (app-data copy first, bundled copy as fallback) and, for each chunk, calls `WKContentRuleListStore.defaultStore` `compileContentRuleListForIdentifier:` with identifier `chronicle-<chunk>-<sha256>`. WebKit caches compiled lists by identifier, so a matching sha is a lookup, not a compile. Compilation runs on a background thread; the pane shows "Preparing blocking…" in the pill until done, and pages opened before that wait for it.
- The compiled lists are added to a shared `WKUserContentController` used by every browser webview's configuration (reached through `with_webview` and `objc2-web-kit`).
- **Update lists**: fetches the same sources at runtime into `<app data>/blocklists/`, converts with the same rules (the converter is JavaScript, so Rust shells out to a bundled `node` script only if `node` is present, otherwise the button explains it needs Node). A weekly check runs through `every()` with a 7-day base while the pane is open. A failed update keeps the last good set and toasts why.

### What blocking covers

Network blocking (`block`, `block-cookies`), first-party/third-party distinctions, domain
options, and generic and specific element hiding (`css-display-none`) survive the
conversion. Scriptlets, redirect rules, procedural cosmetic filters and `$replace` do
not; those are the gap between this and the uBlock Origin extension, and the help text says so.

## The address bar

- Input with a scheme, or containing a dot and no spaces, is a URL; `https://` is prepended when no scheme is given. Anything else searches DuckDuckGo (`https://duckduckgo.com/?q=`).
- `chronicle-file` URLs display as `this project › <relative path>`; the raw scheme is never shown.
- ⌘L focuses the bar, ⌘T new tab, ⌘W close tab, ⌘R reload, ⌘[ / ⌘] back / forward. These bind only while the Web pane is active so they don't collide with existing shortcuts.
- These work while the *page* is focused too: the page is a native child webview that swallows ⌘-chords, so the app carries every shortcut as a key equivalent in a native menu bar (Chronicle · Edit · View · Window · Go). macOS routes a chord the page did not handle to the menu, and the menu item sends it back to the main webview as a synthetic keydown — the same handlers run, and the ones that land in Chronicle's chrome (⌘K/⌘T/⌘L/⌘W/⌘J/⌘/ and ⌥⌘1-3) take keyboard focus back from the page.

## Opening project files

- A custom protocol `chronicle-file://<project-hash>/<relative path>` is registered with `register_uri_scheme_protocol`. It resolves against the opened project's root, refuses `..` and symlinks that escape the root, serves with a MIME type from the extension, and returns 404 outside the jail. `file://` never reaches a browser webview.
- Entry points: an **Open in Web** action on `.html` and `.htm` rows in the Repo file tree, agent file links to HTML, and HTML files dropped on the terminal or composer (the existing drop handling gains a branch). Each opens a new tab, or focuses an existing tab already on that path.
- A page opened this way reloads on `project-fs-changed` for its path (debounced with the existing 450ms), so an agent rewriting a report shows the new version without a click.

## IPC surface

Commands: `web_tab_open`, `web_tab_close`, `web_tab_show`, `web_tab_navigate`, `web_tab_back`, `web_tab_forward`, `web_tab_reload`, `web_set_bounds`, `web_hide_all`, `web_open_file`, `web_update_blocklists`, `web_blocklists_info`.
Events: `web-tab-changed`, `web-blocklists-changed`.
All wrapped in `src/lib/ipc.ts` per the existing rule that components never import Tauri directly.

## Security

- Browser webviews never get Tauri's IPC: they are created with `WebviewBuilder` on an external URL, no `initialization_script`, no `capabilities` entry. The app's CSP is unchanged.
- The persistent profile lives in app data with the same permissions as the rest of Chronicle's data.
- Navigation to non-http(s) schemes is denied in `on_navigation`; `javascript:` URLs typed in the bar are rejected before they reach the webview.

## Error handling

- Rule-list compile failure for one chunk: the pill shows "Blocking · partial", the failing chunk is named in the ⋯ menu, other chunks still apply.
- A webview that fails to create: toast with the reason, the tab is removed.
- Bounds pushed before the webview exists are stored and applied on creation.

## Testing

- **Rust:** unit tests for URL classification (URL vs search), the `chronicle-file` jail (normal path, `..`, escaping symlink, missing file, MIME mapping), manifest parsing, and chunk-size splitting.
- **Script:** `blocklists.mjs` has a `--check` mode that validates every chunk parses and no chunk exceeds the cap; CI can run it against committed output.
- **Manual checklist:** a known ad-heavy page shows no ad slots; the palette opens over the pane and the page returns on close; dragging the splitter keeps the page glued to the region; a claude.ai login survives a relaunch; an HTML report opened from the Repo tree updates when the file is rewritten; hiding the window with a page playing a timer stops its CPU in Activity Monitor.
