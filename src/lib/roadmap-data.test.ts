import { describe, expect, it } from "vitest";
import { ago, historyPanelFrom } from "./roadmap-data";
import type { HistoryFacts } from "./ipc";

const NOW = 1_757_500_000_000; // ms
const S = NOW / 1000;

const CTX = {
  uncommittedOpen: false, checking: false, checkError: null,
  onCheckNow: () => {}, onToggleUncommitted: () => {},
  onViewDetails: () => {}, onStartHistory: () => {},
};

function facts(over: Partial<HistoryFacts> = {}): HistoryFacts {
  return {
    degraded: false,
    is_git: true,
    last_save: { ts: S - 3 * 3600, subject: "fix(notes): keep the caret in place" },
    dirty: [],
    remote: { kind: "ok", ref_name: "origin/react-shadcn", ahead: 2, behind: 0, checked_ms: NOW - 20 * 60_000, error: null },
    last_publish: { ts: S - 21 * 86_400, tag: "v0.7.0" },
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
    const p = historyPanelFrom(facts(), NOW, CTX);
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
    const p = historyPanelFrom(facts({
      dirty: [
        { code: "M", path: "src/a.ts", badge: "edited" },
        { code: "?", path: "src/b.ts", badge: "new" },
        { code: "D", path: "src/c.ts", badge: "deleted" },
        { code: "R", path: "src/d.ts", badge: "renamed" },
      ],
    }), NOW, { ...CTX, uncommittedOpen: true });
    if (p.kind !== "panel") throw new Error("expected the panel");
    expect(p.uncommitted.open).toBe(true);
    expect(p.uncommitted.files.map((f) => f.badge)).toEqual(["edited", "new", "deleted", "renamed"]);
  });

  it("never checked reads as never checked", () => {
    const p = historyPanelFrom(facts({
      remote: { kind: "ok", ref_name: "origin/main", ahead: 0, behind: 0, checked_ms: null, error: null },
    }), NOW, CTX);
    if (p.kind !== "panel") throw new Error("expected the panel");
    expect(p.remote).toMatchObject({ kind: "counts", checked: "never" });
  });

  it("a failed check keeps the old numbers and the old time, and says why", () => {
    const p = historyPanelFrom(facts({
      remote: {
        kind: "ok", ref_name: "origin/main", ahead: 2, behind: 1,
        checked_ms: NOW - 20 * 60_000, error: "Could not resolve host: github.com",
      },
    }), NOW, CTX);
    if (p.kind !== "panel") throw new Error("expected the panel");
    expect(p.remote).toEqual({
      kind: "counts", ahead: 2, behind: 1, refName: "origin/main",
      checked: "20 minutes ago", error: "Could not resolve host: github.com",
    });
  });

  it("a failed check keeps saying why after the facts have been re-read", () => {
    // history_facts never carries an error — it reads git and never fetches — so
    // the sentence has to come from the pane, or it dies on the next poll
    const p = historyPanelFrom(facts(), NOW, { ...CTX, checkError: "Could not resolve host: github.com" });
    if (p.kind !== "panel") throw new Error("expected the panel");
    expect(p.remote).toEqual({
      kind: "counts", ahead: 2, behind: 0, refName: "origin/react-shadcn",
      checked: "20 minutes ago", error: "Could not resolve host: github.com",
    });
  });

  it("no remote and never published are two different lines", () => {
    const noRemote = historyPanelFrom(facts({
      remote: { kind: "no-remote", ref_name: "", ahead: 0, behind: 0, checked_ms: null, error: null },
      last_publish: null,
    }), NOW, CTX);
    if (noRemote.kind !== "panel") throw new Error("expected the panel");
    expect(noRemote.remote).toEqual({ kind: "no-remote" });
    expect(noRemote.lastPublish).toBeNull();

    const never = historyPanelFrom(facts({
      remote: { kind: "never-published", ref_name: "", ahead: 0, behind: 0, checked_ms: null, error: null },
      last_publish: null,
    }), NOW, CTX);
    if (never.kind !== "panel") throw new Error("expected the panel");
    expect(never.remote).toEqual({ kind: "never-published" });
  });

  it("a publish with no tag names no tag", () => {
    const p = historyPanelFrom(facts({ last_publish: { ts: S - 86_400, tag: null } }), NOW, CTX);
    if (p.kind !== "panel") throw new Error("expected the panel");
    expect(p.lastPublish).toEqual({ ago: "yesterday", tag: null });
  });

  it("broken git says so instead of pretending there is no history", () => {
    const p = historyPanelFrom(facts({ degraded: true, is_git: false, last_save: null }), NOW, CTX);
    expect(p.kind).toBe("degraded");
  });

  it("a folder with no repo offers to start one", () => {
    const p = historyPanelFrom(facts({ degraded: false, is_git: false, last_save: null }), NOW, CTX);
    expect(p.kind).toBe("no-history");
  });

  it("nothing loaded yet is not a claim about anything", () => {
    const p = historyPanelFrom(null, NOW, CTX);
    if (p.kind !== "panel") throw new Error("expected the panel");
    expect(p.lastSave).toBeNull();
    expect(p.lastPublish).toBeNull();
    expect(p.uncommitted.files).toEqual([]);
  });

  it("no number in this panel is a save count", () => {
    const p = historyPanelFrom(facts(), NOW, CTX);
    expect(JSON.stringify(p)).not.toMatch(/save[s]? /i);
  });
});
