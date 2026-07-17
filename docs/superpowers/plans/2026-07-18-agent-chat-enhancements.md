# Agent Chat Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add four independent agent-chat features — an effort selector, message queuing, inline side-by-side edit diffs, and a live plan/todo card.

**Architecture:** All four live on the existing agent surface. The single ACP reducer (`agent-session.ts`) gains a `plan` entry kind and a `queue`; the composer gains a shared `ConfigSelect` (used for model + effort) and queue-aware sending; `ToolCard` gains a lazy side-by-side diff reusing `parseDiff` + `agentEditDiff`.

**Tech Stack:** React + TypeScript (Vite), Tailwind, Tauri `invoke` seam.

## Global Constraints

- Frontend has **no unit-test framework**; the automated gate is `npm run typecheck` (`tsc -b`) from the repo root. Verify GUI behaviour by reasoning through the code (subagents cannot drive the app).
- The reducer registers listeners ONCE at module scope (the ipc.ts law) — do not add per-mount global listeners.
- Config options are the agent's OWN advertised ids read from the session — never assume they exist; every picker hides when its option is absent/empty.
- Adding a new `AgentEntry` kind REQUIRES an explicit render branch in `AgentPane`'s `Entry` component BEFORE the `ToolCard` fallback, or the new entry hits the fallback and crashes.
- Commit after each task, staging only that task's files. The working tree has unrelated dirty files — never stage them.
- Tasks are independent; any order works, but the plan orders them trivial → substantial.

---

### Task 1: Effort selector (shared ConfigSelect)

**Files:**
- Modify: `src/screens/agent/Composer.tsx` (replace `ModelPicker` with a shared `ConfigSelect`; render model + effort pickers)

**Interfaces:**
- Consumes: `agentSessionFor(dir).configOptions` (`AgentConfigOption[]`), `setAgentConfigOption(dir, id, value)` (both already imported/available).
- Produces: `ConfigSelect({ dir, optionId, title })` — a dropdown for one advertised select option; renders `null` when the option is absent or has no options.

- [ ] **Step 1: Replace `ModelPicker` with a generic `ConfigSelect`**

In `src/screens/agent/Composer.tsx`, replace the entire `ModelPicker` function (the block from the `/** F32 addendum … */` comment through its closing `}`, ~lines 28-92) with:

```tsx
/** F32 addendum — a config dropdown for ONE of the agent's advertised select
 *  options (model, effort, …), read from the session and set via config.
 *  Hidden when the adapter offers no such option. */
function ConfigSelect({ dir, optionId, title }: { dir: string; optionId: string; title: string }) {
  const s = agentSessionFor(dir);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  const opt = s.configOptions.find((o) => o.id === optionId);
  if (!opt || opt.options.length === 0) return null;
  const current = opt.options.find((o) => o.value === opt.currentValue);

  return (
    <div ref={ref} className="relative">
      <button
        data-config-select={optionId}
        title={title}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex h-[26px] items-center gap-1 rounded-md border border-border-hairline px-2 text-[11.5px] text-text-muted hover:text-text-primary"
      >
        {current?.name ?? opt.name}
        <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="m3 4.5 3 3 3-3" />
        </svg>
      </button>
      {open && (
        <div
          data-config-menu={optionId}
          className="absolute bottom-8 left-0 z-20 flex w-[260px] flex-col rounded-[10px] border border-border-strong bg-surface-overlay p-1 [box-shadow:var(--shadow-overlay)]"
        >
          {opt.options.map((o) => (
            <button
              key={o.value}
              onClick={() => {
                setOpen(false);
                void setAgentConfigOption(dir, optionId, o.value).catch((e) =>
                  toastError("Couldn't change the setting", String(e).slice(0, 90)),
                );
              }}
              className="flex flex-col gap-0.5 rounded-md px-2.5 py-1.5 text-left hover:bg-fill-hover"
            >
              <div className="flex items-center gap-2">
                <span className="text-[12.5px] text-text-primary">{o.name}</span>
                {o.value === opt.currentValue && (
                  <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="var(--state-success)" strokeWidth="1.6" className="shrink-0">
                    <path d="M2 6.5 5 9.5 10 3" />
                  </svg>
                )}
              </div>
              {o.description && <span className="text-[11px] leading-snug text-text-dim">{o.description}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Render both pickers in the composer button row**

Find where the model picker is rendered (search for `<ModelPicker dir={dir} />`). It sits after the 📎 attach button. Replace that single line:

```tsx
        {!disabled && <ModelPicker dir={dir} />}
