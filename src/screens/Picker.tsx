/*
 * F1/F3/F4 + L6 — the launch screen. The only surface with no terminal.
 * Backdrop (F4): a static monochrome radial vignette (2.5% white) — the v1 water
 * shader is deliberately dropped; reduced-motion-safe by construction.
 */
import { BtnPrimary, BtnSecondary, Eyebrow } from "@/components/chrome/atoms";
import { BrandGlyph } from "@/components/chrome/icons";
import { RecentCard, type RecentProject } from "./RecentCard";

export function Picker({
  recents,
  onOpenDialog,
  onNewProject,
  onOpenProject,
  onRemoveRecent,
  onLocate,
  update,
}: {
  recents: RecentProject[];
  onOpenDialog: () => void;
  onNewProject: () => void;
  onOpenProject: (path: string) => void;
  onRemoveRecent: (path: string) => void;
  onLocate?: (path: string) => void;
  /** A newer Chronicle is ready — one dismissable line, never a modal. */
  update?: { version: string; busy: boolean; onInstall: () => void; onDismiss: () => void } | null;
}) {
  return (
    <div className="relative h-full overflow-y-auto">
      {update && (
        <div className="flex items-center justify-center gap-3 border-b border-divider px-6 py-2">
          <span className="text-[12px] text-text-secondary">
            Chronicle {update.version} is ready
          </span>
          <button
            disabled={update.busy}
            onClick={update.onInstall}
            className="text-[12px] font-medium text-text-primary underline underline-offset-2 hover:text-text-secondary disabled:opacity-55"
          >
            {update.busy ? "Updating…" : "Update and restart"}
          </button>
          {!update.busy && (
            <button
              onClick={update.onDismiss}
              className="text-[12px] text-text-dim hover:text-text-secondary"
            >
              Not now
            </button>
          )}
        </div>
      )}
      {/* L6: hero padding 84/64/72; the vignette sits behind it */}
      <div
        className="relative px-16 pb-[72px] pt-[84px]"
        style={{
          background:
            "radial-gradient(ellipse 70% 55% at 50% 0%, rgba(255,255,255,.025), transparent)",
        }}
      >
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex size-11 items-center justify-center rounded-xl border border-border-strong bg-surface-card-raised text-text-secondary">
            <BrandGlyph size={26} />
          </div>
          <div className="text-[21px] font-semibold text-text-primary">Chronicle</div>
          <div className="text-[13px] text-text-muted">
            Open a folder and see where its build stands.
          </div>
          <div className="mt-2.5 flex gap-2.5">
            <BtnPrimary onClick={onOpenDialog}>
              Open a project…
              <span className="font-mono text-[11px] opacity-55">⌘O</span>
            </BtnPrimary>
            <BtnSecondary className="h-9" onClick={onNewProject}>
              New blank project
            </BtnSecondary>
          </div>
        </div>

        {/* Recents — L6: max-width 920 centered, 60px below the hero */}
        <div className="mx-auto mt-[60px] flex max-w-[920px] flex-col gap-3">
          <div className="flex items-baseline justify-between">
            <Eyebrow>Recents</Eyebrow>
            <span className="font-mono text-[11.5px] text-text-dim tabular-nums">
              {recents.length} project{recents.length === 1 ? "" : "s"}
            </span>
          </div>
          {recents.length === 0 ? (
            /* F3 — empty state */
            <div className="flex items-center justify-center rounded-lg border border-dashed border-border-strong px-[18px] py-[26px]">
              <span className="text-[12.5px] text-text-subtle">
                Nothing yet. Your first project will appear here.
              </span>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {recents.map((r) => (
                <RecentCard
                  key={r.path}
                  project={r}
                  onOpen={onOpenProject}
                  onRemove={onRemoveRecent}
                  onLocate={onLocate}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
