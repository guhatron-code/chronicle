/* Review settings (board 11): the composer's chip and the popover it opens, per
   design or for the whole project. */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { computePosition, flip, offset, shift } from "@floating-ui/dom";
import { designProjectFor, setReviewSettings, subscribeDesigns } from "@/lib/design-store";
import type { ReviewSettings } from "@/lib/design-review-model";
import { toastError } from "@/overlays/toasts";

type Scope = "project" | "design";

function Toggle({ on, label, onChange }: { on: boolean; label: string; onChange: (v: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)}
      className={`relative inline-block h-[18px] w-[30px] shrink-0 rounded-[9px] ${on ? "bg-primary" : "bg-fill-hover"}`}>
      <span className={`absolute top-[2px] h-[14px] w-[14px] rounded-full ${on ? "right-[2px] bg-primary-fg" : "left-[2px] bg-text-dim"}`} />
    </button>
  );
}

function Stepper({ value, label, min, max, step, fmt, onChange }: {
  value: number; label: string; min: number; max: number; step: number; fmt: (n: number) => string; onChange: (n: number) => void;
}) {
  const set = (n: number) => onChange(Math.min(max, Math.max(min, Math.round(n * 10) / 10)));
  return (
    <span role="group" aria-label={label}
      className="inline-flex h-7 shrink-0 items-center rounded-lg border border-border-field bg-surface-input">
      <button type="button" aria-label={`${label}: less`} disabled={value <= min} onClick={() => set(value - step)}
        className="w-[26px] text-center text-text-subtle hover:text-text-primary disabled:opacity-40">−</button>
      <span className="min-w-[30px] text-center font-mono text-[12px] text-text-primary">{fmt(value)}</span>
      <button type="button" aria-label={`${label}: more`} disabled={value >= max} onClick={() => set(value + step)}
        className="w-[26px] text-center text-text-subtle hover:text-text-primary disabled:opacity-40">+</button>
    </span>
  );
}

function Line({ label, sub, project, children }: { label: string; sub: string; project?: boolean; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 border-t border-divider px-3.5 py-2.5">
      <div className="flex flex-1 flex-col gap-0.5">
        <span className="text-[12.5px] text-text-primary">{label}</span>
        <span className="text-[11px] leading-[1.45] text-text-faint">{sub}</span>
      </div>
      {project && <span className="text-[11px] text-text-muted">(project)</span>}
      <span className={project ? "opacity-60" : ""}>{children}</span>
    </div>
  );
}

