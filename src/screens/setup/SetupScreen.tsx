/*
 * G1/G5 — the Setup screen. Full-window under the title bar. Two framings share
 * one checklist body: the first-launch/missing-prereq GATE ("Let's get you set
 * up") and the always-reachable HEALTH console ("Setup & health"). A summary
 * card + "Set everything up for me", per-row states, and the all-green
 * celebration. Wired to the doctor store; sign-ins hand off to a terminal.
 */
import { useEffect, useState } from "react";
import {
  CHECK_META,
  allReady,
  cancelCheck,
  checkFor,
  doctorState,
  fixTerminalPath,
  installCheck,
  readyCount,
  refreshDoctor,
  runEverything,
  startSignin,
  subscribeDoctor,
} from "@/lib/setup-store";
import { CheckRow } from "./CheckRow";
import { toastError } from "@/overlays/toasts";
import { TrafficLights } from "@/components/chrome/TitleBar";
import { BrandGlyph } from "@/components/chrome/icons";

const Check = ({ size = 12 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7">
    <path d="M4 10.5 8.2 15 16 5.5" />
  </svg>
);

function Checklist({ dir }: { dir: string | null }) {
  const total = CHECK_META.length;
  const ready = readyCount();
  const running = doctorState().runningAll;

  const rowFor = (id: string) => (
    <CheckRow
      key={id}
      check={checkFor(id)}
      onInstall={() => void installCheck(id).catch((e) => toastError("Couldn't install it", String(e).slice(0, 90)))}
      onFix={() => void fixTerminalPath(id)}
      onSignin={() => void startSignin(dir, id).catch((e) => toastError("Couldn't open the sign-in", String(e).slice(0, 90)))}
      onCancel={() => void cancelCheck(id)}
    />
  );

  return (
    <>
      <div className="flex items-center gap-[18px] rounded-[10px] border border-border-hairline bg-surface-card px-[17px] py-[15px]">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex items-baseline gap-2.5">
            <span className="text-[15px] font-semibold text-text-primary">
              {ready} of {total} ready
            </span>
            <span className="text-[12.5px] text-text-dim">
              {ready === total ? "everything's set" : "a few things need you before you can start"}
            </span>
          </div>
          <span className="block h-1 overflow-hidden rounded-[2px] bg-fill-hover">
            <span className="block h-full rounded-[2px] bg-text-secondary" style={{ width: `${(ready / total) * 100}%` }} />
          </span>
        </div>
        <button
          data-setup-runall
          disabled={running}
          onClick={() => void runEverything().catch((e) => toastError("Setup didn't finish", String(e).slice(0, 90)))}
          className="h-[33px] shrink-0 whitespace-nowrap rounded-lg bg-primary px-[15px] text-[12.5px] font-semibold text-primary-foreground hover:bg-[--primary-hover] disabled:opacity-60"
        >
          {running ? "Setting things up…" : "Set everything up for me"}
        </button>
      </div>
      <div className="flex flex-col">{CHECK_META.map((m) => rowFor(m.id))}</div>
    </>
  );
}

export function SetupScreen({
  mode,
  dir,
  onClose,
  onOpenProject,
}: {
  /** "gate" = first-launch/missing-prereq framing; "health" = the re-check tool */
  mode: "gate" | "health";
  dir: string | null;
  onClose: () => void;
  onOpenProject?: () => void;
}) {
  const [, bump] = useState(0);
  useEffect(() => subscribeDoctor(() => bump((n) => n + 1)), []);
  useEffect(() => { void refreshDoctor(); }, []);
  const done = allReady();

  return (
    <div className="flex h-full flex-col bg-surface-app font-sans text-text-primary">
      <div data-tauri-drag-region className="flex h-11 shrink-0 items-center gap-3 border-b border-divider px-3.5">
        <TrafficLights />
        <span className="flex-1" />
        {mode === "health" && (
          <button onClick={onClose} className="h-[26px] rounded-md px-2.5 text-[11.5px] text-text-muted hover:bg-fill-hover hover:text-text-secondary">
            Done
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[640px] flex-col gap-[22px] px-8 py-10">
          {done ? (
            <div className="flex flex-col items-center gap-[13px] py-16 text-center">
              <span className="flex size-[42px] items-center justify-center rounded-full border border-border-hairline bg-fill-subtle text-state-success">
                <Check size={20} />
              </span>
              <div className="text-[20px] font-semibold text-text-primary">You're all set</div>
              <div className="max-w-[34ch] text-[13px] leading-relaxed text-text-muted [text-wrap:pretty]">
                Everything Chronicle needs is installed and signed in. You can start building.
              </div>
              <button
                onClick={onOpenProject ?? onClose}
                className="mt-1 h-9 rounded-lg bg-primary px-[18px] text-[13px] font-semibold text-primary-foreground hover:bg-[--primary-hover]"
              >
                {mode === "gate" ? "Open a project" : "Done"}
              </button>
            </div>
          ) : mode === "gate" ? (
            <>
              <div className="flex flex-col items-center gap-3 pb-1 pt-4 text-center">
                <span className="flex size-11 items-center justify-center rounded-xl border border-border-strong bg-surface-card-raised text-text-secondary">
                  <BrandGlyph size={20} />
                </span>
                <div className="text-[22px] font-semibold tracking-[-0.01em] text-text-primary">Let's get you set up</div>
                <div className="max-w-[42ch] text-[13px] leading-relaxed text-text-muted [text-wrap:pretty]">
                  Before your first project, Chronicle needs to set up a few tools. It takes a minute, and you won't type a single command.
                </div>
              </div>
              <Checklist dir={dir} />
            </>
          ) : (
            <>
              <div className="flex flex-col gap-1.5">
                <div className="text-[20px] font-semibold text-text-primary">Setup &amp; health</div>
                <div className="max-w-[46ch] text-[12.5px] leading-relaxed text-text-muted [text-wrap:pretty]">
                  Everything Chronicle needs, in one place. Open this any time something stops working and re-check.
                </div>
              </div>
              <Checklist dir={dir} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
