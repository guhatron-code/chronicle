/* Board 3's form: the director asks before it draws. Chips toggle (one for a
   single, up to `max` for a multi), a text question is a 34 px field, and the
   references block takes a URL or a note on Enter and files through the
   composer's attach path into the design's refs/. Once answered or skipped the
   card stays as a record: the picks pressed, no buttons. */
import { useRef, useState, type KeyboardEvent } from "react";
import { answerQuestions, designProjectFor, skipQuestions } from "@/lib/design-store";
import type { Question } from "@/lib/design-review-model";
import { designRefAttach, IMG_MIME } from "@/lib/ipc";
import { toastError } from "@/overlays/toasts";
import { cn } from "@/lib/utils";
import { BtnPrimary } from "@/components/chrome/atoms";
import { ImageGlyph, PaperclipGlyph, XGlyph } from "@/components/chrome/icons";
import { BtnGhost, Eyebrow } from "./card";

type Answer = string | string[];
type Ref = { label: string; value: string; file: boolean };

const FIELD = "h-[34px] rounded-md border border-border-field bg-surface-input px-2.5 text-[12.5px] text-text-primary outline-none placeholder:text-text-faint focus:border-border-field-focus focus:[box-shadow:var(--focus-ring)]";
const isImage = (name: string) => (name.split(".").pop()?.toLowerCase() ?? "") in IMG_MIME;
const looksLikeUrl = (s: string) => /^(https?:\/\/)?[\w-]+(\.[\w-]+)+(\/\S*)?$/i.test(s);

const has = (a: Answer | undefined) => (Array.isArray(a) ? a.length > 0 : !!a && a.trim().length > 0);

