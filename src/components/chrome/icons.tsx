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

/** Claude Code mark — the real starburst from the legacy app; brand colour is
 * one of the two chroma exceptions. */
export const ClaudeStar = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 100 100" fill="none" className="shrink-0">
    <path d="M19.6 66.5L39.3 55.5L39.6 54.5L39.3 54H38.3L35 53.8L23.8 53.5L14 53L4.5 52.5L2.1 52L0 49L0.2 47.5L2.2 46.2L5.1 46.4L11.4 46.9L20.9 47.5L27.8 47.9L38 49.1H39.6L39.8 48.4L39.3 48L38.9 47.6L29 41L18.4 34L12.8 29.9L9.8 27.9L8.3 25.9L7.7 21.7L10.4 18.7L14.1 19L15 19.2L18.7 22.1L26.7 28.2L37 36L38.5 37.2L39.1 36.8L39.2 36.5L38.5 35.4L33 25L27 14.6L24.3 10.3L23.6 7.7C23.3 6.7 23.2 5.7 23.2 4.7L26.2 0.5L28 0L32.2 0.6L33.8 2L36.4 8L40.5 17.3L47 29.9L49 33.7L50 37.1L50.3 38.1H51V37.6L51.5 30.4L52.5 21.7L53.5 10.5L53.8 7.3L55.4 3.5L58.4 1.5L61 2.6L63 5.5L62.7 7.3L61.6 15L59 27.1L57.5 35.3H58.4L59.4 34.2L63.5 28.8L70.4 20.2L73.4 16.7L77 13L79.3 11.2H83.6L86.7 15.9L85.3 20.8L80.9 26.4L77.2 31.1L71.9 38.2L68.7 43.9L69 44.3H69.7L81.7 41.7L88.1 40.6L95.7 39.3L99.2 40.9L99.6 42.5L98.2 45.9L90 47.9L80.4 49.9L66.1 53.2L65.9 53.3L66.1 53.6L72.5 54.2L75.3 54.4H82.1L94.7 55.4L98 57.4L99.9 60.1L99.6 62.1L94.5 64.7L87.7 63.1L71.7 59.3L66.3 58H65.5V58.4L70.1 62.9L78.4 70.4L89 80.1L89.5 82.5L88.2 84.5L86.8 84.3L77.6 77.3L74 74.3L66 67.5H65.5V68.2L67.3 70.9L77.1 85.6L77.6 90.1L76.9 91.5L74.3 92.5L71.6 91.9L65.8 83.9L59.8 74.9L55.1 66.7L54.6 67.1L51.7 97.3L50.4 98.8L47.4 100L44.9 98L43.5 95L44.9 88.8L46.5 80.8L47.8 74.4L49 66.5L49.7 63.9V63.7H49L43 72L34 84.3L26.8 91.9L25.1 92.6L22.1 91.1L22.4 88.3L24 86L34 73.2L40 65.3L44 60.7L43.9 60.2H43.6L17.2 77.4L12.5 78L10.5 76L10.7 73L11.7 72L19.7 66.5H19.6Z" fill="#D97757" />
  </svg>
);

/** Chrongirl — the agent's face, in the Claude orange (the same chroma
 * exception as the star). Used as the agent identity in the pane. */
