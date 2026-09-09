/*
 * "No new timers" is a law of this codebase, not a preference: every cadence goes
 * through `every()` in src/lib/scheduler.ts, which pauses when the window is
 * hidden, slows when it is unfocused and doubles on battery. A bare setTimeout /
 * setInterval in a pane or a store is invisible to all three.
 *
 * A one-shot that ends a visual state (a flash, a ring) or debounces a burst of
 * events is not a cadence — those are marked `// timer-ok: <why>` on the line and
 * listed below. The list is closed: a new one has to be argued for here first.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = new URL("../..", import.meta.url).pathname;

/** The surfaces that must not grow a timer of their own. scheduler.ts is the
 *  one place a real timer lives, and it is not scanned. */
function scanned(): string[] {
  const files: string[] = [
    "src/App.tsx",
    "src/lib/repo-editor.ts",
    "src/lib/round-log.ts",
    "src/lib/notes-store.ts",
    "src/lib/roadmap-data.ts",
  ];
  for (const dir of ["src/screens/repo", "src/screens/roadmap"]) {
    for (const name of readdirSync(join(ROOT, dir))) {
      if (name.endsWith(".tsx")) files.push(`${dir}/${name}`);
    }
  }
  return files;
}

/** Every timer that exists today, with the reason it is allowed. Each of these
 *  lines carries a matching `// timer-ok:` comment. */
const ALLOWED = 6;

describe("no bare timers outside the scheduler", () => {
  it("scans the files it means to scan", () => {
    const files = scanned();
    expect(files).toContain("src/App.tsx");
    expect(files).toContain("src/screens/repo/RepoPane.tsx");
    expect(files).toContain("src/screens/roadmap/RoadmapPane.tsx");
    expect(files.length).toBeGreaterThan(10);
  });

  it("finds no setTimeout or setInterval that isn't marked timer-ok", () => {
    const offenders: string[] = [];
    let allowed = 0;
    for (const rel of scanned()) {
      const lines = readFileSync(join(ROOT, rel), "utf8").split("\n");
      lines.forEach((line, i) => {
        if (!/\b(setTimeout|setInterval)\(/.test(line)) return;
        if (/\/\/ timer-ok:/.test(line)) { allowed += 1; return; }
        offenders.push(`${rel}:${i + 1}  ${line.trim()}`);
      });
    }
    expect(offenders, `use every() from @/lib/scheduler, or mark the line "// timer-ok: <why>":\n${offenders.join("\n")}`)
      .toEqual([]);
    // the whitelist is closed: a new timer-ok has to be argued for in this file
    expect(allowed).toBe(ALLOWED);
  });
});
