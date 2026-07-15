/*
 * The Deck-1 glyph set — inline 1.3–1.6px-stroke SVGs transcribed from the comps
 * (the handoff says: copy the paths). Sizes come from each call site.
 */
import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { size?: number };

/** The Chronicle brand mark — the original v1 quill-and-scroll logo
 *  (operator-directed: the comps' compass placeholder is replaced). */
export const BrandGlyph = ({ size = 20, ...p }: P) => (
  <svg width={size} height={size} viewBox="0 0 120 120" fill="currentColor" {...p}>
    <path d="M94.1495 90.574V98.1481C94.1495 100.597 92.1651 102.593 89.7159 102.593H30.6539C31.6734 101.332 32.3219 99.7887 32.318 98.1481V90.8747L49.392 94.7771C49.5639 94.8122 49.7397 94.8122 49.9115 94.7771L58.7787 92.7106L65.5209 93.6325C65.6264 93.6442 65.728 93.6442 65.8451 93.6208L86.5331 90.5739L94.1495 90.574ZM30.0085 89.4217V98.1483C30.0632 100.547 27.9577 102.605 25.5749 102.582C23.1374 102.582 21.1413 100.597 21.1413 98.1483V88.4177L24.028 81.1561L26.2897 79.367C26.6256 79.1013 26.7858 78.6873 26.7155 78.2692L25.3288 69.7029L28.8835 66.9881C29.1491 66.781 29.3093 66.4568 29.3327 66.1209C29.3444 65.7732 29.2038 65.4412 28.9499 65.2107L21.1335 58.1209L21.1413 21.4219C21.153 19.8047 20.5202 18.2266 19.489 17H45.301L57.02 20.4414C57.2427 20.5039 57.438 20.5 57.6567 20.4531L70.3907 17H80.8637C83.3012 17 85.2973 18.9844 85.2973 21.4219V33.8089L78.3129 39.5003C77.7973 39.8988 77.7582 40.7269 78.2075 41.1956L82.0981 45.2229C81.5629 48.3245 81.02 51.4417 80.4575 54.551C80.4223 54.8049 80.4575 55.0588 80.5746 55.2893C81.5902 57.262 82.5941 59.2385 83.6098 61.2229L85.2934 64.5237V88.4217L65.6684 91.3201L58.8793 90.3865C58.7387 90.3631 58.602 90.3748 58.4653 90.41L49.645 92.4646L31.415 88.2966C30.7236 88.1131 29.9889 88.7107 30.0085 89.4217ZM79.2115 73.6597H33.7935C32.2623 73.6909 32.2935 75.9449 33.7935 75.9683H79.2115C80.7388 75.9409 80.7115 73.6871 79.2115 73.6597ZM33.7935 57.4757H73.4265C74.0632 57.4757 74.5827 56.9561 74.5827 56.3195C74.5827 55.6827 74.0632 55.1632 73.4265 55.1632H33.7935C33.1568 55.1632 32.6373 55.6828 32.6373 56.3195C32.6412 56.9562 33.1607 57.4757 33.7935 57.4757ZM33.7935 64.4132C32.2623 64.4444 32.2935 66.6984 33.7935 66.7218H79.2115C80.7427 66.6905 80.7115 64.4366 79.2115 64.4132H33.7935ZM28.3443 29.4911H79.2113C80.7465 29.4599 80.7074 27.1981 79.2113 27.1825H28.3443C26.8131 27.206 26.8443 29.4677 28.3443 29.4911ZM27.192 37.827C27.192 38.4638 27.7115 38.9832 28.3482 38.9832H73.4302C74.0669 38.9832 74.5864 38.4637 74.5864 37.827C74.5864 37.1904 74.0669 36.6708 73.4302 36.6708H28.3442C27.7114 36.6708 27.192 37.1904 27.192 37.827ZM73.426 48.229C74.9572 48.1978 74.926 45.9439 73.426 45.9205H28.344C26.8128 45.9517 26.844 48.2056 28.344 48.229H73.426ZM10 21.053L12.4922 24.2523C12.7695 24.6116 12.8164 25.096 12.5977 25.4984L10.7383 28.9944H18.8321V21.4202C18.7461 15.7991 10.5586 15.4983 10 21.053Z" />
    <path d="M94.0023 69.1021C92.9867 72.7623 91.7757 76.4341 90.4007 80.0001C90.096 80.7461 90.678 81.586 91.4749 81.5821C91.9358 81.5821 92.3772 81.293 92.5491 80.8438C93.9593 77.2188 95.1819 73.5 96.2093 69.7848L94.0023 69.1021Z" />
    <path d="M108.963 42.953C108.846 45.7694 108.338 48.91 107.393 52.0155C106.377 53.1366 103.94 55.535 101.92 56.1717C100.67 56.5506 100.99 58.4529 102.268 58.4334C103.428 58.2498 104.483 57.5194 105.51 56.8162C103.604 60.7537 100.822 64.3084 97.0022 66.699C99.6702 55.953 100.822 44.801 100.408 33.484C100.326 31.9723 98.0607 32.0621 98.0998 33.5661C98.5021 44.4761 97.4201 55.2341 94.9006 65.6011C91.7678 57.8941 91.0334 48.2261 91.5998 40.5271C92.1388 41.3669 92.9006 43.1209 94.174 42.281C94.6935 41.9099 94.8224 41.1951 94.4513 40.6755C93.1583 38.8396 92.3029 37.0388 92.0021 36.3591C92.3381 33.738 92.8107 31.1521 93.4123 28.7185C94.2561 29.3982 94.9006 29.9177 94.9006 29.9177C95.6389 30.5427 96.8772 29.902 96.7717 28.9372L96.2053 20.6013C96.7366 19.4451 97.3147 18.3747 97.9006 17.4021C99.9904 18.7419 101.826 20.4841 103.373 22.574L102.541 25.2185C102.104 26.6521 104.283 27.3552 104.744 25.9099L104.998 25.113C105.795 26.5349 106.51 28.07 107.088 29.7185C106.256 34.0271 104.998 38.2341 103.358 42.3235C103.139 42.8548 103.346 43.468 103.842 43.7532C104.35 44.0423 104.975 43.9134 105.33 43.4642C106.623 41.8119 107.799 40.0111 108.85 38.0736C108.998 39.6986 109.045 41.3241 108.963 42.953Z" />
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
  <svg width={size} height={size} viewBox="0 0 16 16" fill="#D97757" className="agent-mark">
    <path d="M8 0.8 9.4 5 13.8 3.2 10.9 6.9 15.2 8.6 10.6 9.2 12.3 13.6 8.6 10.7 6.9 15 6.3 10.4 1.9 12.1 4.8 8.4 0.5 6.7 5.1 6.1 3.4 1.7 7.1 4.6z" />
  </svg>
);

