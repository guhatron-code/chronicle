/*
 * The composer's `@` menu — everything in a project worth pointing an agent at.
 *
 * Four sources: repo files, this session's attachments, notes from the vault,
 * and roadmap phases. Files and notes are referenced by path, because the agent
 * can read those itself and a big one costs nothing until it does — a note's
 * text is fetched at send time, never held in the menu. A roadmap phase has no
 * file to read, so its text is inlined at send time.
 *
 * A mention survives in the textarea as plain text plus an entry in a lookup
 * table. Edit the text so it no longer matches and it silently becomes what it
 * looks like — ordinary prose. No chip ever claims something isn't attached.
 */
import { fileIndex, notesRead, readFile } from "./ipc";
import { indexFor } from "./notes-store";

export type MentionKind = "file" | "attachment" | "note" | "phase";

export interface Mention {
  kind: MentionKind;
  /** the mention's identity — unique across the menu, and the key of the
   *  lookup table. Namespaced by kind, as the picker's row id always was; for
   *  a note it names the vault PATH, because two notes in different folders can
   *  share a title (and so share a `token`). */
  key: string;
  /** the text inserted into the composer, without the leading @ */
  token: string;
  /** menu label */
  label: string;
  /** menu right-hand text */
  detail?: string;
  /** set for phase — inlined into the message at send time */
  body?: string;
  /** set for note — the vault path its text is read from at send time */
  path?: string;
}

/* ---------- the file index (cached per project) ---------- */

const fileCache = new Map<string, string[]>();
const inflight = new Map<string, Promise<string[]>>();

export function cachedFiles(dir: string): string[] {
  return fileCache.get(dir) ?? [];
}

/** Load the index once per project; callers re-render when it lands. */
export function ensureFileIndex(dir: string, onReady: () => void): void {
  if (fileCache.has(dir) || inflight.has(dir)) return;
  const p = fileIndex(dir)
    .then((files) => {
      fileCache.set(dir, files);
      return files;
    })
    .catch(() => {
      fileCache.set(dir, []); // a failed index is empty, never a retry storm
      return [];
    })
    .finally(() => {
      inflight.delete(dir);
      onReady();
    });
  inflight.set(dir, p);
}

export function evictFileIndex(dir: string): void {
  fileCache.delete(dir);
}

/* ---------- roadmap phases, read straight off chronicle.json ---------- */

const phaseCache = new Map<string, Mention[]>();

export function cachedPhases(dir: string): Mention[] {
  return phaseCache.get(dir) ?? [];
}

export function ensurePhases(dir: string, onReady: () => void): void {
  if (phaseCache.has(dir)) return;
  phaseCache.set(dir, []); // claim the slot so this runs once
  void readFile(dir, "chronicle.json")
    .then((raw) => {
      const parsed = JSON.parse(raw) as {
        stages?: { phases?: { id?: string; name?: string; desc?: string; items?: string[] }[] }[];
      };
      const out: Mention[] = [];
      for (const stage of parsed.stages ?? []) {
        for (const ph of stage.phases ?? []) {
          if (!ph.id) continue;
          const items = (ph.items ?? []).map((i) => `- ${i}`).join("\n");
          out.push({
            kind: "phase",
            key: `phase:${ph.id}`,
            token: ph.id,
            label: ph.id,
            detail: ph.name,
            body: [`Phase ${ph.id}${ph.name ? ` — ${ph.name}` : ""}`, ph.desc, items]
              .filter(Boolean)
              .join("\n"),
          });
        }
      }
      phaseCache.set(dir, out);
    })
    .catch(() => phaseCache.set(dir, []))
    .finally(onReady);
}

export function evictPhases(dir: string): void {
  phaseCache.delete(dir);
}

/* ---------- the menu ---------- */

/** Substring match on the token and the detail. Deliberately not fuzzy: a
 *  scatter-match over 5000 paths ranks nonsense above the file you typed. */
const matches = (q: string, ...fields: (string | undefined)[]) =>
  q.length === 0 || fields.some((f) => f && f.toLowerCase().includes(q));

export function mentionRows(
  dir: string,
  query: string,
  attachments: { name: string; relPath: string }[],
  limit = 40,
): Mention[] {
  const q = query.toLowerCase().trim();
  const out: Mention[] = [];

  for (const a of attachments) {
    if (matches(q, a.name, a.relPath)) {
      out.push({ kind: "attachment", key: `attachment:${a.relPath}`, token: a.relPath, label: a.name, detail: a.relPath });
    }
  }

  const notes = indexFor(dir).notes;
  const sameTitle = new Map<string, number>();
  for (const n of notes) sameTitle.set(n.title, (sameTitle.get(n.title) ?? 0) + 1);
  for (const n of notes) {
    if (matches(q, n.title, n.path)) {
      const folder = n.folder || "vault";
      // the token carries its own `note:` prefix so the composer reads
      // `@note:Web pane retro` — the spec's form, and the mock's. The token can
      // only carry the title, so the ROW says which folder when a title repeats
      // and the key stays the path, or picking the second one would silently
      // repoint the first.
      out.push({
        kind: "note", key: `note:${n.path}`, token: `note:${n.title}`,
        label: (sameTitle.get(n.title) ?? 0) > 1 ? `${n.title} — ${folder}` : n.title,
        detail: folder, path: n.path, body: undefined,
      });
    }
  }

  for (const p of cachedPhases(dir)) {
    if (matches(q, p.token, p.detail)) out.push(p);
  }

  // files last and capped — there are thousands, and the named things above
  // are what a short query usually means
  for (const f of cachedFiles(dir)) {
    if (out.length >= limit) break;
    if (matches(q, f)) {
      out.push({ kind: "file", key: `file:${f}`, token: f, label: f.split("/").pop() ?? f, detail: f });
    }
  }

  return out.slice(0, limit);
}