export const Chrongirl = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 122 122" fill="none" className="shrink-0">
    <path d="M69.5791 89.6768C67.9697 91.2784 65.8408 92.251 63.5752 92.419H63.5283H63.5244C61.3252 92.3174 59.2666 91.3213 57.8252 89.6573C57.5439 89.3721 57.165 89.2081 56.7666 89.2042C56.3682 89.2003 55.9814 89.3565 55.7002 89.6339C55.415 89.9151 55.2549 90.2979 55.251 90.6964C55.251 91.0948 55.4072 91.4776 55.6885 91.7589C57.6846 94.005 60.5166 95.3292 63.5205 95.4151H63.6299C66.7002 95.2354 69.5947 93.9229 71.7588 91.7354C72.3213 91.1338 72.2939 90.1885 71.6923 89.6221C71.0947 89.0557 70.1494 89.0791 69.5791 89.6768Z" fill="#D97757" />
    <path d="M54.8103 71.1413C52.3767 69.0319 46.3806 66.3249 41.1073 71.1687H41.1034C40.494 71.7273 40.4549 72.6765 41.0135 73.2859C41.576 73.8953 42.5213 73.9343 43.1307 73.3757C47.7362 69.1413 52.6307 73.2234 52.8495 73.407C53.4745 73.9499 54.4237 73.8796 54.9628 73.2546C55.5058 72.6257 55.4353 71.6804 54.8103 71.1413Z" fill="#D97757" />
    <path d="M77.3917 68.2394C75.0401 68.5324 72.9034 69.755 71.4542 71.6261C70.9659 72.2941 71.1105 73.2316 71.7784 73.7199C72.4464 74.2082 73.3839 74.0637 73.8722 73.3957C74.8058 72.2199 76.1534 71.4426 77.6378 71.2238C79.2433 71.0871 80.9387 71.884 82.677 73.5832H82.6809C83.2707 74.1613 84.22 74.1496 84.7981 73.5598C85.3762 72.966 85.3645 72.0168 84.7746 71.4387C82.384 69.1067 79.9034 68.0206 77.3917 68.2394Z" fill="#D97757" />
    <path d="M105.833 54.1803C104.739 39.9383 97.1534 27.4263 85.5401 20.7073C76.1299 15.2659 65.6221 14.512 56.6141 18.6018C53.2274 17.7698 35.8601 14.383 26.1101 29.5158C18.9382 40.6448 12.9621 57.8438 17.6843 72.7498C20.8952 82.8868 28.5713 90.4998 40.4893 95.3868C46.4815 101.457 54.1803 105.117 62.5713 105.117C73.0443 105.117 82.4343 99.4142 88.7783 90.4333C91.4541 89.1442 107.825 80.1363 105.833 54.1793L105.833 54.1803ZM86.4111 88.6213C80.6181 96.883 72.0831 102.121 62.5711 102.121C54.9773 102.121 48.0051 98.7854 42.5551 93.2385C41.5356 90.7619 33.9145 71.4925 36.6645 56.2345C38.9809 61.0783 43.0317 64.8751 48.0165 66.8675C48.5946 67.0941 49.2509 66.9456 49.6688 66.4925C50.0907 66.0355 50.1883 65.3675 49.9149 64.8128C49.8797 64.7386 46.9032 58.5862 47.7508 52.9648C50.2977 56.9453 55.6375 63.6878 64.0438 66.9768C63.2743 71.5588 62.286 79.1798 63.786 81.2858H63.7899C64.118 81.7428 64.6727 81.9811 65.2274 81.8991C65.5946 81.8444 66.6141 81.8756 66.9344 82.2741C67.1648 82.5631 67.2234 83.3757 66.6805 84.8053V84.8014C66.3953 85.5748 66.7859 86.4342 67.5555 86.7233C68.325 87.0162 69.1883 86.6295 69.4852 85.86C70.3719 83.5123 70.3016 81.6725 69.2703 80.3912L69.2664 80.3951C68.4539 79.4693 67.2898 78.9263 66.0555 78.8951C65.786 77.0279 66.2196 72.3756 66.9305 67.9181H66.9344C68.7782 68.422 70.6688 68.7345 72.5789 68.8517C73.0672 68.8829 73.5438 68.6681 73.8445 68.2775C74.0945 67.9572 78.8289 61.8166 79.2 54.9255C83.1844 60.2849 89.3212 71.7073 86.4111 88.6213Z" fill="#D97757" />
  </svg>
);

/** Codex mark — the real gradient badge from the legacy app, the other chroma
 * exception. */
