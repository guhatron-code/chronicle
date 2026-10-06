---
name: chronicle-fonts
description: Fourteen open font families bundled as woff2; copy them into the design, never download a font or link a font service.
---

The fonts are in `fonts/<family>/`, latin subset, as `<family>-latin-<weight>-normal.woff2` (and `<family>-latin-400-italic.woff2` where the family has an italic). To use one: copy the files you need from `${CLAUDE_PLUGIN_ROOT}/skills/chronicle-fonts/fonts/<family>/` into the design's `assets/fonts/`, then load them with `@font-face` from there, one rule per file, with `font-display: swap` (the `url()` below is as seen from a page in `frames/`; from a stylesheet in `assets/` it is `fonts/<file>`). Two families per design at most. Licences (all SIL OFL 1.1) are in `licenses/`.

The pattern, shown once (the other families follow it with their own names and weights):

```css
@font-face { font-family: "Inter"; font-weight: 400; font-style: normal; font-display: swap; src: url("../assets/fonts/inter-latin-400-normal.woff2") format("woff2"); }
@font-face { font-family: "Inter"; font-weight: 600; font-style: normal; font-display: swap; src: url("../assets/fonts/inter-latin-600-normal.woff2") format("woff2"); }
@font-face { font-family: "Inter"; font-weight: 400; font-style: italic; font-display: swap; src: url("../assets/fonts/inter-latin-400-italic.woff2") format("woff2"); }
```

## Families
- **Inter** — sans, neutral and tight; the safe product face. Weights: 400 500 600 700 + 400i. Copy from `${CLAUDE_PLUGIN_ROOT}/skills/chronicle-fonts/fonts/inter/`.
  `@font-face { font-family: "Inter"; font-weight: 400; font-style: normal; font-display: swap; src: url("../assets/fonts/inter-latin-400-normal.woff2") format("woff2"); }`
- **Schibsted Grotesk** — sans with character for editorial product UI. Weights: 400 500 600 700 + 400i. Copy from `${CLAUDE_PLUGIN_ROOT}/skills/chronicle-fonts/fonts/schibsted-grotesk/`.
  `@font-face { font-family: "Schibsted Grotesk"; font-weight: 400; font-style: normal; font-display: swap; src: url("../assets/fonts/schibsted-grotesk-latin-400-normal.woff2") format("woff2"); }`
- **DM Sans** — geometric sans, friendly and round. Weights: 400 500 600 700 + 400i. Copy from `${CLAUDE_PLUGIN_ROOT}/skills/chronicle-fonts/fonts/dm-sans/`.
  `@font-face { font-family: "DM Sans"; font-weight: 400; font-style: normal; font-display: swap; src: url("../assets/fonts/dm-sans-latin-400-normal.woff2") format("woff2"); }`
- **Space Grotesk** — quirky geometric sans for tech brands (no italic). Weights: 400 500 600 700. Copy from `${CLAUDE_PLUGIN_ROOT}/skills/chronicle-fonts/fonts/space-grotesk/`.
  `@font-face { font-family: "Space Grotesk"; font-weight: 400; font-style: normal; font-display: swap; src: url("../assets/fonts/space-grotesk-latin-400-normal.woff2") format("woff2"); }`
- **Source Sans 3** — humanist sans, quiet and readable at small sizes. Weights: 400 500 600 700 + 400i. Copy from `${CLAUDE_PLUGIN_ROOT}/skills/chronicle-fonts/fonts/source-sans-3/`.
  `@font-face { font-family: "Source Sans 3"; font-weight: 400; font-style: normal; font-display: swap; src: url("../assets/fonts/source-sans-3-latin-400-normal.woff2") format("woff2"); }`
- **Archivo** — grotesque sans, sturdy headlines. Weights: 400 500 600 700 + 400i. Copy from `${CLAUDE_PLUGIN_ROOT}/skills/chronicle-fonts/fonts/archivo/`.
  `@font-face { font-family: "Archivo"; font-weight: 400; font-style: normal; font-display: swap; src: url("../assets/fonts/archivo-latin-400-normal.woff2") format("woff2"); }`
