/*
 * ⌘⇧F — global search (F6). One ranked sweep across file names, save subjects,
 * plan documents and notes (all backend, jailed). Same anatomy as the palette;
 * results are pre-filtered so cmdk doesn't re-filter.
 *
 * ⌘P opens the same overlay with `scope="notes"`: only the Notes group shows,
 * and the repo sweep is skipped entirely rather than walked and hidden.
 */
import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Kbd } from "@/components/chrome/atoms";
import { FolderGlyph, NotesGlyph, SearchGlyph } from "@/components/chrome/icons";
import { globalSearch, notesSearch, type NoteSearchHit, type SearchResults } from "@/lib/ipc";

const GROUP_HEAD =
  "**:[[cmdk-group-heading]]:px-2.5 **:[[cmdk-group-heading]]:pb-[5px] **:[[cmdk-group-heading]]:pt-2.5 **:[[cmdk-group-heading]]:text-[10px] **:[[cmdk-group-heading]]:uppercase **:[[cmdk-group-heading]]:tracking-[0.09em] **:[[cmdk-group-heading]]:text-text-dimmer";
const ITEM = "gap-2.5 rounded-md px-2.5 py-2 data-[selected=true]:bg-fill-hover";

/** `Tasks/Archive/Note.md` → `Tasks/Archive`; a note at the root says "vault". */
const folderOf = (path: string) => path.split("/").slice(0, -1).join("/") || "vault";