/* ---------- turning the composer's text into what the agent receives ---------- */

/**
 * The text-only form, for the queue — a queued message is stored as a string
 * and sent unattended later, so its mentions are resolved now while the table
 * still holds them. Paths stay inline; a phase appends its text. A note has a
 * file, so it appends the path to read rather than the whole note: the queued
 * message may go out much later, and the note on disk is the honest version.
 *
 * A note that has been renamed or deleted since it was picked appends nothing —
 * `@note:Title` stays in the message as the prose it now looks like, rather
 * than pointing the agent at a file that isn't there.
 */
export function flattenMentions(text: string, table: Map<string, Mention>, dir: string): string {
  const live = new Set(indexFor(dir).notes.map((n) => n.path));
  const used = firstPerToken(table)
    .filter((m) => text.includes(`@${m.token}`))
    .filter((m) => (m.kind === "note" ? live.has(m.path ?? "") : !!m.body));
  if (used.length === 0) return text;
  const context = used
    .map((m) => `<context ref="${uriFor(m)}">\n${m.body ?? `Read .chronicle/notes/${m.path}`}\n</context>`)
    .join("\n\n");
  return `${text}\n\n${context}`;
}

/** The table is keyed by identity, so two same-titled notes can carry the same
 *  token. Only one of them can be what a given `@note:Title` in the text means:
 *  the first one picked, which is the one that was inserted there. */
function firstPerToken(table: Map<string, Mention>): Mention[] {
  const byToken = new Map<string, Mention>();
  for (const m of table.values()) if (!byToken.has(m.token)) byToken.set(m.token, m);
  return [...byToken.values()];
}

/* ---------- ACP content blocks ---------- */

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "resource_link"; uri: string; name: string }
  | { type: "resource"; resource: { uri: string; text: string; mimeType: string } };

/** `chronicle://phase/F31`, `chronicle://note/Web pane retro` — a stable name
 *  for the thing the mention points at. The note token already carries the
 *  `note:` prefix the composer shows, so the uri names the title, not the token. */
const uriFor = (m: Mention) => `chronicle://${m.kind}/${m.kind === "note" ? m.label : m.token}`;

/**
 * Split `text` into ACP blocks around every still-intact mention token.
 *
 * A file or attachment becomes a `resource_link`: a pointer the agent follows
 * with its own Read tool, so mentioning a 3000-line file costs nothing until
 * it's actually wanted. A phase has no file to read, so it becomes a `resource`
 * carrying its text, which the adapter inlines as a `<context ref>` block. A
 * note is a file, but not one the agent is told the path of, so its text is
 * read here — lazily, at send time, never held in the menu.
 *
 * A token the user has since edited no longer matches the table, so it stays
 * in the surrounding text as the prose it now looks like. That is the whole
 * point of the token design — a mention never outlives its own text.
 */
export async function buildBlocks(text: string, table: Map<string, Mention>, dir: string): Promise<ContentBlock[]> {
  // longest token first: `@src/a.ts` must not be matched by a shorter `@src/a`
  const byToken = new Map(firstPerToken(table).map((m) => [m.token, m] as const));
  const tokens = [...byToken.keys()].sort((a, b) => b.length - a.length);

  type Hit = { at: number; len: number; m: Mention };
  const hits: Hit[] = [];
  for (const token of tokens) {
    const needle = `@${token}`;
    let from = 0;
    for (;;) {
      const at = text.indexOf(needle, from);
      if (at === -1) break;
      // skip anything already covered by a longer token
      if (!hits.some((h) => at < h.at + h.len && h.at < at + needle.length)) {
        hits.push({ at, len: needle.length, m: byToken.get(token)! });
      }
      from = at + needle.length;
    }
  }
  hits.sort((a, b) => a.at - b.at);

  const blocks: ContentBlock[] = [];
  // text accumulates until a mention actually produces a block, so a mention
  // that resolves to nothing simply stays part of the sentence around it
  let carry = "";
  const pushText = (s: string) => { carry += s; };
  const flush = () => { if (carry.length > 0) { blocks.push({ type: "text", text: carry }); carry = ""; } };

  let cursor = 0;
  for (const h of hits) {
    pushText(text.slice(cursor, h.at));
    cursor = h.at + h.len;
    if (h.m.kind === "note" && h.m.path) {
      // renamed or deleted since it was picked: leave `@note:Title` in the
      // prose rather than send an empty resource block claiming to be a note
      const body = await notesRead(dir, h.m.path).catch(() => null);
      if (body === null) { pushText(`@${h.m.token}`); continue; }
      flush();
      blocks.push({
        type: "resource",
        resource: { uri: uriFor(h.m), text: body, mimeType: "text/markdown" },
      });
    } else if (h.m.body) {
      flush();
      blocks.push({
        type: "resource",
        resource: { uri: uriFor(h.m), text: h.m.body, mimeType: "text/plain" },
      });
    } else {
      flush();
      blocks.push({
        type: "resource_link",
        uri: `file://${dir}/${h.m.token}`,
        name: h.m.token,
      });
    }
  }
  pushText(text.slice(cursor));
  flush();

  return blocks.length > 0 ? blocks : [{ type: "text", text }];
}
