/*
 * The terminal route: a round runs in a tab you can watch, type into, and
 * scroll back through — the agent's own CLI, spawned in the project, handed
 * the round's run message and nothing else.
 *
 * There is no headless session behind this and no log file to poll: the tab IS
 * the run. It is NOT, however, what says the round finished — the tab is a
 * shell, and the agent inside it can exit hours before anyone closes the tab.
 * A finished round is announced from the record, by `refreshNotes`, on both
 * routes alike. What the tab dying says is narrower and still worth saying:
 * nothing is running this round any more. That meets the pane's turn-end path
 * in `settleRoundRun`, so the two routes end a round the same way.
 */
import { roundRunMessage } from "./ipc";
import { terminalRoundCommand } from "./notes-model";
import { clearRunningRound, markRunningRound, runningRoundFor } from "./round-log";
import { getTerm, spawnTerm, subscribeTerms } from "./term-sessions";
import { settleRoundRun } from "./agent-session";

/**
 * Run round `n` in a fresh terminal tab. Rust builds the run message, the same
 * one the pane route sends; `spawnTerm` gives the new tab the spotlight.
 *
 * The mark goes up BEFORE the first await, with no tab in it yet. Two awaits
 * stand between the click and a running tab, and the mark is what flips the
 * card from "plan ready" to "executing" — marking afterwards left both Run
 * buttons live for that whole wait, and a second click spawned a second agent
 * on the same round. The tab's id is written into the mark as soon as there is
 * one; a start that never gets that far takes the mark back down.
 */
export async function startRoundInTerminal(
  dir: string,
  n: number,
  /** the round's note count — the terminal route has no card to count into,
   *  and takes it only so both routes are called the same way */
  _total: number,
  agent: "claude" | "codex",
): Promise<void> {
  markRunningRound(dir, { n, route: "terminal" });
  let id: number;
  try {
    const message = await roundRunMessage(dir, n);
    const sess = await spawnTerm(dir, {
      title: `Round ${n}`,
      agent, // the tab wears the agent's name, the way "Start Claude" does
      autoType: terminalRoundCommand(agent, message),
    });
    id = sess.id;
  } catch (e) {
    // only OUR mark: a start that failed must not take down a round someone
    // has since begun (that one has a tab, so it has a termId)
    const m = runningRoundFor(dir);
    if (m?.n === n && m.route === "terminal" && m.termId == null) clearRunningRound(dir);
    throw e;
  }
  markRunningRound(dir, { n, route: "terminal", termId: id });
  watchRoundTab(dir, n, id);
}

/**
 * Wait for the round's tab to end, then stop claiming the round is running.
 *
 * Two different endings arrive here. The pty exiting (`dead`) is the run
 * ending, so it settles: the record is read back, and `settleRoundRun` speaks
 * only if the round did not finish. The session DISAPPEARING is someone
 * closing the tab — or the whole project closing, which tears every tab down
 * on its way out — so the mark is cleared and nothing else is touched: a
 * closed project must not be read back or announced into.
 *
 * Either way the check runs at most once, because the subscription is dropped
 * the first time it reports an ending.
 *
 * The mark is the guard against touching someone else's run: by the time this
 * tab dies the user may have started a newer round or re-routed this one, and
 * only a mark that still names this tab is ours. A mark with no tab in it yet
 * is the interim mark of a start still in flight, which is ours too — it is
 * this round, and the id lands in it a moment later.
 */
function watchRoundTab(dir: string, n: number, termId: number): void {
  const ended = () => {
    const t = getTerm(termId);
    if (t && !t.dead) return false;
    const mark = runningRoundFor(dir);
    const ours = mark?.n === n && mark.route === "terminal" && (mark.termId == null || mark.termId === termId);
    if (ours) {
      if (t) settleRoundRun(dir, n); // clears the mark itself, then reads the record back
      else clearRunningRound(dir);
    }
    return true;
  };
  // a pty that died before this subscribed would never notify again — the mark
  // would say "executing" forever
  if (ended()) return;
  const un = subscribeTerms(() => {
    if (ended()) un();
  });
}
