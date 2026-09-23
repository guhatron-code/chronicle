/* The new-design screen (comps board 2, `b_empty`): a centred 720px column on
 * the dot-grid canvas background — pick a kind, write a brief, start drawing.
 * Kind glyphs are transcribed from design/comps/design-pane/gen.py's G dict,
 * matching the copy DesignSidebar.tsx keeps for the sidebar rows (a shared
 * glyph module is a deferred cleanup). */
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { BtnPrimary, Eyebrow, Kbd } from "@/components/chrome/atoms";
import { designProjectFor, startDesign } from "@/lib/design-store";
import { KIND_LABEL, type DesignKind } from "@/lib/design-model";
import { toastError } from "@/overlays/toasts";
import { cn } from "@/lib/utils";

const KIND_GLYPH_PATH: Record<DesignKind, ReactNode> = {
  ecommerce: (
    <>
      <path d="M3 5.5h10l-.8 8H3.8z" />
      <path d="M5.8 5.5V4.3a2.2 2.2 0 0 1 4.4 0v1.2" />
    </>
  ),
  app: (
    <>
      <rect x="1.8" y="2.5" width="12.4" height="9" rx="1.2" />
      <path d="M5.5 14h5" />
    </>
  ),
  marketing: <path d="M2.5 6.5v3h2l5 3v-9l-5 3zM12 5.5a3.5 3.5 0 0 1 0 5" />,
  brand: (
    <>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 2.5v11M2.5 8h11" />
    </>
  ),
  deck: (
    <>
      <rect x="2" y="3" width="12" height="8" rx="1" />
      <path d="M8 11v2.5M5.5 13.5h5" />
    </>
  ),
};

function KindGlyph({ kind }: { kind: DesignKind }) {
  return (
    <svg
      width={14} height={14} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.3}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
    >
      {KIND_GLYPH_PATH[kind]}
    </svg>
  );
}

const AttachGlyph = () => (
  <svg width={13} height={13} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.3} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M11 6.5 6.8 10.7a1.8 1.8 0 0 1-2.5-2.5l4.6-4.6a3 3 0 0 1 4.2 4.2L8.4 12.5" />
  </svg>
);

const LinkGlyph = () => (
  <svg width={13} height={13} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M6.5 9.5 9.5 6.5M7 4.5l1.2-1.2a2.5 2.5 0 0 1 3.5 3.5L10.5 8M9 11.5l-1.2 1.2a2.5 2.5 0 0 1-3.5-3.5L5.5 8" />
  </svg>
);

const KIND_ROWS: { kind: DesignKind; desc: string }[] = [
  { kind: "ecommerce", desc: "Product, cart and checkout pages" },
  { kind: "app", desc: "Screens, flows and clickable prototypes" },
  { kind: "marketing", desc: "Landing pages, launches, social" },
  { kind: "brand", desc: "Identity, palette, type, guidelines" },
  { kind: "deck", desc: "Pitch and update decks with notes" },
];

export function NewDesign({ dir, onDone }: { dir: string; onDone: () => void }) {
  const [kind, setKind] = useState<DesignKind | null>(null);
  const [brief, setBrief] = useState("");
  const [busy, setBusy] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { taRef.current?.focus(); }, []);

  const canStart = kind != null && brief.trim().length > 0 && !busy;

  const start = async () => {
    if (kind == null || !brief.trim() || busy) return;
    setBusy(true);
    try {
      await startDesign(dir, kind, brief);
      onDone();
    } catch (e) {
      toastError("Couldn't start the design", String(e).slice(0, 90));
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void start();
    } else if (e.key === "Escape") {
      if (designProjectFor(dir).rows.length > 0) onDone();
    }
  };

  return (
    <div
      className="flex min-w-0 flex-1 items-center justify-center overflow-auto bg-surface-app"
      style={{ backgroundImage: "radial-gradient(var(--border-hairline) 1px, transparent 1px)", backgroundSize: "20px 20px" }}
    >
      <div className="flex w-full max-w-[720px] flex-col gap-[22px] px-6 py-10">
        <div className="flex flex-col gap-2">
          <Eyebrow className="text-text-faint">Design</Eyebrow>
          <div className="text-2xl font-semibold tracking-[-0.01em] text-text-primary">What should we design?</div>
          <div className="max-w-[560px] text-[13px] leading-[1.6] text-text-muted">
            Describe it the way you would to a design lead. The design session reads this project’s code for your colors and type, and draws real pages you can open, compare and restore.
          </div>
        </div>
        {/* the column narrows with the pane — the kinds rewrap instead of
            squeezing five cards into a strip of shredded words */}
        <div className="grid grid-cols-[repeat(auto-fit,minmax(128px,1fr))] gap-2">
          {KIND_ROWS.map(({ kind: k, desc }) => {
            const selected = kind === k;
            return (
              <button
                key={k}
                type="button"
                aria-pressed={selected}
                onClick={() => setKind(k)}
                className={cn(
                  "flex flex-col items-start gap-2 rounded-[10px] border p-3.5 text-left text-text-primary",
                  selected ? "border-text-primary bg-fill-hover" : "border-border-hairline bg-surface-card",
                )}
              >
                <span className="flex text-text-secondary"><KindGlyph kind={k} /></span>
                <span className="text-[12.5px] font-semibold">{KIND_LABEL[k]}</span>
                <span className="text-[11.5px] leading-[1.45] text-text-muted">{desc}</span>
              </button>
            );
          })}
        </div>
        <div className="rounded-xl border border-border-field-focus bg-surface-input">
          <textarea
            ref={taRef}
            aria-label="Brief"
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="A product page for our single origin. Lots of gift buyers, mostly on phones."
            className="min-h-[72px] w-full resize-none bg-transparent px-4 py-3.5 text-sm leading-[1.6] text-text-primary outline-none placeholder:text-text-faint"
          />
          <div className="flex flex-wrap items-center gap-2 px-2.5 pb-2.5">
            <button
              type="button"
              disabled
              title="Arrives with the design director"
              className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border-hairline px-2.5 text-[11.5px] text-text-muted disabled:opacity-40"
            >
              <AttachGlyph />References
            </button>
            <button
              type="button"
              disabled
              title="Arrives with the design director"
              className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border-hairline px-2.5 text-[11.5px] text-text-muted disabled:opacity-40"
            >
              <LinkGlyph />Capture a site
            </button>
            <span className="flex-1" />
            <span className="inline-flex items-center gap-1 text-[11px] text-text-faint">
              <Kbd className="text-text-faint">↵</Kbd> to start
            </span>
            <BtnPrimary size="md" disabled={!canStart} onClick={() => void start()}>
              Start designing
            </BtnPrimary>
          </div>
        </div>
      </div>
    </div>
  );
}
