/*
 * C5 dev-preview fixtures — one export per Deck-4 frame state (F23–F25) plus the
 * L3/L4 compositions, specimen copy transcribed verbatim (sentence-cased per the
 * operator rule). Wired into a preview harness by the maintainer later.
 */
import type { FileTreeProps, TreeNode } from "./FileTree";
import type { HistoryPaneProps, HistoryReady } from "./HistoryPane";
import type { CodeLine, DiffRow, ViewerProps } from "./Viewer";
import type { RepoProps } from "./Repo";

/* ============ F23 · file tree ============ */

const treeRoots: TreeNode[] = [
  {
    kind: "dir",
    id: "lumen-site",
    name: "lumen-site",
    open: true,
    hasChanges: true,
    children: [
      {
        kind: "dir",
        id: "lumen-site/src",
        name: "src",
        open: true,
        hasChanges: true,
        children: [
          { kind: "file", id: "lumen-site/src/Pricing.tsx", name: "Pricing.tsx", git: "A" },
          { kind: "file", id: "lumen-site/src/Home.tsx", name: "Home.tsx", git: "M" },
          { kind: "file", id: "lumen-site/src/Legacy.tsx", name: "Legacy.tsx", git: "D" },
        ],
      },
      { kind: "dir", id: "lumen-site/docs", name: "docs", open: false, children: [] },
      { kind: "dir", id: "lumen-site/assets", name: "assets", open: true, empty: true, children: [] },
      { kind: "loading", id: "lumen-site/node_modules", label: "Reading node_modules…" },
    ],
  },
  {
    kind: "dir",
    id: "lumen-site-el1",
    name: "lumen-site-el1",
    open: false,
    workspace: true,
    children: [],
  },
  { kind: "error", id: "lumen-site-el1/broken", message: "Couldn't read this folder" },
];

export const fileTree: FileTreeProps = {
  roots: treeRoots,
  selectedId: "lumen-site/src/Pricing.tsx",
};

/* ============ F23/F24 · code viewer (contents, changed-on-disk bar) ============ */

const pricingLines: CodeLine[] = [
  [
    { t: "import", tone: "dim" },
    { t: " { Tier } " },
    { t: "from", tone: "dim" },
    { t: " " },
    { t: '"../components/Tier"', tone: "subtle" },
    { t: ";" },
  ],
  [],
  [
    { t: "export function", tone: "dim" },
    { t: " " },
    { t: "Pricing", tone: "primary" },
    { t: "() {" },
  ],
  [{ t: "  " }, { t: "return", tone: "dim" }, { t: " (" }],
  [
    { t: "    <" },
    { t: "section", tone: "primary" },
    { t: " " },
    { t: "className", tone: "subtle" },
    { t: "=" },
    { t: '"pricing"', tone: "subtle" },
    { t: ">" },
  ],
  [
    { t: "      <" },
    { t: "Tier", tone: "primary" },
    { t: " " },
    { t: "name", tone: "subtle" },
    { t: "=" },
    { t: '"Solo"', tone: "subtle" },
    { t: " " },
    { t: "highlighted", tone: "subtle" },
    { t: " />" },
  ],
  [{ t: "    </" }, { t: "section", tone: "primary" }, { t: ">" }],
  [{ t: "  );" }],
  [{ t: "}" }],
];

export const viewerCode: ViewerProps = {
  kind: "file",
  tabs: [
    { id: "pricing", name: "Pricing.tsx" },
    { id: "plan", name: "PLAN.md" },
  ],
  activeTabId: "pricing",
  path: "src/screens/Pricing.tsx",
  mode: "contents",
  meta: "tsx · 96 lines",
  changedOnDisk: true,
  body: { kind: "code", lines: pricingLines },
};

/* ============ F24 · diff view ============ */

const homeDiff: DiffRow[] = [
  { kind: "hunk", header: "@@ -18,7 +18,15 @@", context: "function Hero()" },
  { kind: "ctx", old: 18, new: 18, text: "  const copy = useCopy();" },
  { kind: "del", old: 19, text: " return <h1>{copy.title}</h1>;" },
  { kind: "add", new: 19, text: " return (" },
  { kind: "add", new: 20, text: '    <header className="hero">' },
  { kind: "add", new: 21, text: "      <h1>{copy.title}</h1>" },
  { kind: "ctx", old: 20, new: 22, text: "  }" },
];

export const viewerDiff: ViewerProps = {
  kind: "file",
  tabs: [{ id: "home", name: "Home.tsx" }],
  activeTabId: "home",
  path: "src/screens/Home.tsx",
  mode: "diff",
  diffStat: { added: 12, removed: 4 },
  body: { kind: "diff", rows: homeDiff },
};

/* ============ F24 · freshness states ============ */

