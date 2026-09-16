/*
 * The frontend half of the agent action bridge.
 *
 * An agent running inside Chronicle can ask the app to do one of the things
 * its buttons do — plan a round, run one, open a project, read a terminal
 * back. Rust takes that request off the socket and emits `agent-action`; this
 * module performs it with the SAME code the buttons call (nothing here reaches
 * around the app's own paths), replies with a sentence a person can read, and
 * says so out loud: a toast now, a journal line for later.
 *
 * The parts that decide anything are pure and injected (`BridgeDeps`), so the
 * dispatcher is tested without React, xterm or Tauri — see agent-bridge.test.ts.
 * `mountAgentBridge` is the only impure part and stays deliberately thin: it
 * listens, hands the action here, and reports the answer.
 *
 * Every reply is honest about failure. A refusal is never silent and never
 * dressed up as success: the agent gets `ok: false` with the reason, and the
 * user gets a toast saying the app was asked for something it couldn't do.
 */
import { agentActionReply, onAgentAction, type AgentAction } from "./ipc";
import { announce } from "./journal";
import { toastError, toastSuccess } from "@/overlays/toasts";
import type { UnlistenFn } from "@tauri-apps/api/event";

/** Where a round runs: the agent pane, or a terminal tab you can watch. */
export type RoundRoute = "pane" | "terminal";

/**
 * Everything the dispatcher is allowed to touch. App.tsx fills these in with
 * the very functions its buttons use; the tests fill them in with spies.
 */
export interface BridgeDeps {
  planRound(dir: string): Promise<void>;
  startRound(dir: string, n: number, total: number, where: RoundRoute): Promise<void>;
  /** Settles WITH the open: a folder that can't be opened must not be reported
   *  as opened, so this resolves once the project is up and rejects if it isn't. */
  openProject(dir: string): Promise<void>;
  /** Bring an already-open project to the front. The reveals below act on
   *  whichever project the window is showing, so a round started in a project
   *  the user isn't looking at has to foreground that project FIRST — otherwise
   *  the wrong project's panes open and the wrong project's layout is saved. */
  activate(dir: string): void;
  revealPane(): void;
  revealTerminal(): void;
  roundTotal(dir: string, n: number): number;
  /** The last `lines` rows of a terminal tab, or null when there is no such tab. */
  termTail(id: number | null, lines: number): string | null;
  /** The tab an unnamed `terminal.read` means. Optional: without it, an agent
   *  that names no tab is simply told there is none. */
  activeTerm?(dir: string): number | null;
  /** Which project a tab belongs to. Terminal ids are global, so this is what
   *  keeps an agent inside the project it was asked about. */
  termDir?(id: number): string | null;
  /** Is this project already open? Only the wording of the reply turns on it. */
  isProjectOpen?(dir: string): boolean;
  /** Tell the backend the listener below is live. Called once `onAgentAction`'s
   *  promise below has resolved — never before, or an action arriving in that
   *  window would be emitted into the socket with nobody home to hear it. */
  bridgeReady?(): void | Promise<void>;
}

/** What `handleAgentAction` hands back to Rust, and to the user. */
export interface ActionOutcome {
  ok: boolean;
  summary: string;
  data?: unknown;
}

const DEFAULT_TAIL_LINES = 200;
const MAX_TAIL_LINES = 5000;

