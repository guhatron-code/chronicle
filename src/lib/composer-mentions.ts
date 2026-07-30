/*
 * The composer's `@` menu — everything in a project worth pointing an agent at.
 *
 * Four sources: repo files, this session's attachments, kanban tasks, and
 * roadmap phases. Files are referenced by path, because the agent can read
 * those itself and a big file costs nothing until it does. A kanban task or a
 * roadmap phase has no file to read, so its text is inlined at send time.
 *
 * A mention survives in the textarea as plain text plus an entry in a lookup
 * table. Edit the text so it no longer matches and it silently becomes what it
 * looks like — ordinary prose. No chip ever claims something isn't attached.
 */
import { fileIndex, readFile } from "./ipc";
import { kanbanFor } from "./kanban-store";

export type MentionKind = "file" | "attachment" | "task" | "phase";

export interface Mention {
  kind: MentionKind;
  /** the text inserted into the composer, without the leading @ */
  token: string;
  /** menu label */
  label: string;
  /** menu right-hand text */
  detail?: string;
  /** set for task/phase — inlined into the message at send time */
  body?: string;
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
      out.push({ kind: "attachment", token: a.relPath, label: a.name, detail: a.relPath });
    }
  }

  for (const t of kanbanFor(dir).tasks) {
    if (t.archived) continue;
    if (matches(q, t.id, t.title)) {
      out.push({
        kind: "task",
        token: t.id,
        label: t.id,
        detail: t.title,
        body: [`${t.id} — ${t.title}`, t.content].filter(Boolean).join("\n"),
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
      out.push({ kind: "file", token: f, label: f.split("/").pop() ?? f, detail: f });
    }
  }

  return out.slice(0, limit);
}

/* ---------- turning the composer's text into what the agent receives ---------- */

/**
 * The text-only form, for the queue — a queued message is stored as a string
 * and sent unattended later, so its mentions are resolved now while the table
 * still holds them. Paths stay inline; a task or phase appends its text. The
 * agent sees the same information, just without the lazy file links.
 */
export function flattenMentions(text: string, table: Map<string, Mention>): string {
  const used = [...table.values()].filter((m) => m.body && text.includes(`@${m.token}`));
  if (used.length === 0) return text;
  const context = used
    .map((m) => `<context ref="chronicle://${m.kind}/${m.token}">\n${m.body}\n</context>`)
    .join("\n\n");
  return `${text}\n\n${context}`;
}

/* ---------- ACP content blocks ---------- */

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "resource_link"; uri: string; name: string }
  | { type: "resource"; resource: { uri: string; text: string; mimeType: string } };

/** `chronicle://task/T-042` — a stable name for a thing with no file. */
const uriFor = (m: Mention) => `chronicle://${m.kind}/${m.token}`;

/**
 * Split `text` into ACP blocks around every still-intact mention token.
 *
 * A file or attachment becomes a `resource_link`: a pointer the agent follows
 * with its own Read tool, so mentioning a 3000-line file costs nothing until
 * it's actually wanted. A task or phase has no file to read, so it becomes a
 * `resource` carrying its text, which the adapter inlines as a `<context ref>`
 * block.
 *
 * A token the user has since edited no longer matches the table, so it stays
 * in the surrounding text as the prose it now looks like. That is the whole
 * point of the token design — a mention never outlives its own text.
 */
export function buildBlocks(text: string, table: Map<string, Mention>, dir: string): ContentBlock[] {
  // longest token first: `@src/a.ts` must not be matched by a shorter `@src/a`
  const tokens = [...table.keys()].sort((a, b) => b.length - a.length);

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
        hits.push({ at, len: needle.length, m: table.get(token)! });
      }
      from = at + needle.length;
    }
  }
  hits.sort((a, b) => a.at - b.at);

  const blocks: ContentBlock[] = [];
  const pushText = (s: string) => {
    if (s.length > 0) blocks.push({ type: "text", text: s });
  };

  let cursor = 0;
  for (const h of hits) {
    pushText(text.slice(cursor, h.at));
    if (h.m.body) {
      blocks.push({
        type: "resource",
        resource: { uri: uriFor(h.m), text: h.m.body, mimeType: "text/plain" },
      });
    } else {
      blocks.push({
        type: "resource_link",
        uri: `file://${dir}/${h.m.token}`,
        name: h.m.token,
      });
    }
    cursor = h.at + h.len;
  }
  pushText(text.slice(cursor));

  return blocks.length > 0 ? blocks : [{ type: "text", text }];
}
