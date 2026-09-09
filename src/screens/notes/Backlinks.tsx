/*
 * The footer: what links here, and what this note links to (mock frame 1's
 * footer). Two groups side by side, each a stack of `Row`.
 */
import { DocGlyph } from "@/components/chrome/icons";
import { Eyebrow } from "@/components/chrome/atoms";
import { backlinksFor, outlinksFor } from "@/lib/notes-model";
import type { NoteEntry } from "@/lib/ipc";
import { Row } from "./Row";

export function Backlinks({
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
        <div className="flex flex-col">
          {backlinks.map((b) => (
            <Row
              key={b.path}
              name={b.title}
              secondary={b.context}
              icon={<DocGlyph size={12} className="shrink-0 text-text-dim" />}
              onClick={() => onOpenNote(b.path)}
            />
          ))}
        </div>
      </div>
      <div className="min-w-0 flex-1">
        <Eyebrow className="mb-1.5 block">Links to · {outlinks.length}</Eyebrow>
        <div className="flex flex-col">
          {outlinks.map((o, i) => {
            const missing = o.path === null;
            const row = (
              <Row
                name={o.label ?? o.target}
                secondary={missing ? "not created yet" : o.ambiguous ? "more than one note has this name" : undefined}
                onClick={missing ? () => onCreateNote(o.target) : () => onOpenNote(o.path!)}
              />
            );
            return missing ? <div key={`${o.target}-${i}`} className="opacity-55">{row}</div> : <div key={`${o.target}-${i}`}>{row}</div>;
          })}
        </div>
      </div>
    </div>
  );
}
