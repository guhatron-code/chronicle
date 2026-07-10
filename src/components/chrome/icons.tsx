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

export const ErrorGlyph = ({ size = 12, ...p }: P) => (
  <svg width={size} height={size} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" {...p}>
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
  <svg width={size} height={size} viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" {...p}>
    <path d="M7 2.5v9M2.5 7h9" />
  </svg>
);
