# Brand seed palette

A new project with no committed brand colors needs one anchor color. Pick **one row** below (by the mood the brief calls for, not at random), use its OKLCH value as the brand's seed, and compose the rest of the palette around it. This table is a transcription of what one run of the upstream `palette.mjs` prints (its guidance) plus 24 of its 129 curated seeds spread around the hue wheel. Nothing here runs.

| Seed | OKLCH | Hue | One read of the mood |
| --- | --- | --- | --- |
| seed-202 | oklch(0.643 0.247 7.0) | 7° | Glossier brand pink — modern beauty editorial, confident and current |
| seed-015 | oklch(0.527 0.202 22.7) | 23° | Negroni hour on a Milanese terrace — bittersweet vermillion, aperitivo glassware catching low sun |
| seed-043 | oklch(0.781 0.119 38.1) | 38° | Aesop apothecary catalogue — considered terracotta, dermatological restraint, the warm color doing all the work against clinical white |
| seed-168 | oklch(0.400 0.103 50.0) | 50° | Aesop apothecary bottle — amber glass on a clinical white shelf, considered and pharmaceutical |
| seed-054 | oklch(0.740 0.162 68.1) | 68° | late-afternoon honey on terracotta — Mediterranean stucco at golden hour, sun-baked amber |
| seed-150 | oklch(0.750 0.148 80.0) | 80° | Klim Type Foundry specimen page — late-summer editorial gold, considered and grown-up |
| seed-063 | oklch(0.842 0.165 91.3) | 91° | late-afternoon Tuscan sun on limestone — golden hour, considered, optimistic |
| seed-065 | oklch(0.797 0.166 113.1) | 113° | late-summer olive grove at noon — sun-bleached leaves, dry stone, Mediterranean glare |
| seed-119 | oklch(0.600 0.154 130.0) | 130° | moss garden at Saihō-ji — damp stone, filtered green light through old cedar |
| seed-195 | oklch(0.650 0.150 145.0) | 145° | Considered horticulture brand — botanical research lab, the green of a healthy stem photographed in clean daylight |
| seed-159 | oklch(0.600 0.130 160.0) | 160° | moss-covered forest apothecary — herbal tinctures in amber glass, eucalyptus shadow |
| seed-185 | oklch(0.450 0.086 170.0) | 170° | weathered copper patina on a Pacific Northwest greenhouse — oxidized teal, glass light, botanical hush |
| seed-161 | oklch(0.720 0.100 188.0) | 188° | climate-tech dashboard — calm verdigris on plain paper, the quiet confidence of an instrument that just works |
| seed-125 | oklch(0.650 0.100 200.0) | 200° | climate-tech dashboard — calm operational teal, the color of clean water data and atmospheric sensors |
| seed-162 | oklch(0.550 0.091 210.0) | 210° | weathered nautical instrument — patinated brass on oxidized steel, the cool blue-grey of a ship's chronometer at dawn |
| seed-164 | oklch(0.550 0.105 230.0) | 230° | deep harbor at dawn — cold steel water, fog-muted light, the quiet before the boats leave |
| seed-082 | oklch(0.742 0.140 247.4) | 247° | high-altitude flight deck at dawn — cold cabin instruments glowing against a sky still holding night |
| seed-083 | oklch(0.340 0.159 262.4) | 262° | deep cobalt twilight — the moment after sunset when the sky goes electric blue and city windows start to glow |
| seed-090 | oklch(0.445 0.206 279.1) | 279° | Linear-style considered tool indigo — the violet of a focused product surface, not a nightclub |
| seed-137 | oklch(0.700 0.120 290.0) | 290° | Linear-adjacent indigo — the considered tool, late-evening focus mode, software made for people who care about craft |
| seed-094 | oklch(0.533 0.125 294.3) | 294° | Linear-style considered tool indigo — the violet of a focused product surface, calm authority for a creative workspace |
| seed-100 | oklch(0.450 0.150 330.0) | 330° | velvet boudoir at last call — bruised orchid and lipstick traces under low lamplight |
| seed-228 | oklch(0.360 0.147 340.0) | 340° | Figma-era creative tool plum — considered productivity software for designers, the inky violet of a serif wordmark on a marketing site |
| seed-231 | oklch(0.682 0.241 353.2) | 353° | Figma-era creative tool — a confident pink-magenta product brand, the kind a modern design platform uses to feel alive without shouting |

## Composing the palette around the seed

1. Read the brief (PRODUCT.md, DESIGN.md, the user's prompt). Write one specific phrase describing the mood the product calls for. Good: "1970s travel poster — sun-baked warmth, considered", "midnight jazz club — smoky brass, saxophone light". Bad: "modern and clean", "warm and inviting".
2. The seed's hue anchors the primary brand color. Choose L and C to match the mood; the same hue can be deep-and-velvet, bright-and-confident, or pale-and-faded. Primary's hue stays within ±10° of the seed.
3. Compose five more roles in OKLCH:
   - **bg**: the most important architectural choice. The mood lives in the brand colors (primary + accent) and typography, not in the surface. Putting warmth in both primary and bg is the AI cliche.
     - Default A, pure white: exactly `oklch(1 0 0)`. Not 0.99, not chroma 0.002.
     - Default B, pure black or near-black: L 0.04-0.12, chroma exactly 0.
     - Alt, tinted: chroma 0.015-0.05, only when the mood is explicitly environmental (the surface is part of the brand: a lacquered interior, a leather library) or the seed itself is desaturated (chroma < 0.10). Not for "feels warm".
     - If seed chroma > 0.10 and the mood is product-focused, it is almost always pure white. Target distribution across many palettes: about 50% pure white, 25% pure black, 25% tinted.
   - **surface**: bg pulled slightly toward ink (10-15% mix), same hue family. Cards, panels, sections.
   - **ink**: body text. At least 7:1 against bg. May carry the brand hue at low chroma.
   - **accent**: a second brand color, distinct from primary in both hue and lightness, picked to complement the mood. Badges, status pills, links, accent rules.
   - **muted**: secondary text. Ink pulled 40% toward bg, keeping ink's hue. At least 3.5:1 against bg.
4. Pick a color strategy: Restrained (tinted neutrals + accent at most 10%, the product default), Committed (one saturated color carries 30-60%), Full palette (3-4 named roles each used deliberately), Drenched (the surface is the color). The brief picks it.

## Hard rules

- OKLCH only, never hex.
- ink vs bg contrast at least 7.
- Primary chroma at most 0.23; if primary L > 0.78, chroma at most 0.18 (the fluorescent zone).
- Primary vs accent contrast at least 1.7: visibly distinct, not two variants of one hue at similar lightness.
- An accent that carries text on a filled badge is either saturated (chroma at least 0.10), clearly light (L at least 0.85) or clearly dark (L at most 0.30). Never a muddy mid-tone (L 0.45-0.72 with chroma under 0.10).
- Avoid the attractor zones: claude-beige (warm-cream bg + dusty brown primary), forest-green-on-cream, AI-purple-on-white, navy-cream-with-orange-accent.

## Text on color fills

Applies to any text on a saturated fill: buttons, badges, status pills, tags, callouts. For a saturated mid-luminance fill (L 0.42-0.78, chroma at least 0.08) use white text (or near-white from bg), even when WCAG says dark text passes: saturated colors look brighter than their luminance suggests and dark text on them reads muddy. Dark text is right only on pale fills (L > 0.85) or pure-neutral fills (chroma near 0).

Return the composed palette as CSS custom properties in OKLCH, then build with it. The seed is the start, not the recipe.