```

with:

```tsx
        {!disabled && <ConfigSelect dir={dir} optionId="model" title="The model the agent uses" />}
        {!disabled && <ConfigSelect dir={dir} optionId="effort" title="How hard the model thinks" />}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors (confirm no remaining reference to `ModelPicker`).

- [ ] **Step 4: Manual verification (reason through)**

- With an adapter advertising `effort` (category `thought_level`), a second dropdown appears next to the model picker showing the effort levels; picking one calls `setAgentConfigOption(dir, "effort", value)` and the current value gets the green check.
- When no `effort` option is advertised, `ConfigSelect` returns `null` — nothing renders.
- The model picker behaves exactly as before.

- [ ] **Step 5: Commit**

```bash
git add src/screens/agent/Composer.tsx
git commit -m "feat(agent): effort selector via a shared ConfigSelect (model + effort)"
```

---

### Task 2: Message queuing

**Files:**
- Modify: `src/lib/agent-session.ts` (`queue` state, `enqueueAgentMessage`, `dequeueAgentMessage`, turn_end auto-flush)
- Modify: `src/screens/agent/Composer.tsx` (queue on Enter during a turn; "Queue" button)
- Modify: `src/screens/agent/AgentPane.tsx` (queued-message bubbles above the composer)

**Interfaces:**
- Produces: `AgentSessionState.queue: string[]`; `enqueueAgentMessage(dir, text)`; `dequeueAgentMessage(dir, index)`.
- Consumes: `sendAgentMessage(dir, text)` (existing) for the flush.

- [ ] **Step 1: Add queue state**

In `src/lib/agent-session.ts`, add to the `AgentSessionState` interface (after `composerText: string;`):

```ts
  /** messages typed while a turn was active — auto-sent FIFO on turn end (#4) */
  queue: string[];
```

In `blank()` (after `composerText: "",`):

```ts
  queue: [],
```

- [ ] **Step 2: Add enqueue/dequeue actions**

In `src/lib/agent-session.ts`, next to `mirrorComposerText` (in the actions section), add:

```ts
/** Queue a message typed during an active turn (#4). */
export function enqueueAgentMessage(dir: string, text: string) {
  const body = text.trim();
  if (!body) return;
  agentSessionFor(dir).queue.push(body);
  notify();
}

/** Drop one queued message by index (the cancel ✕). */
export function dequeueAgentMessage(dir: string, index: number) {
  const s = agentSessionFor(dir);
  if (index >= 0 && index < s.queue.length) {
    s.queue.splice(index, 1);
    notify();
  }
}
```

- [ ] **Step 3: Auto-flush on a clean turn end**

In `src/lib/agent-session.ts`, in the `_chronicle/turn_end` handler, immediately BEFORE the final `notify();` of that block, add:

```ts
    // #4 — a clean turn end releases the next queued message (FIFO, one/turn);
    // on error we keep the queue so a broken session doesn't fire into the void
    if (params.error == null && s.queue.length > 0) {
      const next = s.queue.shift()!;
      void sendAgentMessage(dir, next).catch(() => {});
    }
```

- [ ] **Step 4: Queue from the composer during a turn**

In `src/screens/agent/Composer.tsx`, import the new actions (add to the `@/lib/agent-session` import list):

```tsx
  enqueueAgentMessage,
```

Add a `queue` helper next to `send` (after the `send` function):

```tsx
  const queue = () => {
    const body = text.trim();
    if (!body) return;
    enqueueAgentMessage(dir, body);
    setText("");
    mirrorComposerText(dir, "");
  };
```

Update the textarea `onKeyDown` Enter branch so a turn-in-progress queues instead of sends:

```tsx
        onKeyDown={(e) => {
          // Enter sends; while a turn is active it queues; Shift+Enter / IME = newline
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            if (s.turnActive) queue();
            else send();
          }
        }}
```

- [ ] **Step 5: Add a "Queue" button beside Stop**

In `src/screens/agent/Composer.tsx`, in the `s.turnActive ?` branch of the button row (the one rendering the `data-agent-stop` button), render a Queue button before the Stop button. Replace:

```tsx
        {s.turnActive ? (
          <button
            data-agent-stop
            onClick={stop}
            className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border-strong px-3 text-xs font-medium text-text-primary hover:bg-fill-hover"
          >
            <span className="size-2 shrink-0 rounded-[1.5px] bg-current" />
            Stop
          </button>
        ) : (
```

