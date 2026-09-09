/*
 * The one pure question the editor asks as it unmounts: is this state worth
 * keeping?
 *
 * THE BUG this replaces: the answer used to be a one-shot `disposed` mark the
 * store set on close and the cleanup consumed. Closing and reopening one docKey
 * in the same tick never unmounted the instance — so no mount effect cleared
 * the mark — and the NEXT real unmount read it, skipped the cache, and dropped
 * a live undo history. Two mounts of one key also shared the single mark.
 */
import { describe, expect, it } from "vitest";
import { shouldCacheOnUnmount } from "./CodeEditor";

const A = "/p\0a.ts";
const B = "/p\0b.ts";

describe("shouldCacheOnUnmount", () => {
  it("keeps the state of a buffer that is still open", () => {
    expect(shouldCacheOnUnmount(A, () => true)).toBe(true);
  });

  it("drops the state of a buffer that was closed under the editor", () => {
    expect(shouldCacheOnUnmount(A, () => false)).toBe(false);
  });

  it("asks about the key that is unmounting, not the one now on screen", () => {
    // a tab switch tears down A's editor while the props already name B
    const open = new Set([B]);
    const asked: string[] = [];
    const isOpen = (k: string) => { asked.push(k); return open.has(k); };
    expect(shouldCacheOnUnmount(A, isOpen)).toBe(false);
    expect(asked).toEqual([A]);
  });

  it("answers the same every time — there is no mark to consume", () => {
    const open = new Set([A]);
    const isOpen = (k: string) => open.has(k);
    // a close + reopen in one tick, then the real unmount: still cached
    expect(shouldCacheOnUnmount(A, isOpen)).toBe(true);
    expect(shouldCacheOnUnmount(A, isOpen)).toBe(true);
    // and two mounts of one key each get their own answer
    open.delete(A);
    expect(shouldCacheOnUnmount(A, isOpen)).toBe(false);
  });

  it("keeps everything when nothing can close a buffer (a preview, a fixture)", () => {
    expect(shouldCacheOnUnmount(A)).toBe(true);
  });
});
