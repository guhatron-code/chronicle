/* The Design canvas's keyboard, pure (spec §7 · Keyboard). Plain keys zoom and move,
   as in Figma; ⌘ chords are the app's (⌘1–⌘9 projects, ⌘=/⌘− app zoom, ⌘J panes),
   except ⌘Z / ⇧⌘Z, which undo the user's own canvas and list actions. */
export type CanvasAction =
  | { type: "zoom"; factor: number } | { type: "fit" } | { type: "actual" }
  | { type: "nudge"; dx: number; dy: number } | { type: "next"; back: boolean }
  | { type: "live" } | { type: "exitLive" } | { type: "undo" } | { type: "redo" } | null;

export function canvasKey(e: { key: string; metaKey: boolean; shiftKey: boolean; ctrlKey: boolean; altKey: boolean }): CanvasAction {
  if (e.metaKey) {
    if (e.key.toLowerCase() === "z" && !e.altKey && !e.ctrlKey) return { type: e.shiftKey ? "redo" : "undo" };
    return null;
  }
  if (e.ctrlKey || e.altKey) return null;
  const step = e.shiftKey ? 10 : 1;
  switch (e.key) {
    case "=": case "+": return { type: "zoom", factor: 1.25 };
    case "-": case "_": return { type: "zoom", factor: 0.8 };
    case "0": return { type: "fit" };
    case "1": return { type: "actual" };
    case "ArrowLeft": return { type: "nudge", dx: -step, dy: 0 };
    case "ArrowRight": return { type: "nudge", dx: step, dy: 0 };
    case "ArrowUp": return { type: "nudge", dx: 0, dy: -step };
    case "ArrowDown": return { type: "nudge", dx: 0, dy: step };
    case "Tab": return { type: "next", back: e.shiftKey };
    case "Enter": return { type: "live" };
    case "Escape": return { type: "exitLive" };
    default: return null;
  }
}
