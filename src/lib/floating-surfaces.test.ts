// The floating surfaces — menus, popovers, dialogs, tooltips, toasts — are one
// skin declared once, plus a single stacking ladder. Both are easy to undo by
// accident: a `shadcn add` rewrites a primitive back to its stock scaffold, and
// a new overlay reaches for a bare `z-50` because that is what the deck shows.
// This pins the ladder and the shared constants so either regression fails here
// rather than in the window.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  MENU_HEADING,
  MENU_ITEM,
  MENU_SURFACE,
  MENU_SURFACE_BASE,
} from "@/components/ui/dropdown-menu";
import { DIALOG_SURFACE } from "@/components/ui/dialog";

const src = (rel: string) => readFileSync(path.resolve(__dirname, "..", rel), "utf8");
/** Comments name the tokens they replaced; only the code decides. */
const code = (rel: string) => src(rel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
const css = src("index.css");

/** Every floating surface in the app's own screens and primitives. */
const FLOATING = [
  "components/ui/dropdown-menu.tsx",
  "components/ui/context-menu.tsx",
  "components/ui/popover.tsx",
  "components/ui/dialog.tsx",
  "components/ui/alert-dialog.tsx",
];

describe("the stacking ladder", () => {
  it("declares all four rungs, in order", () => {
    const rung = (name: string) => {
      const m = new RegExp(`--z-${name}:\\s*(\\d+)`).exec(css);
      expect(m, `--z-${name} is missing from index.css`).not.toBeNull();
      return Number(m![1]);
    };
    const [popover, overlay, modal, toast] = [
      rung("popover"),
      rung("overlay"),
      rung("modal"),
      rung("toast"),
    ];
    expect(popover).toBeLessThan(overlay);
    expect(overlay).toBeLessThan(modal);
    expect(modal).toBeLessThan(toast);
  });

  it("is what the primitives climb — no bare z-50 left in them", () => {
    for (const rel of FLOATING) {
      const text = code(rel);
      expect(text, `${rel} still hard-codes a z-index`).not.toMatch(/["' ]z-\d+[ "']/);
      expect(text, `${rel} does not use the ladder`).toMatch(/z-\(--z-(popover|overlay|modal)\)/);
    }
  });
});

describe("the shared menu skin", () => {
  it("is the house surface, not shadcn's scaffold", () => {
    expect(MENU_SURFACE_BASE).toContain("bg-surface-overlay");
    expect(MENU_SURFACE_BASE).toContain("border-border-strong");
    expect(MENU_SURFACE_BASE).toContain("[box-shadow:var(--shadow-overlay)]");
    // radius stays on the scale: lg is 10px, xl is 12px
    expect(MENU_SURFACE_BASE).toContain("rounded-lg");
    expect(DIALOG_SURFACE).toContain("rounded-xl");
    expect(DIALOG_SURFACE).toContain("bg-surface-overlay");
  });

  it("keeps the one row metric and the one heading ramp", () => {
    expect(MENU_ITEM).toContain("h-[26px]");
    expect(MENU_ITEM).toContain("text-[12px]");
    expect(MENU_ITEM).toContain("focus:bg-fill-hover");
    expect(MENU_HEADING).toContain("text-[10px]");
    expect(MENU_HEADING).toContain("tracking-[0.09em]");
  });

  it("carries the dropdown's own Radix vars only in MENU_SURFACE", () => {
    expect(MENU_SURFACE).toContain("--radix-dropdown-menu-content-available-height");
    expect(MENU_SURFACE_BASE).not.toContain("--radix-");
  });

  it("is what the context menu and the popover are built from", () => {
    for (const rel of ["components/ui/context-menu.tsx", "components/ui/popover.tsx"]) {
      expect(src(rel)).toContain("MENU_SURFACE_BASE");
    }
  });

  it("leaves no stock shadcn tokens in the menu families", () => {
    for (const rel of FLOATING) {
      const text = code(rel);
      for (const stock of ["bg-popover", "bg-accent", "text-muted-foreground", "shadow-md", "shadow-lg"]) {
        expect(text, `${rel} still uses ${stock}`).not.toContain(stock);
      }
    }
  });
});
