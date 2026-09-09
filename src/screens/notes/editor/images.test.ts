import { describe, expect, it } from "vitest";
import { attachmentRefs, seedImageRefs, toDisplay, toFile } from "./images";

const REF = "../attachments/shot-1.png";
const OTHER = "../attachments/shot-2.png";
const DATA = "data:image/png;base64,iVBORw0KGgoAAAA";
const DATA_2 = "data:image/png;base64,ZZZZZZZZZZZZZZZ";

/** Stands in for notes-store's module-global imageCache, which outlives any editor. */
function warmCache(entries: [string, string][] = []) {
  const cache = new Map(entries);
  return {
    cached: (ref: string) => cache.get(ref) ?? null,
    fetched: (ref: string, src: string) => cache.set(ref, src),   // what noteImageSrc does
  };
}

describe("attachment references", () => {
  it("finds every reference the body names", () => {
    const md = `![](${REF})\n\ntext\n\n![a shot](${OTHER})\n`;
    expect(attachmentRefs(md)).toEqual([REF, OTHER]);
  });

  it("leaves a reference alone while it is not cached", () => {
    const { cached } = warmCache();
    const md = `![](${REF})\n`;
    expect(toDisplay(md, cached)).toBe(md);
  });

  it("maps a cached image back to its file reference after a remount", () => {
    const { cached, fetched } = warmCache();
    const body = `# A note\n\n![](${REF})\n`;

    /* first mount: nothing cached, so the reference has to be fetched */
    const first = new Map<string, string>();
    expect(seedImageRefs(body, cached, first)).toEqual([REF]);
    fetched(REF, DATA);
    first.set(DATA, REF);
    expect(toFile(toDisplay(body, cached), first)).toBe(body);

    /* the pane keys the editor by path, so opening the note again gives a fresh
     * map against a cache that is already warm — the reference is no longer
     * "missing", and without seeding there would be no way back from the blob */
    const second = new Map<string, string>();
    expect(seedImageRefs(body, cached, second)).toEqual([]);
    const shown = toDisplay(body, cached);
    expect(shown).toContain(`![](${DATA})`);
    expect(toFile(shown, second)).toBe(body);
  });

  it("keeps every image mapped when only some of them are cached", () => {
    const { cached, fetched } = warmCache([[REF, DATA]]);
    const body = `![one](${REF})\n\n![two](${OTHER})\n`;

    const map = new Map<string, string>();
    expect(seedImageRefs(body, cached, map)).toEqual([OTHER]);
    fetched(OTHER, DATA_2);
    map.set(DATA_2, OTHER);

    const shown = toDisplay(body, cached);
    expect(shown).toBe(`![one](${DATA})\n\n![two](${DATA_2})\n`);
    expect(toFile(shown, map)).toBe(body);
  });

  it("leaves a data URI it cannot map alone rather than guessing", () => {
    const md = `![](${DATA})\n`;
    expect(toFile(md, new Map())).toBe(md);
  });
});
