/*
 * F5 — the ⌘K command palette / project switcher. shadcn Command in a dialog overlay.
 * Groups: "Open — switch instantly" (⌘1–9) · "Recent — open" · actions. State dot is
 * always paired with a word. Footer: ↵ open · esc close.
 */
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Kbd, MarkTile, StateWord, type StateKind, type MarkIndex } from "@/components/chrome/atoms";
import { FolderGlyph, PlusGlyph } from "@/components/chrome/icons";

export type PaletteProject = {
  path: string;
  name: string;
  tildePath: string;
  mark: MarkIndex;
  markLabel: string;
  statusWord: string;
  statusKind: StateKind;
};

export function CommandPalette({
  open,
  onOpenChange,
  openProjects,
  recents,
  onSwitch,
  onOpenRecent,
  onOpenDialog,
  onNewProject,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  openProjects: PaletteProject[];
  recents: PaletteProject[];
  onSwitch: (path: string) => void;
  onOpenRecent: (path: string) => void;
  onOpenDialog: () => void;
  onNewProject: () => void;
}) {
  const row = (p: PaletteProject, kbd?: string) => (
    <>
      <MarkTile mark={p.mark} label={p.markLabel} size={22} />
      <span className="text-[13px] font-medium text-text-primary">{p.name}</span>
      <span className="font-mono text-[11px] text-text-dim">{p.tildePath}</span>
      <span className="flex-1" />
      <StateWord kind={p.statusKind} dotSize={5} glyphSize={10} className="text-[11.5px]">
        {p.statusWord}
      </StateWord>
      {kbd && <Kbd>{kbd}</Kbd>}
    </>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="top-14 max-w-[560px] translate-y-0 gap-0 overflow-hidden rounded-xl border-border-strong bg-surface-overlay p-0 [box-shadow:var(--shadow-overlay)] sm:max-w-[560px]"
      >
        <DialogTitle className="sr-only">Project switcher</DialogTitle>
        <Command
          filter={(value, search) => {
            // substring matching only: cmdk's default scatter-fuzz let a weak
            // match in the first group outrank an exact name in the second
            // (groups never re-sort), sending Enter to the wrong project
            const v = value.toLowerCase();
            const q = search.toLowerCase().trim();
            if (!q) return 1;
            if (v.includes(q)) return 1;
            const tokens = q.split(/\s+/);
            return tokens.length > 1 && tokens.every((t) => v.includes(t)) ? 0.5 : 0;
          }}
          className="bg-transparent **:data-[slot=command-input-wrapper]:h-auto **:data-[slot=command-input-wrapper]:gap-[9px] **:data-[slot=command-input-wrapper]:border-divider **:data-[slot=command-input-wrapper]:px-3.5 **:data-[slot=command-input-wrapper]:py-0 **:data-[slot=command-input-wrapper]:text-text-dim [&_[data-slot=command-input-wrapper]_svg]:size-3.5 [&_[data-slot=command-input-wrapper]_svg]:stroke-[1.5] [&_[data-slot=command-input-wrapper]_svg]:opacity-100">
          <CommandInput
            placeholder="Search projects…"
            className="h-11 text-[13px] text-text-primary placeholder:text-text-dim"
          />
          <CommandList className="p-2">
            <CommandEmpty className="px-3.5 py-[18px] text-center text-[12.5px] text-text-subtle">
              No matches. Try a project name or a folder.
            </CommandEmpty>

            {openProjects.length > 0 && (
              <CommandGroup
                heading="Open — switch instantly"
                className="**:[[cmdk-group-heading]]:px-2.5 **:[[cmdk-group-heading]]:pb-[5px] **:[[cmdk-group-heading]]:pt-2 **:[[cmdk-group-heading]]:text-[10px] **:[[cmdk-group-heading]]:uppercase **:[[cmdk-group-heading]]:tracking-[0.09em] **:[[cmdk-group-heading]]:text-text-dimmer"
              >
                {openProjects.map((p, i) => (
                  <CommandItem
                    key={p.path}
                    value={`open ${p.name} ${p.tildePath}`}
                    onSelect={() => onSwitch(p.path)}
                    className="gap-2.5 rounded-md px-2.5 py-2 data-[selected=true]:bg-fill-hover"
                  >
                    {row(p, i < 9 ? `⌘${i + 1}` : undefined)}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {recents.length > 0 && (
              <CommandGroup
                heading="Recent — open"
                className="**:[[cmdk-group-heading]]:px-2.5 **:[[cmdk-group-heading]]:pb-[5px] **:[[cmdk-group-heading]]:pt-2.5 **:[[cmdk-group-heading]]:text-[10px] **:[[cmdk-group-heading]]:uppercase **:[[cmdk-group-heading]]:tracking-[0.09em] **:[[cmdk-group-heading]]:text-text-dimmer"
              >
                {recents.map((p) => (
                  <CommandItem
                    key={p.path}
                    value={`recent ${p.name} ${p.tildePath}`}
                    onSelect={() => onOpenRecent(p.path)}
                    className="gap-2.5 rounded-md px-2.5 py-2 data-[selected=true]:bg-fill-hover"
                  >
                    {row(p)}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            <CommandSeparator className="mx-1 my-2 bg-divider" />

            <CommandGroup>
              <CommandItem
                value="open a project"
                onSelect={onOpenDialog}
                className="gap-2.5 rounded-md px-2.5 py-2 text-text-secondary data-[selected=true]:bg-fill-hover"
              >
                <FolderGlyph />
                <span className="text-[13px]">Open a project…</span>
                <span className="flex-1" />
                <Kbd>⌘O</Kbd>
              </CommandItem>
              <CommandItem
                value="new blank project"
                onSelect={onNewProject}
                className="gap-2.5 rounded-md px-2.5 py-2 text-text-secondary data-[selected=true]:bg-fill-hover"
              >
                <PlusGlyph />
                <span className="text-[13px]">New blank project…</span>
              </CommandItem>
            </CommandGroup>
          </CommandList>

          <div className="flex items-center gap-3 border-t border-divider px-3.5 py-[9px] text-[11.5px] text-text-dim">
            <span className="inline-flex items-center gap-[5px]">
              <Kbd className="text-text-dim">↵</Kbd>Open
            </span>
            <span className="inline-flex items-center gap-[5px]">
              <Kbd className="text-text-dim">esc</Kbd>Close
            </span>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