export const CodexTile = ({ size = 15 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 100 100" fill="none" className="shrink-0">
    <circle cx="49.9995" cy="50.0003" r="33.3335" fill="white" />
    <path d="M33.688 1.91297C37.7023 0.261368 42.0725 -0.335347 46.3825 0.179629C51.9381 0.818521 56.8882 3.17964 61.2326 7.263C61.2882 7.31855 61.366 7.35744 61.4382 7.37967C61.5166 7.39897 61.5986 7.39897 61.6771 7.37967C67.3252 5.9211 73.3039 6.46087 78.5994 8.90745L78.8605 9.02967L79.5049 9.34634C85.0481 12.1558 89.3718 16.8965 91.6606 22.6742C92.8217 25.5075 93.3994 28.4575 93.4106 31.5353C93.4941 33.8243 93.2433 36.1132 92.6661 38.3298C92.6377 38.4417 92.638 38.559 92.6672 38.6707C92.6963 38.7825 92.7533 38.885 92.8328 38.9687C96.1328 42.341 98.3217 46.3576 99.405 51.0243C101.011 58.941 99.3661 66.08 94.4772 72.4356L93.7217 73.3578C90.4837 77.0642 86.2338 79.7443 81.4938 81.0689C81.391 81.0991 81.2966 81.153 81.2185 81.2264C81.1403 81.2997 81.0805 81.3904 81.0438 81.4912C79.9827 84.5523 78.916 87.1745 76.9327 89.7912C71.9327 96.3857 64.5882 100.047 56.3159 100.002C49.7215 99.969 43.877 97.5579 38.7769 92.769C38.7002 92.6972 38.6058 92.647 38.5033 92.6236C38.4008 92.6002 38.294 92.6043 38.1936 92.6357C36.038 93.3301 33.8603 93.4301 31.5047 93.4023C27.7528 93.3722 24.0572 92.4868 20.6991 90.8134C17.1814 89.0703 14.1188 86.5308 11.7546 83.3967C10.9101 82.2745 10.0712 81.2189 9.45458 79.9689C8.61272 78.2536 7.92483 76.467 7.39901 74.63C6.28902 70.4501 6.26225 66.0564 7.32123 61.8633C7.35606 61.7635 7.36747 61.6571 7.35457 61.5522C7.33555 61.4491 7.28278 61.3553 7.20457 61.2855C4.63827 58.6879 2.67681 55.556 1.46009 52.1132C0.650926 49.9926 0.180359 47.7578 0.0656423 45.491C-0.136187 42.5053 0.128091 39.5064 0.84898 36.602C2.72121 30.4242 6.30456 25.5742 11.5879 22.0575C12.7657 21.2742 13.8824 20.6631 14.9268 20.2242C16.1213 19.7297 17.3157 19.3131 18.5157 18.9631C18.6015 18.9365 18.6793 18.8891 18.7423 18.8251C18.8054 18.7611 18.8516 18.6825 18.8768 18.5964C19.788 15.3244 21.355 12.2718 23.4824 9.62412C26.1643 6.21859 29.6795 3.56261 33.688 1.91297ZM53.0326 60.6077C52.1297 60.6584 51.2805 61.0527 50.6593 61.7098C50.038 62.3668 49.6919 63.2368 49.6919 64.1411C49.6919 65.0453 50.038 65.9153 50.6593 66.5724C51.2805 67.2294 52.1297 67.6238 53.0326 67.6744H73.2327C73.7134 67.7014 74.1945 67.63 74.6466 67.4646C75.0987 67.2992 75.5124 67.0433 75.8622 66.7126C76.212 66.3818 76.4907 65.9832 76.6811 65.541C76.8716 65.0989 76.9698 64.6225 76.9698 64.1411C76.9698 63.6596 76.8716 63.1833 76.6811 62.7411C76.4907 62.299 76.212 61.9003 75.8622 61.5696C75.5124 61.2388 75.0987 60.9829 74.6466 60.8175C74.1945 60.6521 73.7134 60.5808 73.2327 60.6077H53.0326ZM30.3436 34.6131C29.8628 33.8301 29.0963 33.2647 28.2062 33.0366C27.3161 32.8086 26.3722 32.9356 25.574 33.391C24.7759 33.8463 24.1862 34.5942 23.9296 35.4765C23.673 36.3588 23.7697 37.3064 24.1991 38.1187L31.2658 50.4743L24.2324 62.3411C23.9957 62.7405 23.8399 63.1827 23.7741 63.6423C23.7082 64.1019 23.7335 64.57 23.8486 65.0199C23.9636 65.4697 24.1661 65.8925 24.4446 66.2641C24.723 66.6357 25.0719 66.9488 25.4713 67.1855C25.8708 67.4223 26.3129 67.578 26.7726 67.6439C27.2322 67.7098 27.7003 67.6844 28.1501 67.5694C28.6 67.4544 29.0228 67.2518 29.3944 66.9734C29.7659 66.695 30.079 66.3461 30.3158 65.9466L38.3936 52.3077C38.7121 51.7704 38.8825 51.1582 38.8873 50.5336C38.8922 49.909 38.7314 49.2943 38.4214 48.7521L30.3436 34.6131Z" fill="url(#codexGrad)" />
    <defs>
      <linearGradient id="codexGrad" x1="49.9992" y1="0.00185" x2="49.9992" y2="100.002" gradientUnits="userSpaceOnUse">
        <stop stopColor="#B1A7FF" />
        <stop offset="0.5" stopColor="#7A9DFF" />
        <stop offset="1" stopColor="#3941FF" />
      </linearGradient>
    </defs>
  </svg>
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
