import * as React from "react"
import { CheckIcon, ChevronRightIcon } from "lucide-react"
import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function DropdownMenu({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Root>) {
  return <DropdownMenuPrimitive.Root data-slot="dropdown-menu" {...props} />
}

function DropdownMenuPortal({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Portal>) {
  return (
    <DropdownMenuPrimitive.Portal data-slot="dropdown-menu-portal" {...props} />
  )
}

function DropdownMenuTrigger({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Trigger>) {
  return (
    <DropdownMenuPrimitive.Trigger
      data-slot="dropdown-menu-trigger"
      {...props}
    />
  )
}

/*
 * Chronicle's chrome, not shadcn's defaults: a raised overlay surface, a
 * hairline-strong border and the app's own shadow token (matching
 * ConfirmDialog, the suggesters' popup, and SearchOverlay's dialog) — never
 * `bg-popover`/`shadow-md`. `outline-none` because Radix focuses the content
 * div on open; without it the browser draws its own default focus ring on
 * top of everything (no rule in index.css strips a plain, non-:focus-visible
 * outline).
 *
 * MENU_SURFACE_BASE is everything that is NOT tied to one Radix primitive's
 * own CSS variables. The context menu and the popover build their surface out
 * of it plus their own `--radix-<primitive>-content-*` vars, so the floating
 * families stay one skin. Those var-bearing utilities have to be written out
 * literally in each file — Tailwind scans source text, it does not evaluate
 * template strings.
 */
export const MENU_SURFACE_BASE =
  "min-w-[8rem] overflow-x-hidden overflow-y-auto rounded-lg border border-border-strong bg-surface-overlay p-1.5 text-text-secondary outline-none [box-shadow:var(--shadow-overlay)] data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"

export const MENU_SURFACE =
  "z-50 max-h-(--radix-dropdown-menu-content-available-height) origin-(--radix-dropdown-menu-content-transform-origin) " +
  MENU_SURFACE_BASE

/* One group heading for every list that has them — the command palette, the
 * global search, the composer's autocomplete and the note suggesters all used
 * to declare this ramp as a literal of their own. */
export const MENU_HEADING =
  "px-2.5 pb-[5px] pt-2 text-[10px] uppercase tracking-[0.09em] text-text-dimmer"

function DropdownMenuContent({
  className,
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        data-slot="dropdown-menu-content"
        sideOffset={sideOffset}
        className={cn(MENU_SURFACE, className)}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  )
}

function DropdownMenuGroup({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Group>) {
  return (
    <DropdownMenuPrimitive.Group data-slot="dropdown-menu-group" {...props} />
  )
}

/* The item row: 12px (the app's menu-row size — see the suggesters' popup and
 * SearchOverlay's CommandItem), the app's hover fill instead of the shadcn
 * accent tokens, no focus ring. */
export const MENU_ITEM =
  "relative flex h-[26px] cursor-default items-center gap-2 rounded-md px-2 text-[12px] outline-none select-none focus:bg-fill-hover focus:text-text-primary data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[inset]:pl-8 data-[variant=destructive]:text-destructive data-[variant=destructive]:focus:bg-destructive/10 data-[variant=destructive]:focus:text-destructive dark:data-[variant=destructive]:focus:bg-destructive/20 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5 [&_svg:not([class*='text-'])]:text-text-dim data-[variant=destructive]:*:[svg]:text-destructive!"

function DropdownMenuItem({
  className,
  inset,
  variant = "default",
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Item> & {
  inset?: boolean
  variant?: "default" | "destructive"
}) {
  return (
    <DropdownMenuPrimitive.Item
      data-slot="dropdown-menu-item"
      data-inset={inset}
      data-variant={variant}
      className={cn(MENU_ITEM, className)}
      {...props}
    />
  )
}

/* A row that reserves the left gutter for its check/dot indicator. */
export const MENU_ITEM_INDICATED =
  "relative flex h-[26px] cursor-default items-center gap-2 rounded-md py-1.5 pr-2 pl-8 text-[12px] outline-none select-none focus:bg-fill-hover focus:text-text-primary data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5"

/* The sub-menu's own trigger row — MENU_ITEM plus the open-state fill. */
export const MENU_SUB_TRIGGER =
  "flex h-[26px] cursor-default items-center gap-2 rounded-md px-2 text-[12px] outline-none select-none focus:bg-fill-hover focus:text-text-primary data-[inset]:pl-8 data-[state=open]:bg-fill-hover data-[state=open]:text-text-primary [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5 [&_svg:not([class*='text-'])]:text-text-dim"

/** The hairline that separates two groups of rows. */
export const MENU_SEPARATOR = "-mx-1 my-1 h-px bg-border-hairline"

/** The muted label above a group of rows (inside a menu, not a list). */
export const MENU_LABEL =
  "px-2 py-1.5 text-[11px] font-medium text-text-dim data-[inset]:pl-8"

/** The key hint parked at the right edge of a row. */
export const MENU_SHORTCUT = "ml-auto text-[10.5px] tracking-widest text-text-dimmer"

function DropdownMenuCheckboxItem({
  className,
  children,
  checked,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.CheckboxItem>) {
  return (
    <DropdownMenuPrimitive.CheckboxItem
      data-slot="dropdown-menu-checkbox-item"
      className={cn(MENU_ITEM_INDICATED, className)}
      checked={checked}
      {...props}
    >
      <span className="pointer-events-none absolute left-2 top-1/2 flex size-3.5 -translate-y-1/2 items-center justify-center">
        <DropdownMenuPrimitive.ItemIndicator>
          <CheckIcon className="size-3.5" />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.CheckboxItem>
  )
}

function DropdownMenuRadioGroup({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.RadioGroup>) {
  return (
    <DropdownMenuPrimitive.RadioGroup
      data-slot="dropdown-menu-radio-group"
      {...props}
    />
  )
}

function DropdownMenuRadioItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.RadioItem>) {
  return (
    <DropdownMenuPrimitive.RadioItem
      data-slot="dropdown-menu-radio-item"
      className={cn(MENU_ITEM_INDICATED, className)}
      {...props}
    >
      <span className="pointer-events-none absolute left-2 top-1/2 flex size-3.5 -translate-y-1/2 items-center justify-center">
        <DropdownMenuPrimitive.ItemIndicator>
          <CheckIcon className="size-3.5" />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.RadioItem>
  )
}

function DropdownMenuLabel({
  className,
  inset,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Label> & {
  inset?: boolean
}) {
  return (
    <DropdownMenuPrimitive.Label
      data-slot="dropdown-menu-label"
      data-inset={inset}
      className={cn(MENU_LABEL, className)}
      {...props}
    />
  )
}

function DropdownMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return (
    <DropdownMenuPrimitive.Separator
      data-slot="dropdown-menu-separator"
      className={cn(MENU_SEPARATOR, className)}
      {...props}
    />
  )
}

function DropdownMenuShortcut({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="dropdown-menu-shortcut"
      className={cn(MENU_SHORTCUT, className)}
      {...props}
    />
  )
}

function DropdownMenuSub({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Sub>) {
  return <DropdownMenuPrimitive.Sub data-slot="dropdown-menu-sub" {...props} />
}

function DropdownMenuSubTrigger({
  className,
  inset,
  children,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.SubTrigger> & {
  inset?: boolean
}) {
  return (
    <DropdownMenuPrimitive.SubTrigger
      data-slot="dropdown-menu-sub-trigger"
      data-inset={inset}
      className={cn(MENU_SUB_TRIGGER, className)}
      {...props}
    >
      {children}
      <ChevronRightIcon className="ml-auto size-3" />
    </DropdownMenuPrimitive.SubTrigger>
  )
}

function DropdownMenuSubContent({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.SubContent>) {
  return (
    <DropdownMenuPrimitive.SubContent
      data-slot="dropdown-menu-sub-content"
      className={cn(MENU_SURFACE, className)}
      {...props}
    />
  )
}

export {
  DropdownMenu,
  DropdownMenuPortal,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
}
