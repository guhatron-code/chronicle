/*
 * How a signed-out agent signs in (spec §5), as the pane's banner says it.
 * Rust's needs-login event carries the agent's Login from its profile.
 */
export type AgentLogin = { kind: "terminal"; command: string; needs?: string } | { kind: "auth_method"; id: string } | { kind: "none" };
export type AuthMethod = { id: string; name: string; description?: string };

export function parseLogin(raw: unknown): AgentLogin | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.kind === "terminal" && typeof r.command === "string" && r.command)
    return { kind: "terminal", command: r.command, ...(typeof r.needs === "string" && r.needs ? { needs: r.needs } : {}) };
  if (r.kind === "auth_method" && typeof r.id === "string" && r.id) return { kind: "auth_method", id: r.id };
  if (r.kind === "none") return { kind: "none" };
  return null;
}

/** The agent's `initialize` authMethods, passed through by Rust as-is (null when it sent none). */
export function parseAuthMethods(raw: unknown): AuthMethod[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((m): m is Record<string, unknown> => !!m && typeof m === "object")
    .map((m) => ({ id: String(m.id ?? ""), name: String(m.name ?? ""), ...(typeof m.description === "string" ? { description: m.description } : {}) }))
    .filter((m) => m.id);
}

export function loginBanner(input: { name: string; login: AgentLogin | null; waiting: boolean; authMethods: AuthMethod[] }): {
  title: string;
  body: string;
  command: string | null;
  action: "terminal" | "wait" | "none";
} {
  const { name, login, waiting, authMethods } = input;
  if (login?.kind === "auth_method") {
    return waiting
      ? { title: `Finish signing in to ${name} in your browser`, body: "Chronicle carries on by itself when you're done.", command: null, action: "wait" }
      : { title: `${name} isn't signed in`, body: "The sign-in didn't finish. Start the session again to try once more.", command: null, action: "none" };
  }
  if (login?.kind === "none") {
    const own = authMethods.find((m) => m.description)?.description ?? authMethods[0]?.name;
    return { title: `${name} needs its own setup`, body: own ?? `Set ${name} up the way it asks, then start the session again.`, command: null, action: "none" };
  }
  if (login?.kind === "terminal" && login.needs) {
    return { title: `${name} needs you to sign in`, body: `Signing in needs ${login.needs} installed first. Install it, then run this once in a terminal — Chronicle starts the session again when it finishes.`, command: login.command, action: "terminal" };
  }
  if (login?.kind === "terminal") {
    return { title: `${name} needs you to sign in`, body: "Run this once in a terminal. Chronicle starts the session again when it finishes.", command: login.command, action: "terminal" };
  }
  return { title: `${name} isn't signed in`, body: "Sign in, then start the session again.", command: null, action: "none" };
}
