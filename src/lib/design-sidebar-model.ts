/* The designs sidebar's one piece of pure logic: where a dragged design lands
 * within its kind's list. `before` is the slug it should land in front of, or
 * null to land at the end — exactly what a drop past the last row means. */
export function dropOrder(slugs: string[], moved: string, before: string | null): string[] {
  const rest = slugs.filter((s) => s !== moved);
  const i = before == null ? -1 : rest.indexOf(before);
  return i < 0 ? [...rest, moved] : [...rest.slice(0, i), moved, ...rest.slice(i)];
}
