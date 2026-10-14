/*
 * Dev-only: how much the thread costs to render. React's Profiler calls
 * `profilerOnRender` on every commit of the subtree it wraps; we keep the
 * last 600 commits (10 s at 60 fps) and summarise on demand from the Web
 * Inspector: `__chroniclePerf()`.
 */
type Sample = { at: number; ms: number };
const samples: Sample[] = [];
export function profilerOnRender(_id: string, _phase: string, actualDuration: number): void {
  samples.push({ at: performance.now(), ms: actualDuration });
  if (samples.length > 600) samples.shift();
}
export function perfSummary(): { commits: number; avgMs: number; maxMs: number; over2ms: number; perSecond: number } {
  if (samples.length === 0) return { commits: 0, avgMs: 0, maxMs: 0, over2ms: 0, perSecond: 0 };
  const span = (samples[samples.length - 1].at - samples[0].at) / 1000 || 1;
  const ms = samples.map((s) => s.ms);
  return {
    commits: samples.length,
    avgMs: +(ms.reduce((a, b) => a + b, 0) / ms.length).toFixed(2),
    maxMs: +Math.max(...ms).toFixed(2),
    over2ms: ms.filter((m) => m > 2).length,
    perSecond: +(samples.length / span).toFixed(1),
  };
}
if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as { __chroniclePerf: () => unknown }).__chroniclePerf = perfSummary;
}
