/*
 * F8 — toasts (sonner, bottom-center pills on --surface-overlay).
 * Success: glyph + name + mono count. Error: glyph + what happened + how to fix.
 */
import { Toaster, toast } from "sonner";
import { CheckGlyph, ErrorGlyph } from "@/components/chrome/icons";

export function ChronicleToaster() {
  return <Toaster position="bottom-center" gap={8} visibleToasts={3} />;
}

const pill =
  "inline-flex items-center gap-[9px] rounded-full border border-border-strong bg-surface-overlay px-4 py-[9px] shadow-(--shadow-overlay) font-sans";

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
  ));
}

export function toastError(message: string, detail?: string) {
  toast.custom(() => (
    <div className={pill}>
      <span className="text-state-error">
        <ErrorGlyph size={13} />
      </span>
      <span className="text-[12.5px] text-text-primary">{message}</span>
      {detail && <span className="text-xs text-text-muted">{detail}</span>}
    </div>
  ));
}
