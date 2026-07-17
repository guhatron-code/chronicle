# Agent Composer Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-session Full-auto warning, Enter-to-send / Shift+Enter-newline, file attachments (picker + Finder drag + paste), an auto-growing input, and Shift-drag of an attachment path into a terminal — all in the Chronigirl agent composer.

**Architecture:** Attachments follow "approach A" — every added file is persisted into `.chronicle/attachments/` via a new Rust `agent_attach` seam (mirroring `kanban_attach`), and referenced to the agent as an on-disk path appended to the prompt text (the agent reads it with its own Read tool). The composer keeps a local list of attachment chips; each chip is a drag source whose payload is the file's absolute path, and `TerminalColumn`'s per-tab surface is a Shift-gated drop target that types that path via `ptyWrite`.

**Tech Stack:** React + TypeScript (Vite), Tailwind, Tauri (Rust backend, `invoke` seam), xterm terminals.

## Global Constraints

- Attachment files live only in `.chronicle/attachments/`, jailed, base64-in, ≤10 MB (matches `kanban_attach`).
- Frontend has **no unit-test framework**; the automated gate for TS is `npm run typecheck` (`tsc -b`). Rust has `cargo test` (`src-tauri/`).
- Listeners/handlers register ONCE at module scope (the ipc.ts law) — do not add per-mount global listeners.
- Copy is exact where quoted below. Modes are the agent's own ids: `default` (Asks first), `acceptEdits` (Works freely), `bypassPermissions` (Full auto).
- The path typed into a terminal ends with a single trailing space and never a newline (it must never run a command on its own).
- Commit after each task. Do not push unless asked.

---

### Task 1: Rust `agent_attach` seam + TS binding

**Files:**
- Modify: `src-tauri/src/main.rs` (add helper `save_agent_attachment`, command `agent_attach`, register in the invoke handler list ~line 2813; add a `#[test]` in `mod r1_tests`)
- Modify: `src/lib/ipc.ts` (add `agentAttach` binding near `kanbanAttach`, line ~265)

**Interfaces:**
- Produces (Rust command): `agent_attach(dir: String, name: String, b64: String) -> Result<String, String>` returning the repo-relative path, e.g. `.chronicle/attachments/foo.png`, disambiguated on collision (`foo-2.png`, `foo-3.png`, …).
- Produces (pure helper): `fn save_agent_attachment(root: &Path, name: &str, bytes: &[u8]) -> Result<String, String>`.
- Produces (TS): `agentAttach(dir: string, name: string, b64: string): Promise<string>`.

- [ ] **Step 1: Write the failing Rust test**

Add to `mod r1_tests` in `src-tauri/src/main.rs` (the module already has a `tmp` helper):

```rust
    #[test]
    fn agent_attach_saves_and_disambiguates() {
        let repo = tmp("agent-attach");
        let p1 = save_agent_attachment(&repo, "shot.png", b"one").unwrap();
        assert_eq!(p1, ".chronicle/attachments/shot.png");
        assert_eq!(std::fs::read(repo.join(&p1)).unwrap(), b"one");
        // same name again must not clobber — it disambiguates
        let p2 = save_agent_attachment(&repo, "shot.png", b"two").unwrap();
        assert_eq!(p2, ".chronicle/attachments/shot-2.png");
        assert_eq!(std::fs::read(repo.join(&p1)).unwrap(), b"one", "first file untouched");
        assert_eq!(std::fs::read(repo.join(&p2)).unwrap(), b"two");
        // a name with unsafe characters is sanitized, extension preserved
        let p3 = save_agent_attachment(&repo, "a b/c.PNG", b"x").unwrap();
        assert!(p3.starts_with(".chronicle/attachments/"), "stays in the jail dir");
        assert!(!p3.contains('/') || p3.matches('/').count() == 2, "no nested dirs");
        // an empty/invalid name is rejected
        assert!(save_agent_attachment(&repo, "", b"x").is_err());
    }
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd src-tauri && cargo test agent_attach_saves_and_disambiguates`
Expected: FAIL — `cannot find function save_agent_attachment`.

