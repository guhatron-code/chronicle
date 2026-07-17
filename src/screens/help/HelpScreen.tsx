/*
 * G7/G8 — the Help screen. A full-window surface reached from the top bar's
 * "Need help?" button (and ⌘/). Built for a designer who has never worked with
 * an AI coding tool: it opens on a set of getting-started guides that read like
 * a short tutorial, then the "How do I…" recipes, the plain glossary, and the
 * folded-in shortcuts. Search matches across all three. Presentational; content
 * lives in lib/help-content.ts.
 */
import { useState } from "react";
import {
  GLOSSARY,
  GUIDES,
  RECIPES,
  SHORTCUTS,
  searchHelp,
  type Guide,
  type GuideBlock,
  type HelpTarget,
  type Recipe,
} from "@/lib/help-content";
import { TrafficLights } from "@/components/chrome/TitleBar";

const ShowMeArrow = () => (
  <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M3 6h6M6.5 3.5 9 6 6.5 8.5" />
  </svg>
);

const BackArrow = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M9 6H3M5.5 3.5 3 6l2.5 2.5" />
  </svg>
);

/* ---------- article reading view (one guide, full) ---------- */

function GuideBlockView({ block }: { block: GuideBlock }) {
  switch (block.kind) {
    case "heading":
      return <h3 className="mt-2 text-[15px] font-semibold text-text-primary">{block.text}</h3>;
    case "para":
      return <p className="max-w-[64ch] text-[13.5px] leading-[1.65] text-text-muted">{block.text}</p>;
    case "steps":
      return (
        <ol className="flex list-none flex-col gap-2.5 p-0">
          {block.items.map((it, i) => (
            <li key={i} className="flex max-w-[62ch] gap-[11px] text-[13.5px] leading-[1.55] text-text-muted">
              <span className="mt-px flex size-[19px] shrink-0 items-center justify-center rounded-full bg-fill-hover font-mono text-[11px] font-semibold tabular-nums text-text-secondary">
                {i + 1}
              </span>
              {it}
            </li>
          ))}
        </ol>
      );
    case "tip":
      return (
        <div className="flex max-w-[64ch] gap-2.5 rounded-[10px] border border-border-hairline bg-surface-card px-3.5 py-3">
          <span className="mt-px shrink-0 text-[13px]">💡</span>
          <p className="text-[13px] leading-[1.6] text-text-muted">{block.text}</p>
        </div>
      );
    case "example":
      return (
        <div className="flex max-w-[64ch] flex-col gap-2 sm:flex-row">
          <div className="flex-1 rounded-[10px] border border-border-hairline bg-surface-card p-3.5">
            <div className="mb-1.5 flex items-center gap-1.5 text-[10.5px] uppercase tracking-[0.08em] text-text-dim">
              <span className="text-danger-fg">✕</span> Too vague
            </div>
            <p className="text-[12.5px] italic leading-[1.5] text-text-muted">“{block.bad}”</p>
          </div>
          <div className="flex-1 rounded-[10px] border border-[color-mix(in_srgb,#D97757_45%,var(--border-hairline))] bg-surface-card p-3.5">
            <div className="mb-1.5 flex items-center gap-1.5 text-[10.5px] uppercase tracking-[0.08em] text-text-dim">
              <span style={{ color: "#D97757" }}>✓</span> Clear brief
            </div>
            <p className="text-[12.5px] leading-[1.5] text-text-primary">“{block.good}”</p>
          </div>
        </div>
      );
  }
}

function ArticleView({ guide, onBack }: { guide: Guide; onBack: () => void }) {
  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col gap-4 px-8 py-8">
      <button
        onClick={onBack}
        className="inline-flex w-max items-center gap-1.5 text-[12px] text-text-secondary hover:text-text-primary"
      >
        <BackArrow />
        All guides
      </button>
      <div className="flex flex-col gap-1.5 border-b border-divider pb-4">
        <h1 className="text-[22px] font-semibold tracking-[-0.01em] text-text-primary">{guide.title}</h1>
        <span className="text-[12px] text-text-dim">{guide.minutes} min read</span>
      </div>
      <div className="flex flex-col gap-3.5">
        {guide.body.map((block, i) => (
          <GuideBlockView key={i} block={block} />
        ))}
      </div>
      <div className="mt-2 border-t border-divider pt-4">
        <button
          onClick={onBack}
          className="inline-flex w-max items-center gap-1.5 text-[12px] text-text-secondary hover:text-text-primary"
        >
          <BackArrow />
          Back to all guides
        </button>
      </div>
    </div>
  );
}

/* ---------- guide card (in the "Start here" grid) ---------- */

