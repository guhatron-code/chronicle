# The fluid pane (Runs sub-project A) + the engine spike · implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the chat pane start under 1.5 s warm, stream at 60 fps on a 300-entry thread, keep the bottom pinned without fighting the stream, and move with one easing and two durations — and answer the one engine question the Runs sub-project depends on.

**Architecture:** The store keeps mutating entries in place (that is how every reducer path works today) but gains a per-entry revision and one coalesced notification per frame; the pane subscribes through `useSyncExternalStore` and renders memoised rows keyed by identity. The streaming reply goes through `streamdown` (already installed). Follow-scroll becomes a layout-effect pin with a ResizeObserver and a pure decision function. Motion is CSS tokens on `index.css`, not a library. On the Rust side the adapter is installed once into the managed tools folder and spawned through `node` directly, with `npx` as the fallback; the session is warmed when a project is opened. The spike is a throwaway probe in a scratch folder whose only product is a paragraph in the spec.

**Tech Stack:** React 19.2.7, TypeScript, Vite 8 + Tailwind 4 (`@tailwindcss/vite`), vitest (node environment, pure modules only), `streamdown` 2.5.0, Rust/Tauri 2, adapter `@agentclientprotocol/claude-agent-acp@0.75.1`.

**Spec:** `docs/superpowers/specs/2026-10-14-agent-orchestrator-design.md` — §9 (sub-project A), §5 (the spike), §12 (testing), §13 (order). Comps: `design/comps/runs/project/06-Motion.dc.html` (R5) and `07-Start-and-setup.dc.html` (R6), approved 2026-10-14.

## Global Constraints

