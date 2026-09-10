import { describe, expect, it } from "vitest";
import {
  buildWebTree, createFolder, deleteFolder, moveTab, newFolderId, normalizeSaved,
  renameFolder, sanitize, setFolderCollapsed, tabDot, tabLabel, tabsIn, type WebFolder,
} from "./web-model";

type T = { id: number; folder?: string | null; url?: string };
const tab = (id: number, folder?: string): T => ({ id, ...(folder ? { folder } : {}) });
const folder = (id: string, name = id, collapsed = false): WebFolder => ({ id, name, collapsed });

const ids = (tabs: readonly T[]) => tabs.map((t) => t.id);
const filed = (tabs: readonly T[]) => tabs.map((t) => `${t.id}${t.folder ? `@${t.folder}` : ""}`);

describe("buildWebTree", () => {
  it("puts folders first, then the root's tabs, each in order", () => {
    const tabs = [tab(1), tab(2, "a"), tab(3), tab(4, "b"), tab(5, "a")];
    const tree = buildWebTree(tabs, [folder("a"), folder("b")]);
    expect(tree.map((n) => (n.kind === "folder" ? `folder:${n.folder.id}` : `tab:${n.tab.id}`)))
      .toEqual(["folder:a", "folder:b", "tab:1", "tab:3"]);
    expect(tree[0].kind === "folder" && ids(tree[0].tabs)).toEqual([2, 5]);
    expect(tree[1].kind === "folder" && ids(tree[1].tabs)).toEqual([4]);
  });

  it("reads open from the folder's own flag when no set is given", () => {
    const tree = buildWebTree([], [folder("a", "A", true), folder("b")]);
    expect(tree.map((n) => n.kind === "folder" && n.open)).toEqual([false, true]);
  });

  it("lets the live collapsed set override the persisted flag", () => {
    const tree = buildWebTree([], [folder("a", "A", true), folder("b")], new Set(["b"]));
    expect(tree.map((n) => n.kind === "folder" && n.open)).toEqual([true, false]);
  });

  it("draws a tab filed under a folder that no longer exists at the root", () => {
    const tree = buildWebTree([tab(1, "gone")], []);
    expect(tree).toEqual([{ kind: "tab", tab: { id: 1, folder: "gone" } }]);
  });

  it("keeps an empty folder — it is still a place to drop a tab", () => {
    const tree = buildWebTree([tab(1)], [folder("a")]);
    expect(tree[0].kind === "folder" && tree[0].tabs).toEqual([]);
  });

  it("is empty for no tabs and no folders", () => {
    expect(buildWebTree([], [])).toEqual([]);
  });
});

describe("tabsIn", () => {
  it("counts the root's tabs, orphans included", () => {
    const tabs = [tab(1), tab(2, "a"), tab(3, "gone")];
    expect(ids(tabsIn(tabs, [folder("a")], null))).toEqual([1, 3]);
    expect(ids(tabsIn(tabs, [folder("a")], "a"))).toEqual([2]);
  });
});