with:

```tsx
        {s.turnActive ? (
          <>
            {text.trim() && (
              <button
                data-agent-queue
                onClick={queue}
                className="h-7 rounded-md border border-border-strong px-3 text-xs font-medium text-text-primary hover:bg-fill-hover"
              >
                Queue
              </button>
            )}
            <button
              data-agent-stop
              onClick={stop}
              className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border-strong px-3 text-xs font-medium text-text-primary hover:bg-fill-hover"
            >
              <span className="size-2 shrink-0 rounded-[1.5px] bg-current" />
              Stop
            </button>
          </>
        ) : (
```

- [ ] **Step 6: Render queued bubbles above the composer**

In `src/screens/agent/AgentPane.tsx`, import the dequeue action (add to the `@/lib/agent-session` import list):

```tsx
  dequeueAgentMessage,
```

Add a `QueuedMessages` component near the other small components in the file (e.g. above the main pane component):

```tsx
/** #4 — messages waiting for the current turn to end; each cancellable. */
function QueuedMessages({ dir, queue }: { dir: string; queue: string[] }) {
  if (queue.length === 0) return null;
  return (
    <div className="mx-3 mb-2 flex flex-col gap-1.5">
      {queue.map((text, i) => (
        <div
          key={i}
          data-queued-message
          className="flex items-start gap-2 rounded-md border border-border-hairline bg-fill-subtle px-[11px] py-2"
        >
          <span className="mt-[1px] shrink-0 rounded-[5px] bg-surface-card px-1.5 text-[10.5px] text-text-dim">queued</span>
          <span className="min-w-0 flex-1 whitespace-pre-wrap text-[12.5px] text-text-secondary [overflow-wrap:anywhere]">{text}</span>
          <button
            aria-label="Remove this queued message"
            onClick={() => dequeueAgentMessage(dir, i)}
            className="mt-[1px] flex shrink-0 text-text-dim hover:text-text-secondary"
          >
            <XGlyph size={9} />
          </button>
        </div>
      ))}
    </div>
  );
}
```

If `XGlyph` isn't already imported in `AgentPane.tsx`, add it: `import { XGlyph } from "@/components/chrome/icons";` (check the existing imports first — reuse if present).

Render it directly above the `<Composer …/>` line (after `{banner}`):

```tsx
      <QueuedMessages dir={dir} queue={s.queue} />
      <Composer dir={dir} disabled={s.phase !== "ready"} onConfirm={onConfirm} />
```

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 8: Manual verification (reason through)**

- While the agent is working, typing text + Enter (or the "Queue" button) adds a "queued" bubble and clears the input; the agent keeps working.
- The ✕ on a bubble removes just that message.
- When the turn ends cleanly, the first queued message auto-sends (becomes a normal user message, turn starts) and any remaining stay queued until the next turn end.
- If the turn ended with an error, the queue is left intact (nothing auto-fires).
- When no turn is active, Enter/Send send immediately as before.

- [ ] **Step 9: Commit**

```bash
git add src/lib/agent-session.ts src/screens/agent/Composer.tsx src/screens/agent/AgentPane.tsx
git commit -m "feat(agent): queue messages during a turn, auto-send FIFO on turn end"
```

---

### Task 3: Inline side-by-side edit diffs

**Files:**
- Modify: `src/lib/repo-data.ts` (add `sideBySide` transform + `DiffCell` type)
- Modify: `src/screens/agent/ToolCard.tsx` (diff toggle, lazy fetch, side-by-side renderer; new `dir` prop)
- Modify: `src/screens/agent/AgentPane.tsx` (pass `dir` to `ToolCard`)

**Interfaces:**
- Consumes: `parseDiff(raw)` and `DiffRow` (`repo-data.ts`), `agentEditDiff(dir, abs)` (`ipc.ts`).
- Produces: `DiffCell = { n?: number; text: string; kind: "ctx"|"add"|"del"|"empty" }`; `sideBySide(rows: DiffRow[]): { left: DiffCell; right: DiffCell; hunk?: string }[]`.

- [ ] **Step 1: Add the `sideBySide` transform**

In `src/lib/repo-data.ts`, right after the `parseDiff` function, add:

```ts
export type DiffCell = { n?: number; text: string; kind: "ctx" | "add" | "del" | "empty" };
/** One printed row of a side-by-side diff: a left (old) and right (new) cell,
 *  or a full-width hunk separator. */
export type DiffPair = { left: DiffCell; right: DiffCell; hunk?: string };

const EMPTY_CELL: DiffCell = { text: "", kind: "empty" };

/** Turn unified diff rows into paired old|new columns. Context rows fill both
 *  sides; a run of deletions pairs index-aligned against the following run of
 *  additions, padding the shorter side with empty cells. */
export function sideBySide(rows: DiffRow[]): DiffPair[] {
  const out: DiffPair[] = [];
  let dels: DiffRow[] = [];
  let adds: DiffRow[] = [];
  const flush = () => {
    const n = Math.max(dels.length, adds.length);
    for (let i = 0; i < n; i++) {
      const d = dels[i];
      const a = adds[i];
      out.push({
        left: d ? { n: d.old, text: d.text, kind: "del" } : EMPTY_CELL,
        right: a ? { n: a.new, text: a.text, kind: "add" } : EMPTY_CELL,
      });
    }
    dels = [];
    adds = [];
  };
  for (const row of rows) {
    if (row.kind === "del") { dels.push(row); continue; }
    if (row.kind === "add") { adds.push(row); continue; }
    flush();
    if (row.kind === "hunk") {
      out.push({ left: EMPTY_CELL, right: EMPTY_CELL, hunk: `${row.header}${row.context ? `  ${row.context}` : ""}` });
    } else {
      // ctx: same text on both sides
      out.push({ left: { n: row.old, text: row.text, kind: "ctx" }, right: { n: row.new, text: row.text, kind: "ctx" } });
    }
  }
  flush();
  return out;
}
```

- [ ] **Step 2: Add the diff UI to `ToolCard`**

In `src/screens/agent/ToolCard.tsx`, ADD these imports (do NOT re-import
`useState` — it is already imported at the top of the file; only add the three
new lines below):

```tsx
import { agentEditDiff } from "@/lib/ipc";
import { parseDiff, sideBySide, type DiffPair } from "@/lib/repo-data";
import { cn } from "@/lib/utils";
```

(The existing imports — `useState`, `AgentEntry`, `Spinner`, the glyphs — stay as they are.)

Change the component signature to accept `dir`:

```tsx
export function ToolCard({ tool, dir, onViewChanges }: { tool: Tool; dir: string; onViewChanges?: () => void }) {
```

Add diff state near the existing `const [open, setOpen] = useState(false);`:

```tsx
  const [diffOpen, setDiffOpen] = useState(false);
  const [diffRows, setDiffRows] = useState<DiffPair[] | null>(null);
  const [diffState, setDiffState] = useState<"idle" | "loading" | "empty" | "error">("idle");
  const isEdit = ["edit", "delete", "move"].includes(tool.toolKind);

  const toggleDiff = () => {
    const next = !diffOpen;
    setDiffOpen(next);
    if (next && diffRows == null && diffState === "idle") {
      setDiffState("loading");
      agentEditDiff(dir, `${dir}/${tool.detail}`)
        .then((raw) => {
          const pairs = sideBySide(parseDiff(raw).rows);
          setDiffRows(pairs);
          setDiffState(pairs.length ? "idle" : "empty");
        })
        .catch(() => setDiffState("error"));
    }
  };
```

Add the "Show the diff" toggle in the header row. Find the block that renders the `hasOutput` "Show the output" button (lines ~128-136) and add, right before it:

```tsx
        {isEdit && tool.diff && !running && (
          <button
            onClick={toggleDiff}
            className="inline-flex shrink-0 items-center gap-1 text-[11.5px] text-text-dim hover:text-text-secondary"
          >
            {diffOpen ? "Hide the diff" : "Show the diff"}
            {diffOpen ? <ChevronDownGlyph size={10} /> : <ChevronRightGlyph size={10} />}
          </button>
        )}
```

Add the expanded diff body. Find the closing of the output body (the `{hasOutput && (running || open) && ( … )}` block, ~lines 143-147) and add AFTER it, before the component's final `</div>`:

```tsx
      {diffOpen && (
        <div className="max-h-64 overflow-auto rounded-b-md border-t border-border-hairline bg-surface-input font-mono text-[11px] leading-[1.7]">
          {diffState === "loading" && <div className="px-3 py-2 text-text-dim">Loading the diff…</div>}
          {diffState === "empty" && <div className="px-3 py-2 text-text-dim">No diff to show.</div>}
          {diffState === "error" && <div className="px-3 py-2 text-text-dim">Couldn't load the diff.</div>}
          {diffRows && diffState !== "error" && <DiffSideBySide pairs={diffRows} />}
        </div>
      )}
```