- Branch in place on `react-shadcn`; never a worktree for development (the 1.2 GB `src-tauri/target`). Stage by explicit path; never `git add -A`, `stash`, `reset`, `checkout --`, `clean`.
- The installed Chronicle app runs on this repo and writes `.chronicle/` live: never touch `.chronicle/`, never delete `.chronicle/kanban.json` from the index.
- vitest runs `src/**/*.test.ts` in the **node** environment. No component tests, no jsdom/happy-dom, no new dev dependencies. Pure logic goes in `src/lib/*.ts` so it can be tested.
- No new runtime dependencies. `streamdown` 2.5.0 is already in `package.json` (unused); `motion` 12.42.2 is present but this plan does not use it (CSS does the work — see Task 7's note).
- Adapter pin stays `ADAPTER_PACKAGE = "@agentclientprotocol/claude-agent-acp"`, `ADAPTER_VERSION = "0.75.1"` in `src-tauri/src/acp.rs`. Chronicle holds no Anthropic key: `ANTHROPIC_API_KEY` is blanked and `CLAUDECODE` removed on every spawn, exactly as `adapter_command` does today.
- Vocabulary law for user-facing copy: sentence case; save/publish, never commit/push; the pane's state words are `warming`, `starting`, `ready`, `working`, `idle`, `needs login`, `stopped`, `ended`.
- Design tokens only (`var(--…)` / Tailwind token classes); no raw hex. Every animation is off under `prefers-reduced-motion: reduce` (index.css already zeroes durations globally; the new tokens must go through that path too).
- Targets (spec §9): warm start under 1.5 s from project open to `ready`; cold start under 3 s; one streamed chunk costs under 2 ms of render on a 300-entry thread; no visible jump while following.
- Checks: `npm run typecheck`, `npx vitest run`, `npm run build`, and `cd src-tauri && cargo test` (PATH needs `$HOME/.cargo/bin`). Release binary for live checks: `cargo build --release --features tauri/custom-protocol`.
- Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Review Focus

Inputs the spec implies but no task's tests would otherwise exercise; each has its test pinned to the owning task.

1. **A hidden or occluded window while a turn streams** — `requestAnimationFrame` does not fire; notifications must still reach subscribers (the round-settle logic listens to them). Pinned in Task 1: the timer backstop test.
2. **The user scrolled up to read while a long reply streams** — the thread must not yank them down; when they scroll back within reach of the bottom it pins again and glides once. Pinned in Task 5: `stickDecision` tests for `userAway`, `returned`.
3. **An adapter install folder holding a different version than the pin** (after a future bump) — detect must say `missing`, and the spawn must fall back to `npx` of the pinned version rather than launching the stale one. Pinned in Task 8: `adapter_entry_ignores_a_stale_install`.
4. **A project where Claude Code is not installed** — warm start must do nothing (no error banner, no spinner) and the pane must still show its honest start state. Pinned in Task 10: `warm start is a no-op without claude`.
5. **A chunk boundary inside a code fence, a table, or raw HTML** — the reply must render progressively, never throw, and never emit a `<script>` tag. Pinned in Task 4: the server-render fixture test.

---

### Task 0: The engine spike (throwaway; one day at most)

**Files:**
- Create (outside the repo): `~/chronicle-spike/` — a toy git repo with `.claude/workflows/spike.js`
- Modify: `docs/superpowers/specs/2026-10-14-agent-orchestrator-design.md` (append a "Spike result" subsection at the end of §5)

**Interfaces:**
- Consumes: the installed Chronicle app (or `npm run tauri dev`) and the user's Claude Code login.
- Produces: the written answer to §5's two questions, which Plan B (Runs) reads before choosing its engine. No code is kept.

- [ ] **Step 1: Build the toy repo and a two-agent workflow**

```bash
mkdir -p ~/chronicle-spike/.claude/workflows && cd ~/chronicle-spike && git init -q
cat > README.md <<'EOF'
# spike
Two files, two lanes.
EOF
cat > .claude/workflows/spike.js <<'EOF'
export const meta = {
  name: 'spike',
  description: 'Two agents each write one file; Chronicle watches',
  phases: [{ title: 'Write' }],
}
const SCHEMA = { type: 'object', properties: { file: { type: 'string' } }, required: ['file'] }
const results = await parallel([
  () => agent('Create a file named a.txt containing the word alpha. Use the Write tool. Reply with JSON {"file":"a.txt"}.', { label: 'lane-a', phase: 'Write', schema: SCHEMA }),
  () => agent('Create a file named b.txt containing the word beta. Use the Write tool. Reply with JSON {"file":"b.txt"}.', { label: 'lane-b', phase: 'Write', schema: SCHEMA }),
])
return { results }
EOF
git add -A && git commit -qm "spike" && echo ok
```

(This is the only place in the program where `git add -A` is allowed: it is a throwaway repo nobody else writes to.)

- [ ] **Step 2: Open the toy repo in Chronicle and run the workflow from the chat pane**

In the pane (ask-first mode, as shipped), send exactly:

```
Run the saved workflow named "spike" with the Workflow tool. Do not do the work yourself.
```

Allow the `Workflow` tool when the pane asks. Allow each lane's `Write` when the pane asks. Watch the thread.

- [ ] **Step 3: Record question 1 — are the workflow's agents visible?**

Note, in a scratch file, which of these appeared in the thread while the workflow ran: a subagent card per lane (`SubagentCard`, titled `lane-a` / `lane-b`), tool rows under them, their text. If nothing appears until the workflow ends, note that too.

- [ ] **Step 4: Record question 2 — can a permission request be attributed to its lane?**

Find the session log: `ls -t "$TMPDIR"/chronicle-acp-*.log | head -1` (the path pattern is in `acp.rs`, `session_log_path`). Extract the two `session/request_permission` requests:

```bash
grep -n 'request_permission' "$(ls -t "$TMPDIR"/chronicle-acp-*.log | head -1)" | head -5
```

For each, note every field of `params` that could tie it to a lane: `toolCall._meta` keys (look for `claudeCode.agentId`, `parentToolCallId`, `parentId`, a `subagent` marker), `toolCall.title`, and whether the `Write` path alone is enough (it is not — Chronicle's fence needs the lane). Write down the raw `_meta` object verbatim.

- [ ] **Step 5: Write the result into the spec and commit**

Append to §5 of the spec, under a new heading `### Spike result (2026-10-DD)`, four sentences: what showed in the pane (question 1), the exact `_meta` fields a permission request carried (question 2), the engine recommendation for Plan B (workflow-native if both answers are yes; one ACP session per lane otherwise), and the adapter version it was measured against. Then:

```bash
git add docs/superpowers/specs/2026-10-14-agent-orchestrator-design.md
git commit -m "docs(runs): spike result — what the pane sees of a workflow's agents

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
rm -rf ~/chronicle-spike
```

---

### Task 1: One notification per frame

**Files:**
- Modify: `src/lib/agent-session.ts` (the `notify` / `subscribeAgent` block, lines ~245-257)
- Test: `src/lib/agent-session.notify.test.ts` (new)

**Interfaces:**
- Consumes: nothing new.
- Produces: `export function agentVersion(): number` (a counter that increments once per delivered notification); `export function flushAgentNotifications(): void` (delivers a pending notification now; used by tests and by Task 3's unmount path). `subscribeAgent(cb)` keeps its signature. `notify()` stays private.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/agent-session.notify.test.ts
/*
 * The store used to call every subscriber synchronously on every wire message —
 * dozens of full pane renders a second while text streamed. Now a burst of
 * updates inside one frame is one delivery, with a timer backstop for the case
 * where no frame ever comes (a hidden window).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Update = { dir: string; message: { method: string; params?: Record<string, unknown> } };
let onUpdate: ((u: Update) => void) | null = null;

vi.mock("./ipc", () => ({
  onAcpUpdate: vi.fn(async (cb: (u: Update) => void) => { onUpdate = cb; return () => {}; }),
  agentPrompt: vi.fn(async () => {}), roundRunMessage: vi.fn(async () => ""),
  agentSessionStart: vi.fn(async () => {}), roundPlanBegin: vi.fn(), roundPlanCancel: vi.fn(async () => {}),
  roundPlanSettle: vi.fn(), agentCancel: vi.fn(), agentEdits: vi.fn(async () => []), agentHistoryRead: vi.fn(),
  agentSetConfigOption: vi.fn(), agentRespondPermission: vi.fn(), agentSessionResume: vi.fn(),
  agentSessionState: vi.fn(), agentSessionStop: vi.fn(), agentSessionsList: vi.fn(), agentSetMode: vi.fn(),
}));
vi.mock("./notes-store", () => ({
  indexFor: () => ({ notes: [], rounds: [], generation: 0, vault: "", borrowed: false }),
  refreshNotes: vi.fn(async () => {}), roundGenerating: vi.fn(() => false), roundNotesFor: vi.fn(() => []), setRoundGenerating: vi.fn(),
}));
vi.mock("./journal", () => ({ announce: vi.fn() }));
vi.mock("@/overlays/toasts", () => ({ toastAction: vi.fn(), toastError: vi.fn() }));

const agent = await import("./agent-session");
const DIR = "/p";
const chunk = (text: string) =>
  onUpdate!({ dir: DIR, message: { method: "session/update", params: { update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } } } } });

describe("notifications coalesce", () => {
  let frames: FrameRequestCallback[];
  beforeEach(() => {
    frames = [];
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { frames.push(cb); return frames.length; });
    Object.assign(agent.agentSessionFor(DIR), { phase: "ready", entries: [] });
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

  it("delivers one notification for a burst of chunks in one frame", () => {
    const seen = vi.fn();
    const off = agent.subscribeAgent(seen);
    const before = agent.agentVersion();
    for (let i = 0; i < 100; i++) chunk("x");
    expect(seen).not.toHaveBeenCalled();
    expect(frames.length).toBe(1); // one frame requested, not a hundred
    frames[0](0);
    expect(seen).toHaveBeenCalledTimes(1);
    expect(agent.agentVersion()).toBe(before + 1);
    expect(agent.agentSessionFor(DIR).entries[0]).toMatchObject({ kind: "assistant", text: "x".repeat(100) });
    off();
  });

  it("still delivers when no frame ever fires (a hidden window)", () => {
    const seen = vi.fn();
    const off = agent.subscribeAgent(seen);
    chunk("y");
    vi.advanceTimersByTime(60);
    expect(seen).toHaveBeenCalledTimes(1);
    // the frame that finally comes finds nothing pending and delivers nothing extra
    frames.forEach((f) => f(0));
    expect(seen).toHaveBeenCalledTimes(1);
    off();
  });

  it("flushAgentNotifications delivers a pending notification synchronously", () => {
    const seen = vi.fn();
    const off = agent.subscribeAgent(seen);
    chunk("z");
    agent.flushAgentNotifications();
    expect(seen).toHaveBeenCalledTimes(1);
    agent.flushAgentNotifications(); // nothing pending → nothing delivered
    expect(seen).toHaveBeenCalledTimes(1);
    off();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/lib/agent-session.notify.test.ts`
Expected: FAIL — `agent.agentVersion is not a function`, and the first test fails because `seen` was called 100 times.

- [ ] **Step 3: Replace `notify` with the coalescing version**

In `src/lib/agent-session.ts`, replace

```ts
function notify() {
  for (const cb of subs) cb();
}
```

with

```ts
/* ---------- notifications: one delivery per frame ----------
 * Every reducer path still calls notify() as before; delivery is deferred to
 * the next animation frame so a burst of chunks is one pane render. A 50 ms
 * timer backs the frame up: a hidden window gets no frames, and the round
 * logic that listens here must not stall with it. */
let version = 0;
let pending = false;
let backstop: ReturnType<typeof setTimeout> | null = null;

function deliver() {
  if (!pending) return;
  pending = false;
  if (backstop !== null) { clearTimeout(backstop); backstop = null; }
  version++;
  for (const cb of subs) cb();
}

function notify() {
  if (pending) return;
  pending = true;
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => deliver());
  backstop = setTimeout(deliver, 50);
}

/** Increments once per delivered notification — the snapshot `useSyncExternalStore` compares. */
export function agentVersion(): number {
  return version;
}

/** Deliver a pending notification now (tests; a pane unmounting mid-stream). */
export function flushAgentNotifications(): void {
  deliver();
}
```

- [ ] **Step 4: Run the new test and the whole suite**

Run: `npx vitest run src/lib/agent-session.notify.test.ts && npx vitest run`
Expected: the new file passes (3 tests). If an existing test in `src/lib/agent-session.test.ts` fails because it awaited a subscriber callback synchronously, add `agent.flushAgentNotifications()` after the wire call in that test (it asserts on store state, not timing). All 47+1 files pass.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/lib/agent-session.ts src/lib/agent-session.notify.test.ts
git commit -m "perf(pane): the store delivers one notification per frame, with a timer backstop for hidden windows

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Entry revisions and row signatures

**Files:**
- Modify: `src/lib/agent-session.ts` (the `AgentEntry` union; the 11 in-place mutation sites listed below)
- Create: `src/lib/thread-rows.ts`
- Test: `src/lib/thread-rows.test.ts` (new)

**Interfaces:**
- Consumes: `AgentEntry`, `ThreadItem`, `groupEntries` from `agent-session.ts`.
- Produces: every entry carries `rev: number` (starts at 0, bumped by `touch(e)` on each in-place change); `export function rowKeys(items: ThreadItem[]): string[]` (moved out of `AgentPane.tsx`, same behaviour); `export function rowSignature(item: ThreadItem): string` (a cheap string that changes if and only if the row must re-render); `export function touch<E extends { rev: number }>(e: E): E`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/thread-rows.test.ts
/*
 * Rows are memoised by signature, not by object identity, because the reducer
 * mutates entries in place (a streamed chunk appends to the last entry). The
 * signature must move when anything the row draws moves, and stay put otherwise.
 */
import { describe, expect, it } from "vitest";
import { rowKeys, rowSignature, touch } from "./thread-rows";
import type { AgentEntry, ThreadItem } from "./agent-session";

const tool = (id: string, extra: Partial<Extract<AgentEntry, { kind: "tool" }>> = {}): Extract<AgentEntry, { kind: "tool" }> =>
  ({ kind: "tool", toolCallId: id, title: id, toolKind: "other", status: "in_progress", rev: 0, ...extra }) as Extract<AgentEntry, { kind: "tool" }>;

describe("rowSignature", () => {
  it("moves when a streamed chunk lands on an assistant row", () => {
    const e: AgentEntry = { kind: "assistant", text: "hel", streaming: true, rev: 0 };
    const a = rowSignature(e);
    e.text += "lo";
    touch(e);
    expect(rowSignature(e)).not.toBe(a);
  });
  it("stays put when nothing about the row changed", () => {
    const e: AgentEntry = { kind: "assistant", text: "done", streaming: false, rev: 3 };
    expect(rowSignature(e)).toBe(rowSignature(e));
  });
  it("moves for a subagent group when a child changes, and when a child arrives", () => {
    const parent = tool("t1", { subagent: true });
    const child = tool("t2", { parentId: "t1" });
    const group: ThreadItem = { kind: "subagent", tool: parent, children: [child] };
    const a = rowSignature(group);
    child.status = "completed"; touch(child);
    const b = rowSignature(group);
    expect(b).not.toBe(a);
    group.children.push(tool("t3", { parentId: "t1" }));
    expect(rowSignature(group)).not.toBe(b);
  });
});

describe("rowKeys", () => {
  it("keys follow identity where the wire gives one and the n-th of its kind otherwise", () => {
    const items: ThreadItem[] = [
      { kind: "user", text: "a", rev: 0 } as AgentEntry,
      tool("t1"),
      { kind: "assistant", text: "b", streaming: false, rev: 0 },
      { kind: "assistant", text: "c", streaming: false, rev: 0 },
    ];
    expect(rowKeys(items)).toEqual(["user:1", "tool:t1", "assistant:1", "assistant:2"]);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/lib/thread-rows.test.ts`
Expected: FAIL — cannot find module `./thread-rows`.

- [ ] **Step 3: Add `rev` to every entry kind**

In `src/lib/agent-session.ts`, every member of the `AgentEntry` union (line ~89 onward) gains `rev: number`. The simplest edit: change the union to

```ts
export type AgentEntry = { rev: number } & (
  | { kind: "user"; text: string; checkpoint: ... }   // every existing member, unchanged
  | ...
);
```

Then every `s.entries.push({ kind: … })` literal gains `rev: 0`. Find them with `grep -n "entries.push(" src/lib/agent-session.ts` and add `rev: 0` to each object literal (there are about a dozen). The `blank()` state and the replay path (`reduceLines`) need nothing: they go through the same `push` sites.

- [ ] **Step 4: Add `touch` and apply it at the in-place mutation sites**

Create `src/lib/thread-rows.ts`:

```ts
/*
 * The thread's rows as the pane memoises them. The reducer mutates entries in
 * place, so identity cannot say "this row changed"; a per-entry revision can.
 * `touch` bumps it; `rowSignature` folds everything a row draws into one
 * string; `rowKeys` gives rows keys that follow them, not their position.
 */
import type { AgentEntry, ThreadItem } from "./agent-session";

export function touch<E extends { rev: number }>(e: E): E {
  e.rev++;
  return e;
}

/** Keys that follow a row, not its position: identity where the wire gives one; the n-th of its kind otherwise. */
export function rowKeys(items: ThreadItem[]): string[] {
  const seen = new Map<string, number>();
  return items.map((it) => {
    if (it.kind === "tool") return `tool:${it.toolCallId}`;
    if (it.kind === "subagent") return `sub:${it.tool.toolCallId}`;
    if (it.kind === "perm") return `perm:${it.requestId}`;
    const n = (seen.get(it.kind) ?? 0) + 1;
    seen.set(it.kind, n);
    return `${it.kind}:${n}`;
  });
}

/** Changes exactly when the row must re-render. A subagent group folds in its children. */
export function rowSignature(item: ThreadItem): string {
  if (item.kind === "subagent") {
    let s = `sub:${item.tool.rev}:${item.children.length}`;
    for (const c of item.children) s += `,${c.rev}`;
    return s;
  }
  return `${item.kind}:${item.rev}`;
}
```

In `src/lib/agent-session.ts`, import `touch` from `./thread-rows` and wrap each in-place change of an existing entry. The sites (line numbers as of this plan; search by text):

| Site | Change |
|---|---|
| `entry.output = \`${entry.output ?? ""}${str(block.text)}\`` | add `touch(entry);` after |
| `if (last?.kind === "thought") last.streaming = false;` (settleThoughtTail) | `{ last.streaming = false; touch(last); }` |
| `e.ended = true;` (two sites, `endNewestRoundCard`) | add `touch(e);` after each |
| `last.text += str(content.text)` (assistant chunk) | `{ last.text += str(content.text); touch(last); }` |
| `last.text += str(content.text)` (thought chunk) | same |
| `if (update.status != null) e.status = …` (tool_call_update) | add `touch(e);` at the end of that update block, once, after all fields are applied |
| `last.items = items` (plan) | add `touch(last);` |
| `if (last?.kind === "assistant") last.streaming = false;` (settleStreamTail) | `{ last.streaming = false; touch(last); }` |
| `settleStreaming`: `e.streaming = false` loop | `{ e.streaming = false; touch(e); }` |
| `e.rejected = true` (denied permission marks the tool) | add `touch(e);` |
| perm `outcome` assignment (search `outcome =` on a perm entry) | add `touch(…)` |

Also remove `rowKeys` from `src/screens/agent/AgentPane.tsx` and import it from `@/lib/thread-rows` there (Task 3 rewrites that file's thread anyway; do the import now so typecheck stays green).

- [ ] **Step 5: Run the tests, typecheck**

Run: `npx vitest run src/lib/thread-rows.test.ts && npx vitest run && npm run typecheck`
Expected: all pass. Typecheck will flag any `entries.push` literal missing `rev` — fix each.

- [ ] **Step 6: Commit**

```bash
git add src/lib/agent-session.ts src/lib/thread-rows.ts src/lib/thread-rows.test.ts src/screens/agent/AgentPane.tsx
git commit -m "perf(pane): entries carry a revision and rows a signature, so a row can be memoised despite in-place updates

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: The pane renders one row per change

**Files:**
- Modify: `src/screens/agent/AgentPane.tsx` (the component's subscription at lines ~559-561; the thread's `items.map` in both the viewing and the live branches; the `Entry` function)
- Create: `src/lib/perf.ts` (dev-only render accounting)

**Interfaces:**
- Consumes: `agentVersion`, `subscribeAgent`, `flushAgentNotifications` (Task 1); `rowKeys`, `rowSignature` (Task 2).
- Produces: `ThreadRow` — a memoised wrapper around `Entry` whose comparator is `rowSignature` plus `turnActive`/`readOnly`; `perf.ts` exports `profilerOnRender` and `perfSummary()`; in dev, `window.__chroniclePerf()` returns the summary.

- [ ] **Step 1: Dev-only render accounting, first — so "before" is measured on this commit's parent behaviour**

Create `src/lib/perf.ts`:

```ts
/*
 * Dev-only: how much the thread costs to render. React's Profiler calls
 * `profilerOnRender` on every commit of the subtree it wraps; we keep the
 * last 600 commits (10 s at 60 fps) and summarise on demand from the Web
 * Inspector: `__chroniclePerf()`.
 */
type Sample = { at: number; ms: number };
const samples: Sample[] = [];
export function profilerOnRender(_id: string, _phase: string, actualDuration: number): void {
  samples.push({ at: performance.now(), ms: actualDuration });
  if (samples.length > 600) samples.shift();
}
export function perfSummary(): { commits: number; avgMs: number; maxMs: number; over2ms: number; perSecond: number } {
  if (samples.length === 0) return { commits: 0, avgMs: 0, maxMs: 0, over2ms: 0, perSecond: 0 };
  const span = (samples[samples.length - 1].at - samples[0].at) / 1000 || 1;
  const ms = samples.map((s) => s.ms);
  return {
    commits: samples.length,
    avgMs: +(ms.reduce((a, b) => a + b, 0) / ms.length).toFixed(2),
    maxMs: +Math.max(...ms).toFixed(2),
    over2ms: ms.filter((m) => m > 2).length,
    perSecond: +(samples.length / span).toFixed(1),
  };
}
if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as { __chroniclePerf: () => unknown }).__chroniclePerf = perfSummary;
}
```

In `AgentPane.tsx`, wrap the live thread scroller's children in `<Profiler id="thread" onRender={profilerOnRender}>…</Profiler>` when `import.meta.env.DEV` (a ternary around the children; `Profiler` from `react`). Run `npm run tauri dev`, open a project, ask the agent for a 1,500-word answer, and while it streams open the Web Inspector (Safari → Develop → the Chronicle window) and run `__chroniclePerf()`. Create `c-runs/PROGRESS.md` with the heading `# Runs · PROGRESS` and a section `## Task 3 · streaming, before/after` holding the numbers under "before". Commit this alone:

```bash
git add src/lib/perf.ts src/screens/agent/AgentPane.tsx c-runs/PROGRESS.md
git commit -m "chore(pane): dev-only render accounting for the thread (Profiler → __chroniclePerf)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Step 2: Subscribe through `useSyncExternalStore`**

In `AgentPane.tsx` replace

```ts
const [, bump] = useState(0);
useEffect(() => subscribeAgent(() => bump((n) => n + 1)), []);
useEffect(() => subscribeNotesIndex(() => bump((n) => n + 1)), []);
```

with

```ts
useSyncExternalStore(subscribeAgent, agentVersion, agentVersion);
const [, bump] = useState(0);
useEffect(() => subscribeNotesIndex(() => bump((n) => n + 1)), []); // round cards tick with the vault, not with a keystroke
useEffect(() => () => flushAgentNotifications(), []); // a pane unmounting mid-stream leaves nothing pending
```

(`useSyncExternalStore` comes from `react`; add `agentVersion` and `flushAgentNotifications` to the `@/lib/agent-session` import.)

- [ ] **Step 3: Memoise the row**

Below the `Entry` function add:

```tsx
/** One thread row, re-rendered only when its signature moves (the reducer
 *  mutates entries in place, so identity cannot carry that information). */
const ThreadRow = memo(
  function ThreadRow(props: Parameters<typeof Entry>[0] & { sig: string }) {
    const { sig: _sig, ...rest } = props;
    return <Entry {...rest} />;
  },
  (a, b) => a.sig === b.sig && a.turnActive === b.turnActive && a.readOnly === b.readOnly && a.dir === b.dir,
);
```

(`memo` from `react`. The handler props — `onConfirm`, `onOpenNotes`, `onRetryRound` — are deliberately left out of the comparison: they are closures over `dir` and the store, and a stale one still does the right thing.)

- [ ] **Step 4: Use it in both thread branches**

Replace each `items.map((entry, i) => (<Appear key={keys[i]}><Entry … /></Appear>))` with

```tsx
{(() => {
  const items = groupEntries(s.entries) /* keep the existing .filter(...) in the live branch */;
  const keys = rowKeys(items);
  return items.map((entry, i) => (
    <Appear key={keys[i]}>
      <ThreadRow sig={rowSignature(entry)} dir={dir} entry={entry} turnActive={s.turnActive} onConfirm={onConfirm} onOpenNotes={onOpenNotes}
        /* the live branch also passes onRetryRound exactly as today; the viewing branch passes readOnly */ />
    </Appear>
  ));
})()}
```

Hoist the `onRetryRound` arrow out of the map into a `useCallback` on `[dir]` so it is not recreated per row (it is excluded from the comparator anyway, but React still allocates it).

- [ ] **Step 5: Typecheck, tests, build**

Run: `npm run typecheck && npx vitest run && npm run build`
Expected: all green; `vite build` reports no new warnings.

- [ ] **Step 6: Live check (dev) and commit**

Run `npm run tauri dev` again, same 1,500-word ask, same `__chroniclePerf()` read; write the numbers under "after" in `c-runs/PROGRESS.md`'s Task 3 section. Then:

```bash
git add src/screens/agent/AgentPane.tsx c-runs/PROGRESS.md
git commit -m "perf(pane): the thread subscribes per frame and re-renders only the row that changed

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: The streaming reply through streamdown

**Files:**
- Create: `src/screens/agent/AssistantMessage.tsx` (moved out of `AgentPane.tsx`, lines ~244-266)
- Modify: `src/screens/agent/AgentPane.tsx` (delete the inline `AssistantMessage`; import the new one); `src/index.css` (one `@source` line)
- Create: `src/lib/assistant-markdown.ts` (the render options, pure) and `src/screens/agent/rows.tsx` (`MessageRow`, avatars, `TypingDots`, `UserMessage`, moved out of `AgentPane.tsx` unchanged)
- Test: `src/lib/assistant-markdown.test.ts`

**Interfaces:**
- Consumes: `streamdown`'s `Streamdown` component (`import { Streamdown } from "streamdown"`), `MessageRow`, `AssistantAvatar`, `TypingDots` (export these three from `AgentPane.tsx` or move them to `src/screens/agent/rows.tsx` — move them; `UserMessage` goes with them).
- Produces: `AssistantMessage({ text, streaming })` with the same props as today; `src/lib/assistant-markdown.ts` exports `assistantMarkdownProps(): { parseIncompleteMarkdown: boolean; allowedImagePrefixes: string[]; allowedLinkPrefixes: string[] }` so the security-relevant options are one testable object.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/assistant-markdown.test.ts
/*
 * The reply renders as it streams. Three inputs that break naive renderers at a
 * chunk boundary — an unterminated fence, a table cut mid-row, raw HTML — must
 * render without throwing and without ever emitting a script tag. Rendered
 * server-side: vitest here is the node environment, and streamdown is SSR-safe.
 */
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Streamdown } from "streamdown";
import { assistantMarkdownProps } from "./assistant-markdown";

