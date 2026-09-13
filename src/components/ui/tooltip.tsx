import * as React from "react"
import { Tooltip as TooltipPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"
import { MENU_SURFACE_BASE } from "@/components/ui/dropdown-menu"

function TooltipProvider({
  delayDuration = 0,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delayDuration={delayDuration}
      {...props}
    />
  )
}

function Tooltip({
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  return <TooltipPrimitive.Root data-slot="tooltip" {...props} />
}

function TooltipTrigger({
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />
}

/* The house surface again, not shadcn's inverted slab: a tooltip is the
 * smallest floating thing the app has, so it reads as the same material as the
 * menus rather than as a black chip. No arrow — the offset says where it came
 * from, and the arrow was the one thing Rail's inline override could not fix.
 * It rides the popover rung of the ladder like the menus do. */
const TOOLTIP_SURFACE =
  "w-fit max-w-[280px] origin-(--radix-tooltip-content-transform-origin) px-2.5 py-1.5 text-xs text-text-primary text-balance animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95"

function TooltipContent({
  className,
  sideOffset = 6,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          "z-(--z-popover) " + MENU_SURFACE_BASE,
          // a tooltip is not a list of rows: no scroller, no 8rem floor
          "min-w-0 overflow-visible p-0",
          TOOLTIP_SURFACE,
          className
        )}
        {...props}
      >
        {children}
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  )
}

/** One label on one control. `mono` is the key hint that follows it, in the
 *  app's mono face — "Roadmap · ⌘J to cycle". The child must forward a ref and
 *  its props (a DOM element, or a component built on one). */
function Hint({
  label,
  mono,
  side,
  align,
  sideOffset,
  children,
}: {
  label: React.ReactNode
  mono?: string
  side?: React.ComponentProps<typeof TooltipPrimitive.Content>["side"]
  align?: React.ComponentProps<typeof TooltipPrimitive.Content>["align"]
  sideOffset?: number
  children: React.ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side} align={align} sideOffset={sideOffset} className="flex items-center gap-2">
        {label}
        {mono && <span className="shrink-0 font-mono text-[10px] text-text-dim">{mono}</span>}
      </TooltipContent>
    </Tooltip>
  )
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider, Hint }
