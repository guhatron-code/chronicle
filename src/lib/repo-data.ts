/*
 * The pure repo-pane mappers: ground truth (list_dir / git_status_detail /
 * git_log_graph / stat_file / git_diff) in, frame view-models (F23/F24/F25) out.
 * No IPC here — everything is unit-testable.
 */
import type { DirEntry, GitLogRow, GitStatusDetail } from "./ipc";
import type { TreeNode, GitLetter } from "@/screens/repo/FileTree";
import type { CodeLine, DiffRow } from "@/screens/repo/Viewer";
import type {
  BranchArc,
  ChangeGroup,
  Commit,
  CommitRef,
  PublishState,
  SaveFile,
} from "@/screens/repo/HistoryPane";

export type GitStatus = GitStatusDetail;

/** Porcelain code → the tree/history badge letter. */
export function letterFor(code: string): GitLetter {
  if (code === "A" || code === "?" || code === "C") return "A";
  if (code === "D") return "D";
  return "M"; // M, R, T, U — all read as "modified" to a non-developer
}

/* ---- the file tree (F23) ---- */

/** Every changed path + every ancestor dir, for the dir-with-changes tint. */
export function changedPaths(status: GitStatus | null): Set<string> {
  const out = new Set<string>();
  if (!status) return out;
  for (const f of [...status.staged, ...status.unstaged]) {
    out.add(f.path);
    let p = f.path;
    while (p.includes("/")) {
      p = p.slice(0, p.lastIndexOf("/"));
      out.add(p);
    }
  }
  return out;
}

export type DirLoad =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; entries: DirEntry[] };

/**
 * Build the recursive tree from the lazily-loaded children cache.
 * `id` is the repo-relative path ("" = root, listed at the top level).
 */
export function buildTree(
  loads: Map<string, DirLoad>,
  expanded: Set<string>,
  changed: Set<string>,
  gitByPath: Map<string, GitLetter>,
  workspaces: Set<string>,
  parent = "",
): TreeNode[] {
  const load = loads.get(parent);
  if (!load) return [];
  if (load.kind === "loading")
    return [{ kind: "loading", id: `${parent}#loading`, label: `Reading ${parent.split("/").pop() || "the project"}…` }];
  if (load.kind === "error")
    return [{ kind: "error", id: parent || "#root", message: "Couldn't read this folder" }];
  return load.entries.map((e): TreeNode => {
    const id = parent ? `${parent}/${e.name}` : e.name;
    if (e.is_dir) {
      const open = expanded.has(id);
      const childLoad = loads.get(id);
      const empty = childLoad?.kind === "ready" && childLoad.entries.length === 0;
      return {
        kind: "dir",
        id,
        name: e.name,
        open,
        children: open ? buildTree(loads, expanded, changed, gitByPath, workspaces, id) : [],
        hasChanges: changed.has(id),
        empty,
        workspace: workspaces.has(id),
      };
    }
    return { kind: "file", id, name: e.name, git: gitByPath.get(id) };
  });
}

export function gitLetterMap(status: GitStatus | null): Map<string, GitLetter> {
  const m = new Map<string, GitLetter>();
  if (!status) return m;
  // unstaged first so a path both staged+unstaged shows its working-copy letter
  for (const f of status.staged) m.set(f.path, letterFor(f.code));
  for (const f of status.unstaged) m.set(f.path, letterFor(f.code));
  return m;
}

/* ---- the viewer (F24) ---- */

/** A light tone pass — whole-line comments dim; everything else default. */
export function codeLines(text: string): CodeLine[] {
  return text.replace(/\n$/, "").split("\n").map((l): CodeLine => {
    if (l.length === 0) return [];
    const t = l.trimStart();
    if (t.startsWith("//") || t.startsWith("#") || t.startsWith("/*") || t.startsWith("*"))
      return [{ t: l, tone: "dim" }];
    return [{ t: l }];
  });
}

export function parseDiff(raw: string): { rows: DiffRow[]; added: number; removed: number } {
  const rows: DiffRow[] = [];
  let added = 0;
  let removed = 0;
  let oldN = 0;
  let newN = 0;
  for (const l of raw.split("\n")) {
    if (l.startsWith("@@")) {
      const m = /^(@@[^@]*@@)\s*(.*)$/.exec(l);
      const hm = /-(\d+)(?:,\d+)?\s+\+(\d+)/.exec(l);
      if (hm) {
        oldN = Number(hm[1]);
        newN = Number(hm[2]);
      }
      rows.push({ kind: "hunk", header: m?.[1] ?? l, context: m?.[2] || undefined });
    } else if (l.startsWith("+") && !l.startsWith("+++")) {
      rows.push({ kind: "add", new: newN++, text: l.slice(1) });
      added++;
    } else if (l.startsWith("-") && !l.startsWith("---")) {
      rows.push({ kind: "del", old: oldN++, text: l.slice(1) });
      removed++;
    } else if (l.startsWith(" ") || l === "") {
      // skip the file headers / metadata lines that reach here before the first hunk
      if (rows.length > 0) rows.push({ kind: "ctx", old: oldN++, new: newN++, text: l.slice(1) });
    }
  }
  return { rows, added, removed };
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function extOf(path: string): string {
  const name = path.split("/").pop() ?? path;
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i + 1) : "";
}

