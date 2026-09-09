/*
 * F32 — the composer: multiline input (Enter sends, Shift+Enter for a
 * newline), Stop replaces Send while the agent works (input stays
 * editable), the three-state mode control
 * (Asks first / Works freely / Full auto — modes are the AGENT'S OWN ids
 * read from the session), and the quiet usage meter
 * that is hidden entirely when the agent sends no usage data. Switching to
 * Works freely or Full auto is confirmed once per session, with copy that
 * states exactly what it covers.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  agentSessionFor,
  cancelAgentTurn,
  enqueueAgentMessage,
  mirrorComposerText,
  sendAgentMessage,
  setAgentConfigOption,
  setAgentDraft,
  setAgentMode,
} from "@/lib/agent-session";
import { XGlyph, PaperclipGlyph, ImageGlyph, ArrowRightGlyph } from "@/components/chrome/icons";
import type { ConfirmSpec } from "@/overlays/ConfirmDialog";
import { Kbd } from "@/components/chrome/atoms";
import { toastError } from "@/overlays/toasts";
import { cn } from "@/lib/utils";
import { agentAttach, agentAttachPath, IMG_MIME } from "@/lib/ipc";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { Autocomplete, findTrigger, handleKey, type PickerItem } from "./Autocomplete";
import { commandRows, LOCAL_COMMANDS } from "@/lib/composer-commands";
import {
  buildBlocks,
  ensureFileIndex,
  ensurePhases,
  flattenMentions,
  mentionRows,
  type Mention,
} from "@/lib/composer-mentions";

const fmtTokens = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));

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

export function Composer({
  dir,
  disabled,
  onConfirm,
}: {
  dir: string;
  /** true while the session isn't ready — the input dims and nothing sends */
  disabled: boolean;
  onConfirm: (spec: ConfirmSpec) => void;
}) {
  const s = agentSessionFor(dir);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);

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

  /** The OS-drag route (Finder → composer). Tauri intercepts native drops, so
   *  they never surface as HTML drop events and there is no `File` to read —
   *  we get absolute paths and the copy happens in Rust. */
  const addPaths = async (paths: string[]) => {
    for (const abs of paths) {
      try {
        const relPath = await agentAttachPath(dir, abs);
        const name = abs.split("/").pop() || relPath;
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

  const rootRef = useRef<HTMLDivElement>(null);
  const [osDropping, setOsDropping] = useState(false);

  useEffect(() => {
    /** is an OS cursor over this composer? position is PHYSICAL — to CSS px first */
    const over = (pos: { x: number; y: number }) => {
      const el = rootRef.current;
      if (!el) return false;
      const r = el.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const x = pos.x / dpr;
      const y = pos.y / dpr;
      return x >= r.left && x < r.right && y >= r.top && y < r.bottom;
    };
    let unlisten: (() => void) | undefined;
    let dead = false;
    void getCurrentWebview()
      .onDragDropEvent((e) => {
        const p = e.payload;
        if (p.type === "enter" || p.type === "over") setOsDropping(over(p.position));
        else if (p.type === "leave") setOsDropping(false);
        else if (p.type === "drop") {
          setOsDropping(false);
          if (over(p.position) && p.paths.length) void addPaths(p.paths);
        }
      })
      .then((fn) => {
        if (dead) fn();
        else unlisten = fn;
      })
      .catch(() => {});
    return () => {
      dead = true;
      unlisten?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dir]);

  const removeAttachment = (id: string) => setAttachments((prev) => prev.filter((a) => a.id !== id));

  /* ---------- the / and @ menus ---------- */
  const [trigger, setTrigger] = useState<{ kind: "slash" | "at"; start: number; query: string } | null>(null);
  const [active, setActive] = useState(0);

  /** tokens the user actually picked → what they mean. Survives edits; a token
   *  that stops matching just stops being a mention. */
  const mentions = useRef(new Map<string, Mention>());
  const [, bumpMenu] = useState(0);
  const rerender = () => bumpMenu((n) => n + 1);

  const GROUP: Record<Mention["kind"], string> = {
    attachment: "Attached",
    note: "Notes",
    phase: "Roadmap",
    file: "Files",
  };

  const items: PickerItem[] =
    trigger?.kind === "slash"
      ? commandRows(dir, trigger.query).map((r) => ({
          id: `${r.kind}:${r.name}`,
          label: `/${r.name}`,
          detail: r.description,
          hint: r.kind === "agent" ? r.hint : undefined,
          group: r.kind === "local" ? "Chronicle — runs here, never sent" : (r.group ?? "Agent"),
        }))
      : trigger?.kind === "at"
        ? mentionRows(
            dir,
            trigger.query,
            attachments.map((a) => ({ name: a.name, relPath: a.relPath })),
          ).map((m) => ({
            id: m.key,
            label: m.label,
            detail: m.detail,
            group: GROUP[m.kind],
          }))
        : [];

  const closeMenu = () => { setTrigger(null); setActive(0); };

  /** Recompute the trigger after any edit or caret move. The `@` sources load
   *  lazily — the first `@` pays for the index, not every session start. */
  const syncTrigger = (value: string, caret: number) => {
    const t = findTrigger(value, caret);
    if (t?.kind === "at") {
      ensureFileIndex(dir, rerender);
      ensurePhases(dir, rerender);
    }
    setTrigger(t);
    setActive(0);
  };

  const pick = (item: PickerItem) => {
    if (!trigger) return;
    const ta = taRef.current;
    if (trigger.kind === "slash") {
      const local = LOCAL_COMMANDS.find((c) => `local:${c.name}` === item.id);
      if (local) {
        // Chronicle's own — run it and clear; nothing goes to the agent
        closeMenu();
        setText("");
        mirrorComposerText(dir, "");
        void local.run(dir).catch((e) => toastError(`Couldn't run /${local.name}`, String(e).slice(0, 90)));
        return;
      }
      // the agent's own — insert the text and let the user add arguments
      const next = `${item.label} `;
      closeMenu();
      setText(next);
      mirrorComposerText(dir, next);
      requestAnimationFrame(() => {
        ta?.focus();
        ta?.setSelectionRange(next.length, next.length);
      });
      return;
    }

    // @ — swap the typed query for the token and remember what it points at
    const row = mentionRows(
      dir,
      trigger.query,
      attachments.map((a) => ({ name: a.name, relPath: a.relPath })),
    ).find((m) => m.key === item.id);
    if (!row) return;
    // keyed by identity, not by the inserted text: two notes can share a title
    mentions.current.set(row.key, row);
    const caret = ta?.selectionStart ?? text.length;
    const inserted = `@${row.token} `;
    const next = text.slice(0, trigger.start) + inserted + text.slice(caret);
    const at = trigger.start + inserted.length;
    closeMenu();
    setText(next);
    mirrorComposerText(dir, next);
    requestAnimationFrame(() => {
      ta?.focus();
      ta?.setSelectionRange(at, at);
    });
  };

  /* F38 — a preloaded draft lands in the input, unsent */
  const lastDraft = useRef<string | null>(null);
  useEffect(() => {
    if (s.draft != null && s.draft.text !== lastDraft.current) {
      lastDraft.current = s.draft.text;
      setText(s.draft.text);
      mirrorComposerText(dir, s.draft.text);
      taRef.current?.focus();
    }
    if (s.draft == null) lastDraft.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.draft, dir]);

  /* the input grows with its content up to a cap, then scrolls */
  useLayoutEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${ta.scrollHeight}px`;
  }, [text]);

  const send = () => {
    const typed = text.trim();
    if ((!typed && attachments.length === 0) || disabled || sending || s.turnActive) return;
    const withRefs = attachments.length
      ? `${typed ? `${typed}\n\n` : ""}Attached files:\n${attachments.map((a) => `- ${a.relPath}`).join("\n")}`
      : typed;
    // files become links the agent follows itself; a note or phase rides along
    // inline — a note's text is read from the vault here, at send time
    setSending(true);
    buildBlocks(withRefs, mentions.current, dir)
      .then((blocks) => sendAgentMessage(dir, withRefs, blocks))
      .then(() => {
        setText("");
        mirrorComposerText(dir, "");
        setAttachments([]);
        mentions.current.clear();
      })
      .catch((e) => toastError("Couldn't send it", String(e).slice(0, 90)))
      .finally(() => setSending(false));
  };

  const queue = () => {
    const typed = text.trim();
    if (!typed) return;
    // a queued message goes out unattended later — expand its mentions now,
    // while the table still holds what they pointed at
    enqueueAgentMessage(dir, flattenMentions(typed, mentions.current, dir));
    setText("");
    mirrorComposerText(dir, "");
    mentions.current.clear();
  };

  const stop = () => {
    void cancelAgentTurn(dir).catch((e) => toastError("Couldn't stop it", String(e).slice(0, 90)));
  };

  const switchMode = (modeId: string) => {
    if (!s.modes || s.modes.currentModeId === modeId) return;
    const apply = () =>
      void setAgentMode(dir, modeId).catch((e) => toastError("Couldn't switch the mode", String(e).slice(0, 90)));
    if (modeId === "acceptEdits" && !s.worksFreelyConfirmed) {
      onConfirm({
        title: "Switch to Execute?",
        body:
          "File edits happen without asking, for the rest of this session. Commands still ask every time. Every change stays reviewable and undoable. This lasts for this session only — the next session starts in Plan again.",
        cancelLabel: "Stay in Plan",
        confirmLabel: "Execute this session",
        onConfirm: apply,
      });
    } else if (modeId === "bypassPermissions" && !s.fullAutoConfirmed) {
      onConfirm({
        title: "Turn on Auto?",
        body:
          "Edits and commands both run without asking — nothing is confirmed. Every change still stays reviewable and undoable. This lasts for this session only — the next session starts in Plan again.",
        cancelLabel: "Keep confirming",
        confirmLabel: "Turn on Auto",
        onConfirm: apply,
      });
    } else apply();
  };

  const asksFirst = s.modes?.availableModes.find((m) => m.id === "default");
  const worksFreely = s.modes?.availableModes.find((m) => m.id === "acceptEdits");
  const fullAuto = s.modes?.availableModes.find((m) => m.id === "bypassPermissions");
  const current = s.modes?.currentModeId;

  return (
    <div
      ref={rootRef}
      className={cn(
        "flex shrink-0 flex-col gap-2 border-t border-divider px-3 py-2.5",
        osDropping && "bg-fill-subtle",
      )}
      /* Files arrive via the OS route (see addPaths) — these handlers exist only
       * to swallow a chip dropped back on the composer, which IS an in-webview
       * drag and so does reach React. */
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("application/x-chronicle-path")) e.preventDefault();
      }}
      onDrop={(e) => {
        if (e.dataTransfer.types.includes("application/x-chronicle-path")) e.preventDefault();
      }}
    >
      {s.draft && text === s.draft.text && (
        <div className="flex flex-wrap items-center gap-2">
          <span data-draft-chip className="inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-full bg-fill-subtle px-2.5 text-[11px] text-text-subtle">
            {s.draft.label}
            <span className="inline-flex items-center gap-1 text-text-dim">
              <ArrowRightGlyph size={9} className="shrink-0" />
              composer
            </span>
            <button
              aria-label="Clear the loaded prompt"
              onClick={() => { setAgentDraft(dir, null); setText(""); mirrorComposerText(dir, ""); }}
              className="flex text-text-dim hover:text-text-secondary"
            >
              <XGlyph size={8} />
            </button>
          </span>
          <span className="text-[11px] text-text-dim">review and send — nothing goes until you do</span>
        </div>
      )}
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
              {a.isImage ? (
                <ImageGlyph size={12} dot={false} className="shrink-0 text-text-dim" />
              ) : (
                <PaperclipGlyph size={11} className="shrink-0 text-text-dim" />
              )}
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
      <div className="relative flex flex-col">
      {trigger && (
        <Autocomplete
          items={items}
          active={active}
          onActive={setActive}
          onPick={pick}
          emptyLabel={trigger.kind === "slash" ? "No command matches" : "No match"}
        />
      )}
      <textarea
        ref={taRef}
        data-agent-input
        value={text}
        disabled={disabled}
        placeholder="Ask for anything…"
        onChange={(e) => {
          setText(e.target.value);
          mirrorComposerText(dir, e.target.value);
          syncTrigger(e.target.value, e.target.selectionStart ?? e.target.value.length);
          // hand-editing the preload keeps the text but drops the chip's claim
          if (s.draft && e.target.value !== s.draft.text) setAgentDraft(dir, null);
        }}
        onBlur={closeMenu}
        onClick={(e) => {
          const t = e.currentTarget;
          syncTrigger(t.value, t.selectionStart ?? t.value.length);
        }}
        onKeyDown={(e) => {
          // an open menu owns the keys it needs — crucially Enter, which must
          // accept the highlighted row rather than send the message
          if (
            trigger &&
            handleKey(e, items.length, active, setActive, () => pick(items[active]), closeMenu)
          )
            return;
          // Enter sends; while a turn is active it queues; Shift+Enter / IME = newline
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            if (s.turnActive) queue();
            else send();
          }
        }}
        onPaste={(e) => {
          const imgs = Array.from(e.clipboardData.items)
            .filter((it) => it.kind === "file" && it.type.startsWith("image/"))
            .map((it) => it.getAsFile())
            .filter((f): f is File => f != null);
          if (imgs.length) { e.preventDefault(); void addFiles(imgs); }
        }}
        className={cn(
          "max-h-[200px] min-h-14 resize-none overflow-y-auto rounded-md border border-border-field bg-surface-input px-[11px] py-[9px] text-[13px] leading-normal text-text-primary outline-none placeholder:text-text-dimmer",
          "focus:border-border-field-focus focus:[box-shadow:var(--focus-ring)]",
          disabled && "opacity-60",
        )}
      />
      </div>
      <div className="flex items-center gap-[9px]">
        {!disabled && (
          <button
            data-agent-attach
            title="Attach a file"
            onClick={() => fileInput.current?.click()}
            className="inline-flex h-[26px] items-center rounded-md border border-border-hairline px-2 text-text-muted hover:bg-fill-hover hover:text-text-primary"
          >
            <PaperclipGlyph size={13} />
          </button>
        )}
        {asksFirst && worksFreely && (
          <div className="flex overflow-hidden rounded-md border border-border-hairline" data-mode-control>
            <button
              title="The agent asks before editing files or running commands."
              disabled={disabled}
              onClick={() => switchMode("default")}
              className={cn(
                "h-[26px] px-2.5 text-[11.5px]",
                current === "default" ? "bg-fill-hover font-medium text-text-primary" : "text-text-muted hover:text-text-primary",
              )}
            >
              Plan
            </button>
            <button
              title="File edits happen without asking. Commands still ask."
              disabled={disabled}
              onClick={() => switchMode("acceptEdits")}
              className={cn(
                "h-[26px] border-l border-border-hairline px-2.5 text-[11.5px]",
                current === "acceptEdits" ? "bg-fill-hover font-medium text-text-primary" : "text-text-muted hover:text-text-primary",
              )}
            >
              Execute
            </button>
            {fullAuto && (
              <button
                title="Edits and commands both run without asking — nothing is confirmed."
                disabled={disabled}
                onClick={() => switchMode("bypassPermissions")}
                className={cn(
                  "h-[26px] border-l border-border-hairline px-2.5 text-[11.5px]",
                  current === "bypassPermissions" ? "bg-fill-hover font-medium text-text-primary" : "text-text-muted hover:text-text-primary",
                )}
              >
                Auto
              </button>
            )}
          </div>
        )}
        {!disabled && <ConfigSelect dir={dir} optionId="model" title="The model the agent uses" />}
        {!disabled && <ConfigSelect dir={dir} optionId="effort" title="How hard the model thinks" />}
        <input
          ref={fileInput}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => { void addFiles(Array.from(e.target.files ?? [])); e.target.value = ""; }}
        />
        {s.turnActive && (
          <span className="inline-flex items-center gap-1.5 text-[11.5px] text-state-neutral">
            <span
              aria-hidden
              className="inline-block size-[11px] shrink-0 rounded-full border-[1.5px] border-state-neutral"
              style={{ borderTopColor: "transparent", animation: "wv-spin 0.7s linear infinite" }}
            />
            working
          </span>
        )}
        {s.usage && (
          <span data-usage-meter className="font-mono text-[10.5px] text-text-dim tabular-nums">
            {fmtTokens(s.usage.used)} of {fmtTokens(s.usage.size)}
          </span>
        )}
        <span className="flex-1" />
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
          <>
            <Kbd>↩</Kbd>
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
          </>
        )}
      </div>
    </div>
  );
}
