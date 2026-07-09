# Weave design system — how to build with it

Weave's components are **shadcn/ui (new-york, Radix base) + Kibo UI + AI Elements**, re-themed to Weave's
monochrome design language. **Monochrome is the law: colour only ever signals state, never decoration.**
Primary actions are near-white on near-black (dark) / near-black on near-white (light).

## Theming & setup
- **Dark is the default; light is first-class.** Theme is driven by a `data-theme` attribute on the root
  element (`<html data-theme="dark">` or `="light"`), NOT a React provider. All colour comes from CSS
  variables that swap on that attribute — so a component renders themed with no wrapper.
- **Provider wraps** (only where a component reads React context):
  - `Tooltip*` needs `TooltipProvider` near the root.
  - `Sidebar*` needs `SidebarProvider`.
  - Everything else renders standalone.
- **Never hard-code hex.** Always style via the token utility classes below — that is what keeps a design
  on-brand and themable.

## The styling idiom — Tailwind utility classes mapped to Weave tokens
Style with these class families (each resolves to a Weave design token; full set in the stylesheet):

| Purpose | Classes |
|---|---|
| Surfaces | `bg-background` `bg-card` `bg-popover` `bg-muted` `bg-accent` `bg-sidebar` (the monochrome elevation ramp) |
| Text | `text-foreground` `text-muted-foreground` `text-card-foreground` · Weave ramp: `text-text-primary` `text-text-secondary` `text-text-muted` `text-text-subtle` `text-text-dim` |
| Primary action | `bg-primary` `text-primary-foreground` (near-white/near-black, the one loud-yet-calm signal) |
| Borders / focus | `border` `border-border` `border-input` `ring-ring` (hairline borders, never shadows in dark) |
| **State — the ONLY colour** | desaturated, and used ONLY for a real state (a pass, an error, in-progress) — never decoration. Apply via the CSS variable directly: `style={{ color: 'var(--state-success)' }}` (also `--state-error`, `--state-neutral`). |
| Radius | `rounded-sm` (6px) `rounded-md` (8px, default) `rounded-lg` (10px) `rounded-xl` (12px) |
| Type | `font-sans` (Geist, all UI) · `font-mono` (Geist Mono — keys, paths, numbers; add `tabular-nums` on numerics) |

Measured facts and numbers render in near-white/neutral, **never** a state colour. Generous whitespace,
low density, one primary action visible at a time.

## Where the truth lives
- **`styles.css`** (and its `@import` of `_ds_bundle.css`) — the compiled tokens + every utility class.
  Read it before styling; the token variables (`--background`, `--primary`, `--sidebar`, the Weave
  `--surface-*`/`--text-*`/`--state-*` ramps) are all defined there for both themes.
- **`components/<group>/<Name>/<Name>.d.ts`** — each component's prop contract.
- **`components/<group>/<Name>/<Name>.prompt.md`** — per-component usage.

## One idiomatic example
```tsx
import { Button } from '@weave/ui' // window.Weave.Button at runtime

// A calm, monochrome action row on a Weave card surface.
<div className="rounded-lg border border-border bg-card p-4 flex items-center justify-between gap-4">
  <div>
    <div className="text-[15px] font-semibold text-foreground">Publish theme</div>
    <div className="text-[12px] text-muted-foreground">Preview verified · clean Scorecard</div>
  </div>
  <Button>Publish</Button>
</div>
```

# Weave (@weave/ui@0.0.0)

This design system is the published @weave/ui React library, bundled as a single
browser global. All 154 components are the real upstream code.

## Where things are

- `_ds_bundle.js` — the whole-DS bundle at the project root; loads every component to `window.Weave`. First line is a `/* @ds-bundle: … */` metadata header.
- `styles.css` — the single stylesheet entry: it `@import`s the tokens, fonts, and component styles (`_ds_bundle.css`). Link this one file.
- `components/<group>/<Name>/<Name>.prompt.md` (example JSX + variants), `<Name>.d.ts` (types), `<Name>.html` (variant grid).
- `tokens/*.css` — CSS custom properties, names verbatim from upstream.
- `fonts/` — `@font-face` files + `fonts.css` (when the package ships fonts).

For a specific component, `read_file("components/<group>/<Name>/<Name>.prompt.md")`.

## Loading

Add these two lines to your page once (React must be on the page first):

```html
<link rel="stylesheet" href="styles.css">
<script src="_ds_bundle.js"></script>
```

Components are then available at `window.Weave.*`. Mount into a dedicated child node (e.g. `<div id="ds-root">`), not the host page's own React root, so the two trees don't collide:

```jsx
const { Accordion } = window.Weave;
ReactDOM.createRoot(document.getElementById('ds-root')).render(<Accordion />);
```

## Tokens

290 CSS custom properties from @weave/ui. Names are
preserved verbatim from upstream. They are declared inside `_ds_bundle.css` (this DS ships one compiled stylesheet rather than separate token files).

