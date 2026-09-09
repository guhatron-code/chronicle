/*
 * The vault pane: sidebar, header, the editor, backlinks. Everything here is
 * a thin view over notes-store's cache — the store, not this component, is
 * what survives a pane switch.
 *
 * Task 7's wikiLink node is store-free (nodes.ts imports nothing from the
 * store), so it cannot know whether `[[Target]]` resolves. This pane stamps
 * that after every render: a plain DOM walk over the rendered `.wikilink`
 * spans, driven by the same entry.links/entry.resolved arrays the editor's
 * own click handler already reads (same resolution rule: first link whose
 * raw text matches). `[data-missing="true"]` is already styled dashed
 * (src/index.css, added with the node).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NoteEditor } from "./editor/NoteEditor";
import { Sidebar } from "./Sidebar";
import { NoteHeader } from "./NoteHeader";
import { Backlinks } from "./Backlinks";
import { RoundFlow, type RoundFlowHandle } from "./RoundFlow";
import { RoundLog } from "./RoundLog";
import { BtnPrimary } from "@/components/chrome/atoms";
import { runCommand, type NoteEntry } from "@/lib/ipc";
import {
  createNote, editBody, flushSave, hasLiveRound, indexFor, noteEntry, openFor, openNote,
  queuedCountFor, roundKindFor, roundNotesFor, roundPhase, roundRoute, setNotesOnScreen,
  subscribeNotes, takePendingOpenNote,
} from "@/lib/notes-store";
import { armRoundWatch, subscribeRoundSession } from "@/lib/round-log";
import type { RoundCardData } from "./RoundCard";
import { toastError } from "@/overlays/toasts";
import type { ConfirmSpec } from "@/overlays/ConfirmDialog";

const OPEN_KEY = (dir: string) => `chronicle.notes.open.${dir}`;
/* beside the tree's collapsed state, and remembered the same way */
const LOG_KEY = (dir: string) => `chronicle.notes.log.${dir}`;
function loadLogOpen(dir: string): boolean {
  try { return localStorage.getItem(LOG_KEY(dir)) === "1"; } catch { return false; }
}

/** Same resolution rule NoteEditor's handleClickOn uses: the first link in
 *  this note whose raw target text matches the span. */
function markMissingLinks(container: HTMLElement, notes: NoteEntry[], path: string): void {
  const entry = notes.find((n) => n.path === path);
  const spans = container.querySelectorAll<HTMLElement>(".wikilink[data-wikilink]");
  spans.forEach((el) => {
    const target = el.getAttribute("data-wikilink") ?? "";
    const i = entry?.links.findIndex((l) => l.target === target) ?? -1;
    const resolved = i >= 0 ? (entry?.resolved[i] ?? null) : null;
    if (resolved) el.removeAttribute("data-missing");
    else el.setAttribute("data-missing", "true");
  });
}