function GuideCard({ guide, index, onOpen }: { guide: Guide; index: number; onOpen: (g: Guide) => void }) {
  return (
    <button
      onClick={() => onOpen(guide)}
      data-guide={guide.id}
      className="group flex flex-col gap-2 rounded-[12px] border border-border-hairline bg-surface-card p-[18px] text-left transition-colors hover:border-border-field"
    >
      <div className="flex items-center gap-2.5">
        <span
          className="flex size-[26px] shrink-0 items-center justify-center rounded-full font-mono text-[12px] font-semibold tabular-nums"
          style={{ color: "#D97757", background: "color-mix(in srgb, #D97757 12%, transparent)" }}
        >
          {index + 1}
        </span>
        <span className="text-[14px] font-semibold leading-tight text-text-primary">{guide.title}</span>
      </div>
      <p className="text-[12.5px] leading-[1.5] text-text-muted">{guide.blurb}</p>
      <span className="mt-auto inline-flex items-center gap-1 pt-1 text-[11.5px] text-text-secondary opacity-80 group-hover:opacity-100">
        {guide.minutes} min read
        <ShowMeArrow />
      </span>
    </button>
  );
}

function RecipeCard({ recipe, onShowMe }: { recipe: Recipe; onShowMe: (t: HelpTarget) => void }) {
  return (
    <div className="flex flex-col gap-[11px] rounded-[10px] border border-border-hairline bg-surface-card p-4" data-recipe={recipe.title}>
      <div className="text-[14px] font-semibold text-text-primary">{recipe.title}</div>
      <ol className="flex list-none flex-col gap-[7px] p-0">
        {recipe.steps.map((step, i) => (
          <li key={i} className="flex gap-[9px] text-[12.5px] leading-normal text-text-muted">
            <span className="flex size-[17px] shrink-0 items-center justify-center rounded-full bg-fill-hover font-mono text-[10.5px] font-semibold tabular-nums text-text-secondary">
              {i + 1}
            </span>
            {step}
          </li>
        ))}
      </ol>
      <button
        onClick={() => onShowMe(recipe.target)}
        className="inline-flex w-max items-center gap-1.5 text-[12px] text-text-secondary hover:text-text-primary"
      >
        Show me
        <ShowMeArrow />
      </button>
    </div>
  );
}