/** Codex tile — brand gradient, the other chroma exception. */
export const CodexTile = ({ size = 15 }: { size?: number }) => (
  <span
    className="agent-mark inline-block rounded-[5px]"
    style={{ width: size, height: size, background: "linear-gradient(135deg,#6ba6ff,#2563eb)" }}
  />
);

/* ---- Deck-3 glyphs (roadmap pane F12–F22) — paths transcribed from the comps ---- */

/** Clock (F15 waiting-on-you, F16 stale alert). */
export const ClockGlyph = ({ size = 14, ...p }: P) => (
  <svg width={size} height={size} viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" {...p}>
    <circle cx="7" cy="7" r="5.5" />
    <path d="M7 4v3.2l2 1.4" />
  </svg>
);

/** Warning triangle (F14 banner). */
export const WarnGlyph = ({ size = 14, ...p }: P) => (
  <svg width={size} height={size} viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" {...p}>
    <path d="M7 1.8 13 12H1z" />
    <path d="M7 5.8v3M7 10.6v.1" />
  </svg>
);

/** Publish / upload — arrow up from a line (F19 publish row). */
export const UploadGlyph = ({ size = 14, ...p }: P) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" {...p}>
    <path d="M8 13V4M4.5 7.5 8 4l3.5 3.5M3 13.5h10" />
  </svg>
);

/** Code angle-brackets (F19 roadmap-authored action row). */
export const CodeGlyph = ({ size = 14, ...p }: P) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" {...p}>
    <path d="M4 3.5 1.8 8 4 12.5M12 3.5 14.2 8 12 12.5M9.3 2.8 6.7 13.2" />
  </svg>
);

/** Simple closed folder at the 16-grid (F19 leftover-workspace row). */
export const FolderSimpleGlyph = ({ size = 14, ...p }: P) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" {...p}>
    <path d="M2 5c0-.8.7-1.5 1.5-1.5h2.8L7.8 5h4.7c.8 0 1.5.7 1.5 1.5v5c0 .8-.7 1.5-1.5 1.5h-9C2.7 13 2 12.3 2 11.5z" />
  </svg>
);

/** Copy — two offset rects (F19 copy-the-command, F22 doc copy). */
export const CopyGlyph = ({ size = 12, ...p }: P) => (
  <svg width={size} height={size} viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" {...p}>
    <rect x="4.5" y="4.5" width="8" height="8" rx="1.5" />
    <path d="M9.5 4.5v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2" />
  </svg>
);