export function NotesPane({
  dir, agent, onScreen, onConfirm, onGoRoadmap, onOpenSearch, onOpenFile, onOpenUrl,
  onRunRoundInPane, onRevealTerminal,
}: {
  dir: string;
  agent: "claude" | "codex";
  onScreen: boolean;
  onConfirm: (spec: ConfirmSpec) => void;
  onGoRoadmap: () => void;
  /** the sidebar's search button — App opens the overlay scoped to the vault */
  onOpenSearch: () => void;
  onOpenFile: (path: string) => void;
  onOpenUrl: (url: string) => void;
  onRunRoundInPane?: (n: number, total: number) => void;
  /** "Open full log" tails the real file in a terminal tab — show the column */
  onRevealTerminal?: () => void;
}) {
  const [, bump] = useState(0);
  useEffect(() => subscribeNotes(() => bump((n) => n + 1)), []);
  // a session starting or stopping is a phase change, so the card and the log
  // header both move — it fires on that, never on a log line
  useEffect(() => subscribeRoundSession(() => bump((n) => n + 1)), []);
  useEffect(() => { setNotesOnScreen(onScreen ? dir : null); return () => setNotesOnScreen(null); }, [dir, onScreen]);

  /* the search overlay / palette land here */
  useEffect(() => {
    const p = takePendingOpenNote();
    if (p) void openNote(dir, p);
  });

  /* restore the last open note once per dir; skip if something is already open
     (a pane hide/show keeps the store's note alive) */
  const restoredFor = useRef<string | null>(null);
  useEffect(() => {
    if (restoredFor.current === dir) return;
    restoredFor.current = dir;
    if (openFor(dir)) return;
    let saved: string | null = null;
    try { saved = localStorage.getItem(OPEN_KEY(dir)); } catch { /* private mode */ }
    if (saved) void openNote(dir, saved);
  }, [dir]);

  /* flush on unmount (pane switch); blur/beforeunload/visibility are handled
     once at notes-store's module scope */
  useEffect(() => () => { void flushSave(dir); }, [dir]);

  const index = indexFor(dir);
  const open = openFor(dir);

  /* remember the open note across restarts, whoever opened it */
  useEffect(() => {
    if (!open?.path) return;
    try { localStorage.setItem(OPEN_KEY(dir), open.path); } catch { /* private mode */ }
  }, [dir, open?.path]);

  const entry = open ? noteEntry(dir, open.path) : undefined;
  const queued = queuedCountFor(dir);
  /* `index` (indexFor's cache object) keeps its reference across a body edit —
     refreshNotes is the only thing that replaces it — so memoising on it means
     Sidebar's `roundOpen` prop stays referentially stable while the user types,
     and only actually changes when the index itself does. */
  /* The one answer to "what is this round doing?" — the record cannot tell a
     written plan from a running one, so the live session decides. The card and
     the log panel both read this, so they can never disagree again. */
  const live = hasLiveRound(dir);
  useEffect(() => {
    armRoundWatch(dir, onScreen && live);
    return () => armRoundWatch(dir, false);
  }, [dir, onScreen, live]);

  const ph = roundPhase(dir);
  const phase = ph?.phase ?? null;
  const roundN = ph?.n ?? null;
  const route = roundRoute(dir);
  const roundNotes = useMemo(
    () => (roundN == null ? [] : roundNotesFor(dir, roundN)),
    [dir, index, roundN],
  );
  const round = useMemo<RoundCardData | null>(
    () => (phase == null || roundN == null ? null : {
      phase, n: roundN, kind: roundKindFor(dir, roundN), notes: roundNotes,
      done: roundNotes.filter((x) => x.status === "done").length, route,
    }),
    [dir, phase, roundN, roundNotes, route],
  );
  const [logOpen, setLogOpen] = useState(() => loadLogOpen(dir));
  useEffect(() => setLogOpen(loadLogOpen(dir)), [dir]);
  const toggleLog = useCallback(() => {
    setLogOpen((o) => {
      try { localStorage.setItem(LOG_KEY(dir), o ? "0" : "1"); } catch { /* private mode */ }
      return !o;
    });
  }, [dir]);
  const closeLog = useCallback(() => {
    setLogOpen(false);
    try { localStorage.setItem(LOG_KEY(dir), "0"); } catch { /* private mode */ }
  }, [dir]);
  const showLog = logOpen && round !== null;

  const openNoteHere = useCallback((path: string) => { void openNote(dir, path); }, [dir]);
  const newNoteIn = useCallback((folder: string) => {
    createNote(dir, folder, "Untitled").catch((e) => toastError("Couldn't create the note", String(e).slice(0, 90)));
  }, [dir]);
  const createMissing = useCallback((title: string) => {
    const folder = entry?.folder ?? "";
    createNote(dir, folder, title.split("/").pop() ?? title).catch((e) => toastError("Couldn't create the note", String(e).slice(0, 90)));
  }, [dir, entry?.folder]);
  const onRevealVault = useCallback(() => {
    runCommand(dir, 'open ".chronicle/notes"').catch((e) => toastError("Couldn't reveal it", String(e).slice(0, 90)));
  }, [dir]);

  /* App re-renders on every keystroke, so an inline prop would give RoundLog a
     new callback identity each time and defeat its memo — the ref keeps it stable */
  const revealRef = useRef(onRevealTerminal);
  revealRef.current = onRevealTerminal;
  const revealTerminal = useCallback(() => revealRef.current?.(), []);

  const roundFlowRef = useRef<RoundFlowHandle>(null);
  const onStartRound = useCallback(() => roundFlowRef.current?.start(), []);

  /* stamp data-missing on every rendered wikilink after each commit */
  const docRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (docRef.current && open) markMissingLinks(docRef.current, index.notes, open.path);
  });

  const docClasses = useMemo(
    () =>
      [
        "note-doc mx-auto max-w-[820px] px-16 pb-16 pt-8 focus:outline-none",
        "[&_h1]:mb-1.5 [&_h1]:text-[26px] [&_h1]:font-semibold [&_h1]:tracking-[-0.02em] [&_h1]:text-text-primary",
        "[&_h2]:mb-2 [&_h2]:mt-5 [&_h2]:text-[17px] [&_h2]:font-semibold [&_h2]:tracking-[-0.01em] [&_h2]:text-text-primary",
        "[&_h3]:mb-1.5 [&_h3]:mt-4 [&_h3]:text-[14px] [&_h3]:font-semibold [&_h3]:text-text-primary",
        "[&_p]:mb-3.5 [&_p]:text-[14px] [&_p]:leading-[1.62] [&_p]:text-text-secondary",
        "[&_ul]:mb-3.5 [&_ul]:ml-5 [&_ul]:list-disc [&_ul]:text-[14px] [&_ul]:leading-[1.62] [&_ul]:text-text-secondary",
        "[&_ol]:mb-3.5 [&_ol]:ml-5 [&_ol]:list-decimal [&_ol]:text-[14px] [&_ol]:leading-[1.62] [&_ol]:text-text-secondary",
        "[&_li]:mb-0.5",
        "[&_code]:rounded [&_code]:border [&_code]:border-border-hairline [&_code]:bg-fill-subtle [&_code]:px-[5px] [&_code]:py-px [&_code]:font-mono [&_code]:text-[12.5px] [&_code]:text-text-primary",
        "[&_pre]:mb-3.5 [&_pre]:overflow-x-auto [&_pre]:rounded-[7px] [&_pre]:border [&_pre]:border-border-hairline [&_pre]:bg-surface-card [&_pre]:p-3.5 [&_pre]:font-mono [&_pre]:text-[12px] [&_pre]:leading-[1.55] [&_pre]:text-text-secondary",
        "[&_pre_code]:border-0 [&_pre_code]:bg-transparent [&_pre_code]:p-0",
        "[&_img]:mb-3.5 [&_img]:max-w-full [&_img]:rounded-md [&_img]:border [&_img]:border-border-hairline",
        "[&_blockquote]:mb-3.5 [&_blockquote]:border-l-2 [&_blockquote]:border-border-strong [&_blockquote]:pl-3 [&_blockquote]:text-text-dim",
        "[&_hr]:my-4 [&_hr]:border-border-hairline",
      ].join(" "),
    [],
  );

  return (
    <div className="flex h-full min-h-0">
      <Sidebar
        dir={dir}
        notes={index.notes}
        openPath={open?.path ?? null}
        onOpenNote={openNoteHere}
        onNewNote={newNoteIn}
        onOpenSearch={onOpenSearch}
        onRevealVault={onRevealVault}
        queued={queued}
        round={round}
        agent={agent}
        onStartRound={onStartRound}
        onRunRoundInPane={onRunRoundInPane}
        logOpen={logOpen}
        onToggleLog={toggleLog}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        {index.notes.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3">
            <div className="text-[13px] text-text-dim">No notes yet</div>
            <BtnPrimary size="md" onClick={() => newNoteIn("")}>New note</BtnPrimary>
          </div>
        ) : !open ? (
          <div className="flex flex-1 items-center justify-center text-[13px] text-text-dim">
            Select a note
          </div>
        ) : (
          <>
            <NoteHeader
              dir={dir}
              path={open.path}
              entry={entry}
              open={open}
              notes={index.notes}
              onConfirm={onConfirm}
            />
            {entry?.unreadable && (
              <div className="border-b border-border-hairline bg-fill-subtle px-4 py-2 text-[12px] text-text-dim">
                This file couldn't be read — it opens read-only.
              </div>
            )}
            <div ref={docRef} className="min-h-0 flex-1 overflow-y-auto">
              <div className={docClasses}>
                <NoteEditor
                  key={open.path}
                  dir={dir}
                  path={open.path}
                  body={open.body}
                  readOnly={entry?.unreadable ?? false}
                  notes={index.notes}
                  onChange={(body) => editBody(dir, body)}
                  onBlur={() => void flushSave(dir)}
                  onOpenNote={openNoteHere}
                  onCreateNote={(title: string, folder: string) => createNote(dir, folder, title.split("/").pop() ?? title)}
                  onOpenFile={onOpenFile}
                  onOpenUrl={onOpenUrl}
                />
              </div>
            </div>
            {!showLog && (
              <Backlinks notes={index.notes} path={open.path} onOpenNote={openNoteHere} onCreateNote={createMissing} />
            )}
          </>
        )}
        {showLog && round && (
          <RoundLog
            dir={dir}
            phase={round.phase}
            n={round.n}
            done={round.done}
            total={round.notes.length}
            onClose={closeLog}
            onRevealTerminal={revealTerminal}
          />
        )}
      </div>

      <RoundFlow ref={roundFlowRef} dir={dir} agent={agent} onRunInPane={onRunRoundInPane} onGoRoadmap={onGoRoadmap} />
    </div>
  );
}