- **Fraunces** — soft display serif with personality. Weights: 400 500 600 700 + 400i. Copy from `${CLAUDE_PLUGIN_ROOT}/skills/chronicle-fonts/fonts/fraunces/`.
  `@font-face { font-family: "Fraunces"; font-weight: 400; font-style: normal; font-display: swap; src: url("../assets/fonts/fraunces-latin-400-normal.woff2") format("woff2"); }`
- **Young Serif** — warm heavy serif for headlines (one weight). Weights: 400. Copy from `${CLAUDE_PLUGIN_ROOT}/skills/chronicle-fonts/fonts/young-serif/`.
  `@font-face { font-family: "Young Serif"; font-weight: 400; font-style: normal; font-display: swap; src: url("../assets/fonts/young-serif-latin-400-normal.woff2") format("woff2"); }`
- **Libre Baskerville** — classic text serif for long reading. Weights: 400 500 600 700 + 400i. Copy from `${CLAUDE_PLUGIN_ROOT}/skills/chronicle-fonts/fonts/libre-baskerville/`.
  `@font-face { font-family: "Libre Baskerville"; font-weight: 400; font-style: normal; font-display: swap; src: url("../assets/fonts/libre-baskerville-latin-400-normal.woff2") format("woff2"); }`
- **Playfair Display** — high-contrast display serif, fashion and editorial. Weights: 400 500 600 700 + 400i. Copy from `${CLAUDE_PLUGIN_ROOT}/skills/chronicle-fonts/fonts/playfair-display/`.
  `@font-face { font-family: "Playfair Display"; font-weight: 400; font-style: normal; font-display: swap; src: url("../assets/fonts/playfair-display-latin-400-normal.woff2") format("woff2"); }`
- **Instrument Serif** — condensed display serif, modern (one weight). Weights: 400 + 400i. Copy from `${CLAUDE_PLUGIN_ROOT}/skills/chronicle-fonts/fonts/instrument-serif/`.
  `@font-face { font-family: "Instrument Serif"; font-weight: 400; font-style: normal; font-display: swap; src: url("../assets/fonts/instrument-serif-latin-400-normal.woff2") format("woff2"); }`
- **Zilla Slab** — slab serif, friendly and technical. Weights: 400 500 600 700 + 400i. Copy from `${CLAUDE_PLUGIN_ROOT}/skills/chronicle-fonts/fonts/zilla-slab/`.
  `@font-face { font-family: "Zilla Slab"; font-weight: 400; font-style: normal; font-display: swap; src: url("../assets/fonts/zilla-slab-latin-400-normal.woff2") format("woff2"); }`
- **JetBrains Mono** — mono for code and data. Weights: 400 500 600 700 + 400i. Copy from `${CLAUDE_PLUGIN_ROOT}/skills/chronicle-fonts/fonts/jetbrains-mono/`.
  `@font-face { font-family: "JetBrains Mono"; font-weight: 400; font-style: normal; font-display: swap; src: url("../assets/fonts/jetbrains-mono-latin-400-normal.woff2") format("woff2"); }`
- **IBM Plex Mono** — mono with a typewriter note. Weights: 400 500 600 700 + 400i. Copy from `${CLAUDE_PLUGIN_ROOT}/skills/chronicle-fonts/fonts/ibm-plex-mono/`.
  `@font-face { font-family: "IBM Plex Mono"; font-weight: 400; font-style: normal; font-display: swap; src: url("../assets/fonts/ibm-plex-mono-latin-400-normal.woff2") format("woff2"); }`

Pairings that work: Fraunces + Inter, Playfair Display + Source Sans 3, Instrument Serif + Archivo, Young Serif + DM Sans, Schibsted Grotesk alone, Space Grotesk + IBM Plex Mono, Libre Baskerville + Zilla Slab.
