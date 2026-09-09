/*
 * Attachment references vs what a webview can render.
 *
 * A note's markdown carries `![](../attachments/x.png)` — always vault-root
 * relative, whatever folder the note sits in — and no webview can load that.
 * The body is rewritten to `data:` URIs on the way into the editor and back to
 * the relative form on the way out, so the file's text never holds base64.
 *
 * The reverse map (`data:` URI → `../attachments/x.png`) is the load-bearing
 * half: an editor that shows a `data:` URI it cannot map back writes the blob
 * straight into the .md on the first keystroke. It therefore has to be seeded
 * from EVERY reference the body names, not only the ones that had to be
 * fetched — a remounted editor (the pane keys the editor by path) starts with
 * an empty map while notes-store's image cache is already warm.
 *
 * The cache is injected rather than imported so this module stays free of
 * React and of @tauri-apps, and the tests run in vitest's node environment.
 */

/** `![alt](../attachments/file)` — the only image form a note may hold on disk. */
export const ATTACHMENT_REF = /!\[([^\]]*)\]\((\.\.\/attachments\/[^)\s]+)\)/g;
const DATA_REF = /!\[([^\]]*)\]\((data:[^)\s]+)\)/g;

/** Reads a cached data URI for a reference, or null when it is not cached yet. */
export type CachedSrc = (ref: string) => string | null;

/** Every `../attachments/…` reference the body names, in document order. */
export function attachmentRefs(md: string): string[] {
  return [...md.matchAll(ATTACHMENT_REF)].map((m) => m[2]);
}

/**
 * Record the reverse mapping for every reference that is already cached, and
 * return the ones that still have to be fetched.
 */
export function seedImageRefs(md: string, cached: CachedSrc, srcToRef: Map<string, string>): string[] {
  const missing: string[] = [];
  for (const ref of attachmentRefs(md)) {
    const src = cached(ref);
    if (src) srcToRef.set(src, ref);
    else if (!missing.includes(ref)) missing.push(ref);
  }
  return missing;
}

/** `![](../attachments/x.png)` → `![](data:…)` for everything already cached. */
export function toDisplay(md: string, cached: CachedSrc): string {
  return md.replace(ATTACHMENT_REF, (whole, alt: string, ref: string) => {
    const src = cached(ref);
    return src ? `![${alt}](${src})` : whole;
  });
}

/** …and back, so the file never holds a data: URI. */
export function toFile(md: string, srcToRef: Map<string, string>): string {
  return md.replace(DATA_REF, (whole, alt: string, src: string) => {
    const ref = srcToRef.get(src);
    return ref ? `![${alt}](${ref})` : whole;
  });
}
