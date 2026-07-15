/*
 * ⌘⇧F — global search (F6). One ranked sweep across file names, save subjects,
 * plan documents (backend, jailed) and kanban tasks (client store). Same
 * anatomy as the palette; results are pre-filtered so cmdk doesn't re-filter.
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
import { FolderGlyph, SearchGlyph } from "@/components/chrome/icons";
import { globalSearch, type SearchResults } from "@/lib/ipc";
import { kanbanFor } from "@/lib/kanban-store";

const GROUP_HEAD =
  "**:[[cmdk-group-heading]]:px-2.5 **:[[cmdk-group-heading]]:pb-[5px] **:[[cmdk-group-heading]]:pt-2.5 **:[[cmdk-group-heading]]:text-[10px] **:[[cmdk-group-heading]]:uppercase **:[[cmdk-group-heading]]:tracking-[0.09em] **:[[cmdk-group-heading]]:text-text-dimmer";
const ITEM = "gap-2.5 rounded-md px-2.5 py-2 data-[selected=true]:bg-fill-hover";

export function SearchOverlay({
  open,
  onOpenChange,
  dir,
  onOpenFile,
  onOpenHistory,
  onOpenTask,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dir: string | null;
  onOpenFile: (path: string) => void;
  onOpenHistory: () => void;
  onOpenTask: (id: string) => void;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResults>({ files: [], commits: [], docs: [] });
  const seq = useRef(0);

  useEffect(() => {
    if (!open) { setQ(""); setResults({ files: [], commits: [], docs: [] }); return; }
  }, [open]);

  useEffect(() => {
    if (!dir || q.trim().length < 2) { setResults({ files: [], commits: [], docs: [] }); return; }
    const my = ++seq.current;
    const t = setTimeout(() => {
      globalSearch(dir, q)
        .then((r) => { if (seq.current === my) setResults(r); })
        .catch(() => {});
    }, 220);
    return () => clearTimeout(t);
  }, [dir, q]);

  const needle = q.trim().toLowerCase();
  const tasks = !dir || needle.length < 2
    ? []
    : kanbanFor(dir).tasks
        .filter((t) => !t.archived)
        .filter((t) =>
          t.title.toLowerCase().includes(needle) ||
          (t.content ?? "").toLowerCase().includes(needle) ||
          t.id.toLowerCase() === needle)
        .slice(0, 8);

  const go = (fn: () => void) => { onOpenChange(false); fn(); };
  const empty = needle.length >= 2 && results.files.length === 0 &&
    results.commits.length === 0 && results.docs.length === 0 && tasks.length === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
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
            placeholder="Search files, saves, documents, tasks…"
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

            {results.files.length > 0 && (
              <CommandGroup heading="Files" className={GROUP_HEAD}>
                {results.files.map((f) => (
                  <CommandItem key={`f-${f}`} value={`f-${f}`} onSelect={() => go(() => onOpenFile(f))} className={ITEM}>
                    <FolderGlyph size={13} className="shrink-0 text-text-dim" />
                    <span className="min-w-0 truncate font-mono text-[12px] text-text-primary">{f}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {results.commits.length > 0 && (
              <CommandGroup heading="Saves" className={GROUP_HEAD}>
                {results.commits.map((c) => (
                  <CommandItem key={`c-${c.hash}`} value={`c-${c.hash}`} onSelect={() => go(onOpenHistory)} className={ITEM}>
                    <span className="shrink-0 rounded-[5px] bg-fill-subtle px-[5px] font-mono text-[10.5px] text-text-subtle">{c.hash}</span>
                    <span className="min-w-0 truncate text-[12.5px] text-text-primary">{c.subject}</span>
                    <span className="flex-1" />
                    <span className="shrink-0 font-mono text-[10.5px] text-text-dim">{c.ago}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {results.docs.length > 0 && (
              <CommandGroup heading="Plan documents" className={GROUP_HEAD}>
                {results.docs.map((d) => (
                  <CommandItem key={`d-${d.path}`} value={`d-${d.path}`} onSelect={() => go(() => onOpenFile(d.path))} className={ITEM}>
                    <SearchGlyph size={12} className="shrink-0 text-text-dim" />
                    <span className="shrink-0 font-mono text-[11px] text-text-secondary">{d.path}</span>
                    <span className="min-w-0 truncate text-[12px] text-text-dim">{d.line}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {tasks.length > 0 && (
              <CommandGroup heading="Kanban tasks" className={GROUP_HEAD}>
                {tasks.map((t) => (
                  <CommandItem key={`t-${t.id}`} value={`t-${t.id}`} onSelect={() => go(() => onOpenTask(t.id))} className={ITEM}>
                    <span className="shrink-0 rounded-[5px] bg-fill-subtle px-[5px] font-mono text-[10.5px] text-text-subtle">{t.id}</span>
                    <span className="min-w-0 truncate text-[12.5px] text-text-primary">{t.title}</span>
                    <span className="flex-1" />
                    <span className="shrink-0 text-[10.5px] text-text-dim">{t.column.replace("_", " ")}</span>
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
