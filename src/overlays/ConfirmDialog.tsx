/*
 * F6 — the confirm dialog, four variants on one anatomy (shadcn alert-dialog):
 * neutral · danger · live-terminal · live-project. The danger confirm carries
 * --state-error; buttons say what actually happens (copy comes from the caller).
 */
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { BtnPrimary, BtnSecondary } from "@/components/chrome/atoms";
import { cn } from "@/lib/utils";

export type ConfirmSpec = {
  title: string;
  body: string;
  cancelLabel: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  /** A third answer between Cancel and Confirm — "Discard" on the save prompt.
   *  Absent on every other confirm, which stays a two-button dialog. */
  altLabel?: string;
  onAlt?: () => void;
  /** The dialog went away without an answer — Cancel, Escape, a click outside.
   *  `onClose` fires on every path, so a caller that must know it was refused
   *  (the quit guard resolving `false`) listens here instead. */
  onCancel?: () => void;
};

export function ConfirmDialog({
  spec,
  onClose,
}: {
  spec: ConfirmSpec | null;
  onClose: () => void;
}) {
  const dismiss = () => {
    spec?.onCancel?.();
    onClose();
  };

  return (
    <AlertDialog open={spec !== null} onOpenChange={(o) => !o && dismiss()}>
      {spec && (
        <AlertDialogContent className="max-w-[400px] gap-0 rounded-xl border-border-strong bg-surface-overlay p-5 [box-shadow:var(--shadow-overlay)] sm:max-w-[400px]">
          <AlertDialogTitle className="text-[15px] font-semibold text-text-primary">
            {spec.title}
          </AlertDialogTitle>
          <AlertDialogDescription className="mt-2 text-[13px] leading-[1.55] text-text-muted">
            {spec.body}
          </AlertDialogDescription>
          <div className="mt-[18px] flex justify-end gap-2">
            <BtnSecondary onClick={dismiss}>{spec.cancelLabel}</BtnSecondary>
            {spec.altLabel && (
              <BtnSecondary
                onClick={() => {
                  spec.onAlt?.();
                  onClose();
                }}
              >
                {spec.altLabel}
              </BtnSecondary>
            )}
            <BtnPrimary
              className={cn(
                spec.danger && "bg-state-error text-primary-foreground hover:bg-state-error hover:opacity-90",
              )}
              onClick={() => {
                spec.onConfirm();
                onClose();
              }}
            >
              {spec.confirmLabel}
            </BtnPrimary>
          </div>
        </AlertDialogContent>
      )}
    </AlertDialog>
  );
}
