# Notice

This plugin bundles third-party skills. Each keeps its own licence file beside it. Chronicle's own parts (`chronicle-ecommerce`, `chronicle-icons`, `agents/`, `.claude-plugin/`, this notice) are Chronicle's.

## Vendored skills

| Skill | Upstream | Version | Licence | Licence file |
| --- | --- | --- | --- | --- |
| `skills/impeccable/` | https://github.com/pbakaus/impeccable (Claude Code plugin cache) | 3.5.0 | Apache 2.0 | `skills/impeccable/LICENSE` |
| `skills/frontend-design/` | Anthropic, `claude-plugins-official` (cache build ab024cdcfa7c; every cached build had an identical SKILL.md) | n/a (unversioned) | Apache 2.0 | `skills/frontend-design/LICENSE.txt` |
| `skills/canvas-design/` | https://github.com/anthropics/skills, `skills/canvas-design` | commit 8a1541c4a3ffa5a20a5a91de0dcf3f0bab1d1ef4 | Apache 2.0 | `skills/canvas-design/LICENSE.txt` |
| `skills/algorithmic-art/` | https://github.com/anthropics/skills, `skills/algorithmic-art` | commit 8a1541c4a3ffa5a20a5a91de0dcf3f0bab1d1ef4 | Apache 2.0 | `skills/algorithmic-art/LICENSE.txt` |

`frontend-design`, `canvas-design` and `algorithmic-art` are copied verbatim, with no edits. Note that the skills' own `LICENSE.txt` files are the terms for those folders; some bundled assets inside `canvas-design/canvas-fonts/` carry their own licences, kept beside the fonts.

## Icons

`skills/chronicle-icons/icons/` is the Lucide icon set (ISC licence, https://lucide.dev), copied from the `lucide-static` npm package (1.49.0) by `scripts/design-plugin.mjs`. The icons are generated at build time and not committed; the licence text is `skills/chronicle-icons/LICENSE`, copied from the package by the same script and committed.

## Edits to vendored files (impeccable 3.5.0)

Every change from the upstream tree, and why:

1. Removed `scripts/live*.mjs`, `scripts/live-*.js`, `scripts/live/`, `scripts/pin.mjs`, `scripts/critique-storage.mjs`, `scripts/modern-screenshot.umd.js`, `reference/live.md` and `reference/codex.md`: the live browser-iteration mode and the Codex helper do not run inside Chronicle's Design pane. Kept `scripts/detector/**`, `scripts/detect.mjs`, `scripts/palette.mjs`, `scripts/context*.mjs` (the last are not run by Chronicle; harmless). `reference/init.md` and a few other `reference/*.md` files and scripts still mention live mode (for example init's Step 6, which writes `.impeccable/live/config.json`); they are left as upstream wrote them and are harmless, since the `live` command is gone.
2. `SKILL.md`, front matter: removed `live` from `argument-hint`.
3. `SKILL.md`, front matter: removed the `allowed-tools` block (`Bash(npx impeccable *)`); Chronicle sets the session's permissions itself.
4. `SKILL.md`, Setup step 1: replaced the instruction to run `scripts/context.mjs` with "Chronicle names the project's `PRODUCT.md` and `DESIGN.md` in every message's prefix; read them when named. Never run `context.mjs`." The session is not guaranteed a shell and Chronicle already supplies those files.
5. `SKILL.md`, Setup step 5: replaced the instruction to run `scripts/palette.mjs` with "If there are no committed brand colors, pick the seed from `reference/palette.md`." so no script has to run.
6. Added `reference/palette.md`: a table of 24 of the 129 seeds in `scripts/palette.mjs` (one per 15 degree hue band) and the composition guidance and hard rules that script prints, transcribed from one run. This file is Chronicle's addition, derived from upstream's script.

7. `SKILL.md`, command table: removed the `live` row (it linked the deleted `reference/live.md`).
8. `SKILL.md`, "No argument" menu: removed the bullet that said to lead with `live` when `devServer.running` is true.
9. `SKILL.md`, "No argument" menu: replaced "Setup has already run `context.mjs`; if that reported `NO_PRODUCT_MD`..." with a sentence saying Chronicle supplies PRODUCT.md and DESIGN.md (Setup step 1), since `context.mjs` is never run. Edits 7-9 follow from dropping `live`; no other rule was changed.

No other file in `skills/impeccable/` was changed.
