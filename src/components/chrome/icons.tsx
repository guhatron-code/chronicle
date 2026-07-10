/*
 * The Deck-1 glyph set — inline 1.3–1.6px-stroke SVGs transcribed from the comps
 * (the handoff says: copy the paths). Sizes come from each call site.
 */
import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { size?: number };

/** The Chronicle brand mark (compass-ish circle). */
export const BrandGlyph = ({ size = 20, ...p }: P) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" {...p}>
    <path d="M4 10a6 6 0 0 1 12 0M10 4v12" />
    <circle cx="10" cy="10" r="8" />
  </svg>
);

export const CheckGlyph = ({ size = 12, ...p }: P) => (
  <svg width={size} height={size} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" {...p}>
    <path d="M2 6.5 5 9.5 10 3" />
  </svg>
);

export const ErrorGlyph = ({ size = 12, strokeWidth = 1.5, ...p }: P & { strokeWidth?: number }) => (
  <svg width={size} height={size} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={strokeWidth} {...p}>
    <circle cx="6" cy="6" r="5" />
    <path d="M6 3.4v3M6 8.4v.1" />
  </svg>
);

export const TrashGlyph = ({ size = 13, ...p }: P) => (
  <svg width={size} height={size} viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" {...p}>
    <path d="M2.5 3.5h9M5.5 3.5V2.2h3v1.3M3.5 3.5l.6 8h5.8l.6-8" />
  </svg>
);

export const SearchGlyph = ({ size = 14, ...p }: P) => (
  <svg width={size} height={size} viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" {...p}>
    <circle cx="6" cy="6" r="4.2" />
    <path d="M9.4 9.4 12.5 12.5" />
  </svg>
);

export const FolderGlyph = ({ size = 14, ...p }: P) => (
  <svg width={size} height={size} viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" {...p}>
    <path d="M1.8 4.5c0-.7.6-1.3 1.3-1.3h2.4l1.3 1.5h4.1c.7 0 1.3.6 1.3 1.3v4.5c0 .7-.6 1.3-1.3 1.3H3.1c-.7 0-1.3-.6-1.3-1.3z" />
  </svg>
);

export const FolderPlusGlyph = ({ size = 16, ...p }: P) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" {...p}>
    <path d="M2 5c0-.8.7-1.5 1.5-1.5h2.8L7.8 5h4.7c.8 0 1.5.7 1.5 1.5v5c0 .8-.7 1.5-1.5 1.5h-9C2.7 13 2 12.3 2 11.5z" />
    <path d="M8 7.5v3M6.5 9h3" />
  </svg>
);

export const PlusGlyph = ({ size = 14, ...p }: P) => (
  <svg width={size} height={size} viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" {...p}>
    <path d="M7 2.5v9M2.5 7h9" />
  </svg>
);

/* ---- Deck-2 glyphs (rail, tabs, terminal strip) ---- */

export const RoadmapGlyph = ({ size = 15, ...p }: P) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" {...p}>
    <path d="M3 3v7.5M3 3c1.5 0 2 1 4 1s2.5-1 4-1 2 1 2 1v7.5s-.5-1-2-1-2.5 1-4 1-2.5-1-4-1" />
    <path d="M3 13.5v-3" />
  </svg>
);

export const RepoGlyph = ({ size = 15, ...p }: P) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" {...p}>
    <circle cx="5" cy="4" r="1.8" />
    <circle cx="5" cy="12" r="1.8" />
    <circle cx="11" cy="8" r="1.8" />
    <path d="M5 5.8v4.4M6.8 11.3c2.4-.4 4.2-1.1 4.2-3.3v-.2" />
  </svg>
);

export const KanbanGlyph = ({ size = 15, ...p }: P) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" {...p}>
    <rect x="2.2" y="2.5" width="3.4" height="11" rx="1" />
    <rect x="6.9" y="2.5" width="3.4" height="7" rx="1" />
    <rect x="11.6" y="2.5" width="3.4" height="4.5" rx="1" />
  </svg>
);

export const RefreshGlyph = ({ size = 14, ...p }: P) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" {...p}>
    <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2.8v3h-3" />
  </svg>
);

export const HelpGlyph = ({ size = 14, ...p }: P) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" {...p}>
    <circle cx="8" cy="8" r="6" />
    <path d="M6.2 6.2c.2-1 1-1.6 1.9-1.6 1 0 1.9.7 1.9 1.7 0 1.3-1.9 1.4-1.9 2.7M8 11.4v.1" />
  </svg>
);

export const XGlyph = ({ size = 9, ...p }: P) => (
  <svg width={size} height={size} viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" {...p}>
    <path d="m1.5 1.5 7 7M8.5 1.5l-7 7" />
  </svg>
);

/** Claude starburst — brand colour, one of the two chroma exceptions. */
export const ClaudeStar = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="#D97757">
    <path d="M8 0.8 9.4 5 13.8 3.2 10.9 6.9 15.2 8.6 10.6 9.2 12.3 13.6 8.6 10.7 6.9 15 6.3 10.4 1.9 12.1 4.8 8.4 0.5 6.7 5.1 6.1 3.4 1.7 7.1 4.6z" />
  </svg>
);

/** Codex tile — brand gradient, the other chroma exception. */
export const CodexTile = ({ size = 15 }: { size?: number }) => (
  <span
    className="inline-block rounded-[5px]"
    style={{ width: size, height: size, background: "linear-gradient(135deg,#6ba6ff,#2563eb)" }}
  />
);