- [ ] **Step 3: Add the pure helper + command**

Insert after `kanban_attach` (after line ~1174 in `src-tauri/src/main.rs`):

```rust
/// Save a composer attachment into `.chronicle/attachments/`, never clobbering:
/// a name collision gets a `-2`, `-3`, … suffix before the extension. Returns
/// the repo-relative path (approach A — the agent reads it from disk).
fn save_agent_attachment(root: &Path, name: &str, bytes: &[u8]) -> Result<String, String> {
    let safe: String = name.rsplit('/').next().unwrap_or(name).chars()
        .map(|c| if c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_') { c } else { '-' })
        .collect();
    let safe = safe.trim_matches('-').to_string();
    if safe.is_empty() || safe == "." { return Err("bad attachment name".into()); }
    if bytes.len() > 10_000_000 { return Err("attachment is over 10 MB".into()); }
    let adir = root.join(".chronicle/attachments");
    std::fs::create_dir_all(&adir).map_err(|e| e.to_string())?;
    let (stem, ext) = match safe.rfind('.') {
        Some(i) if i > 0 => (&safe[..i], &safe[i..]),
        _ => (safe.as_str(), ""),
    };
    let mut rel = format!(".chronicle/attachments/{safe}");
    let mut n = 2;
    while root.join(&rel).exists() {
        rel = format!(".chronicle/attachments/{stem}-{n}{ext}");
        n += 1;
    }
    std::fs::write(root.join(&rel), bytes).map_err(|e| e.to_string())?;
    Ok(rel)
}

/// Composer attachment: save a base64 file beside the manifest; returns the
/// repo-relative path to reference in the prompt.
#[tauri::command]
async fn agent_attach(roots: State<'_, OpenRoots>, dir: String, name: String, b64: String) -> Result<String, String> {
    let p = project_for(&roots, &dir)?;
    let bytes = base64::engine::general_purpose::STANDARD.decode(b64).map_err(|e| e.to_string())?;
    save_agent_attachment(&p.dir, &name, &bytes)
}
```

- [ ] **Step 4: Register the command**

In the `tauri::generate_handler![…]` list (near line 2813), add `agent_attach` to the kanban line:

```rust
            kanban_detach, agent_attach,
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd src-tauri && cargo test agent_attach_saves_and_disambiguates`
Expected: PASS.

- [ ] **Step 6: Add the TS binding**

In `src/lib/ipc.ts`, right after the `kanbanAttach` export (line ~266):

```ts
/** Composer attachment (approach A): save a base64 file into .chronicle/attachments;
 *  returns its repo-relative path to reference in the agent prompt. */
export const agentAttach = (dir: string, name: string, b64: string) =>
  invoke<string>("agent_attach", { dir, name, b64 });
```

- [ ] **Step 7: Typecheck + commit**

Run: `npm run typecheck`
Expected: no errors.

```bash
git add src-tauri/src/main.rs src/lib/ipc.ts
git commit -m "feat(agent): agent_attach seam — persist composer attachments to .chronicle/attachments"
```

---

### Task 2: Full-auto warning (once per session)

**Files:**
- Modify: `src/lib/agent-session.ts` (`AgentSessionState` + `blank()` + `setAgentMode`)
- Modify: `src/screens/agent/Composer.tsx` (`switchMode`)

**Interfaces:**
- Consumes: `AgentSessionState.worksFreelyConfirmed` (existing pattern to mirror), `ConfirmSpec` (`{ title, body, cancelLabel, confirmLabel, onConfirm }`), `setAgentMode(dir, modeId)`.
- Produces: `AgentSessionState.fullAutoConfirmed: boolean` (resets per session).

- [ ] **Step 1: Add the state field**

In `src/lib/agent-session.ts`, in the `AgentSessionState` interface, right after the `worksFreelyConfirmed` field (line ~102):

```ts
  /** the Full-auto confirm is per SESSION — reset on every new session */
  fullAutoConfirmed: boolean;
```

In `blank()` (after the `worksFreelyConfirmed: false,` line ~127):

