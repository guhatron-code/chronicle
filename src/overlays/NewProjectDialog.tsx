/*
 * F7 — the new blank project dialog (shadcn dialog + input). Inline error, no
 * apology; Create disabled while invalid. Live ~/dev/<name> path preview.
 */
import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { BtnPrimary, BtnSecondary } from "@/components/chrome/atoms";
import { ErrorGlyph, FolderPlusGlyph } from "@/components/chrome/icons";
import { cn } from "@/lib/utils";

export function NewProjectDialog({
  open,
  onOpenChange,
  error,
  onCreate,
  onClearError,
  basePath = "~/Documents",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  error: string | null;
  onCreate: (name: string) => void;
  onClearError?: () => void;
  basePath?: string;
}) {
  const [name, setName] = useState("");
  useEffect(() => {
    if (!open) setName("");
  }, [open]);
  const invalid = error !== null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="flex max-w-[420px] flex-col gap-3 rounded-xl border-border-strong bg-surface-overlay p-5 [box-shadow:var(--shadow-overlay)] sm:max-w-[420px]"
      >
        <div className="flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-lg border border-border-strong bg-surface-card-raised text-text-secondary">
            <FolderPlusGlyph />
          </span>
          <div>
            <DialogTitle className="text-[15px] font-semibold text-text-primary">
              New blank project
            </DialogTitle>
            <div className="text-[12.5px] text-text-muted">
              A folder with history started, ready to build in.
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="np-name" className="text-[12.5px] text-text-muted">
            Project name
          </label>
          <Input
            id="np-name"
            autoFocus
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (error) onClearError?.(); // a stale error must not outlive the edit
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && name.trim()) onCreate(name.trim());
            }}
            aria-invalid={invalid}
            className={cn(
              "h-9 rounded-md border-border-field bg-surface-input text-[13px] text-text-primary shadow-none dark:bg-surface-input md:text-[13px]",
              "focus-visible:border-border-field-focus focus-visible:[box-shadow:var(--focus-ring)]! focus-visible:ring-0",
              invalid && "border-state-error focus-visible:border-state-error focus-visible:[box-shadow:none]",
            )}
          />
          {invalid ? (
            <div className="flex items-center gap-1.5 text-xs text-state-error">
              <ErrorGlyph size={11} />
              {error}
            </div>
          ) : (
            name.trim() && (
              <div className="font-mono text-[11px] text-text-dim">
                {basePath}/{name.trim()}
              </div>
            )
          )}
        </div>

        <div className="flex justify-end gap-2">
          <BtnSecondary onClick={() => onOpenChange(false)}>Cancel</BtnSecondary>
          <BtnPrimary
            className="h-[34px] px-3.5"
            disabled={!name.trim() || invalid}
            onClick={() => onCreate(name.trim())}
          >
            Create
          </BtnPrimary>
        </div>
      </DialogContent>
    </Dialog>
  );
}