export function QuestionsCard({ dir }: { dir: string }) {
  const p = designProjectFor(dir);
  const q = p.questions;
  const [picked, setPicked] = useState<Record<string, Answer>>({});
  const [refs, setRefs] = useState<Ref[]>([]);
  const [refText, setRefText] = useState("");
  const [sending, setSending] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  if (!q || q.questions.length === 0) return null;

  const done = q.answers != null || q.skipped;
  const answers: Record<string, Answer> = done ? (q.answers ?? {}) : picked;
  const doneRefs: Ref[] = done
    ? (Array.isArray(q.answers?.references) ? (q.answers.references as string[]) : []).map((v) => ({ label: v.split("/").pop() ?? v, value: v, file: !looksLikeUrl(v) && v.includes("/") }))
    : refs;
  const ready = q.questions.every((x) => x.type === "text" || has(picked[x.id]));

  const toggle = (x: Question, opt: string) => setPicked((prev) => {
    if (x.type === "single") return { ...prev, [x.id]: prev[x.id] === opt ? "" : opt };
    const cur = Array.isArray(prev[x.id]) ? (prev[x.id] as string[]) : [];
    if (cur.includes(opt)) return { ...prev, [x.id]: cur.filter((o) => o !== opt) };
    if (x.max != null && cur.length >= x.max) return prev;
    return { ...prev, [x.id]: [...cur, opt] };
  });

  const addRefText = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
    e.preventDefault();
    const t = refText.trim();
    if (!t) return;
    setRefs((prev) => (prev.some((r) => r.value === t) ? prev : [...prev, { label: t, value: t, file: false }]));
    setRefText("");
  };

  const addFiles = async (files: File[]) => {
    const slug = p.active;
    if (!slug) return;
    for (const f of files) {
      try {
        const buf = new Uint8Array(await f.arrayBuffer());
        let bin = "";
        for (const byte of buf) bin += String.fromCharCode(byte);
        const rel = await designRefAttach(dir, slug, f.name || "reference", btoa(bin));
        setRefs((prev) => [...prev, { label: f.name || rel.split("/").pop() || rel, value: rel, file: true }]);
      } catch (e) {
        toastError("Couldn't attach it", String(e).slice(0, 90));
      }
    }
  };

  const send = () => {
    if (!ready || sending) return;
    const out: Record<string, string | string[]> = {};
    for (const x of q.questions) if (has(picked[x.id])) out[x.id] = picked[x.id];
    setSending(true);
    answerQuestions(dir, out, refs.map((r) => r.value))
      .catch((e) => toastError("Couldn't send the answers", String(e).slice(0, 90)))
      .finally(() => setSending(false));
  };
  const skip = () => {
    if (sending) return;
    setSending(true);
    skipQuestions(dir)
      .catch((e) => toastError("Couldn't skip the questions", String(e).slice(0, 90)))
      .finally(() => setSending(false));
  };

  const n = q.questions.length;
  return (
    <form aria-label="Before I draw" onSubmit={(e) => { e.preventDefault(); send(); }}
      className="mx-3.5 mb-1.5 ml-[50px] mt-1 rounded-[10px] border border-border-strong bg-surface-card">
      <div className="flex items-center gap-2 px-3 py-2.5">
        <Eyebrow>Before I draw</Eyebrow>
        <span className="flex-1" />
        <span className="font-mono text-[10.5px] text-text-faint">{`${n} question${n === 1 ? "" : "s"} · ~20 s`}</span>
      </div>
      {q.questions.map((x) => {
        const a = answers[x.id];
        const hint = x.hint || (x.type === "multi" && x.max != null ? `pick up to ${x.max}` : "");
        return (
          <div key={x.id} role="group" aria-labelledby={`dq-${x.id}`} className="flex min-w-0 flex-col gap-[7px] border-t border-divider px-3 py-2.5">
            <div className="flex items-baseline gap-2">
              <span id={`dq-${x.id}`} className="text-[12.5px] font-medium text-text-primary">{x.label}</span>
              {hint && <span className="text-[11px] text-text-faint">{hint}</span>}
            </div>
            {x.type === "text" ? (
              done ? (
                <span className="text-[12.5px] text-text-secondary">{typeof a === "string" && a.trim() ? a : "No answer"}</span>
              ) : (
                <input type="text" aria-labelledby={`dq-${x.id}`} className={FIELD} value={typeof a === "string" ? a : ""}
                  onChange={(e) => setPicked((prev) => ({ ...prev, [x.id]: e.target.value }))} />
              )
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {x.options.map((opt) => {
                  const on = Array.isArray(a) ? a.includes(opt) : a === opt;
                  const cls = cn("inline-flex h-7 items-center rounded-lg border px-2.5 text-[12px]",
                    on ? "border-text-primary bg-fill-hover text-text-primary" : "border-border-hairline text-text-secondary");
                  return done ? (
                    on ? <span key={opt} className={cls}>{opt}</span> : null
                  ) : (
                    <button key={opt} type="button" aria-pressed={on} onClick={() => toggle(x, opt)}
                      className={cn(cls, "outline-none hover:bg-fill-hover hover:text-text-primary focus-visible:[box-shadow:var(--focus-ring)]")}>
                      {opt}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
      {q.references && (
        <div className="flex flex-col gap-[7px] border-t border-divider px-3 py-2.5">
          <label htmlFor="design-refs" className="text-[12.5px] font-medium text-text-primary">Anything to match or avoid?</label>
          {!done && (
            <div className="flex items-center gap-1.5">
              <input id="design-refs" type="text" className={cn(FIELD, "min-w-0 flex-1")} value={refText}
                placeholder="A site, a screenshot, or “not like …”"
                onChange={(e) => setRefText(e.target.value)} onKeyDown={addRefText} />
              <button type="button" aria-label="Attach a reference file" onClick={() => fileInput.current?.click()}
                className="flex size-[34px] shrink-0 items-center justify-center rounded-md text-text-faint outline-none hover:bg-fill-hover hover:text-text-secondary focus-visible:[box-shadow:var(--focus-ring)]">
                <PaperclipGlyph size={13} />
              </button>
              <input ref={fileInput} type="file" multiple hidden
                onChange={(e) => { void addFiles(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
            </div>
          )}
          {doneRefs.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {doneRefs.map((r) => (
                <span key={r.value} className={cn("inline-flex h-5 max-w-[200px] items-center gap-[5px] whitespace-nowrap rounded-md bg-fill-subtle px-[7px] text-text-subtle",
                  r.file ? "text-[11px]" : "font-mono text-[10.5px]")}>
                  {r.file && (isImage(r.label) ? <ImageGlyph size={11} dot={false} className="shrink-0" /> : <PaperclipGlyph size={11} className="shrink-0" />)}
                  <span className="truncate">{r.label}</span>
                  {!done && (
                    <button type="button" aria-label={`Remove ${r.label}`} onClick={() => setRefs((prev) => prev.filter((x) => x.value !== r.value))}
                      className="flex rounded-sm text-text-faint outline-none hover:text-text-secondary focus-visible:[box-shadow:var(--focus-ring)]">
                      <XGlyph size={8} />
                    </button>
                  )}
                </span>
              ))}
            </div>
          ) : done ? <span className="text-[12.5px] text-text-secondary">None</span> : null}
        </div>
      )}
      <div className="flex items-center gap-2 border-t border-divider px-3 py-2.5">
        {done ? (
          <span className="flex-1 text-[11px] text-text-faint">{q.skipped ? "Skipped" : "Answered"}</span>
        ) : (
          <>
            <span className="flex-1 text-[11px] text-text-faint">Skip and I’ll decide, and say what I assumed.</span>
            <BtnGhost size="sm" type="button" disabled={sending} onClick={skip}>Skip</BtnGhost>
            <BtnPrimary size="sm" type="submit" disabled={!ready || sending}>Send answers</BtnPrimary>
          </>
        )}
      </div>
    </form>
  );
}