function intArg(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function textArg(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}

function routeArg(v: unknown): RoundRoute {
  return v === "terminal" ? "terminal" : "pane";
}

function tailLines(v: unknown): number {
  const n = intArg(v);
  if (n == null || n < 1) return DEFAULT_TAIL_LINES;
  return Math.min(n, MAX_TAIL_LINES);
}

/** One line of blame, from whatever was thrown. */
function why(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  return raw.split("\n")[0].trim().slice(0, 140) || "something went wrong";
}

const refusal = (verb: string, e: unknown): ActionOutcome => ({
  ok: false,
  summary: `Couldn't ${verb}: ${why(e)}`,
});

/**
 * What an agent asked for, in words — the label the opt-in surfaces show
 * BEFORE anything happens. Pure, and null for anything this app doesn't do:
 * an action nobody can name is an action nobody should be asked to approve.
 */
export function describeAction(action: string, args: Record<string, unknown>): string | null {
  switch (action) {
    case "round.plan":
      return "Plan a round";
    case "round.start": {
      const n = intArg(args.n);
      if (n == null) return null;
      return `Start round ${n} in ${routeArg(args.where) === "terminal" ? "a terminal" : "the pane"}`;
    }
    case "project.open": {
      const dir = textArg(args.dir);
      return dir ? `Open ${dir}` : null;
    }
    case "terminal.read": {
      const id = intArg(args.id);
      const lines = tailLines(args.lines);
      return id == null
        ? `Read the terminal's last ${lines} lines`
        : `Read terminal ${id}'s last ${lines} lines`;
    }
    default:
      return null;
  }
}

/**
 * Perform one action and say what happened. Never throws: a request that fails
 * comes back as a refusal, because the agent on the other end is waiting for an
 * answer either way and a dropped request would just time out in silence.
 */
export async function handleAgentAction(a: AgentAction, deps: BridgeDeps): Promise<ActionOutcome> {
  const args = a.args ?? {};
  switch (a.action) {
    case "round.plan":
      try {
        deps.activate(a.dir); // the project being worked in comes to the front first
        deps.revealPane(); // then the pane: the work is visible while it runs
        await deps.planRound(a.dir);
        return { ok: true, summary: "An agent started planning a round in the pane." };
      } catch (e) {
        return refusal("plan a round", e);
      }

    case "round.start": {
      const n = intArg(args.n);
      if (n == null) return refusal("start a round", "no round number");
      const where = routeArg(args.where);
      try {
        const total = deps.roundTotal(a.dir, n);
        deps.activate(a.dir); // reveal follows the front project, so switch to it first
        if (where === "terminal") deps.revealTerminal();
        else deps.revealPane();
        await deps.startRound(a.dir, n, total, where);
        return {
          ok: true,
          summary: `An agent started round ${n} in ${where === "terminal" ? "a terminal" : "the pane"}.`,
        };
      } catch (e) {
        return refusal(`start round ${n}`, e);
      }
    }

    case "project.open": {
      const dir = textArg(args.dir);
      if (dir == null) return refusal("open a project", "no folder");
      try {
        const already = deps.isProjectOpen?.(dir) ?? false;
        // awaited: the app's own open reports a folder it can't read, and a
        // reply that said "Opened" beside that red toast would be a lie
        await deps.openProject(dir);
        return { ok: true, summary: `${already ? "Switched to" : "Opened"} ${dir}.` };
      } catch (e) {
        return refusal(`open ${dir}`, e);
      }
    }

    case "terminal.read": {
      const named = intArg(args.id);
      const lines = tailLines(args.lines);
      // tab ids are global; a named one that lives in another project is none
      // of this agent's business, and is refused without being read
      if (named != null && deps.termDir && deps.termDir(named) !== a.dir) {
        return { ok: false, summary: `Terminal ${named} isn't in this project.` };
      }
      // an agent that names no tab means the one the project is looking at
      const id = named ?? deps.activeTerm?.(a.dir) ?? null;
      const what = named == null ? "the terminal" : `terminal ${named}`;
      let text: string | null;
      try {
        text = deps.termTail(id, lines);
      } catch (e) {
        return refusal(`read ${what}`, e);
      }
      if (text == null) return refusal(`read ${what}`, "no terminal is open there");
      // count what was actually handed over: the rows of the returned text, with a
      // trailing newline not counted as a row of its own. `termTail` caps on the same
      // unit, so "50 lines" is never the answer to a read that returned 73.
      const body = text.endsWith("\n") ? text.slice(0, -1) : text;
      const got = body === "" ? 0 : body.split("\n").length;
      return {
        ok: true,
        summary: `${got} lines from ${named == null ? "the terminal" : `terminal ${named}`}.`,
        data: { text, lines: got },
      };
    }

    default:
      return refusal(`run "${a.action}"`, "Chronicle doesn't know that action");
  }
}

/**
 * Listen for actions, perform them, reply, and say so.
 *
 * Success gets a toast and a journal line (the journal is the project's
 * record of what happened while nobody was watching); a refusal gets the
 * toast only — a thing the app declined to do is not part of the project's
 * history. Mount ONCE at app scope and return the cleanup, like every other
 * listener (ipc.ts law).
 *
 * Exactly one reply goes out per action, whatever happens: `handleAgentAction`
 * is not supposed to throw, and if it ever does, the agent still hears why
 * instead of waiting out Rust's timeout. And when the REPLY is what fails,
 * Rust has already given up on this action — the agent was told it timed out,
 * so saying anything here would tell the user a story the agent never got.
 *
 * `deps.bridgeReady` (usually `agentBridgeReady` from ipc.ts) is called only once
 * `onAgentAction`'s listener is actually registered — calling it any earlier would
 * tell the backend it is safe to emit into a socket nobody is listening on yet.
 */
export function mountAgentBridge(deps: BridgeDeps): () => void {
  let un: UnlistenFn | undefined;
  let dead = false;
  void onAgentAction((a) => {
    void handleAgentAction(a, deps)
      .catch((e): ActionOutcome => ({ ok: false, summary: `Couldn't do that: ${why(e)}` }))
      .then((r) =>
        agentActionReply(a.id, r.ok, r.summary, r.data).then(
          () => {
            if (r.ok) {
              toastSuccess(r.summary);
              announce(a.dir, "agent-action", r.summary, "Chronicle");
            } else {
              toastError("An agent asked for something Chronicle couldn't do", r.summary);
            }
          },
          () => {}, // nobody is waiting any more
        ),
      );
  }).then((u) => {
    if (dead) { u(); return; }
    un = u;
    void deps.bridgeReady?.();
  });
  return () => {
    dead = true;
    un?.();
  };
}
