import { describe, expect, it } from "vitest";
import { ago, historyPanelFrom, mapRoadmap, type RoadmapCtx } from "./roadmap-data";
import type { HistoryFacts, StateData } from "./ipc";

const NOW = 1_757_500_000_000; // ms
const S = NOW / 1000;

const CTX = {
  nowMs: NOW,
  uncommittedOpen: false, checking: false, checkError: null,
  onCheckNow: () => {}, onToggleUncommitted: () => {},
  onViewDetails: () => {}, onStartHistory: () => {},
};

/** What `git log` alone can answer, plus the last real check. */
function facts(over: Partial<HistoryFacts> = {}): HistoryFacts {
  return {
    last_save: { ts: S - 3 * 3600, subject: "fix(notes): keep the caret in place" },
    last_publish: { ts: S - 21 * 86_400, tag: "v0.7.0" },
    checked_ms: NOW - 20 * 60_000,
    error: null,
    ...over,
  };
}

/** The rest of the panel rides on the poll everyone already pays for. */
function repo(over: Partial<StateData> = {}): StateData {
  return {
    repo: "/p", dir: "/p",
    manifest_present: false, manifest_error: null, manifest: null,
    is_git: true, branch: "react-shadcn", upstream: true,
    ahead: 2, behind: 0, remote_url: "git@github.com:x/y.git",
    commits: 12, last_commit: "", tags: [], worktrees: [],
    dirty: [], published: "ok", remote_ref: "origin/react-shadcn",
    statuses: [], docs: {}, stale: [], custom_actions: [], manifest_warnings: [],
    work_branch: null, init_consent: null, checked_at: "",
    ...over,
  };
}

describe("ago", () => {
  it("says the plainest true thing", () => {
    expect(ago(NOW, S)).toBe("just now");
    expect(ago(NOW, S - 45)).toBe("just now");
    expect(ago(NOW, S - 60)).toBe("1 minute ago");
    expect(ago(NOW, S - 20 * 60)).toBe("20 minutes ago");
    expect(ago(NOW, S - 3600)).toBe("1 hour ago");
    expect(ago(NOW, S - 3 * 3600)).toBe("3 hours ago");
    expect(ago(NOW, S - 86_400)).toBe("yesterday");
    expect(ago(NOW, S - 3 * 86_400)).toBe("3 days ago");
    expect(ago(NOW, S - 21 * 86_400)).toBe("3 weeks ago");
    expect(ago(NOW, S - 200 * 86_400)).toBe("6 months ago");
    expect(ago(NOW, S + 500)).toBe("just now"); // a clock skew never says "in 8 minutes"
  });

  it("counts the last days before a year as months, not as zero years", () => {
    expect(ago(NOW, S - 360 * 86_400)).toBe("11 months ago");
    expect(ago(NOW, S - 364 * 86_400)).toBe("11 months ago");
    expect(ago(NOW, S - 365 * 86_400)).toBe("1 year ago");
    expect(ago(NOW, S - 730 * 86_400)).toBe("2 years ago");
  });

  it("never counts backwards, however far the clock has drifted", () => {
    for (const skew of [1, 500, 86_400, 400 * 86_400]) {
      const said = ago(NOW, S + skew);
      expect(said).toBe("just now");
      expect(said).not.toMatch(/-|in /);
    }
  });
});

