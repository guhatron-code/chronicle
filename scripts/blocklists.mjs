#!/usr/bin/env node
// Downloads uBlock Origin's default filter lists, converts them to WebKit
// content-blocker JSON with eyeo's abp2blocklist, splits them under WebKit's
// 150k-rules-per-list cap and writes src-tauri/resources/blocklists/. Chunks
// are gzipped (level 9) before being written — a 20 MB raw JSON chunk is
// ~1 MB gzipped, and 40 MB of raw JSON has no business in git history. The
// manifest's sha256 is over the UNCOMPRESSED text (that's what WebKit
// actually compiles), so the Rust side inflates a chunk before hashing or
// compiling it. Run this before a release. `--check` validates the
// committed output instead.
import { createRequire } from "node:module";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import path from "node:path";

const require = createRequire(import.meta.url);
const { Filter } = require("abp2blocklist/adblockpluscore/lib/filterClasses");
const { ContentBlockerList } = require("abp2blocklist/lib/abp2blocklist.js");

const OUT = path.resolve("src-tauri/resources/blocklists");
const CAP = 150_000;
// WebKit caps a content-blocker list at 150k rules, but says nothing about
// bytes. `merge: "all"` can still produce chunks tens of MB in size (a
// merged generic-block rule's unless-domain list alone runs to hundreds of
// KB), which is too large to comfortably commit as a bundle resource. Cap
// chunks by size too, well under CAP, and split further when needed.
const MAX_CHUNK_BYTES = 20 * 1024 * 1024;
const SOURCES = [
  { name: "EasyList", url: "https://easylist.to/easylist/easylist.txt" },
  { name: "EasyPrivacy", url: "https://easylist.to/easylist/easyprivacy.txt" },
  { name: "uBlock filters", url: "https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/filters.txt" },
  { name: "uBlock privacy", url: "https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/privacy.txt" },
  { name: "uBlock badware", url: "https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/badware.txt" },
  { name: "uBlock unbreak", url: "https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/unbreak.txt" },
  { name: "uBlock quick fixes", url: "https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/quick-fixes.txt" },
  { name: "Peter Lowe's list", url: "https://pgl.yoyo.org/adservers/serverlist.php?hostformat=adblockplus&showintro=1&mimetype=plaintext" },
];

const sha = (s) => createHash("sha256").update(s).digest("hex");

async function check() {
  const manifest = JSON.parse(await readFile(path.join(OUT, "manifest.json"), "utf8"));
  let ok = true;
  for (const c of manifest.chunks) {
    const gz = await readFile(path.join(OUT, c.file));
    const text = gunzipSync(gz).toString("utf8");
    const rules = JSON.parse(text);
    const problems = [];
    if (!Array.isArray(rules)) problems.push("not an array");
    if (rules.length !== c.rules) problems.push(`rules ${rules.length} != manifest ${c.rules}`);
    if (rules.length > CAP) problems.push(`over the ${CAP} cap`);
    if (sha(text) !== c.sha256) problems.push("sha256 mismatch");
    if (problems.length) { ok = false; console.error(`${c.file}: ${problems.join(", ")}`); }
  }
  console.log(ok ? `ok — ${manifest.chunks.length} chunks, fetched ${manifest.fetched_at}` : "check failed");
  process.exit(ok ? 0 : 1);
}

async function build() {
  const list = new ContentBlockerList({ merge: "all" });
  const sources = [];
  let filters = 0;
  for (const s of SOURCES) {
    const res = await fetch(s.url, { headers: { "user-agent": "chronicle-blocklists/1" } });
    if (!res.ok) throw new Error(`${s.name}: HTTP ${res.status}`);
    const text = await res.text();
    let n = 0;
    for (const line of text.split(/\r?\n/)) {
      if (!/^\s*[^\[\s!]/.test(line)) continue; // comments, headers, blanks
      try { list.addFilter(Filter.fromText(Filter.normalize(line))); n++; } catch { /* unparsable line */ }
    }
    sources.push({ name: s.name, url: s.url, filters: n });
    filters += n;
    console.error(`${s.name}: ${n} filters`);
  }
  const rules = await list.generateRules();
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  const chunks = [];
  let current = [];
  let currentBytes = 2; // "[" + "]"
  const flush = async () => {
    if (!current.length) return;
    const text = JSON.stringify(current);
    const file = `${chunks.length}.json.gz`;
    await writeFile(path.join(OUT, file), gzipSync(text, { level: 9 }));
    chunks.push({ file, rules: current.length, sha256: sha(text), bytes: text.length });
    current = [];
    currentBytes = 2;
  };
  for (const rule of rules) {
    const added = JSON.stringify(rule).length + 1; // +1 for the separating comma
    if (current.length && (current.length >= CAP || currentBytes + added > MAX_CHUNK_BYTES)) {
      await flush();
    }
    current.push(rule);
    currentBytes += added;
  }
  await flush();
  const manifest = {
    fetched_at: new Date().toISOString(),
    converter: "abp2blocklist@721ec7f",
    sources, filters, rules: rules.length, chunks,
  };
  await writeFile(path.join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.error(`${rules.length} rules in ${chunks.length} chunk(s) → ${OUT}`);
}

if (process.argv.includes("--check")) await check(); else await build();