export function ReviewSettingsPopover({ dir, anchor, scope: initial, onClose }: {
  dir: string; anchor: HTMLElement | null; scope: Scope; onClose: () => void;
}) {
  const [, bump] = useState(0);
  useEffect(() => subscribeDesigns(() => bump((n) => n + 1)), []);
  const p = designProjectFor(dir);
  const [scope, setScope] = useState<Scope>(initial);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const folder = dir.split("/").filter(Boolean).pop() ?? "project";

  useLayoutEffect(() => {
    if (!anchor || !ref.current) return;
    void computePosition(anchor, ref.current, {
      strategy: "fixed", placement: "top-start",
      middleware: [offset(8), flip(), shift({ padding: 8 })],
    }).then((r) => setPos({ left: r.x, top: r.y }));
  }, [anchor, scope]);

  useEffect(() => {
    ref.current?.focus();
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    const down = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !anchor?.contains(t)) onClose();
    };
    window.addEventListener("keydown", key, true);
    window.addEventListener("mousedown", down);
    return () => { window.removeEventListener("keydown", key, true); window.removeEventListener("mousedown", down); };
  }, [anchor, onClose]);

  const over = scope === "design" ? p.settingsScope.design ?? {} : {};
  const val = <K extends keyof ReviewSettings>(k: K): ReviewSettings[K] => (over as Partial<ReviewSettings>)[k] ?? p.settings[k];
  const inherited = (k: keyof ReviewSettings) => scope === "design" && (over as Partial<ReviewSettings>)[k] === undefined;
  const change = (patch: Partial<ReviewSettings>) =>
    void setReviewSettings(dir, scope, patch).catch((e) => toastError("Couldn't save that", String(e).slice(0, 90)));

  return (
    <div ref={ref} role="dialog" aria-label="Review settings" tabIndex={-1}
      style={{ position: "fixed", left: pos?.left ?? 0, top: pos?.top ?? 0, width: 340, visibility: pos ? "visible" : "hidden" }}
      className="z-50 rounded-[10px] border border-border-strong bg-surface-overlay text-text-primary shadow-overlay outline-none">
      <div className="flex flex-col gap-2 px-3.5 py-3">
        <span className="text-[12.5px] font-semibold">Review before you see it</span>
        <div role="group" aria-label="Applies to" className="flex gap-0.5 rounded-lg border border-border-hairline p-0.5">
          {([["design", "This design"], ["project", `All designs in ${folder}`]] as const).map(([id, t]) => (
            <button key={id} type="button" aria-pressed={scope === id} onClick={() => setScope(id)}
              disabled={id === "design" && !p.active}
              className={`flex h-6 min-w-0 flex-1 items-center justify-center truncate rounded-md px-1.5 text-[11.5px] disabled:opacity-40 ${scope === id ? "bg-fill-hover text-text-primary" : "text-text-muted hover:text-text-primary"}`}>
              <span className="truncate">{t}</span>
            </button>
          ))}
        </div>
      </div>
      <Line label="Critique panel" sub="Four reviewers score each design. Off is faster and uses less of your plan." project={inherited("critique")}>
        <Toggle on={val("critique")} label="Critique panel" onChange={(v) => change({ critique: v })} />
      </Line>
      <Line label="Passing score" sub="Below this, the director tries again." project={inherited("bar")}>
        <Stepper value={val("bar")} label="Passing score" min={5} max={9.5} step={0.5} fmt={(n) => n.toFixed(1)} onChange={(n) => change({ bar: n })} />
      </Line>
      <Line label="Most rounds" sub="Then it shows its best round and why." project={inherited("rounds")}>
        <Stepper value={val("rounds")} label="Most rounds" min={1} max={5} step={1} fmt={(n) => String(n)} onChange={(n) => change({ rounds: n })} />
      </Line>
      <Line label="Lint gate" sub="Blocks known AI-looking patterns and failed contrast." project={inherited("lint")}>
        <Toggle on={val("lint")} label="Lint gate" onChange={(v) => change({ lint: v })} />
      </Line>
      <div className="flex items-center gap-2 border-t border-divider px-3.5 py-2.5">
        <span className="flex-1 text-[11px] text-text-faint">Connections live in Setup &amp; health</span>
        <button type="button" className="whitespace-nowrap text-[11.5px] text-text-secondary hover:text-text-primary"
          onClick={() => { onClose(); window.dispatchEvent(new CustomEvent("chronicle:open-setup")); }}>Open</button>
      </div>
    </div>
  );
}

/** the composer chip: `Critique on · pass 8.0`, `Critique off`, `… · lint off` */
export function ReviewChip({ dir }: { dir: string }) {
  const [, bump] = useState(0);
  useEffect(() => subscribeDesigns(() => bump((n) => n + 1)), []);
  const s = designProjectFor(dir).settings;
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<Scope>("design");
  const btn = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => { setOpen(false); btn.current?.focus(); }, []);
  useEffect(() => {
    const on = (e: Event) => {
      setScope((e as CustomEvent).detail?.scope === "project" ? "project" : "design");
      setOpen(true);
    };
    window.addEventListener("chronicle:review-settings", on);
    return () => window.removeEventListener("chronicle:review-settings", on);
  }, []);
  const text = (s.critique ? `Critique on · pass ${s.bar.toFixed(1)}` : "Critique off") + (s.lint ? "" : " · lint off");
  return (
    <>
      <button ref={btn} type="button" aria-haspopup="dialog" aria-expanded={open}
        onClick={() => { if (!open) setScope(designProjectFor(dir).active ? "design" : "project"); setOpen((o) => !o); }}
        className={`inline-flex h-6 items-center rounded-full border px-2.5 text-[11.5px] text-text-secondary hover:text-text-primary ${open ? "border-text-primary" : "border-border-hairline"}`}>
        {text}
      </button>
      {open && <ReviewSettingsPopover dir={dir} anchor={btn.current} scope={scope} onClose={close} />}
    </>
  );
}
