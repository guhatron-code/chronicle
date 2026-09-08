/*
 * Pure address rules for the Web pane — no Tauri, no React. What the user
 * typed becomes a URL or a search; what a tab is on becomes a display string;
 * and two predicates decide what the terminal routes into the pane.
 */
export const SEARCH_PREFIX = "https://duckduckgo.com/?q=";
const ALLOWED_SCHEMES = new Set(["http", "https", "chronicle-file", "about"]);

/** Typed input → a navigable URL, or null when it must not be navigated. */
export function toAddress(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  if (/^[a-z0-9.-]+:\d{1,5}(\/|$)/i.test(s)) return `https://${s}`;
  const m = /^([a-z][a-z0-9+.-]*):/i.exec(s);
  if (m) {
    const scheme = m[1].toLowerCase();
    if (scheme === "javascript" || scheme === "data" || scheme === "file") return null;
    if (ALLOWED_SCHEMES.has(scheme)) return s;
    return SEARCH_PREFIX + encodeURIComponent(s);
  }
  if (!/\s/.test(s) && s.includes(".")) return `https://${s}`;
  return SEARCH_PREFIX + encodeURIComponent(s);
}

/** What the address bar shows for a tab's URL. */
export function displayAddress(url: string): string {
  if (url === "about:blank" || url === "") return "";
  const m = /^chronicle-file:\/\/[^/]+\/(.*)$/.exec(url);
  if (m) {
    let rel = m[1];
    try {
      rel = decodeURIComponent(rel);
    } catch {
      /* show it as-is */
    }
    return `this project › ${rel}`;
  }
  return url;
}

const ARTIFACT_HOSTS = new Set(["claude.ai", "www.claude.ai", "claude.site", "www.claude.site"]);

/** A link the terminal should open inside the Web pane rather than the system browser. */
export function isClaudeArtifactUrl(url: string): boolean {
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol !== "https:" || !ARTIFACT_HOSTS.has(u.hostname)) return false;
  return u.pathname.includes("/artifacts/");
}

export function isHtmlPath(path: string): boolean {
  return /\.html?$/i.test(path);
}