/** Document sheet; `fold` draws the corner-fold stroke (F20 chips; missing chip omits it). */
export const DocGlyph = ({ size = 12, fold = true, ...p }: P & { fold?: boolean }) => (
  <svg width={size} height={size} viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" {...p}>
    <path d="M3 1.8h5.2L11 4.6v7.6H3z" />
    {fold && <path d="M8 1.8v3h3" />}
  </svg>
);

/* Chevrons at the 12-grid (twisties, accordion rows, breadcrumb back). */
export const ChevronDownGlyph = ({ size = 11, ...p }: P) => (
  <svg width={size} height={size} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" {...p}>
    <path d="m3 4.5 3 3 3-3" />
  </svg>
);

export const ChevronUpGlyph = ({ size = 11, ...p }: P) => (
  <svg width={size} height={size} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" {...p}>
    <path d="m3 7.5 3-3 3 3" />
  </svg>
);

export const ChevronRightGlyph = ({ size = 11, ...p }: P) => (
  <svg width={size} height={size} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" {...p}>
    <path d="m4.5 3 3 3-3 3" />
  </svg>
);

export const ChevronLeftGlyph = ({ size = 11, ...p }: P) => (
  <svg width={size} height={size} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" {...p}>
    <path d="M7.5 2 4 6l3.5 4" />
  </svg>
);

/** Play triangle, filled (F22 "Start this phase"). */
export const PlayGlyph = ({ size = 11, ...p }: P) => (
  <svg width={size} height={size} viewBox="0 0 12 12" fill="currentColor" {...p}>
    <path d="M3 1.8v8.4L10 6z" />
  </svg>
);

/** Neutral agent star (F22 save-avatar tile) — token-coloured, NOT the Claude brand star. */
export const AgentStarGlyph = ({ size = 9, ...p }: P) => (
  <svg width={size} height={size} viewBox="0 0 12 12" fill="currentColor" {...p}>
    <path d="M6 .8 7 4.2 10.5 3 8.2 5.8 11.4 7.2 8 7.6 9.2 11 6.4 8.8 5 12 4.6 8.5 1.2 9.8 3.4 7 .4 5.6 3.9 5.1 2.6 1.8 5.4 4z" />
  </svg>
);

/* ---- Deck-4 glyphs (repo pane F23–F25) — paths transcribed from the comps ---- */

/** Clock with a rewind arrow — the Explorer-head "Project history" button (F23). */
export const HistoryClockGlyph = ({ size = 13, ...p }: P) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" {...p}>
    <path d="M13.2 8A5.2 5.2 0 1 1 8 2.8c2 0 3.7 1.1 4.6 2.7M12.8 2.8v2.9h-2.9" />
    <path d="M8 5.3V8l2 1.2" />
  </svg>
);

/** Picture-in-frame (F24 image-preview thumb). `dot` draws the sun circle —
 *  the Deck-5 kanban thumb tiles omit it (F27/F29 tile glyph has no circle). */
export const ImageGlyph = ({ size = 22, dot = true, ...p }: P & { dot?: boolean }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.3" {...p}>
    <rect x="2.5" y="3.5" width="15" height="13" rx="1.5" />
    {dot && <circle cx="7" cy="8" r="1.5" />}
    <path d="m3.5 14.5 4-4 3 3 2.5-2.5 3.5 3.5" />
  </svg>
);

/* ---- Deck-5 glyphs (kanban F27–F30) — paths transcribed from the comps ---- */

/** Chain link (F27/F29 design-link chips). */
export const LinkGlyph = ({ size = 9, ...p }: P) => (
  <svg width={size} height={size} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" {...p}>
    <path d="M5 7a2.4 2.4 0 0 0 3.4 0l1.8-1.8a2.4 2.4 0 0 0-3.4-3.4l-1 1M7 5a2.4 2.4 0 0 0-3.4 0L1.8 6.8a2.4 2.4 0 0 0 3.4 3.4l1-1" />
  </svg>
);

/** Padlock (F28 frozen-round cards). */
export const LockGlyph = ({ size = 10, ...p }: P) => (
  <svg width={size} height={size} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3" {...p}>
    <rect x="2.5" y="5" width="7" height="5.5" rx="1" />
    <path d="M4 5V3.6a2 2 0 0 1 4 0V5" />
  </svg>
);

/** Six-dot drag grip (F28 hover affordance) — 10×14, fill. */
export const GripGlyph = ({ size = 10, ...p }: P) => (
  <svg width={size} height={size * 1.4} viewBox="0 0 10 14" fill="currentColor" {...p}>
    <circle cx="3" cy="2.5" r="1.1" />
    <circle cx="7" cy="2.5" r="1.1" />
    <circle cx="3" cy="7" r="1.1" />
    <circle cx="7" cy="7" r="1.1" />
    <circle cx="3" cy="11.5" r="1.1" />
    <circle cx="7" cy="11.5" r="1.1" />
  </svg>
);
