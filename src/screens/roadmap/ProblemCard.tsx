/*
 * F17 (Deck 3) — manifest-problem cards. One anatomy, six variants: part-of-another /
 * can't-read / blank / misplaced / scan-failed / basic-view marker. Errors say what
 * went wrong and how to fix it; no apologies. Presentational only.
 */
import type { ReactNode } from "react";
import { BtnPrimary, BtnSecondary, Eyebrow } from "@/components/chrome/atoms";
import { ErrorGlyph } from "@/components/chrome/icons";
import { cn } from "@/lib/utils";

export type ProblemCardProps =
  | { kind: "part-of"; projectName: string; path: string; onOpen?: () => void; className?: string }
  | {
      kind: "cant-read";
      /** The mono error line, e.g. `ROADMAP.md:41 — unclosed phase block "EL-1"`. */
      detail: string;
      onOpenFile?: () => void;
      onRescan?: () => void;
      className?: string;
    }
  | { kind: "blank"; onBuild?: () => void; className?: string }
  | { kind: "misplaced"; foundIn: string; onMove?: () => void; onLeave?: () => void; className?: string }
  | {
      kind: "scan-failed";
      /** The mono error line, e.g. `session exited with code 1 after 42s`. */
      detail: string;
      onRetry?: () => void;
      onBasicView?: () => void;
      className?: string;
    }
  | { kind: "basic-view"; onBuild?: () => void; className?: string };

const Title = ({ error, children }: { error?: boolean; children: ReactNode }) =>
  error ? (
    <div className="flex items-center gap-[7px] text-sm font-medium text-text-primary">
      <ErrorGlyph size={13} className="text-state-error" />
      {children}
    </div>
  ) : (
    <div className="text-sm font-medium text-text-primary">{children}</div>
  );

const Body = ({ children }: { children: ReactNode }) => (
  <div className="text-[12.5px] leading-[1.5] text-text-muted">{children}</div>
);

/** The mono error line — surface-input, radius 8, no border (log-pane law). */
const Detail = ({ children }: { children: ReactNode }) => (
  <div className="rounded-md bg-surface-input px-2.5 py-2 font-mono text-[11px] text-state-error [overflow-wrap:anywhere]">
    {children}
  </div>
);

const Primary = ({ label, onClick }: { label: string; onClick?: () => void }) => (
  <BtnPrimary className="h-[31px] px-3 text-[12.5px]" onClick={onClick}>
    {label}
  </BtnPrimary>
);

const Secondary = ({ label, onClick }: { label: string; onClick?: () => void }) => (
  <BtnSecondary className="h-[31px] px-3 text-[12.5px]" onClick={onClick}>
    {label}
  </BtnSecondary>
);

export function ProblemCard(p: ProblemCardProps) {
  return (
    <div
      className={cn(
        "flex flex-1 flex-col gap-2.5 rounded-lg border border-border-hairline bg-surface-card p-[18px]",
        p.className,
      )}
    >
      {p.kind === "part-of" && (
        <>
          <Title>This folder is part of {p.projectName}</Title>
          <Body>
            Its roadmap lives one level up, at{" "}
            <span className="font-mono text-[11.5px] text-text-subtle">{p.path}</span>.
          </Body>
          <div>
            <Primary label={`Open ${p.projectName}`} onClick={p.onOpen} />
          </div>
        </>
      )}

      {p.kind === "cant-read" && (
        <>
          <Title error>The roadmap can't be read</Title>
          <Body>The file exists but isn't valid. Fix it by hand, or run the scan to rewrite it.</Body>
          <Detail>{p.detail}</Detail>
          <div className="flex gap-2">
            <Secondary label="Open the file" onClick={p.onOpenFile} />
            <Primary label="Run the scan again" onClick={p.onRescan} />
          </div>
        </>
      )}

      {p.kind === "blank" && (
        <>
          <Title>No roadmap yet</Title>
          <Body>This project is a blank page. Build a roadmap when there's a plan to track.</Body>
          <div>
            <Primary label="Build roadmap" onClick={p.onBuild} />
          </div>
        </>
      )}

      {p.kind === "misplaced" && (
        <>
          <Title>Found a roadmap inside {p.foundIn}</Title>
          <Body>Chronicle reads it from the project root. Moving it is one rename — nothing else changes.</Body>
          <div className="flex gap-2">
            <Primary label="Move it here" onClick={p.onMove} />
            <button
              onClick={p.onLeave}
              className="h-[31px] rounded-md px-3 text-[12.5px] text-text-dim hover:bg-fill-hover hover:text-text-secondary"
            >
              Leave it
            </button>
          </div>
        </>
      )}

      {p.kind === "scan-failed" && (
        <>
          <Title error>The scan didn't finish</Title>
          <Body>The session ended before the roadmap was written. Running it again usually works.</Body>
          <Detail>{p.detail}</Detail>
          <div className="flex gap-2">
            <Primary label="Try again" onClick={p.onRetry} />
            <Secondary label="Use the basic view" onClick={p.onBasicView} />
          </div>
        </>
      )}

      {p.kind === "basic-view" && (
        <>
          <Eyebrow>Basic view · files and history only</Eyebrow>
          <Body>
            No roadmap is being tracked. The Repo and Terminal work as usual; build a roadmap any
            time.
          </Body>
          <div>
            <Secondary label="Build roadmap" onClick={p.onBuild} />
          </div>
        </>
      )}
    </div>
  );
}