export function SearchOverlay({
  open,
  onOpenChange,
  dir,
  scope = "all",
  onOpenFile,
  onOpenHistory,
  onOpenNote,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dir: string | null;
  /** ⌘P narrows the overlay to the vault; ⌘⇧F sweeps everything. */
  scope?: "all" | "notes";
  onOpenFile: (path: string) => void;
  onOpenHistory: () => void;
  onOpenNote: (path: string) => void;
}) {
  const repo = scope === "all";
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResults>({ files: [], commits: [], docs: [] });
  const [notes, setNotes] = useState<NoteSearchHit[]>([]);
  const seqRepo = useRef(0);
  const seqNotes = useRef(0);

  useEffect(() => {
    if (!open) { setQ(""); setResults({ files: [], commits: [], docs: [] }); setNotes([]); return; }
  }, [open]);

  useEffect(() => {
    // bump the guard before bailing out too: closing the overlay clears `q`,
    // and a request already in flight must not land its answer in the empty
    // state and be there waiting when the overlay reopens
    if (!dir || !repo || q.trim().length < 2) { seqRepo.current += 1; setResults({ files: [], commits: [], docs: [] }); return; }
    const my = ++seqRepo.current;
    const t = setTimeout(() => {
      globalSearch(dir, q)
        .then((r) => { if (seqRepo.current === my) setResults(r); })
        .catch(() => {});
    }, 220);
    return () => clearTimeout(t);
  }, [dir, q, repo]);

  useEffect(() => {
    if (!dir || q.trim().length < 2) { seqNotes.current += 1; setNotes([]); return; }
    // no debounce timer of its own: notes_search is an in-memory index scan
    // plus at most one read per body hit, and the sequence guard already
    // discards the answers to keystrokes the user has moved past
    const my = ++seqNotes.current;
    notesSearch(dir, q).then((r) => { if (seqNotes.current === my) setNotes(r.slice(0, 8)); }).catch(() => {});
  }, [dir, q]);

  const needle = q.trim().toLowerCase();

  const go = (fn: () => void) => { onOpenChange(false); fn(); };
  const empty = needle.length >= 2 && notes.length === 0 &&
    (!repo || (results.files.length === 0 && results.commits.length === 0 && results.docs.length === 0));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-chrome
        showCloseButton={false}
        className="max-w-[600px] gap-0 overflow-hidden rounded-xl border-border-strong bg-surface-overlay p-0 [box-shadow:var(--shadow-overlay)] sm:max-w-[600px]"
      >
        <DialogTitle className="sr-only">Search this project</DialogTitle>
        <Command
          shouldFilter={false}
          className="bg-transparent **:data-[slot=command-input-wrapper]:h-auto **:data-[slot=command-input-wrapper]:gap-[9px] **:data-[slot=command-input-wrapper]:border-divider **:data-[slot=command-input-wrapper]:px-3.5 **:data-[slot=command-input-wrapper]:py-0 **:data-[slot=command-input-wrapper]:text-text-dim [&_[data-slot=command-input-wrapper]_svg]:size-3.5 [&_[data-slot=command-input-wrapper]_svg]:stroke-[1.5] [&_[data-slot=command-input-wrapper]_svg]:opacity-100"
        >
          <CommandInput
            value={q}
            onValueChange={setQ}
            placeholder={repo ? "Search files, saves, documents, notes…" : "Search notes…"}
            className="h-11 text-[13px] text-text-primary placeholder:text-text-dim"
          />
          <CommandList className="max-h-[420px] p-2">
            {needle.length < 2 && (
              <div className="px-3.5 py-[18px] text-center text-[12.5px] text-text-subtle">
                Type at least two characters.
              </div>
            )}
            {empty && (
              <CommandEmpty className="px-3.5 py-[18px] text-center text-[12.5px] text-text-subtle">
                Nothing matches in this project.
              </CommandEmpty>
            )}

            {repo && needle.length >= 2 && results.files.length > 0 && (
              <CommandGroup heading="Files" className={GROUP_HEAD}>
                {results.files.map((f) => (
                  <CommandItem key={`f-${f}`} value={`f-${f}`} onSelect={() => go(() => onOpenFile(f))} className={ITEM}>
                    <FolderGlyph size={13} className="shrink-0 text-text-dim" />
                    <span data-selectable className="min-w-0 truncate font-mono text-[12px] text-text-primary">{f}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {repo && needle.length >= 2 && results.commits.length > 0 && (
              <CommandGroup heading="Saves" className={GROUP_HEAD}>
                {results.commits.map((c) => (
                  <CommandItem key={`c-${c.hash}`} value={`c-${c.hash}`} onSelect={() => go(onOpenHistory)} className={ITEM}>
                    <span className="shrink-0 rounded-[5px] bg-fill-subtle px-[5px] font-mono text-[10.5px] text-text-subtle">{c.hash}</span>
                    <span data-selectable className="min-w-0 truncate text-[12.5px] text-text-primary">{c.subject}</span>
                    <span className="flex-1" />
                    <span className="shrink-0 font-mono text-[10.5px] text-text-dim">{c.ago}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {repo && needle.length >= 2 && results.docs.length > 0 && (
              <CommandGroup heading="Plan documents" className={GROUP_HEAD}>
                {results.docs.map((d) => (
                  <CommandItem key={`d-${d.path}`} value={`d-${d.path}`} onSelect={() => go(() => onOpenFile(d.path))} className={ITEM}>
                    <SearchGlyph size={12} className="shrink-0 text-text-dim" />
                    <span data-selectable className="shrink-0 font-mono text-[11px] text-text-secondary">{d.path}</span>
                    <span data-selectable className="min-w-0 truncate text-[12px] text-text-dim">{d.line}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {needle.length >= 2 && notes.length > 0 && (
              <CommandGroup heading="Notes" className={GROUP_HEAD}>
                {notes.map((n) => (
                  <CommandItem key={`n-${n.path}`} value={`n-${n.path}`} onSelect={() => go(() => onOpenNote(n.path))} className={ITEM}>
                    <NotesGlyph size={13} className="shrink-0 text-text-dim" />
                    <span data-selectable className="min-w-0 truncate text-[12.5px] text-text-primary">{n.title}</span>
                    <span className="flex-1" />
                    <span className="shrink-0 truncate text-[10.5px] text-text-dim">{folderOf(n.path)}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
          <div className="flex items-center gap-3 border-t border-divider px-3.5 py-2 text-[10.5px] text-text-dimmer">
            <span className="inline-flex items-center gap-1"><Kbd>↵</Kbd> open</span>
            <span className="inline-flex items-center gap-1"><Kbd>esc</Kbd> close</span>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
