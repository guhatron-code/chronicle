/*
 * The composer's / menu, both halves.
 *
 * AGENT commands come off the wire (`available_commands_update`) and are sent
 * to the agent as ordinary text — the adapter's SDK expands them. Skills arrive
 * through the same channel, so a project skill needs no special handling.
 *
 * CHRONICLE commands never reach the agent. They run locally against the
 * session the composer is already looking at, and the menu keeps them under
 * their own heading so the difference is visible rather than implied.
 */
import { agentEditKeep, agentEditUndo, agentRestoreCheckpoint } from "./ipc";
import { agentSessionFor, type AgentCommand } from "./agent-session";

export interface LocalCommand {
  /** typed without the leading slash */
  name: string;
  description: string;
  /** false hides the row — a command is never offered when it can't work */
  enabled: (dir: string) => boolean;
  run: (dir: string) => Promise<unknown>;
}

/** The checkpoint taken before the most recent user message, if there is one. */
export function lastCheckpoint(dir: string): string | null {
  const { entries } = agentSessionFor(dir);
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e.kind === "user" && e.checkpoint) return e.checkpoint;
  }
  return null;
}

const pendingEdits = (dir: string) => agentSessionFor(dir).editFiles.length > 0;

export const LOCAL_COMMANDS: LocalCommand[] = [
  {
    name: "undo",
    description: "Put the project back to just before your last message",
    enabled: (dir) => lastCheckpoint(dir) != null,
    run: (dir) => {
      const id = lastCheckpoint(dir);
      if (!id) return Promise.reject(new Error("there's no checkpoint to go back to"));
      return agentRestoreCheckpoint(dir, id);
    },
  },
  {
    name: "keep",
    description: "Accept every file the agent changed",
    enabled: pendingEdits,
    run: (dir) => agentEditKeep(dir, null),
  },
  {
    name: "revert",
    description: "Throw away every file the agent changed",
    enabled: pendingEdits,
    run: (dir) => agentEditUndo(dir, null),
  },
];

export type CommandRow =
  | { kind: "agent"; name: string; description: string; hint?: string; group?: string }
  | { kind: "local"; name: string; description: string };

/**
 * The / menu's rows for a query (the text after the slash, may be empty).
 * Chronicle's own commands lead — there are three of them against the agent's
 * ninety-odd, and burying them under a plugin's skills would hide them.
 */
export function commandRows(dir: string, query: string): CommandRow[] {
  const q = query.toLowerCase().trim();
  const hit = (name: string, description: string) =>
    q.length === 0 || name.toLowerCase().includes(q) || description.toLowerCase().includes(q);

  const local: CommandRow[] = LOCAL_COMMANDS.filter((c) => c.enabled(dir) && hit(c.name, c.description)).map(
    (c) => ({ kind: "local", name: c.name, description: c.description }),
  );

  const agent: CommandRow[] = agentCommandsFor(dir)
    .filter((c) => hit(c.name, c.description))
    .map((c) => ({
      kind: "agent",
      name: c.name,
      description: c.description,
      hint: c.hint,
      group: c.group,
    }));

  // an exact name match wins outright — typing "/undo" fully must not leave a
  // fuzzy neighbour highlighted when Enter is pressed
  const exact = (r: CommandRow) => (r.name.toLowerCase() === q ? 0 : 1);
  return [...local, ...agent].sort((a, b) => exact(a) - exact(b));
}

function agentCommandsFor(dir: string): AgentCommand[] {
  return agentSessionFor(dir).commands;
}
