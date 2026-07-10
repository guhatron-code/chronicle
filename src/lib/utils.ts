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