export function HelpScreen({ onClose, onShowMe }: { onClose: () => void; onShowMe: (t: HelpTarget) => void }) {
  const [q, setQ] = useState("");
  const [openGuide, setOpenGuide] = useState<Guide | null>(null);
  const hits = searchHelp(q);
  const searching = q.trim().length > 0;
  const guideHits = hits.filter((h) => h.kind === "guide");
  const recipeHits = hits.filter((h) => h.kind === "recipe");
  const glossaryHits = hits.filter((h) => h.kind === "glossary");

  return (
    <div className="flex h-full flex-col bg-surface-app font-sans text-text-primary">
      <div data-tauri-drag-region className="flex h-11 shrink-0 items-center gap-3 border-b border-divider px-3.5">
        <TrafficLights />
        <span className="flex-1" />
        <span className="text-[12.5px] font-medium text-text-secondary">Help</span>
        <span className="flex-1" />
        <button aria-label="Close help" onClick={onClose} className="flex size-6 items-center justify-center rounded-md text-text-dim hover:bg-fill-hover hover:text-text-secondary">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="m1.5 1.5 7 7M8.5 1.5l-7 7" /></svg>
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {openGuide ? (
          <ArticleView guide={openGuide} onBack={() => setOpenGuide(null)} />
        ) : (
        <div className="mx-auto flex w-full max-w-[1000px] flex-col gap-[22px] px-8 py-8">
          {/* search */}
          <div className="flex h-10 items-center gap-[11px] rounded-[9px] border border-border-field bg-surface-input px-[13px] focus-within:border-border-field-focus">
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="var(--text-subtle)" strokeWidth="1.5"><circle cx="7" cy="7" r="4.5" /><path d="m10.5 10.5 3 3" /></svg>
            <input
              data-help-search
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search help…"
              className="flex-1 bg-transparent text-[13px] text-text-primary outline-none placeholder:text-text-dimmer"
            />
            <span className="rounded-[5px] bg-fill-subtle px-1.5 py-0.5 font-mono text-[10.5px] text-text-subtle">⌘/</span>
          </div>

          {searching ? (
            /* one ranked result list, all kinds */
            <div data-help-results className="flex flex-col gap-4">
              {hits.length === 0 && <div className="text-[12.5px] text-text-dim">Nothing matches “{q}”.</div>}
              {guideHits.length > 0 && (
                <div className="flex flex-col gap-3">
                  <div className="text-[10px] uppercase tracking-[0.09em] text-text-dimmer">Guides</div>
                  <div className="grid grid-cols-1 gap-[14px] sm:grid-cols-2 lg:grid-cols-3">
                    {guideHits.map((h) => (
                      <GuideCard key={h.title} guide={h.guide!} index={GUIDES.indexOf(h.guide!)} onOpen={setOpenGuide} />
                    ))}
                  </div>
                </div>
              )}
              {recipeHits.length > 0 && (
                <div className="flex flex-col gap-3">
                  <div className="text-[10px] uppercase tracking-[0.09em] text-text-dimmer">Recipes</div>
                  <div className="grid grid-cols-1 gap-[14px] sm:grid-cols-2 lg:grid-cols-3">
                    {recipeHits.map((h) => (
                      <RecipeCard key={h.title} recipe={h.recipe!} onShowMe={onShowMe} />
                    ))}
                  </div>
                </div>
              )}
              {glossaryHits.length > 0 && (
                <div className="flex flex-col gap-2 border-t border-divider pt-4">
                  <div className="text-[10px] uppercase tracking-[0.09em] text-text-dimmer">Glossary</div>
                  {glossaryHits.map((h) => (
                    <div key={h.title} className="grid grid-cols-[130px_1fr] gap-4 py-2">
                      <span className="text-[13px] font-semibold text-text-primary">{h.term!.term}</span>
                      <span className="text-[12.5px] leading-normal text-text-muted">{h.term!.meaning}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <>
              {/* getting-started guides — the tutorial */}
              <div className="flex flex-col gap-[14px]">
                <div className="flex flex-col gap-1">
                  <span className="text-[16px] font-semibold tracking-[-0.01em] text-text-primary">New to Chronicle? Start here.</span>
                  <span className="text-[12.5px] text-text-muted">A short, plain-English tour — from your first project to publishing online. No code, no jargon.</span>
                </div>
                <div className="grid grid-cols-1 gap-[14px] sm:grid-cols-2 lg:grid-cols-3">
                  {GUIDES.map((g, i) => (
                    <GuideCard key={g.id} guide={g} index={i} onOpen={setOpenGuide} />
                  ))}
                </div>
              </div>

              {/* recipes */}
              <div className="flex flex-col gap-[14px] border-t border-divider pt-[22px]">
                <div className="flex items-baseline justify-between">
                  <span className="text-[10px] uppercase tracking-[0.09em] text-text-dimmer">How do I…</span>
                  <span className="text-[11.5px] text-text-dim">{RECIPES.length} quick answers</span>
                </div>
                <div className="grid grid-cols-1 gap-[14px] sm:grid-cols-2 lg:grid-cols-3">
                  {RECIPES.map((r) => (
                    <RecipeCard key={r.title} recipe={r} onShowMe={onShowMe} />
                  ))}
                </div>
              </div>

              {/* glossary */}
              <div className="flex flex-col gap-3 border-t border-divider pt-[22px]">
                <div className="flex items-baseline justify-between">
                  <span className="text-[10px] uppercase tracking-[0.09em] text-text-dimmer">In plain words</span>
                  <span className="text-[11.5px] text-text-dim">{GLOSSARY.length} terms</span>
                </div>
                <div className="flex flex-col">
                  {GLOSSARY.map((g) => (
                    <div key={g.term} className="grid grid-cols-[130px_1fr] gap-4 border-t border-divider py-[11px] first:border-t-0">
                      <span className="text-[13px] font-semibold text-text-primary">{g.term}</span>
                      <div className="flex flex-col gap-[3px]">
                        <span className="text-[12.5px] leading-normal text-text-muted">{g.meaning}</span>
                        {g.technical && <span className="font-mono text-[10.5px] text-text-dim">{g.technical}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* shortcuts */}
              <div className="flex flex-col gap-3 border-t border-divider pt-[22px]">
                <span className="text-[10px] uppercase tracking-[0.09em] text-text-dimmer">Keyboard shortcuts</span>
                <div className="grid grid-cols-1 gap-x-[26px] gap-y-[9px] sm:grid-cols-2">
                  {SHORTCUTS.map((s) => (
                    <div key={s.keys} className="flex items-center gap-[10px]">
                      <span className="min-w-[48px] rounded-[5px] border border-border-hairline bg-fill-subtle px-[7px] py-0.5 text-center font-mono text-[11px] text-text-secondary">{s.keys}</span>
                      <span className="text-[12.5px] text-text-muted">{s.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
        )}
      </div>
    </div>
  );
}
