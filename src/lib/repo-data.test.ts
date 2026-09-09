import { describe, expect, it } from "vitest";
import { buildTree, newPathIn, nextFreeName, type DirLoad } from "./repo-data";
import type { GitLetter } from "@/screens/repo/FileTree";

const ready = (names: [string, boolean][]): DirLoad => ({
  kind: "ready",
  entries: names.map(([name, is_dir]) => ({ name, is_dir, size: 0 })),
});

describe("new-name helpers", () => {
  it("joins a name into a folder, and the root has no leading slash", () => {
    expect(newPathIn("", "a.ts")).toBe("a.ts");
    expect(newPathIn("src", "a.ts")).toBe("src/a.ts");
    expect(newPathIn("src/lib", "a.ts")).toBe("src/lib/a.ts");
  });

  it("finds the next free name rather than clobbering", () => {
    const taken = new Set(["src/a.ts", "src/a 2.ts"]);
    expect(nextFreeName(taken, "src/b.ts")).toBe("src/b.ts");
    expect(nextFreeName(taken, "src/a.ts")).toBe("src/a 3.ts");
    expect(nextFreeName(new Set(["src/x"]), "src/x")).toBe("src/x 2");
  });
});

describe("the tree's pending row", () => {
  const loads = new Map<string, DirLoad>([
    ["", ready([["src", true], ["README.md", false]])],
    ["src", ready([["a.ts", false]])],
  ]);
  const noChange = new Set<string>();
  const noGit = new Map<string, GitLetter>();
  const noWs = new Set<string>();

  it("puts the input row first inside the folder being added to", () => {
    const roots = buildTree(loads, new Set(["src"]), noChange, noGit, noWs, "", { parent: "src", kind: "file" });
    const src = roots.find((n) => n.id === "src");
    expect(src?.kind).toBe("dir");
    if (src?.kind !== "dir") throw new Error("src is a folder");
    expect(src.children[0]?.kind).toBe("input");
    expect(src.children[1]?.id).toBe("src/a.ts");
  });

  it("puts it at the top level when the root is the target", () => {
    const roots = buildTree(loads, new Set(), noChange, noGit, noWs, "", { parent: "", kind: "dir" });
    expect(roots[0]?.kind).toBe("input");
    expect(roots[1]?.id).toBe("src");
  });

  it("adds nothing when nothing is pending", () => {
    const roots = buildTree(loads, new Set(), noChange, noGit, noWs, "", null);
    expect(roots.some((n) => n.kind === "input")).toBe(false);
  });
});
