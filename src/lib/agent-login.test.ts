import { describe, expect, it } from "vitest";
import { loginBanner, parseAuthMethods, parseLogin } from "./agent-login";

describe("sign-in, per agent", () => {
  it("parses the three kinds and refuses anything else", () => {
    expect(parseLogin({ kind: "terminal", command: "codex login" })).toEqual({ kind: "terminal", command: "codex login" });
    expect(parseLogin({ kind: "auth_method", id: "oauth-personal" })).toEqual({ kind: "auth_method", id: "oauth-personal" });
    expect(parseLogin({ kind: "none" })).toEqual({ kind: "none" });
    expect(parseLogin({ kind: "terminal" })).toBeNull();
    expect(parseLogin(null)).toBeNull();
  });

  it("auth methods tolerate null and junk", () => {
    expect(parseAuthMethods(null)).toEqual([]);
    expect(parseAuthMethods([{ id: "a", name: "A", description: "d" }, { name: "no id" }, 3])).toEqual([{ id: "a", name: "A", description: "d" }]);
  });

  it("a terminal login names the agent and its command", () => {
    const b = loginBanner({ name: "Codex", login: { kind: "terminal", command: "codex login" }, waiting: false, authMethods: [] });
    expect(b).toEqual({ title: "Codex needs you to sign in", body: "Run this once in a terminal. Chronicle starts the session again when it finishes.", command: "codex login", action: "terminal" });
  });

  it("an auth-method login says the browser is open while Rust waits", () => {
    const b = loginBanner({ name: "Gemini CLI", login: { kind: "auth_method", id: "oauth-personal" }, waiting: true, authMethods: [] });
    expect(b.action).toBe("wait");
    expect(b.title).toBe("Finish signing in to Gemini CLI in your browser");
  });

  it("an agent that signs itself in shows its own words", () => {
    const b = loginBanner({ name: "OpenCode", login: { kind: "none" }, waiting: false, authMethods: [{ id: "x", name: "Set a provider key", description: "Run opencode auth login to add a provider key." }] });
    expect(b).toMatchObject({ action: "none", body: "Run opencode auth login to add a provider key.", command: null });
  });

  it("an unknown login still reads as a plain sign-in for that agent", () => {
    expect(loginBanner({ name: "Claude Code", login: null, waiting: false, authMethods: [] }).title).toBe("Claude Code isn't signed in");
  });
  it("says when the sign-in needs the agent's own CLI first", () => {
    expect(parseLogin({ kind: "terminal", command: "codex login", needs: "codex" })).toEqual({ kind: "terminal", command: "codex login", needs: "codex" });
    const b = loginBanner({ name: "Codex", login: { kind: "terminal", command: "codex login", needs: "codex" }, waiting: false, authMethods: [] });
    expect(b.body).toContain("needs codex installed first");
    expect(b.command).toBe("codex login");
  });
});
