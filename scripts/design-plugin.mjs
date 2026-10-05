#!/usr/bin/env node
// Assembles src-tauri/resources/design-plugin/: the hand-edited parts are
// committed there already; this script only (re)generates the Lucide icon
// set from node_modules/lucide-static so 1,500 SVGs never live in git.
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
const ROOT = path.resolve("src-tauri/resources/design-plugin");
const ICONS = path.join(ROOT, "skills/chronicle-icons/icons");
const SRC = path.resolve("node_modules/lucide-static/icons");
if (!existsSync(SRC)) { console.error("lucide-static is not installed: npm install"); process.exit(1); }
rmSync(ICONS, { recursive: true, force: true });
mkdirSync(ICONS, { recursive: true });
let n = 0;
for (const f of readdirSync(SRC)) if (f.endsWith(".svg")) { cpSync(path.join(SRC, f), path.join(ICONS, f)); n++; }
writeFileSync(path.join(ICONS, "..", "ICONS.txt"), readdirSync(ICONS).map((f) => f.replace(/\.svg$/, "")).join("\n") + "\n");
console.log(`design-plugin: ${n} icons`);
