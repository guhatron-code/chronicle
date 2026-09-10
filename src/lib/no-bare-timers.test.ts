/*
 * "No new timers" is a law of this codebase, not a preference: every cadence goes
 * through `every()` in src/lib/scheduler.ts, which pauses when the window is
 * hidden, slows when it is unfocused and doubles on battery. A bare setTimeout /
 * setInterval in a pane, an overlay or a store is invisible to all three.
 *
 * A one-shot that ends a visual state (a flash, a ring, a focus hop) or debounces
 * a burst of events is not a cadence — those are marked `// timer-ok: <why>` on
 * the line, and the exact set of them is asserted below. Adding one means writing
 * its reason here, where it can be argued with.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = new URL("../..", import.meta.url).pathname;

/** Test files are not app cadence, and the scheduler is where the one real
 *  timer lives — neither is scanned. */
const SKIP = (rel: string) => /\.test\.tsx?$/.test(rel) || rel === "src/lib/scheduler.ts";

function walk(rel: string, deep: boolean, ext: RegExp, out: string[]): void {
  for (const name of readdirSync(join(ROOT, rel))) {
    const child = `${rel}/${name}`;
    if (statSync(join(ROOT, child)).isDirectory()) {
      if (deep) walk(child, deep, ext, out);
    } else if (ext.test(name) && !SKIP(child)) out.push(child);
  }
}

/** The surfaces that must not grow a timer of their own. */
function scanned(): string[] {
  const files = ["src/App.tsx"];
  walk("src/screens", true, /\.tsx$/, files);
  walk("src/overlays", false, /\.tsx$/, files);
  walk("src/components/chrome", false, /\.tsx$/, files);
  walk("src/lib", false, /\.ts$/, files);
  return files.sort();
}

/** Every timer that exists today, as `<file> — <reason>`. Line numbers move; a
 *  file and a reason do not. */
const ALLOWED = [
  'src/App.tsx — the fs-burst debounce, cleared on every event and on unmount',
  'src/App.tsx — one-shot, repaints the terminal tab when its grace window ends',
  'src/lib/term-sessions.ts — one-shot, lets the shell prompt settle before autotyping',
  'src/lib/term-sessions.ts — the trailing foreground probe, cleared on every chunk',
  'src/lib/web-store.ts — the persist debounce, cleared on every write',
  'src/lib/web-store.ts — the reload debounce for file tabs, cleared on every fs burst',
  'src/overlays/SearchOverlay.tsx — the 220ms keystroke debounce, cleared on every keystroke and on unmount',
  'src/screens/repo/RepoPane.tsx — the watcher\'s 450ms debounce, cleared on every event and on unmount',
  'src/screens/roadmap/RoadmapPane.tsx — one-shot, ends the copied flash',
  'src/screens/roadmap/RoadmapPane.tsx — one-shot, ends the "just done" ring',
  'src/screens/roadmap/bits.tsx — one-shot, releases a measured height after the expand animation',
];

const TIMER = /\b(setTimeout|setInterval)\(/;
const OK = /\/\/ timer-ok:\s*(.+?)\s*$/;

describe("no bare timers outside the scheduler", () => {
  it("scans the files it means to scan", () => {
    const files = scanned();
    for (const f of [
      "src/App.tsx",
      "src/screens/repo/RepoPane.tsx",
      "src/screens/roadmap/RoadmapPane.tsx",
      "src/screens/web/WebPane.tsx",
      "src/overlays/SearchOverlay.tsx",
      "src/components/chrome/TabStrip.tsx",
      "src/lib/web-store.ts",
    ]) expect(files, `${f} is not being scanned`).toContain(f);
    expect(files).not.toContain("src/lib/scheduler.ts");
    expect(files.some((f) => f.endsWith(".test.ts"))).toBe(false);
    expect(files.length).toBeGreaterThan(40);
  });

  it("finds no setTimeout or setInterval that isn't marked timer-ok", () => {
    const offenders: string[] = [];
    const marked: string[] = [];
    for (const rel of scanned()) {
      readFileSync(join(ROOT, rel), "utf8").split("\n").forEach((line, i) => {
        if (!TIMER.test(line)) return;
        const why = OK.exec(line)?.[1];
        if (why) marked.push(`${rel} — ${why}`);
        else offenders.push(`${rel}:${i + 1}  ${line.trim()}`);
      });
    }
    expect(
      offenders,
      `use every() from @/lib/scheduler, or mark the line "// timer-ok: <why>" and list it in no-bare-timers.test.ts:\n${offenders.join("\n")}`,
    ).toEqual([]);
    // the whitelist is exact: a new exemption has to be argued for in ALLOWED
    expect(marked.sort()).toEqual([...ALLOWED].sort());
  });
});