- [ ] **Step 3: Add the `DiffSideBySide` renderer**

In `src/screens/agent/ToolCard.tsx`, add this component below the `ToolCard` function:

```tsx
/** #3 — two mono columns (old | new); del tinted red, add tinted green. */
function DiffSideBySide({ pairs }: { pairs: DiffPair[] }) {
  const cell = (c: { n?: number; text: string; kind: string }) => (
    <div
      className={cn(
        "flex min-w-0 flex-1 basis-1/2",
        c.kind === "add" && "bg-[color-mix(in_srgb,var(--state-success)_9%,transparent)]",
        c.kind === "del" && "bg-[color-mix(in_srgb,var(--state-error)_10%,transparent)]",
      )}
    >
      <span aria-hidden className="w-[34px] shrink-0 select-none px-2 text-right text-text-dimmer tabular-nums">
        {c.n ?? ""}
      </span>
      <span className="min-w-0 flex-1 whitespace-pre pr-2 text-text-secondary">{c.text}</span>
    </div>
  );
  return (
    <div className="min-w-max">
      {pairs.map((p, i) =>
        p.hunk != null ? (
          <div key={i} className="border-y border-divider-faint bg-surface-card-raised px-3 py-[3px] text-[10.5px] text-text-dim">
            {p.hunk}
          </div>
        ) : (
          <div key={i} className="flex">
            {cell(p.left)}
            <span className="w-px shrink-0 bg-border-hairline" />
            {cell(p.right)}
          </div>
        ),
      )}
    </div>
  );
}
```

- [ ] **Step 4: Pass `dir` to `ToolCard`**