```ts
  fullAutoConfirmed: false,
```

- [ ] **Step 2: Set the flag on switch**

In `setAgentMode` (line ~550), right after the `if (modeId === "acceptEdits") s.worksFreelyConfirmed = true;` line:

```ts
  if (modeId === "bypassPermissions") s.fullAutoConfirmed = true;
```

- [ ] **Step 3: Gate the switch in the composer**

In `src/screens/agent/Composer.tsx`, replace the `switchMode` function body (lines ~136-150) so `bypassPermissions` gets its own confirm branch:

```tsx
  const switchMode = (modeId: string) => {
    if (!s.modes || s.modes.currentModeId === modeId) return;
    const apply = () =>
      void setAgentMode(dir, modeId).catch((e) => toastError("Couldn't switch the mode", String(e).slice(0, 90)));
    if (modeId === "acceptEdits" && !s.worksFreelyConfirmed) {
      onConfirm({
        title: "Let the agent work freely?",
        body:
          "File edits happen without asking, for the rest of this session. Commands still ask every time. Every change stays reviewable and undoable. This lasts for this session only — the next session asks first again.",
        cancelLabel: "Keep asking first",
        confirmLabel: "Work freely this session",
        onConfirm: apply,
      });
    } else if (modeId === "bypassPermissions" && !s.fullAutoConfirmed) {
      onConfirm({
        title: "Turn on Full auto?",
        body:
          "Edits and commands both run without asking — nothing is confirmed. Every change still stays reviewable and undoable. This lasts for this session only — the next session asks first again.",
        cancelLabel: "Keep confirming",
        confirmLabel: "Turn on Full auto",
        onConfirm: apply,
      });
    } else apply();
  };
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Manual verification**

Run: `npm run dev`, open a project, start the agent. Then:
- Click **Full auto** → the "Turn on Full auto?" dialog appears; **Cancel** leaves the mode unchanged.
- Click **Full auto** again → confirm → mode switches to Full auto.
- Switch to Asks first, then back to **Full auto** → **no dialog** this time (confirmed this session).
- End/restart the session, click **Full auto** → the dialog appears again.

- [ ] **Step 6: Commit**

```bash
git add src/lib/agent-session.ts src/screens/agent/Composer.tsx
git commit -m "feat(agent): warn once per session before Full auto"
```

---

### Task 3: Enter-to-send, Shift+Enter newline, auto-growing height

**Files:**
- Modify: `src/screens/agent/Composer.tsx` (textarea `onKeyDown`, className, remove `rows`, add auto-grow effect, Kbd hint)

**Interfaces:**
- Consumes: `send()` (existing), `taRef` (existing `useRef<HTMLTextAreaElement>`), `text` state (existing).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Add the auto-grow effect**

In `src/screens/agent/Composer.tsx`, add `useLayoutEffect` to the React import (line 10):

```tsx
import { useEffect, useLayoutEffect, useRef, useState } from "react";
```

Then add this effect right after the existing draft `useEffect` (after line ~120, before `const send =`):

```tsx
  /* the input grows with its content up to a cap, then scrolls */
  useLayoutEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${ta.scrollHeight}px`;
  }, [text]);
```

- [ ] **Step 2: Change Enter behaviour**

Replace the textarea `onKeyDown` (lines ~187-192):

```tsx
        onKeyDown={(e) => {
          // Enter sends; Shift+Enter (and IME composition) inserts a newline
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            send();
          }
        }}
```

- [ ] **Step 3: Swap fixed rows for min/max height**

Replace the textarea `className` block (lines ~193-197) and delete the `rows={2}` prop (line ~198):

```tsx
        className={cn(
          "max-h-[200px] min-h-14 resize-none overflow-y-auto rounded-md border border-border-field bg-surface-input px-[11px] py-[9px] text-[13px] leading-normal text-text-primary outline-none placeholder:text-text-dimmer",
          "focus:border-border-field-focus focus:[box-shadow:var(--focus-ring)]",
          disabled && "opacity-60",
        )}
```

(Remove the `rows={2}` line entirely — the effect now owns the height.)

