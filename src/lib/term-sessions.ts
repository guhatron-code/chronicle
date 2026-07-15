/*
 * The terminal session registry — framework-free. Sessions are xterm instances
 * bound to backend PTYs, kept alive OUTSIDE React so they survive pane and
 * project switches (legacy parity: cross-project hidden-alive terms). The
 * TerminalPane re-parents a session's host <div> into the visible frame;
 * xterm survives re-parenting.
 *
 * PTY event listeners register ONCE at module scope on first use and route by
 * id (ipc.ts law — per-mount listeners duplicate writes under HMR/StrictMode).
 */
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import {
  decodePtyChunk,
  onPtyOut,
  onPtyExit,
  ptyKill,
  ptyResize,
  ptySpawn,
  ptyWrite,
} from "./ipc";

export interface TermSession {
  id: number; // pty id
  dir: string;
  title: string;
  autoNamed: boolean; // false once the user renames
  agent?: "claude" | "codex";
  dead: boolean;
  term: Terminal;
  fit: FitAddon;
  host: HTMLDivElement; // xterm's render target; re-parented into the frame
}

const sessions = new Map<number, TermSession>();
/** The selected tab per project — session state, so roadmap-spawned terminals
 * can activate themselves without threading React state around. */
const activeByDir = new Map<string, number>();
let counter = 0;
let listenersReady = false;
const subscribers = new Set<() => void>();

function notify() {
  for (const cb of subscribers) cb();
}

/** Re-render hook for React containers. Returns unsubscribe. */
export function subscribeTerms(cb: () => void): () => void {
  subscribers.add(cb);
  return () => subscribers.delete(cb);
}

function ensureListeners() {
  if (listenersReady) return;
  listenersReady = true;
  void onPtyOut((id, b64) => {
    sessions.get(id)?.term.write(decodePtyChunk(b64));
  });
  void onPtyExit((id) => {
    const s = sessions.get(id);
    if (s && !s.dead) {
      s.dead = true;
      // an ended session must not keep a live-looking cursor
      s.term.options.cursorBlink = false;
      s.term.write("\x1b[?25l");
      s.term.write("\r\n\x1b[2m[session ended]\x1b[0m\r\n");
      notify();
    }
  });
}

/* The legacy ANSI accents were drawn from the DS mark palette; the chrome
 * colours come from the live tokens so theme changes carry through. */
const ANSI = {
  black: "#121214", red: "#cf8a86", green: "#7fae8a", yellow: "#c9a961",
  blue: "#8a9bb0", magenta: "#9b8ab0", cyan: "#8ab0a3", white: "#ececec",
  brightBlack: "#525252", brightRed: "#cf8a86", brightGreen: "#7fae8a",
  brightYellow: "#c9a961", brightBlue: "#8a9bb0", brightMagenta: "#9b8ab0",
  brightCyan: "#8ab0a3", brightWhite: "#ffffff",
};

function themeFromTokens() {
  const v = (name: string, fallback: string) =>
    getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  return {
    background: v("--surface-app", "#0a0a0a"),
    foreground: v("--text-secondary", "#b8b8b8"),
    cursor: v("--text-primary", "#ececec"),
    selectionBackground: "rgba(255,255,255,.16)",
    ...ANSI,
  };
}

export function activeTermFor(dir: string): number | null {
  const want = activeByDir.get(dir);
  if (want != null && sessions.has(want)) return want;
  return termsFor(dir)[0]?.id ?? null;
}

export function setActiveTermFor(dir: string, id: number) {
  activeByDir.set(dir, id);
  notify();
}

export function termsFor(dir: string): TermSession[] {
  return [...sessions.values()].filter((s) => s.dir === dir);
}

export function getTerm(id: number): TermSession | undefined {
  return sessions.get(id);
}

export function liveCount(dir?: string): number {
  return [...sessions.values()].filter((s) => !s.dead && (!dir || s.dir === dir)).length;
}

export interface SpawnOpts {
  title?: string;
  agent?: "claude" | "codex";
  /** Typed into the session after the shell settles (the agent launch or a command). */
  autoType?: string;
}

/** Spawn a shell in `dir` and bind an xterm to it. Throws on backend refusal. */
export async function spawnTerm(dir: string, opts: SpawnOpts = {}): Promise<TermSession> {
  ensureListeners();
  counter += 1;
  const host = document.createElement("div");
  host.className = "h-full w-full";
  const term = new Terminal({
    fontFamily: '"Geist Mono", ui-monospace, Menlo, monospace',
    fontSize: 13,
    cursorBlink: true,
    scrollback: 4000,
    macOptionIsMeta: true,
    theme: themeFromTokens(),
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.open(host);
  // host is detached — cols/rows are wrong until the frame attaches; spawn with
  // a sane default and let the first attach fit+resize
  let id: number;
  try {
    id = await ptySpawn(dir, term.cols || 80, term.rows || 24);
  } catch (e) {
    term.dispose();
    throw e;
  }
  const session: TermSession = {
    id,
    dir,
    title: opts.title ?? `Shell ${counter}`,
    autoNamed: !opts.title,
    agent: opts.agent,
    dead: false,
    term,
    fit,
    host,
  };
  sessions.set(id, session);
  activeByDir.set(dir, id); // a fresh session takes the spotlight
  term.onData((d) => void ptyWrite(id, d).catch(() => {}));
  const typed = opts.autoType ?? (opts.agent ? `${opts.agent}\n` : null);
  if (typed) {
    // legacy timing: let the shell prompt settle first
    setTimeout(() => void ptyWrite(id, typed.endsWith("\n") ? typed : `${typed}\n`).catch(() => {}), 650);
  }
  notify();
  return session;
}

/** Fit the xterm to its current box and propagate the size to the pty. */
export function fitTerm(id: number) {
  const s = sessions.get(id);
  if (!s || s.dead || !s.host.isConnected) return;
  // a hidden tab's host is zero-sized — fitting would resize the pty to ~10x6,
  // rewrap a live agent's output, and truncate scrollback (audit T-002)
  if (s.host.clientWidth === 0 || s.host.clientHeight === 0) return;
  try {
    s.fit.fit();
    void ptyResize(id, s.term.cols, s.term.rows).catch(() => {});
  } catch { /* zero-size box mid-layout — the next observe pass fits */ }
}

export function renameTerm(id: number, title: string) {
  const s = sessions.get(id);
  if (!s) return;
  const t = title.trim();
  if (t) {
    s.title = t;
    s.autoNamed = false;
    notify();
  }
}

/** Kill (if live) and fully dispose a session. */
export function closeTerm(id: number) {
  const s = sessions.get(id);
  if (!s) return;
  if (!s.dead) void ptyKill(id).catch(() => {});
  s.term.dispose();
  s.host.remove();
  sessions.delete(id);
  if (activeByDir.get(s.dir) === id) activeByDir.delete(s.dir);
  notify();
}

/* live terminals follow theme switches — xterm accepts a theme swap at runtime */
if (typeof MutationObserver !== "undefined") {
  new MutationObserver(() => {
    const theme = themeFromTokens();
    for (const s of sessions.values()) s.term.options.theme = theme;
  }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
}

/* dev-only handle for the wiring harness */
if (import.meta.env.DEV) {
  (window as never as Record<string, unknown>).__terms = { getTerm, termsFor, liveCount };
}

/** Close every session for a project (project close / ⌘W after confirm). */
export function closeTermsFor(dir: string) {
  for (const s of termsFor(dir)) closeTerm(s.id);
}