In `src/screens/agent/AgentPane.tsx`, find `<ToolCard tool={entry} />` (in the `Entry` component's fallback return) and change it to:

```tsx
      <ToolCard tool={entry} dir={dir} />
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Manual verification (reason through)**

- An edit tool card still shows the `+N −M` badge. A "Show the diff" toggle appears (only for edit/delete/move with a diff, when not running).
- Expanding lazily fetches `agentEditDiff(dir, dir+"/"+detail)`, parses it, and renders side-by-side: old lines left (red), new lines right (green), context on both, hunk headers as separators; horizontal scroll for long lines; collapses again on toggle.
- A path with no ledger diff shows "No diff to show."; a fetch failure shows "Couldn't load the diff."
- Execute tool cards' "Show the output" is unaffected.

- [ ] **Step 7: Commit**

```bash
git add src/lib/repo-data.ts src/screens/agent/ToolCard.tsx src/screens/agent/AgentPane.tsx
git commit -m "feat(agent): expand edit tool cards to a side-by-side diff in the chat"
```

---

### Task 4: Live plan/todo card

**Files:**
- Modify: `src/lib/agent-session.ts` (`plan` entry kind + reducer case)
- Modify: `src/screens/agent/AgentPane.tsx` (`PlanCard` + `Entry` branch)

**Interfaces:**
- Consumes: the ACP `session/update` with `sessionUpdate === "plan"`, carrying `entries: { content: string; status: "pending"|"in_progress"|"completed" }[]`.
- Produces: `AgentEntry` variant `{ kind: "plan"; items: { text: string; status: "pending"|"in_progress"|"completed" }[] }`.

- [ ] **Step 1: Add the `plan` entry kind**

In `src/lib/agent-session.ts`, in the `AgentEntry` union, add a variant (e.g. after the `round` variant):

```ts
  | {
      kind: "plan";
      items: { text: string; status: "pending" | "in_progress" | "completed" }[];
    }
```

- [ ] **Step 2: Reduce the `plan` update in place**

In `src/lib/agent-session.ts`, in the `session/update` handler, add a branch alongside the other `kind === …` branches (e.g. after the `usage_update` branch):

```ts
    } else if (kind === "plan") {
      const raw = Array.isArray(update.entries) ? (update.entries as Raw[]) : [];
      const items = raw.map((e) => {
        const st = str(e.status);
        return {
          text: str(e.content),
          status: (st === "in_progress" || st === "completed" ? st : "pending") as
            | "pending"
            | "in_progress"
            | "completed",
        };
      });
      // update the live plan in place; a session has one evolving list
      const last = [...s.entries].reverse().find((e) => e.kind === "plan");
      if (last && last.kind === "plan") last.items = items;
      else s.entries.push({ kind: "plan", items });
```

- [ ] **Step 3: Render the plan card**

In `src/screens/agent/AgentPane.tsx`, add a `PlanCard` component (near `RoundCard`):

```tsx
/** #1 — the agent's live plan/todo list; updates in place as items progress. */
function PlanCard({ entry }: { entry: Extract<AgentEntry, { kind: "plan" }> }) {
  if (entry.items.length === 0) return null;
  const done = entry.items.filter((i) => i.status === "completed").length;
  return (
    <div data-plan-card className="flex flex-col gap-2 rounded-[10px] border border-border-hairline bg-surface-card-raised px-3.5 py-3">
      <div className="flex items-center gap-2 text-[11.5px] text-text-dim">
        <span className="font-medium text-text-secondary">Plan</span>
        <span className="tabular-nums">{done}/{entry.items.length}</span>
      </div>
      <div className="flex flex-col gap-1.5">
        {entry.items.map((item, i) => (
          <div key={i} className="flex items-start gap-2">
            <span className="mt-[2px] flex size-3.5 shrink-0 items-center justify-center">
              {item.status === "completed" ? (
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="var(--state-success)" strokeWidth="1.7"><path d="M2 6.5 5 9.5 10 3" /></svg>
              ) : item.status === "in_progress" ? (
                <span className="size-2.5 rounded-full border-[1.5px] border-state-neutral" style={{ borderTopColor: "transparent", animation: "wv-spin 0.7s linear infinite" }} />
              ) : (
                <span className="size-2.5 rounded-full border border-border-strong" />
              )}
            </span>
            <span className={cn("text-[12.5px] leading-[1.5]", item.status === "completed" ? "text-text-dim line-through" : "text-text-secondary")}>
              {item.text}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

Ensure `AgentEntry` and `cn` are imported in `AgentPane.tsx` (check the existing imports — `AgentEntry` is a type import from `@/lib/agent-session`, `cn` from `@/lib/utils`; both are almost certainly already imported since `RoundCard` uses them — reuse, don't duplicate).

- [ ] **Step 4: Add the `Entry` render branch**

In `src/screens/agent/AgentPane.tsx`, in the `Entry` component, add a branch BEFORE the final `ToolCard` fallback return:

```tsx
  if (entry.kind === "plan")
    return (
      <div className="px-3.5 py-1">
        <PlanCard entry={entry} />
      </div>
    );
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors (the new union member is handled in the `Entry` switch, so no exhaustiveness error).

- [ ] **Step 6: Manual verification (reason through)**

- When the adapter emits a `plan` update, a "Plan N/M" card renders in the thread with one row per item: completed → green check + strikethrough, in_progress → spinner, pending → hollow dot.
- Subsequent `plan` updates mutate the same card in place (the reducer finds the last plan entry), rather than stacking new cards.
- Replaying a stored transcript containing `plan` updates rebuilds the same card (the reducer is the single reduce path).
- Sessions that never emit `plan` show no card (no regression).

- [ ] **Step 7: Commit**

```bash
git add src/lib/agent-session.ts src/screens/agent/AgentPane.tsx
git commit -m "feat(agent): render the agent's live plan/todo list in the chat"
```

---

## Self-Review notes

- **Spec coverage:** #2 effort → Task 1. #4 queuing → Task 2. #3 inline diffs → Task 3. #1 plan card → Task 4. Non-goals (sub-agent fan-out, attachments-in-queue, other selects) intentionally excluded.
- **Type consistency:** `ConfigSelect({dir, optionId, title})` defined and used in Task 1; `queue`/`enqueueAgentMessage`/`dequeueAgentMessage` defined in Task 2 step 1-2 and consumed in the same task's composer/pane steps; `sideBySide`/`DiffPair`/`DiffCell` defined in Task 3 step 1 and consumed step 2-3; `ToolCard` gains `dir` in Task 3 step 2 and the call site is updated step 4; the `plan` union member (Task 4 step 1) is produced by the reducer (step 2) and consumed by `PlanCard` + the `Entry` branch (steps 3-4).
- **Crash-guard:** Task 4 step 4 adds the `Entry` branch for the new `plan` kind before the `ToolCard` fallback, per the Global Constraint.
- **Reuse:** Task 1 removes copy-paste by folding both pickers into `ConfigSelect`; Task 3 reuses `parseDiff` and `agentEditDiff` rather than adding a diff algorithm or IPC.
- **#1 live-verification caveat** (spec §Risks): the `plan` update was not present in local transcripts; if the adapter doesn't emit it the card simply never appears. Flag for live verification, not a code defect.
