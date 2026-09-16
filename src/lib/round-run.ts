/*
 * The terminal route: a round runs in a tab you can watch, type into, and
 * scroll back through — the agent's own CLI, spawned in the project, handed
 * the round's run message and nothing else.
 *
 * There is no headless session behind this and no log file to poll: the tab IS
 * the run. So the tab is also the only thing that can say the run is over —
 * the pty exiting is the end of the round, exactly as the turn ending is the
 * end of a round in the pane. Both ends meet in `settleRoundRun`, so the two
 * routes announce a round the same way.
 */
import { roundRunMessage } from "./ipc";
import { terminalRoundCommand } from "./notes-model";
import { clearRunningRound, markRunningRound, runningRoundFor } from "./round-log";
import { getTerm, setActiveTermFor, spawnTerm, subscribeTerms } from "./term-sessions";
import { settleRoundRun } from "./agent-session";

/**
 * Run round `n` in a fresh terminal tab. Rust builds the run message (one
 * source for both routes); the tab takes the spotlight so the user lands on
 * the round they just started.
 */
export async function startRoundInTerminal(
  dir: string,
  n: number,
  /** the round's note count — the terminal route has no card to count into,
   *  and takes it only so both routes are called the same way */
  _total: number,
  agent: "claude" | "codex",
): Promise<void> {
  const message = await roundRunMessage(dir, n);
  const sess = await spawnTerm(dir, {
    title: `Round ${n}`,
    agent, // the tab wears the agent's name, the way "Start Claude" does
    autoType: terminalRoundCommand(agent, message),
  });
  setActiveTermFor(dir, sess.id);
  markRunningRound(dir, { n, route: "terminal", termId: sess.id });
  watchRoundTab(dir, n, sess.id);
}

/**
 * Wait for the round's tab to end, then stop claiming the round is running.
 *
 * Two different endings arrive here. The pty exiting (`dead`) is the round
 * itself finishing or dying, so it settles: the notes are read back and the
 * round announces itself. The session DISAPPEARING is someone closing the tab
 * — or the whole project closing, which tears every tab down on its way out —
 * so the mark is cleared and nothing else is touched: a closed project must
 * not be read back or announced into.
 *
 * The mark is the guard against clearing someone else's run: by the time a tab
 * dies the user may have started a newer round, or re-routed this one, and
 * only a mark that still names THIS tab belongs to us. Unsubscribing first
 * means the clear happens exactly once.
 */
function watchRoundTab(dir: string, n: number, termId: number): void {
  const ended = () => {
    const t = getTerm(termId);
    if (t && !t.dead) return false;
    const mark = runningRoundFor(dir);
    if (mark?.route === "terminal" && mark.termId === termId && mark.n === n) {
      clearRunningRound(dir);
      if (t) settleRoundRun(dir, n);
    }
    return true;
  };
  // a pty that died between the spawn resolving and this subscribing would
  // never notify again — the mark would say "executing" forever
  if (ended()) return;
  const un = subscribeTerms(() => {
    if (ended()) un();
  });
}