- [ ] **Step 4: Update the keyboard hint**

Change the Kbd hint (line ~268) from `⌘↩` to `↩`:

```tsx
            <Kbd>↩</Kbd>
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Manual verification**

Run: `npm run dev`, open the agent pane:
- Type a line, press **Enter** → the message sends and the input clears.
- Type a line, press **Shift+Enter** → a newline is inserted, nothing sends; the input **grows** one row.
- Paste several lines → the input grows up to ~200px then scrolls.
- With empty input, **Enter** does nothing (send stays disabled).
- The hint by the Send button reads **↩**.

- [ ] **Step 7: Commit**

```bash
git add src/screens/agent/Composer.tsx
git commit -m "feat(agent): Enter sends, Shift+Enter newline, input grows with content"
```

---

### Task 4: Attachments in the composer (picker, Finder drag, paste)

**Files:**
- Modify: `src/screens/agent/Composer.tsx` (attachment state, `addFiles`, chip row, 📎 button + hidden file input, container drop/paste, send body)

**Interfaces:**
- Consumes: `agentAttach(dir, name, b64)` (Task 1), `IMG_MIME` (`ipc.ts`), `sendAgentMessage(dir, body)` (existing), `toastError` (existing).
- Produces (used by Task 5): a rendered chip element carrying `data-attach-chip`, `draggable`, and per-chip `absPath` on `onDragStart`. The composer's `Attachment` shape:
  ```ts
  type Attachment = { id: string; name: string; absPath: string; relPath: string; isImage: boolean };
  ```

- [ ] **Step 1: Import the attach seam + MIME table**

In `src/screens/agent/Composer.tsx`, add to the `@/lib/agent-session` sibling imports and `@/lib/ipc`:

```tsx
import { agentAttach, IMG_MIME } from "@/lib/ipc";
```

- [ ] **Step 2: Add attachment state + helpers**

Inside `Composer`, after `const [sending, setSending] = useState(false);` (line ~106), add:

```tsx
  type Attachment = { id: string; name: string; absPath: string; relPath: string; isImage: boolean };
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const attachSeq = useRef(0);

  const addFiles = async (files: File[]) => {
    for (const f of files) {
      try {
        const buf = new Uint8Array(await f.arrayBuffer());
        let bin = "";
        for (const byte of buf) bin += String.fromCharCode(byte);
        const name = f.name || `pasted-${(attachSeq.current += 1)}.png`;
        const relPath = await agentAttach(dir, name, btoa(bin));
        const ext = relPath.split(".").pop()?.toLowerCase() ?? "";
        setAttachments((prev) => [
          ...prev,
          { id: `${Date.now()}-${attachSeq.current++}`, name, absPath: `${dir}/${relPath}`, relPath, isImage: ext in IMG_MIME },
        ]);
      } catch (e) {
        toastError("Couldn't attach the file", String(e).slice(0, 90));
      }
    }
  };

  const removeAttachment = (id: string) => setAttachments((prev) => prev.filter((a) => a.id !== id));
```

- [ ] **Step 3: Route send through the attachment references**

Replace the `send` function (lines ~122-130) so it (a) allows attachment-only sends, and (b) appends the reference block:

```tsx
  const send = () => {
    const typed = text.trim();
    if ((!typed && attachments.length === 0) || disabled || sending || s.turnActive) return;
    const refs = attachments.length
      ? `${typed ? `${typed}\n\n` : ""}Attached files:\n${attachments.map((a) => `- ${a.relPath}`).join("\n")}`
      : typed;
    setSending(true);
    sendAgentMessage(dir, refs)
      .then(() => { setText(""); mirrorComposerText(dir, ""); setAttachments([]); })
      .catch((e) => toastError("Couldn't send it", String(e).slice(0, 90)))
      .finally(() => setSending(false));
  };