describe("moveTab", () => {
  const fs = [folder("a"), folder("b")];

  it("files a root tab into a folder at an index", () => {
    const tabs = [tab(1), tab(2, "a"), tab(3, "a")];
    const next = moveTab(tabs, fs, 1, "a", 1);
    expect(ids(tabsIn(next, fs, "a"))).toEqual([2, 1, 3]);
    expect(tabsIn(next, fs, null)).toEqual([]);
  });

  it("appends past the end of the destination", () => {
    const tabs = [tab(1), tab(2, "a")];
    expect(ids(tabsIn(moveTab(tabs, fs, 1, "a", 99), fs, "a"))).toEqual([2, 1]);
  });

  it("clamps a negative index to the front", () => {
    const tabs = [tab(1), tab(2, "a")];
    expect(ids(tabsIn(moveTab(tabs, fs, 1, "a", -4), fs, "a"))).toEqual([1, 2]);
  });

  it("drops a tab into an empty folder", () => {
    const next = moveTab([tab(1), tab(2)], fs, 2, "b", 0);
    expect(ids(tabsIn(next, fs, "b"))).toEqual([2]);
    expect(ids(tabsIn(next, fs, null))).toEqual([1]);
  });

  it("reorders inside one folder — the index counts the list after the lift", () => {
    const tabs = [tab(1, "a"), tab(2, "a"), tab(3, "a")];
    expect(ids(tabsIn(moveTab(tabs, fs, 1, "a", 2), fs, "a"))).toEqual([2, 3, 1]);
    expect(ids(tabsIn(moveTab(tabs, fs, 3, "a", 0), fs, "a"))).toEqual([3, 1, 2]);
  });

  it("moving a tab onto its own position leaves the order alone", () => {
    const tabs = [tab(1, "a"), tab(2, "a")];
    expect(ids(tabsIn(moveTab(tabs, fs, 1, "a", 0), fs, "a"))).toEqual([1, 2]);
  });

  it("takes a tab back out to the root", () => {
    const tabs = [tab(1), tab(2, "a"), tab(3)];
    const next = moveTab(tabs, fs, 2, null, 1);
    expect(ids(tabsIn(next, fs, null))).toEqual([1, 2, 3]);
    expect(next.find((t) => t.id === 2)?.folder).toBeUndefined();
  });

  it("never disturbs the other folder's order", () => {
    const tabs = [tab(1, "a"), tab(2, "b"), tab(3, "a"), tab(4, "b")];
    const next = moveTab(tabs, fs, 3, "a", 0);
    expect(ids(tabsIn(next, fs, "b"))).toEqual([2, 4]);
    expect(ids(tabsIn(next, fs, "a"))).toEqual([3, 1]);
  });

  it("treats an unknown folder as the root", () => {
    const next = moveTab([tab(1, "a")], fs, 1, "nope", 0);
    expect(next[0].folder).toBeUndefined();
  });

  it("is a no-op for a tab that is not there, and copies the array", () => {
    const tabs = [tab(1)];
    const next = moveTab(tabs, fs, 42, "a", 0);
    expect(next).toEqual(tabs);
    expect(next).not.toBe(tabs);
  });
});

describe("folders", () => {
  it("creates with a sanitised name and a unique id", () => {
    const { folders, folder: f } = createFolder([], "Docs/Ref:2026");
    expect(f.name).toBe("Docs-Ref-2026");
    expect(folders).toEqual([f]);
    expect(newFolderId()).not.toBe(newFolderId());
  });

  it("falls back to Untitled when the sanitiser eats the name", () => {
    expect(createFolder([], "  ...  ").folder.name).toBe("Untitled");
    expect(createFolder([], "").folder.name).toBe("Untitled");
  });

  it("renames, and ignores a name that sanitises to nothing", () => {
    const fs = [folder("a", "A"), folder("b", "B")];
    expect(renameFolder(fs, "a", "Reading")).toEqual([folder("a", "Reading"), folder("b", "B")]);
    expect(renameFolder(fs, "a", "///")).toEqual(fs);
  });

  it("toggles collapsed on one folder only", () => {
    const fs = [folder("a"), folder("b")];
    expect(setFolderCollapsed(fs, "a", true).map((f) => f.collapsed)).toEqual([true, false]);
  });

  it("delete moves its tabs to the root in place, and closes nothing", () => {
    const tabs = [tab(1), tab(2, "a"), tab(3, "a"), tab(4, "b")];
    const fs = [folder("a"), folder("b")];
    const out = deleteFolder(tabs, fs, "a");
    expect(out.folders).toEqual([folder("b")]);
    expect(filed(out.tabs)).toEqual(["1", "2", "3", "4@b"]);
    expect(ids(tabsIn(out.tabs, out.folders, null))).toEqual([1, 2, 3]);
  });

  it("deleting a folder that is not there changes nothing", () => {
    const fs = [folder("a")];
    expect(deleteFolder([tab(1, "a")], fs, "zz")).toEqual({ tabs: [tab(1, "a")], folders: fs });
  });
});

