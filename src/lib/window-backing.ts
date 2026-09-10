/*
 * The window's own backing colour follows the app surface. An opaque titled
 * window shows its backing wherever WebKit has not repainted yet — a zoom, a
 * fast resize — and in the surface colour that lag is invisible. Repainted at
 * boot and on every change of appearance or theme attribute; no timers.
 */
import { setWindowBackground } from "./ipc";

let last = "";

function paint() {
  const hex = getComputedStyle(document.documentElement).getPropertyValue("--surface-app").trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(hex) || hex === last) return;
  last = hex;
  void setWindowBackground(hex).catch(() => {});
}

export function initWindowBacking(): void {
  paint();
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener("change", paint);
  new MutationObserver(paint).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class"] });
}