describe("the four history lines", () => {
  it("states each fact with its own time", () => {
    const p = historyPanelFrom(facts(), repo(), CTX);
    if (p.kind !== "panel") throw new Error("expected the panel");
    expect(p.lastSave).toEqual({ ago: "3 hours ago", subject: "fix(notes): keep the caret in place" });
    expect(p.remote).toEqual({
      kind: "counts", ahead: 2, behind: 0,
      refName: "origin/react-shadcn", checked: "20 minutes ago", error: undefined,
    });
    expect(p.lastPublish).toEqual({ ago: "3 weeks ago", tag: "v0.7.0" });
    expect(p.uncommitted.files).toEqual([]);
  });

  it("carries the dirty files with their badge words", () => {
    const p = historyPanelFrom(facts(), repo({
      dirty: [
        { code: "M", path: "src/a.ts", badge: "edited" },
        { code: "?", path: "src/b.ts", badge: "new" },
        { code: "D", path: "src/c.ts", badge: "deleted" },
        { code: "R", path: "src/d.ts", badge: "renamed" },
      ],
    }), { ...CTX, uncommittedOpen: true });
    if (p.kind !== "panel") throw new Error("expected the panel");
    expect(p.uncommitted.open).toBe(true);
    expect(p.uncommitted.files.map((f) => f.badge)).toEqual(["edited", "new", "deleted", "renamed"]);
  });

  it("never checked reads as never checked", () => {
    const p = historyPanelFrom(
      facts({ checked_ms: null }),
      repo({ remote_ref: "origin/main", ahead: 0, behind: 0 }),
      CTX,
    );
    if (p.kind !== "panel") throw new Error("expected the panel");
    expect(p.remote).toMatchObject({ kind: "counts", checked: "never" });
  });

  it("a failed check keeps the old numbers and the old time, and says why", () => {
    const p = historyPanelFrom(
      facts({ error: "Could not resolve host: github.com" }),
      repo({ remote_ref: "origin/main", ahead: 2, behind: 1 }),
      CTX,
    );
    if (p.kind !== "panel") throw new Error("expected the panel");
    expect(p.remote).toEqual({
      kind: "counts", ahead: 2, behind: 1, refName: "origin/main",
      checked: "20 minutes ago", error: "Could not resolve host: github.com",
    });
  });

  it("a failed check keeps saying why after the facts have been re-read", () => {
    // only git_fetch ever sets `error`, and the very next poll re-reads the
    // facts without one — so the sentence has to come from the pane or it dies
    const p = historyPanelFrom(facts(), repo(), { ...CTX, checkError: "Could not resolve host: github.com" });
    if (p.kind !== "panel") throw new Error("expected the panel");
    expect(p.remote).toEqual({
      kind: "counts", ahead: 2, behind: 0, refName: "origin/react-shadcn",
      checked: "20 minutes ago", error: "Could not resolve host: github.com",
    });
  });

  it("no remote and never published are two different lines", () => {
    const noRemote = historyPanelFrom(
      facts({ last_publish: null, checked_ms: null }),
      repo({ published: "no-remote", remote_ref: "", ahead: 0, behind: 0 }),
      CTX,
    );
    if (noRemote.kind !== "panel") throw new Error("expected the panel");
    expect(noRemote.remote).toEqual({ kind: "no-remote" });
    expect(noRemote.lastPublish).toBeNull();

    const never = historyPanelFrom(
      facts({ last_publish: null, checked_ms: null }),
      repo({ published: "never-published", remote_ref: "", ahead: 0, behind: 0 }),
      CTX,
    );
    if (never.kind !== "panel") throw new Error("expected the panel");
    expect(never.remote).toEqual({ kind: "never-published" });
  });

  it("a publish with no tag names no tag", () => {
    const p = historyPanelFrom(facts({ last_publish: { ts: S - 86_400, tag: null } }), repo(), CTX);
    if (p.kind !== "panel") throw new Error("expected the panel");
    expect(p.lastPublish).toEqual({ ago: "yesterday", tag: null });
  });

  it("broken git says so instead of pretending there is no history", () => {
    const p = historyPanelFrom(facts({ last_save: null }), repo({ git_degraded: true, is_git: false }), CTX);
    expect(p.kind).toBe("degraded");
  });

  it("a folder with no repo offers to start one", () => {
    const p = historyPanelFrom(facts({ last_save: null }), repo({ is_git: false }), CTX);
    expect(p.kind).toBe("no-history");
  });

  it("no number in this panel is a save count", () => {
    const p = historyPanelFrom(facts(), repo(), CTX);
    expect(JSON.stringify(p)).not.toMatch(/save[s]? /i);
  });
});

describe("the history section while the facts are still on their way", () => {
  // every handler is a no-op here; the mapping is what is under test
  const handlers = new Proxy({}, { get: () => () => {} }) as RoadmapCtx["handlers"];
  const ctx = (over: Partial<RoadmapCtx> = {}): RoadmapCtx => ({
    agent: "claude", partOf: null, initRun: null, fixesRun: null, execRun: null,
    digest: null, consent: null, copiedPath: null, expandedId: null,
    justSwitched: false, historyFacts: null, historyChecking: false,
    historyError: null, uncommittedOpen: false, warningDismissed: false,
    handlers, ...over,
  });

  /* The panel used to render "nothing saved yet · Everything saved · not on
     GitHub · never published" through the first read and through every project
     switch — four confident sentences about a project nobody had looked at. */
  it("says nothing at all until the facts have landed", () => {
    expect(mapRoadmap(repo(), ctx()).history).toBeUndefined();
  });

  it("draws the panel the moment they have", () => {
    const p = mapRoadmap(repo(), ctx({ historyFacts: facts() })).history;
    expect(p?.kind).toBe("panel");
    if (p?.kind !== "panel") throw new Error("expected the panel");
    expect(p.lastSave?.subject).toBe("fix(notes): keep the caret in place");
  });
});
