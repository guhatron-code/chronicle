/*
 * Feeds the scheduler. Visibility comes from the DOM: WKWebView flips
 * document.visibilityState to "hidden" when the window is occluded,
 * minimized or hidden with ⌘H, which is exactly "nobody can see this".
 * Focus comes from window focus/blur. Battery comes from Rust (power.rs).
 * Also stamps <html data-idle> so CSS can pause looping animations, and
 * tells Rust when the UI is visible.
 */
import { getPowerSource, onPowerSourceChanged, setUiVisible } from "./ipc";
import { cadenceFor, setActivity, subscribeActivity } from "./scheduler";

let started = false;

export function initActivity(): void {
  if (started) return;
  started = true;
  const sync = () =>
    setActivity({ visible: document.visibilityState === "visible", focused: document.hasFocus() });
  document.addEventListener("visibilitychange", sync);
  window.addEventListener("focus", sync);
  window.addEventListener("blur", sync);
  sync();
  void getPowerSource().then((p) => setActivity({ onBattery: p.on_battery })).catch(() => {});
  void onPowerSourceChanged((onBattery) => setActivity({ onBattery }));
  subscribeActivity((a) => {
    document.documentElement.dataset.idle = cadenceFor(a) === "normal" ? "false" : "true";
    void setUiVisible(a.visible).catch(() => {});
  });
  document.documentElement.dataset.idle = "false";
}