```

- [ ] **Step 4: Make the container a drop + paste target**

Change the outermost composer `<div>` (line ~158) to accept file drops from Finder (ignoring our own chip drags) and image paste:

```tsx
    <div
      className="flex shrink-0 flex-col gap-2 border-t border-divider px-3 py-2.5"
      onDragOver={(e) => {
        // accept Finder file drops; ignore a chip being dragged (Task 5)
        if (Array.from(e.dataTransfer.types).includes("Files")) e.preventDefault();
      }}
      onDrop={(e) => {
        if (e.dataTransfer.types.includes("application/x-chronicle-path")) return; // a chip, not a file
        const files = Array.from(e.dataTransfer.files);
        if (files.length) { e.preventDefault(); void addFiles(files); }
      }}
    >
```

Add `onPaste` to the `<textarea>` (alongside `onChange`/`onKeyDown`):

```tsx
        onPaste={(e) => {
          const imgs = Array.from(e.clipboardData.items)
            .filter((it) => it.kind === "file" && it.type.startsWith("image/"))
            .map((it) => it.getAsFile())
            .filter((f): f is File => f != null);
          if (imgs.length) { e.preventDefault(); void addFiles(imgs); }
        }}
```

- [ ] **Step 5: Render the chip row + 📎 button + hidden input**

Add the chip row directly above the `<textarea>` (after the draft-chip block, line ~174):

```tsx
      {attachments.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {attachments.map((a) => (
            <span
              key={a.id}
              data-attach-chip
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData("application/x-chronicle-path", a.absPath);
                e.dataTransfer.setData("text/plain", a.absPath);
                e.dataTransfer.effectAllowed = "copy";
              }}
              className="inline-flex h-6 max-w-[180px] cursor-grab items-center gap-1.5 rounded-full bg-fill-subtle px-2.5 text-[11px] text-text-subtle active:cursor-grabbing"
              title={`${a.absPath} — drag onto a terminal (hold Shift) to insert the path`}
            >
              <span className="text-text-dim">{a.isImage ? "🖼" : "📎"}</span>
              <span className="truncate">{a.name}</span>
              <button
                aria-label={`Remove ${a.name}`}
                onClick={() => removeAttachment(a.id)}
                className="flex text-text-dim hover:text-text-secondary"
              >
                <XGlyph size={8} />
              </button>
            </span>
          ))}
        </div>
      )}
```

Add a 📎 attach button to the left of `<ModelPicker>` in the button row (line ~240), plus the hidden input. Replace the `{!disabled && <ModelPicker dir={dir} />}` line with:

```tsx
        {!disabled && (
          <button
            data-agent-attach
            title="Attach a file"
            onClick={() => fileInput.current?.click()}
            className="inline-flex h-[26px] items-center rounded-md border border-border-hairline px-2 text-[11.5px] text-text-muted hover:text-text-primary"
          >
            📎
          </button>
        )}
        {!disabled && <ModelPicker dir={dir} />}
        <input
          ref={fileInput}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => { void addFiles(Array.from(e.target.files ?? [])); e.target.value = ""; }}
        />
```

- [ ] **Step 6: Enable Send when only attachments are present**

Update the Send button `disabled` (line ~271) and its className condition (line ~275) to treat attachments as content. Replace both occurrences of `!text.trim()` in the Send button block with `(!text.trim() && attachments.length === 0)`:

```tsx
            <button
              data-agent-send
              disabled={disabled || sending || (!text.trim() && attachments.length === 0)}
              onClick={send}
              className={cn(
                "h-7 rounded-md px-3 text-xs font-medium",
                disabled || sending || (!text.trim() && attachments.length === 0)
                  ? "cursor-default bg-fill-subtle text-text-dimmer"
                  : "bg-primary text-primary-foreground hover:bg-[--primary-hover]",
              )}
            >
              Send
            </button>
