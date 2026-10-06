#!/usr/bin/env node
// Assembles src-tauri/resources/design-plugin/: the hand-edited parts are
// committed there already; this script only (re)generates what comes from npm
// packages so neither 1,500 SVGs nor a megabyte of fonts lives in git: the
// Lucide icon set from lucide-static, and the font families from @fontsource/*.
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
const ROOT = path.resolve("src-tauri/resources/design-plugin");

// icons
const ICONS = path.join(ROOT, "skills/chronicle-icons/icons");
const SRC = path.resolve("node_modules/lucide-static/icons");
if (!existsSync(SRC)) { console.error("lucide-static is not installed: npm install"); process.exit(1); }
rmSync(ICONS, { recursive: true, force: true });
mkdirSync(ICONS, { recursive: true });
let n = 0;
for (const f of readdirSync(SRC)) if (f.endsWith(".svg")) { cpSync(path.join(SRC, f), path.join(ICONS, f)); n++; }
// ISC requires the licence text to travel with the icons; committed (outside the ignored icons/ dir)
cpSync(path.resolve("node_modules/lucide-static/LICENSE"), path.join(ICONS, "..", "LICENSE"));
writeFileSync(path.join(ICONS, "..", "ICONS.txt"), readdirSync(ICONS).map((f) => f.replace(/\.svg$/, "")).join("\n") + "\n");

// fonts: the latin subset only, weights 400/500/600/700 upright and the 400 italic,
// whichever of those the package has. SKILL.md (committed) lists each family.
const FAMILIES = ["inter", "schibsted-grotesk", "dm-sans", "space-grotesk", "source-sans-3", "fraunces", "young-serif",
  "libre-baskerville", "zilla-slab", "jetbrains-mono", "ibm-plex-mono", "instrument-serif", "playfair-display", "archivo"];
const FONTS = path.join(ROOT, "skills/chronicle-fonts/fonts");
const LICENSES = path.join(ROOT, "skills/chronicle-fonts/licenses");
rmSync(FONTS, { recursive: true, force: true });
mkdirSync(LICENSES, { recursive: true });
let files = 0, bytes = 0;
for (const family of FAMILIES) {
  const pkg = path.resolve("node_modules/@fontsource", family);
  if (!existsSync(pkg)) { console.error(`@fontsource/${family} is not installed: npm install`); process.exit(1); }
  const want = new RegExp(`^${family}-latin-(400|500|600|700)-normal\\.woff2$|^${family}-latin-400-italic\\.woff2$`);
  const dir = path.join(FONTS, family);
  mkdirSync(dir, { recursive: true });
  for (const f of readdirSync(path.join(pkg, "files"))) {
    if (!want.test(f)) continue;
    cpSync(path.join(pkg, "files", f), path.join(dir, f));
    files++; bytes += statSync(path.join(dir, f)).size;
  }
  // the OFL text travels with each family; committed (outside the ignored fonts/ dir)
  cpSync(path.join(pkg, "LICENSE"), path.join(LICENSES, `${family}.txt`));
}
console.log(`design-plugin: ${n} icons · ${FAMILIES.length} font families, ${files} files, ${(bytes / 1048576).toFixed(1)} MB`);
