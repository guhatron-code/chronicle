/*
 * F8 — toasts (sonner, top-right pills on --surface-overlay). A native child
 * webview always paints over the app's DOM, so a toast anywhere above the Web
 * pane's page region would be invisible. Top-right puts them over the pane's own
 * DOM chrome — the tab strip and address bar — never over the native page
 * region, whatever the column layout does. The 44px offset clears the 38px
 * title bar. Success: glyph + name + mono count. Error: glyph + what happened
 * + how to fix.
 */
import { Toaster, toast } from "sonner";
import { CheckGlyph, ErrorGlyph } from "@/components/chrome/icons";
import { openUrl } from "@/lib/ipc";

export function ChronicleToaster() {
  // NOTE: never set --width to max-content — sonner centers the stack via
  // margin-left: calc(var(--width) / 2 * -1), and calc() with a keyword is
  // invalid, which shoved every toast right of center. The default numeric
  // width stays; the [data-x-position='center'] centering rule in index.css
  // simply stops matching now that toasts sit top-right.
  return <Toaster position="top-right" offset={44} gap={8} visibleToasts={2} />;
}

const pill =
  "inline-flex w-max items-center gap-[9px] whitespace-nowrap rounded-full border border-border-strong bg-surface-overlay px-4 py-[9px] [box-shadow:var(--shadow-overlay)] font-sans";

export function toastSuccess(message: string, monoDetail?: string) {
  toast.custom(() => (
    <div className={pill}>
      <span className="text-state-success">
        <CheckGlyph size={13} />
      </span>
      <span className="text-[12.5px] text-text-primary">{message}</span>
      {monoDetail && (
        <span className="font-mono text-[11.5px] text-text-dim tabular-nums">{monoDetail}</span>
      )}
    </div>
  ), { duration: 2100 });
}

/** E — a success pill with one action button (the PR hint). */
export function toastAction(message: string, actionLabel: string, onAction: () => void, monoDetail?: string) {
  toast.custom((id) => (
    <div className={pill.replace("px-4", "py-2 pl-4 pr-2.5")}>
      <span className="text-state-success">
        <CheckGlyph size={13} />
      </span>
      <span className="text-[12.5px] text-text-primary">{message}</span>
      {monoDetail && (
        <span className="font-mono text-[11.5px] text-text-dim tabular-nums">{monoDetail}</span>
      )}
      <button
        onClick={() => { toast.dismiss(id); onAction(); }}
        className="h-[26px] rounded-full border border-border-strong px-[11px] text-[11.5px] font-medium text-text-primary hover:bg-fill-hover"
      >
        {actionLabel}
      </button>
    </div>
  ), { duration: 6000 });
}

export function toastError(message: string, detail?: string) {
  toast.custom(() => (
    <div className={pill}>
      <span className="text-state-error">
        <ErrorGlyph size={13} />
      </span>
      <span className="text-[12.5px] text-text-primary">{message}</span>
      {detail && <span data-selectable className="text-xs text-text-muted">{detail}</span>}
    </div>
  ), { duration: 2100 });
}

/** E — one toast per remote outcome: plain words lead, raw git stays mono,
 *  the GitHub PR hint becomes an action. */
export function toastRemoteOutcome(r: { headline: string; detail: string; prUrl: string | null }) {
  if (r.prUrl) {
    const url = r.prUrl;
    toastAction(r.headline, "Create a pull request", () => void openUrl(url).catch(() => {}), r.detail || undefined);
  } else {
    toastSuccess(r.headline, r.detail || undefined);
  }
}