```

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 8: Manual verification**

Run: `npm run dev`, open the agent pane:
- Click **📎** → pick a file → a chip appears; a file lands in `.chronicle/attachments/`.
- Drag a file from Finder onto the composer → a chip appears.
- Copy an image, focus the input, **⌘V** → a chip appears.
- With only a chip (no text), **Send** is enabled; sending posts a user message ending with `Attached files:\n- .chronicle/attachments/…` and the chips clear.
- The **✕** on a chip removes it (and its reference from the next send).

- [ ] **Step 9: Commit**

```bash
git add src/screens/agent/Composer.tsx
git commit -m "feat(agent): attach files in the composer (picker, Finder drag, paste)"
```

---

### Task 5: Shift-drag an attachment path into a terminal

**Files:**
- Modify: `src/components/chrome/TerminalColumn.tsx` (per-tab host div: `onDragOver` + `onDrop`)

**Interfaces:**
- Consumes: the chip drag source from Task 4 (`application/x-chronicle-path` = absolute path), `ptyWrite(id, data)` (`@/lib/ipc`), each tab's `t.id`.
- Produces: nothing consumed later.

- [ ] **Step 1: Import ptyWrite**

At the top of `src/components/chrome/TerminalColumn.tsx`, add:

```tsx
import { ptyWrite } from "@/lib/ipc";
```

- [ ] **Step 2: Add a shell-quote helper**

Above the `TerminalColumn` component (near line 96), add:

```tsx
/** Quote a path for the shell only when it needs it; always trailing-spaced,
 *  never newline-terminated (dropping a path must never run a command). */
function shellPath(p: string): string {
  return /[^A-Za-z0-9_./-]/.test(p) ? `'${p.replace(/'/g, `'\\''`)}' ` : `${p} `;
}
```

- [ ] **Step 3: Make each terminal surface a Shift-gated drop target**

In the per-tab host `<div>` (line ~301-309), add `onDragOver` and `onDrop`:

```tsx
          {tabs.map((t) => (
            <div
              key={t.id}
              ref={hostFor?.(t.id)}
              onDragOver={(e) => {
                // Shift-gated: only accept our attachment path while Shift is held
                if (e.shiftKey && e.dataTransfer.types.includes("application/x-chronicle-path")) {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "copy";
                }
              }}
              onDrop={(e) => {
                const path = e.dataTransfer.getData("application/x-chronicle-path");
                if (!e.shiftKey || !path) return;
                e.preventDefault();
                void ptyWrite(t.id, shellPath(path)).catch(() => {});
              }}
              className={cn(
                "h-full w-full min-w-0 overflow-hidden px-4 py-3.5 font-mono text-xs leading-[1.7] text-text-secondary",
                t.id !== activeId && "hidden",
              )}
            />
          ))}
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Manual verification**

Run: `npm run dev`, open a project with the agent pane and a terminal both visible:
- Attach a file in the composer (Task 4), then **drag its chip onto the terminal while holding Shift** → the absolute path is typed at the shell prompt with a trailing space, **no** newline (nothing runs).
- Drag the same chip onto the terminal **without Shift** → nothing is inserted.
- A path containing a space is single-quoted; a plain path is inserted bare.
- Dropping the chip back onto the composer does nothing (Task 4's guard).

- [ ] **Step 6: Commit**

```bash
git add src/components/chrome/TerminalColumn.tsx
git commit -m "feat(agent): Shift-drag an attachment path into a terminal"
```

---

## Self-Review notes

- **Spec coverage:** §1 Full-auto → Task 2. §2 Enter/Shift+Enter → Task 3. §3 attachments (seam + picker/drag/paste + send body) → Tasks 1 & 4. §4 auto-grow → Task 3. §5 Shift-drag into terminal → Tasks 4 (drag source) & 5 (drop target). Non-goal B (ACP image blocks) intentionally not implemented.
- **Type consistency:** `agentAttach` (Task 1) is consumed in Task 4; the `application/x-chronicle-path` dataTransfer key and absolute-path payload are set in Task 4 and read in Task 5; `Attachment.relPath` (repo-relative) feeds the send body, `Attachment.absPath` feeds the chip drag + terminal drop.
- **Finder-drop risk (spec §Risks):** Step 4 of Task 4 uses HTML5 `dataTransfer.files`. If a build shows Finder drops arriving only via a Tauri file-drop event instead, adapt that one step to subscribe to the Tauri event and call `addFiles` with the dropped paths (reading them via the existing `read_file_b64` seam) — the rest of the design is unchanged.
```
