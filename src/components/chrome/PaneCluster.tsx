/*
 * F31 — the pane-visibility cluster. Three toggles (content · agent · terminal)
 * on the title bar's right side, leftmost of the update line. Visible = quiet
 * fill, hidden = dim outline; the toggle that would hide the LAST visible unit
 * disables ("The last pane stays open"). Keyboard twins: ⌥⌘1/2/3.
 */
import { cn } from "@/lib/utils";

export type PaneUnit = "content" | "agent" | "terminal";
export type PaneVisibility = Record<PaneUnit, boolean>;

const KBD: Record<PaneUnit, string> = { content: "⌥⌘1", agent: "⌥⌘2", terminal: "⌥⌘3" };
const NAME: Record<PaneUnit, string> = { content: "the content pane", agent: "the agent", terminal: "the terminal" };

function UnitIcon({ unit }: { unit: PaneUnit }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
      <rect x="2" y="3" width="12" height="10" rx="1.5" />
      {unit === "content" ? (
        <rect x="3.6" y="4.6" width="3.6" height="6.8" rx="0.8" fill="currentColor" stroke="none" />
      ) : (
        <>
          <path d="M9.5 3v10" />
          <rect x="10.9" y={unit === "agent" ? "4.5" : "8.6"} width="1.9" height="3" rx="0.6" fill="currentColor" stroke="none" />
        </>
      )}
    </svg>
  );
}

export function PaneCluster({
  visibility,
  onToggle,
}: {
  visibility: PaneVisibility;
  onToggle: (unit: PaneUnit) => void;
}) {
  const visibleCount = (["content", "agent", "terminal"] as PaneUnit[]).filter((u) => visibility[u]).length;
  return (
    <div className="flex items-center gap-0.5 rounded-md border border-border-hairline p-0.5" data-no-zoom>
      {(["content", "agent", "terminal"] as PaneUnit[]).map((unit) => {
        const visible = visibility[unit];
        const last = visible && visibleCount === 1; // the floor: never hide the last unit
        return (
          <button
            key={unit}
            aria-label={last ? "The last pane stays open" : `${visible ? "Hide" : "Show"} ${NAME[unit]}`}
            aria-pressed={visible}
            data-pane-toggle={unit}
            disabled={last}
            title={last ? "The last pane stays open" : `${visible ? "Hide" : "Show"} ${NAME[unit]} — ${KBD[unit]}`}
            onClick={() => onToggle(unit)}
            className={cn(
              "flex size-6 items-center justify-center rounded-[6px]",
              visible ? "bg-fill-hover text-text-primary" : "text-text-dimmer hover:bg-fill-subtle hover:text-text-secondary",
              last && "cursor-default opacity-45",
            )}
          >
            <UnitIcon unit={unit} />
          </button>
        );
      })}
    </div>
  );
}
