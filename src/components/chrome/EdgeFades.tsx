/*
 * The two gradients that stand in for a horizontal scrollbar on a tab strip.
 * Drop them in a `relative` wrapper alongside the scroller (they must be
 * siblings of it, not children — anything inside a scroller scrolls with it)
 * and feed them useOverflowEdges(ref).
 *
 * The colour is whatever the strip sits on: --fade-to, defaulting to the app
 * surface, which is what both strips are transparent over today. A strip on a
 * different surface sets --fade-to on the wrapper and the fade follows it into
 * either theme, because both ends of the ramp are tokens.
 */
import type { OverflowEdges } from "@/lib/overflow-edges";
import { cn } from "@/lib/utils";

export function EdgeFades({ edges, className }: { edges: OverflowEdges; className?: string }) {
  // bottom-px, not inset-y-0: the strip's divider runs under the fade and the
  // gradient would otherwise erase its last pixel at both ends
  const base = "pointer-events-none absolute bottom-px top-0 w-8 transition-opacity duration-150";
  return (
    <>
      <span
        aria-hidden
        className={cn(base, "left-0", edges.left ? "opacity-100" : "opacity-0", className)}
        style={{ backgroundImage: "linear-gradient(to right, var(--fade-to, var(--surface-app)), transparent)" }}
      />
      <span
        aria-hidden
        className={cn(base, "right-0", edges.right ? "opacity-100" : "opacity-0", className)}
        style={{ backgroundImage: "linear-gradient(to left, var(--fade-to, var(--surface-app)), transparent)" }}
      />
    </>
  );
}
