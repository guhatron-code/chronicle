/*
 * The footer: what links here, and what this note links to (mock frame 1's
 * footer). Two groups side by side, each a stack of the same tree rows the
 * sidebar and the explorer use — indented by nothing, with the context line in
 * the trailing slot.
 */
import { memo, type ReactNode } from "react";
import { DocGlyph } from "@/components/chrome/icons";
import { Eyebrow } from "@/components/chrome/atoms";
import { TreeRow } from "@/components/chrome/Tree";
import { backlinksFor, outlinksFor } from "@/lib/notes-model";
import type { NoteEntry } from "@/lib/ipc";

/* Memoised for the same reason Sidebar is: NotesPane re-renders on every
 * keystroke, but `notes`/`path` only change when the index or the open note
 * itself changes, and the callbacks are useCallback'd — so a body edit no
 * longer re-runs backlinksFor/outlinksFor or reconciles this footer. */
export const Backlinks = memo(function Backlinks({
  notes, path, onOpenNote, onCreateNote,
}: {
  notes: NoteEntry[];
  path: string;
  onOpenNote: (path: string) => void;
  onCreateNote: (target: string) => void;
}) {
  const backlinks = backlinksFor(notes, path);
  const outlinks = outlinksFor(notes, path);

  return (
    <div className="flex flex-none gap-7 border-t border-border-hairline px-4 py-2.5">
      <div className="min-w-0 flex-1">
        <Eyebrow className="mb-1.5 block">Linked from · {backlinks.length}</Eyebrow>
        <div className="flex flex-col text-[12.5px] text-text-secondary">
          {backlinks.map((b) => (
            <TreeRow
              key={b.path}
              name={b.title}
              marquee
              icon={<DocGlyph size={13} strokeWidth={1.2} className="shrink-0 text-text-subtle" />}
              trailing={<Secondary>{b.context}</Secondary>}
              onClick={() => onOpenNote(b.path)}
            />
          ))}
        </div>
      </div>
      <div className="min-w-0 flex-1">
        <Eyebrow className="mb-1.5 block">Links to · {outlinks.length}</Eyebrow>
        <div className="flex flex-col text-[12.5px] text-text-secondary">
          {outlinks.map((o, i) => {
            const missing = o.path === null;
            const note = missing ? "not created yet" : o.ambiguous ? "more than one note has this name" : undefined;
            const row = (
              <TreeRow
                name={o.label ?? o.target}
                marquee
                trailing={note ? <Secondary>{note}</Secondary> : undefined}
                onClick={missing ? () => onCreateNote(o.target) : () => onOpenNote(o.path!)}
              />
            );
            return missing ? <div key={`${o.target}-${i}`} className="opacity-55">{row}</div> : <div key={`${o.target}-${i}`}>{row}</div>;
          })}
        </div>
      </div>
    </div>
  );
});

/** The dim half of a link row — whatever is left after the name. */
function Secondary({ children }: { children: ReactNode }) {
  return <span data-selectable className="min-w-0 shrink truncate text-[11px] text-text-dim">{children}</span>;
}