const render = (text: string) => renderToStaticMarkup(createElement(Streamdown, { ...assistantMarkdownProps(), children: text }));

describe("the streaming reply", () => {
  it("renders an unterminated code fence as code, not as a swallowed block", () => {
    const html = render("Here:\n```ts\nconst a = 1");
    expect(html).toContain("const a = 1");
    expect(html).toMatch(/<pre|<code/);
  });
  it("renders a table cut mid-row without throwing", () => {
    expect(() => render("| a | b |\n|---|---|\n| 1 |")).not.toThrow();
  });
  it("never emits a script tag or an inline handler from raw HTML in the reply", () => {
    const html = render("hi <script>alert(1)</script> <img src=x onerror=alert(1)> there");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("onerror");
  });
  it("links and images are limited to http(s)", () => {
    const p = assistantMarkdownProps();
    expect(p.allowedLinkPrefixes).toEqual(["https://", "http://"]);
    expect(p.allowedImagePrefixes).toEqual(["https://", "http://"]);
    expect(p.parseIncompleteMarkdown).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/lib/assistant-markdown.test.ts`
Expected: FAIL — cannot find module `./assistant-markdown`.

- [ ] **Step 3: The props module**

```ts
// src/lib/assistant-markdown.ts
/*
 * The options the streaming reply renders with. Kept as a plain object so the
 * security-relevant ones are testable without a DOM: links and images only
 * to http(s), incomplete markdown closed as it streams.
 */
export function assistantMarkdownProps() {
  return {
    parseIncompleteMarkdown: true,
    allowedLinkPrefixes: ["https://", "http://"],
    allowedImagePrefixes: ["https://", "http://"],
  };
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/lib/assistant-markdown.test.ts`
Expected: PASS. If streamdown's import pulls a DOM-only module at load time and the file fails with `window is not defined`, that is a finding to report, not to paper over: stop and say so in the task's report (the plan's fallback is `react-markdown`, which the Runs plan would then pick up).

- [ ] **Step 5: The component**

Create `src/screens/agent/rows.tsx` by moving `MessageRow`, `AssistantAvatar`, `UserAvatar`, `UserMessage`, `TypingDots` out of `AgentPane.tsx` unchanged (export each). Create `src/screens/agent/AssistantMessage.tsx`:

```tsx
/*
 * The agent's reply, formatted as it streams. streamdown parses completed
 * blocks once and re-parses only the open one, so a chunk costs the open
 * paragraph, not the whole reply. A caret trails the live text.
 */
import { Streamdown } from "streamdown";
import { assistantMarkdownProps } from "@/lib/assistant-markdown";
import { AssistantAvatar, MessageRow, TypingDots } from "./rows";

const props = assistantMarkdownProps();

export function AssistantMessage({ text, streaming }: { text: string; streaming: boolean }) {
  return (
    <MessageRow who="Chronigirl" avatar={<AssistantAvatar />}>
      <span data-streaming={streaming || undefined}>
        {streaming && !text.trim() ? (
          <TypingDots />
        ) : (
          <span data-selectable className="assistant-md [&>*:last-child]:inline">
            <Streamdown {...props} className="space-y-1.5">{text}</Streamdown>
            {streaming && (
              <span className="ml-0.5 inline-block h-[15px] w-px translate-y-[2px] bg-text-secondary" style={{ animation: "wv-pulse 1.1s step-end infinite" }} />
            )}
          </span>
        )}
      </span>
    </MessageRow>
  );
}
```

In `AgentPane.tsx` delete the old `AssistantMessage` and the moved helpers; import `AssistantMessage` from `./AssistantMessage` and the helpers from `./rows`. `MiniMd` stays in `src/lib/mini-md.tsx` for `src/screens/roadmap/PhaseDetail.tsx`; remove only its import from `AgentPane.tsx`.

- [ ] **Step 6: Tailwind sees streamdown's classes; the tokens it needs exist**

In `src/index.css`, after `@import 'tw-animate-css';` add:

```css
/* streamdown (the agent's streaming reply) is styled with Tailwind utilities inside node_modules */
@source "../node_modules/streamdown/dist/*.js";
```

streamdown reads shadcn's `--background`, `--foreground`, `--muted`, `--muted-foreground`, `--border`, `--primary`, `--radius` — all already defined by this file's bridge (lines ~135-160). Add one rule so the reply's type matches the thread:

```css
.assistant-md { font-size: 13px; line-height: 1.65; }
.assistant-md pre { font-family: var(--font-mono); font-size: 11px; line-height: 1.55; }
.assistant-md code:not(pre code) { font-family: var(--font-mono); font-size: 11px; }
```

- [ ] **Step 7: Build, and prove mermaid stays lazy**

Run: `npm run typecheck && npx vitest run && npm run build && ls -la dist/assets | sort -k5 -n | tail -8`
Expected: green; the asset list shows a separate `mermaid-*.js` chunk, and `grep -l "mermaid" dist/assets/index-*.js` prints nothing (the main chunk does not statically import it). If the main chunk grew by more than 150 KB gzipped against the parent commit's build, report the number.

- [ ] **Step 8: Live check and commit**

In `npm run tauri dev`, ask the agent for an answer with a code block, a table and a list; watch it stream. Record `__chroniclePerf()` again in `c-runs/PROGRESS.md` (Task 4 row). Then:

```bash
git add src/screens/agent/AssistantMessage.tsx src/screens/agent/rows.tsx src/screens/agent/AgentPane.tsx src/lib/assistant-markdown.ts src/lib/assistant-markdown.test.ts src/index.css c-runs/PROGRESS.md
git commit -m "perf(pane): the reply streams through streamdown — completed blocks are parsed once

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Following the bottom without fighting the stream

**Files:**
- Create: `src/lib/thread-scroll.ts` (pure decision) and `src/screens/agent/useStickToBottom.ts` (the hook)
- Modify: `src/screens/agent/AgentPane.tsx` (delete the two scroll effects at lines ~584-607 and the `nearBottom`/`rowCount` refs; use the hook); `src/index.css` (`overflow-anchor`, `content-visibility`)
- Test: `src/lib/thread-scroll.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `export type StickInput = { pinned: boolean; scrollTop: number; scrollHeight: number; clientHeight: number; grew: boolean; userScrolled: boolean; reducedMotion: boolean }`; `export type StickDecision = { pinned: boolean; action: "none" | "jump" | "glide" }`; `export function stickDecision(i: StickInput): StickDecision`; `export const NEAR_BOTTOM_PX = 60`; the hook `useStickToBottom(ref: RefObject<HTMLElement>, deps: unknown[])`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/thread-scroll.test.ts
/*
 * The rule: while you are at the bottom the thread stays there as content
 * grows, with no scroll animation (a glide restarted on every chunk never
 * lands). You leave the bottom by scrolling up; you come back by scrolling
 * within reach of it, and that one return glides.
 */
import { describe, expect, it } from "vitest";
import { NEAR_BOTTOM_PX, stickDecision } from "./thread-scroll";

const base = { pinned: true, scrollTop: 1000, scrollHeight: 1600, clientHeight: 600, grew: true, userScrolled: false, reducedMotion: false };

describe("stickDecision", () => {
  it("pinned + content grew → jump to the bottom, no glide", () => {
    expect(stickDecision({ ...base, scrollHeight: 1700 })).toEqual({ pinned: true, action: "jump" });
  });
  it("pinned + nothing grew → nothing", () => {
    expect(stickDecision({ ...base, grew: false })).toEqual({ pinned: true, action: "none" });
  });
  it("the user scrolled up → unpinned, and growth no longer moves them", () => {
    const away = stickDecision({ ...base, userScrolled: true, scrollTop: 300 });
    expect(away).toEqual({ pinned: false, action: "none" });
    expect(stickDecision({ ...base, pinned: false, scrollTop: 300, scrollHeight: 2400 })).toEqual({ pinned: false, action: "none" });
  });
  it("the user scrolled back within reach of the bottom → pinned again, one glide", () => {
    const top = 1600 - 600 - (NEAR_BOTTOM_PX - 1);
    expect(stickDecision({ ...base, pinned: false, userScrolled: true, scrollTop: top, grew: false })).toEqual({ pinned: true, action: "glide" });
  });
  it("the return is a jump under reduced motion", () => {
    const top = 1600 - 600 - 10;
    expect(stickDecision({ ...base, pinned: false, userScrolled: true, scrollTop: top, grew: false, reducedMotion: true })).toEqual({ pinned: true, action: "jump" });
  });
  it("a scroll event that lands exactly at the bottom keeps the pin", () => {
    expect(stickDecision({ ...base, userScrolled: true, scrollTop: 1000, grew: false })).toEqual({ pinned: true, action: "none" });
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/lib/thread-scroll.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: The decision**

```ts
// src/lib/thread-scroll.ts
/*
 * Pure: given what the scroller looks like and what just happened, say whether
 * the thread is pinned to its bottom and what, if anything, to do about it.
 * The hook measures; this decides; tests pin the rule.
 */
export const NEAR_BOTTOM_PX = 60;

export type StickInput = {
  pinned: boolean;
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  /** content got taller since the last decision */
  grew: boolean;
  /** this decision follows a scroll event the user caused */
  userScrolled: boolean;
  reducedMotion: boolean;
};
export type StickDecision = { pinned: boolean; action: "none" | "jump" | "glide" };

export function stickDecision(i: StickInput): StickDecision {
  const gap = i.scrollHeight - i.scrollTop - i.clientHeight;
  if (i.userScrolled) {
    const near = gap < NEAR_BOTTOM_PX;
    if (!near) return { pinned: false, action: "none" };
    if (i.pinned) return { pinned: true, action: "none" };
    return { pinned: true, action: i.reducedMotion ? "jump" : "glide" };
  }
  if (!i.pinned) return { pinned: false, action: "none" };
  return { pinned: true, action: i.grew ? "jump" : "none" };
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/lib/thread-scroll.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: The hook**

```ts
// src/screens/agent/useStickToBottom.ts
/*
 * Keeps a scroller pinned to its bottom while content grows, without any
 * scroll animation during growth (the jump happens in a layout effect, before
 * paint, so nothing is visible), and without a scroll call at all once the
 * user has scrolled up. A ResizeObserver catches growth React never rendered
 * (an image, a card opening). `overflow-anchor: none` on the scroller stops
 * the browser from correcting the same movement a second time.
 */
import { useLayoutEffect, useRef, type RefObject } from "react";
import { stickDecision } from "@/lib/thread-scroll";

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export function useStickToBottom(ref: RefObject<HTMLElement | null>, deps: unknown[]) {
  const pinned = useRef(true);
  const lastHeight = useRef(0);

  const apply = (el: HTMLElement, userScrolled: boolean) => {
    const grew = el.scrollHeight > lastHeight.current;
    lastHeight.current = el.scrollHeight;
    const d = stickDecision({
      pinned: pinned.current, scrollTop: el.scrollTop, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight,
      grew, userScrolled, reducedMotion: reducedMotion(),
    });
    pinned.current = d.pinned;
    if (d.action === "jump") el.scrollTop = el.scrollHeight;
    else if (d.action === "glide") el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  };

  // on mount: open at the newest entry before the first paint
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    lastHeight.current = el.scrollHeight;
    el.scrollTop = el.scrollHeight;
    const onScroll = () => apply(el, true);
    el.addEventListener("scroll", onScroll, { passive: true });
    const ro = new ResizeObserver(() => apply(el, false));
    for (const child of Array.from(el.children)) ro.observe(child);
    const mo = new MutationObserver((muts) => {
      for (const m of muts) for (const n of Array.from(m.addedNodes)) if (n instanceof HTMLElement) ro.observe(n);
    });
    mo.observe(el, { childList: true });
    return () => { el.removeEventListener("scroll", onScroll); ro.disconnect(); mo.disconnect(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // after every render that could have grown the content
  useLayoutEffect(() => {
    const el = ref.current;
    if (el) apply(el, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
```

- [ ] **Step 6: Use it in the pane; drop the old effects**

In `AgentPane.tsx` delete the `nearBottom`/`rowCount` refs, the `useLayoutEffect` that set `scrollTop` on mount, the follow-scroll `useEffect`, and the `onScroll` prop on the scroller. Add `useStickToBottom(scrollRef, [agentVersion()])` (the version is the dependency: a render after a delivered notification is the only time the thread grows through React). Keep `data-agent-thread` on the scroller and add the class `thread-scroller`.

- [ ] **Step 7: CSS**

In `src/index.css`, in the agent-pane motion block (near `.wv-enter`):

```css
/* The thread scroller pins itself (useStickToBottom); the browser must not
   also anchor, or a growth is corrected twice. Rows off screen cost no layout. */
.thread-scroller { overflow-anchor: none; }
.thread-scroller > .wv-enter { content-visibility: auto; contain-intrinsic-size: auto 56px; }
```

- [ ] **Step 8: Typecheck, tests, live check, commit**

Run: `npm run typecheck && npx vitest run`. In `npm run tauri dev`: ask for a long answer; while it streams, scroll up — the thread must stay where you put it; scroll back down — one glide, then pinned. Then open a subagent card mid-stream: no jump. Note the result in `c-runs/PROGRESS.md` (Task 5 row). Commit:

```bash
git add src/lib/thread-scroll.ts src/lib/thread-scroll.test.ts src/screens/agent/useStickToBottom.ts src/screens/agent/AgentPane.tsx src/index.css c-runs/PROGRESS.md
git commit -m "fix(pane): the thread pins to its bottom in a layout effect and glides only when you come back to it

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Motion tokens and the four moments (board R5)

**Files:**
- Modify: `src/index.css` (the agent-pane motion block, lines ~428-436; the reduced-motion block at ~582); `src/components/chrome/atoms.tsx` (`StateWord`); `src/screens/agent/SubagentCard.tsx`; `src/screens/agent/ToolCard.tsx` (the output block); `src/components/ai-elements/task.tsx` (`TaskContent`)
- Test: `src/lib/motion-tokens.test.ts` (reads `src/index.css` as text and pins the tokens — the one way to test CSS here)

**Interfaces:**
- Consumes: nothing.
- Produces: CSS custom properties `--ease-pane`, `--dur-fast` (140ms), `--dur-slow` (260ms); classes `.wv-enter` (now on the tokens), `.wv-grow` (height from 0 to auto via `grid-template-rows`), `.wv-word` (cross-fade on a keyed remount), `.wv-open` (Radix collapsible height via `--radix-collapsible-content-height`).

> **Deviation from spec §9, for the user to confirm at plan review:** §9 said the cards use the `motion` library's layout animations. Every moment on board R5 is reachable with CSS alone (a `grid-template-rows: 0fr → 1fr` transition for a card growing, Radix's content-height variable for a tree opening, a keyed remount with a fade for a state word, the existing `.wv-enter` for a row). CSS keeps the bundle where it is and runs on the compositor; `motion` stays installed and unused. If the live check in Step 7 shows a jump CSS cannot cover, the plan's fallback is `motion/react`'s `layout` prop on that one element.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/motion-tokens.test.ts
/*
 * The pane moves with one easing and two durations, defined once. This pins
 * the tokens and the rule that everything goes through them — read from the
 * stylesheet as text, since there is no DOM here.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../index.css", import.meta.url), "utf8");

describe("motion tokens", () => {
  it("defines the easing and the two durations once, on :root", () => {
    expect(css).toMatch(/--ease-pane:\s*cubic-bezier\(0?\.2,\s*0?\.8,\s*0?\.2,\s*1\)/);
    expect(css).toMatch(/--dur-fast:\s*140ms/);
    expect(css).toMatch(/--dur-slow:\s*260ms/);
    expect(css.match(/--dur-fast:/g)?.length).toBe(2); // :root and the reduced-motion override
  });
  it("the pane's moves use the tokens, not literal durations", () => {
    const block = css.slice(css.indexOf("/* The agent pane's motion"), css.indexOf("@keyframes wv-spin"));
    expect(block).toContain("var(--dur-slow)");
    expect(block).toContain("var(--ease-pane)");
    expect(block).not.toMatch(/\b\d{3}ms\b/);
  });
  it("reduced motion zeroes both durations", () => {
    const rm = css.slice(css.lastIndexOf("@media (prefers-reduced-motion: reduce)"));
    expect(rm).toMatch(/--dur-fast:\s*0ms/);
    expect(rm).toMatch(/--dur-slow:\s*0ms/);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/lib/motion-tokens.test.ts`
Expected: FAIL on the first assertion.

- [ ] **Step 3: The tokens and the classes**

In `src/index.css`, inside the `:root, [data-theme='dark']` block (any position; tokens are theme-independent), add:

```css
  /* motion — one curve, two durations; the pane never uses a literal duration */
  --ease-pane: cubic-bezier(0.2, 0.8, 0.2, 1);
  --dur-fast: 140ms;
  --dur-slow: 260ms;
```

Replace the agent-pane motion block (from the comment `/* The agent pane's motion` through the `.wv-pop` reduced-motion line) with:

```css
/* The agent pane's motion — one easing, two durations (tokens above):
   enter — a new row settles in from 6px below, once, on mount;
   pop   — a status glyph that just flipped (spinner → check) lands from small;
   grow  — a card's body opens from 0 to its height (grid rows, no JS);
   word  — a state word that changed fades in on its keyed remount;
   open  — a tree's children slide and fade (Radix collapsible height). */
@keyframes wv-enter { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
@keyframes wv-pop { 0% { opacity: 0; transform: scale(0.5); } 70% { transform: scale(1.12); } 100% { opacity: 1; transform: none; } }
@keyframes wv-word { from { opacity: 0; } to { opacity: 1; } }
@keyframes wv-open { from { opacity: 0; transform: translateY(-4px); height: 0; } to { opacity: 1; transform: none; height: var(--radix-collapsible-content-height); } }
@keyframes wv-close { from { height: var(--radix-collapsible-content-height); } to { height: 0; opacity: 0; } }
.wv-enter { animation: wv-enter var(--dur-slow) var(--ease-pane) both; }
.wv-pop { animation: wv-pop var(--dur-slow) var(--ease-pane) both; display: inline-flex; }
.wv-word { animation: wv-word var(--dur-fast) var(--ease-pane) both; }
.wv-grow { display: grid; grid-template-rows: 0fr; transition: grid-template-rows var(--dur-slow) var(--ease-pane); }
.wv-grow > * { min-height: 0; overflow: hidden; }
.wv-grow[data-open="true"] { grid-template-rows: 1fr; }
.wv-open[data-state="open"] { animation: wv-open var(--dur-slow) var(--ease-pane); }
.wv-open[data-state="closed"] { animation: wv-close var(--dur-fast) var(--ease-pane); }
```

In the final `@media (prefers-reduced-motion: reduce)` block add `:root { --dur-fast: 0ms; --dur-slow: 0ms; }` as its first rule (the existing `animation-duration: 0.001s` rules stay).

- [ ] **Step 4: The state word**

In `src/components/chrome/atoms.tsx`, `StateWord`: wrap the text in a keyed span so a changed word remounts and fades — in each of the three returns, replace `<span className="min-w-0 truncate">{children}</span>` with `<span key={String(children)} className="wv-word min-w-0 truncate">{children}</span>`.

- [ ] **Step 5: The tree opening and the card growing**

In `src/components/ai-elements/task.tsx`, `TaskContent`: add `wv-open` to the `CollapsibleContent`'s `className` (it already carries `data-state`). In `src/screens/agent/SubagentCard.tsx`, wrap the report block (`{report && !running && (<div … font-mono …>…)}`) as:

```tsx
<div className="wv-grow" data-open={Boolean(report && !running)}>
  <div>{report && !running && (<div data-selectable className="mt-1.5 max-h-24 …">…</div>)}</div>
</div>
```

In `src/screens/agent/ToolCard.tsx`, do the same around the tool's output block (find the element that renders `tool.output`; the wrapper's `data-open` is `open && !!tool.output`).

- [ ] **Step 6: Run the token test and the suite**

Run: `npx vitest run src/lib/motion-tokens.test.ts && npx vitest run && npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Live check against board R5, then commit**

`npm run tauri dev`; trigger each moment: a subagent finishing (card grows), opening its tree (children slide), a state word changing in the header, a new row. Then System Settings → Accessibility → Display → Reduce motion on: every moment is instant, nothing hidden. Note both in `c-runs/PROGRESS.md` (Task 6 row). Commit:

```bash
git add src/index.css src/lib/motion-tokens.test.ts src/components/chrome/atoms.tsx src/components/ai-elements/task.tsx src/screens/agent/SubagentCard.tsx src/screens/agent/ToolCard.tsx c-runs/PROGRESS.md
git commit -m "feat(pane): one easing and two durations for everything that moves; cards grow, trees open, words fade

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: The adapter is installed once and launched directly (Rust)

**Files:**
- Modify: `src-tauri/src/setup.rs` (new `adapter_dir`, `adapter_entry`, `install_adapter`; `detect`/`install` arms; `CHECKS`)
- Modify: `src-tauri/src/acp.rs` (`adapter_command` → `adapter_command_for(launch: &AdapterLaunch)`; the session log gets timestamps)
- Modify: `src-tauri/src/main.rs` (`agent_session_start`, `agent_session_resume` use `setup::adapter_launch()`)
- Test: in-file `#[cfg(test)]` modules of `setup.rs` and `acp.rs`

**Interfaces:**
- Consumes: `ADAPTER_PACKAGE`, `ADAPTER_VERSION` (acp.rs), `resolve(name)`, `tools_dir()`, `tool_env_path()` (setup.rs).
- Produces, in `setup.rs`:
  - `pub fn adapter_dir() -> PathBuf` = `tools_dir().join("adapter")`
  - `pub fn adapter_entry_in(dir: &Path, version: &str) -> Option<PathBuf>` — `Some(<dir>/node_modules/@agentclientprotocol/claude-agent-acp/dist/index.js)` only when that package's `package.json` has `"version": "<version>"` and the entry file exists
  - `pub fn adapter_launch() -> Option<AdapterLaunch>` — `Direct { node, entry }` when `resolve("node")` and `adapter_entry_in(&adapter_dir(), ADAPTER_VERSION)` both resolve; `Npx { npx }` when `resolve("npx")` does; `None` otherwise
  - `pub enum AdapterLaunch { Direct { node: String, entry: PathBuf }, Npx { npx: String } }` (lives in `acp.rs`, re-exported for setup)
  - `fn install_adapter(emit, cancel) -> Result<(), String>` — runs `npm install --prefix <adapter_dir> --no-audit --no-fund --no-package-lock <pkg>@<ver>` with `PATH = tool_env_path()`, emits `installing` (no percentage) then done
  - detect id `"connector"`: `ready` with detail `<version>` when the entry resolves; `blocked` "Install the engine first." without node; else `missing` with action `install`
- Produces, in `acp.rs`: `pub fn adapter_command_for(launch: &AdapterLaunch) -> std::process::Command` with the same env treatment as today; `adapter_command(npx)` becomes `adapter_command_for(&AdapterLaunch::Npx { npx })` and stays for the existing test. Session log lines start with `[+<ms since spawn>]`.

- [ ] **Step 1: Write the failing tests**

In `src-tauri/src/setup.rs` `mod tests`:

```rust
    fn fake_adapter(dir: &Path, version: &str) {
        let pkg = dir.join("node_modules/@agentclientprotocol/claude-agent-acp");
        std::fs::create_dir_all(pkg.join("dist")).unwrap();
        std::fs::write(pkg.join("package.json"), format!(r#"{{"name":"@agentclientprotocol/claude-agent-acp","version":"{version}","bin":{{"claude-agent-acp":"dist/index.js"}}}}"#)).unwrap();
        std::fs::write(pkg.join("dist/index.js"), "#!/usr/bin/env node\n").unwrap();
    }

    #[test]
    fn adapter_entry_resolves_the_pinned_install() {
        let d = std::env::temp_dir().join(format!("chronicle-adapter-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        fake_adapter(&d, crate::acp::ADAPTER_VERSION);
        let e = adapter_entry_in(&d, crate::acp::ADAPTER_VERSION).expect("the pinned install resolves");
        assert!(e.ends_with("dist/index.js"), "{e:?}");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn adapter_entry_ignores_a_stale_install() {
        // a future pin bump must never launch the old adapter: detect says missing,
        // the spawn falls back to npx of the pinned version
        let d = std::env::temp_dir().join(format!("chronicle-adapter-stale-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        fake_adapter(&d, "0.0.1");
        assert!(adapter_entry_in(&d, crate::acp::ADAPTER_VERSION).is_none());
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn the_connector_row_is_never_required_and_joins_the_list() {
        assert_eq!(REQUIRED, 6);
        assert!(CHECKS.contains(&"connector"));
        let s = status();
        assert_eq!(s["total"], 6);
        assert_eq!(s["checks"].as_array().unwrap().len(), 9);
        let c = detect("connector");
        assert!(["ready", "missing", "blocked"].contains(&c["state"].as_str().unwrap()));
        if c["state"] == "missing" { assert_eq!(c["action"], "install"); }
    }
```

Also change the existing `the_design_rows_detect_from_disk_and_never_join_the_required_count` assertion `len(), 8` to `9`.

In `src-tauri/src/acp.rs` `mod tests`:

```rust
    #[test]
    fn a_direct_launch_runs_node_on_the_entry_with_the_same_env_as_npx() {
        let cmd = adapter_command_for(&AdapterLaunch::Direct { node: "/x/bin/node".into(), entry: PathBuf::from("/x/adapter/dist/index.js") });
        assert_eq!(cmd.get_program(), std::ffi::OsStr::new("/x/bin/node"));
        let args: Vec<_> = cmd.get_args().map(|a| a.to_string_lossy().to_string()).collect();
        assert_eq!(args, vec!["/x/adapter/dist/index.js".to_string()]);
        let path = cmd.get_envs().find(|(k, _)| *k == std::ffi::OsStr::new("PATH")).and_then(|(_, v)| v).unwrap().to_string_lossy().to_string();
        assert!(path.starts_with("/x/bin"), "node's own dir leads the PATH: {path}");
        assert!(cmd.get_envs().any(|(k, v)| k == std::ffi::OsStr::new("ANTHROPIC_API_KEY") && v == Some(std::ffi::OsStr::new(""))));
        assert!(cmd.get_envs().any(|(k, v)| k == std::ffi::OsStr::new("CLAUDECODE") && v.is_none()));
    }

    #[test]
    fn an_npx_launch_is_unchanged() {
        let cmd = adapter_command_for(&AdapterLaunch::Npx { npx: "/opt/homebrew/bin/npx".into() });
        let args: Vec<_> = cmd.get_args().map(|a| a.to_string_lossy().to_string()).collect();
        assert_eq!(args, vec!["--yes".to_string(), "--".to_string(), format!("{ADAPTER_PACKAGE}@{ADAPTER_VERSION}")]);
    }
```

- [ ] **Step 2: Run them to see them fail**

Run: `export PATH="$HOME/.cargo/bin:$PATH" && cd src-tauri && cargo test adapter_ 2>&1 | tail -20`
Expected: compile errors — `adapter_entry_in`, `AdapterLaunch`, `adapter_command_for` not found.

- [ ] **Step 3: `acp.rs` — the launch enum and the command**

Above `adapter_command`:

```rust
/// How the adapter process is started: the managed install launched by node
/// directly (0.2 s), or `npx` resolving the pinned package (2 s). Setup
/// decides which is possible; the command is built the same way either way.
#[derive(Debug, Clone, PartialEq)]
pub enum AdapterLaunch {
    Direct { node: String, entry: PathBuf },
    Npx { npx: String },
}

pub fn adapter_command_for(launch: &AdapterLaunch) -> std::process::Command {
    let (program, args, tool): (&str, Vec<String>, &str) = match launch {
        AdapterLaunch::Direct { node, entry } => (node.as_str(), vec![entry.to_string_lossy().to_string()], node.as_str()),
        AdapterLaunch::Npx { npx } => (npx.as_str(), vec!["--yes".into(), "--".into(), format!("{ADAPTER_PACKAGE}@{ADAPTER_VERSION}")], npx.as_str()),
    };
    let mut cmd = std::process::Command::new(program);
    cmd.args(args)
        .env("ANTHROPIC_API_KEY", "")
        .env_remove("CLAUDECODE")
        .env("PATH", child_path(tool));
    cmd
}

pub fn adapter_command(npx: &str) -> std::process::Command {
    adapter_command_for(&AdapterLaunch::Npx { npx: npx.to_string() })
}
```

(Keep the existing comments about the Finder PATH and the nested-session refusal on the new function.) Session log timestamps: find the function that appends to `session_log_path` (search `chronicle-acp-` near line 1080 and its writer) and prefix each line with `[+{ms}]` where `ms` is `started.elapsed().as_millis()` from an `Instant` stored on the session at spawn.

- [ ] **Step 4: `setup.rs` — the install, the detect, the launch**

```rust
/* ================= the agent's connector (the ACP adapter) ================= */

pub fn adapter_dir() -> PathBuf { tools_dir().join("adapter") }

/// The adapter's entry script, only when the install under `dir` is exactly
/// `version`: a stale install after a pin bump must look like no install.
pub fn adapter_entry_in(dir: &Path, version: &str) -> Option<PathBuf> {
    let pkg = dir.join("node_modules").join(crate::acp::ADAPTER_PACKAGE);
    let manifest = std::fs::read_to_string(pkg.join("package.json")).ok()?;
    let v: Value = serde_json::from_str(&manifest).ok()?;
    if v.get("version").and_then(|x| x.as_str()) != Some(version) { return None; }
    let entry = pkg.join("dist/index.js");
    entry.is_file().then_some(entry)
}

/// Direct when the managed install matches the pin and node resolves; npx otherwise; None without node at all.
pub fn adapter_launch() -> Option<crate::acp::AdapterLaunch> {
    if let (Some(node), Some(entry)) = (resolve("node"), adapter_entry_in(&adapter_dir(), crate::acp::ADAPTER_VERSION)) {
        return Some(crate::acp::AdapterLaunch::Direct { node, entry });
    }
    resolve("npx").map(|npx| crate::acp::AdapterLaunch::Npx { npx })
}

fn install_adapter(emit: &Emit, _cancel: &AtomicBool) -> Result<(), String> {
    let npm = resolve("npm").ok_or("the engine isn't installed yet — install it first")?;
    emit_state(emit, "connector", json!({ "state": "installing", "pct": Value::Null }));
    std::fs::create_dir_all(adapter_dir()).map_err(|e| e.to_string())?;
    let out = std::process::Command::new(&npm)
        .args(["install", "--prefix"]).arg(adapter_dir())
        .args(["--no-audit", "--no-fund", "--no-package-lock", &format!("{}@{}", crate::acp::ADAPTER_PACKAGE, crate::acp::ADAPTER_VERSION)])
        .env("PATH", tool_env_path())
        .stdin(std::process::Stdio::null())
        .output()
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(format!("couldn't install the connector: {}", String::from_utf8_lossy(&out.stderr).lines().last().unwrap_or("npm failed")));
    }
    adapter_entry_in(&adapter_dir(), crate::acp::ADAPTER_VERSION).map(|_| ()).ok_or_else(|| "installed, but the connector's files aren't where expected".to_string())
}
```

`CHECKS` becomes `[&str; 9]` with `"connector"` appended. `detect`:

```rust
        "connector" => {
            if resolve("node").is_none() { ("blocked", "Install the engine first.", "") }
            else if adapter_entry_in(&adapter_dir(), crate::acp::ADAPTER_VERSION).is_some() { return json!({ "id": id, "state": "ready", "detail": crate::acp::ADAPTER_VERSION, "action": "" }); }
            else { ("missing", "", "install") }
        }
```

`install`: add `"connector" => install_adapter(emit, cancel),`. `run_all`: add `"connector"` to its id list after `"node"` (it needs the engine; it is cheap; it makes every later session fast).

- [ ] **Step 5: `main.rs` — the two spawn sites**

In `agent_session_start` and `agent_session_resume`, replace

```rust
let npx = find_tool("npx").ok_or("the agent needs Node.js — install it from nodejs.org, then try again")?;
```

with

```rust
let launch = setup::adapter_launch().ok_or("the agent needs Node.js — install it from Setup & health, then try again")?;
```

and `acp::adapter_command(&npx)` with `acp::adapter_command_for(&launch)`. The design-lane `extras` branch still needs `npx` for its MCP servers; since that branch is behind `DESIGN_PANE` in the UI but compiles, keep `let npx = find_tool("npx").unwrap_or_default();` inside the `if lane == acp::Lane::Design` block only.

- [ ] **Step 6: Run the Rust tests**

Run: `export PATH="$HOME/.cargo/bin:$PATH" && cd src-tauri && cargo test 2>&1 | tail -5`
Expected: all pass, including the four new tests and the updated count.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/setup.rs src-tauri/src/acp.rs src-tauri/src/main.rs
git commit -m "perf(agent): the connector is installed once into the managed tools and launched by node directly; npx is the fallback

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: The connector row in Setup & health (board R6, bottom-left)

**Files:**
- Modify: `src/lib/setup-store.ts` (`CHECK_META`, the `kind` union, `REQUIRED_META`); `src/screens/setup/CheckRow.tsx` (`KindIcon`); `src/lib/setup-store.test.ts`

**Interfaces:**
- Consumes: the Rust `connector` check (Task 7) through the existing doctor IPC.
- Produces: `CHECK_META` entry `{ id: "connector", name: "The agent’s connector", blurb: "The small program Chronicle talks to the AI through. Installed once, so sessions start fast.", kind: "connector" }`; `totalRequired()` stays 6.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/setup-store.test.ts`:

```ts
it("the connector row exists, installs, and never counts toward ready", async () => {
  const m = await import("./setup-store");
  const row = m.CHECK_META.find((c) => c.id === "connector");
  expect(row).toMatchObject({ kind: "connector", name: "The agent’s connector" });
  expect(m.totalRequired()).toBe(6);
  // it sits right after the engine it needs
  const ids = m.CHECK_META.map((c) => c.id);
  expect(ids.indexOf("connector")).toBe(ids.indexOf("node") + 1);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/lib/setup-store.test.ts`
Expected: FAIL — `row` is undefined.

- [ ] **Step 3: The meta and the icon**

In `src/lib/setup-store.ts`: add `"connector"` to the `kind` union; insert the row directly after the `node` row; add `c.kind !== "connector"` to the `REQUIRED_META` filter. In `src/screens/setup/CheckRow.tsx`, `KindIcon`, add before the `agents` branch:

```tsx
  if (kind === "connector")
    return (
      <svg {...common} strokeWidth="1.3" className="text-text-subtle">
        <path d="M5 2.5v3a3 3 0 0 0 6 0v-3M8 8.5v5M5.5 13.5h5" />
      </svg>
    );
```

The row's `state === "installing"` with `pct: null` must show the word `installing` without a percentage or bar — check `CheckRow.tsx`'s installing branch handles a null `pct` (the design-browser row already emits a null `pct` before its first progress line, so this path exists; confirm by reading it, and if it renders `NaN%`, guard with `check.pct != null`).

- [ ] **Step 4: Run the tests, typecheck**

Run: `npx vitest run src/lib/setup-store.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Live check and commit**

`npm run tauri dev` → Setup & health: the row shows `missing` with Install; click Install → `installing` → `ready` with `0.75.1` in mono; `ls ~/.chronicle/tools/adapter/node_modules/@agentclientprotocol/claude-agent-acp/dist/index.js` exists. Start a session: the session log's first `[+ms]` line to `ready` is under 1.5 s. Record it in `c-runs/PROGRESS.md` (Task 8 row, with the npx figure from a run before Install for "before").

```bash
git add src/lib/setup-store.ts src/lib/setup-store.test.ts src/screens/setup/CheckRow.tsx c-runs/PROGRESS.md
git commit -m "feat(setup): the agent's connector row — installed once so sessions start fast

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Warm start — the session starts when the project opens (board R6, top)

**Files:**
- Modify: `src/lib/agent-session.ts` (new `warmAgentSession`, `warm` flag, `agentStateWord`); `src/screens/agent/AgentPane.tsx` (the auto-start effect at lines ~561-579 becomes a call to `warmAgentSession`; composer gating); `src/App.tsx` (call `warmAgentSession` when a project becomes active); `src/screens/agent/Composer.tsx` (`sendDisabled` separate from `disabled`)
- Test: `src/lib/agent-session.warm.test.ts`

**Interfaces:**
- Consumes: `agentsAvailable`, `agentSessionStart` (ipc); `adoptAgentSession`, `startAgentSession`.
- Produces: `export async function warmAgentSession(dir: string): Promise<void>` — adopts a live session if one exists; otherwise, once per app session per project and only when Claude is installed, starts one and marks the state `warm: true` until it is ready; `AgentSessionState.warm: boolean`; `agentStateWord` returns `{ word: "warming", kind: "neutral" }` while `warm` and the phase is `installing`/`starting`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/agent-session.warm.test.ts
/*
 * The session is warmed when a project opens, not when the pane mounts. It
 * must never warm twice, never warm without Claude installed, and must say
 * "warming", not "starting", so the pane is honest about why it is quick.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const started: string[] = [];
let claude: string | null = "/usr/local/bin/claude";
vi.mock("./ipc", () => ({
  onAcpUpdate: vi.fn(async () => () => {}),
  agentsAvailable: vi.fn(async () => ({ claude, codex: null, default: claude ? "claude" : "" })),
  agentSessionStart: vi.fn(async (dir: string) => { started.push(dir); }),
  agentSessionState: vi.fn(async () => null),
  agentPrompt: vi.fn(async () => {}), roundRunMessage: vi.fn(async () => ""), roundPlanBegin: vi.fn(),
  roundPlanCancel: vi.fn(async () => {}), roundPlanSettle: vi.fn(), agentCancel: vi.fn(), agentEdits: vi.fn(async () => []),
  agentHistoryRead: vi.fn(), agentSetConfigOption: vi.fn(), agentRespondPermission: vi.fn(), agentSessionResume: vi.fn(),
  agentSessionStop: vi.fn(), agentSessionsList: vi.fn(), agentSetMode: vi.fn(),
}));
vi.mock("./notes-store", () => ({
  indexFor: () => ({ notes: [], rounds: [], generation: 0, vault: "", borrowed: false }),
  refreshNotes: vi.fn(async () => {}), roundGenerating: vi.fn(() => false), roundNotesFor: vi.fn(() => []), setRoundGenerating: vi.fn(),
}));
vi.mock("./journal", () => ({ announce: vi.fn() }));
vi.mock("@/overlays/toasts", () => ({ toastAction: vi.fn(), toastError: vi.fn() }));

const agent = await import("./agent-session");

describe("warmAgentSession", () => {
  beforeEach(() => { started.length = 0; claude = "/usr/local/bin/claude"; });

  it("starts the session once and says warming until it is ready", async () => {
    const dir = "/warm-a";
    await agent.warmAgentSession(dir);
    await agent.warmAgentSession(dir);
    expect(started).toEqual([dir]);
    const s = agent.agentSessionFor(dir);
    expect(s.warm).toBe(true);
    expect(agent.agentStateWord(s)).toEqual({ word: "warming", kind: "neutral" });
    s.phase = "ready";
    expect(agent.agentStateWord(s).word).toBe("idle");
  });

  it("warm start is a no-op without claude", async () => {
    claude = null;
    const dir = "/warm-b";
    await agent.warmAgentSession(dir);
    expect(started).toEqual([]);
    expect(agent.agentSessionFor(dir).phase).toBe("none");
    expect(agent.agentStateWord(agent.agentSessionFor(dir)).word).toBe("idle");
  });

  it("does not warm a session that was explicitly ended", async () => {
    const dir = "/warm-c";
    Object.assign(agent.agentSessionFor(dir), { phase: "ended" });
    await agent.warmAgentSession(dir);
    expect(started).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/lib/agent-session.warm.test.ts`
Expected: FAIL — `warmAgentSession is not a function`.

- [ ] **Step 3: The store**

In `src/lib/agent-session.ts`: add `warm: boolean` to `AgentSessionState` and `warm: false` to `blank()`. Where the reducer sets `s.phase = "ready"` (the `_chronicle/session_state` `ready` branch), add `s.warm = false;`. In `agentStateWord`, before the `installing || starting` line:

```ts
if (s.warm && (s.phase === "installing" || s.phase === "starting")) return { word: "warming", kind: "neutral" };
```

Add, next to `startAgentSession`:

```ts
/** Projects warmed this app session — a pane being hidden and shown, or a
 *  session the user ended, must never start another on its own. */
const warmed = new Set<string>();

/** Start the project's session the moment the project is open, so the first
 *  word is answered without the handshake in the way. Adopts a live backend
 *  session first; otherwise starts one, once, and only when Claude is
 *  installed — an unconfigured Mac must not open into an error banner. */
export async function warmAgentSession(dir: string): Promise<void> {
  await adoptAgentSession(dir);
  if (warmed.has(dir)) return;
  const s = agentSessionFor(dir);
  if (s.phase !== "none") return;
  const a = (await agentsAvailable().catch(() => null)) as { claude?: string | null } | null;
  if (!a?.claude) return;
  if (agentSessionFor(dir).phase !== "none") return; // re-check across the await
  warmed.add(dir);
  s.warm = true;
  await startAgentSession(dir).catch(() => { s.warm = false; });
}
```

(`agentsAvailable` joins the `./ipc` import. The two older test files that mock `./ipc` — `src/lib/agent-session.test.ts` and `src/lib/agent-session.notify.test.ts` — must add `agentsAvailable: vi.fn(async () => ({ claude: null, codex: null, default: "" }))` to their mock objects, or the import binding throws when first touched.)

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/lib/agent-session.warm.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: The callers**

`src/screens/agent/AgentPane.tsx`: replace the body of the auto-start effect (keep the `variant === "design"` early return) with `void warmAgentSession(dir);`; delete the `autoStarted` set and the `agentsAvailable` import. `src/App.tsx`: inside `activate` (after `setActiveDir(dir)`) add `void warmAgentSession(dir);`, and in the effect that restores the last active project on launch (the one that calls `activate` or `setActiveDir` for the remembered project) make sure it goes through `activate` so the same line runs. Import `warmAgentSession` from `@/lib/agent-session`.

Composer while warming: in `src/screens/agent/Composer.tsx` add a prop `sendDisabled?: boolean` (default `false`); the send guard on line ~388 becomes `|| disabled || sendDisabled || sending || s.turnActive`; the send button's `disabled` includes `sendDisabled`; the textarea's `disabled` stays on `disabled` alone. In `AgentPane.tsx`, for the chat variant pass `disabled={s.phase === "error" || s.phase === "needs-login"}` and `sendDisabled={s.phase !== "ready"}`, so the draft can be typed while warming (board R6, "you can type now") and the existing `s.draft` carries it to the ready session. Under the status word, while `s.warm` and not ready, the empty-thread screen shows the line `Ready in a moment — you can type now` in `text-[11px] text-text-faint`.

- [ ] **Step 6: Typecheck, suite, live check, commit**

Run: `npm run typecheck && npx vitest run`. In the installed-style check (release build): open a project, count from the window appearing to the state word reading `ready`, using the session log's `[+ms]` stamps; type a word during `warming` and send it once `ready` — it goes. Record in `c-runs/PROGRESS.md` (Task 9 row).

```bash
git add src/lib/agent-session.ts src/lib/agent-session.warm.test.ts src/screens/agent/AgentPane.tsx src/screens/agent/Composer.tsx src/App.tsx c-runs/PROGRESS.md
git commit -m "feat(pane): the session warms when the project opens; the pane says so and takes your draft meanwhile

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: Measured against the targets, and the roadmap phase

**Files:**
- Modify: `c-runs/PROGRESS.md` (the before/after table, one row per target); `chronicle.json` (phase `RN-2`'s `done_when`, so the roadmap can prove it)

**Interfaces:**
- Consumes: every task's PROGRESS rows.
- Produces: the sub-project's closing table and the roadmap proof.

- [ ] **Step 1: Build the release binary and run the four measurements**

```bash
export PATH="$HOME/.cargo/bin:$PATH"
cd src-tauri && cargo build --release --features tauri/custom-protocol && cd ..
```

Launch `src-tauri/target/release/chronicle` from a terminal (it refuses unknown args; just the binary). Measure:

| Target | How |
|---|---|
| Warm start < 1.5 s | open a project; from the session log, `[+ms]` of the `ready` line minus the first line |
| Cold start < 3 s | `rm -rf ~/.chronicle/tools/adapter`, relaunch, open a project, same stamps; then reinstall from Setup |
| Chunk < 2 ms, 60 fps | a dev build, 300-entry thread (ask for a long numbered list until the thread has 300 rows — `__chroniclePerf()`; `avgMs`, `maxMs`, `over2ms`, `perSecond`) |
| No jump while following | watch a 1,500-word stream pinned; scroll up; return — screenshot the three states by window id (`screencapture -x -l <id>`) |

- [ ] **Step 2: Write the closing table**

`c-runs/PROGRESS.md` ends with:

```markdown
## Sub-project A · closing table (2026-10-DD)

| Target | Before | After | Met |
|---|---|---|---|
| Warm start, project open → ready | n/a (started on pane mount) | … s | yes/no |
| Cold start, pane mount → ready | … s (npx) | … s | yes/no |
| Chunk render cost, 300-entry thread | avg … ms · max … ms · … over 2 ms | avg … ms · max … ms · … over 2 ms | yes/no |
| Follow-scroll | smooth scroll restarted per row; jump per chunk | pinned, no visible jump; one glide on return | yes/no |
```

Every cell is a number you measured. A target not met is written as `no` with the number; it is not reworded.

- [ ] **Step 3: The roadmap proof**

In `chronicle.json`, phase `RN-2` ("A faster, smoother chat pane"): set its `status.done_when` to `[{ "file_matches": { "path": "c-runs/PROGRESS.md", "pattern": "(?m)^## Sub-project A · closing table" } }]` (the same shape `SE` and the Z-phases use). Validate: `python3 -c "import json;json.load(open('chronicle.json'))"`.

- [ ] **Step 4: Commit**

```bash
git add c-runs/PROGRESS.md chronicle.json
git commit -m "docs(runs): sub-project A measured — the closing table, and the roadmap proof for RN-2

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Self-review (done while writing)

- **Spec coverage, §9:** direct spawn (Task 7), the Setup row (8), warm start (9), notifications per frame (1), memoised rows (2, 3), streamdown (4), scroll anchoring and content-visibility (5), motion tokens and the four moments (6), targets measured (10). §5's spike (0). §12's tests: coalescing, row signatures, markdown fixtures, scroll decision, Rust launch/detect, setup row, warm start; the replay fixture for the run card belongs to Plan B.
- **Placeholders:** none; every code step has its code. The two live-check rows that read "…" in Task 10's table are measured values the executor fills in, by instruction.
- **Types:** `rev` is added to the union in Task 2 and used by `rowSignature`; `agentVersion`/`flushAgentNotifications` named the same in Tasks 1, 3, 5; `AdapterLaunch` is defined in `acp.rs` and consumed by `setup.rs`/`main.rs` under that name; `warm` is on the state in Task 9 and read by `agentStateWord`.
- **Review Focus:** all five pinned (Tasks 1, 5, 7, 9, 4).
- **Deviation flagged:** Task 6 uses CSS instead of the `motion` library named in spec §9.