/* ---- the history pane (F25) ---- */

export function splitName(path: string): { name: string; dir: string } {
  const i = path.lastIndexOf("/");
  return i < 0 ? { name: path, dir: "" } : { name: path.slice(i + 1), dir: path.slice(0, i) };
}

export function saveFiles(status: GitStatus): SaveFile[] {
  return status.staged.map((f) => ({ ...splitName(f.path), path: f.path }));
}

export function changeGroups(status: GitStatus, closed: Set<string>): ChangeGroup[] {
  const byDir = new Map<string, ChangeGroup["files"]>();
  for (const f of status.unstaged) {
    const { name, dir } = splitName(f.path);
    const key = dir || "."; // repo-root files group under "."
    if (!byDir.has(key)) byDir.set(key, []);
    byDir.get(key)!.push({ name, git: letterFor(f.code), path: f.path });
  }
  return [...byDir.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([dir, files]) => ({ dir, open: !closed.has(dir), files }));
}

/** Find the full repo path for a change-row name inside its group. */
export function pathInGroup(dir: string, name: string): string {
  return dir === "." ? name : `${dir}/${name}`;
}

export function publishStateFrom(s: {
  remote_url?: string | null;
  upstream?: boolean;
  ahead?: number;
  behind?: number;
  commits?: number;
}): PublishState {
  if (!s.remote_url) return { kind: "no-remote" };
  if (!s.upstream)
    return { kind: "never-published", label: `Never published · ${s.commits ?? 0} save${(s.commits ?? 0) === 1 ? "" : "s"} waiting` };
  const ahead = s.ahead ?? 0;
  const behind = s.behind ?? 0;
  if (ahead > 0)
    return {
      kind: "waiting",
      // the L4 in-column footer uses the short form so label + both buttons fit one row
      label: `${ahead} save${ahead === 1 ? "" : "s"} waiting`,
      behindLabel: behind > 0 ? `Bring down ${behind} newer` : undefined,
    };
  return { kind: "published" };
}

/* -- the commit graph: git_log_graph rows → trunk + branch arcs -- */

export type LogRow = GitLogRow;

function refsFrom(raw: string, currentBranch: string | null): CommitRef[] | undefined {
  if (!raw) return undefined;
  const out: CommitRef[] = [];
  for (const part of raw.split(",").map((x) => x.trim())) {
    if (!part) continue;
    const label = part.replace(/^HEAD -> /, "").replace(/^tag: /, "");
    if (label === "HEAD" || label.startsWith("origin/")) continue;
    out.push({ label, current: part.startsWith("HEAD -> ") || label === currentBranch });
  }
  return out.length ? out : undefined;
}

function authorFor(name: string): Commit["author"] {
  if (/claude|codex|bot|agent/i.test(name)) return { kind: "agent" };
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
  return { kind: "you", initials: initials || "?" };
}

/**
 * The legacy lane algorithm reduced to the F25 model: every commit gets a lane
 * (0 = trunk), and each contiguous run of same-lane side commits becomes one
 * BranchArc departing below the row above it and rejoining above the row below.
 */
export function mapCommits(
  rows: LogRow[],
  currentBranch: string | null,
): { commits: Commit[]; branches: BranchArc[] } {
  const have = new Set(rows.map((r) => r.hash));
  let lanes: (string | null)[] = [];
  const laneOf: number[] = [];
  for (const c of rows) {
    let nodeLane = lanes.indexOf(c.hash);
    if (nodeLane === -1) {
      nodeLane = lanes.indexOf(null);
      if (nodeLane === -1) {
        nodeLane = lanes.length;
        lanes.push(null);
      }
    }
    lanes.forEach((h, i) => {
      if (h === c.hash && i !== nodeLane) lanes[i] = null;
    });
    const parents = c.parents ?? [];
    lanes[nodeLane] = parents[0] && have.has(parents[0]) ? parents[0] : null;
    for (let k = 1; k < parents.length; k++) {
      const pp = parents[k];
      if (pp && have.has(pp) && lanes.indexOf(pp) === -1) {
        let idx = lanes.indexOf(null);
        if (idx === -1) {
          idx = lanes.length;
          lanes.push(null);
        }
        lanes[idx] = pp;
      }
    }
    while (lanes.length && lanes[lanes.length - 1] == null) lanes.pop();
    laneOf.push(Math.min(nodeLane, 4));
  }

  const commits: Commit[] = rows.map((r, i) => ({
    subject: r.subject,
    refs: refsFrom(r.refs, currentBranch),
    author: authorFor(r.author),
    hash: r.hash,
    ago: r.ago,
    lane: laneOf[i]!,
    // the deck dims the two oldest visible rows (.68 / .55)
    dim: i === rows.length - 1 && rows.length > 3 ? 0.55 : i === rows.length - 2 && rows.length > 4 ? 0.68 : undefined,
  }));

  const branches: BranchArc[] = [];
  let i = 0;
  while (i < commits.length) {
    const lane = laneOf[i]!;
    if (lane > 0) {
      let j = i;
      while (j + 1 < commits.length && laneOf[j + 1] === lane) j++;
      branches.push({ lane, fromRow: Math.max(0, i - 1), toRow: Math.min(commits.length - 1, j + 1) });
      i = j + 1;
    } else i++;
  }
  return { commits, branches };
}
