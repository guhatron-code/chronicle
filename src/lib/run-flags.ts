/*
 * Tiny shared flags for per-project background sessions — lets the picker show
 * the "Writing your roadmap…" card for a project whose build runs while you're
 * on the home screen. RoadmapPane writes; App reads.
 */
const initRunning = new Set<string>();
const subscribers = new Set<() => void>();

export function subscribeRunFlags(cb: () => void): () => void {
  subscribers.add(cb);
  return () => subscribers.delete(cb);
}

export function setInitRunning(dir: string, running: boolean) {
  const had = initRunning.has(dir);
  if (running === had) return;
  if (running) initRunning.add(dir);
  else initRunning.delete(dir);
  for (const cb of subscribers) cb();
}

export function isInitRunning(dir: string): boolean {
  return initRunning.has(dir);
}