- **color** (119): `--rc-drag-handle-bg-colour`, `--rc-border-color`, `--rc-focus-color`, …
- **spacing** (6): `--tw-space-y-reverse`, `--tw-space-x-reverse`, `--tw-inset-shadow`, …
- **typography** (14): `--font-sans`, `--font-serif`, `--font-mono`, …
- **radius** (4): `--xy-node-border-radius-default`, `--radius-xs`, `--radius-2xl`, …
- **shadow** (12): `--xy-node-boxshadow-hover-default`, `--xy-node-boxshadow-selected-default`, `--xy-controls-box-shadow-default`, …
- **other** (135): `--rc-drag-handle-size`, `--rc-drag-handle-mobile-size`, `--rc-drag-bar-size`, …

## Components

### general
- `Accordion`
- `Alert`
- `AlertDialog`
- `AspectRatio`
- `Attachment`
- `Avatar`
- `Badge`
- `Breadcrumb`
- `Bubble`
- `Button`
- `ButtonGroup`
- `Calendar`
- `Card`
- `Carousel`
- `Checkbox`
- `Collapsible`
- `Command`
- `ContextMenu`
- `Dialog`
- `DirectionProvider`
- `Drawer`
- `DropdownMenu`
- `Empty`
- `Field`
- `Form`
- `HoverCard`
- `Input`
- `InputGroup`
- `InputOTP`
- `Item`
- `Kbd`
- `Label`
- `Marker`
- `Menubar`
- `MessageScroller`
- `NativeSelect`
- `NavigationMenu`
- `Pagination`
- `Popover`
- `Progress`
- `RadioGroup`
- `ResizablePanel`
- `ScrollArea`
- `Select`
- `Separator`
- `Sheet`
- `Sidebar`
- `Skeleton`
- `Slider`
- `Switch`
- `Table`
- `Tabs`
- `Textarea`
- `Toaster`
- `Toggle`
- `ToggleGroup`
- `Tooltip`

### kibo-ui
- `Announcement`
- `Banner`
- `Choicebox`
- `Combobox`
- `Comparison`
- `Cursor`
- `Deck`
- `Dropzone`
- `Glimpse`
- `Marquee`
- `Pill`
- `Rating`
- `Reel`
- `Snippet`
- `Spinner`
- `Status`
- `Stories`
- `Tags`
- `Ticker`

### ai-elements
- `Artifact`
- `Canvas`
- `ChainOfThought`
- `Checkpoint`
- `Confirmation`
- `Connection`
- `Controls`
- `Conversation`
- `Edge`
- `ExampleChainOfThought`
- `ExampleChatbot`
- `ExampleCheckpoint`
- `ExampleConfirmation`
- `ExampleConfirmationAccepted`
- `ExampleConfirmationRejected`
- `ExampleConfirmationRequest`
- `ExampleConversation`
- `ExampleDemoChatgpt`
- `ExampleDemoClaude`
- `ExampleDemoGrok`
- `ExampleDemoWorkflow`
- `ExampleImage`
- `ExampleInlineCitation`
- `ExampleLoader`
- `ExampleLoaderCustom`
- `ExampleLoaderSizes`
- `ExampleMessage`
- `ExampleMessageFlat`
- `ExampleOpenInChat`
- `ExamplePlan`
- `ExamplePromptInput`
- `ExamplePromptInputCursor`
- `ExampleQueue`
- `ExampleQueuePromptInput`
- `ExampleReasoning`
- `ExampleShimmer`
- `ExampleShimmerDuration`
- `ExampleShimmerElements`
- `ExampleSources`
- `ExampleSourcesCustom`
- `ExampleSuggestion`
- `ExampleSuggestionInput`
- `ExampleV0Clone`
- `ExampleWebPreview`
- `ExampleWorkflow`
- `Image`
- `InlineCitation`
- `Loader`
- `Message`
- `Node`
- `OpenIn`
- `Panel`
- `Plan`
- `PromptInput`
- `Queue`
- `Reasoning`
- `Shimmer`
- `Sources`
- `Suggestion`
- `Task`
- `Toolbar`
- `WebPreview`

### avatar-stack
- `AvatarStack`

### calendar
- `CalendarBody`

### color-picker
- `ColorPicker`

### contribution-graph
- `ContributionGraph`

### dialog-stack
- `DialogStack`

### gantt
- `GanttToday`

### image-crop
- `ImageCrop`

### image-zoom
- `ImageZoom`

### kanban
- `KanbanCard`

### list
- `ListItem`

### mini-calendar
- `MiniCalendar`

### qr-code
- `QRCode`

### relative-time
- `RelativeTime`

### table
- `TableRow`

### theme-switcher
- `ThemeSwitcher`

### tree
- `TreeIcon`