describe("sanitize", () => {
  it("collapses separators, trims dots and dashes, caps the length", () => {
    expect(sanitize("a/b\\c:d")).toBe("a-b-c-d");
    expect(sanitize(".hidden")).toBe("hidden");
    expect(sanitize("x".repeat(200))).toHaveLength(80);
    expect(sanitize("  spaced  ")).toBe("spaced");
  });
});

describe("normalizeSaved", () => {
  it("migrates a pre-folders file: every tab at the root, in order", () => {
    const legacy = [{ url: "https://a", title: "A" }, { url: "https://b", title: "B" }];
    expect(normalizeSaved(legacy)).toEqual({
      tabs: [{ url: "https://a", title: "A" }, { url: "https://b", title: "B" }],
      folders: [],
    });
    expect(buildWebTree(normalizeSaved(legacy).tabs.map((t, i) => ({ id: i, folder: t.folder })), []))
      .toHaveLength(2);
  });

  it("round-trips the modern shape", () => {
    const saved = {
      tabs: [{ url: "https://a", title: "A", folder: "f1" }, { url: "https://b", title: "" }],
      folders: [{ id: "f1", name: "Reading", collapsed: true }],
    };
    expect(normalizeSaved(saved)).toEqual(saved);
    expect(normalizeSaved(normalizeSaved(saved))).toEqual(saved);
  });

  it("drops a tab filed under a folder the file does not carry", () => {
    const out = normalizeSaved({ tabs: [{ url: "https://a", title: "A", folder: "ghost" }], folders: [] });
    expect(out.tabs).toEqual([{ url: "https://a", title: "A" }]);
  });

  it("drops junk rather than throwing the pane away", () => {
    expect(normalizeSaved(null)).toEqual({ tabs: [], folders: [] });
    expect(normalizeSaved("nope")).toEqual({ tabs: [], folders: [] });
    expect(normalizeSaved({})).toEqual({ tabs: [], folders: [] });
    expect(normalizeSaved({ tabs: [{ title: "no url" }, { url: "https://a" }], folders: [{ name: "no id" }] }))
      .toEqual({ tabs: [{ url: "https://a", title: "" }], folders: [] });
  });

  it("keeps the first of two folders sharing an id", () => {
    const out = normalizeSaved({ tabs: [], folders: [{ id: "x", name: "One" }, { id: "x", name: "Two" }] });
    expect(out.folders).toEqual([{ id: "x", name: "One", collapsed: false }]);
  });
});

describe("the row's label and dot", () => {
  it("prefers the title, then the address, then New tab", () => {
    expect(tabLabel({ title: "Chronicle", url: "https://example.com" })).toBe("Chronicle");
    expect(tabLabel({ title: "", url: "https://example.com/x" })).toBe("https://example.com/x");
    expect(tabLabel({ title: "", url: "about:blank" })).toBe("New tab");
    expect(tabLabel({ title: "", url: "" })).toBe("New tab");
  });

  it("shows a project file as its file name, not the whole path", () => {
    expect(tabLabel({ title: "", url: "chronicle-file://abc/docs/report.html" })).toBe("report.html");
    expect(tabLabel({ title: "", url: "chronicle-file://abc/report.html" })).toBe("report.html");
  });

  it("dots: loading beats everything, then local, then live", () => {
    expect(tabDot({ loading: true, url: "https://a" })).toBe("loading");
    expect(tabDot({ loading: false, url: "chronicle-file://h/a.html" })).toBe("local");
    expect(tabDot({ loading: false, url: "http://a" })).toBe("live");
    expect(tabDot({ loading: false, url: "about:blank" })).toBeNull();
  });
});