export const viewerEmpty: ViewerProps = { kind: "empty" };

export const viewerReadError: ViewerProps = {
  kind: "file",
  tabs: [{ id: "secrets", name: ".env" }],
  activeTabId: "secrets",
  path: ".env",
  mode: "contents",
  body: {
    kind: "read-error",
    message: "This file couldn't be read",
    detail: "EACCES · permission denied",
  },
};

export const viewerImage: ViewerProps = {
  kind: "file",
  tabs: [{ id: "hero", name: "hero.png" }],
  activeTabId: "hero",
  path: "public/hero.png",
  mode: "contents",
  body: { kind: "image", caption: "hero.png · 1440×960 · 212 KB" },
};

export const viewerBinary: ViewerProps = {
  kind: "file",
  tabs: [{ id: "font", name: "Geist.woff2" }],
  activeTabId: "font",
  path: "fonts/Geist.woff2",
  mode: "contents",
  body: {
    kind: "binary",
    message: "Binary file",
    note: "Nothing readable to show.",
    detail: "fonts/Geist.woff2 · 84 KB",
  },
};

export const viewerHuge: ViewerProps = {
  kind: "file",
  tabs: [{ id: "bundle", name: "bundle.js" }],
  activeTabId: "bundle",
  path: "dist/bundle.js",
  mode: "contents",
  body: { kind: "huge", message: "This file is 2.4 MB", note: "Reading it may be slow." },
};

/* ============ F25 · history pane ============ */

const historyBody: HistoryReady = {
  kind: "ready",
  banner:
    "The last publish didn't finish — the network dropped. Nothing was lost; publish again when you're online.",
  message: "R-1: changelog layout drawn",
  readyToSave: [
    { name: "Changelog.tsx", dir: "src/screens" },
    { name: "PLAN.md", dir: "docs" },
  ],
  changes: [
    {
      dir: "src/screens",
      open: true,
      files: [
        { name: "Home.tsx" },
        { name: "Pricing.tsx", git: "A" },
        { name: "Legacy.tsx", git: "D" },
      ],
    },
    { dir: "docs", open: false, files: [{ name: "NOTES.md", git: "M" }] },
  ],
  publish: {
    kind: "waiting",
    label: "2 saves waiting to publish",
    behindLabel: "Bring down 3 newer",
  },
  commits: [
    {
      subject: "R-1: pricing layout drawn",
      refs: [{ label: "main", current: true }, { label: "R-1" }],
      author: { kind: "agent" },
      hash: "a41f2c9",
      ago: "18m ago",
      lane: 0,
    },
    {
      subject: "R-1: skeleton audit notes",
      author: { kind: "you", initials: "JD" },
      hash: "9c07b1e",
      ago: "2h ago",
      lane: 0,
    },
    {
      subject: "EL-1 workspace: type scale experiments",
      refs: [{ label: "el-1" }],
      author: { kind: "agent" },
      hash: "f3d9a02",
      ago: "1d ago",
      lane: 1,
      dim: 0.68,
    },
    {
      subject: "R-0: skeleton pages exist",
      refs: [{ label: "phase-0" }],
      author: { kind: "you", initials: "JD" },
      hash: "1b44e07",
      ago: "3d ago",
      lane: 0,
      dim: 0.55,
    },
  ],
  branches: [{ lane: 1, fromRow: 1, toRow: 3 }],
  hasMore: true,
};

export const historyReady: HistoryPaneProps = { branch: "main", state: historyBody };

/** Save box empty + "Nothing to save · everything is recorded." */
export const historyNothingToSave: HistoryPaneProps = {
  branch: "main",
  state: {
    ...historyBody,
    banner: undefined,
    message: "",
    readyToSave: [],
    changes: [],
    publish: { kind: "published" },
  },
};

export const historyPublished: HistoryPaneProps = {
  branch: "main",
  state: { ...historyBody, banner: undefined, publish: { kind: "published" } },
};

export const historyNoRemote: HistoryPaneProps = {
  branch: "main",
  state: { ...historyBody, banner: undefined, publish: { kind: "no-remote" } },
};

export const historyNeverPublished: HistoryPaneProps = {
  branch: "main",
  state: {
    ...historyBody,
    banner: undefined,
    publish: { kind: "never-published", label: "Never published · 12 saves waiting" },
  },
};

export const historyLoading: HistoryPaneProps = { branch: "main", state: { kind: "loading" } };

export const historyNoHistory: HistoryPaneProps = { state: { kind: "no-history" } };

/* ============ L3 / L4 · pane compositions ============ */

export const repoFiles: RepoProps = {
  view: { kind: "files", tree: fileTree, viewer: viewerCode },
  treeWidth: 230,
};

export const repoHistory: RepoProps = {
  view: { kind: "history", history: historyReady },
};
