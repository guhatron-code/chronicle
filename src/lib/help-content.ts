/*
 * The Help screen's content (G7/G8) — task recipes, the plain glossary, and
 * the shortcuts, all in a non-developer's language. Data lives here so the
 * screen is presentational and search has one place to read from. The
 * shortcuts are the ACTUAL shipped bindings (the comp's ⌘J/⌘R were
 * placeholders); reconcile here if the keymap in App.tsx changes.
 */

export type HelpTarget = "road" | "repo" | "kanban" | "agent" | "setup";

export interface Recipe {
  title: string;
  steps: string[];
  /** where "Show me" takes you */
  target: HelpTarget;
}

export interface GlossaryTerm {
  term: string;
  meaning: string;
  /** the technical word, shown small in mono — omitted when there isn't one */
  technical?: string;
}

export interface Shortcut {
  keys: string;
  label: string;
}

export const RECIPES: Recipe[] = [
  {
    title: "Publish my project online",
    steps: ["Open the project you want to share.", "In the Repo view, press Publish.", "Pick who can see it, then confirm."],
    target: "repo",
  },
  {
    title: "Undo what the agent changed",
    steps: ["Find the checkpoint from just before the change.", "Press Undo to here.", "Your files go back to how they were."],
    target: "agent",
  },
  {
    title: "Start a phase with the agent",
    steps: ["Open the phase in the Roadmap.", "Press Start with the agent.", "Answer its questions; it works while you watch."],
    target: "road",
  },
  {
    title: "Understand a red mark in “what needs you”",
    steps: ["A red dot means one thing is waiting on you.", "Click it to read what happened, in plain words.", "Do the one action it suggests."],
    target: "road",
  },
  {
    title: "Bring down changes from another computer",
    steps: ["Open the project in the Repo view.", "Press Bring down.", "The newest version lands on this computer."],
    target: "repo",
  },
  {
    title: "Start a fresh project",
    steps: ["From the picker, press New project.", "Give it a name and pick a folder.", "Chronicle opens it, ready to go."],
    target: "road",
  },
  {
    title: "Sign back in when the agent needs a login",
    steps: ["The agent shows “isn’t signed in”.", "Press Sign in — a terminal opens.", "Finish there; the agent picks up on its own."],
    target: "agent",
  },
];

export const GLOSSARY: GlossaryTerm[] = [
  { term: "save", meaning: "Record where your project is right now, so you can come back to it.", technical: "commit" },
  { term: "publish", meaning: "Put your project online so others can see it.", technical: "push" },
  { term: "bring down", meaning: "Get the newest version of your project onto this computer.", technical: "pull" },
  { term: "the agent", meaning: "The AI that writes and edits your project for you." },
  { term: "a phase", meaning: "A chunk of work with a goal — like “add the sign-up page”." },
  { term: "a round", meaning: "One back-and-forth with the agent inside a phase." },
  { term: "a checkpoint", meaning: "A saved moment you can go back to if something goes wrong." },
  { term: "works freely", meaning: "The agent edits files without asking each time. Commands still ask." },
  { term: "what needs you", meaning: "The list of things waiting on a decision or action from you." },
  { term: "a workspace", meaning: "The folder on your computer where one project lives.", technical: "working directory" },
];

export const SHORTCUTS: Shortcut[] = [
  { keys: "⌘K", label: "Open another project" },
  { keys: "⌘O", label: "Open a folder" },
  { keys: "⌘1–9", label: "Switch between open projects" },
  { keys: "⌘J", label: "Cycle Roadmap · Repo · Kanban" },
  { keys: "⌥⌘1", label: "Show or hide the content pane" },
  { keys: "⌥⌘2", label: "Show or hide the agent" },
  { keys: "⌥⌘3", label: "Show or hide the terminal" },
  { keys: "⌘⏎", label: "Send a message to the agent" },
  { keys: "⌘T", label: "New terminal" },
  { keys: "⌘⇧F", label: "Search this project" },
  { keys: "⌘W", label: "Close the project" },
  { keys: "⌘/", label: "Open Help" },
];

export interface SearchHit {
  kind: "recipe" | "glossary";
  title: string;
  sub?: string;
  recipe?: Recipe;
  term?: GlossaryTerm;
}

/** Search across recipes + glossary — one ranked list, both kinds. */
export function searchHelp(q: string): SearchHit[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return [];
  const hits: SearchHit[] = [];
  for (const r of RECIPES) {
    const hay = `${r.title} ${r.steps.join(" ")}`.toLowerCase();
    if (hay.includes(needle)) hits.push({ kind: "recipe", title: r.title, recipe: r });
  }
  for (const g of GLOSSARY) {
    const hay = `${g.term} ${g.meaning} ${g.technical ?? ""}`.toLowerCase();
    if (hay.includes(needle)) hits.push({ kind: "glossary", title: g.term, sub: g.meaning, term: g });
  }
  // title/term matches rank above body-only matches
  hits.sort((a, b) => Number(b.title.toLowerCase().includes(needle)) - Number(a.title.toLowerCase().includes(needle)));
  return hits;
}
