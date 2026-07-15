import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Sentence-case a statement — the UI never starts a statement lowercase
 *  (operator rule). Mono commands, paths, and kbd keys are exempt. */
export function sentence(s: string): string {
  return s.length > 0 ? s[0].toUpperCase() + s.slice(1) : s;
}

/** Raw OS/git error lines become one plain sentence a non-developer can act on.
 *  Anything unrecognized passes through trimmed — never hide the truth. */
export function humanError(e: unknown): string {
  const raw = String(e).split("\n")[0];
  if (/No such file or directory|os error 2\b|ENOENT/i.test(raw))
    return "That file isn't there anymore — it may have been moved or deleted.";
  if (/Permission denied|os error 13\b|EACCES/i.test(raw))
    return "macOS wouldn't allow reading it — check the file's permissions.";
  if (/Is a directory|os error 21\b/i.test(raw))
    return "That's a folder, not a file.";
  return raw.slice(0, 110);
}

/** Publish/bring-down failures in recovery language, not git language. */
export function humanGitError(e: unknown): string {
  const raw = String(e);
  if (/rejected|non-fast-forward|fetch first|behind/i.test(raw))
    return "The online copy has newer saves — bring them down first, then publish again.";
  if (/could not read|authentication|permission denied|403|publickey|access denied/i.test(raw))
    return "GitHub didn't accept the connection — sign in again (gh auth login in the terminal).";
  if (/could not resolve host|network|timed out/i.test(raw))
    return "Couldn't reach GitHub — check the internet connection and try again.";
  return raw.split("\n")[0].slice(0, 110);
}
